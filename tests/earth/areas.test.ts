// 区域结构通用化（第 41 轮）：世界由几个区域拼成，规则用合并后的世界，地图按所在区域画。
// 用一个假的第二区域检查：合并的约束、跨区域出行、存档清洗、找医院、区域判断都不依赖「只有西澳」。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS, areaOf, CROSS_ROUTES, exitsOf, getAreaBase, mergeAreas, WORLD_BASE } from '../../src/game/data/areas-base.ts';
import { WA_BASE } from '../../src/game/data/wa-base.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';
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

test('现在的世界：西澳 + 南澳（第 42 轮）；规则看到的世界是两者合起来，西澳本身不变（平衡模拟只用西澳）', () => {
	assert.deepEqual(AREAS.map((a) => a.id), ['wa', 'sa']);
	assert.equal(getAreaBase('wa'), WA_BASE);
	assert.equal(getAreaBase('sa'), SA_BASE);
	for (const bad of ['world', 'constructor', '__proto__', 'toString', 1, null]) assert.equal(getAreaBase(bad), undefined, String(bad));
	assert.deepEqual(WORLD.locations, [...WA.locations, ...SA_BASE.locations]);
	assert.deepEqual(WORLD.routes, [...WA.routes, ...SA_BASE.routes, ...CROSS_ROUTES]);
	assert.deepEqual(WORLD.venues, WA.venues, '南澳还没有真实地点');
	assert.equal(WORLD.spawn, 'perth', '新角色还在珀斯出生');
	assert.equal(getRegion('world'), WORLD);
	assert.equal(getRegion('wa'), FULL_AREAS[0]);
	// 每个区域都有出生点和医院，且都在自己的地点里；区域内路线两端都在本区域；地点 id 全世界唯一
	for (const a of FULL_AREAS) {
		const ids = new Set(a.locations.map((l) => l.id));
		assert.ok(ids.has(a.spawn) && ids.has(a.hospital), a.id);
		for (const r of a.routes) assert.ok(ids.has(r.a) && ids.has(r.b), `${a.id} 的路线 ${r.a}–${r.b} 两端都在本区域`);
		assert.ok(a.outline.length >= 3, `${a.id} 有轮廓`);
	}
	assert.equal(new Set(WORLD.locations.map((l) => l.id)).size, WORLD.locations.length);
});

/** 点在多边形里（射线法） */
function inside([x, y]: [number, number], poly: [number, number][]) {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i], [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
}

