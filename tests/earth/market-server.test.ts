// 交易所与面交的服务端测试：托管、钱和东西守恒、并发（同时买同一件、同时撤回和买、同一人同时花两笔钱）、
// 重放（同一请求编号只执行一次）、到期结算、新号限制、每日额度、注销清理。用内存里的假存储直接调 fetch()，不联网。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { EXCHANGE } from '../../src/game/core/exchange.ts';

function makeWorld(delayMs = 0) {
	const data = new Map<string, any>();
	const wait = () => (delayMs ? new Promise((done) => setTimeout(done, Math.random() * delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			await wait();
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		delete: async (k: string | string[]) => { await wait(); for (const x of Array.isArray(k) ? k : [k]) data.delete(x); },
		list: async ({ prefix = '' }: { prefix?: string } = {}) => {
			await wait();
			return new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)]));
		},
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, world };
}

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const profile = { name: '测试', avatar: '🧑', origin: 'student', traits: [] };
let nonceN = 0;
const nonce = () => 'n' + (++nonceN).toString(36).padStart(10, '0');
type Cred = { id: string; key: string };
const cred = (id: string): Cred => ({ id, key: 'k'.repeat(24) });

/** 建号后改成「老号」（建号日往前推、游戏里过了 10 天），并设好现金和背包 */
async function veteran(w: ReturnType<typeof makeWorld>, c: Cred, over: { cash?: number; inventory?: Record<string, number>; loc?: string } = {}) {
	await w.call({ action: 'create', ...c, profile });
	const rec = w.data.get('save:' + c.id);
	w.data.set('save:' + c.id, { ...rec, state: { ...rec.state, clock: 10 * 1440, cash: over.cash ?? 1000, inventory: over.inventory ?? {}, ...(over.loc ? { loc: over.loc } : {}) } });
	w.data.set('since:' + c.id, realDayOf(Date.now()) - 10);
	return (await w.call({ action: 'get', ...c })).data.state;
}
const rev = async (w: ReturnType<typeof makeWorld>, c: Cred) => (await w.call({ action: 'get', ...c })).data.state.rev;
const saved = (w: ReturnType<typeof makeWorld>, c: Cred) => w.data.get('save:' + c.id).state;
const mkt = async (w: ReturnType<typeof makeWorld>, c: Cred, op: string, extra: Record<string, unknown> = {}) =>
	w.call({ action: 'market', op, ...c, rev: await rev(w, c), nonce: nonce(), ...extra });
const sink = (w: ReturnType<typeof makeWorld>) => [...w.data].filter(([k]) => k.startsWith('sink:')).reduce((n, [, v]) => n + v, 0);
/** 全部现金 = 存档现金 + 邮箱里的钱 + 拍卖托管的出价 + 回收掉的手续费（只和每日奖励这类外部投放有关） */
function cashTotal(w: ReturnType<typeof makeWorld>) {
	let n = 0;
	for (const [k, v] of w.data) {
		if (k.startsWith('save:')) n += v.state.cash;
		else if (k.startsWith('mail:')) n += v.reduce((m: number, x: any) => m + x.cash, 0);
		else if (k.startsWith('lot:') && !v.gone) n += v.bid;
	}
	return n + sink(w);
}
/** 某件物品在整个世界里的数量 = 背包 + 邮箱 + 在挂的拍品 */
function itemTotal(w: ReturnType<typeof makeWorld>, item: string) {
	let n = 0;
	for (const [k, v] of w.data) {
		if (k.startsWith('save:')) n += v.state.inventory[item] ?? 0;
		else if (k.startsWith('mail:')) n += v.filter((x: any) => x.item === item).reduce((m: number, x: any) => m + x.n, 0);
		else if (k.startsWith('lot:') && !v.gone && v.item === item) n += 1;
	}
	return n;
}

