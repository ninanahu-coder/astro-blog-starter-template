// 主线剧情：按章推进，每章几个小目标，全部做到就结算本章、进入下一章。
// 目标分两种：
//   - 状态目标（state）：看存档现在的样子判断，例如「有一份工作」「去过弗里曼特尔」，做到的那一刻记下，之后丢了也不收回；
//   - 动作目标（act）：用和心愿一样的 WishDone 描述「哪种动作算一次」，n 次才算完成。
// 判定统一在 core/story.ts，不写针对单个目标的代码。奖励待平衡。
import type { Effect, WishDone, VenueOp } from '../core/types.ts';

export type StoryCheck =
	| { t: 'visited'; loc: string }
	| { t: 'places'; n: number } // 去过的地点数（含出生地）
	| { t: 'job' }
	| { t: 'home' }
	| { t: 'cash'; n: number }
	| { t: 'friend'; score: number }; // 至少一位 NPC 好感达到 score

export interface StoryStep {
	id: string;
	text: string;
	state?: StoryCheck;
	act?: WishDone;
	venue?: VenueOp[]; // 在真实地点做这些事也算一次（同心愿）
	n?: number; // 动作目标要做几次，默认 1
}

export interface StoryChapter {
	id: string;
	title: string;
	intro: string;
	outro: string;
	steps: StoryStep[];
	reward: Effect; // 只用 cash、respect、moodlet（待平衡）
}

export const STORY: StoryChapter[] = [
	{
		id: 'first-week',
		title: '第一章 · 落地珀斯的头一周',
		intro: '飞机落地，口袋里的钱撑不了太久。先在这座城市里站稳脚：吃一顿热饭，认识几个人，出去走走。',
		outro: '一周下来，珀斯不再是地图上的一个点。你知道哪家咖啡便宜，也有人会在街上跟你打招呼了。',
		steps: [
			{ id: 'meal', text: '在外面吃一顿饭', act: { t: 'activity', ids: ['eat', 'market'] }, venue: ['meal'] },
			{ id: 'chat', text: '和当地人聊聊天', act: { t: 'npc', acts: ['chat'] }, n: 2 },
			{ id: 'buy', text: '买一样用得上的东西', act: { t: 'buy' }, venue: ['groceries'] },
			{ id: 'freo', text: '坐车去弗里曼特尔看看', state: { t: 'visited', loc: 'fremantle' } },
			{ id: 'places', text: '去过 3 个地方', state: { t: 'places', n: 3 } },
		],
		reward: { cash: 50, respect: 2, moodlet: 'wish-done' },
	},
];
