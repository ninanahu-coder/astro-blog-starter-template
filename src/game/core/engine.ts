// 游戏规则引擎：纯函数、确定性（随机数来自存档里的 seed），前后端与测试共用。
// 所有动作返回新的 PlayerState，不修改入参。
import { ACTIVITIES } from '../data/activities.ts';
import { EVENTS } from '../data/events.ts';
import { ITEMS } from '../data/items.ts';
import { NPCS } from '../data/npcs.ts';
import { CAREERS, GOOD_BONUS, PROMOTE_GOOD, PROMOTE_SHIFTS, SHIFT_DC } from '../data/careers.ts';
import { HOMES } from '../data/housing.ts';
import { FURNITURE, FURNITURE_RESALE, FURNITURE_SLOTS, HOME_COOK, HOME_RELAX } from '../data/furniture.ts';
import { DEALER_HOURS, DEALER_TAG, VEHICLES } from '../data/vehicles.ts';
import { COURSE_PRICE_STEP, COURSES } from '../data/courses.ts';
import { AREAS, EXPERIENCES, REPEAT_FUN_SHARE } from '../data/experiences.ts';
import { dayOf, hoursLabel, isOpen } from './time.ts';
import { checkScore, costMult, decayMult, gainMult, getItem, heatMult, hurtMult } from './attributes.ts';
import { clamp100, JOURNAL_MAX, SKILL_META } from './character.ts';
import { haversineKm, locateInRegion, POI_RADIUS_KM } from './geo.ts';
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type {
	ActionResult, Activity, CareerDef, CareerLevel, Effect, GameEvent, GameLocation, HomeDef, ItemDef, NpcAction, SkillKey, VehicleDef, CourseDef, ExperienceDef, FurnitureDef, NpcDef, PlayerState, Region, Relation, Route, TravelMode, Where,
} from './types.ts';

// ---------- 调参常量 ----------
/** 每游戏分钟的需求衰减 */
export const DECAY: Record<string, number> = { hunger: 0.07, energy: 0.05, hygiene: 0.035, fun: 0.04, social: 0.03 };
const STARVE_DMG = 0.02; // 饱食或精力见底时每分钟掉血
const ARRIVAL_EVENT_CHANCE = 0.55;
const HEAT_CHECK_AT = 60;

