// GM 控制台（平衡调试工具，docs/earth-game/balance-tools.md §4）：
// 1. 核心函数：改现金 / 时间 / 事件，不改入参，结果过存档校验；
// 2. 只在开发环境出现：集成钩子只在 astro dev 注入路由；线上入口不 import GM；
// 3. **真跑一次生产构建**，产物里没有 GM 的任何痕迹，也没有 /earth/gm 路由；
//    对照组：强行把 GM 页注入再构建一次，同样的扫描必须能找到痕迹（证明扫描本身会失败，不是空转）。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { getPendingEvent } from '../../src/game/core/engine.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import { GM_MARKER, gmCommand, gmEvents, gmPass, gmSetCash, gmSkip, gmTriggerEvent, MAX_PASS_MINUTES, parseDuration } from '../../src/game/dev/gm.ts';
import { earthGm, GM_ROUTE } from '../../tools/earth/gm/integration.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOCS = new Set(WORLD.locations.map((l) => l.id));
const fresh = () => createCharacter({ id: 'gm-test-0001', name: 'T', avatar: '🧑', origin: 'student', region: WORLD.id, spawn: WORLD.spawn, seed: 7 });
const frozen = <T>(x: T): T => {
	if (x && typeof x === 'object') {
		for (const v of Object.values(x)) frozen(v);
		Object.freeze(x);
	}
	return x;
};

// ---------- 1. 核心函数 ----------

test('GM 改现金：设为、加减、钳在 0 到 10 亿，不改入参，记一条 [GM] 日志', () => {
	const s = frozen(fresh());
	const r = gmSetCash(s, WORLD, 5000);
	assert.ok(r.ok);
	assert.equal(r.state.cash, 5000);
	assert.equal(s.cash, 1200);
	assert.match(r.state.journal.at(-1)!.text, /^\[GM\] 现金 \$1200 → \$5000/);
	assert.equal(gmCommand(r.state, WORLD, 'cash+=250').state.cash, 5250);
	assert.equal(gmCommand(r.state, WORLD, 'cash-=99999').state.cash, 0);
	const huge = gmSetCash(s, WORLD, 5e12);
	assert.equal(huge.state.cash, 1e9);
	assert.match(huge.msg, /→ \$1000000000$/, 'GM 自己先钳值，日志里不能写出存档放不下的数');
	assert.match(gmSetCash(s, WORLD, -50).msg, /→ \$0$/);
	assert.equal(gmSetCash(s, WORLD, 12.6).state.cash, 13);
	const bad = gmSetCash(s, WORLD, Number('abc'));
	assert.equal(bad.ok, false);
	assert.equal(bad.state, s);
	// 结果过得了服务端同一套校验；改完不合法的存档（例：所在地点不存在）整个放弃
	assert.ok(sanitizeState(r.state, LOCS));
	const lost = { ...fresh(), loc: 'atlantis' };
	const rej = gmSetCash(lost, WORLD, 10);
	assert.equal(rej.ok, false);
	assert.equal(rej.state, lost);
	assert.match(rej.msg, /不合法/);
});

test('GM 跳时间不结算；快进按规则歇着过；碰到事件停下', () => {
	const s = frozen(fresh());
	const sk = gmSkip(s, WORLD, parseDuration('1d6h'));
	assert.ok(sk.ok);
	assert.equal(sk.state.clock, s.clock + 1800);
	assert.deepEqual(sk.state.needs, s.needs); // 跳过 = 不扣需求
	assert.equal(gmSkip(s, WORLD, 0).ok, false);

	const p = gmPass(s, WORLD, 180);
	assert.ok(p.ok, p.msg);
	assert.ok(p.state.clock >= s.clock + 180);
	assert.ok(p.state.needs.hunger < s.needs.hunger, '快进要按规则扣饱食');
	assert.equal(gmPass(s, WORLD, MAX_PASS_MINUTES + 1).ok, false);

	const ev = gmTriggerEvent(s, WORLD, gmEvents()[0].id);
	const stuck = gmPass(ev.state, WORLD, 600);
	assert.equal(stuck.state.clock, ev.state.clock);
	assert.match(stuck.msg, /碰到事件停下/);
});

test('GM 触发事件：挂到 pending，按规则选选项结算；未知事件、已有事件都拒绝', () => {
	const s = frozen(fresh());
	const id = gmEvents().find((e) => e.id === 'heat-check')?.id ?? gmEvents()[0].id;
	const r = gmTriggerEvent(s, WORLD, id);
	assert.ok(r.ok);
	assert.equal(getPendingEvent(r.state)?.id, id);
	assert.equal(s.pending, null);
	assert.equal(gmTriggerEvent(r.state, WORLD, id).ok, false);
	assert.equal(gmTriggerEvent(s, WORLD, 'no-such-event').ok, false);
	const c = gmCommand(r.state, WORLD, 'choose=0');
	assert.ok(c.ok, c.msg);
	assert.equal(c.state.pending, null);
});

test('GM 命令解析：时长格式、看不懂的命令、坏 JSON 都不抛错', () => {
	assert.equal(parseDuration('90'), 90);
	assert.equal(parseDuration('2d'), 2880);
	assert.equal(parseDuration('1h30m'), 90);
	assert.equal(parseDuration('-3h'), -180);
	assert.ok(Number.isNaN(parseDuration('soon')));
	assert.ok(Number.isNaN(parseDuration('d')));
	const s = fresh();
	for (const cmd of ['hello', 'fly=1', 'act={oops', 'act={"t":"nope"}', 'skip=soon', 'clock=-1']) {
		const r = gmCommand(s, WORLD, cmd);
		assert.equal(r.ok, false, cmd);
		assert.equal(r.state, s, cmd);
	}
	assert.ok(gmCommand(s, WORLD, 'act={"t":"activity","id":"rest"}').ok);
});

