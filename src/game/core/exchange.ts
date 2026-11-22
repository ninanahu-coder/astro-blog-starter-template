// 玩家之间的交易所：寄卖（一口价）、拍卖、面交换物。纯函数，服务端在锁内调用，客户端只用检查函数显示按钮状态。
// 设计见 docs/earth-game/player-trade.md。要点：
// - 物品挂出时就从卖家背包里扣走（托管），钱在出价时就从买家现金里扣走（托管）：同一件东西、同一笔钱不可能同时在两处。
// - 不在买卖双方都在线时成交的钱和东西，一律进「邮箱」（Mail），本人下次操作时领取；结算本身不碰对方存档。
// - 没有「直接转钱」：钱只作为某件物品的价款流动，价款限定在商店价的 PRICE_MIN–PRICE_MAX 倍。
// - 所有数值都「待平衡」。
import { finishTally } from './tally.ts';
import { getItem } from './attributes.ts';
import { capState, nextRev } from './character.ts';
import { clone, log, pruneMoodlets } from './engine.ts';
import { TRADE_DAILY, tradesToday } from './trade.ts';
import type { PlayerState } from './types.ts';

/** 交易所数值（全部待平衡） */
export const EXCHANGE = {
	/** 新号限制：建号后满这么多个现实日才能用交易所、带钱的面交（待平衡） */
	minRealDays: 3,
	/** 新号限制：游戏里至少过了这么多天（待平衡） */
	minGameDays: 5,
	/** 每人每个现实日最多成交 / 挂单几笔（挂单、一口价买入、对一件拍品第一次出价各算一笔）（待平衡） */
	dailyDeals: 8,
	/** 每人每个现实日最多付出多少钱（买入、出价、面交付款合计）（待平衡） */
	dailyVolume: 1500,
	/** 同一对玩家每个现实日最多成交几笔（挡小号倒钱）（待平衡） */
	pairDaily: 2,
	/** 每人同时挂着的寄卖 + 拍卖最多几件（待平衡） */
	maxLots: 4,
	/** 一口价寄卖挂多久没卖掉就退回（小时）（待平衡） */
	fixedHours: 48,
	/** 拍卖可选时长（小时）（待平衡） */
	auctionHours: [6, 24] as const,
	/** 挂单费：按价格的比例，至少 $1，不退（待平衡） */
	listFeeRate: 0.02,
	/** 成交佣金：从卖家到手的钱里扣，至少 $1（待平衡） */
	commission: 0.08,
	/** 面交里带钱时，收钱一方付的手续费比例，至少 $1（待平衡） */
	swapFee: 0.05,
	/** 价格硬上下限：商店价的倍数，超出直接拒绝（待平衡）。
	 *  下限不低于二手摊的 SALE_MIN（0.5）：claude/earth-shop-items 的 NPC 二手店按 40% 回收，要保证「从玩家手里低价收、转卖给二手店」一定亏 */
	priceMin: 0.5,
	priceMax: 2,
	/** 价格软上下限：超出记入可疑记录（不拒绝）（待平衡） */
	flagLow: 0.6,
	flagHigh: 1.5,
	/** 加价幅度：至少比当前最高价高这么多比例，且至少 $1（待平衡） */
	bidStep: 0.05,
	/** 防最后一秒抢拍：结束前这么多分钟内有人出价，结束时间顺延同样长（最多顺延 maxExtends 次）（待平衡） */
	snipeMin: 5,
	maxExtends: 6,
	/** 面交一边最多几种物品 */
	swapKinds: 3,
	/** 邮箱最多存几封（超出时最旧的现金和物品合并到一封，不会丢） */
	mailMax: 30,
} as const;

const HOUR = 3_600_000;

export type LotKind = 'fixed' | 'auction';