// ---------- 随机数（mulberry32，状态存于 state.seed） ----------
function roll(state: PlayerState): number {
	let t = (state.seed = (state.seed + 0x6d2b79f5) >>> 0);
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clone = (s: PlayerState): PlayerState => structuredClone(s);
const fail = (state: PlayerState, msg: string): ActionResult => ({ ok: false, state, msg });

function log(state: PlayerState, text: string) {
	state.journal.push({ t: state.clock, text });
	if (state.journal.length > JOURNAL_MAX) state.journal.splice(0, state.journal.length - JOURNAL_MAX);
}

export function getLocation(region: Region, id: string): GameLocation | undefined {
	return region.locations.find((l) => l.id === id);
}

// ---------- 时间与效果 ----------
/** 返回 true 表示途中晕倒（已被送往医院） */
function advance(state: PlayerState, minutes: number, region: Region): boolean {
	if (minutes <= 0) return false;
	state.clock += minutes;
	weeklyTick(state, region);
	for (const k of NEED_KEYS) state.needs[k] = clamp100(state.needs[k] - DECAY[k] * decayMult(state, k) * minutes);
	if (state.needs.hunger <= 0 || state.needs.energy <= 0) {
		state.health = clamp100(state.health - STARVE_DMG * minutes);
	}
	if (state.health > 0) return false;
	collapse(state, region);
	return true;
}

/** 体力耗尽：在医院醒来，付医药费（$100 + 现金的 10%，最多 $500；不删档） */
export const COLLAPSE_BILL = { base: 100, share: 0.1, max: 500 };
function collapse(state: PlayerState, region: Region) {
	const bill = Math.min(state.cash, Math.round(Math.min(COLLAPSE_BILL.max, COLLAPSE_BILL.base + state.cash * COLLAPSE_BILL.share)));
	state.cash -= bill;
	state.health = 50;
	for (const k of NEED_KEYS) state.needs[k] = Math.max(state.needs[k], 50);
	state.loc = nearestHospital(state, region);
	state.pending = null;
	state.clock += 12 * 60;
	log(state, `你晕倒了，在${getLocation(region, state.loc)?.name ?? ''}的医院醒来，医药费 $${bill}。`);
}

/** 离当前位置最近、有医院的地点；没有就用区域默认医院 */
function nearestHospital(state: PlayerState, region: Region): string {
	const here = getLocation(region, state.loc);
	if (!here) return region.hospital;
	let best = region.hospital;
	let bestKm = Infinity;
	for (const l of region.locations) {
		if (!l.tags.includes('hospital')) continue;
		const km = haversineKm(here.lat, here.lon, l.lat, l.lon);
		if (km < bestKm) {
			best = l.id;
			bestKm = km;
		}
	}
	return best;
}

/** 能力成长整体倍率与递减曲线：越接近满分涨得越慢 */
export const SKILL_GROWTH = { scale: 0.35, cap: 110 };

/** 能力变化的唯一入口。增长 = 原值 × 特质倍率 × scale × (1 − 当前值 / cap)；扣减不打折 */
export function growSkill(state: PlayerState, k: SkillKey, d: number) {
	const cur = state.skills[k];
	const delta = d > 0 ? d * gainMult(state, k) * SKILL_GROWTH.scale * Math.max(0, 1 - cur / SKILL_GROWTH.cap) : d;
	state.skills[k] = clamp100(cur + delta);
}

export function applyEffect(state: PlayerState, fx: Effect, region: Region) {
	if (fx.cash) state.cash = Math.max(0, Math.round(state.cash + fx.cash));
	if (fx.respect) state.respect = Math.max(0, state.respect + fx.respect);
	if (fx.heat) state.heat = clamp100(state.heat + (fx.heat > 0 ? fx.heat * heatMult(state) : fx.heat));
	if (fx.vehicle) state.vehicle = fx.vehicle;
	if (fx.skills) {
		for (const k of SKILL_KEYS) {
			const d = fx.skills[k];
			if (d) growSkill(state, k, d);
		}
	}
	if (fx.items) {
		for (const [id, d] of Object.entries(fx.items)) {
			const def = getItem(id);
			if (!def || !d) continue;
			const n = Math.max(0, Math.min(def.max, (state.inventory[id] ?? 0) + d));
			if (n) state.inventory[id] = n;
			else Reflect.deleteProperty(state.inventory, id);
		}
	}
	// 先流逝时间（会衰减需求），再结算需求增减，保证“睡 8 小时”后精力确实是满的
	if (fx.minutes) advance(state, fx.minutes, region);
	if (fx.needs) for (const k of NEED_KEYS) if (fx.needs[k]) state.needs[k] = clamp100(state.needs[k] + fx.needs[k]!);
	if (fx.health) {
		state.health = clamp100(state.health + (fx.health < 0 ? fx.health * hurtMult(state) : fx.health));
		if (state.health <= 0) collapse(state, region);
	}
}

// ---------- 出行 ----------
export interface TravelOption {
	to: string;
	mode: TravelMode;
	label: string;
	km: number;
	minutes: number;
	cost: number;
	available: boolean;
	reason?: string;
}

export function travelOptions(state: PlayerState, region: Region): TravelOption[] {
	const here = getLocation(region, state.loc);
	if (!here) return [];
	const out: TravelOption[] = [];
	for (const r of region.routes) {
		const toId = r.a === state.loc ? r.b : r.b === state.loc ? r.a : null;
		if (!toId) continue;
		const to = getLocation(region, toId);
		if (!to) continue;
		out.push(priceRoute(state, r, here, to));
	}
	return out.sort((x, y) => x.km - y.km);
}

function priceRoute(state: PlayerState, r: Route, from: GameLocation, to: GameLocation): TravelOption {
	const straight = haversineKm(from.lat, from.lon, to.lat, to.lon);
	let km = straight, minutes = 0, cost = 0, label = '', available = true;
	let reason: string | undefined;
	if (r.mode === 'air') {
		minutes = 60 + (km / 750) * 60;
		cost = 120 + km * 0.25;
		label = '✈️ 航班';
	} else if (r.mode === 'ferry') {
		minutes = 45;
		cost = 40;
		label = '⛴️ 渡轮';
	} else {
		km = straight * 1.25; // 公路绕行系数
		const v = getVehicle(state.vehicle);
		if (r.mode === 'track') {
			label = `${v?.icon ?? '🚙'} 越野土路`;
			const speed = v?.trackSpeed ?? 0;
			if (!speed) { available = false; reason = '需要能走土路的车（四驱或露营车）'; }
			minutes = (km / ((speed || 55) + state.skills.driving * 0.15)) * 60;
			cost = km * (v?.costPerKm ?? 0.22);
		} else if (!v) {
			label = '🚌 长途巴士';
			minutes = (km / 70) * 60 + 20;
			cost = 8 + km * 0.12;
		} else {
			label = `${v.icon} 自驾`;
			minutes = (km / (v.speed + state.skills.driving * 0.25)) * 60;
			cost = km * v.costPerKm;
		}
	}
	cost = Math.round(cost * costMult(state));
	if (available && state.cash < cost) { available = false; reason = '现金不足'; }
	return { to: to.id, mode: r.mode, label, km: Math.round(km), minutes: Math.round(minutes), cost, available, reason };
}

export function travel(prev: PlayerState, region: Region, toId: string, mode: TravelMode): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const opt = travelOptions(prev, region).find((o) => o.to === toId && o.mode === mode);
	if (!opt) return fail(prev, '这里到不了那里。');
	if (!opt.available) return fail(prev, opt.reason ?? '暂时无法出行。');
	const state = clone(prev);
	state.cash -= opt.cost;
	const selfDrive = (mode === 'road' || mode === 'track') && !!getVehicle(state.vehicle);
	if (selfDrive) {
		growSkill(state, 'driving', opt.km / 150);
		if (mode === 'track') growSkill(state, 'survival', opt.km / 300);
	}
	const ride = selfDrive ? getVehicle(state.vehicle)?.ride : undefined;
	if (ride) for (const k of NEED_KEYS) if (ride[k]) state.needs[k] = clamp100(state.needs[k] + ride[k]! * opt.minutes);
	if (advance(state, opt.minutes, region)) return { ok: true, state, msg: '路上体力不支晕倒了。' }; // collapse 已把人送去医院
	arrive(state, region, toId, mode);
	return { ok: true, state, msg: `抵达${getLocation(region, toId)!.name}。` };
}

