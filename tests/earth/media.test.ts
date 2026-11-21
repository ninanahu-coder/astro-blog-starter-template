// AIGC 媒体（docs/earth-game/aigc-media.md）：清单里每项文件都在、体积在上限内、语音有对应文字；
// 清单当不可信数据过滤；拼出来的 HTML 转义、不自动播放、短片不预载。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { AREAS } from '../../src/game/data/areas-base.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { CLIP_MAX_BYTES, greetHtml, heroHtml, parseMedia, VOICE_MAX_BYTES } from '../../src/game/ui/media.ts';

const pub = new URL('../../public/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('earth/media/manifest.json', pub), 'utf8'));
const media = parseMedia(raw);
const voices = JSON.parse(readFileSync(new URL('../../tools/earth/media/voices.json', import.meta.url), 'utf8')) as { lines: { npc: string; voice: string; text: string }[] };
const file = (url: string) => new URL(url.replace(/^\//, ''), pub);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

test('媒体清单：过滤后一项不少（清单里没有格式不对的项），并标明是 AI 生成', () => {
	assert.deepEqual(Object.keys(media.loc).sort(), Object.keys(raw.loc).sort());
	assert.deepEqual(Object.keys(media.voice).sort(), Object.keys(raw.voice).sort());
	assert.match(raw.note, /AI 生成/);
	for (const [k, c] of Object.entries(raw.loc as Record<string, { once?: unknown }>)) assert.equal(media.loc[k].once, c.once === true ? true : undefined, `${k} 的 once 没保留`);
});

test('地点短片：键是真实地点，文件在、不超过约 1MB，封面图在', () => {
	const locs = new Set(AREAS.flatMap((a) => a.locations.map((l) => l.id)));
	for (const [k, c] of Object.entries(media.loc)) {
		assert.ok(locs.has(k), `${k} 不是地点`);
		assert.ok(existsSync(file(c.src)), `${k} 的短片不存在`);
		assert.ok(statSync(file(c.src)).size <= CLIP_MAX_BYTES, `${k} 短片太大`);
		if (c.poster) assert.ok(existsSync(file(c.poster)), `${k} 的封面不存在`);
	}
});

test('地点短片验收记录：清单每一段都有测量且过线（tools/earth/media/clips-qa.json，§6.4）', () => {
	const qa = JSON.parse(readFileSync(new URL('../../tools/earth/media/clips-qa.json', import.meta.url), 'utf8')).clips as Record<string, Record<string, number | string | boolean>>;
	assert.deepEqual(Object.keys(qa).sort(), Object.keys(media.loc).sort(), '验收记录和清单的地点不一致');
	for (const [k, c] of Object.entries(media.loc)) {
		const r = qa[k];
		assert.equal(r.pass, true, `${k} 没过验收`);
		assert.equal(r.bytes, statSync(file(c.src)).size, `${k} 成片换过但没重新测量`);
		assert.equal(r.mode, c.once ? 'once' : 'loop', `${k} once / 循环和验收记录不一致`);
		assert.ok((r.kf_diff as number) < 10, `${k} 首帧和关键帧差太多（可能串帧）`);
		if (r.kind === 'keyframed') {
			// 首尾帧定镜头（Blender 定机位 + 重绘 + H3 补间）：只播一次；末帧要落在第二张关键帧上，中间没有单帧跳变
			assert.equal(c.once, true, `${k} 首尾不同的片子必须只播一次`);
			assert.ok((r.kf_end_diff as number) < 10, `${k} 末帧没落在关键帧上`);
			assert.ok((r.max_over_median as number) < 3, `${k} 有单帧跳变`);
			assert.match(c.poster ?? '', /^\/earth\/media\/loc\//, `${k} 封面要用短片自己的首帧`);
		} else if (c.once) {
			// 推镜：至少推近 4%，一路向前、不回弹
			assert.ok((r.scale_end as number) >= 1.04, `${k} 推镜不够：×${r.scale_end}`);
			assert.ok((r.rebound as number) <= 0.01 && r.monotonic === true, `${k} 推镜有回弹`);
		} else {
			// 循环：画面里有东西在动，成片首尾接得上（缝不超过片内最大相邻差的 3 倍）
			assert.ok((r.motion_median as number) >= 0.08, `${k} 几乎不动`);
			assert.ok((r.web_loop_seam as number) <= 3 * (r.web_max_adjacent as number), `${k} 循环缝太明显`);
		}
	}
});

test('NPC 语音：键是常驻 NPC，文件在、不超过 100KB，文字和台词表一致', () => {
	const byNpc = new Map(voices.lines.map((l) => [l.npc, l]));
	for (const [k, v] of Object.entries(media.voice)) {
		assert.ok(NPCS.some((n) => n.id === k), `${k} 不是 NPC`);
		assert.ok(existsSync(file(v.src)), `${k} 的语音不存在`);
		const size = statSync(file(v.src)).size;
		assert.ok(size > 2_000 && size <= VOICE_MAX_BYTES, `${k} 语音体积不对：${size}`);
		assert.equal(v.text, byNpc.get(k)?.text, `${k} 的文字和台词表不一致`);
	}
});

test('台词表：17 位常驻 NPC 各一条，1–2 句，都有音色', () => {
	assert.deepEqual(voices.lines.map((l) => l.npc).sort(), NPCS.map((n) => n.id).sort());
	for (const l of voices.lines) {
		assert.ok(l.voice.trim(), `${l.npc} 没有音色`);
		const sentences = l.text.split(/[。！？]/).filter((x) => x.trim()).length;
		assert.ok(sentences >= 1 && sentences <= 3 && l.text.length <= 40, `${l.npc} 台词太长：${l.text}`);
	}
});

test('parseMedia：外部地址、路径穿越、脚本地址、空文字都丢掉', () => {
	const m = parseMedia({
		loc: { o: { src: '/earth/media/loc/o.mp4', once: 'yes' }, a: { src: 'https://evil.example/x.webm' }, b: { src: '/earth/media/loc/../x.webm' }, c: { src: 'javascript:alert(1)' }, 'D!': { src: '/earth/media/loc/d.webm' }, ok: { src: '/earth/media/loc/ok.webm', poster: 'https://x/y.webp' } },
		voice: { a: { src: '/earth/media/voice/a.mp3', text: '  ' }, b: { src: '/earth/media/voice/b.wav', text: '你好' }, c: { src: '/earth/media/voice/c.mp3', text: 3 } },
	});
	assert.deepEqual(m, { loc: { o: { src: '/earth/media/loc/o.mp4' }, ok: { src: '/earth/media/loc/ok.webm' } }, voice: {} });
	assert.equal(parseMedia({ loc: { o: { src: '/earth/media/loc/o.mp4', once: true } } }).loc.o.once, true);
	assert.deepEqual(parseMedia(null), { loc: {}, voice: {} });
	assert.deepEqual(parseMedia('x'), { loc: {}, voice: {} });
});

test('heroHtml：有短片放静音循环、不预载、不自动播放；没有就退回静态图，再退回图标', () => {
	const v = heroHtml(esc, { src: '/earth/media/loc/perth.webm', poster: '/earth/cgi/perth.webp' }, '/earth/cgi/perth.webp', '🏙');
	assert.match(v, /<video [^>]*muted loop playsinline preload="none"/);
	assert.doesNotMatch(v, /autoplay/);
	assert.match(v, /poster="\/earth\/cgi\/perth\.webp"/);
	assert.match(v, /AI 生成示意/);
	const img = heroHtml(esc, undefined, '/earth/cgi/perth.webp', '🏙');
	assert.match(img, /<img src="\/earth\/cgi\/perth\.webp"/);
	assert.match(img, /AI 生成示意/);
	assert.equal(heroHtml(esc, undefined, undefined, '🏙'), '<div class="hero">🏙</div>');
	assert.doesNotMatch(heroHtml(esc, { src: '"><script>' }, undefined, ''), /<script>/);
	// 只播一次的推镜版：不循环、不自动播放、不预载，带 data-once 给页面识别
	const once = heroHtml(esc, { src: '/earth/media/loc/perth.mp4', once: true }, '/earth/cgi/perth.webp', '🏙');
	assert.match(once, /<video [^>]*muted data-once="1" playsinline preload="none"/);
	assert.doesNotMatch(once, /\bloop\b|autoplay/);
	assert.match(once, /AI 生成示意/);
});

test('greetHtml：文字转义、按钮点了才播、标明 AI 语音；没有语音就什么都不加', () => {
	const h = greetHtml(esc, 'mia', '米娅', { src: '/earth/media/voice/mia.mp3', text: '<b>早</b>' });
	assert.match(h, /&lt;b&gt;早&lt;\/b&gt;/);
	assert.match(h, /data-voice="mia"/);
	assert.match(h, /AI 语音示意/);
	assert.doesNotMatch(h, /<audio|autoplay/);
	assert.equal(greetHtml(esc, 'mia', '米娅', undefined), '');
});

test('页面：媒体清单异步拉取，地点主视觉和 NPC 卡片走 media.ts', () => {
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(page, /fetch\('\/earth\/media\/manifest\.json'\)/);
	assert.match(page, /heroHtml\(esc, media\.loc\[key\]/);
	assert.match(page, /greetHtml\(esc, npc\.id, npc\.name, media\.voice\[npc\.id\]\)/);
	assert.doesNotMatch(page, /import [^;]*media\/manifest\.json/);
	// 重绘沿用正在播的短片；once 的播完（或这次到达已播过）不再 play
	assert.match(page, /wireClips\(prevClip\)/);
	assert.match(page, /!onceOver\(v\)\) v\.play\(\)/);
});
