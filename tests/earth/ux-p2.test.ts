// 体验改造 P2（docs/earth-game/ux-p2.md）：emoji 换成 Fluent Emoji 扁平版、界面图标换成 Lucide、提示音换 ZzFX 后的门禁
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EMOJI_CODES } from '../../src/game/data/emoji-set.ts';
import { emojiSrc, splitEmoji } from '../../src/game/ui/emoji.ts';
import { LUCIDE_NAMES, LUCIDE_SPRITE } from '../../src/game/ui/lucide-sprite.ts';
import { lu } from '../../src/game/ui/lu.ts';
import { DEFAULT_PREFS } from '../../src/game/ui/prefs.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const PAGE = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?|[\u{1F3FB}-\u{1F3FF}])*/gu;

test('源码里用到的每个 emoji 都有扁平版小图（新加 emoji 要重跑 tools/earth/icons/build-emoji.mjs）', () => {
	const files = ['src/game/data', 'src/game/core', 'src/game/ui'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.ts') && f !== 'emoji-set.ts').map((f) => join(ROOT, d, f))).concat([join(ROOT, 'src/pages/earth.astro')]);
	const missing = new Set<string>();
	for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(EMOJI_RE)) { const g = m[0].replace(/️/g, ''); if (!Object.hasOwn(EMOJI_CODES, g)) missing.add(g); }
	assert.deepEqual([...missing], []);
	for (const code of Object.values(EMOJI_CODES)) assert.ok(existsSync(join(ROOT, 'public/earth/emoji', code + '.svg')), code);
});