function arrive(state: PlayerState, region: Region, locId: string, mode: TravelMode | 'gps') {
	const loc = getLocation(region, locId)!;
	const first = !state.visited[locId];
	state.loc = locId;
	state.visited[locId] = (state.visited[locId] ?? 0) + 1;
	log(state, first ? `第一次来到${loc.name}。${loc.blurb}` : `回到${loc.name}。`);
	if (first) state.respect += 1;
	const ev = pickArrivalEvent(state, loc, mode === 'gps' ? null : mode, first);
	if (ev) state.pending = { eventId: ev.id };
}

function eventMatches(ev: GameEvent, loc: GameLocation, mode: TravelMode | null): boolean {
	if (ev.arrivedBy && (!mode || !ev.arrivedBy.includes(mode))) return false;
	const scoped = ev.locs || ev.tags || ev.kinds;
	if (!scoped) return true;
	return !!(
		ev.locs?.includes(loc.id) ||
		ev.tags?.some((t) => loc.tags.includes(t)) ||
		ev.kinds?.includes(loc.kind)
	);
}

function pickArrivalEvent(state: PlayerState, loc: GameLocation, mode: TravelMode | null, first: boolean): GameEvent | null {
	if (state.heat >= HEAT_CHECK_AT) return EVENTS.find((e) => e.id === 'heat-check') ?? null;
	const pool = EVENTS.filter((e) => e.weight > 0 && eventMatches(e, loc, mode) && !(e.once && state.seen.includes(e.id)));
	if (!pool.length) return null;
	// 首次到访：有签名事件就必出
	const signature = pool.filter((e) => e.once);
	if (first && signature.length) return signature[Math.floor(roll(state) * signature.length)];
	if (roll(state) > ARRIVAL_EVENT_CHANCE) return null;
	let r = roll(state) * pool.reduce((s, e) => s + e.weight, 0);
	for (const e of pool) if ((r -= e.weight) <= 0) return e;
	return pool[pool.length - 1];
}

// ---------- 事件 ----------
export function getPendingEvent(state: PlayerState): GameEvent | null {
	return state.pending ? (EVENTS.find((e) => e.id === state.pending!.eventId) ?? null) : null;
}

export function resolveEvent(prev: PlayerState, region: Region, choiceIdx: number): ActionResult {
	const ev = getPendingEvent(prev);
	if (!ev) return { ok: false, state: prev.pending ? { ...prev, pending: null } : prev, msg: '没有待处理的事件。' };
	const choice = ev.choices[choiceIdx];
	if (!choice) return fail(prev, '无效的选择。');
	const state = clone(prev);
	state.pending = null;
	if (ev.once && !state.seen.includes(ev.id)) state.seen.push(ev.id);
	let outcome = choice.ok;
	if (choice.check) {
		const passed = checkScore(state, choice.check.skill).total + roll(state) * 60 >= choice.check.dc;
		if (!passed && choice.fail) outcome = choice.fail;
	}
	applyEffect(state, outcome.fx, region);
	log(state, `【${ev.title}】${outcome.text}`);
	return { ok: true, state, msg: outcome.text };
}

// ---------- 地点互动 ----------
export function activityAvailableAt(act: Activity, loc: GameLocation): boolean {
	if (!act.kinds && !act.tags) return true;
	return !!(act.kinds?.includes(loc.kind) || act.tags?.some((t) => loc.tags.includes(t)));
}

export function activitiesAt(state: PlayerState, region: Region): { act: Activity; blocked?: string }[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return ACTIVITIES.filter((a) => activityAvailableAt(a, loc)).map((act) => ({ act, blocked: blockedReason(state, act) }));
}

function blockedReason(state: PlayerState, act: Activity): string | undefined {
	if (!isOpen(act.hours, state.clock)) return `营业时间 ${hoursLabel(act.hours!)}`;
	const req = act.requires;
	if (!req) return undefined;
	if (req.cash && state.cash < req.cash) return `需要 $${req.cash}`;
	if (req.vehicle && !req.vehicle.includes(state.vehicle)) return '已拥有';
	if (req.skill) for (const k of SKILL_KEYS) if (req.skill[k] && state.skills[k] < req.skill[k]!) return `${SKILL_META[k].name}需达到 ${req.skill[k]}`;
	return undefined;
}

export function performActivity(prev: PlayerState, region: Region, activityId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const loc = getLocation(region, prev.loc);
	const act = ACTIVITIES.find((a) => a.id === activityId);
	if (!loc || !act || !activityAvailableAt(act, loc)) return fail(prev, '这里做不了这件事。');
	const blocked = blockedReason(prev, act);
	if (blocked) return fail(prev, blocked);
	const state = clone(prev);
	applyEffect(state, { ...act.fx, minutes: act.minutes }, region);
	log(state, `在${loc.name}${act.name}。`);
	return { ok: true, state, msg: `${act.icon} ${act.name}完成。` };
}

