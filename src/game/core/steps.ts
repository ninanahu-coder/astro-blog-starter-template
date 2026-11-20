// 主线和支线共用的目标判定（第 28 批从 core/story.ts 抽出来）。纯函数，不用随机数。
// 目标分两种：状态目标（看存档现在的样子）和动作目标（这次动作算不算一次，规则同心愿）。
import type { StoryCheck, StoryStep } from '../data/story.ts';
import type { GameAction } from './actions.ts';
import type { PlayerState } from './types.ts';
import { wishMatches } from './wishes.ts';

export const stepNeed = (step: StoryStep): number => step.n ?? 1;

/** 状态条件现在是否成立 */
export function checkMet(state: PlayerState, c: StoryCheck): boolean {
	switch (c.t) {
		case 'visited': return (state.visited[c.loc] ?? 0) > 0;
		case 'places': return Object.keys(state.visited).length >= c.n;
		case 'job': return !!state.job;
		case 'home': return !!state.home;
		case 'cash': return state.cash >= c.n;
		case 'friend': return Object.values(state.relations).some((r) => r.score >= c.score);
		case 'npc': return (state.relations[c.npc]?.score ?? 0) >= c.score;
		case 'chapter': return state.story.ch >= c.n;
		case 'side': return state.side.done.includes(c.id);
		case 'checkins': return state.checkins.length >= c.n;
		case 'dex': return state.dex.length >= c.n;
		case 'fishKinds': return Object.keys(state.fish).length >= c.n;
	}
}

/** 这次动作算不算这个动作目标的一次 */
export function stepActMatches(step: StoryStep, a: GameAction, before: PlayerState, after: PlayerState): boolean {
	if (!step.act) return false;
	if (step.at) {
		// 限定地点：真实地点动作不算（真实地点和游戏地点不是一回事），动作开始时得在这个地点
		if (a.t === 'venue' || before.loc !== step.at) return false;
	}
	return wishMatches({ id: step.id, text: step.text, done: step.act, venue: step.at ? undefined : step.venue }, a, before, after);
}

/**
 * 按这次动作推进一组目标，返回新的进度表（不改入参）。
 * countActs=false 时只看状态目标：比如支线刚在这次动作里解锁，这个动作不算进支线。
 */
export function advanceSteps(steps: StoryStep[], done: Record<string, number>, before: PlayerState, after: PlayerState, a: GameAction, countActs: boolean): Record<string, number> {
	const out = { ...done };
	for (const step of steps) {
		const got = out[step.id] ?? 0;
		const need = stepNeed(step);
		if (got >= need) continue;
		let next = got;
		if (step.state && checkMet(after, step.state)) next = need;
		else if (countActs && stepActMatches(step, a, before, after)) next = got + 1;
		if (next !== got) out[step.id] = Math.min(need, next);
	}
	return out;
}

export const stepsDone = (steps: StoryStep[], done: Record<string, number>): boolean => steps.every((s) => (done[s.id] ?? 0) >= stepNeed(s));
