#!/usr/bin/env node
// 校验 OpenClaw 采集的真实地点（餐馆、健身房、公园……）并合并进 src/game/data/wa.venues.json。
// 用法：npm run earth:venues [-- --dry-run]
// 输入：tools/earth/openclaw/inbox/venues-*.json，格式：{ "region": "wa", "venues": [ { id, loc, name, lat, lon, type, source, tier? } ] }
// 任何一条不合格，整批不写入。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVenue, dedupeVenues } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, 'inbox');
const target = join(here, '../../../src/game/data/wa.venues.json');
const dryRun = process.argv.includes('--dry-run');



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
// 同一场所的重复记录（同类型、同名、几乎同一位置）只留一条
const { kept, dropped } = dedupeVenues([...byId.values()]);
for (const d of dropped) console.log(`重复：${d.venue.name}（${d.venue.id}）与 ${d.keep} 相距 ${d.meters} 米，只保留后者。`);
const byType = {};
for (const v of kept) byType[v.type] = (byType[v.type] ?? 0) + 1;
console.log(`校验通过：新增 ${added}，更新 ${updated}，去掉重复 ${dropped.length}，合计 ${kept.length} 个地点。`, byType);
if (!dryRun && (files.length || dropped.length)) {
	current.venues = [...kept].sort((a, b) => a.loc.localeCompare(b.loc) || a.id.localeCompare(b.id));
	writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
	console.log(`已写入 ${target}`);
}
