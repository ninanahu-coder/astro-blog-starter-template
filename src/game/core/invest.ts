// 买卖金融资产（第 25 批）：随时随地用手机下单，每次花 10 分钟。有待处理事件时不能交易。
// 买入：付 amount 现金，扣手续费后按今天价格换成份数。卖出：按今天价格卖出价值 amount 的份数（超过持仓就全卖），扣手续费后到账。
// 同一天买了马上卖一定亏手续费（储蓄没有手续费，存了马上取不赚不亏）。
import { ASSET_MIN_TRADE, ASSET_TRADE_MINUTES, ASSETS } from '../data/assets.ts';
import { applyEffect, clone, collapsedResult, fail, log } from './engine.ts';
import { assetPrice, getAsset, sellValue } from './market.ts';
import type { ActionResult, AssetDef, PlayerState, Region } from './types.ts';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

export interface AssetQuote {
	asset: AssetDef;
	price: number; // 今天的单价
	units: number; // 持有份数
	value: number; // 现在全卖能到手多少
	cost: number; // 累计成本
	buyBlocked?: string;
	sellBlocked?: string;
}

/** 所有资产的报价和持仓 */
export function marketQuotes(state: PlayerState): AssetQuote[] {
	return ASSETS.map((asset) => {
		const price = assetPrice(state, asset);
		const h = state.holdings[asset.id];
		const units = h?.units ?? 0;
		return {
			asset, price, units, value: sellValue(asset, units, price), cost: h?.cost ?? 0,
			buyBlocked: state.cash < ASSET_MIN_TRADE ? `至少买 ${money(ASSET_MIN_TRADE)}` : undefined,
			sellBlocked: units > 0 ? undefined : '没有持仓',
		};
	});
}

export function buyAsset(prev: PlayerState, region: Region, id: string, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getAsset(id);
	if (!def) return fail(prev, '没有这种资产。');
	const pay = Math.floor(amount);
	if (!(pay >= ASSET_MIN_TRADE)) return fail(prev, `至少买 ${money(ASSET_MIN_TRADE)}。`);
	if (prev.cash < pay) return fail(prev, `现金不够 ${money(pay)}。`);
	const state = clone(prev);
	const price = assetPrice(state, def);
	state.cash -= pay;
	const h = (state.holdings[id] ??= { units: 0, cost: 0 });
	h.units += (pay * (1 - def.fee)) / price;
	h.cost += pay;
	if (applyEffect(state, { minutes: ASSET_TRADE_MINUTES }, region)) return collapsedResult(state);
	const msg = `买入${def.name} ${money(pay)}（单价 $${price.toFixed(2)}${def.fee ? `，手续费 ${money(pay * def.fee)}` : ''}）。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function sellAsset(prev: PlayerState, region: Region, id: string, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getAsset(id);
	if (!def) return fail(prev, '没有这种资产。');
	const held = prev.holdings[id]?.units ?? 0;
	if (held <= 0) return fail(prev, `没有${def.name}可卖。`);
	if (!(amount > 0)) return fail(prev, '卖出金额要大于 0。');
	const state = clone(prev);
	const price = assetPrice(state, def);
	const all = amount >= held * price;
	const units = all ? held : amount / price;
	const got = sellValue(def, units, price);
	if (all) state.holdings = Object.fromEntries(Object.entries(state.holdings).filter(([k]) => k !== id));
	else {
		const h = state.holdings[id];
		h.cost = h.cost * (1 - units / held);
		h.units = held - units;
	}
	state.cash += got;
	if (applyEffect(state, { minutes: ASSET_TRADE_MINUTES }, region)) return collapsedResult(state);
	const msg = `卖出${all ? '全部' : ''}${def.name}，到手 ${money(got)}（单价 $${price.toFixed(2)}）。`;
	log(state, msg);
	return { ok: true, state, msg };
}
