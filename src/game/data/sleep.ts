// 睡眠与作息的数值表（第 43 批，设计见 docs/earth-game/time-sleep.md）。
// 规则在 core/sleep.ts，这里只放数。标「待平衡」的都是第一版初始值，等 Codex 跑平衡分析再定；Claude 不下平衡结论。
import type { LocationKind } from '../core/types.ts';

export const SLEEP = {
	/** 一觉的长度（分钟）：回家睡、睡车、住旅馆、露营都是 8 小时【现状】 */
	fullMinutes: 480,
	/** 补觉（小睡）的长度（分钟）【新，待平衡】 */
	napMinutes: 120,
	/** 补觉恢复的精力（满质量时）【新，待平衡】：约等于整觉 100 的 2/8，略多一点，鼓励白天补一下 */
	napEnergy: 30,
	/** 醒着超过这么多分钟才开始记睡眠债（熬夜）【新，待平衡】 */
	awakeOkMinutes: 16 * 60,
	/** 熬夜每多醒 1 小时记几小时睡眠债【新，待平衡】 */
	debtPerHour: 1,
	/** 睡眠债上限（小时）【新，待平衡】 */
	debtMax: 24,
	/** 每睡 1 小时（乘睡眠质量）还几小时债：补觉还不全，熬掉的觉只能还一半【新，待平衡】 */
	repayPerHour: 0.5,
	/** 补觉把「已经醒了多久」往回拨：每睡 1 分钟拨回这么多分钟【新，待平衡】 */
	napResetMult: 3,
	/** 醒来时还欠这么多小时以上，挂「熬夜没缓过来」【新，待平衡】 */
	debtMoodletAt: 4,
	/** 睡眠质量低于它，挂「没睡好」（沿用已有的 rough-night），并且不发效果里写的「睡了个好觉」【新，待平衡】 */
	poorAt: 0.75,
	goodMoodlet: 'great-sleep',
	/** 睡眠质量的上下限【新，待平衡】 */
	qualityMin: 0.4,
	qualityMax: 1.1,
	/** 按时睡：入睡钟点落在 [开, 关)（跨午夜）算「夜里睡」；其他时候睡乘 offHoursMult【新，待平衡】 */
	nightHours: [20, 3] as [number, number],
	offHoursMult: 0.85,
	/** 时差：每差 1 小时质量 −perHour，每过一个游戏日倒回 recoverPerDay 小时【新，待平衡】。
	 *  「大约一天调一个时区」是常见经验说法，不是精确医学结论 */
	jetlag: { perHour: 0.05, recoverPerDay: 1 },
};

/** 床（睡在哪）的基础质量【新，待平衡】。住处按舒适度加，床位家具再加 */
export const BED = {
	home: { base: 0.9, perComfort: 0.01, bedFurniture: 0.1 },
	vehicle: 0.85, // 露营车 / 房车
	motel: 0.95,
	camp: 0.8, // 帐篷：露营另有「星空下醒来」的心情，不重复奖励
} as const;
export type BedKind = 'home' | 'vehicle' | 'motel' | 'camp';

/** 地点类型的夜间噪音，从质量里扣【新，待平衡】。城市夜生活和车流最吵，矿区有 24 小时作业，野外安静 */
export const NOISE: Partial<Record<LocationKind, number>> = {
	city: 0.06,
	port: 0.04,
	mining: 0.04,
	town: 0.01,
};

/**
 * 出身 → 来澳洲之前生活地的时区（分钟，UTC 偏移）。null 表示本地人，没有时差。
 * 【假设，待用户确认】玩家主要是华人和留学生：留学生、背包客（打工度假）按从 UTC+8 的华语地区飞来算；
 * 矿区轮班工、冲浪手按本来就住在澳洲算。西澳也是 UTC+8，所以只有落地南澳（UTC+9:30，夏令时 +10:30）才有时差。
 */
export const ORIGIN_TZ: Record<string, number | null> = {
	student: 8 * 60,
	backpacker: 8 * 60,
	fifo: null,
	surfer: null,
};
