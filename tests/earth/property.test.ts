import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { weeklyCosts } from '../../src/game/core/attributes.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	buyFurniture, buyProperty, moveIntoProperty, netWorth, ownedProperty, propertiesAt, repayLoan, sellProperty, sleepHome,
	toggleRentOut,
} from '../../src/game/core/engine.ts';
import {
	downPayment, expectedYield, FINANCE, loanPayment, propertyDue, saleProceeds, weeklyInterest, weeklyPrincipal, weeksToPayOff,
} from '../../src/game/core/finance.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'prop-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 21 }),
	...over,
});
const flat = PROPERTIES.find((p) => p.id === 'perth-apartment')!;
/** 睡一觉把时间推到指定那天晚上，触发途中的周结算 */
const passTo = (s: PlayerState, day: number) => applyAction({ ...s, clock: at(20, day) }, WA, { t: 'activity', id: 'sleep-camp' }).state;

test('房产数据自洽，出租收益不超过上限', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	assert.equal(new Set(PROPERTIES.map((p) => p.id)).size, PROPERTIES.length);
	for (const p of PROPERTIES) {
		assert.ok(locs.has(p.loc), `${p.id} 地点存在`);
		assert.ok(HOMES.some((h) => h.id === p.homeType), `${p.id} 房型存在`);
		const y = expectedYield(p);
		assert.ok(y > 0 && y <= FINANCE.yieldCap, `${p.id} 年化净收益 ${(y * 100).toFixed(2)}% 应在 0–4%`);
	}
});

test('贷款公式', () => {
	assert.equal(downPayment(flat), 9000);
	assert.equal(weeklyInterest(72000), 72);
	assert.equal(weeklyPrincipal(flat, 72000), 450);
	assert.equal(weeklyPrincipal(flat, 100), 100, '最后一期只还剩下的');
	assert.equal(loanPayment(flat, 72000), 522);
	assert.equal(loanPayment(flat, 0), 0);
	assert.equal(propertyDue(flat, { id: flat.id, loan: 72000, rented: false, missed: 0 }), 36 + 522);
	assert.equal(weeksToPayOff(flat, 72000), 160);
	assert.equal(saleProceeds(flat, 72000), 85500 - 72000);
	assert.equal(saleProceeds(flat, 90000), 0, '资不抵债时到手为 0，不会为负');
});

test('买房：全款或贷款；要在当地；钱不够', () => {
	const rich = make({ cash: 100000, clock: at(10) });
	assert.equal(propertiesAt({ ...rich, loc: 'broome' }, WA).length, 0);
	const full = buyProperty(rich, WA, flat.id, false);
	assert.ok(full.ok);
	assert.equal(full.state.cash, 10000);
	assert.deepEqual(ownedProperty(full.state, flat.id), { id: flat.id, loan: 0, rented: false, missed: 0 });
	assert.equal(buyProperty(full.state, WA, flat.id, true).ok, false, '不能重复买');

	const s = make({ cash: 20000, clock: at(10) });
	assert.equal(buyProperty(s, WA, flat.id, false).ok, false, '全款不够');
	const loan = buyProperty(s, WA, flat.id, true);
	assert.ok(loan.ok);
	assert.equal(loan.state.cash, 11000);
	assert.equal(ownedProperty(loan.state, flat.id)!.loan, 81000);
	assert.equal(buyProperty(make({ cash: 8999 }), WA, flat.id, true).ok, false, '首付不够');
	assert.equal(buyProperty({ ...rich, loc: 'fremantle' }, WA, flat.id, false).ok, false, '人不在当地');
});

