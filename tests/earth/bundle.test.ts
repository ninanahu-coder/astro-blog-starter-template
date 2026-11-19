// 首屏体积（第 34、35 轮）：页面脚本按浏览器那样分包打包，检查首屏那一块里没有只在某些页面才用的大文件，
// 并给首屏体积设上限（超了说明有大东西被静态导入进来了）。真实地点、地图库、二维码库都只能动态加载。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { WA } from '../../src/game/data/wa.ts';
import { getRegionBase, WA_BASE } from '../../src/game/data/wa-base.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * 首屏脚本（esbuild 压缩后、未 gzip）的上限：第 34 轮拆完约 327KB（Vite 实际构建约 259KB）；
 * 第 8 批（天象、场景界面）和第 9 批（南澳地点、小知识、事件、NPC）正常长到约 374KB，上限提到 400KB。
 * 第 29 批（NPC 帮个小忙 17 条文案、关系变淡）正常长到约 401KB，上限提到 420KB。
 * 真实地点约 87KB，打回首屏照样会超。
 */
export const FIRST_SCREEN_MAX = 420_000;

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
		const entry = Object.entries(out.metafile.outputs).find(([, o]) => o.entryPoint)!;
		return { entry: entry[1], outputs: out.metafile.outputs };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('首屏脚本不含真实地点、地图库、二维码库，体积在上限内', async () => {
	const { entry, outputs } = await split();
	const inputs = Object.keys(entry.inputs);
	for (const heavy of ['wa.venues.json', 'sa.venues.json', 'node_modules/maplibre-gl', 'node_modules/qrcode-generator']) {
		assert.ok(!inputs.some((i) => i.includes(heavy)), `${heavy} 被打进了首屏`);
		assert.ok(Object.values(outputs).some((o) => Object.keys(o.inputs).some((i) => i.includes(heavy))), `${heavy} 应该在单独的包里`);
	}
	assert.ok(entry.bytes < FIRST_SCREEN_MAX, `首屏脚本 ${entry.bytes} 字节，超过上限 ${FIRST_SCREEN_MAX}`);
});

test('首屏版区域和完整区域只差真实地点', () => {
	assert.deepEqual(WA_BASE.venues, []);
	assert.ok(WA.venues.length > 0);
	assert.deepEqual({ ...WA, venues: [] }, WA_BASE);
	assert.equal(getRegionBase('wa'), WA_BASE);
	for (const bad of ['constructor', '__proto__', 'toString', 'sa', 1]) assert.equal(getRegionBase(bad), undefined);
});
