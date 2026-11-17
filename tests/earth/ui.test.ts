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
import { WA } from '../../src/game/data/wa.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

class ClassList {
	set = new Set<string>(['hidden']);
	add(c: string) { this.set.add(c); }
	remove(c: string) { this.set.delete(c); }
	toggle(c: string, on?: boolean) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }
	contains(c: string) { return this.set.has(c); }
}
type El = { focus(): void; id: string; innerHTML: string; textContent: string; value: string; disabled: boolean; inert: boolean; classList: ClassList; attrs: Record<string, string>; ls: Record<string, (e: unknown) => void>; focused: number; scrollTop: number; scrollHeight: number; setAttribute(k: string, v: string): void; addEventListener(t: string, f: (e: unknown) => void): void; querySelector(q: string): { focus(): void } | null };

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

async function bundlePage(opts: { venuesFail?: boolean } = {}): Promise<string> {
	const astro = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
	const start = astro.indexOf('<script>') + '<script>'.length;
	const end = astro.indexOf('</script>', start);
	const out = await build({
		stdin: { contents: astro.slice(start, end), resolveDir: join(ROOT, 'src/pages'), loader: 'ts', sourcefile: 'earth-page.ts' },
		bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
		// 真实底图的地图库是动态加载的：测试环境没有 WebGL，走手绘地图，不需要把它打进来
		external: ['maplibre-gl', 'maplibre-gl/*'],
		// venuesFail：真实地点分包下载失败（断网时打开「附近」）——把它换成一个一加载就报错的模块
		plugins: opts.venuesFail ? [{ name: 'venues-fail', setup(b) { b.onLoad({ filter: /wa\.venues\.json$/ }, () => ({ contents: 'throw new Error("offline")', loader: 'js' })); } }] : [],
	});
	return out.outputFiles[0].text;
}

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 无障碍静态检查（第 30 轮）：对渲染出的 HTML 片段检查读屏和键盘的基本要求，返回不合格的地方。
 * 按钮要有可读的名字（文字或 aria-label，纯 emoji / 符号不算）；图片要有 alt；输入框要有标签；
 * 不用正数 tabindex；进度条要带数值；role="dialog" 要有名字。
 */
export function a11yIssues(html: string): string[] {
	const bad: string[] = [];
	const named = (attrs: string) => /aria-label="[^"]*\p{L}[^"]*"/u.test(attrs) || /aria-labelledby="[^"]+"/.test(attrs);
	for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
		const text = m[2].replace(/<[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/[a-z]+>/g, '').replace(/<[^>]+>/g, '');
		if (!/\p{L}|\p{N}/u.test(text) && !named(m[1])) bad.push(`按钮没有名字：${m[0].slice(0, 80)}`);
	}
	for (const m of html.matchAll(/<img\b([^>]*)>/g)) if (!/\balt="/.test(m[1])) bad.push(`图片没有 alt：${m[0].slice(0, 80)}`);
	for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
		if (/type="hidden"/.test(m[2])) continue;
		const id = m[2].match(/\bid="([^"]+)"/)?.[1];
		const labelled = named(m[2]) || (id && new RegExp(`<label[^>]*for="${id}"`).test(html));
		const wrapped = html.lastIndexOf('<label', m.index!) > html.lastIndexOf('</label>', m.index!);
		if (!labelled && !wrapped) bad.push(`输入框没有标签：${m[0].slice(0, 80)}`);
	}
	for (const m of html.matchAll(/tabindex="(\d+)"/g)) if (Number(m[1]) > 0) bad.push(`正数 tabindex：${m[0]}`);
	for (const m of html.matchAll(/<[a-z]+\b([^>]*role="progressbar"[^>]*)>/g)) {
		if (!/aria-valuenow="/.test(m[1]) && !named(m[1])) bad.push(`进度条没有数值：${m[0].slice(0, 80)}`);
	}
	for (const m of html.matchAll(/<[a-z]+\b([^>]*role="dialog"[^>]*)>/g)) if (!named(m[1])) bad.push(`对话框没有名字：${m[0].slice(0, 80)}`);
	return bad;
}
const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// 假元素的 closest：和真浏览器一样只认选择器名单里的 [data-xxx]，名单漏了就返回 null（点不动）
function fakeClosest(this: { dataset: Record<string, string> }, sel: string) {
	const keys = [...sel.matchAll(/\[data-([a-z0-9-]+)\]/g)].map((m) => m[1].replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()));
	return keys.some((k) => k in this.dataset) ? this : null;
}

