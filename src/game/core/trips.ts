// 离开地图的旅行（第 43 批）：跨州、回国探亲，以及州内自驾游规划。纯函数，不改入参。
// 设计见 docs/earth-game/travel.md。
import { AWAY_DESTS, FARE_SEASONS, JETLAG_TZ, JOB_LEAVE_DAYS, PACKING, PACKING_REMINDERS, RETURN_EVENTS, RETURN_NEEDS, ROAD_TRIP_DRIVE_MIN_PER_DAY, TRIP_DAY_MIN, TRIP_DAYS, type AwayDest, type FareSeason, type TripFare, type TripKind } from '../data/trips.ts';
import { EVENTS } from '../data/events.ts';
import { addMoodlet, awayTime, clone, fail, getLocation, log, releaseEmployerHome, roll, travelOptions } from './engine.ts';
import { petTravelBlocked } from './pets.ts';
import { PET } from '../data/pets.ts';
import { bankWeekly } from './credit.ts';
import { settleBiz } from './business.ts';
import { currentIllness } from './health.ts';
import { TAX_GAME } from '../data/tax.ts';
import { SLEEP } from '../data/sleep.ts';
/** 旅途中每晚的睡眠质量（按普通夜里一觉算，待平衡） */
const TRIP_SLEEP_Q = 0.85;
import { debtNow } from './sleep.ts';
import { costMult, getItem, weeklyCosts } from './attributes.ts';
import { areaOf } from '../data/areas-base.ts';
import { inSpan, dayOf, YEAR_DAYS } from './time.ts';
import { NEED_KEYS } from './types.ts';
import type { ActionResult, PlayerState, Region, TravelMode } from './types.ts';

export const getAwayDest = (id: unknown): AwayDest | undefined => (typeof id === 'string' ? AWAY_DESTS.find((d) => d.id === id) : undefined);

/** 某个出发日落在哪些票价季节里（可能好几段） */
export function fareSeasonsOn(clock: number): FareSeason[] {
	return FARE_SEASONS.filter((s) => inSpan(clock, s.season, s.day, s.days).active);
}

/** 票价需求度 0–1：几段重叠取最大，不在任何一段为 0 */
export function fareDemand(clock: number, kind: TripKind): number {
	return fareSeasonsOn(clock).reduce((m, s) => Math.max(m, s.demand[kind]), 0);
}

/** 往返票价：下限 + (上限 − 下限) × 需求度，再乘特质的费用倍率，取整 */
export function tripFare(state: PlayerState, fare: TripFare, kind: TripKind): number {
	const base = fare.low + (fare.high - fare.low) * fareDemand(state.clock, kind);
	return Math.round(base * costMult(state));
}

export interface PackingCheck {
	id: string;
	label: string;
	packed: boolean;
	missCost: number;
}

/** 行李清单：按身上的物品判断每类带没带 */
export function packingList(state: PlayerState, kind: TripKind): PackingCheck[] {
	return PACKING.filter((p) => p.kinds.includes(kind)).map((p) => ({
		id: p.id, label: p.label, missCost: p.missCost,
		packed: p.items.some((id) => (state.inventory[id] ?? 0) > 0),
	}));
}

export const packingReminders = (kind: TripKind): string[] => PACKING_REMINDERS[kind];

/** 没带的东西到了当地补买要花的钱（乘特质费用倍率） */
export function packingCost(state: PlayerState, kind: TripKind): number {
	return Math.round(packingList(state, kind).reduce((s, p) => s + (p.packed ? 0 : p.missCost), 0) * costMult(state));
}

export interface AwayPreview {
	days: number;
	/** 离开期间会经过几次周结算 */
	settlements: number;
	/** 按现在的固定开销估的这几次结算合计（房租、车险、房产） */
	weeklyDue: number;
	/** 有工作而且请假超过上限：回来就没工作了 */
	loseJob: boolean;
	/** 有工作时今年还能请几天可保留工作的假（不带薪）；没工作为 Infinity */
	leaveLeft: number;
	/** 付完机票、补买行李以后的现金够不够这几次结算 */
	short: boolean;
	returnClock: number;
}

/** 出发前的预估：离开 days 天会发生什么 */
export function awayPreview(state: PlayerState, days: number, upfront: number): AwayPreview {
	const returnClock = state.clock + days * TRIP_DAY_MIN;
	const settlements = Math.max(0, Math.floor((dayOf(returnClock) - state.nextWeek) / 7) + 1);
	// 合并 main 时复核：周结算还会扣银行的还款（信用卡最低还款、贷款、先买后付）、欠税的分期，第一次结算还会补交欠的罚款
	const taxPlan = state.tax?.debt ? Math.min(state.tax.debt, Math.max(TAX_GAME.planMin, Math.ceil(state.tax.debt * TAX_GAME.planShare))) : 0;
	const wc = weeklyCosts(state);
	const perWeek = wc.total + (state.bank ? bankWeekly(state.bank) : 0) + taxPlan;
	// 签约预收的房租只抵第一次结算，之后几次按整周（第十轮平衡）
	const weeklyDue = perWeek * settlements + wc.ahead * Math.max(0, settlements - 1) + (settlements ? state.law?.owed ?? 0 : 0);
	return { days, settlements, weeklyDue, loseJob: leaveLeft(state) < days, leaveLeft: leaveLeft(state), short: state.cash - upfront < weeklyDue, returnClock };
}