// ---------- 真实定位打卡 ----------
/**
 * 用手机真实坐标打卡：
 * - 落在某地点半径内且不是当前所在地 → 直接“抵达”（不花钱不耗时），并触发到达事件；
 * - 再检查 400m 内的 POI，首次打卡给奖励。
 */
export function gpsCheckIn(prev: PlayerState, region: Region, lat: number, lon: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail(prev, '定位无效。');
	const hit = locateInRegion(region, lat, lon);
	if (!hit) return fail(prev, '你的真实位置不在任何已开放地点附近。');
	const state = clone(prev);
	const msgs: string[] = [];
	if (hit.id !== state.loc) {
		arrive(state, region, hit.id, 'gps');
		msgs.push(`真实抵达${getLocation(region, hit.id)!.name}！`);
	}
	for (const p of region.pois) {
		if (p.loc !== hit.id || state.checkins.includes(p.id)) continue;
		if (haversineKm(lat, lon, p.lat, p.lon) > POI_RADIUS_KM) continue;
		state.checkins.push(p.id);
		state.respect += 2;
		state.needs.fun = clamp100(state.needs.fun + 15);
		log(state, `实地打卡：${p.name}。`);
		msgs.push(`打卡 ${p.name}：声望 +2`);
	}
	if (!msgs.length) return fail(prev, '你已经在这里了，附近暂无新的打卡点。');
	return { ok: true, state, msg: msgs.join(' ') };
}

// ---------- 物品 ----------
function soldAt(item: ItemDef, loc: GameLocation): boolean {
	return !!(item.shop.kinds?.includes(loc.kind) || item.shop.tags?.some((t) => loc.tags.includes(t)));
}

export interface ShopEntry {
	item: ItemDef;
	price: number;
	blocked?: string;
}

/** 当前地点可买的物品（价格已含特质折扣） */
export function shopAt(state: PlayerState, region: Region): ShopEntry[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return ITEMS.filter((i) => soldAt(i, loc)).map((item) => {
		const price = Math.round(item.price * costMult(state));
		const have = state.inventory[item.id] ?? 0;
		const blocked = have >= item.max ? '已带满' : state.cash < price ? `需要 $${price}` : undefined;
		return { item, price, blocked };
	});
}

export function buyItem(prev: PlayerState, region: Region, itemId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const entry = shopAt(prev, region).find((e) => e.item.id === itemId);
	if (!entry) return fail(prev, '这里买不到。');
	if (entry.blocked) return fail(prev, entry.blocked);
	const state = clone(prev);
	state.cash -= entry.price;
	state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
	advance(state, 5, region);
	return { ok: true, state, msg: `买了${entry.item.name}。` };
}

export function useItem(prev: PlayerState, region: Region, itemId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getItem(itemId);
	if (!def?.use) return fail(prev, '这个不能直接使用。');
	if (!prev.inventory[itemId]) return fail(prev, '背包里没有。');
	const state = clone(prev);
	applyEffect(state, { ...def.use, items: { [itemId]: -1 } }, region);
	return { ok: true, state, msg: `用了${def.name}。` };
}

// ---------- NPC 与关系 ----------
export const RELATION_TIERS = [
	{ min: -100, name: '有过节' },
	{ min: 0, name: '陌生人' },
	{ min: 10, name: '认识' },
	{ min: 30, name: '朋友' },
	{ min: 60, name: '好友' },
	{ min: 90, name: '挚友' },
];
const BOND_AT = 60;

export function relationTier(score: number): string {
	let name = RELATION_TIERS[0].name;
	for (const t of RELATION_TIERS) if (score >= t.min) name = t.name;
	return name;
}

export const getRelation = (state: PlayerState, npcId: string): Relation =>
	state.relations[npcId] ?? { score: 0, last: {}, bonded: false };

export interface NpcAvailability {
	npc: NpcDef;
	rel: Relation;
	tier: string;
	/** 每种互动不能做的原因；undefined 表示可以做 */
	blocked: Record<NpcAction, string | undefined>;
	/** 送礼时会送出的物品（背包里第一件 TA 喜欢的东西） */
	gift?: string;
}

/** 当前地点、当前时段在场的 NPC */
export function npcsAt(state: PlayerState, region: Region): NpcAvailability[] {
	void region;
	const today = dayOf(state.clock);
	return NPCS.filter((n) => n.loc === state.loc && isOpen(n.hours, state.clock)).map((npc) => {
		const rel = getRelation(state, npc.id);
		const gift = npc.likes.find((id) => state.inventory[id]);
		const used = (a: NpcAction) => (rel.last[a] === today ? '今天已经做过了' : undefined);
		return {
			npc, rel, tier: relationTier(rel.score), gift,
			blocked: {
				chat: used('chat'),
				gift: used('gift') ?? (gift ? undefined : `没有TA喜欢的东西（${npc.likes.map((id) => getItem(id)?.name).join('、')}）`),
				help: used('help') ?? (state.needs.energy < 25 ? '太累了' : undefined),
			},
		};
	});
}

