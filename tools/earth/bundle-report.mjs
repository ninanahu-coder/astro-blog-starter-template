#!/usr/bin/env node
// 地球人生首屏体积报告（第 41 批，性能）。两部分：
// 1. 模块构成：和 tests/earth/bundle.test.ts 同样的 esbuild 分包（压缩、未 gzip），列出首屏入口里每个模块占多少、按需分块有哪些；
// 2. 真实构建产物：读 dist/earth/index.html 引用的 JS/CSS（要先 npm run build），给出原始、gzip、brotli 大小。
// 用法：node tools/earth/bundle-report.mjs [仓库根目录] [--top N] [--json]
import { build } from 'esbuild';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const args = process.argv.slice(2);
const ROOT = resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? fileURLToPath(new URL('../../', import.meta.url)));
const TOP = Number(args[args.indexOf('--top') + 1]) || 30;
const JSON_OUT = args.includes('--json');

const gz = (b) => gzipSync(b, { level: 9 }).length;
const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KiB';

async function modules() {
	const astro = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
	const start = astro.indexOf('<script>') + '<script>'.length;
	const end = astro.indexOf('</script>', start);
	const out = await build({
		stdin: { contents: astro.slice(start, end), resolveDir: join(ROOT, 'src/pages'), loader: 'ts', sourcefile: 'earth-page.ts' },
		bundle: true, splitting: true, format: 'esm', minify: true, outdir: '/earth-report', write: false, metafile: true, logLevel: 'silent',
		loader: { '.css': 'empty' }, external: ['*?url'],
		// 量别的工作区时它可能没装依赖：用本脚本所在仓库的 node_modules 兜底
		nodePaths: [fileURLToPath(new URL('../../node_modules', import.meta.url))],
	});
	const base = (p) => p.split('/').pop();
	const files = new Map(out.outputFiles.map((f) => [base(f.path), f.contents]));
	const outs = out.metafile.outputs;
	const entryName = Object.keys(outs).find((k) => outs[k].entryPoint);
	// 首屏 = 入口 + 它静态 import 的分块（递归）
	const first = new Set([entryName]);
	for (const name of first) for (const i of outs[name].imports) if (i.kind === 'import-statement' && outs[i.path]) first.add(i.path);
	const byModule = new Map();
	for (const name of first) for (const [k, v] of Object.entries(outs[name].inputs)) byModule.set(k, (byModule.get(k) ?? 0) + v.bytesInOutput);
	const firstBytes = [...first].reduce((s, n) => s + outs[n].bytes, 0);
	const firstGzip = [...first].reduce((s, n) => s + gz(files.get(base(n))), 0);
	// 按目录归类：页面脚本本身 / 数据 / 引擎 / 界面工具
	const groups = {};
	for (const [k, v] of byModule) {
		const g = k === 'earth-page.ts' || k.endsWith('earth-page.ts') ? '页面脚本 earth.astro' : k.includes('src/game/data/') ? '数据 src/game/data' : k.includes('src/game/core/') ? '引擎 src/game/core' : k.includes('src/game/ui/') ? '界面工具 src/game/ui' : '其他';
		groups[g] = (groups[g] ?? 0) + v;
	}
	const lazy = Object.entries(outs).filter(([k, o]) => !first.has(k) && Object.keys(o.inputs).length).map(([k, o]) => ({ file: k, bytes: o.bytes, inputs: Object.keys(o.inputs).map((i) => i.replace(/^.*node_modules\//, 'node_modules/').replace(/^.*src\//, 'src/')) }));
	return {
		firstScreen: { bytes: firstBytes, gzip: firstGzip, chunks: first.size },
		groups,
		top: [...byModule].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => ({ module: k.replace(/^.*src\//, 'src/'), bytes: v })),
		lazy: lazy.sort((a, b) => b.bytes - a.bytes),
	};
}

function dist() {
	const html = join(ROOT, 'dist/earth/index.html');
	if (!existsSync(html)) return null;
	const page = readFileSync(html);
	const refs = [...new Set(page.toString().match(/\/_astro\/[^"'\s)>]+/g) ?? [])];
	const rows = refs.map((r) => { const b = readFileSync(join(ROOT, 'dist', r)); return { file: r, kind: r.endsWith('.css') ? 'css' : 'js', bytes: b.length, gzip: gz(b), brotli: br(b) }; });
	rows.unshift({ file: '/earth/index.html', kind: 'html', bytes: page.length, gzip: gz(page), brotli: br(page) });
	const sum = (k, f = () => true) => rows.filter(f).reduce((s, r) => s + r[k], 0);
	const astroDir = join(ROOT, 'dist/_astro');
	return {
		rows,
		total: { bytes: sum('bytes'), gzip: sum('gzip'), brotli: sum('brotli') },
		css: { bytes: sum('bytes', (r) => r.kind === 'css'), gzip: sum('gzip', (r) => r.kind === 'css') },
		js: { bytes: sum('bytes', (r) => r.kind === 'js'), gzip: sum('gzip', (r) => r.kind === 'js') },
		worker: existsSync(join(ROOT, 'dist/_worker.js')) ? statSync(join(ROOT, 'dist/_worker.js/index.js')).size : 0,
		astroDir: existsSync(astroDir),
	};
}

const report = { root: ROOT, modules: await modules(), dist: dist() };
if (JSON_OUT) {
	console.log(JSON.stringify(report, null, 1));
} else {
	const m = report.modules;
	console.log(`# 首屏脚本（esbuild 分包，压缩未 gzip，口径同 tests/earth/bundle.test.ts）`);
	console.log(`首屏 ${m.firstScreen.bytes} 字节（${kb(m.firstScreen.bytes).trim()}），gzip ${m.firstScreen.gzip} 字节，${m.firstScreen.chunks} 个文件`);
	console.log('\n## 按目录');
	for (const [g, v] of Object.entries(m.groups).sort((a, b) => b[1] - a[1])) console.log(`${kb(v)}  ${(v / m.firstScreen.bytes * 100).toFixed(1).padStart(5)}%  ${g}`);
	console.log(`\n## 最大的 ${TOP} 个模块`);
	for (const r of m.top) console.log(`${kb(r.bytes)}  ${r.module}`);
	console.log('\n## 按需分块（不在首屏）');
	for (const r of m.lazy) console.log(`${kb(r.bytes)}  ${r.inputs.slice(0, 3).join(', ')}${r.inputs.length > 3 ? ` 等 ${r.inputs.length} 个` : ''}`);
	const d = report.dist;
	if (d) {
		console.log('\n# 真实构建产物（dist/earth/index.html 直接引用的文件）');
		for (const r of d.rows) console.log(`${kb(r.bytes)}  gzip ${kb(r.gzip)}  br ${kb(r.brotli)}  ${r.file}`);
		console.log(`合计 ${kb(d.total.bytes)}  gzip ${kb(d.total.gzip)}  br ${kb(d.total.brotli)}（JS gzip ${kb(d.js.gzip).trim()}，阻塞渲染的 CSS gzip ${kb(d.css.gzip).trim()}）`);
	} else console.log('\n（没有 dist/earth/index.html，先 npm run build 才有真实产物的数字）');
}