export interface TripOption {
	dest: AwayDest;
	fare: TripFare;
	price: number;
	packing: number;
	/** 此刻去不了的原因；能去为 undefined */
	blocked?: string;
}

/** 从当前地点能去的离开地图的旅行；不在有这些航线的机场时返回空 */
export function tripOptions(state: PlayerState): TripOption[] {
	const out: TripOption[] = [];
	for (const dest of AWAY_DESTS) {
		const fare = dest.fares.find((f) => f.from === state.loc);
		if (!fare) continue;
		const price = tripFare(state, fare, dest.kind);
		const packing = packingCost(state, dest.kind);
		const ill = currentIllness(state);
		const blocked = state.pending ? '先处理眼前的事件'
			: state.clockIn ? '还在上班（先打下班卡）'
			: ill ? `${ill.def.name}还没好，先养病再出远门` // 合并 main 时复核：原来飞走就能躲过生病
			: state.cash < price + packing ? '现金不够买机票'
			: undefined;
		out.push({ dest, fare, price, packing, ...(blocked ? { blocked } : {}) });
	}
	return out;
}

/** 今年（游戏一年 YEAR_DAYS 天）还能请几天可保留工作的假（不带薪）：老板能等的天数按年累计（合并 main 时复核：原来每趟单算，连着走几趟 7 天永远不丢工作） */
export function leaveLeft(state: PlayerState): number {
	if (!state.job) return Infinity;
	const y = Math.floor(dayOf(state.clock) / YEAR_DAYS);
	const used = state.job.leave && state.job.leave.y === y ? state.job.leave.d : 0;
	return Math.max(0, JOB_LEAVE_DAYS - used);
}

/**
 * 离开 days 天才看得出来的限制（合并 main 后）：
 * - 宠物（main 的宠物系统）：不能带上飞机；要寄养，而且寄养要付到回来那天；
 * - 签证（main 的签证路线）：回国再入境要签证有效。签证已过期，或者在回来之前到期，出境后就回不来。永居、没有签证记录的出身不受影响。
 * 能去返回 undefined
 */
export function tripDaysBlocked(state: PlayerState, kind: TripKind, days: number): string | undefined {
	const back = dayOf(state.clock + days * TRIP_DAY_MIN);
	const pet = state.pet;
	if (pet && days > PET.boardMaxDays) return `${pet.name}最多只能寄养 ${PET.boardMaxDays} 天，带着宠物最长离开 ${PET.boardMaxDays} 天`;
	if (pet && !pet.board) return petTravelBlocked(state, state.loc, 'air');
	if (pet?.board && pet.board.until < back) return `${pet.name}的寄养只付到第 ${pet.board.until + 1} 天，要续到你回来那天`;
	const v = state.visa;
	if (kind === 'home' && v && v.kind === 'expired') return '签证已经过期，出境后回不来';
	if (kind === 'home' && v && v.until >= 0 && v.until < back) return `签证第 ${v.until + 1} 天到期，在你回来之前，出境后回不来`;
	return undefined;
}

/** 回来时按顺序看事件规则，第一个满足条件且掷骰过了的触发 */
function pickReturnEvent(state: PlayerState, kind: TripKind): string | null {
	for (const r of RETURN_EVENTS) {
		if (!r.kinds.includes(kind)) continue;
		if (r.needHome && !state.home) continue;
		if (!EVENTS.some((e) => e.id === r.id)) continue;
		if (roll(state) < r.chance) return r.id;
	}
	return null;
}

/**
 * 出发并回来：一个动作结算完整段旅行。
 * 1. 付机票和补买行李  2. 时钟走 days 天，跨周结算照常（房租、车险、房产）  3. 请假超过上限丢工作
 * 4. 需求按旅行类型重置，发心情、纪念品  5. 可能抽一个回来的事件
 */
