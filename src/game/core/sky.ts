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
