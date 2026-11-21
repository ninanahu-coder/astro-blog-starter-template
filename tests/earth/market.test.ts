// 第 25 批：金融资产（储蓄、指数基金、金条、虚拟币）。设计见 docs/earth-game/economy-design.md 第 11 节
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, publicState } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { netWorth } from '../../src/game/core/engine.ts';
import { buyAsset, marketQuotes, sellAsset } from '../../src/game/core/invest.ts';
import { assetPrice, deriveMarketSeed, getAsset, holdingsValue, priceHistory, priceOn } from '../../src/game/core/market.ts';
import { ASSET_MIN_TRADE, ASSETS, MARKET_DAYS_MAX } from '../../src/game/data/assets.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'market-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 2501 }),
	...over,
});
const locs = new Set(WA.locations.map((l) => l.id));
const asset = (id: string) => getAsset(id)!;

test('资产数据自洽：id 唯一、手续费 0–5%、波动率和起始价合法、虚拟币注明虚构', () => {
	assert.equal(new Set(ASSETS.map((a) => a.id)).size, ASSETS.length);
	for (const a of ASSETS) {
		assert.ok(a.fee >= 0 && a.fee <= 0.05, `${a.id} 手续费`);
		assert.ok(a.vol >= 0 && a.vol <= 1.5 && a.start > 0, `${a.id} 参数`);
		assert.ok(/^[a-z0-9-]{1,40}$/.test(a.id), `${a.id} 能通过动作校验`);
	}
	for (const a of ASSETS.filter((x) => x.kind === 'crypto')) assert.match(a.desc, /虚构/, '虚拟币要写明是虚构的');
	for (const a of ASSETS.filter((x) => x.vol > 0)) assert.ok(a.fee > 0, `${a.id} 会波动的资产必须有手续费，不然同日来回买卖没有成本`);
});

test('价格：第 0 天是起始价；同一种子同一天永远一样；不同种子走势不同', () => {
	const idx = asset('asx-index');
	assert.equal(priceOn(idx, 7, 0), idx.start);
	assert.equal(priceOn(idx, 7, 120), priceOn(idx, 7, 120));
	const a = [1, 2, 3, 4, 5].map((d) => priceOn(idx, 7, d));
	const b = [1, 2, 3, 4, 5].map((d) => priceOn(idx, 8, d));
	assert.notDeepEqual(a, b);
});

test('储蓄没有波动，按天复利', () => {
	const s = asset('savings');
	for (const d of [1, 30, 365]) assert.ok(Math.abs(priceOn(s, 99, d) - s.start * Math.exp((s.drift * d) / 365)) < 1e-9, `第 ${d} 天`);
});

test('价格校准：一年的对数收益均值 ≈ drift − vol²/2，标准差 ≈ vol', () => {
	for (const def of ASSETS.filter((a) => a.vol > 0)) {
		const r = Array.from({ length: 600 }, (_, i) => Math.log(priceOn(def, 1000 + i, 365) / def.start));
		const mean = r.reduce((a, b) => a + b, 0) / r.length;
		const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
		const expect = def.drift - (def.vol * def.vol) / 2;
		assert.ok(Math.abs(mean - expect) < 4 * (def.vol / Math.sqrt(r.length)) + 0.005, `${def.id} 均值 ${mean.toFixed(3)}，应约 ${expect.toFixed(3)}`);
		assert.ok(Math.abs(sd / def.vol - 1) < 0.15, `${def.id} 标准差 ${sd.toFixed(3)}，应约 ${def.vol}`);
	}
});

test('价格只算到 MARKET_DAYS_MAX 天，之后不变', () => {
	const coin = asset('emu-coin');
	assert.equal(priceOn(coin, 5, MARKET_DAYS_MAX + 1000), priceOn(coin, 5, MARKET_DAYS_MAX));
	assert.equal(priceOn(coin, 5, -3), coin.start);
});

test('走势：最近 n 天，最后一个是今天', () => {
	const s = make({ clock: 40 * 1440 + 600 });
	const idx = asset('asx-index');
	const h = priceHistory(s, idx, 30);
	assert.equal(h.length, 30);
	assert.equal(h[29], assetPrice(s, idx));
	assert.equal(priceHistory(make(), idx, 30).length, 1, '开局第 0 天只有一个点');
});

test('买入：扣现金、按手续费后的金额换份数、记成本、花 10 分钟；不修改入参', () => {
	const s = make({ cash: 1000 });
	const before = JSON.stringify(s);
	const idx = asset('asx-index');
	const r = buyAsset(s, WA, 'asx-index', 400);
	assert.ok(r.ok, r.msg);
	assert.equal(JSON.stringify(s), before);
	assert.equal(r.state.cash, 600);
	assert.ok(Math.abs(r.state.holdings['asx-index'].units - (400 * (1 - idx.fee)) / assetPrice(s, idx)) < 1e-9);
	assert.equal(r.state.holdings['asx-index'].cost, 400);
	assert.equal(r.state.clock, s.clock + 10);
});

