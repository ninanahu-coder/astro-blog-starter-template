// 天气：由「地点 + 游戏日」确定，所有玩家看到的一样，不用存档里的随机种子（种子是私密的，天气要能公开预报）。
// 第 30 批：概率按地点参照的真实气象站的当月气候平均推出（data/climate.ts），并加上「连着几天」的惯性。
// 纯函数：不读时钟、不用 Math.random；同一地点同一天，任何时候算出来都一样。
import { dayOf } from './time.ts';
import { realDayOfYear } from './sky.ts';
import type { PlayerState } from './types.ts';
import { WEATHERS, type WeatherDef } from '../data/weather.ts';
import { CLIMATE_ZONES, DEFAULT_STATION, LOC_STATION, MONTH_DAYS, STATIONS, WEATHER_MODEL, type ClimateStation } from '../data/climate.ts';

/** FNV-1a 32 位哈希 → [0, 1) */
export function unit(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	// 末尾再混一遍（murmur3 的 fmix32）：只差一位数字的相邻日子，FNV 本身的低位分布不够均匀
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b) >>> 0;
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35) >>> 0;
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

// ---------- 游戏日 → 现实月份 ----------
// 和气温、日出日落用同一套对应（sky.ts 的 realDayOfYear）：游戏一季 28 天按比例对应现实一季，南半球春 9–11 月、夏 12–2 月、秋 3–5 月、冬 6–8 月。
// （sky.ts 也从这里引 unit：两个模块互相引用，但都只在函数里用对方，不在模块顶层调用，加载顺序无所谓。）
/** 某个游戏日（dayOf 的返回值）对应现实的几月（1–12） */
export function realMonth(day: number): number {
	let d = realDayOfYear(day * 1440);
	let m = 0;
	while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
	return m + 1;
}

// ---------- 地点 → 气象站 ----------
export const stationId = (locId: string) => (Object.hasOwn(LOC_STATION, locId) ? LOC_STATION[locId] : DEFAULT_STATION);
export const stationOf = (locId: string): ClimateStation => STATIONS[stationId(locId)];
/** 给界面看的：这里属于哪个气候区、参照哪个站 */
export function climateOf(locId: string) {
	const st = stationOf(locId);
	return { zone: st.zone, zoneName: CLIMATE_ZONES[st.zone].name, zoneDesc: CLIMATE_ZONES[st.zone].desc, station: st.name, stationId: stationId(locId) };
}

// ---------- 气候平均 → 当月天气权重 ----------
const clamp01 = (x: number, max = 1) => Math.max(0, Math.min(max, x));
/** 某站某月（1–12）各种天气的概率（合计 1，只列大于 0 的），换算办法见 data/climate.ts 的 WEATHER_MODEL */
export function monthWeights(st: ClimateStation, month: number): [string, number][] {
	const m = WEATHER_MODEL;
	const i = month - 1;
	const days = MONTH_DAYS[i];
	const wet = clamp01(st.rainDays[i] / days);
	const stormShare = st.cyclone && (m.cycloneMonths as readonly number[]).includes(month) ? m.cycloneStormShare : m.stormShare;
	const storm = wet * stormShare;
	const rain = wet - storm;
	const cloudy = (1 - wet) * clamp01(st.cloudyDays[i] / days);
	const clear = 1 - wet - cloudy;
	const hot = clear * clamp01((st.tmax[i] - m.hot.from) / m.hot.span, m.hot.max);
	const cold = (clear - hot) * clamp01((m.cold.from - st.tmin[i]) / m.cold.span, m.cold.max);
	const sunny = clear - hot - cold;
	const out: [string, number][] = [['sunny', sunny], ['cloudy', cloudy], ['hot', hot], ['cold', cold], ['rain', rain], ['storm', storm]];
	return out.filter(([, w]) => w > 1e-9);
}
const cache = new Map<string, [string, number][]>();
/** 某地点某个游戏日的天气概率表（同站同月只算一次） */
export function weightsOn(locId: string, day: number): [string, number][] {
	const key = `${stationId(locId)}|${realMonth(day)}`;
	let t = cache.get(key);
	if (!t) cache.set(key, (t = monthWeights(STATIONS[stationId(locId)], realMonth(day))));
	return t;
}

/** 不看前一天、只按当天概率表抽的天气 id */
function freshOn(locId: string, day: number): string {
	const table = weightsOn(locId, day);
	let r = unit(`${locId}|${day}`);
	for (const [id, w] of table) {
		r -= w;
		if (r < 0) return id;
	}
	return table[table.length - 1][0];
}

const byId = new Map(WEATHERS.map((w) => [w.id, w]));
/**
 * 某地点在某个游戏日（dayOf 的返回值）的天气。
 * 惯性：从 persistDays 天前开始往后推，每天有 persist 的概率沿用前一天（前提是这种天气这天的概率表里还有），否则按当天的表重新抽。
 * 前一天本身就是按同一张表抽的，所以长期看各种天气的比例不变，只是会连成几天。往前看的天数有上限，任何一天都能单独算。
 */
export function weatherOn(locId: string, day: number): WeatherDef {
	let id = freshOn(locId, day - WEATHER_MODEL.persistDays);
	for (let d = day - WEATHER_MODEL.persistDays + 1; d <= day; d++) {
		const keep = unit(`keep|${locId}|${d}`) < WEATHER_MODEL.persist && weightsOn(locId, d).some(([x]) => x === id);
		if (!keep) id = freshOn(locId, d);
	}
	return byId.get(id)!;
}

/** 玩家此刻所在地点的天气 */
export const weatherAt = (state: PlayerState) => weatherOn(state.loc, dayOf(state.clock));

/** 从某个游戏日起连续 n 天的预报（今天算第 1 天） */
export const forecast = (locId: string, day: number, n = 3): WeatherDef[] => Array.from({ length: n }, (_, k) => weatherOn(locId, day + k));
