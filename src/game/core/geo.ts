import type { Region } from './types.ts';

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** 两点大圆距离（km） */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const dLat = rad(lat2 - lat1);
	const dLon = rad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 等距圆柱投影（按区域中纬度修正），返回地图 viewBox 尺寸与投影函数 */
export function makeProjection(region: Region, width = 400) {
	const { minLon, maxLon, minLat, maxLat } = region.bounds;
	const k = Math.cos(rad((minLat + maxLat) / 2));
	const scale = width / ((maxLon - minLon) * k);
	const height = Math.round((maxLat - minLat) * scale);
	return {
		width,
		height,
		project: (lon: number, lat: number): [number, number] => [
			+((lon - minLon) * k * scale).toFixed(1),
			+((maxLat - lat) * scale).toFixed(1),
		],
	};
}

/** 真实坐标命中的游戏地点（在打卡半径内的最近者），没有则返回 null */
export function locateInRegion(region: Region, lat: number, lon: number) {
	let best: { id: string; km: number } | null = null;
	for (const l of region.locations) {
		const km = haversineKm(lat, lon, l.lat, l.lon);
		if (km <= l.radiusKm && (!best || km < best.km)) best = { id: l.id, km };
	}
	return best;
}

export const POI_RADIUS_KM = 0.4;
