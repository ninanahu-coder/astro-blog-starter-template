// 主线剧情：数据自洽、目标判定（状态目标做到就记下、动作目标按次数）、一章完成发奖励进下一章、存档清洗
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, type GameAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { currentChapter, settleStory, storyProgress } from '../../src/game/core/story.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { STORY } from '../../src/game/data/story.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'story-player', name: '故', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 5 }),
	...over,
});
/** 模拟一次成功的动作：after 由 change 改出来，然后结算剧情 */
function step(s: PlayerState, a: GameAction, change: (x: PlayerState) => void = () => {}) {
	const after = structuredClone(s);
	change(after);
	const notes = settleStory(s, after, a);
	return { after, notes };
}
const CHAT: GameAction = { t: 'npc', npc: NPCS[0].id, act: 'chat' };
const EAT: GameAction = { t: 'activity', id: 'eat' };
const BUY: GameAction = { t: 'buy', item: 'water' };

test('剧情数据：章、目标 id 唯一；每个目标恰好是状态目标或动作目标；地点、活动存在；奖励只用钱、声望、心情', () => {
	assert.equal(new Set(STORY.map((c) => c.id)).size, STORY.length);
	const locs = new Set(WA.locations.map((l) => l.id));
	const acts = new Set(ACTIVITIES.map((a) => a.id));
	for (const c of STORY) {
		assert.ok(c.steps.length >= 3 && c.steps.length <= 20, c.id);
		assert.equal(new Set(c.steps.map((s) => s.id)).size, c.steps.length, c.id);
		for (const s of c.steps) {
			assert.ok(!!s.state !== !!s.act, `${c.id}/${s.id} 只能是一种目标`);
			assert.ok((s.n ?? 1) >= 1 && Number.isInteger(s.n ?? 1), s.id);
			if (s.state?.t === 'visited') assert.ok(locs.has(s.state.loc), s.id);
			if (s.act?.t === 'activity') for (const id of s.act.ids) assert.ok(acts.has(id), `${s.id} 活动 ${id}`);
		}
		assert.deepEqual(Object.keys(c.reward).filter((k) => !['cash', 'respect', 'moodlet'].includes(k)), [], c.id);
	}
});

test('新角色从第一章开始，所有目标都没完成', () => {
	const p = storyProgress(make())!;
	assert.equal(p.index, 0);
	assert.equal(p.chapter.id, STORY[0].id);
	assert.ok(p.steps.every((x) => x.got === 0));
});

test('动作目标按次数推进；不相干的动作不算；状态目标做到就记下，之后不收回', () => {
	let s = make();
	s = step(s, EAT).after;
	assert.equal(s.story.done.meal, 1);
	s = step(s, CHAT).after;
	assert.equal(s.story.done.chat, 1, '聊天要 2 次，现在 1 次');
	s = step(s, { t: 'activity', id: 'hike' }).after;
	assert.equal(s.story.done.meal, 1, '徒步不算吃饭');
	// 去了弗里曼特尔：状态目标做到
	s = step(s, { t: 'travel', to: 'fremantle', mode: 'road' }, (x) => { x.visited.fremantle = 1; x.loc = 'fremantle'; }).after;
	assert.equal(s.story.done.freo, 1);
	// 存档里的到访记录被改没了也不收回
	s = step(s, EAT, (x) => { delete x.visited.fremantle; }).after;
	assert.equal(s.story.done.freo, 1);
});

test('第一章全部做到：发一次奖励、写进日志、进下一章；不改 before', () => {
	let s = make();
	for (const a of [EAT, CHAT, CHAT, BUY]) s = step(s, a).after;
	assert.equal(s.story.ch, 0, '还差地点');
	const before = structuredClone(s);
	const r = step(s, EAT, (x) => { x.visited.fremantle = 1; x.visited.rottnest = 1; });
	assert.deepEqual(s, before, '不改 before');
	assert.deepEqual(r.notes, [`${STORY[0].title} 完成`]);
	assert.equal(r.after.story.ch, 1);
	const nextSteps = STORY[1]?.steps ?? [];
	assert.ok(Object.keys(r.after.story.done).every((id) => nextSteps.some((x) => x.id === id && x.state)), '下一章从零开始，只有已经满足的状态目标会马上记下');
	assert.equal(r.after.cash, s.cash + (STORY[0].reward.cash ?? 0));
	assert.equal(r.after.respect, s.respect + (STORY[0].reward.respect ?? 0));
	assert.ok(r.after.journal.some((j) => j.text.includes(STORY[0].title)));
	// 再做一次同样的事，不会再发第一章的奖励
	const again = step(r.after, EAT);
	assert.deepEqual(again.notes, []);
});

