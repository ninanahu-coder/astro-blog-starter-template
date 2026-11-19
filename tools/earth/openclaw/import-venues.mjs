#!/usr/bin/env node
// 校验采集的真实地点（餐馆、健身房、公园……）并按区域合并进 src/game/data/<区域>.venues.json（wa、sa……）。
// 用法：npm run earth:venues [-- --dry-run]
// 输入：tools/earth/openclaw/inbox/venues-*.json，格式：{ "region": "wa" | "sa", "venues": [ { id, loc, name, lat, lon, type, source, tier? } ] }
// 每条的地点必须属于批次写的区域。任何一条不合格，整批不写入。
// venue-exclude.json 里的 id（抽查确认关门、私人场所等）导入时跳过，已在数据里的删掉。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVenue, dedupeVenues } from './checks.mjs';
import { AREAS, areaOf } from '../../../src/game/data/areas-base.ts';

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, 'inbox');
const dataDir = join(here, '../../../src/game/data');
const dryRun = process.argv.includes('--dry-run');
const REGION_IDS = AREAS.map((a) => a.id);
const excludeFile = join(here, 'venue-exclude.json');
const EXCLUDE = new Map((existsSync(excludeFile) ? JSON.parse(readFileSync(excludeFile, 'utf8')).venues : []).map((e) => [e.id, e]));
const targetOf = (region) => join(dataDir, `${region}.venues.json`);

/** 每个区域一份：现有数据 + 这次的新数据 */
const regions = new Map();
for (const id of REGION_IDS) {
	const file = targetOf(id);
	// 新区域的文件头照西澳的写：区域、来源、许可署名
	const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { region: id, generatedBy: 'fetch-venues', attribution: '© OpenStreetMap contributors, ODbL', venues: [] };
	const venues = doc.venues;
	regions.set(id, { file, doc, exists: existsSync(file), current: venues, byId: new Map(venues.map((v) => [v.id, v])), touched: false });
}
const files = existsSync(inbox) ? readdirSync(inbox).filter((f) => f.startsWith('venues-') && f.endsWith('.json')).sort() : [];
if (!files.length) console.log(`inbox 里没有 venues-*.json（${inbox}）。只校验现有数据。`);

let errors = 0, added = 0, updated = 0, skipped = 0;
// 排除名单：已在数据里的删掉
for (const [, r] of regions) for (const id of EXCLUDE.keys()) if (r.byId.delete(id)) { r.touched = true; console.log(`排除：${EXCLUDE.get(id).name}（${id}）：${EXCLUDE.get(id).reason}`); }
for (const [id, r] of regions) for (const v of r.current) {
	const err = checkVenue(v) ?? (areaOf(v.loc)?.id !== id ? `地点 ${v.loc} 不属于区域 ${id}` : null);
	if (err) { errors++; console.error(`✗ 现有数据 ${id} ${v.id}: ${err}`); }
}
for (const f of files) {
	let batch;
	try {
		batch = JSON.parse(readFileSync(join(inbox, f), 'utf8'));
	} catch (e) {
		errors++; console.error(`✗ ${f}: JSON 解析失败 ${e.message}`); continue;
	}
	const r = typeof batch?.region === 'string' && REGION_IDS.includes(batch.region) ? regions.get(batch.region) : undefined;
	if (!r || !Array.isArray(batch.venues)) { errors++; console.error(`✗ ${f}: region 必须是 ${REGION_IDS.join(' / ')} 之一且含 venues 数组`); continue; }
	for (const v of batch.venues) {
		const err = checkVenue(v) ?? (areaOf(v.loc)?.id !== batch.region ? `地点 ${v.loc} 不属于区域 ${batch.region}` : null);
		if (err) { errors++; console.error(`✗ ${f} ${v?.id ?? '?'}: ${err}`); continue; }
		if (EXCLUDE.has(v.id)) { skipped++; continue; }
		r.byId.has(v.id) ? updated++ : added++;
		r.byId.set(v.id, v);
		r.touched = true;
	}
}

if (errors) {
	console.error(`\n${errors} 处错误，未写入。`);
	process.exit(1);
}
// 同一场所的重复记录（同类型、同名、几乎同一位置）只留一条
console.log(`校验通过：新增 ${added}，更新 ${updated}，排除名单跳过 ${skipped}。`);
for (const [id, r] of regions) {
	if (!r.exists && !r.touched) continue;
	const { kept, dropped } = dedupeVenues([...r.byId.values()]);
	for (const d of dropped) console.log(`重复：${d.venue.name}（${d.venue.id}）与 ${d.keep} 相距 ${d.meters} 米，只保留后者。`);
	const byType = {};
	for (const v of kept) byType[v.type] = (byType[v.type] ?? 0) + 1;
	console.log(`${id}：去掉重复 ${dropped.length}，合计 ${kept.length} 个地点。`, byType);
	if (!dryRun && (r.touched || dropped.length)) {
		writeFileSync(r.file, JSON.stringify({ ...r.doc, venues: [...kept].sort((a, b) => a.loc.localeCompare(b.loc) || a.id.localeCompare(b.id)) }, null, 2) + '\n');
		console.log(`已写入 ${r.file}`);
	}
}
