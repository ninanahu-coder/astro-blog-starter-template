// 界面回归测试：把 earth.astro 里的页面脚本现场打包，用最小的 DOM 替身在 Node 里运行；
// 网络请求直接交给服务端的 EarthWorld（内存存储），不需要启动服务器。
// 覆盖：五个标签和「我」的五个子栏都能渲染、地图只在出行页、「下一步」按钮真的能结算、
// 事件弹窗锁住背后页面、名字里的 HTML 被转义。
// esbuild 来自 Astro/Vite 的依赖（node_modules 里已有）。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { EarthWorld } from '../../src/game/server/world.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

class ClassList {
	set = new Set<string>(['hidden']);
	add(c: string) { this.set.add(c); }
	remove(c: string) { this.set.delete(c); }
	toggle(c: string, on?: boolean) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }
	contains(c: string) { return this.set.has(c); }
}
type El = { id: string; innerHTML: string; textContent: string; value: string; disabled: boolean; inert: boolean; classList: ClassList; attrs: Record<string, string>; ls: Record<string, (e: unknown) => void>; focused: number; scrollTop: number; scrollHeight: number; setAttribute(k: string, v: string): void; addEventListener(t: string, f: (e: unknown) => void): void; querySelector(q: string): { focus(): void } | null };

function makeWorld() {
	const data = new Map<string, unknown>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
	};
	return { data, world: new EarthWorld({ storage } as never, {}) };
}

