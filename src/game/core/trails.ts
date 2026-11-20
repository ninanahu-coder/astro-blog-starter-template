// 主要路线（实地路线）：玩家本人拿着手机按顺序走过几个真实地点，到站和沿途触发事件。设计见 docs/earth-game/gps-route-design.md。
// 纯函数：现实时间 now（毫秒）由服务端传入；坐标来自手机，可以伪造，所以沿用真实地点的精度和瞬移检查（fixProblem），
// 再加上站与站之间的平均速度检查。存档里只记每条路线到了第几站，不记轨迹。
import { addLog, addMoodlet, applyEffect, clone, collapsedResult, fail, getLocation } from './engine.ts';
import { haversineKm, locateInRegion } from './geo.ts';
import { fixProblem } from './venues.ts';
import { EVENTS } from '../data/events.ts';
import { FIX_RULES } from '../data/venues.ts';
import { TRAIL_RULES, TRAILS, type TrailDef, type TrailStop } from '../data/trails.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

export interface TrailRequest {
	lat: number;
	lon: number;
	acc: number;
}

/** 一条路线在这个角色身上的进度：到了几站、这一段的沿途事件出没出、到上一站的服务端时间（0 表示还没出发） */
export interface TrailProgress {
	at: number;
	leg: boolean;
	t: number;
}

const NONE: TrailProgress = { at: 0, leg: false, t: 0 };

export const trailProgress = (state: PlayerState, id: string): TrailProgress => (Object.hasOwn(state.trails, id) ? state.trails[id] : NONE);
export const trailDone = (state: PlayerState, t: TrailDef): boolean => trailProgress(state, t.id).at >= t.stops.length;
/** 主线进行到这条路线的章节才开放（写完的章节对应的路线一直开放） */
export const trailOpen = (state: PlayerState, t: TrailDef): boolean => state.story.ch >= t.chapter;

/** 到站判定半径（米）：站半径 + 定位误差，误差最多算 FIX_RULES.accuracySlackM */
export const stopReach = (stop: TrailStop, acc: number): number => (stop.radiusM ?? TRAIL_RULES.stopRadiusM) + Math.min(Math.max(0, acc), FIX_RULES.accuracySlackM);

export const distM = (a: { lat: number; lon: number }, lat: number, lon: number): number => Math.round(haversineKm(a.lat, a.lon, lat, lon) * 1000);

/**
 * 点 p 在线段 a→b 上的位置：t 是投影沿线段的比例（不钳制，<0 在 a 之前，>1 过了 b），offM 是离线段（钳到端点）的距离。
 * 在 a 点附近的局部平面上算，几公里内误差可以忽略。
 */
export function legProgress(a: { lat: number; lon: number }, b: { lat: number; lon: number }, p: { lat: number; lon: number }): { t: number; offM: number } {
	const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
	const ky = 110_540;
	const bx = (b.lon - a.lon) * kx;
	const by = (b.lat - a.lat) * ky;
	const px = (p.lon - a.lon) * kx;
	const py = (p.lat - a.lat) * ky;
	const len2 = bx * bx + by * by;
	const t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
	const c = Math.min(1, Math.max(0, t));
	return { t, offM: Math.hypot(px - c * bx, py - c * by) };
}

/** 从上一站（服务端时间 since）到这里的平均速度太快时返回原因 */
function tooFast(from: TrailStop, lat: number, lon: number, since: number, now: number): string | undefined {
	if (!since) return undefined;
	const km = haversineKm(from.lat, from.lon, lat, lon);
	const hours = Math.max(now - since, 1000) / 3_600_000;
	const kmh = km / hours;
	if (kmh <= TRAIL_RULES.maxKmh) return undefined;
	const wait = Math.ceil(((km / TRAIL_RULES.maxKmh) * 3_600_000 - (now - since)) / 60_000);
	return `从${from.name}过来太快了（平均约 ${Math.round(kmh)} 公里/小时），路线要真的走过去；${wait} 分钟后再试。`;
}

export interface TrailView {
	trail: TrailDef;
	open: boolean;
	done: boolean;
	at: number;
	next?: TrailStop;
}

/** 这个区域里的路线和进度（界面用）：开放的在前，按数据顺序 */
export function trailsIn(state: PlayerState, region: Region): TrailView[] {
	const locs = new Set(region.locations.map((l) => l.id));
	return TRAILS.filter((t) => locs.has(t.loc))
		.map((trail) => {
			const at = Math.min(trailProgress(state, trail.id).at, trail.stops.length);
			return { trail, open: trailOpen(state, trail), done: at >= trail.stops.length, at, next: trail.stops[at] };
		})
		.sort((a, b) => Number(b.open) - Number(a.open));
}

const eventExists = (id: string | undefined): id is string => !!id && EVENTS.some((e) => e.id === id);

/**
 * 用一次真实定位推进路线。检查顺序：待处理事件 → 联网（服务端时间）→ 定位可信（精度、瞬移、精度可疑）→ 有开放的路线 → 游戏里人在路线所在城市
 * → 到站（含站间速度）→ 沿途 → 都不是就告诉玩家离下一站多远。一次动作只推进一条路线的一件事。
 * 成功后记下这次定位（坐标保留 3 位小数），和真实地点共用，用于下一次的瞬移检查。
 */
