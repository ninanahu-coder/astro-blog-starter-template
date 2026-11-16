// 全服周目标的规则（纯函数）。全服累计数由服务端保存；玩家自己出了几份力、领没领奖记在存档的 weekly 里。
import { addLog, clone } from './engine.ts';
import type { ActionResult, PlayerState } from './types.ts';
import { WEEKLY_GOALS } from '../data/weekly.ts';

export type WeeklyMetric = 'coop' | 'trade' | 'experience' | 'travel';

export interface WeeklyGoal {
	id: string;
	icon: string;
	title: string;
	desc: string;
	metric: WeeklyMetric;
	target: number;
	reward: { cash: number; respect: number };
}

/** 现实周序号（按珀斯时间的现实日 ÷ 7） */
export const weekOf = (realDay: number) => Math.floor(realDay / 7);
/** 这周还剩几天（含今天） */
export const weekDaysLeft = (realDay: number) => 7 - (((realDay % 7) + 7) % 7);
/** 这周的目标：按周序号轮换 */
export const goalOfWeek = (week: number): WeeklyGoal => WEEKLY_GOALS[((week % WEEKLY_GOALS.length) + WEEKLY_GOALS.length) % WEEKLY_GOALS.length];

/** 我这周出了几份力、领没领 */
export function weeklyMine(state: PlayerState, week: number): { n: number; claimed: boolean } {
	const w = state.weekly;
	return w && w.week === week ? { n: w.n, claimed: w.claimed } : { n: 0, claimed: false };
}

/** 记一份力（跨周自动归零）。返回新存档，不改入参 */
export function addWeekly(state: PlayerState, week: number, k = 1): PlayerState {
	const m = weeklyMine(state, week);
	return { ...state, weekly: { week, n: m.n + k, claimed: m.claimed } };
}

/** 能不能领：全服达成、我出过力、这周没领过 */
export function weeklyBlocked(state: PlayerState, week: number, count: number): string | undefined {
	const goal = goalOfWeek(week);
	const m = weeklyMine(state, week);
	if (m.claimed) return '这周的奖励已经领过了。';
	if (count < goal.target) return `全服还差 ${goal.target - count} 次。`;
	if (m.n < 1) return '这周还没出过力，先去做一次吧。';
	return undefined;
}

/** 领奖（调用方负责版本号加一和数值钳制） */
export function claimWeekly(prev: PlayerState, week: number, count: number): ActionResult {
	const why = weeklyBlocked(prev, week, count);
	if (why) return { ok: false, state: prev, msg: why };
	const goal = goalOfWeek(week);
	const state = clone(prev);
	state.cash += goal.reward.cash;
	state.respect += goal.reward.respect;
	state.weekly = { week, n: weeklyMine(prev, week).n, claimed: true };
	const msg = `${goal.icon} 全服周目标「${goal.title}」达成，领到 $${goal.reward.cash}，声望 +${goal.reward.respect}。`;
	addLog(state, msg);
	return { ok: true, state, msg };
}