test('无障碍（第 30 轮）：页面的静态标记（创建角色页、外框）按钮有名字、输入框有标签', () => {
	const astro = readFileSync(join(ROOT, 'src/pages/earth.astro'), 'utf8');
	const markup = astro.slice(0, astro.indexOf('<script>')).replace(/<style[\s\S]*?<\/style>/g, '');
	assert.ok(markup.includes('id="create"'), '读到了创建页');
	assert.deepEqual(a11yIssues(markup), []);
	// 检查函数本身会报错：故意写错的例子都要被抓出来
	assert.equal(a11yIssues('<button>🔁</button><img src="a.png"><input id="x"><div tabindex="2"></div><div role="progressbar"></div><div role="dialog"></div>').length, 6);
	assert.deepEqual(a11yIssues('<button aria-label="关闭">✕</button><button><span aria-hidden="true">🔁</span>重来</button><label>名字<input id="n"></label><img alt="" src="a.png">'), []);
});

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
			focus() { this.focused++; },
		});
		return els.get(id)!;
	};
	const docListeners: Record<string, (e: unknown) => void> = {};
	const store = new Map<string, string>([['earth.cred.v1', JSON.stringify(cred)], ['earth.save.v1', JSON.stringify(made.json.state)]]);
	const g = globalThis as any;
	const saved = { setTimeout: g.setTimeout as typeof setTimeout, setInterval: g.setInterval, document: g.document, window: g.window, localStorage: g.localStorage, location: g.location, fetch: g.fetch, WebSocket: g.WebSocket, confirm: g.confirm, navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
	const rootClasses = new ClassList();
	rootClasses.remove('hidden');
	g.document = { getElementById: el, addEventListener: (t: string, f: (e: unknown) => void) => (docListeners[t] = f), body: { classList: new ClassList() }, documentElement: { classList: rootClasses }, hidden: false };
	const winListeners: Record<string, (e: unknown) => void> = {};
	// 假的 Web Audio：记下建了几个 AudioContext、放了几个音（第 29 轮音效）
	const audioLog = { ctx: 0, notes: 0, offAt: -1 };
	class FakeAudio { currentTime = 0; state = 'running'; destination = {}; constructor() { audioLog.ctx++; } createOscillator() { audioLog.notes++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }
	g.window = { setTimeout: (f: () => void, ms?: number) => g.setTimeout(f, ms), scrollTo() {}, addEventListener: (t: string, f: (e: unknown) => void) => (winListeners[t] = f), AudioContext: FakeAudio };
	g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
	g.location = { protocol: 'http:', host: 'game.test', reload() {} };
	g.fetch = async (u: string, o?: RequestInit) => {
		if (String(u) === '/api/earth/save') return world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: o?.body as string }));
		return new Response('{}', { status: 404 });
	};
	// 在线频道：连上就算打开，记下发出去的消息
	const sent: string[] = [];
	type FakeWs = { onmessage: ((e: { data: string }) => void) | null };
	let lastWs = null as FakeWs | null;
	g.WebSocket = class { static OPEN = 1; readyState = 1; onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null; constructor() { lastWs = this; } send(m: string) { sent.push(m); } close() {} };
	g.confirm = () => true;
	// 页面里的心跳、附近页刷新是 setInterval，会让测试进程一直不退出：测试期间不执行
	g.setInterval = () => 0;
	// 页面里的延时提示（toast 等）在测试结束后还会触发：记下来，结束时全部取消
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const realSetTimeout = saved.setTimeout;
	g.setTimeout = (f: () => void, ms?: number) => { const id = realSetTimeout(f, ms); timers.add(id); return id; };
	let copied = '';
	Object.defineProperty(g, 'navigator', { value: { geolocation: null, clipboard: { writeText: async (t: string) => { copied = t; } } }, configurable: true });

	const dir = mkdtempSync(join(tmpdir(), 'earth-ui-'));
	try {
		const file = join(dir, 'page.mjs');
		writeFileSync(file, await bundlePage());
		await import(pathToFileURL(file).href);
		await pause(50);
		// 页面在请求进行中（body.busy）会直接丢掉点击：点之前、点之后都等它空闲（最多 2 秒），不靠固定睡眠
		const bodyClasses = (g.document as { body: { classList: ClassList } }).body.classList;
		const idle = async () => { for (let i = 0; i < 100 && bodyClasses.contains('busy'); i++) await pause(20); assert.equal(bodyClasses.contains('busy'), false, '页面一直忙，点击会被丢掉'); };
		const click = async (dataset: Record<string, string>, cls = '') => {
			await idle();
			docListeners.click({ target: { dataset, disabled: false, classList: { contains: (c: string) => c === cls }, closest: fakeClosest } });
			await pause(20);
			await idle();
		};
		const panel = () => el('panel').innerHTML;
		// 在线频道的消息：页面攒 150 毫秒合成一次重画（第 35 轮），发完等它画完
		const wsSay = async (m: unknown) => { lastWs!.onmessage!({ data: JSON.stringify(m) }); await pause(200); };
		// 改了服务端存档后让页面去同步：等页面缓存的存档版本和服务端一致（最多 2 秒），不靠固定睡眠
		const clientRev = () => (JSON.parse(store.get('earth.save.v1') ?? 'null') as { rev?: number } | null)?.rev;
		const pullNow = async () => {
			docListeners.visibilitychange({});
			const want = () => (data.get('save:' + cred.id) as any).state.rev;
			for (let i = 0; i < 100 && clientRev() !== want(); i++) await pause(20);
			assert.equal(clientRev(), want(), '回到前台后没有同步到服务端存档');
			await pause(20);
		};

		// 开局：游戏页显示、创建页隐藏，五个标签
		assert.equal(el('create').classList.contains('hidden'), true);
		assert.equal(el('game').classList.contains('hidden'), false);
		assert.equal(strip(el('tabs').innerHTML), '今天 出行 附近 社交 我');
		assert.equal(el('map-wrap').classList.contains('hidden'), true, '今天页不显示地图');
		assert.ok(rootClasses.contains('p-day') && !rootClasses.contains('p-night'), '开局 8 点是白天');
		// 名字里的 HTML 被转义（服务端可能已清洗掉尖括号；无论如何不能原样出现）
		for (const h of [panel(), el('hud').innerHTML]) assert.ok(!h.includes('<b>阿测</b>'), '名字没有转义');
		assert.match(panel(), /1 天后周结算，钱不够/, '周结算预警');
		// 新手指南（第 26 轮）：开局只解开第 1 天，标出「现在」这一步；在今天页时第一步不需要「去看看」跳转
		assert.match(panel(), /新手指南 · 第 1 天/);
		assert.match(panel(), /aria-current="step"/);
		assert.match(panel(), /做完这些或到第 2 天解开/);
		// 顶栏（草图样式）：时间小字 + 地点大标题 + 天气；一排现金、等级、心情
		assert.match(el('hud').innerHTML, /<h1>[^<]+<\/h1>/, '今天页顶栏用地点做大标题');
		assert.match(el('hud').innerHTML, /class="wx-pill/, '顶栏有天气');
		assert.match(el('hud').innerHTML, /class="chip cash">\$120</, '顶栏有现金');
		// 今天页：下一步在最上面，然后是状态卡，最低的一项标「最缺」
		assert.ok(panel().indexOf('class="next"') >= 0 && panel().indexOf('class="next"') < panel().indexOf('<h3>状态</h3>'), '下一步排在状态卡前面');
		assert.match(panel(), /最缺/);
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
		// 吃饱以后，下一步改成先挣钱应付周结算（推荐这里收入最高、现在能做的事）
		const next2 = panel().match(/<div class="next">[\s\S]*?<\/div>/)?.[0] ?? '';
		assert.match(next2, /周结算钱不够/);
		assert.match(next2, /data-(act|job)=/);

		// 其他标签都能渲染；地图只在出行页
		// 地图只在出行页画：今天页时 SVG 还是空的
		assert.equal(el('map').innerHTML, '', '今天页不画地图');
		for (const t of ['go', 'near', 'social', 'me']) {
			await click({ tab: t });
			assert.ok(strip(panel()).length > 20, `${t} 页是空的`);
			assert.deepEqual(a11yIssues(panel() + el('hud').innerHTML + el('tabs').innerHTML), [], `${t} 页`);
			assert.equal(el('map-wrap').classList.contains('hidden'), t !== 'go', `${t} 页地图显示不对`);
			if (t === 'go') assert.match(el('map').innerHTML, /class="land"/, '出行页画了地图');
			if (t === 'go') assert.match(panel(), /去了周结算会不够/, '周结算前的路费提醒');
			if (t === 'go') assert.match(el('hud').innerHTML, /<h1>出行<\/h1>/, '其他页顶栏用页名做大标题');
			if (t === 'me') assert.match(panel(), /class="card me-head"/, '我页顶上有人物抬头');
		}
		for (const mt of ['overview', 'assets', 'people', 'log', 'sync']) {
			await click({ metab: mt });
			assert.match(panel(), new RegExp(`data-metab="${mt}" class="on"`), mt);
			assert.deepEqual(a11yIssues(panel()), [], `我 · ${mt}`);
			if (mt === 'log') assert.match(panel(), /class="log-day">第 1 天 · 春季第 1 天/, '日志按天分组');
			if (mt === 'sync') {
				// 设置（第 28 轮）：字号三档、动画三档、三个提示开关，只存在本机
				assert.match(panel(), /data-pref="font" data-val="m" class="on" aria-pressed="true"/, '默认标准字号');
				await click({ pref: 'font', val: 'xl' });
				assert.ok(rootClasses.contains('fs-xl') && !rootClasses.contains('fs-l'), '特大字号');
				await click({ pref: 'font', val: 'l' });
				assert.ok(rootClasses.contains('fs-l') && !rootClasses.contains('fs-xl'), '换成大字号');
				await click({ pref: 'font', val: '<b>' });
				assert.ok(rootClasses.contains('fs-l'), '不认识的取值不改');
				assert.equal(rootClasses.contains('calm'), false, '跟随系统、系统没要求时不减少动画');
				await click({ pref: 'motion', val: 'reduce' });
				assert.equal(rootClasses.contains('calm'), true, '选「减少」后关掉动画');
				await click({ pref: 'motion', val: 'auto' });
				assert.equal(rootClasses.contains('calm'), false);
				assert.match(panel(), /data-pref="recap" aria-pressed="true"/);
				await click({ pref: 'recap' });
				assert.match(panel(), /data-pref="recap" aria-pressed="false">已关闭/);
				assert.equal(JSON.parse(store.get('earth.prefs.v1')!).recap, false, '存进本机');
				await click({ pref: 'recap' });
				await click({ pref: 'font', val: 'm' });
				// 音效（第 29 轮）：默认关，之前做的事都没出声；打开时放一声试听，关掉后不再出声
				assert.match(panel(), /data-pref="sound" aria-pressed="false">已关闭/);
				assert.equal(audioLog.ctx, 0, '默认关：没有建音频');
				await click({ pref: 'sound' });
				assert.equal(audioLog.ctx, 1, '打开时才建音频');
				assert.ok(audioLog.notes >= 1, '打开时试听一声');
				await click({ pref: 'sound' });
				const quiet = audioLog.notes;
				await click({ pref: 'sound' });
				assert.ok(audioLog.notes > quiet, '再打开又能出声');
				await click({ pref: 'sound' });
				assert.match(panel(), /data-pref="sound" aria-pressed="false">/);
				audioLog.offAt = audioLog.notes;
				// 真实地图（第 31 轮）：默认开，能关能开，存进本机；测试环境没有 WebGL，出行页一直是手绘地图
				assert.match(panel(), /data-pref="basemap" aria-pressed="true">已开启/);
				assert.match(panel(), /OpenFreeMap/);
				await click({ pref: 'basemap' });
				assert.match(panel(), /data-pref="basemap" aria-pressed="false">已关闭/);
				assert.equal(JSON.parse(store.get('earth.prefs.v1')!).basemap, false);
				await click({ pref: 'basemap' });
				assert.equal(JSON.parse(store.get('earth.prefs.v1')!).basemap, true);
				// 关掉新手指南后今天页不再显示，打开后回来
				await click({ pref: 'guide' });
				await click({ tab: 'place' });
				assert.ok(!panel().includes('新手指南'), '关掉后不显示');
				await click({ tab: 'me' });
				await click({ metab: 'sync' });
				await click({ pref: 'guide' });
				await click({ tab: 'place' });
				assert.match(panel(), /新手指南 · 第 1 天/, '重新打开后又显示');
				await click({ tab: 'me' });
				await click({ metab: 'sync' });
				// 换设备（第 32 轮）：点「显示二维码」后同步页里出现二维码（库是点了才加载的），再点收起
				assert.match(panel(), /data-qr aria-expanded="false">显示二维码/);
				await click({ qr: '' });
				for (let i = 0; i < 100 && !panel().includes('class="qr"'); i++) await pause(20);
				assert.match(panel(), /<svg class="qr" viewBox="0 0 \d+ \d+" role="img" aria-label="同步码二维码/);
				assert.match(panel(), /data-qr aria-expanded="true">收起二维码/);
				assert.match(panel(), /等同于密码/);
				assert.deepEqual(a11yIssues(panel()), [], '二维码');
				await click({ qr: '' });
				assert.ok(!panel().includes('class="qr"'), '点收起后不显示');
			}
		}

		// 分享进度：没有系统分享时复制到剪贴板；只含展示信息，不含存档 id 和同步码
		await click({ metab: 'overview' });
		// 足迹：全部地点；点一个没去过的地方跳到出行页并选中它
		assert.match(panel(), new RegExp(`足迹 1/${WA.locations.length}<`));
		assert.match(panel(), /见闻录 0\/\d+/);
		assert.match(panel(), /？？？/);
		assert.doesNotMatch(panel(), /某个地方/, '每个一次性事件都能提示在哪');
		await click({ loc: 'broome' });
		assert.match(el('tabs').innerHTML, /data-tab="go" class="on"/);
		assert.match(panel(), /card dest/);
		// 目的地卡：交通方式是并排方块，默认选中一种，下面是路费后的余额和「出发」大按钮
		// 布鲁姆只有航班、钱不够：方块灰掉，不给出发按钮
		assert.match(panel(), /class="tile" data-dmode="air" data-dest="broome" aria-pressed="false" disabled/);
		assert.doesNotMatch(panel(), /出发去布鲁姆/);
		await click({ loc: 'fremantle' });
		assert.match(panel(), /class="tile on" data-dmode="[a-z]+" data-dest="fremantle" aria-pressed="true"/);
		assert.match(panel(), /路费后剩 \$\d+，1 天后周结算要付 \$160，会不够/);
		assert.match(panel(), /data-go="fremantle" data-mode="[a-z]+">出发去弗里曼特尔/);
		const alt = panel().match(/class="tile" data-dmode="([a-z]+)" data-dest="fremantle" aria-pressed="false" >/)?.[1];
		assert.equal(alt, undefined, '这时钱只够走陆路（换走法在最后用卡尔古利测）');
		await click({ loc: 'fremantle' });
		await click({ tab: 'me' });
		await click({ metab: 'overview' });
		await click({ share: '' });
		await pause(20);
		assert.match(copied, /地球人生/);
		assert.match(copied, /https?:\/\/game\.test\/earth\//);
		assert.ok(!copied.includes(cred.id) && !copied.includes(cred.key), '分享文字不能带凭证');
		// 转义：在线频道发来的名字和文字不经过服务端的名字清洗，界面必须自己转义
		assert.ok(lastWs, '连上了在线频道');
		await wsSay({ t: 'chat', name: '<img src=x onerror=alert(1)>', avatar: '🧑', text: '<script>bad()</script>' });
		await click({ tab: 'social' });
		assert.ok(!panel().includes('<img src=x') && !panel().includes('<script>bad'), '聊天内容没有转义');
		assert.match(panel(), /&lt;img src=x onerror=alert\(1\)&gt;/);
		// 同地点有其他玩家时，社交标签显示人数
		await wsSay({ t: 'join', p: { id: 'peer-1', name: '路人', avatar: '🧑', loc: (data.get('save:' + cred.id) as any).state.loc } });
		assert.match(el('tabs').innerHTML, /class="badge"[^>]*>1</, '社交标签显示 1 位');
		await wsSay({ t: 'leave', id: 'peer-1' });
		assert.doesNotMatch(el('tabs').innerHTML, /class="badge"/);
		// 社交页的快捷短语：点一下发到本地频道
		await click({ tab: 'social' });
		assert.match(panel(), /data-quick="0"/);
		await click({ quick: '1' });
		assert.ok(sent.some((m) => JSON.parse(m).t === 'chat' && JSON.parse(m).text === '有人一起吗？'), '快捷短语发出去了');
		// 共同事件：社交页能发起；发起后显示等人加入、提醒同地点的人；发起人可以解散
		assert.match(panel(), /一起做点什么/);
		assert.match(panel(), /data-coop="open" data-coop-id="beach-cleanup" data-role="0"/);
		await click({ coop: 'open', coopId: 'beach-cleanup', role: '0' });
		await pause(30);
		assert.match(panel(), /等人加入（至少 2 人）/);
		assert.ok(sent.some((m) => JSON.parse(m).t === 'coop'), '提醒同地点的人');
		const lob = panel().match(/data-coop="leave" data-lobby="([a-f0-9]{8})"/)?.[1];
		assert.ok(lob, '有解散按钮');
		await click({ coop: 'leave', lobby: lob! });
		await pause(30);
		assert.doesNotMatch(panel(), /等人加入/);
		// 送礼：点在场的人旁边的 🎁，选背包里的东西送出，单子出现在送礼卡里，可以撤回
		// 收件人要是真实存在、在同一地点的存档：服务端按哈希找到它
		const peerH = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ui-peer-gift')))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
		data.set('h:' + peerH, 'ui-peer-gift');
		data.set('save:ui-peer-gift', { keyHash: 'x', at: 0, state: { loc: (data.get('save:' + cred.id) as any).state.loc, name: '小王' } });
		await wsSay({ t: 'join', p: { id: peerH, name: '<b>小王</b>', avatar: '🧑', loc: (data.get('save:' + cred.id) as any).state.loc } });
		const giftSave = data.get('save:' + cred.id) as any;
		giftSave.state.inventory = { ...giftSave.state.inventory, water: 2 };
		data.set('save:' + cred.id, giftSave);
		await click({ pull: '' });
		await pause(30);
		await click({ tab: 'social' });
		assert.match(panel(), new RegExp(`data-giftpick="${peerH}"`));
		await click({ giftpick: peerH, giftName: '<b>小王</b>' });
		assert.match(panel(), /送给&lt;b&gt;小王&lt;\/b&gt;什么/, '名字转义');
		assert.match(panel(), /data-trade="gift" data-item="water"/);
		await click({ trade: 'gift', item: 'water' });
		await pause(30);
		assert.match(panel(), /等小王收下 💧 饮用水/, "收件人名字以服务端存档为准");
		assert.ok(sent.some((m) => JSON.parse(m).t === 'trade'), '提醒同地点的人');
		const offerId = panel().match(/data-trade="cancel" data-offer="([a-f0-9]{10})"/)?.[1];
		assert.ok(offerId, '有撤回按钮');
		await click({ trade: 'cancel', offer: offerId! });
		await pause(30);
		assert.doesNotMatch(panel(), /等小王/);
		// 二手摊：选一件、点一个价格挂上，单子出现在卡里
		await click({ trade: 'sellpick' });
		assert.match(panel(), /卖多少/);
		const price = panel().match(/data-trade="sale" data-item="water" data-price="(\d+)"/)?.[1];
		assert.ok(price, '有价格按钮');
		await click({ trade: 'sale', item: 'water', price: price! });
		await pause(30);
		assert.ok(panel().includes(`二手摊上的 💧 饮用水 · $${price}`), '挂上了');
		const saleId = panel().match(/data-trade="cancel" data-offer="([a-f0-9]{10})"/)?.[1];
		await click({ trade: 'cancel', offer: saleId! });
		await pause(30);
		assert.doesNotMatch(panel(), /二手摊上的/);
		// 常遇见的人：在线、同地点的标「就在这里」并能直接送礼；不在线的显示几天前见过
		const metSave = data.get('save:' + cred.id) as any;
		metSave.state.met = { [peerH]: { name: '小王', avatar: '🧑', n: 3, last: 0 }, 'ffffffffffff': { name: '老李', avatar: '🐨', n: 1, last: 0 } };
		data.set('save:' + cred.id, metSave);
		await click({ pull: '' });
		await pause(30);
		await click({ tab: 'social' });
		assert.match(panel(), /常遇见的人/);
		assert.match(panel(), /小王<small>一起做过 3 次事 · 就在这里/);
		assert.match(panel(), /老李<small>一起做过 1 次事 · \d+ 天前见过/);
		// 全服周目标卡：有进度条，没达成时领奖按钮灰掉
		assert.match(panel(), /全服周目标：/);
		assert.match(panel(), /role="progressbar"/);
		assert.match(panel(), /data-week="claim" disabled/);
		// 断开连接时角标也要清掉
		await wsSay({ t: 'join', p: { id: 'peer-2', name: '路人', avatar: '🧑', loc: (data.get('save:' + cred.id) as any).state.loc } });
		assert.match(el('tabs').innerHTML, /class="badge"/);
		(lastWs as unknown as { onclose: () => void }).onclose();
		assert.doesNotMatch(el('tabs').innerHTML, /class="badge"/, '断开后角标清掉');
		// 断网：动作失败后顶栏出现离线横幅；恢复网络后自动同步、横幅消失
		const realFetch = g.fetch;
		g.fetch = async () => { throw new TypeError('offline'); };
		await click({ tab: 'place' });
		const anyAct = panel().match(/data-act="([^"]+)"/)?.[1];
		assert.ok(anyAct);
		const revBefore = (data.get('save:' + cred.id) as any).state.rev;
		await click({ act: anyAct! });
		await pause(30);
		assert.match(el('hud').innerHTML, /现在离线/);
		// 离线排队（第 33 轮）：做事先排在本机，今天页列出来，顶栏写排了几个
		assert.match(el('toast').textContent, /已排队（1\/5）/);
		assert.match(panel(), /排队中 · 联网后自动补交/);
		assert.match(el('hud').innerHTML, /已排 1 个/);
		await click({ act: anyAct! });
		assert.equal(JSON.parse(store.get('earth.queue.v1')!).items.length, 2, '排队存在本机');
		// 看真实位置的动作不排
		await click({ gps: '' });
		assert.equal(JSON.parse(store.get('earth.queue.v1')!).items.length, 2);
		// 联网：按顺序补交两个，服务端存档前进两版，排队清空
		g.fetch = realFetch;
		winListeners.online?.({});
		for (let i = 0; i < 100 && (JSON.parse(store.get('earth.queue.v1')!).items.length || (data.get('save:' + cred.id) as any).state.rev < revBefore + 2); i++) await pause(20);
		assert.equal((data.get('save:' + cred.id) as any).state.rev, revBefore + 2, '两个排队的动作都交给了服务器');
		assert.equal(JSON.parse(store.get('earth.queue.v1')!).items.length, 0);
		assert.match(el('toast').textContent, /补交了 2 个排队的动作/);
		assert.doesNotMatch(el('hud').innerHTML, /现在离线/);
		assert.ok(!panel().includes('排队中'), '交完不再显示排队');
		// 补交时有一个没通过：停下，后面的取消，告诉玩家原因
		g.fetch = async () => { throw new TypeError('offline'); };
		await click({ use: 'no-such-item' });
		await click({ act: anyAct! });
		const revMid = (data.get('save:' + cred.id) as any).state.rev;
		g.fetch = realFetch;
		winListeners.online?.({});
		for (let i = 0; i < 100 && JSON.parse(store.get('earth.queue.v1')!).items.length; i++) await pause(20);
		await pause(40);
		assert.equal(JSON.parse(store.get('earth.queue.v1')!).items.length, 0);
		assert.equal((data.get('save:' + cred.id) as any).state.rev, revMid, '第一个没通过，后面的没交');
		assert.match(el('toast').textContent, /没成功：.*后面 1 个已取消/);
		// 全部取消按钮
		g.fetch = async () => { throw new TypeError('offline'); };
		await click({ act: anyAct! });
		assert.match(panel(), /data-queue-clear/);
		await click({ queueClear: '' });
		assert.equal(JSON.parse(store.get('earth.queue.v1')!).items.length, 0);
		g.fetch = realFetch;
		winListeners.online?.({});
		await pause(60);
		// 出行到罗特尼斯岛（先到弗里曼特尔坐渡轮）：第一次抵达有事件，弹窗打开时锁住背后
		// 开头为了测周结算预警把现金设成 $120：弗里曼特尔抽到的事件不固定，有的选项要花钱，剩下的不够坐渡轮去罗特尼斯岛。出发前补足
		const rich = data.get('save:' + cred.id) as any;
		rich.state.cash = 2000;
		rich.state.rev += 1;
		data.set('save:' + cred.id, rich);
		await pullNow();
		await click({ tab: 'go' });
		await click({ go: 'fremantle', mode: 'road' });
		// 机器忙时（全套测试并行跑）请求和渲染可能超过几十毫秒：等服务端存档到了弗里曼特尔、界面也画完再往下
		const serverState = () => (data.get('save:' + cred.id) as any).state;
		for (let i = 0; i < 50 && serverState().loc !== 'fremantle'; i++) await pause(20);
		await pause(60);
		for (let i = 0; i < 6 && (serverState().pending || !el('modal').classList.contains('hidden')); i++) {
			await click(el('modal').innerHTML.includes('data-result-close') ? { resultClose: '' } : { choice: '0' });
			await pause(60);
		}
		assert.equal(serverState().pending, null, '弗里曼特尔的事件处理完了');
		await click({ tab: 'go' });
		await click({ go: 'rottnest', mode: 'ferry' });
		// 先确认出行请求真的到了服务端，再等弹窗画出来
		for (let i = 0; i < 100 && serverState().loc !== 'rottnest'; i++) await pause(20);
		assert.equal(serverState().loc, 'rottnest', '出行请求没有发出去');
		assert.ok(serverState().pending, '罗特尼斯岛首次抵达服务端应该有待处理事件');
		for (let i = 0; i < 100 && el('modal').classList.contains('hidden'); i++) await pause(20);
		assert.equal(el('modal').classList.contains('hidden'), false, '罗特尼斯岛首次抵达应该出事件');
		assert.equal(el('game').inert, true, '弹窗打开时背后页面不可操作');
		assert.deepEqual(a11yIssues(el('modal').innerHTML), [], '事件弹窗');
		assert.ok(el('modal').focused > 0, '焦点移进弹窗');
		await click({ tab: 'place' });
		assert.ok(!panel().includes('class="next"'), '有待处理事件时不给下一步按钮');
		// 弹窗开着时同一个事件重画（后台同步回来）：不抢焦点
		const rottEv = serverState().pending.eventId;
		let modalFocus = el('modal').focused;
		const same = data.get('save:' + cred.id) as any;
		same.state.rev += 1;
		data.set('save:' + cred.id, same);
		await pullNow();
		assert.equal(el('modal').focused, modalFocus, '同一个事件重画不移焦点');
		// 事件接着换成另一个事件（弹窗一直开着）：焦点移到新内容上；再换回来也一样
		for (const id of ['monkey-mia-feeding', rottEv]) {
			const sw = data.get('save:' + cred.id) as any;
			sw.state.pending = { eventId: id };
			sw.state.rev += 1;
			data.set('save:' + cred.id, sw);
			await pullNow();
			assert.equal(el('modal').classList.contains('hidden'), false);
			assert.ok(el('modal').focused > modalFocus, `换成事件 ${id} 后焦点移进新内容`);
			modalFocus = el('modal').focused;
		}
		assert.match(el('modal').innerHTML, /data-choice="1"/);
		await click({ choice: '1' });
		await pause(30);
		// 选项按钮被结果页替换掉了：焦点移到「继续」
		assert.ok(el('modal').focused > modalFocus, '选完后焦点移到结果页');
		// 选完先看结果页：弹窗还开着、仍然锁住背后，点「继续」才关闭
		assert.match(el('modal').innerHTML, /结果/);
		assert.match(el('modal').innerHTML, /data-result-close/);
		assert.equal(el('game').inert, true, '结果页也锁住背后');
		// 键盘：结果页按 Esc 等于点「继续」（弗里曼特尔那段已经点过「继续」按钮）
		const panelFocus = el('panel').focused;
		docListeners.keydown({ key: 'Enter' });
		assert.equal(el('modal').classList.contains('hidden'), false, '别的键不关');
		docListeners.keydown({ key: 'Escape' });
		await pause(20);
		assert.equal(el('modal').classList.contains('hidden'), true, '按 Esc 后弹窗关闭');
		assert.ok(el('panel').focused > panelFocus, '弹窗关掉后焦点回到页面内容');
		assert.equal(el('game').inert, false, '弹窗关闭后解锁');
		assert.equal((data.get('save:' + cred.id) as any).state.loc, 'rottnest');
		// 夜里精力不满、其他都还行：下一步建议找地方过夜
		const night = data.get('save:' + cred.id) as any;
		night.state.clock = Math.floor(night.state.clock / 1440) * 1440 + 23 * 60;
		for (const k of Object.keys(night.state.needs)) night.state.needs[k] = 90;
		night.state.needs.energy = 70;
		night.state.health = 100;
		night.state.cash = 5000;
		night.state.pending = null;
		data.set('save:' + cred.id, night);
		docListeners.visibilitychange({});
		// 回到前台会去服务端同步：等同步回来的夜晚存档真的画进面板（最多 2 秒）
		const nextCard = () => panel().match(/<div class="next">[\s\S]*?<\/div>/)?.[0] ?? '';
		await click({ tab: 'place' });
		for (let i = 0; i < 100 && !/夜深了/.test(nextCard()); i++) { await pause(20); if (i % 10 === 9) await click({ tab: 'place' }); }
		assert.match(nextCard(), /夜深了/);
		// 每日摘要（第 27 轮）：服务端存档里有昨天的变化，回到前台后今天页顶上出回顾卡，点「知道了」收起
		const rc = data.get('save:' + cred.id) as any;
		rc.state.clock += 1440; // 拨到第 2 天的同一时刻（还是夜里），才有「昨天」
		const today = Math.floor(rc.state.clock / 1440);
		rc.state.dayMark = { day: today, at: today * 1440, cash: rc.state.cash, respect: rc.state.respect, places: Object.keys(rc.state.visited).length };
		rc.state.yday = { day: today - 1, days: 1, from: (today - 1) * 1440 - 1, to: today * 1440, cash: -42, respect: 1, places: 2 };
		rc.state.journal.push({ t: (today - 1) * 1440 + 600, text: '<i>在码头</i>看了一下午的船' });
		data.set('save:' + cred.id, rc);
		docListeners.visibilitychange({});
		for (let i = 0; i < 100 && !panel().includes('昨天回顾'); i++) { await pause(20); if (i % 10 === 9) await click({ tab: 'place' }); }
		assert.match(panel(), new RegExp(`昨天回顾（第 ${today} 天）`));
		assert.match(panel(), /现金 −\$42 · 声望 \+1 · 新去了 2 个地方/);
		assert.match(panel(), /10:00<\/span> &lt;i&gt;在码头/, '日志带时间、转义');
		await click({ recapClose: String(today - 1) });
		assert.ok(!panel().includes('昨天回顾'), '点知道了后收起');
		// 附近页底部有留言板和输入框
		assert.match(panel(), /📝 留言板/);
		assert.match(panel(), /id="note-form"[\s\S]*maxlength="60"/);
		// 夜里：根元素换成夜晚，出行页地图上有星星
		assert.ok(rootClasses.contains('p-night') && !rootClasses.contains('p-day'), '夜里换成夜晚配色');
		await click({ tab: 'go' });
		assert.match(el('map').innerHTML, /class="star"/, '夜里地图有星星');
		await click({ tab: 'place' });
		// 换交通方式：回到珀斯、钱够，卡尔古利能坐飞机也能走陆路，点另一块方块后出发按钮跟着换
		const back = data.get('save:' + cred.id) as any;
		back.state.loc = 'perth';
		back.state.rev += 1;
		data.set('save:' + cred.id, back);
		await pullNow();
		await click({ tab: 'go' });
		await click({ loc: 'kalgoorlie' });
		const other = panel().match(/class="tile" data-dmode="([a-z]+)" data-dest="kalgoorlie" aria-pressed="false" >/)?.[1];
		assert.ok(other, `卡尔古利应有第二种能选的走法：${panel().match(/data-dmode="[^>]+>/g)}`);
		await click({ dmode: other!, dest: 'kalgoorlie' });
		assert.match(panel(), new RegExp(`class="tile on" data-dmode="${other}" data-dest="kalgoorlie"`), '点中的方块变成选中');
		assert.match(panel(), new RegExp(`data-go="kalgoorlie" data-mode="${other}">出发去`), '出发按钮跟着换');
		// 住在房车营地、白天在珀斯车行：卖车按钮灰掉并写明原因（和引擎的检查一致）
		const camp = data.get('save:' + cred.id) as any;
		camp.state.clock = Math.floor(camp.state.clock / 1440) * 1440 + 1440 + 10 * 60;
		camp.state.vehicle = 'campervan';
		camp.state.home = { type: 'campground', loc: 'bunbury', furniture: {} };
		camp.state.rev += 1;
		data.set('save:' + cred.id, camp);
		await pullNow();
		await click({ tab: 'place' });
		assert.match(panel(), /<button data-veh="sell" disabled>/, '住营地时卖车按钮灰掉');
		assert.match(panel(), /你住在房车营地/);
		// 后台同步比动作晚回来（复现第 27 轮查到的竞态）：同步请求故意慢 150ms，期间做一个动作
		const fastFetch = g.fetch;
		g.fetch = async (u: string, o?: RequestInit) => {
			const res = await fastFetch(u, o); // 服务端按请求到达时的存档回答，回程故意慢
			if (String(o?.body).includes('"action":"get"')) await new Promise((r) => realSetTimeout(r, 150));
			return res;
		};
		docListeners.visibilitychange({});
		const act2 = panel().match(/data-act="([^"]+)"/)?.[1];
		assert.ok(act2);
		await click({ act: act2! });
		const afterAct = (data.get('save:' + cred.id) as any).state.rev;
		assert.equal(clientRev(), afterAct, '动作结果已经采用');
		await pause(250);
		g.fetch = fastFetch;
		assert.equal(clientRev(), afterAct, '晚回来的同步没有把存档倒回动作之前');
		// 两次同步先发的后到（第 6 批审查复现过：版本从 10 退回 9）：第一次慢 200ms，期间服务端存档更新、再同步一次
		let firstGet = true;
		g.fetch = async (u: string, o?: RequestInit) => {
			const res = await fastFetch(u, o);
			if (firstGet && String(o?.body).includes('"action":"get"')) { firstGet = false; await new Promise((r) => realSetTimeout(r, 200)); }
			return res;
		};
		docListeners.visibilitychange({});
		await pause(20);
		const bump = data.get('save:' + cred.id) as any;
		bump.state.rev += 1;
		data.set('save:' + cred.id, bump);
		await pullNow();
		const newest = bump.state.rev;
		await pause(300);
		g.fetch = fastFetch;
		assert.equal(clientRev(), newest, '先发后到的旧同步没有盖掉新的');
		// 音效关着时，后面的出行、事件、动作都没有出声
		assert.equal(audioLog.notes, audioLog.offAt, '关掉音效后不再出声');
		// 性能（第 35 轮）：一下子来 300 条进场消息，只合成一两次重画；社交页只列前 30 位，其余写个数
		const tabsEl = el('tabs');
		let tabsHtml = tabsEl.innerHTML, tabWrites = 0;
		Object.defineProperty(tabsEl, 'innerHTML', { get: () => tabsHtml, set: (v: string) => { tabWrites++; tabsHtml = v; }, configurable: true });
		const myLoc = (data.get('save:' + cred.id) as any).state.loc;
		for (let i = 0; i < 300; i++) lastWs!.onmessage!({ data: JSON.stringify({ t: 'join', p: { id: `crowd-${i}`, name: `路人${i}`, avatar: '🧑', loc: myLoc } }) });
		await pause(250);
		assert.ok(tabWrites >= 1 && tabWrites <= 2, `300 条消息重画了 ${tabWrites} 次`);
		assert.match(tabsHtml, />30\d</, '角标是最新人数');
		await click({ tab: 'social' });
		const rows = panel().match(/data-giftpick="crowd-/g) ?? [];
		assert.equal(rows.length, 30, '只列前 30 位');
		assert.match(panel(), /还有 2\d\d 位玩家在这里/);
		assert.ok(panel().length < 60_000, `社交页 HTML ${panel().length} 字节`);
	} finally {
		for (const id of timers) clearTimeout(id);
		rmSync(dir, { recursive: true, force: true });
		for (const [k, v] of Object.entries(saved)) {
			if (k === 'navigator') { if (v) Object.defineProperty(g, 'navigator', v as PropertyDescriptor); continue; }
			if (v === undefined) delete g[k]; else g[k] = v;
		}
	}
});


