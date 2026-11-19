// 二手市场「邻里换手墙」：数据自洽、不能套利、看货 / 先转账 / 砍价 / 假付款、搬家季、协议校验、存档清洗、界面转义
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { cleanSwap, createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { buyBlocked, exitRatio, floorPrice, kmFactor, newPrice, scamChance, sellOffers, swapBoard, swapSeason, swapToday, type SwapListing } from '../../src/game/core/secondhand.ts';
import { SEASON_DAYS } from '../../src/game/core/time.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import { BUYER_FLAGS, LISTING_FLAGS, SWAP, SWAP_GOODS, SWAP_SEASONS } from '../../src/game/data/secondhand.ts';
import { FURNITURE, FURNITURE_RESALE } from '../../src/game/data/furniture.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';
import { swapCard } from '../../src/game/ui/secondhand.ts';

const LOCS = new Set(WA.locations.map((l) => l.id));
const at = (hour: number, day = 3) => day * 1440 + hour * 60;
const mk = (over: Partial<PlayerState> = {}, seed = 1): PlayerState => ({
	...createCharacter({ id: 'swap-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed }),
	loc: 'perth', clock: at(10), nextWeek: 99, cash: 50_000, vehicle: 'none', car: { km: 0, since: 0 },
	...over,
});
/** 季节系数里卖价最高的那个 */
const MAX_SELL = Math.max(1, ...SWAP_SEASONS.map((w) => w.sell));
const MAX_ASK = Math.max(1, ...SWAP_SEASONS.map((w) => w.ask));
/** 找一条满足条件的挂单（换几天找），找不到测试就失败 */
function findListing(pred: (l: SwapListing) => boolean, over: Partial<PlayerState> = {}): { s: PlayerState; l: SwapListing } {
	for (let d = 1; d < 400; d++) {
		const s = mk({ clock: at(10, d), ...over });
		const l = swapBoard(s, WA)!.listings.find(pred);
		if (l) return { s, l };
	}
	assert.fail('找不到符合条件的挂单');
}

test('数据：引用的物品、家具、车型都存在；红旗 id 唯一；搬家季日期合法', () => {
	for (const g of SWAP_GOODS) {
		const ok = g.kind === 'item' ? ITEMS.some((i) => i.id === g.ref) : g.kind === 'furniture' ? FURNITURE.some((f) => f.id === g.ref) : VEHICLES.some((v) => v.id === g.ref);
		assert.ok(ok, `${g.kind}:${g.ref} 不存在`);
		assert.ok(g.weight > 0);
		if (g.kind === 'item') assert.equal(ITEMS.find((i) => i.id === g.ref)!.max, 1, '只交易一人一件的耐用装备（存档按件数记，没有成色）');
	}
	assert.equal(new Set(SWAP_GOODS.map((g) => `${g.kind}:${g.ref}`)).size, SWAP_GOODS.length);
	for (const t of [LISTING_FLAGS, BUYER_FLAGS]) assert.equal(new Set(t.map((f) => f.id)).size, t.length);
	for (const w of SWAP_SEASONS) assert.ok(w.day >= 1 && w.day <= SEASON_DAYS && w.days > 0 && w.days < SEASON_DAYS);
});

test('不变量：二手标价下限高于任何回收途径（换手墙最高卖价、家具折现、车行回收），倒买倒卖不赚钱', () => {
	for (const g of SWAP_GOODS) {
		const np = newPrice(g);
		const e = exitRatio(g);
		const floor = floorPrice(g);
		assert.ok(floor < np, `${g.ref} 二手下限不低于新品价`);
		assert.ok(np * SWAP.askTop * MAX_ASK < np, '季节最高标价也低于新品价');
		// 卖给买家的最高价：季节最高 × 带红旗买家的加价（车按里程只会更低）
		assert.ok(np * e * MAX_SELL * SWAP.flagBonus < floor, `${g.ref} 卖价上限 ${np * e * MAX_SELL * SWAP.flagBonus} 不低于下限 ${floor}`);
		if (g.kind === 'furniture') assert.ok(np * FURNITURE_RESALE < floor);
		if (g.kind === 'vehicle') assert.ok(np * VEHICLES.find((v) => v.id === g.ref)!.resale < floor);
	}
	// 实际生成的挂单：每一条（砍价后）都不低于下限、不高于新品价
	for (let d = 0; d < 120; d++) for (const loc of ['perth', 'fremantle', 'bunbury', 'kalgoorlie', 'albany']) {
		const b = swapBoard(mk({ loc, clock: at(10, d) }), WA)!;
		for (const l of b.listings) {
			assert.ok(l.haggled >= floorPrice(l.good) && l.haggled <= l.ask && l.ask < newPrice(l.good), `${l.id} 第 ${d} 天 ${l.haggled}/${l.ask}`);
		}
	}
});

test('换手墙：同一地点同一天对谁都一样（客户端、服务端算出相同挂单）；没有市场的地方不显示', () => {
	const a = swapBoard(mk({ clock: at(9) }), WA);
	const b = swapBoard(mk({ clock: at(18), cash: 1 }, 99), WA);
	assert.ok(a && b);
	assert.deepEqual(a.listings.map((l) => [l.id, l.good.ref, l.ask, l.flags]), b.listings.map((l) => [l.id, l.good.ref, l.ask, l.flags]), '种子、现金、时刻不影响挂单');
	assert.equal(a.listings.length, SWAP.listings.city + SWAP.remote);
	assert.notDeepEqual(swapBoard(mk({ clock: at(9, 4) }), WA)!.listings.map((l) => l.good.ref + l.ask), a.listings.map((l) => l.good.ref + l.ask), '换一天换一批');
	for (const loc of ['pinnacles', 'wave-rock', 'rottnest']) assert.equal(swapBoard(mk({ loc }), WA), null, loc);
	const remote = a.listings.filter((l) => l.remote);
	assert.equal(remote.length, SWAP.remote);
	for (const l of remote) {
		assert.ok(l.flags.includes('remote'));
		assert.notEqual(l.loc, 'perth');
		assert.match(buyBlocked(mk(), l, 'pickup')!, /外地/);
	}
});

test('上门看货：真货扣钱到手；骗局当场识破不亏钱；同一条今天不能再买；不改入参', () => {
	let got = 0, dodged = 0;
	for (let seed = 1; seed < 80; seed++) {
		const { s, l } = findListing((x) => !x.remote && x.good.kind === 'item' && x.flags.length > 0, {});
		const st = { ...s, seed };
		const snap = JSON.stringify(st);
		const r = applyAction(st, WA, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how: 'pickup', haggle: false });
		assert.equal(JSON.stringify(st), snap, '不改入参');
		assert.ok(r.ok, r.msg);
		assert.equal(r.state.clock - st.clock, SWAP.pickupMinutes);
		if (r.state.inventory[l.good.ref]) {
			got++;
			assert.equal(r.state.cash, st.cash - l.ask);
		} else {
			dodged++;
			assert.equal(r.state.cash, st.cash, '识破骗局一分钱不亏');
			assert.equal(r.state.swap.dodged, 1);
			assert.match(r.state.journal.at(-1)!.text, /没见到东西不先转账/);
		}
		assert.deepEqual(r.state.swap.done, [l.id]);
		const again = applyAction(r.state, WA, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how: 'pickup', haggle: false });
		assert.equal(again.ok, false);
	}
	assert.ok(got > 0 && dodged > 0, `两种结果都要出现：${got}/${dodged}`);
});

test('先转账：骗子卷钱，真货送到；带红旗的挂单被骗得多；运费照付', () => {
	const rate = (pred: (l: SwapListing) => boolean) => {
		const { s, l } = findListing(pred);
		let lost = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const st = { ...s, seed };
			const r = applyAction(st, WA, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how: 'prepay', haggle: false });
			assert.ok(r.ok, r.msg);
			assert.equal(r.state.cash, st.cash - l.ask - SWAP.delivery[l.good.kind], '钱都付出去了');
			if (r.state.inventory[l.good.ref]) continue;
			lost++;
			assert.equal(r.state.swap.lost, 1);
		}
		return lost / 300;
	};
	const clean = rate((l) => !l.remote && l.good.kind === 'item' && l.flags.length === 0);
	const shady = rate((l) => l.remote && l.good.kind === 'item' && l.flags.includes('cheap'));
	assert.ok(clean < 0.1, `没红旗的被骗率 ${clean}`);
	assert.ok(shady > 0.4, `外地低价被骗率 ${shady}`);
	assert.equal(scamChance(['remote', 'cheap', 'giftcard'], LISTING_FLAGS, SWAP.baseScam), SWAP.maxScam, '有上限');
	assert.equal(scamChance([], BUYER_FLAGS, 0), 0, '没红旗的买家一定是真的');
});

