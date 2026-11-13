// 游戏时钟：state.clock 是从第 1 天 00:00 起的分钟数（开局为 08:00）。
import type { Hours } from './types.ts';

export const hourOf = (clock: number) => Math.floor((clock % 1440) / 60);
export const dayOf = (clock: number) => Math.floor(clock / 1440);

export interface Period {
	id: 'dawn' | 'day' | 'dusk' | 'night';
	name: string;
}

/** 时段：清晨 5–8，白天 8–17，傍晚 17–20，夜晚 20–5 */
export function period(clock: number): Period {
	const h = hourOf(clock);
	if (h >= 5 && h < 8) return { id: 'dawn', name: '清晨' };
	if (h >= 8 && h < 17) return { id: 'day', name: '白天' };
	if (h >= 17 && h < 20) return { id: 'dusk', name: '傍晚' };
	return { id: 'night', name: '夜晚' };
}

/** [开, 关) 小时；关 ≤ 开 表示跨午夜（如 [20, 6]）；不写表示全天 */
export function isOpen(hours: Hours | undefined, clock: number): boolean {
	if (!hours) return true;
	const [open, close] = hours;
	const h = hourOf(clock);
	return open < close ? h >= open && h < close : h >= open || h < close;
}

export const hoursLabel = (hours: Hours) => `${hours[0]}:00–${hours[1] % 24}:00`;

// ---------- 日历：一年四季，每季 28 天 ----------
export const SEASON_DAYS = 28;
export const SEASONS = [
	{ id: 'spring', name: '春' },
	{ id: 'summer', name: '夏' },
	{ id: 'autumn', name: '秋' },
	{ id: 'winter', name: '冬' },
] as const;
export type SeasonId = (typeof SEASONS)[number]['id'];
export const YEAR_DAYS = SEASON_DAYS * SEASONS.length;

export interface GameDate {
	year: number; // 从 1 开始
	season: SeasonId;
	seasonName: string;
	day: number; // 季内第几天，1–28
	dayOfYear: number; // 0–111
}

/** 游戏第 1 天是第 1 年春季第 1 天 */
export function dateOf(clock: number): GameDate {
	const d = dayOf(clock);
	const dayOfYear = ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
	const s = SEASONS[Math.floor(dayOfYear / SEASON_DAYS)];
	return { year: Math.floor(d / YEAR_DAYS) + 1, season: s.id, seasonName: s.name, day: (dayOfYear % SEASON_DAYS) + 1, dayOfYear };
}

export const dateLabel = (clock: number) => {
	const d = dateOf(clock);
	return `${d.seasonName}季第 ${d.day} 天`;
};

/** 某个“季 + 日”起、持续 days 天的时间段，今天是否在其中；以及距离下次开始还有几天（进行中为 0） */
export function inSpan(clock: number, season: SeasonId, day: number, days: number): { active: boolean; startsIn: number } {
	const start = SEASONS.findIndex((s) => s.id === season) * SEASON_DAYS + (day - 1);
	const offset = (dateOf(clock).dayOfYear - start + YEAR_DAYS) % YEAR_DAYS;
	const active = offset < days;
	return { active, startsIn: active ? 0 : YEAR_DAYS - offset };
}
