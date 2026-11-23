// 二手市场「邻里换手墙」的规则：纯函数（设计见 docs/earth-game/secondhand.md）。
// 挂单和买家出价由「地点 + 游戏日」的公开哈希生成，客户端和服务端算出来一样；
// 骗局是真是假、砍价成不成在结算时用 state.seed 掷骰（seed 不发给客户端），所以客户端只能看红旗，猜不到结果。
// 结算只在服务端经 applyAction() 发生；价格、骗局、运费全部由服务端重算，客户端发来的只有「选哪条、怎么买」。
import { carLoanBlocks } from './bank.ts';
import { advance, atHome, campBlocks, clone, collapsedResult, fail, getFurniture, getLocation, getVehicle, growSkill, log, roll } from './engine.ts';
import { getItem } from './attributes.ts';
import { dayOf, hoursLabel, inSpan, isOpen } from './time.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';
import { FURNITURE_RESALE } from '../data/furniture.ts';
import { DEPRECIATION, SERVICE_KM } from '../data/vehicles.ts';
import { BUYER_FLAGS, LISTING_FLAGS, SWAP, SWAP_GOODS, SWAP_NORMAL, SWAP_SEASONS, SWAP_TIPS, type SwapFlag, type SwapGood, type SwapKind, type SwapSeason } from '../data/secondhand.ts';

export type SwapHow = 'pickup' | 'prepay';

const CAT_ICON: Record<string, string> = { 家具: '🛋️', 电器: '🔌' };

