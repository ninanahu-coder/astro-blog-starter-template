// 交易所与面交的规则（纯函数）：托管、手续费、价格带、新号限制、额度、拍卖加价与防抢拍、结算、邮箱、面交形状（不能纯转钱）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import {
	bidLot, buyLot, cancelLot, claimMail, createLot, EXCHANGE, feeOf, minBid, newbieBlocked, parseSwapSide, priceBand, priceFlags, pushMail,
	quotaAdd, quotaBlocked, quotaOf, resolveSwap, settleLot, swapCashBand, swapReceiverBlocked, swapShapeBlocked, type Lot, type Mail,
} from '../../src/game/core/exchange.ts';
import { swapCashOptions } from '../../src/game/ui/market.ts';
import { getItem } from '../../src/game/core/attributes.ts';

const DAY = 20_000;
const T0 = 1_800_000_000_000;
const mk = (id: string, over: Record<string, unknown> = {}) => ({ ...createCharacter({ id, name: id, avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 }), clock: 10 * 1440, ...over });
const ctxL = (lotId = 'aaaaaaaaaaaa') => ({ lotId, hash: 'a'.repeat(12), now: T0, openLots: 0 });

test('挂出：东西从背包扣走托管，扣挂单费（至少 $1），不改入参；价格、数量、事件、上限都挡', () => {
	const s = mk('ex-seller', { inventory: { firstaid: 2 }, cash: 100, rev: 3 });
	const snap = JSON.stringify(s);
	const r = createLot(s, { kind: 'fixed', item: 'firstaid', price: 40, hours: 0 }, ctxL());
	if (typeof r === 'string') assert.fail(r);
	assert.equal(JSON.stringify(s), snap, '入参没被改');
	assert.equal(r.state.inventory.firstaid, 1);
	assert.equal(r.fee, 1, '40 × 2% = 0.8，至少 $1');
	assert.equal(r.state.cash, 99);
	assert.equal(r.state.rev, 4);
	assert.equal(r.lot.endsAt, T0 + EXCHANGE.fixedHours * 3_600_000);
	assert.deepEqual(priceBand('firstaid'), { min: 18, max: 70 }, '急救包商店价 $35：0.5–2 倍');
	assert.match(createLot(s, { kind: 'fixed', item: 'firstaid', price: 71, hours: 0 }, ctxL()) as string, /\$18–\$70/);
	assert.match(createLot(s, { kind: 'fixed', item: 'firstaid', price: 10.5, hours: 0 }, ctxL()) as string, /之间/);
	assert.match(createLot(s, { kind: 'auction', item: 'firstaid', price: 30, hours: 3 }, ctxL()) as string, /时长/);
	assert.match(createLot(s, { kind: 'fixed', item: 'swag', price: 100, hours: 0 }, ctxL()) as string, /没有这件/);
	assert.match(createLot({ ...s, pending: { eventId: 'x' } }, { kind: 'fixed', item: 'firstaid', price: 30, hours: 0 }, ctxL()) as string, /事件/);
	assert.match(createLot(s, { kind: 'fixed', item: 'firstaid', price: 30, hours: 0 }, { ...ctxL(), openLots: EXCHANGE.maxLots }) as string, /最多挂/);
	assert.match(createLot({ ...s, cash: 0 }, { kind: 'fixed', item: 'firstaid', price: 30, hours: 0 }, ctxL()) as string, /挂单费/);
	assert.match(createLot(s, { kind: 'fixed', item: 'not-an-item', price: 30, hours: 0 }, ctxL()) as string, /不能交易/);
});

