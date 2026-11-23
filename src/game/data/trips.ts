// 离开地图的旅行（第 43 批）：跨州（墨尔本、悉尼、布里斯班）和回国探亲。
// 票价只用查得到出处的数字；出处、查询日期、换算方法见 docs/earth-game/travel.md §3。
// 标「待平衡」的是游戏设定，不是真实数据，等 Codex 跑模拟后再调。
import type { NeedKey, SeasonKey } from '../core/types.ts';

export type TripKind = 'interstate' | 'home';

/** 从某个机场出发的一条航线 */
export interface TripFare {
	/** 出发的游戏地点（只有州府机场有这些航线） */
	from: string;
	/** 往返票价下限（澳元）：出处里最便宜的那个数，单程的已 ×2 */
	low: number;
	/** 往返票价上限（澳元）：有出处写出处；没有就按 BITRE 指数比例推算（见 derived） */
	high: number;
	/** 出处里查到的航程，只写查到的（分钟）；没查到不写，游戏里也不显示 */
	flightMin?: number;
	/** 航司、直飞还是中转，给玩家看 */
	carrier: string;
	/** 短出处（首屏有体积上限，完整出处在文档） */
	source: string;
	/** official：出处原数；derived：按出处推算；verify：借用相邻数据，待人工核对 */
	note: 'official' | 'derived' | 'verify';
	/** 比出发地快几小时（不算夏令时，见文档 §3.3）；≥ 2 小时回来有时差 */
	tz: number;
}

export interface AwayDest {
	id: string;
	name: string;
	icon: string;
	kind: TripKind;
	blurb: string;
	fares: TripFare[];
	/** 可选的天数（待平衡） */
	days: number[];
	/** 带回来的纪念品（data/items.ts 里 shop 为空、商店不卖的物品）和数量 */
	souvenir: { item: string; n: number };
}

const BITRE = 'BITRE 国内票价指数 2025-12 / 2026-01（76.0 / 62.1）';
/** 国内旺季倍率：BITRE 最便宜折扣票指数 12 月 76.0 ÷ 1 月 62.1，取两位小数。只用来推算上限，不是真实某条航线的票价 */
export const DOMESTIC_PEAK_RATIO = 1.22;
const dom = (from: string, oneWay: number, carrier: string, source: string, tz: number, flightMin?: number): TripFare => ({
	from, low: oneWay * 2, high: Math.round(oneWay * 2 * DOMESTIC_PEAK_RATIO), carrier, source: `${source}；上限按${BITRE}推算`, note: 'derived', tz, ...(flightMin ? { flightMin } : {}),
});

export const AWAY_DESTS: AwayDest[] = [
	{
		id: 'melbourne', name: '墨尔本', icon: '☕', kind: 'interstate', blurb: '维多利亚州首府，小巷咖啡馆和电车。',
		fares: [
			dom('perth', 329, 'Qantas 直飞', 'Qantas 2026-06/07 促销单程 $329', 2),
			dom('adelaide', 99, 'Qantas 直飞', 'Qantas 2026 促销单程 $99', 0.5),
		],
		days: [3, 5, 7], souvenir: { item: 'souvenir-mel', n: 1 },
	},
	{
		id: 'sydney', name: '悉尼', icon: '🌉', kind: 'interstate', blurb: '新州首府，港湾大桥和歌剧院。',
		fares: [
			dom('perth', 299, 'Qantas 直飞', 'Qantas 2026-07 促销单程 $299', 2),
			dom('adelaide', 149, 'Qantas 直飞', 'Qantas 促销单程 $149', 0.5),
		],
		days: [3, 5, 7], souvenir: { item: 'souvenir-syd', n: 1 },
	},
	{
		id: 'brisbane', name: '布里斯班', icon: '🌴', kind: 'interstate', blurb: '昆士兰州首府，一年四季都暖和。',
		fares: [dom('perth', 299, 'Qantas 直飞', 'Qantas 2026-08 红尾促销单程 $299', 2)],
		days: [3, 5, 7], souvenir: { item: 'souvenir-bne', n: 1 },
	},
	{
		id: 'home-cn', name: '回国探亲', icon: '🏮', kind: 'home', blurb: '经广州入境，回家看看爸妈。到家以后的国内段不另算。',
		fares: [
			{ from: 'perth', low: 773, high: 1423, flightMin: 470, carrier: '南航 CZ320 直飞广州（往返）', source: 'Google Flights 2026-11 往返 A$773 起；Trip.com 12 月直飞往返 AU$1,423；航程 7 小时 50 分', note: 'official', tz: 0 },
			{ from: 'adelaide', low: 663, high: 1423, carrier: '南航 CZ664 直飞广州（往返）', source: 'Air Traveler Club 2026-10 全澳出发往返 A$663 起；上限借用珀斯直飞数据', note: 'verify', tz: -1.5 },
		],
		days: [7, 14, 21], souvenir: { item: 'souvenir-home', n: 2 },
	},
];

