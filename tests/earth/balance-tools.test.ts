// 平衡调试工具（docs/earth-game/balance-tools.md）：模拟器的系统开关和经济流水、导出格式、回归基线对比、待平衡面板。
// 模拟只跑很短（几天 × 一两个种子），这里验的是口径和接线，不是数值。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSim } from '../../tools/earth/balance/ab.ts';
import { abRows, diffBaseline, toBaseline, toCsv, toJson, variantName, type Baseline, type SimResult } from '../../tools/earth/balance/report.ts';
import { GIGS, parseSystems, SYSTEM_IDS, SYSTEMS, systemOf } from '../../tools/earth/balance/systems.ts';
import { MARKER, scanText, scanTuning, systemOf as tuningSystem, tuningCsv, tuningMarkdown } from '../../tools/earth/balance/tuning-lib.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}：${a} ≠ ${b}`);

// 几个测试共用的短模拟：两种会碰到很多系统的策略。走命令行（sim.ts 是脚本，import 就会跑）
const SHORT = ['--days=21', '--runs=2', '--only=barista,drifter'];
const simulate = (...extra: string[]): SimResult => runSim([...SHORT, ...extra]);
const sim = (...args: string[]) => spawnSync(process.execPath, ['tools/earth/balance/sim.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const base = simulate();
const PLAN_IDS = [...readFileSync(join(ROOT, 'tools/earth/balance/sim.ts'), 'utf8').split('const PLANS: Plan[] = [')[1].split('\n];')[0].matchAll(/(?<!npc: \{ )\bid: '([\w-]+)'/g)].map((m) => m[1]);

// ---------- 系统开关 ----------

test('系统清单：id 不重复，每个动作最多归一个系统', () => {
	assert.equal(new Set(SYSTEM_IDS).size, SYSTEMS.length);
	assert.equal(systemOf({ t: 'course', id: 'x' } as never), 'courses');
	assert.equal(systemOf({ t: 'home', op: 'rent', home: 'room' } as never), 'rent');
	assert.equal(systemOf({ t: 'home', op: 'sleep' } as never), undefined);
	assert.equal(systemOf({ t: 'activity', id: 'work-cafe' } as never), 'gigs');
	assert.equal(systemOf({ t: 'activity', id: 'charity-dinner' } as never), 'charity');
	assert.equal(systemOf({ t: 'activity', id: 'rest' } as never), undefined);
	assert.equal(systemOf({ t: 'travel', to: 'x', mode: 'bus' } as never), undefined);
	assert.throws(() => parseSystems('events,weather'), /没有这些系统：weather/);
	assert.deepEqual(parseSystems(' events,coop,events '), ['events', 'coop']);
	// 和 sim.ts 的零工清单一致
	const simGigs = /const GIG_IDS = \[([^\]]+)\]/.exec(readFileSync(join(ROOT, 'tools/earth/balance/sim.ts'), 'utf8'))![1];
	assert.deepEqual([...simGigs.matchAll(/'([\w-]+)'/g)].map((m) => m[1]), [...GIGS]);
});

test('同样的种子跑两遍结果一样；全开时报告里没有「关掉的系统」，加了 --eco 只在末尾多一节', () => {
	const again = simulate();
	assert.deepEqual(again.plans, base.plans);
	const md = sim(...SHORT);
	assert.equal(md.status, 0, md.stderr);
	assert.doesNotMatch(md.stdout, /本次关掉的系统|经济流水/);
	// 默认报告的结尾和加这批工具之前一样：最后一行是口径说明，后面恰好一个换行
	assert.ok(md.stdout.endsWith('破产天数 = 当天结束时现金低于 $20 的天数。\n'), JSON.stringify(md.stdout.slice(-40)));
	const eco = sim(...SHORT, '--eco');
	assert.ok(eco.stdout.startsWith(md.stdout), '--eco 不能改动原有报告');
	assert.match(eco.stdout.slice(md.stdout.length), /^\n## 经济流水：投放与回收/);
	assert.match(sim(...SHORT, '--off=courses').stdout, /本次关掉的系统：courses/);
	assert.deepEqual(base.plans.map((p) => p.id), ['barista', 'drifter']);
	assert.deepEqual(base.off, []);
	for (const p of base.plans) assert.deepEqual(p.blocked, {});
});

test('关掉事件：事件出现就丢掉，一个都不结算；全开时漫游背包客确实碰得到事件', () => {
	const off = simulate('--off=events');
	assert.deepEqual(off.off, ['events']);
	const b = base.plans.find((p) => p.id === 'drifter')!;
	const o = off.plans.find((p) => p.id === 'drifter')!;
	assert.ok(b.metrics.events > 0, '对照：全开时应该有事件');
	assert.equal(o.metrics.events, 0);
	assert.ok(o.blocked.events > 0);
	assert.equal(o.eco.in.event ?? 0, 0);
	assert.equal(o.eco.out.event ?? 0, 0);
});

test('关掉共同事件：理想搭档那一行一次都不做；全开时确实会做', () => {
	const args = ['--days=21', '--runs=1', '--only=barista-coop'];
	const on = runSim(args).plans[0];
	const off = runSim([...args, '--off=coop']).plans[0];
	assert.ok(on.metrics.coops > 0, '对照：全开时应该做共同事件');
	assert.ok((on.eco.in.coop ?? 0) > 0);
	assert.equal(off.metrics.coops, 0);
	assert.equal(off.eco.in.coop ?? 0, 0);
});

test('关掉课程：咖啡店的课一节都不上，被拦下的次数记在 blocked', () => {
	const b = base.plans.find((p) => p.id === 'barista')!;
	assert.ok((b.eco.out.course ?? 0) > 0, '对照：全开时咖啡店会上课');
	const o = runSim(['--days=21', '--runs=2', '--only=barista', '--off=courses']).plans[0];
	assert.equal(o.eco.out.course ?? 0, 0);
	assert.ok(o.blocked.courses > 0);
});

// ---------- 经济流水 ----------

test('经济流水：投放、回收都非负；投放 − 回收 = 各动作净现金之和；按类型和按动作键两种汇总对得上', () => {
	for (const p of base.plans) {
		for (const v of [...Object.values(p.eco.in), ...Object.values(p.eco.out)]) assert.ok(v > 0);
		close(p.metrics.ecoIn, sum(p.eco.in), `${p.id} 投放合计`);
		close(p.metrics.ecoOut, sum(p.eco.out), `${p.id} 回收合计`);
		close(sum(p.eco.in), sum(p.eco.inDetail), `${p.id} 投放两种汇总`);
		close(sum(p.eco.out), sum(p.eco.outDetail), `${p.id} 回收两种汇总`);
		close(p.metrics.ecoIn - p.metrics.ecoOut, sum(p.flow), `${p.id} 净额`);
	}
	// 咖啡店上班族的钱主要来自上班
	const b = base.plans.find((p) => p.id === 'barista')!;
	assert.ok(b.eco.in.job > 0);
	assert.ok(b.eco.in.job >= Math.max(...Object.values(b.eco.in)));
});

// ---------- 导出 ----------

test('CSV 长表：表头固定，每行 5 列，带逗号的值加引号', () => {
	const csv = toCsv([base]);
	const lines = csv.trim().split('\n');
	assert.equal(lines[0], 'variant,plan,section,key,value');
	assert.ok(lines.some((l) => l.startsWith('base,barista,eco_in,job,')));
	assert.ok(lines.some((l) => l.startsWith('base,barista,metric,netPerDay,')));
	const withComma = { ...base, plans: [{ ...base.plans[0], id: 'a,b' }] };
	assert.ok(toCsv([withComma]).includes('base,"a,b",metric,'));
	for (const l of lines.slice(1)) assert.equal(l.split(',').length, 5, l);
});

test('JSON：单个结果是对象，A/B 是数组；不带 markdown 正文', () => {
	const one = JSON.parse(toJson([base]));
	assert.equal(one.variant, 'base');
	assert.equal(one.markdown, undefined);
	assert.equal(one.plans.length, 2);
	const off = simulate('--off=events,coop');
	const two = JSON.parse(toJson([base, off]));
	assert.deepEqual(two.map((x: { variant: string }) => x.variant), ['base', 'off:events+coop']);
	assert.equal(variantName(off), 'off:events+coop');
	const rows = abRows(base, off);
	for (const r of rows) if (r.base !== null && r.variant !== null) close(r.delta!, r.variant - r.base, `${r.plan} ${r.metric}`);
});

test('命令行：--format=json 可解析；--ab 和 --off 一起用报错；坏参数退出码 2', () => {
	const run = sim;
	const j = run('--days=3', '--runs=1', '--only=idle', '--format=json');
	assert.equal(j.status, 0, j.stderr);
	assert.equal(JSON.parse(j.stdout).plans[0].id, 'idle');
	const ab = run('--days=3', '--runs=1', '--only=idle', '--ab=events');
	assert.equal(ab.status, 0, ab.stderr);
	assert.match(ab.stdout, /A\/B 对比：base（系统全开） vs off:events/);
	const abJson = run('--days=3', '--runs=1', '--only=idle', '--ab=events', '--format=json');
	assert.deepEqual(JSON.parse(abJson.stdout).map((x: { variant: string }) => x.variant), ['base', 'off:events']);
	assert.equal(run('--ab=nope').status, 2);
	assert.equal(run('--ab=events', '--off=coop').status, 2);
	assert.equal(run('--off=nope', '--days=2', '--runs=1').status, 2);
	assert.equal(run('--format=xml').status, 2);
	assert.equal(run('--days=0').status, 2);
});

// ---------- 回归基线 ----------

test('基线：四舍五入到 4 位；任何变化都报出来，容差内的不报；口径不同直接报错', () => {
	const b = toBaseline(base);
	assert.deepEqual(diffBaseline(b, toBaseline(simulate())), []);
	const changed: Baseline = structuredClone(b);
	changed.plans.barista.netPerDay = (changed.plans.barista.netPerDay as number) + 1;
	delete changed.plans.drifter['eco.out.activity'];
	changed.plans.newbie = { mood: 50 };
	const d = diffBaseline(b, changed);
	assert.deepEqual(d.map((x) => `${x.plan}.${x.key}`).sort(), ['barista.netPerDay', 'drifter.eco.out.activity', 'newbie.mood']);
	const tiny: Baseline = structuredClone(b);
	tiny.plans.barista.netPerDay = (tiny.plans.barista.netPerDay as number) * 1.0001;
	assert.equal(diffBaseline(b, tiny).length, 1);
	assert.equal(diffBaseline(b, tiny, 0.001).length, 0);
	assert.throws(() => diffBaseline(b, { ...b, runs: 99 }), /口径不同/);
	for (const row of Object.values(b.plans)) for (const v of Object.values(row)) if (typeof v === 'number') assert.equal(v, Math.round(v * 1e4) / 1e4);
});

test('提交的 baseline.json：口径是 60 天 × 20 种子，覆盖全部策略', () => {
	const b = JSON.parse(readFileSync(join(ROOT, 'tools/earth/balance/baseline.json'), 'utf8')) as Baseline;
	assert.equal(b.days, 60);
	assert.equal(b.runs, 20);
	assert.deepEqual(Object.keys(b.plans), PLAN_IDS);
	for (const row of Object.values(b.plans)) for (const k of ['netPerDay', 'ecoIn', 'ecoOut', 'mood']) assert.equal(typeof row[k], 'number', k);
});

// 工作流模板（还没启用，见 balance-tools.md §5）：本机 gh 授权推不了 .github/workflows/
test('PR 检查的工作流模板：跑 earth:baseline，并把对比写进 Summary', () => {
	const wf = readFileSync(join(ROOT, 'tools/earth/balance/earth-balance.workflow.yml'), 'utf8');
	assert.match(wf, /npm run -s earth:baseline -- --against=.* --summary="\$GITHUB_STEP_SUMMARY"/);
	assert.match(wf, /contents: read/);
	assert.doesNotMatch(wf, /deploy|wrangler|git push/);
});

// ---------- 待平衡面板 ----------

test('面板：认出五种范围，取到当前值和数字；字符串里的标记也算', () => {
	const text = [
		'// 这个文件的价格全部待平衡。',
		"import { x } from './x.ts';",
		'',
		'export interface Def {',
		'\tchance: number; // 每次的几率（待平衡）',
		'}',
		'/** 一次钓鱼花的时间（待平衡） */',
		'export const FISHING = { minutes: 90, energy: -8 };',
		'export const LIST = [',
		"\t{ id: 'a', price: 10 },",
		'\t// 第 9 轮新增（价格待平衡）',
		'\t{',
		"\t\tid: 'b',",
		'\t\tprice: 1_500,',
		'\t},',
		"\t{ id: 'rod', price: 40, desc: '钓 2 小时鱼（数值待平衡）。' },",
		'];',
		'export const CAP = 3; // 上限，待平衡',
		"const URL = 'https://x.test/a'; // 不是标记",
	].join('\n');
	const items = scanText('src/game/data/fish.ts', text);
	assert.deepEqual(items.map((i) => [i.line, i.kind]), [[1, 'file'], [5, 'field'], [7, 'decl'], [11, 'block'], [16, 'inline'], [18, 'inline']]);
	const by = (l: number) => items.find((i) => i.line === l)!;
	assert.equal(by(7).value, 'export const FISHING = { minutes: 90, energy: -8 };');
	assert.equal(by(7).valueLine, 8);
	assert.deepEqual(by(7).numbers, [90, -8]);
	assert.match(by(11).value, /^\{ id: 'b', price: 1_500, \}/);
	assert.deepEqual(by(11).numbers, [1500]);
	assert.deepEqual(by(16).numbers, [40]);
	assert.deepEqual(by(18).numbers, [3]);
	assert.equal(by(5).value, '');
	for (const i of items) assert.equal(i.system, '钓鱼');
	assert.equal(tuningSystem('src/game/data/brand-new.ts'), 'brand-new');
});

test('面板扫全仓库：src/game 里每一行带「待平衡」的都列出来，一行不多一行不少', () => {
	const files: string[] = [];
	const walk = (d: string) => {
		for (const n of readdirSync(d)) {
			const p = join(d, n);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(ts|mjs|js)$/.test(n)) files.push(p);
		}
	};
	walk(join(ROOT, 'src/game'));
	const expected = files.reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').filter((l) => l.includes(MARKER)).length, 0);
	const items = scanTuning(ROOT);
	assert.ok(expected > 0);
	assert.equal(items.length, expected);
	for (const i of items) {
		assert.ok(i.system && i.file.startsWith('src/game/') && i.line > 0);
		if (i.kind === 'inline' || i.kind === 'decl') assert.ok(i.value, `${i.file}:${i.line} 应该有当前值`);
	}
	const md = tuningMarkdown(items);
	assert.match(md, new RegExp(`${items.length} 处「待平衡」标记`));
	assert.equal(tuningCsv(items).trim().split('\n').length, items.length + 1);
});

test('第十七轮 --matrix：十个部门 × 四种出身恰好 40 条 mx-* 路线；--only 能单点；带 jobShare、lowCashDays', () => {
	const all = sim('--matrix', '--days=1', '--runs=1', '--format=json');
	assert.equal(all.status, 0, all.stderr);
	const ids = JSON.parse(all.stdout).plans.map((p: { id: string }) => p.id) as string[];
	assert.equal(ids.length, 40);
	assert.equal(new Set(ids).size, 40);
	assert.ok(ids.every((id) => id.startsWith('mx-')), ids.join());
	const one = sim('--matrix', '--only=mx-it-support-backpacker', '--days=1', '--runs=1', '--format=json');
	const plans = JSON.parse(one.stdout).plans;
	assert.deepEqual(plans.map((p: { id: string }) => p.id), ['mx-it-support-backpacker']);
	assert.equal(typeof plans[0].metrics.jobShare, 'number');
	assert.equal(typeof plans[0].metrics.lowCashDays, 'number');
});

test('第十七轮：非 FIFO 卡车先在出生地补力量 / 驾驶，没补完不去卡尔古利签房、不被收房', () => {
	const r = sim('--matrix', '--only=mx-trucker-backpacker', '--days=10', '--runs=1', '--format=json');
	const m = JSON.parse(r.stdout).plans[0].metrics;
	assert.equal(m.homeDay, null);
	assert.equal(m.jobShare, 0);
	assert.equal(m.evictions, 0);
	assert.match(readFileSync(join(ROOT, 'tools/earth/balance/sim.ts'), 'utf8'), /id: 'trucker',[^\n]*\n[^\n]*cashReserve: 1000,/);
});

test('第十八轮 --long：无 --only 时恰好十部门代表路线；--only 照常筛选；默认 39 条策略不变', () => {
	const all = sim('--long', '--days=1', '--runs=1', '--format=json');
	assert.equal(all.status, 0, all.stderr);
	const ids = JSON.parse(all.stdout).plans.map((p: { id: string }) => p.id) as string[];
	assert.deepEqual([...ids].sort(), ['barista', 'bartender', 'builder', 'carer', 'farmhand', 'guide', 'it-support', 'lifeguard', 'miner', 'trucker']);
	const one = sim('--long', '--only=guide', '--days=1', '--runs=1', '--format=json');
	assert.deepEqual(JSON.parse(one.stdout).plans.map((p: { id: string }) => p.id), ['guide']);
	assert.equal(PLAN_IDS.length, 39);
	assert.equal(new Set(PLAN_IDS).size, 39);
});

test('第十八轮：短跑 JSON 不带 long；365 天带 long 字段，导游到顶后升级租公寓', () => {
	const short = sim('--only=guide', '--days=1', '--runs=1', '--format=json');
	assert.equal(JSON.parse(short.stdout).plans[0].long, undefined);
	const r = sim('--long', '--only=guide', '--days=365', '--runs=1', '--format=json');
	assert.equal(r.status, 0, r.stderr);
	const l = JSON.parse(r.stdout).plans[0].long;
	for (const k of ['netWorthDay0', 'netWorthDay180', 'netWorthDay365', 'cashDay180', 'cashDay365']) {
		for (const q of ['p10', 'median', 'p90']) assert.equal(typeof l[k][q], 'number', `${k}.${q}`);
	}
	for (const k of ['cashNetPerDayLateBins', 'worthGrowthPerDayLateBins', 'moodMeanLateBins', 'moodActionMeanLateBins']) assert.equal(l[k].length, 3, k);
	for (const k of ['worthGrowthPerDay181_365', 'moodMean181_365', 'collapses181_365', 'evictions181_365', 'lowCashDays181_365', 'visaExpiredDays181_365']) assert.equal(typeof l[k], 'number', k);
	assert.equal(typeof l.visaTransitions, 'object');
	assert.equal(l.homeUpgradeShare, 1);
	assert.ok(l.homeUpgradeDay.median >= 112, `升级日 ${l.homeUpgradeDay.median}`);
	assert.equal(l.evictions181_365, 0);
});

test('第二十轮 --risk：沿用十部门长线选择，JSON 带汇总和逐种子风险，默认短跑不带', () => {
	const plain = sim('--only=barista', '--days=5', '--runs=2', '--format=json');
	assert.equal(JSON.parse(plain.stdout).plans[0].risk, undefined);
	const r = sim('--risk', '--only=barista', '--days=5', '--runs=2', '--format=json');
	assert.equal(r.status, 0, r.stderr);
	const risk = JSON.parse(r.stdout).plans[0].risk;
	assert.equal(risk.seeds.length, 2);
	for (const k of ['workStopDays', 'sickLeaveDays', 'collapseDays', 'missedRiskGross', 'badShifts', 'jobLosses', 'demotions', 'lowCashDays', 'lowCashStreak']) {
		for (const q of ['mean', 'p90', 'max']) assert.equal(typeof risk[k][q], 'number', `${k}.${q}`);
	}
	for (const q of ['p10', 'median', 'p90']) assert.equal(typeof risk.netWorth[q], 'number', `netWorth.${q}`);
	assert.match(sim('--risk', '--only=barista', '--days=5', '--runs=1').stdout, /职业风险尾部（--risk）/);
});

test('第十九轮 --switch：跨部门仍从头晋升，同部门跨城在入职日恢复原职级', () => {
	const r = sim('--switch', '--days=160', '--runs=1', '--format=json');
	assert.equal(r.status, 0, r.stderr);
	const plans = JSON.parse(r.stdout).plans;
	assert.deepEqual(plans.map((p: { id: string }) => p.id), ['switch-barista-it-d60', 'switch-miner-port-hedland-d120']);
	const career = plans[0].transition;
	assert.equal(career.kind, 'career');
	assert.equal(career.hireShare, 1);
	assert.ok(career.daysHireToTop.median > 0);
	const transfer = plans[1].transition;
	assert.equal(transfer.kind, 'transfer');
	assert.equal(transfer.hireShare, 1);
	assert.equal(transfer.daysHireToTop.median, 0);
	assert.equal(transfer.topDay.median, transfer.hireDay.median);
});
