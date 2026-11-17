// 区域结构通用化（第 41 轮）：世界由几个区域拼成，规则用合并后的世界，地图按所在区域画。
// 用一个假的第二区域检查：合并的约束、跨区域出行、存档清洗、找医院、区域判断都不依赖「只有西澳」。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS, areaOf, CROSS_ROUTES, exitsOf, getAreaBase, mergeAreas, WORLD_BASE } from '../../src/game/data/areas-base.ts';
import { WA_BASE } from '../../src/game/data/wa-base.ts';
import { FULL_AREAS, getRegion, WA, WORLD } from '../../src/game/data/wa.ts';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { travelOptions } from '../../src/game/core/engine.ts';
import type { Region } from '../../src/game/core/types.ts';

/** 假的第二区域：两个地点、一条公路 */
const FAKE: Region = {
	id: 'zz', name: '测试区', bounds: { minLon: 150, maxLon: 152, minLat: -31, maxLat: -29 }, outline: [[150, -29], [152, -29], [152, -31], [150, -31]],
	spawn: 'zz-a', hospital: 'zz-a', pois: [], venues: [],
	locations: [
		{ id: 'zz-a', name: '甲城', en: 'Zed A', lat: -30, lon: 151, kind: 'city', tags: ['airport', 'hospital', 'pub'], radiusKm: 10, blurb: '测试用' },
		{ id: 'zz-b', name: '乙镇', en: 'Zed B', lat: -30.3, lon: 151.4, kind: 'town', tags: ['pub'], radiusKm: 8, blurb: '测试用' },
	],
	routes: [{ a: 'zz-a', b: 'zz-b', mode: 'road' }],
};
const CROSS = [{ a: 'perth', b: 'zz-a', mode: 'air' as const }];
const W2 = mergeAreas([WA, FAKE], CROSS);

test('合并：地点、路线、打卡点、真实地点拼在一起，范围取并集；出生点和默认医院用第一个区域的', () => {
	assert.equal(W2.locations.length, WA.locations.length + 2);
	assert.equal(W2.routes.length, WA.routes.length + 1 + 1);
	assert.equal(W2.venues.length, WA.venues.length);
	assert.equal(W2.spawn, WA.spawn);
	assert.equal(W2.hospital, WA.hospital);
	assert.equal(W2.bounds.maxLon, 152);
	assert.equal(W2.bounds.minLon, WA.bounds.minLon);
	assert.equal(areaOf('zz-b', [WA, FAKE]), FAKE);
	assert.equal(areaOf('perth', [WA, FAKE]), WA);
	assert.equal(areaOf('nowhere', [WA, FAKE]), undefined);
	assert.equal(areaOf(42, [WA, FAKE]), undefined);
	assert.deepEqual(exitsOf(WA, CROSS), CROSS, '西澳的出口');
	assert.deepEqual(exitsOf(FAKE, CROSS), CROSS);
	assert.deepEqual(exitsOf(FAKE, []), []);
});

test('合并的约束：地点 id 重复、跨区域路线连到不存在的地点或两端同区域，都直接报错', () => {
	assert.throws(() => mergeAreas([WA, { ...FAKE, locations: [{ ...FAKE.locations[0], id: 'perth' }] }], []), /重复/);
	assert.throws(() => mergeAreas([WA, FAKE], [{ a: 'perth', b: 'nope', mode: 'air' }]), /不存在/);
	assert.throws(() => mergeAreas([WA, FAKE], [{ a: 'perth', b: 'broome', mode: 'air' }]), /两端都在/);
	assert.throws(() => mergeAreas([], []), /没有区域/);
});

