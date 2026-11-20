// 现实活动（第 24 批）：跟真实日历同步的节日和公众假期。纯函数：现实时间 now（毫秒）一律由调用方传入（服务端用自己的时钟）。
//
// 时区：
// - 西澳（珀斯）全年 UTC+8，不实行夏令时。
// - 南澳（阿德莱德）标准时间 UTC+9:30；夏令时 UTC+10:30，
//   从 10 月第一个星期日标准时间 2:00 起，到次年 4 月第一个星期日夏令时 3:00 止
//   （Daylight Saving Regulations 2024 (SA) 第 4 条：
//   https://www.legislation.sa.gov.au/_legislation-documents/lz/c/r/daylight-saving-regulations-2024/current/2024.74.un.rtf）。
//   两个切换点换算成 UTC 都是那个星期日的前一天 16:30。
//
// 和游戏时钟的关系：游戏时钟（state.clock）跟着动作走，和现实时间没有固定比例；现实活动只看现实时间，不看游戏日历。
// 游戏日历里的节日（festivals.ts）照旧按游戏的季和日走，两套互不影响。
import { addLog, addMoodlet, clone, getLocation } from './engine.ts';
import { areaOf } from '../data/areas-base.ts';
import { LIVE_ID_RE, LIVE_MAX } from './character.ts';
import { LIVE_EVENTS } from '../data/live-events.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

export type LiveArea = 'wa' | 'sa';

/** 一段上线时间：当地时间 'YYYY-MM-DDTHH:MM'，start 含、end 不含 */
export interface LiveSpan {
	start: string;
	end: string;
}

