#!/usr/bin/env node
// 校验 OpenClaw 采集的 POI 批次并合并进 src/game/data/wa.pois.json。
// 用法：npm run earth:pois [-- --dry-run]
// 输入：tools/earth/openclaw/inbox/*.json（格式见 poi.schema.json）
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from '../../../src/game/core/geo.ts';
import { WA } from '../../../src/game/data/wa.ts';

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, 'inbox');
const target = join(here, '../../../src/game/data/wa.pois.json');
const dryRun = process.argv.includes('--dry-run');

const CATEGORIES = new Set(['park', 'beach', 'landmark', 'heritage', 'market', 'museum', 'lookout', 'food', 'pub', 'wildlife', 'trail']);
const SOURCES = new Set(['osm', 'wikidata', 'seed']);
const FIELDS = ['id', 'loc', 'name', 'lat', 'lon', 'category', 'source', 'license'];
const locs = new Map(WA.locations.map((l) => [l.id, l]));

/** 返回错误信息；合法返回 null */
function check(p) {
	if (!p || typeof p !== 'object') return '不是对象';
	const extra = Object.keys(p).filter((k) => !FIELDS.includes(k));
	if (extra.length) return `多余字段: ${extra.join(',')}`;
	if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(p.id)) return 'id 不合法';
	if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || /[<>]/.test(p.name)) return 'name 不合法';
	if (!CATEGORIES.has(p.category)) return `category 不合法: ${p.category}`;
	if (!SOURCES.has(p.source)) return `source 不合法: ${p.source}`;
	if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return '坐标不是数字';
	const loc = locs.get(p.loc);
	if (!loc) return `未知地点: ${p.loc}`;
	const km = haversineKm(p.lat, p.lon, loc.lat, loc.lon);
	if (km > loc.radiusKm) return `距 ${loc.id} ${km.toFixed(1)}km，超出打卡半径 ${loc.radiusKm}km`;
	return null;
}

const current = JSON.parse(readFileSync(target, 'utf8'));
const byId = new Map(current.pois.map((p) => [p.id, p]));
const files = existsSync(inbox) ? readdirSync(inbox).filter((f) => f.endsWith('.json')).sort() : [];
if (!files.length) {
	console.log(`inbox 为空（${inbox}）。只校验现有数据。`);
}

let errors = 0, added = 0, updated = 0;
for (const p of current.pois) {
	const err = check(p);
	if (err) { errors++; console.error(`✗ 现有数据 ${p.id}: ${err}`); }
}
for (const f of files) {
	let batch;
	try {
		batch = JSON.parse(readFileSync(join(inbox, f), 'utf8'));
	} catch (e) {
		errors++; console.error(`✗ ${f}: JSON 解析失败 ${e.message}`); continue;
	}
	if (batch.region !== 'wa' || !Array.isArray(batch.pois)) { errors++; console.error(`✗ ${f}: region 必须为 wa 且含 pois 数组`); continue; }
	for (const p of batch.pois) {
		const err = check(p);
		if (err) { errors++; console.error(`✗ ${f} ${p?.id ?? '?'}: ${err}`); continue; }
		byId.has(p.id) ? updated++ : added++;
		byId.set(p.id, p);
	}
}

if (errors) {
	console.error(`\n${errors} 处错误，未写入。`);
	process.exit(1);
}
console.log(`校验通过：新增 ${added}，更新 ${updated}，合计 ${byId.size} 个 POI。`);
if (!dryRun && files.length) {
	current.generatedBy = 'seed+openclaw';
	current.pois = [...byId.values()].sort((a, b) => a.loc.localeCompare(b.loc) || a.id.localeCompare(b.id));
	writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
	console.log(`已写入 ${target}`);
}
