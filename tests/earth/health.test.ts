// 健康、疾病和看病（第 1 版）：数据自洽、发病、病程、受伤、活动限制、医疗保障的费用、就医动作、存档清洗。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, ORIGINS, sanitizeState } from '../../src/game/core/character.ts';
import { activitiesAt, applyEffect, careAt, shiftBlocked } from '../../src/game/core/engine.ts';
import { careOutcome, coverOf, currentIllness, illnessBlock, illnessRisk, illnessTick, injure, loadOfActivity, pickIllness, startIllness } from '../../src/game/core/health.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { getVenueType, opOutcome } from '../../src/game/core/venues.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { CARE, CONDITIONS, COVER_BY_ORIGIN, COVERS, ED_WAIT, HEALTH, REAL_FEES, RX_PRICE } from '../../src/game/data/health.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, origin = 'fifo'): PlayerState => ({
	...createCharacter({ id: 'health-player', name: '测', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const sick = (id: string, over: Partial<PlayerState> = {}, origin = 'fifo') => {
	const s = structuredClone(make({ clock: at(10, 2), ...over }, origin));
	startIllness(s, id);
	return s;
};
/** 珀斯第一个这种天气的游戏日 */
const dayWith = (wx: string, from = 0) => {
	for (let d = from; d < from + 400; d++) if (weatherOn(WA.spawn, d).id === wx) return d;
	throw new Error(`找不到 ${wx}`);
};
const CANON = (s: PlayerState) => sanitizeState(s, new Set(WA.locations.map((l) => l.id)), { fallbackLoc: WA.spawn, now: 1 })!;

test('数据自洽：病的心情状态存在、就医倍率在 (0,1]、每个出身都有医疗保障、真实收费有出处', () => {
	const moods = new Set(MOODLETS.map((m) => m.id));
	assert.equal(new Set(CONDITIONS.map((c) => c.id)).size, CONDITIONS.length);
	for (const c of CONDITIONS) {
		assert.ok(moods.has(c.moodlet), c.id);
		assert.ok(c.days > 0 && c.energyPerHour >= 0 && c.healthPerDay >= 0, c.id);
		assert.ok(MOODLETS.find((m) => m.id === c.moodlet)!.hours >= c.days * 24, `${c.id} 的心情状态要能撑满病程`);
		for (const [k, f] of Object.entries(c.care)) assert.ok(f! > 0 && f! <= 1 && CARE.some((x) => x.id === k), `${c.id}.${k}`);
		if (c.script) assert.ok(c.rx && c.rx > 0 && c.rx <= 1, c.id);
		assert.ok(ED_WAIT[c.severity] !== undefined, c.id);
	}
	for (const k of Object.keys(HEALTH.base)) assert.ok(CONDITIONS.some((c) => c.id === k), k);
	for (const t of Object.values(HEALTH.weather)) for (const k of Object.keys(t)) assert.ok(CONDITIONS.some((c) => c.id === k), k);
	for (const o of ORIGINS) assert.ok(COVERS.some((c) => c.id === COVER_BY_ORIGIN[o.id]), `出身 ${o.id} 没有医疗保障`);
	for (const c of COVERS) assert.ok(c.source.length > 10, c.id);
	assert.equal(REAL_FEES.mbsGp, 43.9);
	assert.equal(REAL_FEES.pbsGeneral, 25);
	assert.match(REAL_FEES.mbsGpSource, /item 23/);
	assert.match(REAL_FEES.pbsSource, /2026-01-01/);
});

test('出身对应的医疗保障：留学生 OSHC，背包客自费，矿工和冲浪手 Medicare', () => {
	assert.equal(coverOf(make({}, 'student')).id, 'oshc');
	assert.equal(coverOf(make({}, 'backpacker')).id, 'none');
	assert.equal(coverOf(make({}, 'fifo')).id, 'medicare');
	assert.equal(coverOf(make({}, 'surfer')).id, 'medicare');
});

test('发病概率：下雨和风暴加感冒、热天加热衰竭（带水减半）、冬季加流感、疲劳和饥饿放大、不洗澡加肠胃炎', () => {
	const s = make({ inventory: {} }); // 开局背包里有水，这里先清空
	const sunny = illnessRisk(s, dayWith('sunny'));
	const rain = illnessRisk(s, dayWith('rain'));
	const storm = illnessRisk(s, dayWith('storm'));
	assert.ok(rain.cold > sunny.cold && storm.cold > rain.cold);
	assert.equal(sunny.heat, undefined, '不热不会热衰竭');
	const hotDay = dayWith('hot');
	const hot = illnessRisk(s, hotDay).heat;
	assert.ok(hot > 0);
	assert.equal(illnessRisk({ ...s, inventory: { water: 1 } }, hotDay).heat, hot * HEALTH.hydrated);
	assert.equal(illnessRisk({ ...s, inventory: { electrolyte: 2 } }, hotDay).heat, hot * HEALTH.hydrated);
	const spring = dayWith('sunny', 0);
	const winter = dayWith('sunny', 84);
	assert.ok(illnessRisk(s, winter).flu > illnessRisk(s, spring).flu, '冬季流感更多');
	const tired = illnessRisk({ ...s, needs: { ...s.needs, energy: 10 } }, spring);
	assert.equal(tired.cold, sunny.cold * HEALTH.fatigueMult);
	const hungry = illnessRisk({ ...s, needs: { ...s.needs, hunger: 10 } }, spring);
	assert.equal(hungry.cold, sunny.cold * HEALTH.hungryMult);
	const weak = illnessRisk({ ...s, health: 30 }, spring);
	assert.equal(weak.cold, sunny.cold * HEALTH.weakMult);
	const dirty = illnessRisk({ ...s, needs: { ...s.needs, hygiene: 5 } }, spring);
	assert.equal(dirty.gastro, sunny.gastro + HEALTH.dirtyGastro);
	assert.equal(pickIllness({ cold: 0.1, flu: 0.1 }, 0.05), 'cold');
	assert.equal(pickIllness({ cold: 0.1, flu: 0.1 }, 0.15), 'flu');
	assert.equal(pickIllness({ cold: 0.1, flu: 0.1 }, 0.25), null);
});

test('病程：跨午夜才掷、掷中就病并挂心情；病中额外掉精力、健康按天掉但不低于下限；到期痊愈、心情一起消失', () => {
	const s = structuredClone(make({ clock: at(23, 4) }));
	s.clock = at(1, 5);
	let calls = 0;
	const logs = illnessTick(s, at(23, 4), () => (calls++, 0));
	assert.equal(calls, 1, '跨一个午夜掷一次');
	assert.ok(s.illness, '随机数 0 必中');
	assert.equal(s.illness!.since, at(0, 5), '从午夜算起');
	assert.match(logs[0], /病了|暑气/);
	const def = CONDITIONS.find((c) => c.id === s.illness!.id)!;
	assert.ok(s.moodlets.some((m) => m.id === def.moodlet && m.until <= s.illness!.until));

	const t = sick('flu', { health: 80, needs: { ...make().needs, energy: 80 } });
	const t0 = t.clock;
	t.clock += 12 * 60;
	const flu = CONDITIONS.find((c) => c.id === 'flu')!;
	assert.deepEqual(illnessTick(t, t0, () => 0.99), []);
	assert.equal(Math.round(t.needs.energy * 10) / 10, Math.round((80 - flu.energyPerHour * 12) * 10) / 10);
	assert.equal(t.health, 80 - flu.healthPerDay / 2);
	// 下限：生病本身不会把健康压到 illFloor 以下，已经更低的也不再掉
	const low = sick('gastro', { health: HEALTH.illFloor + 1 });
	const l0 = low.clock;
	low.clock += 1440;
	illnessTick(low, l0, () => 0.99);
	assert.equal(low.health, HEALTH.illFloor);
	const lower = sick('gastro', { health: 5 });
	const w0 = lower.clock;
	lower.clock += 600;
	illnessTick(lower, w0, () => 0.99);
	assert.equal(lower.health, 5);
	// 病中跨午夜不再掷
	const busy = sick('flu');
	const b0 = busy.clock;
	busy.clock += 1440;
	let rolled = 0;
	illnessTick(busy, b0, () => (rolled++, 0));
	assert.equal(rolled, 0);
	// 到期痊愈
	const end = sick('cold');
	const e0 = end.clock;
	end.clock = end.illness!.until + 5;
	const out = illnessTick(end, e0, () => 0.99);
	assert.equal(end.illness, null);
	assert.match(out[0], /感冒好了/);
	assert.ok(!end.moodlets.some((m) => m.id === 'sick-mild'));
});

test('引擎里的时间流逝会发病：又累又饿又脏地露营几个月，总会病一次；病由存档种子决定（同种子结果相同）', () => {
	const run = () => {
		let s = make({ clock: at(20) });
		for (let i = 0; i < 120 && !s.illness; i++) {
			s = { ...s, clock: at(20, i), health: 80, needs: { ...s.needs, hunger: 40, energy: 30, hygiene: 10 } };
			const r = applyAction(s, WA, { t: 'activity', id: 'sleep-camp' });
			assert.ok(r.ok, r.msg);
			s = r.state;
		}
		return s;
	};
	const a = run();
	assert.ok(a.illness, '120 天一次都没病');
	assert.ok(a.journal.some((j) => /病了|暑气/.test(j.text)));
	assert.deepEqual(run().illness, a.illness);
});

test('受伤：一下掉 ≥10 健康记扭伤（不覆盖别的病，扭伤再伤只延长）；小伤不记', () => {
	const s = structuredClone(make({ clock: at(10, 3) }));
	assert.equal(injure(s, HEALTH.injuryAt - 1), false);
	assert.equal(s.illness, null);
	assert.equal(injure(s, HEALTH.injuryAt), true);
	assert.equal(s.illness!.id, 'sprain');
	const until = s.illness!.until;
	s.clock += 600;
	assert.equal(injure(s, 20), false, '已经扭伤：不算新伤');
	assert.ok(s.illness!.until > until, '再伤一次延长');
	const flu = sick('flu');
	flu.illness!.until = flu.clock + 60; // 快好了：被当成扭伤延长的话一眼能看出来
	const fluBefore = structuredClone(flu.illness);
	assert.equal(injure(flu, 30), false);
	assert.deepEqual(flu.illness, fluBefore, '正在得流感：不被扭伤覆盖，病程也不变');
	// 走引擎：效果里掉健康
	const e = structuredClone(make({ clock: at(10, 3) }));
	applyEffect(e, { health: -15 }, WA);
	assert.equal(e.illness?.id, 'sprain');
	assert.ok(e.journal.some((j) => j.text.includes('扭伤')));
});

test('活动限制：流感不能健身、上班、下海；感冒只是不能下海；扭伤不能剧烈运动但能做轻活', () => {
	const gym = ACTIVITIES.find((a) => a.id === 'gym')!;
	const swim = ACTIVITIES.find((a) => a.id === 'swim')!;
	const cafe = ACTIVITIES.find((a) => a.id === 'work-cafe')!;
	assert.deepEqual(loadOfActivity(gym), ['heavy']);
	assert.deepEqual(loadOfActivity(swim), ['heavy', 'sea']);
	assert.deepEqual(loadOfActivity(cafe), ['work'], '咖啡店零工不算剧烈');
	const flu = sick('flu');
	for (const a of [gym, swim, cafe]) assert.match(illnessBlock(flu, loadOfActivity(a))!, /流感中/);
	const cold = sick('cold');
	assert.equal(illnessBlock(cold, loadOfActivity(gym)), undefined);
	assert.match(illnessBlock(cold, loadOfActivity(swim))!, /下海/);
	const sprain = sick('sprain');
	assert.match(illnessBlock(sprain, loadOfActivity(gym))!, /剧烈运动/);
	assert.equal(illnessBlock(sprain, loadOfActivity(cafe)), undefined);
	assert.equal(illnessBlock(make(), ['heavy', 'sea', 'work']), undefined, '没病不拦');
	// 引擎：列表里显示原因，点下去也拦
	const list = activitiesAt(flu, WA);
	assert.match(list.find((x) => x.act.id === 'gym')!.blocked!, /流感/);
	const r = applyAction(flu, WA, { t: 'activity', id: 'gym' });
	assert.equal(r.ok, false);
	assert.match(r.msg, /流感/);
	// 病过期了照常
	const over = { ...flu, clock: flu.illness!.until };
	assert.equal(illnessBlock(over, ['work']), undefined);
	// 上班
	const job = { career: 'barista', loc: WA.spawn, level: 0, shifts: 0, good: 0, lastDay: -1 };
	const fluJob = sick('flu', { job, clock: at(8, 2) });
	assert.match(shiftBlocked(fluJob)!, /上班/);
	const coldJob = sick('cold', { job, clock: at(8, 2) });
	assert.equal(shiftBlocked(coldJob), undefined, '感冒照常上班');
	// 真实地点：生病不能训练
	const gymType = getVenueType('gym')!;
	const v = { id: 'x', name: 'x', type: 'gym', lat: 0, lon: 0, loc: WA.spawn, source: 'seed' } as never;
	assert.match(opOutcome(flu, 'train', gymType, v)!.blocked!, /流感/);
	assert.equal(opOutcome(make({ cash: 999 }), 'train', gymType, v)!.blocked, undefined);
});

test('费用：GP 自付 = 标价 − MBS 收费标准 × 报销比例；处方药 Medicare 按 PBS 封顶；急诊 Medicare 免费、自费按标价', () => {
	const gp = CARE.find((c) => c.id === 'gp')!;
	const ed = CARE.find((c) => c.id === 'ed')!;
	const m = careOutcome(sick('flu'), 'gp');
	assert.equal(m.cost, Math.round(gp.fee - REAL_FEES.mbsGp));
	assert.equal(m.script, true, '流感开处方');
	assert.equal(careOutcome(sick('flu', {}, 'student'), 'gp').cost, Math.round(gp.fee - REAL_FEES.mbsGp), 'OSHC 也按 MBS 报销');
	assert.equal(careOutcome(sick('flu', {}, 'backpacker'), 'gp').cost, gp.fee, '自费付全价');
	assert.equal(careOutcome(sick('cold'), 'gp').script, false, '感冒不开处方');

	const rx = (origin: string) => {
		const s = sick('flu', {}, origin);
		s.illness!.rx = true;
		return careOutcome(s, 'pharmacy');
	};
	assert.equal(rx('fifo').cost, REAL_FEES.pbsGeneral);
	assert.equal(rx('fifo').fillRx, true);
	assert.equal(rx('student').cost, RX_PRICE, 'OSHC 的药品赔付待核实：先按药价');
	assert.equal(rx('backpacker').cost, RX_PRICE);
	assert.equal(careOutcome(sick('cold'), 'pharmacy').fillRx, false, '没处方买非处方药');

	assert.equal(careOutcome(sick('heat'), 'ed').cost, 0);
	assert.equal(careOutcome(sick('heat', {}, 'student'), 'ed').cost, 0);
	assert.equal(careOutcome(sick('heat', {}, 'backpacker'), 'ed').cost, ed.fee);
	assert.equal(careOutcome(sick('heat'), 'ed').minutes, ed.minutes + ED_WAIT[3]);
	assert.equal(careOutcome(sick('cold'), 'ed').minutes, ed.minutes + ED_WAIT[1], '小病急诊等得久');

	assert.match(careOutcome(make(), 'gp').blocked!, /不用看/);
	assert.equal(careOutcome(make({ health: 60 }), 'gp').blocked, undefined, '没病但健康不满也能看');
	assert.match(careOutcome(sick('flu', { cash: 3 }, 'backpacker'), 'gp').blocked!, /需要 \$85/);
});

test('就医动作：付自付部分、花时间、缩短病程；GP 开处方后药房取药再缩短；同一种就医不重复缩短；不改入参', () => {
	const s0 = sick('flu', { cash: 500, clock: at(10, 2) });
	const before = structuredClone(s0);
	const left0 = s0.illness!.until - s0.clock;
	const r1 = applyAction(s0, WA, { t: 'care', kind: 'gp' });
	assert.ok(r1.ok, r1.msg);
	assert.deepEqual(s0, before, '不改入参');
	const s1 = r1.state;
	assert.equal(s1.cash, 500 - Math.round(85 - REAL_FEES.mbsGp));
	assert.equal(s1.illness!.rx, true);
	assert.deepEqual(s1.illness!.care, ['gp']);
	const left1 = s1.illness!.until - s1.clock;
	assert.ok(left1 < left0 - 90, '看完病剩余病程变短');
	assert.match(s1.journal.at(-1)!.text, /Medicare/);

	const r2 = applyAction(s1, WA, { t: 'care', kind: 'pharmacy' });
	assert.ok(r2.ok, r2.msg);
	assert.equal(r2.state.cash, s1.cash - REAL_FEES.pbsGeneral);
	assert.deepEqual(r2.state.illness!.care, ['gp', 'pharmacy', 'rx']);
	assert.ok(r2.state.illness!.until - r2.state.clock < left1 - 20);

	// 再看一次 GP：只回健康，不再缩短
	const again = careOutcome({ ...r2.state, health: 50 }, 'gp');
	assert.equal(again.factor, 1);
	assert.equal(again.script, false);
	assert.match(careOutcome({ ...r2.state, health: 100 }, 'gp').blocked!, /已经/);

	// 地点和营业时间
	const wild = WA.locations.find((l) => !['city', 'port', 'town', 'coast', 'mining', 'island'].includes(l.kind) && !l.tags.includes('hospital'))!;
	assert.equal(careAt({ ...s0, loc: wild.id }, WA).length, 0);
	assert.equal(applyAction({ ...s0, loc: wild.id }, WA, { t: 'care', kind: 'gp' }).ok, false);
	const night = { ...s0, clock: at(2, 3) };
	assert.match(applyAction(night, WA, { t: 'care', kind: 'gp' }).msg, /营业时间/);
	assert.ok(applyAction(night, WA, { t: 'care', kind: 'ed' }).ok, '急诊 24 小时');
	assert.equal(applyAction({ ...s0, pending: { eventId: 'x' } }, WA, { t: 'care', kind: 'gp' }).ok, false);
	// 健康卡用的列表和点下去一致
	for (const x of careAt(s0, WA)) assert.equal(!x.blocked, applyAction(s0, WA, { t: 'care', kind: x.care.id }).ok, x.care.id);
});

test('动作协议：care 只接受已知种类', () => {
	assert.deepEqual(parseAction({ t: 'care', kind: 'gp' }), { t: 'care', kind: 'gp' });
	assert.deepEqual(parseAction({ t: 'care', kind: 'ed', extra: 1 }), { t: 'care', kind: 'ed' });
	for (const kind of ['', 'GP', 'surgery', 1, null, undefined, '__proto__', 'constructor']) assert.equal(parseAction({ t: 'care', kind }), null, String(kind));
});

test('存档清洗：旧档缺字段为 null；坏值、未知病、已过期清掉；病程不超过该病天数；就医记录只留已知标签；幂等', () => {
	const base = make({ clock: at(10, 5) });
	const { illness: _, ...old } = base;
	assert.equal(CANON(old as PlayerState).illness, null);
	const bad = [null, 1, 'flu', [], { id: 'plague', until: at(10, 6) }, { id: 'flu' }, { id: 'flu', until: NaN }, { id: 'flu', until: at(9, 5) }, { id: 'flu', until: Infinity }, { id: '__proto__', until: at(10, 6) }];
	for (const v of bad) assert.equal(CANON({ ...base, illness: v as never }).illness, null, JSON.stringify(v));
	const big = CANON({ ...base, illness: { id: 'cold', since: -50, until: 1e12, care: ['gp', 'gp', 'evil', 3, 'rx'] as never, rx: 'yes' as never } });
	assert.deepEqual(big.illness, { id: 'cold', since: 0, until: base.clock + 3 * 1440, care: ['gp', 'rx'], rx: false });
	const future = CANON({ ...base, illness: { id: 'flu', since: at(10, 9), until: at(12, 5), care: [], rx: true } });
	assert.equal(future.illness!.since, base.clock, '开始时间不晚于现在');
	assert.deepEqual(CANON(big), big);
	assert.deepEqual(CANON(future), future);
	const live = sick('gastro');
	assert.deepEqual(CANON(live).illness, live.illness);
	assert.equal(createCharacter({ id: 'n', name: 'n', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 1 }).illness, null);
	assert.equal(currentIllness({ ...live, clock: live.illness!.until }), null);
});
