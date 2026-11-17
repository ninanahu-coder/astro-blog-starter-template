// 每日摘要（第 27 轮）：存档里记下「今天开始时」的现金、声望、到过几个地方；
// 动作跨过午夜时，算出上一段日子的变化存成 yday，界面在今天页显示「昨天回顾」。纯函数，只改传进来的新存档。
import { dayOf } from './time.ts';
import type { PlayerState } from './types.ts';

export interface DayMark { day: number; cash: number; respect: number; places: number }
export interface DayRecap { day: number; days: number; cash: number; respect: number; places: number }

const placesOf = (s: Pick<PlayerState, 'visited'>) => Object.values(s.visited).filter((n) => n > 0).length;

/** 现在这一刻作为「今天开始」的记号 */
export const markOf = (s: Pick<PlayerState, 'clock' | 'cash' | 'respect' | 'visited'>): DayMark => ({ day: dayOf(s.clock), cash: s.cash, respect: s.respect, places: placesOf(s) });

/**
 * 跨日结账：after 已经跨过午夜就把 dayMark 那天起到现在的变化记进 yday，再把记号换成新的一天。
 * 一个动作跨好几天（晕倒住院、长途旅行）时 days > 1，界面写「过去 N 天」。没跨日什么也不做。
 * 返回是否换了日子。
 */
export function rollDay(after: PlayerState): boolean {
	const today = dayOf(after.clock);
	const m = after.dayMark;
	if (today <= m.day) return false;
	after.yday = { day: m.day, days: today - m.day, cash: after.cash - m.cash, respect: after.respect - m.respect, places: Math.max(0, placesOf(after) - m.places) };
	after.dayMark = markOf(after);
	return true;
}

/** 昨天回顾要不要显示：只在 yday 结束后的那一天显示（再过一天就过时了） */
export function recapFor(s: PlayerState): DayRecap | null {
	const y = s.yday;
	return y && y.day + y.days === dayOf(s.clock) ? y : null;
}

/** 那段日子的日志（按游戏时钟落在那几天里的条目），最多 n 条，取最后的 */
export function recapLog(s: PlayerState, y: DayRecap, n = 6) {
	const from = y.day * 1440;
	const to = (y.day + y.days) * 1440;
	return s.journal.filter((j) => j.t >= from && j.t < to).slice(-n);
}
