// 每日奖励：按现实日期计。现实日期由服务端算好传进来，这里保持纯函数。
import { JOURNAL_MAX } from './character.ts';
import type { PlayerState } from './types.ts';

export const DAILY = {
	base: 30, // 连续第 1 天
	step: 10, // 连续每多一天多给
	cap: 7, // 金额按连续天数增长，到第 7 天封顶
	bonus: 150, // 每连续满 7 天当天的额外奖励
	bonusRespect: 2,
	tzOffsetHours: 8, // 以珀斯时间（UTC+8）的 0 点为一天的分界
};

/** 现实时间戳 → 现实日序号（珀斯时间） */
export const realDayOf = (nowMs: number) => Math.floor((nowMs + DAILY.tzOffsetHours * 3_600_000) / 86_400_000);

export interface DailyClaim {
	state: PlayerState;
	cash: number;
	streak: number;
	msg: string;
}

/** 今天还没领就发奖励并更新连续天数；已经领过返回 null。不修改入参 */
export function claimDaily(prev: PlayerState, realDay: number): DailyClaim | null {
	if (!Number.isInteger(realDay) || prev.daily.day >= realDay) return null;
	const streak = prev.daily.day === realDay - 1 ? prev.daily.streak + 1 : 1;
	const full = streak % DAILY.cap === 0;
	const cash = DAILY.base + DAILY.step * (Math.min(streak, DAILY.cap) - 1) + (full ? DAILY.bonus : 0);
	const msg = `每日奖励 $${cash}（连续 ${streak} 天${full ? '，满 7 天大礼' : ''}）`;
	const state: PlayerState = {
		...prev,
		cash: prev.cash + cash,
		respect: prev.respect + (full ? DAILY.bonusRespect : 0),
		daily: { day: realDay, streak },
		journal: [...prev.journal, { t: prev.clock, text: msg + '。' }].slice(-JOURNAL_MAX),
		rev: prev.rev + 1,
	};
	return { state, cash, streak, msg };
}