test('小图只当图片用：没有脚本、事件属性、外链；每张不超过 40KB、总共不超过 1MB；附 MIT 许可', () => {
	const dir = join(ROOT, 'public/earth/emoji');
	const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
	assert.equal(files.length, new Set(Object.values(EMOJI_CODES)).size, '没有多余的图');
	for (const f of files) {
		const svg = readFileSync(join(dir, f), 'utf8');
		assert.doesNotMatch(svg, /<script|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?!#)|@import|<foreignObject/i, f);
		// 最大的是头像里的「卷发的人」（约 34KB，Fluent 原图就这么复杂）；其余都在 14KB 以内，用到时才下载
		assert.ok(statSync(join(dir, f)).size < 40_000, `${f} 太大`);
	}
	assert.ok(files.reduce((n, f) => n + statSync(join(dir, f)).size, 0) < 1_000_000, '总量');
	assert.match(readFileSync(join(dir, 'LICENSE.txt'), 'utf8'), /MIT License[\s\S]*Microsoft/);
});

test('切分 emoji：普通文字、变体符号、零宽连接、肤色；没图的 emoji 留在文字里；原型链上的名字不当 emoji', () => {
	const codes = { '🍔': '1f354', '☀': '2600', '👩‍🦰': '1f469-200d-1f9b0', '👍🏽': '1f44d-1f3fd' };
	assert.deepEqual(splitEmoji('吃 🍔 吧', codes), [{ t: 'text', v: '吃 ' }, { t: 'emo', glyph: '🍔', code: '1f354' }, { t: 'text', v: ' 吧' }]);
	assert.deepEqual(splitEmoji('☀️晴', codes), [{ t: 'emo', glyph: '☀️', code: '2600' }, { t: 'text', v: '晴' }], '带 FE0F 的也认，glyph 原样保留给 alt');
	assert.deepEqual(splitEmoji('👩‍🦰', codes), [{ t: 'emo', glyph: '👩‍🦰', code: '1f469-200d-1f9b0' }]);
	assert.deepEqual(splitEmoji('👍🏽', codes), [{ t: 'emo', glyph: '👍🏽', code: '1f44d-1f3fd' }]);
	assert.deepEqual(splitEmoji('🦄 没图', codes), [{ t: 'text', v: '🦄 没图' }]);
	assert.deepEqual(splitEmoji('', codes), []);
	assert.deepEqual(splitEmoji('🍔', Object.create({ '🍔': '../../x' })), [{ t: 'text', v: '🍔' }], '只认表自己的键');
	assert.equal(emojiSrc('1f354'), '/earth/emoji/1f354.svg');
	assert.equal(emojiSrc('1f469-200d-1f9b0'), '/earth/emoji/1f469-200d-1f9b0.svg');
	for (const bad of ['../x', '1F354', '1f354.svg', 'javascript:x', '']) assert.equal(emojiSrc(bad), '', bad);
});

test('页面接上了：查找表按需加载（不进首屏），下好后补换已画的；顶栏、面板、弹窗、提示条写完都换', () => {
	assert.match(PAGE, /void import\('\.\.\/game\/ui\/emoji\.ts'\)\.then\(\(m\) => \{ emo = m; for \(const id of \['hud', 'panel', 'modal', 'toast'\]\) m\.emojify\(document\.getElementById\(id\)\); \}\)/);
	assert.doesNotMatch(PAGE, /import \{ emojify \} from/, '不能静态 import（会进首屏）');
	assert.match(PAGE, /function paint\(el: HTMLElement, html: string\) \{\n\t*if \(setHtml\(el, html\)\) emo\?\.emojify\(el\);/);
	for (const w of ["paint($('hud')", "paint($('panel'), html)", 'paint(modal, `<div class="sheet drawer"']) assert.ok(PAGE.includes(w), w);
	assert.equal((PAGE.match(/paint\(modal, `<div class="sheet" role="dialog"/g) ?? []).length, 2, '事件和结果页');
	assert.match(PAGE, /el\.textContent = msg;\n\t*emo\?\.emojify\(el\);/, '提示条');
	assert.match(PAGE, /#app img\.emo, #modal img\.emo, #toast img\.emo \{[^}]*width: 1\.2em; height: 1\.2em;/);
});

test('Lucide：雪碧图在构建时写进页面，每个名字都有；lu() 输出装饰性图标；页面脚本只 import 类型', () => {
	assert.match(PAGE, /import \{ LUCIDE_SPRITE \} from '\.\.\/game\/ui\/lucide-sprite\.ts';\n/, '在页面头部（构建时）引入');
	assert.match(PAGE, /<body>\n\t*<Fragment set:html=\{LUCIDE_SPRITE\} \/>/);
	assert.match(PAGE, /import type \{ LucideName \} from '\.\.\/game\/ui\/lucide-sprite\.ts';/);
	for (const n of LUCIDE_NAMES) assert.ok(LUCIDE_SPRITE.includes(`<symbol id="lu-${n}" viewBox="0 0 24 24">`), n);
	assert.doesNotMatch(LUCIDE_SPRITE, /<script|\son[a-z]+=|href=/i);
	assert.equal(lu('house'), '<svg class="lu" aria-hidden="true" focusable="false"><use href="#lu-house"/></svg>');
	assert.equal(lu('circle-check', 'done'), '<svg class="lu done" aria-hidden="true" focusable="false"><use href="#lu-circle-check"/></svg>');
	// 「在这里」的每个分组、定位、箭头、主线勾选都用 Lucide，不再用 emoji 当界面图标
	for (const n of ['sparkles', 'shopping-bag', 'briefcase-business', 'house', 'users', 'ticket', 'graduation-cap', 'car', 'paw-print', 'map-pin']) assert.ok(PAGE.includes(`, '${n}', `), n);
	assert.match(PAGE, /<span class="ico">\$\{lu\('locate-fixed'\)\}<\/span><span class="body">真实定位打卡/);
	assert.match(PAGE, /<span class="chev" aria-hidden="true">\$\{lu\('chevron-right'\)\}<\/span>/);
	assert.match(PAGE, /lu\(x\.got >= x\.need \? 'circle-check' : 'circle'/);
});

test('音效默认开、总音量默认最轻（用户 2026-11-21 定）；环境音和音乐仍默认关', () => {
	assert.equal(DEFAULT_PREFS.sound, true);
	assert.equal(DEFAULT_PREFS.volume, 'low');
	assert.equal(DEFAULT_PREFS.ambience, false);
	assert.equal(DEFAULT_PREFS.music, false);
});

// ---------- 多角度复核（2026-11-21）后补的 ----------
import { isSafeIcon } from '../../tools/earth/icons/build-lucide.mjs';
import { CUE_RATE, CUES, cueSamples, VOLUME, type Cue } from '../../src/game/ui/sound.ts';
import { zzfxSamples } from '../../src/game/ui/zzfx.ts';

test('复核修正：Lucide 雪碧图按白名单校验（用 set:html 写进页面，黑名单挡不住 <img/src/onerror>）', () => {
	assert.equal(isSafeIcon('<path d="M3 10a2 2 0 0 1 2-2" /><circle cx="12" cy="10" r="2.4" />'), true);
	for (const bad of ['<img/src="x"/onerror="alert(1)">', '<path d="M1" onload="x" />', '<script/>', '<use href="#a" />', '<path d="M1"/><foreignObject/>', '<a href="x"><path d="M1"/></a>', 'text']) assert.equal(isSafeIcon(bad), false, bad);
	for (const sym of LUCIDE_SPRITE.matchAll(/<symbol id="lu-[a-z-]+" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/g)) assert.ok(isSafeIcon(sym[1]), sym[1]);
	assert.match(LUCIDE_SPRITE, /^<!-- Lucide icons https:\/\/lucide\.dev ISC License Copyright \(c\) \d{4} Lucide Icons and Contributors Permission to use, copy, modify/, '雪碧图前面带完整 ISC 许可');
});

test('复核修正：第三方许可汇总（ZzFX MIT、Lucide ISC、Fluent MIT），ZzFX 源码头部用 /*! */ 保留注释', () => {
	const lic = readFileSync(join(ROOT, 'public/earth/LICENSES.txt'), 'utf8');
	for (const s of ['ZzFX', 'Copyright (c) 2019 Frank Force', 'Lucide', 'ISC License', 'Fluent Emoji', 'Copyright (c) Microsoft Corporation']) assert.ok(lic.includes(s), s);
	assert.match(readFileSync(join(ROOT, 'src/game/ui/zzfx.ts'), 'utf8'), /\/\*!\nZzFX - Zuper Zmall Zound Zynth - Micro Edition\nMIT License - Copyright 2019 Frank Force/);
});

test('复核修正：每个声部的滑音不滑过 0 Hz（滑过去会先降到底再往上走）', () => {
	for (const [cue, voices] of Object.entries(CUES)) for (const v of voices) {
		const [, , f = 220, a = 0, su = 0, re = 0.1, , , slide = 0, , , , , , , , , , de = 0] = v.zz;
		assert.ok(f + 500 * slide * (a + de + su + re) > 40, `${cue} 结尾 ${f + 500 * slide * (a + de + su + re)} Hz`);
	}
});

test('复核修正：风暴是低通滤过的闷雷（高频成分远小于整体）；同一时刻的声部是叠加不是覆盖', () => {
	const hiRatio = (s: Float32Array) => { let e = 0, d = 0; for (let i = 1; i < s.length; i++) { e += s[i] * s[i]; d += (s[i] - s[i - 1]) ** 2; } return d / e; };
	assert.ok(hiRatio(cueSamples('storm')) < 0.2, `风暴高频比 ${hiRatio(cueSamples('storm'))}`);
	const flipped = CUES.storm[0].zz.slice() as typeof CUES.storm[0]['zz'];
	flipped[20] = -(flipped[20] ?? 0);
	assert.ok(hiRatio(zzfxSamples(flipped, CUE_RATE, () => 0.5)) > hiRatio(cueSamples('storm')) * 5, '滤波换成正号（高通）时高频多得多：说明现在是低通');
	const [v1, v2] = CUES.stamp;
	const a = zzfxSamples(v1.zz, CUE_RATE, () => 0.5), b = zzfxSamples(v2.zz, CUE_RATE, () => 0.5);
	const sum = cueSamples('stamp' as Cue);
	for (const i of [0, 10, 200, Math.min(a.length, b.length) - 1]) assert.ok(Math.abs(sum[i] - (a[i] + b[i]) * VOLUME) < 1e-6, `第 ${i} 个采样`);
});

test('复核修正：页面把「进账」传给提示音；玩家点过或按过键之前不出声（不在没手势时建音频、攒着声音）', () => {
	assert.match(PAGE, /weather: weatherAt\(state\)\.id, coin: state\.cash > before\.cash \}\);/);
	assert.match(PAGE, /function sfx\(cue: Cue\) \{\n\t*if \(!prefs\.sound \|\| !gestured\) return;/);
	assert.match(PAGE, /document\.addEventListener\('keydown', \(e\) => \{\n\t*gestured = true;/);
	assert.match(PAGE, /gestured = true;\n\t*const t = \(e\.target as Element\)\.closest<HTMLElement>\('\[data-tab\],/);
	assert.match(PAGE, /#app img\.emo, #modal img\.emo, #toast img\.emo \{ position: static; inset: auto;[^}]*opacity: 1;/, 'emoji 小图不被事件主视觉的 img 规则拉满、压暗');
});