test('交易所：挂出托管、别人买下、卖家领到扣佣金的钱；全程钱和东西守恒，账本只记哈希', async () => {
	const w = makeWorld();
	const S = cred('mkt-seller-1');
	const B = cred('mkt-buyer-1');
	await veteran(w, S, { cash: 100, inventory: { swag: 1 } });
	await veteran(w, B, { cash: 500 });
	const cash0 = cashTotal(w);
	const sold = await mkt(w, S, 'sell', { kind: 'fixed', item: 'swag', price: 150 });
	assert.ok(sold.data.ok, sold.data.msg);
	assert.equal(sold.data.state.inventory.swag, undefined, '挂出后背包里没有了');
	assert.equal(sold.data.state.cash, 97, '挂单费 150 × 2% = $3');
	assert.equal(sold.data.mine.length, 1);
	assert.equal(sold.data.lots.length, 0, '自己的不在「在卖的」里');
	assert.equal(itemTotal(w, 'swag'), 1);
	const seen = (await mkt(w, B, 'list')).data;
	assert.equal(seen.lots.length, 1);
	assert.equal(JSON.stringify(seen).includes(S.id), false, '卖家真实 id 不发给客户端');
	const bought = await mkt(w, B, 'buy', { lot: seen.lots[0].id });
	assert.ok(bought.data.ok, bought.data.msg);
	assert.equal(bought.data.state.cash, 350);
	assert.equal(bought.data.state.inventory.swag, 1);
	assert.equal(itemTotal(w, 'swag'), 1, '东西只有一件');
	assert.equal(cashTotal(w), cash0, '钱守恒（手续费进回收）');
	assert.equal(sink(w), 3 + 12);
	const again = await mkt(w, B, 'buy', { lot: seen.lots[0].id });
	assert.equal(again.status, 404, '不能买两次');
	const sl = (await mkt(w, S, 'list')).data;
	assert.equal(sl.mail.length, 1);
	assert.equal(sl.mail[0].cash, 138);
	const claimed = await mkt(w, S, 'claim');
	assert.ok(claimed.data.ok, claimed.data.msg);
	assert.equal(claimed.data.state.cash, 97 + 138);
	assert.equal(claimed.data.mail.length, 0);
	assert.equal(cashTotal(w), cash0);
	const tx = [...w.data].filter(([k]) => k.startsWith('tx:'));
	assert.equal(tx.length, 1);
	assert.deepEqual({ ...tx[0][1], tx: '', at: 0 }, { tx: '', at: 0, kind: 'buy', item: 'swag', n: 1, price: 150, fee: 12, seller: hashOf(S.id), buyer: hashOf(B.id), flags: [] });
	assert.equal(JSON.stringify(tx).includes(S.id) || JSON.stringify(tx).includes(B.id), false, '账本不记真实 id');
});

test('交易所：并发——两人同时买同一件只成交一笔；卖家撤回和买家买下同时到只成一个；钱和东西守恒', async () => {
	for (let round = 0; round < 6; round++) {
		const w = makeWorld(3);
		const S = cred(`mkt-seller-c${round}`);
		const B1 = cred(`mkt-buyer-c${round}a`);
		const B2 = cred(`mkt-buyer-c${round}b`);
		await veteran(w, S, { cash: 100, inventory: { surfboard: 1 } });
		await veteran(w, B1, { cash: 900 });
		await veteran(w, B2, { cash: 900 });
		const cash0 = cashTotal(w);
		const lot = (await mkt(w, S, 'sell', { kind: 'fixed', item: 'surfboard', price: 300 })).data.mine[0].id;
		const [r1, r2, r3] = await Promise.all([mkt(w, B1, 'buy', { lot }), mkt(w, B2, 'buy', { lot }), round % 2 ? mkt(w, S, 'cancel', { lot }) : Promise.resolve(null)]);
		const oks = [r1, r2, r3].filter((r) => r?.data.ok).length;
		assert.equal(oks, 1, `第 ${round} 轮只能成一个`);
		assert.equal(itemTotal(w, 'surfboard'), 1, '冲浪板只有一块');
		assert.equal(cashTotal(w), cash0, '钱守恒');
	}
});