test('一口价买下：买家付全价拿到东西，卖家邮箱收到扣佣金后的钱；钱守恒（差额正好是佣金）', () => {
	const seller = mk('ex-seller', { inventory: { swag: 1 }, cash: 50 });
	const r = createLot(seller, { kind: 'fixed', item: 'swag', price: 120, hours: 0 }, ctxL());
	if (typeof r === 'string') assert.fail(r);
	const buyer = mk('ex-buyer', { cash: 200 });
	const snap = JSON.stringify(buyer);
	const b = buyLot(buyer, r.lot, { now: T0 + 1, mailId: 'm1', tx: 't1', buyerHash: 'b'.repeat(12) });
	if (typeof b === 'string') assert.fail(b);
	assert.equal(JSON.stringify(buyer), snap, '入参没被改');
	assert.equal(b.buyer.cash, 80);
	assert.equal(b.buyer.inventory.swag, 1);
	assert.equal(b.fee, 10, '120 × 8% = 9.6 向上取整');
	assert.equal(b.mail.cash, 110);
	assert.equal(buyer.cash - b.buyer.cash - b.mail.cash, b.fee, '买家付出的 = 卖家到手 + 佣金');
	assert.deepEqual(b.entry.flags, []);
	assert.equal(b.entry.seller, 'a'.repeat(12));
	assert.match(buyLot({ ...buyer, cash: 119 }, r.lot, { now: T0 + 1, mailId: 'm', tx: 't', buyerHash: 'b'.repeat(12) }) as string, /\$120/);
	assert.match(buyLot({ ...buyer, inventory: { swag: 1 } }, r.lot, { now: T0 + 1, mailId: 'm', tx: 't', buyerHash: 'b'.repeat(12) }) as string, /带满/);
	assert.match(buyLot({ ...buyer, id: 'ex-seller' }, r.lot, { now: T0 + 1, mailId: 'm', tx: 't', buyerHash: 'b'.repeat(12) }) as string, /自己/);
	assert.match(buyLot(buyer, r.lot, { now: r.lot.endsAt, mailId: 'm', tx: 't', buyerHash: 'b'.repeat(12) }) as string, /结束/);
	assert.match(buyLot(buyer, { ...r.lot, kind: 'auction' }, { now: T0, mailId: 'm', tx: 't', buyerHash: 'b'.repeat(12) }) as string, /出价/);
});

const auction = (over: Partial<Lot> = {}): Lot => ({
	id: 'aaaaaaaaaaaa', kind: 'auction', seller: 'ex-seller', sellerHash: 'a'.repeat(12), sellerName: '卖家', sellerAvatar: '🧑', item: 'surfboard', price: 200,
	bid: 0, bidder: null, bidderHash: '', at: T0, endsAt: T0 + 24 * 3_600_000, extends: 0, ...over,
});

test('拍卖出价：钱扣下托管；被超过的人全额退回邮箱；自己加价只多扣差额；加价至少 5%；最多出到商店价 2 倍', () => {
	const lot = auction();
	assert.equal(minBid(lot), 200);
	const a = mk('ex-a', { cash: 1000 });
	const r1 = bidLot(a, lot, 200, { now: T0 + 1000, mailId: 'm1', bidderHash: 'c'.repeat(12) });
	if (typeof r1 === 'string') assert.fail(r1);
	assert.equal(r1.bidder.cash, 800);
	assert.equal(r1.refund, null);
	assert.equal(minBid(r1.lot), 210);
	assert.match(bidLot(mk('ex-b', { cash: 1000 }), r1.lot, 209, { now: T0 + 2000, mailId: 'm', bidderHash: 'd'.repeat(12) }) as string, /\$210/);
	const b = mk('ex-b', { cash: 1000 });
	const r2 = bidLot(b, r1.lot, 250, { now: T0 + 2000, mailId: 'm2', bidderHash: 'd'.repeat(12) });
	if (typeof r2 === 'string') assert.fail(r2);
	assert.deepEqual(r2.refund, { to: 'ex-a', mail: { id: 'm2', cash: 200, item: null, n: 0, text: r2.refund!.mail.text, at: T0 + 2000 } });
	assert.equal(r2.bidder.cash, 750);
	// b 自己再加价：退回上一口，只多扣差额
	const r3 = bidLot(r2.bidder, r2.lot, 300, { now: T0 + 3000, mailId: 'm3', bidderHash: 'd'.repeat(12) });
	if (typeof r3 === 'string') assert.fail(r3);
	assert.equal(r3.bidder.cash, 700);
	assert.equal(r3.refund, null);
	assert.match(bidLot(mk('ex-c', { cash: 5000 }), r3.lot, 701, { now: T0 + 4000, mailId: 'm', bidderHash: 'e'.repeat(12) }) as string, /最多出到 \$700/);
	assert.match(bidLot(mk('ex-c', { cash: 5000 }), auction({ kind: 'fixed' }), 300, { now: T0, mailId: 'm', bidderHash: 'e'.repeat(12) }) as string, /直接买/);
});

