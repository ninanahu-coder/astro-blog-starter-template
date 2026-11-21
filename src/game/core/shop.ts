// 商店定价与回收（第 34 批）：纯函数，引擎（buyItem / sellItem）、页面和测试共用。
// 防刷的不变量（测试会查）：任何物品、任何特质组合下，回收价 < 最低买价，且回收价 < 二手摊最低价（trade.ts 的 SALE_MIN）。
import { costMult } from './attributes.ts';
import { hourOf } from './time.ts';
import { SHOP_RULES, STORE_TYPES } from '../data/shops.ts';
import type { GameLocation, ItemCat, ItemDef, PlayerState, StoreTypeDef } from './types.ts';

export const ITEM_CATS: Record<ItemCat, string> = { consumable: '消耗品', gear: '装备', gift: '礼物', collectible: '收藏' };

/** 物品分类：数据里写了 cat 就用它，否则 use → 消耗品，passive → 装备，都没有 → 礼物 */
export function itemCat(item: ItemDef): ItemCat {
	return item.cat ?? (item.use ? 'consumable' : item.passive ? 'gear' : 'gift');
}

/** 现在是不是打折贴时段（只对易腐物品生效） */
export function markdownNow(state: PlayerState, item: ItemDef): boolean {
	return !!item.perish && hourOf(state.clock) >= SHOP_RULES.markdown.fromHour;
}

/** 买价 = 标价 × 特质折扣 × 打折贴，四舍五入，至少 $1 */
export function buyPrice(state: PlayerState, item: ItemDef): number {
	const md = markdownNow(state, item) ? SHOP_RULES.markdown.mult : 1;
	return Math.max(1, Math.round(item.price * costMult(state) * md));
}

/** 二手店回收价（向下取整）；这一类不收时返回 null */
export function sellPrice(item: ItemDef): number | null {
	const k = SHOP_RULES.sellBack[itemCat(item)];
	return k ? Math.floor(item.price * k) : null;
}

/** 这个地点有没有二手店 */
export function hasSecondHand(loc: GameLocation | undefined): boolean {
	return !!loc && SHOP_RULES.sellKinds.includes(loc.kind);
}

/** 能不能在这里把这件东西卖给二手店；能的话返回 undefined */
export function sellItemBlocked(state: PlayerState, loc: GameLocation | undefined, item: ItemDef | undefined): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	if (!item) return '没有这件东西。';
	if ((state.inventory[item.id] ?? 0) < 1) return '背包里没有。';
	const p = sellPrice(item);
	if (!p) return `二手店不收${ITEM_CATS[itemCat(item)]}。`;
	if (!hasSecondHand(loc)) return '这里没有二手店，到城市或城镇再卖。';
	return undefined;
}

/** 物品对应的现实店铺类别（标注用） */
export function storesOf(item: ItemDef): StoreTypeDef[] {
	return (item.stores ?? []).map((id) => STORE_TYPES.find((s) => s.id === id)).filter((s): s is StoreTypeDef => !!s);
}
