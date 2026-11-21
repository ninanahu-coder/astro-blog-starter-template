import { haversineKm } from './geo.ts';
import { FIX_RULES } from '../data/venues.ts';
import type { PlayerState } from './types.ts';

export type FixRules = { maxAccuracyM: number; maxSpeedKmh: number; speedFreeKm: number };

/**
 * 定位本身是否可信：精度够不够、和上一次定位（state.fix，服务端时间）比有没有“瞬移”。
 * 真实地点用 FIX_RULES；城市抵达（gps 动作）用 GPS_FIX_RULES（速度上限按坐飞机算）。
 */
export function fixProblem(state: PlayerState, lat: number, lon: number, acc: number, now: number, rules: FixRules = FIX_RULES): string | undefined {
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return '定位无效。';
	if (!Number.isFinite(acc) || acc < 0 || acc > rules.maxAccuracyM) return `定位精度不够（误差 ${Math.round(acc)} 米），到开阔处再试。`;
	const f = state.fix;
	if (f) {
		const km = haversineKm(f.lat, f.lon, lat, lon);
		const hours = Math.max(now - f.at, 60_000) / 3_600_000;
		if (km > rules.speedFreeKm && km / hours > rules.maxSpeedKmh) {
			const wait = Math.ceil(((km / rules.maxSpeedKmh) * 3_600_000 - (now - f.at)) / 60_000);
			return `定位跳得太快（${Math.round(km)} 公里），${wait} 分钟后再试。`;
		}
	}
	return undefined;
}

/** 成功后记下的定位：坐标保留 3 位小数（约 100 米） */
export function roundFix(lat: number, lon: number, now: number): NonNullable<PlayerState['fix']> {
	return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, at: now };
}