test('防抢拍：结束前 5 分钟内出价顺延 5 分钟，最多顺延 6 次', () => {
	const end = T0 + 24 * 3_600_000;
	const a = mk('ex-a', { cash: 5000 });
	const r = bidLot(a, auction(), 200, { now: end - 60_000, mailId: 'm', bidderHash: 'c'.repeat(12) });
	if (typeof r === 'string') assert.fail(r);
	assert.equal(r.lot.endsAt, end + 5 * 60_000);
	assert.equal(r.lot.extends, 1);
	const capped = bidLot(a, auction({ extends: EXCHANGE.maxExtends }), 200, { now: end - 60_000, mailId: 'm', bidderHash: 'c'.repeat(12) });
	if (typeof capped === 'string') assert.fail(capped);
	assert.equal(capped.lot.endsAt, end, '顺延次数用完');
	const early = bidLot(a, auction(), 200, { now: end - 10 * 60_000, mailId: 'm', bidderHash: 'c'.repeat(12) });
	if (typeof early === 'string') assert.fail(early);
	assert.equal(early.lot.endsAt, end);
});

test('到期结算：没到期不动；没人出价退回卖家；有人出价东西给买家、钱扣佣金给卖家；异常高价打标记', () => {
	const lot = auction({ bid: 650, bidder: 'ex-b', bidderHash: 'd'.repeat(12) });
	assert.equal(settleLot(lot, lot.endsAt - 1, { a: 'x', b: 'y', tx: 't' }), null);
	const r = settleLot(lot, lot.endsAt, { a: 'x', b: 'y', tx: 't' })!;
	assert.equal(r.fee, 52);
	assert.deepEqual(r.mails.map((m) => [m.to, m.mail.cash, m.mail.item]), [['ex-b', 0, 'surfboard'], ['ex-seller', 598, null]]);
	assert.deepEqual(r.entry!.flags, ['price-high'], '650 > 350 × 1.5');
	const none = settleLot(auction(), auction().endsAt, { a: 'x', b: 'y', tx: 't' })!;
	assert.deepEqual(none.mails.map((m) => [m.to, m.mail.item, m.mail.cash]), [['ex-seller', 'surfboard', 0]]);
	assert.equal(none.entry, null);
	assert.deepEqual(priceFlags('surfboard', 200), ['price-low'], '200 < 350 × 0.6');
	assert.deepEqual(priceFlags('surfboard', 350), []);
});

test('撤回：寄卖随时可以，拍卖有人出价后不行；背包满了进邮箱；只能撤自己的', () => {
	const s = mk('ex-seller', { inventory: {} });
	const r = cancelLot(s, auction(), { now: T0, mailId: 'm' });
	if (typeof r === 'string') assert.fail(r);
	assert.equal(r.state.inventory.surfboard, 1);
	assert.equal(r.mail, null);
	const full = cancelLot({ ...s, inventory: { surfboard: 1 } }, auction(), { now: T0, mailId: 'm' });
	if (typeof full === 'string') assert.fail(full);
	assert.equal(full.mail!.item, 'surfboard');
	assert.equal(full.state.inventory.surfboard, 1);
	assert.match(cancelLot(s, auction({ bid: 200, bidder: 'x' }), { now: T0, mailId: 'm' }) as string, /有人出价/);
	assert.match(cancelLot(mk('ex-other'), auction(), { now: T0, mailId: 'm' }) as string, /自己/);
});