test('交易所：同一人同时发两笔花钱的请求——存档锁让第二笔看到新版本号，不会透支', async () => {
	const w = makeWorld(3);
	const S = cred('mkt-seller-d');
	const B = cred('mkt-buyer-d');
	await veteran(w, S, { cash: 100, inventory: { surfboard: 1, swag: 1 } });
	await veteran(w, B, { cash: 400 });
	const l1 = (await mkt(w, S, 'sell', { kind: 'fixed', item: 'surfboard', price: 300 })).data.mine[0].id;
	const l2 = (await mkt(w, S, 'sell', { kind: 'auction', item: 'swag', price: 200, hours: 24 })).data.mine.find((l: any) => l.kind === 'auction').id;
	const r = await rev(w, B);
	const [a, b] = await Promise.all([
		w.call({ action: 'market', op: 'buy', ...B, rev: r, nonce: nonce(), lot: l1 }),
		w.call({ action: 'market', op: 'bid', ...B, rev: r, nonce: nonce(), lot: l2, amount: 200 }),
	]);
	assert.equal([a, b].filter((x) => x.data.ok).length, 1);
	assert.equal([a, b].filter((x) => x.status === 409).length, 1, '另一笔版本冲突，没执行');
	assert.ok(saved(w, B).cash >= 0);
});

test('交易所：重放——同一请求编号重交只执行一次（即使带着新版本号），回答相同', async () => {
	const w = makeWorld();
	const S = cred('mkt-seller-r');
	await veteran(w, S, { cash: 100, inventory: { water: 5 } });
	const n = nonce();
	const first = await w.call({ action: 'market', op: 'sell', ...S, rev: await rev(w, S), nonce: n, kind: 'fixed', item: 'water', price: 3 });
	assert.ok(first.data.ok, first.data.msg);
	const replay = await w.call({ action: 'market', op: 'sell', ...S, rev: first.data.state.rev, nonce: n, kind: 'fixed', item: 'water', price: 3 });
	assert.equal(replay.data.dup, true);
	assert.equal(replay.data.ok, true);
	assert.equal(saved(w, S).inventory.water, 4, '只挂出一瓶');
	assert.equal([...w.data.keys()].filter((k) => k.startsWith('lot:')).length, 1);
	// 被拒绝的请求也记下：重交得到同样的拒绝，不会因为条件变了而执行
	const n2 = nonce();
	const bad = await w.call({ action: 'market', op: 'sell', ...S, rev: await rev(w, S), nonce: n2, kind: 'fixed', item: 'water', price: 999 });
	assert.equal(bad.data.ok, false);
	const bad2 = await w.call({ action: 'market', op: 'sell', ...S, rev: await rev(w, S), nonce: n2, kind: 'fixed', item: 'water', price: 3 });
	assert.equal(bad2.data.dup, true);
	assert.equal(bad2.data.ok, false);
	assert.equal(saved(w, S).inventory.water, 4);
	// 没有编号、版本号落后都不执行
	assert.match((await w.call({ action: 'market', op: 'sell', ...S, rev: await rev(w, S), kind: 'fixed', item: 'water', price: 3 })).data.msg, /编号/);
	assert.equal((await w.call({ action: 'market', op: 'sell', ...S, rev: 0, nonce: nonce(), kind: 'fixed', item: 'water', price: 3 })).status, 409);
});

