// 税务动作：申请 TFN、注册 ABN、报税。规则在 tax.ts（不引用引擎，存档清洗也要用它）。
import { TAX_GAME } from '../data/tax.ts';
import { clone, fail, log } from './engine.ts';
import { hasAbn, settle, tfnState } from './tax.ts';
import { dayOf } from './time.ts';
import type { ActionResult, PlayerState } from './types.ts';

/** 网上申请 TFN：不花钱不花时间，tfnWaitDays 天后拿到号码 */
export function applyTfn(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (prev.tax.tfn >= 0) return fail(prev, tfnState(prev.tax, dayOf(prev.clock)) === 'ok' ? '你已经有 TFN 了。' : 'TFN 已经在办了，等几天。');
	const state = clone(prev);
	state.tax.tfn = dayOf(state.clock) + TAX_GAME.tfnWaitDays;
	const msg = `在 ATO 网站申请了税号（TFN），${TAX_GAME.tfnWaitDays} 天后寄到。等号码期间雇主按正常税率预扣。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 注册 ABN（个体户）：要先有 TFN。之后街头表演算生意收入 */
export function applyAbn(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (hasAbn(prev)) return fail(prev, '你已经有 ABN 了。');
	if (tfnState(prev.tax, dayOf(prev.clock)) !== 'ok') return fail(prev, '注册 ABN 要先有 TFN。');
	const state = clone(prev);
	state.tax.abn = true;
	if (state.biz && state.biz.lic.abn === undefined) state.biz.lic.abn = dayOf(state.clock); // 和副业与小生意的 ABN 是同一个（合并 main 后）
	const msg = `注册了 ABN，成了个体户：街头表演能接商演，收入多 ${Math.round(TAX_GAME.abnBonus * 100)}%，但要在报税时交税。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 申报上一财年：要有 TFN */
export function lodgeReturn(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.tax.ret) return fail(prev, '现在没有要申报的税表。');
	if (tfnState(prev.tax, dayOf(prev.clock)) !== 'ok') return fail(prev, '报税要先有 TFN。');
	const state = clone(prev);
	const msg = settle(state, false);
	log(state, msg);
	return { ok: true, state, msg };
}

