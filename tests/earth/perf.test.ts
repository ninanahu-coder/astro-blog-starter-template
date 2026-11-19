// 性能（第 41 批）：局部重绘、地图样式按需插入、缓存头。体积上限见 bundle.test.ts，分析见 docs/earth-game/performance.md。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setHtml } from '../../src/game/ui/dom.ts';
import { addHeadLink, BASEMAP_ORIGIN, type HeadDoc } from '../../src/game/ui/basemap.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('setHtml：内容一样不碰 DOM，变了才写', () => {
	let writes = 0;
	let html = '';
	const el = { get innerHTML() { return html; }, set innerHTML(v: string) { writes++; html = v; } };
	assert.equal(setHtml(el, '<b>a</b>'), true);
	assert.equal(setHtml(el, '<b>a</b>'), false);
	assert.equal(writes, 1);
	assert.equal(setHtml(el, '<b>b</b>'), true);
	assert.equal(html, '<b>b</b>');
	// 每个元素各记各的
	const other = { innerHTML: '' };
	assert.equal(setHtml(other, '<b>b</b>'), true);
	assert.equal(writes, 2);
});

function fakeHead() {
	const links: Record<string, unknown>[] = [];
	const doc: HeadDoc = { head: { appendChild: (n) => links.push(n as Record<string, unknown>) }, createElement: () => ({}) };
	return { doc, links };
}

test('addHeadLink：同一个链接只加一次；预连接带 crossorigin；样式表等加载完', async () => {
	const { doc, links } = fakeHead();
	await addHeadLink(doc, 'preconnect', BASEMAP_ORIGIN, { crossOrigin: true });
	await addHeadLink(doc, 'preconnect', BASEMAP_ORIGIN, { crossOrigin: true });
	assert.equal(links.length, 1);
	assert.deepEqual({ rel: links[0].rel, href: links[0].href, crossOrigin: links[0].crossOrigin }, { rel: 'preconnect', href: 'https://tiles.openfreemap.org', crossOrigin: 'anonymous' });
	let done = false;
	const p = addHeadLink(doc, 'stylesheet', '/_astro/x.css').then(() => (done = true));
	await new Promise((ok) => setTimeout(ok, 5));
	assert.equal(done, false, '样式表没加载完之前不返回');
	(links[1].onload as () => void)();
	await p;
	assert.equal(done, true);
	// 加载失败也继续（地图照样能用，只是控件没样式）
	const q = addHeadLink(doc, 'stylesheet', '/_astro/y.css');
	(links[2].onerror as () => void)();
	await q;
	// 一直没有回音：超时后继续
	await addHeadLink(doc, 'stylesheet', '/_astro/z.css', { timeoutMs: 5 });
	assert.equal(links.length, 4);
});

test('页面脚本不直接 import CSS：会被 Astro 提进 <head> 阻塞首屏渲染（地图样式 70KB）', () => {
	const files = [join(ROOT, 'src/pages/earth.astro'), ...readdirSync(join(ROOT, 'src/game/ui')).map((f) => join(ROOT, 'src/game/ui', f))];
	for (const f of files) {
		const src = readFileSync(f, 'utf8');
		assert.doesNotMatch(src, /import\s*\(\s*['"][^'"]+\.css['"]\s*\)/, `${f} 动态 import 了 CSS，改用 ?url 加 addHeadLink`);
		assert.doesNotMatch(src, /^\s*import\s+['"][^'"]*maplibre[^'"]*\.css['"]/m, `${f} 静态 import 了地图样式`);
	}
});

/** 解析 public/_headers：路径行顶格，头部行缩进 */
function headerRules() {
	const rules: { path: string; headers: Record<string, string> }[] = [];
	for (const line of readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n')) {
		if (!line.trim() || line.trim().startsWith('#')) continue;
		if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
		else {
			const i = line.indexOf(':');
			rules.at(-1)!.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
		}
	}
	return rules;
}
const matches = (pattern: string, path: string) => new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(path);

test('缓存头：构建文件永久缓存，插图短缓存，页面不缓存，规则互不重叠', () => {
	const rules = headerRules();
	const cc = (path: string) => rules.filter((r) => matches(r.path, path)).map((r) => r.headers['cache-control']).filter(Boolean);
	assert.deepEqual(cc('/_astro/earth.astro_astro_type_script_index_0_lang.MPLOutYp.js'), ['public, max-age=31536000, immutable']);
	assert.deepEqual(cc('/_astro/wa.venues.B8LH0vTE.js'), ['public, max-age=31536000, immutable']);
	const img = cc('/earth/cgi/perth.webp');
	assert.equal(img.length, 1);
	assert.ok(!img[0].includes('immutable'), '插图文件名不带哈希，不能标 immutable');
	assert.ok(Number(/max-age=(\d+)/.exec(img[0])![1]) <= 86400);
	assert.equal(cc('/earth/cgi/manifest.json').length, 1, '插图清单只被一条规则命中（重叠会把两个值拼在一起）');
	for (const page of ['/earth/', '/earth/index.html', '/earth/sw.js', '/']) assert.deepEqual(cc(page), [], `${page} 不能长缓存`);
	// 带哈希的才能 immutable：所有 immutable 规则都只能在 /_astro/ 下
	for (const r of rules) if (r.headers['cache-control']?.includes('immutable')) assert.ok(r.path.startsWith('/_astro/'), r.path);
});
