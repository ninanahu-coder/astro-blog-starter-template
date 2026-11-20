// 点击委托：页面只在 document 上挂一个 click 监听，靠 closest('[data-x],…') 这份名单找到被点的按钮。
// 处理分支里写了 d.x 却没把 [data-x] 加进名单，按钮就点了没反应，而且别的测试都看不出来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

test('点击委托：每个顶层处理分支的 data 属性都在选择器名单里', () => {
	const m = src.match(/closest<HTMLElement>\('(\[data-tab\][^']*)'\)/);
	assert.ok(m, '找不到点击委托的选择器名单');
	const listed = new Set(m[1].split(',').map((x) => x.slice(1, -1)));
	const from = src.indexOf(m[0]);
	const body = src.slice(from, src.indexOf('\n\t\t\t});', from));
	// 只看与 `if (d.tab)` 同一缩进的分支，嵌套里的 d.xxx 是按钮的附带参数
	const indent = body.match(/\n(\t+)if \(d\.tab\)/)?.[1];
	assert.ok(indent, '找不到第一个处理分支');
	// 两种写法：if (d.x …) 和 if ('x' in d)
	const heads = [...body.matchAll(new RegExp(`\\n${indent}(?:\\} )?(?:else )?if \\((?:d\\.([a-zA-Z]+)\\b|'([a-zA-Z]+)' in d\\b)`, 'g'))].map((x) => x[1] ?? x[2]);
	assert.ok(heads.length > 30, `处理分支太少（${heads.length}），正则可能没对上`);
	const missing = heads.map((h) => 'data-' + kebab(h)).filter((a) => !listed.has(a));
	assert.deepEqual(missing, [], '这些按钮点了不会有反应');
});
