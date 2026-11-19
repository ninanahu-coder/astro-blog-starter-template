// 昼夜：事件按抵达时刻的时段过滤；清晨才有「看日出」；数据里写的时段都合法
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { activitiesAt } from '../../src/game/core/engine.ts';
import { PERIOD_IDS, period, YEAR_DAYS } from '../../src/game/core/time.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { WA } from '../../src/game/data/wa.ts';

/** gps 动作要服务端时间（没有就当离线拒绝） */
const GPS_NOW = 1_800_000_000_000;

test('昼夜数据自洽：事件写的时段都存在且不为空；每个时段限定事件都有能触发的地点', () => {
	const ids = new Set<string>(PERIOD_IDS);
	const timed = EVENTS.filter((e) => e.periods);
	assert.ok(timed.length >= 4, '至少有四个按时段出现的事件');
	for (const e of timed) {
		assert.ok(e.periods!.length > 0, e.id);
		for (const p of e.periods!) assert.ok(ids.has(p), `${e.id} 的时段 ${p} 不存在`);
		const where = WA.locations.filter((l) => e.locs?.includes(l.id) || e.tags?.some((t) => l.tags.includes(t)) || e.kinds?.includes(l.kind));
		assert.ok(where.length > 0, `${e.id} 没有能触发的地点`);
	}
});

test('时段事件：只在抵达时刻属于对应时段时出现，对应时段能抽到', () => {
	const base = createCharacter({ id: 'period-check', name: '时', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 });
	const fre = WA.locations.find((l) => l.id === 'fremantle')!;
	const timed = new Map(EVENTS.filter((e) => e.periods).map((e) => [e.id, e.periods!]));
	let wrong = 0;
	const hits = new Set<string>();
	for (let d = 1; d < 60; d++) {
		for (let h = 0; h < 24; h++) {
			for (let seed = 0; seed < 4; seed++) {
				const s = { ...base, seed: seed * 7919 + d * 31 + h, clock: d * 1440 + h * 60, visited: { ...base.visited, fremantle: 1 } };
				const r = applyAction(s, WA, { t: 'gps', lat: fre.lat, lon: fre.lon, acc: 10 }, GPS_NOW);
				const id = r.state.pending?.eventId;
				const ps = id ? timed.get(id) : undefined;
				if (!ps) continue;
				if (!ps.includes(period(r.state.clock).id)) wrong++;
				hits.add(id!);
			}
		}
	}
	assert.equal(wrong, 0, '时段不对时出现了时段事件');
	assert.ok(hits.has('dawn-boats'), '清晨到港口应该能遇到渔船');
	assert.ok(hits.has('dusk-sunset'), '傍晚到海滩应该能看到日落');
});

test('看日出：海滩上只在不下雨的清晨 5–8 点出现', () => {
	const c = createCharacter({ id: 'sunrise', name: '早', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 3 });
	let clear = -1;
	for (let d = 1; d < YEAR_DAYS && clear < 0; d++) if (['sunny', 'cloudy', 'hot'].includes(weatherOn('perth', d).id)) clear = d;
	assert.ok(clear > 0);
	const has = (hour: number) => activitiesAt({ ...c, clock: clear * 1440 + hour * 60 }, WA).find((x) => x.act.id === 'sunrise');
	assert.ok(has(6), '晴天清晨 6 点有看日出');
	assert.ok(has(6)!.blocked === undefined || has(6)!.blocked === null || !has(6)!.blocked, '清晨能做');
	const noon = has(12);
	assert.ok(!noon || noon.blocked, '中午不能看日出');
});

test('夜间事件（第 25 轮）：至少 8 条只在夜里出现；大陆上每个地点天黑后抵达都至少有一条能抽到', () => {
	const night = EVENTS.filter((e) => e.weight > 0 && !e.venueTypes && e.periods?.includes('night'));
	assert.ok(night.length >= 8, `夜间事件只有 ${night.length} 条`);
	for (const l of WA.locations.filter((x) => x.kind !== 'island')) {
		const hit = night.some((e) => !(e.locs || e.tags || e.kinds) || e.locs?.includes(l.id) || e.tags?.some((t) => l.tags.includes(t)) || e.kinds?.includes(l.kind));
		assert.ok(hit, `${l.id} 天黑后没有夜间事件`);
	}
});

test('精确小时的事件：午后海风只在 12–20 点、猴子米亚喂海豚只在 7–12 点抵达时出现', async () => {
	const { eventMatches } = await import('../../src/game/core/engine.ts');
	const { YEAR_DAYS: Y, dateOf } = await import('../../src/game/core/time.ts');
	const at = (id: string, locId: string, hour: number) => {
		const ev = EVENTS.find((e) => e.id === id)!;
		const loc = WA.locations.find((l) => l.id === locId)!;
		// 找一天季节、天气都满足，只剩小时条件
		for (let d = 1; d < Y; d++) {
			if (ev.seasons && !ev.seasons.includes(dateOf(d * 1440).season)) continue;
			if (ev.weather && !ev.weather.includes(weatherOn(locId, d).id)) continue;
			return eventMatches(ev, loc, 'road', d * 1440 + hour * 60);
		}
		throw new Error(`${id} 一年里找不到合适的日子`);
	};
	for (const e of EVENTS.filter((x) => x.hours)) {
		const [o, c] = e.hours!;
		assert.ok(Number.isInteger(o) && Number.isInteger(c) && o >= 0 && o < 24 && c > 0 && c <= 24 && o !== c, `${e.id} 的 hours 不合法`);
	}
	assert.equal(at('freo-doctor', 'fremantle', 8), false, '早上 8 点还没有午后海风');
	assert.equal(at('freo-doctor', 'fremantle', 11), false, '11 点还没有午后海风');
	assert.equal(at('freo-doctor', 'fremantle', 12), true, '中午开始有海风');
	assert.equal(at('freo-doctor', 'fremantle', 15), true, '下午有海风');
	assert.equal(at('freo-doctor', 'fremantle', 20), false, '20 点以后不算');
	assert.equal(at('monkey-mia-feeding', 'monkey-mia', 6), false, '6 点还没开始喂');
	assert.equal(at('monkey-mia-feeding', 'monkey-mia', 7), true, '早上 7 点能遇到');
	assert.equal(at('monkey-mia-feeding', 'monkey-mia', 11), true, '11 点还能遇到');
	assert.equal(at('monkey-mia-feeding', 'monkey-mia', 12), false, '中午以后不喂');
	assert.equal(at('monkey-mia-feeding', 'monkey-mia', 16), false, '下午 4 点不喂');
});