/** 交易所里的一件拍品 / 寄卖品。seller、bidder 是真实存档 id，只在服务端；发给客户端前用 lotView() */
export interface Lot {
	id: string;
	kind: LotKind;
	seller: string;
	sellerHash: string;
	sellerName: string;
	sellerAvatar: string;
	item: string;
	/** 一口价，或拍卖的起拍价 */
	price: number;
	/** 当前最高出价（已从出价人现金里扣走托管），0 为还没人出价 */
	bid: number;
	bidder: string | null;
	bidderHash: string;
	at: number;
	endsAt: number;
	extends: number;
}

/** 邮箱里的一封：托管退回、成交货款、拍到的东西 */
export interface Mail {
	id: string;
	cash: number;
	item: string | null;
	n: number;
	text: string;
	at: number;
}

/** 每人每个现实日的交易额度（服务端按 id 哈希存） */
export interface Quota {
	day: number;
	deals: number;
	volume: number;
	/** 对方 id 哈希 -> 今天和他成交了几笔 */
	pairs: Record<string, number>;
	/** 记过账的拍品 id（同一件拍品多次出价只算一笔） */
	lots: string[];
}

/** 服务端账本的一行：只记哈希，不记真实 id */
export interface LedgerEntry {
	tx: string;
	at: number;
	kind: 'buy' | 'auction' | 'swap';
	item: string;
	n: number;
	price: number;
	fee: number;
	seller: string;
	buyer: string;
	flags: string[];
}

export const emptyQuota = (day: number): Quota => ({ day, deals: 0, volume: 0, pairs: {}, lots: [] });

/** 不可信的落盘数据 → 合法的额度（日期不对就当作新的一天） */
export function quotaOf(raw: unknown, day: number): Quota {
	const q = raw as Partial<Quota> | null | undefined;
	if (!q || typeof q !== 'object' || q.day !== day) return emptyQuota(day);
	const n = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0);
	const pairs: Record<string, number> = {};
	if (q.pairs && typeof q.pairs === 'object') for (const [k, v] of Object.entries(q.pairs)) if (/^[a-f0-9]{12}$/.test(k)) pairs[k] = n(v);
	const lots = Array.isArray(q.lots) ? q.lots.filter((x): x is string => typeof x === 'string').slice(-50) : [];
	return { day, deals: n(q.deals), volume: n(q.volume), pairs, lots };
}

/** 物品的参考价（商店价）；不能交易的东西返回 null */
export function refPrice(itemId: string): number | null {
	const item = getItem(itemId);
	return item && item.price > 0 ? item.price : null;
}

/** 单价允许的区间（整数，至少 $1） */
export function priceBand(itemId: string): { min: number; max: number } | null {
	const ref = refPrice(itemId);
	if (ref === null) return null;
	return { min: Math.max(1, Math.ceil(ref * EXCHANGE.priceMin)), max: Math.max(1, Math.floor(ref * EXCHANGE.priceMax)) };
}

/** 异常价格：在硬区间内但偏离商店价较多时打的标记（记入账本，供人工复核） */
export function priceFlags(itemId: string, price: number): string[] {
	const ref = refPrice(itemId);
	if (ref === null) return ['unknown-item'];
	if (price < ref * EXCHANGE.flagLow) return ['price-low'];
	if (price > ref * EXCHANGE.flagHigh) return ['price-high'];
	return [];
}

/** 手续费：按比例向上取整，有价款时至少 $1，且不超过价款本身 */
export function feeOf(price: number, rate: number): number {
	if (price <= 0) return 0;
	return Math.min(price, Math.max(1, Math.ceil(price * rate)));
}

/** 游戏里第几天（从 1 起） */
export const gameDayOf = (state: PlayerState) => Math.floor(state.clock / 1440) + 1;

/**
 * 新号限制。bornDay 是服务端记的建号现实日（老存档没有记录时为 null，按老号处理）。能用返回 undefined。
 */
export function newbieBlocked(state: PlayerState, bornDay: number | null, day: number): string | undefined {
	if (bornDay !== null && day - bornDay < EXCHANGE.minRealDays) return `新角色满 ${EXCHANGE.minRealDays} 天后才能用交易所（还差 ${EXCHANGE.minRealDays - (day - bornDay)} 天）。`;
	if (gameDayOf(state) < EXCHANGE.minGameDays) return `在游戏里过满 ${EXCHANGE.minGameDays} 天后才能用交易所。`;
	return undefined;
}

