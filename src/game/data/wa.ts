// 区域（完整版）：首屏用的区域数据（wa-base.ts、areas-base.ts）加上由 OpenClaw 从 OSM 采集的真实地点（*.venues.json）。
// 服务器结算和测试用这个；页面首屏只加载首屏版，打开「附近」时再下载真实地点（第 34 轮）。
// 第 41 轮起游戏世界由几个区域拼成：规则用 WORLD（所有区域合在一起），单个区域（WA 等）给地图和测试用。
import type { Region, Venue } from '../core/types.ts';
import venues from './wa.venues.json' with { type: 'json' };
import saVenues from './sa.venues.json' with { type: 'json' };
import { WA_BASE } from './wa-base.ts';
import { AREAS, CROSS_ROUTES, mergeAreas } from './areas-base.ts';

export const WA: Region = { ...WA_BASE, venues: (venues as { venues: Venue[] }).venues };

/** 各区域的真实地点（按区域 id） */
const VENUES: Record<string, Venue[]> = { wa: WA.venues, sa: (saVenues as { venues: Venue[] }).venues };
/** 完整版的各区域 */
export const FULL_AREAS: Region[] = AREAS.map((a) => (Object.hasOwn(VENUES, a.id) ? { ...a, venues: VENUES[a.id] } : a));
/** 完整版的世界：服务器结算用它 */
export const WORLD: Region = mergeAreas(FULL_AREAS, CROSS_ROUTES);

export const REGIONS: Record<string, Region> = { world: WORLD, ...Object.fromEntries(FULL_AREAS.map((a) => [a.id, a])) };

/** 按 id 取区域。只认 REGIONS 自己的键：`constructor`、`toString`、`__proto__` 这类名字会命中 Object.prototype，不能直接用下标取 */
export const getRegion = (id: unknown): Region | undefined => (typeof id === 'string' && Object.hasOwn(REGIONS, id) ? REGIONS[id] : undefined);
