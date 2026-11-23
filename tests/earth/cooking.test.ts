// 做饭分支：食材、保质期、食谱解锁、烹饪技能、请客、外卖、存档清洗、界面转义。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, type GameAction } from '../../src/game/core/actions.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	buyGroceries, cookBlocked, cookGain, cookQuality, cookRecipe, deliveryBlocked, freshPantry, getRecipe, groceriesAt, hostBatches, hostBlocked, hostDinner, hostGuests, kitchenLevel, orderDelivery, pantryCount, recipeKnown, takeFromPantry,
} from '../../src/game/core/cooking.ts';
import { cleanCooking, newCooking } from '../../src/game/core/cooking-save.ts';
import { buyFurniture, rentHome } from '../../src/game/core/engine.ts';
import { COOK_GROWTH, DELIVERY, GROCER_BATCH_MAX, HOSTING, INGREDIENTS, KITCHEN_LEVELS, PANTRY_MAX, RECIPES } from '../../src/game/data/cooking.ts';
import { FURNITURE, HOME_COOK } from '../../src/game/data/furniture.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';
import { queueable } from '../../src/game/ui/queue.ts';
import { groceryHtml, kitchenHtml } from '../../src/game/ui/kitchen.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import { planFor } from '../../src/game/core/npc-behavior.ts';
import { isFading } from '../../src/game/core/relations.ts';
import { WISHES } from '../../src/game/data/wishes.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'cook-player', name: '厨', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
/** 珀斯合租房间，摆好炊具（或带烤箱的厨房） */
const kitchen = (furn = 'cookset', over: Partial<PlayerState> = {}) => {
	const s = rentHome(make({ cash: 5000, clock: at(9), ...over }), WA, 'room').state;
	return buyFurniture(s, WA, furn).state;
};
const withPantry = (s: PlayerState, items: Record<string, number>, days = 5): PlayerState => ({
	...s,
	cooking: { ...s.cooking, pantry: Object.entries(items).map(([id, n]) => ({ id, n, exp: s.clock + days * 1440 })) },
});
const withRel = (s: PlayerState, npc: string, score: number): PlayerState => ({ ...s, relations: { ...s.relations, [npc]: { score, last: {}, seen: [], known: [] } } });
const hungry = (s: PlayerState): PlayerState => ({ ...s, needs: { ...s.needs, hunger: 10, fun: 10, social: 10 } });

test('做饭数据自洽：食材、食谱、解锁、厨房等级、心情都对得上', () => {
	const ing = new Set(INGREDIENTS.map((i) => i.id));
	assert.equal(ing.size, INGREDIENTS.length, '食材 id 唯一');
	assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length, '食谱 id 唯一');
	for (const i of INGREDIENTS) assert.ok(i.price > 0 && i.days >= 1, `${i.id} 价格、保质期为正`);
	const levels = new Set(FURNITURE.map((f) => f.kitchen).filter(Boolean));
	for (const lv of Object.keys(KITCHEN_LEVELS)) assert.ok(levels.has(Number(lv)), `厨房等级 ${lv} 有家具提供`);
	for (const r of RECIPES) {
		for (const [id, n] of Object.entries(r.ingredients)) assert.ok(ing.has(id) && n >= 1, `${r.id} 的食材 ${id}`);
		assert.ok(r.cuisine === 'basic' ? !!r.cash && !Object.keys(r.ingredients).length : Object.keys(r.ingredients).length > 0, `${r.id}：随手做只花钱，其他要食材`);
		assert.ok(KITCHEN_LEVELS[r.kitchen], `${r.id} 厨房等级存在`);
		assert.ok(r.serves >= 1 && r.minutes > 0 && r.hunger > 0 && r.xp > 0);
		if (r.unlock && 'npc' in r.unlock) assert.ok(NPCS.some((n) => n.id === (r.unlock as { npc: string }).npc), `${r.id} 教菜的 NPC 存在`);
	}
	for (const m of ['home-cooked', 'taste-of-home', 'hosted']) assert.ok(MOODLETS.some((x) => x.id === m));
	const quick = getRecipe('quick')!;
	assert.deepEqual([quick.cash, quick.minutes, quick.hunger], [HOME_COOK.cost, HOME_COOK.minutes, HOME_COOK.hunger], '随手做一顿就是旧版在家做饭');
	assert.ok(RECIPES.some((r) => r.cuisine === 'zh' && !r.unlock) || RECIPES.some((r) => r.cuisine === 'zh' && r.unlock && 'skill' in r.unlock && r.unlock.skill === 0), '一开始就会一道中餐');
	assert.ok(RECIPES.some((r) => r.cuisine === 'au' && r.unlock && 'skill' in r.unlock && r.unlock.skill === 0), '一开始就会一道澳洲菜');
});

