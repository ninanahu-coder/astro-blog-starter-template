// A/B 对比（平衡调试工具，docs/earth-game/balance-tools.md §2.2）：npm run earth:sim -- --ab=events,coop [--days --runs --only --origins --format --out]
// 用同样的参数起两个 sim.ts 子进程：一个系统全开，一个关掉 --ab 里的系统；种子相同，所以差别只来自关掉的系统。
// 由 sim.ts 在看到 --ab= 时 import，不单独运行。也导出 runSim 给基线脚本和测试用。
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abMarkdown, ecoMarkdown, toCsv, toJson, variantName, type SimResult } from './report.ts';
import { parseSystems } from './systems.ts';

const SIM = fileURLToPath(new URL('./sim.ts', import.meta.url));

/** 跑一次 sim.ts，拿 JSON 结果。args 是 sim.ts 的参数（不要带 --format / --out / --ab） */
export function runSim(args: string[]): SimResult {
	const r = spawnSync(process.execPath, [SIM, ...args, '--format=json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (r.status !== 0) throw new Error(`sim.ts ${args.join(' ')} 失败（退出码 ${r.status}）：${r.stderr}`);
	return JSON.parse(r.stdout) as SimResult;
}

const argv = process.argv.slice(2);
const val = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (val('ab') !== undefined) {
	let off: string[];
	try {
		off = parseSystems(val('ab')!);
		if (!off.length) throw new Error('--ab= 后面要写至少一个系统');
		if (val('off') !== undefined) throw new Error('--ab 和 --off 只能用一个：--ab 自己会跑全开和关掉两边');
	} catch (e) {
		console.error((e as Error).message);
		process.exit(2);
	}
	const format = val('format') ?? 'md';
	// 透传给子进程的参数：去掉本层自己处理的
	const pass = argv.filter((a) => !/^--(ab|format|out|eco)(=|$)/.test(a));
	let base: SimResult, variant: SimResult;
	try {
		base = runSim(pass);
		variant = runSim([...pass, `--off=${off.join(',')}`]);
	} catch (e) {
		console.error((e as Error).message);
		process.exit(2);
	}
	const text = format === 'json' ? toJson([base, variant])
		: format === 'csv' ? toCsv([base, variant])
			: [abMarkdown(base, variant), ecoMarkdown(base).replace('## ', '## base · '), ecoMarkdown(variant).replace('## ', `## ${variantName(variant)} · `)].join('\n');
	process.stdout.write(text);
	const out = val('out');
	if (out) {
		writeFileSync(out, text);
		console.error(`已写入 ${out}`);
	}
}