test('拍卖：出价托管、被超过退回邮箱、到期结算给买家东西给卖家钱；没人出价退回卖家', async () => {
	const w = makeWorld();
	const S = cred('mkt-seller-a');
	const A = cred('mkt-bidder-a');
	const B = cred('mkt-bidder-b');
	await veteran(w, S, { cash: 100, inventory: { surfboard: 1, rod: 1 } });
	await veteran(w, A, { cash: 800 });
	await veteran(w, B, { cash: 800 });
	const cash0 = cashTotal(w);
	const lot = (await mkt(w, S, 'sell', { kind: 'auction', item: 'surfboard', price: 200, hours: 6 })).data.mine[0].id;
	const empty = (await mkt(w, S, 'sell', { kind: 'auction', item: 'rod', price: 30, hours: 6 })).data.mine.find((l: any) => l.id !== lot).id;
	assert.ok((await mkt(w, A, 'bid', { lot, amount: 200 })).data.ok);
	assert.equal(saved(w, A).cash, 600);
	assert.match((await mkt(w, B, 'bid', { lot, amount: 205 })).data.msg, /\$210/);
	assert.ok((await mkt(w, B, 'bid', { lot, amount: 400 })).data.ok);
	assert.match((await mkt(w, S, 'cancel', { lot })).data.msg, /有人出价/);
	const al = (await mkt(w, A, 'list')).data;
	assert.equal(al.mail[0].cash, 200, '被超过的人退回邮箱');
	assert.equal(cashTotal(w), cash0, '出价托管期间钱守恒');
	// 时间到：把内存和存储里的结束时间都拨到过去
	const lots = (w.world as any).lots as Map<string, any>;
	for (const id of [lot, empty]) { lots.get(id).endsAt = Date.now() - 1; w.data.set('lot:' + id, { ...w.data.get('lot:' + id), endsAt: Date.now() - 1 }); }
	const bl = (await mkt(w, B, 'list')).data;
	assert.equal(bl.mail.length, 1);
	assert.equal(bl.mail[0].item, 'surfboard');
	const sl = (await mkt(w, S, 'list')).data;
	assert.deepEqual(sl.mail.map((m: any) => [m.item, m.cash]).sort(), [['rod', 0], [null, 368]].sort(), '流拍的鱼竿退回，冲浪板 400 扣 8% 佣金');
	assert.equal(sl.mine.length, 0);
	assert.ok((await mkt(w, B, 'claim')).data.ok);
	assert.equal(saved(w, B).inventory.surfboard, 1);
	assert.equal(itemTotal(w, 'surfboard'), 1);
	assert.equal(itemTotal(w, 'rod'), 1);
	assert.equal(cashTotal(w), cash0);
	assert.equal((await mkt(w, A, 'claim')).data.state.cash, 800);
	assert.deepEqual([...w.data].filter(([k]) => k.startsWith('tx:')).map(([, v]) => v.kind), ['auction']);
});

test('防刷：新号不能用交易所（领邮箱、撤回可以）；每日笔数、同一对玩家笔数、每日付出金额都有上限', async () => {
	const w = makeWorld();
	const N = cred('mkt-newbie-1');
	await w.call({ action: 'create', ...N, profile });
	const rec = w.data.get('save:' + N.id);
	w.data.set('save:' + N.id, { ...rec, state: { ...rec.state, inventory: { water: 3 } } });
	const r = await mkt(w, N, 'sell', { kind: 'fixed', item: 'water', price: 3 });
	assert.equal(r.status, 403);
	assert.match(r.data.msg, /满 3 天/);
	assert.match(r.data.newbie, /新角色/);
	const S = cred('mkt-seller-q');
	const S2 = cred('mkt-seller-q2');
	const B = cred('mkt-buyer-q');
	await veteran(w, S, { cash: 100, inventory: { water: 10 } });
	await veteran(w, S2, { cash: 100, inventory: { surfboard: 1, swag: 1, rod: 1, firstaid: 3 } });
	await veteran(w, B, { cash: 5000 });
	for (let i = 0; i < 3; i++) assert.ok((await mkt(w, S, 'sell', { kind: 'fixed', item: 'water', price: 3 })).data.ok);
	const lots = (await mkt(w, B, 'list')).data.lots.map((l: any) => l.id);
	assert.ok((await mkt(w, B, 'buy', { lot: lots[0] })).data.ok);
	assert.ok((await mkt(w, B, 'buy', { lot: lots[1] })).data.ok);
	const third = await mkt(w, B, 'buy', { lot: lots[2] });
	assert.equal(third.status, 429);
	assert.match(third.data.msg, /这位玩家/);
	// 每日付出金额：1500 封顶
	await mkt(w, S2, 'sell', { kind: 'fixed', item: 'surfboard', price: 700 });
	await mkt(w, S2, 'sell', { kind: 'fixed', item: 'swag', price: 240 });
	await mkt(w, S2, 'sell', { kind: 'fixed', item: 'rod', price: 80 });
	const l2 = (await mkt(w, B, 'list')).data.lots.filter((l: any) => l.item !== 'water');
	const big = l2.find((l: any) => l.item === 'surfboard').id;
	assert.ok((await mkt(w, B, 'buy', { lot: big })).data.ok);
	const q = w.data.get('xq:' + hashOf(B.id));
	assert.equal(q.volume, 706);
	assert.equal(q.deals, 3);
	// 挂单本身也算笔数：卖家一天最多 8 笔
	for (let i = 0; i < 2; i++) await mkt(w, S2, 'sell', { kind: 'fixed', item: 'firstaid', price: 35 });
	const sq = w.data.get('xq:' + hashOf(S2.id));
	assert.equal(sq.deals, 5);
	w.data.set('xq:' + hashOf(S2.id), { ...sq, deals: EXCHANGE.dailyDeals });
	assert.match((await mkt(w, S2, 'sell', { kind: 'fixed', item: 'firstaid', price: 35 })).data.msg, /今天已经交易 8 笔/);
	w.data.set('xq:' + hashOf(B.id), { ...q, volume: EXCHANGE.dailyVolume - 10 });
	const rod = l2.find((l: any) => l.item === 'rod').id;
	assert.match((await mkt(w, B, 'buy', { lot: rod })).data.msg, /最多付出 \$1500，还剩 \$10/);
});

