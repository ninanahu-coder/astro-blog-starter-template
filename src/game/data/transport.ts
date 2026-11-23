// 公共交通与步行（第 32 批，设计见 docs/earth-game/transport-design.md）。
// 规则：票价只写有出处的数字；出处是「推算」的在 fareNote 里写明怎么推的。
// 车速、候车时间、运营时段、步行消耗都不是真实时刻表，是游戏设定，统一标「待平衡」。
import type { Hours, NeedKey } from '../core/types.ts';

export type FareNote = 'official' | 'derived';

/** 一条公共交通线路：在两个游戏地点之间开，双向同价 */
export interface TransitService {
	id: string;
	a: string;
	b: string;
	/** 'transit' 市内公交/火车/轻轨（Transperth、Adelaide Metro），'rail' 区域火车（Transwa） */
	mode: 'transit' | 'rail';
	icon: string;
	name: string; // 界面上的线路名
	operator: string;
	fare: number; // 成人单程票价（澳元）
	fareNote: FareNote; // official：官方票价表原数；derived：由官方公布的数字推算
	source: string; // 出处：网址 + 查询日期（推算方法、原文数字见 docs/earth-game/transport-design.md §2）
	kmh: number; // 平均运行速度（含停站），按「直线 × 1.25 的公路距离」折算，待平衡；火车直线跑，所以比实际车速写得高
	wait: number; // 平均候车分钟，待平衡
	hours: Hours; // 当天能上车的时段，待平衡（不是真实首末班）
	freeWeekday?: number; // 这一天免费（weekdayOf：0 = 周一 … 6 = 周日）
}

export const TRANSIT: TransitService[] = [
	{
		id: 'transperth-fremantle', a: 'perth', b: 'fremantle', mode: 'transit', icon: '🚆', name: 'Transperth 弗里曼特尔线', operator: 'Transperth',
		fare: 3.5, fareNote: 'official', freeWeekday: 6,
		source: 'transperth.wa.gov.au/tickets-fares/fares 2026-11-20',
		kmh: 45, wait: 8, hours: [5, 24],
	},
	{
		id: 'transperth-mandurah', a: 'perth', b: 'mandurah', mode: 'transit', icon: '🚆', name: 'Transperth 曼杜拉线', operator: 'Transperth',
		fare: 3.5, fareNote: 'official', freeWeekday: 6,
		source: 'transperth.wa.gov.au/tickets-fares/fares 2026-11-20',
		kmh: 75, wait: 10, hours: [5, 24],
	},
	{
		id: 'adelaide-metro-glenelg', a: 'adelaide', b: 'glenelg', mode: 'transit', icon: '🚋', name: 'Adelaide Metro 格莱内尔格电车', operator: 'Adelaide Metro',
		fare: 4.75, fareNote: 'official',
		source: 'en.wikipedia.org/wiki/MetroCARD 2026-11-20（转载 2026-10-01 起票价表）',
		kmh: 25, wait: 8, hours: [5, 24],
	},
	{
		id: 'transwa-australind', a: 'perth', b: 'bunbury', mode: 'rail', icon: '🚄', name: 'Transwa Australind 火车', operator: 'Transwa',
		fare: 18, fareNote: 'derived',
		source: 'wa.gov.au 媒体通稿 2025-06-19（往返省 $36 → 单程 $18）',
		kmh: 75, wait: 30, hours: [6, 19],
	},
	{
		id: 'transwa-prospector', a: 'perth', b: 'kalgoorlie', mode: 'rail', icon: '🚄', name: 'Transwa Prospector 火车', operator: 'Transwa',
		fare: 50, fareNote: 'derived',
		source: 'wa.gov.au 媒体通稿 2025-06-19（往返省 $100 → 单程 $50）',
		kmh: 85, wait: 45, hours: [6, 16],
	},
];

/**
 * 已有渡轮路线（wa-base / sa-base 里 mode 'ferry' 的 Route）的真实票价，替换原来的统一 $40。
 * 耗时仍按引擎原来的 45 分钟，渡轮停航仍由天气决定（不在这里管）。
 */
export interface RouteFare {
	a: string;
	b: string;
	fare: number;
	fareNote: FareNote;
	operator: string;
	source: string;
}

export const ROUTE_FARES: RouteFare[] = [
	{
		a: 'fremantle', b: 'rottnest', fare: 44, fareNote: 'derived', operator: 'Rottnest Express',
		source: 'rottnestexpress.com.au/ferry-bookings/fares 2026-11-20（同日往返 $87.50 ÷ 2）',
	},
	{
		a: 'cape-jervis', b: 'kangaroo-island', fare: 49, fareNote: 'official', operator: 'SeaLink',
		source: 'sealink.com.au/kangaroo-island-ferry/fares 2026-11-20',
	},
];

/** 步行（待平衡）：只开放给公路距离不超过 maxKm 的路线；不花钱，但更累更脏，顺便练体能 */
export const WALK: { maxKm: number; kmh: number; needs: Partial<Record<NeedKey, number>>; staminaPerKm: number } = {
	maxKm: 15,
	kmh: 4.5,
	needs: { energy: -0.04, hygiene: -0.02, fun: 0.01 }, // 每分钟，叠加在正常衰减之上
	staminaPerKm: 1 / 10,
};
