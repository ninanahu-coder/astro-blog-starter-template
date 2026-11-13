import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { growSkill } from '../../src/game/core/engine.ts';
import { derivedStats, efficiency, mealOutcome, trainOutcome, workPay } from '../../src/game/core/formulas.ts';
import { fixProblem, venueAction, venuesNear } from '../../src/game/core/venues.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { VENUE_EVENTS } from '../../src/game/data/venue-events.ts';
import { getPendingEvent } from '../../src/game/core/engine.ts';
import { FIX_RULES, VENUE_OPS, VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState, Region, Venue } from '../../src/game/core/types.ts';

// 测试用的虚构地点（不是真实店铺），都放在珀斯市中心附近
const V = (id: string, type: string, dLat: number, dLon: number, tier?: number): Venue => ({ id, loc: 'perth', name: id, lat: -31.95 + dLat, lon: 115.86 + dLon, type, source: 'seed', ...(tier ? { tier } : {}) });
const VENUES: Venue[] = [
	V('t-cafe', 'cafe', 0, 0),
	V('t-diner', 'restaurant', 0.001, 0),
	V('t-fine', 'restaurant', 0.002, 0, 4),
	V('t-gym', 'gym', 0.003, 0),
	V('t-park', 'park', 0.006, 0),
	V('t-library', 'library', 0.009, 0),
	V('t-fremantle-cafe', 'cafe', 0, 0),
];
VENUES[6] = { ...VENUES[6], loc: 'fremantle', lat: -32.055, lon: 115.745 };
const R: Region = { ...WA, venues: VENUES };
const T0 = Date.UTC(2026, 10, 14, 1, 0); // 珀斯上午 9 点
const MIN = 60_000;

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'venue-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const at = (v: Venue, extra = {}) => ({ venue: v.id, lat: v.lat, lon: v.lon, acc: 10, ...extra });
const find = (id: string) => VENUES.find((v) => v.id === id)!;

test('数据自洽：类型、动作、职业对应的地点类型都存在', () => {
	const ops = new Set(VENUE_OPS.map((o) => o.id));
	const types = new Set(VENUE_TYPES.map((t) => t.id));
	assert.equal(types.size, VENUE_TYPES.length);
	for (const t of VENUE_TYPES) {
		assert.ok(t.ops.length && t.ops.every((o) => ops.has(o)), `${t.id} 动作存在`);
		assert.ok(t.tier >= 1 && t.tier <= 4 && t.radiusM > 0);
		if (t.ops.includes('work')) assert.ok(t.gigRate || CAREERS.some((c) => c.venues?.includes(t.id)), `${t.id} 能上班就得有时薪或职业`);
	}
	for (const c of CAREERS) for (const v of c.venues ?? []) assert.ok(types.has(v), `${c.id} 的地点类型 ${v} 存在`);
	for (const v of WA.venues) assert.ok(types.has(v.type) && WA.locations.some((l) => l.id === v.loc), `${v.id}`);
	assert.ok(MOODLETS.find((m) => m.id === 'focused')?.gain === 1.25);
});

test('状态系数：心情、健康、疲劳连乘，有上下限', () => {
	const fresh = efficiency(make());
	assert.ok(fresh.total > 0.9 && fresh.total < 1.3, String(fresh.total));
	const wrecked = efficiency(make({ health: 10, needs: { hunger: 0, energy: 0, hygiene: 0, fun: 0, social: 0 } }));
	assert.equal(wrecked.fatigue, 0.5);
	assert.equal(wrecked.total, 0.3, '下限 0.3');
});

test('派生属性：体质越好越省力，邋遢扣吸引力', () => {
	const weak = derivedStats(make());
	const fit = derivedStats(make({ skills: { ...make().skills, stamina: 90, strength: 80, swimming: 60 } }));
	assert.ok(fit.fitness > weak.fitness && fit.exertion < weak.exertion && fit.recovery > weak.recovery);
	const dirty = derivedStats(make({ needs: { ...make().needs, hygiene: 10 } }));
	assert.ok(dirty.appeal < weak.appeal);
});