/**
 * 票价季节：落在这些日子里的出发日按 demand 把票价往上限推（0 = 下限，1 = 上限）。几段重叠取最大。
 * 日子按游戏日历（春 = 9–11 月，夏 = 12–2 月，秋 = 3–5 月，冬 = 6–8 月，每季 28 天）大致对上真实月份；demand 都是待平衡。
 */
export interface FareSeason {
	id: string;
	name: string;
	season: SeasonKey;
	day: number;
	days: number;
	demand: Record<TripKind, number>;
	why: string;
}

export const FARE_SEASONS: FareSeason[] = [
	{ id: 'xmas', name: '圣诞和暑假', season: 'summer', day: 1, days: 18, demand: { interstate: 1, home: 0.8 }, why: 'BITRE 12 月折扣票指数比 1 月高约 22%；南航 12-01 至次年 03-10 把珀斯、阿德莱德—广州加到每天一班' },
	{ id: 'cny', name: '春节', season: 'summer', day: 16, days: 10, demand: { interstate: 0.3, home: 1 }, why: '春节在 1 月下旬到 2 月中旬，落在南航加班期里' },
	{ id: 'midyear', name: '年中假期', season: 'winter', day: 1, days: 8, demand: { interstate: 0.6, home: 0.6 }, why: '西澳学校 7 月初放假，大学年中放假' },
	{ id: 'golden-week', name: '国庆和春季假期', season: 'spring', day: 9, days: 7, demand: { interstate: 0.4, home: 0.6 }, why: '西澳学校 9 月底到 10 月初放假，国内 10 月 1–7 日放假' },
];

/** 离开期间：一天按多少分钟算（整天，不按航班时刻） */
export const TRIP_DAY_MIN = 1440;
/** 能离开的天数范围（待平衡） */
export const TRIP_DAYS = { min: 2, max: 28 };
/**
 * 有工作时最多请几天假，超过就被辞退（待平衡）。
 * 依据：《公平工作法》全职每年 4 周年假；游戏一年 112 天，4/52 × 112 ≈ 9 天。临时工没有带薪假，这里不区分。
 */
export const JOB_LEAVE_DAYS = 9;
/** 时差到几小时以上回来算倒时差（待平衡） */
export const JETLAG_TZ = 2;

/** 回来时各项需求的值：旅途中吃住都有着落，不按普通时间流逝扣（待平衡） */
export const RETURN_NEEDS: Record<TripKind, Record<NeedKey, number>> = {
	interstate: { hunger: 70, energy: 55, hygiene: 70, fun: 90, social: 70 },
	home: { hunger: 90, energy: 50, hygiene: 80, fun: 80, social: 95 },
};

/** 行李清单：每类用现有物品里任一件就算带了；没带的到了当地补买（待平衡） */
export interface PackingRow {
	id: string;
	label: string;
	items: string[];
	kinds: TripKind[];
	/** 没带的话在当地补买花多少 */
	missCost: number;
}

export const PACKING: PackingRow[] = [
	{ id: 'rain', label: '雨具', items: ['umbrella', 'raincoat'], kinds: ['interstate'], missCost: 25 },
	{ id: 'sun', label: '防晒', items: ['sunscreen', 'sunhat'], kinds: ['interstate', 'home'], missCost: 20 },
	{ id: 'aid', label: '常用药和创可贴', items: ['firstaid'], kinds: ['interstate', 'home'], missCost: 30 },
	{ id: 'snack', label: '路上的零食', items: ['snack'], kinds: ['interstate', 'home'], missCost: 10 },
];

/** 不对应物品的提醒，只显示（证件、签证这些游戏里没有物品） */
export const PACKING_REMINDERS: Record<TripKind, string[]> = {
	interstate: ['驾照或身份证（国内航班登机要）', '手机充电器'],
	home: ['护照和澳洲签证（回来入境要查）', '转换插头（国内是 A/C/I 型插座）', '入境卡：带食物一律申报'],
};

/** 回来时可能抽到的事件（按顺序看，命中第一个满足条件、掷骰过了的；chance 待平衡） */
export interface ReturnEventRule {
	id: string;
	kinds: TripKind[];
	needHome?: boolean;
	chance: number;
}

export const RETURN_EVENTS: ReturnEventRule[] = [
	{ id: 'trip-biosecurity', kinds: ['home'], chance: 0.7 },
	{ id: 'trip-mailbox', kinds: ['interstate', 'home'], needHome: true, chance: 0.5 },
	{ id: 'trip-jetlag-night', kinds: ['interstate', 'home'], chance: 0.4 },
];

/** 州内自驾游规划：每天最多开几小时（待平衡） */
export const ROAD_TRIP_DRIVE_MIN_PER_DAY = 6 * 60;