/** 扫码打开页面（第 32 轮）：地址栏带 #sync=；本机已有存档 local 时按情况处理。返回页面元素、本机存储和地址栏的变化 */
type HashOpts = {
	/** 本机存储里预先放的其他键（比如排队） */
	extra?: Record<string, string>;
	/** 改写服务器的回复（模拟慢、坏响应）：返回 undefined 用原回复 */
	reply?: (body: any, res: () => Promise<Response>) => Promise<Response | undefined>;
	venuesFail?: boolean;
	/** 页面启动完、清理之前再做点什么（点按钮、触发联网事件） */
	after?: (ctx: { click: (d: Record<string, string>) => Promise<void>; win: Record<string, (e: unknown) => void>; el: (id: string) => El }) => Promise<void>;
};
async function openWithHash(hash: string, local: { cred: unknown; state: unknown } | null, world: EarthWorld, confirmAnswer = true, opts: HashOpts = {}) {
	const els = new Map<string, El>();
	const el = (id: string): El => {
		if (!els.has(id)) els.set(id, {
			id, innerHTML: '', textContent: '', value: '', disabled: false, inert: false, classList: new ClassList(), attrs: {}, ls: {}, focused: 0, scrollTop: 0, scrollHeight: 0,
			setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.ls[t] = f; },
			querySelector() { return null; }, focus() { this.focused++; },
		});
		return els.get(id)!;
	};
	const store = new Map<string, string>();
	if (local) { store.set('earth.cred.v1', JSON.stringify(local.cred)); store.set('earth.save.v1', JSON.stringify(local.state)); }
	for (const [k, v] of Object.entries(opts.extra ?? {})) store.set(k, v);
	const docLs: Record<string, (e: unknown) => void> = {};
	const winLs: Record<string, (e: unknown) => void> = {};
	const g = globalThis as any;
	const saved = { setTimeout: g.setTimeout as typeof setTimeout, setInterval: g.setInterval, document: g.document, window: g.window, localStorage: g.localStorage, location: g.location, history: g.history, confirm: g.confirm, fetch: g.fetch, WebSocket: g.WebSocket, navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
	const seen = { reloads: 0, replaced: [] as string[], asked: [] as string[] };
	g.document = { getElementById: el, addEventListener: (t: string, f: (e: unknown) => void) => { docLs[t] = f; }, body: { classList: new ClassList() }, hidden: false };
	g.window = { setTimeout: (f: () => void, ms?: number) => g.setTimeout(f, ms), scrollTo() {}, addEventListener: (t: string, f: (e: unknown) => void) => { winLs[t] = f; } };
	g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
	g.location = { protocol: 'http:', host: 'game.test', pathname: '/earth/', search: '', hash, reload() { seen.reloads++; } };
	g.history = { replaceState: (_s: unknown, _t: string, u: string) => { seen.replaced.push(u); g.location.hash = ''; } };
	g.confirm = (m: string) => { seen.asked.push(m); return confirmAnswer; };
	g.fetch = async (u: string, o?: RequestInit) => {
		if (String(u) !== '/api/earth/save') return new Response('{}', { status: 404 });
		const res = () => world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: o?.body as string }));
		return (await opts.reply?.(JSON.parse(o?.body as string), res)) ?? res();
	};
	g.WebSocket = class { static OPEN = 1; readyState = 0; send() {} close() {} };
	g.setInterval = () => 0;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const realSetTimeout = saved.setTimeout;
	g.setTimeout = (f: () => void, ms?: number) => { const id = realSetTimeout(f, ms); timers.add(id); return id; };
	Object.defineProperty(g, 'navigator', { value: { geolocation: null, clipboard: null }, configurable: true });
	const dir = mkdtempSync(join(tmpdir(), 'earth-ui-'));
	try {
		const file = join(dir, 'page.mjs');
		writeFileSync(file, await bundlePage({ venuesFail: opts.venuesFail }));
		await import(pathToFileURL(file).href);
		for (let i = 0; i < 50; i++) await pause(10);
		const click = async (dataset: Record<string, string>) => { docLs.click({ target: { dataset, disabled: false, classList: { contains: () => false }, closest: fakeClosest } }); await pause(30); };
		await opts.after?.({ click, win: winLs, el });
		return { el, store, seen };
	} finally {
		for (const id of timers) clearTimeout(id);
		rmSync(dir, { recursive: true, force: true });
		for (const [k, v] of Object.entries(saved)) {
			if (k === 'navigator') { if (v) Object.defineProperty(g, 'navigator', v as PropertyDescriptor); continue; }
			if (v === undefined) delete g[k]; else g[k] = v;
		}
	}
}

