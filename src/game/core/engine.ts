// 游戏规则引擎：纯函数、确定性（随机数来自存档里的 seed），前后端与测试共用。
// 所有动作返回新的 PlayerState，不修改入参。
import { unit, weatherAt, weatherOn } from './weather.ts';
import { ANIMALS, DEX_GROUPS, type AnimalDef } from '../data/wildlife.ts';
import { FISH, FISHING, type FishDef } from '../data/fish.ts';
import { FACTS, type PlaceFact } from '../data/facts.ts';
import { NPC_DUOS, type NpcDuo } from '../data/npc-duos.ts';
import { PHOTO_CHAIN_BONUS, PHOTO_MINUTES, PHOTO_QUESTS, type PhotoQuest } from '../data/photo-quests.ts';
import { ACTIVITIES } from '../data/activities.ts';
import { EVENTS } from '../data/events.ts';
import { ITEMS } from '../data/items.ts';
import { NPCS } from '../data/npcs.ts';
import { CAREERS, GOOD_BONUS, PROMOTE_GOOD, PROMOTE_SHIFTS, SHIFT_DC } from '../data/careers.ts';
import { BOND_WEEKS, HOMES } from '../data/housing.ts';
import { areaOf } from '../data/areas-base.ts';
import { PROPERTIES } from '../data/properties.ts';
import { downPayment, FINANCE, loanPayment, propertyEquity, repairRange, saleProceeds, vehicleDuty, weeklyInterest, weeklyPrincipal } from './finance.ts';
import { FURNITURE, FURNITURE_RESALE, FURNITURE_SLOTS, HOME_COOK, HOME_RELAX } from '../data/furniture.ts';
import { BREAKDOWN, CAR_KM_MAX, DEALER_HOURS, DEALER_TAG, DEPRECIATION, GARAGE, SERVICE_KM, VEHICLES } from '../data/vehicles.ts';
import { COURSE_PRICE_STEP, COURSES } from '../data/courses.ts';
import { CERTS } from '../data/certs.ts';
import { AREAS, EXPERIENCES, REPEAT_FUN_SHARE } from '../data/experiences.ts';
import { dateOf, dayOf, hourOf, hoursLabel, inSpan, isOpen, period, weekdayOf } from './time.ts';
import { FESTIVALS } from '../data/festivals.ts';
import { MOODLET_MAX, MOODLETS } from '../data/moodlets.ts';
import { checkScore, costMult, decayMult, gainMult, getItem, heatMult, homeComfort, hurtMult } from './attributes.ts';
import { CAPS, clamp100, JOURNAL_MAX, SKILL_META } from './character.ts';
import { haversineKm, locateInRegion, POI_RADIUS_KM } from './geo.ts';
import { efficiency, moodletGainMult } from './formulas.ts';
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type {
	ActionResult, Activity, CareerDef, CareerLevel, CertDef, Effect, GameEvent, GiftReaction, Hours, GameLocation, HomeDef, ItemDef, NpcAction, SkillKey, VehicleDef, CourseDef, ExperienceDef, FestivalDef, FurnitureDef, OwnedProperty, PropertyDef, NpcDef, PlayerState, Region, Relation, Route, TravelMode, Where,
} from './types.ts';

// ---------- 调参常量 ----------
/** 每游戏分钟的需求衰减 */
export const DECAY: Record<string, number> = { hunger: 0.07, energy: 0.05, hygiene: 0.035, fun: 0.04, social: 0.03 };
const STARVE_DMG = 0.02; // 饱食或精力见底时每分钟掉血
const ARRIVAL_EVENT_CHANCE = 0.55;
const HEAT_CHECK_AT = 60;

