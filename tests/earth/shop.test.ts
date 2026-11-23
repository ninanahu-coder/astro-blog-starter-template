// 商店与物品系统（第 34 批）：分类、打折贴、二手店回收、防刷不变量、动作协议
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { shopAt } from '../../src/game/core/engine.ts';
import { buyPrice, itemCat, markdownNow, sellItemBlocked, sellPrice, storesOf } from '../../src/game/core/shop.ts';
import { SALE_MIN, saleRange } from '../../src/game/core/trade.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { SHOP_RULES, STORE_TYPES } from '../../src/game/data/shops.ts';
import { TRAITS } from '../../src/game/data/traits.ts';
import { VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { ItemDef, PlayerState } from '../../src/game/core/types.ts';

const mk = (over: Partial<PlayerState> = {}): PlayerState => ({ ...createCharacter({ id: 'shop-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 7 }), ...over });
const item = (id: string) => ITEMS.find((i) => i.id === id)!;
const at = (day: number, h: number, m = 0) => day * 1440 + h * 60 + m;
const outside = WA.locations.find((l) => !SHOP_RULES.sellKinds.includes(l.kind))!;

test('数据：每件物品都有分类和现实店铺类别；店铺类别都在表里；已采集的真实地点类型确实存在', () => {
	const stores = new Set(STORE_TYPES.map((s) => s.id));
	assert.equal(stores.size, STORE_TYPES.length);
	for (const i of ITEMS) {
		assert.ok(i.cat, `${i.id} 要写 cat`);
		assert.ok(i.stores?.length, `${i.id} 要写 stores`);
		for (const s of i.stores!) assert.ok(stores.has(s), `${i.id} 的店铺类别 ${s} 不在 STORE_TYPES 里`);
		assert.equal(storesOf(i).length, i.stores!.length);
		if (i.cat === 'gear') assert.ok(i.passive && !i.use, `${i.id} 装备要有被动加值、不能消耗`);
		if (i.cat === 'consumable') assert.ok(i.use, `${i.id} 消耗品要能用`);
		if (i.cat === 'gift') assert.ok(!i.passive, `${i.id} 礼物不带检定加值`);
	}
	for (const s of STORE_TYPES) if (s.venue) assert.ok(VENUE_TYPES.some((v) => v.id === s.venue), `${s.id} 指向的真实地点类型 ${s.venue} 不存在`);
	// 已有的物品 id 不能改名（NPC 喜好、委托、存档都按 id 记）
	for (const id of ['water', 'snack', 'coffee', 'firstaid', 'flynet', 'swag', 'jerrycan', 'raincoat', 'umbrella', 'sunhat', 'sunscreen', 'drybag', 'electrolyte', 'rod', 'surfboard']) assert.ok(item(id), id);
	// NPC 喜好里的物品都存在
	for (const n of NPCS) for (const id of [...n.gifts.love, ...n.gifts.like, ...n.gifts.dislike]) assert.ok(item(id), `${n.id} 的喜好 ${id}`);
});

test('分类推断：没写 cat 时 use → 消耗品，passive → 装备，都没有 → 礼物', () => {
	const base: ItemDef = { id: 'x', name: 'x', icon: 'x', price: 1, max: 1, shop: {}, desc: '' };
	assert.equal(itemCat({ ...base, use: { needs: { hunger: 1 } } }), 'consumable');
	assert.equal(itemCat({ ...base, passive: { survival: 1 } }), 'gear');
	assert.equal(itemCat(base), 'gift');
	assert.equal(itemCat({ ...base, use: { needs: { hunger: 1 } }, passive: { survival: 1 } }), 'consumable', '能用掉的优先算消耗品（用完就没了，二手店不收）');
	assert.equal(itemCat({ ...base, use: { needs: { hunger: 1 } }, cat: 'gift' }), 'gift', '写了 cat 以 cat 为准');
});

test('打折贴：只对易腐物品、只在 18 点以后；价格按比例打折', () => {
	const flowers = item('flowers');
	const snack = item('snack');
	assert.equal(markdownNow(mk({ clock: at(3, 17, 59) }), flowers), false);
	assert.equal(markdownNow(mk({ clock: at(3, 18) }), flowers), true);
	assert.equal(markdownNow(mk({ clock: at(3, 23, 59) }), flowers), true);
	assert.equal(markdownNow(mk({ clock: at(4, 0) }), flowers), false, '过了午夜恢复原价');
	assert.equal(markdownNow(mk({ clock: at(3, 20) }), snack), false, '不易腐的不打折');
	assert.equal(buyPrice(mk({ clock: at(3, 10) }), flowers), 15);
	assert.equal(buyPrice(mk({ clock: at(3, 20) }), flowers), Math.round(15 * SHOP_RULES.markdown.mult));
	// 商店列表带上标记，买的时候也按打折价扣钱
	const eve = mk({ clock: at(3, 20), cash: 100, traits: [] });
	const row = shopAt(eve, WA).find((e) => e.item.id === 'flowers')!;
	assert.equal(row.markdown, true);
	assert.equal(row.price, 8);
	const r = applyAction(eve, WA, { t: 'buy', item: 'flowers' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, 92);
	assert.equal(shopAt(mk({ clock: at(3, 10), traits: [] }), WA).find((e) => e.item.id === 'flowers')!.markdown, undefined);
});

test('特质折扣照旧：精打细算买东西便宜 15%', () => {
	const frugal = mk({ traits: ['frugal'], clock: at(3, 10) });
	assert.equal(buyPrice(frugal, item('surfboard')), Math.round(350 * 0.85));
	assert.equal(buyPrice(mk({ traits: [], clock: at(3, 10) }), item('surfboard')), 350);
});

test('二手店：只收装备和收藏，按标价 40% 向下取整；只在城市和城镇；不改入参', () => {
	assert.equal(sellPrice(item('surfboard')), 140);
	assert.equal(sellPrice(item('sunhat')), 7);
	assert.equal(sellPrice(item('snack')), null, '消耗品不收');
	assert.equal(sellPrice(item('flowers')), null, '礼物不收');
	const s = mk({ inventory: { surfboard: 1, snack: 2 }, cash: 50, clock: at(3, 10) });
	const snap = JSON.stringify(s);
	const r = applyAction(s, WA, { t: 'sell', item: 'surfboard' });
	assert.ok(r.ok, r.msg);
	assert.equal(JSON.stringify(s), snap, '入参没被改');
	assert.equal(r.state.cash, 190);
	assert.equal('surfboard' in r.state.inventory, false, '卖掉最后一件不留 0');
	assert.equal(r.state.clock, s.clock + SHOP_RULES.sellMinutes);
	assert.match(r.state.journal.at(-1)!.text, /二手店/);
	assert.equal(r.state.rev, s.rev + 1);
	assert.match(applyAction(s, WA, { t: 'sell', item: 'snack' }).msg, /不收消耗品/);
	assert.match(applyAction({ ...s, loc: outside.id }, WA, { t: 'sell', item: 'surfboard' }).msg, /没有二手店/);
	assert.match(applyAction({ ...s, inventory: {} }, WA, { t: 'sell', item: 'surfboard' }).msg, /背包里没有/);
	assert.match(applyAction({ ...s, pending: { eventId: 'flies' } }, WA, { t: 'sell', item: 'surfboard' }).msg, /眼前的事件/);
	assert.match(sellItemBlocked(s, undefined, undefined)!, /没有这件东西/);
	const two = applyAction({ ...s, inventory: { surfboard: 1, rod: 1 } }, WA, { t: 'sell', item: 'rod' });
	assert.equal(two.state.inventory.surfboard, 1, '别的东西不动');
});

test('防刷不变量：任何物品、任何特质组合、打折贴时段，回收价都低于最低买价，也低于二手摊最低价', () => {
	const costs = TRAITS.map((t) => t.mods.cost ?? 1);
	const minMult = costs.filter((c) => c < 1).reduce((a, c) => a * c, 1);
	for (const i of ITEMS) {
		const back = sellPrice(i);
		if (back === null) continue;
		assert.ok(!i.perish, `${i.id} 能回收的东西不应该打折贴`);
		assert.ok(back < Math.round(i.price * minMult * (i.perish ? SHOP_RULES.markdown.mult : 1)), `${i.id} 回收 $${back} 不能 ≥ 最低买价`);
		assert.ok(back < saleRange(i.id)!.min, `${i.id} 回收 $${back} 不能 ≥ 二手摊最低价`);
	}
	for (const k of Object.values(SHOP_RULES.sellBack)) assert.ok(k! < SALE_MIN && k! < minMult);
	// 买了马上卖回去一定亏
	let s = mk({ cash: 1000, traits: ['frugal'], clock: at(3, 10), inventory: {} });
	const before = s.cash;
	for (const id of ['sunhat', 'umbrella', 'raincoat', 'sunscreen']) {
		const b = applyAction(s, WA, { t: 'buy', item: id });
		if (!b.ok) continue;
		s = applyAction(b.state, WA, { t: 'sell', item: id }).state;
	}
	assert.ok(s.cash < before);
});

test('动作协议：sell 只接受合法 id，网络里的多余字段丢掉', () => {
	assert.deepEqual(parseAction({ t: 'sell', item: 'rod', price: 99999 }), { t: 'sell', item: 'rod' });
	assert.equal(parseAction({ t: 'sell', item: '<img>' }), null);
	assert.equal(parseAction({ t: 'sell' }), null);
	assert.equal(applyAction(mk(), WA, { t: 'sell', item: 'no-such' }).ok, false);
});

test('新礼物：饼干能吃也能送，鲜花只能送', () => {
	assert.equal(itemCat(item('biscuits')), 'gift');
	assert.ok(item('biscuits').use);
	assert.equal(item('flowers').use, undefined);
	assert.equal(applyAction(mk({ inventory: { flowers: 1 } }), WA, { t: 'use', item: 'flowers' }).ok, false);
});
