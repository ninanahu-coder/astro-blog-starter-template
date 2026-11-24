// 和 NPC 的关系数值（第 29 批，设计见 docs/earth-game/social-system.md）。
// 引擎只读这张表，不在 engine.ts 里写死数字。标「待平衡」的是第一版初值，等 Codex 跑模拟分析后由用户拍板再改。
import type { GiftReaction } from '../core/types.ts';

/** 关系分档：分数 ≥ min 就算这一档（现状，第 29 批只是从 engine.ts 搬到这里） */
export const RELATION_TIERS = [
	{ min: -100, name: '有过节' },
	{ min: 0, name: '陌生人' },
	{ min: 10, name: '认识' },
	{ min: 30, name: '朋友' },
	{ min: 60, name: '好友' },
	{ min: 90, name: '挚友' },
] as const;

/** 送礼时关系的变化（第十三轮 15 / 9 / 3 → 5 / 3 / 1：最爱礼物原来一周就到挚友；讨厌仍是 -8） */
export const GIFT_GAIN: Record<GiftReaction, number> = { love: 5, like: 3, neutral: 1, dislike: -8 };

/** 其他互动涨多少关系（现状：聊天投机 7 / 寒暄 3，帮忙 9，专属互动 2；帮个小忙是第 29 批新加的，待平衡） */
export const RELATION_GAIN = {
	chatGood: 7,
	chatPlain: 3,
	help: 9,
	perk: 2,
	favor: 10, // 待平衡
} as const;

/**
 * 关系变淡（第 29 批新加，全部待平衡）：
 * 和某位 NPC 最近一次互动之后过了 grace 个游戏日还没再见，之后每 every 天关系 −1，
 * 降到 floor（「朋友」的门槛）就不再降——认识过、做过朋友的人不会变回陌生人，只有「好友」「挚友」要常来往才保得住。
 * 有过节（负分）的反过来：同样的节奏往 0 回升，时间会冲淡不愉快。
 */
export const RELATION_DECAY = {
	grace: 7, // 待平衡
	every: 3, // 待平衡
	floor: 30, // 待平衡
} as const;

/**
 * 帮个小忙（NPC 主动找你，第 29 批新加，全部待平衡）：
 * 每 every 个游戏日算一期，每位 NPC 每期按日子和 TA 的 id 算出今期有没有事相求（约一半的期数有），
 * 关系到 minScore（「认识」）才会开口；每期最多帮一次。
 */
export const FAVOR_RULE = {
	every: 3, // 待平衡
	minScore: 10, // 待平衡
	/** 约多少期里有一期有事相求：hash % odds === 0 */
	odds: 2, // 待平衡
} as const;

/**
 * 知己（第 29 批，用户定：不做恋爱，做挚友之后的深交。全部待平衡）：
 * 关系到 minScore 且看过那一段剧情后，可以当面「结为知己」，同时最多 max 位。
 * 知己的关系不会变淡；每隔 every 个游戏日，和 TA 聊天会多听到一段近况（只给心情，不给钱和能力）。
 * 解除后 cooldown 天内不能和同一位再结，防止反复结、解刷心情。
 */
export const CONFIDANT = {
	minScore: 90, // 待平衡
	max: 3, // 待平衡
	every: 7, // 待平衡
	cooldown: 7, // 待平衡
	minutes: 30, // 待平衡
} as const;
