#!/usr/bin/env node
// 从 OpenStreetMap（Overpass API）采集真实地点，原样转成 inbox/venues-<日期>.json，再由 `npm run earth:venues` 校验合并。
// 坐标、名字、OSM 编号全部取自 API 返回，不做任何人工或模型改写。数据许可：ODbL，© OpenStreetMap contributors。
//
// 用法：
//   npm run earth:fetch-venues                         # 默认珀斯、弗里曼特尔，半径 5 公里
//   npm run earth:fetch-venues -- --locs=perth --km=3 --per=40
//   npm run earth:fetch-venues -- --dry-run            # 只打印查询语句，不联网
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WA } from '../../../src/game/data/wa.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const LOCS = String(args.locs ?? 'perth,fremantle').split(',');
const KM = Number(args.km ?? 5);
const PER = Number(args.per ?? 40); // 每个地点每种类型最多几条
// 公共 Overpass 服务经常忙：失败后按顺序换镜像、逐次加长等待
const ENDPOINTS = args.endpoint ? [String(args.endpoint)] : ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let ENDPOINT = ENDPOINTS[0];
const DRY = !!args['dry-run'];

// OSM 标签 → 游戏地点类型（与 src/game/data/venues.ts 的 VENUE_TYPES 对应）。查询按类型分开发，typeOf 再核对一次
const RULES = [
	{ type: 'restaurant', sel: '["amenity"="restaurant"]' },
	{ type: 'fast-food', sel: '["amenity"="fast_food"]' },
	{ type: 'cafe', sel: '["amenity"="cafe"]' },
	{ type: 'pub', sel: '["amenity"~"^(pub|bar)$"]' },
	{ type: 'gym', sel: '["leisure"="fitness_centre"]' },
	{ type: 'sports-centre', sel: '["leisure"="sports_centre"]' },
	{ type: 'pool', sel: '["leisure"="swimming_pool"]["access"!~"^(private|no|customers)$"]' },
	{ type: 'park', sel: '["leisure"="park"]' },
	{ type: 'library', sel: '["amenity"="library"]' },
	{ type: 'supermarket', sel: '["shop"="supermarket"]' },
	{ type: 'clinic', sel: '["amenity"~"^(clinic|doctors|hospital)$"]' },
];

/** 以地点为中心、边长 2 × km 的矩形（Overpass 处理矩形比圆形快得多，圆形范围在本地再筛） */
function bbox(lat, lon, km) {
	const dLat = km / 111.32;
	const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
	return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
}

/** 一种类型一条查询，避免一次查太多被服务器超时 */
function query(rule, box) {
	return `[out:json][timeout:90];\nnwr${rule.sel}["name"](${box});\nout center tags;`;
}

/** 一个元素属于哪个类型（按 RULES 顺序第一个命中） */
function typeOf(tags) {
	const a = tags.amenity, l = tags.leisure;
	if (a === 'restaurant') return 'restaurant';
	if (a === 'fast_food') return 'fast-food';
	if (a === 'cafe') return 'cafe';
	if (a === 'pub' || a === 'bar') return 'pub';
	if (l === 'fitness_centre') return 'gym';
	if (l === 'sports_centre') return 'sports-centre';
	if (l === 'swimming_pool' && !/^(private|no|customers)$/.test(tags.access ?? '')) return 'pool';
	if (l === 'park') return 'park';
	if (a === 'library') return 'library';
	if (tags.shop === 'supermarket') return 'supermarket';
	if (a === 'clinic' || a === 'doctors' || a === 'hospital') return 'clinic';
	return null;
}

/** 知名度：有 wikidata / website / opening_hours 的优先 */
const fame = (t) => (t.wikidata ? 4 : 0) + (t.website || t['contact:website'] ? 2 : 0) + (t.opening_hours ? 1 : 0);

const cleanName = (n) => String(n).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/** 已关闭、停用的地点：有 disused / abandoned / end_date 标签，或名字以“Former / Old … (closed)”开头 */
const closed = (t, name) => !!(t.disused || t.abandoned || t.end_date || t['disused:amenity'] || /^former\b|\(closed\)|\bclosed\b/i.test(name));

