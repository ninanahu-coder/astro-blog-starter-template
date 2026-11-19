// 犯罪、罚款和法律后果（第 43 批，docs/earth-game/law.md）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { activitiesAt, applyEffect, getPendingEvent, performActivity, resolveEvent, travel, travelOptions } from '../../src/game/core/engine.ts';
import { applyOffence, breathTest, cleanLaw, demeritTotal, drankRecently, emptyLaw, heatCooldown, LAW_HIST_MAX, lawSummary, lawWeekly, licenceBanned, noteDrink, payFine, serveCommunity, visaNote } from '../../src/game/core/law.ts';
import { COMMUNITY_SERVICE, DEMERITS, DRINK, FINE_DEBT, getOffence, HEAT_RULES, OFFENCES, SA_VICTIMS_LEVY } from '../../src/game/data/law.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const DAY = 1440;
const at = (hour: number, day = 0) => day * DAY + hour * 60;
const make = (over: Partial<PlayerState> = {}, seed = 3): PlayerState => ({
	...createCharacter({ id: 'law-player', name: '守法', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(12, 10),
	cash: 5000,
	...over,
});
const clone = (s: PlayerState): PlayerState => structuredClone(s);

test('数据：每条违章两州都有罚款和出处；游戏数值标了 game；走法庭的才判社区服务', () => {
	const ids = new Set<string>();
	for (const o of OFFENCES) {
		assert.ok(!ids.has(o.id), `重复 ${o.id}`);
		ids.add(o.id);
		for (const p of [o.wa, o.sa]) {
			assert.ok(Number.isInteger(p.fine) && p.fine > 0, `${o.id} 罚款`);
			assert.ok(Number.isInteger(p.pts) && p.pts >= 0 && p.pts < DEMERITS.limit, `${o.id} 扣分`);
			assert.ok(p.src.length > 4, `${o.id} 要有出处`);
			if (p.game) assert.match(p.src, /游戏数值/, `${o.id} 游戏数值要在出处里写明`);
		}
		if (o.csHours) assert.ok(o.court, `${o.id} 只有法庭才判社区服务`);
		assert.ok(o.heat >= 0);
	}
	// 关键真实数值（2026-11-20 核对）：改了要同时改出处
	assert.deepEqual([getOffence('speed-mid')!.wa.fine, getOffence('speed-mid')!.wa.pts], [200, 2]);
	assert.deepEqual([getOffence('drink-low')!.wa.fine, getOffence('drink-low')!.wa.pts], [1000, 3]);
	assert.deepEqual([getOffence('drink-low')!.sa.fine, getOffence('drink-low')!.sa.pts], [904 + SA_VICTIMS_LEVY, 4]);
	assert.equal(getOffence('drink-low')!.sa.banDays ?? 0, 0, 'SA 0.05–0.079 首次交罚款不停驾');
});

test('事件数据：法律后果的 id 都存在；交通事件只在自己开车时出现；违法的选项不给好处', () => {
	let n = 0;
	for (const e of EVENTS) {
		for (const c of e.choices) {
			for (const out of [c.ok, c.fail]) {
				if (!out?.law) continue;
				n++;
				assert.ok(out.law === 'breath' || getOffence(out.law), `${e.id} 的 law ${out.law} 不存在`);
				if (out.law !== 'breath' && getOffence(out.law)!.traffic) assert.ok(e.driving, `${e.id} 有交通违章，要标 driving`);
			}
			if (c.risk !== undefined) {
				assert.ok(c.risk > 0 && c.risk < 1 && c.fail, `${e.id} risk 要配 fail`);
				// 冒险没被查到也不能有收益：不给钱、能力、声望，不降麻烦值
				const fx = c.ok.fx;
				assert.ok(!(fx.cash! > 0) && !fx.skills && !(fx.respect! > 0) && !(fx.heat! < 0), `${e.id}「${c.label}」不能美化违法`);
			}
		}
		if (e.driving) assert.deepEqual(e.arrivedBy, ['road'], `${e.id}`);
	}
	assert.ok(n >= 5);
	assert.ok(EVENTS.find((e) => e.id === 'rbt')!.driving);
});

test('罚款按所在州：同一违章在西澳、南澳罚款和扣分不同', () => {
	const wa = make();
	applyOffence(wa, 'speed-mid');
	assert.equal(wa.cash, 5000 - 200);
	assert.equal(demeritTotal(wa), 2);
	const sa = make({ region: 'sa' });
	applyOffence(sa, 'speed-mid');
	assert.equal(sa.cash, 5000 - 484 - SA_VICTIMS_LEVY);
	assert.equal(demeritTotal(sa), 3);
	assert.equal(sa.law.record, 0, '交通罚单不是定罪');
	assert.equal(visaNote(sa), null);
});

test('钱不够：当场交能交的，其余记欠款；周结算补交，交不上麻烦值上涨', () => {
	const s = make({ cash: 300 });
	const msg = applyOffence(s, 'drink-low');
	assert.equal(s.cash, 0);
	assert.equal(s.law.owed, 700);
	assert.match(msg, /欠 \$700/);
	const heat0 = s.heat;
	assert.equal(lawWeekly(s).length, 1);
	assert.equal(s.heat, heat0 + FINE_DEBT.overdueHeat, '一分没交上');
	s.cash = 500;
	lawWeekly(s);
	assert.equal(s.law.owed, 200);
	assert.equal(s.cash, 0);
	s.cash = 1000;
	const h = s.heat;
	lawWeekly(s);
	assert.equal(s.law.owed, 0);
	assert.equal(s.cash, 800);
	assert.equal(s.heat, h, '交清了不涨');
	assert.deepEqual(lawWeekly(s), [], '没欠款没社区服务时什么都不做');
	assert.equal(payFine(s, 100), 100);
});

test('引擎周结算会补交欠的罚款', () => {
	const s = make({ cash: 2000, vehicle: 'none', nextWeek: 11, law: { ...emptyLaw(), owed: 300 } });
	applyEffect(s, { minutes: 2 * DAY }, WA);
	assert.equal(s.law.owed, 0);
	assert.equal(s.cash, 1700);
	assert.ok(s.journal.some((j) => j.text.includes('补交罚款 $300')));
});

test('酒驾：3 年内第二次走法庭（定罪、停驾）；持签证的出身有签证提示；3 年后再犯按首次', () => {
	const s = make({ region: 'sa' });
	applyOffence(s, 'drink-low');
	assert.equal(s.law.record, 0);
	assert.ok(!licenceBanned(s), 'SA 首次交罚款不停驾');
	s.clock += 30 * DAY;
	const msg = applyOffence(s, 'drink-low');
	assert.equal(s.law.hist.at(-1)!.id, 'drink-repeat');
	assert.equal(s.law.record, 1);
	assert.equal(s.law.ban, s.clock + 180 * DAY);
	assert.match(msg, /法院/);
	assert.ok(visaNote(s), '留学生有签证提示');
	assert.ok(msg.includes(visaNote(s)!));
	assert.equal(visaNote({ ...s, origin: 'fifo' }), null, '本地人没有签证提示');

	const later = make();
	applyOffence(later, 'drink-low');
	later.clock += DEMERITS.windowDays * DAY + 1;
	applyOffence(later, 'drink-low');
	assert.equal(later.law.hist.at(-1)!.id, 'drink-low', '超过 3 年按首次');
	assert.equal(later.law.record, 0);
});

test('扣分：3 年内扣满 12 分停驾并清零；3 年前的分不算', () => {
	const s = make();
	for (let i = 0; i < 5; i++) applyOffence(s, 'speed-mid'); // 2 × 5 = 10
	assert.equal(demeritTotal(s), 10);
	assert.ok(!licenceBanned(s));
	applyOffence(s, 'speed-mid'); // 12
	assert.ok(licenceBanned(s));
	assert.equal(s.law.ban, s.clock + DEMERITS.banDays * DAY);
	assert.equal(demeritTotal(s), 0, '扣满停驾后清零');
	assert.equal(lawSummary(s).banDays, DEMERITS.banDays);

	const old = make();
	for (let i = 0; i < 5; i++) applyOffence(old, 'speed-mid');
	old.clock += DEMERITS.windowDays * DAY;
	assert.equal(demeritTotal(old), 0, '正好 3 年就过期');
	applyOffence(old, 'speed-mid');
	assert.ok(!licenceBanned(old));
});

test('呼气测试：喝酒后窗口内超标，窗口外、没喝过都通过', () => {
	const s = make();
	assert.equal(breathTest(s), '读数为零。');
	assert.equal(s.cash, 5000);
	noteDrink(s, 'gym');
	assert.ok(!drankRecently(s), '不是喝酒的活动不算');
	noteDrink(s, 'pub');
	assert.ok(drankRecently(s));
	const late = clone(s);
	late.clock += DRINK.windowMin;
	assert.equal(breathTest(late), '读数为零。', '正好过了窗口');
	late.clock -= 1;
	assert.match(breathTest(late), /超标/);
	assert.equal(late.cash, 5000 - 1000);
});

test('麻烦值：违章按特质系数上涨；随时间冷却，冷却对谁都一样', () => {
	const plain = make();
	applyOffence(plain, 'drink-low');
	assert.equal(plain.heat, getOffence('drink-low')!.heat);
	const lawful = make({ traits: ['lawful'] });
	applyOffence(lawful, 'drink-low');
	assert.equal(lawful.heat, getOffence('drink-low')!.heat * 0.5);
	const bold = make({ traits: ['daredevil'] });
	applyOffence(bold, 'drink-low');
	assert.equal(bold.heat, getOffence('drink-low')!.heat * 1.5);

	const s = make({ heat: 50 });
	heatCooldown(s, 240);
	assert.equal(s.heat, 50 - 4 * HEAT_RULES.coolPerHour);
	heatCooldown(s, -60);
	assert.equal(s.heat, 49, '负时间不动');
	const z = make({ heat: 0.1 });
	heatCooldown(z, 600);
	assert.equal(z.heat, 0, '不会低于 0');
	// 引擎里时间流逝时冷却
	const e = make({ heat: 50 });
	applyEffect(e, { minutes: 120 }, WA);
	assert.equal(e.heat, 50 - 2 * HEAT_RULES.coolPerHour);
});

test('社区服务：没欠着做不了；做一次抵 4 小时；逾期周结算麻烦值上涨、期限顺延', () => {
	const act = ACTIVITIES.find((a) => a.id === COMMUNITY_SERVICE.activity)!;
	assert.ok(act, '有社区服务活动');
	assert.ok(!act.fx.cash && !act.fx.skills && !act.fx.respect, '社区服务不给奖励');
	const free = make();
	assert.equal(activitiesAt(free, WA).find((a) => a.act.id === act.id)?.blocked, '没有要做的社区服务');
	assert.equal(performActivity(free, WA, act.id).ok, false);

	const s = make({ nextWeek: 999 }); // 不让周结算（车险）掺进现金比较
	applyOffence(s, 'evade');
	assert.equal(s.law.record, 1);
	assert.equal(s.law.cs, getOffence('evade')!.csHours);
	assert.equal(s.law.csDue, Math.floor(s.clock / DAY) + COMMUNITY_SERVICE.dueDays);
	s.clock = at(9, 11);
	const r = performActivity(s, WA, act.id);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.law.cs, getOffence('evade')!.csHours! - act.minutes / 60);
	assert.equal(r.state.cash, s.cash, '不给钱也不收钱');

	const over = clone(r.state);
	over.clock = (over.law.csDue + 1) * DAY + 60;
	const h = over.heat;
	assert.equal(lawWeekly(over).length, 1);
	assert.equal(over.heat, h + COMMUNITY_SERVICE.overdueHeat);
	assert.equal(over.law.csDue, Math.floor(over.clock / DAY) + COMMUNITY_SERVICE.dueDays);
	assert.equal(serveCommunity(over, 100), 0);
	assert.equal(over.law.csDue, -1, '做完清掉期限');
});

test('停驾：有车也只能坐大巴，不涨驾驶、不记里程；交通事件不会抽到', () => {
	const s = make({ law: { ...emptyLaw(), ban: at(12, 10) + 30 * DAY } });
	const road = travelOptions(s, WA).find((o) => o.to === 'fremantle' && o.mode === 'road')!;
	assert.match(road.label, /巴士/);
	const r = travel(s, WA, 'fremantle', 'road');
	assert.ok(r.ok);
	assert.equal(r.state.car.km, s.car.km);
	assert.equal(r.state.skills.driving, s.skills.driving);
	const free = travelOptions(make(), WA).find((o) => o.to === 'fremantle' && o.mode === 'road')!;
	assert.match(free.label, /自驾/);
});

test('交通事件只在自己开车时出现：坐大巴的一百个种子都抽不到；开车的能抽到路检', () => {
	const driving = new Set(EVENTS.filter((e) => e.driving).map((e) => e.id));
	let carHits = 0;
	for (let seed = 1; seed <= 100; seed++) {
		const bus = travel(make({ vehicle: 'none', visited: { perth: 1, fremantle: 1 } }, seed), WA, 'fremantle', 'road');
		assert.ok(!driving.has(getPendingEvent(bus.state)?.id ?? ''), `种子 ${seed}`);
		const car = travel(make({ visited: { perth: 1, fremantle: 1 } }, seed), WA, 'fremantle', 'road');
		if (driving.has(getPendingEvent(car.state)?.id ?? '')) carHits++;
	}
	assert.ok(carHits > 0, '开车时能遇到');
});

test('整条链：在酒吧喝完马上开车遇到路检 → 酒驾罚款扣分；拒绝测试走法庭', () => {
	const s = make({ clock: at(13, 10) });
	const pub = performActivity(s, WA, 'pub');
	assert.ok(pub.ok, pub.msg);
	assert.ok(drankRecently(pub.state));
	const stopped: PlayerState = { ...pub.state, pending: { eventId: 'rbt' } };
	const blow = resolveEvent(stopped, WA, 0);
	assert.ok(blow.ok);
	assert.equal(blow.state.cash, stopped.cash - 1000);
	assert.equal(blow.state.law.hist.at(-1)!.id, 'drink-low');
	assert.match(blow.msg, /超标/);
	const sober = resolveEvent({ ...make(), pending: { eventId: 'rbt' } }, WA, 0);
	assert.equal(sober.state.law.hist.length, 0);
	assert.match(sober.msg, /读数为零/);
	const refuse = resolveEvent({ ...make(), pending: { eventId: 'rbt' } }, WA, 1);
	assert.equal(refuse.state.law.record, 1);
	assert.ok(licenceBanned(refuse.state));
});

test('盘查时溜走：不降麻烦值、不涨能力；被拦下走法庭', () => {
	let caught = 0, slipped = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const s = { ...make({ heat: 70 }, seed), pending: { eventId: 'heat-check' } };
		const r = resolveEvent(s, WA, 1);
		assert.deepEqual(r.state.skills, s.skills, `种子 ${seed} 不涨能力`);
		if (r.state.law.record) {
			caught++;
			assert.ok(r.state.law.cs > 0);
		} else {
			slipped++;
			assert.ok(r.state.heat > s.heat - 1, `种子 ${seed} 溜走不降麻烦值`);
		}
	}
	assert.ok(caught > slipped, '大多数会被拦下（risk 0.7）');
	assert.ok(slipped > 0);
});