test('买了马上卖亏 5%；净资产按可变现价值算', () => {
	const s = make({ cash: 100000, clock: at(10) });
	assert.equal(netWorth(s), 100000);
	const bought = buyProperty(s, WA, flat.id, false).state;
	assert.equal(netWorth(bought), 10000 + 85500);
	const sold = sellProperty(bought, flat.id);
	assert.equal(sold.state.cash, 95500);
	assert.equal(sold.state.properties.length, 0);
	const viaLoan = sellProperty(buyProperty(make({ cash: 20000, clock: at(10) }), WA, flat.id, true).state, flat.id);
	assert.equal(viaLoan.state.cash, 11000 + 4500, '贷款买再卖同样亏掉房价的 5%');
	assert.equal(sellProperty(s, flat.id).ok, false);
});

test('自住：不交房租，只交物业费；可以添家具、回家睡觉', () => {
	let s = buyProperty(make({ cash: 100000, clock: at(10) }), WA, flat.id, false).state;
	const moved = moveIntoProperty(s, flat.id);
	assert.ok(moved.ok);
	s = moved.state;
	assert.deepEqual(s.home, { type: 'flat', loc: 'perth', furniture: {}, owned: flat.id });
	assert.deepEqual(weeklyCosts(s), { rent: 0, vehicle: 0, property: 36, total: 36 });
	assert.equal(moveIntoProperty(s, flat.id).ok, false, '已经住在这里');
	s = buyFurniture(s, WA, 'mattress').state;
	assert.ok(sleepHome({ ...s, needs: { ...s.needs, energy: 5 } }, WA).ok);
	const week = passTo(s, 6);
	assert.equal(week.cash, s.cash - 36, '一周只扣物业费');
	assert.ok(week.home, '不会被收房');
});

test('每周还款：本金减少，还清后只剩物业费', () => {
	let s = buyProperty(make({ cash: 30000, clock: at(10) }), WA, flat.id, true).state;
	const w1 = passTo(s, 6);
	assert.equal(w1.cash, s.cash - (36 + 81 + 450));
	assert.equal(ownedProperty(w1, flat.id)!.loan, 80550);
	const paid = repayLoan(w1, flat.id, 5000);
	assert.equal(ownedProperty(paid.state, flat.id)!.loan, 75550);
	assert.equal(repayLoan(w1, flat.id, 1e9).state.cash, 0, '最多还到手头现金');
	assert.equal(repayLoan(w1, flat.id, -5).ok, false);
	s = { ...w1, cash: 90000 };
	s = repayLoan(s, flat.id, 90000).state;
	assert.equal(ownedProperty(s, flat.id)!.loan, 0);
	assert.equal(s.cash, 90000 - 80550);
	assert.equal(repayLoan(s, flat.id, 100).ok, false, '没有贷款了');
});

test('出租：收租金、偶尔空置和维修；搬进去就停止出租', () => {
	let s = buyProperty(make({ cash: 200000, clock: at(10) }), WA, flat.id, false).state;
	s = moveIntoProperty(s, flat.id).state;
	const r = toggleRentOut(s, flat.id);
	assert.ok(r.ok);
	assert.equal(r.state.home, null, '出租要先搬出');
	assert.ok(ownedProperty(r.state, flat.id)!.rented);
	// 跑 104 周，统计实际净收益，应接近并不超过设计上限太多
	let cur = r.state;
	const start = cur.cash;
	for (let w = 0; w < 104; w++) cur = passTo({ ...cur, needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 }, health: 100 }, 6 + w * 7);
	const perYear = (cur.cash - start) / 2 / flat.price;
	assert.ok(perYear > 0.01 && perYear < 0.06, `两年实际年化 ${(perYear * 100).toFixed(2)}%`);
	assert.ok(cur.journal.some((j) => j.text.includes('租金收入')));
	const back = moveIntoProperty(cur, flat.id);
	assert.equal(ownedProperty(back.state, flat.id)!.rented, false);
	assert.equal(toggleRentOut(toggleRentOut(s, flat.id).state, flat.id).state.properties[0].rented, false, '再点一次停止出租');
});

