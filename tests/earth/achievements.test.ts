import assert from 'node:assert/strict';
import { test } from 'node:test';
import { achievements, newAchievements, FRIEND_SCORE, BESTIE_SCORE, type AchievementMetric } from '../../src/game/core/achievements.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { netWorth } from '../../src/game/core/engine.ts';
import { ACHIEVEMENTS } from '../../src/game/data/achievements.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { WA } from '../../src/game/data/wa.ts';

const fresh = () => createCharacter({ id: 'ach', name: '成就', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 1 });
const byId = (s: ReturnType<typeof fresh>) => new Map(achievements(s, WA).map((a) => [a.def.id, a]));

test('成就数据自洽：id 唯一、指标合法、目标为正', () => {
	const metrics: AchievementMetric[] = ['places', 'checkins', 'collected', 'friends', 'besties', 'home', 'properties', 'topJob', 'worth', 'level'];
	assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
	for (const a of ACHIEVEMENTS) {
		assert.ok(metrics.includes(a.metric), a.id);
		assert.ok(a.goal === 'all-places' || a.goal === 'all-experiences' || (Number.isInteger(a.goal) && a.goal > 0), a.id);
		assert.ok(a.name && a.desc && a.icon, a.id);
	}
});

test('成就：新角色只完成和开局相符的，进度不超过目标', () => {
	const s = fresh();
	const m = byId(s);
	assert.equal(m.get('explore-5')!.cur, 1, '出生地算去过一次');
	assert.equal(m.get('explore-all')!.goal, WA.locations.length);
	assert.equal(m.get('collect-all')!.goal, EXPERIENCES.length);
	for (const a of m.values()) assert.ok(a.cur <= a.goal, a.def.id);
	assert.deepEqual([...m.values()].filter((a) => a.done).map((a) => a.def.id), [], '背包客开局没有成就');
});

test('成就：各指标按存档现算，新达成的能被识别', () => {
	const before = fresh();
	const s = structuredClone(before);
	for (const l of WA.locations.slice(0, 10)) s.visited[l.id] = 1;
	s.relations = {
		mia: { score: FRIEND_SCORE, last: {}, seen: [], known: [] },
		bill: { score: BESTIE_SCORE, last: {}, seen: [], known: [] },
		nancy: { score: FRIEND_SCORE - 1, last: {}, seen: [], known: [] },
	} as typeof s.relations;
	s.collected = [...EXPERIENCES.slice(0, 5).map((e) => e.id), 'not-a-real-experience'];
	const top = CAREERS[0];
	s.job = { career: top.id, loc: WA.spawn, level: top.levels.length - 1, shifts: 0, good: 0, lastDay: -1 } as typeof s.job;
	s.properties = [{ id: PROPERTIES[0].id, loan: 0, rented: false, missed: 0 }] as typeof s.properties;
	s.cash = 20_000;
	const m = byId(s);
	assert.equal(m.get('explore-10')!.done, true);
	assert.equal(m.get('explore-all')!.done, false);
	assert.equal(m.get('friend-3')!.cur, 2, '朋友按分数门槛算，挚友也是朋友；差 1 分的不算');
	assert.equal(m.get('bestie')!.done, true);
	assert.equal(m.get('collect-5')!.cur, 5, '未知体验不计');
	assert.equal(m.get('top-job')!.done, true);
	assert.equal(m.get('owner')!.done, true);
	assert.equal(m.get('landlord')!.done, false);
	assert.equal(m.get('worth-10k')!.done, netWorth(s) >= 10_000);
	const got = newAchievements(before, s, WA).map((d) => d.id);
	for (const id of ['explore-5', 'explore-10', 'friend-1', 'bestie', 'collect-5', 'top-job', 'owner', 'worth-10k']) assert.ok(got.includes(id), id);
	assert.deepEqual(newAchievements(s, s, WA), [], '没有变化就没有新成就');
});
