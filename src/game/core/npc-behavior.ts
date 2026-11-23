// NPC 行为规则（第 43 批，设计见 docs/earth-game/npc-behavior.md）：日程、不在（休假 / 病假）、移动、空间分布、需求和心情。
// 纯函数，确定性：只看「NPC + 游戏时钟」（和天气一样，所有玩家看到的一样），不用存档里的随机种子，不读真实时钟。
// 规则按优先级逐层判断（简单状态机）：休假 > 病假 > 日程（节日、天气、星期、季节，按数据顺序取第一条） > 常驻。
import { FESTIVALS } from '../data/festivals.ts';
import { NPC_LEAVE, NPC_LINES, NPC_MOOD, NPC_NEEDS, NPC_SICK, NPC_TEMPER, NPC_TRAVEL, type NpcMoodCause, type NpcMoodLevel } from '../data/npc-behavior.ts';
import { haversineKm } from './geo.ts';
import { dateOf, dayOf, inSpan, weekdayOf } from './time.ts';
import type { Hours, NpcDef, NpcSlot, Region } from './types.ts';
import { unit, weatherOn } from './weather.ts';

export interface NpcPlan {
	loc: string;
	hours: Hours;
	note?: string;
	/** 今天不在：休年假 / 病假。这时 loc、hours 是常驻的，只用来显示「平时在哪」 */
	away?: 'leave' | 'sick';
}

const festivalOn = (id: string, clock: number): boolean => {
	const f = FESTIVALS.find((x) => x.id === id);
	return !!f && inSpan(clock, f.season, f.day, f.days).active;
};

/** 某条日程今天是否适用 */
export function slotMatches(npc: NpcDef, slot: NpcSlot, clock: number): boolean {
	if (slot.weekdays && !slot.weekdays.includes(weekdayOf(clock))) return false;
	if (slot.seasons && !slot.seasons.includes(dateOf(clock).season)) return false;
	if (slot.festival && !festivalOn(slot.festival, clock)) return false;
	if (slot.weather && !slot.weather.includes(weatherOn(slot.weatherAt ?? npc.loc, dayOf(clock)).id)) return false;
	return true;
}

/** 今天是否在休年假；是的话返回那条假期 */
export function leaveOn(npcId: string, clock: number) {
	return NPC_LEAVE.find((l) => l.npc === npcId && inSpan(clock, l.season, l.day, l.days).active);
}

/** 今天是否病着：过去 maxDays 天内某天按概率开始生病，病期覆盖今天。节日日程那几天不会病（玩家专门赶来） */
export function sickOn(npc: NpcDef, clock: number): boolean {
	const today = dayOf(clock);
	if (npc.schedule?.some((s) => s.festival && slotMatches(npc, s, clock))) return false;
	for (let back = 0; back < NPC_SICK.maxDays; back++) {
		const start = today - back;
		const rate = NPC_SICK.rate[dateOf(start * 1440).season];
		if (unit(`npc-sick|${npc.id}|${start}`) >= rate) continue;
		const len = 1 + Math.floor(unit(`npc-sick-len|${npc.id}|${start}`) * NPC_SICK.maxDays);
		if (back < len) return true;
	}
	return false;
}

/** NPC 某天（clock 所在的游戏日）的安排 */
export function planFor(npc: NpcDef, clock: number): NpcPlan {
	const home = { loc: npc.loc, hours: npc.hours };
	const leave = leaveOn(npc.id, clock);
	if (leave) return { ...home, note: leave.note, away: 'leave' };
	if (sickOn(npc, clock)) return { ...home, note: NPC_SICK.note, away: 'sick' };
	for (const slot of npc.schedule ?? []) {
		if (slotMatches(npc, slot, clock)) return { loc: slot.loc, hours: slot.hours, note: slot.note };
	}
	return home;
}

// ---------- 移动与空间分布 ----------

/** 两地之间 NPC 路上要几个小时（整数） */
export function travelHours(from: string, to: string, region?: Region): number {
	if (from === to) return 0;
	const a = region?.locations.find((l) => l.id === from);
	const b = region?.locations.find((l) => l.id === to);
	if (!a || !b) return NPC_TRAVEL.fallback;
	const h = Math.ceil(haversineKm(a.lat, a.lon, b.lat, b.lon) / NPC_TRAVEL.kmh);
	return Math.max(NPC_TRAVEL.min, Math.min(NPC_TRAVEL.max, h));
}

export type NpcWhereKind = 'there' | 'travel' | 'off' | 'away';

export interface NpcWhere {
	kind: NpcWhereKind;
	/** 此刻所在：there 是工作 / 去处的地点；off、away 是常驻地点（家）；travel 是出发地 */
	loc: string;
	/** travel 时的目的地 */
	to?: string;
	/** 这一刻适用的那天的安排，和它是哪个游戏日的（凌晨还在昨天跨午夜班次里时是昨天） */
	plan: NpcPlan;
	day: number;
}

/** 某天安排在绝对分钟上的窗口：开工、收工（跨午夜的收工记在第二天） */
function windowOf(plan: NpcPlan, day: number): [number, number] {
	const [o, c] = plan.hours;
	return [day * 1440 + o * 60, day * 1440 + (c <= o ? c + 24 : c) * 60];
}

/**
 * NPC 此刻在哪：在班上 / 在路上 / 在家歇着 / 请假不在。
 * 去外地的那天，开工前 travelHours 小时出发，收工后同样时长回家。凌晨还在昨天跨午夜班次里的，算昨天的安排。
 */