test('出租从下一个结算期起算：结算前挂牌、结算后搬回，领不到租金', () => {
	const rested = { needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 }, health: 100 };
	let s = buyProperty(make({ cash: 200000, clock: at(10) }), WA, flat.id, false).state;
	s = moveIntoProperty(s, flat.id).state;
	// 第 6 天晚上挂牌，睡一觉跨过第 7 天的结算
	const listed = toggleRentOut({ ...s, ...rested, clock: at(20, 6) }, flat.id);
	assert.match(listed.msg, /下个结算日之后开始收租/);
	assert.equal(ownedProperty(listed.state, flat.id)!.fresh, true);
	const w1 = passTo(listed.state, 6);
	assert.ok(w1.nextWeek > 7, '已经过了一次结算');
	assert.ok(w1.journal.some((j) => j.text.includes('刚挂牌')));
	assert.ok(!w1.journal.some((j) => j.text.includes('租金收入') || j.text.includes('空置')), '第一期不计租');
	assert.equal(ownedProperty(w1, flat.id)!.fresh, undefined);
	assert.equal(w1.cash, listed.state.cash - flat.weekly, '只付了物业费，没有租金');
	// 结算后立刻搬回：没领到任何租金
	const back = moveIntoProperty(w1, flat.id).state;
	assert.equal(back.cash, w1.cash);
	// 一直租着：第二期开始正常计租（收租或空置）
	const w2 = passTo({ ...w1, ...rested }, 13);
	assert.ok(w2.journal.some((j) => j.text.includes('租金收入') || j.text.includes('空置')));
	// 挂牌后在结算前取消，标记也清掉
	assert.equal(ownedProperty(toggleRentOut(listed.state, flat.id).state, flat.id)!.fresh, undefined);
});

test('「乔迁之喜」每套房只给一次：搬出再搬回不能反复刷', () => {
	let s = buyProperty(make({ cash: 200000, clock: at(10) }), WA, flat.id, false).state;
	const first = moveIntoProperty(s, flat.id).state;
	assert.ok(first.moodlets.some((m) => m.id === 'new-home'));
	assert.equal(ownedProperty(first, flat.id)!.lived, true);
	const out = applyAction({ ...first, moodlets: [] }, WA, { t: 'home', op: 'leave' }).state;
	const again = moveIntoProperty(out, flat.id);
	assert.ok(again.ok, again.msg);
	assert.ok(!again.state.moodlets.some((m) => m.id === 'new-home'), '第二次搬进同一套房不再给');
	// 旧存档没有 lived：正住在里面算住过，没住过的不算
	const locs = new Set(WA.locations.map((l) => l.id));
	const strip = (st: PlayerState) => ({ ...st, properties: st.properties.map(({ lived: _l, fresh: _f, ...rest }) => rest) });
	assert.equal(sanitizeState(strip(first), locs)!.properties[0].lived, true);
	assert.equal(sanitizeState(strip(s), locs)!.properties[0].lived, undefined);
	// fresh 只在出租中才保留
	const listed = toggleRentOut(first, flat.id).state;
	assert.equal(sanitizeState(listed, locs)!.properties[0].fresh, true);
	assert.equal(sanitizeState({ ...listed, properties: [{ ...listed.properties[0], rented: false }] }, locs)!.properties[0].fresh, undefined);
});

test('晕倒住院跨过结算日也要结算：醒来不能抢在断供前卖房', () => {
	let s = buyProperty(make({ cash: 9000, clock: at(10) }), WA, flat.id, true).state;
	s = moveIntoProperty(s, flat.id).state;
	// 已欠满宽限次数，第 6 天 22:30，快饿晕了；下一次结算在第 7 天
	const weak: PlayerState = {
		...s, cash: 0, clock: at(22, 6) + 30, nextWeek: 7, health: 0.5,
		needs: { hunger: 0, energy: 60, hygiene: 60, fun: 60, social: 60 },
		properties: [{ ...s.properties[0], missed: FINANCE.graceWeeks }],
	};
	const r = applyAction(weak, WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok && r.collapsed, r.msg);
	assert.ok(Math.floor(r.state.clock / 1440) >= 7, '醒来已经过了结算日');
	assert.ok(r.state.nextWeek > Math.floor(r.state.clock / 1440), '结算已经做过，没有逾期未结的');
	assert.equal(r.state.properties.length, 0, '断供的房子已被强制卖出');
});