test('砍价：成功按砍后价，失败按标价；魅力高成功率高；练魅力', () => {
	const { s, l } = findListing((x) => !x.remote && x.good.kind === 'item' && x.flags.length === 0 && x.haggled < x.ask);
	const wins = (charisma: number) => {
		let n = 0;
		for (let seed = 1; seed <= 200; seed++) {
			const st = { ...s, seed, skills: { ...s.skills, charisma } };
			const r = applyAction(st, WA, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how: 'pickup', haggle: true });
			if (!r.state.inventory[l.good.ref]) continue; // 极少数是骗局
			const paid = st.cash - r.state.cash;
			assert.ok(paid === l.ask || paid === l.haggled, `付了 ${paid}`);
			assert.ok(r.state.skills.charisma > charisma || charisma >= 100);
			if (paid === l.haggled) n++;
		}
		return n;
	};
	assert.ok(wins(90) > wins(0) + 30, '魅力 90 明显更容易砍下来');
});

test('家具和车：要有住处 / 先卖旧车；家具换掉旧的折现；车带着里程和保养记录；没车自提家具要付搬运', () => {
	const { s, l } = findListing((x) => !x.remote && x.good.kind === 'furniture' && x.flags.length === 0);
	assert.match(buyBlocked(s, l, 'pickup')!, /住处/);
	const slot = FURNITURE.find((f) => f.id === l.good.ref)!.slot;
	const other = FURNITURE.find((f) => f.slot === slot && f.id !== l.good.ref)!;
	const home = { type: 'room', loc: 'perth', furniture: { [slot]: other.id } };
	let checked = false;
	for (let seed = 1; seed < 30 && !checked; seed++) {
		const r = applyAction({ ...s, home, seed }, WA, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how: 'pickup', haggle: false });
		if (r.state.home!.furniture[slot] !== l.good.ref) continue;
		assert.equal(r.state.cash, s.cash - l.ask - SWAP.delivery.furniture + Math.round(other.price * FURNITURE_RESALE));
		checked = true;
	}
	assert.ok(checked);
	const v = findListing((x) => !x.remote && x.good.kind === 'vehicle' && x.flags.length === 0);
	assert.match(buyBlocked({ ...v.s, vehicle: 'car' }, v.l, 'pickup')!, /旧车|现在的车/);
	for (let seed = 1; seed < 30; seed++) {
		const r = applyAction({ ...v.s, seed }, WA, { t: 'swap', op: 'buy', id: v.l.id, ref: v.l.good.ref, how: 'pickup', haggle: false });
		if (r.state.vehicle !== v.l.good.ref) continue;
		assert.deepEqual(r.state.car, { km: v.l.km, since: v.l.since });
		assert.ok(v.l.km >= SWAP.kmLo && v.l.km <= SWAP.kmHi && v.l.since <= v.l.km);
		assert.equal(r.state.clock - v.s.clock, SWAP.testDriveMinutes);
		assert.deepEqual(sanitizeState(r.state, LOCS)!.car, r.state.car, '买来的车里程过存档校验不变');
		return;
	}
	assert.fail('试了 30 个种子都没买到车');
});