/** 直接在服务端建一个角色，返回凭证和存档（给「扫码打开」这类测试当本机已有的角色） */
async function makeChar(world: EarthWorld, id: string, name: string) {
	const cred = { id, key: id[0].repeat(24) };
	const res = await world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: JSON.stringify({ action: 'create', ...cred, profile: { name, avatar: '🧑', origin: 'backpacker', traits: [] } }) }));
	const j = (await res.json()) as any;
	assert.ok(j.ok, j.msg);
	return { cred, state: j.state };
}

test('界面：扫二维码打开（#sync=）——没有角色就恢复，同一个角色不动，别的角色先问；同步码马上从地址栏抹掉', async () => {
	const { world } = makeWorld();
	const make = (id: string, name: string) => makeChar(world, id, name);
	const a = await make('scan-player-a', '扫码甲');
	const b = await make('scan-player-b', '扫码乙');
	const link = `#sync=${encodeURIComponent(a.cred.id + '.' + a.cred.key)}`;
	// 新设备：直接恢复成甲，进入游戏
	const fresh = await openWithHash(link, null, world);
	assert.deepEqual(fresh.seen.replaced, ['/earth/'], '同步码从地址栏抹掉');
	assert.equal(fresh.el('game').classList.contains('hidden'), false, '恢复后进入游戏');
	assert.deepEqual(JSON.parse(fresh.store.get('earth.cred.v1')!), a.cred);
	// 已经是甲：什么也不换
	const same = await openWithHash(link, a, world);
	assert.equal(same.seen.asked.length, 0);
	assert.equal(same.seen.reloads, 0);
	assert.deepEqual(JSON.parse(same.store.get('earth.cred.v1')!), a.cred);
	// 本机是乙：先问；不同意就不换
	const no = await openWithHash(link, b, world, false);
	assert.match(no.seen.asked[0] ?? '', /扫码乙/);
	assert.deepEqual(JSON.parse(no.store.get('earth.cred.v1')!), b.cred, '不同意就留着乙');
	assert.equal(no.seen.reloads, 0);
	// 同意：换成甲（本机存档也换成甲的），重新载入
	const yes = await openWithHash(link, b, world, true);
	assert.deepEqual(JSON.parse(yes.store.get('earth.cred.v1')!), a.cred);
	assert.equal(JSON.parse(yes.store.get('earth.save.v1')!).id, a.cred.id);
	assert.equal(yes.seen.reloads, 1);
	// 同步码不对：服务器不认，什么也不写
	const bad = await openWithHash(`#sync=${a.cred.id}.${'z'.repeat(24)}`, null, world);
	assert.equal(bad.store.get('earth.cred.v1'), undefined);
	assert.equal(bad.el('game').classList.contains('hidden'), true);
});

