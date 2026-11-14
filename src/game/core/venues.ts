// 真实地点：玩家拿着手机真的走到某家餐馆、健身房、公园，就能在游戏里做对应的事。
// 纯函数：现实时间 now（毫秒）由服务端传入，客户端无法伪造；坐标来自手机定位，可以伪造，所以做了精度、距离和速度三道检查。
import { realDayOf } from './daily.ts';
import { addMoodlet, applyEffect, clone, collapsedResult, fail, getCareer, getLocation, log, pickVenueEvent, tryPromote } from './engine.ts';
import {
	drinkOutcome, exerciseOutcome, groceriesOutcome, healOutcome, mealOutcome, relaxOutcome, studyOutcome, trainOutcome, workPay,
	type OpOutcome,
} from './formulas.ts';
import { haversineKm } from './geo.ts';
import { dayOf } from './time.ts';
import { FIX_RULES, VENUE_OPS, VENUE_TYPES, type VenueOpDef } from '../data/venues.ts';
import type { ActionResult, PlayerState, Region, SkillKey, Venue, VenueOp, VenueTypeDef } from './types.ts';

/** 实地到岗的时薪加成（第六轮平衡：1.15 → 1.05） */
export const ON_SITE_BONUS = 1.05;

export const getVenueType = (id: string): VenueTypeDef | undefined => VENUE_TYPES.find((t) => t.id === id);
export const getVenueOp = (id: string): VenueOpDef | undefined => VENUE_OPS.find((o) => o.id === id);

/** 零工用哪项能力算加成 */
const GIG_SKILL: Record<string, SkillKey> = { supermarket: 'strength', pool: 'swimming' };

export interface WorkTerms {
	hourly: number;
	skill: SkillKey;
	career: boolean; // 按职业计（算班次、能升职）还是零工
}

/** 在这个地点上班的条件：有对应职业时按职业工资折算时薪（不低于零工时薪）再加 15% 到岗加成，否则用零工时薪；都没有返回 null */
export function workTerms(state: PlayerState, type: VenueTypeDef): WorkTerms | null {
	const job = state.job;
	const c = job ? getCareer(job.career) : undefined;
	if (job && c?.venues?.includes(type.id)) {
		const base = Math.max(c.levels[job.level].pay / (c.minutes / 60), type.gigRate ?? 0);
		return { hourly: Math.round(base * ON_SITE_BONUS * 10) / 10, skill: c.skill, career: true };
	}
	if (type.gigRate) return { hourly: type.gigRate, skill: GIG_SKILL[type.id] ?? 'charisma', career: false };
	return null;
}

/** 除上班外，各动作的结算预览 */
export function opOutcome(state: PlayerState, op: VenueOp, type: VenueTypeDef, venue: Venue): OpOutcome | null {
	const tier = venue.tier ?? type.tier;
	switch (op) {
		case 'meal': return mealOutcome(state, type, tier);
		case 'train': return trainOutcome(state, type);
		case 'run':
		case 'swim': return exerciseOutcome(state, op);
		case 'relax': return relaxOutcome(state);
		case 'study': return studyOutcome(state);
		case 'drink': return drinkOutcome(state, tier);
		case 'groceries': return groceriesOutcome(state);
		case 'heal': return healOutcome(state);
		default: return null;
	}
}

/** 冷却中返回原因 */
function cooldownLeft(state: PlayerState, op: VenueOpDef, now: number): string | undefined {
	const last = state.venueCd[op.id];
	if (last === undefined || !op.cooldownMin) return undefined;
	const left = Math.ceil((last + op.cooldownMin * 60_000 - now) / 60_000);
	return left > 0 ? `${left} 分钟后可以再${op.name}` : undefined;
}

/** 定位本身是否可信：精度够不够、和上一次定位比有没有“瞬移” */
export function fixProblem(state: PlayerState, lat: number, lon: number, acc: number, now: number): string | undefined {
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return '定位无效。';
	if (!Number.isFinite(acc) || acc < 0 || acc > FIX_RULES.maxAccuracyM) return `定位精度不够（误差 ${Math.round(acc)} 米），到开阔处再试。`;
	const f = state.fix;
	if (f) {
		const km = haversineKm(f.lat, f.lon, lat, lon);
		const hours = Math.max(now - f.at, 60_000) / 3_600_000;
		if (km > FIX_RULES.speedFreeKm && km / hours > FIX_RULES.maxSpeedKmh) {
			const wait = Math.ceil(((km / FIX_RULES.maxSpeedKmh) * 3_600_000 - (now - f.at)) / 60_000);
			return `定位跳得太快（${Math.round(km)} 公里），${wait} 分钟后再试。`;
		}
	}
	return undefined;
}

export interface NearbyOp {
	op: VenueOpDef;
	outcome: OpOutcome | null; // 上班为 null
	blocked?: string;
	voids?: string; // 上班：这里打不了新卡，但点一下能作废过期的旧卡；值是打不了新卡的原因
}