test('邮箱：钱全领、东西按空位领，放不下的留着；空邮箱不改存档；超过上限只合并现金，不丢东西', () => {
	const box: Mail[] = [
		{ id: 'a', cash: 30, item: null, n: 0, text: '', at: 1 },
		{ id: 'b', cash: 0, item: 'surfboard', n: 1, text: '', at: 2 },
		{ id: 'c', cash: 0, item: 'water', n: 12, text: '', at: 3 },
	];
	const s = mk('ex-a', { cash: 5, inventory: { surfboard: 1 } });
	const r = claimMail(s, box);
	if (typeof r === 'string') assert.fail(r);
	assert.equal(r.state.cash, 35);
	assert.equal(r.state.inventory.water, 10, '饮用水最多带 10');
	assert.deepEqual(r.left.map((m) => [m.item, m.n, m.cash]), [['surfboard', 1, 0], ['water', 2, 0]]);
	assert.match(claimMail(s, []) as string, /空/);
	assert.match(claimMail(s, [box[1]]) as string, /满/);
	let big: Mail[] = [];
	for (let i = 0; i < EXCHANGE.mailMax + 5; i++) big = pushMail(big, { id: 'm' + i, cash: 10, item: i % 3 ? null : 'water', n: i % 3 ? 0 : 1, text: '', at: i });
	assert.equal(big.length, EXCHANGE.mailMax);
	assert.equal(big.reduce((n, m) => n + m.cash, 0), 10 * (EXCHANGE.mailMax + 5), '现金一分不少');
	assert.equal(big.filter((m) => m.item).length, Math.ceil((EXCHANGE.mailMax + 5) / 3), '东西一件不少');
});

test('新号限制、每日额度、同一对玩家上限、拍品多次出价只算一笔', () => {
	const s = mk('ex-a');
	assert.match(newbieBlocked(s, DAY - 1, DAY)!, /还差 2 天/);
	assert.equal(newbieBlocked(s, DAY - EXCHANGE.minRealDays, DAY), undefined);
	assert.equal(newbieBlocked(s, null, DAY), undefined, '老存档没有建号记录按老号');
	assert.match(newbieBlocked({ ...s, clock: 0 }, null, DAY)!, /游戏里过满/);
	let q = quotaOf(undefined, DAY);
	q = quotaAdd(q, 100, 'b'.repeat(12));
	q = quotaAdd(q, 100, 'b'.repeat(12));
	assert.match(quotaBlocked(q, 10, 'b'.repeat(12))!, /这位玩家/);
	assert.equal(quotaBlocked(q, 10, 'c'.repeat(12)), undefined);
	assert.match(quotaBlocked(q, EXCHANGE.dailyVolume, null)!, /最多付出/);
	q = quotaAdd(q, 10, 'c'.repeat(12), 'lot1');
	q = quotaAdd(q, 20, 'c'.repeat(12), 'lot1');
	assert.equal(q.deals, 3, '同一件拍品加价不重复计笔数');
	assert.equal(q.volume, 230);
	for (let i = 0; i < 10; i++) q = quotaAdd(q, 0, null);
	assert.match(quotaBlocked(q, 0, null)!, /笔了/);
	assert.equal(quotaBlocked(q, 0, null, 'lot1'), undefined, '已经计过的拍品还能继续加价');
	assert.deepEqual(quotaOf(q, DAY + 1).deals, 0, '跨日归零');
	assert.deepEqual(quotaOf({ day: DAY, deals: -3, volume: 'x', pairs: { bad: 9, ['f'.repeat(12)]: 2.7 }, lots: [1, 'x'] }, DAY), { day: DAY, deals: 0, volume: 0, pairs: { ['f'.repeat(12)]: 2 }, lots: ['x'] });
	assert.equal(feeOf(0, 0.08), 0);
	assert.equal(feeOf(1, 0.08), 1, '至少 $1，但不超过价款');
});