export interface LiveEventDef {
	id: string;
	kind: 'festival' | 'holiday';
	area: LiveArea;
	/** 绑定的游戏地点；不写表示整个州（公众假期） */
	loc?: string;
	name: string;
	en?: string;
	spans: LiveSpan[];
	desc: string;
	/** 官方来源网址 */
	source: string;
	/** 核对日期 */
	checked: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const AREA_TZ: Record<LiveArea, { name: string; label: string }> = {
	wa: { name: 'Australia/Perth', label: '珀斯时间' },
	sa: { name: 'Australia/Adelaide', label: '阿德莱德时间' },
};

/** 某年某月（0 起）第一个星期日的 UTC 0 点（毫秒） */
export function firstSundayUtc(year: number, month: number): number {
	const first = Date.UTC(year, month, 1);
	const dow = new Date(first).getUTCDay(); // 0 = 星期日
	return first + ((7 - dow) % 7) * DAY;
}

/** 南澳在这一刻是不是夏令时 */
export function adelaideDst(utcMs: number): boolean {
	const y = new Date(utcMs).getUTCFullYear();
	// 当地 10 月第一个星期日 2:00 ACST（UTC+9:30）= UTC 前一天 16:30；4 月第一个星期日 3:00 ACDT（UTC+10:30）同样是 UTC 前一天 16:30
	const start = firstSundayUtc(y, 9) + 2 * HOUR - 9.5 * HOUR;
	const end = firstSundayUtc(y, 3) + 3 * HOUR - 10.5 * HOUR;
	return utcMs >= start || utcMs < end;
}

/** 这一刻当地比 UTC 快多少分钟 */
export function tzOffsetMin(area: LiveArea, utcMs: number): number {
	if (area === 'wa') return 8 * 60;
	return adelaideDst(utcMs) ? 10.5 * 60 : 9.5 * 60;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 当地时间 'YYYY-MM-DDTHH:MM' → UTC 毫秒。格式不对返回 NaN。夏令时切换的那一小时里不存在或重复的钟点按切换后的偏移算（数据里不放这种时刻） */
export function localToUtc(area: LiveArea, local: string): number {
	const m = LOCAL_RE.exec(local);
	if (!m) return NaN;
	const [y, mo, d, h, mi] = m.slice(1).map(Number);
	const naive = Date.UTC(y, mo - 1, d, h, mi);
	if (new Date(naive).getUTCMonth() !== mo - 1 || h > 23 || mi > 59) return NaN;
	// 先按标准时间猜一次，再用猜出的时刻的偏移修正
	const guess = naive - tzOffsetMin(area, naive - 9.5 * HOUR) * MIN;
	return naive - tzOffsetMin(area, guess) * MIN;
}

/** UTC 毫秒 → 当地日期和钟点 */
export function localParts(area: LiveArea, utcMs: number): { date: string; hour: number; minute: number } {
	const t = new Date(utcMs + tzOffsetMin(area, utcMs) * MIN);
	const p = (n: number) => String(n).padStart(2, '0');
	return { date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`, hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

export interface LiveStatus {
	event: LiveEventDef;
	active: boolean;
	/** 都过去了 */
	ended: boolean;
	/** 进行中：这一段还有多久下线；没开始：多久后上线；结束了：0 */
	startsInMs: number;
	endsInMs: number;
}

/** 某个活动在 now 这一刻的状态 */
export function liveStatus(ev: LiveEventDef, now: number): LiveStatus {
	let active = false;
	let startsInMs = Infinity;
	let endsInMs = 0;
	let anyFuture = false;
	for (const s of ev.spans) {
		const a = localToUtc(ev.area, s.start);
		const b = localToUtc(ev.area, s.end);
		if (!(a < b)) continue;
		if (now >= a && now < b) {
			active = true;
			endsInMs = Math.max(endsInMs, b - now);
		}
		if (b > now) anyFuture = true;
		if (a > now) startsInMs = Math.min(startsInMs, a - now);
	}
	return { event: ev, active, ended: !anyFuture, startsInMs: active ? 0 : Number.isFinite(startsInMs) ? startsInMs : 0, endsInMs };
}

/** 现在进行中的活动，和 horizonDays 天内要开始的（进行中的在前，其余按开始先后） */
export function liveCalendar(now: number, horizonDays = 30, events: LiveEventDef[] = LIVE_EVENTS): LiveStatus[] {
	return events
		.map((e) => liveStatus(e, now))
		.filter((s) => s.active || (!s.ended && s.startsInMs <= horizonDays * DAY))
		.sort((a, b) => Number(b.active) - Number(a.active) || a.startsInMs - b.startsInMs);
}

export const getLiveEvent = (id: string) => LIVE_EVENTS.find((e) => e.id === id);

/** 到场纪念的奖励（待平衡）：艺术节在指定地点，公众假期在同一个州任何地点 */
export const LIVE_REWARD = {
	festival: { fun: 20, respect: 3 }, // 待平衡
	holiday: { fun: 10, respect: 1 }, // 待平衡
};
export { LIVE_ID_RE, LIVE_MAX };

/** 能不能领这个活动的到场纪念；能领返回 undefined */
export function liveBlocked(state: PlayerState, region: Region, ev: LiveEventDef | undefined, now: number): string | undefined {
	if (!ev) return '没有这个活动。';
	if (state.pending) return '先处理眼前的事。';
	const st = liveStatus(ev, now);
	if (!st.active) return st.ended ? '这个活动已经结束了。' : '活动还没开始。';
	if ((state.live ?? []).includes(ev.id)) return '这次活动的纪念已经领过了。';
	if (ev.loc) {
		if (state.loc !== ev.loc) return `要在${getLocation(region, ev.loc)?.name ?? '活动地点'}才能参加。`;
	} else if (areaOf(state.loc)?.id !== ev.area) return `要在${ev.area === 'wa' ? '西澳' : '南澳'}才能参加。`;
	return undefined;
}

/** 领到场纪念：加娱乐和声望、节日气氛，记进存档。不修改入参（版本号和钳制由 applyAction 统一做） */
export function claimLive(prev: PlayerState, region: Region, id: string, now: number): ActionResult {
	const ev = getLiveEvent(id);
	const why = liveBlocked(prev, region, ev, now);
	if (why) return { ok: false, state: prev, msg: why };
	const r = LIVE_REWARD[ev!.kind];
	const state = clone(prev);
	state.needs.fun = Math.min(100, state.needs.fun + r.fun);
	state.respect += r.respect;
	state.live = [...(state.live ?? []).filter((x) => x !== ev!.id), ev!.id].slice(-LIVE_MAX);
	addMoodlet(state, 'festival');
	const msg = `${ev!.kind === 'festival' ? '🎪' : '🎉'} 赶上了现实里的「${ev!.name}」：娱乐 +${r.fun}，声望 +${r.respect}。`;
	addLog(state, msg);
	return { ok: true, state, msg };
}

/** 日期标签（当地时间）：「2月5日–2月28日」「12月25日、12月27日」「12月24日 19:00–24:00」 */
export function liveDateLabel(ev: LiveEventDef): string {
	const md = (s: string) => `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
	return ev.spans.map((sp) => {
		const a = localToUtc(ev.area, sp.start);
		const b = localToUtc(ev.area, sp.end);
		const lastDay = localParts(ev.area, b - 1).date; // end 不含：最后一天是 end 前一分钟所在的日子
		const fullDays = sp.start.endsWith('T00:00') && sp.end.endsWith('T00:00');
		if (fullDays) return lastDay === sp.start.slice(0, 10) ? md(sp.start) : `${md(sp.start)}–${md(lastDay)}`;
		const endHm = sp.end.endsWith('T00:00') ? '24:00' : sp.end.slice(11);
		return Number.isFinite(a) ? `${md(sp.start)} ${sp.start.slice(11)}–${endHm}` : '';
	}).join('、') + `（${AREA_TZ[ev.area].label}）`;
}
