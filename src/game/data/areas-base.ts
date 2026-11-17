// 区域注册表（第 41 轮，首屏版，不含真实地点）：游戏世界由几个「区域」（西澳、南澳……）拼成。
// 规则层（引擎、服务器、存档清洗）用合并后的 WORLD_BASE：所有地点、路线（含跨区域路线）放在一起，出行、找医院、成就都不用关心区域；
// 画面层（地图、底图、轮廓）按玩家所在地点的区域（areaOf）画。地点 id 在所有区域里必须唯一。
import type { Region, Route } from '../core/types.ts';
import { WA_BASE } from './wa-base.ts';
import { SA_BASE } from './sa-base.ts';

/** 所有区域（首屏版）。第一个是新角色的出生区域 */
export const AREAS: Region[] = [WA_BASE, SA_BASE];

/** 跨区域路线（第 43 轮起） */
export const CROSS_ROUTES: Route[] = [];

/**
 * 把几个区域合成一个「世界」：地点、路线、打卡点、真实地点拼在一起，范围取并集；出生点和默认医院用第一个区域的。
 * 地点 id 重复、跨区域路线连到不存在的地点、或两端在同一区域时直接报错（数据错了宁可启动失败，也不要静默串错地方）。
 */
export function mergeAreas(areas: Region[], cross: Route[]): Region {
	if (!areas.length) throw new Error('mergeAreas: 没有区域');
	const owner = new Map<string, string>();
	for (const a of areas) for (const l of a.locations) {
		if (owner.has(l.id)) throw new Error(`mergeAreas: 地点 id ${l.id} 在 ${owner.get(l.id)} 和 ${a.id} 里重复`);
		owner.set(l.id, a.id);
	}
	for (const r of cross) {
		const [x, y] = [owner.get(r.a), owner.get(r.b)];
		if (!x || !y) throw new Error(`mergeAreas: 跨区域路线 ${r.a}–${r.b} 连到不存在的地点`);
		if (x === y) throw new Error(`mergeAreas: 路线 ${r.a}–${r.b} 两端都在 ${x}，应写在区域自己的 routes 里`);
	}
	const b = areas.map((a) => a.bounds);
	return {
		id: 'world',
		name: areas.map((a) => a.name).join('、'),
		bounds: { minLon: Math.min(...b.map((x) => x.minLon)), maxLon: Math.max(...b.map((x) => x.maxLon)), minLat: Math.min(...b.map((x) => x.minLat)), maxLat: Math.max(...b.map((x) => x.maxLat)) },
		outline: [],
		spawn: areas[0].spawn,
		hospital: areas[0].hospital,
		locations: areas.flatMap((a) => a.locations),
		routes: [...areas.flatMap((a) => a.routes), ...cross],
		pois: areas.flatMap((a) => a.pois),
		venues: areas.flatMap((a) => a.venues),
	};
}

export const WORLD_BASE: Region = mergeAreas(AREAS, CROSS_ROUTES);

/** 地点属于哪个区域（找不到返回 undefined） */
export function areaOf(locId: unknown, areas: Region[] = AREAS): Region | undefined {
	return typeof locId === 'string' ? areas.find((a) => a.locations.some((l) => l.id === locId)) : undefined;
}

/** 按 id 取区域（首屏版）。只认注册过的 id，`constructor` 这类原型上的名字不算 */
export function getAreaBase(id: unknown): Region | undefined {
	return typeof id === 'string' ? AREAS.find((a) => a.id === id) : undefined;
}

/** 跨区域路线里从某个区域出去的（地图上画成通往别处的出口） */
export const exitsOf = (area: Region, cross: Route[] = CROSS_ROUTES) => {
	const ids = new Set(area.locations.map((l) => l.id));
	return cross.filter((r) => ids.has(r.a) !== ids.has(r.b));
};
