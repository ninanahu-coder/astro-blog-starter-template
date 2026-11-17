// 西澳区域（完整版）：首屏用的区域数据（wa-base.ts）加上由 OpenClaw 从 OSM 采集的真实地点（wa.venues.json）。
// 服务器结算和测试用这个；页面首屏只加载 wa-base.ts，打开「附近」时再下载真实地点（第 34 轮）。
import type { Region, Venue } from '../core/types.ts';
import venues from './wa.venues.json' with { type: 'json' };
import { WA_BASE } from './wa-base.ts';

export const WA: Region = { ...WA_BASE, venues: (venues as { venues: Venue[] }).venues };

export const REGIONS: Record<string, Region> = { wa: WA };

/** 按 id 取区域。只认 REGIONS 自己的键：`constructor`、`toString`、`__proto__` 这类名字会命中 Object.prototype，不能直接用下标取 */
export const getRegion = (id: unknown): Region | undefined => (typeof id === 'string' && Object.hasOwn(REGIONS, id) ? REGIONS[id] : undefined);