// ---------- 公开哈希随机数（不用 state.seed：挂单要对所有人、客户端和服务端都一样） ----------
function hash32(key: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** 由字符串种出的确定性随机序列，[0, 1) */
export function keyRng(key: string): () => number {
	let a = hash32(key);
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------- 价格 ----------
/** 这件东西的新品价（物品、家具、车型的标价）；未知返回 0 */
export function newPrice(good: Pick<SwapGood, 'kind' | 'ref'>): number {
	if (good.kind === 'item') return getItem(good.ref)?.price ?? 0;
	if (good.kind === 'furniture') return getFurniture(good.ref)?.price ?? 0;
	return getVehicle(good.ref)?.price ?? 0;
}

/** 保底回收比例 e：不经换手墙也一定能拿回的比例（家具折现、车行回收、二手店回收） */
export function exitRatio(good: Pick<SwapGood, 'kind' | 'ref'>): number {
	if (good.kind === 'furniture') return FURNITURE_RESALE;
	if (good.kind === 'vehicle') return getVehicle(good.ref)?.resale ?? 0;
	return SWAP.itemExit;
}

/** 二手标价下限：新品价 × e × floorOver，向上取整 */
export const floorPrice = (good: Pick<SwapGood, 'kind' | 'ref'>) => Math.ceil(newPrice(good) * exitRatio(good) * SWAP.floorOver);

/**
 * 车的成色系数：和车行回收、净资产用同一条按里程折旧的线（main 的 DEPRECIATION，见 engine.ts resaleValue）——
 * 系数 = 这个里程的回收比例 ÷ 新车的回收比例；合并 main 后复核：原来自己一条线（最低 0.6），跑很多公里的车在换手墙比车行贵得多
 */
export const kmFactor = (km: number, id: string) => {
	const v = getVehicle(id);
	if (!v || v.resale <= 0) return 1;
	const share = Math.max(Math.min(v.resale, DEPRECIATION.floor), v.resale - Math.max(0, km) * DEPRECIATION.perKm);
	return share / v.resale;
};

export function goodName(good: Pick<SwapGood, 'kind' | 'ref'>): { name: string; icon: string } {
	if (good.kind === 'item') {
		const i = getItem(good.ref);
		return { name: i?.name ?? good.ref, icon: i?.icon ?? '📦' };
	}
	if (good.kind === 'vehicle') {
		const v = getVehicle(good.ref);
		return { name: v?.name ?? good.ref, icon: v?.icon ?? '🚗' };
	}
	const cat = SWAP_GOODS.find((g) => g.kind === 'furniture' && g.ref === good.ref)?.cat ?? '家具';
	return { name: getFurniture(good.ref)?.name ?? good.ref, icon: CAT_ICON[cat] ?? '🛋️' };
}

// ---------- 搬家季 ----------
/** 今天是不是搬家季（开学、毕业）；不是返回 SWAP_NORMAL */
export function swapSeason(clock: number): SwapSeason {
	return SWAP_SEASONS.find((w) => inSpan(clock, w.season, w.day, w.days).active) ?? SWAP_NORMAL;
}

export function haggleChance(state: PlayerState, win: SwapSeason): number {
	const h = SWAP.haggle;
	return Math.min(h.max, Math.max(h.min, h.base + state.skills.charisma * h.perCharisma + win.haggle));
}

/** 骗局几率：没有红旗时为 base（买家一侧 base 为 0，没红旗的买家一定是真的） */
export function scamChance(flags: string[], table: SwapFlag[], base: number): number {
	const sum = flags.reduce((s, id) => s + (table.find((f) => f.id === id)?.weight ?? 0), 0);
	return Math.min(SWAP.maxScam, base + sum);
}

// ---------- 今天的换手墙 ----------
/** 今天的换手墙记录（跨游戏日自动换新；累计的识破 / 被骗次数保留）。不改入参 */
export function swapToday(state: PlayerState): PlayerState['swap'] {
	const day = dayOf(state.clock);
	const sw = state.swap;
	return sw.day === day ? sw : { day, done: [], sold: 0, dodged: sw.dodged, lost: sw.lost };
}

export interface SwapListing {
	id: string;
	good: SwapGood;
	name: string;
	icon: string;
	loc: string; // 东西在哪（上门自提的地方）
	locName: string;
	remote: boolean; // 外地卖家：只能先转账
	ask: number;
	haggled: number; // 砍价成功后的价格
	flags: string[];
	km: number; // 只对车有意义
	since: number;
	done: boolean;
}

export interface SwapBoard {
	season: SwapSeason;
	listings: SwapListing[];
}

const marketHere = (region: Region, locId: string) => {
	const loc = getLocation(region, locId);
	return loc && SWAP.kinds.includes(loc.kind) ? loc : undefined;
};

function pickGood(r: () => number): SwapGood {
	const total = SWAP_GOODS.reduce((s, g) => s + g.weight, 0);
	let x = r() * total;
	for (const g of SWAP_GOODS) if ((x -= g.weight) < 0) return g;
	return SWAP_GOODS[SWAP_GOODS.length - 1];
}

function makeListing(id: string, r: () => number, win: SwapSeason, loc: { id: string; name: string }, remote: boolean, done: string[]): SwapListing {
	const good = pickGood(r);
	const q = r();
	const flags: string[] = [];
	if (remote) {
		flags.push('remote');
		if (r() < 0.6) flags.push('cheap');
	}
	if (r() < SWAP.flagChance) {
		const pool = LISTING_FLAGS.filter((f) => f.id !== 'remote' && !flags.includes(f.id));
		flags.push(pool[Math.floor(r() * pool.length)].id);
	}
	const np = newPrice(good);
	const floor = floorPrice(good);
	const ceil = Math.max(floor, np - 1);
	const fr = exitRatio(good) * SWAP.floorOver;
	const raw = flags.includes('cheap') ? floor : Math.round(np * (fr + (SWAP.askTop - fr) * q) * win.ask);
	const ask = Math.min(ceil, Math.max(floor, raw));
	const disc = SWAP.haggle.discLo + (SWAP.haggle.discHi - SWAP.haggle.discLo) * r();
	const haggled = Math.max(floor, Math.round(ask * (1 - disc)));
	const km = good.kind === 'vehicle' ? Math.round((SWAP.kmLo + (1 - q) * (SWAP.kmHi - SWAP.kmLo)) / 100) * 100 : 0;
	const since = good.kind === 'vehicle' ? Math.min(km, Math.floor(r() * SERVICE_KM * 1.5)) : 0;
	return { id, good, ...goodName(good), loc: loc.id, locName: loc.name, remote, ask, haggled, flags, km, since, done: done.includes(id) };
}

/** 当前地点的换手墙：不在有换手墙的地点返回 null */
export function swapBoard(state: PlayerState, region: Region): SwapBoard | null {
	const loc = marketHere(region, state.loc);
	if (!loc) return null;
	const day = dayOf(state.clock);
	const season = swapSeason(state.clock);
	const done = swapToday(state).done;
	const n = Math.max(1, (loc.kind === 'city' ? SWAP.listings.city : SWAP.listings.other) + season.supply);
	const listings: SwapListing[] = [];
	for (let i = 0; i < n; i++) listings.push(makeListing(`${loc.id}-${i}`, keyRng(`${loc.id}|${day}|${i}`), season, loc, false, done));
	const others = region.locations.filter((l) => l.id !== loc.id && SWAP.kinds.includes(l.kind));
	for (let j = 0; j < SWAP.remote && others.length; j++) {
		const r = keyRng(`${loc.id}|${day}|remote|${j}`);
		const far = others[Math.floor(r() * others.length)];
		listings.push(makeListing(`${loc.id}-r${j}`, r, season, far, true, done));
	}
	return { season, listings };
}

/** 这样买要花的钱（按标价算，砍价成功会更少）：先转账要付运费；自提家具又没车要付搬运 */
export function buyCost(state: PlayerState, l: SwapListing, how: SwapHow, price = l.ask): { price: number; fee: number } {
	const fee = how === 'prepay' ? SWAP.delivery[l.good.kind] : l.good.kind === 'furniture' && state.vehicle === 'none' ? SWAP.delivery.furniture : 0;
	return { price, fee };
}

/** 这条挂单能不能这样买；能买返回 undefined */
export function buyBlocked(state: PlayerState, l: SwapListing, how: SwapHow): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	if (l.done) return '这条挂单你今天已经处理过了。';
	if (how === 'pickup') {
		if (l.remote || l.loc !== state.loc) return '卖家在外地，没法上门看货。';
		if (!isOpen(SWAP.pickupHours, state.clock)) return `上门看货要在 ${hoursLabel(SWAP.pickupHours)}`;
	}
	const g = l.good;
	if (g.kind === 'item' && (state.inventory[g.ref] ?? 0) >= (getItem(g.ref)?.max ?? 0)) return '已经带满了。';
	if (g.kind === 'furniture') {
		if (!state.home) return '先租个住处，家具才有地方放。';
		if (state.home.furniture[getFurniture(g.ref)!.slot] === g.ref) return '家里已经有一件了。';
	}
	if (g.kind === 'vehicle' && state.vehicle !== 'none') return '先把现在的车卖了再买。';
	const c = buyCost(state, l, how);
	if (state.cash < c.price + c.fee) return `需要 $${c.price + c.fee}。`;
	return undefined;
}

const pushDone = (sw: PlayerState['swap'], id: string) => {
	sw.done.push(id);
	if (sw.done.length > SWAP.doneMax) sw.done.splice(0, sw.done.length - SWAP.doneMax);
};

/** 东西到手：物品进背包；家具摆进住处（同槽位旧家具按折现比例卖掉）；车直接开走，里程跟车走 */
function grant(state: PlayerState, l: SwapListing): string {
	const g = l.good;
	if (g.kind === 'item') {
		state.inventory[g.ref] = (state.inventory[g.ref] ?? 0) + 1;
		return '';
	}
	if (g.kind === 'vehicle') {
		state.vehicle = g.ref;
		state.car = { km: l.km, since: l.since };
		return `，里程 ${l.km.toLocaleString()} 公里`;
	}
	const slot = getFurniture(g.ref)!.slot;
	const old = getFurniture(state.home!.furniture[slot] ?? '');
	state.home!.furniture[slot] = g.ref;
	if (!old) return '';
	const back = Math.round(old.price * FURNITURE_RESALE);
	state.cash += back;
	return `（旧的${old.name}折了 $${back}）`;
}

/**
 * 买一条挂单。pickup：上门看货、当面付款，骗局当场识破、不亏钱，但要人在当地、花时间；
 * prepay：先转账让对方送货，省时间、外地的也能买，但遇到骗子钱就没了。haggle：先砍价（魅力检定）。
 * 客户端只发 id、ref（防止跨日后挂单变了还按旧的买）和方式；价格、骗局都在这里算。
 */
export function buyListing(prev: PlayerState, region: Region, id: string, ref: string, how: SwapHow, haggle: boolean): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const board = swapBoard(prev, region);
	if (!board) return fail(prev, '这里没有换手墙。');
	const l = board.listings.find((x) => x.id === id);
	if (!l || l.good.ref !== ref) return fail(prev, '这条挂单已经下架了。');
	const why = buyBlocked(prev, l, how);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const sw = (state.swap = swapToday(state));
	pushDone(sw, l.id);
	let price = l.ask;
	let minutes = 0;
	let note = '';
	if (haggle) {
		minutes += SWAP.haggle.minutes;
		const won = roll(state) < haggleChance(state, board.season);
		growSkill(state, 'charisma', 0.4);
		price = won ? l.haggled : l.ask;
		note = won && price < l.ask ? `砍到了 $${price}，` : '卖家不松口，';
	}
	const scam = roll(state) < scamChance(l.flags, LISTING_FLAGS, SWAP.baseScam);
	const { fee } = buyCost(state, l, how, price);
	let msg: string;
	if (how === 'pickup') {
		minutes += l.good.kind === 'vehicle' ? SWAP.testDriveMinutes : SWAP.pickupMinutes;
		if (scam) {
			sw.dodged++;
			msg = `🚩 按约好的地址上门看${l.name}，根本没有这个人。好在没先转账，一分钱没亏。`;
			log(state, `${msg}（${SWAP_TIPS.prepay}）`);
		} else {
			state.cash -= price + fee;
			const extra = grant(state, l);
			msg = `${l.icon} ${note}上门看过货，$${price}${fee ? ` 加搬运 $${fee}` : ''} 买下了${l.name.startsWith('二手') ? '' : '二手'}${l.name}${extra}。`;
			log(state, msg);
		}
	} else {
		minutes += SWAP.prepayMinutes;
		state.cash -= price + fee;
		if (scam) {
			sw.lost++;
			msg = `💸 先转了 $${price + fee} 给卖${l.name}的人，对方收钱后把你拉黑了。`;
			log(state, `${msg}（${SWAP_TIPS.prepay}）`);
		} else {
			const extra = grant(state, l);
			msg = `${l.icon} ${note}先转账 $${price}${fee ? `、运费 $${fee}` : ''}，${l.name.startsWith('二手') ? '' : '二手'}${l.name}送到了${extra}。`;
			log(state, msg);
		}
	}
	if (advance(state, minutes, region)) return collapsedResult(state);
	return { ok: true, state, msg };
}

