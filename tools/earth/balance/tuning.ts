#!/usr/bin/env node
// 待平衡数值面板（平衡调试工具）：npm run earth:tuning [-- --format=md|json|csv] [--out=文件] [--dir=src/game,...]
// 列出所有标了「待平衡」的数值：位置、当前值、所属系统。说明见 docs/earth-game/balance-tools.md §3。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanTuning, tuningCsv, tuningMarkdown } from './tuning-lib.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const format = arg('format', 'md');
if (!['md', 'json', 'csv'].includes(format)) {
	console.error(`--format 只能是 md、json、csv，收到 ${format}`);
	process.exit(2);
}
const items = scanTuning(ROOT, arg('dir', 'src/game').split(',').filter(Boolean));
const text = format === 'json' ? JSON.stringify(items, null, '\t') + '\n' : format === 'csv' ? tuningCsv(items) : tuningMarkdown(items);
process.stdout.write(text);
const out = arg('out', '');
if (out) {
	writeFileSync(out, text);
	console.error(`已写入 ${out}`);
}