test('吃饭：档次越高越贵越顶饱，吃撑了递减，钱不够不能吃', () => {
	const t = VENUE_TYPES.find((x) => x.id === 'restaurant')!;
	const hungry = make({ cash: 500, needs: { ...make().needs, hunger: 10 } });
	const cheap = mealOutcome(hungry, t, 1);
	const fine = mealOutcome(hungry, t, 4);
	assert.equal(cheap.cost, 8);
	assert.equal(fine.cost, 74);
	assert.ok(fine.fx.needs!.hunger! > cheap.fx.needs!.hunger!);
	assert.equal(fine.fx.moodlet, 'fine-dining');
	const full = mealOutcome({ ...hungry, needs: { ...hungry.needs, hunger: 95 } }, t, 4);
	assert.ok(full.fx.needs!.hunger! < fine.fx.needs!.hunger! / 2, '吃撑了');
	assert.ok(mealOutcome({ ...hungry, cash: 5 }, t, 2).blocked);
});

test('训练：耗体力涨力量/体能/魅力；状态差、酸痛时收益低；体力不够不能练', () => {
	const gym = VENUE_TYPES.find((x) => x.id === 'gym')!;
	const good = trainOutcome(make({ cash: 100 }), gym);
	assert.ok(!good.blocked);
	assert.ok(good.fx.skills!.strength! > 0 && good.fx.skills!.charisma! > 0 && good.fx.needs!.energy! < 0);
	const sore = trainOutcome(make({ cash: 100, moodlets: [{ id: 'sore', until: 10_000 }] }), gym);
	assert.ok(Math.abs(sore.fx.skills!.strength! - good.fx.skills!.strength! / 2) < 0.15, '酸痛减半');
	assert.equal(sore.fx.moodlet, 'sore', '酸痛时再练继续酸痛');
	assert.ok(trainOutcome(make({ cash: 100, needs: { ...make().needs, energy: 10 } }), gym).blocked);
});

test('工资：时长、表现、能力相乘', () => {
	const s = make();
	const two = workPay(s, 26, 120, 'charisma');
	const four = workPay(s, 26, 240, 'charisma');
	assert.ok(Math.abs(four.pay - two.pay * 2) <= 1);
	const tired = workPay(make({ needs: { ...s.needs, energy: 5 } }), 26, 120, 'charisma');
	assert.ok(tired.pay < two.pay && tired.perf < two.perf);
});

test('「专注」让能力成长 ×1.25', () => {
	const s = make();
	const a = structuredClone(s);
	const b = structuredClone({ ...s, moodlets: [{ id: 'focused', until: s.clock + 300 }] });
	growSkill(a, 'charisma', 4);
	growSkill(b, 'charisma', 4);
	const da = a.skills.charisma - s.skills.charisma;
	const db = b.skills.charisma - s.skills.charisma;
	assert.ok(Math.abs(db / da - 1.25) < 0.01, `${db / da}`);
});

test('定位检查：精度、距离、瞬移、游戏里不在这个地点', () => {
	const cafe = find('t-cafe');
	const s = make({ cash: 200 });
	assert.match(venueAction(s, R, { op: 'meal', ...at(cafe, { acc: 400 }) }, T0).msg, /精度/);
	assert.match(venueAction(s, R, { op: 'meal', ...at(cafe, { lat: cafe.lat + 0.01 }) }, T0).msg, /还有/);
	const ok = venueAction(s, R, { op: 'meal', ...at(cafe) }, T0);
	assert.ok(ok.ok, ok.msg);
	assert.deepEqual(ok.state.fix, { lat: -31.95, lon: 115.86, at: T0 }, '记下定位，坐标 3 位小数');
	// 10 分钟后出现在 50 公里外：推算速度 300 km/h
	assert.match(fixProblem(ok.state, -32.4, 115.86, 10, T0 + 10 * MIN)!, /太快/);
	assert.equal(fixProblem(ok.state, -32.4, 115.86, 10, T0 + 30 * MIN), undefined, '30 分钟 50 公里可以');
	const far = find('t-fremantle-cafe');
	assert.match(venueAction(make(), R, { op: 'meal', ...at(far) }, T0).msg, /先用真实定位抵达/);
	assert.match(venueAction(s, R, { op: 'meal', ...at(cafe) }, 0).msg, /联网/);
	assert.match(venueAction(s, R, { op: 'train', ...at(cafe) }, T0).msg, /不能训练/);
});

