// 首屏体积（第 34、35 轮）：页面脚本按浏览器那样分包打包，检查首屏那一块里没有只在某些页面才用的大文件，
// 并给首屏体积设上限（超了说明有大东西被静态导入进来了）。真实地点、地图库、二维码库都只能动态加载。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { WA } from '../../src/game/data/wa.ts';
import { getRegionBase, WA_BASE } from '../../src/game/data/wa-base.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * 首屏脚本（esbuild 压缩后）的上限。首屏 = 入口 + 它静态 import 的分块（递归），动态 import() 的不算。
 * 历史：第 34 轮拆完约 327KB（Vite 实际构建约 259KB）；第 8、9 批长到约 374KB，上限 400KB。
 *
 * 第 41 批，用户 2026-11-20 选定「方案甲：两步走」（docs/earth-game/performance.md §3）：
 * 1. 现在是**临时值**：各分支全部合并期间，上限 = 合并后预计 540KB + 3% ≈ 560KB（gzip 175KB）。
 *    合并的人合完最后一个分支后重量一次（node tools/earth/bundle-report.mjs），把这两个数改成「实测 + 3%」。
 *    不要再「取各分支里最大的那个上限」：增量是相加的。
 * 2. 合并结束后做 P1（事件正文按需加载）+ P3（NPC 对话、小知识按需加载），再把上限降到 450KB、gzip 140KB。
 * 第 29 批（NPC 帮个小忙 17 条文案、关系变淡）正常长到约 401KB，上限提到 420KB。
 * 真实地点约 87KB，打回首屏照样会超。
 * v31（宠物与野生动物）：宠物规则、数据、图鉴新动物和更新日志 +19.5KB（392.7KB → 412.2KB），上限提到 415KB。别的分支也加首屏内容时合并后要重测。
 * v32 公交、火车、步行（线路表、3 个事件、更新日志）让首屏到了约 400.6KB，上限提到 420KB（和 v22 主要路线分支同一个数）。
 * 第 25 批（经济、理财）：main 的 e429bcd 是 392,671 字节，理财（行情、存档字段、理财卡）加了约 7.6KB 到 400,250，上限提到 410KB。
 * 试过把理财卡改成按需加载，只省 600 字节（卡片和首屏共用几乎所有代码），不值得。
 * 同时改成「首屏 = 入口 + 它静态 import 的所有分块」：只量入口的话，按需加载会把共用代码挪进静态分块，数字变小但首屏并没变小。
 */
export const FIRST_SCREEN_MAX = 560_000;
/** 首屏 gzip 后的上限（玩家实际下载的量），临时值，见上 */
export const FIRST_SCREEN_GZIP_MAX = 175_000;

async function split() {
	const astro = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
	const start = astro.indexOf('<script>') + '<script>'.length;
	const end = astro.indexOf('</script>', start);
	const dir = mkdtempSync(join(tmpdir(), 'earth-bundle-'));
	try {
		const out = await build({
			stdin: { contents: astro.slice(start, end), resolveDir: join(ROOT, 'src/pages'), loader: 'ts', sourcefile: 'earth-page.ts' },
			bundle: true, splitting: true, format: 'esm', minify: true, outdir: dir, write: false, metafile: true, logLevel: 'silent',
			loader: { '.css': 'empty' },
			// worker 文件按 URL 引用（Vite 的 ?url），这里只关心它不进首屏
			external: ['*?url'],
		});
		const outputs = out.metafile.outputs;
		const base = (p: string) => p.split(/[\\/]/).pop()!;
		const files = new Map(out.outputFiles.map((f) => [base(f.path), f.contents]));
		const entryName = Object.keys(outputs).find((k) => outputs[k].entryPoint)!;
		const first = new Set([entryName]);
		for (const name of first) for (const i of outputs[name].imports) if (i.kind === 'import-statement' && outputs[i.path]) first.add(i.path);
		const names = [...first];
		return {
			outputs,
			first: names,
			inputs: names.flatMap((n) => Object.keys(outputs[n].inputs)),
			bytes: names.reduce((s, n) => s + outputs[n].bytes, 0),
			gzip: names.reduce((s, n) => s + gzipSync(files.get(base(n))!).length, 0),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('首屏脚本不含真实地点、地图库、二维码库、更新日志，体积在上限内', async () => {
	const { outputs, first, inputs, bytes, gzip } = await split();
	// 更新日志（第 41 批）：每批都变长，打开「我」页才加载
	for (const heavy of ['wa.venues.json', 'sa.venues.json', 'node_modules/maplibre-gl', 'node_modules/qrcode-generator', 'src/game/data/changelog.ts']) {
		assert.ok(!inputs.some((i) => i.includes(heavy)), `${heavy} 被打进了首屏`);
		assert.ok(Object.entries(outputs).some(([k, o]) => !first.includes(k) && Object.keys(o.inputs).some((i) => i.includes(heavy))), `${heavy} 应该在单独的包里`);
	}
	assert.ok(bytes < FIRST_SCREEN_MAX, `首屏脚本 ${bytes} 字节，超过上限 ${FIRST_SCREEN_MAX}`);
	assert.ok(gzip < FIRST_SCREEN_GZIP_MAX, `首屏脚本 gzip 后 ${gzip} 字节，超过上限 ${FIRST_SCREEN_GZIP_MAX}`);
});

test('首屏版区域和完整区域只差真实地点', () => {
	assert.deepEqual(WA_BASE.venues, []);
	assert.ok(WA.venues.length > 0);
	assert.deepEqual({ ...WA, venues: [] }, WA_BASE);
	assert.equal(getRegionBase('wa'), WA_BASE);
	for (const bad of ['constructor', '__proto__', 'toString', 'sa', 1]) assert.equal(getRegionBase(bad), undefined);
});