/** 今天的额度够不够：要付 cash、和 pair（对方哈希，可空）成交、对 lotId（可空，拍品）出价。够的话返回 undefined */
export function quotaBlocked(q: Quota, cash: number, pair: string | null, lotId: string | null = null): string | undefined {
	const newDeal = !lotId || !q.lots.includes(lotId);
	if (newDeal && q.deals >= EXCHANGE.dailyDeals) return `今天已经交易 ${EXCHANGE.dailyDeals} 笔了，明天再来。`;
	if (cash > 0 && q.volume + cash > EXCHANGE.dailyVolume) return `今天最多付出 $${EXCHANGE.dailyVolume}，还剩 $${Math.max(0, EXCHANGE.dailyVolume - q.volume)}。`;
	if (pair && newDeal && (q.pairs[pair] ?? 0) >= EXCHANGE.pairDaily) return `今天和这位玩家已经交易 ${EXCHANGE.pairDaily} 笔了，明天再来。`;
	return undefined;
}

/** 记一笔额度（不改入参） */
export function quotaAdd(q: Quota, cash: number, pair: string | null, lotId: string | null = null): Quota {
	const newDeal = !lotId || !q.lots.includes(lotId);
	const pairs = { ...q.pairs };
	if (pair && newDeal) pairs[pair] = (pairs[pair] ?? 0) + 1;
	return {
		day: q.day,
		deals: q.deals + (newDeal ? 1 : 0),
		volume: q.volume + Math.max(0, cash),
		pairs,
		lots: lotId && newDeal ? [...q.lots, lotId].slice(-50) : q.lots,
	};
}

/** 规则改动存档后的统一收尾：版本号加一、清过期心情、钳制数值 */
/** 生涯统计记账：玩家之间的买卖、出价、领钱都算「人情往来」（career-stats.md §2.2；合并 main 后复核） */
function booked(prev: PlayerState, next: PlayerState): PlayerState {
	finishTally(prev, next, ['social', 'social']);
	return next;
}

function fin(s: PlayerState, prev: PlayerState): PlayerState {
	pruneMoodlets(s);
	return capState({ ...s, rev: nextRev(prev.rev) });
}

function takeItem(s: PlayerState, itemId: string, n: number) {
	const left = (s.inventory[itemId] ?? 0) - n;
	if (left > 0) s.inventory[itemId] = left;
	else delete s.inventory[itemId];
}

/** 背包里还能放几件 */
export function roomFor(state: PlayerState, itemId: string): number {
	const item = getItem(itemId);
	return item ? Math.max(0, item.max - (state.inventory[itemId] ?? 0)) : 0;
}

export interface ListInput {
	kind: LotKind;
	item: string;
	price: number;
	hours: number;
}

/** 能不能挂出这件东西；能的话返回 undefined */
export function listBlocked(state: PlayerState, input: ListInput, openLots: number): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	const item = getItem(input.item);
	const band = priceBand(input.item);
	if (!item || !band) return '这件东西不能交易。';
	if ((state.inventory[item.id] ?? 0) < 1) return '你背包里没有这件东西了。';
	if (openLots >= EXCHANGE.maxLots) return `同时最多挂 ${EXCHANGE.maxLots} 件，先等卖掉或撤回一件。`;
	if (!Number.isInteger(input.price) || input.price < band.min || input.price > band.max) return `价格要在 $${band.min}–$${band.max} 之间。`;
	if (input.kind === 'auction' && !(EXCHANGE.auctionHours as readonly number[]).includes(input.hours)) return '拍卖时长无效。';
	const fee = feeOf(input.price, EXCHANGE.listFeeRate);
	if (state.cash < fee) return `挂单费要 $${fee}。`;
	return undefined;
}