export function npcWhere(npc: NpcDef, clock: number, region?: Region): NpcWhere {
	const today = dayOf(clock);
	const days = [today, today - 1].map((d) => ({ d, plan: planFor(npc, d * 1440) }));
	// 先看在班上（今天的优先），再看在路上
	for (const { d, plan } of days) {
		if (plan.away) continue;
		const [open, close] = windowOf(plan, d);
		if (clock >= open && clock < close) return { kind: 'there', loc: plan.loc, plan, day: d };
	}
	for (const { d, plan } of days) {
		if (plan.away || plan.loc === npc.loc) continue;
		const t = travelHours(npc.loc, plan.loc, region) * 60;
		const [open, close] = windowOf(plan, d);
		if (clock >= open - t && clock < open) return { kind: 'travel', loc: npc.loc, to: plan.loc, plan, day: d };
		if (clock >= close && clock < close + t) return { kind: 'travel', loc: plan.loc, to: npc.loc, plan, day: d };
	}
	// 昨天请假、平时是跨午夜的班：凌晨这段仍算昨天的请假（和 planNow 一致）
	const y = days[1];
	if (y.plan.away && !days[0].plan.away && clock < windowOf(y.plan, y.d)[1]) return { kind: 'away', loc: npc.loc, plan: y.plan, day: y.d };
	const plan = days[0].plan;
	return { kind: plan.away ? 'away' : 'off', loc: npc.loc, plan, day: today };
}

/** 同一时刻所有 NPC 的空间分布：地点 id → 在那里当班的 NPC id（按 NPCS 的顺序） */
export function npcMap(npcs: NpcDef[], clock: number, region?: Region): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const n of npcs) {
		const w = npcWhere(n, clock, region);
		if (w.kind === 'there') (out[w.loc] ??= []).push(n.id);
	}
	return out;
}

// ---------- 需求与心情 ----------

export interface NpcNeeds {
	energy: number;
	/** 同一地点当班的其他 NPC 人数 */
	company: number;
}

/** NPC 此刻的需求：精力随班次消耗；同伴数来自空间分布 */
export function npcNeeds(npc: NpcDef, npcs: NpcDef[], clock: number, region?: Region): NpcNeeds {
	const w = npcWhere(npc, clock, region);
	let energy = w.kind === 'travel' ? NPC_NEEDS.travel : NPC_NEEDS.off;
	let company = 0;
	if (w.kind === 'there') {
		const [open, close] = windowOf(w.plan, w.day);
		energy = NPC_NEEDS.start - NPC_NEEDS.shiftDrop * ((clock - open) / (close - open));
		company = (npcMap(npcs, clock, region)[w.loc]?.length ?? 1) - 1;
	}
	energy += NPC_NEEDS.weather[weatherOn(w.loc, dayOf(clock)).id] ?? 0;
	return { energy: Math.max(0, Math.min(100, Math.round(energy))), company };
}

export interface NpcMood {
	score: number;
	level: NpcMoodLevel;
	/** 分量最大的那个原因（对话按它挑台词） */
	cause: NpcMoodCause;
	needs: NpcNeeds;
	/** 招呼台词，占位符已替换（页面插值时仍要 esc） */
	line: string;
}

/** NPC 此刻的心情：脾气 + 天气 + 节日 + 周末 + 精力 + 有没有伴。传 region 时台词里的地点用中文名 */
export function npcMood(npc: NpcDef, npcs: NpcDef[], clock: number, region?: Region): NpcMood {
	const needs = npcNeeds(npc, npcs, clock, region);
	const w = npcWhere(npc, clock, region);
	const temper = NPC_TEMPER[npc.id] ?? { base: 0 };
	const wx = weatherOn(w.loc, dayOf(clock));
	const fest = FESTIVALS.find((f) => f.loc === w.loc && inSpan(clock, f.season, f.day, f.days).active);
	const parts: [NpcMoodCause, number][] = [
		['weather', temper.weather?.[wx.id] ?? 0],
		['festival', fest ? NPC_MOOD.festival : 0],
		['weekend', weekdayOf(clock) >= 5 ? NPC_MOOD.weekend : 0],
		['tired', needs.energy < NPC_MOOD.energyPivot ? -(NPC_MOOD.energyPivot - needs.energy) / NPC_MOOD.energyDiv : 0],
		w.kind === 'there' ? (needs.company > 0 ? ['company', NPC_MOOD.company] : ['lonely', NPC_MOOD.lonely]) : ['calm', 0],
	];
	const score = Math.round(temper.base + parts.reduce((s, [, v]) => s + v, 0));
	const level = NPC_MOOD.levels.find((l) => score >= l.min)!.level;
	// 原因：和心情同方向、分量最大的那一项；台词表里没有这个原因就用 calm
	const sign = level === 'great' || level === 'good' ? 1 : -1;
	const top = parts.filter(([, v]) => v * sign > 0).sort((a, b) => b[1] * sign - a[1] * sign)[0];
	const table = NPC_LINES[level];
	const cause: NpcMoodCause = top && table[top[0]] ? top[0] : 'calm';
	const lines = table[cause] ?? table.calm;
	const pick = lines[Math.floor(unit(`npc-line|${npc.id}|${dayOf(clock)}`) * lines.length)];
	const place = region?.locations.find((l) => l.id === w.loc)?.name ?? '';
	const line = pick.replaceAll('{weather}', wx.name).replaceAll('{festival}', fest?.name ?? '').replaceAll('{place}', place);
	return { score, level, cause, needs, line };
}

/** 聊天检定的门槛：基础 45，按 NPC 心情加减 */
export const chatDc = (mood: NpcMood) => 45 + NPC_MOOD.chatDc[mood.level];