test('买食材：超市按地点类别、亚洲超市只在首府；营业时间、钱、食材柜上限', () => {
	const s = make({ cash: 500, clock: at(10) });
	const perth = groceriesAt(s, WA).map((o) => o.item.id);
	assert.ok(perth.includes('sauce') && perth.includes('tofu') && perth.includes('veg'), '珀斯有亚洲超市');
	const fre = groceriesAt({ ...s, loc: 'fremantle' }, WA).map((o) => o.item.id);
	assert.ok(fre.includes('veg') && !fre.includes('sauce'), '弗里曼特尔只有普通超市');
	assert.equal(groceriesAt({ ...s, loc: 'wave-rock' }, WA).length, 0, '内陆没有超市');
	assert.equal(groceryHtml({ ...s, loc: 'wave-rock' }, WA, String), '', '没有超市不显示卡片');
	assert.match(groceriesAt({ ...s, clock: at(23) }, WA)[0].blocked ?? '', /营业/);
	assert.equal(buyGroceries({ ...s, clock: at(23) }, WA, 'veg', 1).ok, false, '关门了');
	assert.equal(buyGroceries({ ...s, loc: 'fremantle' }, WA, 'sauce', 1).ok, false, '买不到');
	assert.equal(buyGroceries(s, WA, 'veg', 0).ok, false);
	assert.equal(buyGroceries(s, WA, 'veg', GROCER_BATCH_MAX + 1).ok, false);
	assert.equal(buyGroceries({ ...s, cash: 5 }, WA, 'meat', 1).ok, false, '钱不够');
	const r = buyGroceries(s, WA, 'veg', 3);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, 500 - 9);
	assert.equal(s.cooking.pantry.length, 0, '不改入参');
	assert.deepEqual(r.state.cooking.pantry, [{ id: 'veg', n: 3, exp: (0 + 5 + 1) * 1440 }], '保质期从今天结束算起');
	const r2 = buyGroceries(r.state, WA, 'veg', 2);
	assert.deepEqual(r2.state.cooking.pantry, [{ id: 'veg', n: 5, exp: 6 * 1440 }], '同一天买的合并成一批');
	const full = withPantry(s, { staple: PANTRY_MAX - 1 });
	assert.ok(buyGroceries(full, WA, 'veg', 1).ok, '刚好放满');
	assert.equal(buyGroceries(full, WA, 'veg', 2).ok, false, '放不下');
	const thrifty = make({ cash: 500, clock: at(10), traits: ['frugal'] });
	if (thrifty.traits.length) assert.ok(groceriesAt(thrifty, WA)[0].price <= groceriesAt(s, WA)[0].price, '省钱特质不更贵');
});

test('保质期：过期的不算数，做菜先用快过期的，过期的在下一次做菜时扔掉', () => {
	const rows = [{ id: 'veg', n: 2, exp: 100 }, { id: 'veg', n: 2, exp: 50 }, { id: 'meat', n: 1, exp: 10 }];
	assert.deepEqual(freshPantry(rows, 20), { rows: rows.slice(0, 2), spoiled: 1 });
	assert.deepEqual(freshPantry(rows, 10), { rows: rows.slice(0, 2), spoiled: 1 }, '到点就算过期');
	assert.deepEqual(takeFromPantry(rows, { veg: 3 }), [{ id: 'veg', n: 1, exp: 100 }, { id: 'meat', n: 1, exp: 10 }], '先用 exp=50 的那批');
	assert.equal(takeFromPantry(rows, { veg: 5 }), null);
	assert.equal(rows[1].n, 2, '不改入参');
	let s = withPantry(kitchen(), { veg: 1, dairy: 1, staple: 1 }, 1);
	s = { ...s, cooking: { ...s.cooking, pantry: [...s.cooking.pantry, { id: 'meat', n: 2, exp: s.clock - 1 }] } };
	assert.equal(pantryCount(s).meat, undefined, '过期的肉不算');
	assert.match(cookBlocked(s, 'sausage-sizzle') ?? '', /还缺肉 1 份/);
	const r = cookRecipe(hungry(s), WA, 'tomato-egg');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(r.state.cooking.pantry, [], '用掉的和过期的都清掉');
	assert.match(r.msg, /过期/);
	const late = { ...s, clock: s.clock + 2 * 1440 };
	assert.match(cookBlocked(late, 'tomato-egg') ?? '', /还缺/, '放了两天蔬菜过期了');
	assert.equal(cookRecipe(late, WA, 'tomato-egg').state, late, '做不了时不改存档');
});