/** 挂出：东西从背包里扣走（托管），扣挂单费。不改入参 */
export function createLot(state: PlayerState, input: ListInput, ctx: { lotId: string; hash: string; now: number; openLots: number }): { state: PlayerState; lot: Lot; fee: number } | string {
	const why = listBlocked(state, input, ctx.openLots);
	if (why) return why;
	const item = getItem(input.item)!;
	const fee = feeOf(input.price, EXCHANGE.listFeeRate);
	const s = clone(state);
	takeItem(s, item.id, 1);
	s.cash -= fee;
	const hours = input.kind === 'fixed' ? EXCHANGE.fixedHours : input.hours;
	log(s, input.kind === 'fixed' ? `${item.icon} 把${item.name}以 $${input.price} 挂到交易所寄卖，付了挂单费 $${fee}。` : `${item.icon} 把${item.name}送去拍卖，起拍价 $${input.price}，付了挂单费 $${fee}。`);
	const lot: Lot = {
		id: ctx.lotId, kind: input.kind, seller: state.id, sellerHash: ctx.hash, sellerName: state.name, sellerAvatar: state.avatar,
		item: item.id, price: input.price, bid: 0, bidder: null, bidderHash: '', at: ctx.now, endsAt: ctx.now + hours * HOUR, extends: 0,
	};
	return { state: booked(state, fin(s, state)), lot, fee };
}

/** 买方的通用检查 */
function buyerBlocked(buyer: PlayerState, lot: Lot, now: number): string | undefined {
	if (buyer.pending) return '先处理眼前的事件。';
	if (buyer.id === lot.seller) return '不能买自己挂的东西。';
	if (now >= lot.endsAt) return '已经结束了。';
	return undefined;
}

/** 一口价买下：买家付钱、东西直接进背包；卖家的货款（扣佣金）进他的邮箱。不改入参 */
export function buyLot(buyer: PlayerState, lot: Lot, ctx: { now: number; mailId: string; tx: string; buyerHash: string }): { buyer: PlayerState; mail: Mail; fee: number; entry: LedgerEntry } | string {
	if (lot.kind !== 'fixed') return '拍卖品要出价。';
	const why = buyerBlocked(buyer, lot, ctx.now);
	if (why) return why;
	const item = getItem(lot.item);
	if (!item) return '这件东西不能交易。';
	if (roomFor(buyer, lot.item) < 1) return `${item.name}已经带满了。`;
	if (buyer.cash < lot.price) return `需要 $${lot.price}。`;
	const fee = feeOf(lot.price, EXCHANGE.commission);
	const s = clone(buyer);
	s.cash -= lot.price;
	s.inventory[lot.item] = (s.inventory[lot.item] ?? 0) + 1;
	log(s, `${item.icon} 在交易所花 $${lot.price} 买下${lot.sellerName}寄卖的${item.name}。`);
	const mail: Mail = { id: ctx.mailId, cash: lot.price - fee, item: null, n: 0, text: `${item.icon} ${item.name}以 $${lot.price} 卖出，扣佣金 $${fee}`, at: ctx.now };
	const entry: LedgerEntry = { tx: ctx.tx, at: ctx.now, kind: 'buy', item: lot.item, n: 1, price: lot.price, fee, seller: lot.sellerHash, buyer: ctx.buyerHash, flags: priceFlags(lot.item, lot.price) };
	return { buyer: booked(buyer, fin(s, buyer)), mail, fee, entry };
}

/** 下一口至少出多少 */
export function minBid(lot: Lot): number {
	return lot.bid > 0 ? lot.bid + Math.max(1, Math.ceil(lot.bid * EXCHANGE.bidStep)) : lot.price;
}

/**
 * 出价：新出价从出价人现金里扣走（托管）；被超过的上一位出价人全额退回到他的邮箱（自己加价时退回给自己）。
 * 结束前 snipeMin 分钟内出价，结束时间顺延。不改入参
 */