test('冷却按真实时间算，换一家店也一样', () => {
	const s = make({ cash: 200, needs: { ...make().needs, hunger: 20 }, venueEvAt: T0 }); // 刚遇到过事件，排除事件干扰
	const r1 = venueAction(s, R, { op: 'meal', ...at(find('t-cafe')) }, T0);
	assert.ok(r1.ok);
	const r2 = venueAction(r1.state, R, { op: 'meal', ...at(find('t-diner')) }, T0 + 30 * MIN);
	assert.match(r2.msg, /分钟后可以再吃一顿/);
	assert.ok(venueAction(r1.state, R, { op: 'meal', ...at(find('t-diner')) }, T0 + 91 * MIN).ok);
});

test('附近地点：按距离排序，标出能做的事和原因', () => {
	const cafe = find('t-cafe');
	const list = venuesNear(make({ cash: 200 }), R, cafe.lat, cafe.lon, 10, T0);
	assert.deepEqual(list.slice(0, 3).map((n) => n.venue.id), ['t-cafe', 't-diner', 't-fine']);
	assert.ok(list[0].inRange && !list[2].inRange);
	assert.ok(!list.some((n) => n.venue.id === 't-fremantle-cafe'), '超出 1.5 公里不列');
	const work = list[0].ops.find((o) => o.op.id === 'work')!;
	assert.equal(work.blocked, undefined, '咖啡馆有零工时薪');
});

test('真实上班：打卡、至少 15 分钟、按时长计薪、每天封顶', () => {
	const cafe = find('t-cafe');
	const s = make();
	const inn = venueAction(s, R, { op: 'work', ...at(cafe) }, T0);
	assert.ok(inn.ok && inn.state.clockIn?.venue === 't-cafe');
	assert.equal(inn.state.cash, s.cash, '打上班卡不发钱');
	assert.match(venueAction(inn.state, R, { op: 'work', ...at(cafe) }, T0 + 5 * MIN).msg, /至少 15 分钟/);
	const out = venueAction(inn.state, R, { op: 'work', ...at(cafe) }, T0 + 120 * MIN);
	assert.ok(out.ok, out.msg);
	assert.ok(out.state.cash > s.cash + 30 && out.state.cash < s.cash + 80, `两小时零工 ${out.state.cash - s.cash}`);
	assert.equal(out.state.clockIn, null);
	assert.equal(out.state.realWork.min, 120);
	assert.equal(out.state.clock, s.clock + 120, '游戏时间按真实时长流逝');
	// 一次最多计 8 小时
	const long = venueAction(inn.state, R, { op: 'work', ...at(cafe) }, T0 + 12 * 60 * MIN);
	assert.equal(long.state.realWork.min, FIX_RULES.shiftMaxMin);
	// 超过 16 小时没打下班卡：作废，重新打上班卡
	const stale = venueAction(inn.state, R, { op: 'work', ...at(cafe) }, T0 + 17 * 60 * MIN);
	assert.ok(stale.ok);
	assert.match(stale.msg, /作废/);
	assert.equal(stale.state.clockIn?.at, T0 + 17 * 60 * MIN);
	// 当天已计满
	const capped = { ...inn.state, realWork: { day: Math.floor((T0 + 8 * 3_600_000) / 86_400_000), min: FIX_RULES.dayMaxMin } };
	assert.match(venueAction({ ...capped, clockIn: null }, R, { op: 'work', ...at(cafe) }, T0).msg, /计满/);
});

