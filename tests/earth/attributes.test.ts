import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkScore, level, mood, moodTier, validTraits, wantedStars } from '../../src/game/core/attributes.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { buyItem, performActivity, shopAt, travelOptions, useItem } from '../../src/game/core/engine.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { MAX_TRAITS, TRAITS } from '../../src/game/data/traits.ts';
import { WA } from '../../src/game/data/wa.ts';

const make = (traits: string[] = [], origin = 'backpacker') =>
	createCharacter({ id: 'attr-player', name: '测', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 1, traits });

test('特质与物品数据自洽', () => {
	const ids = new Set(TRAITS.map((t) => t.id));
	assert.equal(ids.size, TRAITS.length);
	for (const t of TRAITS) for (const c of t.conflicts ?? []) {
		assert.ok(ids.has(c), `${t.id} 互斥对象存在`);
		assert.ok(TRAITS.find((x) => x.id === c)!.conflicts?.includes(t.id), `${t.id}↔${c} 互斥是双向的`);
	}
	assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
	for (const i of ITEMS) assert.ok(i.use || i.passive, `${i.id} 要么能用要么是装备`);
});

test('特质选择校验', () => {
	assert.ok(validTraits(['athletic', 'frugal'], MAX_TRAITS));
	assert.ok(!validTraits(['charming', 'loner'], MAX_TRAITS), '互斥');
	assert.ok(!validTraits(['athletic', 'athletic'], MAX_TRAITS), '重复');
	assert.ok(!validTraits(['athletic', 'frugal', 'tough'], MAX_TRAITS), '超过上限');
	assert.ok(!validTraits(['nope'], MAX_TRAITS), '不存在');
	assert.deepEqual(make(['charming', 'loner']).traits, [], '非法组合创建时被丢弃');
});

test('心情：短板效应与档位', () => {
	const s = make();
	s.needs = { hunger: 100, energy: 100, hygiene: 100, fun: 100, social: 0 };
	assert.equal(mood(s), 48, '一项见底会把心情拉到一般');
	assert.equal(moodTier(10).check, -10);
	assert.equal(moodTier(90).check, 10);
	assert.equal(mood({ ...make(['easygoing']), needs: s.needs }), 56, '没心没肺 +8');
});

test('检定分 = 能力 + 特质 + 最高一件装备 + 心情', () => {
	const s = { ...make(['waterborn'], 'surfer'), inventory: { surfboard: 1 } };
	const c = checkScore(s, 'swimming');
	assert.equal(c.skill, 40);
	assert.equal(c.trait, 5);
	assert.equal(c.item, 5);
	assert.equal(c.total, c.skill + c.trait + c.item + c.mood);
});

test('特质改变成长、衰减、花费、受伤、麻烦值', () => {
	const base = make();
	const ath = make(['athletic']);
	const lift = (s: typeof base) => performActivity({ ...s, cash: 100 }, WA, 'gym').state;
	assert.ok(lift(ath).skills.strength - ath.skills.strength > lift(base).skills.strength - base.skills.strength);
	assert.ok(lift(ath).needs.hunger < lift(base).needs.hunger, '运动健将饿得快');

	const cost = (s: typeof base) => travelOptions(s, WA).find((o) => o.to === 'kalgoorlie' && o.mode === 'air')!.cost;
	assert.ok(cost(make(['frugal'])) < cost(base));

	assert.ok(wantedStars(59) === 2 && wantedStars(60) === 3 && wantedStars(100) === 5);
});

test('买东西与用东西', () => {
	const s = { ...make(), cash: 500 };
	assert.ok(shopAt(s, WA).some((e) => e.item.id === 'firstaid'));
	const bought = buyItem(s, WA, 'firstaid');
	assert.ok(bought.ok);
	assert.equal(bought.state.inventory.firstaid, 1);
	assert.equal(bought.state.cash, 465);
	const used = useItem({ ...bought.state, health: 50 }, WA, 'firstaid');
	assert.ok(used.ok);
	assert.equal(used.state.health, 75);
	assert.equal(used.state.inventory.firstaid, undefined, '用完从背包移除');
	assert.equal(useItem(used.state, WA, 'firstaid').ok, false);
	assert.equal(useItem({ ...s, inventory: { swag: 1 } }, WA, 'swag').ok, false, '装备不能消耗');
	assert.equal(buyItem({ ...s, inventory: { swag: 1 } }, WA, 'swag').ok, false, '已带满');
	const inland = { ...s, loc: 'wave-rock' };
	assert.equal(buyItem(inland, WA, 'surfboard').ok, false, '内陆买不到冲浪板');
});

test('等级', () => {
	assert.deepEqual(level(0), { lv: 1, title: '新来的', next: 10 });
	assert.equal(level(25).lv, 3);
	assert.equal(level(9999).next, null);
});

test('存档校验：特质与背包', () => {
	const dirty = { ...make(['athletic']), traits: ['charming', 'loner'], inventory: { water: 99, ghost: 3, snack: -1, swag: 1.7 } };
	const clean = sanitizeState(dirty)!;
	assert.deepEqual(clean.traits, []);
	assert.deepEqual(clean.inventory, { water: 10, swag: 1 });
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'traits');
	Reflect.deleteProperty(old, 'inventory');
	const migrated = sanitizeState(old)!;
	assert.deepEqual(migrated.traits, [], '旧存档没有这两个字段也能读');
	assert.deepEqual(migrated.inventory, {});
});
