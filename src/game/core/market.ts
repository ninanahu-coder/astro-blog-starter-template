// 行情：每种资产的价格是一条几何随机游走，按游戏日逐日生成。纯函数。
//
// 设计（参考 GitHub 上开源游戏的做法，只借机制）：
//   - bitburner-official/bitburner-src 的 src/StockMarket：每只股票有自己的波动率、买卖价差和手续费，价格随机游走
//   - OpenTTD/OpenTTD 的 src/economy.cpp：物价和收入分开通胀、贷款按月计息
//
// 价格 = 起始价 × exp(Σ 每天的 (μ − σ²/2) + σ·z)，μ、σ 是把年化 drift / vol 折到一天（÷365、÷√365），z 是标准正态随机数。
// z 来自 (行情种子, 资产, 天) 的哈希，不消耗 state.seed：同一个玩家同一天看到的价格永远一样，别的随机结果也不受影响。
// 行情种子不发给客户端，所以玩家没法从前端代码推算明天的价格。
import { ASSETS, MARKET_DAYS_MAX, QUOTE_DAYS } from '../data/assets.ts';
import { dayOf } from './time.ts';
import type { AssetDef, PlayerState } from './types.ts';

export const getAsset = (id: string): AssetDef | undefined => ASSETS.find((a) => a.id === id);

/** 32 位整数混合（murmur3 的 fmix32） */
function mix(h: number): number {
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

function strHash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** (0, 1) 之间的均匀随机数 */
const uniform = (seed: number, asset: number, day: number, k: number) => (mix(mix(mix(seed ^ asset) + day) ^ (k * 0x9e3779b9)) + 0.5) / 4294967296;

/** 标准正态随机数（Box–Muller） */
export function shock(seed: number, assetId: string, day: number): number {
	const a = strHash(assetId);
	const u1 = uniform(seed, a, day, 1);
	const u2 = uniform(seed, a, day, 2);
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** 由服务端随机种子派生行情种子（创建角色、旧存档补字段时用） */
export const deriveMarketSeed = (seed: number) => mix((seed ^ 0x5bd1e995) >>> 0);

// 对数价格的缓存：同一个 (种子, 资产) 只算一遍，往后按需延长。服务器会同时服务很多玩家，条目多了整体清空
const cache = new Map<string, number[]>();
const CACHE_MAX = 512;

function logLevels(seed: number, def: AssetDef, upTo: number): number[] {
	const key = `${seed}:${def.id}`;
	let arr = cache.get(key);
	if (!arr) {
		if (cache.size >= CACHE_MAX) cache.clear();
		arr = [Math.log(def.start)];
		cache.set(key, arr);
	}
	const mu = def.drift / 365;
	const sigma = def.vol / Math.sqrt(365);
	while (arr.length <= upTo) {
		const d = arr.length;
		arr.push(arr[d - 1] + mu - (sigma * sigma) / 2 + (sigma ? sigma * shock(seed, def.id, d) : 0));
	}
	return arr;
}

/** 某个行情种子下，某资产第 day 天的单价（不四舍五入，展示时自己取整） */
export function priceOn(def: AssetDef, seed: number, day: number): number {
	const d = Math.max(0, Math.min(MARKET_DAYS_MAX, Math.floor(day)));
	if (d === 0) return def.start; // exp(log(x)) 有浮点误差，第 0 天直接给起始价
	return Math.exp(logLevels(seed >>> 0, def, d)[d]);
}

/**
 * 玩家此刻看到的单价。
 * 客户端拿到的存档没有行情种子（publicState 清零了），而是带着服务端算好的 quotes：有 quotes 就用它的最后一个价。
 * 服务端的存档永远没有 quotes（只有 publicState 的副本里有），所以结算一定按行情种子算。
 */
export function assetPrice(state: PlayerState, def: AssetDef): number {
	const q = state.quotes?.[def.id];
	return q?.length ? q[q.length - 1] : priceOn(def, state.marketSeed, dayOf(state.clock));
}

/** 发给客户端的行情：每种资产最近 QUOTE_DAYS 天的价格（含今天，从早到晚），保留 6 位有效数字 */
export function marketView(state: PlayerState): Record<string, number[]> {
	const plain = { ...state, quotes: undefined };
	return Object.fromEntries(ASSETS.map((def) => [def.id, priceHistory(plain, def, QUOTE_DAYS).map((p) => Number(p.toPrecision(6)))]));
}

/** 最近 n 天的价格（含今天，从早到晚），界面画走势用 */
export function priceHistory(state: PlayerState, def: AssetDef, n: number): number[] {
	const q = state.quotes?.[def.id];
	if (q?.length) return q.slice(-n);
	const today = dayOf(state.clock);
	const out: number[] = [];
	for (let d = Math.max(0, today - n + 1); d <= today; d++) out.push(priceOn(def, state.marketSeed, d));
	return out;
}

/** 卖出一部分持仓的到手金额：市值 × (1 − 手续费)，取整 */
export const sellValue = (def: AssetDef, units: number, price: number) => Math.floor(units * price * (1 - def.fee));

/** 全部持仓按今天价格卖掉能拿到的钱（计入净资产） */
export function holdingsValue(state: PlayerState): number {
	let sum = 0;
	for (const [id, h] of Object.entries(state.holdings)) {
		const def = getAsset(id);
		if (def && h.units > 0) sum += sellValue(def, h.units, assetPrice(state, def));
	}
	return sum;
}