test('上门看货有时间段，有待处理事件不能买', () => {
	const { s, l } = findListing((x) => !x.remote && x.good.kind === 'item');
	assert.match(buyBlocked({ ...s, clock: at(22) }, l, 'pickup') ?? '', /7:00/);
	assert.equal(buyBlocked({ ...s, clock: at(22) }, l, 'prepay'), undefined, '先转账不看时间');
	assert.match(buyBlocked({ ...s, pending: { eventId: 'x' } }, l, 'prepay')!, /事件/);
	assert.equal(applyAction(s, WA, { t: 'swap', op: 'buy', id: l.id, ref: 'no-such', how: 'pickup', haggle: false }).ok, false, 'ref 对不上（挂单换了）不卖');
});

test('卖东西：没红旗的买家一定付钱；等到账再交货永远不丢东西；不等就交可能人财两空；每天限次', () => {
	const s = mk({ inventory: { surfboard: 1 } });
	let lostItem = 0, lostCash = 0;
	for (let d = 1; d < 200; d++) {
		const st = { ...s, clock: at(10, d), seed: d };
		const so = sellOffers(st, WA, 'item', 'surfboard')!;
		assert.equal(so.blocked, undefined);
		so.offers.forEach((o, i) => {
			const safe = applyAction(st, WA, { t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: i, verify: true });
			assert.ok(safe.ok, safe.msg);
			if (!o.flags.length) assert.equal(safe.state.cash, st.cash + o.amount, '没红旗的买家一定付钱');
			if (!safe.state.inventory.surfboard) assert.equal(safe.state.cash, st.cash + o.amount, '东西没了就一定收到了钱');
			assert.ok(safe.state.cash >= st.cash, '等到账再交货不会亏钱');
			const quick = applyAction(st, WA, { t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: i, verify: false });
			if (!quick.state.inventory.surfboard && quick.state.cash <= st.cash) {
				lostItem++;
				if (quick.state.cash < st.cash) {
					lostCash++;
					assert.ok(o.flags.includes('overpay'), '只有「退差价」会额外赔钱');
				}
			}
			assert.ok(o.amount <= Math.ceil(newPrice({ kind: 'item', ref: 'surfboard' }) * SWAP.itemExit * MAX_SELL * SWAP.flagBonus));
		});
	}
	assert.ok(lostItem > 0 && lostCash > 0, `${lostItem}/${lostCash}`);
	// 每天限次：卖满后挡住
	const full = { ...s, swap: { ...swapToday(s), sold: SWAP.sellDaily } };
	assert.match(sellOffers(full, WA, 'item', 'surfboard')!.blocked!, /明天/);
	// 家具要在住处卖
	const f = mk({ home: { type: 'room', loc: 'fremantle', furniture: { bed: 'mattress' } } });
	assert.match(sellOffers(f, WA, 'furniture', 'mattress')!.blocked!, /住处/);
	assert.equal(sellOffers({ ...f, loc: 'fremantle' }, WA, 'furniture', 'mattress')!.blocked, undefined);
});

