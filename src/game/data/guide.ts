// 新手指南（第 26 轮）：前三天的分步提示。每天一组，做到了自动打勾；
// 当天这组做完就提前解开下一组，到了那一天也会解开。只教操作，不发奖励（奖励在主线剧情里）。
import type { PlayerState } from '../core/types.ts';
import { VEHICLES } from './vehicles.ts';

export interface GuideStep {
	id: string;
	day: 1 | 2 | 3; // 第几天的这组
	title: string;
	hint: string;
	tab?: 'place' | 'go' | 'near' | 'grow' | 'social' | 'me'; // 「去看看」按钮跳到哪个页
	done: (s: PlayerState, start: number) => boolean; // start 为开局时钟
}

const count = (r: Record<string, number>) => Object.values(r).filter((n) => n > 0).length;

export const GUIDE_STEPS: GuideStep[] = [
	{ id: 'next', day: 1, title: '按「下一步」做一件事', hint: '今天页最上面会给出建议；做事要花时间，饥饿、精力这些需求会跟着变', tab: 'place', done: (s, start) => s.clock > start },
	{ id: 'chat', day: 1, title: '和当地人聊聊天', hint: '今天页的「这里的人」里点一位，好感高了会有故事', tab: 'place', done: (s) => Object.keys(s.relations).length > 0 },
	{ id: 'night', day: 1, title: '找地方过第一夜', hint: '精力低了就去睡，青旅、营地或者车里都行', tab: 'place', done: (s, start) => Math.floor(s.clock / 1440) > Math.floor(start / 1440) },
	{ id: 'travel', day: 2, title: '到「出行」去一个新地方', hint: '第一次到一个地方常有事件，路费和时间在出发前就写着', tab: 'go', done: (s) => count(s.visited) > 1 },
	{ id: 'job', day: 2, title: '找一份工作', hint: '今天页的「工作」里能应聘，不同地方招的人不一样', tab: 'place', done: (s) => !!s.job },
	{ id: 'shift', day: 2, title: '上一个班', hint: '到了上班地点、在开工时段里就能上班，拿到的是这一班的工资', tab: 'place', done: (s) => s.workDay >= 0 },
	{ id: 'home', day: 3, title: '有个落脚的地方', hint: '租个房间或买辆能睡的露营车，每周结算一次房租和保险', tab: 'place', done: (s) => !!s.home || s.properties.length > 0 || !!VEHICLES.find((v) => v.id === s.vehicle)?.sleep },
	{ id: 'places', day: 3, title: '去过 3 个地方', hint: '出行页的地图上能看到哪些地方还没去过', tab: 'go', done: (s) => count(s.visited) >= 3 },
	{ id: 'sync', day: 3, title: '记下同步码', hint: '「我 · 设置」里复制同步码或显示二维码；换手机、在电脑上玩都靠它找回存档', tab: 'me', done: (s) => s.onboard.tips.includes('sync-kept') },
	{ id: 'nearby', day: 3, title: '人在真实的餐馆、公园时打开「出行 · 附近」', hint: '本人到场就能在游戏里吃饭、训练、打卡上班；没在外面可以先跳过', tab: 'near', done: (s) => Object.keys(s.venueCd).length > 0 || !!s.clockIn },
];