test('界面：扫码换角色时，原角色排着的动作在换完之前一个都不交；不换就照常补交（第 7 批审查问题 3）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'race-player-a', '竞态甲');
	const b = await makeChar(world, 'race-player-b', '竞态乙');
	const link = `#sync=${encodeURIComponent(a.cred.id + '.' + a.cred.key)}`;
	const queued = () => ({ 'earth.queue.v1': JSON.stringify({ id: b.cred.id, items: [{ act: { t: 'activity', id: 'rest' }, at: Date.now(), label: '休息', op: 'race0000000000b1' }] }) });
	// 新角色的存档慢 100 毫秒才回来：这段时间里乙不能同步、补交
	const slow = async (body: any, res: () => Promise<Response>) => {
		if (body.action === 'get' && body.id === a.cred.id) await pause(100);
		return res();
	};
	const bRev = () => (data.get('save:' + b.cred.id) as any).state.rev;
	const yes = await openWithHash(link, b, world, true, { extra: queued(), reply: slow });
	assert.equal(yes.seen.reloads, 1);
	assert.equal(bRev(), b.state.rev, '乙排着的动作没交出去');
	// 不换：乙照常启动，排着的动作补交
	const no = await openWithHash(link, b, world, false, { extra: queued(), reply: slow });
	assert.equal(no.seen.reloads, 0);
	for (let i = 0; i < 100 && bRev() === b.state.rev; i++) await pause(10);
	assert.equal(bRev(), b.state.rev + 1, '不换角色就照常补交');
});

