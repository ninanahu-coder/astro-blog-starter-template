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
	assert.match(PAGE, /img\.emo \{ display: inline-block; width: 1\.2em; height: 1\.2em;/);
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
