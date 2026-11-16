// 共同事件的规则（纯函数）：哪里能做、谁现在不能参加、团队检定和每个人的结算。
// 服务端负责凑人（大厅）和调用这里；客户端只用 coopsAt / coopBlocked 显示。
import { checkScore } from './attributes.ts';
import { applyEffect, clone, collapsedResult, getLocation, log, roll } from './engine.ts';
import { hoursLabel, isOpen } from './time.ts';
import type { ActionResult, CoopDef, GameLocation, PlayerState, Region } from './types.ts';
import { weatherAt } from './weather.ts';
import { COOP_EVENTS } from '../data/coop.ts';

/** 每多一个人，团队分 +6 */
export const COOP_TEAM_BONUS = 6;

export function coopAvailableAt(def: CoopDef, loc: GameLocation): boolean {
	if (!def.locs && !def.tags && !def.kinds) return true;
	return !!(def.locs?.includes(loc.id) || def.tags?.some((t) => loc.tags.includes(t)) || def.kinds?.includes(loc.kind));
}

/** 这个人现在能不能参加（发起、加入、开始时都要检查）；能参加返回 undefined */
export function coopBlocked(state: PlayerState, region: Region, def: CoopDef): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	const loc = getLocation(region, state.loc);
	if (!loc || !coopAvailableAt(def, loc)) return '这里做不了这件事。';
	if (def.weather && !def.weather.includes(weatherAt(state).id)) return '今天的天气做不了这件事。';
	if (!isOpen(def.hours, state.clock)) return `时间 ${hoursLabel(def.hours!)}`;
	return undefined;
}

/** 当前地点能做的共同事件（天气不对的不列出，和普通互动一致） */
export function coopsAt(state: PlayerState, region: Region): { def: CoopDef; blocked?: string }[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	const today = weatherAt(state).id;
	return COOP_EVENTS.filter((d) => coopAvailableAt(d, loc) && (!d.weather || d.weather.includes(today))).map((def) => ({ def, blocked: coopBlocked(state, region, def) }));
}

export interface CoopMember {
	state: PlayerState;
	role: number;
	name: string;
}

export interface CoopResult {
	success: boolean;
	score: number;
	results: ActionResult[];
}

/**
 * 团队检定和每个人的结算。不改入参：每个人的随机数来自自己的存档种子。
 * 调用方要先确认每个人都能参加（coopBlocked），人数在 min–max 之间。
 */
export function resolveCoop(def: CoopDef, region: Region, members: CoopMember[]): CoopResult {
	const states = members.map((m) => clone(m.state));
	const parts = members.map((m, i) => {
		const role = def.roles[m.role] ?? def.roles[0];
		return checkScore(states[i], role.skill).total + roll(states[i]) * 60;
	});
	const score = Math.round(parts.reduce((a, b) => a + b, 0) / Math.max(1, parts.length) + COOP_TEAM_BONUS * (members.length - 1));
	const success = score >= def.dc;
	const out = success ? def.ok : def.fail;
	const results = states.map((s, i): ActionResult => {
		const others = members.filter((_, j) => j !== i).map((m) => m.name).join('、');
		const role = def.roles[members[i].role] ?? def.roles[0];
		if (applyEffect(s, out.fx, region)) return collapsedResult(s);
		log(s, `【${def.title}】和${others}一起，你负责${role.label}。${out.text}`);
		return { ok: true, state: s, msg: `${def.icon} ${def.title}：${out.text}` };
	});
	return { success, score, results };
}
