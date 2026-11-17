// 摄影任务链：按提示去指定地点，在指定时段、天气拍一张照片，拍完才给下一个任务。
// 奖励待平衡。天气按「地点 + 游戏日」固定，所以等对的天气可能要换几天再来。
import type { SeasonId } from '../core/time.ts';

export interface PhotoQuest {
	id: string;
	title: string;
	hint: string;
	loc: string;
	periods?: ('dawn' | 'day' | 'dusk' | 'night')[];
	weather?: string[];
	seasons?: SeasonId[];
	cash: number;
	respect: number;
}

export const PHOTO_MINUTES = 20;
/** 整条任务链拍完的额外声望（待平衡） */
export const PHOTO_CHAIN_BONUS = 5;

const CLEAR = ['sunny', 'cloudy', 'hot'];

export const PHOTO_QUESTS: PhotoQuest[] = [
	{ id: 'swan-dusk', title: '天鹅河的黄昏', hint: '傍晚去珀斯，拍天鹅河上的晚霞。', loc: 'perth', periods: ['dusk'], cash: 30, respect: 2 },
	{ id: 'freo-dawn', title: '港口醒来', hint: '清晨去弗里曼特尔，拍渔船出港。', loc: 'fremantle', periods: ['dawn'], cash: 30, respect: 2 },
	{ id: 'quokka-sun', title: '晴天的矮袋鼠', hint: '找个不下雨的白天去罗特尼斯岛，拍一只晒太阳的短尾矮袋鼠。', loc: 'rottnest', periods: ['day'], weather: CLEAR, cash: 40, respect: 2 },
	{ id: 'jetty-rain', title: '雨中栈桥', hint: '下雨天去巴瑟尔顿，拍伸进海里的长栈桥。', loc: 'busselton', weather: ['rain'], cash: 40, respect: 2 },
	{ id: 'pinnacles-stars', title: '石阵星空', hint: '找个没下雨的夜晚去尖峰石阵，拍石柱上方的银河。', loc: 'pinnacles', periods: ['night'], weather: CLEAR, cash: 50, respect: 3 },
	{ id: 'wave-noon', title: '正午的浪', hint: '晴天或炎热天的白天去波浪岩，拍阳光下的花岗岩巨浪。', loc: 'wave-rock', periods: ['day'], weather: ['sunny', 'hot'], cash: 50, respect: 3 },
	{ id: 'coral-blue', title: '透明的蓝', hint: '晴天的白天去珊瑚湾，拍礁石边透明的海水。', loc: 'coral-bay', periods: ['day'], weather: ['sunny', 'hot'], cash: 60, respect: 3 },
	{ id: 'cable-sunset', title: '凯布尔海滩落日', hint: '不下雨的傍晚去布鲁姆，拍海滩上的骆驼和落日。', loc: 'broome', periods: ['dusk'], weather: CLEAR, cash: 80, respect: 4 },
];
