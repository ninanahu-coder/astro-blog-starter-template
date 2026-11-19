// 世界事件（第 43 批，设计见 docs/earth-game/world-events.md）：全服共享的宏观指标和它们对游戏的影响。
// 指标只由「游戏日」决定（core/world.ts），和天气一样所有玩家看到同一个世界；不用存档里的随机种子。
// 所有周期、幅度、影响系数都「待平衡」。真实数据只用来定量级（历史区间），不跟真实行情挂钩，也不预测真实市场。
export type IndicatorId = 'oil' | 'rate' | 'mining' | 'house' | 'rent' | 'fx';

export interface IndicatorDef {
	id: IndicatorId;
	name: string;
	icon: string;
	/** 周期中心值（游戏开局第 0 天的值，影响系数在这个值上为 1） */
	center: number;
	/** 周期振幅，与 center 同单位 */
	amp: number;
	/** 周期长度（游戏日；一年 112 天） */
	period: number;
	/** 相位（0–1，一个周期的几分之几）。0 和 0.5 都让第 0 天落在中心值上 */
	phase: number;
	/** 每期的小幅扰动上限，与 center 同单位（按「指标 + 期数」哈希，可复现） */
	noise: number;
	/** 多少天更新一次（期内不变） */
	step: number;
	/** 展示用的小数位和单位 */
	decimals: number;
	unit: string;
	/** 新闻门槛：一期变化的绝对值至少这么多才出新闻（利率每次变动都出） */
	newsMin: number;
	/** 真实参照（只定量级） */
	source: string;
}

/**
 * 六个指标。周期中心尽量放在真实历史区间的中段，振幅不超过真实区间。
 * 利率：振幅 1.25、周期 448 天时，每 14 天最多移动约 0.245 个点（< 0.25），取整到 0.25 后每次议息最多变一档（测试检查）。游戏区间 2.75%–5.25%。
 * 房价、租金每 28 天（一季）更新一次，季度报告在每季第 1 天发。
 */
export const INDICATORS: IndicatorDef[] = [
	{
		id: 'rate', name: '现金利率', icon: '🏦', center: 4, amp: 1.25, period: 448, phase: 0, noise: 0, step: 14, decimals: 2, unit: '%', newsMin: 0.01,
		source: 'RBA 现金利率目标 2000–2025 年在 0.10%（2020-11）到 7.25%（2008-03）之间：https://www.rba.gov.au/statistics/cash-rate/ （区间端点未逐条核对原表）',
	},
	{
		id: 'oil', name: '珀斯汽油', icon: '⛽', center: 190, amp: 34, period: 168, phase: 0, noise: 6, step: 7, decimals: 0, unit: '¢/升', newsMin: 4,
		source: '珀斯 ULP 月均价 2016–2025 年大致在 120–220 ¢/升（2022 年中最高）：FuelWatch 历史价格 https://www.fuelwatch.wa.gov.au/ （量级，未逐月核对）',
	},
	{
		id: 'mining', name: '矿业景气', icon: '⛏️', center: 100, amp: 20, period: 336, phase: 0, noise: 3, step: 7, decimals: 0, unit: '点', newsMin: 4,
		source: '游戏自定指数。量级参照铁矿石价格 2015–2025 年在约 US$40（2015-12）到 US$215（2021-05）之间大起大落：World Bank Commodity Price Data (Pink Sheet) （未核对原表），游戏只取温和的 ±20%',
	},
	{
		id: 'house', name: '房价指数', icon: '🏠', center: 100, amp: 8, period: 448, phase: 0.5, noise: 0.6, step: 28, decimals: 1, unit: '点', newsMin: 0.5,
		source: '游戏自定指数，与利率反向（相位差半个周期）。量级参照 REIWA 珀斯房价季度报告（单季涨跌多在 ±5% 以内）：https://reiwa.com.au/ （未核对具体季度）',
	},
	{
		id: 'rent', name: '租金指数', icon: '🔑', center: 100, amp: 6, period: 448, phase: 0.5, noise: 0.4, step: 28, decimals: 1, unit: '点', newsMin: 0.5,
		source: '游戏自定指数，跟房价同向、幅度更小。量级参照 REIWA 珀斯租金报告：https://reiwa.com.au/ （未核对具体季度）',
	},
	{
		id: 'fx', name: '澳元兑人民币', icon: '💱', center: 4.75, amp: 0.3, period: 336, phase: 0, noise: 0.05, step: 7, decimals: 2, unit: '元', newsMin: 0.06,
		source: '只作背景，不能兑换。澳元是商品货币，游戏里跟矿业景气同相位。量级参照 RBA 汇率历史数据 F11（2015–2025 年约 4.4–5.4）：https://www.rba.gov.au/statistics/historical-data.html （未核对原表）',
	},
];