export interface NearbyVenue {
	venue: Venue;
	type: VenueTypeDef;
	distM: number;
	inRange: boolean;
	ops: NearbyOp[];
}

/** 真实坐标附近的地点（默认 1.5 公里内），按距离排序；在判定半径内的才能做事 */
export function venuesNear(state: PlayerState, region: Region, lat: number, lon: number, acc: number, now: number, maxM = 1500): NearbyVenue[] {
	const slack = Math.min(Number.isFinite(acc) ? acc : 0, FIX_RULES.accuracySlackM);
	const out: NearbyVenue[] = [];
	for (const venue of region.venues) {
		const type = getVenueType(venue.type);
		if (!type) continue;
		const distM = Math.round(haversineKm(lat, lon, venue.lat, venue.lon) * 1000);
		if (distM > maxM) continue;
		const ops = type.ops.map((id) => {
			const op = getVenueOp(id)!;
			if (id === 'work') {
				const blocked = workBlocked(state, type, venue, now);
				// 和 work() 一致：别处的卡已过期时，这里就算上不了班也能点，用来作废旧卡
				return blocked && clockStale(state, now) ? { op, outcome: null, voids: blocked } : { op, outcome: null, blocked };
			}
			const outcome = opOutcome(state, id, type, venue);
			return { op, outcome, blocked: cooldownLeft(state, op, now) ?? outcome?.blocked };
		});
		out.push({ venue, type, distM, inRange: distM <= type.radiusM + slack, ops });
	}
	return out.sort((a, b) => a.distM - b.distM);
}

/** 上班卡是否已经过期（太久没打下班卡） */
export function clockStale(state: PlayerState, now: number): boolean {
	return !!state.clockIn && now - state.clockIn.at > FIX_RULES.clockInStaleMin * 60_000;
}

function workBlocked(state: PlayerState, type: VenueTypeDef, venue: Venue, now: number): string | undefined {
	if (state.clockIn?.venue === venue.id) return undefined; // 可以打下班卡
	if (!workTerms(state, type)) return '这里需要对应的职业才能上班';
	const today = realDayOf(now);
	if (state.realWork.day === today && state.realWork.min >= FIX_RULES.dayMaxMin) return `今天已经计满 ${FIX_RULES.dayMaxMin / 60} 小时`;
	return undefined;
}

export interface VenueRequest {
	venue: string;
	op: VenueOp;
	lat: number;
	lon: number;
	acc: number;
}

/**
 * 在真实地点做一件事。检查顺序：有没有待处理事件 → 地点和动作存在 → 定位可信 → 人在判定半径内 → 游戏里也在这个地点 → 冷却。
 * 成功后记下这次定位（坐标保留 3 位小数），用于下一次的速度检查。
 */
export function venueAction(prev: PlayerState, region: Region, req: VenueRequest, now: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!Number.isFinite(now) || now <= 0) return fail(prev, '真实地点需要联网才能用。');
	const venue = region.venues.find((v) => v.id === req.venue);
	const type = venue ? getVenueType(venue.type) : undefined;
	if (!venue || !type) return fail(prev, '没有这个地点。');
	const op = getVenueOp(req.op);
	if (!op || !type.ops.includes(req.op)) return fail(prev, `${type.name}不能${op?.name ?? '这样做'}。`);
	const bad = fixProblem(prev, req.lat, req.lon, req.acc, now);
	if (bad) return fail(prev, bad);
	const distM = Math.round(haversineKm(req.lat, req.lon, venue.lat, venue.lon) * 1000);
	const reach = type.radiusM + Math.min(req.acc, FIX_RULES.accuracySlackM);
	if (distM > reach) return fail(prev, `你离${venue.name}还有 ${distM - type.radiusM} 米。`);
	if (prev.loc !== venue.loc) return fail(prev, `先用真实定位抵达${getLocation(region, venue.loc)?.name ?? venue.loc}。`);

	const r = req.op === 'work' ? work(prev, region, venue, type, now) : simpleOp(prev, region, venue, type, op, now);
	if (r.ok) r.state.fix = { lat: Math.round(req.lat * 1000) / 1000, lon: Math.round(req.lon * 1000) / 1000, at: now };
	return r;
}

function simpleOp(prev: PlayerState, region: Region, venue: Venue, type: VenueTypeDef, op: VenueOpDef, now: number): ActionResult {
	const cd = cooldownLeft(prev, op, now);
	if (cd) return fail(prev, cd);
	const out = opOutcome(prev, op.id, type, venue)!;
	if (out.blocked) return fail(prev, out.blocked);
	const state = clone(prev);
	// 先流逝时间再结算（applyEffect 内部顺序），所以时长单独传
	state.venueCd[op.id] = now; // 晕倒也算来过一次，冷却照常
	if (applyEffect(state, { ...out.fx, minutes: op.minutes }, region)) return collapsedResult(state);
	if (op.id === 'train') addMoodlet(state, 'sore'); // 练完 12 小时内再练只有一半效果（超量恢复）
	const msg = `在${venue.name}${op.name}：${out.notes.join('，')}。`;
	log(state, msg);
	return { ok: true, state, msg: msg + venueEvent(state, type, now) };
}

