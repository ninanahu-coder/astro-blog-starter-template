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
	downPayment, expectedYield, FINANCE, loanPayment, propertyDue, saleNote, saleProceeds, weeklyInterest, weeklyPrincipal, weeksToPayOff,
} from '../../src/game/core/finance.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'prop-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 21 }),
	...over,
});
const flat = PROPERTIES.find((p) => p.id === 'perth-apartment')!;
const townhouse = PROPERTIES.find((p) => p.id === 'margaret-townhouse')!;
/** 睡一觉把时间推到指定那天晚上，触发途中的周结算 */
const passTo = (s: PlayerState, day: number) => applyAction({ ...s, clock: at(20, day) }, WA, { t: 'activity', id: 'sleep-camp' }).state;

test('房产数据自洽，出租收益不超过上限', () => {
	const locs = new Set(WORLD.locations.map((l) => l.id));
	assert.equal(new Set(PROPERTIES.map((p) => p.id)).size, PROPERTIES.length);
	for (const p of PROPERTIES) {
		assert.ok(locs.has(p.loc), `${p.id} 地点存在`);
		assert.ok(HOMES.some((h) => h.id === p.homeType), `${p.id} 房型存在`);
		const y = expectedYield(p);
		assert.ok(y > 0 && y <= FINANCE.yieldCap, `${p.id} 年化净收益 ${(y * 100).toFixed(2)}% 应在 0–4%`);
	}
});

test('第二十四轮：玛格丽特河镇中心联排是可买的入门 flat', () => {
	const listed = propertiesAt(make({ loc: 'margaret-river', cash: 300000 }), WA);
	assert.deepEqual(listed.map((x) => x.property.id), ['margaret-townhouse', 'margaret-beach-house']);
	assert.equal(downPayment(townhouse), 10000);
	assert.ok(expectedYield(townhouse) >= 0.035 && expectedYield(townhouse) <= 0.037);
});

test('贷款公式', () => {
	// 河景公寓第十一轮：房价 70000、物业费 28
	assert.equal(downPayment(flat), 7000);
	assert.equal(weeklyInterest(56000), 56);
	assert.equal(weeklyPrincipal(flat, 56000), 350);
	assert.equal(weeklyPrincipal(flat, 100), 100, '最后一期只还剩下的');
	assert.equal(loanPayment(flat, 56000), 406);
	assert.equal(loanPayment(flat, 0), 0);
	assert.equal(propertyDue(flat, { id: flat.id, loan: 56000, rented: false, missed: 0 }), 28 + 406);
	assert.equal(weeksToPayOff(flat, 56000), 160);
	assert.equal(saleProceeds(flat, 56000), 66500 - 56000);
	assert.equal(saleProceeds(flat, 70000), 0, '资不抵债时到手为 0，不会为负');
	// 卖房日志（第十三轮）：不够还贷时写明免掉多少，不写「还清」
	assert.equal(saleNote(flat, 0), '到手 $66500');
	assert.equal(saleNote(flat, 56000), '还清贷款 $56000 后到手 $10500');
	assert.equal(saleNote(flat, 72000), '卖价 $66500 抵贷款 $72000；不足的 $5500 已免除，到手 $0');
	assert.equal(saleNote(flat, 72072, FINANCE.forecloseShare), '卖价 $59500 抵贷款 $72072；不足的 $12572 已免除，到手 $0');
});

test('卖房：卖价不够还贷，短缺免掉、提示不写还清', () => {
	let s = buyProperty(make({ cash: 7000, clock: at(10) }), WA, flat.id, true).state;
	s = { ...s, properties: [{ ...s.properties[0], loan: 72000 }] };
	const r = sellProperty(s, flat.id);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, s.cash, '到手 0，现金不变');
	assert.equal(r.state.properties.length, 0);
	assert.match(r.msg, /不足的 \$5500 已免除，到手 \$0/);
	assert.doesNotMatch(r.msg, /还清/);
});

