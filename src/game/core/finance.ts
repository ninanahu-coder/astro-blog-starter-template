// 房产与贷款的基础公式：纯函数，只依赖类型。引擎、派生属性、模拟和测试共用。
import type { OwnedProperty, PropertyDef } from './types.ts';

export const FINANCE = {
	minDown: 0.1, // 最低首付比例（模拟后从 0.2 下调：上班族约 4 个月能付得起首付）
	weeklyRate: 0.001, // 每周利率（年化约 5%）
	weeklyPrincipal: 0.005, // 每周归还的本金 = 房价 × 该比例（九成贷款约 180 周还清）
	sellShare: 0.95, // 正常卖房到手比例（扣中介费）
	forecloseShare: 0.85, // 断供强制卖房到手比例
	graceWeeks: 2, // 连续欠款超过这么多周就强制卖房
	vacancy: 0.05, // 出租时每周空置概率
	repairChance: 1 / 12, // 出租时每周发生维修的概率
	repairMin: 0.002, // 维修费 = 房价 × [min, max]
	repairMax: 0.006,
	yieldCap: 0.04, // 设计约束：出租的期望年化净收益不超过房价的这个比例
};

/** 存档里一套房的贷款最多能是多少：房价，降过价的按以前最高的房价（旧存档按原价贷的款不抹掉） */
export const loanCap = (def: PropertyDef) => Math.max(def.price, def.priceWas ?? 0);

/** 贷款买房的首付金额 */
export const downPayment = (def: PropertyDef) => Math.round(def.price * FINANCE.minDown);

/** 本周利息。rateMult：世界事件的利率系数（core/world.ts 的 loanRateMult），不传为 1 */
export const weeklyInterest = (loan: number, rateMult = 1) => Math.round(loan * FINANCE.weeklyRate * rateMult);

/** 本周应还本金（不超过剩余贷款） */
export const weeklyPrincipal = (def: PropertyDef, loan: number) => Math.min(loan, Math.round(def.price * FINANCE.weeklyPrincipal));

/** 本周还款额 = 利息 + 本金；没有贷款为 0 */
export const loanPayment = (def: PropertyDef, loan: number, rateMult = 1) => (loan > 0 ? weeklyInterest(loan, rateMult) + weeklyPrincipal(def, loan) : 0);

/** 一套房每周必须付的钱：物业费 + 还款 */
export const propertyDue = (def: PropertyDef, owned: OwnedProperty, rateMult = 1) => def.weekly + loanPayment(def, owned.loan, rateMult);

/** 还清贷款还要多少周（按固定本金估算） */
export const weeksToPayOff = (def: PropertyDef, loan: number) => Math.ceil(loan / Math.max(1, Math.round(def.price * FINANCE.weeklyPrincipal)));

/** 卖房到手 = 房价 × 比例 − 剩余贷款（不会为负） */
export const saleProceeds = (def: PropertyDef, loan: number, share = FINANCE.sellShare) => Math.max(0, Math.round(def.price * share) - loan);

/** 卖房日志里「到手多少」那半句。卖价不够还贷时短缺直接免掉，不再写「还清贷款」（第十三轮） */
export function saleNote(def: PropertyDef, loan: number, share = FINANCE.sellShare): string {
	const gross = Math.round(def.price * share);
	if (!loan) return `到手 $${gross}`;
	if (gross >= loan) return `还清贷款 $${loan} 后到手 $${gross - loan}`;
	return `卖价 $${gross} 抵贷款 $${loan}；不足的 $${loan - gross} 已免除，到手 $0`;
}

/** 一套房计入净资产的价值（按正常卖出估算） */
export const propertyEquity = (def: PropertyDef, loan: number) => saleProceeds(def, loan);

/** 维修费范围 */
export const repairRange = (def: PropertyDef): [number, number] => [Math.round(def.price * FINANCE.repairMin), Math.round(def.price * FINANCE.repairMax)];

/**
 * 全款持有并出租的期望年化净收益率（不含利息）：
 * (租金 × (1 − 空置率) − 物业费 − 期望维修费) × 52 / 房价
 */
export function expectedYield(def: PropertyDef): number {
	const repair = FINANCE.repairChance * ((FINANCE.repairMin + FINANCE.repairMax) / 2) * def.price;
	return ((def.rentIncome * (1 - FINANCE.vacancy) - def.weekly - repair) * 52) / def.price;
}

// ---------- 车辆过户印花税（第 26 批） ----------
/**
 * 买车时按车价交的印花税，用的是真实公式（来源见 docs/earth-game/home-and-vehicle.md）；在游戏里收不收、按什么价收是游戏设定（待平衡）。
 * - 西澳 vehicle licence duty（轻型车）：≤ $25,000 按 2.75%；$25,000–$50,000 按 R = 2.75 + (价 − 25,000) / 6,666.66（保留两位小数）%；> $50,000 按 6.5%
 * - 南澳非商用车：≤ $1,000 每 $100（不足按 $100）$1、最低 $5；≤ $2,000 为 $10 + 超出部分每 $100 $2；≤ $3,000 为 $30 + 每 $100 $3；以上为 $60 + 每 $100 $4
 * 其他区域按西澳算。结果取整到元。
 */
export function vehicleDuty(value: number, area: string): number {
	const v = Math.max(0, value);
	if (area === 'sa') {
		const per100 = (over: number) => Math.ceil(over / 100);
		if (v <= 1000) return Math.max(5, per100(v));
		if (v <= 2000) return 10 + 2 * per100(v - 1000);
		if (v <= 3000) return 30 + 3 * per100(v - 2000);
		return 60 + 4 * per100(v - 3000);
	}
	const rate = v <= 25000 ? 2.75 : v <= 50000 ? Math.round((2.75 + (v - 25000) / 6666.66) * 100) / 100 : 6.5;
	return Math.round((v * rate) / 100);
}