export function bidLot(bidder: PlayerState, lot: Lot, amount: number, ctx: { now: number; mailId: string; bidderHash: string }): { bidder: PlayerState; lot: Lot; refund: { to: string; mail: Mail } | null } | string {
	if (lot.kind !== 'auction') return '寄卖品直接买。';
	const why = buyerBlocked(bidder, lot, ctx.now);
	if (why) return why;
	const item = getItem(lot.item);
	const band = priceBand(lot.item);
	if (!item || !band) return '这件东西不能交易。';
	if (!Number.isInteger(amount) || amount < minBid(lot)) return `至少出 $${minBid(lot)}。`;
	if (amount > band.max) return `这件东西最多出到 $${band.max}（商店价的 ${EXCHANGE.priceMax} 倍）。`;
	if (bidder.cash < amount) return `需要 $${amount}。`;
	const s = clone(bidder);
	s.cash -= amount;
	let refund: { to: string; mail: Mail } | null = null;
	if (lot.bidder && lot.bid > 0) {
		// 自己加价：上一口直接退回现金（同一份存档，不走邮箱）
		if (lot.bidder === bidder.id) s.cash += lot.bid;
		else refund = { to: lot.bidder, mail: { id: ctx.mailId, cash: lot.bid, item: null, n: 0, text: `${item.icon} ${item.name}的拍卖被人出了更高价，退回你出的 $${lot.bid}`, at: ctx.now } };
	}
	log(s, `${item.icon} 给${lot.sellerName}拍卖的${item.name}出价 $${amount}（钱先由交易所保管）。`);
	const snipe = lot.endsAt - ctx.now <= EXCHANGE.snipeMin * 60_000 && lot.extends < EXCHANGE.maxExtends;
	const next: Lot = { ...lot, bid: amount, bidder: bidder.id, bidderHash: ctx.bidderHash, endsAt: snipe ? lot.endsAt + EXCHANGE.snipeMin * 60_000 : lot.endsAt, extends: lot.extends + (snipe ? 1 : 0) };
	return { bidder: booked(bidder, fin(s, bidder)), lot: next, refund };
}

/**
 * 到期结算（不碰任何存档）：没人出价 / 寄卖没卖掉 → 东西退回卖家邮箱；有人出价 → 东西进买家邮箱、货款扣佣金进卖家邮箱。
 * 没到期返回 null
 */
export function settleLot(lot: Lot, now: number, ids: { a: string; b: string; tx: string }): { mails: { to: string; mail: Mail }[]; fee: number; entry: LedgerEntry | null } | null {
	if (now < lot.endsAt) return null;
	const item = getItem(lot.item);
	const label = item ? `${item.icon} ${item.name}` : lot.item;
	if (!lot.bidder || lot.bid <= 0) {
		return { mails: [{ to: lot.seller, mail: { id: ids.a, cash: 0, item: lot.item, n: 1, text: `${label}${lot.kind === 'fixed' ? '寄卖到期没卖掉' : '拍卖没人出价'}，退回给你`, at: now } }], fee: 0, entry: null };
	}
	const fee = feeOf(lot.bid, EXCHANGE.commission);
	return {
		mails: [
			{ to: lot.bidder, mail: { id: ids.a, cash: 0, item: lot.item, n: 1, text: `${label}拍下了，成交价 $${lot.bid}`, at: now } },
			{ to: lot.seller, mail: { id: ids.b, cash: lot.bid - fee, item: null, n: 0, text: `${label}拍卖成交 $${lot.bid}，扣佣金 $${fee}`, at: now } },
		],
		fee,
		entry: { tx: ids.tx, at: now, kind: 'auction', item: lot.item, n: 1, price: lot.bid, fee, seller: lot.sellerHash, buyer: lot.bidderHash, flags: priceFlags(lot.item, lot.bid) },
	};
}