test('买房：全款或贷款；要在当地；钱不够', () => {
	const rich = make({ cash: 100000, clock: at(10) });
	assert.equal(propertiesAt({ ...rich, loc: 'broome' }, WA).length, 0);
	const full = buyProperty(rich, WA, flat.id, false);
	assert.ok(full.ok);
	assert.equal(full.state.cash, 30000);
	assert.deepEqual(ownedProperty(full.state, flat.id), { id: flat.id, loan: 0, rented: false, missed: 0 });
	assert.equal(buyProperty(full.state, WA, flat.id, true).ok, false, '不能重复买');

	const s = make({ cash: 20000, clock: at(10) });
	assert.equal(buyProperty(s, WA, flat.id, false).ok, false, '全款不够');
	const loan = buyProperty(s, WA, flat.id, true);
	assert.ok(loan.ok);
	assert.equal(loan.state.cash, 13000);
	assert.equal(ownedProperty(loan.state, flat.id)!.loan, 63000);
	assert.equal(buyProperty(make({ cash: 6999 }), WA, flat.id, true).ok, false, '首付不够');
	assert.equal(buyProperty({ ...rich, loc: 'fremantle' }, WA, flat.id, false).ok, false, '人不在当地');
});

test('买了马上卖亏 5%；净资产按可变现价值算', () => {
	const s = make({ cash: 100000, clock: at(10) });
	assert.equal(netWorth(s), 100000);
	const bought = buyProperty(s, WA, flat.id, false).state;
	assert.equal(netWorth(bought), 30000 + 66500);
	const sold = sellProperty(bought, flat.id);
	assert.equal(sold.state.cash, 96500);
	assert.equal(sold.state.properties.length, 0);
	const viaLoan = sellProperty(buyProperty(make({ cash: 20000, clock: at(10) }), WA, flat.id, true).state, flat.id);
	assert.equal(viaLoan.state.cash, 13000 + 3500, '贷款买再卖同样亏掉房价的 5%');
	assert.equal(sellProperty(s, flat.id).ok, false);
});

test('自住：不交房租，只交物业费；可以添家具、回家睡觉', () => {
	let s = buyProperty(make({ cash: 100000, clock: at(10) }), WA, flat.id, false).state;
	const moved = moveIntoProperty(s, flat.id);
	assert.ok(moved.ok);
	s = moved.state;
	assert.deepEqual(s.home, { type: 'flat', loc: 'perth', furniture: {}, owned: flat.id });
	assert.deepEqual(weeklyCosts(s), { rent: 0, vehicle: 0, property: 28, total: 28, ahead: 0 });
	assert.equal(moveIntoProperty(s, flat.id).ok, false, '已经住在这里');
	s = buyFurniture(s, WA, 'mattress').state;
	assert.ok(sleepHome({ ...s, needs: { ...s.needs, energy: 5 } }, WA).ok);
	const week = passTo(s, 6);
	assert.equal(week.cash, s.cash - 28, '一周只扣物业费');
	assert.ok(week.home, '不会被收房');
});

test('每周还款：本金减少，还清后只剩物业费', () => {
	let s = buyProperty(make({ cash: 30000, clock: at(10) }), WA, flat.id, true).state;
	const w1 = passTo(s, 6);
	assert.equal(w1.cash, s.cash - (28 + 63 + 350));
	assert.equal(ownedProperty(w1, flat.id)!.loan, 62650);
	const paid = repayLoan(w1, flat.id, 5000);
	assert.equal(ownedProperty(paid.state, flat.id)!.loan, 57650);
	assert.equal(repayLoan(w1, flat.id, 1e9).state.cash, 0, '最多还到手头现金');
	assert.equal(repayLoan(w1, flat.id, -5).ok, false);
	s = { ...w1, cash: 90000 };
	s = repayLoan(s, flat.id, 90000).state;
	assert.equal(ownedProperty(s, flat.id)!.loan, 0);
	assert.equal(s.cash, 90000 - 62650);
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
	let s = buyProperty(make({ cash: 7000, clock: at(10) }), WA, flat.id, true).state;
	s = moveIntoProperty(s, flat.id).state;
	assert.equal(s.cash, 0);
	const w1 = passTo(s, 6);
	assert.equal(ownedProperty(w1, flat.id)!.missed, 1);
	assert.equal(ownedProperty(w1, flat.id)!.loan, 63063, '欠的利息计入本金');
	const w2 = passTo(w1, 13);
	assert.equal(ownedProperty(w2, flat.id)!.missed, 2);
	assert.ok(w2.home, '宽限期内还住着');
	const w3 = passTo(w2, 20);
	assert.equal(w3.properties.length, 0, '第三次欠款被强制卖出');
	assert.equal(w3.home, null);
	assert.ok(w3.cash >= 0 && w3.cash < 7000, `到手 ${w3.cash}，比首付少`);
	const forced = w3.journal.find((j) => j.text.includes('被强制卖出，'))!.text;
	assert.match(forced, /卖价 \$59500 抵贷款 \$\d+；不足的 \$\d+ 已免除，到手 \$0/, forced);
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
	assert.equal(sold.state.cash, s.cash + 66500 + 200);
});

