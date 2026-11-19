import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { checkScore } from '../../src/game/core/attributes.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { activitiesAt } from '../../src/game/core/engine.ts';
import { dateOf, SEASONS, YEAR_DAYS } from '../../src/game/core/time.ts';
import { weatherAt, weatherOn, weightsOn } from '../../src/game/core/weather.ts';
import { WEATHERS } from '../../src/game/data/weather.ts';
import { WA } from '../../src/game/data/wa.ts';

test('天气数据：id 唯一，只有风暴关海；每个地点、每个月的概率表只引用存在的天气', () => {
	assert.equal(new Set(WEATHERS.map((w) => w.id)).size, WEATHERS.length);
	assert.deepEqual(WEATHERS.filter((w) => w.closesSea).map((w) => w.id), ['storm']);
	for (const loc of WA.locations) for (let d = 0; d < YEAR_DAYS; d += 7) for (const [id] of weightsOn(loc.id, d)) assert.ok(WEATHERS.some((x) => x.id === id), id);
});

test('天气：同一地点同一天结果固定，和先算哪天无关', () => {
	const first = weatherOn('perth', 40).id;
	for (let d = 0; d < 200; d++) weatherOn('perth', d);
	assert.equal(weatherOn('perth', 40).id, first);
	// 每个季节都能见到不止一种天气
	for (const s of SEASONS) {
		const seen = new Set<string>();
		for (let d = 0; d < YEAR_DAYS * 3; d++) if (dateOf(d * 1440).season === s.id) seen.add(weatherOn('perth', d).id);
		assert.ok(seen.size >= 3, `${s.id}: ${[...seen]}`);
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

test('风暴天：事件里下海的选项不能选（换别的选项能结算），出海类 NPC 专属互动也做不了', async () => {
	const { EVENTS } = await import('../../src/game/data/events.ts');
	const { NPCS } = await import('../../src/game/data/npcs.ts');
	const { npcsAt } = await import('../../src/game/core/engine.ts');
	// 数据：有下海选项的事件都还有别的选项，风暴天不会卡住
	for (const e of EVENTS) if (e.choices.some((c) => c.exposed === 'sea')) assert.ok(e.choices.some((c) => c.exposed !== 'sea'), `${e.id} 只有下海选项`);
	// 埃斯佩兰斯的风暴天，挂着「白沙滩上的袋鼠」
	let day = -1;
	for (let d = 0; d < YEAR_DAYS * 4 && day < 0; d++) if (weatherOn('esperance', d).id === 'storm') day = d;
	assert.ok(day >= 0);
	const base = createCharacter({ id: 'storm-event', name: '风暴', avatar: '🧑', origin: 'surfer', region: 'wa', spawn: 'esperance', seed: 4 });
	const s = { ...base, clock: day * 1440 + 10 * 60, pending: { eventId: 'lucky-bay-roos' } };
	const sea = EVENTS.find((e) => e.id === 'lucky-bay-roos')!.choices.findIndex((c) => c.exposed === 'sea');
	const r = applyAction(s, WA, { t: 'event', choice: sea });
	assert.equal(r.ok, false);
	assert.match(r.msg, /风暴/);
	assert.ok(applyAction(s, WA, { t: 'event', choice: sea === 0 ? 1 : 0 }).ok, '另一个选项照常');
	// 汤姆的「清晨收笼」：杰拉尔顿风暴天、关系够了也做不了
	let gday = -1;
	for (let d = 0; d < YEAR_DAYS * 4 && gday < 0; d++) if (weatherOn('geraldton', d).id === 'storm' && ![5, 6].includes(d % 7)) gday = d;
	const g = createCharacter({ id: 'storm-perk', name: '收笼', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'geraldton', seed: 4 });
	const gs = { ...g, clock: gday * 1440 + 8 * 60, relations: { tom: { score: 70, last: {}, seen: [10, 30, 60], known: [] } } };
	const tom = npcsAt(gs, WA).find((x) => x.npc.id === 'tom');
	assert.ok(tom, '汤姆在');
	assert.match(tom!.blocked.perk ?? '', /风暴/);
	assert.equal(applyAction(gs, WA, { t: 'npc', npc: 'tom', act: 'perk' }).ok, false);
	assert.ok(NPCS.find((n) => n.id === 'tom')!.perk!.exposed === 'sea');
});

test('看星星：只在内陆和公园、晚上 20 点到凌晨 2 点、不下雨的夜里能做', () => {
	let clear = -1, wet = -1;
	for (let d = 0; d < YEAR_DAYS * 3 && (clear < 0 || wet < 0); d++) {
		const w = weatherOn('pinnacles', d).id;
		if (['sunny', 'cloudy', 'hot'].includes(w) && clear < 0) clear = d;
		if (['rain', 'storm'].includes(w) && wet < 0) wet = d;
	}
	const base = createCharacter({ id: 'star-gazer', name: '星星', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'pinnacles', seed: 6 });
	const at = (day: number, hour: number) => ({ ...base, clock: day * 1440 + hour * 60 });
	const has = (s: ReturnType<typeof at>) => activitiesAt(s, WA).find((x) => x.act.id === 'stargaze');
	assert.ok(has(at(clear, 22)) && !has(at(clear, 22))!.blocked, '晴夜 22 点可以');
	assert.ok(applyAction(at(clear, 22), WA, { t: 'activity', id: 'stargaze' }).ok);
	assert.match(has(at(clear, 14))?.blocked ?? '', /营业时间|20/, '白天不行');
	assert.equal(has(at(wet, 22)), undefined, '下雨的夜里列表里没有');
	const city = createCharacter({ id: 'star-city', name: '城里', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 6 });
	assert.equal(activitiesAt({ ...city, clock: clear * 1440 + 22 * 60 }, WA).find((x) => x.act.id === 'stargaze'), undefined, '城市里没有');
});

test('天气事件：只在抵达地点当天下雨时出现', async () => {
	const { EVENTS } = await import('../../src/game/data/events.ts');
	const rainOnly = EVENTS.filter((e) => e.weather?.includes('rain'));
	assert.ok(rainOnly.length >= 2);
	// 在弗里曼特尔找一个下雨天和一个不下雨的天，让「躲雨」成为唯一可能的事件来源之一：
	// 直接检查事件池过滤——不下雨的日子永远不会抽到下雨事件
	const base = createCharacter({ id: 'rain-check', name: '雨', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 });
	const fre = WA.locations.find((l) => l.id === 'fremantle')!;
	let dryHits = 0, wetHits = 0;
	for (let d = 1; d < YEAR_DAYS * 2; d++) {
		const wet = weatherOn('fremantle', d).id === 'rain';
		for (let seed = 0; seed < 6; seed++) {
			const s = { ...base, seed: seed * 7919 + d, clock: d * 1440 + 9 * 60, visited: { ...base.visited, fremantle: 1 } };
			const r = applyAction(s, WA, { t: 'gps', lat: fre.lat, lon: fre.lon });
			const id = r.state.pending?.eventId;
			if (id && rainOnly.some((e) => e.id === id)) { if (wet) wetHits++; else dryHits++; }
		}
	}
	assert.equal(dryHits, 0, '不下雨的日子出现了下雨事件');
	assert.ok(wetHits > 0, '下雨天应该能抽到下雨事件');
});

test('天气相关数据自洽：活动和事件里写的天气都存在，exposed 只能是 sea，限定天气的活动至少有一种天气', async () => {
	const { ACTIVITIES } = await import('../../src/game/data/activities.ts');
	const { EVENTS } = await import('../../src/game/data/events.ts');
	const { NPCS } = await import('../../src/game/data/npcs.ts');
	const ids = new Set(WEATHERS.map((w) => w.id));
	for (const a of ACTIVITIES) {
		if (a.weather) {
			assert.ok(a.weather.length > 0, a.id);
			for (const w of a.weather) assert.ok(ids.has(w), `${a.id} 的天气 ${w} 不存在`);
		}
		if (a.exposed !== undefined) assert.equal(a.exposed, 'sea', a.id);
	}
	for (const e of EVENTS) {
		for (const w of e.weather ?? []) assert.ok(ids.has(w), `${e.id} 的天气 ${w} 不存在`);
		for (const c of e.choices) if (c.exposed !== undefined) assert.equal(c.exposed, 'sea', `${e.id}：${c.label}`);
	}
	for (const n of NPCS) if (n.perk?.exposed !== undefined) assert.equal(n.perk.exposed, 'sea', n.id);
	// 只有风暴会关海：如果以后有别的天气 closesSea，这里提醒检查文案
	assert.deepEqual(WEATHERS.filter((w) => w.closesSea).map((w) => w.id), ['storm']);
});

test('天气用品：天气限定的装备只在对应天气加检定分，其他天气不算', () => {
	const base = createCharacter({ id: 'gear', name: 'g', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 });
	const find = (want: string) => {
		for (let d = 0; d < 400; d++) {
			const clock = d * 1440 + 12 * 60;
			if (weatherAt({ ...base, clock }).id === want) return clock;
		}
		throw new Error('找不到 ' + want);
	};
	const rainy = { ...base, clock: find('rain'), inventory: { raincoat: 1 } };
	const sunny = { ...rainy, clock: find('sunny') };
	assert.equal(checkScore(rainy, 'stamina').item, 4, '下雨天雨衣生效');
	assert.equal(checkScore(sunny, 'stamina').item, 0, '晴天雨衣不算');
	const hat = { ...sunny, inventory: { sunhat: 1, flynet: 1 } };
	assert.equal(checkScore(hat, 'survival').item, 4, '晴天宽檐帽 +4 高于防蝇网帽 +3');
	assert.equal(checkScore({ ...hat, clock: rainy.clock }, 'survival').item, 3, '雨天只剩防蝇网帽');
	for (const it of ITEMS) for (const w of it.weather ?? []) assert.ok(WEATHERS.some((x) => x.id === w), `${it.id} 的天气 ${w}`);
	for (const it of ITEMS) if (it.weather) assert.ok(it.passive, `${it.id} 天气限定只用于随身装备`);
});
