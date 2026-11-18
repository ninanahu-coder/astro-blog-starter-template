// 导入器的校验规则：纯函数。导入这个文件不会执行导入流程、不写任何文件；
// 它依赖 wa.ts，所以会读取现有的 wa.pois.json / *.venues.json（这些文件损坏时这里也会加载失败）。
// 地点和「运行时归到最近的地点」都按整个世界（所有区域）算，和服务器一致。
// import-venues.mjs / import-pois.mjs 和测试共用。
import { haversineKm, locateInRegion } from '../../../src/game/core/geo.ts';
import { WORLD } from '../../../src/game/data/wa.ts';
import { VENUE_TYPES } from '../../../src/game/data/venues.ts';

const LOCS = new Map(WORLD.locations.map((l) => [l.id, l]));
const VENUE_TYPE_IDS = new Set(VENUE_TYPES.map((t) => t.id));
const VENUE_FIELDS = ['id', 'loc', 'name', 'lat', 'lon', 'type', 'source', 'tier'];
const POI_CATEGORIES = new Set(['park', 'beach', 'landmark', 'heritage', 'market', 'museum', 'lookout', 'food', 'pub', 'wildlife', 'trail']);
const POI_SOURCES = new Set(['osm', 'wikidata', 'seed']);
const POI_FIELDS = ['id', 'loc', 'name', 'lat', 'lon', 'category', 'source', 'license'];

/** 真实地点（venue）：返回错误信息；合法返回 null */
export function checkVenue(v) {
	if (!v || typeof v !== 'object') return '不是对象';
	const extra = Object.keys(v).filter((k) => !VENUE_FIELDS.includes(k));
	if (extra.length) return `多余字段: ${extra.join(',')}`;
	if (typeof v.id !== 'string' || !/^osm-(node|way|relation)-\d{1,15}$/.test(v.id)) return 'id 必须是 osm-<node|way|relation>-<数字>';
	if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60 || /[<>]/.test(v.name)) return 'name 不合法';
	if (!VENUE_TYPE_IDS.has(v.type)) return `type 不合法: ${v.type}`;
	if (v.source !== 'osm') return 'source 只能是 osm';
	if (v.tier !== undefined && (!Number.isInteger(v.tier) || v.tier < 1 || v.tier > 4)) return 'tier 只能是 1–4 的整数';
	if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return '坐标不是数字';
	if (v.lat < -90 || v.lat > 90 || v.lon < -180 || v.lon > 180) return '坐标超出经纬度范围';
	const loc = LOCS.get(v.loc);
	if (!loc) return `未知地点: ${v.loc}`;
	const km = haversineKm(v.lat, v.lon, loc.lat, loc.lon);
	if (km > loc.radiusKm) return `距 ${loc.id} ${km.toFixed(1)}km，超出半径 ${loc.radiusKm}km`;
	// 半径会重叠：游戏运行时把人归到最近的地点，标成别的地点的话这条数据永远用不上
	const near = locateInRegion(WORLD, v.lat, v.lon);
	if (near?.id !== loc.id) return `坐标离 ${near?.id} 更近，运行时会归到那里，不能标成 ${loc.id}`;
	return null;
}

/** 打卡点（POI）：返回错误信息；合法返回 null */
export function checkPoi(p) {
	if (!p || typeof p !== 'object') return '不是对象';
	const extra = Object.keys(p).filter((k) => !POI_FIELDS.includes(k));
	if (extra.length) return `多余字段: ${extra.join(',')}`;
	if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(p.id)) return 'id 不合法';
	if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || /[<>]/.test(p.name)) return 'name 不合法';
	if (!POI_CATEGORIES.has(p.category)) return `category 不合法: ${p.category}`;
	if (!POI_SOURCES.has(p.source)) return `source 不合法: ${p.source}`;
	if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return '坐标不是数字';
	if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return '坐标超出经纬度范围';
	const loc = LOCS.get(p.loc);
	if (!loc) return `未知地点: ${p.loc}`;
	const km = haversineKm(p.lat, p.lon, loc.lat, loc.lon);
	if (km > loc.radiusKm) return `距 ${loc.id} ${km.toFixed(1)}km，超出打卡半径 ${loc.radiusKm}km`;
	// 半径会重叠：游戏运行时把人归到最近的地点，标成别的地点的话这个打卡点永远领不到
	const near = locateInRegion(WORLD, p.lat, p.lon);
	if (near?.id !== loc.id) return `坐标离 ${near?.id} 更近，运行时会归到那里，不能标成 ${loc.id}`;
	return null;
}

/** 同一个场所在 OSM 里常有两条记录（一个点加一个轮廓，或重复录入）：同类型、同名、相距不超过这么多米就算同一个 */
export const DUP_VENUE_M = 30;

/**
 * 去掉重复的真实地点。只按 OSM id 去重不够：同一场所的 node 和 way 是两个 id。
 * 每组重复里保留 id 排序靠前的那条。返回留下的记录和被去掉的记录（附保留的是哪条、相距多少米）。不修改入参。
 */
export function dedupeVenues(venues) {
	const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
	const sorted = [...venues].sort((a, b) => a.id.localeCompare(b.id));
	const kept = [];
	const dropped = [];
	for (const v of sorted) {
		const twin = kept.find((k) => k.type === v.type && norm(k.name) === norm(v.name) && haversineKm(k.lat, k.lon, v.lat, v.lon) * 1000 <= DUP_VENUE_M);
		if (twin) dropped.push({ venue: v, keep: twin.id, meters: Math.round(haversineKm(twin.lat, twin.lon, v.lat, v.lon) * 1000) });
		else kept.push(v);
	}
	return { kept, dropped };
}
