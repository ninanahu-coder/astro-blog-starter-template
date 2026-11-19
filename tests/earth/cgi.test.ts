// CGI 素材：清单里的每张图都在、不太大；每个地点和事件都有图；提示词里不出现玩法标签。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { AREAS } from '../../src/game/data/areas-base.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { buildJobs } from '../../tools/earth/comfyui/prompts.mjs';

const dir = new URL('../../public/earth/cgi/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as { images: Record<string, string> };

test('CGI 清单：每项指向存在的 WebP，单张不超过 250KB', () => {
	const entries = Object.entries(manifest.images);
	assert.ok(entries.length > 0, '清单是空的');
	for (const [key, url] of entries) {
		assert.match(url, /^\/earth\/cgi\/[a-z0-9-]+\.webp$/, key);
		const file = new URL(url.replace('/earth/cgi/', ''), dir);
		assert.ok(existsSync(file), `${key} 的图片不存在`);
		assert.ok(statSync(file).size < 250_000, `${key} 太大`);
	}
});

test('CGI：每个地点和事件都有图，清单里没有提示词以外的项', () => {
	const jobs = buildJobs() as { key: string; prompt: string }[];
	for (const a of AREAS) for (const l of a.locations) assert.ok(manifest.images[l.id], `${l.id} 没有主视觉`);
	for (const e of EVENTS) assert.ok(manifest.images['event:' + e.id], `事件 ${e.id} 没有插图`);
	const keys = new Set(jobs.map((j) => j.key));
	for (const k of Object.keys(manifest.images)) assert.ok(keys.has(k), `清单里多了 ${k}`);
	// 玩法标签照字面画会让画面又挤又乱
	for (const j of jobs) assert.doesNotMatch(j.prompt, /\b(airport|hospital|gym|dealer)\b/, j.key);
});
