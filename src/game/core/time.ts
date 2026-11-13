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