/** 做完一件事后可能遇到事件：同一时间只有一个，现实里至少隔 eventGapMin 分钟 */
function venueEvent(state: PlayerState, type: VenueTypeDef, now: number): string {
	if (state.pending || now - state.venueEvAt < FIX_RULES.eventGapMin * 60_000) return '';
	const ev = pickVenueEvent(state, type.id, FIX_RULES.eventChance);
	if (!ev) return '';
	state.pending = { eventId: ev.id };
	state.venueEvAt = now;
	return ` 这时：${ev.icon} ${ev.title}。`;
}

/** 打卡上班 / 下班。第一次点是上班卡，同一地点再点是下班卡，按真实停留时长计薪 */
function work(prev: PlayerState, region: Region, venue: Venue, type: VenueTypeDef, now: number): ActionResult {
	const state = clone(prev);
	const ci = state.clockIn;
	const stale = clockStale(state, now);
	if (ci && ci.venue === venue.id && !workTerms(state, type)) {
		// 打上班卡之后辞职或换了工作：不管待了多久、卡有没有过期，下班卡都能打，只是不计薪，不然这张卡会一直挂着
		state.clockIn = null;
		log(state, `在${venue.name}打了下班卡，但你已经不在这里工作，这次不计薪。`);
		return { ok: true, state, msg: '你已经不在这里工作，这次不计薪。' };
	}
	if (!ci || ci.venue !== venue.id || stale) {
		const why = workBlocked({ ...state, clockIn: null }, type, venue, now);
		if (why) {
			if (!stale) return fail(prev, why);
			// 过期的卡不管能不能开始新的一班都作废
			state.clockIn = null;
			log(state, '上一张上班卡太久没打下班卡，作废了。');
			return { ok: true, state, msg: `上一张上班卡太久没打下班卡，作废了。${why}，没有打上新的卡。` };
		}
		const voided = ci ? (stale ? '上一张上班卡太久没打下班卡，作废了。' : '上一张别处的上班卡作废了。') : '';
		state.clockIn = { venue: venue.id, at: now };
		const msg = `${voided}在${venue.name}打了上班卡。离开前在这里再打一次下班卡，至少待 ${FIX_RULES.clockInMinMin} 分钟。`;
		log(state, `在${venue.name}打了上班卡。`);
		return { ok: true, state, msg };
	}
	const elapsed = Math.floor((now - ci.at) / 60_000);
	if (elapsed < FIX_RULES.clockInMinMin) return fail(prev, `才待了 ${elapsed} 分钟，至少 ${FIX_RULES.clockInMinMin} 分钟才计薪。`);
	const terms = workTerms(state, type)!; // 没有任职资格的情况在上面已经清卡返回
	const today = realDayOf(now);
	if (state.realWork.day !== today) state.realWork = { day: today, min: 0 };
	const minutes = Math.min(elapsed, FIX_RULES.shiftMaxMin, FIX_RULES.dayMaxMin - state.realWork.min);
	state.clockIn = null;
	if (minutes <= 0) {
		log(state, `在${venue.name}打了下班卡，今天的计薪时长已满。`);
		return { ok: true, state, msg: `今天已经计满 ${FIX_RULES.dayMaxMin / 60} 小时，这次不计薪。` };
	}
	const w = workPay(state, terms.hourly, minutes, terms.skill);
	const hours = minutes / 60;
	state.realWork.min += minutes;
	// 途中晕倒：工资不发、不算班次、不抽事件
	if (applyEffect(state, { minutes, cash: w.pay, needs: { energy: -w.energy, fun: -Math.round(hours * 2), social: Math.round(hours * 3) } }, region)) return collapsedResult(state);
	let msg = `在${venue.name}上班 ${Math.round(hours * 10) / 10} 小时，收入 $${w.pay}（${w.notes.join('，')}）。`;
	const job = state.job;
	const c = job ? getCareer(job.career) : undefined;
	if (terms.career && job && c && minutes >= c.minutes / 2 && job.lastDay !== dayOf(prev.clock)) {
		// 实地上满半个班，算作职业的一个班次：能升职，但当天游戏里不能再上班
		applyEffect(state, { skills: c.shift.skills }, region);
		job.shifts++;
		if (w.perf >= 1) job.good++;
		job.lastDay = state.workDay = dayOf(prev.clock);
		msg += ` 算作一个班次${w.perf >= 1 ? '（表现出色）' : ''}。` + tryPromote(state);
	}
	log(state, msg);
	return { ok: true, state, msg: msg + venueEvent(state, type, now) };
}