/**
 * 与 NPC 互动：聊天（魅力检定决定涨多少）、送礼（消耗一件TA喜欢的物品）、帮忙（花时间体力，涨声望）。
 * 每种互动每个游戏日一次。关系第一次达到「好友」时发放该 NPC 的一次性回报。
 */
export function interactNpc(prev: PlayerState, region: Region, npcId: string, action: NpcAction): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const here = npcsAt(prev, region).find((a) => a.npc.id === npcId);
	if (!here) return fail(prev, 'TA现在不在这里。');
	const why = here.blocked[action];
	if (why) return fail(prev, why);
	const { npc } = here;
	const state = clone(prev);
	const rel: Relation = structuredClone(getRelation(state, npcId));
	let gain = 0;
	let text = '';
	if (action === 'chat') {
		const good = checkScore(state, 'charisma').total + roll(state) * 60 >= 45;
		gain = good ? 7 : 3;
		applyEffect(state, { minutes: 30, needs: { social: 18, fun: 5 }, skills: { charisma: 0.5 } }, region);
		text = good ? `和${npc.name}聊得很投机。` : `和${npc.name}寒暄了几句。`;
	} else if (action === 'gift') {
		gain = 12;
		applyEffect(state, { minutes: 10, items: { [here.gift!]: -1 }, needs: { social: 8 } }, region);
		text = `送给${npc.name}一份${getItem(here.gift!)!.name}，TA很高兴。`;
	} else {
		gain = 9;
		applyEffect(state, { minutes: 120, respect: 1, needs: { energy: -18, social: 10 }, skills: { strength: 0.5, stamina: 0.5 } }, region);
		text = `帮${npc.name}干了两小时活。`;
	}
	rel.score = Math.min(100, rel.score + gain);
	rel.last[action] = dayOf(prev.clock); // 按开始互动的那天计，跨午夜也不能当天重复
	state.relations[npcId] = rel;
	log(state, text);
	if (!rel.bonded && rel.score >= BOND_AT) {
		rel.bonded = true;
		applyEffect(state, npc.bond.fx, region);
		log(state, `【${npc.name}成了你的好友】${npc.bond.text}`);
		text += ` ${npc.name}成了你的好友！${npc.bond.text}`;
	}
	return { ok: true, state, msg: text };
}

// ---------- 职业 ----------
const matches = (w: Where, loc: GameLocation) => !!(w.kinds?.includes(loc.kind) || w.tags?.some((t) => loc.tags.includes(t)));

/** 是否满足某个职业等级的要求；不满足时返回原因 */
function unmet(state: PlayerState, lv: CareerLevel): string | undefined {
	if (lv.req?.respect && state.respect < lv.req.respect) return `声望需达到 ${lv.req.respect}`;
	for (const k of SKILL_KEYS) {
		const need = lv.req?.skills?.[k];
		if (need && state.skills[k] < need) return `${SKILL_META[k].name}需达到 ${need}`;
	}
	return undefined;
}

export interface CareerOffer {
	career: CareerDef;
	blocked?: string;
}

/** 当前地点能应聘的职业 */
export function careersAt(state: PlayerState, region: Region): CareerOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return CAREERS.filter((c) => matches(c.where, loc)).map((career) => ({
		career,
		blocked: state.job?.career === career.id && state.job.loc === loc.id ? '你已经在这里工作' : unmet(state, career.levels[0]),
	}));
}

export const getCareer = (id: string) => CAREERS.find((c) => c.id === id);

/** 当前工作能否上班；可以返回 undefined */
export function shiftBlocked(state: PlayerState): string | undefined {
	const job = state.job;
	if (!job) return '你还没有工作';
	const c = getCareer(job.career)!;
	if (state.loc !== job.loc) return '要到工作地点才能上班';
	if (job.lastDay === dayOf(state.clock)) return '今天已经上过班了';
	if (!isOpen(c.start, state.clock)) return `上班时间 ${hoursLabel(c.start)} 开始`;
	if (state.needs.energy < 20) return '太累了，先休息';
	return undefined;
}

/** 下一级的升职条件，已经是最高级时返回 null */
export function promotionStatus(state: PlayerState): { next: CareerLevel; shifts: number; good: number; blocked?: string } | null {
	const job = state.job;
	if (!job) return null;
	const c = getCareer(job.career)!;
	const next = c.levels[job.level + 1];
	if (!next) return null;
	return { next, shifts: job.shifts, good: job.good, blocked: unmet(state, next) };
}

