// 主要路线（实地路线）：把几个真实地点按顺序串起来，跟着主线章节开放，玩家本人拿着手机走。
// 设计见 docs/earth-game/gps-route-design.md；判定在 core/trails.ts。
// 站只引用已有的真实地点：wa.pois.json 的种子打卡点（seed）或 *.venues.json 里 OpenClaw 从 OSM 采集的地点（osm）。
// 名字和坐标是从来源抄过来的，tests/earth/trails.test.ts 逐条核对，不在这里引入新坐标。
// 所有数值（站的收获、路线奖励、TRAIL_RULES）待平衡。
import type { Effect } from '../core/types.ts';

export interface TrailStop {
	/** 来源里的地点 id（wa.pois.json / *.venues.json） */
	ref: string;
	name: string;
	lat: number;
	lon: number;
	/** 到站时的描写 */
	text: string;
	/** 到站的小收获（待平衡） */
	fx?: Effect;
	/** 到站事件（data/trail-events.ts） */
	event?: string;
	/** 从上一站走到这一站途中的事件（第一站没有上一站，不写） */
	along?: string;
	/** 到站半径（米），默认 TRAIL_RULES.stopRadiusM */
	radiusM?: number;
}

export interface TrailDef {
	id: string;
	title: string;
	/** 所在游戏地点（GameLocation.id）：游戏里人在这座城市才能走 */
	loc: string;
	/** 主线进行到第几章（STORY 的下标，0 起）开放 */
	chapter: number;
	intro: string;
	outro: string;
	stops: TrailStop[];
	/** 走完整条路线的奖励：只用 cash、respect、moodlet（待平衡） */
	reward: Effect;
}

/** 路线判定的约束（待平衡） */
export const TRAIL_RULES = {
	stopRadiusM: 80, // 到站半径，另加 min(定位误差, FIX_RULES.accuracySlackM)
	corridorM: 150, // 沿途走廊半宽：离「上一站 → 下一站」线段这么近才算在路上
	alongFrom: 0.2, // 沿途事件要在这段路走了 20%……
	alongTo: 0.85, // ……到 85% 之间
	maxKmh: 25, // 站与站之间按直线距离和服务端时间算的最高平均速度（步行、跑步、骑车够用，开车刷站不行）
	minAccuracyM: 1, // 定位误差小于这个值视为异常（真机不会报 0 米，开发者工具和部分模拟定位会）
	stopMinutes: 20, // 到站花的游戏时间
};

