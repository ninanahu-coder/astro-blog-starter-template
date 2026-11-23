// 买保险、续保的动作（网上办，不花游戏时间）。计算都在 core/insurance.ts。
import { clone, fail, log } from './engine.ts';
import { extendCover, insureBlocked, premiumFor } from './insurance.ts';
import { getPolicy } from '../data/insurance.ts';
import { dayOf } from './time.ts';
import type { ActionResult, PlayerState } from './types.ts';

export function buyInsurance(prev: PlayerState, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const day = dayOf(prev.clock);
	const blocked = insureBlocked(prev, id, day);
	if (blocked) return fail(prev, blocked);
	const p = getPolicy(id)!;
	const price = premiumFor(prev.cover, id, day);
	const state = clone(prev);
	const renew = (state.cover[id]?.until ?? 0) > day;
	state.cash -= price;
	state.cover[id] = extendCover(state.cover[id], p, day);
	const c = state.cover[id];
	const msg = `${renew ? '续了' : '买了'}${p.name}，保费 $${price}，保到第 ${c.until} 天（含）${c.from > day ? `（第 ${c.from + 1} 天起生效）` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}
