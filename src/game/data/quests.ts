// 支线（第 28 批新增）：和某位当地人的好感、主线进度挂钩的小故事，几个目标做完就发奖励。
// - 解锁条件（unlock）全部成立时自动接下，不用去哪里点「接任务」；解锁前做的事不算。
// - 目标的写法和主线一样（data/story.ts 的 StoryStep）：状态目标看存档，动作目标看这次动作。
// - venue：在真实地点做这些事也算一次，但从不是唯一做法——没定位、人不在西澳南澳的玩家也能做完每一条支线。
// - 每条支线一辈子只做一次，完成记进存档 side.done，奖励在服务端结算动作时一并发出（不能重复领）。
// 奖励（现金、声望、好感、称号）全部「待平衡」，等 Codex 跑模拟分析后由用户拍板。
import type { StoryCheck, StoryStep } from './story.ts';

export interface SideReward {
	cash?: number;
	respect?: number;
	moodlet?: string;
	/** 给这位 NPC 加好感（-100..100 钳制） */
	rel?: { npc: string; n: number };
	/** 完成后获得的称号名（称号 id 为 side.<支线 id>） */
	title?: string;
}

export interface SideQuest {
	id: string;
	icon: string;
	title: string;
	/** 谁给的（NPC id），界面显示头像和名字；没有就是自己想做的事 */
	npc?: string;
	/** 还没解锁时告诉玩家怎么解锁 */
	hint: string;
	intro: string;
	outro: string;
	unlock: StoryCheck[];
	steps: StoryStep[];
	reward: SideReward;
}

export const SIDE_QUESTS: SideQuest[] = [
	{
		id: 'jack-early-boat',
		icon: '🎣',
		title: '老杰克的早班船',
		npc: 'jack',
		hint: '和弗里曼特尔的老杰克好感到 30',
		intro: '老杰克说，想知道这片海，就得先学会在码头上耐着性子等。',
		outro: '老杰克把一张手画的钓点图塞给你：「别告诉别人。」',
		unlock: [{ t: 'npc', npc: 'jack', score: 30 }],
		steps: [
			{ id: 'fish-freo', text: '在弗里曼特尔钓到 2 回鱼', act: { t: 'fish' }, at: 'fremantle', n: 2 },
			{ id: 'help-jack', text: '帮老杰克一个忙', act: { t: 'npc', acts: ['help'], npc: 'jack' } },
			{ id: 'kinds', text: '钓到过 3 种不同的鱼', state: { t: 'fishKinds', n: 3 } },
		],
		reward: { cash: 60, respect: 2, rel: { npc: 'jack', n: 5 }, title: '码头熟客' },
	},
	{
		id: 'mia-coffee-map',
		icon: '☕',
		title: '米娅的咖啡地图',
		npc: 'mia',
		hint: '和珀斯的米娅好感到 30',
		intro: '米娅想给新来的留学生画一张「便宜又好吃」的地图，请你帮她试吃。',
		outro: '地图印出来了，角落里写着你的名字。',
		unlock: [{ t: 'npc', npc: 'mia', score: 30 }],
		steps: [
			{ id: 'meals', text: '在外面吃 3 顿饭', act: { t: 'activity', ids: ['eat', 'market'] }, venue: ['meal'], n: 3 },
			{ id: 'snap', text: '拍一张没拍过的照片', act: { t: 'photo' } },
			{ id: 'chat-mia', text: '回去和米娅聊聊', act: { t: 'npc', acts: ['chat'], npc: 'mia' } },
		],
		reward: { cash: 40, respect: 2, rel: { npc: 'mia', n: 5 }, moodlet: 'wish-done' },
	},
	{
		id: 'linda-island-patrol',
		icon: '🦘',
		title: '琳达的岛上巡护',
		npc: 'linda',
		hint: '和罗特尼斯岛的琳达好感到 30',
		intro: '琳达要做一次动物普查，人手不够，问你愿不愿意帮着记一记。',
		outro: '普查表交上去了。琳达说明年还想找你。',
		unlock: [{ t: 'npc', npc: 'linda', score: 30 }],
		steps: [
			{ id: 'hike-island', text: '在罗特尼斯岛徒步一圈', act: { t: 'activity', ids: ['hike'] }, at: 'rottnest' },
			{ id: 'help-linda', text: '帮琳达一个忙', act: { t: 'npc', acts: ['help'], npc: 'linda' } },
			{ id: 'dex', text: '图鉴里记下 5 种动物', state: { t: 'dex', n: 5 } },
		],
		reward: { respect: 3, rel: { npc: 'linda', n: 5 }, title: '岛上巡护员' },
	},
	{
		id: 'local-routine',
		icon: '🏙️',
		title: '过上本地人的日子',
		hint: '写完主线第一章',
		intro: '安顿下来以后，试试像本地人一样过一周：运动、学点东西、自己买菜。',
		outro: '你发现自己不再看导航也知道超市在哪了。',
		unlock: [{ t: 'chapter', n: 1 }],
		steps: [
			{ id: 'move', text: '运动一次（游泳、徒步或健身）', act: { t: 'activity', ids: ['swim', 'hike', 'gym'] }, venue: ['swim', 'run', 'train'] },
			{ id: 'learn', text: '上一节课', act: { t: 'course' }, venue: ['study'] },
			{ id: 'groceries', text: '自己采购一次', act: { t: 'buy' }, venue: ['groceries'] },
		],
		reward: { cash: 50, respect: 2, moodlet: 'wish-done' },
	},
];
