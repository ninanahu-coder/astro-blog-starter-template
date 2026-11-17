// 第 16、17 轮：新地点接进路网；每个地点 3 张小知识卡，按到访次数解锁
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { achievements } from '../../src/game/core/achievements.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { placeFacts, travel, travelOptions } from '../../src/game/core/engine.ts';
import { FACTS } from '../../src/game/data/facts.ts';
import { WA } from '../../src/game/data/wa.ts';

const fresh = () => createCharacter({ id: 'place-player', name: '游', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 5 });

test('新地点：曼杜拉、巴瑟尔顿、彭伯顿、珊瑚湾都在，不坐飞机也能从珀斯走到每个地点', () => {
	for (const id of ['mandurah', 'busselton', 'pemberton', 'coral-bay']) assert.ok(WA.locations.some((l) => l.id === id), id);
	const seen = new Set([WA.spawn]);
	const queue = [WA.spawn];
	while (queue.length) {
		const at = queue.shift()!;
		for (const r of WA.routes) {
			if (r.mode === 'air') continue;
			const next = r.a === at ? r.b : r.b === at ? r.a : null;
			if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
		}
	}
	assert.deepEqual(WA.locations.filter((l) => !seen.has(l.id)).map((l) => l.id), []);
	// 走一趟：珀斯开车到曼杜拉
	const r = travel(fresh(), WA, 'mandurah', 'road');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.loc, 'mandurah');
	assert.ok(travelOptions(r.state, WA).some((o) => o.to === 'bunbury'));
});

/** 射线法判断点在不在多边形里；ring 是 [经度, 纬度] */
function inside(lon: number, lat: number, ring: [number, number][]): boolean {
	let hit = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
	}
	return hit;
}

test('地图：大陆上的地点都落在西澳轮廓里（岛屿除外），岛屿在轮廓外', () => {
	for (const l of WA.locations) {
		assert.equal(inside(l.lon, l.lat, WA.outline), l.kind !== 'island', `${l.id} (${l.lon}, ${l.lat})`);
	}
});

test('小知识数据：每个地点正好 3 条，不重复，有 https 来源，不超过 50 个字', () => {
	const ids = new Set(WA.locations.map((l) => l.id));
	assert.deepEqual(Object.keys(FACTS).filter((k) => !ids.has(k)), [], '没有多余地点');
	for (const l of WA.locations) {
		const list = FACTS[l.id];
		assert.equal(list?.length, 3, l.id);
		assert.equal(new Set(list.map((f) => f.text)).size, 3, l.id);
		for (const f of list) {
			assert.ok(f.source.startsWith('https://'), `${l.id}: ${f.source}`);
			assert.ok([...f.text].length <= 50, `${l.id}: ${f.text}`);
		}
	}
});

test('小知识解锁：第 n 次到访解锁第 n 条；没来过全锁；成就按解锁数计', () => {
	const s = fresh();
	assert.deepEqual(placeFacts(s, 'albany').map((f) => f.unlocked), [false, false, false]);
	assert.deepEqual(placeFacts(s, 'perth').map((f) => f.unlocked), [true, false, false], '开局在珀斯算到访一次');
	assert.deepEqual(placeFacts({ ...s, visited: { perth: 2 } }, 'perth').map((f) => f.unlocked), [true, true, false]);
	assert.deepEqual(placeFacts({ ...s, visited: { perth: 9 } }, 'perth').map((f) => f.unlocked), [true, true, true]);
	const r = travel(s, WA, 'fremantle', 'road');
	assert.equal(placeFacts(r.state, 'fremantle').filter((f) => f.unlocked).length, 1);
	const visited = Object.fromEntries(WA.locations.slice(0, 5).map((l) => [l.id, 3]));
	assert.ok(achievements({ ...s, visited }, WA).find((a) => a.def.id === 'facts-15')!.done);
});
