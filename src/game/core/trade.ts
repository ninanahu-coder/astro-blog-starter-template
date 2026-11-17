// 玩家之间的交易（送礼、二手摊）的规则：纯函数。
// 服务端在锁住双方存档后调用 actions.ts 的 applyTrade()；客户端只用这里的检查函数显示按钮状态。
// 防刷：每人每个现实日最多送出 / 收下各 TRADE_DAILY 次（买卖也算）；只能交易背包里的物品，不能直接转钱；
// 二手摊的价格限定在商店价的 50%–150%，小号之间倒钱的空间有限。
import { getItem } from './attributes.ts';
import { addMoodlet, clone, log } from './engine.ts';
import type { PlayerState } from './types.ts';

export const TRADE_DAILY = 5;
export const SALE_MIN = 0.5;
export const SALE_MAX = 1.5;

/** 这个现实日已经送出 / 收下的次数（跨日自动归零） */
export function tradesToday(state: PlayerState, day: number): { out: number; in: number } {
	const t = state.trades;
	return t && t.day === day ? { out: t.out, in: t.in } : { out: 0, in: 0 };
}

/** 二手摊上这件物品允许的价格区间（整数，至少 $1） */
export function saleRange(itemId: string): { min: number; max: number } | null {
	const item = getItem(itemId);
	if (!item) return null;
	return { min: Math.max(1, Math.ceil(item.price * SALE_MIN)), max: Math.max(1, Math.floor(item.price * SALE_MAX)) };
}

/** 能不能把这件东西给出去（送礼或挂到二手摊）；能的话返回 undefined */
export function giveBlocked(state: PlayerState, itemId: string, day: number): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	if (!getItem(itemId)) return '没有这件东西。';
	if ((state.inventory[itemId] ?? 0) < 1) return '你背包里没有这件东西了。';
	if (tradesToday(state, day).out >= TRADE_DAILY) return `今天已经给出去 ${TRADE_DAILY} 次了，明天再来。`;
	return undefined;
}

/** 能不能收下（或买下）这件东西；能的话返回 undefined */
export function takeBlocked(state: PlayerState, itemId: string, price: number, day: number): string | undefined {
	const item = getItem(itemId);
	if (!item) return '没有这件东西。';
	if (state.pending) return '先处理眼前的事件。';
	if ((state.inventory[itemId] ?? 0) >= item.max) return `${item.name}已经带满了。`;
	if (price > 0 && state.cash < price) return `需要 $${price}。`;
	if (tradesToday(state, day).in >= TRADE_DAILY) return `今天已经收下 ${TRADE_DAILY} 次了，明天再来。`;
	return undefined;
}

/**
 * 一次交易：from 把一件 itemId 给 to，to 付 price（0 为送礼）。不改入参。
 * 调用方负责在锁内重新读取双方存档；任何一方不满足条件时返回原因字符串。
 */
export function resolveTrade(from: PlayerState, to: PlayerState, itemId: string, price: number, day: number, names: { from: string; to: string }): { from: PlayerState; to: PlayerState } | string {
	if (from.id === to.id) return '不能和自己交易。';
	if (!Number.isInteger(price) || price < 0) return '价格无效。';
	const why = giveBlocked(from, itemId, day) ?? takeBlocked(to, itemId, price, day);
	if (why) return why;
	const item = getItem(itemId)!;
	const a = clone(from);
	const b = clone(to);
	const left = (a.inventory[itemId] ?? 0) - 1;
	if (left > 0) a.inventory[itemId] = left;
	else delete a.inventory[itemId];
	b.inventory[itemId] = (b.inventory[itemId] ?? 0) + 1;
	if (price > 0) {
		a.cash += price;
		b.cash -= price;
	}
	const ta = tradesToday(a, day);
	const tb = tradesToday(b, day);
	a.trades = { day, out: ta.out + 1, in: ta.in };
	b.trades = { day, out: tb.out, in: tb.in + 1 };
	if (price > 0) {
		log(a, `${item.icon} 把${item.name}卖给了${names.to}，收到 $${price}。`);
		log(b, `${item.icon} 从${names.from}的二手摊买了${item.name}，花了 $${price}。`);
	} else {
		a.needs.social = Math.min(100, a.needs.social + 10);
		b.needs.social = Math.min(100, b.needs.social + 10);
		addMoodlet(b, 'warm-moment');
		log(a, `${item.icon} 把${item.name}送给了${names.to}。`);
		log(b, `${item.icon} ${names.from}送了你一件${item.name}。`);
	}
	return { from: a, to: b };
}