test('断供：宽限两周，第三次欠款强制卖房，现金不会为负', () => {
	let s = buyProperty(make({ cash: 9000, clock: at(10) }), WA, flat.id, true).state;
	s = moveIntoProperty(s, flat.id).state;
	assert.equal(s.cash, 0);
	const w1 = passTo(s, 6);
	assert.equal(ownedProperty(w1, flat.id)!.missed, 1);
	assert.equal(ownedProperty(w1, flat.id)!.loan, 81081, '欠的利息计入本金');
	const w2 = passTo(w1, 13);
	assert.equal(ownedProperty(w2, flat.id)!.missed, 2);
	assert.ok(w2.home, '宽限期内还住着');
	const w3 = passTo(w2, 20);
	assert.equal(w3.properties.length, 0, '第三次欠款被强制卖出');
	assert.equal(w3.home, null);
	assert.ok(w3.cash >= 0 && w3.cash < 9000, `到手 ${w3.cash}，比首付少`);
	// 宽限期内补上就清零
	const saved = passTo({ ...w2, cash: 5000 }, 20);
	assert.equal(ownedProperty(saved, flat.id)!.missed, 0);
});

test('卖掉正在住的房子会搬出，家具折现', () => {
	let s = buyProperty(make({ cash: 100000, clock: at(10) }), WA, flat.id, false).state;
	s = moveIntoProperty(s, flat.id).state;
	s = buyFurniture(s, WA, 'mattress').state;
	const sold = sellProperty(s, flat.id);
	assert.equal(sold.state.home, null);
	assert.equal(sold.state.cash, s.cash + 85500 + 200);
});

test('动作协议与存档校验', () => {
	assert.deepEqual(parseAction({ t: 'property', op: 'buy', id: 'perth-apartment', loan: 'yes' }), { t: 'property', op: 'buy', id: 'perth-apartment', loan: false });
	assert.deepEqual(parseAction({ t: 'property', op: 'repay', id: 'perth-apartment', amount: 99.9 }), { t: 'property', op: 'repay', id: 'perth-apartment', amount: 99 });
	assert.equal(parseAction({ t: 'property', op: 'repay', id: 'perth-apartment', amount: -1 }), null);
	assert.equal(parseAction({ t: 'property', op: 'seize', id: 'perth-apartment' }), null);
	assert.ok(applyAction(make({ cash: 20000, clock: at(10) }), WA, { t: 'property', op: 'buy', id: flat.id, loan: true }).ok);

	const base = make();
	const dirty = {
		...base,
		properties: [
			{ id: flat.id, loan: 9e9, rented: 'true', missed: 99 },
			{ id: flat.id, loan: 0, rented: false, missed: 0 },
			{ id: 'white-house', loan: 0, rented: false, missed: 0 },
		],
		home: { type: 'flat', loc: 'perth', furniture: {}, owned: 'freo-terrace' },
	};
	const clean = sanitizeState(dirty)!;
	assert.deepEqual(clean.properties, [{ id: flat.id, loan: 90000, rented: false, missed: 2 }]);
	assert.equal(clean.home, null, '声称住在没买的房子里：住处作废');
	const rentedHome = sanitizeState({ ...base, properties: [{ id: flat.id, loan: 0, rented: true, missed: 0 }], home: { type: 'flat', loc: 'perth', furniture: {}, owned: flat.id } })!;
	assert.equal(rentedHome.home, null, '不能同时出租和自住');
	const old = { ...base } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'properties');
	assert.deepEqual(sanitizeState(old)!.properties, []);
});
