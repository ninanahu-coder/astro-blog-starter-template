import { CASH_CUSHION } from '../core/engine.ts';

export interface CashConfirmInput {
	label: string;
	cash: number;
	cost: number;
	rent: number;
}

/**
 * 一次性付款会把现金压到应急线以下时，生成二次确认文案；否则不确认。
 * 这是纯 UI 判断，不执行动作，也不替代服务端对价格、余额和规则的权威校验。
 */
export function lowCashConfirm(input: CashConfirmInput): string | undefined {
	const cash = Math.round(input.cash);
	const cost = Math.round(input.cost);
	const roundedRent = Math.round(input.rent);
	const rent = Number.isFinite(roundedRent) ? Math.max(0, roundedRent) : 0;
	// 花不起的动作会由按钮或服务端拒绝，不先弹一份不可能发生的“负余额”确认。
	if (!Number.isFinite(cash) || !(cost > 0) || !Number.isFinite(cost) || cost > cash || cash - cost >= CASH_CUSHION) return undefined;
	const left = cash - cost;
	return `${input.label}要扣 $${cost.toLocaleString('en-US')}；操作后现金剩 $${left.toLocaleString('en-US')}，低于应急线 $${CASH_CUSHION}。下周房租 $${rent.toLocaleString('en-US')}。仍要继续吗？`;
}