// ---------- 卖东西 ----------
export interface SwapOffer {
	id: string;
	amount: number;
	flags: string[];
	done: boolean;
}

/** 你手上能拿到换手墙卖的东西（不看在哪） */
export function swapOwned(state: PlayerState): SwapGood[] {
	return SWAP_GOODS.filter((g) =>
		g.kind === 'item' ? (state.inventory[g.ref] ?? 0) > 0
			: g.kind === 'vehicle' ? state.vehicle === g.ref
				: !!state.home && Object.values(state.home.furniture).includes(g.ref));
}

/** 不看买家，这件东西现在能不能卖；能卖返回 undefined */
export function sellBlockedSwap(state: PlayerState, good: SwapGood): string | undefined {
	if (state.pending) return '先处理眼前的事件。';
	if (!swapOwned(state).includes(good)) return '你没有这件东西。';
	if (swapToday(state).sold >= SWAP.sellDaily) return `今天已经卖了 ${SWAP.sellDaily} 次，明天再挂。`;
	if (good.kind === 'furniture' && !atHome(state)) return '买家要上门搬，得在住处才能卖家具。';
	if (good.kind === 'vehicle') return carLoanBlocks(state) ?? campBlocks(state, 'none'); // 车贷的抵押车不能卖（银行合并 main 后）
	return undefined;
}

