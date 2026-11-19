// 二手市场「邻里换手墙」：玩家在城镇的分类信息板上买卖二手家具、电器、车和户外用品（见 docs/earth-game/secondhand.md）。
// 名字和界面是原创的，不用任何真实平台的品牌。数值全部【待平衡】，不是平衡结论。
import type { LocationKind, SeasonKey } from '../core/types.ts';

export const SWAP_NAME = '邻里换手墙';

export type SwapKind = 'item' | 'furniture' | 'vehicle';

/** 能在换手墙上买卖的东西：引用已有的物品、家具、车型 id，价格以它们的新品价为准 */
export interface SwapGood {
	kind: SwapKind;
	ref: string;
	cat: string; // 显示分类
	weight: number; // 每天挂出来的相对频率（待平衡）
}

export const SWAP_GOODS: SwapGood[] = [
	{ kind: 'furniture', ref: 'mattress', cat: '家具', weight: 5 },
	{ kind: 'furniture', ref: 'kingbed', cat: '家具', weight: 2 },
	{ kind: 'furniture', ref: 'plants', cat: '家具', weight: 3 },
	{ kind: 'furniture', ref: 'designer', cat: '家具', weight: 1 },
	{ kind: 'furniture', ref: 'cookset', cat: '电器', weight: 4 },
	{ kind: 'furniture', ref: 'heater', cat: '电器', weight: 2 },
	{ kind: 'furniture', ref: 'stereo', cat: '电器', weight: 2 },
	{ kind: 'furniture', ref: 'espresso', cat: '电器', weight: 2 },
	{ kind: 'furniture', ref: 'console', cat: '电器', weight: 3 },
	{ kind: 'item', ref: 'surfboard', cat: '冲浪户外', weight: 3 },
	{ kind: 'item', ref: 'swag', cat: '冲浪户外', weight: 2 },
	{ kind: 'item', ref: 'rod', cat: '冲浪户外', weight: 2 },
	{ kind: 'item', ref: 'jerrycan', cat: '冲浪户外', weight: 1 },
	{ kind: 'vehicle', ref: 'motorbike', cat: '车', weight: 1 },
	{ kind: 'vehicle', ref: 'car', cat: '车', weight: 2 },
	{ kind: 'vehicle', ref: '4wd', cat: '车', weight: 1 },
	{ kind: 'vehicle', ref: 'campervan', cat: '车', weight: 0.5 },
];

/**
 * 规则数值（全部待平衡）。价格都以「保底回收比例 e」为单位：
 * 家具 e = 家具折现比例（0.5），车 e = 车型的 resale，装备 e = SWAP.itemExit。
 * 不变量（测试守着）：二手标价下限 e × floorOver ＞ 卖给买家的最高价 e × 季节卖价上限 × flagBonus，
 * 所以「换手墙上买、再卖回去（换手墙、车行、家具折现）」永远不赚钱。
 */
export const SWAP = {
	/** 有换手墙的地点类型 */
	kinds: ['city', 'port', 'town', 'coast', 'mining'] as LocationKind[],
	/** 每天本地挂单条数（另外再挂 remote 条外地的） */
	listings: { city: 6, other: 4 } as { city: number; other: number },
	remote: 1,
	/** 上门看货自提的时间段（整点 [开, 关)） */
	pickupHours: [7, 21] as [number, number],
	/** 二手标价下限 = 新品价 × e × floorOver；上限 = 新品价 × askTop（再乘季节系数，不超过新品价） */
	floorOver: 1.25,
	askTop: 0.92,
	/** 装备（冲浪板、睡袋……）的保底回收比例：和商店分支二手店回收 40% 对齐 */
	itemExit: 0.4,
	/** 一条挂单带红旗的几率；带红旗的挂单里「价格低一大截」直接标在保底价 */
	flagChance: 0.35,
	/** 骗局几率 = baseScam + 各红旗权重之和，上限 maxScam；没红旗的买家一定是真的 */
	baseScam: 0.03,
	maxScam: 0.9,
	/** 砍价：成功率 = base + 魅力 × perCharisma + 季节修正，钳在 [min, max]；成功后按挂单的 disc 打折（不低于标价下限） */
	haggle: { base: 0.3, perCharisma: 0.004, min: 0.1, max: 0.85, discLo: 0.05, discHi: 0.15, minutes: 10 },
	/** 上门看货、试车、先转账的耗时（分钟） */
	pickupMinutes: 45,
	testDriveMinutes: 90,
	prepayMinutes: 10,
	/** 先转账让对方送货的运费；自提家具又没有车时也要付这笔「找人帮搬」 */
	delivery: { item: 15, furniture: 60, vehicle: 150 } as Record<SwapKind, number>,
	/** 卖东西：每个游戏日最多卖几次；每次出现几个买家；买家出价下浮；带红旗的买家出价高一点（诱饵） */
	sellDaily: 3,
	buyers: 3,
	offerLo: 0.92,
	flagBonus: 1.08,
	/** 等钱真正到账 / 当面收现金再交货，和看截图就交货的耗时 */
	verifyMinutes: 30,
	quickMinutes: 5,
	/** 车按里程打折：系数 = max(kmFloor, 1 − 公里数 / kmScale)；挂单车的里程在 kmLo–kmHi 之间 */
	kmScale: 500_000,
	kmFloor: 0.6,
	kmLo: 20_000,
	kmHi: 220_000,
	/** 存档里「今天处理过的挂单」最多记几条 */
	doneMax: 40,
};