test('照食谱做菜：要在家、有炊具、会做、食材够；扣食材、不扣钱、涨烹饪、按菜系给心情', () => {
	const base = kitchen();
	const s = hungry(withPantry(base, { veg: 2, dairy: 2, staple: 2, meat: 2 }));
	assert.equal(cookBlocked({ ...s, loc: 'fremantle' }, 'tomato-egg'), '要在住处');
	assert.equal(cookBlocked({ ...s, home: { ...s.home!, furniture: {} } }, 'tomato-egg'), '需要炊具');
	assert.equal(cookBlocked(s, 'nope'), '没有这道菜。');
	assert.match(cookBlocked(s, 'mapo-tofu') ?? '', /还不会/);
	const r = cookRecipe(s, WA, 'tomato-egg');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, s.cash, '用自己的食材不花钱');
	assert.deepEqual(pantryCount(r.state), { veg: 1, dairy: 1, staple: 1, meat: 2 });
	assert.ok(r.state.needs.hunger > s.needs.hunger + 40);
	assert.ok(r.state.cooking.xp > 0);
	assert.equal(r.state.cooking.made['tomato-egg'], 1);
	assert.ok(r.state.moodlets.some((m) => m.id === 'taste-of-home'), '中餐给家乡的味道');
	const au = cookRecipe(s, WA, 'sausage-sizzle');
	assert.ok(au.state.moodlets.some((m) => m.id === 'home-cooked'), '澳洲菜给自己做的饭');
	assert.equal(r.state.clock - s.clock, getRecipe('tomato-egg')!.minutes);
	// 随手做一顿：和旧版一样花 $6，不用食材
	const q = cookRecipe(s, WA);
	assert.equal(q.state.cash, s.cash - HOME_COOK.cost);
	assert.deepEqual(pantryCount(q.state), pantryCount(s));
	assert.ok(q.state.moodlets.some((m) => m.id === 'well-fed'));
});

test('烹饪技能：第一次做某道菜涨得多，越高涨得越慢；过门槛自动学会新菜', () => {
	const s = kitchen();
	const egg = getRecipe('tomato-egg')!;
	const first = cookGain(s, egg);
	const again = cookGain({ ...s, cooking: { ...s.cooking, made: { 'tomato-egg': 1 } } }, egg);
	assert.ok(Math.abs(first - again * COOK_GROWTH.first) < 1e-9, '第一次加倍');
	assert.ok(cookGain({ ...s, cooking: { ...s.cooking, xp: 80 } }, egg) < first, '递减');
	const max = hungry(withPantry({ ...s, cooking: { ...s.cooking, xp: 100 } }, { veg: 1, dairy: 1, staple: 1 }));
	assert.equal(cookRecipe(max, WA, 'tomato-egg').state.cooking.xp, 100, '封顶 100');
	// 卡在门槛下一点：做一道菜就跨过 5，学会蛋炒饭
	const near = hungry(withPantry({ ...s, cooking: { ...s.cooking, xp: 4.9 } }, { veg: 1, dairy: 1, staple: 1 }));
	assert.equal(recipeKnown(near, getRecipe('fried-rice')!), false);
	const r = cookRecipe(near, WA, 'tomato-egg');
	assert.ok(recipeKnown(r.state, getRecipe('fried-rice')!));
	assert.match(r.msg, /学会了「蛋炒饭」/);
	// 品质随技能和熟练度上升，钳在范围内
	const mapo = getRecipe('mapo-tofu')!;
	const lo = cookQuality({ ...s, cooking: { ...s.cooking, xp: 15 } }, mapo);
	const hi = cookQuality({ ...s, cooking: { ...s.cooking, xp: 60 } }, mapo);
	const practiced = cookQuality({ ...s, cooking: { ...s.cooking, xp: 15, made: { 'mapo-tofu': 3 } } }, mapo);
	assert.ok(hi > lo && practiced > lo);
	assert.ok(cookQuality({ ...s, cooking: { ...s.cooking, xp: 100, made: { 'mapo-tofu': 99 } } }, mapo) <= 1.25);
	assert.equal(cookQuality(s, getRecipe('quick')!), 1);
});