// ---------- 2. 只在开发环境 ----------

function setupHook(command: string) {
	const injected: { pattern: string; entrypoint: string }[] = [];
	const hook = earthGm().hooks['astro:config:setup'] as (o: unknown) => void;
	hook({ command, injectRoute: (r: { pattern: string; entrypoint: string }) => injected.push(r), logger: { info() {} } });
	return injected;
}

test('集成钩子：只有 astro dev 注入 /earth/gm；build / preview / sync 什么都不做', () => {
	const dev = setupHook('dev');
	assert.equal(dev.length, 1);
	assert.equal(dev[0].pattern, GM_ROUTE);
	assert.ok(statSync(dev[0].entrypoint).isFile());
	for (const c of ['build', 'preview', 'sync']) assert.deepEqual(setupHook(c), [], c);
});

test('GM 页自己也挡一道：不是开发环境就 404', () => {
	const page = readFileSync(join(ROOT, 'src/game/dev/gm-page.astro'), 'utf8');
	const front = page.split('---')[1];
	assert.match(front, /if \(!import\.meta\.env\.DEV\) return new Response\(null, \{ status: 404 \}\);/);
});

function walk(dir: string, out: string[] = []) {
	for (const n of readdirSync(dir)) {
		const p = join(dir, n);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

test('线上入口（页面、Worker、服务端、界面模块）不 import src/game/dev', () => {
	const files = [...walk(join(ROOT, 'src/pages')), join(ROOT, 'src/worker.ts'), ...walk(join(ROOT, 'src/game')).filter((f) => !f.includes(`${join('src', 'game', 'dev')}`))];
	const hits = files.filter((f) => /\.(ts|astro|mjs|js)$/.test(f) && /from\s+['"][^'"]*\/dev\/gm|import\(\s*['"][^'"]*\/dev\/gm/.test(readFileSync(f, 'utf8')));
	assert.deepEqual(hits.map((f) => relative(ROOT, f)), []);
});

// ---------- 3. 生产构建 ----------

/** 构建产物里能说明 GM 被打进去的字符串：页面标记、沙盒存储键、命令解析的文案、路由 */
const TRACES = [GM_MARKER, 'earth-gm-sandbox', '看不懂的命令', 'earth/gm'];

/** 打包器可能把中文转成 \uXXXX（esbuild 默认就这样）：原样和转义后的大小写两种写法都要查 */
const forms = (t: string) => {
	const esc = (upper: boolean) => t.replace(/[^\x00-\x7f]/g, (c) => {
		const h = c.charCodeAt(0).toString(16).padStart(4, '0');
		return `\\u${upper ? h.toUpperCase() : h}`;
	});
	return [...new Set([t, esc(false), esc(true)])];
};

function traces(dir: string): string[] {
	const found: string[] = [];
	for (const f of walk(dir)) {
		const rel = relative(dir, f);
		if (/(^|[\\/])earth[\\/]gm([\\/.]|$)/.test(rel)) found.push(`路径 ${rel}`);
		const text = readFileSync(f).toString('utf8');
		for (const t of TRACES) if (forms(t).some((x) => text.includes(x))) found.push(`${rel} 含 ${t}`);
	}
	return found;
}

function astroBuild(outDir: string, forceGm = false) {
	// forceGm：对照组，用一个测试专用的集成无条件注入 GM 页（线上配置里没有这个开关）
	const script = forceGm
		? `import { build } from 'astro'; import { GM_ENTRY } from './tools/earth/gm/integration.mjs';
			await build({ root: process.cwd(), outDir: ${JSON.stringify(outDir)}, logLevel: 'error',
				integrations: [{ name: 'force-gm', hooks: { 'astro:config:setup': ({ injectRoute }) => injectRoute({ pattern: '/earth/gm', entrypoint: GM_ENTRY, prerender: false }) } }] });`
		: `import { build } from 'astro'; await build({ root: process.cwd(), outDir: ${JSON.stringify(outDir)}, logLevel: 'error' });`;
	const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
	assert.equal(r.status, 0, `构建失败：${r.stderr}\n${r.stdout}`);
}

test('生产构建里没有 GM 入口；强行注入的对照构建里扫得到（扫描不是空转）', { timeout: 600_000 }, async () => {
	const tmp = mkdtempSync(join(tmpdir(), 'earth-gm-build-'));
	try {
		// 对照：GM 代码自己打包一下，确实含有这些字符串
		const bundled = await build({ entryPoints: [join(ROOT, 'src/game/dev/gm.ts')], bundle: true, minify: true, format: 'esm', write: false, logLevel: 'silent' });
		assert.ok(forms('看不懂的命令').some((x) => bundled.outputFiles[0].text.includes(x)), '转义后的写法也要能认出来');

		const prod = join(tmp, 'prod');
		astroBuild(prod);
		assert.ok(walk(prod).some((f) => f.endsWith('_worker.js') || f.includes('_worker.js')), '构建产物里应该有 Worker');
		assert.deepEqual(traces(prod), [], '生产构建里出现了 GM 的痕迹');

		const forced = join(tmp, 'forced');
		astroBuild(forced, true);
		const hits = traces(forced);
		// 页面正文里的 GM_MARKER 在生产构建里会被当成死代码删掉（import.meta.env.DEV 编译成 false，后面的模板走不到），所以对照只查另外三种
		for (const t of ['earth-gm-sandbox', '看不懂的命令', 'earth/gm']) assert.ok(hits.some((h) => h.includes(t)), `对照构建里应该扫得到 ${t}：${hits.join('；')}`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});
