// 自然灾害（第 43 批）：山火、洪水封路、热带气旋、热浪、停电。设计见 docs/earth-game/disasters.md，数据在 data/disasters.ts。
// 和天气一样只由「地点 + 游戏日」决定：所有玩家看到的一样、能提前看到，不用存档种子，不进存档。
// 纯函数：不读时钟、不用 Math.random；往前、往后看的天数都有上限，任何一天都能单独算出来。
// 这里是游戏里的模拟，不是真实预警；界面上要写明，并链到真实发布机构。
import { dayOf } from './time.ts';
import { fireDanger, isCoastal, realDayOfYear } from './sky.ts';
import { unit, weatherOn } from './weather.ts';
import type { GameLocation, PlayerState, Region } from './types.ts';
import { DISASTER_RULES as R, HAZARDS, KIT_ITEM, WARN_LEVELS, type HazardId, type WarnLevel } from '../data/disasters.ts';

export interface Warning {
	hazard: HazardId;
	level: WarnLevel;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 游戏日 → 对应现实的月份 0–11（和 sky.ts 的山火季同一套换算） */
export function monthOfDay(day: number): number {
	let d = realDayOfYear(day * 1440);
	let m = 0;
	while (m < 11 && d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
	return m;
}

const wx = (loc: GameLocation, day: number) => weatherOn(loc.id, day).id;

// ---------- 各灾害 ----------
/** 这天这里有没有起山火：0 没有，2 注意并行动，3 紧急警告 */
function fireOn(loc: GameLocation, day: number): 0 | 2 | 3 {
	if (!R.bushfire.kinds.includes(loc.kind) || (R.bushfire.exclude as readonly string[]).includes(loc.id)) return 0;
	const f = fireDanger(loc, day * 1440, wx(loc, day)).id;
	const r = unit(`bushfire|${loc.id}|${day}`);
	if (f === 'catastrophic' && r < R.bushfire.igniteCatastrophic) return 3;
	if (f === 'extreme' && r < R.bushfire.igniteExtreme) return 2;
	return 0;
}
export function bushfireLevel(loc: GameLocation, day: number): WarnLevel | 0 {
	const today = fireOn(loc, day);
	if (today) return today;
	return fireOn(loc, day - 1) ? 1 : 0; // 前一天起过火：余火，降为提示
}

export function floodLevel(loc: GameLocation, day: number): WarnLevel | 0 {
	if (loc.lat <= R.flood.latAbove) return 0;
	if (!(R.flood.months as readonly number[]).includes(monthOfDay(day))) return 0;
	let storms = 0;
	for (let d = day - R.flood.lookback + 1; d <= day; d++) if (wx(loc, d) === 'storm') storms++;
	const today = wx(loc, day) === 'storm';
	if (today && storms >= 2) return 3;
	if (today) return 2;
	return storms ? 1 : 0;
}

/** 这天这里是不是气旋过境日 */
function cycloneDay(loc: GameLocation, day: number): boolean {
	if (!(R.cyclone.locs as readonly string[]).includes(loc.id)) return false;
	if (!(R.cyclone.months as readonly number[]).includes(monthOfDay(day))) return false;
	return wx(loc, day) === 'storm' && unit(`cyclone|${loc.id}|${day}`) < R.cyclone.chance;
}
export function cycloneLevel(loc: GameLocation, day: number): WarnLevel | 0 {
	if (cycloneDay(loc, day)) return 3;
	if (cycloneDay(loc, day + 1)) return 2;
	if (cycloneDay(loc, day + 2) || cycloneDay(loc, day - 1)) return 1;
	return 0;
}

/** 截至这天连续炎热了几天（最多看 lookback 天） */
export function hotRun(loc: GameLocation, day: number): number {
	let n = 0;
	while (n < R.heatwave.lookback && wx(loc, day - n) === 'hot') n++;
	return n;
}
export function heatwaveLevel(loc: GameLocation, day: number): WarnLevel | 0 {
	const run = hotRun(loc, day);
	const inland = !isCoastal(loc);
	if (run >= R.heatwave.emergencyRun && inland) return 3;
	if (run >= R.heatwave.watchRun || (run >= R.heatwave.minRun && inland)) return 2;
	return run >= R.heatwave.minRun ? 1 : 0;
}

/** 停电跟着别的灾害来，不单独起 */
export function outageLevel(loc: GameLocation, day: number, others: { bushfire: number; cyclone: number; heatwave: number }): WarnLevel | 0 {
	if (others.cyclone >= 3 || others.bushfire >= 3) return 2;
	const r = unit(`outage|${loc.id}|${day}`);
	if (others.cyclone >= 2 && r < R.outage.cycloneWatchChance) return 1;
	if (others.heatwave >= 2 && r < R.outage.heatChance) return 1;
	if (loc.kind !== 'city' && wx(loc, day) === 'storm' && r < R.outage.stormChance) return 1;
	return 0;
}

/** 这天这里的所有预警，级别高的在前 */
export function warningsOn(loc: GameLocation, day: number): Warning[] {
	const lv = {
		bushfire: bushfireLevel(loc, day),
		flood: floodLevel(loc, day),
		cyclone: cycloneLevel(loc, day),
		heatwave: heatwaveLevel(loc, day),
	};
	const outage = outageLevel(loc, day, lv);
	const all: [HazardId, WarnLevel | 0][] = [['cyclone', lv.cyclone], ['bushfire', lv.bushfire], ['flood', lv.flood], ['heatwave', lv.heatwave], ['outage', outage]];
	return all.filter((x): x is [HazardId, WarnLevel] => x[1] > 0).map(([hazard, level]) => ({ hazard, level })).sort((a, b) => b.level - a.level);
}

/** 这条预警是否达到某个门槛 */
const reaches = (w: Warning, at: WarnLevel | undefined) => at !== undefined && w.level >= at;
export const warnTitle = (w: Warning) => `${HAZARDS[w.hazard].icon} ${HAZARDS[w.hazard].name} · ${WARN_LEVELS[w.level].name}`;

// ---------- 玩家应对：封路、户外关闭、停工、停电 ----------
/** 这趟路线今天走不走得了；走不了返回原因。from 端的「只封进来方向」的灾害不拦（留着撤离的路） */
export function routeClosed(from: GameLocation, to: GameLocation, mode: string, day: number): string | undefined {
	if (mode === 'ferry') return undefined; // 渡轮看风暴（data/weather.ts），这里不重复
	const key = mode === 'air' ? 'closeAir' : mode === 'track' ? 'closeTrack' : 'closeRoad';
	for (const [end, loc] of [['to', to], ['from', from]] as const) {
		for (const w of warningsOn(loc, day)) {
			const h = HAZARDS[w.hazard];
			if (!reaches(w, h[key])) continue;
			if (end === 'from' && h.inboundOnly) continue;
			const what = mode === 'air' ? '航班停飞' : mode === 'track' ? '土路封闭' : '公路封闭';
			return `${loc.name}${h.name}${WARN_LEVELS[w.level].name}，${what}`;
		}
	}
	return undefined;
}

/** 某个活动今天在这里是不是因为灾害关闭 */
export function activityClosed(loc: GameLocation, day: number, actId: string): string | undefined {
	for (const w of warningsOn(loc, day)) {
		const h = HAZARDS[w.hazard];
		if (reaches(w, h.closeOutdoor) && h.outdoor?.includes(actId)) return `${h.name}${WARN_LEVELS[w.level].name}，户外活动暂停`;
	}
	return undefined;
}

/** 这里今天是否停工 */
export function workStopped(loc: GameLocation, day: number): string | undefined {
	for (const w of warningsOn(loc, day)) {
		const h = HAZARDS[w.hazard];
		if (reaches(w, h.stopWork)) return `${h.name}${WARN_LEVELS[w.level].name}，今天停工`;
	}
	return undefined;
}

/** 停电时在家做不了饭，除非带着应急包（里面有不用电的炉头） */
export function outageBlocksCook(state: PlayerState, loc: GameLocation, day: number): string | undefined {
	if (!warningsOn(loc, day).some((w) => w.hazard === 'outage')) return undefined;
	return (state.inventory[KIT_ITEM] ?? 0) > 0 ? undefined : '停电了，电炉用不了（应急包里有炉头）';
}

/** 撤离去处：从这里今天还能走的路线里，挑没有「注意并行动」以上预警、最近的地点；没有返回 null */
export function evacuationTarget(region: Region, loc: GameLocation, day: number): GameLocation | null {
	let best: { to: GameLocation; km: number } | null = null;
	for (const r of region.routes) {
		const toId = r.a === loc.id ? r.b : r.b === loc.id ? r.a : null;
		const to = toId ? region.locations.find((l) => l.id === toId) : undefined;
		if (!to || routeClosed(loc, to, r.mode, day)) continue;
		if (warningsOn(to, day).some((w) => w.level >= 2)) continue;
		const km = Math.hypot(to.lat - loc.lat, (to.lon - loc.lon) * Math.cos((loc.lat * Math.PI) / 180));
		if (!best || km < best.km || (km === best.km && to.id < best.to.id)) best = { to, km };
	}
	return best?.to ?? null;
}

/** 玩家此刻所在地点的预警 */
export function warningsAt(state: PlayerState, region: Region): Warning[] {
	const loc = region.locations.find((l) => l.id === state.loc);
	return loc ? warningsOn(loc, dayOf(state.clock)) : [];
}

// ---------- 保险理赔接口（只提供数据，不改存档；保险分支来接） ----------
export interface DisasterIncident {
	hazard: HazardId;
	level: WarnLevel;
	loc: string;
	day: number;
	/** 可能受影响的财产：租/住的房子在灾区、车停在灾区（按玩家当天结束时所在地点近似） */
	assets: ('home' | 'vehicle')[];
}

/** 能报案的灾害：气旋、山火、洪水的紧急警告。热浪、停电不算财产损失 */
export const CLAIMABLE: readonly HazardId[] = ['cyclone', 'bushfire', 'flood'];

/**
 * [fromDay, toDay] 之间，玩家的住处或车所在地点遇到的可报案灾害。
 * 只返回事实（哪天、哪种、多严重、涉及哪样财产），赔不赔、赔多少由保险规则决定。
 * 车的位置按「现在所在地点」近似（存档里没有逐日位置），调用方需要更精确时自己传 vehicleLoc。
 */
export function incidentsFor(state: PlayerState, region: Region, fromDay: number, toDay: number, vehicleLoc: string = state.loc): DisasterIncident[] {
	const out: DisasterIncident[] = [];
	const span = Math.max(0, Math.min(toDay - fromDay, 366)); // 一次最多查一年
	const places = new Map<string, ('home' | 'vehicle')[]>();
	if (state.home) places.set(state.home.loc, ['home']);
	if (state.vehicle && state.vehicle !== 'none') places.set(vehicleLoc, [...(places.get(vehicleLoc) ?? []), 'vehicle']);
	for (const [locId, assets] of places) {
		const loc = region.locations.find((l) => l.id === locId);
		if (!loc) continue;
		for (let day = fromDay; day <= fromDay + span; day++) {
			for (const w of warningsOn(loc, day)) if (w.level === 3 && CLAIMABLE.includes(w.hazard)) out.push({ hazard: w.hazard, level: w.level, loc: locId, day, assets });
		}
	}
	return out.sort((a, b) => a.day - b.day || a.loc.localeCompare(b.loc) || a.hazard.localeCompare(b.hazard));
}