export function takeTrip(prev: PlayerState, region: Region, destId: string, days: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const dest = getAwayDest(destId);
	if (!dest) return fail(prev, '没有这条航线。');
	if (!Number.isInteger(days) || days < TRIP_DAYS.min || days > TRIP_DAYS.max || !dest.days.includes(days)) return fail(prev, '天数不对。');
	const opt = tripOptions(prev).find((o) => o.dest.id === destId);
	if (!opt) return fail(prev, `要先到有直飞${dest.name}航线的机场。`);
	if (opt.blocked) return fail(prev, `${opt.blocked}。`);
	const why = tripDaysBlocked(prev, dest.kind, days);
	if (why) return fail(prev, `${why}。`);
	const state = clone(prev);
	const here = getLocation(region, state.loc)?.name ?? '';
	const debtBefore = debtNow(prev);
	state.cash -= opt.price + opt.packing;
	log(state, `从${here}出发去${dest.name}，机票 $${opt.price}${opt.packing ? `，在当地补买没带的东西 $${opt.packing}` : ''}，要离开 ${days} 天。`);
	let lostJob = false, lostHome = '', keptLeft = -1;
	if (state.job && days > leaveLeft(state)) {
		state.job = null;
		lostHome = releaseEmployerHome(state);
		lostJob = true;
	} else if (state.job) {
		const y = Math.floor(dayOf(state.clock) / YEAR_DAYS);
		const used = state.job.leave && state.job.leave.y === y ? state.job.leave.d : 0;
		state.job.leave = { y, d: used + days };
		keptLeft = Math.max(0, JOB_LEAVE_DAYS - used - days);
	}
	// 合并 main 时复核：一天一天往前走——每天先结算自己店里的生意，再过这一天（跨过结算日就交房租、还贷款、报税）。
	// 原来一次跳过整段，房租和还款都先扣、店里的收入最后才进账；涨租、财年交界也按回来那天算
	for (let i = 0; i < days; i++) {
		const biz = settleBiz(state, region).trim();
		if (biz) log(state, biz);
		awayTime(state, TRIP_DAY_MIN, region);
	}
	const bizLast = settleBiz(state, region).trim(); // 回来那天的前一天也结算掉
	if (bizLast) log(state, bizLast);
	if (lostJob) log(state, `今年可保留工作的请假（不带薪）累计超过 ${JOB_LEAVE_DAYS} 天，老板另外找了人，工作没了。${lostHome}`);
	else if (keptLeft >= 0 && state.job) log(state, `请假 ${days} 天，工作保留；这几天不上班没有工资，今年可保留工作的请假还剩 ${keptLeft} 天。`);
	for (const k of NEED_KEYS) state.needs[k] = RETURN_NEEDS[dest.kind][k];
	// 合并时间和睡眠后：在外面每晚都睡了觉——醒来时间从回到机场算起，欠的觉每晚按普通一觉还一部分（见 time-sleep.md §2.4）
	const perNight = (SLEEP.fullMinutes / 60) * TRIP_SLEEP_Q * SLEEP.repayPerHour;
	state.rest = { wake: state.clock, debt: Math.max(0, Math.round((debtBefore - days * perNight) * 10) / 10) };
	addMoodlet(state, dest.kind === 'home' ? 'family-time' : 'trip-glow');
	if (Math.abs(opt.fare.tz) >= JETLAG_TZ) addMoodlet(state, 'jetlag');
	const item = getItem(dest.souvenir.item);
	if (item) state.inventory[item.id] = Math.min(item.max, (state.inventory[item.id] ?? 0) + dest.souvenir.n);
	log(state, `从${dest.name}回到${here}${item ? `，带回了${item.icon}${item.name}` : ''}。`);
	const ev = pickReturnEvent(state, dest.kind);
	if (ev) state.pending = { eventId: ev };
	return { ok: true, state, msg: `离开 ${days} 天后回到${here}。${lostJob ? `工作已经没了。${lostHome}` : ''}` };
}

// ---------- 州内自驾游规划 ----------
export interface RoadTripStop {
	to: string;
	mode: TravelMode;
	km: number;
	minutes: number;
	cost: number;
	/** 玩家没去过 */
	fresh: boolean;
}

export interface RoadTripPlan {
	stops: RoadTripStop[];
	km: number;
	minutes: number;
	cost: number;
}

/**
 * 自驾游建议：从当前地点出发，一站站挑下一站（优先没去过的、再挑近的），开车总时长不超过 days 天 × 每天上限。
 * 只走公路、土路（车能走的话）和渡轮，不坐飞机；interstate 为 false 时不出本州。只给建议，不改存档。
 */
export function planRoadTrip(state: PlayerState, region: Region, days: number, interstate = false): RoadTripPlan {
	const budget = Math.max(0, days) * ROAD_TRIP_DRIVE_MIN_PER_DAY;
	const homeArea = areaOf(state.loc)?.id;
	const sim: PlayerState = { ...state, cash: Number.MAX_SAFE_INTEGER, pending: null };
	const used = new Set([state.loc]);
	const plan: RoadTripPlan = { stops: [], km: 0, minutes: 0, cost: 0 };
	for (let guard = 0; guard < 50; guard++) {
		const opts = travelOptions(sim, region).filter((o) =>
			o.available && (o.mode === 'road' || o.mode === 'track' || o.mode === 'ferry') && !used.has(o.to) && !petTravelBlocked(state, o.to, o.mode)
			&& (interstate || areaOf(o.to)?.id === homeArea)
			&& plan.minutes + o.minutes <= budget);
		if (!opts.length) break;
		opts.sort((a, b) => Number(!!state.visited[a.to]) - Number(!!state.visited[b.to]) || a.minutes - b.minutes || a.to.localeCompare(b.to));
		const o = opts[0];
		plan.stops.push({ to: o.to, mode: o.mode, km: o.km, minutes: o.minutes, cost: o.cost, fresh: !state.visited[o.to] });
		plan.km += o.km;
		plan.minutes += o.minutes;
		plan.cost += o.cost;
		used.add(o.to);
		sim.loc = o.to;
	}
	return plan;
}
