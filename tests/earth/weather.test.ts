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

test('天气相册：抵达时按当天天气收一张，同一张不重复；清洗只留合法的照片 id', async () => {
	const { sanitizeState } = await import('../../src/game/core/character.ts');
	const LOCS = new Set(WA.locations.map((l) => l.id));
	const s = createCharacter({ id: 'photo-album', name: '相册', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 5 });
	assert.deepEqual(s.photos, []);
	const fre = WA.locations.find((l) => l.id === 'fremantle')!;
	const a = applyAction(s, WA, { t: 'gps', lat: fre.lat, lon: fre.lon });
	assert.ok(a.ok, a.msg);
	const shot = `fremantle|${weatherOn('fremantle', Math.floor(a.state.clock / 1440)).id}`;
	assert.deepEqual(a.state.photos, [shot]);
	assert.deepEqual(s.photos, [], '不改入参');
	// 处理掉可能的到达事件后，同一天再来一次不重复收
	let st = a.state;
	while (st.pending) st = applyAction(st, WA, { t: 'event', choice: 0 }).state;
	const per = WA.locations.find((l) => l.id === 'perth')!;
	st = applyAction(st, WA, { t: 'gps', lat: per.lat, lon: per.lon }).state;
	while (st.pending) st = applyAction(st, WA, { t: 'event', choice: 0 }).state;
	if (Math.floor(st.clock / 1440) === Math.floor(a.state.clock / 1440)) {
		const b = applyAction(st, WA, { t: 'gps', lat: fre.lat, lon: fre.lon });
		assert.equal(b.state.photos.filter((p) => p === shot).length, 1);
	}
	// 清洗：未知地点、未知天气、重复、非字符串都丢掉；旧存档没有这个字段时为空
	const dirty = sanitizeState({ ...s, photos: [shot, shot, 'atlantis|sunny', 'perth|snow', 7] }, LOCS);
	assert.deepEqual(dirty!.photos, [shot]);
	const old = { ...s } as Record<string, unknown>;
	delete old.photos;
	assert.deepEqual(sanitizeState(old, LOCS)!.photos, []);
});

test('看风暴：只在风暴天的海滩出现、能做；其他天气不显示也不能做', () => {
	let storm = -1, calm = -1;
	for (let d = 0; d < YEAR_DAYS * 3 && (storm < 0 || calm < 0); d++) {
		const w = weatherOn('perth', d);
		if (w.id === 'storm' && storm < 0) storm = d;
		if (w.id !== 'storm' && calm < 0) calm = d;
	}
	const base = createCharacter({ id: 'storm-watcher', name: '看浪', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 9 });
	const at = (day: number) => ({ ...base, clock: day * 1440 + 11 * 60 });
	assert.ok(activitiesAt(at(storm), WA).some((x) => x.act.id === 'storm-watch' && !x.blocked), '风暴天的珀斯海滩可以看风暴');
	assert.ok(applyAction(at(storm), WA, { t: 'activity', id: 'storm-watch' }).ok);
	assert.ok(!activitiesAt(at(calm), WA).some((x) => x.act.id === 'storm-watch'), '其他天气列表里没有');
	const r = applyAction(at(calm), WA, { t: 'activity', id: 'storm-watch' });
	assert.equal(r.ok, false);
	assert.match(r.msg, /天气/);
});

test('心愿「想拍一张没拍过的照片」：抵达时收到新照片才算完成', async () => {
	const { wishMatches, getWish } = await import('../../src/game/core/wishes.ts');
	const w = getWish('photo')!;
	assert.ok(w, '有这条心愿');
	const s = createCharacter({ id: 'photo-wisher', name: '拍照', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 2 });
	const fre = WA.locations.find((l) => l.id === 'fremantle')!;
	const a = { t: 'gps', lat: fre.lat, lon: fre.lon } as const;
	const r = applyAction(s, WA, a);
	assert.ok(r.ok);
	assert.equal(wishMatches(w, a, s, r.state), true, '收到新照片算完成');
	assert.equal(wishMatches(w, a, r.state, r.state), false, '没收到新照片不算');
});