/** 撤回：寄卖随时可以；拍卖只有没人出价时可以。东西放回背包，放不下进邮箱。挂单费不退。不改入参 */
export function cancelLot(state: PlayerState, lot: Lot, ctx: { now: number; mailId: string }): { state: PlayerState; mail: Mail | null } | string {
	if (lot.seller !== state.id) return '只能撤回自己挂的。';
	if (lot.kind === 'auction' && lot.bid > 0) return '已经有人出价了，撤不回来。';
	const item = getItem(lot.item);
	const s = clone(state);
	let mail: Mail | null = null;
	if (roomFor(s, lot.item) >= 1) s.inventory[lot.item] = (s.inventory[lot.item] ?? 0) + 1;
	else mail = { id: ctx.mailId, cash: 0, item: lot.item, n: 1, text: `${item?.icon ?? ''} 撤回的${item?.name ?? lot.item}（背包满了先放这里）`, at: ctx.now };
	log(s, `${item?.icon ?? ''} 撤回了交易所里的${item?.name ?? lot.item}。`);
	return { state: booked(state, fin(s, state)), mail };
}

/** 往邮箱里加一封；超过上限时把最旧的两封里的现金合到一封（物品不合并，宁可超出上限也不丢东西） */
export function pushMail(box: Mail[], mail: Mail): Mail[] {
	const out = [...box, mail];
	while (out.length > EXCHANGE.mailMax) {
		const i = out.findIndex((m) => !m.item);
		const j = i < 0 ? -1 : out.findIndex((m, k) => k > i && !m.item);
		if (j < 0) break;
		out[j] = { ...out[j], cash: out[j].cash + out[i].cash, text: '几笔货款和退款合在一起' };
		out.splice(i, 1);
	}
	return out;
}

/** 领邮箱：钱全领；东西按背包空位领，放不下的留在邮箱。不改入参 */
export function claimMail(state: PlayerState, box: Mail[]): { state: PlayerState; left: Mail[]; cash: number; items: number } | string {
	if (!box.length) return '邮箱是空的。';
	const s = clone(state);
	const left: Mail[] = [];
	let cash = 0;
	let items = 0;
	for (const m of box) {
		cash += m.cash;
		if (m.item && m.n > 0) {
			const take = Math.min(m.n, roomFor(s, m.item));
			if (take > 0) {
				s.inventory[m.item] = (s.inventory[m.item] ?? 0) + take;
				items += take;
			}
			if (take < m.n) left.push({ ...m, cash: 0, n: m.n - take });
		}
	}
	if (cash === 0 && items === 0) return '背包满了，东西先留在邮箱里。';
	s.cash += cash;
	log(s, `📬 从交易所邮箱领了${cash ? ` $${cash}` : ''}${cash && items ? ' 和' : ''}${items ? ` ${items} 件东西` : ''}。`);
	return { state: booked(state, fin(s, state)), left, cash, items };
}

// ---------- 面交换物 ----------

export interface SwapSide {
	items: { item: string; n: number }[];
	cash: number;
}

/** 不可信输入 → 一边的内容；不合法返回 null */
export function parseSwapSide(raw: unknown): SwapSide | null {
	const r = raw as { items?: unknown; cash?: unknown } | null;
	if (!r || typeof r !== 'object') return null;
	const cash = r.cash === undefined ? 0 : r.cash;
	if (!Number.isInteger(cash) || (cash as number) < 0 || (cash as number) > 1_000_000) return null;
	const list = Array.isArray(r.items) ? r.items : [];
	if (list.length > EXCHANGE.swapKinds) return null;
	const items: { item: string; n: number }[] = [];
	for (const x of list) {
		const it = x as { item?: unknown; n?: unknown };
		if (!it || typeof it.item !== 'string' || !refPrice(it.item) || !Number.isInteger(it.n) || (it.n as number) < 1 || (it.n as number) > 99) return null;
		if (items.some((y) => y.item === it.item)) return null;
		items.push({ item: it.item, n: it.n as number });
	}
	return { items, cash: cash as number };
}

export const sideValue = (side: SwapSide) => side.items.reduce((v, x) => v + (refPrice(x.item) ?? 0) * x.n, 0);

