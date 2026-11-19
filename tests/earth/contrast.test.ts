// 配色对比度回归测试：从 earth.astro 读出浅色、深色两套颜色变量，检查文字和背景的组合都达到 WCAG AA（4.5:1）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out[m[1]] = m[2];
	return out;
}
const lightStart = css.indexOf(':root {');
const light = tokens(css.slice(lightStart, css.indexOf('}', lightStart)));
const darkStart = css.indexOf(':root {', css.indexOf('@media (prefers-color-scheme: dark)'));
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}', darkStart))) };

function lum(hex: string): number {
	let h = hex.slice(1);
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

// [文字, 背景]：界面里实际出现的组合
const PAIRS: [string, string][] = [
	['--text', '--bg'], ['--text', '--card'], ['--text', '--card2'], ['--dim', '--bg'], ['--dim', '--card'], ['--dim', '--card2'],
	['--accent-ink', '--accent'], ['--accent', '--card'], ['--text2', '--card'], ['--text2', '--seg-bg'],
	['--tint-blue-ink', '--tint-blue'], ['--tint-green-ink', '--tint-green'], ['--tint-amber-ink', '--tint-amber'],
	['--tint-red-ink', '--tint-red'], ['--tint-cost-ink', '--tint-cost'], ['--low-ink', '--card'], ['--mid-ink', '--card'],
	['--ink-dim', '--ink'], ['--text', '--warm-bg'], ['--text', '--tint-red'], ['--text', '--soft'], ['--map-night-text', '--land-night'], ['--map-night-text', '--ocean-night'],
	// 「新」标记和底栏在线人数角标：橙底上的字（第 10 批审查问题 3）
	['--warm-ink', '--warm'],
	// 虚拟人生风格界面（Codex 界面审查建议）：地点名牌 / NPC 名牌、关系文字、对话气泡、高亮的第一个选项
	['--bg', '--text'], ['--tint-green-ink', '--card'], ['--text', '--tint-blue'],
	// 入境卡世界（v27）：顶栏是护照封皮（随时段换 --sky-* 的深浅），字是雾白、烫金；地点名牌、下一步卡、主按钮、toast
	['--pass-ink', '--pass'], ['--mist', '--pass'], ['--gold', '--pass'], ['--gold-2', '--pass'],
	['--pass-ink', '--sky-dawn'], ['--mist', '--sky-dawn'], ['--gold', '--sky-dawn'], ['--pass-ink', '--sky-dusk'], ['--mist', '--sky-dusk'], ['--gold', '--sky-dusk'],
	['--pass-ink', '--sky-night'], ['--mist', '--sky-night'], ['--gold', '--sky-night'], ['--ink-dim', '--ink'], ['--primary-ink', '--primary'], ['--accent', '--card2'],
];
// 不是文字的图形（关系条、需求条的填充和轨道）：WCAG 1.4.11 要求至少 3:1
const GRAPHIC_PAIRS: [string, string][] = [['--ok', '--soft']];

for (const [name, t] of [['浅色', light], ['深色', dark]] as const) {
	test(`配色对比度（${name}）：文字和背景至少 4.5:1`, () => {
		assert.ok(Object.keys(t).length > 20, '没读到颜色变量');
		const bad: string[] = [];
		for (const [fg, bg] of PAIRS) {
			assert.ok(t[fg] && t[bg], `${name} 缺少 ${fg} 或 ${bg}`);
			const r = ratio(t[fg], t[bg]);
			if (r < 4.5) bad.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
		}
		assert.deepEqual(bad, [], `${name}对比度不够：${bad.join('；')}`);
	});
	test(`配色对比度（${name}）：图形和底色至少 3:1`, () => {
		for (const [fg, bg] of GRAPHIC_PAIRS) {
			assert.ok(t[fg] && t[bg], `${name} 缺少 ${fg} 或 ${bg}`);
			assert.ok(ratio(t[fg], t[bg]) >= 3, `${name} ${fg} on ${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
		}
	});
}