/** 挂单上的红旗（卖家这一侧的骗局信号）：预付诈骗 */
export interface SwapFlag {
	id: string;
	text: string;
	weight: number; // 加到骗局几率上
	refund?: number; // 只用于买家红旗：被骗时还要「退差价」的比例
}

export const LISTING_FLAGS: SwapFlag[] = [
	{ id: 'cheap', text: '价格比同类低一大截', weight: 0.25 },
	{ id: 'remote', text: '卖家说人在外地，只能先转账再寄过来', weight: 0.35 },
	{ id: 'rush', text: '催你今天就先付定金，说好几个人在问', weight: 0.2 },
	{ id: 'giftcard', text: '只收礼品卡或加密货币', weight: 0.4 },
	{ id: 'newbie', text: '账号刚注册，没有任何评价', weight: 0.1 },
];

/** 买家红旗（你卖东西时）：假付款 */
export const BUYER_FLAGS: SwapFlag[] = [
	{ id: 'screenshot', text: '发来一张「已付款」截图，要你先交货', weight: 0.5 },
	{ id: 'overpay', text: '说多转了钱，让你先把差价退回去', weight: 0.6, refund: 0.3 },
	{ id: 'courier', text: '说会派「快递员」上门取货，本人不露面', weight: 0.35 },
	{ id: 'link', text: '发来一个「收款链接」，让你登录网银确认', weight: 0.6 },
];

/** 搬家季：开学、毕业前后供需变化。ask 标价系数、sell 卖价系数、supply 每天多挂几条、haggle 砍价成功率修正（待平衡） */
export interface SwapSeason {
	id: string;
	name: string;
	season: SeasonKey;
	day: number; // 季内第几天开始
	days: number;
	ask: number;
	sell: number;
	supply: number;
	haggle: number;
	desc: string;
}

/**
 * 日期是按游戏日历（每季 28 天，南半球季节）对现实学期的粗略换算，未核实具体院校校历：
 * 第一学期二月底开学 ≈ 夏季第 20 天起；第二学期七月下旬 ≈ 冬季第 17 天起；年底毕业退租 ≈ 春季第 22 天起（跨进夏季）。
 */
export const SWAP_SEASONS: SwapSeason[] = [
	{ id: 'sem1', name: '开学季', season: 'summer', day: 20, days: 10, ask: 1.08, sell: 1.1, supply: -1, haggle: -0.1, desc: '新生和换房的人都在找家具电器，东西少、卖得上价，不好砍。' },
	{ id: 'sem2', name: '年中开学', season: 'winter', day: 17, days: 6, ask: 1.04, sell: 1.05, supply: 0, haggle: -0.05, desc: '第二学期开学，求购的帖子多了一些。' },
	{ id: 'grad', name: '毕业搬家季', season: 'spring', day: 22, days: 10, ask: 0.9, sell: 0.85, supply: 2, haggle: 0.1, desc: '毕业生退租回国，满墙都是清仓的，好砍价，但自己的东西也卖不上价。' },
];

/** 平常日子 */
export const SWAP_NORMAL: SwapSeason = { id: 'normal', name: '平常', season: 'summer', day: 1, days: 0, ask: 1, sell: 1, supply: 0, haggle: 0, desc: '' };

/** 防骗提示：被骗或识破骗局后写进日志 */
export const SWAP_TIPS: Record<string, string> = {
	prepay: '没见到东西不先转账；坚持看货、当面付款，外地卖家可以走带担保的付款方式。',
	fake: '截图不等于到账。等钱真的进了你的账户，或者当面收现金，再交货。',
	overpay: '「多付了请退差价」是经典骗局：原来那笔钱根本不存在。',
	link: '不要点陌生人发来的「收款链接」登录网银：收钱不需要你登录任何东西。',
};
