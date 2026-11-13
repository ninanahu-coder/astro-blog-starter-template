import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { getRelation, interactNpc, npcsAt, performActivity, relationTier } from '../../src/game/core/engine.ts';
import { isOpen, period } from '../../src/game/core/time.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = () => createCharacter({ id: 'npc-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 3 });

test('NPC 数据自洽', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const items = new Set(ITEMS.map((i) => i.id));
	assert.equal(new Set(NPCS.map((n) => n.id)).size, NPCS.length);
	for (const n of NPCS) {
		assert.ok(locs.has(n.loc), `${n.id} 地点存在`);
		assert.ok(n.likes.length && n.likes.every((i) => items.has(i)), `${n.id} 喜欢的物品存在`);
		for (const i of Object.keys(n.bond.fx.items ?? {})) assert.ok(items.has(i), `${n.id} 回报物品存在`);
	}
});

test('时段与营业时间（含跨午夜）', () => {
	assert.equal(period(at(6)).name, '清晨');
	assert.equal(period(at(12)).name, '白天');
	assert.equal(period(at(18)).name, '傍晚');
	assert.equal(period(at(23)).name, '夜晚');
	assert.ok(isOpen([9, 17], at(9)) && !isOpen([9, 17], at(17)));
	assert.ok(isOpen([20, 6], at(23)) && isOpen([20, 6], at(3)) && !isOpen([20, 6], at(12)));
	assert.ok(isOpen(undefined, at(3)));
});

test('酒吧凌晨关门、白天营业', () => {
	const s = { ...make(), loc: 'fremantle', cash: 500 };
	const closed = performActivity({ ...s, clock: at(2) }, WA, 'pub');
	assert.equal(closed.ok, false);
	assert.match(closed.msg, /营业时间/);
	assert.equal(performActivity({ ...s, clock: at(15) }, WA, 'pub').ok, true);
});

test('NPC 只在自己的地点和作息时间出现', () => {
	const s = make();
	assert.deepEqual(npcsAt({ ...s, clock: at(9) }, WA).map((a) => a.npc.id), ['mia']);
	assert.deepEqual(npcsAt({ ...s, clock: at(20) }, WA), [], '下班了');
	assert.deepEqual(npcsAt({ ...s, loc: 'port-hedland', clock: at(2) }, WA).map((a) => a.npc.id), ['dave'], '夜班司机');
});

test('聊天、送礼、帮忙：每种每天一次，涨关系', () => {
	let s = { ...make(), clock: at(9) };
	const r1 = interactNpc(s, WA, 'mia', 'chat');
	assert.ok(r1.ok);
	assert.ok(getRelation(r1.state, 'mia').score >= 3);
	assert.equal(interactNpc(r1.state, WA, 'mia', 'chat').ok, false, '同一天不能再聊');
	const r2 = interactNpc(r1.state, WA, 'mia', 'gift');
	assert.ok(r2.ok, r2.msg);
	assert.equal(r2.state.inventory.snack, undefined, '送掉了唯一的能量棒');
	assert.equal(interactNpc(r2.state, WA, 'mia', 'gift').ok, false);
	s = { ...r2.state, clock: at(9, 1) };
	assert.ok(interactNpc(s, WA, 'mia', 'chat').ok, '第二天可以再聊');
	assert.equal(interactNpc({ ...s, loc: 'broome' }, WA, 'mia', 'chat').ok, false, '人不在');
});

test('第一次成为好友发放一次性回报', () => {
	const s = { ...make(), clock: at(9), relations: { mia: { score: 55, last: {}, bonded: false } } };
	const r = interactNpc(s, WA, 'mia', 'help');
	assert.ok(r.ok);
	assert.equal(relationTier(getRelation(r.state, 'mia').score), '好友');
	assert.ok(getRelation(r.state, 'mia').bonded);
	assert.equal(r.state.cash, s.cash + 250);
	const again = interactNpc({ ...r.state, clock: at(9, 1) }, WA, 'mia', 'help');
	assert.equal(again.state.cash, r.state.cash, '回报只发一次');
});

test('存档校验：关系', () => {
	const dirty = { ...make(), relations: { mia: { score: 999, last: { chat: -3, gift: 2.7 }, bonded: 'yes' }, ghost: { score: 50 } } };
	const clean = sanitizeState(dirty)!;
	assert.deepEqual(clean.relations, { mia: { score: 100, last: { gift: 2 }, bonded: false } });
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'relations');
	assert.deepEqual(sanitizeState(old)!.relations, {});
});