export function trailStep(prev: PlayerState, region: Region, req: TrailRequest, now: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!Number.isFinite(now) || now <= 0) return fail(prev, '走路线需要联网。');
	const bad = fixProblem(prev, req.lat, req.lon, req.acc, now);
	if (bad) return fail(prev, bad);
	if (req.acc < TRAIL_RULES.minAccuracyM) return fail(prev, '定位数据异常，请关掉模拟定位后再试。');
	const live = trailsIn(prev, region).filter((v) => v.open && !v.done && v.next);
	if (!live.length) return fail(prev, '现在没有能走的路线。');
	// 人已经在另一座有路线的城市，游戏里还没过去：先用真实定位抵达那里（页面会自动先发一次 gps）
	const hit = locateInRegion(region, req.lat, req.lon);
	if (hit && hit.id !== prev.loc && live.some((v) => v.trail.loc === hit.id)) return fail(prev, `先用真实定位抵达${getLocation(region, hit.id)?.name ?? hit.id}。`);
	const here = live.filter((v) => v.trail.loc === prev.loc);
	if (!here.length) {
		const near = live.reduce((a, b) => (distM(b.next!, req.lat, req.lon) < distM(a.next!, req.lat, req.lon) ? b : a));
		return fail(prev, `先用真实定位抵达${getLocation(region, near.trail.loc)?.name ?? near.trail.loc}。`);
	}
	// 到站
	for (const v of here) {
		const stop = v.next!;
		if (distM(stop, req.lat, req.lon) > stopReach(stop, req.acc)) continue;
		const p = trailProgress(prev, v.trail.id);
		const fast = v.at > 0 ? tooFast(v.trail.stops[v.at - 1], req.lat, req.lon, p.t, now) : undefined;
		if (fast) return fail(prev, fast);
		return arriveStop(prev, region, v.trail, v.at, req, now);
	}
	// 沿途
	for (const v of here) {
		const p = trailProgress(prev, v.trail.id);
		const stop = v.next!;
		if (v.at === 0 || p.leg || !eventExists(stop.along)) continue;
		const from = v.trail.stops[v.at - 1];
		const g = legProgress(from, stop, req);
		if (g.offM > TRAIL_RULES.corridorM || g.t < TRAIL_RULES.alongFrom || g.t > TRAIL_RULES.alongTo) continue;
		const fast = tooFast(from, req.lat, req.lon, p.t, now);
		if (fast) return fail(prev, fast);
		const state = clone(prev);
		state.trails[v.trail.id] = { ...p, leg: true };
		state.pending = { eventId: stop.along };
		addLog(state, `在去${stop.name}的路上。`);
		return done(state, req, now, `🚶 ${v.trail.title}：在去${stop.name}的路上……`);
	}
	const v = here.reduce((a, b) => (distM(b.next!, req.lat, req.lon) < distM(a.next!, req.lat, req.lon) ? b : a));
	const left = Math.max(0, distM(v.next!, req.lat, req.lon) - (v.next!.radiusM ?? TRAIL_RULES.stopRadiusM));
	return fail(prev, `离「${v.next!.name}」还有 ${left} 米。`);
}

function arriveStop(prev: PlayerState, region: Region, trail: TrailDef, at: number, req: TrailRequest, now: number): ActionResult {
	const stop = trail.stops[at];
	const state = clone(prev);
	// 晕倒（体力本来就见底）：这一站不算，进度不变
	if (applyEffect(state, { ...stop.fx, minutes: TRAIL_RULES.stopMinutes }, region)) {
		const r = collapsedResult(state);
		return done(r.state, req, now, r.msg, true);
	}
	const last = at + 1 >= trail.stops.length;
	state.trails[trail.id] = { at: at + 1, leg: false, t: now };
	addLog(state, `${trail.title}：到了${stop.name}。${stop.text}`);
	let msg = `📍 ${trail.title} ${at + 1}/${trail.stops.length}：到了${stop.name}。`;
	if (last) {
		// 路线奖励直接入账（不花时间，同主线章节奖励）
		const fx = trail.reward;
		if (fx.cash) state.cash = Math.round(state.cash + fx.cash);
		if (fx.respect) state.respect += fx.respect;
		if (fx.moodlet) addMoodlet(state, fx.moodlet);
		const got = `${fx.cash ? ` +$${fx.cash}` : ''}${fx.respect ? `，声望 +${fx.respect}` : ''}`;
		addLog(state, `🚶 走完了「${trail.title}」：${trail.outro}${got}`);
		msg += ` 路线走完！${got}`;
	}
	if (eventExists(stop.event)) state.pending = { eventId: stop.event };
	return done(state, req, now, msg);
}

function done(state: PlayerState, req: TrailRequest, now: number, msg: string, collapsed = false): ActionResult {
	state.fix = { lat: Math.round(req.lat * 1000) / 1000, lon: Math.round(req.lon * 1000) / 1000, at: now };
	return collapsed ? { ok: true, state, msg, collapsed } : { ok: true, state, msg };
}
