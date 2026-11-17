// 全服周目标：每个现实周（按珀斯时间的现实日 ÷ 7）轮换一个，所有玩家一起累计。
// 达成后，这周出过力（至少算进 1 次）的玩家各领一次奖励。目标和奖励是初始值，待平衡。
import type { WeeklyGoal } from '../core/weekly.ts';

export const WEEKLY_GOALS: WeeklyGoal[] = [
	{ id: 'week-coop', icon: '🤝', title: '一起搭把手', desc: '全服一起完成共同事件（每次每个参加的人都算一份）', metric: 'coop', target: 30, reward: { cash: 60, respect: 3 } },
	{ id: 'week-trade', icon: '🎁', title: '礼尚往来', desc: '全服一起送礼或在二手摊成交', metric: 'trade', target: 20, reward: { cash: 60, respect: 3 } },
	{ id: 'week-exp', icon: '🎟️', title: '出门玩一趟', desc: '全服一起完成收费体验', metric: 'experience', target: 40, reward: { cash: 60, respect: 3 } },
	{ id: 'week-travel', icon: '🧭', title: '满西澳地跑', desc: '全服一起抵达新的地点（每次出行算一次）', metric: 'travel', target: 120, reward: { cash: 60, respect: 3 } },
];
