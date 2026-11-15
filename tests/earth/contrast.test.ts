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
	['--accent-ink', '--accent'], ['--accent', '--card'], ['--text2', '--card'],
	['--tint-blue-ink', '--tint-blue'], ['--tint-green-ink', '--tint-green'], ['--tint-amber-ink', '--tint-amber'],
	['--tint-red-ink', '--tint-red'], ['--tint-cost-ink', '--tint-cost'], ['--low-ink', '--card'], ['--mid-ink', '--card'],
	['--ink-dim', '--ink'], ['--text', '--warm-bg'], ['--text', '--tint-red'],
];

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
}