test('解锁：NPC 关系到了就会做；要烤箱的菜只有炉灶做不了', () => {
	let s = hungry(withPantry(kitchen(), { dairy: 4 }));
	const pav = getRecipe('pavlova')!;
	assert.equal(recipeKnown(s, pav), false);
	s = withRel(s, 'mia', 30);
	assert.ok(recipeKnown(s, pav), '米娅教');
	assert.equal(kitchenLevel(s), 1);
	assert.equal(cookBlocked(s, 'pavlova'), '需要带烤箱的厨房');
	const oven = hungry(withRel(withPantry(kitchen('espresso'), { dairy: 4 }), 'mia', 30));
	assert.equal(kitchenLevel(oven), 2);
	assert.ok(cookRecipe(oven, WA, 'pavlova').ok);
	assert.equal(kitchenLevel(make()), 0, '没有住处');
});

test('请客：请常住这里的朋友，按人数做几锅；涨社交和关系，每天一次；待客之家多涨关系', () => {
	let s = kitchen('cookset', { clock: at(18) });
	s = hungry(withRel(withRel(s, 'mia', 40), 'jack', 50)); // 老杰克常住弗里曼特尔，不算
	assert.deepEqual(hostGuests(s).map((n) => n.id), ['mia']);
	const egg = getRecipe('tomato-egg')!;
	assert.equal(hostBatches(s, egg), 2, '两个人吃，番茄炒蛋一锅一人份');
	assert.equal(hostBatches(s, getRecipe('hotpot')!), 1);
	assert.equal(hostBlocked(s, 'quick'), '请客要照食谱做菜');
	assert.match(hostBlocked(s, 'tomato-egg') ?? '', /还缺/);
	s = withPantry(s, { veg: 4, dairy: 4, staple: 4 });
	assert.match(hostBlocked({ ...s, clock: at(9) }, 'tomato-egg') ?? '', /饭点/);
	assert.equal(hostBlocked({ ...s, needs: { ...s.needs, energy: 5 } }, 'tomato-egg'), '太累了');
	const r = hostDinner(s, WA, 'tomato-egg');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.relations.mia.score, 40 + HOSTING.rel);
	assert.equal(r.state.relations.jack.score, 50, '不在的朋友不涨');
	assert.ok(r.state.needs.social >= HOSTING.social + HOSTING.perGuest);
	assert.equal(r.state.respect, s.respect + HOSTING.respect);
	assert.deepEqual(pantryCount(r.state), { veg: 2, dairy: 2, staple: 2 }, '做了两锅');
	assert.ok(r.state.moodlets.some((m) => m.id === 'hosted'));
	assert.equal(r.state.cooking.hostDay, 0);
	assert.equal(hostBlocked(r.state, 'tomato-egg'), '今天已经请过客了');
	assert.equal(s.relations.mia.score, 40, '不改入参');
	// 没有朋友：请邻居，三个人吃，只涨社交
	const alone = withPantry(hungry(kitchen('cookset', { clock: at(18) })), { veg: 3, dairy: 3, staple: 3 });
	const n = hostDinner(alone, WA, 'tomato-egg');
	assert.ok(n.ok, n.msg);
	assert.deepEqual(pantryCount(n.state), {}, '邻居两位加自己，三锅');
	assert.deepEqual(n.state.relations, alone.relations);
	// 待客之家：咖啡机厨房 + 游戏机 + 设计师软装
	let set = kitchen('espresso', { clock: at(12), cash: 9000 });
	for (const id of ['console', 'designer']) set = buyFurniture(set, WA, id).state;
	set = hungry(withPantry(withRel({ ...set, clock: at(18) }, 'mia', 40), { veg: 4, dairy: 4, staple: 4 }));
	assert.equal(hostDinner(set, WA, 'tomato-egg').state.relations.mia.score, 40 + HOSTING.rel + HOSTING.setRel);
});

test('叫外卖：在城镇的住处、营业时间，贵但不用厨房', () => {
	const s = hungry(rentHome(make({ cash: 2000, clock: at(12) }), WA, 'room').state); // 合并 main 后：租房还要交押金，起始现金调高
	assert.equal(deliveryBlocked(s, WA), undefined, '没有炊具也能叫');
	const r = orderDelivery(s, WA);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, s.cash - DELIVERY.cost);
	assert.ok(r.state.needs.hunger > s.needs.hunger + 30);
	assert.match(deliveryBlocked({ ...s, clock: at(3) }, WA) ?? '', /外卖/);
	assert.equal(deliveryBlocked({ ...s, loc: 'fremantle' }, WA), '要在住处');
	assert.equal(deliveryBlocked({ ...s, cash: 3 }, WA), `需要 $${DELIVERY.cost}`);
	assert.ok(DELIVERY.cost > HOME_COOK.cost, '外卖比在家做贵');
});

