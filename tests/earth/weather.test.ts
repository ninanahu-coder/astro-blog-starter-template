import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { activitiesAt } from '../../src/game/core/engine.ts';
import { dateOf, SEASONS, YEAR_DAYS } from '../../src/game/core/time.ts';
import { weatherAt, weatherOn } from '../../src/game/core/weather.ts';
import { WEATHERS, WEATHER_WEIGHTS } from '../../src/game/data/weather.ts';
import { WA } from '../../src/game/data/wa.ts';

test('天气数据：每季权重合计 100，只引用存在的天气', () => {
	for (const s of SEASONS) {
		const t = WEATHER_WEIGHTS[s.id];
		assert.equal(t.reduce((a, [, w]) => a + w, 0), 100, s.id);
		for (const [id, w] of t) {
			assert.ok(WEATHERS.some((x) => x.id === id), id);
			assert.ok(w > 0, id);
		}
	}
});

test('天气：同一地点同一天结果固定；长期分布接近各季权重', () => {
	assert.equal(weatherOn('perth', 40).id, weatherOn('perth', 40).id);
	const counts: Record<string, Record<string, number>> = {};
	let days = 0;
	for (const loc of WA.locations) {
		for (let d = 0; d < YEAR_DAYS * 6; d++) {
			const season = dateOf(d * 1440).season;
			const w = weatherOn(loc.id, d).id;
			(counts[season] ??= {})[w] = (counts[season][w] ?? 0) + 1;
			days++;
		}
	}
	assert.ok(days > 10_000);
	for (const s of SEASONS) {
		const total = Object.values(counts[s.id]).reduce((a, b) => a + b, 0);
		for (const [id, w] of WEATHER_WEIGHTS[s.id]) {
			const share = (counts[s.id][id] ?? 0) / total * 100;
			assert.ok(Math.abs(share - w) < 3, `${s.id} ${id}: ${share.toFixed(1)}% vs ${w}%`);
		}
	}
});

test('天气：风暴天只取消海上的活动，其他天照常', () => {
	// 珀斯有海滩：找一个风暴天和一个晴天
	let storm = -1, calm = -1;
	for (let d = 0; d < YEAR_DAYS * 3 && (storm < 0 || calm < 0); d++) {
		const w = weatherOn('perth', d);
		if (w.closesSea && storm < 0) storm = d;
		if (!w.closesSea && calm < 0) calm = d;
	}
	assert.ok(storm >= 0 && calm >= 0);
	const base = createCharacter({ id: 'wx', name: '天气', avatar: '🧑', origin: 'surfer', region: 'wa', spawn: 'perth', seed: 3 });
	const at = (day: number) => ({ ...base, clock: day * 1440 + 10 * 60 });
	const stormy = at(storm);
	assert.equal(weatherAt(stormy).id, 'storm');
	const swim = activitiesAt(stormy, WA).find((x) => x.act.id === 'swim')!;
	assert.match(swim.blocked ?? '', /风暴/);
	const r = applyAction(stormy, WA, { t: 'activity', id: 'swim' });
	assert.equal(r.ok, false);
	assert.match(r.msg, /风暴/);
	const eat = activitiesAt(stormy, WA).find((x) => x.act.id === 'eat')!;
	assert.equal(eat.blocked, undefined, '陆上的活动不受影响');
	const calmDay = at(calm);
	assert.equal(activitiesAt(calmDay, WA).find((x) => x.act.id === 'swim')!.blocked, undefined);
	assert.ok(applyAction(calmDay, WA, { t: 'activity', id: 'swim' }).ok);
});
