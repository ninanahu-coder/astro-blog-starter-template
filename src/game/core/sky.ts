// 天象（第 8 批）：气温、日出日落、潮汐、山火季、紫外线。全部按地点经纬度和游戏日期用公式现场算，不接外部数据。
// 只做显示和提示：不进存档、不影响任何规则和数值（时段、天气效果照旧由 time.ts / weather.ts 决定）。
// 纯函数：不读时钟、不用 Math.random；同一地点同一游戏时刻，所有玩家看到的一样。
import { dateOf, dayOf, SEASON_DAYS } from './time.ts';
import { unit } from './weather.ts';

/** 计算要用到的地点信息（GameLocation 的子集） */
export interface SkyLoc { id: string; lat: number; lon: number; kind: string; tags: string[] }

// ---------- 游戏日期 → 现实里一年中的第几天 ----------
// 游戏一季 28 天，现实一季约 91 天：游戏季内第 d 天对应现实这一季里同样比例的位置。南半球：春 9–11 月、夏 12–2 月、秋 3–5 月、冬 6–8 月。
/** 各季在现实里开始的日子（一年中第几天，0 = 1 月 1 日，按平年）和长度 */
const REAL_SEASON: Record<string, { start: number; len: number }> = {
	spring: { start: 243, len: 91 }, // 9 月 1 日
	summer: { start: 334, len: 90 }, // 12 月 1 日
	autumn: { start: 59, len: 92 }, // 3 月 1 日
	winter: { start: 151, len: 92 }, // 6 月 1 日
};
export function realDayOfYear(clock: number): number {
	const d = dateOf(clock);
	const r = REAL_SEASON[d.season];
	return (r.start + Math.floor(((d.day - 1 + 0.5) * r.len) / SEASON_DAYS)) % 365;
}
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 一年中第几天 → 「12 月 3 日」 */
export function realDateLabel(doy: number): string {
	let d = ((Math.floor(doy) % 365) + 365) % 365;
	let m = 0;
	while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
	return `${m + 1} 月 ${d + 1} 日`;
}

// ---------- 第 36 轮：气温 ----------
// 西澳的气候大致：越往北越热、冬夏差越小；南端奥尔巴尼受南冰洋影响夏天也凉；内陆夏天更热、早晚温差更大。
// 海边地点 1 月、7 月平均最高气温取几个纬度上的大致值（布鲁姆、卡那封、珀斯、奥尔巴尼一带），中间线性插值；内陆夏 +4、冬 −1。
// 一年里按余弦过渡：1 月中最热、7 月中最冷。天气再修正：炎热 +6、多云 −1、小雨 −3、风暴 −5；每天另有 ±2 度起伏（按地点和日子定，所有人一样）。
export interface Temps { max: number; min: number }
export const isCoastal = (l: SkyLoc) => l.tags.includes('beach') || l.kind === 'port' || l.kind === 'island' || l.kind === 'coast';
/** [南纬度数, 1 月平均最高, 7 月平均最高]（海边） */
const CLIMATE: [number, number, number][] = [[18, 33, 29], [25, 32, 24], [32, 31, 19], [35, 25, 16]];
const WX_TEMP: Record<string, number> = { hot: 6, cloudy: -1, rain: -3, storm: -5 };
function climateAt(lat: number): [number, number] {
	const a = Math.min(CLIMATE[CLIMATE.length - 1][0], Math.max(CLIMATE[0][0], -lat));
	let i = 0;
	while (i < CLIMATE.length - 2 && a > CLIMATE[i + 1][0]) i++;
	const [a0, s0, w0] = CLIMATE[i];
	const [a1, s1, w1] = CLIMATE[i + 1];
	const t = (a - a0) / (a1 - a0);
	return [s0 + (s1 - s0) * t, w0 + (w1 - w0) * t];
}
/** 今天的最高、最低气温（°C，整数） */
export function temps(l: SkyLoc, clock: number, weatherId: string): Temps {
	const coast = isCoastal(l);
	const [jan, jul] = climateAt(l.lat);
	const summerMax = jan + (coast ? 0 : 4);
	const winterMax = jul + (coast ? 0 : -1);
	const doy = realDayOfYear(clock);
	const s = (1 + Math.cos((2 * Math.PI * (doy - 15)) / 365)) / 2; // 1 月中 = 1，7 月中 = 0
	const jitter = (unit(`temp|${l.id}|${dayOf(clock)}`) - 0.5) * 4;
	const max = Math.round(winterMax + (summerMax - winterMax) * s + (WX_TEMP[weatherId] ?? 0) + jitter);
	const spread = (coast ? 8 : 14) - (weatherId === 'rain' || weatherId === 'storm' || weatherId === 'cloudy' ? 3 : 0);
	return { max, min: max - spread };
}

