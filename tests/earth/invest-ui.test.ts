// 第 25 批：理财卡片和客户端行情（quotes）。页面里的整体流程见 ui.test.ts 的「理财卡」两条
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicState } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { netWorth } from '../../src/game/core/engine.ts';
import { buyAsset } from '../../src/game/core/invest.ts';
import { assetPrice, getAsset, marketView, priceHistory, priceOn } from '../../src/game/core/market.ts';
import { ASSETS, QUOTE_DAYS } from '../../src/game/data/assets.ts';
import { WA } from '../../src/game/data/wa.ts';
import { defaultAmount, fmtChange, fmtPrice, investCard, sparkPoints } from '../../src/game/ui/invest.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const locs = new Set(WA.locations.map((l) => l.id));
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'invest-ui', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 77 }),
	...over,
});
/** 模拟客户端：服务端发来的存档再过一遍客户端的存档校验 */
const client = (s: PlayerState) => sanitizeState(JSON.parse(JSON.stringify(publicState(s))), locs)!;

test('发给客户端的行情：最近 QUOTE_DAYS 天、最后一个是今天、6 位有效数字；落盘的存档没有', () => {
	const s = make({ clock: 50 * 1440 + 600 });
	const v = marketView(s);
	assert.deepEqual(Object.keys(v), ASSETS.map((a) => a.id));
	for (const def of ASSETS) {
		assert.equal(v[def.id].length, QUOTE_DAYS);
		assert.equal(v[def.id][QUOTE_DAYS - 1], Number(priceOn(def, s.marketSeed, 50).toPrecision(6)));
	}
	assert.equal(marketView(make()).savings.length, 1, '第 0 天只有一个价');
	assert.equal(s.quotes, undefined);
});

test('客户端没有行情种子，靠 quotes 算出和服务端一致的价格和净值', () => {
	const server = buyAsset(make({ cash: 3000, clock: 40 * 1440 + 600 }), WA, 'emu-coin', 1000).state;
	const c = client(server);
	assert.equal(c.marketSeed, 0);
	const coin = getAsset('emu-coin')!;
	assert.ok(Math.abs(assetPrice(c, coin) / assetPrice(server, coin) - 1) < 1e-5, '价格一致（只差有效数字取整）');
	assert.ok(Math.abs(netWorth(c) - netWorth(server)) <= 1, `净值一致：客户端 ${netWorth(c)}，服务端 ${netWorth(server)}`);
	assert.deepEqual(priceHistory(c, coin, 5), c.quotes!['emu-coin'].slice(-5));
});

test('客户端存档校验：行情有一项不对就整个丢掉', () => {
	const good = JSON.parse(JSON.stringify(publicState(make({ clock: 3 * 1440 }))));
	assert.ok(sanitizeState(good, locs)!.quotes);
	const bads = [
		{ ...good.quotes, gold: [] },
		{ ...good.quotes, gold: [1, -2] },
		{ ...good.quotes, gold: ['1'] },
		{ ...good.quotes, gold: Array(QUOTE_DAYS + 1).fill(1) },
		(() => { const q = { ...good.quotes }; delete q.gold; return q; })(),
		'oops',
	];
	for (const q of bads) assert.equal(sanitizeState({ ...good, quotes: q }, locs)!.quotes, undefined, JSON.stringify(q).slice(0, 60));
});

test('数字格式：单价、涨跌幅、走势线', () => {
	assert.equal(fmtPrice(1234.5), '$1,234.50');
	assert.equal(fmtPrice(0.012345), '$0.01235');
	assert.equal(fmtPrice(0), '—');
	assert.equal(fmtChange(100, 112.34), '+12.3%');
	assert.equal(fmtChange(100, 90), '-10%');
	assert.equal(fmtChange(100, 100), '0%');
	assert.equal(sparkPoints([1, 2, 3], 10, 10), '0,8 5,5 10,2');
	assert.equal(sparkPoints([5], 10, 10), '0,8 10,8', '一个点画水平线');
	assert.equal(sparkPoints([]), '');
});

test('理财卡：四种资产都有买卖按钮；没持仓不能卖；持仓显示盈亏；没障碍问题', () => {
	const empty = investCard(client(make({ cash: 1000 })));
	assert.equal((empty.match(/data-asset="buy"/g) ?? []).length, ASSETS.length);
	assert.equal((empty.match(/data-asset="sell"[^>]*disabled/g) ?? []).length, ASSETS.length);
	assert.match(empty, />存入</, '储蓄叫存入');
	assert.doesNotMatch(empty, /<button[^>]*>\s*<\/button>/, '按钮都有文字（完整的无障碍检查在 ui.test.ts）');
	const held = investCard(client(buyAsset(make({ cash: 1000 }), WA, 'gold', 500).state));
	assert.match(held, /持仓 \$4\d\d/);
	assert.match(held, /亏 \$\d+/, '当天买入扣了手续费，显示亏');
	assert.match(held, /data-asset="sell" data-asset-id="gold">卖出/);
	assert.match(investCard(client(make({ cash: 5 }))), /data-asset="buy" data-asset-id="gold" disabled/, '现金不够最低额不能买');
});

test('下单默认金额：买入默认现金一半（取整到 10），卖出默认全部', () => {
	assert.equal(defaultAmount(make({ cash: 1234 }), 'gold', 'buy'), 610);
	assert.equal(defaultAmount(make({ cash: 3 }), 'gold', 'buy'), 10);
	const s = buyAsset(make({ cash: 1000 }), WA, 'savings', 400).state;
	assert.equal(defaultAmount(s, 'savings', 'sell'), 400);
	assert.equal(defaultAmount(s, 'nope', 'sell'), 0);
});