test('界面：服务器发来的存档不是这个角色的（坏响应），换角色和恢复都不写本机（第 7 批审查问题 4）', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'badsave-player-a', '坏档甲');
	const b = await makeChar(world, 'badsave-player-b', '坏档乙');
	const link = `#sync=${encodeURIComponent(a.cred.id + '.' + a.cred.key)}`;
	const wrong = async (body: any, res: () => Promise<Response>) => {
		if (body.action !== 'get' || body.id !== a.cred.id) return undefined;
		const j = (await (await res()).json()) as any;
		return new Response(JSON.stringify({ ...j, state: { ...j.state, id: 'someone-else' } }));
	};
	const sw = await openWithHash(link, b, world, true, { reply: wrong });
	assert.equal(sw.seen.reloads, 0, '不换');
	assert.deepEqual(JSON.parse(sw.store.get('earth.cred.v1')!), b.cred, '凭证还是乙');
	assert.equal(JSON.parse(sw.store.get('earth.save.v1')!).id, b.cred.id, '存档还是乙');
	assert.match(sw.el('toast').textContent, /云端存档已损坏/);
	const rs = await openWithHash(link, null, world, true, { reply: wrong });
	assert.equal(rs.store.get('earth.cred.v1'), undefined, '恢复时凭证也不写');
	assert.equal(rs.el('game').classList.contains('hidden'), true);
});