/** 发一条查询：失败后换镜像、逐次加长等待 */
async function overpass(q, label) {
	const errs = [];
	for (let attempt = 0; attempt < 6; attempt++) {
		const ep = ENDPOINTS[attempt % ENDPOINTS.length];
		try {
			const res = await fetch(ep, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'terra-life-venue-fetch/1.0 (open-source game data import)' },
				body: 'data=' + encodeURIComponent(q),
				signal: AbortSignal.timeout(120_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json();
			if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark.slice(0, 120));
			ENDPOINT = ep;
			return json;
		} catch (e) {
			errs.push(`${new URL(ep).host}: ${e.message}`);
			console.error(`  ${label} 第 ${attempt + 1} 次失败（${errs.at(-1)}）`);
			await new Promise((ok) => setTimeout(ok, 4000 * 2 ** Math.min(attempt, 3)));
		}
	}
	throw new Error(`${label}: Overpass 全部失败：${errs.join('；')}`);
}

const distM = (lat1, lon1, lat2, lon2) => {
	const r = (d) => (d * Math.PI) / 180;
	const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
};

async function fetchLoc(loc) {
	const box = bbox(loc.lat, loc.lon, KM);
	if (DRY) { for (const r of RULES) console.log(`--- ${loc.id} ${r.type}\n${query(r, box)}`); return { venues: [], raw: 0, skipped: 0 }; }
	const venues = [];
	let raw = 0, skipped = 0, osmTime;
	for (const rule of RULES) {
		const data = await overpass(query(rule, box), `${loc.id}/${rule.type}`);
		osmTime ??= data.osm3s?.timestamp_osm_base;
		const list = [];
		for (const el of data.elements ?? []) {
			raw++;
			const t = el.tags ?? {};
			const lat = el.lat ?? el.center?.lat;
			const lon = el.lon ?? el.center?.lon;
			const name = cleanName(t.name ?? '');
			if (typeOf(t) !== rule.type || closed(t, name) || !Number.isFinite(lat) || !Number.isFinite(lon) || !name || name.length > 60 || distM(lat, lon, loc.lat, loc.lon) > KM * 1000) { skipped++; continue; }
			list.push({ v: { id: `osm-${el.type}-${el.id}`, loc: loc.id, name, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, type: rule.type, source: 'osm' }, f: fame(t) });
		}
		list.sort((a, b) => b.f - a.f || a.v.id.localeCompare(b.v.id));
		venues.push(...list.slice(0, PER).map((x) => x.v));
		console.log(`  ${loc.id}/${rule.type}: ${list.length} 条符合，保留 ${Math.min(list.length, PER)}`);
		await new Promise((ok) => setTimeout(ok, 1500)); // 对公共服务客气一点
	}
	return { venues, raw, skipped, osmTime };
}

const all = new Map();
const stats = [];
for (const id of LOCS) {
	const loc = WA.locations.find((l) => l.id === id);
	if (!loc) { console.error(`未知地点 ${id}`); process.exit(1); }
	const r = await fetchLoc(loc);
	for (const v of r.venues) if (!all.has(v.id)) all.set(v.id, v);
	const byType = {};
	for (const v of r.venues) byType[v.type] = (byType[v.type] ?? 0) + 1;
	stats.push({ loc: id, raw: r.raw, skipped: r.skipped, kept: r.venues.length, byType, osmTime: r.osmTime });
	console.log(`${id}: OSM 返回 ${r.raw} 条，跳过 ${r.skipped ?? 0}，保留 ${r.venues.length}`, byType);
}
if (DRY) process.exit(0);

const day = new Date().toISOString().slice(0, 10);
const out = join(here, 'inbox', `venues-${day}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
	region: 'wa',
	venues: [...all.values()].sort((a, b) => a.loc.localeCompare(b.loc) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
}, null, 2) + '\n');
writeFileSync(join(here, 'inbox', `venues-${day}.meta.txt`), [
	`来源：OpenStreetMap，经 Overpass API（${ENDPOINT}）`,
	`许可：ODbL，© OpenStreetMap contributors`,
	`查询时间：${new Date().toISOString()}`,
	`地点：${LOCS.join(', ')}；半径 ${KM} km；每种类型每地最多 ${PER} 条（有 wikidata / website / opening_hours 的优先）`,
	...stats.map((s) => `${s.loc}：OSM 返回 ${s.raw}，跳过 ${s.skipped}，保留 ${s.kept}，数据版本 ${s.osmTime ?? '?'}，${JSON.stringify(s.byType)}`),
	'',
	'查询语句（每种类型一条，以第一个地点为例；矩形范围查询后按到地点中心的距离筛到半径内）：',
	...RULES.map((r) => query(r, bbox(WA.locations.find((l) => l.id === LOCS[0]).lat, WA.locations.find((l) => l.id === LOCS[0]).lon, KM))),
].join('\n') + '\n');
console.log(`已写入 ${out}（${all.size} 条）`);
