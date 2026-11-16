// 玩家之间交易的规则（纯函数）：送礼、二手摊的条件、每日次数、不改入参
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTrade } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { giveBlocked, saleRange, takeBlocked, TRADE_DAILY, tradesToday } from '../../src/game/core/trade.ts';
import { WA } from '../../src/game/data/wa.ts';
import { MET_MAX, metList, noteMet } from '../../src/game/core/social.ts';

const mk = (id: string, over: Record<string, unknown> = {}) => ({ ...createCharacter({ id, name: id, avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 }), ...over });
const DAY = 20_000;

test('送礼：东西从一方背包到另一方，双方版本号加一，不改入参，收礼的人心情好', () => {
	const a = mk('trade-aa', { inventory: { snack: 2 }, rev: 4 });
	const b = mk('trade-bb', { inventory: {}, rev: 9 });
	const snap = JSON.stringify([a, b]);
	const r = applyTrade(a, b, 'snack', 0, DAY, { from: '阿甲', to: '阿乙' });
	assert.equal(typeof r, 'object');
	if (typeof r === 'string') return;
	assert.equal(JSON.stringify([a, b]), snap, '入参没被改');
	assert.equal(r.from.inventory.snack, 1);
	assert.equal(r.to.inventory.snack, 1);
	assert.deepEqual([r.from.rev, r.to.rev], [5, 10]);
	assert.equal(r.from.cash, a.cash, '送礼不涉及钱');
	assert.ok(r.to.moodlets.some((m) => m.id === 'warm-moment'));
	assert.match(r.to.journal.at(-1)!.text, /阿甲送了你/);
	assert.deepEqual(tradesToday(r.from, DAY), { out: 1, in: 0 });
	assert.deepEqual(tradesToday(r.to, DAY), { out: 0, in: 1 });
	// 最后一件送出去后背包里不留 0
	const r2 = applyTrade(r.from, r.to, 'snack', 0, DAY, { from: '阿甲', to: '阿乙' });
	if (typeof r2 === 'string') assert.fail(r2);
	assert.equal('snack' in r2.from.inventory, false);
});

test('二手摊：买方付钱给卖方；价格限定在商店价的 50%–150%', () => {
	const range = saleRange('firstaid')!;
	assert.deepEqual(range, { min: 18, max: 52 }, '急救包商店价 $35');
	const a = mk('trade-aa', { inventory: { firstaid: 1 }, cash: 100 });
	const b = mk('trade-bb', { cash: 30 });
	const r = applyTrade(a, b, 'firstaid', 30, DAY, { from: 'A', to: 'B' });
	if (typeof r === 'string') assert.fail(r);
	assert.equal(r.from.cash, 130);
	assert.equal(r.to.cash, 0);
	assert.equal(applyTrade(a, { ...b, cash: 29 }, 'firstaid', 30, DAY, { from: 'A', to: 'B' }), '需要 $30。');
});

test('不能交易的情况：没有这件、有待处理事件、对方带满、自己和自己、今天次数用完（跨日归零）', () => {
	const a = mk('trade-aa', { inventory: { swag: 1 } });
	const b = mk('trade-bb', { inventory: { swag: 1 } });
	assert.match(giveBlocked(a, 'snack', DAY)!, /没有这件/);
	assert.match(giveBlocked({ ...a, pending: { eventId: 'rainbow' } }, 'swag', DAY)!, /事件/);
	assert.match(takeBlocked(b, 'swag', 0, DAY)!, /带满/, '睡袋最多带 1 个');
	assert.match(applyTrade(a, a, 'swag', 0, DAY, { from: 'A', to: 'A' }) as string, /自己/);
	const tired = { ...a, trades: { day: DAY, out: TRADE_DAILY, in: 0 } };
	assert.match(giveBlocked(tired, 'swag', DAY)!, /明天再来/);
	assert.equal(giveBlocked(tired, 'swag', DAY + 1), undefined, '第二天归零');
	assert.match(takeBlocked({ ...b, inventory: {}, trades: { day: DAY, out: 0, in: TRADE_DAILY } }, 'swag', 0, DAY)!, /明天再来/);
	assert.equal(applyTrade(a, b, 'swag', -5, DAY, { from: 'A', to: 'B' }), '价格无效。');
});

test('存档校验：trades 钳到合法范围，旧存档补默认值', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const s = sanitizeState({ ...mk('trade-aa'), trades: { day: 3.7, out: -2, in: 1e9 } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(s.trades, { day: 3, out: 0, in: 1000 });
	const old: Record<string, unknown> = { ...mk('trade-aa') };
	delete old.trades;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.trades, { day: 0, out: 0, in: 0 });
});

test('常遇见的人：次数累加、名字跟着更新、超过上限丢最久没见的；不改入参；存档校验只留合法条目', () => {
	const a = mk('trade-aa');
	const snap = JSON.stringify(a);
	const p = { hash: 'aaaaaaaaaaaa', name: '阿乙', avatar: '🐨' };
	let s = noteMet(a, [p, { hash: 'bad', name: 'x', avatar: 'x' }], 10);
	s = noteMet(s, [{ ...p, name: '阿乙改名' }], 12);
	assert.equal(JSON.stringify(a), snap, '入参没被改');
	assert.deepEqual(s.met, { aaaaaaaaaaaa: { name: '阿乙改名', avatar: '🐨', n: 2, last: 12 } });
	for (let i = 0; i < MET_MAX + 5; i++) s = noteMet(s, [{ hash: i.toString(16).padStart(12, '0'), name: `p${i}`, avatar: '🧑' }], 100 + i);
	assert.equal(Object.keys(s.met).length, MET_MAX);
	assert.ok(!('aaaaaaaaaaaa' in s.met), '最久没见的被挤掉');
	assert.equal(metList(s)[0].last, 100 + MET_MAX + 4, '次数相同按最近排');
	const locs = new Set(WA.locations.map((l) => l.id));
	const dirty = sanitizeState({ ...a, met: { 'not-a-hash': { name: 'x' }, bbbbbbbbbbbb: { name: '<b>坏</b>', avatar: '<img>', n: -3, last: 4.5 } } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(dirty.met, { bbbbbbbbbbbb: { name: 'b坏/b', avatar: 'img', n: 1, last: 4 } });
});

test('有待处理事件时不能收礼或买东西（审查问题 4）', () => {
	const b = mk('trade-bb', { pending: { eventId: 'quokka-selfie' } });
	assert.match(takeBlocked(b, 'snack', 0, DAY)!, /事件/);
	assert.match(applyTrade(mk('trade-aa', { inventory: { snack: 1 } }), b, 'snack', 0, DAY, { from: 'A', to: 'B' }) as string, /事件/);
});