test('面交：带钱换物要同一地点、双方都过新号限制；收钱一方付手续费；不能纯转钱；同时收下只成一次', async () => {
	const w = makeWorld(2);
	const A = cred('swap-from-1');
	const B = cred('swap-to-1');
	await veteran(w, A, { cash: 600, inventory: { snack: 2 } });
	await veteran(w, B, { cash: 50, inventory: { surfboard: 1 } });
	const cash0 = cashTotal(w);
	const call = (c: Cred, op: string, extra: Record<string, unknown> = {}) => w.call({ action: 'trade', op, ...c, ...extra });
	const bare = await call(A, 'swap', { to: hashOf(B.id), give: { items: [], cash: 100 }, want: { items: [] } });
	assert.match(bare.data.msg, /至少要有一件/);
	const gift = await call(A, 'swap', { to: hashOf(B.id), give: { items: [{ item: 'snack', n: 1 }], cash: 100 }, want: { items: [] } });
	assert.match(gift.data.msg, /不能直接转钱/);
	const over = await call(A, 'swap', { to: hashOf(B.id), give: { items: [], cash: 701 }, want: { items: [{ item: 'surfboard', n: 1 }] } });
	assert.match(over.data.msg, /\$175–\$700/);
	const ok = await call(A, 'swap', { to: hashOf(B.id), give: { items: [{ item: 'snack', n: 1 }], cash: 344 }, want: { items: [{ item: 'surfboard', n: 1 }] } });
	assert.ok(ok.data.ok, ok.data.msg);
	const offer = (await call(B, 'list')).data.offers.find((o: any) => o.kind === 'swap');
	assert.ok(offer.give && offer.want, '收件人看得到双方内容');
	const r = await rev(w, B);
	const [x, y] = await Promise.all([call(B, 'accept', { offer: offer.id, rev: r }), call(B, 'accept', { offer: offer.id, rev: r })]);
	assert.equal([x, y].filter((z) => z.data.ok).length, 1, '只成一次');
	assert.equal(saved(w, A).inventory.surfboard, 1);
	assert.equal(saved(w, B).inventory.snack, 1);
	assert.equal(saved(w, B).cash, 50 + 344 - 18);
	assert.equal(cashTotal(w), cash0, '钱守恒（手续费进回收）');
	assert.equal(itemTotal(w, 'surfboard'), 1);
	assert.deepEqual([...w.data].filter(([k]) => k.startsWith('tx:')).map(([, v]) => [v.kind, v.price, v.fee]), [['swap', 344, 18]]);
	// 新号：带钱的面交不行，纯换物可以
	const N = cred('swap-newbie-1');
	await w.call({ action: 'create', ...N, profile });
	const nrec = w.data.get('save:' + N.id);
	w.data.set('save:' + N.id, { ...nrec, state: { ...nrec.state, cash: 500, inventory: { water: 2 } } });
	assert.match((await call(N, 'swap', { to: hashOf(A.id), give: { items: [], cash: 200 }, want: { items: [{ item: 'surfboard', n: 1 }] } })).data.msg, /满 3 天/);
	const plain = await call(N, 'swap', { to: hashOf(A.id), give: { items: [{ item: 'water', n: 1 }] }, want: { items: [{ item: 'snack', n: 1 }] } });
	assert.ok(plain.data.ok, plain.data.msg);
	// A 是老号、N 是新号：A 想卖东西给新号收钱，收下时也挡
	const sell = await call(A, 'swap', { to: hashOf(N.id), give: { items: [{ item: 'snack', n: 1 }] }, want: { items: [], cash: 6 } });
	assert.ok(sell.data.ok, sell.data.msg);
	const so = (await call(N, 'list')).data.offers.find((o: any) => o.kind === 'swap' && !o.mine);
	const nacc = await call(N, 'accept', { offer: so.id, rev: await rev(w, N) });
	assert.equal(nacc.status, 403);
	assert.match(nacc.data.msg, /满 3 天/);
});