/** 这件东西今天的买家出价（不在有换手墙的地点或东西不在可交易清单里返回 null） */
export function sellOffers(state: PlayerState, region: Region, kind: SwapKind, ref: string): { good: SwapGood; offers: SwapOffer[]; blocked?: string } | null {
	const loc = marketHere(region, state.loc);
	const good = SWAP_GOODS.find((g) => g.kind === kind && g.ref === ref);
	if (!loc || !good) return null;
	const season = swapSeason(state.clock);
	const sw = swapToday(state);
	const r = keyRng(`${loc.id}|${sw.day}|sell|${sw.sold}|${kind}|${ref}`);
	const cond = kind === 'vehicle' ? kmFactor(state.car.km, ref) : 1;
	const base = newPrice(good) * exitRatio(good) * season.sell * cond;
	const n = season.sell < 1 ? SWAP.buyers - 1 : SWAP.buyers;
	const offers: SwapOffer[] = [];
	for (let i = 0; i < n; i++) {
		const flags = r() < SWAP.flagChance ? [BUYER_FLAGS[Math.floor(r() * BUYER_FLAGS.length)].id] : [];
		const amount = Math.max(1, Math.round(base * (flags.length ? SWAP.flagBonus : SWAP.offerLo + (1 - SWAP.offerLo) * r())));
		const id = `o-${kind}-${ref}-${sw.sold}-${i}`;
		offers.push({ id, amount, flags, done: sw.done.includes(id) });
	}
	return { good, offers, blocked: sellBlockedSwap(state, good) };
}

