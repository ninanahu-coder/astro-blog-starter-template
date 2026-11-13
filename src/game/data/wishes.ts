// 短期心愿：角色每个游戏日冒出几个小心愿，做到了给心情和声望，过了当天自动换新。
// done 描述“哪种动作算完成”，由 core/wishes.ts 统一判断，不写针对单个心愿的代码。
import type { WishDef } from '../core/types.ts';

export const WISHES_PER_DAY = 3;
export const WISH_REWARD = { fun: 12, respect: 0.5 }; // 声望给 1 时模拟里升职和买房都明显过快

export const WISHES: WishDef[] = [
	{ id: 'eat-out', text: '想在外面吃顿好的', done: { t: 'activity', ids: ['eat', 'market'] } },
	{ id: 'swim', text: '想下海游一圈', done: { t: 'activity', ids: ['swim', 'surf', 'snorkel'] } },
	{ id: 'drink', text: '想去酒吧坐坐', done: { t: 'activity', ids: ['pub', 'wine'] } },
	{ id: 'walk', text: '想出去走走', done: { t: 'activity', ids: ['hike'] } },
	{ id: 'chat', text: '想找人聊聊天', done: { t: 'npc', acts: ['chat'] } },
	{ id: 'gift', text: '想给朋友送点东西', done: { t: 'npc', acts: ['gift'] } },
	{ id: 'help', text: '想帮别人一个忙', done: { t: 'npc', acts: ['help'] } },
	{ id: 'work', text: '今天想好好上个班', needs: 'job', done: { t: 'job' } },
	{ id: 'learn', text: '想学点新东西', done: { t: 'course' } },
	{ id: 'somewhere-new', text: '想去个没去过的地方', done: { t: 'newplace' } },
	{ id: 'treat', text: '想体验点特别的', done: { t: 'experience' } },
	{ id: 'cook', text: '想在家做顿饭', needs: 'home', done: { t: 'home', ops: ['cook'] } },
	{ id: 'stay-in', text: '想在家待一会儿', needs: 'home', done: { t: 'home', ops: ['relax', 'sleep'] } },
	{ id: 'shopping', text: '想买点东西', done: { t: 'buy' } },
	{ id: 'road-trip', text: '想出趟门', done: { t: 'travel' } },
];