test('注销：他挂的拍品撤下，已出价的人全额退回邮箱；他的邮箱、额度、建号记录一起删', async () => {
	const w = makeWorld();
	const S = cred('mkt-seller-del');
	const B = cred('mkt-buyer-del');
	await veteran(w, S, { cash: 100, inventory: { surfboard: 1 } });
	await veteran(w, B, { cash: 900 });
	const lot = (await mkt(w, S, 'sell', { kind: 'auction', item: 'surfboard', price: 200, hours: 24 })).data.mine[0].id;
	assert.ok((await mkt(w, B, 'bid', { lot, amount: 300 })).data.ok);
	const del = await w.call({ action: 'delete', ...S, confirm: 'delete' });
	assert.ok(del.data.ok, del.data.msg);
	for (const k of ['save:', 'since:', 'mail:', 'mops:']) assert.equal(w.data.has(k + S.id), false, k);
	assert.equal(w.data.has('xq:' + hashOf(S.id)), false);
	const bl = (await mkt(w, B, 'list')).data;
	assert.equal(bl.lots.length, 0);
	assert.equal(bl.mail[0].cash, 300);
	assert.equal((await mkt(w, B, 'claim')).data.state.cash, 900);
});

// ---------- 合并 main 后复核补的 ----------
/** 直接在存档里记下 who 屏蔽了 target（测试用；正式流程走 safety 动作） */
function block(w: ReturnType<typeof makeWorld>, who: Cred, target: Cred) {
	const rec = w.data.get('save:' + who.id);
	const blocked = { ...(rec.state.blocked ?? {}), [hashOf(target.id)]: { name: '被屏蔽', avatar: '🙈', day: realDayOf(Date.now()) } };
	w.data.set('save:' + who.id, { ...rec, state: { ...rec.state, blocked } });
}

test('屏蔽（合并 main 后）：屏蔽了卖家就看不到他挂的东西，也买不了、拍不了；卖家屏蔽了我也一样', async () => {
	const w = makeWorld();
	const S = cred('mkt-block-seller');
	const A = cred('mkt-block-a');
	const B = cred('mkt-block-b');
	await veteran(w, S, { cash: 100, inventory: { swag: 1, surfboard: 1 } });
	await veteran(w, A, { cash: 900 });
	await veteran(w, B, { cash: 900 });
	assert.ok((await mkt(w, S, 'sell', { kind: 'fixed', item: 'swag', price: 150 })).data.ok);
	assert.ok((await mkt(w, S, 'sell', { kind: 'auction', item: 'surfboard', price: 200, hours: 24 })).data.ok);
	const lots = (await mkt(w, A, 'list')).data.lots;
	assert.equal(lots.length, 2, '（对照）没屏蔽时看得到两件');
	const fixed = lots.find((l: any) => l.kind === 'fixed').id;
	const auction = lots.find((l: any) => l.kind === 'auction').id;
	// A 屏蔽了卖家
	block(w, A, S);
	assert.equal((await mkt(w, A, 'list')).data.lots.length, 0, '屏蔽了卖家：列表里看不到');
	assert.match((await mkt(w, A, 'buy', { lot: fixed })).data.msg, /你屏蔽了对方/);
	assert.match((await mkt(w, A, 'bid', { lot: auction, amount: 250 })).data.msg, /你屏蔽了对方/);
	// 卖家屏蔽了 B：B 看得到（不暴露谁屏蔽了谁），但买不了、拍不了
	block(w, S, B);
	assert.equal((await mkt(w, B, 'list')).data.lots.length, 2);
	assert.match((await mkt(w, B, 'buy', { lot: fixed })).data.msg, /对方现在不接受/);
	assert.match((await mkt(w, B, 'bid', { lot: auction, amount: 250 })).data.msg, /对方现在不接受/);
	assert.equal(saved(w, B).cash, 900, '没扣钱');
	assert.equal(itemTotal(w, 'swag'), 1);
});

