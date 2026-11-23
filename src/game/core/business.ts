// 副业与小生意（第 1 版）的规则：纯函数、确定性（随机数只来自 state.seed），动作都不修改入参。
// 设计说明见 docs/earth-game/side-business.md；数值在 data/business.ts，全部「待平衡」。
//
// 三块：
// 1. 证照（ABN、商号、WWC 儿童工作检查、食品营业登记）：网上办，在哪都能办，按州的只在那个州有效。
// 2. 副业：市集摆摊、代购、家教、送外卖、摄影接单。每种每个游戏日一次，花时间、花精力，收入有随机。
// 3. 店铺：真实街区选址、押金和装修、进货、雇人、看店；每个游戏日自动结算客流、工资、租金和经营事件，
//    欠款达到几周租金就倒闭。结算由 actions.ts 的 applyAction 在每个成功动作之后调用 settleBiz()。
// 生意的营业额记进 biz.book（按游戏年），达到 GST 门槛自动登记，之后按营业额减进货的 1/11 交 GST。
import { GIGS, GST, LICENSES, SHOP_EVENTS, SHOP_RULES, SHOP_SITES, SHOP_TYPES, type GigDef, type LicenseDef, type ShopEventDef, type ShopSiteDef, type ShopTypeDef, type StateCode } from '../data/business.ts';
import { areaOf } from '../data/areas-base.ts';
import { applyEffect, clone, collapsedResult, fail, getLocation, log, roll } from './engine.ts';
import { dateOf, dayOf, hoursLabel, isOpen, weekdayOf } from './time.ts';
import { weatherAt } from './weather.ts';
import { logWork, visaBlocked } from './visa.ts';
import { illnessBlock } from './health.ts';
import { copyTally, tallyCash } from './tally.ts';
import { workStopped } from './disasters.ts';
import { clamp100 } from './character.ts';
import type { ActionResult, Effect, GameLocation, PlayerState, Region, ShopState, Where } from './types.ts';

export const getLicenseDef = (id: string): LicenseDef | undefined => LICENSES.find((l) => l.id === id);
export const getGig = (id: string): GigDef | undefined => GIGS.find((g) => g.id === id);
export const getShopType = (id: string): ShopTypeDef | undefined => SHOP_TYPES.find((t) => t.id === id);
export const getShopSite = (id: string): ShopSiteDef | undefined => SHOP_SITES.find((s) => s.id === id);

const today = (s: PlayerState) => dayOf(s.clock);
const whereMatch = (w: Where, loc: GameLocation) => !!(w.kinds?.includes(loc.kind) || w.tags?.some((t) => loc.tags.includes(t)));

/** 某个地点属于哪个州；地图外的地点（损坏存档）返回 undefined */
export function stateOf(locId: string): StateCode | undefined {
	const id = areaOf(locId)?.id;
	return id === 'wa' || id === 'sa' ? id : undefined;
}

// ---------- 证照 ----------
/** 证照在 day 这一天是否有效：办过、没过期 */
export function licenseValid(state: PlayerState, id: string, day = today(state)): boolean {
	const got = state.biz.lic[id];
	const def = getLicenseDef(id);
	if (got === undefined || !def) return false;
	return def.days === 0 || day < got + def.days;
}

/** 过期日（游戏日）；不过期或没办过返回 null */
export function licenseExpires(state: PlayerState, id: string): number | null {
	const got = state.biz.lic[id];
	const def = getLicenseDef(id);
	return got === undefined || !def || def.days === 0 ? null : got + def.days;
}

/** 把副业要求里按州办的证照（写成前缀 wwc）补成所在州的 id */
export function resolveLicense(id: string, st: StateCode | undefined): string {
	return getLicenseDef(id) ? id : `${id}-${st ?? 'wa'}`;
}

export interface LicenseOffer {
	lic: LicenseDef;
	valid: boolean;
	expires: number | null;
	blocked?: string;
}