test('买入被拒：事件未处理、没有这种资产、低于最低额、现金不够', () => {
	assert.equal(buyAsset(make({ cash: 1000, pending: { eventId: 'x' } }), WA, 'gold', 100).ok, false);
	assert.equal(buyAsset(make({ cash: 1000 }), WA, 'nope', 100).ok, false);
	assert.equal(buyAsset(make({ cash: 1000 }), WA, 'gold', ASSET_MIN_TRADE - 1).ok, false);
	assert.equal(buyAsset(make({ cash: 50 }), WA, 'gold', 100).ok, false);
	assert.equal(sellAsset(make(), WA, 'gold', 100).ok, false, '没有持仓不能卖');
});

test('同一天买了马上全卖：有手续费的一定亏，储蓄不赚不亏', () => {
	for (const def of ASSETS) {
		const s = make({ cash: 5000 });
		const bought = buyAsset(s, WA, def.id, 1000).state;
		const sold = sellAsset(bought, WA, def.id, 1e9).state;
		assert.equal(sold.holdings[def.id], undefined, `${def.id} 全卖后清掉持仓`);
		// 买卖各收一次手续费：到手 = 1000 × (1 − fee)²，向下取整
		const expect = 4000 + Math.floor(1000 * (1 - def.fee) ** 2 + 1e-9);
		assert.ok(Math.abs(sold.cash - expect) <= 1, `${def.id} 来回一趟应剩约 $${expect}，实际 $${sold.cash}`);
		if (def.fee > 0) assert.ok(sold.cash < 5000, `${def.id} 来回一趟应该亏，实际剩 $${sold.cash}`);
		else assert.ok(sold.cash <= 5000 && sold.cash >= 4999, `${def.id} 来回一趟不赚不亏，实际 $${sold.cash}`);
	}
});

test('卖出一部分：份数和成本按比例减少，到手 = 市值 × (1 − 手续费)', () => {
	const gold = asset('gold');
	const bought = buyAsset(make({ cash: 5000 }), WA, 'gold', 2000).state;
	const h = bought.holdings.gold;
	const price = assetPrice(bought, gold);
	const r = sellAsset(bought, WA, 'gold', 500);
	assert.ok(r.ok, r.msg);
	const share = 500 / price / h.units;
	assert.ok(Math.abs(r.state.holdings.gold.units - h.units * (1 - share)) < 1e-9);
	assert.ok(Math.abs(r.state.holdings.gold.cost - h.cost * (1 - share)) < 1e-6);
	assert.equal(r.state.cash, bought.cash + Math.floor(500 * (1 - gold.fee)), '卖出价值 $500，到手扣手续费');
});

test('净资产算上持仓（按今天的卖出到手价）；报价列表对得上', () => {
	const s = buyAsset(make({ cash: 3000 }), WA, 'emu-coin', 1000).state;
	assert.ok(holdingsValue(s) > 0);
	assert.equal(netWorth(s) - netWorth({ ...s, holdings: {} }), holdingsValue(s));
	const q = marketQuotes(s).find((x) => x.asset.id === 'emu-coin')!;
	assert.equal(q.value, holdingsValue(s));
	assert.equal(q.sellBlocked, undefined);
	assert.equal(marketQuotes(s).find((x) => x.asset.id === 'gold')!.sellBlocked, '没有持仓');
});

test('动作协议：校验形状，经 applyAction 结算', () => {
	assert.deepEqual(parseAction({ t: 'asset', op: 'buy', id: 'gold', amount: 100 }), { t: 'asset', op: 'buy', id: 'gold', amount: 100 });
	for (const bad of [{ t: 'asset', op: 'hold', id: 'gold', amount: 1 }, { t: 'asset', op: 'buy', id: 'GOLD!', amount: 1 }, { t: 'asset', op: 'sell', id: 'gold', amount: -5 }, { t: 'asset', op: 'buy', id: 'gold', amount: Infinity }, { t: 'asset', op: 'buy', id: 'gold' }]) {
		assert.equal(parseAction(bad), null, JSON.stringify(bad));
	}
	const r = applyAction(make({ cash: 500 }), WA, { t: 'asset', op: 'buy', id: 'savings', amount: 200 });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, 300);
});

test('行情种子：创建时派生，不发给客户端；存档校验补旧存档、丢掉坏持仓', () => {
	const s = make();
	assert.equal(s.marketSeed, deriveMarketSeed(2501));
	assert.notEqual(s.marketSeed, s.seed);
	assert.equal(publicState(s).marketSeed, 0);
	const raw = JSON.parse(JSON.stringify({ ...s, holdings: { gold: { units: 3, cost: 400 }, nope: { units: 5, cost: 1 }, 'emu-coin': { units: -2, cost: 9 } } })) as Record<string, unknown>;
	const clean = sanitizeState(raw, locs)!;
	assert.deepEqual(clean.holdings, { gold: { units: 3, cost: 400 } });
	assert.equal(clean.marketSeed, s.marketSeed);
	const old = { ...raw };
	Reflect.deleteProperty(old, 'marketSeed');
	Reflect.deleteProperty(old, 'holdings');
	const migrated = sanitizeState(old, locs)!;
	assert.deepEqual(migrated.holdings, {});
	assert.equal(migrated.marketSeed, deriveMarketSeed(s.seed));
	assert.equal(sanitizeState({ ...raw, marketSeed: -1 }, locs)!.marketSeed, deriveMarketSeed(s.seed), '坏的行情种子按随机种子重新派生');
});
