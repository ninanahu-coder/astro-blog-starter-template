// 摄影任务链：数据自洽、按地点时段天气判定、按顺序推进、全部拍完发额外奖励、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { photoQuestNow, takeQuestPhoto } from '../../src/game/core/engine.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { PHOTO_CHAIN_BONUS, PHOTO_MINUTES, PHOTO_QUESTS } from '../../src/game/data/photo-quests.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'photo-player', name: '拍', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 2 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 50, social: 90 },
	...over,
});
const HOUR = { dawn: 6, day: 12, dusk: 18, night: 22 } as const;
/** 找一个满足任务条件的时刻（天气按地点和游戏日固定，往后找） */
function goodMoment(i: number): number {
	const q = PHOTO_QUESTS[i];
	const hour = HOUR[q.periods?.[0] ?? 'day'];
	for (let d = 0; d < 400; d++) if (!q.weather || q.weather.includes(weatherOn(q.loc, d).id)) return at(hour, d);
	throw new Error(`${q.id} 找不到合适的天气`);
}

test('任务数据：id 唯一、地点存在、奖励为正；每个任务一年里都拍得到', () => {
	assert.equal(new Set(PHOTO_QUESTS.map((q) => q.id)).size, PHOTO_QUESTS.length);
	for (let i = 0; i < PHOTO_QUESTS.length; i++) {
		const q = PHOTO_QUESTS[i];
		assert.ok(WA.locations.some((l) => l.id === q.loc), q.id);
		assert.ok(q.cash > 0 && q.respect > 0, q.id);
		goodMoment(i);
	}
});

test('判定：不在地点、时段不对、天气不对都拍不了；条件都对才能拍', () => {
	const s = make({ photoQuest: 0, loc: 'fremantle', clock: at(18) });
	assert.match(photoQuestNow(s, WA)!.blocked!, /要去珀斯/);
	assert.match(photoQuestNow({ ...s, loc: 'perth', clock: at(12) }, WA)!.blocked!, /时段不对/);
	assert.equal(photoQuestNow({ ...s, loc: 'perth' }, WA)!.blocked, undefined);
	const i = PHOTO_QUESTS.findIndex((q) => q.id === 'jetty-rain');
	for (let d = 0; d < 200; d++) {
		if (weatherOn('busselton', d).id === 'rain') continue;
		assert.match(photoQuestNow(make({ photoQuest: i, loc: 'busselton', clock: at(12, d) }), WA)!.blocked!, /天气不对/);
		break;
	}
	assert.equal(takeQuestPhoto({ ...s, loc: 'perth', pending: { eventId: 'quokka-selfie' } }, WA).ok, false);
});

test('按顺序一个个拍完：每张加钱和声望、花时间；最后一张额外加声望；拍完后没有任务', () => {
	let s = make();
	let bonusSeen = false;
	for (let i = 0; i < PHOTO_QUESTS.length; i++) {
		const q = PHOTO_QUESTS[i];
		s = { ...s, loc: q.loc, clock: goodMoment(i), pending: null };
		const before = structuredClone(s);
		const r = takeQuestPhoto(s, WA);
		assert.ok(r.ok, `${q.id}: ${r.msg}`);
		assert.deepEqual(s, before, '不改入参');
		const extra = i === PHOTO_QUESTS.length - 1 ? PHOTO_CHAIN_BONUS : 0;
		assert.equal(r.state.photoQuest, i + 1);
		assert.equal(r.state.cash, s.cash + q.cash);
		assert.equal(r.state.respect, s.respect + q.respect + extra);
		assert.equal(r.state.clock, s.clock + PHOTO_MINUTES);
		if (extra) bonusSeen = /全部完成/.test(r.msg);
		s = r.state;
	}
	assert.ok(bonusSeen);
	assert.equal(photoQuestNow(s, WA), null);
	assert.equal(takeQuestPhoto(s, WA).ok, false);
});

test('走动作协议；存档校验把进度钳在 0 到任务总数之间', () => {
	assert.deepEqual(parseAction({ t: 'photo' }), { t: 'photo' });
	const r = applyAction(make({ loc: 'perth', clock: at(18) }), WA, { t: 'photo' });
	assert.ok(r.ok && r.state.rev === 1 && r.state.photoQuest === 1, r.msg);
	const locs = new Set(WA.locations.map((l) => l.id));
	const clean = (v: unknown) => sanitizeState({ ...make(), photoQuest: v }, locs, { fallbackLoc: 'perth', now: Date.now() })!.photoQuest;
	assert.equal(clean(999), PHOTO_QUESTS.length);
	assert.equal(clean(-3), 0);
	assert.equal(clean(2.7), 2);
	assert.equal(clean('x'), 0);
});
