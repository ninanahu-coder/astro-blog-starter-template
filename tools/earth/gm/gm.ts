#!/usr/bin/env node
// GM 控制台（命令行版，平衡调试工具，仅开发用）：对本地沙盒存档改时间、改现金、触发事件，再按规则继续玩。
// 不连服务器，不读写线上存档；说明见 docs/earth-game/balance-tools.md §4。
//
//   npm run earth:gm -- --new=student cash=5000 event=heat-check --out=sandbox.json
//   npm run earth:gm -- --save=sandbox.json choose=0 pass=1d skip=6h --out=sandbox.json
//   npm run earth:gm -- --list-events
//
// 命令：cash=5000 · cash+=300 · cash-=300 · skip=2d（跳时间、不结算）· clock=2000 · pass=1d（按规则歇着过）
//       event=<事件 id> · choose=<选项序号> · act=<动作 JSON，如 {"t":"activity","id":"swim"}>
import { readFileSync, writeFileSync } from 'node:fs';
import { createCharacter, ORIGINS, sanitizeState } from '../../../src/game/core/character.ts';
import { getPendingEvent } from '../../../src/game/core/engine.ts';
import type { PlayerState } from '../../../src/game/core/types.ts';
import { WORLD } from '../../../src/game/data/wa.ts';
import { gmCommand, gmEvents, gmWhen } from '../../../src/game/dev/gm.ts';

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cmds = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const region = WORLD;

if (process.argv.includes('--list-events')) {
	for (const e of gmEvents()) console.log(`${e.id}\t${e.title}`);
	process.exit(0);
}

let state: PlayerState | null;
const savePath = flag('save');
if (savePath) {
	const raw = JSON.parse(readFileSync(savePath, 'utf8'));
	// 也接受「导出我的数据」那种外面包一层的文件
	state = sanitizeState(raw?.save ?? raw?.state ?? raw, new Set(region.locations.map((l) => l.id)), { fallbackLoc: region.spawn });
	if (!state) {
		console.error(`${savePath} 不是有效的存档`);
		process.exit(2);
	}
} else {
	const origin = flag('new') ?? 'backpacker';
	if (!ORIGINS.some((o) => o.id === origin)) {
		console.error(`没有出身 ${origin}（可选：${ORIGINS.map((o) => o.id).join('，')}）`);
		process.exit(2);
	}
	state = createCharacter({ id: 'gm-sandbox-0001', name: 'GM', avatar: '🧑', origin, region: region.id, spawn: region.spawn, seed: Number(flag('seed') ?? 1) });
}

let failed = 0;
for (const c of cmds) {
	const r = gmCommand(state, region, c);
	console.log(`${r.ok ? '✓' : '✗'} ${c}：${r.msg}`);
	if (!r.ok) failed++;
	state = r.state;
}
const ev = getPendingEvent(state);
const evText = ev ? ` · 待选事件 ${ev.id}：${ev.choices.map((ch, i) => `${i}=${ch.label}`).join(' / ')}` : '';
console.log(`\n${gmWhen(state.clock)}（clock ${state.clock}）· ${state.loc} · 现金 $${state.cash} · 健康 ${Math.round(state.health)}${evText}`);
const out = flag('out');
if (out) {
	writeFileSync(out, JSON.stringify(state, null, '\t') + '\n');
	console.error(`已写入 ${out}`);
}
process.exit(failed ? 1 : 0);