function takeAway(state: PlayerState, good: SwapGood) {
	if (good.kind === 'item') {
		const left = (state.inventory[good.ref] ?? 0) - 1;
		if (left > 0) state.inventory[good.ref] = left;
		else delete state.inventory[good.ref];
	} else if (good.kind === 'vehicle') {
		state.vehicle = 'none';
		state.car = { km: 0, since: 0 };
	} else {
		const slot = getFurniture(good.ref)!.slot;
		Reflect.deleteProperty(state.home!.furniture, slot);
	}
}

/**
 * 把东西卖给第 buyer 个买家。verify：等钱真的到账（或当面收现金）再交货，多花时间，但假付款一定识破；
 * 不等就交货：快，但遇到假付款东西就没了，「多付了请退差价」还要再赔一笔。
 */
export function sellToBuyer(prev: PlayerState, region: Region, kind: SwapKind, ref: string, buyer: number, verify: boolean): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const so = sellOffers(prev, region, kind, ref);
	if (!so) return fail(prev, '这里没有换手墙。');
	if (so.blocked) return fail(prev, so.blocked);
	const offer = so.offers[buyer];
	if (!offer) return fail(prev, '这个买家不在了。');
	if (offer.done) return fail(prev, '这个买家已经走了。');
	const state = clone(prev);
	const sw = (state.swap = swapToday(state));
	pushDone(sw, offer.id);
	const { name, icon } = goodName(so.good);
	const fake = roll(state) < scamChance(offer.flags, BUYER_FLAGS, 0);
	const flag = BUYER_FLAGS.find((f) => f.id === offer.flags[0]);
	const tip = flag?.id === 'overpay' ? SWAP_TIPS.overpay : flag?.id === 'link' ? SWAP_TIPS.link : SWAP_TIPS.fake;
	let msg: string;
	if (fake && verify) {
		sw.dodged++;
		msg = `🚩 买${name}的人${flag!.text}。你坚持等钱到账再交货，对方一直没付，最后不回消息了。东西还在你手里。`;
		log(state, `${msg}（${tip}）`);
	} else if (fake) {
		takeAway(state, so.good);
		const loss = flag?.refund ? Math.min(state.cash, Math.round(offer.amount * flag.refund)) : 0;
		state.cash -= loss;
		sw.lost++;
		msg = `💸 没等钱到账就交了${name}${loss ? `，还「退了差价」$${loss}` : ''}。那笔付款根本不存在。`;
		log(state, `${msg}（${tip}）`);
	} else {
		takeAway(state, so.good);
		state.cash += offer.amount;
		sw.sold++;
		msg = `${icon} 把${name}卖了 $${offer.amount}。`;
		log(state, msg);
	}
	if (advance(state, verify ? SWAP.verifyMinutes : SWAP.quickMinutes, region)) return collapsedResult(state);
	return { ok: true, state, msg };
}
