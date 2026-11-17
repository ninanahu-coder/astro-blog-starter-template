// 主线剧情的判定与结算（数据见 data/story.ts）。不用随机数。
import { STORY, type StoryChapter, type StoryCheck, type StoryStep } from '../data/story.ts';
import type { GameAction } from './actions.ts';
import { addLog, addMoodlet } from './engine.ts';
import type { PlayerState } from './types.ts';
import { wishMatches } from './wishes.ts';

export const STORY_DONE_MAX = 20; // 一章最多几个目标（存档清洗用）

/** 当前章；全部写完返回 null */
export const currentChapter = (state: PlayerState): StoryChapter | null => STORY[state.story.ch] ?? null;

export const stepNeed = (step: StoryStep): number => step.n ?? 1;

function stateMet(state: PlayerState, c: StoryCheck): boolean {
	switch (c.t) {
		case 'visited': return (state.visited[c.loc] ?? 0) > 0;
		case 'places': return Object.keys(state.visited).length >= c.n;
		case 'job': return !!state.job;
		case 'home': return !!state.home;
		case 'cash': return state.cash >= c.n;
		case 'friend': return Object.values(state.relations).some((r) => r.score >= c.score);
	}
}

/** 当前章每个目标的进度（界面用） */
export function storyProgress(state: PlayerState): { chapter: StoryChapter; index: number; steps: { step: StoryStep; got: number; need: number }[] } | null {
	const chapter = currentChapter(state);
	if (!chapter) return null;
	return {
		chapter,
		index: state.story.ch,
		steps: chapter.steps.map((step) => ({ step, got: Math.min(stepNeed(step), state.story.done[step.id] ?? 0), need: stepNeed(step) })),
	};
}

/**
 * 成功的动作之后调用（途中晕倒不算）：记下这次动作推进的目标，做满一章就发奖励、进下一章。
 * 新的一章开头的状态目标也会马上判断（比如进第二章时已经有工作了）。原地修改 after，返回提示文字。
 */
export function settleStory(before: PlayerState, after: PlayerState, a: GameAction): string[] {
	const notes: string[] = [];
	let first = true;
	for (let guard = 0; guard < STORY.length; guard++) {
		const ch = currentChapter(after);
		if (!ch) break;
		for (const step of ch.steps) {
			const got = after.story.done[step.id] ?? 0;
			const need = stepNeed(step);
			if (got >= need) continue;
			let next = got;
			if (step.state && stateMet(after, step.state)) next = need;
			// 动作只算在它发生时的那一章：刚进下一章时，不把同一个动作再算一次
			else if (first && step.act && wishMatches({ id: step.id, text: step.text, done: step.act, venue: step.venue }, a, before, after)) next = got + 1;
			if (next !== got) after.story.done[step.id] = Math.min(need, next);
		}
		if (!ch.steps.every((s) => (after.story.done[s.id] ?? 0) >= stepNeed(s))) break;
		// 本章完成：奖励直接入账（不花时间，不经过周结算）
		const fx = ch.reward;
		if (fx.cash) after.cash = Math.round(after.cash + fx.cash);
		if (fx.respect) after.respect += fx.respect;
		if (fx.moodlet) addMoodlet(after, fx.moodlet);
		after.story = { ch: after.story.ch + 1, done: {} };
		const msg = `📖 ${ch.title} 完成：${ch.outro}${fx.cash ? ` +$${fx.cash}` : ''}${fx.respect ? `，声望 +${fx.respect}` : ''}`;
		addLog(after, msg);
		notes.push(`${ch.title} 完成`);
		first = false;
	}
	return notes;
}
