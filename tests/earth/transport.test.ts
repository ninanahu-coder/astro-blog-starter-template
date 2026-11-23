// 公共交通与步行（第 32 批）：真实票价、周日免费、运营时段、渡轮按真实票价、步行的消耗与成长、动作协议
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { applyEffect, clone, eventMatches, travel, travelOptions } from '../../src/game/core/engine.ts';
import { gamePrice, ROAD_FACTOR, routeFare, serviceMinutes, transitOptions, walkMinutes } from '../../src/game/core/transport.ts';
import { haversineKm } from '../../src/game/core/geo.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { weekdayOf } from '../../src/game/core/time.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { ROUTE_FARES, TRANSIT, WALK } from '../../src/game/data/transport.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const MONDAY = 0, SUNDAY = 6; // 游戏第 1 天（day 0）是周一
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'transit-player', name: '车', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WORLD.spawn, seed: 5 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(10, MONDAY),
	cash: 500,
	traits: [],
	...over,
});
const loc = (id: string) => WORLD.locations.find((l) => l.id === id)!;
const opt = (s: PlayerState, to: string, mode: string) => travelOptions(s, WORLD).find((o) => o.to === to && o.mode === mode);

test('数据：线路两端是真实存在的地点；票价为正、有出处；渡轮票价对应已有渡轮路线；id 不重复', () => {
	const ids = new Set(WORLD.locations.map((l) => l.id));
	assert.equal(new Set(TRANSIT.map((t) => t.id)).size, TRANSIT.length);
	for (const t of TRANSIT) {
		assert.ok(ids.has(t.a) && ids.has(t.b) && t.a !== t.b, t.id);
		assert.ok(t.fare > 0 && t.kmh > 0 && t.wait >= 0, t.id);
		assert.ok(['official', 'derived'].includes(t.fareNote), t.id);
		assert.match(t.source, /\d{4}-\d{2}-\d{2}/, `${t.id} 的出处要带日期`);
		assert.match(t.source, /\.(gov\.au|com\.au|org)\b/, `${t.id} 的出处要有网址`);
	}
	for (const f of ROUTE_FARES) {
		assert.ok(WORLD.routes.some((r) => r.mode === 'ferry' && ((r.a === f.a && r.b === f.b) || (r.a === f.b && r.b === f.a))), `${f.a}–${f.b} 不是已有的渡轮路线`);
		assert.ok(f.fare > 0 && ['official', 'derived'].includes(f.fareNote));
		assert.match(f.source, /\d{4}-\d{2}-\d{2}/, `${f.a}–${f.b} 的出处要带日期`);
		assert.match(f.source, /\.(gov\.au|com\.au|org)\b/, `${f.a}–${f.b} 的出处要有网址`);
	}
});

test('任何地点出发：同一个目的地同一种走法只有一条（travel 按 to + mode 找）', () => {
	for (const l of WORLD.locations) {
		const keys = travelOptions(make({ loc: l.id }), WORLD).map((o) => `${o.to}|${o.mode}`);
		assert.equal(new Set(keys).size, keys.length, l.id);
	}
});

test('Transperth：$3.50 四舍五入到 $4；特质折扣照算；周日免费；时间 = 候车 + 公路距离 ÷ 车速', () => {
	const svc = TRANSIT.find((t) => t.id === 'transperth-fremantle')!;
	const o = opt(make(), 'fremantle', 'transit')!;
	assert.equal(o.cost, 4);
	assert.ok(o.available);
	assert.match(o.note!, /Transperth 真实票价/);
	const km = haversineKm(loc('perth').lat, loc('perth').lon, loc('fremantle').lat, loc('fremantle').lon) * ROAD_FACTOR;
	assert.equal(o.minutes, serviceMinutes(svc, km));
	assert.equal(o.minutes, Math.round(svc.wait + (km / svc.kmh) * 60));
	assert.equal(opt(make({ traits: ['frugal'] }), 'fremantle', 'transit')!.cost, 3, '精打细算 × 0.85');
	const sunday = make({ clock: at(10, SUNDAY) });
	assert.equal(weekdayOf(sunday.clock), 6);
	assert.equal(opt(sunday, 'fremantle', 'transit')!.cost, 0);
	assert.match(opt(sunday, 'fremantle', 'transit')!.note!, /周日/);
	assert.equal(opt(make({ clock: at(10, SUNDAY + 1) }), 'fremantle', 'transit')!.cost, 4, '下周一恢复收费');
	// 南澳电车没有周日免费
	assert.equal(opt(make({ loc: 'adelaide', clock: at(10, SUNDAY) }), 'glenelg', 'transit')!.cost, 5);
});

test('运营时段外和现金不够时不能坐，travel 也拒绝', () => {
	const night = make({ clock: at(2) });
	const o = opt(night, 'fremantle', 'transit')!;
	assert.equal(o.available, false);
	assert.match(o.reason!, /运营时段/);
	assert.equal(travel(night, WORLD, 'fremantle', 'transit').ok, false);
	const poor = make({ cash: 3 });
	assert.equal(opt(poor, 'fremantle', 'transit')!.reason, '现金不足');
	assert.equal(travel(poor, WORLD, 'fremantle', 'transit').ok, false);
	assert.ok(opt(make({ cash: 4 }), 'fremantle', 'transit')!.available, '正好够也能坐');
});

test('坐公交：扣票价、走时间、到达；不改入参，不练驾驶，自己的车不加里程', () => {
	const s = make({ origin: 'student', vehicle: 'car', car: { km: 100, since: 100 } });
	const before = structuredClone(s);
	const o = opt(s, 'fremantle', 'transit')!;
	const r = travel(s, WORLD, 'fremantle', 'transit');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '入参没变');
	assert.equal(r.state.loc, 'fremantle');
	assert.equal(r.state.cash, s.cash - o.cost);
	assert.equal(r.state.clock, s.clock + o.minutes);
	assert.deepEqual(r.state.car, s.car);
	assert.equal(r.state.skills.driving, s.skills.driving);
});