test('动作协议：做菜可带食谱，请客必须带，买食材份数有上下限；旧客户端的做饭照常', () => {
	assert.deepEqual(parseAction({ t: 'home', op: 'cook' }), { t: 'home', op: 'cook' });
	assert.deepEqual(parseAction({ t: 'home', op: 'cook', recipe: 'mapo-tofu', extra: 1 }), { t: 'home', op: 'cook', recipe: 'mapo-tofu' });
	assert.equal(parseAction({ t: 'home', op: 'cook', recipe: '<b>' }), null);
	assert.equal(parseAction({ t: 'home', op: 'host' }), null);
	assert.deepEqual(parseAction({ t: 'home', op: 'host', recipe: 'hotpot' }), { t: 'home', op: 'host', recipe: 'hotpot' });
	assert.deepEqual(parseAction({ t: 'home', op: 'delivery' }), { t: 'home', op: 'delivery' });
	assert.deepEqual(parseAction({ t: 'grocery', id: 'veg', n: 4, price: 0 }), { t: 'grocery', id: 'veg', n: 4 });
	for (const n of [0, -1, 1.5, GROCER_BATCH_MAX + 1, '2', NaN]) assert.equal(parseAction({ t: 'grocery', id: 'veg', n }), null, `n=${n}`);
	assert.ok(queueable({ t: 'home', op: 'cook', recipe: 'tomato-egg' }));
	for (const a of [{ t: 'home', op: 'host', recipe: 'hotpot' }, { t: 'home', op: 'delivery' }, { t: 'grocery', id: 'veg', n: 1 }] as const) assert.equal(queueable(a), false);
	const s = hungry(withPantry(kitchen(), { veg: 1, dairy: 1, staple: 1 }));
	const r = applyAction(s, WA, { t: 'home', op: 'cook', recipe: 'tomato-egg' });
	assert.ok(r.ok);
	assert.equal(r.state.rev, s.rev + 1);
	const g = applyAction(make({ clock: at(10) }), WA, { t: 'grocery', id: 'sauce', n: 2 });
	assert.ok(g.ok, g.msg);
});

test('存档清洗：旧存档补默认值，坏值、未知 id、超量食材、未来的请客日都清掉，幂等', () => {
	assert.deepEqual(cleanCooking(undefined, 0), newCooking());
	for (const bad of [null, 1, 'x', [], { xp: NaN }, { pantry: 'x' }, { made: [] }]) assert.deepEqual(cleanCooking(bad, 0).pantry, []);
	const c = cleanCooking({
		xp: 1e9, made: { 'tomato-egg': 3.7, ghost: 5, 'mapo-tofu': -1, __proto__: { x: 1 } }, hostDay: 99,
		pantry: [{ id: 'veg', n: 20, exp: 1e12 }, { id: 'ghost', n: 1, exp: 10 }, { id: 'meat', n: 20, exp: 50 }, { id: 'dairy', n: 'x', exp: 1 }, null],
	}, 1440 * 2 + 10);
	assert.equal(c.xp, 100);
	assert.deepEqual(c.made, { 'tomato-egg': 3 });
	assert.equal(c.hostDay, 2, '不晚于今天');
	assert.deepEqual(c.pantry.map((r) => [r.id, r.n]), [['veg', 20], ['meat', PANTRY_MAX - 20]], '合计不超过上限');
	assert.ok(c.pantry[0].exp <= 1440 * 2 + 10 + 121 * 1440, '过期时间钳到最长保质期内');
	assert.deepEqual(cleanCooking(c, 1440 * 2 + 10), c, '幂等');
	const raw = { ...make(), cooking: { xp: 12, made: { bbq: 2 }, pantry: [{ id: 'veg', n: 2, exp: 9999 }], hostDay: 0 } };
	const once = sanitizeState(raw)!;
	assert.equal(once.cooking.xp, 12);
	assert.deepEqual(sanitizeState(once), once);
	const old = { ...make() } as Record<string, unknown>;
	delete old.cooking;
	assert.deepEqual(sanitizeState(old)!.cooking, newCooking(), '旧存档没有这个字段');
});