test('跨区域出行：走跨区域路线到另一个区域，存档清洗后区域跟着地点变；那边的路线照常能走', () => {
	const s0 = createCharacter({ id: 'area-test', name: '测试', avatar: '🧑', origin: 'backpacker', traits: [], region: 'wa', spawn: 'perth', seed: 7 });
	const s = { ...s0, cash: 5000 };
	assert.ok(travelOptions(s, W2).some((o) => o.to === 'zz-a' && o.mode === 'air'), '珀斯有飞去甲城的航班');
	assert.ok(!travelOptions(s, WA).some((o) => o.to === 'zz-a'), '只用西澳时没有');
	const r = applyAction(s, W2, { t: 'travel', to: 'zz-a', mode: 'air' }, 1_800_000_000_000);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.loc, 'zz-a');
	const locs = new Set(W2.locations.map((l) => l.id));
	const clean = sanitizeState(r.state, locs, { fallbackLoc: W2.spawn });
	assert.ok(clean);
	assert.equal(clean!.loc, 'zz-a', '另一个区域的地点在世界里是合法的');
	const st = { ...clean!, pending: null };
	assert.ok(travelOptions(st, W2).some((o) => o.to === 'zz-b'), '到了那边能走那边的路');
	// 只认西澳的地点集合时，另一区域的地点按「不存在」挪回出生点（服务器用的是整个世界，不会这样）
	assert.equal(sanitizeState(r.state, new Set(WA.locations.map((l) => l.id)), { fallbackLoc: 'perth' })!.loc, 'perth');
});

test('现在的世界：只有西澳一个区域，规则看到的和原来的西澳完全一样（平衡模拟不变）', () => {
	assert.deepEqual(AREAS.map((a) => a.id), ['wa']);
	assert.deepEqual(CROSS_ROUTES, []);
	assert.equal(getAreaBase('wa'), WA_BASE);
	for (const bad of ['world', 'constructor', '__proto__', 'toString', 1, null]) assert.equal(getAreaBase(bad), undefined, String(bad));
	assert.deepEqual(WORLD.locations, WA.locations);
	assert.deepEqual(WORLD.routes, WA.routes);
	assert.deepEqual(WORLD.pois, WA.pois);
	assert.deepEqual(WORLD.venues, WA.venues);
	assert.deepEqual(WORLD_BASE.locations, WA_BASE.locations);
	assert.equal(WORLD.spawn, 'perth');
	assert.equal(getRegion('world'), WORLD);
	assert.equal(getRegion('wa'), FULL_AREAS[0]);
	// 每个区域都有出生点和医院，且都在自己的地点里；地点 id 全世界唯一
	for (const a of FULL_AREAS) {
		const ids = new Set(a.locations.map((l) => l.id));
		assert.ok(ids.has(a.spawn) && ids.has(a.hospital), a.id);
		for (const r of a.routes) assert.ok(ids.has(r.a) && ids.has(r.b), `${a.id} 的路线 ${r.a}–${r.b} 两端都在本区域`);
		assert.ok(a.outline.length >= 3, `${a.id} 有轮廓`);
	}
	assert.equal(new Set(WORLD.locations.map((l) => l.id)).size, WORLD.locations.length);
});

test('存档清洗：区域字段由地点决定，存档里写错的区域会被改正', () => {
	const s0 = createCharacter({ id: 'area-test-2', name: '测试', avatar: '🧑', origin: 'backpacker', traits: [], region: 'wa', spawn: 'perth', seed: 7 });
	const locs = new Set(WORLD.locations.map((l) => l.id));
	for (const bad of ['zz', 'world', 'constructor', 42]) assert.equal(sanitizeState({ ...s0, region: bad }, locs, { fallbackLoc: 'perth' })!.region, 'wa');
});

test('在线频道按区域分：只认注册过的区域 id，不认 world 和原型名', async () => {
	const { EarthWorld } = await import('../../src/game/server/world.ts');
	const w = new EarthWorld({ storage: { get: async () => undefined, put: async () => {}, list: async () => new Map() } } as never, {});
	for (const bad of ['world', 'constructor', '__proto__', 'zz']) {
		const res = await w.fetch(new Request(`https://x.test/api/earth/ws?region=${bad}&id=p${'a'.repeat(15)}`, { headers: { Upgrade: 'websocket' } }));
		assert.equal(res.status, 404, bad);
	}
});
