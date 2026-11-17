// 天气：由「地点 + 游戏日」确定，所有玩家看到的一样，不用存档里的随机种子（种子是私密的，天气要能公开预报）。
// 纯函数：不读时钟、不用 Math.random。
import { dateOf, dayOf } from './time.ts';
import type { PlayerState } from './types.ts';
import { WEATHERS, WEATHER_WEIGHTS, type WeatherDef } from '../data/weather.ts';

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

/** 某地点在某个游戏日（dayOf 的返回值）的天气 */
export function weatherOn(locId: string, day: number): WeatherDef {
	const season = dateOf(day * 1440).season;
	const table = WEATHER_WEIGHTS[season];
	const total = table.reduce((s, [, w]) => s + w, 0);
	let r = unit(`${locId}|${day}`) * total;
	for (const [id, w] of table) {
		r -= w;
		if (r < 0) return WEATHERS.find((x) => x.id === id)!;
	}
	return WEATHERS.find((x) => x.id === table[table.length - 1][0])!;
}

/** 玩家此刻所在地点的天气 */
export const weatherAt = (state: PlayerState) => weatherOn(state.loc, dayOf(state.clock));