test('南澳数据（第 42 轮）：坐标在范围内、大陆地点在轮廓里；区域内路线连通；航班两头都有机场；标签和类型合法；每个地点 3 条小知识', async () => {
	const { FACTS } = await import('../../src/game/data/facts.ts');
	const KINDS = new Set(WA.locations.map((l) => l.kind));
	const TAGS = new Set(['airport', 'hospital', 'pub', 'beach', 'reef', 'surf', 'wine', 'whale', 'dolphin', 'market', 'gym', 'gorge', 'gold', 'opal']);
	const b = SA_BASE.bounds;
	for (const l of SA_BASE.locations) {
		assert.ok(l.lat > b.minLat && l.lat < b.maxLat && l.lon > b.minLon && l.lon < b.maxLon, `${l.id} 在范围内`);
		if (l.kind !== 'island') assert.ok(inside([l.lon, l.lat], SA_BASE.outline), `${l.id} 在南澳轮廓里`);
		else assert.ok(!inside([l.lon, l.lat], SA_BASE.outline), `${l.id} 是岛，不在大陆轮廓里`);
		assert.ok(KINDS.has(l.kind), `${l.id} 类型 ${l.kind}`);
		for (const t of l.tags) assert.ok(TAGS.has(t), `${l.id} 标签 ${t}`);
		assert.equal(FACTS[l.id]?.length, 3, `${l.id} 小知识`);
	}
	const byId = new Map(SA_BASE.locations.map((l) => [l.id, l]));
	for (const r of SA_BASE.routes) if (r.mode === 'air') assert.ok(byId.get(r.a)!.tags.includes('airport') && byId.get(r.b)!.tags.includes('airport'), `航班 ${r.a}–${r.b} 两头有机场`);
	// 从阿德莱德出发，区域内路线能到每个地点
	const seen = new Set(['adelaide']);
	for (let changed = true; changed; ) {
		changed = false;
		for (const r of SA_BASE.routes) for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) if (seen.has(x) && !seen.has(y)) { seen.add(y); changed = true; }
	}
	assert.equal(seen.size, SA_BASE.locations.length, '都连得上');
	// 南澳轮廓：西界 129°E、东界 141°E、北界 26°S
	assert.ok(SA_BASE.outline.every(([x, y]) => x >= 129 && x <= 141 && y <= -26 && y >= -38.1));
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

test('跨区域出行（第 43 轮）：珀斯飞阿德莱德、卡尔古利走公路到锡杜纳；价格时间照旧按出行公式算；到了以后存档区域变成南澳', () => {
	assert.deepEqual(CROSS_ROUTES.map((r) => `${r.a}-${r.b}-${r.mode}`), ['perth-adelaide-air', 'kalgoorlie-ceduna-road']);
	for (const r of CROSS_ROUTES) {
		assert.notEqual(areaOf(r.a)!.id, areaOf(r.b)!.id, '两端在不同区域');
		if (r.mode === 'air') assert.ok([r.a, r.b].every((id) => WORLD.locations.find((l) => l.id === id)!.tags.includes('airport')), '航班两头有机场');
	}
	assert.deepEqual(exitsOf(WA_BASE).length, 2);
	assert.deepEqual(exitsOf(SA_BASE).length, 2);
	const s0 = createCharacter({ id: 'cross-test', name: '测试', avatar: '🧑', origin: 'backpacker', traits: [], region: 'wa', spawn: 'perth', seed: 7 });
	const rich = { ...s0, cash: 5000 };
	const fly = travelOptions(rich, WORLD).find((o) => o.to === 'adelaide')!;
	assert.equal(fly.mode, 'air');
	// 航班公式：60 分钟 + 每 750 km 一小时；票价 120 + 每公里 0.25（engine.ts priceRoute，没改）
	assert.equal(fly.minutes, Math.round(60 + (fly.km / 750) * 60));
	assert.ok(fly.km > 2000 && fly.km < 2300, `珀斯—阿德莱德直线 ${fly.km} km`);
	const r = applyAction(rich, WORLD, { t: 'travel', to: 'adelaide', mode: 'air' }, 1_800_000_000_000);
	assert.ok(r.ok, r.msg);
	const clean = sanitizeState(r.state, new Set(WORLD.locations.map((l) => l.id)), { fallbackLoc: 'perth' })!;
	assert.equal(clean.loc, 'adelaide');
	assert.equal(clean.region, 'sa');
	assert.ok(travelOptions({ ...clean, pending: null }, WORLD).some((o) => o.to === 'glenelg'), '到了南澳能走南澳的路');
	// 公路：卡尔古利—锡杜纳，绕行系数 1.25，坐巴士要一天多
	const kal = { ...s0, loc: 'kalgoorlie', cash: 5000 };
	const bus = travelOptions(kal, WORLD).find((o) => o.to === 'ceduna')!;
	assert.equal(bus.mode, 'road');
	assert.ok(bus.km > 1300 && bus.km < 1700, `${bus.km} km`);
	assert.ok(bus.minutes > 18 * 60, '一天多');
	// 西澳本身没有这些路线：平衡模拟只用西澳，不受影响
	assert.ok(!travelOptions(rich, WA).some((o) => o.to === 'adelaide'));
});

test('南澳职业与住处（第 45 轮）：每个南澳地点都有至少一份工作和一种住处；库伯佩迪能租地下屋；三套南澳房产照搬西澳同档的数', async () => {
	const { CAREERS } = await import('../../src/game/data/careers.ts');
	const { HOMES } = await import('../../src/game/data/housing.ts');
	const { PROPERTIES } = await import('../../src/game/data/properties.ts');
	const hit = (w: { kinds?: string[]; tags?: string[] }, l: { kind: string; tags: string[] }) => !!w.kinds?.includes(l.kind) || !!w.tags?.some((t) => l.tags.includes(t));
	for (const l of SA_BASE.locations) {
		assert.ok(CAREERS.some((c) => hit(c.where, l)), `${l.id} 有工作`);
		assert.ok(HOMES.some((h) => hit(h.where, l)), `${l.id} 有住处`);
	}
	const dug = HOMES.find((h) => h.id === 'dugout')!;
	assert.deepEqual(WORLD.locations.filter((l) => hit(dug.where, l)).map((l) => l.id), ['coober-pedy'], '地下屋只在库伯佩迪');
	const same = (a: string, b: string) => {
		const [x, y] = [PROPERTIES.find((p) => p.id === a)!, PROPERTIES.find((p) => p.id === b)!];
		assert.deepEqual([x.price, x.weekly, x.rentIncome, x.homeType], [y.price, y.weekly, y.rentIncome, y.homeType], `${a} 照搬 ${b}`);
	};
	same('adelaide-villa', 'perth-apartment');
	same('glenelg-unit', 'freo-terrace');
	assert.equal(PROPERTIES.find((p) => p.id === 'coober-dugout')!.homeType, 'dugout');
	for (const p of PROPERTIES.filter((x) => SA_BASE.locations.some((l) => l.id === x.loc))) {
		const l = WORLD.locations.find((x) => x.id === p.loc)!;
		assert.ok(hit(HOMES.find((h) => h.id === p.homeType)!.where, l), `${p.id} 的房型在 ${l.id} 也能租到`);
	}
});