test('有对应职业时按职业工资计，上满半个班算一个班次', () => {
	const cafe = find('t-cafe');
	const s = make({ job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	const inn = venueAction(s, R, { op: 'work', ...at(cafe) }, T0);
	const out = venueAction(inn.state, R, { op: 'work', ...at(cafe) }, T0 + 200 * MIN);
	assert.ok(out.ok, out.msg);
	assert.equal(out.state.job!.shifts, 1);
	assert.match(out.msg, /算作一个班次/);
	const gig = venueAction(venueAction(make(), R, { op: 'work', ...at(cafe) }, T0).state, R, { op: 'work', ...at(cafe) }, T0 + 200 * MIN);
	assert.ok(out.state.cash - s.cash > gig.state.cash - make().cash, '职业时薪（含到岗加成）高于零工');
});

test('自习给「专注」，健身房训练涨魅力', () => {
	const lib = venueAction(make(), R, { op: 'study', ...at(find('t-library')) }, T0);
	assert.ok(lib.ok && lib.state.moodlets.some((m) => m.id === 'focused'));
	const s = make({ cash: 100 });
	const gym = venueAction(s, R, { op: 'train', ...at(find('t-gym')) }, T0);
	assert.ok(gym.ok, gym.msg);
	assert.ok(gym.state.skills.charisma > s.skills.charisma && gym.state.skills.strength > s.skills.strength);
	assert.ok(gym.state.needs.energy < s.needs.energy);
	const ids = gym.state.moodlets.map((m) => m.id);
	assert.ok(ids.includes('pumped') && ids.includes('sore'), '练完：练完很精神 + 肌肉酸痛');
	const again = trainOutcome(gym.state, VENUE_TYPES.find((t) => t.id === 'gym')!);
	assert.ok(again.notes.includes('酸痛 ×0.5'), '12 小时内再练只有一半效果');
});

test('游戏内健身、游泳的成长也乘状态系数；其他活动不变', () => {
	const fresh = make({ cash: 100 });
	const tired = make({ cash: 100, health: 50, needs: { ...make().needs, energy: 25 } });
	assert.ok(efficiency(fresh).total > efficiency(tired).total);
	const gain = (s: PlayerState, id: string, k: 'strength' | 'charisma') => {
		const r = applyAction({ ...s, clock: 10 * 60 }, WA, { t: 'activity', id });
		assert.ok(r.ok, `${id}: ${r.msg}`);
		return r.state.skills[k] - s.skills[k];
	};
	assert.ok(gain(fresh, 'gym', 'strength') > gain(tired, 'gym', 'strength'), '状态好练得多');
	const busk = gain(fresh, 'busk', 'charisma');
	assert.ok(busk > 0);
	assert.equal(busk.toFixed(3), gain(tired, 'busk', 'charisma').toFixed(3), '街头表演不受状态系数影响');
});

test('动作协议与存档校验', () => {
	assert.deepEqual(parseAction({ t: 'venue', venue: 't-cafe', op: 'meal', lat: -31.95, lon: 115.86, acc: 12, extra: 1 }), { t: 'venue', venue: 't-cafe', op: 'meal', lat: -31.95, lon: 115.86, acc: 12 });
	for (const bad of [
		{ t: 'venue', venue: 't-cafe', op: 'rob', lat: 0, lon: 0, acc: 1 },
		{ t: 'venue', venue: 'T CAFE', op: 'meal', lat: 0, lon: 0, acc: 1 },
		{ t: 'venue', venue: 't-cafe', op: 'meal', lat: 95, lon: 0, acc: 1 },
		{ t: 'venue', venue: 't-cafe', op: 'meal', lat: 0, lon: 0 },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
	assert.equal(applyAction(make(), R, { t: 'venue', venue: 't-cafe', op: 'meal', lat: -31.95, lon: 115.86, acc: 10 }).ok, false, '没传现实时间时不可用');
	const dirty = { ...make(), fix: { lat: -31.9512345, lon: 115.86, at: 5 }, venueCd: { meal: 3, rob: 1, train: -1 }, clockIn: { venue: '<x>', at: 1 }, realWork: { day: 3, min: 99999 } };
	const clean = sanitizeState(dirty)!;
	assert.deepEqual(clean.fix, { lat: -31.951, lon: 115.86, at: 5 });
	assert.deepEqual(clean.venueCd, { meal: 3 });
	assert.equal(sanitizeState({ ...make(), venueEvAt: -5 })!.venueEvAt, 0);
	assert.equal(sanitizeState({ ...make(), venueEvAt: 1234.9 })!.venueEvAt, 1234);
	assert.equal(clean.clockIn, null);
	assert.deepEqual(clean.realWork, { day: 3, min: 1440 });
	const old = { ...make() } as Record<string, unknown>;
	for (const k of ['fix', 'venueCd', 'clockIn', 'realWork']) Reflect.deleteProperty(old, k);
	const migrated = sanitizeState(old)!;
	assert.deepEqual([migrated.fix, migrated.venueCd, migrated.clockIn, migrated.realWork], [null, {}, null, { day: 0, min: 0 }]);
	assert.equal(migrated.venueEvAt, 0);
});

test('真实地点事件：数据自洽，每类能去的地点至少 2 个事件', () => {
	const types = new Set(VENUE_TYPES.map((t) => t.id));
	for (const e of VENUE_EVENTS) {
		assert.ok(e.venueTypes?.length, e.id);
		for (const t of e.venueTypes!) assert.ok(types.has(t), `${e.id}: 未知地点类型 ${t}`);
		assert.ok(!e.locs && !e.tags && !e.kinds, `${e.id}: 真实地点事件不能同时挂城镇范围`);
		assert.ok(EVENTS.includes(e), `${e.id} 已注册进 EVENTS`);
	}
	for (const t of VENUE_TYPES) assert.ok(VENUE_EVENTS.filter((e) => e.venueTypes!.includes(t.id) && !e.seasons).length >= 2, `${t.id} 全年事件不足 2 个`);
});

test('真实地点事件：做完事按概率触发、只抽本类型、现实里至少隔 60 分钟', () => {
	let hit = 0, miss = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const s = { ...make({ cash: 200, needs: { ...make().needs, hunger: 20 } }), seed };
		const r = venueAction(s, R, { op: 'meal', ...at(find('t-cafe')) }, T0);
		assert.ok(r.ok, r.msg);
		const ev = getPendingEvent(r.state);
		if (!ev) { miss++; assert.equal(r.state.venueEvAt, 0); continue; }
		hit++;
		assert.ok(ev.venueTypes!.includes('cafe'), ev.id);
		assert.equal(r.state.venueEvAt, T0);
		assert.match(r.msg, new RegExp(ev.title));
		// 有事件没处理时，别的真实地点动作被挡住
		assert.match(venueAction(r.state, R, { op: 'study', ...at(find('t-library')) }, T0 + 5 * MIN).msg, /先处理/);
	}
	assert.ok(hit >= 10 && miss >= 10, `命中 ${hit} / 未命中 ${miss}`);
	// 60 分钟内不会再触发
	for (let seed = 1; seed <= 60; seed++) {
		const s = { ...make({ cash: 200, needs: { ...make().needs, hunger: 20 } }), seed, venueEvAt: T0 - 59 * MIN };
		assert.equal(venueAction(s, R, { op: 'meal', ...at(find('t-cafe')) }, T0).state.pending, null);
	}
});

test('真实地点事件不会在到达城镇时被抽到', () => {
	const ids = new Set(VENUE_EVENTS.map((e) => e.id));
	for (let seed = 1; seed <= 200; seed++) {
		const s = { ...make({ cash: 2000 }), seed };
		const r = applyAction(s, WA, { t: 'travel', to: 'fremantle', mode: 'road' });
		if (r.state.pending) assert.ok(!ids.has(r.state.pending.eventId), r.state.pending.eventId);
	}
});
