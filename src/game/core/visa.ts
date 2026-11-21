// 留学生签证工时：纯函数，只读数据和 PlayerState（logWork 原地修改调用方已经复制的存档）。
// 规则和现实出处见 data/education.ts 的 VISA 注释和 docs/earth-game/education-career.md 第 3 节。
import { PROGRAMS, VISA } from '../data/education.ts';
import { dayOf } from './time.ts';
import type { PlayerState } from './types.ts';

// ---------- 签证状态（签证路线，第 43 批，合并 main 时从 core/immigration.ts 挪过来：engine 的上班、零工判断也要用） ----------
type VisaKindLike = NonNullable<PlayerState['visa']>['kind'];
/** 会到期的临时签证 */
export const isTemporary = (k: VisaKindLike) => k === 'student' || k === 'graduate' || k === 'graduate2' || k === 'sponsored' || k === 'regional';

/** 还剩几天到期（到期日当天算 0）；不会到期、或老存档没有签证记录时返回 null */
export function daysLeft(s: PlayerState): number | null {
	return s.visa && isTemporary(s.visa.kind) ? s.visa.until - dayOf(s.clock) : null;
}

/** 实际状态：临时签证过了到期日就算过期（存档里的 kind 要等下一个动作结算时才改） */
export function visaKindNow(s: PlayerState): VisaKindLike {
	const left = daysLeft(s);
	return left !== null && left < 0 ? 'expired' : (s.visa?.kind ?? 'none');
}

/** 现在能不能合法工作。none（本地人等）和 PR 都能；过期不能 */
export const canWork = (s: PlayerState) => visaKindNow(s) !== 'expired';

/** 签证过期时的提示（上班、零工、真实地点打卡、应聘都用这一句） */
export const VISA_EXPIRED_MSG = '签证已过期，不能工作。去「我」页重新申请签证。';

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

/**
 * 现在受不受签证工时限制：持学生签证、并且在读学历课程。
 * 合并签证路线（第 43 批，docs/earth-game/visa.md §3.7）后：拿到 485、482、永居之后不再限；老存档没有 visa 字段时按出身判断。
 */
export const visaCapped = (state: PlayerState) => (state.visa ? visaKindNow(state) === 'student' : state.origin === VISA.origin) && inSession(state);

/** 这两周已经算进签证工时的分钟数 */
export const workedMinutes = (state: PlayerState) => (state.workLog.f === fortnightOf(state.clock) ? state.workLog.min : 0);

/** 这两周还能上多少分钟班；不受限制时返回 null */
export function workMinutesLeft(state: PlayerState): number | null {
	return visaCapped(state) ? Math.max(0, VISA.capHours * 60 - workedMinutes(state)) : null;
}

/** 再上 minutes 分钟班会不会超签证工时；会的话返回原因 */
export function visaBlocked(state: PlayerState, minutes: number): string | undefined {
	if (!canWork(state)) return VISA_EXPIRED_MSG; // 签证过期（第 43 批）：上班、雇佣性质的零工都不行，界面提前置灰
	const left = workMinutesLeft(state);
	if (left === null || minutes <= left) return undefined;
	return `学生签证学期内每两周最多打工 ${VISA.capHours} 小时（这两周已打 ${Math.round(workedMinutes(state) / 6) / 10} 小时）`;
}

/** 记一段上班时间（不管受不受限都记，方便中途开始读书时接着算）。原地修改 */
export function logWork(state: PlayerState, minutes: number, clock: number) {
	const f = fortnightOf(clock);
	state.workLog = { f, min: (state.workLog.f === f ? state.workLog.min : 0) + minutes };
}