/**
 * 带钱时付钱一方的钱数区间：付出的总价值（钱 + 自己给出物品的商店价）要在换来物品商店价合计的 priceMin–priceMax 倍之间。
 * 不带钱（纯换物）没有价格限制，和送礼一样。没有可行区间时返回 null
 */
export function swapCashBand(goods: SwapSide, payerItems: SwapSide): { min: number; max: number } | null {
	const ref = sideValue(goods);
	const own = sideValue(payerItems);
	const min = Math.max(1, Math.ceil(ref * EXCHANGE.priceMin - own));
	const max = Math.floor(ref * EXCHANGE.priceMax - own);
	return goods.items.length && max >= min ? { min, max } : null;
}

/**
 * 一笔面交的形状检查（与双方存档无关）：不能空手、不能纯转钱、两边不能同时给钱、带钱时钱数在 swapCashBand 里。合法返回 undefined
 */
export function swapShapeBlocked(give: SwapSide, want: SwapSide): string | undefined {
	if (!give.items.length && !want.items.length) return '至少要有一件物品。';
	if (give.cash > 0 && want.cash > 0) return '只能一方给钱。';
	const payer = give.cash > 0 ? give : want.cash > 0 ? want : null;
	if (!payer) return undefined;
	const goods = payer === give ? want : give;
	if (!goods.items.length) return '不能直接转钱，钱只能用来买东西。';
	const band = swapCashBand(goods, payer);
	if (!band) return '这些东西不值得再加钱。';
	if (payer.cash < band.min || payer.cash > band.max) return `这笔要加的钱在 $${band.min}–$${band.max} 之间。`;
	return undefined;
}

/** 面交里涉及的钱（给账本和额度用） */
export const swapCash = (give: SwapSide, want: SwapSide) => give.cash + want.cash;

/**
 * 一笔面交：a 给出 give、拿到 want；b 反过来。双方同一地点，锁内重新检查后一次结算。不改入参。
 * 收钱一方付 swapFee（货币回收）。
 */
/**
 * 收到换物请求的一方现在能不能同意（纯函数，界面提前把「同意」按钮置灰用；结算时服务端仍按 resolveSwap 全部重查）。
 * 只查自己这边：今天收下的次数、待处理事件、有没有对方要的东西和钱、背包放不放得下。新号限制和每日额度只有服务端知道，不在这里查。
 */
export function swapReceiverBlocked(b: PlayerState, give: SwapSide, want: SwapSide, day: number): string | undefined {
	if (tradesToday(b, day).in >= TRADE_DAILY) return `今天已经收下 ${TRADE_DAILY} 次了`;
	if (b.pending) return '先处理眼前的事件';
	if (!want.items.every((x) => (b.inventory[x.item] ?? 0) >= x.n)) return '你没有对方想要的东西';
	if (b.cash < want.cash) return `要付 $${want.cash}，钱不够`;
	if (!give.items.every((x) => roomFor(b, x.item) + (want.items.find((y) => y.item === x.item)?.n ?? 0) >= x.n)) return '背包放不下';
	return undefined;
}

