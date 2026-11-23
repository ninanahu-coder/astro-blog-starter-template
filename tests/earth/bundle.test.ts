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
 * 第 24 批（现实节日、公众假期的日期数据和时区规则约 7KB，屏蔽举报界面约 6KB）：本分支量法与 main 相同，合并时并入上面的临时上限。
 * 第 29 批（NPC 帮个小忙 17 条文案、关系变淡）正常长到约 401KB，上限提到 420KB。
 * 第 28 批（任务总览、支线、成就领奖、称号）约 +30KB，合并时并入上面的临时上限。
 * 真实地点约 87KB，打回首屏照样会超。
 * v36 新手引导（引导数据、纯函数、便签和回流卡片）约 +13KB，合并时并入下面的临时上限。
 * v22 主要路线（路线数据、到站和沿途事件、「附近」页的路线卡）约 +18KB，合并时并入下面的临时上限。
 * v31（宠物与野生动物）：宠物规则、数据、图鉴新动物和更新日志 +19.5KB（392.7KB → 412.2KB），上限提到 415KB。别的分支也加首屏内容时合并后要重测。
 * v32 公交、火车、步行（线路表、3 个事件、更新日志）让首屏到了约 400.6KB，上限提到 420KB（和 v22 主要路线分支同一个数）。
 * 第 25 批（经济、理财）：main 的 e429bcd 是 392,671 字节，理财（行情、存档字段、理财卡）加了约 7.6KB 到 400,250，上限提到 410KB。
 * 试过把理财卡改成按需加载，只省 600 字节（卡片和首屏共用几乎所有代码），不值得。
 * 同时改成「首屏 = 入口 + 它静态 import 的所有分块」：只量入口的话，按需加载会把共用代码挪进静态分块，数字变小但首屏并没变小。
 * 第二批（2026-11-21 起，用户定「每个分支按需上调」）：每合一个分支，gzip 上限调到「实际 + 1KB」，在 PR 里写明涨了多少。
 *   - 事件引擎：main fdd7b44 是 174,944 字节，规则层（event-rules.ts）加了约 3.3KB 到 178,259，上限 175,000 → 179,300。
 *   - 法律：违章表、法律规则、3 个交通事件、档案卡和出行提醒，gzip 178,259 → 181,601（+3.3KB），上限 179,300 → 182,600；
 *     未压缩 568,058 字节超过 560,000，同样按「实际 + 3KB」调到 571,100。
 *   - 玩家交易：交易所卡片、面交选择器（ui/market.ts）、交易规则，gzip 181,646 → 185,660（+4.0KB），上限 182,600 → 186,700；
 *     未压缩 568,167 → 582,106，上限 571,100 → 585,100。
 *   - 签证路线：签证规则和数据（含偏远地区邮编表）、移民打分、签证卡片，gzip 185,814 → 190,759（+4.9KB），上限 186,700 → 191,800；
 *     未压缩 582,723 → 598,580，上限 585,100 → 601,600。
 *   - 世界事件：六个宏观指标、新闻文案、世界经济卡，gzip 190,990 → 194,352（+3.4KB），上限 191,800 → 195,500；
 *     未压缩 599,223 → 610,177，上限 601,600 → 613,400。
 *   - 排行榜：榜单卡片、上榜设置和一次性上榜提示（ui/board.ts）、榜单规则，gzip 194,352 → 196,313（+2.0KB），上限 195,500 → 197,300；
 *     未压缩 610,177 → 616,064，上限 613,400 → 618,900。
 *   - 自然灾害：灾害规则和数据（山火、洪水、气旋、热浪、停电）、预警行和顶栏标签，gzip 196,313 → 199,858（+3.5KB），上限 197,300 → 200,800；
 *     未压缩 616,064 → 626,692，上限 618,900 → 629,400。
 *   - NPC 行为：休假、病假、天气日程、移动、心情和招呼台词（core/npc-behavior.ts、data/npc-behavior.ts），gzip 199,871 → 202,906（+3.0KB），上限 200,800 → 203,900；
 *     未压缩 626,730 → 635,977，上限 629,400 → 639,000。
 *   - 健康和看病：病种和就医数据、发病和病程规则（core/health.ts）、今天页健康卡，gzip 202,910 → 206,915（+4.0KB），上限 203,900 → 207,900；
 *     未压缩 635,977 → 646,621，上限 639,000 → 649,500。
 *   - 生涯统计：记账（core/tally.ts）、里程碑数据、「我 · 生涯」样式（生涯页本身按需加载），gzip 206,915 → 209,857（+2.9KB），上限 207,900 → 210,800；
 *     未压缩 646,621 → 654,024，上限 649,500 → 656,800。
 *   - 做饭：食材和食谱数据（data/cooking.ts）、做饭规则（core/cooking.ts）、住处厨房和超市卡（ui/kitchen.ts），gzip 209,857 → 214,893（+5.0KB），上限 210,800 → 215,900；
 *     未压缩 654,024 → 668,516，上限 656,800 → 671,300。
 *   - 保险：保单数据、理赔规则（core/insurance.ts）、6 个出险事件、「我 · 资产」保险卡（ui/insurance.ts），gzip 214,893 → 218,125（+3.2KB），上限 215,900 → 219,200；
 *     未压缩 668,516 → 679,227，上限 671,300 → 682,300。
 *   - 运动和比赛：运动、比赛、俱乐部数据表（data/sports.ts，比赛说明和真实赛事参照占大头）、规则（core/sports.ts）、「体验和爱好」里的运动卡（ui/sports-card.ts），
 *     gzip 218,125 → 226,455（+8.3KB），上限 219,200 → 227,500；未压缩 679,227 → 705,247，上限 682,300 → 708,300。
 */
export const FIRST_SCREEN_MAX = 708_300;
/** 首屏 gzip 后的上限（玩家实际下载的量），临时值，见上 */
export const FIRST_SCREEN_GZIP_MAX = 227_500;

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
		// 页面脚本本身的入口名是 earth-page.ts（见上面的 sourcefile）；按需加载的模块（更新日志、emoji 查找表……）在元数据里也标了 entryPoint，不能拿第一个当入口（输出顺序会变）
		const entryName = Object.keys(outputs).find((k) => outputs[k].entryPoint?.endsWith('earth-page.ts'))!;
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
	// 更新日志（第 41 批）：每批都变长，打开「我」页才加载；环境音和背景音乐的合成器（v37）只在玩家打开时才加载
	for (const heavy of ['wa.venues.json', 'sa.venues.json', 'node_modules/maplibre-gl', 'node_modules/qrcode-generator', 'src/game/data/changelog.ts', 'src/game/ui/ambient.ts', 'src/game/data/emoji-set.ts']) {
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