export const TRAILS: TrailDef[] = [
	{
		id: 'perth-city-walk',
		title: '市中心认路',
		loc: 'perth',
		chapter: 0,
		intro: '刚落地的头几天，先把市中心走一遍：从河边出发，经过两座图书馆，最后去北桥买点家乡味道。',
		outro: '从河边走到北桥，一个多小时。下次有人问你图书馆在哪、哪里买得到家乡调料，你能直接指路了。',
		stops: [
			{ ref: 'seed-elizabeth-quay', name: '伊丽莎白码头 Elizabeth Quay', lat: -31.958, lon: 115.8573, text: '码头边的步行桥上，有人在拍天鹅河的对岸。你从这里出发。', fx: { needs: { fun: 6 } }, event: 'trail-quay-start' },
			{ ref: 'osm-way-147035269', name: 'City of Perth Library', lat: -31.95517, lon: 115.861226, text: '圆筒形的图书馆，门口贴着免费活动的海报，旁边的小花园里有人坐着吃午饭。', fx: { needs: { fun: 4, energy: 3 }, skills: { street: 0.5 } }, along: 'trail-along-busker' },
			{ ref: 'osm-way-42506693', name: 'State Library of Western Australia', lat: -31.948966, lon: 115.860566, text: '过了火车站就是文化中心，州立图书馆里有不少人在安静地自习。', fx: { needs: { fun: 4 } }, event: 'trail-library-seat', along: 'trail-along-crossing' },
			{ ref: 'osm-node-14067556216', name: '龙辉超市', lat: -31.945239, lon: 115.861907, text: '北桥的亚洲超市，货架上的包装终于都看得懂了。', fx: { needs: { fun: 6, social: 4 } }, event: 'trail-asian-grocer' },
		],
		reward: { cash: 40, respect: 2, moodlet: 'wish-done' },
	},
	{
		id: 'freo-old-port',
		title: '老港口半日',
		loc: 'fremantle',
		chapter: 0,
		intro: '弗里曼特尔的老城不大，走路就能逛完：公园、图书馆、市集，最后去山坡上的老监狱。',
		outro: '半天下来，你把老港口的几条主街都认熟了，也知道周末该几点来市集。',
		stops: [
			{ ref: 'osm-way-164770781', name: 'Princess May Park', lat: -32.05054, lon: 115.749103, text: '老城北边的小公园，长椅上有人在晒太阳。', fx: { needs: { fun: 4, energy: 3 } } },
			{ ref: 'osm-node-2409358109', name: 'Fremantle Library', lat: -32.054087, lon: 115.748345, text: '图书馆门口的布告栏上贴着招工和合租的小纸条。', fx: { needs: { fun: 4 }, skills: { street: 0.5 } }, event: 'trail-notice-board', along: 'trail-along-sea-breeze' },
			{ ref: 'seed-freo-markets', name: '弗里曼特尔市集 Fremantle Markets', lat: -32.0564, lon: 115.7489, text: '市集里飘着烤肉和咖啡的味道，摊主在吆喝。', fx: { needs: { fun: 6, social: 4 } } },
			{ ref: 'seed-freo-prison', name: '弗里曼特尔监狱 Fremantle Prison', lat: -32.055, lon: 115.7536, text: '山坡上的石灰岩高墙，门口有人在排队等导览。', fx: { needs: { fun: 6 } }, event: 'trail-prison-gate', along: 'trail-along-busker' },
		],
		reward: { cash: 30, respect: 2, moodlet: 'wish-done' },
	},
	{
		id: 'adelaide-grid-walk',
		title: '棋盘城一圈',
		loc: 'adelaide',
		chapter: 0,
		intro: '阿德莱德的市中心是方方正正的棋盘格，几个广场像棋子一样摆着。从西边的广场出发，斜穿到北边的公园。',
		outro: '走完一圈你就明白了：这座城的路很好认，几条大街横平竖直，广场就是路标。',
		stops: [
			{ ref: 'osm-way-194852575', name: 'Light Square', lat: -34.925405, lon: 138.593659, text: '西边的广场，周围是学生公寓和小餐馆。', fx: { needs: { fun: 4 } }, event: 'trail-quay-start' },
			{ ref: 'osm-node-9228689164', name: 'Little Tokyo', lat: -34.929369, lon: 138.596629, text: '一家日式小超市，冷柜里有饭团和味噌。', fx: { needs: { fun: 4, social: 2 } }, event: 'trail-asian-grocer' },
			{ ref: 'osm-relation-13040624', name: 'Hindmarsh Square', lat: -34.924367, lon: 138.605603, text: '城东的广场，周围一圈咖啡店。', fx: { needs: { fun: 4, energy: 3 } }, along: 'trail-along-crossing' },
			{ ref: 'osm-way-677417155', name: 'State Library of South Australia', lat: -34.920501, lon: 138.602373, text: '北大街上的州立图书馆，老阅览室的木书架一层摞一层。', fx: { needs: { fun: 4 }, skills: { street: 0.5 } }, event: 'trail-library-seat' },
			{ ref: 'osm-relation-19596485', name: 'Botanic Park', lat: -34.913269, lon: 138.609553, text: '城北的大草坪，大树底下有人铺着野餐垫。', fx: { needs: { fun: 6, energy: 3 } }, along: 'trail-along-sea-breeze' },
		],
		reward: { cash: 40, respect: 2, moodlet: 'wish-done' },
	},
	{
		id: 'perth-kings-park',
		title: '上山看城',
		loc: 'perth',
		chapter: 1,
		intro: '工作和住处有着落了，找个周末从市中心一路走上国王公园，站高一点看看这座城。',
		outro: '从山上看下去，你上班的那条街、住的那片区都能指出来。这座城开始有你的位置了。',
		stops: [
			{ ref: 'osm-way-4957439', name: 'Supreme Court Gardens', lat: -31.958151, lon: 115.860116, text: '河边的花园，周末常有人在这里办活动。', fx: { needs: { fun: 4 } } },
			{ ref: 'seed-kings-park', name: '国王公园 Kings Park', lat: -31.9609, lon: 115.832, text: '爬上山坡，整个市中心和天鹅河都在脚下。', fx: { needs: { fun: 8 }, skills: { stamina: 0.5 } }, event: 'trail-city-view', along: 'trail-along-stairs' },
			{ ref: 'osm-way-151266667', name: 'Western Australian Botanic Garden', lat: -31.964206, lon: 115.840175, text: '植物园里种满了本地植物，牌子上写着它们的名字。', fx: { needs: { fun: 6, energy: 3 } } },
		],
		reward: { cash: 60, respect: 3, moodlet: 'wish-done' },
	},
];

export const getTrail = (id: string): TrailDef | undefined => TRAILS.find((t) => t.id === id);