export function resolveSwap(a: PlayerState, b: PlayerState, give: SwapSide, want: SwapSide, ctx: { now: number; day: number; tx: string; aHash: string; bHash: string }): { a: PlayerState; b: PlayerState; fee: number; entry: LedgerEntry } | string {
	if (a.id === b.id) return '不能和自己交易。';
	// 和送礼、二手摊共用每日次数：发起人算送出一次，收下的人算收下一次
	if (tradesToday(a, ctx.day).out >= TRADE_DAILY) return `发起人今天已经给出去 ${TRADE_DAILY} 次了。`;
	if (tradesToday(b, ctx.day).in >= TRADE_DAILY) return `今天已经收下 ${TRADE_DAILY} 次了，明天再来。`;
	const shape = swapShapeBlocked(give, want);
	if (shape) return shape;
	if (a.pending || b.pending) return '有人还有没处理完的事件。';
	if (a.loc !== b.loc) return '要在同一个地点才能面交。';
	const has = (s: PlayerState, side: SwapSide) => side.items.every((x) => (s.inventory[x.item] ?? 0) >= x.n) && s.cash >= side.cash;
	if (!has(a, give)) return '发起人已经没有这些东西或钱了。';
	if (!has(b, want)) return '你没有对方想要的东西或钱。';
	const fits = (s: PlayerState, gets: SwapSide, gives: SwapSide) => gets.items.every((x) => roomFor(s, x.item) + (gives.items.find((y) => y.item === x.item)?.n ?? 0) >= x.n);
	if (!fits(a, want, give)) return '发起人背包放不下了。';
	if (!fits(b, give, want)) return '你的背包放不下了。';
	const cash = swapCash(give, want);
	const fee = feeOf(cash, EXCHANGE.swapFee);
	const sa = clone(a);
	const sb = clone(b);
	const move = (from: PlayerState, to: PlayerState, side: SwapSide) => {
		for (const x of side.items) {
			takeItem(from, x.item, x.n);
			to.inventory[x.item] = (to.inventory[x.item] ?? 0) + x.n;
		}
		from.cash -= side.cash;
		to.cash += side.cash;
	};
	move(sa, sb, give);
	move(sb, sa, want);
	// 收钱的一方付手续费
	if (fee > 0) (give.cash > 0 ? sb : sa).cash -= fee;
	const ta = tradesToday(sa, ctx.day);
	const tb = tradesToday(sb, ctx.day);
	sa.trades = { day: ctx.day, out: ta.out + 1, in: ta.in };
	sb.trades = { day: ctx.day, out: tb.out, in: tb.in + 1 };
	const desc = (side: SwapSide) => [...side.items.map((x) => `${getItem(x.item)!.icon}${getItem(x.item)!.name}×${x.n}`), ...(side.cash ? [`$${side.cash}`] : [])].join('、') || '什么也没有';
	log(sa, `🤝 和${b.name}面交：给出 ${desc(give)}，换来 ${desc(want)}${fee && want.cash ? `（手续费 $${fee}）` : ''}。`);
	log(sb, `🤝 和${a.name}面交：给出 ${desc(want)}，换来 ${desc(give)}${fee && give.cash ? `（手续费 $${fee}）` : ''}。`);
	const goods = give.cash > 0 ? want : give;
	const first = goods.items[0] ?? give.items[0] ?? want.items[0];
	const payerSide = give.cash > 0 ? give : want;
	const unit = cash > 0 && goods.items.length ? (cash + sideValue(payerSide)) / Math.max(1, sideValue(goods)) : 1;
	const flags = cash > 0 ? (unit < EXCHANGE.flagLow ? ['price-low'] : unit > EXCHANGE.flagHigh ? ['price-high'] : []) : [];
	// 账本里卖方是收钱的一方（没钱时记发起人）
	const sellerIsB = want.cash > 0 ? false : give.cash > 0;
	const entry: LedgerEntry = {
		tx: ctx.tx, at: ctx.now, kind: 'swap', item: first.item, n: goods.items.reduce((n, x) => n + x.n, 0) || first.n, price: cash, fee,
		seller: sellerIsB ? ctx.bHash : ctx.aHash, buyer: sellerIsB ? ctx.aHash : ctx.bHash, flags,
	};
	return { a: booked(a, fin(sa, a)), b: booked(b, fin(sb, b)), fee, entry };
}

/** 发给客户端的拍品：不带真实 id；告诉是不是自己的、自己是不是最高出价 */
export function lotView(lot: Lot, me: string) {
	return {
		id: lot.id, kind: lot.kind, item: lot.item, price: lot.price, bid: lot.bid, next: lot.kind === 'auction' ? minBid(lot) : lot.price,
		name: lot.sellerName, avatar: lot.sellerAvatar, endsAt: lot.endsAt, mine: lot.seller === me, leading: lot.bidder === me,
	};
}
export type LotView = ReturnType<typeof lotView>;