test('面交形状：不能纯转钱、不能两边都给钱、带钱时按商店价限价、纯换物不限价', () => {
	const side = (items: [string, number][], cash = 0) => ({ items: items.map(([item, n]) => ({ item, n })), cash });
	assert.match(swapShapeBlocked(side([], 100), side([]))!, /至少要有一件/);
	assert.match(swapShapeBlocked(side([['snack', 1]], 100), side([]))!, /不能直接转钱/, '给东西还倒贴钱 = 转钱');
	assert.match(swapShapeBlocked(side([['snack', 1]], 5), side([['water', 1]], 5))!, /一方/);
	assert.equal(swapShapeBlocked(side([['snack', 1]]), side([['surfboard', 1]])), undefined, '纯换物不限价（和送礼一样）');
	assert.deepEqual(swapCashBand(side([['surfboard', 1]]), side([['snack', 1]])), { min: 169, max: 694 });
	assert.equal(swapShapeBlocked(side([], 350), side([['surfboard', 1]])), undefined, '按商店价买');
	assert.match(swapShapeBlocked(side([], 701), side([['surfboard', 1]]))!, /\$175–\$700/);
	assert.match(swapShapeBlocked(side([], 50), side([['surfboard', 1]]))!, /\$175–\$700/, '低价卖也算异常：挡反向倒货');
	assert.equal(parseSwapSide({ items: [{ item: 'snack', n: 1 }, { item: 'snack', n: 2 }] }), null, '同一件不能列两次');
	assert.equal(parseSwapSide({ items: [{ item: 'snack', n: 1 }], cash: -1 }), null);
	assert.equal(parseSwapSide({ items: [{ item: 'nope', n: 1 }] }), null);
	assert.equal(parseSwapSide({ items: new Array(4).fill(0).map((_, i) => ({ item: ['snack', 'water', 'coffee', 'rod'][i], n: 1 })) }), null);
	assert.deepEqual(parseSwapSide({ items: [{ item: 'snack', n: 2 }] }), { items: [{ item: 'snack', n: 2 }], cash: 0 });
	// 界面的加钱选项都能过形状检查
	for (const [g, w] of [['snack', 'surfboard'], ['surfboard', 'snack'], [undefined, 'rod'], ['rod', undefined], ['water', 'snack']] as const) {
		for (const o of swapCashOptions(g, w)) assert.equal(swapShapeBlocked(side(g ? [[g, 1]] : [], o.give), side(w ? [[w, 1]] : [], o.want)), undefined, `${g}→${w} ${o.label}`);
	}
});

test('面交结算：双方一次换好、收钱一方付手续费、钱守恒、计每日次数；条件不满足不改存档', () => {
	const a = mk('ex-a', { inventory: { snack: 2 }, cash: 500 });
	const b = mk('ex-b', { inventory: { surfboard: 1 }, cash: 10 });
	const give = { items: [{ item: 'snack', n: 1 }], cash: 344 };
	const want = { items: [{ item: 'surfboard', n: 1 }], cash: 0 };
	const snap = JSON.stringify([a, b]);
	const r = resolveSwap(a, b, give, want, { now: T0, day: DAY, tx: 't', aHash: 'a'.repeat(12), bHash: 'b'.repeat(12) });
	if (typeof r === 'string') assert.fail(r);
	assert.equal(JSON.stringify([a, b]), snap, '入参没被改');
	assert.equal(r.a.inventory.surfboard, 1);
	assert.equal(r.a.inventory.snack, 1);
	assert.equal(r.b.inventory.snack, 1);
	assert.equal('surfboard' in r.b.inventory, false);
	assert.equal(r.fee, 18, '344 × 5% = 17.2 向上取整');
	assert.equal(r.a.cash, 156);
	assert.equal(r.b.cash, 10 + 344 - 18);
	assert.equal(a.cash + b.cash - r.a.cash - r.b.cash, r.fee, '钱只少了手续费');
	assert.deepEqual([r.a.trades.out, r.b.trades.in], [1, 1]);
	assert.equal(r.entry.seller, 'b'.repeat(12), '收钱的是卖方');
	const ctx = { now: T0, day: DAY, tx: 't', aHash: 'a'.repeat(12), bHash: 'b'.repeat(12) };
	assert.match(resolveSwap(a, { ...b, loc: 'albany' }, give, want, ctx) as string, /同一个地点/);
	assert.match(resolveSwap(a, { ...b, inventory: {} }, give, want, ctx) as string, /你没有/);
	assert.match(resolveSwap({ ...a, cash: 300 }, b, give, want, ctx) as string, /发起人/);
	assert.match(resolveSwap(a, { ...b, inventory: { surfboard: 1, snack: 10 } }, give, want, ctx) as string, /放不下/);
	assert.match(resolveSwap(a, a, give, want, ctx) as string, /自己/);
	assert.match(resolveSwap({ ...a, trades: { day: DAY, out: 5, in: 0 } }, b, give, want, ctx) as string, /给出去 5 次/);
});