test('卖车按里程打折，有下限', () => {
	assert.equal(kmFactor(0), 1);
	assert.ok(kmFactor(100_000) < kmFactor(10_000));
	assert.equal(kmFactor(5_000_000), SWAP.kmFloor);
	const base = mk({ vehicle: 'car', car: { km: 0, since: 0 } });
	const fresh = sellOffers(base, WA, 'vehicle', 'car')!.offers;
	const old = sellOffers({ ...base, car: { km: 200_000, since: 0 } }, WA, 'vehicle', 'car')!.offers;
	fresh.forEach((o, i) => assert.ok(old[i].amount < o.amount));
});

test('搬家季：毕业季挂单多、价格低、好砍价、卖不上价；开学季相反', () => {
	const day = (season: number, d: number) => season * SEASON_DAYS + d - 1;
	const grad = SWAP_SEASONS.find((w) => w.id === 'grad')!;
	const sem1 = SWAP_SEASONS.find((w) => w.id === 'sem1')!;
	assert.equal(swapSeason(at(10, day(0, 22))).id, 'grad', '春季第 22 天');
	assert.equal(swapSeason(at(10, day(1, 2))).id, 'grad', '跨进夏季还在毕业季');
	assert.equal(swapSeason(at(10, day(1, 22))).id, 'sem1');
	assert.equal(swapSeason(at(10, day(2, 10))).id, 'normal');
	assert.ok(grad.ask < 1 && grad.sell < 1 && grad.supply > 0 && grad.haggle > 0);
	assert.ok(sem1.ask > 1 && sem1.sell > 1 && sem1.supply < 0 && sem1.haggle < 0);
	const n = (d: number) => swapBoard(mk({ clock: at(10, d) }), WA)!.listings.length;
	assert.equal(n(day(0, 23)), SWAP.listings.city + grad.supply + SWAP.remote);
	assert.equal(n(day(1, 23)), SWAP.listings.city + sem1.supply + SWAP.remote);
	const s = mk({ inventory: { surfboard: 1 } });
	const avg = (d: number) => { const o = sellOffers({ ...s, clock: at(10, d) }, WA, 'item', 'surfboard')!.offers.filter((x) => !x.flags.length); return o.reduce((a, x) => a + x.amount, 0) / Math.max(1, o.length); };
	let g = 0, h = 0;
	for (let k = 0; k < 8; k++) { g += avg(day(0, 22) + k); h += avg(day(1, 20) + k); }
	assert.ok(g < h, '毕业季卖价低于开学季');
});

