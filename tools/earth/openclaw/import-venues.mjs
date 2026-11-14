#!/usr/bin/env node
// 校验 OpenClaw 采集的真实地点（餐馆、健身房、公园……）并合并进 src/game/data/wa.venues.json。
// 用法：npm run earth:venues [-- --dry-run]
// 输入：tools/earth/openclaw/inbox/venues-*.json，格式：{ "region": "wa", "venues": [ { id, loc, name, lat, lon, type, source, tier? } ] }
// 任何一条不合格，整批不写入。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from '../../../src/game/core/geo.ts';
import { WA } from '../../../src/game/data/wa.ts';
import { VENUE_TYPES } from '../../../src/game/data/venues.ts';

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, 'inbox');
const target = join(here, '../../../src/game/data/wa.venues.json');
const dryRun = process.argv.includes('--dry-run');

const TYPES = new Set(VENUE_TYPES.map((t) => t.id));
const FIELDS = ['id', 'loc', 'name', 'lat', 'lon', 'type', 'source', 'tier'];
const locs = new Map(WA.locations.map((l) => [l.id, l]));

/** 返回错误信息；合法返回 null */
export function checkVenue(v) {
	if (!v || typeof v !== 'object') return '不是对象';
	const extra = Object.keys(v).filter((k) => !FIELDS.includes(k));
	if (extra.length) return `多余字段: ${extra.join(',')}`;
	if (typeof v.id !== 'string' || !/^osm-(node|way|relation)-\d{1,15}$/.test(v.id)) return 'id 必须是 osm-<node|way|relation>-<数字>';
	if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60 || /[<>]/.test(v.name)) return 'name 不合法';
	if (!TYPES.has(v.type)) return `type 不合法: ${v.type}`;
	if (v.source !== 'osm') return 'source 只能是 osm';
	if (v.tier !== undefined && (!Number.isInteger(v.tier) || v.tier < 1 || v.tier > 4)) return 'tier 只能是 1–4 的整数';
	if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return '坐标不是数字';
	if (v.lat < -90 || v.lat > 90 || v.lon < -180 || v.lon > 180) return '坐标超出经纬度范围';
	const loc = locs.get(v.loc);
	if (!loc) return `未知地点: ${v.loc}`;
	const km = haversineKm(v.lat, v.lon, loc.lat, loc.lon);
	if (km > loc.radiusKm) return `距 ${loc.id} ${km.toFixed(1)}km，超出半径 ${loc.radiusKm}km`;
	return null;
}

const current = JSON.parse(readFileSync(target, 'utf8'));
const byId = new Map(current.venues.map((v) => [v.id, v]));
const files = existsSync(inbox) ? readdirSync(inbox).filter((f) => f.startsWith('venues-') && f.endsWith('.json')).sort() : [];
if (!files.length) console.log(`inbox 里没有 venues-*.json（${inbox}）。只校验现有数据。`);

let errors = 0, added = 0, updated = 0;
for (const v of current.venues) {
	const err = checkVenue(v);
	if (err) { errors++; console.error(`✗ 现有数据 ${v.id}: ${err}`); }
}
for (const f of files) {
	let batch;
	try {
		batch = JSON.parse(readFileSync(join(inbox, f), 'utf8'));
	} catch (e) {
		errors++; console.error(`✗ ${f}: JSON 解析失败 ${e.message}`); continue;
	}
	if (batch.region !== 'wa' || !Array.isArray(batch.venues)) { errors++; console.error(`✗ ${f}: region 必须为 wa 且含 venues 数组`); continue; }
	for (const v of batch.venues) {
		const err = checkVenue(v);
		if (err) { errors++; console.error(`✗ ${f} ${v?.id ?? '?'}: ${err}`); continue; }
		byId.has(v.id) ? updated++ : added++;
		byId.set(v.id, v);
	}
}

if (errors) {
	console.error(`\n${errors} 处错误，未写入。`);
	process.exit(1);
}
const byType = {};
for (const v of byId.values()) byType[v.type] = (byType[v.type] ?? 0) + 1;
console.log(`校验通过：新增 ${added}，更新 ${updated}，合计 ${byId.size} 个地点。`, byType);
if (!dryRun && files.length) {
	current.venues = [...byId.values()].sort((a, b) => a.loc.localeCompare(b.loc) || a.id.localeCompare(b.id));
	writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
	console.log(`已写入 ${target}`);
}
