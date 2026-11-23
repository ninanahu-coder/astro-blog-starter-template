// 新手引导（v36）：渐进解锁的功能、第一次进入某页的提示、回流提示的门槛。
// 只放数据和判定条件；进度计算在 core/onboard.ts。条件只读存档，不发奖励、不改数值。
import type { PlayerState } from '../core/types.ts';

/** 进入游戏后的页面：底部 5 个标签 + 出行的「附近」分页 + 「我」里的设置分栏 */
export type OnboardPage = 'place' | 'go' | 'near' | 'grow' | 'social' | 'me' | 'sync';

/** 游戏里第几天（第 1 天 = 开局那天），和新手指南同一个算法 */
export const gameDay = (s: PlayerState) => Math.floor(s.clock / 1440) + 1;
const places = (s: PlayerState) => Object.values(s.visited).filter((n) => n > 0).length;

export interface FeatureDef {
	id: string;
	name: string; // 解开后提示和「还没出现」清单里的名字
	where: string; // 解开后在哪里找
	/** 满足就解开；解开后记进存档，以后条件不满足了也不再藏起来 */
	when: (s: PlayerState) => boolean;
	hint: string; // 还没解开时，告诉玩家怎么让它出现
}

/**
 * 今天页上可以晚一点出现的卡片。核心循环（需求、下一步、心愿、做事、工作、住处、出行）从第一分钟就在，不在这里。
 * 条件都很宽：第 2、3 天自动出现，提前做到相关的事也会提前出现。
 */
export const FEATURES: FeatureDef[] = [
	{ id: 'hobby', name: '爱好（钓鱼、摄影、观鸟……）和星空', where: '今天页「在这里 · 体验和爱好」里', when: (s) => gameDay(s) >= 2 || places(s) >= 2, hint: '到第 2 天或去过第二个地方' },
	{ id: 'study', name: '课程和职业证书', where: '今天页「在这里 · 学习」里，有课的地方才显示', when: (s) => gameDay(s) >= 2 || !!s.job || s.certs.length > 0, hint: '找到工作或到第 2 天' },
	{ id: 'garage', name: '车行和修车厂', where: '今天页「在这里 · 车和房产」里，有车行的城镇才显示', when: (s) => gameDay(s) >= 2 || s.vehicle !== 'none' || places(s) >= 2, hint: '到第 2 天或去过第二个地方' },
	{ id: 'estate', name: '买房和房产', where: '今天页「在这里 · 车和房产」里，有房出售的地方才显示', when: (s) => gameDay(s) >= 3 || !!s.home || s.properties.length > 0, hint: '租到住处或到第 3 天' },
];

export interface TipDef {
	id: string;
	page: OnboardPage;
	title: string;
	text: string;
	/** 可选的「去做」按钮：跳到哪个页面 */
	go?: { label: string; page: OnboardPage };
}

/** 第一次进入某页时的提示：一页最多一条，关掉就不再出现（记在存档里，换设备也一样） */
export const TIPS: TipDef[] = [
	{ id: 'go', page: 'go', title: '出行：路费和时间出发前就写着', text: '点地图上的地点或下面的路线，选一种走法再出发。橙色点是没去过的地方，第一次到常有事件。' },
	{ id: 'near', page: 'near', title: '附近：人到了现场才用得上', text: '你本人在真实的餐馆、健身房、公园时，打开定位就能在游戏里吃饭、训练、打卡上班。不在外面就先跳过，不影响别的玩法。' },
	{ id: 'grow', page: 'grow', title: '成长：能力用进则长', text: '做什么事就涨什么能力，没有加点。这里能看到等级、成就和收集进度。' },
	{ id: 'social', page: 'social', title: '社交：同一地点的玩家', text: '和你在同一个地点的其他玩家会出现在这里，可以打招呼、送东西、一起参加共同事件。没人在线时也不影响一个人玩。' },
	{ id: 'me', page: 'me', title: '我：存档、日志和设置', text: '这里看资产、关系和日志。「设置」里有同步码：换手机或在电脑上玩，靠它找回同一个存档。', go: { label: '去看同步码', page: 'sync' } },
	{ id: 'sync', page: 'sync', title: '同步码是存档的钥匙', text: '复制或显示二维码后记在自己的备忘录里。别发给别人：拿到它的人能用你的存档。' },
];

/** 不是提示、但也记在 tips 里的里程碑：玩家在界面上做了某件只发生在本机的事 */
export const MARKS = ['sync-kept'] as const;

/** 离开至少这么多个现实日再回来，算回流（待平衡） */
export const RETURN_DAYS = 3;
/** 回流卡片在回来的那天和第二天显示，之后自动消失 */
export const RETURN_SHOW_DAYS = 2;