test('存档清洗：旧存档没有 law、各种坏值都不抛、钳到范围、幂等', () => {
	const base = make();
	const { law: _drop, ...old } = base as any;
	const fromOld = sanitizeState(old)!;
	assert.deepEqual(fromOld.law, emptyLaw());
	const clock = base.clock;
	for (const bad of [null, 1, 'x', [], NaN, { hist: 'x' }, { hist: [null, 1, { t: 'a' }] }, Object.create({ ban: 1e12 })]) {
		assert.deepEqual(cleanLaw(bad, clock), emptyLaw(), JSON.stringify(bad));
	}
	const dirty = cleanLaw({
		hist: [{ t: clock - 10, id: 'speed-mid', n: 99 }, { t: clock + 10, id: 'speed-mid', n: 2 }, { t: 5, id: 'nope', n: 2 }, ...Array.from({ length: 50 }, () => ({ t: 1, id: 'parking', n: 0 }))],
		ban: clock + 1e9, owed: -5, cs: 1e9, csDue: -1, record: 1e9, drank: clock + 5,
	}, clock);
	assert.ok(dirty.hist.length <= LAW_HIST_MAX);
	assert.ok(dirty.hist.every((h) => h.t <= clock && getOffence(h.id) && h.n <= 20));
	assert.ok(dirty.ban <= clock + 180 * DAY);
	assert.equal(dirty.owed, 0);
	assert.ok(dirty.cs <= 500 && dirty.csDue >= 0, '欠着社区服务一定有期限');
	assert.equal(dirty.drank, -1, '未来的喝酒时间不认');
	assert.deepEqual(cleanLaw(dirty, clock), dirty, '幂等');
	const s = sanitizeState({ ...base, law: { ...dirty } })!;
	assert.deepEqual(sanitizeState(structuredClone(s)), s);
	assert.equal(cleanLaw({ ban: clock - 5 }, clock).ban, 0, '过期的停驾清掉');
});
