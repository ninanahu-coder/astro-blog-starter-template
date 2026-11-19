// 留学生签证工时：纯函数，只读数据和 PlayerState（logWork 原地修改调用方已经复制的存档）。
// 规则和现实出处见 data/education.ts 的 VISA 注释和 docs/earth-game/education-career.md 第 3 节。
import { PROGRAMS, VISA } from '../data/education.ts';
import { dayOf } from './time.ts';
import type { PlayerState } from './types.ts';

/** 游戏时钟所在的「两周」序号 */
export const fortnightOf = (clock: number) => Math.floor(dayOf(clock) / VISA.periodDays);

/** 正在读的学历课程（上过、没上完、最近 inSessionDays 天内上过课） */
export function inSession(state: PlayerState): boolean {
	const today = dayOf(state.clock);
	return PROGRAMS.some((p) => {
		const st = state.study[p.id];
		return !!st && st.n > 0 && st.n < p.sessions && today - st.day <= VISA.inSessionDays;
	});
}

/** 现在受不受签证工时限制 */
export const visaCapped = (state: PlayerState) => state.origin === VISA.origin && inSession(state);

/** 这两周已经算进签证工时的分钟数 */
export const workedMinutes = (state: PlayerState) => (state.workLog.f === fortnightOf(state.clock) ? state.workLog.min : 0);

/** 这两周还能上多少分钟班；不受限制时返回 null */
export function workMinutesLeft(state: PlayerState): number | null {
	return visaCapped(state) ? Math.max(0, VISA.capHours * 60 - workedMinutes(state)) : null;
}

/** 再上 minutes 分钟班会不会超签证工时；会的话返回原因 */
export function visaBlocked(state: PlayerState, minutes: number): string | undefined {
	const left = workMinutesLeft(state);
	if (left === null || minutes <= left) return undefined;
	return `学生签证学期内每两周最多打工 ${VISA.capHours} 小时（这两周已打 ${Math.round(workedMinutes(state) / 6) / 10} 小时）`;
}

/** 记一段上班时间（不管受不受限都记，方便中途开始读书时接着算）。原地修改 */
export function logWork(state: PlayerState, minutes: number, clock: number) {
	const f = fortnightOf(clock);
	state.workLog = { f, min: (state.workLog.f === f ? state.workLog.min : 0) + minutes };
}