test('区域火车：珀斯—班伯里 $18、珀斯—卡尔古利 $50（按官方减半后的往返推算）', () => {
	const s = make();
	assert.equal(opt(s, 'bunbury', 'rail')!.cost, 18);
	assert.equal(opt(s, 'kalgoorlie', 'rail')!.cost, 50);
	assert.equal(opt(make({ clock: at(21) }), 'kalgoorlie', 'rail')!.available, false, '晚上没车');
	const r = travel(s, WORLD, 'bunbury', 'rail');
	assert.ok(r.ok);
	assert.equal(r.state.loc, 'bunbury');
	assert.equal(r.state.cash, s.cash - 18);
});

test('渡轮按真实票价：罗特尼斯 $44、袋鼠岛 $49；风暴停航不受票价影响；钱按新价判断', () => {
	assert.equal(routeFare('rottnest', 'fremantle')?.fare, 44, '双向都能查到');
	const s = make({ loc: 'fremantle' });
	const o = opt(s, 'rottnest', 'ferry')!;
	assert.equal(o.cost, 44);
	assert.match(o.note!, /Rottnest Express/);
	assert.equal(opt(make({ loc: 'cape-jervis' }), 'kangaroo-island', 'ferry')!.cost, 49);
	assert.equal(opt(make({ loc: 'fremantle', cash: 43 }), 'rottnest', 'ferry')!.reason, '现金不足');
	assert.ok(opt(make({ loc: 'fremantle', cash: 44 }), 'rottnest', 'ferry')!.available);
	const r = travel(s, WORLD, 'rottnest', 'ferry');
	assert.equal(r.state.cash, s.cash - 44);
	// 找一个弗里曼特尔刮风暴的日子：如果引擎（其他分支）在风暴天停航，标价不能把它重新打开
	let day = 0;
	while (!weatherOn('fremantle', day).closesSea && day < 400) day++;
	const storm = opt(make({ loc: 'fremantle', clock: at(10, day) }), 'rottnest', 'ferry')!;
	assert.equal(storm.cost, 44);
	if (storm.reason && storm.reason !== '现金不足') assert.equal(storm.available, false);
});

test('步行：只给公路距离 ≤ 15 km 的路线；不花钱；额外消耗精力和清洁，按公里练体能', () => {
	assert.equal(walkMinutes(WALK.maxKm + 0.1), null);
	assert.equal(walkMinutes(9), 120);
	assert.equal(opt(make(), 'fremantle', 'walk'), undefined, '珀斯到弗里曼特尔太远');
	const s = make({ loc: 'adelaide' });
	const w = opt(s, 'glenelg', 'walk')!;
	assert.ok(w.available);
	assert.equal(w.cost, 0);
	const r = travel(s, WORLD, 'glenelg', 'walk');
	assert.ok(r.ok);
	assert.equal(r.state.clock, s.clock + w.minutes);
	// 基准：同一个人原地待同样长的时间
	const base = clone(s);
	applyEffect(base, { minutes: w.minutes }, WORLD);
	assert.ok(Math.abs(r.state.needs.energy - (base.needs.energy + WALK.needs.energy! * w.minutes)) < 0.01, '精力额外消耗');
	assert.ok(Math.abs(r.state.needs.hygiene - (base.needs.hygiene + WALK.needs.hygiene! * w.minutes)) < 0.01, '清洁额外消耗');
	assert.ok(r.state.skills.stamina > s.skills.stamina, '体能涨了');
	// 坐电车不额外消耗
	const t = travel(s, WORLD, 'glenelg', 'transit');
	const tb = clone(s);
	applyEffect(tb, { minutes: opt(s, 'glenelg', 'transit')!.minutes }, WORLD);
	assert.ok(Math.abs(t.state.needs.energy - tb.needs.energy) < 0.01);
	assert.equal(t.state.skills.stamina, s.skills.stamina);
});

test('transitOptions 不改入参；没有这个地点时返回空', () => {
	const s = make();
	const before = structuredClone(s);
	transitOptions(s, WORLD);
	assert.deepEqual(s, before);
	assert.deepEqual(transitOptions(make({ loc: 'nowhere' }), WORLD), []);
	assert.equal(gamePrice(s, 4.75), 5);
});

test('动作协议认新走法；出行事件只在对应走法抵达时出现', () => {
	for (const mode of ['transit', 'rail', 'walk']) assert.deepEqual(parseAction({ t: 'travel', to: 'fremantle', mode }), { t: 'travel', to: 'fremantle', mode });
	assert.equal(parseAction({ t: 'travel', to: 'fremantle', mode: 'teleport' }), null);
	const pairs: [string, string][] = [['transit-hometown', 'transit'], ['rail-wheatbelt', 'rail'], ['walk-blister', 'walk']];
	for (const [id, mode] of pairs) {
		const ev = EVENTS.find((e) => e.id === id)!;
		assert.ok(ev, id);
		assert.ok(eventMatches(ev, loc('fremantle'), mode as never, at(10)), `${id} 坐 ${mode} 能抽到`);
		assert.ok(!eventMatches(ev, loc('fremantle'), 'road', at(10)), `${id} 自驾抽不到`);
		assert.ok(!eventMatches(ev, loc('fremantle'), null, at(10)), `${id} GPS 打卡抽不到`);
		assert.ok(ev.choices.some((c) => !c.cost), `${id} 没钱也能处理`);
	}
});