test('界面：交易所卡片和面交说明里的玩家名字、邮箱文字都经过 esc()；有防诈骗和禁止真钱交易的提示', async () => {
	const { marketCard, swapDesc, swapPicker, SAFETY_TIP } = await import('../../src/game/ui/market.ts');
	const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
	const evil = '<img src=x onerror=alert(1)>';
	const s = mk('ex-ui', { inventory: { surfboard: 1 }, cash: 1000 });
	const lot = { id: 'abcdefabcdef', kind: 'auction' as const, item: 'surfboard', price: 200, bid: 0, next: 200, name: evil, avatar: evil, endsAt: T0 + 3_600_000, mine: false, leading: false };
	const html = marketCard(esc, s, { lots: [lot, { ...lot, id: 'fedcbafedcba', kind: 'fixed', price: 300 }], mine: [], mail: [{ id: 'm', cash: 5, item: null, n: 0, text: evil, at: T0 }], quota: { deals: 0, volume: 0, maxDeals: 8, maxVolume: 1500 }, newbie: null }, { item: 'surfboard', kind: 'auction' }, T0);
	assert.equal(html.includes('<img'), false);
	assert.ok(html.includes('&lt;img'));
	assert.ok(html.includes(esc(SAFETY_TIP)));
	assert.match(SAFETY_TIP, /真钱/);
	assert.match(SAFETY_TIP, /同步码/);
	assert.ok(html.includes('data-mkt="bid"') && html.includes('data-mkt="buy"') && html.includes('data-mkt="sell"'));
	const picker = swapPicker(esc, s, { to: 'a'.repeat(12), name: evil, give: 'surfboard', want: 'snack' });
	assert.equal(picker.includes('<img'), false);
	assert.ok(picker.includes('data-swap="send"'));
	assert.equal(swapDesc(esc, { items: [{ item: 'snack', n: 2 }], cash: 0 }, { items: [], cash: 9 }), '拿出 🍫能量棒×2，想换你的 $9');
});

test('换物预检（合并 main 后，界面用来把「同意」置灰）：东西、钱、背包、待处理事件、今天收下的次数', () => {
	const give = { items: [{ item: 'snack', n: 1 }], cash: 0 };
	const want = { items: [{ item: 'surfboard', n: 1 }], cash: 0 };
	const ok = mk('pre-b', { inventory: { surfboard: 1 }, cash: 100 });
	assert.equal(swapReceiverBlocked(ok, give, want, DAY), undefined);
	assert.match(swapReceiverBlocked(mk('pre-b', { inventory: {} }), give, want, DAY)!, /没有对方想要的东西/);
	assert.match(swapReceiverBlocked(mk('pre-b', { inventory: { surfboard: 1 }, cash: 10 }), give, { ...want, cash: 40 }, DAY)!, /钱不够/);
	assert.match(swapReceiverBlocked({ ...ok, pending: { eventId: 'x' } }, give, want, DAY)!, /事件/);
	const full = getItem('snack')!.max;
	assert.match(swapReceiverBlocked(mk('pre-b', { inventory: { surfboard: 1, snack: full } }), give, want, DAY)!, /背包放不下/, '对方给的东西已经拿满了');
	assert.match(swapReceiverBlocked({ ...ok, trades: { day: DAY, out: 0, in: 99 } } as never, give, want, DAY)!, /收下/);
	// 和服务端结算一致：预检通过的，resolveSwap 在收件人这边也不挡
	const a = mk('pre-a', { inventory: { snack: 1 } });
	assert.equal(typeof resolveSwap(a, ok, give, want, { now: T0, day: DAY, tx: 't', aHash: 'aaaaaaaaaaaa', bHash: 'bbbbbbbbbbbb' }), 'object');
});