/** 所有证照的状态；办理按钮能不能按 */
export function licenseOffers(state: PlayerState): LicenseOffer[] {
	return LICENSES.map((lic) => {
		const valid = licenseValid(state, lic.id);
		const missing = lic.needs?.find((n) => !licenseValid(state, n));
		const blocked = valid
			? '已有，还在有效期内'
			: state.pending ? '先处理眼前的事件'
				: missing ? `先办${getLicenseDef(missing)?.name ?? missing}`
					: state.cash < lic.fee ? `需要 $${lic.fee}` : undefined;
		return { lic, valid, expires: licenseExpires(state, lic.id), blocked };
	});
}

/** 办（或续办）一张证照：先把时间过完再收费，途中晕倒不收费、不发证（同 engine.ts 的 paidTask 口径） */
export function getLicense(prev: PlayerState, region: Region, id: string): ActionResult {
	const offer = licenseOffers(prev).find((o) => o.lic.id === id);
	if (!offer) return fail(prev, '没有这种证照。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	if (applyEffect(state, { minutes: offer.lic.minutes, needs: { fun: -3 } }, region)) return collapsedResult(state);
	if (state.cash < offer.lic.fee) return fail(prev, `需要 $${offer.lic.fee}`);
	state.cash -= offer.lic.fee;
	state.biz.lic[id] = today(state);
	const msg = `${offer.lic.icon} 办好了${offer.lic.name}${offer.lic.fee ? `，交了 $${offer.lic.fee}` : '，不收费'}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 账本与 GST ----------
/** 本笔生意要交的 GST：已登记时按（营业额 − 这笔的进货成本）的 1/11，不为负 */
export function gstDue(state: PlayerState, gross: number, cost: number): number {
	return state.biz.gst ? Math.max(0, Math.round((gross - cost) * GST.rate)) : 0;
}

/** 记一笔生意账（原地修改）：跨游戏年先清零；营业额到门槛自动登记 GST。返回要追加的提示 */
export function recordBiz(state: PlayerState, day: number, gross: number, net: number): string {
	const y = dateOf(day * 1440).year;
	if (state.biz.book.y !== y) state.biz.book = { y, gross: 0, net: 0 };
	state.biz.book.gross = Math.min(1e9, state.biz.book.gross + Math.max(0, Math.round(gross)));
	state.biz.book.net = Math.max(-1e9, Math.min(1e9, state.biz.book.net + Math.round(net)));
	if (state.biz.gst || state.biz.book.gross < GST.threshold) return '';
	state.biz.gst = true;
	if (!licenseValid(state, 'abn', day)) state.biz.lic.abn = Math.min(day, today(state));
	const text = `今年营业额到了 $${GST.threshold.toLocaleString('en-US')}，已登记 GST，之后每笔生意按毛利的 1/11 交 GST。`;
	log(state, text);
	return ` 🧾 ${text}`;
}

// ---------- 副业 ----------
export interface GigOffer {
	gig: GigDef;
	/** 预计收入区间（不含成本、GST） */
	range: [number, number];
	blocked?: string;
}

function gigMult(state: PlayerState, gig: GigDef): number {
	let k = 1 + state.skills[gig.skill] / 200;
	if (gig.noVehicle && state.vehicle === 'none') k *= gig.noVehicle;
	if (gig.rain && (weatherAt(state).id === 'rain' || weatherAt(state).id === 'storm')) k *= gig.rain;
	return k;
}

/**
 * 副业、看店都是有报酬的工作（合并 main 后）：签证过期不能做；学生签证在读期间算进每两周 48 小时；
 * 生病不能上班的病也不能做；灾害让这里停工时也不做
 */
export function workRules(state: PlayerState, loc: GameLocation | undefined, minutes: number): string | undefined {
	return visaBlocked(state, minutes) ?? illnessBlock(state, ['work']) ?? (loc ? workStopped(loc, today(state)) : undefined);
}

function gigBlocked(state: PlayerState, gig: GigDef, loc?: GameLocation): string | undefined {
	if (state.pending) return '先处理眼前的事件';
	if (state.biz.gigs[gig.id] === today(state)) return '今天已经做过了';
	if (gig.days && !gig.days.includes(weekdayOf(state.clock))) return '只在周末';
	if (!isOpen(gig.hours, state.clock)) return `${hoursLabel(gig.hours)} 才能开始`;
	const st = stateOf(state.loc);
	for (const raw of gig.licenses ?? []) {
		const id = resolveLicense(raw, st);
		if (!licenseValid(state, id)) return `要先办${getLicenseDef(id)?.name ?? id}`;
	}
	if (gig.portfolio && state.photoQuest < gig.portfolio) return `要先完成 ${gig.portfolio} 个摄影任务当作品集（现在 ${state.photoQuest} 个）`;
	if (state.needs.energy < 25) return '太累了，先休息';
	const work = workRules(state, loc, gig.minutes);
	if (work) return work;
	if (state.cash < gig.cost) return `要先垫 $${gig.cost}`;
	return undefined;
}

/** 当前地点能做的副业 */
export function gigsAt(state: PlayerState, region: Region): GigOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return GIGS.filter((g) => whereMatch(g.where, loc)).map((gig) => {
		const k = gigMult(state, gig);
		return { gig, range: [Math.round(gig.base * k * 0.75), Math.round(gig.base * k * 1.25)] as [number, number], blocked: gigBlocked(state, gig, loc) };
	});
}

/** 做一次副业：先付成本，时间走完、没晕倒才拿到收入（同 applyEffect 的付出在前、收获在后） */
export function doGig(prev: PlayerState, region: Region, id: string): ActionResult {
	const offer = gigsAt(prev, region).find((o) => o.gig.id === id);
	if (!offer) return fail(prev, '这里做不了这份副业。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const gig = offer.gig;
	const state = clone(prev);
	const day = today(state);
	state.biz.gigs[gig.id] = day;
	const r = roll(state);
	const lost = !!gig.loss && roll(state) < gig.loss;
	const gross = lost ? 0 : Math.round(gig.base * gigMult(prev, gig) * (0.75 + 0.5 * r));
	const gst = gstDue(state, gross, gig.cost);
	const good = !lost && r >= 0.5;
	state.cash -= gig.cost; // blocked 已检查过付得起
	const fx: Effect = { minutes: gig.minutes, cash: gross - gst, needs: gig.needs, skills: { [gig.skill]: gig.growth }, respect: good ? gig.respect : 0 };
	if (applyEffect(state, fx, region)) return collapsedResult(state);
	logWork(state, gig.minutes, prev.clock); // 算进签证工时（合并 main 后）
	const extra = recordBiz(state, day, gross, gross - gst - gig.cost);
	const parts = [lost ? `${gig.icon} ${gig.name}：货出了意外，$${gig.cost} 货款收不回来。` : `${gig.icon} ${gig.name} ${Math.round(gig.minutes / 60)} 小时，收入 $${gross}${gig.cost ? `（成本 $${gig.cost}）` : ''}${gst ? `，GST $${gst}` : ''}。`];
	if (good && gig.respect) parts.push(`客人很满意，声望 +${gig.respect}。`);
	const msg = parts.join('') + extra;
	log(state, parts.join(''));
	return { ok: true, state, msg };
}

// ---------- 店铺 ----------
/** 开店要的证照：ABN（商号要先有它）、商号，卖吃的再加店铺所在州的食品登记 */
export function shopLicenses(type: ShopTypeDef, site: ShopSiteDef): string[] {
	return ['abn', 'bizname', ...(type.food ? [`food-${site.state}`] : [])];
}

export const shopBond = (site: ShopSiteDef) => site.rent * SHOP_RULES.bondWeeks;
export const openCost = (type: ShopTypeDef, site: ShopSiteDef) => type.fitout + shopBond(site);

export interface ShopOffer {
	type: ShopTypeDef;
	site: ShopSiteDef;
	cost: number;
	blocked?: string;
}

/** 当前地点能租的铺面 × 店铺类型 */
export function shopOffersAt(state: PlayerState): ShopOffer[] {
	const sites = SHOP_SITES.filter((x) => x.loc === state.loc);
	return sites.flatMap((site) => SHOP_TYPES.map((type) => {
		const cost = openCost(type, site);
		const missing = shopLicenses(type, site).find((id) => !licenseValid(state, id));
		const blocked = state.pending ? '先处理眼前的事件'
			: state.biz.shop ? '你已经有一家店了（第 1 版每人一家）'
				: missing ? `要先办${getLicenseDef(missing)?.name ?? missing}`
					: state.cash < cost ? `需要 $${cost.toLocaleString('en-US')}（装修 $${type.fitout.toLocaleString('en-US')} + 押金 ${SHOP_RULES.bondWeeks} 周租金）`
						: undefined;
		return { type, site, cost, blocked };
	}));
}

/** 每天的固定开销：租金 + 店员工资 + 养老金 + 工伤保险 */
export function shopDailyCost(shop: ShopState): { rent: number; wages: number; superPay: number; comp: number; total: number } {
	const site = getShopSite(shop.site)!;
	const rent = Math.round(site.rent / 7);
	const wages = shop.staff * SHOP_RULES.staffWage;
	const superPay = Math.round(wages * SHOP_RULES.superRate);
	const comp = Math.round(wages * SHOP_RULES.compRate);
	return { rent, wages, superPay, comp, total: rent + wages + superPay + comp };
}

/** 店里的操作要人在店铺所在地点；返回原因或 undefined */
function shopHere(state: PlayerState): string | undefined {
	const shop = state.biz.shop;
	if (!shop) return '你还没有店';
	if (state.pending) return '先处理眼前的事件';
	const site = getShopSite(shop.site)!;
	if (state.loc !== site.loc) return `要到${site.name}的店里`;
	return undefined;
}

/** 店里能做什么、为什么不能做 */
export function shopActions(state: PlayerState, region?: Region): { restock?: string; hire?: string; fire?: string; tend?: string } {
	const shop = state.biz.shop;
	if (!shop) {
		const no = '你还没有店';
		return { restock: no, hire: no, fire: no, tend: no };
	}
	const here = shopHere(state);
	const type = getShopType(shop.type)!;
	return {
		restock: here ?? (shop.stock >= type.maxStock ? '库存已满' : state.cash < type.unitCost ? '钱不够进货' : undefined),
		hire: here ?? (shop.staff >= SHOP_RULES.maxStaff ? `最多雇 ${SHOP_RULES.maxStaff} 个人` : undefined),
		fire: here ?? (shop.staff <= 0 ? '没有店员' : undefined),
		tend: here ?? (shop.tend === today(state) ? '今天已经看过店了'
			: !isOpen(SHOP_RULES.tendHours, state.clock) ? `${hoursLabel(SHOP_RULES.tendHours)} 开门时才能看店`
				: state.needs.energy < 25 ? '太累了，先休息'
					// 合并 main 后：看店是工作，签证、生病、灾害停工照样拦（传了区域才查，界面和模拟都传）
					: region ? workRules(state, getLocation(region, state.loc), SHOP_RULES.tendMinutes) : undefined),
	};
}

export function openShop(prev: PlayerState, region: Region, typeId: string, siteId: string): ActionResult {
	const offer = shopOffersAt(prev).find((o) => o.type.id === typeId && o.site.id === siteId);
	if (!offer) return fail(prev, '这里没有这个铺面。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const day = today(state);
	state.cash -= offer.cost;
	if (applyEffect(state, { minutes: SHOP_RULES.openMinutes, needs: { fun: 5 } }, region)) {
		// 签了租约、装修付了：晕倒也已经开张（钱已经花出去，不能当保险箱）
		state.biz.shop = newShop(offer, day);
		return collapsedResult(state);
	}
	state.biz.shop = newShop(offer, day);
	state.respect += SHOP_RULES.openRespect;
	recordBiz(state, day, 0, -offer.type.fitout);
	const msg = `${offer.type.icon} 在${offer.site.name}开了一家${offer.type.name}！装修 $${offer.type.fitout.toLocaleString('en-US')}，押金 $${shopBond(offer.site).toLocaleString('en-US')}，每周租金 $${offer.site.rent}。先去进货，再雇人或自己看店。`;
	log(state, msg);
	return { ok: true, state, msg };
}

function newShop(offer: ShopOffer, day: number): ShopState {
	return { type: offer.type.id, site: offer.site.id, day, last: day - 1, stock: 0, staff: 0, tend: -1, rep: SHOP_RULES.repStart, debt: 0, bond: shopBond(offer.site), hist: [] };
}

/** 进货 qty 单（不超过库存上限，按钱数截短） */
export function restockShop(prev: PlayerState, region: Region, qty: number): ActionResult {
	const pre = settled(prev, region);
	const why = shopActions(pre.state).restock;
	if (why) return fail(prev, why);
	const state = pre.state === prev ? clone(prev) : pre.state;
	const shop = state.biz.shop!;
	const type = getShopType(shop.type)!;
	const n = Math.min(Math.floor(qty), type.maxStock - shop.stock, Math.floor(state.cash / type.unitCost));
	if (!(n >= 1)) return fail(prev, '进货数量不对。');
	const cost = n * type.unitCost;
	state.cash -= cost;
	shop.stock += n;
	recordBiz(state, today(state), 0, -cost);
	if (applyEffect(state, { minutes: SHOP_RULES.restockMinutes, needs: { energy: -5 } }, region)) return collapsedResult(state);
	const msg = `${pre.msg}进了 ${n} 单的货，花了 $${cost.toLocaleString('en-US')}，库存 ${shop.stock}。`;
	log(state, `给${type.name}进了 ${n} 单的货，$${cost}。`);
	return { ok: true, state, msg };
}

export function hireStaff(prev: PlayerState, region: Region, op: 'hire' | 'fire'): ActionResult {
	const pre = settled(prev, region);
	const why = shopActions(pre.state)[op];
	if (why) return fail(prev, why);
	const state = pre.state === prev ? clone(prev) : pre.state;
	const shop = state.biz.shop!;
	shop.staff += op === 'hire' ? 1 : -1;
	if (applyEffect(state, { minutes: op === 'hire' ? SHOP_RULES.hireMinutes : 30, needs: { social: op === 'hire' ? 5 : -5 } }, region)) return collapsedResult(state);
	const c = shopDailyCost(shop);
	const msg = op === 'hire'
		? `${pre.msg}雇了一名店员（每天工资 $${SHOP_RULES.staffWage}，另付 ${Math.round(SHOP_RULES.superRate * 100)}% 养老金和工伤保险）。现在 ${shop.staff} 人，每天固定开销 $${c.total}。`
		: `${pre.msg}辞退了一名店员，现在 ${shop.staff} 人。${shop.staff ? '' : '没人看店的日子不开门，但房租照交。'}`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 自己看一天店：今天多一份人手、不付自己工资；花 6 小时 */
export function tendShop(prev: PlayerState, region: Region): ActionResult {
	const pre = settled(prev, region);
	const why = shopActions(pre.state, region).tend;
	if (why) return fail(prev, why);
	const state = pre.state === prev ? clone(prev) : pre.state;
	state.biz.shop!.tend = today(state);
	if (applyEffect(state, { minutes: SHOP_RULES.tendMinutes, needs: { energy: -20, social: 12 }, skills: { charisma: 0.6, street: 0.3 } }, region)) return collapsedResult(state);
	logWork(state, SHOP_RULES.tendMinutes, pre.state.clock); // 自己看店也算工作（合并 main 后）
	const type = getShopType(state.biz.shop!.type)!;
	const msg = `${pre.msg}${type.icon} 在店里忙了 ${SHOP_RULES.tendMinutes / 60} 小时，今天的账明天结。`;
	log(state, `在自己的${type.name}看了一天店。`);
	return { ok: true, state, msg };
}

/** 关店：先结算到昨天；押金抵欠款，剩下的退回；库存按进价五折清货；装修不退 */
export function closeShop(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.biz.shop) return fail(prev, '你还没有店。');
	const pre = settled(prev, region);
	const state = pre.state === prev ? clone(prev) : pre.state;
	if (!state.biz.shop) return { ok: true, state, msg: pre.msg.trim() }; // 结算时已经倒闭
	const shop = state.biz.shop;
	const type = getShopType(shop.type)!;
	const site = getShopSite(shop.site)!;
	const clearance = Math.round(shop.stock * type.unitCost * 0.5);
	const back = shop.bond + clearance - shop.debt;
	state.cash = Math.max(0, state.cash + back);
	state.biz.shop = null;
	recordBiz(state, today(state), clearance, clearance);
	const msg = `${pre.msg}${type.icon} 关掉了${site.name}的${type.name}：押金 $${shop.bond}${clearance ? `、清货 $${clearance}` : ''}${shop.debt ? `，扣掉欠款 $${shop.debt}` : ''}，${back >= 0 ? `拿回 $${back}` : `还倒贴 $${-back}`}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 先把店结算到昨天（没有店或没有要结算的天时原样返回同一个对象） */
function settled(prev: PlayerState, region: Region): { state: PlayerState; msg: string } {
	if (!prev.biz.shop || prev.biz.shop.last >= today(prev) - 1) return { state: prev, msg: '' };
	const state = clone(prev);
	const before = state.cash;
	const msg = settleBiz(state, region);
	// 结算出的钱单独记账（和 applyAction 里的一致），不和这次进货、雇人、关店的钱混成一笔净额（合并 main 后复核）
	if (state.tally && state.cash !== before) {
		state.tally = copyTally(state.tally);
		tallyCash(state, 'work', state.cash - before);
	}
	return { state, msg: msg ? msg.trim() + ' ' : '' };
}

function pickEvent(state: PlayerState, shop: ShopState, type: ShopTypeDef): ShopEventDef | undefined {
	const pool = SHOP_EVENTS.filter((e) => (!e.food || type.food) && (!e.staffed || shop.staff > 0));
	const total = pool.reduce((n, e) => n + e.weight, 0);
	let x = roll(state) * total;
	for (const e of pool) {
		x -= e.weight;
		if (x < 0) return e;
	}
	return pool[pool.length - 1];
}

export interface DayResult {
	d: number;
	open: boolean;
	customers: number;
	sold: number;
	revenue: number;
	cost: number; // 固定开销（租金、工资、养老金、工伤保险）
	gst: number;
	event?: string;
	net: number;
}

/** 结算店铺的一天（原地修改 state）。纯规则，外面负责循环和收尾 */
export function settleShopDay(state: PlayerState, d: number): DayResult {
	const shop = state.biz.shop!;
	const type = getShopType(shop.type)!;
	const site = getShopSite(shop.site)!;
	const hands = shop.staff + (shop.tend === d ? 1 : 0);
	const open = hands > 0;
	let customers = 0;
	let sold = 0;
	if (open) {
		const weekend = weekdayOf(d * 1440) >= 5 ? SHOP_RULES.weekend : 1;
		const swing = 1 - SHOP_RULES.swing / 2 + SHOP_RULES.swing * roll(state);
		customers = Math.round(type.customers * site.traffic * (0.6 + (shop.rep / 100) * 0.8) * weekend * swing);
		const served = Math.min(customers, hands * type.perHand);
		sold = Math.min(served, shop.stock);
		shop.stock -= sold;
		shop.rep = clamp100(shop.rep + (served > sold ? SHOP_RULES.repStockout : SHOP_RULES.repServed));
	} else shop.rep = clamp100(shop.rep - 1); // 关门的日子老客人流失
	const revenue = sold * type.price;
	const fixed = shopDailyCost(shop).total;
	const gst = gstDue(state, revenue, sold * type.unitCost);
	let eventCash = 0;
	let eventText: string | undefined;
	if (roll(state) < SHOP_RULES.eventChance) {
		const ev = pickEvent(state, shop, type);
		if (ev) {
			if (ev.inspection && !licenseValid(state, `food-${site.state}`, d)) {
				eventCash = -ev.inspection.fine;
				shop.rep = clamp100(shop.rep + ev.inspection.rep);
				eventText = `${ev.text}：食品登记过期了，罚款 $${ev.inspection.fine}`;
			} else {
				eventCash = ev.cash ?? 0;
				if (ev.rep) shop.rep = clamp100(shop.rep + ev.rep);
				if (ev.stockLoss) shop.stock = Math.floor(shop.stock * (1 - ev.stockLoss));
				eventText = `${ev.text}${ev.inspection ? '，一切合格' : ''}${ev.cash ? `（${ev.cash > 0 ? '+' : '−'}$${Math.abs(ev.cash)}）` : ''}`;
			}
		}
	}
	const net = revenue - fixed - gst + eventCash;
	// 赚了先还欠款；亏了从你的现金里出，现金不够的部分记欠款（独资经营：店的钱就是你的钱）
	let cash = state.cash + net;
	if (cash < 0) {
		shop.debt = Math.min(1e9, shop.debt - cash);
		cash = 0;
	} else if (shop.debt > 0) {
		const pay = Math.min(shop.debt, cash);
		shop.debt -= pay;
		cash -= pay;
	}
	state.cash = Math.round(cash);
	shop.hist.push({ d, sold, net });
	if (shop.hist.length > SHOP_RULES.histDays) shop.hist.splice(0, shop.hist.length - SHOP_RULES.histDays);
	shop.last = d;
	return { d, open, customers, sold, revenue, cost: fixed, gst, event: eventText, net };
}

/**
 * 把店结算到昨天（原地修改，调用方传入的是引擎新建的对象）。返回给玩家看的提示（没有店或没有要结算的天为空串）。
 * 欠款达到 SHOP_RULES.closeWeeks 周租金就倒闭：押金抵欠款，剩下的欠款游戏里不再追讨（现实里独资经营者要个人承担，见设计文档）。
 */
export function settleBiz(state: PlayerState, _region?: Region): string {
	const shop = state.biz.shop;
	if (!shop) return '';
	const end = today(state) - 1;
	if (shop.last >= end) return '';
	const type = getShopType(shop.type)!;
	const site = getShopSite(shop.site)!;
	const start = Math.max(shop.last + 1, end - SHOP_RULES.maxSettleDays + 1);
	let sold = 0;
	let net = 0;
	let days = 0;
	const events: string[] = [];
	let extra = '';
	for (let d = start; d <= end; d++) {
		const r = settleShopDay(state, d);
		days++;
		sold += r.sold;
		net += r.net;
		extra += recordBiz(state, d, r.revenue, r.net);
		if (r.event) {
			events.push(r.event);
			log(state, `🏪 ${r.event}。`);
		}
		if (state.biz.shop!.debt >= site.rent * SHOP_RULES.closeWeeks) {
			const owed = state.biz.shop!.debt;
			const bond = state.biz.shop!.bond;
			state.biz.shop = null;
			state.respect = Math.max(0, state.respect + SHOP_RULES.closeRespect);
			const text = `${type.name}欠下 $${owed.toLocaleString('en-US')} 的租金和工资，撑不下去倒闭了。押金 $${bond.toLocaleString('en-US')} 被房东扣下抵债${owed > bond ? '，剩下的欠款一笔勾销（现实里要个人偿还）' : ''}，声望 ${SHOP_RULES.closeRespect}。`;
			log(state, text);
			return ` 💸 ${text}`;
		}
	}
	shop.tend = shop.tend > shop.last ? shop.tend : -1;
	const sum = `🏪 ${site.name}${type.name}结算 ${days} 天：卖出 ${sold} 单，净${net >= 0 ? '赚' : '亏'} $${Math.abs(Math.round(net)).toLocaleString('en-US')}${state.biz.shop!.debt ? `，欠款 $${state.biz.shop!.debt.toLocaleString('en-US')}` : ''}。`;
	log(state, sum);
	return ` ${sum}${events.length ? ` ${events.join('；')}。` : ''}${extra}`;
}

/** 店铺概况（界面用）：最近几天的销量和净收入、每天固定开销、离倒闭还差多少欠款 */
export function shopSummary(state: PlayerState): { shop: ShopState; type: ShopTypeDef; site: ShopSiteDef; daily: ReturnType<typeof shopDailyCost>; recentNet: number; recentSold: number; closeAt: number } | null {
	const shop = state.biz.shop;
	if (!shop) return null;
	const type = getShopType(shop.type)!;
	const site = getShopSite(shop.site)!;
	const recent = shop.hist.slice(-7);
	return {
		shop, type, site,
		daily: shopDailyCost(shop),
		recentNet: recent.reduce((n, h) => n + h.net, 0),
		recentSold: recent.reduce((n, h) => n + h.sold, 0),
		closeAt: site.rent * SHOP_RULES.closeWeeks,
	};
}