test('全部章节写完后没有当前章，动作不再推进剧情', () => {
	const s = make({ story: { ch: STORY.length, done: {} } });
	assert.equal(currentChapter(s), null);
	assert.equal(storyProgress(s), null);
	const r = step(s, EAT);
	assert.deepEqual(r.notes, []);
	assert.deepEqual(r.after.story, s.story);
});

test('走 applyAction：在珀斯吃饭推进第一章「吃一顿饭」；失败的动作不推进', () => {
	const s = make({ needs: { hunger: 40, energy: 90, hygiene: 90, fun: 60, social: 60 } });
	const r = applyAction(s, WA, EAT);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.story.done.meal, 1);
	const bad = applyAction(s, WA, { t: 'activity', id: 'work-mine' });
	assert.equal(bad.ok, false);
	assert.equal(bad.state.story.done.meal, undefined);
});

test('存档清洗：章号钳在 0 到章数之间并取整；只留当前章认识的目标，次数取整并不超过要求', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const clean = (story: unknown) => sanitizeState({ ...make(), story }, locs, { fallbackLoc: 'perth', now: Date.now() })!.story;
	assert.deepEqual(clean(undefined), { ch: 0, done: {} });
	assert.deepEqual(clean({ ch: 999, done: { meal: 1 } }), { ch: STORY.length, done: {} });
	assert.deepEqual(clean({ ch: -2.5, done: {} }), { ch: 0, done: {} });
	assert.deepEqual(clean({ ch: 0.9, done: { meal: 7.8, chat: 1.5, hax: 3, freo: -1, constructor: 1 } }), { ch: 0, done: { meal: 1, chat: 1 } });
	assert.deepEqual(clean('x'), { ch: 0, done: {} });
});

test('第二章：进章时已经满足的状态目标马上记下；结束上一章的那个动作不会再算进下一章', () => {
	const job = { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 };
	let s = make({ cash: 900, job });
	for (const a of [EAT, CHAT, CHAT, BUY]) s = step(s, a).after;
	// 用一次上班结束第一章（顺便去够了地点）
	const WORK: GameAction = { t: 'job', op: 'work' };
	const r = step(s, WORK, (x) => { x.visited.fremantle = 1; x.visited.rottnest = 1; });
	assert.equal(r.after.story.ch, 1);
	assert.equal(r.after.story.done.job, 1, '已经有工作，马上记下');
	assert.equal(r.after.story.done.savings, 1, '现金已经过 $500');
	assert.equal(r.after.story.done.shifts, undefined, '结束第一章的那个班不算进第二章');
	// 之后的班一个个算
	let t = r.after;
	for (let i = 0; i < 7; i++) t = step(t, WORK).after;
	assert.equal(t.story.done.shifts, 5, '上满 5 个就封顶');
});

test('第二章全部做到：发奖励，主线全部写完', () => {
	const ch = STORY.findIndex((c) => c.id === 'steady');
	const job = { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 };
	let s = make({ story: { ch, done: { shifts: 5, sleep: 1 } }, job, cash: 600 });
	const before = s.cash;
	const r = step(s, EAT, (x) => {
		x.home = { type: 'room', loc: 'perth', furniture: {} };
		x.relations[NPCS[0].id] = { score: 30, last: {}, seen: [], known: [] };
	});
	assert.deepEqual(r.notes, [`${STORY[ch].title} 完成`]);
	assert.equal(r.after.cash, before + (STORY[ch].reward.cash ?? 0));
	assert.equal(r.after.story.ch, ch + 1);
	s = r.after;
	assert.equal(s.story.ch, STORY.length, '目前一共两章');
});