export function applyJob(prev: PlayerState, region: Region, careerId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = careersAt(prev, region).find((o) => o.career.id === careerId);
	if (!offer) return fail(prev, '这里没有这份工作。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const old = state.job ? getCareer(state.job.career) : null;
	state.job = { career: careerId, loc: state.loc, level: 0, shifts: 0, good: 0, lastDay: -1 };
	advance(state, 30, region);
	const title = offer.career.levels[0].title;
	const place = getLocation(region, state.loc)!.name;
	const msg = `${old ? `辞去了${old.name}的工作，` : ''}被${place}的${offer.career.name}录用为${title}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function quitJob(prev: PlayerState): ActionResult {
	if (!prev.job) return fail(prev, '你还没有工作。');
	const state = clone(prev);
	const c = getCareer(state.job!.career)!;
	state.job = null;
	log(state, `辞去了${c.name}的工作。`);
	return { ok: true, state, msg: '已辞职。' };
}

/**
 * 上一个班：按能力检定表现，表现好有奖金。
 * 当前等级上满 PROMOTE_SHIFTS 班、其中 PROMOTE_GOOD 班表现好、且满足下一级要求时自动升职。
 */
export function workShift(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = shiftBlocked(prev);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const job = state.job!;
	const c = getCareer(job.career)!;
	const lv = c.levels[job.level];
	const good = checkScore(state, c.skill).total + roll(state) * 60 >= SHIFT_DC[Math.min(job.level, SHIFT_DC.length - 1)];
	const pay = Math.round(lv.pay * (good ? 1 + GOOD_BONUS : 1));
	job.lastDay = dayOf(state.clock);
	applyEffect(state, { ...c.shift, minutes: c.minutes, cash: pay }, region);
	job.shifts++;
	if (good) job.good++;
	let msg = `${lv.title}上班 ${Math.round(c.minutes / 60)} 小时，收入 $${pay}${good ? '（表现出色，有奖金）' : ''}。`;
	const next = c.levels[job.level + 1];
	if (next && job.shifts >= PROMOTE_SHIFTS && job.good >= PROMOTE_GOOD && !unmet(state, next)) {
		job.level++;
		job.shifts = 0;
		job.good = 0;
		state.respect += 3;
		msg += ` 升职为${next.title}！`;
	}
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 住房 ----------
export const getHome = (id: string) => HOMES.find((h) => h.id === id);

/** 住处家具的折现价值 */
export function furnitureValue(state: PlayerState): number {
	if (!state.home) return 0;
	return Object.values(state.home.furniture).reduce((sum, id) => sum + Math.round((getFurniture(id)?.price ?? 0) * FURNITURE_RESALE), 0);
}

/** 离开住处：家具半价折现 */
function vacate(state: PlayerState): number {
	const got = furnitureValue(state);
	state.cash += got;
	state.home = null;
	return got;
}

/**
 * 每周结算：时间每跨过一个结算日执行一次。
 * 1. 房租：付不起则被收房（家具折现）  2. 车辆保险保养：付不起则记麻烦值
 */
function weeklyTick(state: PlayerState, region: Region) {
	while (dayOf(state.clock) >= state.nextWeek) {
		state.nextWeek += 7;
		if (state.home) {
			const def = getHome(state.home.type)!;
			const place = getLocation(region, state.home.loc)?.name ?? '';
			if (state.cash >= def.rentWeek) {
				state.cash -= def.rentWeek;
				log(state, `周结算：支付${place}${def.name}房租 $${def.rentWeek}。`);
			} else {
				const got = vacate(state);
				log(state, `付不起${place}${def.name}的房租，房东收回了房子${got ? `，家具折现 $${got}` : ''}。`);
			}
		}
		const v = getVehicle(state.vehicle);
		if (v?.weekly) {
			if (state.cash >= v.weekly) {
				state.cash -= v.weekly;
				log(state, `周结算：${v.name}保险保养 $${v.weekly}。`);
			} else {
				state.heat = clamp100(state.heat + 8 * heatMult(state));
				log(state, `没钱续${v.name}的保险，无保险上路被记了一笔。`);
			}
		}
	}
}

/** 现在租房要付的首期：按到下一个结算日的天数折算（至少一天） */
export function firstRent(state: PlayerState, home: HomeDef): number {
	const days = Math.max(1, Math.min(7, state.nextWeek - dayOf(state.clock)));
	return Math.round((home.rentWeek * days) / 7);
}

export interface HomeOffer {
	home: HomeDef;
	blocked?: string;
}

export function homesAt(state: PlayerState, region: Region): HomeOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return HOMES.filter((h) => matches(h.where, loc)).map((home) => ({
		home,
		blocked: state.home?.type === home.id && state.home.loc === loc.id ? '你正住在这里' : state.cash < firstRent(state, home) ? `首期租金 $${firstRent(state, home)}` : undefined,
	}));
}

/** 租房：先付到下一个结算日的房租；之前的住处直接退掉（已付租金不退，家具半价折现） */
export function rentHome(prev: PlayerState, region: Region, homeId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = homesAt(prev, region).find((o) => o.home.id === homeId);
	if (!offer) return fail(prev, '这里租不到。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const due = firstRent(state, offer.home);
	const sold = vacate(state);
	state.cash -= due;
	state.home = { type: homeId, loc: state.loc, furniture: {} };
	advance(state, 60, region);
	const msg = `在${getLocation(region, prev.loc)!.name}租下了${offer.home.name}，首期 $${due}，之后每周 $${offer.home.rentWeek}${sold ? `；旧家具折现 $${sold}` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function leaveHome(prev: PlayerState): ActionResult {
	if (!prev.home) return fail(prev, '你没有租房。');
	const state = clone(prev);
	const got = vacate(state);
	const msg = `退掉了租的房子${got ? `，家具折现 $${got}` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 回家睡觉：免费，恢复量随住房舒适度提高 */
export function sleepHome(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.home) return fail(prev, '你没有租房。');
	if (prev.home.loc !== prev.loc) return fail(prev, '要回到住处才能睡。');
	const def = getHome(prev.home.type)!;
	const state = clone(prev);
	applyEffect(state, { minutes: 480, health: 15 + def.comfort, needs: { energy: 100, hygiene: 50 + def.comfort * 2, fun: 5 + def.comfort } }, region);
	for (const id of Object.values(state.home!.furniture)) {
		const extra = getFurniture(id)?.sleep;
		if (extra) applyEffect(state, extra, region);
	}
	log(state, `在${def.name}睡了一觉。`);
	return { ok: true, state, msg: '睡了个好觉。' };
}

// ---------- 交通工具 ----------
export const getVehicle = (id: string): VehicleDef | undefined => VEHICLES.find((v) => v.id === id);
export const resaleValue = (id: string) => {
	const v = getVehicle(id);
	return v ? Math.round(v.price * v.resale) : 0;
};

export interface DealerOffer {
	vehicle: VehicleDef;
	/** 扣除旧车折抵后要付的钱 */
	net: number;
	blocked?: string;
}

/** 车行在售车型；不在车行或不在营业时间返回空 */
export function dealerAt(state: PlayerState, region: Region): DealerOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc || !loc.tags.includes(DEALER_TAG)) return [];
	const open = isOpen(DEALER_HOURS, state.clock);
	const tradeIn = resaleValue(state.vehicle);
	return VEHICLES.map((vehicle) => {
		const net = vehicle.price - tradeIn;
		const blocked = !open ? `车行营业时间 ${hoursLabel(DEALER_HOURS)}` : state.vehicle === vehicle.id ? '你已经有这辆车' : state.cash < net ? `还差 $${net - state.cash}` : undefined;
		return { vehicle, net, blocked };
	});
}

export function buyVehicle(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = dealerAt(prev, region).find((o) => o.vehicle.id === id);
	if (!offer) return fail(prev, '这里没有车行。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const old = getVehicle(state.vehicle);
	state.cash -= offer.net;
	state.vehicle = id;
	advance(state, 60, region);
	const msg = old ? `用${old.name}折抵 $${resaleValue(old.id)}，换了一辆${offer.vehicle.name}。` : `买了一辆${offer.vehicle.name}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function sellVehicle(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const v = getVehicle(prev.vehicle);
	if (!v) return fail(prev, '你没有车。');
	if (!dealerAt(prev, region).length) return fail(prev, '要到车行才能卖车。');
	if (!isOpen(DEALER_HOURS, prev.clock)) return fail(prev, `车行营业时间 ${hoursLabel(DEALER_HOURS)}`);
	const state = clone(prev);
	const got = resaleValue(v.id);
	state.cash += got;
	state.vehicle = 'none';
	advance(state, 30, region);
	const msg = `把${v.name}卖了 $${got}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 在车里过夜（只有露营车这类 sleep 不为空的车） */
export function sleepInVehicle(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const v = getVehicle(prev.vehicle);
	if (!v?.sleep) return fail(prev, '你的车不能睡人。');
	const state = clone(prev);
	applyEffect(state, { ...v.sleep, minutes: 480 }, region);
	log(state, `在${v.name}里睡了一觉。`);
	return { ok: true, state, msg: '在车里睡了一觉。' };
}

// ---------- 课程 ----------
export const coursePrice = (state: PlayerState, c: CourseDef) => Math.round(c.base * (1 + state.skills[c.skill] / COURSE_PRICE_STEP));

export interface CourseOffer {
	course: CourseDef;
	price: number;
	blocked?: string;
}

export function coursesAt(state: PlayerState, region: Region): CourseOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	const today = dayOf(state.clock);
	return COURSES.filter((c) => matches(c.where, loc)).map((course) => {
		const price = coursePrice(state, course);
		const blocked = !isOpen(course.hours, state.clock) ? `上课时间 ${hoursLabel(course.hours)}`
			: state.courseDays[course.id] === today ? '今天已经上过这门课'
			: state.cash < price ? `需要 $${price}`
			: state.needs.energy < 15 ? '太累了' : undefined;
		return { course, price, blocked };
	});
}

export function takeCourse(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = coursesAt(prev, region).find((o) => o.course.id === id);
	if (!offer) return fail(prev, '这里没有这门课。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const c = offer.course;
	const state = clone(prev);
	const before = state.skills[c.skill];
	state.cash -= offer.price;
	state.courseDays[c.id] = dayOf(prev.clock);
	growSkill(state, c.skill, c.gain);
	applyEffect(state, { minutes: c.minutes, needs: { energy: -Math.round(c.minutes / 12), fun: 3 } }, region);
	const msg = `上了${c.name}，${SKILL_META[c.skill].name} +${(state.skills[c.skill] - before).toFixed(1)}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 体验与收藏 ----------
export interface ExperienceOffer {
	exp: ExperienceDef;
	first: boolean;
	blocked?: string;
}

export function experiencesAt(state: PlayerState, region: Region): ExperienceOffer[] {
	void region;
	return EXPERIENCES.filter((e) => e.loc === state.loc).map((exp) => ({
		exp,
		first: !state.collected.includes(exp.id),
		blocked: !isOpen(exp.hours, state.clock) ? `开放时间 ${hoursLabel(exp.hours!)}` : state.cash < exp.price ? `需要 $${exp.price}` : undefined,
	}));
}

/** 已集齐的片区称号 */
export function areaTitles(state: PlayerState): string[] {
	return Object.entries(AREAS)
		.filter(([id]) => EXPERIENCES.filter((e) => e.area === id).every((e) => state.collected.includes(e.id)))
		.map(([, a]) => a.title);
}

export function doExperience(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = experiencesAt(prev, region).find((o) => o.exp.id === id);
	if (!offer) return fail(prev, '这里没有这个项目。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const e = offer.exp;
	const state = clone(prev);
	const titlesBefore = areaTitles(state);
	state.cash -= e.price;
	if (offer.first) {
		applyEffect(state, { ...e.fx, minutes: e.minutes, respect: e.respect }, region);
		state.collected.push(e.id);
	} else {
		const fun = Math.round((e.fx.needs?.fun ?? 0) * REPEAT_FUN_SHARE);
		applyEffect(state, { minutes: e.minutes, needs: { fun } }, region);
	}
	let msg = offer.first ? `体验了${e.name}，收进了收藏册（声望 +${e.respect}）。` : `又体验了一次${e.name}。`;
	const gained = areaTitles(state).filter((t) => !titlesBefore.includes(t));
	if (gained.length) {
		state.respect += 5;
		msg += ` 集齐了「${AREAS[e.area].name}」，获得称号「${gained[0]}」！`;
	}
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 家具与在家活动 ----------
export const getFurniture = (id: string): FurnitureDef | undefined => FURNITURE.find((f) => f.id === id);

const atHome = (state: PlayerState) => !!state.home && state.home.loc === state.loc;
const homeHas = (state: PlayerState, unlock: 'cook' | 'relax') =>
	!!state.home && Object.values(state.home.furniture).some((id) => getFurniture(id)?.unlock === unlock);

export interface FurnitureOffer {
	item: FurnitureDef;
	owned: boolean;
	/** 扣掉同槽位旧家具折现后要付的钱 */
	net: number;
	blocked?: string;
}

/** 人在住处时可以给住处添置的家具 */
export function furnitureAt(state: PlayerState): FurnitureOffer[] {
	if (!atHome(state)) return [];
	return FURNITURE.map((item) => {
		const cur = state.home!.furniture[item.slot];
		const owned = cur === item.id;
		const net = item.price - (cur ? Math.round((getFurniture(cur)?.price ?? 0) * FURNITURE_RESALE) : 0);
		return { item, owned, net, blocked: owned ? '已拥有' : state.cash < net ? `需要 $${net}` : undefined };
	});
}

export function buyFurniture(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.home) return fail(prev, '先租个住处。');
	const offer = furnitureAt(prev).find((o) => o.item.id === id);
	if (!offer) return fail(prev, '要在住处才能添置家具。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const old = getFurniture(state.home!.furniture[offer.item.slot] ?? '');
	state.cash -= offer.net;
	state.home!.furniture[offer.item.slot] = id;
	advance(state, 30, region);
	const msg = `给住处添了${offer.item.name}${old ? `（旧的${old.name}折了半价）` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function sellFurniture(prev: PlayerState, slot: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!atHome(prev)) return fail(prev, '要在住处才能处理家具。');
	const item = getFurniture(prev.home!.furniture[slot] ?? '');
	if (!item || !FURNITURE_SLOTS[slot]) return fail(prev, '这个位置没有家具。');
	const state = clone(prev);
	const got = Math.round(item.price * FURNITURE_RESALE);
	state.cash += got;
	Reflect.deleteProperty(state.home!.furniture, slot);
	const msg = `把${item.name}卖了 $${got}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 在家做饭 / 放松不能做的原因 */
export function homeActionBlocked(state: PlayerState, op: 'cook' | 'relax'): string | undefined {
	if (!atHome(state)) return '要在住处';
	if (!homeHas(state, op)) return op === 'cook' ? '需要炊具' : '需要娱乐设备';
	if (op === 'cook' && state.cash < HOME_COOK.cost) return `需要 $${HOME_COOK.cost}`;
	return undefined;
}

export function cookAtHome(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = homeActionBlocked(prev, 'cook');
	if (why) return fail(prev, why);
	const state = clone(prev);
	applyEffect(state, { cash: -HOME_COOK.cost, minutes: HOME_COOK.minutes, needs: { hunger: HOME_COOK.hunger, fun: 3 } }, region);
	log(state, '在家做了顿饭。');
	return { ok: true, state, msg: '🍳 在家吃了顿饭。' };
}

export function relaxAtHome(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = homeActionBlocked(prev, 'relax');
	if (why) return fail(prev, why);
	const state = clone(prev);
	applyEffect(state, { minutes: HOME_RELAX.minutes, needs: { fun: HOME_RELAX.fun, energy: 3 } }, region);
	log(state, '在家放松了一会儿。');
	return { ok: true, state, msg: '🎵 在家放松了一会儿。' };
}
