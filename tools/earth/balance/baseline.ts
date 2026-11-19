#!/usr/bin/env node
// 平衡回归基线（平衡调试工具，docs/earth-game/balance-tools.md §5）。
//
//   npm run earth:baseline                         跑一次模拟，和 tools/earth/balance/baseline.json 比；有差异退出码 1
//   npm run earth:baseline -- --update             改了数值、确认要改：重写基线（基线的 diff 就是这次平衡变化的清单）
//   npm run earth:baseline -- --against=main.json  另外和一份旧基线比（CI 拿 main 上的基线比，只出报告）
//   --current=x.json      不跑模拟，直接用一份已经生成的快照（CI 里跑一次、比两回）
//   --write-current=x.json  把这次的快照写出来
//   --summary=FILE        把对比结果追加到这个文件（CI 里传 $GITHUB_STEP_SUMMARY）
//
// 口径固定为 60 天 × 每种策略 20 个种子、全部系统打开；改口径就要 --update 重写。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSim } from './ab.ts';
import { diffBaseline, diffMarkdown, toBaseline, type Baseline } from './report.ts';

export const BASELINE_DAYS = 60;
export const BASELINE_RUNS = 20;
const FILE = fileURLToPath(new URL('./baseline.json', import.meta.url));

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Baseline;
const write = (p: string, b: Baseline) => writeFileSync(p, JSON.stringify(b, null, '\t') + '\n');

const currentPath = flag('current');
const current = currentPath ? read(currentPath) : toBaseline(runSim([`--days=${BASELINE_DAYS}`, `--runs=${BASELINE_RUNS}`]));
const wc = flag('write-current');
if (wc) write(wc, current);

if (process.argv.includes('--update')) {
	write(FILE, current);
	console.log(`已重写基线 ${FILE}（${current.days} 天 × ${current.runs} 种子，${Object.keys(current.plans).length} 种策略）`);
	process.exit(0);
}

const report: string[] = [];
let exit = 0;
const against = flag('against');
if (against) {
	if (existsSync(against)) {
		try {
			report.push(diffMarkdown(diffBaseline(read(against), current), `和 ${against} 相比的平衡变化（只报告，不判失败）`));
		} catch (e) {
			report.push(`### 和 ${against} 相比\n\n${(e as Error).message}\n`);
		}
	} else report.push(`### 和 ${against} 相比\n\n那边还没有基线文件，跳过。\n`);
}
if (!existsSync(FILE)) {
	report.push('### 回归基线\n\n还没有 baseline.json：先跑 `npm run earth:baseline -- --update`。\n');
	exit = 1;
} else {
	const diffs = diffBaseline(read(FILE), current);
	report.push(diffMarkdown(diffs, '和本分支的 baseline.json 相比'));
	if (diffs.length) {
		report.push('模拟结果变了，但 baseline.json 没更新。是有意改数值就跑 `npm run earth:baseline -- --update` 并把基线一起提交；不是有意的，就是回归。\n');
		exit = 1;
	}
}
const text = `## 平衡回归基线（${current.days} 天 × ${current.runs} 种子）\n\n${report.join('\n')}`;
process.stdout.write(text);
const summary = flag('summary');
if (summary) appendFileSync(summary, text + '\n');
process.exit(exit);
