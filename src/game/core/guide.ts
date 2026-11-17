// 新手指南进度（第 26 轮）：纯函数，界面只负责显示。
import { GUIDE_STEPS, type GuideStep } from '../data/guide.ts';
import { START_CLOCK } from './character.ts';
import type { PlayerState } from './types.ts';

export const GUIDE_DAYS = 3;

export interface GuideView {
	day: number; // 现在解开到第几组（1–3）
	steps: (Omit<GuideStep, 'done'> & { done: boolean })[]; // 已解开的步骤（前面没做完的也留着）
	current: string | null; // 该做的下一步
	done: number;
	total: number;
	next: string | null; // 下一组的预告（还没解开时）
}

/**
 * 前三天显示；过了第三天、或者九步都做完就不显示（返回 null）。
 * 解开规则：到了第 N 天解开第 N 组；前面各组都做完也会提前解开下一组。
 */
export function guideView(s: PlayerState): GuideView | null {
	const all = GUIDE_STEPS.map((g) => ({ ...g, done: g.done(s, START_CLOCK) }));
	const doneN = all.filter((g) => g.done).length;
	const gameDay = Math.floor(s.clock / 1440) - Math.floor(START_CLOCK / 1440) + 1;
	if (doneN === all.length || gameDay > GUIDE_DAYS) return null;
	let day = Math.max(1, gameDay);
	while (day < GUIDE_DAYS && all.filter((g) => g.day <= day).every((g) => g.done)) day++;
	const steps = all.filter((g) => g.day <= day);
	const upcoming = all.filter((g) => g.day === day + 1);
	return {
		day,
		steps,
		current: steps.find((g) => !g.done)?.id ?? null,
		done: doneN,
		total: all.length,
		next: upcoming.length ? upcoming.map((g) => g.title).join('、') : null,
	};
}
