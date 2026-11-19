// 排行榜与赛季的数值表（第一版，见 docs/earth-game/leaderboard.md）。
// 标「待平衡」的数值都是第一版的占位，等 Codex 看线上数据和模拟报告后给建议；Claude 不下平衡结论。

/** 榜单维度 */
export type LbDim = 'worth' | 'places' | 'dex' | 'respect' | 'contest';

export interface LbDimDef {
	id: LbDim;
	name: string;
	icon: string;
	/** 总榜有没有这个维度：比赛积分只按赛季记，没有总榜 */
	allTime: boolean;
	desc: string;
}

export const LB_DIMS: LbDimDef[] = [
	{ id: 'worth', name: '身家', icon: '💰', allTime: true, desc: '净资产：现金 + 车 + 家具 + 房产 − 贷款。赛季榜按本赛季增长排。' },
	{ id: 'places', name: '打卡', icon: '📍', allTime: true, desc: '用真实定位打卡过的地点数。赛季榜按本赛季新打卡的地点数排。' },
	{ id: 'dex', name: '图鉴', icon: '📖', allTime: true, desc: '野生动物图鉴 + 钓到过的鱼种的完成度。赛季榜按本赛季新收集的比例排。' },
	{ id: 'respect', name: '声望', icon: '⭐', allTime: true, desc: '声望。赛季榜按本赛季增长排。' },
	{ id: 'contest', name: '比赛', icon: '🏆', allTime: false, desc: '比赛类共同事件的积分，只按赛季记。' },
];

/** 一个赛季几周（赛季边界和周目标的周边界对齐：珀斯时间周四零点）。待平衡 */
export const LB_SEASON_WEEKS = 4;
/** 第 1 赛季的序号（weekOf ÷ LB_SEASON_WEEKS）：2026-11-19 开始的那一季 */
export const LB_FIRST_SEASON = 742;

/** 榜单显示前多少名 */
export const LB_TOP = 20;

/** 排名结果在服务器内存里缓存多久（毫秒）：期间有新写入也先用缓存，过期才重排。待平衡 */
export const LB_CACHE_MS = 30_000;

/**
 * 比赛积分：哪些共同事件算「比赛」，成功、失败各记几分（每个成员都记）。待平衡。
 * 运动分支（claude/earth-sports）以后有正式比赛时，往这里加 id 即可，不改逻辑。
 */
export const LB_CONTEST: Record<string, { ok: number; fail: number }> = {
	'fishing-comp': { ok: 3, fail: 1 },
};
/** 每人每个现实日最多记几分比赛积分（挡小号陪刷）。待平衡 */
export const LB_CONTEST_DAY_CAP = 6;

/**
 * 异常值：一次落盘（通常是一个动作）里涨得超过这些，就把这名玩家的榜单记录挂起复核。待平衡。
 * 第一版按模拟报告里机器人的「单个动作最大涨幅」留出余量来定，见 docs/earth-game/leaderboard.md §6。
 */
export const LB_ANOMALY = {
	/** 一个动作净资产最多涨多少 */
	worthPerRev: 40_000,
	/** 一小时（现实时间）内净资产最多涨多少 */
	worthPerHour: 200_000,
	/** 一个动作最多新增几个打卡地点 */
	placesPerRev: 3,
	/** 一个动作图鉴完成度最多涨多少（千分比） */
	dexPerRev: 100,
	/** 一个动作声望最多涨多少 */
	respectPerRev: 60,
};
/** 挂起复核多久（现实天）后自动解除：第一版还没有人工复核工具，不能让误判的玩家一直下榜。待平衡 */
export const LB_HOLD_DAYS = 7;

/** 赛季奖励档位：只发称号和榜单徽章，不给任何数值。待平衡 */
export type LbTier = 'champion' | 'podium' | 'top10' | 'top100';
export const LB_TIERS: { tier: LbTier; upTo: number; badge: string; label: string }[] = [
	{ tier: 'champion', upTo: 1, badge: '🥇', label: '冠军' },
	{ tier: 'podium', upTo: 3, badge: '🥈', label: '前三' },
	{ tier: 'top10', upTo: 10, badge: '🏅', label: '前十' },
	{ tier: 'top100', upTo: 100, badge: '🎖️', label: '前百' },
];
/** 每人最多保留几条赛季称号 */
export const LB_TITLES_MAX = 40;

/** 匿名上榜时显示的名字和头像 */
export const LB_ANON = { name: '匿名旅人', avatar: '👤' };
