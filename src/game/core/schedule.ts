// 今日日程（第 43 批）：把「今天要上的班」「该睡了没有」排成一张表，并在做一件耗时的事之前提醒会不会错过。
// 只读、只提示：不拦动作（上班窗口、营业时间照旧由各自的规则把关）。纯函数，设计见 docs/earth-game/time-sleep.md §3。
import { SLEEP } from '../data/sleep.ts';
import { CAREERS } from '../data/careers.ts';
import { awakeMinutes, debtNow, minutesToLate } from './sleep.ts';
import { dayOf, hourOf, hoursLabel, isOpen } from './time.ts';
import type { PlayerState, Region } from './types.ts';

export type AgendaStatus = 'done' | 'now' | 'later' | 'missed';

export interface AgendaItem {
	kind: 'work' | 'sleep';
	icon: string;
	title: string;
	/** 时间说明，如「6:00–11:00 开工」 */
	when: string;
	status: AgendaStatus;
	/** 补充说明（在哪、欠多少觉） */
	note?: string;
}

const h1 = (min: number) => Math.round((min / 60) * 10) / 10;

/** 今天这一班的状态：上过了 / 现在能开工 / 还没到点 / 窗口已经过了 */
export function shiftStatus(state: PlayerState): AgendaStatus | null {
	const job = state.job;
	const c = job && CAREERS.find((x) => x.id === job.career);
	if (!job || !c) return null;
	if (job.lastDay === dayOf(state.clock)) return 'done';
	if (isOpen(c.start, state.clock)) return 'now';
	const [open, close] = c.start;
	const h = hourOf(state.clock);
	// 窗口不跨午夜：还没到开工点是「稍后」；跨午夜的窗口（[22, 2] 这类）关着时一定是在等今晚开工
	return open < close ? (h < open ? 'later' : 'missed') : 'later';
}

/** 今天的日程：上班（有工作时）+ 睡觉 */
export function agenda(state: PlayerState, region: Region): AgendaItem[] {
	const items: AgendaItem[] = [];
	const job = state.job;
	const c = job && CAREERS.find((x) => x.id === job.career);
	const st = shiftStatus(state);
	if (job && c && st) {
		const where = job.loc === state.loc ? undefined : `在${region.locations.find((l) => l.id === job.loc)?.name ?? '别处'}`;
		items.push({ kind: 'work', icon: '💼', title: `${c.name}上班（${Math.round(c.minutes / 60)} 小时）`, when: `${hoursLabel(c.start)} 开工`, status: st, note: where });
	}
	const awake = awakeMinutes(state);
	const debt = debtNow(state);
	const late = minutesToLate(state);
	const [n0, n1] = SLEEP.nightHours;
	items.push({
		kind: 'sleep',
		icon: '🛏️',
		title: '睡觉',
		when: `${n0}:00–${n1}:00 入睡算按时`,
		status: late > 0 ? 'later' : 'now',
		note: `已经醒了 ${h1(awake)} 小时${late > 0 ? `，再过 ${h1(late)} 小时算熬夜` : '，在熬夜'}${debt > 0 ? `；欠觉 ${debt} 小时` : ''}`,
	});
	return items;
}

/**
 * 做一件要 minutes 分钟的事之前的提醒（不拦）：
 * - 今天的班还没上、开工窗口还开着或没到，做完就过了窗口 → 提醒会错过；
 * - 做完就醒了超过 awakeOkMinutes → 提醒开始熬夜。
 * 没有要提醒的返回 undefined。
 */
export function timeConflict(state: PlayerState, minutes: number): string | undefined {
	if (!(minutes > 0)) return undefined;
	const out: string[] = [];
	const job = state.job;
	const c = job && CAREERS.find((x) => x.id === job.career);
	const st = shiftStatus(state);
	if (c && (st === 'now' || st === 'later') && c.start[0] < c.start[1]) {
		const closeAt = dayOf(state.clock) * 1440 + c.start[1] * 60;
		if (state.clock < closeAt && state.clock + minutes >= closeAt) out.push(`做完就过了 ${c.start[1]}:00，赶不上今天${c.name}的班`);
	}
	const late = minutesToLate(state);
	if (late > 0 && minutes >= late) out.push('做完就开始熬夜了');
	return out.length ? out.join('；') : undefined;
}