test('屏蔽（合并 main 后）：面交换物两个方向都发不出；已经发出的换物请求，屏蔽后列表里看不到', async () => {
	const w = makeWorld();
	const A = cred('swap-block-a');
	const B = cred('swap-block-b');
	await veteran(w, A, { cash: 600, inventory: { snack: 2 } });
	await veteran(w, B, { cash: 50, inventory: { surfboard: 1 } });
	const call = (c: Cred, op: string, extra: Record<string, unknown> = {}) => w.call({ action: 'trade', op, ...c, ...extra });
	const body = (to: Cred) => ({ to: hashOf(to.id), give: { items: [{ item: 'snack', n: 1 }] }, want: { items: [{ item: 'surfboard', n: 1 }] } });
	const sent = await call(A, 'swap', body(B));
	assert.ok(sent.data.ok, sent.data.msg);
	const seen = (await call(B, 'list')).data.offers.filter((o: any) => o.kind === 'swap');
	assert.equal(seen.length, 1, '（对照）没屏蔽时收件人看得到');
	assert.ok(seen[0].give && seen[0].want, '换物内容带着');
	block(w, B, A);
	assert.equal((await call(B, 'list')).data.offers.filter((o: any) => o.kind === 'swap').length, 0, 'B 屏蔽 A 后看不到 A 的换物请求');
	assert.match((await call(A, 'swap', body(B))).data.msg, /对方现在不能和你交换/, '被对方屏蔽了：发不出');
	assert.match((await call(B, 'swap', { to: hashOf(A.id), give: { items: [{ item: 'surfboard', n: 1 }] }, want: { items: [{ item: 'snack', n: 1 }] } })).data.msg, /你屏蔽了对方/, '自己屏蔽了对方：发不出');
});

test('建号日（合并 main 后）：玩家关了统计（nt）也照样记 since:（新号限制要用），但不记统计的 born:', async () => {
	const w = makeWorld();
	const N = cred('since-nt-1');
	const made = await w.call({ action: 'create', ...N, profile, nt: true });
	assert.ok(made.data.ok, made.data.msg);
	assert.equal(w.data.get('since:' + N.id), realDayOf(Date.now()));
	assert.equal([...w.data.keys()].some((k) => k.startsWith('born:')), false, '统计的注册日不记');
	const rec = w.data.get('save:' + N.id);
	w.data.set('save:' + N.id, { ...rec, state: { ...rec.state, clock: 10 * 1440, inventory: { swag: 1 } } });
	assert.match((await mkt(w, N, 'sell', { kind: 'fixed', item: 'swag', price: 150 })).data.msg, /满 3 天/, '照样按新号限制');
});

test('注销（合并 main 后补测）：最高出价的人注销，出价清掉，拍品还在；到期没人出价退回卖家', async () => {
	const w = makeWorld();
	const S = cred('mkt-seller-del2');
	const B = cred('mkt-bidder-del2');
	await veteran(w, S, { cash: 100, inventory: { surfboard: 1 } });
	await veteran(w, B, { cash: 900 });
	const lot = (await mkt(w, S, 'sell', { kind: 'auction', item: 'surfboard', price: 200, hours: 6 })).data.mine[0].id;
	assert.ok((await mkt(w, B, 'bid', { lot, amount: 300 })).data.ok);
	assert.ok((await w.call({ action: 'delete', ...B, confirm: 'delete' })).data.ok);
	assert.equal(w.data.has('mail:' + B.id), false, '注销的人没有邮箱留下');
	const mine = (await mkt(w, S, 'list')).data.mine;
	assert.equal(mine.length, 1, '拍品还在');
	assert.equal(mine[0].bid, 0, '出价清掉了');
	// 到期：没人出价，东西退回卖家邮箱
	const cached = await (w.world as any).loadLots();
	cached.get(lot).endsAt = Date.now() - 1;
	w.data.set('lot:' + lot, { ...w.data.get('lot:' + lot), endsAt: Date.now() - 1 });
	const after = (await mkt(w, S, 'list')).data;
	assert.equal(after.mine.length, 0);
	assert.ok(after.mail.some((m: any) => m.item === 'surfboard'), '流拍退回卖家');
	assert.equal(itemTotal(w, 'surfboard'), 1);
});
