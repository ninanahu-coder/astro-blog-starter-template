// 和 NPC 的关系：变淡、帮个小忙（第 29 批，设计见 docs/earth-game/social-system.md）。纯函数，不引用 engine.ts。
import { CONFIDANT, FAVOR_RULE, RELATION_DECAY } from '../data/relations.ts';
import { CONFIDE_LINES } from '../data/npc-confidants.ts';
import { NPC_FAVORS, type NpcFavor } from '../data/npc-favors.ts';
import type { PlayerState, Relation } from './types.ts';

/** 最近一次和 TA 互动的游戏日（聊天、送礼、帮忙、专属互动、帮小忙里最晚的）；从没互动过为 undefined */
export function lastTouch(rel: Relation): number | undefined {
	const days = Object.values(rel.last).filter((d): d is number => typeof d === 'number');
	return days.length ? Math.max(...days) : undefined;
}

/** 到 day 为止，从最近一次互动算起累计应变淡几次（宽限期内为 0） */
function steps(lt: number, day: number): number {
	return Math.max(0, Math.floor((day - lt - RELATION_DECAY.grace) / RELATION_DECAY.every));
}

/**
 * 游戏日从 fromDay 走到 toDay 时，一段关系变淡后的分数。
 * 高于 floor 的往 floor 降，负分往 0 回升，每 every 天 1 分；不会越过 floor / 0。没跨日或没互动过不变。
 */
export function decayedScore(rel: Relation, fromDay: number, toDay: number): number {
	const lt = lastTouch(rel);
	if (lt === undefined || toDay <= fromDay || isConfidant(rel)) return rel.score;
	const n = steps(lt, toDay) - steps(lt, fromDay);
	if (n <= 0) return rel.score;
	if (rel.score > RELATION_DECAY.floor) return Math.max(RELATION_DECAY.floor, rel.score - n);
	if (rel.score < 0) return Math.min(0, rel.score + n);
	return rel.score;
}

/** 跨日结算：所有关系按经过的游戏日变淡。没有变化时返回原存档；有变化时返回新存档（不改入参） */
export function settleDecay(state: PlayerState, fromDay: number, toDay: number): PlayerState {
	let changed: Record<string, Relation> | null = null;
	for (const [id, rel] of Object.entries(state.relations)) {
		const score = decayedScore(rel, fromDay, toDay);
		if (score === rel.score) continue;
		changed ??= { ...state.relations };
		changed[id] = { ...rel, score };
	}
	return changed ? { ...state, relations: changed } : state;
}

/** 这段关系是不是正在变淡（过了宽限期、分数还高于底线）：界面提示「好久没见」 */
export function isFading(rel: Relation, today: number): boolean {
	const lt = lastTouch(rel);
	return lt !== undefined && !isConfidant(rel) && rel.score > RELATION_DECAY.floor && today - lt > RELATION_DECAY.grace;
}

/** 游戏日 day 属于第几期 */
export const favorPeriod = (day: number): number => Math.floor(day / FAVOR_RULE.every);

/** 确定性的小散列（FNV-1a），只用来决定哪几期开口，不参与任何检定 */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** 这位 NPC 在这一期有没有事相求（不看关系，只看日子） */
export function favorOn(npcId: string, day: number): NpcFavor | undefined {
	const f = NPC_FAVORS.find((x) => x.npc === npcId);
	if (!f) return undefined;
	return hash(`${npcId}:${favorPeriod(day)}`) % FAVOR_RULE.odds === 0 ? f : undefined;
}

/**
 * 这位 NPC 今天向你开口的小忙：这期有事、关系够「认识」、这期还没帮过。
 * 不看在不在场——界面在「认识的人今天在哪」里也会提示。
 */
export function favorToday(state: PlayerState, npcId: string, day: number): NpcFavor | undefined {
	const rel = state.relations[npcId];
	if (!rel || rel.score < FAVOR_RULE.minScore) return undefined;
	const f = favorOn(npcId, day);
	if (!f) return undefined;
	const done = rel.last.favor;
	if (done !== undefined && favorPeriod(done) === favorPeriod(day)) return undefined;
	return f;
}

// ---------- 知己（第 29 批：不做恋爱，做挚友之后的深交） ----------

export const isConfidant = (rel: Relation | undefined): boolean => rel?.bond !== undefined;

/** 现在有几位知己 */
export const confidantCount = (state: PlayerState): number => Object.values(state.relations).filter(isConfidant).length;

/**
 * 能不能和 TA 结为知己：null 表示还不到这一步（关系没到、没看过那一段剧情、已经是知己），界面不显示按钮；
 * 字符串是暂时不能结的原因；undefined 表示可以。
 */
export function bondBlocked(state: PlayerState, rel: Relation, today: number): string | null | undefined {
	if (isConfidant(rel) || rel.score < CONFIDANT.minScore || !rel.seen.includes(CONFIDANT.minScore)) return null;
	if (confidantCount(state) >= CONFIDANT.max) return `最多 ${CONFIDANT.max} 位知己，先和其中一位解除`;
	const last = rel.last.unbond;
	if (last !== undefined && today - last < CONFIDANT.cooldown) return `刚解除不久，${CONFIDANT.cooldown - (today - last)} 天后才能再结`;
	return undefined;
}

/** 这次和知己聊天会不会多听到一段近况：是知己，且离上次听近况满 every 天（或从没听过） */
export function confideDue(rel: Relation, today: number): boolean {
	return isConfidant(rel) && (rel.told === undefined || today - rel.told >= CONFIDANT.every);
}

/** 这一期轮到哪段近况（按 every 天一期轮流）；没写近况的 NPC 返回 undefined */
export function confideLine(npcId: string, today: number): string | undefined {
	const lines = CONFIDE_LINES[npcId];
	return lines?.length ? lines[Math.floor(today / CONFIDANT.every) % lines.length] : undefined;
}