test('界面：厨房和超市片段里的文字都经过 esc()', () => {
	const mark = (v: unknown) => `«${String(v)}»`;
	const s = withRel(withPantry(kitchen('cookset', { clock: at(18) }), { veg: 1 }), 'mia', 40);
	const html = kitchenHtml(s, WA, mark);
	assert.ok(html.includes('«米娅»'), 'NPC 名字经过 esc');
	assert.ok(html.includes('«番茄炒蛋»'), '菜名经过 esc');
	assert.ok(html.includes('«新鲜蔬菜»'), '食材名经过 esc');
	assert.ok(!/米娅(?!»)/.test(html.replace(/«米娅»/g, '')), '没有漏掉的');
	const g = groceryHtml(make({ clock: at(23) }), WA, mark);
	assert.ok(g.includes('<small>«超市 7:00–22:00 营业»</small>'), '不能买的原因经过 esc');
	assert.ok(g.includes('«豆腐»'));
});

// ---------- 合并 main 后复核补的 ----------
test('请客：今天请假（休假 / 病假）的朋友不来，关系不涨（合并 main 后复核）', () => {
	const mia = NPCS.find((n) => n.id === 'mia')!;
	let day = 0;
	while (day < 400 && !planFor(mia, at(18, day)).away) day++;
	assert.ok(day < 400, '一年里米娅总有请假的日子');
	let s = kitchen('cookset', { clock: at(18, day) });
	s = hungry(withPantry(withRel(s, 'mia', 40), { veg: 4, dairy: 4, staple: 4 }));
	assert.deepEqual(hostGuests(s).map((n) => n.id), [], '请假的米娅不来');
	const r = hostDinner(s, WA, 'tomato-egg');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.relations.mia.score, 40);
	// 前一天没请假就照常来
	const before = { ...s, clock: at(18, day - 1) };
	assert.ok(!planFor(mia, before.clock).away);
	assert.deepEqual(hostGuests(before).map((n) => n.id), ['mia']);
});

test('请客算见过面：很久没联系、关系在变淡的朋友吃完饭就不再变淡；记录读档后还在（合并 main 后复核）', () => {
	let s = kitchen('cookset', { clock: at(18, 40) });
	s = hungry(withPantry(withRel(s, 'mia', 40), { veg: 4, dairy: 4, staple: 4 }));
	s = { ...s, relations: { ...s.relations, mia: { ...s.relations.mia, last: { chat: 10 } } } };
	assert.ok(!planFor(NPCS.find((n) => n.id === 'mia')!, s.clock).away, '第 40 天米娅没请假');
	assert.ok(isFading(s.relations.mia, 40), '30 天没联系在变淡');
	const r = hostDinner(s, WA, 'tomato-egg');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.relations.mia.last.host, 40);
	assert.equal(isFading(r.state.relations.mia, 40), false);
	const a = sanitizeState(JSON.parse(JSON.stringify(r.state)))!;
	assert.equal(a.relations.mia.last.host, 40, '读档保留');
	assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(a)))!.relations.mia, a.relations.mia, '幂等');
	assert.equal(s.relations.mia.last.host, undefined, '不改入参');
});

test('买食材路上晕倒：钱花了，食材也在柜子里（合并 main 后复核）', () => {
	const s = make({ cash: 500, clock: at(10), health: 0.2, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } as never });
	const id = groceriesAt(s, WA).find((o) => !o.blocked)!.item.id;
	const r = buyGroceries(s, WA, id, 4);
	assert.ok(r.collapsed, '路上晕倒');
	assert.equal(pantryCount(r.state)[id], 4);
});

test('心愿「想在家做顿饭」：请客也算（合并 main 后复核）', () => {
	assert.deepEqual(WISHES.find((w) => w.id === 'cook')!.done, { t: 'home', ops: ['cook', 'host'] });
});

test('生涯统计：在家做饭、请客、叫外卖、买食材记「吃喝购物」，租房、睡觉还记「住房」（合并 main 后）', () => {
	for (const a of [{ t: 'home', op: 'cook' }, { t: 'home', op: 'cook', recipe: 'hotpot' }, { t: 'home', op: 'host', recipe: 'hotpot' }, { t: 'home', op: 'delivery' }, { t: 'grocery', id: 'veg', n: 1 }] as GameAction[]) assert.deepEqual(actionCats(a), ['shop', 'shop'], JSON.stringify(a));
	for (const a of [{ t: 'home', op: 'rent', home: 'room' }, { t: 'home', op: 'sleep' }, { t: 'home', op: 'relax' }] as GameAction[]) assert.deepEqual(actionCats(a), ['housing', 'housing'], JSON.stringify(a));
});

