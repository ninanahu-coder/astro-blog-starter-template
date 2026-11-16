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
				const r = applyAction(s, WA, { t: 'gps', lat: fre.lat, lon: fre.lon });
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