test('协议：只收合法字段，客户端带的价格丢掉；坏 kind、ref、buyer、how 整条拒绝', () => {
	assert.deepEqual(parseAction({ t: 'swap', op: 'buy', id: 'perth-1', ref: 'surfboard', how: 'pickup', haggle: true, price: 1 }), { t: 'swap', op: 'buy', id: 'perth-1', ref: 'surfboard', how: 'pickup', haggle: true });
	assert.deepEqual(parseAction({ t: 'swap', op: 'buy', id: 'perth-1', ref: 'surfboard', how: 'prepay', haggle: 'yes' }), { t: 'swap', op: 'buy', id: 'perth-1', ref: 'surfboard', how: 'prepay', haggle: false });
	assert.deepEqual(parseAction({ t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: 2, verify: true, amount: 9999 }), { t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: 2, verify: true });
	for (const bad of [
		{ t: 'swap', op: 'buy', id: 'perth-1', ref: 'surfboard', how: 'steal' },
		{ t: 'swap', op: 'buy', id: '<x>', ref: 'surfboard', how: 'pickup' },
		{ t: 'swap', op: 'sell', kind: 'item', ref: 'water', buyer: 0 },
		{ t: 'swap', op: 'sell', kind: 'vehicle', ref: 'surfboard', buyer: 0 },
		{ t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: 1.5 },
		{ t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: -1 },
		{ t: 'swap', op: 'gift' },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
	// 卖不在手上的东西、买家下标越界：引擎拒绝，存档不变
	const s = mk();
	const r = applyAction(s, WA, { t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: 0, verify: true });
	assert.equal(r.ok, false);
	assert.equal(r.state, s);
	assert.equal(applyAction(mk({ inventory: { surfboard: 1 } }), WA, { t: 'swap', op: 'sell', kind: 'item', ref: 'surfboard', buyer: 9, verify: true }).ok, false);
});

test('存档清洗：旧存档缺字段给默认；坏值不抛异常；未来日期清零；幂等', () => {
	const clock = at(10, 5);
	assert.deepEqual(cleanSwap(undefined, clock), { day: 0, done: [], sold: 0, dodged: 0, lost: 0 });
	for (const bad of [null, 7, 'x', [], { day: NaN, done: 'x', sold: Infinity, dodged: -3, lost: 1e99 }, Object.create({ day: 5, sold: 2 })]) {
		const c = cleanSwap(bad, clock);
		assert.ok(c.day <= 5 && c.sold <= SWAP.sellDaily && c.dodged >= 0 && c.lost <= 1e6 && Array.isArray(c.done));
		assert.deepEqual(cleanSwap(c, clock), c, '幂等');
	}
	assert.equal(cleanSwap(Object.create({ day: 5, sold: 2 }), clock).sold, 0, '原型链上的键不算');
	const future = cleanSwap({ day: 9, done: ['perth-1'], sold: 2, dodged: 1, lost: 0 }, clock);
	assert.deepEqual(future, { day: 5, done: [], sold: 0, dodged: 1, lost: 0 });
	const many = cleanSwap({ day: 5, done: [...Array(100).keys()].map((i) => `perth-${i}`).concat(['<b>', 'perth-1']), sold: 1 }, clock);
	assert.equal(many.done.length, SWAP.doneMax);
	assert.ok(!many.done.includes('<b>'));
	// 整份存档：缺字段的旧存档能读，结果幂等
	const old = mk() as Partial<PlayerState>;
	delete old.swap;
	const canon = sanitizeState(old, LOCS)!;
	assert.deepEqual(canon.swap, { day: 0, done: [], sold: 0, dodged: 0, lost: 0 });
	assert.deepEqual(sanitizeState(canon, LOCS), canon);
});

test('界面：地名、物品名等插值都转义；没有换手墙的地方不出卡片', () => {
	const evil = { ...WA, locations: WA.locations.map((l) => (l.id === 'perth' || l.id === 'fremantle' ? { ...l, name: '<img src=x onerror=alert(1)>' } : l)) };
	const html = swapCard(mk({ inventory: { surfboard: 1 } }), evil);
	assert.ok(html.includes('data-swap="buy"') && html.includes('data-swap="sell"'));
	assert.ok(!html.includes('<img'), '地名没转义');
	assert.ok(html.includes('&lt;img'));
	assert.equal(swapCard(mk({ loc: 'pinnacles' }), WA), '');
});
