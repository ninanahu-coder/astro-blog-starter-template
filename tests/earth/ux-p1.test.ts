// 体验改造 P1 的静态门禁（docs/earth-game/ux-p1.md）：进游戏后的界面字号不小于 12px。
// 例外：开场入境卡（另有设计语言）、地图和印章里的 SVG 文字（随画面缩放）、读屏跳过的装饰性英文小标签。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
const EXEMPT = /^\s*(\.bp-|\.ac-|#map\b|[^{]*stamp|#hud \.plate \.en|\.next \.lbl i)/;

test('进游戏后的 CSS 字号都不小于 12px', () => {
	const bad = PAGE.split('\n').filter((l) => l.includes('{') && /font-size:\s*([0-9]|1[01])(\.\d+)?px/.test(l) && !EXEMPT.test(l));
	assert.deepEqual(bad.map((l) => l.trim().slice(0, 80)), []);
});

test('模板里没有用行内样式写小于 12px 的字', () => {
	assert.deepEqual([...PAGE.matchAll(/style="[^"]*font-size:\s*([0-9]|1[01])(\.\d+)?px/g)].map((m) => m[0]), []);
});

// 下面几条来自多角度复核（2026-11-21）：行为在测试用的假页面里测不到（视频、滚动、真实焦点），只能守住代码
test('复核修正：抽屉里的地点短片也接上播放；同一个抽屉重画时放回滚动位置和焦点', () => {
	assert.match(PAGE, /querySelectorAll<HTMLVideoElement>\('#panel video\.loc-clip, #modal \.drawer video\.loc-clip'\)/);
	assert.match(PAGE, /if \(sh\) sh\.scrollTop = prevTop;/);
	assert.match(PAGE, /if \(f && !f\.hasAttribute\('disabled'\)\) f\.focus\(\{ preventScroll: true \}\);/);
	assert.match(PAGE, /wireClips\(prevClip\);\n\t*return;\n\t*\}/, '抽屉画完接上短片');
});

test('复核修正：减少动态效果时不显示飘字；事件结果页开着时 Esc、点遮罩不关后面的抽屉', () => {
	assert.match(PAGE, /html\.calm \.ring-delta, html\.calm \.cash-delta \{ display: none; \}/);
	assert.match(PAGE, /if \(drawer && !eventResult && !\(state && getPendingEvent\(state\)\)\) \{ closeDrawer\(\); return; \}/);
	assert.match(PAGE, /if \(drawer && !eventResult && e\.target === \$\('modal'\)/);
});

test('复核修正：「刚才」的环变化只给今天页用一次，换页、后台同步换存档时清掉', () => {
	assert.match(PAGE, /if \(tab !== 'place'\) ringFx = \{\};/);
	assert.match(PAGE, /lastDelta = \[\]; ringFx = \{\}; cashFx = 0;/);
});

test('复核修正：顶栏英文地名对读屏隐藏（字号豁免的前提）', () => {
	assert.match(PAGE, /<span class="en" lang="en" aria-hidden="true">/);
});

test('复核修正：摘要数字——自己的房不算在售，「做事」算上在车里睡', () => {
	assert.match(PAGE, /props\.some\(\(x\) => !x\.owned\) \? `\$\{props\.filter\(\(x\) => !x\.owned\)\.length\} 套房出售`/);
	assert.match(PAGE, /`现在能做 \$\{openActs\.length \+ \(vanHtml \? 1 : 0\)\} 项/);
	assert.match(PAGE, /节日专属体验在「在这里 · 体验和爱好」里。/);
});
