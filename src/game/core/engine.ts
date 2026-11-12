// 游戏规则引擎：纯函数、确定性（随机数来自存档里的 seed），前后端与测试共用。
// 所有动作返回新的 PlayerState，不修改入参。
import { ACTIVITIES } from '../data/activities.ts';
import { EVENTS } from '../data/events.ts';
import { clamp100, JOURNAL_MAX, SKILL_META } from './character.ts';
import { haversineKm, locateInRegion, POI_RADIUS_KM } from './geo.ts';
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type {
	ActionResult, Activity, Effect, GameEvent, GameLocation, PlayerState, Region, Route, TravelMode,
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
	for (const k of NEED_KEYS) state.needs[k] = clamp100(state.needs[k] - DECAY[k] * minutes);
	if (state.needs.hunger <= 0 || state.needs.energy <= 0) {
		state.health = clamp100(state.health - STARVE_DMG * minutes);
	}
	if (state.health > 0) return false;
	collapse(state, region);
	return true;
}

/** 体力耗尽：在医院醒来，损失部分现金（不删档） */
function collapse(state: PlayerState, region: Region) {
	const bill = Math.round(state.cash * 0.2);
	state.cash -= bill;
	state.health = 50;
	for (const k of NEED_KEYS) state.needs[k] = Math.max(state.needs[k], 50);
	state.loc = region.hospital;
	state.pending = null;
	state.clock += 12 * 60;
	log(state, `你晕倒了，在${getLocation(region, region.hospital)?.name ?? '医院'}醒来，医药费 $${bill}。`);
}

export function applyEffect(state: PlayerState, fx: Effect, region: Region) {
	if (fx.cash) state.cash = Math.max(0, Math.round(state.cash + fx.cash));
	if (fx.respect) state.respect = Math.max(0, state.respect + fx.respect);
	if (fx.heat) state.heat = clamp100(state.heat + fx.heat);
	if (fx.vehicle) state.vehicle = fx.vehicle;
	if (fx.skills) for (const k of SKILL_KEYS) if (fx.skills[k]) state.skills[k] = clamp100(state.skills[k] + fx.skills[k]!);
	// 先流逝时间（会衰减需求），再结算需求增减，保证“睡 8 小时”后精力确实是满的
	if (fx.minutes) advance(state, fx.minutes, region);
	if (fx.needs) for (const k of NEED_KEYS) if (fx.needs[k]) state.needs[k] = clamp100(state.needs[k] + fx.needs[k]!);
	if (fx.health) {
		state.health = clamp100(state.health + fx.health);
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
		if (r.mode === 'track') {
			label = '🚙 越野土路';
			if (state.vehicle !== '4wd') { available = false; reason = '需要四驱越野车'; }
			minutes = (km / (55 + state.skills.driving * 0.15)) * 60;
			cost = km * 0.22;
		} else if (state.vehicle === 'none') {
			label = '🚌 长途巴士';
			minutes = (km / 70) * 60 + 20;
			cost = 8 + km * 0.12;
		} else {
			label = '🚗 自驾';
			minutes = (km / (85 + state.skills.driving * 0.25)) * 60;
			cost = km * (state.vehicle === '4wd' ? 0.2 : 0.15);
		}
	}
	cost = Math.round(cost);
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
	const selfDrive = (mode === 'road' || mode === 'track') && state.vehicle !== 'none';
	if (selfDrive) {
		state.skills.driving = clamp100(state.skills.driving + opt.km / 150);
		if (mode === 'track') state.skills.survival = clamp100(state.skills.survival + opt.km / 300);
	}
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
		const passed = state.skills[choice.check.skill] + roll(state) * 60 >= choice.check.dc;
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
