// 房产与贷款的基础公式：纯函数，只依赖类型。引擎、派生属性、模拟和测试共用。
import type { OwnedProperty, PropertyDef } from './types.ts';

export const FINANCE = {
	minDown: 0.2, // 最低首付比例
	weeklyRate: 0.001, // 每周利率（年化约 5%）
	weeklyPrincipal: 0.005, // 每周归还的本金 = 房价 × 该比例（八成贷款约 160 周还清）
	sellShare: 0.95, // 正常卖房到手比例（扣中介费）
	forecloseShare: 0.85, // 断供强制卖房到手比例
	graceWeeks: 2, // 连续欠款超过这么多周就强制卖房
	vacancy: 0.05, // 出租时每周空置概率
	repairChance: 1 / 12, // 出租时每周发生维修的概率
	repairMin: 0.002, // 维修费 = 房价 × [min, max]
	repairMax: 0.006,
	yieldCap: 0.04, // 设计约束：出租的期望年化净收益不超过房价的这个比例
};

/** 贷款买房的首付金额 */
export const downPayment = (def: PropertyDef) => Math.round(def.price * FINANCE.minDown);

/** 本周利息 */
export const weeklyInterest = (loan: number) => Math.round(loan * FINANCE.weeklyRate);

/** 本周应还本金（不超过剩余贷款） */
export const weeklyPrincipal = (def: PropertyDef, loan: number) => Math.min(loan, Math.round(def.price * FINANCE.weeklyPrincipal));

/** 本周还款额 = 利息 + 本金；没有贷款为 0 */
export const loanPayment = (def: PropertyDef, loan: number) => (loan > 0 ? weeklyInterest(loan) + weeklyPrincipal(def, loan) : 0);

/** 一套房每周必须付的钱：物业费 + 还款 */
export const propertyDue = (def: PropertyDef, owned: OwnedProperty) => def.weekly + loanPayment(def, owned.loan);

/** 还清贷款还要多少周（按固定本金估算） */
export const weeksToPayOff = (def: PropertyDef, loan: number) => Math.ceil(loan / Math.max(1, Math.round(def.price * FINANCE.weeklyPrincipal)));

/** 卖房到手 = 房价 × 比例 − 剩余贷款（不会为负） */
export const saleProceeds = (def: PropertyDef, loan: number, share = FINANCE.sellShare) => Math.max(0, Math.round(def.price * share) - loan);

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