test('界面：动作已经在服务器结算、回复在路上丢了，联网补交时不会再做一次（第 7 批审查问题 1）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'lost-reply-a', '丢包甲');
	let lost = 0;
	const rev = () => (data.get('save:' + a.cred.id) as any).state.rev;
	await openWithHash('', a, world, true, {
		reply: async (body, res) => {
			if (body.action === 'act' && lost === 0) { lost++; await res(); throw new TypeError('connection reset'); }
			return undefined;
		},
		after: async ({ click, win, el }) => {
			await click({ tab: 'place' });
			const act = el('panel').innerHTML.match(/data-act="([^"]+)"/)?.[1];
			assert.ok(act);
			const before = rev();
			await click({ act: act! });
			assert.equal(lost, 1);
			assert.equal(rev(), before + 1, '服务器已经结算');
			assert.match(el('toast').textContent, /已排队/, '页面以为没发出去，排了队');
			win.online?.({});
			for (let i = 0; i < 100 && /排队中/.test(el('panel').innerHTML); i++) await pause(10);
			await pause(50);
			assert.equal(rev(), before + 1, '补交时服务器认出是同一个动作，没再做一次');
			assert.match(el('toast').textContent, /补交了 1 个排队的动作/);
		},
	});
});

test('界面：真实地点下载失败时显示重试，不会反复重画卡死；点重试、重新联网会再试（第 7 批审查问题 2）', { timeout: 30_000 }, async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'venues-fail-a', '附近甲');
	let checked = 0;
	await openWithHash('', a, world, true, {
		venuesFail: true,
		after: async ({ click, win, el }) => {
			await click({ tab: 'near' });
			await pause(50);
			assert.match(el('panel').innerHTML, /真实地点数据没载入/);
			assert.match(el('panel').innerHTML, /data-venues-retry/);
			await click({ venuesRetry: '' });
			await pause(50);
			assert.match(el('panel').innerHTML, /真实地点数据没载入/, '重试又失败，照样停在提示上');
			win.online?.({});
			await pause(50);
			assert.match(el('panel').innerHTML, /真实地点数据没载入/);
			checked++;
		},
	});
	assert.equal(checked, 1);
});