// ---------- 第 37 轮：日出日落 ----------
// NOAA 的简化太阳位置公式（误差几分钟），按西澳标准时间 AWST（UTC+8，西澳不实行夏令时）。游戏里的钟点就当作当地钟点。
const RAD = Math.PI / 180;
const TZ_MIN = 8 * 60;
function solar(doy: number, minuteOfDay: number) {
	const g = ((2 * Math.PI) / 365) * (doy + (minuteOfDay / 60 - 12) / 24);
	const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
	const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
	return { eqTime, decl };
}
/** 太阳高度角（度）：地平线 0，正午最高；负数表示在地平线下 */
export function sunElevation(l: Pick<SkyLoc, 'lat' | 'lon'>, clock: number): number {
	const doy = realDayOfYear(clock);
	const m = ((clock % 1440) + 1440) % 1440;
	const { eqTime, decl } = solar(doy, m);
	const tst = m + eqTime + 4 * l.lon - TZ_MIN; // 真太阳时（分钟）
	const ha = (tst / 4 - 180) * RAD;
	const lat = l.lat * RAD;
	const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
	return 90 - Math.acos(Math.min(1, Math.max(-1, cosZ))) / RAD;
}
export interface SunTimes { rise: number; set: number; noon: number }
/** 当天的日出、日落、正午（当地钟点，从 0 点起的分钟数）。西澳纬度上每天都有日出日落 */
export function sunTimes(l: Pick<SkyLoc, 'lat' | 'lon'>, clock: number): SunTimes {
	const doy = realDayOfYear(clock);
	const { eqTime, decl } = solar(doy, 720);
	const lat = l.lat * RAD;
	const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
	const h = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
	const noon = 720 - 4 * l.lon - eqTime + TZ_MIN;
	return { rise: Math.round(noon - 4 * h), set: Math.round(noon + 4 * h), noon: Math.round(noon) };
}
export const hhmm = (min: number) => {
	const m = ((Math.round(min) % 1440) + 1440) % 1440;
	return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
/** 画面的天色（只管画面明暗，不是玩法时段）：太阳在地平线上 6° 以上白天，−6° 到 6° 按上午 / 下午分清晨和傍晚，再低是夜里 */
export function skyPhase(l: Pick<SkyLoc, 'lat' | 'lon'>, clock: number): 'dawn' | 'day' | 'dusk' | 'night' {
	const e = sunElevation(l, clock);
	if (e >= 6) return 'day';
	if (e < -6) return 'night';
	const m = ((clock % 1440) + 1440) % 1440;
	return m < sunTimes(l, clock).noon ? 'dawn' : 'dusk';
}

// ---------- 第 38 轮：潮汐（示意） ----------
// 用四个主要分潮（M2 半日、S2 半日、K1 全日、O1 全日）叠加。各分潮振幅按纬度取西澳海岸的大致量级插值：
// 北边金伯利（布鲁姆）大潮差可达八九米；宁格鲁一带一两米；珀斯以南以全日潮为主，潮差不到一米。各地的相位用地点名定（所有人一样）。
// 不是真实潮汐表：只给玩家一个「这里潮水大不大、现在涨还是退」的感觉，卡片上写明真下海要看官方潮汐预报。
const TIDE_PERIODS_H = [12.4206, 12, 23.9345, 25.8193] as const;
/** [南纬度数, M2, S2, K1, O1 振幅（米）] */
const TIDE_AMP: [number, number, number, number, number][] = [[17, 2.4, 1.6, 0.6, 0.35], [21, 0.9, 0.5, 0.25, 0.15], [24, 0.5, 0.25, 0.2, 0.13], [29, 0.25, 0.12, 0.18, 0.12], [32, 0.05, 0.04, 0.17, 0.12]];
function tideAmps(lat: number): number[] {
	const a = Math.min(TIDE_AMP[TIDE_AMP.length - 1][0], Math.max(TIDE_AMP[0][0], -lat));
	let i = 0;
	while (i < TIDE_AMP.length - 2 && a > TIDE_AMP[i + 1][0]) i++;
	const t = (a - TIDE_AMP[i][0]) / (TIDE_AMP[i + 1][0] - TIDE_AMP[i][0]);
	return [1, 2, 3, 4].map((k) => TIDE_AMP[i][k] + (TIDE_AMP[i + 1][k] - TIDE_AMP[i][k]) * t);
}
/** 这里看不看潮汐：海边、港口、岛 */
export const hasTide = (l: SkyLoc) => isCoastal(l);
/** 某时刻的潮高（米，相对平均海面） */
export function tideHeight(l: SkyLoc, clock: number): number {
	const amps = tideAmps(l.lat);
	const h = clock / 60;
	let sum = 0;
	for (let k = 0; k < 4; k++) sum += amps[k] * Math.cos((2 * Math.PI * h) / TIDE_PERIODS_H[k] - 2 * Math.PI * unit(`tide|${l.id}|${k}`));
	return sum;
}
export interface TideTurn { kind: 'high' | 'low'; at: number; h: number }
export interface TideNow { h: number; rising: boolean; next: TideTurn[]; range: number }
/** 现在的潮高、涨还是退、接下来的两次满潮 / 干潮（at 是游戏时钟），以及今天（当地 0–24 点）的潮差 */
export function tideNow(l: SkyLoc, clock: number): TideNow {
	const step = 5;
	const h = tideHeight(l, clock);
	const rising = tideHeight(l, clock + step) > h;
	const next: TideTurn[] = [];
	let prev = h;
	let cur = tideHeight(l, clock + step);
	for (let t = clock + step; t < clock + 30 * 60 && next.length < 2; t += step) {
		const nx = tideHeight(l, t + step);
		if (cur > prev && cur >= nx) next.push({ kind: 'high', at: t, h: cur });
		else if (cur < prev && cur <= nx) next.push({ kind: 'low', at: t, h: cur });
		prev = cur;
		cur = nx;
	}
	const day0 = dayOf(clock) * 1440;
	let lo = Infinity, hi = -Infinity;
	for (let t = day0; t < day0 + 1440; t += 10) { const x = tideHeight(l, t); lo = Math.min(lo, x); hi = Math.max(hi, x); }
	return { h, rising, next, range: hi - lo };
}

// ---------- 第 39 轮：山火季（示意） ----------
// 澳洲火险评级（AFDRS）四级：中等、高、极端、灾难性；没到中等时不评级。
// 西澳南部（南纬 26° 以南）山火季在夏天（12–3 月最重，11 月、4 月是前后期）；北部（南纬 23° 以北）在旱季（5–11 月，8–10 月最重），雨季没有；中间一带 10–2 月。
// 当天天气修正：炎热 +1（内陆炎热天再 +1）、小雨和风暴 −2。灾难性只在最重的组合里少数日子出现。只做提示，不影响玩法。
export const FIRE_LEVELS = [
	{ id: 'none', name: '无评级', advice: '' },
	{ id: 'moderate', name: '中等', advice: '提前计划，留意情况变化。' },
	{ id: 'high', name: '高', advice: '做好准备，野外不要生火，留意火情通报。' },
	{ id: 'extreme', name: '极端', advice: '采取行动保护生命和财产，远离林区和灌木丛。' },
	{ id: 'catastrophic', name: '灾难性', advice: '为了生存，尽早离开高风险地区。' },
] as const;
export type FireLevel = (typeof FIRE_LEVELS)[number];
/** 1–12 月的基础火险（0–2） */
const FIRE_SOUTH = [2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 2];
const FIRE_NORTH = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 1, 0];
const FIRE_MID = [1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1];
/** 一年中第几天 → 月份 0–11 */
function monthOf(doy: number): number {
	let d = doy;
	let m = 0;
	while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
	return m;
}
/** 这里这个月是不是山火季 */
export function fireSeason(l: SkyLoc, clock: number): boolean {
	const table = l.lat < -26 ? FIRE_SOUTH : l.lat > -23 ? FIRE_NORTH : FIRE_MID;
	return table[monthOf(realDayOfYear(clock))] > 0;
}
/** 今天的火险等级 */
export function fireDanger(l: SkyLoc, clock: number, weatherId: string): FireLevel {
	const table = l.lat < -26 ? FIRE_SOUTH : l.lat > -23 ? FIRE_NORTH : FIRE_MID;
	const base = table[monthOf(realDayOfYear(clock))];
	if (!base) return FIRE_LEVELS[0];
	let score = base + (weatherId === 'hot' ? 1 : 0) - (weatherId === 'rain' || weatherId === 'storm' ? 2 : 0) + (weatherId === 'hot' && !isCoastal(l) ? 1 : 0);
	if (score >= 4) score = unit(`fire|${l.id}|${dayOf(clock)}`) < 0.25 ? 4 : 3;
	return FIRE_LEVELS[Math.max(0, Math.min(4, score))];
}

