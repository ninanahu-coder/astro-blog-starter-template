// 公共交通与步行（第 32 批）：纯函数，只读入参，不改 state。
// 引擎的 travelOptions 在原有路线走法（自驾/巴士/土路/航班/渡轮）之外，叠加这里算出的公交、区域火车和步行；
// 已有渡轮路线的票价也在这里按真实票价表替换（priceRoute 本身不动，免得和天气路况的改动打架）。
// 设计与出处见 docs/earth-game/transport-design.md；数据见 data/transport.ts。
import { ROUTE_FARES, TRANSIT, WALK, type TransitService } from '../data/transport.ts';
import { costMult } from './attributes.ts';
import { haversineKm } from './geo.ts';
import { hoursLabel, isOpen, weekdayOf } from './time.ts';
import type { GameLocation, NeedKey, PlayerState, Region, TravelMode } from './types.ts';
import type { TravelOption } from './engine.ts';

/** 公路绕行系数，和 engine.ts 的 priceRoute 一致 */
export const ROAD_FACTOR = 1.25;

const find = (region: Region, id: string): GameLocation | undefined => region.locations.find((l) => l.id === id);
const roadKm = (from: GameLocation, to: GameLocation) => haversineKm(from.lat, from.lon, to.lat, to.lon) * ROAD_FACTOR;
const other = (a: string, b: string, here: string) => (a === here ? b : b === here ? a : null);

/** 游戏里的价钱：真实票价 × 特质乘数，四舍五入到整元（游戏现金是整数） */
export const gamePrice = (state: PlayerState, fare: number) => Math.round(fare * costMult(state));

/** 两地之间已有渡轮路线的真实票价条目（双向） */
export const routeFare = (a: string, b: string) => ROUTE_FARES.find((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));

/** 一条线路今天是否免费（Transperth 周日免费） */
export const isFreeToday = (svc: TransitService, clock: number) => svc.freeWeekday !== undefined && weekdayOf(clock) === svc.freeWeekday;

/** 坐一趟公共交通的分钟数：平均候车 + 公路距离 ÷ 平均车速 */
export const serviceMinutes = (svc: TransitService, km: number) => Math.round(svc.wait + (km / svc.kmh) * 60);

function serviceOption(state: PlayerState, svc: TransitService, from: GameLocation, to: GameLocation): TravelOption {
	const km = roadKm(from, to);
	const free = isFreeToday(svc, state.clock);
	const cost = free ? 0 : gamePrice(state, svc.fare);
	let available = true;
	let reason: string | undefined;
	if (!isOpen(svc.hours, state.clock)) { available = false; reason = `运营时段 ${hoursLabel(svc.hours)}`; }
	else if (state.cash < cost) { available = false; reason = '现金不足'; }
	const note = free ? '今天周日，刷卡免费' : svc.fareNote === 'official' ? `${svc.operator} 真实票价` : `${svc.operator} 票价（按官方数字推算）`;
	return { to: to.id, mode: svc.mode, label: `${svc.icon} ${svc.name}`, km: Math.round(km), minutes: serviceMinutes(svc, km), cost, available, reason, note };
}

/** 步行这一段的分钟数；路太远（超过 WALK.maxKm）返回 null */
export function walkMinutes(km: number): number | null {
	return km > WALK.maxKm ? null : Math.round((km / WALK.kmh) * 60);
}

/**
 * 从玩家所在地出发的公共交通和步行走法。
 * - 公共交通：data/transport.ts 的 TRANSIT 里一端是这里的线路；
 * - 步行：已有路线（region.routes 里的公路）里公路距离 ≤ WALK.maxKm 的，每个目的地一条。
 */
export function transitOptions(state: PlayerState, region: Region): TravelOption[] {
	const here = find(region, state.loc);
	if (!here) return [];
	const out: TravelOption[] = [];
	for (const svc of TRANSIT) {
		const toId = other(svc.a, svc.b, here.id);
		const to = toId ? find(region, toId) : undefined;
		if (to) out.push(serviceOption(state, svc, here, to));
	}
	const walked = new Set<string>();
	for (const r of region.routes) {
		if (r.mode !== 'road') continue;
		const toId = other(r.a, r.b, here.id);
		const to = toId ? find(region, toId) : undefined;
		if (!to || walked.has(to.id)) continue;
		const km = roadKm(here, to);
		const minutes = walkMinutes(km);
		if (minutes === null) continue;
		walked.add(to.id);
		out.push({ to: to.id, mode: 'walk', label: '🚶 步行', km: Math.round(km), minutes, cost: 0, available: true, note: '不花钱，但更累' });
	}
	return out;
}

/** 已有渡轮路线按真实票价重新标价（不动耗时和停航判断）；现金够不够按新价重算 */
export function withRouteFare(state: PlayerState, from: string, opt: TravelOption): TravelOption {
	if (opt.mode !== 'ferry') return opt;
	const f = routeFare(from, opt.to);
	if (!f) return opt;
	const cost = gamePrice(state, f.fare);
	const out: TravelOption = { ...opt, cost, note: f.fareNote === 'official' ? `${f.operator} 真实票价` : `${f.operator} 票价（按官方数字推算）` };
	if (opt.reason === '现金不足' || opt.available) {
		out.available = state.cash >= cost;
		out.reason = out.available ? undefined : '现金不足';
	}
	return out;
}

/** 步行每公里涨的体能 */
export const WALK_STAMINA_PER_KM = WALK.staminaPerKm;

/** 走路途中每分钟额外的需求变化（叠加在正常衰减上）；其他走法没有 */
export function modeNeeds(mode: TravelMode): Partial<Record<NeedKey, number>> | undefined {
	return mode === 'walk' ? WALK.needs : undefined;
}
