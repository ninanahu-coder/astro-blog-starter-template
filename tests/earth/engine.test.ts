// 运行：npm test（Node ≥ 22.18 原生执行 TypeScript）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	activitiesAt, getPendingEvent, gpsCheckIn, performActivity, resolveEvent, travel, travelOptions,
} from '../../src/game/core/engine.ts';
import { haversineKm, locateInRegion } from '../../src/game/core/geo.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { WA } from '../../src/game/data/wa.ts';

const fresh = (origin = 'backpacker', seed = 42) =>
	createCharacter({ id: 'test-player', name: '测试', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed });

test('区域数据自洽', () => {
	const ids = new Set(WA.locations.map((l) => l.id));
	assert.equal(ids.size, WA.locations.length, '地点 id 唯一');
	for (const r of WA.routes) assert.ok(ids.has(r.a) && ids.has(r.b), `路线端点存在: ${r.a}-${r.b}`);
	for (const p of WA.pois) assert.ok(ids.has(p.loc), `POI 所属地点存在: ${p.id}`);
	for (const l of WA.locations) {
		assert.ok(l.lon > WA.bounds.minLon && l.lon < WA.bounds.maxLon && l.lat > WA.bounds.minLat && l.lat < WA.bounds.maxLat, l.id);
		assert.ok(WA.routes.some((r) => r.a === l.id || r.b === l.id), `${l.id} 至少有一条路线`);
	}
	for (const e of EVENTS) for (const id of e.locs ?? []) assert.ok(ids.has(id), `事件地点存在: ${e.id}`);
	assert.equal(new Set(EVENTS.map((e) => e.id)).size, EVENTS.length);
	assert.equal(new Set(ACTIVITIES.map((a) => a.id)).size, ACTIVITIES.length);
});

test('距离计算：珀斯—布鲁姆约 1680km', () => {
	const km = haversineKm(-31.95, 115.86, -17.96, 122.24);
	assert.ok(km > 1600 && km < 1750, String(km));
});

test('出行扣钱、耗时并到达；首次到访签名事件必出', () => {
	const s0 = fresh();
	const r1 = travel(s0, WA, 'fremantle', 'road');
	assert.ok(r1.ok);
	assert.equal(r1.state.loc, 'fremantle');
	assert.ok(r1.state.cash < s0.cash && r1.state.clock > s0.clock);
	assert.equal(s0.loc, 'perth', '不修改入参');
	let s = r1.state;
	if (s.pending) s = resolveEvent(s, WA, 0).state;
	const r2 = travel(s, WA, 'rottnest', 'ferry');
	assert.ok(r2.ok);
	assert.equal(getPendingEvent(r2.state)?.id, 'quokka-selfie');
	assert.equal(travel(r2.state, WA, 'fremantle', 'ferry').ok, false, '事件未处理不能走');
	const r3 = resolveEvent(r2.state, WA, 0);
	assert.ok(r3.ok && r3.state.pending === null && r3.state.seen.includes('quokka-selfie'));
});

test('越野土路需要四驱；现金不足不能出行', () => {
	let s = { ...fresh(), loc: 'exmouth', cash: 5000 };
	const opt = travelOptions(s, WA).find((o) => o.to === 'karijini')!;
	assert.equal(opt.available, false);
	s = { ...s, vehicle: '4wd' };
	assert.equal(travelOptions(s, WA).find((o) => o.to === 'karijini')!.available, true);
	assert.equal(travel({ ...fresh(), cash: 0 }, WA, 'kalgoorlie', 'air').ok, false);
	assert.equal(travel(fresh(), WA, 'broome', 'road').ok, false, '无直达路线');
});

test('互动：条件校验与效果', () => {
	const s = fresh();
	assert.equal(performActivity(s, WA, 'work-mine').ok, false, '珀斯没有矿场');
	assert.equal(performActivity(s, WA, 'buy-car').ok, false, '钱不够');
	const r = performActivity({ ...s, needs: { ...s.needs, hunger: 20 } }, WA, 'eat');
	assert.ok(r.ok && r.state.needs.hunger > 60 && r.state.cash === s.cash - 18);
	const slept = performActivity({ ...s, needs: { ...s.needs, energy: 5 } }, WA, 'sleep-motel');
	assert.equal(slept.state.needs.energy, 100);
	assert.ok(activitiesAt(s, WA).some((a) => a.act.id === 'gym'));
});

test('饿到晕倒会被送医而不是卡死', () => {
	let s = { ...fresh(), health: 3, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } };
	s = performActivity(s, WA, 'sleep-camp').state;
	s = performActivity({ ...s, health: 1, needs: { ...s.needs, hunger: 0 } }, WA, 'lay-low').state;
	assert.equal(s.loc, WA.hospital);
	assert.ok(s.health >= 50);
});

test('GPS 打卡：真实到达 + POI 奖励，不可重复领取', () => {
	assert.equal(locateInRegion(WA, -32.055, 115.7536)?.id, 'fremantle');
	assert.equal(locateInRegion(WA, -25.0, 125.0), null);
	const r = gpsCheckIn(fresh(), WA, -32.055, 115.7536);
	assert.ok(r.ok);
	assert.equal(r.state.loc, 'fremantle');
	assert.ok(r.state.checkins.includes('seed-freo-prison'));
	const again = gpsCheckIn({ ...r.state, pending: null }, WA, -32.055, 115.7536);
	assert.equal(again.ok, false);
	assert.equal(gpsCheckIn(fresh(), WA, 0, 0).ok, false);
});

test('相同 seed 结果确定', () => {
	const run = () => {
		let s = fresh('student', 7);
		for (const [to, mode] of [['bunbury', 'road'], ['margaret-river', 'road'], ['albany', 'road']] as const) {
			s = travel(s, WA, to, mode).state;
			if (s.pending) s = resolveEvent(s, WA, 0).state;
		}
		return s;
	};
	assert.deepEqual(run(), run());
});

test('存档校验：拒绝畸形数据并钳制数值', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	assert.equal(sanitizeState(null), null);
	assert.equal(sanitizeState({ v: 2 }), null);
	assert.equal(sanitizeState({ ...fresh(), loc: 'atlantis' }, locs), null);
	const dirty = { ...fresh(), cash: 1e99, health: -5, name: '<script>x', skills: { driving: 9999 }, heat: NaN };
	const clean = sanitizeState(dirty, locs)!;
	assert.equal(clean.cash, 1e9);
	assert.equal(clean.health, 0);
	assert.equal(clean.skills.driving, 100);
	assert.equal(clean.heat, 0);
	assert.ok(!clean.name.includes('<'));
	assert.deepEqual(sanitizeState(fresh(), locs), fresh());
});
