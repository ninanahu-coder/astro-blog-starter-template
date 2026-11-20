// 人物模型（tools/earth/blender）：形象数据要和游戏的形象、出身、职业对得上，证件照文件要齐、不超体积。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { AVATARS, ORIGINS } from '../../src/game/core/character.ts';
import { CAREERS } from '../../src/game/data/careers.ts';

const root = new URL('../../', import.meta.url);
const looks = JSON.parse(readFileSync(new URL('tools/earth/blender/looks.json', root), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('public/earth/char/manifest.json', root), 'utf8'));

test('人物形象：looks.json 和 AVATARS 一一对应，每个出身和职业都有装束', () => {
	assert.deepEqual(looks.looks.map((l: { emoji: string }) => l.emoji), AVATARS);
	for (const l of looks.looks) assert.ok(Number.isInteger(l.tone) && l.tone >= 0 && l.tone <= 4, l.name);
	for (const id of [...ORIGINS.map((o) => o.id), ...CAREERS.map((c) => c.id)]) assert.ok(looks.outfits[id], `缺装束：${id}`);
});

test('人物证件照：每个出身 × 每个形象都有一张，文件存在、是 WebP、不超过 30KB', () => {
	const want = ORIGINS.flatMap((o) => AVATARS.map((_, i) => `${o.id}-${i}`)).sort();
	assert.deepEqual(Object.keys(manifest.busts).sort(), want);
	for (const [key, url] of Object.entries(manifest.busts) as [string, string][]) {
		assert.equal(url, `/earth/char/${key}.webp`);
		const file = new URL(`public${url}`, root);
		assert.ok(existsSync(file), url);
		const buf = readFileSync(file);
		assert.equal(buf.subarray(8, 12).toString('ascii'), 'WEBP', `${url} 不是 WebP`);
		assert.ok(statSync(file).size <= 30_000, `${url} 超过 30KB`);
	}
});