// ---------- 第 40 轮：紫外线指数（示意） ----------
// 晴天紫外线指数按太阳高度的经验公式估算：UVI ≈ 12.5 × cos(天顶角)^2.42（Madronich 的近似，正午太阳越高越强）；
// 再按天气打折：多云 ×0.75、小雨 ×0.45、风暴 ×0.25。分级按世界卫生组织：低 0–2、中等 3–5、高 6–7、很高 8–10、极高 11+；
// 澳洲防晒（SunSmart）的说法是指数 3 及以上就要防晒。只做提示。
const UV_CLOUD: Record<string, number> = { cloudy: 0.75, rain: 0.45, storm: 0.25 };
export const UV_LEVELS = [
	{ min: 0, name: '低' },
	{ min: 3, name: '中等' },
	{ min: 6, name: '高' },
	{ min: 8, name: '很高' },
	{ min: 11, name: '极高' },
] as const;
export const uvLevel = (uv: number) => [...UV_LEVELS].reverse().find((x) => uv >= x.min)!;
/** 某时刻的紫外线指数（整数） */
export function uvIndex(l: Pick<SkyLoc, 'lat' | 'lon'>, clock: number, weatherId: string): number {
	const e = sunElevation(l, clock);
	if (e <= 0) return 0;
	const mu = Math.sin(e * RAD);
	return Math.round(12.5 * mu ** 2.42 * (UV_CLOUD[weatherId] ?? 1));
}
export interface UvDay { now: number; peak: number; protect: [number, number] | null }
/** 现在、今天最高，以及今天需要防晒（指数 ≥ 3）的时段（当地钟点的分钟数；全天都不到 3 时为 null） */
export function uvDay(l: Pick<SkyLoc, 'lat' | 'lon'>, clock: number, weatherId: string): UvDay {
	const day0 = dayOf(clock) * 1440;
	let peak = 0;
	let from = -1, to = -1;
	for (let m = 0; m < 1440; m += 10) {
		const u = uvIndex(l, day0 + m, weatherId);
		peak = Math.max(peak, u);
		if (u >= 3) { if (from < 0) from = m; to = m; }
	}
	return { now: uvIndex(l, clock, weatherId), peak, protect: from < 0 ? null : [from, to + 10] };
}
