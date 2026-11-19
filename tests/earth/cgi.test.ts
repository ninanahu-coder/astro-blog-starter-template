// CGI 素材：清单里的每张图都在、不太大；每个地点、事件和界面配图都有图，尺寸合规；提示词里不出现玩法标签。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { AREAS } from '../../src/game/data/areas-base.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';
import { PHOTO_QUESTS } from '../../src/game/data/photo-quests.ts';
import { FESTIVALS } from '../../src/game/data/festivals.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { COURSES } from '../../src/game/data/courses.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { FISH } from '../../src/game/data/fish.ts';
import { buildJobs, SCREEN_KINDS } from '../../tools/earth/comfyui/prompts.mjs';

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

// 界面配图（docs/earth-game/cg-screens.md）：每个类别的每一项都有图；方形缩略图压成 256 宽、宽图 640–960 宽

/** WebP 宽高：VP8X 扩展头（cwebp 加 -metadata none 时通常是 VP8 有损头） */
function webpSize(buf: Buffer) {
	const kind = buf.toString('ascii', 12, 16);
	if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
	if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
	if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
	throw new Error('不是 WebP：' + kind);
}

test('界面配图：每个类别的每一项都有图', () => {
	const data: Record<string, { id: string }[]> = {
		exp: EXPERIENCES, photo: PHOTO_QUESTS, fest: FESTIVALS, veh: VEHICLES, prop: PROPERTIES, home: HOMES,
		career: CAREERS, course: COURSES, cert: CERTS, fish: FISH,
	};
	const kinds = SCREEN_KINDS as Record<string, { square: boolean; ids: string[] }>;
	for (const [kind, list] of Object.entries(data)) {
		assert.ok(kinds[kind], `没有 ${kind} 类别`);
		for (const x of list) assert.ok(manifest.images[`${kind}:${x.id}`], `${kind}:${x.id} 没有图`);
	}
	for (const id of ['grow', 'social', 'near']) assert.ok(manifest.images['banner:' + id], `banner:${id} 没有图`);
	for (const id of ['bag', 'rels', 'estate']) assert.ok(manifest.images['empty:' + id], `empty:${id} 没有图`);
	for (const [kind, k] of Object.entries(kinds)) for (const id of k.ids) assert.ok(manifest.images[`${kind}:${id}`], `${kind}:${id} 没有图`);
});

test('界面配图：方形缩略图 256×256 且不超过 40KB，宽图 640–960 宽、横向', () => {
	const kinds = SCREEN_KINDS as Record<string, { square: boolean; ids: string[] }>;
	const jobs = new Map((buildJobs() as { key: string; size?: string; width?: number }[]).map((j) => [j.key, j]));
	for (const [kind, k] of Object.entries(kinds)) for (const id of k.ids) {
		const key = `${kind}:${id}`;
		const job = jobs.get(key)!;
		const file = new URL(manifest.images[key].replace('/earth/cgi/', ''), dir);
		const { w, h } = webpSize(readFileSync(file));
		if (k.square) {
			assert.equal(job.size, '1024x1024', key);
			assert.equal(job.width, 256, `${key} 的任务应压成 256 宽`);
			assert.ok(w === 256 && h === 256, `${key} 是 ${w}×${h}，应为 256×256`);
			assert.ok(statSync(file).size < 40_000, `${key} 太大`);
		} else {
			assert.equal(job.size, undefined, key);
			assert.ok(w >= 640 && w <= 960 && w === job.width, `${key} 宽 ${w}，应为 ${job.width}`);
			assert.ok(h < w, `${key} 不是横图`);
		}
	}
});