// ---------- 随机数（mulberry32，状态存于 state.seed） ----------
export function roll(state: PlayerState): number {
	let t = (state.seed = (state.seed + 0x6d2b79f5) >>> 0);
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const clone = (s: PlayerState): PlayerState => structuredClone(s);
export const fail = (state: PlayerState, msg: string): ActionResult => ({ ok: false, state, msg });

export function log(state: PlayerState, text: string) {
	state.journal.push({ t: state.clock, text });
	if (state.journal.length > JOURNAL_MAX) state.journal.splice(0, state.journal.length - JOURNAL_MAX);
}

export function getLocation(region: Region, id: string): GameLocation | undefined {
	return region.locations.find((l) => l.id === id);
}

// ---------- 时间与效果 ----------
/** 返回 true 表示途中晕倒（已被送往医院） */
/**
 * 时间流逝：需求衰减、饥饿伤害，再做跨周结算。返回途中是否晕倒。
 * gains 是本动作的收获（工资等）：没晕倒才入账，而且在跨周结算之前，所以这一班的工资能付刚到期的房租房贷。
 */
function advance(state: PlayerState, minutes: number, region: Region, gains?: () => void): boolean {
	if (minutes <= 0) {
		gains?.();
		return false;
	}
	state.clock = Math.min(CAPS.clock, state.clock + minutes); // 上限只有损坏的存档会碰到；在这里钳住，后面的日志、状态到期时间都用钳过的时间
	for (const k of NEED_KEYS) state.needs[k] = clamp100(state.needs[k] - DECAY[k] * decayMult(state, k) * minutes);
	if (state.needs.hunger <= 0 || state.needs.energy <= 0) {
		state.health = clamp100(state.health - STARVE_DMG * minutes);
	}
	const collapsed = state.health <= 0;
	if (!collapsed) gains?.();
	weeklyTick(state, region);
	if (!collapsed) return false;
	collapse(state, region);
	return true;
}

/** 事件选项显示给玩家的文字：要先付钱的选项一律带金额（文案里已经写了就不重复） */
export function choiceLabel(c: { label: string; cost?: number }): string {
	return c.cost && !c.label.includes(`$${c.cost}`) ? `${c.label}（$${c.cost}）` : c.label;
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
	state.clock = Math.min(CAPS.clock, state.clock + 12 * 60);
	addMoodlet(state, 'collapsed'); // 出院时才开始计时，醒来时剩满 48 小时
	log(state, `你晕倒了，在${getLocation(region, state.loc)?.name ?? ''}的医院醒来，医药费 $${bill}。`);
	// 住院又过了 12 小时：跨过结算日的话也要结算，不然醒来能抢在结算前卖房、退租。放在这里，饿晕和受伤致晕两条路都覆盖
	weeklyTick(state, region);
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
	const delta = d > 0 ? d * gainMult(state, k) * moodletGainMult(state) * SKILL_GROWTH.scale * Math.max(0, 1 - cur / SKILL_GROWTH.cap) : d;
	state.skills[k] = clamp100(cur + delta);
}

/**
 * 结算一份效果，返回途中是否晕倒（晕倒后原动作到此为止，调用方要停止后续结算）。
 * 付出在前、收获在后：花的钱和用掉的物品先扣，收入等时间走完才到账，晕倒就拿不到；
 * 能力成长仍在时间流逝前结算（学到的就是学到的）。
 */
export function applyEffect(state: PlayerState, fx: Effect, region: Region): boolean {
	// 付出在前
	if (fx.cash && fx.cash < 0) state.cash = Math.max(0, Math.round(state.cash + fx.cash));
	if (fx.respect && fx.respect < 0) state.respect = Math.max(0, state.respect + fx.respect);
	if (fx.heat && fx.heat > 0) state.heat = clamp100(state.heat + fx.heat * heatMult(state));
	addItems(state, fx.items, -1);
	if (fx.skills) {
		for (const k of SKILL_KEYS) {
			const d = fx.skills[k];
			if (d) growSkill(state, k, d);
		}
	}
	// 收获在后：时间走完、没晕倒才拿到
	const gains = () => {
		if (fx.cash && fx.cash > 0) state.cash = Math.round(state.cash + fx.cash);
		if (fx.respect && fx.respect > 0) state.respect += fx.respect;
		if (fx.heat && fx.heat < 0) state.heat = clamp100(state.heat + fx.heat);
		if (fx.vehicle) state.vehicle = fx.vehicle;
		addItems(state, fx.items, 1);
	};
	// 先流逝时间（会衰减需求），再结算需求增减，保证“睡 8 小时”后精力确实是满的
	// 途中晕倒：原动作到此为止，收获、需求、状态、健康都不再结算（不然露营晕倒还会拿到「星空下醒来」）
	if (advance(state, fx.minutes ?? 0, region, gains)) return true;
	if (fx.needs) for (const k of NEED_KEYS) if (fx.needs[k]) state.needs[k] = clamp100(state.needs[k] + fx.needs[k]!);
	if (fx.moodlet) addMoodlet(state, fx.moodlet);
	if (fx.health) {
		if (fx.health <= -5) addMoodlet(state, 'hurt');
		state.health = clamp100(state.health + (fx.health < 0 ? fx.health * hurtMult(state) : fx.health));
		if (state.health <= 0) {
			collapse(state, region);
			return true;
		}
	}
	return false;
}

/** 按符号增减物品：sign = -1 只处理用掉的，1 只处理得到的 */
function addItems(state: PlayerState, items: Effect['items'], sign: 1 | -1) {
	if (!items) return;
	for (const [id, d] of Object.entries(items)) {
		const def = getItem(id);
		if (!def || !d || Math.sign(d) !== sign) continue;
		const n = Math.max(0, Math.min(def.max, (state.inventory[id] ?? 0) + d));
		if (n) state.inventory[id] = n;
		else Reflect.deleteProperty(state.inventory, id);
	}
}

/** 动作途中晕倒时的统一结果 */
export function collapsedResult(state: PlayerState): ActionResult {
	return { ok: true, state, msg: '😵 体力耗尽，你晕倒了，在医院醒来。', collapsed: true };
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
	// 第 26 批（待平衡）：出发地当天的天气影响陆路耗时，风暴天土路封闭、渡轮停航
	const wx = weatherOn(from.id, dayOf(state.clock));
	if (r.mode === 'air') {
		minutes = 60 + (km / 750) * 60;
		cost = 120 + km * 0.25;
		label = '✈️ 航班';
	} else if (r.mode === 'ferry') {
		minutes = 45;
		cost = 40;
		label = '⛴️ 渡轮';
		if (wx.closesSea) { available = false; reason = `今天${wx.name}，渡轮停航`; }
	} else {
		km = straight * 1.25; // 公路绕行系数
		const v = getVehicle(state.vehicle);
		if (r.mode === 'track') {
			label = `${v?.icon ?? '🚙'} 越野土路`;
			const speed = v?.trackSpeed ?? 0;
			if (!speed) { available = false; reason = '需要能走土路的车（四驱或露营车）'; }
			else if (wx.road?.trackClosed) { available = false; reason = `今天${wx.name}，土路封闭`; }
			minutes = (km / ((speed || 55) + state.skills.driving * 0.15)) * 60 * (wx.road?.trackMult ?? 1);
			cost = km * (v?.costPerKm ?? 0.22);
		} else if (!v) {
			label = '🚌 长途巴士';
			minutes = (km / 70) * 60 * (wx.road?.mult ?? 1) + 20;
			cost = 8 + km * 0.12;
		} else {
			label = `${v.icon} 自驾`;
			minutes = (km / (v.speed + state.skills.driving * 0.25)) * 60 * (wx.road?.mult ?? 1);
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
	if (advance(state, opt.minutes, region)) return collapsedResult(state); // collapse 已把人送去医院，没到达
	if (selfDrive) state.car = { km: Math.min(CAR_KM_MAX, state.car.km + opt.km), since: Math.min(CAR_KM_MAX, state.car.since + opt.km) };
	// 该保养的车按几率抛锚。事件先后：盘查 → 首次到访的签名事件 → 抛锚 → 普通到达事件，所以标的几率就是实际几率（被盘查、首次到访有签名事件时除外）；
	// 没超保养里程、或这趟反正要被盘查时不掷骰，不影响别的随机结果
	let breakdown: GameEvent | null = null;
	const chance = selfDrive && state.heat < HEAT_CHECK_AT ? breakdownChance(state) : 0;
	if (chance > 0 && roll(state) < chance) {
		const pool = EVENTS.filter((e) => e.breakdown);
		if (pool.length) breakdown = pool[Math.floor(roll(state) * pool.length)];
	}
	arrive(state, region, toId, mode, breakdown);
	return { ok: true, state, msg: `抵达${getLocation(region, toId)!.name}。` };
}

/** override：这趟已经定好的事件（抛锚）。先后：盘查 → 首次到访的签名事件 → override → 普通到达事件 */
function arrive(state: PlayerState, region: Region, locId: string, mode: TravelMode | 'gps', override: GameEvent | null = null) {
	const loc = getLocation(region, locId)!;
	const first = !state.visited[locId];
	state.loc = locId;
	state.visited[locId] = (state.visited[locId] ?? 0) + 1;
	log(state, first ? `第一次来到${loc.name}。${loc.blurb}` : `回到${loc.name}。`);
	// 天气相册：这个地点在这种天气下的照片还没有，就收一张
	const w = weatherOn(locId, dayOf(state.clock));
	const photo = `${locId}|${w.id}`;
	if (!state.photos.includes(photo)) {
		state.photos.push(photo);
		log(state, `相册里多了一张${loc.name}的${w.icon}${w.name}。`);
	}
	if (first) {
		state.respect += 1;
		addMoodlet(state, 'first-visit');
	}
	const fest = festivalsNow(state.clock).find((f) => f.loc === locId);
	// 节日气氛还在身上时再进城不重复加娱乐，免得来回进出刷
	if (fest && !state.moodlets.some((m) => m.id === 'festival' && m.until > state.clock)) state.needs.fun = clamp100(state.needs.fun + 10);
	if (fest) {
		addMoodlet(state, 'festival');
		log(state, `正赶上${fest.name}：${fest.desc}`);
	}
	const ev = pickArrivalEvent(state, loc, mode === 'gps' ? null : mode, first, override);
	if (ev) {
		state.pending = { eventId: ev.id };
		if (ev.id === 'heat-check') addMoodlet(state, 'in-trouble');
		if (ev.animal) recordAnimal(state, ev.animal);
	}
	const seen = spotAnimal(state, loc);
	if (seen) recordAnimal(state, seen.id, `在${loc.name}看见了${seen.icon}${seen.name}：${seen.desc}`);
}

// ---------- 地点小知识 ----------
/** 某地点的小知识卡：第 n 次到访解锁第 n 条（不存档，按到访次数现算） */
export function placeFacts(state: PlayerState, locId: string): { fact: PlaceFact; unlocked: boolean }[] {
	const n = state.visited[locId] ?? 0;
	return (FACTS[locId] ?? []).map((fact, i) => ({ fact, unlocked: i < n }));
}

// ---------- 摄影任务链 ----------
/** 当前的摄影任务；全部拍完返回 null。blocked：此刻在这里拍不了的原因 */
export function photoQuestNow(state: PlayerState, region: Region): { quest: PhotoQuest; index: number; blocked?: string } | null {
	const quest = PHOTO_QUESTS[state.photoQuest];
	if (!quest) return null;
	const where = getLocation(region, quest.loc)?.name ?? quest.loc;
	const p = period(state.clock);
	const w = weatherAt(state);
	const blocked = state.loc !== quest.loc ? `要去${where}`
		: quest.seasons && !quest.seasons.includes(dateOf(state.clock).season) ? '季节不对'
		: quest.periods && !quest.periods.includes(p.id) ? `现在是${p.name}，时段不对`
		: quest.weather && !quest.weather.includes(w.id) ? `今天${w.name}，天气不对，改天再来`
		: undefined;
	return { quest, index: state.photoQuest, blocked };
}

export function takeQuestPhoto(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const now = photoQuestNow(prev, region);
	if (!now) return fail(prev, '摄影任务都拍完了。');
	if (now.blocked) return fail(prev, now.blocked + '。');
	const state = clone(prev);
	const q = now.quest;
	const last = now.index + 1 >= PHOTO_QUESTS.length;
	// 奖励走 applyEffect 的收获：没晕倒才到账，而且在跨周结算之前，能付刚到期的房租
	if (applyEffect(state, { minutes: PHOTO_MINUTES, needs: { fun: 8 }, cash: q.cash, respect: q.respect + (last ? PHOTO_CHAIN_BONUS : 0) }, region)) return collapsedResult(state);
	state.photoQuest += 1;
	let msg = `拍下了「${q.title}」，杂志买了这张照片：$${q.cash}，声望 +${q.respect}。`;
	if (last) msg += ` 摄影任务全部完成！额外声望 +${PHOTO_CHAIN_BONUS}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 钓鱼 ----------
const fishHere = (f: FishDef, loc: GameLocation) => !!(f.where.locs?.includes(loc.id) || f.where.kinds?.includes(loc.kind) || f.where.tags?.some((t) => loc.tags.includes(t)));

/** 这个地方此刻能钓到的鱼；一种都没有就是不能钓鱼的地方（返回 null） */
export function fishingAt(state: PlayerState, region: Region): { fish: FishDef[]; blocked?: string } | null {
	const loc = getLocation(region, state.loc);
	if (!loc || !FISH.some((f) => fishHere(f, loc))) return null;
	const season = dateOf(state.clock).season;
	const p = period(state.clock).id;
	const w = weatherAt(state);
	const fish = FISH.filter((f) => fishHere(f, loc) && (!f.seasons || f.seasons.includes(season)) && (!f.periods || f.periods.includes(p)) && (!f.weather || f.weather.includes(w.id)));
	const blocked = !state.inventory[FISHING.rod] ? '要先买一根鱼竿' : w.closesSea ? '风暴天浪太大，钓不了' : !fish.length ? '这个时候这里钓不到鱼' : undefined;
	return { fish, blocked };
}

/** 钓一次鱼：花时间和体力；按生存能力决定空手几率，钓到的当场卖给鱼铺 */
export function goFishing(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const spot = fishingAt(prev, region);
	if (!spot) return fail(prev, '这里没有能钓鱼的水。');
	if (spot.blocked) return fail(prev, spot.blocked + '。');
	const state = clone(prev);
	const empty = Math.max(FISHING.emptyMin, FISHING.emptyBase - checkScore(state, 'survival').total * FISHING.emptyPerSkill);
	let r = roll(state) * (empty + spot.fish.reduce((s, f) => s + f.weight, 0)) - empty;
	const caught = r < 0 ? undefined : spot.fish.find((f) => (r -= f.weight) < 0) ?? spot.fish[spot.fish.length - 1];
	// 鱼款走 applyEffect 的收获：没晕倒才到账，而且在跨周结算之前，能付刚到期的房租
	if (applyEffect(state, { minutes: FISHING.minutes, needs: FISHING.needs, skills: { survival: 0.5 }, cash: caught?.price }, region)) return collapsedResult(state);
	if (!caught) {
		log(state, '钓了一个半小时，一条也没上钩。');
		return { ok: true, state, msg: '一条也没钓到，不过吹了吹风。' };
	}
	const isNew = !state.fish[caught.id];
	state.fish[caught.id] = (state.fish[caught.id] ?? 0) + 1;
	const msg = `钓到一条${caught.icon}${caught.name}${isNew ? '（新鱼种！）' : ''}，卖给鱼铺得 $${caught.price}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 野生动物图鉴 ----------
/** 此刻在这个地方可能看见的动物（还没见过的） */
export function animalsAt(state: PlayerState, loc: GameLocation): AnimalDef[] {
	const season = dateOf(state.clock).season;
	const p = period(state.clock).id;
	return ANIMALS.filter((a) => !state.dex.includes(a.id)
		&& (a.where.locs?.includes(loc.id) || matches(a.where, loc))
		&& (!a.seasons || a.seasons.includes(season))
		&& (!a.periods || a.periods.includes(p)));
}

/** 抵达时看见哪只新动物（最多一只）。只读种子做哈希、不推进它，所以不影响其他随机结果 */
function spotAnimal(state: PlayerState, loc: GameLocation): AnimalDef | undefined {
	return animalsAt(state, loc).find((a) => unit(`${state.seed}|${state.clock}|${loc.id}|${a.id}`) < a.chance);
}

function recordAnimal(state: PlayerState, id: string, text?: string) {
	const a = ANIMALS.find((x) => x.id === id);
	if (!a || state.dex.includes(id)) return;
	state.dex.push(id);
	log(state, text ?? `图鉴里记下了${a.icon}${a.name}。`);
	for (const [g, def] of Object.entries(DEX_GROUPS)) {
		if (state.dexSets.includes(g)) continue;
		const all = ANIMALS.filter((x) => x.group === g);
		if (all.length && all.every((x) => state.dex.includes(x.id))) {
			state.dexSets.push(g);
			state.respect += def.respect;
			log(state, `${def.name}动物全部见过了！声望 +${def.respect}。`);
		}
	}
}

/** 图鉴进度：每组见过几只、一共几只 */
export function dexProgress(state: PlayerState): { group: string; name: string; got: number; total: number; done: boolean }[] {
	return Object.entries(DEX_GROUPS).map(([g, def]) => {
		const all = ANIMALS.filter((x) => x.group === g);
		const got = all.filter((x) => state.dex.includes(x.id)).length;
		return { group: g, name: def.name, got, total: all.length, done: state.dexSets.includes(g) };
	});
}

export function eventMatches(ev: GameEvent, loc: GameLocation, mode: TravelMode | null, clock: number): boolean {
	if (ev.venueTypes) return false; // 真实地点事件只由 pickVenueEvent 抽
	if (ev.seasons && !ev.seasons.includes(dateOf(clock).season)) return false;
	if (ev.weather && !ev.weather.includes(weatherOn(loc.id, dayOf(clock)).id)) return false;
	if (ev.periods && !ev.periods.includes(period(clock).id)) return false;
	if (ev.hours && !isOpen(ev.hours, clock)) return false;
	if (ev.arrivedBy && (!mode || !ev.arrivedBy.includes(mode))) return false;
	const scoped = ev.locs || ev.tags || ev.kinds;
	if (!scoped) return true;
	return !!(
		ev.locs?.includes(loc.id) ||
		ev.tags?.some((t) => loc.tags.includes(t)) ||
		ev.kinds?.includes(loc.kind)
	);
}

function pickArrivalEvent(state: PlayerState, loc: GameLocation, mode: TravelMode | null, first: boolean, override: GameEvent | null = null): GameEvent | null {
	if (state.heat >= HEAT_CHECK_AT) return EVENTS.find((e) => e.id === 'heat-check') ?? null;
	const pool = EVENTS.filter((e) => e.weight > 0 && eventMatches(e, loc, mode, state.clock) && !(e.once && state.seen.includes(e.id)));
	// 首次到访：有签名事件就必出（这趟的抛锚让给它）
	const signature = pool.filter((e) => e.once);
	if (first && signature.length) return signature[Math.floor(roll(state) * signature.length)];
	if (override) return override;
	if (!pool.length) return null;
	if (roll(state) > ARRIVAL_EVENT_CHANCE) return null;
	let r = roll(state) * pool.reduce((s, e) => s + e.weight, 0);
	for (const e of pool) if ((r -= e.weight) <= 0) return e;
	return pool[pool.length - 1];
}

/**
 * 在真实地点做完一件事后，按地点类型抽一个事件（用存档里的种子，结果可复现）。
 * 概率和现实时间间隔见 FIX_RULES；返回 null 表示这次没遇到。
 */
export function pickVenueEvent(state: PlayerState, venueType: string, chance: number): GameEvent | null {
	const pool = EVENTS.filter((e) => e.weight > 0 && e.venueTypes?.includes(venueType)
		&& (!e.seasons || e.seasons.includes(dateOf(state.clock).season))
		&& !(e.once && state.seen.includes(e.id)));
	if (!pool.length || roll(state) > chance) return null;
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
	if (choice.exposed === 'sea' && weatherAt(prev).closesSea) return fail(prev, '今天有风暴，下不了海。换个选项吧。');
	if (choice.cost && prev.cash < choice.cost) return fail(prev, `需要 $${choice.cost}，钱不够。换个选项吧。`);
	const state = clone(prev);
	state.pending = null;
	if (choice.cost) state.cash -= choice.cost;
	if (ev.once && !state.seen.includes(ev.id)) state.seen.push(ev.id);
	let outcome = choice.ok;
	if (choice.check) {
		const passed = checkScore(state, choice.check.skill).total + roll(state) * 60 >= choice.check.dc;
		if (!passed && choice.fail) outcome = choice.fail;
	}
	if (applyEffect(state, outcome.fx, region)) return collapsedResult(state);
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
	const today = weatherAt(state).id;
	return ACTIVITIES.filter((a) => activityAvailableAt(a, loc) && (!a.weather || a.weather.includes(today))).map((act) => ({ act, blocked: blockedReason(state, act) }));
}

function blockedReason(state: PlayerState, act: Activity): string | undefined {
	if (!isOpen(act.hours, state.clock)) return `营业时间 ${hoursLabel(act.hours!)}`;
	if (act.exposed === 'sea' && weatherAt(state).closesSea) return '今天有风暴，海上的活动取消了';
	const req = act.requires;
	if (!req) return undefined;
	if (req.cash && state.cash < req.cash) return `需要 $${req.cash}`;
	if (req.vehicle && !req.vehicle.includes(state.vehicle)) return '已拥有';
	if (req.skill) for (const k of SKILL_KEYS) if (req.skill[k] && state.skills[k] < req.skill[k]!) return `${SKILL_META[k].name}需达到 ${req.skill[k]}`;
	return undefined;
}

/** 训练类活动的能力成长乘状态系数（和真实地点一致）；只作用于这些活动，不改全局 growSkill */
const CONDITION_SCALED = new Set(['gym', 'swim']);
function scaledFx(state: PlayerState, act: Activity): Effect {
	if (!CONDITION_SCALED.has(act.id) || !act.fx.skills) return act.fx;
	const k = efficiency(state).total;
	const skills: Partial<Record<SkillKey, number>> = {};
	for (const [key, v] of Object.entries(act.fx.skills)) skills[key as SkillKey] = Math.round(v! * k * 100) / 100;
	return { ...act.fx, skills };
}

export function performActivity(prev: PlayerState, region: Region, activityId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const loc = getLocation(region, prev.loc);
	const act = ACTIVITIES.find((a) => a.id === activityId);
	if (!loc || !act || !activityAvailableAt(act, loc)) return fail(prev, '这里做不了这件事。');
	if (act.weather && !act.weather.includes(weatherAt(prev).id)) return fail(prev, '今天的天气做不了这件事。');
	const blocked = blockedReason(prev, act);
	if (blocked) return fail(prev, blocked);
	const state = clone(prev);
	if (applyEffect(state, { ...scaledFx(prev, act), minutes: act.minutes }, region)) return collapsedResult(state);
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
	if (advance(state, 5, region)) return collapsedResult(state);
	return { ok: true, state, msg: `买了${entry.item.name}。` };
}

export function useItem(prev: PlayerState, region: Region, itemId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getItem(itemId);
	if (!def?.use) return fail(prev, '这个不能直接使用。');
	if (!prev.inventory[itemId]) return fail(prev, '背包里没有。');
	const state = clone(prev);
	if (applyEffect(state, { ...def.use, items: { [itemId]: -1 } }, region)) return collapsedResult(state);
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

export function relationTier(score: number): string {
	let name = RELATION_TIERS[0].name;
	for (const t of RELATION_TIERS) if (score >= t.min) name = t.name;
	return name;
}

export const getRelation = (state: PlayerState, npcId: string): Relation =>
	state.relations[npcId] ?? { score: 0, last: {}, seen: [], known: [] };

/** 送礼时关系的变化 */
export const GIFT_GAIN: Record<GiftReaction, number> = { love: 15, like: 9, neutral: 3, dislike: -8 };
export const GIFT_LABEL: Record<GiftReaction, string> = { love: '最爱', like: '喜欢', neutral: '一般', dislike: '讨厌' };

export function giftReaction(npc: NpcDef, itemId: string): GiftReaction {
	if (npc.gifts.love.includes(itemId)) return 'love';
	if (npc.gifts.like.includes(itemId)) return 'like';
	if (npc.gifts.dislike.includes(itemId)) return 'dislike';
	return 'neutral';
}

export interface NpcPlan {
	loc: string;
	hours: Hours;
	note?: string;
}

/** NPC 某天的安排：日程里第一条满足今天条件的，否则常驻地点和作息 */
export function npcPlan(npc: NpcDef, clock: number): NpcPlan {
	const wd = weekdayOf(clock);
	const season = dateOf(clock).season;
	for (const slot of npc.schedule ?? []) {
		if (slot.weekdays && !slot.weekdays.includes(wd)) continue;
		if (slot.seasons && !slot.seasons.includes(season)) continue;
		if (slot.festival && !festivalActive(slot.festival, clock)) continue;
		return { loc: slot.loc, hours: slot.hours, note: slot.note };
	}
	return { loc: npc.loc, hours: npc.hours };
}

/** 跨午夜的作息（如 20:00–6:00）在凌晨时算前一天的安排 */
/** NPC 此刻适用的安排：凌晨时沿用前一天跨午夜的作息（和「在不在场」的判断一致，界面也用它） */
export function planNow(npc: NpcDef, clock: number): NpcPlan {
	// 只有凌晨还在昨天那个跨午夜班次里（早于它的收工时间）时才沿用昨天；否则就是今天的安排
	const yesterday = npcPlan(npc, clock - 1440);
	const [yo, yc] = yesterday.hours;
	if (yo >= yc && hourOf(clock) < yc) return yesterday;
	return npcPlan(npc, clock);
}

/** NPC 此刻相对当前安排的状态：在那里 / 还没到时间 / 今天已经走了 */
export function npcStatus(npc: NpcDef, clock: number): { plan: NpcPlan; state: 'there' | 'before' | 'after' } {
	const plan = planNow(npc, clock);
	if (isOpen(plan.hours, clock)) return { plan, state: 'there' };
	const [open, close] = plan.hours;
	const h = hourOf(clock);
	// 不跨午夜的作息：开工前算「还没到」，收工后算「已经走了」；跨午夜的作息此刻不在就是还没到
	return { plan, state: open < close && h >= close ? 'after' : 'before' };
}

/** NPC 此刻是否在某地点 */
export function npcPresent(npc: NpcDef, loc: string, clock: number): boolean {
	const p = planNow(npc, clock);
	return p.loc === loc && isOpen(p.hours, clock);
}

/** 专属互动不能做的原因；undefined 表示可以做。没有专属互动的 NPC 返回 null */
function perkBlocked(npc: NpcDef, rel: Relation, today: number, stormy: boolean): string | null | undefined {
	if (!npc.perk) return null;
	if (rel.score < npc.perk.at) return `关系达到「${relationTier(npc.perk.at)}」后解锁`;
	if (npc.perk.exposed === 'sea' && stormy) return '今天有风暴，出不了海';
	const last = rel.last.perk;
	if (last !== undefined && today - last < npc.perk.every) return `${npc.perk.every - (today - last)} 天后可以再来`;
	return undefined;
}

export interface NpcAvailability {
	npc: NpcDef;
	rel: Relation;
	tier: string;
	/** 每种互动不能做的原因；undefined 表示可以做。没有专属互动的 NPC 没有 perk 键 */
	blocked: Partial<Record<NpcAction, string | undefined>> & Record<'chat' | 'gift' | 'help', string | undefined>;
	/** 不指定物品时会送出的东西：背包里 TA 反应最好的（不会自动送讨厌的） */
	gift?: string;
	/** 下一段剧情的门槛 */
	nextStory?: number;
}

/** 不指定物品时挑哪件：最爱 > 喜欢 > 一般，讨厌的不挑；随身装备（睡袋、冲浪板……）不会被自动送出，要送得明确指定 */
function pickGift(state: PlayerState, npc: NpcDef): string | undefined {
	const owned = ITEMS.filter((i) => state.inventory[i.id] && !i.passive).map((i) => i.id);
	for (const r of ['love', 'like', 'neutral'] as const) {
		const hit = owned.find((id) => giftReaction(npc, id) === r);
		if (hit) return hit;
	}
	return undefined;
}

/** 当前地点、当前时段在场的 NPC */
export function npcsAt(state: PlayerState, region: Region): NpcAvailability[] {
	void region;
	const today = dayOf(state.clock);
	return NPCS.filter((n) => npcPresent(n, state.loc, state.clock)).map((npc) => {
		const rel = getRelation(state, npc.id);
		const gift = pickGift(state, npc);
		const used = (a: NpcAction) => (rel.last[a] === today ? '今天已经做过了' : undefined);
		const anyItem = Object.values(state.inventory).some((n) => n > 0);
		const blocked: NpcAvailability['blocked'] = {
			chat: used('chat'),
			gift: used('gift') ?? (anyItem ? undefined : '背包里没有能送的东西'),
			help: used('help') ?? (state.needs.energy < 25 ? '太累了' : undefined),
		};
		const perk = perkBlocked(npc, rel, today, !!weatherAt(state).closesSea);
		if (perk !== null) blocked.perk = perk;
		const nextStory = npc.stories.find((st) => !rel.seen.includes(st.at))?.at;
		return { npc, rel, tier: relationTier(rel.score), gift, blocked, nextStory };
	});
}

/** 关系变化后，触发所有新达到门槛的剧情（可能一次跨过好几档）。原地修改 */
function unlockStories(state: PlayerState, region: Region, npc: NpcDef, rel: Relation): string[] {
	const out: string[] = [];
	for (const st of npc.stories) {
		if (rel.score < st.at || rel.seen.includes(st.at)) continue;
		rel.seen.push(st.at);
		if (st.fx) applyEffect(state, st.fx, region);
		log(state, `【${npc.name} · ${st.title}】${st.text}`);
		out.push(`【${st.title}】${st.text}`);
	}
	rel.seen.sort((a, b) => a - b);
	return out;
}

/** 和这位 NPC 有关、两人好感都已够格、还没触发的联动剧情 */
export function duosReady(state: PlayerState, npcId: string): NpcDuo[] {
	const score = (id: string) => state.relations[id]?.score ?? 0;
	return NPC_DUOS.filter((d) => (d.a === npcId || d.b === npcId) && !state.duos.includes(d.id) && score(d.a) >= d.at && score(d.b) >= d.at);
}

/** 互动后触发够格的联动剧情（各一次）。效果不花时间，直接结算。原地修改 */
function unlockDuos(state: PlayerState, region: Region, npcId: string): string[] {
	const out: string[] = [];
	for (const d of duosReady(state, npcId)) {
		state.duos.push(d.id);
		applyEffect(state, d.fx, region);
		log(state, `【联动 · ${d.title}】${d.text}`);
		out.push(`【${d.title}】${d.text}`);
	}
	return out;
}

/**
 * 与 NPC 互动：聊天（魅力检定决定涨多少）、送礼（看 TA 对这件东西的反应）、帮忙（花时间体力，涨声望）、
 * 专属互动（关系够了才解锁，有冷却）。聊天、送礼、帮忙每种每个游戏日一次。
 * 关系第一次达到某段剧情的门槛时触发那段剧情和它的回报。
 */
export function interactNpc(prev: PlayerState, region: Region, npcId: string, action: NpcAction, itemId?: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const here = npcsAt(prev, region).find((a) => a.npc.id === npcId);
	if (!here) return fail(prev, 'TA现在不在这里。');
	if (action === 'perk' && !here.npc.perk) return fail(prev, 'TA没有这个互动。');
	const why = here.blocked[action];
	if (why) return fail(prev, why);
	const gift = action === 'gift' ? itemId ?? here.gift : undefined;
	if (action === 'gift') {
		if (!gift) return fail(prev, '背包里没有合适的礼物。');
		if (!prev.inventory[gift] || !getItem(gift)) return fail(prev, '背包里没有这件东西。');
	}
	const { npc } = here;
	const state = clone(prev);
	const rel: Relation = structuredClone(getRelation(state, npcId));
	// 先记下这次互动的日期（按开始互动的那天计，跨午夜也不能当天重复），再结算效果：
	// 能力成长在时间流逝前就拿到了，途中晕倒不记日期的话，可以绕过每天一次和专属互动的冷却反复领
	rel.last[action] = dayOf(prev.clock);
	state.relations[npcId] = rel;
	let gain = 0;
	let text = '';
	if (action === 'chat') {
		const good = checkScore(state, 'charisma').total + roll(state) * 60 >= 45;
		gain = good ? 7 : 3;
		if (applyEffect(state, { minutes: 30, needs: { social: 18, fun: 5 }, skills: { charisma: 0.5 } }, region)) return collapsedResult(state);
		text = good ? `和${npc.name}聊得很投机。` : `和${npc.name}寒暄了几句。`;
	} else if (action === 'gift') {
		const r = giftReaction(npc, gift!);
		gain = GIFT_GAIN[r];
		const name = getItem(gift!)!.name;
		if (applyEffect(state, { minutes: 10, items: { [gift!]: -1 }, needs: { social: r === 'dislike' ? 0 : 8 }, moodlet: r === 'love' ? 'gift-loved' : r === 'dislike' ? 'gift-awkward' : undefined }, region)) return collapsedResult(state);
		text = {
			love: `送给${npc.name}一份${name}，TA眼睛都亮了——这是TA的最爱。`,
			like: `送给${npc.name}一份${name}，TA很高兴。`,
			neutral: `送给${npc.name}一份${name}，TA客气地收下了。`,
			dislike: `送给${npc.name}一份${name}，TA的笑容有点僵——看来不喜欢这个。`,
		}[r];
		if (!rel.known.includes(gift!)) rel.known.push(gift!);
	} else if (action === 'help') {
		gain = 9;
		if (applyEffect(state, { minutes: 120, respect: 1, needs: { energy: -18, social: 10 }, skills: { strength: 0.5, stamina: 0.5 } }, region)) return collapsedResult(state);
		text = `帮${npc.name}干了两小时活。`;
	} else {
		const perk = npc.perk!;
		gain = 2;
		if (applyEffect(state, perk.fx, region)) return collapsedResult(state);
		text = `${perk.name}：${perk.desc}`;
	}
	rel.score = Math.max(-100, Math.min(100, rel.score + gain));
	log(state, text);
	const stories = [...unlockStories(state, region, npc, rel), ...unlockDuos(state, region, npcId)];
	if (stories.length) text += ' ' + stories.join(' ');
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

/** 持有的、对这份职业有用的证书加薪比例之和（没有为 0） */
export function certBonus(state: PlayerState, careerId: string): number {
	return CERTS.filter((c) => c.career === careerId && state.certs.includes(c.id)).reduce((sum, c) => sum + c.payBonus, 0);
}

/** 这份职业某个等级的每班工资（含证书加薪，不含表现奖金） */
export function careerPay(state: PlayerState, careerId: string, level: number): number {
	const lv = getCareer(careerId)?.levels[level];
	return lv ? Math.round(lv.pay * (1 + certBonus(state, careerId))) : 0;
}

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
	// 今天已经上过班的话，换了工作当天也不能再上一班
	state.job = { career: careerId, loc: state.loc, level: 0, shifts: 0, good: 0, lastDay: state.workDay };
	voidCareerCard(state); // 不管之前有没有工作：存档里可能留着对不上工作的职业卡
	if (advance(state, 30, region)) return collapsedResult(state);
	const title = offer.career.levels[0].title;
	const place = getLocation(region, state.loc)!.name;
	const msg = `${old ? `辞去了${old.name}的工作，` : ''}被${place}的${offer.career.name}录用为${title}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 辞职或换工作时，按职业打的上班卡当场作废：之后再应聘同一职业也不能接着用这张卡 */
function voidCareerCard(state: PlayerState): string {
	if (!state.clockIn?.career) return '';
	state.clockIn = null;
	log(state, '还没打下班卡的那一班作废了，不计薪。');
	return '还没打下班卡的那一班作废了，不计薪。';
}

export function quitJob(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.job) return fail(prev, '你还没有工作。');
	const state = clone(prev);
	const c = getCareer(state.job!.career)!;
	state.job = null;
	const voided = voidCareerCard(state);
	log(state, `辞去了${c.name}的工作。`);
	return { ok: true, state, msg: `已辞职。${voided}` };
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
	const pay = Math.round(careerPay(state, job.career, job.level) * (good ? 1 + GOOD_BONUS : 1));
	job.lastDay = state.workDay = dayOf(state.clock);
	if (applyEffect(state, { ...c.shift, minutes: c.minutes, cash: pay }, region)) return collapsedResult(state); // 没上完的班不发工资、不计班次
	job.shifts++;
	if (good) job.good++;
	const msg = `${lv.title}上班 ${Math.round(c.minutes / 60)} 小时，收入 $${pay}${good ? '（表现出色，有奖金）' : ''}。` + tryPromote(state);
	log(state, msg);
	return { ok: true, state, msg };
}

/** 班次和表现够了、下一级要求也满足时升职。原地修改，返回要追加的提示（没升职为空串） */
export function tryPromote(state: PlayerState): string {
	const job = state.job;
	if (!job) return '';
	const c = getCareer(job.career)!;
	const next = c.levels[job.level + 1];
	if (!next || job.shifts < PROMOTE_SHIFTS || job.good < PROMOTE_GOOD || unmet(state, next)) return '';
	job.level++;
	job.shifts = 0;
	job.good = 0;
	state.respect += 3;
	addMoodlet(state, 'promoted');
	return ` 升职为${next.title}！`;
}

// ---------- 住房 ----------
export const getHome = (id: string) => HOMES.find((h) => h.id === id);

/** 住处家具的折现价值 */
export function furnitureValue(state: PlayerState): number {
	if (!state.home) return 0;
	return Object.values(state.home.furniture).reduce((sum, id) => sum + Math.round((getFurniture(id)?.price ?? 0) * FURNITURE_RESALE), 0);
}

/** 租房押金：周租 × 押金周数（房型的 bondWeeks，默认 BOND_WEEKS） */
export function bondFor(home: HomeDef): number {
	return Math.round(home.rentWeek * (home.bondWeeks ?? BOND_WEEKS));
}

/** 离开住处：家具半价折现，押金退回（arrears：先从押金里扣的欠租）。返回家具折现，退回的押金写进 refund */
function vacate(state: PlayerState, arrears = 0, refund?: { bond: number }): number {
	const got = furnitureValue(state);
	const bond = Math.max(0, (state.home?.bond ?? 0) - arrears);
	state.cash += got + bond;
	if (refund) refund.bond = bond;
	state.home = null;
	return got;
}

/** 日志里的押金一句 */
const bondNote = (n: number) => (n ? `，押金退回 $${n}` : '');

/**
 * 每周结算：时间每跨过一个结算日执行一次。
 * 1. 房租（住自有房不交）：付不起则被收房  2. 房产：租金收入、维修、物业费、还款、断供  3. 车辆保险：付不起则记麻烦值
 */
function weeklyTick(state: PlayerState, region: Region) {
	while (dayOf(state.clock) >= state.nextWeek) {
		state.nextWeek += 7;
		if (state.home && !state.home.owned && !homeUsable(state)) {
			const def = getHome(state.home.type)!;
			const place = getLocation(region, state.home.loc)?.name ?? '';
			const back = { bond: 0 };
			const got = vacate(state, 0, back);
			log(state, `周结算：没有能睡人的车，退掉了${place}的${def.name}${got ? `，家具折现 $${got}` : ''}${bondNote(back.bond)}。`);
		}
		if (state.home && !state.home.owned) {
			const def = getHome(state.home.type)!;
			const place = getLocation(region, state.home.loc)?.name ?? '';
			if (state.cash >= def.rentWeek) {
				state.cash -= def.rentWeek;
				log(state, `周结算：支付${place}${def.name}房租 $${def.rentWeek}。`);
			} else {
				// 押金先抵这周房租，剩下的退回
				const kept = Math.min(state.home.bond ?? 0, def.rentWeek);
				const back = { bond: 0 };
				const got = vacate(state, kept, back);
				addMoodlet(state, 'evicted');
				log(state, `付不起${place}${def.name}的房租，房东收回了房子${kept ? `，押金扣了 $${kept} 抵房租` : ''}${got ? `，家具折现 $${got}` : ''}${bondNote(back.bond)}。`);
			}
		}
		settleProperties(state, region);
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

/** 车能不能睡人 */
const canSleepIn = (vehicleId: string) => !!getVehicle(vehicleId)?.sleep;

/** 住处还能不能住：房车营地要有能睡人的车 */
function homeUsable(state: PlayerState): boolean {
	return !state.home || !getHome(state.home.type)?.vehicleSleep || canSleepIn(state.vehicle);
}

/** 住在房车营地时，换成或卖成不能睡人的车会没地方睡：先退营地。返回原因，没问题返回 undefined */
function campBlocks(state: PlayerState, nextVehicle: string): string | undefined {
	return state.home && !state.home.owned && getHome(state.home.type)?.vehicleSleep && !canSleepIn(nextVehicle) ? '你住在房车营地，没了能睡人的车就没地方睡；先退掉营地' : undefined;
}

/** 现在租房要付的首期：按到下一个结算日的天数折算（至少一天） */
export function firstRent(state: PlayerState, home: HomeDef): number {
	const days = Math.max(1, Math.min(7, state.nextWeek - dayOf(state.clock)));
	return Math.round((home.rentWeek * days) / 7);
}

/** 租下要先付的钱 = 首期租金 + 押金 − 旧住处退回的押金（换房时旧押金在付款前退回） */
export function moveInCost(state: PlayerState, home: HomeDef): number {
	return firstRent(state, home) + bondFor(home) - (state.home && !state.home.owned ? (state.home.bond ?? 0) : 0);
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
		blocked: state.home?.type === home.id && state.home.loc === loc.id && !state.home.owned ? '你正住在这里'
			: home.vehicleSleep && !canSleepIn(state.vehicle) ? '要有能睡人的车（比如露营车）才能住营地'
			: state.cash < moveInCost(state, home) ? `首期租金 $${firstRent(state, home)}${bondFor(home) ? ` + 押金 $${bondFor(home)}` : ''}` : undefined,
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
	const bond = bondFor(offer.home);
	const back = { bond: 0 };
	const sold = vacate(state, 0, back);
	state.cash -= due + bond;
	state.home = { type: homeId, loc: state.loc, furniture: {}, ...(bond ? { bond } : {}) };
	addMoodlet(state, 'new-home');
	if (advance(state, 60, region)) return collapsedResult(state);
	const msg = `在${getLocation(region, prev.loc)!.name}租下了${offer.home.name}，首期 $${due}${bond ? `、押金 $${bond}（搬走时退）` : ''}，之后每周 $${offer.home.rentWeek}${sold ? `；旧家具折现 $${sold}` : ''}${back.bond ? `；旧住处押金退回 $${back.bond}` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function leaveHome(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.home) return fail(prev, '你没有住处。');
	const state = clone(prev);
	const own = !!state.home!.owned;
	const back = { bond: 0 };
	const got = vacate(state, 0, back);
	const msg = `${own ? '搬出了自己的房子' : '退掉了租的房子'}${got ? `，家具折现 $${got}` : ''}${bondNote(back.bond)}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 回家睡觉：免费，恢复量随住房舒适度提高 */
export function sleepHome(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.home) return fail(prev, '你没有住处。');
	if (prev.home.loc !== prev.loc) return fail(prev, '要回到住处才能睡。');
	const def = getHome(prev.home.type)!;
	if (!homeUsable(prev)) return fail(prev, '没有能睡人的车，营地住不了。');
	const state = clone(prev);
	// 睡这一觉用的是入睡时的住处：睡到一半跨过结算日，住处可能因为欠租或断供被收走（state.home 变成 null）
	const furniture = Object.values(prev.home.furniture);
	const cosy = homeComfort(prev) >= 3 || 'bed' in prev.home.furniture;
	if (applyEffect(state, { minutes: 480, health: 15 + def.comfort, needs: { energy: 100, hygiene: 50 + def.comfort * 2, fun: 5 + def.comfort } }, region)) return collapsedResult(state);
	for (const id of furniture) {
		const extra = getFurniture(id)?.sleep;
		if (extra && applyEffect(state, extra, region)) return collapsedResult(state);
	}
	if (cosy) addMoodlet(state, 'great-sleep');
	log(state, `在${def.name}睡了一觉。`);
	return { ok: true, state, msg: state.home ? '睡了个好觉。' : '睡了一觉，醒来时住处已经没了（详见日志）。' };
}

// ---------- 交通工具 ----------
export const getVehicle = (id: string): VehicleDef | undefined => VEHICLES.find((v) => v.id === id);
/** 回收价：第 26 批起随里程下降（DEPRECIATION），最低剩原价的 floor。km 不传按新车算 */
export const resaleValue = (id: string, km = 0) => {
	const v = getVehicle(id);
	if (!v) return 0;
	const share = Math.max(Math.min(v.resale, DEPRECIATION.floor), v.resale - Math.max(0, km) * DEPRECIATION.perKm);
	return Math.round(v.price * share);
};

/** 在这个地点买这辆车要交的过户印花税（按地点所在区域的真实公式，见 finance.ts） */
export const dutyAt = (locId: string, v: VehicleDef) => vehicleDuty(v.price, areaOf(locId)?.id ?? 'wa');

export interface DealerOffer {
	vehicle: VehicleDef;
	/** 过户印花税（已算进 net） */
	duty: number;
	/** 车价 + 印花税 − 旧车折抵，要付的钱 */
	net: number;
	blocked?: string;
}

/** 车行在售车型；不在车行或不在营业时间返回空 */
export function dealerAt(state: PlayerState, region: Region): DealerOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc || !loc.tags.includes(DEALER_TAG)) return [];
	const open = isOpen(DEALER_HOURS, state.clock);
	const tradeIn = resaleValue(state.vehicle, state.car.km);
	return VEHICLES.map((vehicle) => {
		const duty = dutyAt(loc.id, vehicle);
		const net = vehicle.price + duty - tradeIn;
		const blocked = !open ? `车行营业时间 ${hoursLabel(DEALER_HOURS)}` : state.vehicle === vehicle.id ? '你已经有这辆车' : campBlocks(state, vehicle.id) ?? (state.cash < net ? `还差 $${net - state.cash}` : undefined);
		return { vehicle, duty, net, blocked };
	});
}

export function buyVehicle(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = dealerAt(prev, region).find((o) => o.vehicle.id === id);
	if (!offer) return fail(prev, '这里没有车行。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const state = clone(prev);
	const old = getVehicle(state.vehicle);
	const tradeIn = resaleValue(state.vehicle, state.car.km);
	state.cash -= offer.net;
	state.vehicle = id;
	state.car = { km: 0, since: 0 };
	if (advance(state, 60, region)) return collapsedResult(state);
	const duty = offer.duty ? `（含过户印花税 $${offer.duty}）` : '';
	const msg = old ? `用${old.name}折抵 $${tradeIn}，换了一辆${offer.vehicle.name}${duty}。` : `买了一辆${offer.vehicle.name}${duty}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 现在能不能卖车（不看是否在车行）；能卖返回 undefined */
export function sellBlocked(state: PlayerState): string | undefined {
	if (!getVehicle(state.vehicle)) return '你没有车。';
	if (!isOpen(DEALER_HOURS, state.clock)) return `车行营业时间 ${hoursLabel(DEALER_HOURS)}`;
	return campBlocks(state, 'none');
}

export function sellVehicle(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const v = getVehicle(prev.vehicle);
	if (!v) return fail(prev, '你没有车。');
	if (!dealerAt(prev, region).length) return fail(prev, '要到车行才能卖车。');
	if (!isOpen(DEALER_HOURS, prev.clock)) return fail(prev, `车行营业时间 ${hoursLabel(DEALER_HOURS)}`);
	const camp = campBlocks(prev, 'none');
	if (camp) return fail(prev, camp);
	const state = clone(prev);
	const got = resaleValue(v.id, prev.car.km);
	state.cash += got;
	state.vehicle = 'none';
	state.car = { km: 0, since: 0 };
	if (advance(state, 30, region)) return collapsedResult(state);
	const msg = `把${v.name}卖了 $${got}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 现在这辆车每趟自驾抵达时抛锚的几率：离上次保养没超过 SERVICE_KM 为 0 */
export function breakdownChance(state: PlayerState): number {
	if (!getVehicle(state.vehicle) || state.car.since <= SERVICE_KM) return 0;
	return Math.min(BREAKDOWN.max, BREAKDOWN.base + (state.car.since - SERVICE_KM) * BREAKDOWN.perKm);
}

/** 修车厂：这里能不能给你的车做保养；这里没有修车厂或你没车返回 null */
export function garageAt(state: PlayerState, region: Region): { price: number; blocked?: string } | null {
	const loc = getLocation(region, state.loc);
	const v = getVehicle(state.vehicle);
	if (!loc || !v || !matches(GARAGE.where, loc)) return null;
	const blocked = !isOpen(GARAGE.hours, state.clock) ? `修车厂营业时间 ${hoursLabel(GARAGE.hours)}`
		: state.car.since === 0 ? '刚保养过'
		: state.cash < v.service ? `需要 $${v.service}` : undefined;
	return { price: v.service, blocked };
}

/** 保养：付钱、等两小时，离上次保养的里程清零 */
export function serviceVehicle(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const g = garageAt(prev, region);
	if (!g) return fail(prev, getVehicle(prev.vehicle) ? '这里没有修车厂。' : '你没有车。');
	if (g.blocked) return fail(prev, g.blocked);
	const v = getVehicle(prev.vehicle)!;
	const { state, collapsed } = paidTask(prev, g.price, (s) => advance(s, GARAGE.minutes, region));
	if (collapsed) {
		log(state, `等保养时晕倒了，${v.name}的保养没做，不收钱。`);
		return collapsedResult(state);
	}
	state.car = { km: state.car.km, since: 0 };
	const msg = `给${v.name}做了保养，花了 $${g.price}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 在车里过夜（只有露营车这类 sleep 不为空的车） */
export function sleepInVehicle(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const v = getVehicle(prev.vehicle);
	if (!v?.sleep) return fail(prev, '你的车不能睡人。');
	const state = clone(prev);
	if (applyEffect(state, { ...v.sleep, minutes: 480 }, region)) return collapsedResult(state);
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
	if (applyEffect(state, { minutes: c.minutes, needs: { energy: -Math.round(c.minutes / 12), fun: 3 } }, region)) return collapsedResult(state);
	const msg = `上了${c.name}，${SKILL_META[c.skill].name} +${(state.skills[c.skill] - before).toFixed(1)}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 花钱又花时间的事（考证、保养） ----------
/**
 * 先按没交钱把这段时间过完：途中晕倒就当没报名——不收费，住院费、途中的周结算都按手上原有的钱算，
 * 不能拿这笔费用当「保险箱」少付住院费或躲过房租。顺利做完才收费；
 * 途中的周结算花掉了这笔钱（钱不够了）时，改按「先交钱再做」重算一遍，付不起的房租照常处理。
 * run 返回 true 表示途中晕倒。
 */
function paidTask(prev: PlayerState, price: number, run: (s: PlayerState) => boolean): { state: PlayerState; collapsed: boolean } {
	const free = clone(prev);
	if (run(free)) return { state: free, collapsed: true };
	if (free.cash >= price) {
		free.cash -= price;
		return { state: free, collapsed: false };
	}
	const paid = clone(prev);
	paid.cash -= price;
	if (run(paid)) {
		// 极少见：先交钱的那一遍晕倒了（两遍只差手上的钱）。照样不收费
		paid.cash += price;
		return { state: paid, collapsed: true };
	}
	return { state: paid, collapsed: false };
}

// ---------- 职业证书 ----------
export interface CertOffer {
	cert: CertDef;
	blocked?: string;
}

/** 当前地点能考的证书 */
export function certsAt(state: PlayerState, region: Region): CertOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return CERTS.filter((c) => matches(c.where, loc)).map((cert) => {
		const blocked = state.certs.includes(cert.id) ? '已经有这张证了'
			: !isOpen(cert.hours, state.clock) ? `上课时间 ${hoursLabel(cert.hours)}`
			: state.cash < cert.price ? `需要 $${cert.price}`
			: state.needs.energy < 25 ? '太累了' : undefined;
		return { cert, blocked };
	});
}

export function takeCert(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = certsAt(prev, region).find((o) => o.cert.id === id);
	if (!offer) return fail(prev, '这里考不了这张证。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const c = offer.cert;
	const { state, collapsed } = paidTask(prev, c.price, (s) => applyEffect(s, { minutes: c.minutes, needs: { energy: -Math.round(c.minutes / 10), fun: -5 } }, region));
	if (collapsed) {
		log(state, `${c.name}没上完，不收学费。`);
		return collapsedResult(state);
	}
	state.certs.push(c.id);
	const career = getCareer(c.career);
	const msg = `考到了${c.name}${career ? `：${career.name}的工作每班工资 +${Math.round(c.payBonus * 100)}%` : ''}。`;
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
	return EXPERIENCES.filter((e) => e.loc === state.loc && (!e.festival || festivalActive(e.festival, state.clock))).map((exp) => ({
		exp,
		first: !state.collected.includes(exp.id),
		blocked: !isOpen(exp.hours, state.clock) ? `开放时间 ${hoursLabel(exp.hours!)}` : state.cash < exp.price ? `需要 $${exp.price}` : undefined,
	}));
}

/** 按现在的体验清单已经集齐的片区 */
function completeAreas(state: PlayerState): string[] {
	return Object.keys(AREAS).filter((id) => {
		const list = EXPERIENCES.filter((e) => e.area === id);
		return list.length > 0 && list.every((e) => state.collected.includes(e.id));
	});
}

/** 已获得的片区称号：存档里记下的（加了新体验也不收回），加上现在集齐的 */
export function areaTitles(state: PlayerState): string[] {
	const got = new Set([...(state.areas ?? []), ...completeAreas(state)]);
	return Object.entries(AREAS).filter(([id]) => got.has(id)).map(([, a]) => a.title);
}

export function doExperience(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = experiencesAt(prev, region).find((o) => o.exp.id === id);
	if (!offer) return fail(prev, '这里没有这个项目。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const e = offer.exp;
	const state = clone(prev);
	state.cash -= e.price;
	if (offer.first) {
		// 没体验完不收进收藏册
		if (applyEffect(state, { ...e.fx, minutes: e.minutes, respect: e.respect, moodlet: 'experience' }, region)) return collapsedResult(state);
		state.collected.push(e.id);
	} else {
		const fun = Math.round((e.fx.needs?.fun ?? 0) * REPEAT_FUN_SHARE);
		if (applyEffect(state, { minutes: e.minutes, needs: { fun }, moodlet: 'good-time' }, region)) return collapsedResult(state);
	}
	let msg = offer.first ? `体验了${e.name}，收进了收藏册（声望 +${e.respect}）。` : `又体验了一次${e.name}。`;
	// 称号奖励每个片区只发一次：记进存档，以后加了新体验再补齐也不重复发
	const gained = completeAreas(state).filter((id) => !(state.areas ?? []).includes(id));
	if (gained.length) {
		state.areas = [...(state.areas ?? []), ...gained];
		state.respect += 5;
		msg += ` 集齐了「${AREAS[gained[0]].name}」，获得称号「${AREAS[gained[0]].title}」！`;
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
	if (advance(state, 30, region)) return collapsedResult(state);
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
	if (applyEffect(state, { cash: -HOME_COOK.cost, minutes: HOME_COOK.minutes, needs: { hunger: HOME_COOK.hunger, fun: 3 }, moodlet: 'well-fed' }, region)) return collapsedResult(state);
	log(state, '在家做了顿饭。');
	return { ok: true, state, msg: '🍳 在家吃了顿饭。' };
}

export function relaxAtHome(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = homeActionBlocked(prev, 'relax');
	if (why) return fail(prev, why);
	const state = clone(prev);
	if (applyEffect(state, { minutes: HOME_RELAX.minutes, needs: { fun: HOME_RELAX.fun, energy: 3 } }, region)) return collapsedResult(state);
	log(state, '在家放松了一会儿。');
	return { ok: true, state, msg: '🎵 在家放松了一会儿。' };
}

// ---------- 房产 ----------
export const getProperty = (id: string): PropertyDef | undefined => PROPERTIES.find((p) => p.id === id);
export const ownedProperty = (state: PlayerState, id: string): OwnedProperty | undefined => state.properties.find((p) => p.id === id);

/** 净资产 = 现金 + 车辆残值（按里程折旧）+ 住处家具折现 + 租房押金 + 各房产（按正常卖出到手价，已扣贷款） */
export function netWorth(state: PlayerState): number {
	const estate = state.properties.reduce((sum, p) => {
		const def = getProperty(p.id);
		return sum + (def ? propertyEquity(def, p.loan) : 0);
	}, 0);
	return state.cash + resaleValue(state.vehicle, state.car.km) + furnitureValue(state) + (state.home?.bond ?? 0) + estate;
}

/** 每周结算里的房产部分。顺序：租金收入 → 维修 → 物业费与还款 → 断供处理 */
function settleProperties(state: PlayerState, region: Region) {
	for (const p of [...state.properties]) {
		const def = getProperty(p.id);
		if (!def) continue;
		if (p.rented && p.fresh) {
			// 这个结算期内才挂牌：不满一期不计租，下期起算。不然结算前挂牌、结算后搬回就能白领一周租金
			Reflect.deleteProperty(p, 'fresh');
			log(state, `周结算：${def.name}刚挂牌，下周起收租。`);
		} else if (p.rented) {
			if (roll(state) < FINANCE.vacancy) log(state, `周结算：${def.name}这周空置，没有租金。`);
			else {
				state.cash += def.rentIncome;
				log(state, `周结算：${def.name}租金收入 $${def.rentIncome}。`);
			}
			if (roll(state) < FINANCE.repairChance) {
				const [lo, hi] = repairRange(def);
				const cost = Math.min(state.cash, Math.round(lo + roll(state) * (hi - lo)));
				state.cash -= cost;
				log(state, `${def.name}的租客报修，花了 $${cost}。`);
			}
		}
		const interest = weeklyInterest(p.loan);
		const principal = weeklyPrincipal(def, p.loan);
		const due = def.weekly + (p.loan > 0 ? interest + principal : 0);
		if (state.cash >= due) {
			state.cash -= due;
			p.loan -= principal;
			p.missed = 0;
			log(state, `周结算：${def.name}物业费 $${def.weekly}${interest + principal ? `，还款 $${interest + principal}（剩余贷款 $${p.loan}）` : ''}。`);
			continue;
		}
		p.missed++;
		p.loan = Math.min(def.price, p.loan + interest); // 没付的利息计入本金；不超过房价（存档校验的上限，正常买房到不了）
		if (p.missed <= FINANCE.graceWeeks) {
			log(state, `付不起${def.name}这周的 $${due}（第 ${p.missed} 次欠款，超过 ${FINANCE.graceWeeks} 次将被强制卖房）。`);
			continue;
		}
		const got = saleProceeds(def, p.loan, FINANCE.forecloseShare);
		removeProperty(state, p.id);
		state.cash += got;
		log(state, `连续欠款，${def.name}被强制卖出，还清贷款后到手 $${got}。`);
	}
	void region;
}

/** 从名下移除一套房；如果正住在里面则搬出（家具折现） */
function removeProperty(state: PlayerState, id: string) {
	if (state.home?.owned === id) vacate(state);
	state.properties = state.properties.filter((p) => p.id !== id);
}

export interface PropertyOffer {
	property: PropertyDef;
	owned?: OwnedProperty;
	down: number; // 贷款买的首付
	blockedCash?: string; // 全款买不了的原因
	blockedLoan?: string; // 贷款买不了的原因
}

/** 当前地点的在售房产（含已拥有的，方便界面显示） */
export function propertiesAt(state: PlayerState, region: Region): PropertyOffer[] {
	void region;
	return PROPERTIES.filter((p) => p.loc === state.loc).map((property) => {
		const owned = ownedProperty(state, property.id);
		const down = downPayment(property);
		return {
			property, owned, down,
			blockedCash: owned ? '已拥有' : state.cash < property.price ? `全款需要 $${property.price}` : undefined,
			blockedLoan: owned ? '已拥有' : state.cash < down ? `首付需要 $${down}` : undefined,
		};
	});
}

/** 买房：全款，或付最低首付（FINANCE.minDown）、其余贷款。要人在房产所在地 */
export function buyProperty(prev: PlayerState, region: Region, id: string, withLoan: boolean): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = propertiesAt(prev, region).find((o) => o.property.id === id);
	if (!offer) return fail(prev, '这里没有这套房。');
	const why = withLoan ? offer.blockedLoan : offer.blockedCash;
	if (why) return fail(prev, why);
	const def = offer.property;
	const state = clone(prev);
	const paid = withLoan ? offer.down : def.price;
	state.cash -= paid;
	state.properties.push({ id, loan: def.price - paid, rented: false, missed: 0 });
	state.respect += 5;
	if (advance(state, 120, region)) return collapsedResult(state);
	const msg = withLoan
		? `付了 $${paid} 首付买下${def.name}，贷款 $${def.price - paid}，每周还款约 $${loanPayment(def, def.price - paid)}。`
		: `全款 $${paid} 买下了${def.name}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 卖房：到手房价的 95% 减去剩余贷款；在任何地方都能卖 */
export function sellProperty(prev: PlayerState, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getProperty(id);
	const mine = ownedProperty(prev, id);
	if (!def || !mine) return fail(prev, '你没有这套房。');
	const state = clone(prev);
	const got = saleProceeds(def, mine.loan);
	removeProperty(state, id);
	state.cash += got;
	const msg = `卖掉了${def.name}，${mine.loan ? `还清贷款 $${mine.loan} 后` : ''}到手 $${got}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 搬进自己的房子：停止出租，退掉原来的住处（家具折现）。在任何地方都能办，但要人到了才能睡 */
export function moveIntoProperty(prev: PlayerState, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getProperty(id);
	if (!def || !ownedProperty(prev, id)) return fail(prev, '你没有这套房。');
	if (prev.home?.owned === id) return fail(prev, '你已经住在这里。');
	const state = clone(prev);
	const back = { bond: 0 };
	const sold = vacate(state, 0, back);
	const mine = ownedProperty(state, id)!;
	mine.rented = false;
	Reflect.deleteProperty(mine, 'fresh');
	state.home = { type: def.homeType, loc: def.loc, furniture: {}, owned: id };
	// 「搬了新家」每套房只给一次：搬出再搬回不花钱也不花时间，不能拿来反复刷
	if (!mine.lived) addMoodlet(state, 'new-home');
	mine.lived = true;
	const msg = `搬进了自己的${def.name}，以后不用交房租了${sold ? `；旧家具折现 $${sold}` : ''}${back.bond ? `；租房押金退回 $${back.bond}` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 把房子租出去（正住在里面则先搬出）；再调用一次停止出租 */
export function toggleRentOut(prev: PlayerState, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getProperty(id);
	if (!def || !ownedProperty(prev, id)) return fail(prev, '你没有这套房。');
	const state = clone(prev);
	const mine = ownedProperty(state, id)!;
	let msg: string;
	if (mine.rented) {
		mine.rented = false;
		Reflect.deleteProperty(mine, 'fresh');
		msg = `${def.name}不再出租。`;
	} else {
		const sold = state.home?.owned === id ? vacate(state) : 0;
		mine.rented = true;
		mine.fresh = true;
		msg = `${def.name}挂牌出租，下个结算日之后开始收租，每周 $${def.rentIncome}${sold ? `；搬出时家具折现 $${sold}` : ''}。`;
	}
	log(state, msg);
	return { ok: true, state, msg };
}

/** 提前还贷：把一部分现金还进贷款（不超过剩余贷款和手头现金） */
export function repayLoan(prev: PlayerState, id: string, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getProperty(id);
	const mine = ownedProperty(prev, id);
	if (!def || !mine) return fail(prev, '你没有这套房。');
	if (!mine.loan) return fail(prev, '这套房没有贷款。');
	const pay = Math.floor(Math.min(amount, mine.loan, prev.cash));
	if (!(pay > 0)) return fail(prev, '还款金额无效。');
	const state = clone(prev);
	state.cash -= pay;
	ownedProperty(state, id)!.loan -= pay;
	const left = mine.loan - pay;
	const msg = left ? `提前还了 $${pay}，${def.name}还剩贷款 $${left}。` : `${def.name}的贷款还清了！`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 日历与节日 ----------
export const festivalActive = (id: string, clock: number): boolean => {
	const f = FESTIVALS.find((x) => x.id === id);
	return !!f && inSpan(clock, f.season, f.day, f.days).active;
};

/** 今天正在举行的节日 */
export const festivalsNow = (clock: number): FestivalDef[] => FESTIVALS.filter((f) => inSpan(clock, f.season, f.day, f.days).active);

/** 附近页的节日卡：这里正在办的，和近 14 天的其他节日（至少列 2 个，让人知道下一个在哪） */
export function festivalsSoon(clock: number, loc: string): { here?: { festival: FestivalDef; active: boolean; startsIn: number }; soon: { festival: FestivalDef; active: boolean; startsIn: number }[] } {
	const cal = festivalCalendar(clock);
	const here = cal.find((c) => c.active && c.festival.loc === loc);
	const soon = cal.filter((c) => c !== here).filter((c, i) => i < 2 || c.startsIn <= 14);
	return { here, soon };
}

/** 全部节日，按离现在的远近排序；进行中的 startsIn 为 0 */
export function festivalCalendar(clock: number): { festival: FestivalDef; active: boolean; startsIn: number }[] {
	return FESTIVALS.map((festival) => ({ festival, ...inSpan(clock, festival.season, festival.day, festival.days) })).sort((a, b) => a.startsIn - b.startsIn);
}

// 给 core/wishes.ts 等同层模块用的内部工具
export { roll as rngRoll, log as addLog };

// ---------- 带时限的心情状态 ----------
/** 获得一个心情状态：同种刷新时长；顺带清掉已过期的。原地修改 */
export function addMoodlet(state: PlayerState, id: string) {
	const def = MOODLETS.find((m) => m.id === id);
	if (!def) return;
	const until = state.clock + def.hours * 60;
	state.moodlets = state.moodlets.filter((m) => m.id !== id && m.until > state.clock);
	state.moodlets.push({ id, until });
	if (state.moodlets.length > MOODLET_MAX) state.moodlets.splice(0, state.moodlets.length - MOODLET_MAX);
}

/** 清掉已过期的心情状态。原地修改 */
export function pruneMoodlets(state: PlayerState) {
	state.moodlets = state.moodlets.filter((m) => m.until > state.clock);
}