/** 指标最多算到第几天，之后不再变（防止损坏的存档让循环失控；约 55 年） */
export const WORLD_DAYS_MAX = 20000;

/** 对游戏的影响系数（全部待平衡） */
export const WORLD_FX = {
	/** 油价每偏离中心 1%，各出行方式的路费变动多少 %（燃油在票价里的份额，自驾最高） */
	fuelShare: { road: 0.5, track: 0.5, bus: 0.3, air: 0.3, ferry: 0.2 },
	/** 矿业景气每偏离中心 1%，矿业公司工资变动多少 % */
	miningPayShare: 0.5,
	/** 矿业景气低于这个值时，矿业公司暂停招新人（已经在职的照常上班） */
	miningHireFloor: 88,
	/** 房贷利率 = 现金利率 + 这个利差；房贷利息系数 = (当前现金利率 + 利差) / (中心 + 利差) */
	mortgageSpread: 2,
	/** 租金指数每偏离中心 1%，房租和出租收入变动多少 % */
	rentShare: 1,
};

/** 受矿业景气影响的职业（FIFO 工资和招工） */
export const MINING_CAREERS = ['miner'];

export type NewsDir = 'up' | 'down' | 'hold';

/**
 * 新闻原因的文案池：每条新闻按「指标 + 天」哈希挑一条。全部是游戏内虚构说法，不对应任何真实事件。
 * effect 是对玩家说明「这对你意味着什么」。
 */
export const NEWS_TEXT: Record<IndicatorId, Partial<Record<NewsDir, { title: string; reasons: string[]; effect: string }>>> = {
	rate: {
		up: { title: '储备银行加息', reasons: ['通胀连续几个季度高于 2%–3% 的目标区间', '就业市场偏紧，工资涨得快', '服务价格居高不下'], effect: '房贷每周利息跟着涨。' },
		down: { title: '储备银行降息', reasons: ['通胀回落到目标区间', '失业率上升，消费变弱', '海外经济放缓，出口订单减少'], effect: '房贷每周利息跟着降。' },
		hold: { title: '储备银行按兵不动', reasons: ['通胀和就业都在预期之内', '想再观察几个月的数据'], effect: '房贷利息不变。' },
	},
	oil: {
		up: { title: '油价上涨', reasons: ['国际原油供应收紧', '新加坡炼厂检修，成品油进口变贵', '澳元走弱，进口油价变高', '周期性涨价日，加油站集体调价'], effect: '自驾、巴士、机票都跟着贵一点。' },
		down: { title: '油价回落', reasons: ['国际原油需求转弱', '炼厂恢复供应', '澳元走强，进口油价变便宜', '加油站价格战'], effect: '自驾、巴士、机票都便宜一点。' },
	},
	mining: {
		up: { title: '矿业回暖', reasons: ['钢厂补库存，铁矿石订单增加', '锂矿新项目开工', '海外基建计划带动矿石需求'], effect: '矿业公司工资上调。' },
		down: { title: '矿业降温', reasons: ['钢厂减产，铁矿石订单减少', '锂价下跌，几个矿暂缓扩产', '海外需求放缓'], effect: '矿业公司工资下调。' },
	},
	house: {
		up: { title: '季度房价报告：上涨', reasons: ['利率下行，买家的贷款额度变大', '外州移民和留学生持续流入', '新房开工跟不上需求'], effect: '目前只是新闻，房产买卖价格还按标价。' },
		down: { title: '季度房价报告：下跌', reasons: ['利率上行，买家贷款额度变小', '挂牌量增加', '投资客观望'], effect: '目前只是新闻，房产买卖价格还按标价。' },
	},
	rent: {
		up: { title: '季度租金报告：上涨', reasons: ['空置率偏低，看房的人排长队', '开学季学生集中找房', '矿业招工带来新住户'], effect: '房租和出租收入都上调。' },
		down: { title: '季度租金报告：回落', reasons: ['新公寓集中交房，空置率回升', '矿区裁员，有人搬走', '假期过后需求变淡'], effect: '房租和出租收入都下调。' },
	},
	fx: {
		up: { title: '澳元走强', reasons: ['矿产出口收入增加', '利率差扩大'], effect: '家里汇钱过来换到的澳元变少（只作背景，游戏里不能换汇）。' },
		down: { title: '澳元走弱', reasons: ['矿产出口收入减少', '海外避险情绪升温'], effect: '家里汇钱过来换到的澳元变多（只作背景，游戏里不能换汇）。' },
	},
};

/** 新闻页一次最多显示几条、回看多少天 */
export const NEWS_MAX = 8;
export const NEWS_LOOKBACK_DAYS = 28;

export const WORLD_DISCLAIMER = '游戏内虚构的宏观新闻，数值按固定周期变化，不是真实行情，也不构成任何投资建议。';