async function bundlePage(): Promise<string> {
	const astro = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
	const start = astro.indexOf('<script>') + '<script>'.length;
	const end = astro.indexOf('</script>', start);
	const out = await build({
		stdin: { contents: astro.slice(start, end), resolveDir: join(ROOT, 'src/pages'), loader: 'ts', sourcefile: 'earth-page.ts' },
		bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
	});
	return out.outputFiles[0].text;
}

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('界面：五个标签、子栏、下一步、事件弹窗和转义', async () => {
	const { data, world } = makeWorld();
	const call = async (body: unknown) => {
		const res = await world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { res, json: (await res.clone().json()) as any };
	};
	// 服务端先建好角色（名字里故意带 HTML），本机缓存里放同一份存档
	const cred = { id: 'ui-test-player', key: 'u'.repeat(24) };
	const made = await call({ action: 'create', ...cred, profile: { name: '<b>阿测</b>', avatar: '🧑', origin: 'backpacker', traits: [] } });
	assert.ok(made.json.ok, made.json.msg);
	// 让「下一步」有明确的建议：服务端存档的饱食改低
	const rec = data.get('save:' + cred.id) as any;
	rec.state.needs.hunger = 15;
	// 租着合租房间、现金只有 $120、明天周结算：今天页应该出预警
	rec.state.home = { type: 'room', loc: rec.state.loc, furniture: {} };
	rec.state.cash = 120;
	rec.state.nextWeek = Math.floor(rec.state.clock / 1440) + 1;
	data.set('save:' + cred.id, rec);

	const els = new Map<string, El>();
	const el = (id: string): El => {
		if (!els.has(id)) els.set(id, {
			id, innerHTML: '', textContent: '', value: '', disabled: false, inert: false, classList: new ClassList(), attrs: {}, ls: {}, focused: 0, scrollTop: 0, scrollHeight: 0,
			setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.ls[t] = f; },
			querySelector() { const self = this; return { focus() { self.focused++; } }; },
		});
		return els.get(id)!;
	};
	const docListeners: Record<string, (e: unknown) => void> = {};
	const store = new Map<string, string>([['earth.cred.v1', JSON.stringify(cred)], ['earth.save.v1', JSON.stringify(made.json.state)]]);
	const g = globalThis as any;
	const saved = { setInterval: g.setInterval, document: g.document, window: g.window, localStorage: g.localStorage, location: g.location, fetch: g.fetch, WebSocket: g.WebSocket, confirm: g.confirm, navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
	g.document = { getElementById: el, addEventListener: (t: string, f: (e: unknown) => void) => (docListeners[t] = f), body: { classList: new ClassList() }, hidden: false };
	g.window = { setTimeout, scrollTo() {} };
	g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
	g.location = { protocol: 'http:', host: 'game.test', reload() {} };
	g.fetch = async (u: string, o?: RequestInit) => {
		if (String(u) === '/api/earth/save') return world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: o?.body as string }));
		return new Response('{}', { status: 404 });
	};
	g.WebSocket = class { static OPEN = 1; readyState = 0; send() {} close() {} };
	g.confirm = () => true;
	// 页面里的心跳、附近页刷新是 setInterval，会让测试进程一直不退出：测试期间不执行
	g.setInterval = () => 0;
	Object.defineProperty(g, 'navigator', { value: { geolocation: null, clipboard: null }, configurable: true });

	const dir = mkdtempSync(join(tmpdir(), 'earth-ui-'));
	try {
		const file = join(dir, 'page.mjs');
		writeFileSync(file, await bundlePage());
		await import(pathToFileURL(file).href);
		await pause(50);
		const click = async (dataset: Record<string, string>, cls = '') => {
			docListeners.click({ target: { dataset, disabled: false, classList: { contains: (c: string) => c === cls }, closest() { return this; } } });
			await pause(20);
		};
		const panel = () => el('panel').innerHTML;

		// 开局：游戏页显示、创建页隐藏，五个标签
		assert.equal(el('create').classList.contains('hidden'), true);
		assert.equal(el('game').classList.contains('hidden'), false);
		assert.equal(strip(el('tabs').innerHTML), '今天 出行 附近 社交 我');
		assert.equal(el('map-wrap').classList.contains('hidden'), true, '今天页不显示地图');
		// 名字里的 HTML 被转义（服务端可能已清洗掉尖括号；无论如何不能原样出现）
		for (const h of [panel(), el('hud').innerHTML]) assert.ok(!h.includes('<b>阿测</b>'), '名字没有转义');
		assert.match(panel(), /1 天后周结算，钱不够/, '周结算预警');
		assert.match(panel(), /要付 \$160（房租 \$160），现在只有 \$120，还差 \$40/);
		// 「下一步」：饱食最低 → 吃饭
		const next = panel().match(/<div class="next">[\s\S]*?<\/div>/)?.[0] ?? '';
		assert.match(next, /肚子有点饿了/);
		const act = next.match(/data-act="([^"]+)"/)?.[1];
		assert.ok(act, '下一步应该给出一个互动');
		const rev0 = (data.get('save:' + cred.id) as any).state.rev;
		await click({ act: act! });
		await pause(50);
		assert.equal((data.get('save:' + cred.id) as any).state.rev, rev0 + 1, '点了下一步，服务端结算了一次');
		assert.match(panel(), /aria-label="刚才的变化"/, '显示数值变化');

		// 其他标签都能渲染；地图只在出行页
		for (const t of ['go', 'near', 'social', 'me']) {
			await click({ tab: t });
			assert.ok(strip(panel()).length > 20, `${t} 页是空的`);
			assert.equal(el('map-wrap').classList.contains('hidden'), t !== 'go', `${t} 页地图显示不对`);
		}
		for (const mt of ['overview', 'assets', 'people', 'log', 'sync']) {
			await click({ metab: mt });
			assert.match(panel(), new RegExp(`data-metab="${mt}" class="on"`), mt);
		}

		// 出行到罗特尼斯岛（先到弗里曼特尔坐渡轮）：第一次抵达有事件，弹窗打开时锁住背后
		await click({ tab: 'go' });
		await click({ go: 'fremantle', mode: 'road' });
		await pause(30);
		for (let i = 0; i < 3 && !el('modal').classList.contains('hidden'); i++) { await click({ choice: '0' }); await pause(30); }
		await click({ tab: 'go' });
		await click({ go: 'rottnest', mode: 'ferry' });
		await pause(30);
		assert.equal(el('modal').classList.contains('hidden'), false, '罗特尼斯岛首次抵达应该出事件');
		assert.equal(el('game').inert, true, '弹窗打开时背后页面不可操作');
		assert.ok(el('modal').focused > 0, '焦点移进弹窗');
		await click({ tab: 'place' });
		assert.ok(!panel().includes('class="next"'), '有待处理事件时不给下一步按钮');
		await click({ choice: '1' });
		await pause(30);
		assert.equal(el('modal').classList.contains('hidden'), true, '选完事件弹窗关闭');
		assert.equal(el('game').inert, false, '弹窗关闭后解锁');
		assert.equal((data.get('save:' + cred.id) as any).state.loc, 'rottnest');
	} finally {
		rmSync(dir, { recursive: true, force: true });
		for (const [k, v] of Object.entries(saved)) {
			if (k === 'navigator') { if (v) Object.defineProperty(g, 'navigator', v as PropertyDescriptor); continue; }
			if (v === undefined) delete g[k]; else g[k] = v;
		}
	}
});