test('界面：留言超过每地点上限时页面留下最新的（服务器按最新在前发）（第 7 批审查问题 5）', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'notes-many-a', '留言甲');
	let html = '';
	await openWithHash('', a, world, true, {
		reply: async (body) => {
			if (body.action !== 'notes') return undefined;
			// 21 条，最新在前：第 0 条是最新的
			const notes = Array.from({ length: 21 }, (_, i) => ({ id: 'n' + i, name: '路人', avatar: '🧑', text: `第${i}新的留言`, at: 1_800_000_000_000 - i * 1000, mine: false }));
			return new Response(JSON.stringify({ ok: true, notes, at: Date.now() }));
		},
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			for (let i = 0; i < 50 && !el('panel').innerHTML.includes('第0新的留言'); i++) await pause(10);
			html = el('panel').innerHTML;
		},
	});
	assert.ok(html.includes('第0新的留言'), '最新的在');
	assert.ok(html.includes('第19新的留言'));
	assert.ok(!html.includes('第20新的留言'), '最旧的那条截掉');
});

test('界面：没有存档时显示创建页，选完四步能创建角色并进入游戏', async () => {
	const { data, world } = makeWorld();
	const els = new Map<string, El>();
	const el = (id: string): El => {
		if (!els.has(id)) els.set(id, {
			id, innerHTML: '', textContent: '', value: '', disabled: false, inert: false, classList: new ClassList(), attrs: {}, ls: {}, focused: 0, scrollTop: 0, scrollHeight: 0,
			setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.ls[t] = f; },
			querySelector() { return null; }, focus() { this.focused++; },
		});
		return els.get(id)!;
	};
	const store = new Map<string, string>();
	const g = globalThis as any;
	const saved = { setTimeout: g.setTimeout as typeof setTimeout, setInterval: g.setInterval, document: g.document, window: g.window, localStorage: g.localStorage, location: g.location, fetch: g.fetch, WebSocket: g.WebSocket, navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
	g.document = { getElementById: el, addEventListener: () => {}, body: { classList: new ClassList() }, hidden: false };
	g.window = { setTimeout: (f: () => void, ms?: number) => g.setTimeout(f, ms), scrollTo() {}, addEventListener() {} };
	g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
	g.location = { protocol: 'http:', host: 'game.test', reload() {} };
	g.fetch = async (u: string, o?: RequestInit) => (String(u) === '/api/earth/save' ? world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: o?.body as string })) : new Response('{}', { status: 404 }));
	g.WebSocket = class { static OPEN = 1; readyState = 0; send() {} close() {} };
	g.setInterval = () => 0;
	// 页面里的延时提示（toast 等）在测试结束后还会触发：记下来，结束时全部取消
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const realSetTimeout = saved.setTimeout;
	g.setTimeout = (f: () => void, ms?: number) => { const id = realSetTimeout(f, ms); timers.add(id); return id; };
	Object.defineProperty(g, 'navigator', { value: { geolocation: null, clipboard: null }, configurable: true });
	const dir = mkdtempSync(join(tmpdir(), 'earth-ui-'));
	try {
		const file = join(dir, 'page.mjs');
		writeFileSync(file, await bundlePage());
		await import(pathToFileURL(file).href);
		await pause(30);
		assert.equal(el('create').classList.contains('hidden'), false, '没有存档时显示创建页');
		assert.equal(el('game').classList.contains('hidden'), true);
		const pickIn = (box: string, attr: string) => {
			const ids = [...el(box).innerHTML.matchAll(new RegExp(`<button class="[^"]*" data-${attr}="([^"]+)"(?![^>]*disabled)`, 'g'))].map((m) => m[1]);
			return ids;
		};
		const tap = async (dataset: Record<string, string>) => { el('create').ls.click({ target: { dataset, disabled: false, closest: fakeClosest } }); await pause(5); };
		assert.equal(el('c-start').disabled, true, '没选够特质不能开始');
		await tap({ origin: pickIn('c-origins', 'origin')[1] });
		await tap({ avatar: pickIn('c-avatars', 'avatar')[2] });
		await tap({ trait: pickIn('c-traits', 'trait')[0] });
		const second = pickIn('c-traits', 'trait').find((t) => !el('c-traits').innerHTML.includes(`trait on" data-trait="${t}"`));
		await tap({ trait: second! });
		assert.equal(el('c-start').disabled, false, '选够两个特质可以开始');
		el('c-name').value = '新来的';
		el('c-start').ls.click({});
		await pause(80);
		assert.equal(el('game').classList.contains('hidden'), false, '创建后进入游戏');
		const cred = JSON.parse(store.get('earth.cred.v1') ?? 'null');
		assert.ok(cred?.id && cred?.key, '凭证存到本机');
		const rec = data.get('save:' + cred.id) as any;
		assert.equal(rec.state.name, '新来的');
		assert.equal(rec.state.traits.length, 2);
	} finally {
		for (const id of timers) clearTimeout(id);
		rmSync(dir, { recursive: true, force: true });
		for (const [k, v] of Object.entries(saved)) {
			if (k === 'navigator') { if (v) Object.defineProperty(g, 'navigator', v as PropertyDescriptor); continue; }
			if (v === undefined) delete g[k]; else g[k] = v;
		}
	}
});