test('动作协议与存档校验', () => {
	assert.deepEqual(parseAction({ t: 'property', op: 'buy', id: 'perth-apartment', loan: 'yes' }), { t: 'property', op: 'buy', id: 'perth-apartment', loan: false });
	assert.deepEqual(parseAction({ t: 'property', op: 'repay', id: 'perth-apartment', amount: 99.9 }), { t: 'property', op: 'repay', id: 'perth-apartment', amount: 99 });
	assert.equal(parseAction({ t: 'property', op: 'repay', id: 'perth-apartment', amount: -1 }), null);
	assert.equal(parseAction({ t: 'property', op: 'seize', id: 'perth-apartment' }), null);
	// 按揭买房要先开户、有收入（banking.md）；全款不受影响
	const noBank = applyAction(make({ cash: 20000, clock: at(10) }), WA, { t: 'property', op: 'buy', id: flat.id, loan: true });
	assert.ok(!noBank.ok && noBank.msg.includes('开'), noBank.msg);
	const worker = make({ cash: 20000, clock: at(10), job: { career: 'barista', loc: 'perth', level: 2, shifts: 0, good: 0, lastDay: -1 } });
	worker.bank.open = true;
	assert.ok(applyAction(worker, WA, { t: 'property', op: 'buy', id: flat.id, loan: true }).ok);

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
	assert.deepEqual(clean.properties, [{ id: flat.id, loan: 90000, rented: false, missed: 2 }], '贷款封顶按以前最高的房价（第十一轮降价前 9 万）');
	assert.equal(clean.home, null, '声称住在没买的房子里：住处作废');
	const rentedHome = sanitizeState({ ...base, properties: [{ id: flat.id, loan: 0, rented: true, missed: 0 }], home: { type: 'flat', loc: 'perth', furniture: {}, owned: flat.id } })!;
	assert.equal(rentedHome.home, null, '不能同时出租和自住');
	const old = { ...base } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'properties');
	assert.deepEqual(sanitizeState(old)!.properties, []);
});

test('第十一轮降价后的旧存档：按原价交的合租押金、按原价贷的房贷不会被存档清洗或欠款计息砍掉', () => {
	const room = HOMES.find((h) => h.id === 'room')!;
	assert.equal(room.rentWeek, 120);
	const base = make();
	const old = sanitizeState({ ...base, home: { type: 'room', loc: 'perth', furniture: {}, bond: 320 } })!;
	assert.equal(old.home!.bond, 320, '旧存档按 $160 周租交的 2 周押金照退');
	assert.equal(sanitizeState({ ...base, home: { type: 'room', loc: 'perth', furniture: {}, bond: 99999 } })!.home!.bond, 320, '伪造的押金仍封顶');
	assert.equal(flat.price, 70000);
	const owner = sanitizeState({ ...base, properties: [{ id: flat.id, loan: 81000, rented: false, missed: 0 }] })!;
	assert.equal(ownedProperty(owner, flat.id)!.loan, 81000, '按 9 万房价贷的款不抹掉');
	const broke = passTo({ ...owner, cash: 0 }, 6);
	assert.equal(ownedProperty(broke, flat.id)!.missed, 1);
	assert.equal(ownedProperty(broke, flat.id)!.loan, 81081, '欠款计息照常加到本金，不被新房价截断');
});
