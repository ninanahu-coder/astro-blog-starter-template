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
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { SEASON_DAYS } from '../../src/game/core/time.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { npcsAt } from '../../src/game/core/engine.ts';
import { NPCS } from '../../src/game/data/npcs.ts';

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
		delete: async (k: string | string[]) => { for (const kk of Array.isArray(k) ? k : [k]) data.delete(kk); },
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
		plugins: opts.venuesFail ? [{ name: 'venues-fail', setup(b) { b.onLoad({ filter: /\.venues\.json$/ }, () => ({ contents: 'throw new Error("offline")', loader: 'js' })); } }] : [],
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
	// 宠物（v31）：名字是玩家输入，存档里故意带 HTML，页面必须转义。寄养着：后面要坐船上罗特内斯特岛，带着宠物上不了岛
	rec.state.pet = { kind: 'budgie', name: '<i>啾</i>', from: 'shelter', since: 0, bond: 40, fedDay: 0, playDay: -1, walkDay: -1, vetDay: 0, board: { loc: rec.state.loc, until: Math.floor(rec.state.clock / 1440) + 14 } };
	data.set('save:' + cred.id, rec);
	// 装成排行榜改版前建的旧角色：没有上榜设置，读档时要弹一次上榜提示
	const lbKey = 'lbp:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred.id)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
	assert.ok(data.has(lbKey), '新角色建好时就有上榜设置');
	data.delete(lbKey);

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
	class FakeAudio { currentTime = 0; state = 'running'; destination = {}; constructor() { audioLog.ctx++; } createOscillator() { audioLog.notes++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; } createBufferSource() { return { buffer: null, loop: false, connect() {}, start() { audioLog.notes++; }, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }
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
		// 体验改造 P1：今天页的分组收进了抽屉，查分组里的内容用这个（今天页 + 各抽屉）
		const placeAll = () => withDrawers(click, el);
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

		// 开局时页面先画本机缓存，再去服务端拉存档（上面把饱食、现金改了）：等本机缓存换成服务端那份再往下测（最多 2 秒）。
		// 原来固定只等 50 毫秒，机器忙时偶尔还没拉到就断言，周结算预警那条会时好时坏（第 15 批 20 次重复测试里抓到）
		const pulled = () => (JSON.parse(store.get('earth.save.v1') ?? 'null') as { cash?: number; needs?: { hunger?: number } } | null);
		for (let i = 0; i < 100 && !(pulled()?.cash === 120 && pulled()?.needs?.hunger === 15); i++) await pause(20);
		assert.equal(pulled()?.cash, 120, '开局没有拉到服务端存档');
		await idle();
		// 旧角色：弹一次上榜提示，背后页面不可点；选「匿名上榜」后关掉并记到服务端
		for (let i = 0; i < 100 && !el('modal').innerHTML.includes('lbask-title'); i++) await pause(20);
		assert.match(el('modal').innerHTML, /排行榜要你同意才上榜/);
		assert.match(el('modal').innerHTML, /不会显示你在哪里/);
		assert.equal(el('modal').classList.contains('hidden'), false);
		assert.equal(el('game').inert, true);
		assert.deepEqual(a11yIssues(el('modal').innerHTML), []);
		await click({ lbask: 'anon' });
		for (let i = 0; i < 100 && !data.get(lbKey); i++) await pause(20);
		assert.equal(el('modal').classList.contains('hidden'), true, '回答后关掉');
		assert.equal(el('game').inert, false);
		assert.deepEqual([(data.get(lbKey) as any)?.on, (data.get(lbKey) as any)?.anon], [true, true], '回答记到服务端，换设备也不再问');
		await pullNow();
		assert.ok(!el('modal').innerHTML.includes('lbask-title') || el('modal').classList.contains('hidden'), '再读档不再弹');
		// 开局：游戏页显示、创建页隐藏，五个标签
		assert.equal(el('create').classList.contains('hidden'), true);
		assert.equal(el('game').classList.contains('hidden'), false);
		assert.equal(strip(el('tabs').innerHTML), '今天 出行 成长 社交 我');
		assert.equal(el('map-wrap').classList.contains('hidden'), true, '今天页不显示地图');
		assert.ok(rootClasses.contains('p-day') && !rootClasses.contains('p-night'), '开局 8 点是白天');
		// 名字里的 HTML 被转义（服务端可能已清洗掉尖括号；无论如何不能原样出现）
		for (const h of [panel(), el('hud').innerHTML]) assert.ok(!h.includes('<b>阿测</b>'), '名字没有转义');
		assert.match(panel(), /🦜 /, '今天页有宠物卡片');
		assert.match(panel(), /寄养到第 \d+ 天/);
		assert.ok(!panel().includes('<i>啾</i>'), '宠物名字没有转义');
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
		// 主界面定稿（第 15 批）：需求环 → 下一步 → 心愿 → 快捷动作
		assert.ok(panel().indexOf('<h3>状态</h3>') >= 0 && panel().indexOf('<h3>状态</h3>') < panel().indexOf('class="next"'), '需求环排在下一步前面');
		assert.ok(panel().indexOf('class="next"') < panel().indexOf('<h3>今天的心愿 · 还剩 '), '心愿在下一步后面');
		assert.ok(panel().indexOf('<h3>今天的心愿 · 还剩 ') < panel().indexOf('class="quick"'), '快捷动作在心愿后面');
		assert.equal((panel().match(/<div class="wish">/g) ?? []).length, (data.get('save:' + cred.id) as any).state.wishes.length, '每个没做的心愿一张小卡');
		// 快捷动作：2–4 个，都是这里能做的互动，从最缺的需求起挑
		const quick = panel().match(/<div class="quick"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
		const qActs = [...quick.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
		assert.ok(qActs.length >= 2 && qActs.length <= 4, `快捷动作 ${qActs.length} 个`);
		assert.equal(new Set(qActs).size, qActs.length, '快捷动作不重复');
		// 体验改造 P1：完整列表在「做事」抽屉里
		await click({ drawer: 'do' });
		for (const id of qActs) assert.match(el('modal').innerHTML, new RegExp(`class="row" data-act="${id}"`), `${id} 在完整列表里也有`);
		await click({ drawerClose: '' });
		// 左上人物名牌：等级环，点了去成长页；右上现金和天气
		assert.match(el('hud').innerHTML, /<button class="lv-plate" data-tab="grow" aria-label="Lv1 新来的，升级进度 \d+%，去成长页">/);
		assert.match(el('hud').innerHTML, /<div class="scene-right"><span class="chip cash">\$120<\/span>/);
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
		for (const t of ['go', 'near', 'grow', 'social', 'me']) {
			await click({ tab: t });
			assert.ok(strip(panel()).length > 20, `${t} 页是空的`);
			assert.deepEqual(a11yIssues(panel() + el('hud').innerHTML + el('tabs').innerHTML), [], `${t} 页`);
			assert.equal(el('map-wrap').classList.contains('hidden'), t !== 'go', `${t} 页地图显示不对`);
			if (t === 'go') assert.match(el('map').innerHTML, /class="land"/, '出行页画了地图');
			if (t === 'go') assert.match(panel(), /去了周结算会不够/, '周结算前的路费提醒');
			if (t === 'go') assert.match(el('hud').innerHTML, /<h1>出行<\/h1>/, '其他页顶栏用页名做大标题');
			if (t === 'me') assert.match(panel(), /class="card me-head"/, '我页顶上有人物抬头');
			// 附近并进出行（第 13 批）：两页顶上都有「路线 / 附近」分页，底部亮的都是出行
			if (t === 'go' || t === 'near') {
				assert.match(el('tabs').innerHTML, /data-tab="go" class="on" aria-current="page"/, `${t} 页底部应亮出行`);
				assert.match(panel(), new RegExp(`role="tablist" aria-label="出行"><button role="tab" data-tab="go" class="${t === 'go' ? 'on' : ''}" aria-selected="${t === 'go'}">路线</button><button role="tab" data-tab="near" class="${t === 'near' ? 'on' : ''}" aria-selected="${t === 'near'}">附近</button>`));
			}
			if (t === 'near') assert.match(el('hud').innerHTML, /<h1>附近<\/h1>/, '附近分页顶栏仍叫附近');
			// 成长页：等级卡在最上面，然后是每日奖励和各种收集
			if (t === 'grow') {
				assert.match(el('hud').innerHTML, /<h1>成长<\/h1>/);
				// 新角色第一次进成长页：最上面是引导便签（v36），便签下面是等级卡
				assert.match(panel(), /^<section class="slip" aria-labelledby="slip-grow">/);
				assert.ok(panel().replace(/^<section class="slip"[\s\S]*?<\/section>/, '').startsWith('<div class="card grow-head">'), '成长页最上面是等级卡');
				// 前面的事件结果有随机，声望可能是 0 或 0.5：按页面上的数核对「还差」和进度条
				const lvm = panel().match(/<b>Lv1 新来的<\/b><span>声望 ([\d.]+) \/ 10 · 离下一级还差 ([\d.]+)<\/span><span class="bar" role="img" aria-label="升级进度 (\d+)%"><i style="width:(\d+)%">/);
				assert.ok(lvm, '等级卡格式不对');
				assert.equal(Number(lvm![1]) + Number(lvm![2]), 10, '声望 + 还差 = 下一级门槛');
				assert.equal(Number(lvm![3]), Math.round(Number(lvm![1]) * 10), '进度百分比按声望算');
				assert.equal(lvm![3], lvm![4], '读屏文字和条宽一致');
				for (const h of ['每日奖励', '成就 ', '收藏册 ', '天气相册 ', '野生动物图鉴 ', '鱼获 ', '见闻录 ', '足迹 ']) assert.ok(panel().includes(`<h3>${h}`), `成长页缺 ${h}`);
				assert.ok(panel().indexOf('<h3>每日奖励') < panel().indexOf('<h3>成就 '), '每日奖励在成就前');
			}
			if (t === 'me') for (const h of ['每日奖励', '成就 ', '收藏册 ', '足迹 ']) assert.ok(!panel().includes(`<h3>${h}`), `「我」页不该再有 ${h}`);
		}
		for (const mt of ['overview', 'assets', 'people', 'log', 'sync']) {
			await click({ metab: mt });
			assert.match(panel(), new RegExp(`data-metab="${mt}" class="on"`), mt);
			assert.deepEqual(a11yIssues(panel()), [], `我 · ${mt}`);
			if (mt === 'log') assert.match(panel(), /class="log-day">第 1 天 · 春季第 1 天/, '日志按天分组');
			// 世界事件（第 43 批）：资产页有世界经济卡，开局第 1 天利率 4.00%、还没有新闻
			if (mt === 'assets') assert.match(panel(), /<h3>世界经济<\/h3>.*现金利率<\/span><b>4\.00%<\/b>.*最近四周没有大新闻.*不是真实行情/s, '资产页的世界经济卡');
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
				// 音效：体验改造 P2 起默认开（用户 2026-11-21 定），之前做的事已经出过声；关掉、再打开时试听一声，关掉后不再出声
				assert.match(panel(), /data-pref="sound" aria-pressed="true">已开启/);
				assert.equal(audioLog.ctx, 1, '默认开：做事时建了一次音频（只建一次）');
				assert.ok(audioLog.notes >= 1, '之前做的事出过声');
				await click({ pref: 'sound' });
				assert.match(panel(), /data-pref="sound" aria-pressed="false">已关闭/);
				const quiet = audioLog.notes;
				await click({ pref: 'sound' });
				assert.ok(audioLog.notes > quiet, '再打开又能出声（试听）');
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
		await click({ tab: 'grow' });
		// 足迹：全部地点；点一个没去过的地方跳到出行页并选中它
		assert.match(panel(), new RegExp(`足迹 1/${WORLD.locations.length}<`));
		assert.match(panel(), new RegExp(`<p class="trail-area">西澳大利亚 · 1/${WA.locations.length}</p>`), '足迹按区域分组');
		assert.match(panel(), /<p class="trail-area">南澳大利亚 · 0\/13<\/p>/);
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
		// 第 32 批：珀斯—弗里曼特尔多了 Transperth 火车，默认选最便宜的火车，长途巴士是另一个能点的方块（换走法在最后用卡尔古利测）
		assert.match(panel(), /class="tile on" data-dmode="transit" data-dest="fremantle"/);
		const alt = panel().match(/class="tile" data-dmode="([a-z]+)" data-dest="fremantle" aria-pressed="false" >/)?.[1];
		assert.equal(alt, 'road');
		assert.match(panel(), /Transperth 真实票价|今天周日，刷卡免费/, '公交方块写明票价出处');
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
		assert.match((await placeAll()), /📝 留言板/);
		assert.match((await placeAll()), /id="note-form"[\s\S]*maxlength="60"/);
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
		assert.match((await placeAll()), /<button data-veh="sell" disabled>/, '住营地时卖车按钮灰掉');
		assert.match((await placeAll()), /你住在房车营地/);
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
type LiveWs = { url: string; closed: boolean; say: (m: unknown) => void };
type HashOpts = {
	/** 本机存储里预先放的其他键（比如排队） */
	extra?: Record<string, string>;
	/** 改写服务器的回复（模拟慢、坏响应）：返回 undefined 用原回复 */
	reply?: (body: any, res: () => Promise<Response>) => Promise<Response | undefined>;
	venuesFail?: boolean;
	/** 启动时页面在后台（document.hidden），after 里用 show() 切回前台 */
	hidden?: boolean;
	/** 在线频道当作已连上：每个新建的连接记进这个数组（连接地址 url、收消息 say、是否被关 closed） */
	liveWs?: LiveWs[];
	/** CGI 清单（/earth/cgi/manifest.json 的 images）；不给时清单请求 404，页面全部走没图的样式 */
	cgi?: Record<string, string>;
	/** prompt() 的回答（默认 null，等于点了取消）；问过的话记进 seen.prompts */
	prompt?: string | null;
	/** 页面启动完、清理之前再做点什么（点按钮、触发联网事件） */
	after?: (ctx: { click: (d: Record<string, string>) => Promise<void>; win: Record<string, (e: unknown) => void>; doc: Record<string, (e: unknown) => void>; el: (id: string) => El; show: () => void; hide: () => void }) => Promise<void>;
	/** 页面能用的 AudioContext（不给就是没有 Web Audio 的浏览器） */
	audio?: unknown;
	/** AIGC 媒体清单（/earth/media/manifest.json）；不给时 404 */
	media?: unknown;
	/** 系统开了省流量（navigator.connection.saveData，体验改造 P3） */
	saveData?: boolean;
};
/**
 * 体验改造 P1：今天页的分组收进了底部抽屉（做事、买东西、工作、住处、这里的人、体验和爱好……）。
 * 依次打开今天页上的每个抽屉，把今天页和抽屉里的内容拼在一起，给检查「今天页里有什么」的测试用；最后关上抽屉。
 */
async function withDrawers(click: (d: Record<string, string>) => Promise<void>, el: (id: string) => { innerHTML: string }) {
	const panel = el('panel').innerHTML;
	let all = panel;
	for (const m of panel.matchAll(/data-drawer="([a-z]+)"/g)) {
		await click({ drawer: m[1] });
		all += '\n' + el('modal').innerHTML;
		await click({ drawerClose: '' });
	}
	return all;
}

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
	const saved = { setTimeout: g.setTimeout as typeof setTimeout, setInterval: g.setInterval, document: g.document, window: g.window, localStorage: g.localStorage, location: g.location, history: g.history, confirm: g.confirm, prompt: g.prompt, fetch: g.fetch, WebSocket: g.WebSocket, navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
	const seen = { reloads: 0, replaced: [] as string[], asked: [] as string[], prompts: [] as string[], fetched: [] as string[] };
	const root = new ClassList();
	g.document = { getElementById: el, addEventListener: (t: string, f: (e: unknown) => void) => { docLs[t] = f; }, body: { classList: new ClassList() }, documentElement: { classList: root }, hidden: !!opts.hidden };
	g.window = { setTimeout: (f: () => void, ms?: number) => g.setTimeout(f, ms), scrollTo() {}, addEventListener: (t: string, f: (e: unknown) => void) => { winLs[t] = f; }, AudioContext: opts.audio };
	g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
	g.location = { protocol: 'http:', host: 'game.test', pathname: '/earth/', search: '', hash, reload() { seen.reloads++; } };
	g.history = { replaceState: (_s: unknown, _t: string, u: string) => { seen.replaced.push(u); g.location.hash = ''; } };
	g.confirm = (m: string) => { seen.asked.push(m); return confirmAnswer; };
	g.prompt = (m: string) => { seen.prompts.push(m); return opts.prompt ?? null; };
	g.fetch = async (u: string, o?: RequestInit) => {
		seen.fetched.push(String(u));
		if (String(u) === '/earth/media/manifest.json' && opts.media) return new Response(JSON.stringify(opts.media), { status: 200 });
		if (String(u) === '/earth/cgi/manifest.json' && opts.cgi) return new Response(JSON.stringify({ images: opts.cgi }), { status: 200 });
		if (String(u) !== '/api/earth/save') return new Response('{}', { status: 404 });
		const res = () => world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: o?.body as string }));
		return (await opts.reply?.(JSON.parse(o?.body as string), res)) ?? res();
	};
	const live: LiveWs[] = opts.liveWs ?? [];
	g.WebSocket = opts.liveWs
		? class { static OPEN = 1; readyState = 1; onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null;
			constructor(url: string) { const self = this; live.push({ url, closed: false, say: (m) => self.onmessage?.({ data: JSON.stringify(m) }) }); this.idx = live.length - 1; }
			idx = 0; send() {} close() { live[this.idx].closed = true; this.readyState = 3; } }
		: class { static OPEN = 1; readyState = 0; send() {} close() {} };
	g.setInterval = () => 0;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const realSetTimeout = saved.setTimeout;
	g.setTimeout = (f: () => void, ms?: number) => { const id = realSetTimeout(f, ms); timers.add(id); return id; };
	// connection.change：页面注册的「省流量变了」回调，测试里改 saveData 后手动触发
	const connection = opts.saveData === undefined ? undefined : { saveData: opts.saveData, change: null as null | (() => void), addEventListener(t: string, f: () => void) { if (t === 'change') this.change = f; } };
	Object.defineProperty(g, 'navigator', { value: { geolocation: null, clipboard: null, ...(connection ? { connection } : {}) }, configurable: true });
	const dir = mkdtempSync(join(tmpdir(), 'earth-ui-'));
	try {
		const file = join(dir, 'page.mjs');
		writeFileSync(file, await bundlePage({ venuesFail: opts.venuesFail }));
		await import(pathToFileURL(file).href);
		for (let i = 0; i < 50; i++) await pause(10);
		const click = async (dataset: Record<string, string>) => { docLs.click({ target: { dataset, disabled: false, classList: { contains: () => false }, closest: fakeClosest } }); await pause(30); };
		await opts.after?.({ click, win: winLs, doc: docLs, el, show: () => { g.document.hidden = false; }, hide: () => { g.document.hidden = true; } });
		return { el, store, seen, root };
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
/** 当成新手引导上线前的老角色（存档里没有 onboard 字段）：所有卡片直接显示，不出引导便签 */
function asVeteran(data: Map<string, unknown>, c: { cred: { id: string }; state: any }) {
	const rec = data.get('save:' + c.cred.id) as any;
	const { onboard: _a, ...cloud } = rec.state;
	data.set('save:' + c.cred.id, { ...rec, state: cloud });
	const { onboard: _b, ...local } = c.state;
	return { ...c, state: local };
}
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
			await click({ drawer: 'place' });
			for (let i = 0; i < 50 && !el('modal').innerHTML.includes('第0新的留言'); i++) await pause(10);
			html = el('modal').innerHTML;
		},
	});
	assert.ok(html.includes('第0新的留言'), '最新的在');
	assert.ok(html.includes('第19新的留言'));
	assert.ok(!html.includes('第20新的留言'), '最旧的那条截掉');
});

test('界面：今天页的「今天的天」卡和顶栏气温（第 8 批，只做显示）', async () => {
	const { data, world } = makeWorld();
	const a = asVeteran(data, await makeChar(world, 'sky-card-a', '天象甲'));
	let panel = '', hud = '';
	await openWithHash('', a, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			panel = await withDrawers(click, el);
			hud = el('hud').innerHTML;
		},
	});
	assert.match(panel, /<h3>今天的天<\/h3>/);
	assert.match(panel, /现实中的 \d+ 月 \d+ 日/);
	assert.match(panel, /气温 -?\d+–\d+°C/);
	assert.match(panel, /日出 \d+:\d\d · 日落 \d+:\d\d/);
	assert.match(panel, /(涨|退)潮中 · 现在 [+−]\d+\.\d 米/, '出生地在海边，有潮汐');
	assert.match(panel, /真下海请看官方潮汐预报/);
	assert.match(panel, /紫外线：现在 \d+/);
	assert.match(hud, /class="wx-pill[^"]*">[^<]*\d+°/, '顶栏天气带最高气温');
	// 虚拟人生风格：今天页顶栏是当地小场景，地点名牌、需求环、NPC 立绘
	assert.match(hud, /<div class="scene"><svg class="scene-art"/);
	// 地点名牌：大字地名，下面一行是时间（第 15 批从顶上的时间胶囊挪进来）
	assert.match(hud, /<div class="plate"><h1>[^<]+<\/h1><span class="en" lang="en" aria-hidden="true">[^<]+<\/span><small title="[^"]+">[^<]*\d+:\d\d[^<]*<\/small><\/div>/);
	assert.doesNotMatch(hud, /pill-on/, '顶上不再有单独的时间胶囊');
	assert.match(panel, /<div class="rings">/);
	assert.equal((panel.match(/class="ring /g) ?? []).length, 6, '六个需求环');
	assert.match(panel, /role="img" aria-label="健康 \d+/);
	assert.deepEqual(a11yIssues(panel), []);
});

test('界面：火险高以上时卡片、顶栏、提示（第 39 轮，只做提示）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'fire-card-a', '火险甲');
	// 夏季里珀斯第一个「炎热」的游戏日
	let day = SEASON_DAYS;
	while (weatherOn('perth', day).id !== 'hot') day++;
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.clock = day * 1440 + 10 * 60;
	rec.state.loc = 'perth';
	data.set('save:' + a.cred.id, rec);
	let panel = '', hud = '', toasts = '';
	const { store: lastStore } = await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			await pause(700);
			panel = await withDrawers(click, el);
			hud = el('hud').innerHTML;
			toasts = el('toast').textContent;
		},
	});
	assert.match(panel, /<span class="chip">山火季<\/span>/);
	assert.match(panel, /火险等级：极端/);
	assert.match(hud, /🔥 火险极端/);
	assert.match(toasts, /火险极端（游戏里的估算，不是真实预警）/, '提示写明是估算');
	assert.match(toasts, /Emergency WA/);
	assert.match(panel, /<a href="https:\/\/www\.emergency\.wa\.gov\.au\/" target="_blank" rel="noopener">/, '卡片有真实来源的链接');
	assert.match(hud, /🔥 火险极端 · 示意/);
	// 去重（第 8 批审查问题 2）：记在本机，重新载入同一地点同一天不再弹
	const seenRaw = lastStore.get('earth.fire.v1')!;
	assert.deepEqual(JSON.parse(seenRaw), [`perth@${day}`]);
	let again = '';
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		extra: { 'earth.fire.v1': seenRaw },
		after: async ({ click, el }) => { await click({ tab: 'place' }); await pause(700); again = el('toast').textContent; },
	});
	assert.doesNotMatch(again, /火险/, '重新载入不再弹');
	// 0.6 秒内切到别的页：不弹，也不记成已提示
	let away = '';
	const left = await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		hidden: true,
		after: async ({ click, el, show }) => {
			await pause(700);
			assert.doesNotMatch(el('toast').textContent, /火险/, '页面在后台时不弹');
			show();
			// 点「今天」排上提示，马上切到「出行」（click 只等 20 毫秒，远小于 0.6 秒）
			await click({ tab: 'place' });
			await click({ tab: 'go' });
			await pause(700);
			away = el('toast').textContent;
		},
	});
	assert.doesNotMatch(away, /火险/, '切到出行页后不在那里弹');
	assert.equal(left.store.get('earth.fire.v1'), undefined);
	// 紫外线（第 40 轮）：夏天上午 10 点的炎热天，现在很高，顶栏提醒，卡片写防晒时段
	assert.match(panel, /紫外线：现在 \d+（(很高|极高)）· 今天最高 \d+/);
	assert.match(panel, /\d+:\d\d–\d+:\d\d 指数在 3 以上，出门要防晒/);
	assert.match(hud, /🕶️ 紫外线 \d+/);
});

test('界面：画面天色跟着当地日出日落，不是固定钟点（第 37 轮）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'sky-phase-a', '天色甲');
	const open = async (day: number, hour: number) => {
		const rec = data.get('save:' + a.cred.id) as any;
		rec.state.clock = day * 1440 + hour * 60;
		rec.state.loc = 'perth';
		data.set('save:' + a.cred.id, rec);
		const r = await openWithHash('', { cred: a.cred, state: rec.state }, world);
		return Object.assign(r.root, { hud: r.el('hud').innerHTML });
	};
	// 冬季中（≈ 7 月中）傍晚 6 点半：钟点上还算「傍晚」，但珀斯 5 点半就日落了，画面是夜色
	const winter = await open(3 * SEASON_DAYS + 14, 18.5);
	assert.ok(winter.contains('p-night') && !winter.contains('p-dusk'), '冬天 6 点半已经黑了');
	assert.match(winter.hud, /18:30 傍晚（天已经黑了）/, '顶栏说明玩法时段和实际天色不一样');
	// 夏季（≈ 1 月）傍晚 6 点半：太阳还高，画面是白天
	const summer = await open(SEASON_DAYS + 12, 18.5);
	assert.ok(summer.contains('p-day'), '夏天 6 点半还亮');
});

test('界面：虚拟人生风格——最缺的需求变成想法气泡；NPC 有立绘、名牌、关系条和对话气泡；事件弹窗用当地场景当背景', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'life-ui-a', '人生甲');
	const rec = data.get('save:' + a.cred.id) as any;
	// 找一个有 NPC 在场的地点和时刻
	let found: { loc: string; clock: number } | null = null;
	for (const n of NPCS) {
		for (let c = 0; c < 7 * 1440 && !found; c += 60) {
			const st = { ...rec.state, loc: n.loc, clock: 1440 * 3 + c };
			if (npcsAt(st, WA).length) found = { loc: n.loc, clock: st.clock };
		}
		if (found) break;
	}
	assert.ok(found, '有 NPC 在场的时刻');
	rec.state.loc = found!.loc;
	rec.state.clock = found!.clock;
	rec.state.needs.social = 10;
	data.set('save:' + a.cred.id, rec);
	let panel = '', hud = '';
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			panel = await withDrawers(click, el);
			hud = el('hud').innerHTML;
		},
	});
	assert.match(hud, /<span class="thought">想找人说说话<\/span>/, '社交最缺：人物头上冒想法');
	assert.match(panel, /<div class="npc-talk"><div class="npc-head"><svg class="portrait"/);
	assert.match(panel, /<div class="npc-name"><b>[^<]+<\/b><small>[^<]+<\/small><\/div>/);
	assert.match(panel, /role="progressbar" aria-label="和[^"]+的关系" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\d+"/);
	assert.match(panel, /<p class="bubble">/);
	assert.match(panel, /<em class="lack">最缺<\/em>/);
	assert.deepEqual(a11yIssues(panel), []);
	assert.deepEqual(a11yIssues(hud), []);
	// 事件弹窗：放一个待处理事件，弹窗背景是当地场景（没有配图时）
	const { EVENTS } = await import('../../src/game/data/events.ts');
	const ev = EVENTS.find((e) => e.choices.length >= 2 && !e.periods)!;
	rec.state.pending = { eventId: ev.id };
	data.set('save:' + a.cred.id, rec);
	let modal = '';
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, { after: async ({ el }) => { modal = el('modal').innerHTML; } });
	assert.match(modal, /<div class="ev-hero"><svg class="scene-art"[^>]*aria-hidden="true"/);
	assert.match(modal, /<i class="ev-shade"><\/i>/);
	assert.deepEqual(a11yIssues(modal), []);
	assert.equal((modal.match(/class="row choice first"/g) ?? []).length, 1, '只高亮一个选项');
	assert.match(modal, /class="row choice first" data-choice="0"/, '第一项能选时高亮第一项');
});

test('界面：想法气泡的边界——并列最低按固定顺序取一个；恰好 60 和全满都不冒气泡（Codex 界面审查问题 3）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'thought-a', '想法甲');
	const hudWith = async (health: number, needs: Record<string, number>) => {
		const rec = data.get('save:' + a.cred.id) as any;
		rec.state.health = health;
		rec.state.needs = { ...rec.state.needs, ...needs };
		rec.state.rev += 1;
		data.set('save:' + a.cred.id, rec);
		let hud = '';
		await openWithHash('', { cred: a.cred, state: rec.state }, world, true, { after: async ({ click, el }) => { await click({ tab: 'place' }); hud = el('hud').innerHTML; } });
		return hud;
	};
	const full = { hunger: 100, energy: 100, hygiene: 100, fun: 100, social: 100 };
	assert.ok(!(await hudWith(100, full)).includes('class="thought"'), '全满不冒气泡');
	assert.ok(!(await hudWith(100, { ...full, social: 60 })).includes('class="thought"'), '恰好 60 不冒气泡');
	assert.match(await hudWith(100, { ...full, social: 59 }), /<span class="thought">想找人说说话<\/span>/, '59 冒气泡');
	// 娱乐和社交一样低：按 健康→饱食→精力→卫生→娱乐→社交 取第一个，只冒一个
	const tie = await hudWith(100, { ...full, fun: 20, social: 20 });
	assert.equal((tie.match(/class="thought"/g) ?? []).length, 1);
	assert.match(tie, /<span class="thought">有点无聊<\/span>/);
	assert.match(await hudWith(20, { ...full, hunger: 20 }), /<span class="thought">身体不太舒服<\/span>/, '健康排在最前');
});

test('界面：事件第一项不能选时（钱不够），高亮顺延到第一个能选的选项（Codex 界面审查问题 2）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'first-choice-a', '选项甲');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'exmouth';
	rec.state.cash = 0;
	rec.state.pending = { eventId: 'whale-shark' };
	data.set('save:' + a.cred.id, rec);
	let modal = '', focusedChoice: string | undefined;
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ el }) => {
			modal = el('modal').innerHTML;
			focusedChoice = (el('modal') as any).querySelector?.('button:not([disabled])')?.dataset?.choice;
		},
	});
	assert.match(modal, /<button class="row choice" data-choice="0" disabled>/, '第一项钱不够，不能选、不高亮');
	assert.match(modal, /<button class="row choice first" data-choice="1">/, '高亮顺延到第二项');
	assert.equal((modal.match(/choice first/g) ?? []).length, 1);
	if (focusedChoice !== undefined) assert.equal(focusedChoice, '1', '键盘焦点和高亮是同一个选项');
});

test('界面：跨区域出行（第 43 轮）——西澳地图上有通往南澳的出口；飞到阿德莱德后地图换成南澳，出行列表标出回西澳的航班', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'cross-ui-a', '跨区甲');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.cash = 5000;
	rec.state.loc = 'perth';
	data.set('save:' + a.cred.id, rec);
	let before = '', list = '', after = '', afterList = '', saved: any = null;
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'go' });
			before = el('map').innerHTML;
			list = el('panel').innerHTML;
			await click({ go: 'adelaide', mode: 'air' });
			for (let i = 0; i < 100 && (data.get('save:' + a.cred.id) as any).state.loc !== 'adelaide'; i++) await pause(20);
			await pause(60);
			saved = (data.get('save:' + a.cred.id) as any).state;
			await click({ tab: 'go' });
			after = el('map').innerHTML;
			afterList = el('panel').innerHTML;
		},
	});
	assert.match(before, /class="exit-label"[^>]*>✈️ 阿德莱德（南澳大利亚）</, '珀斯有飞阿德莱德的出口');
	assert.match(before, /data-loc="adelaide"/);
	assert.match(before, /🛣️ 锡杜纳（南澳大利亚）/, '卡尔古利有公路出口');
	assert.doesNotMatch(before, /data-loc="glenelg"/, '西澳地图上不画南澳的地点');
	assert.match(list, /data-go="adelaide" data-mode="air"/);
	assert.match(list, /去南澳大利亚 · /);
	assert.equal(saved.loc, 'adelaide');
	assert.equal(saved.region, 'sa');
	assert.match(after, /data-loc="glenelg"/, '到了以后画南澳');
	assert.doesNotMatch(after, /data-loc="fremantle"/);
	assert.match(after, /✈️ 珀斯（西澳大利亚）/);
	assert.match(afterList, /去西澳大利亚 · /);
});

test('界面：跨区域换在线频道（第 9 批审查问题 1）——旧区域连接还在路上的进出和聊天不混进新区域，旧区域的聊天记录清掉', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'cross-ws-a', '换频道甲');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.cash = 5000;
	rec.state.loc = 'perth';
	data.set('save:' + a.cred.id, rec);
	const socks: LiveWs[] = [];
	let social = '', badge = '';
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		liveWs: socks,
		after: async ({ click, el }) => {
			assert.equal(socks.length, 1, '开局连上一个在线频道');
			assert.match(socks[0].url, /region=wa/);
			socks[0].say({ t: 'hello', you: 'me', emotes: [], players: [] });
			socks[0].say({ t: 'chat', id: 'p1', name: '西澳人', avatar: '🙂', text: '珀斯今天好热' });
			await pause(200);
			await click({ tab: 'go' });
			await click({ go: 'adelaide', mode: 'air' });
			for (let i = 0; i < 100 && socks.length < 2; i++) await pause(20);
			assert.equal(socks.length, 2, '到南澳后换了新连接');
			assert.equal(socks[0].closed, true, '旧连接关了');
			assert.match(socks[1].url, /region=sa/);
			// 旧连接关了，但还有在路上的消息到达
			socks[0].say({ t: 'join', p: { id: 'p2', name: '迟到的西澳人', avatar: '😎', loc: 'perth' } });
			socks[0].say({ t: 'chat', id: 'p2', name: '迟到的西澳人', avatar: '😎', text: '还在珀斯' });
			socks[1].say({ t: 'hello', you: 'me2', emotes: [], players: [] });
			await pause(200);
			await click({ tab: 'social' });
			social = el('panel').innerHTML;
			badge = el('tabs').innerHTML;
		},
	});
	assert.doesNotMatch(social, /迟到的西澳人/, '旧区域的进出和聊天不显示');
	assert.doesNotMatch(social, /珀斯今天好热/, '换区域后旧聊天清掉');
	assert.doesNotMatch(badge, /迟到的西澳人/);
});

test('界面：附近页按所在区域载入真实地点（第 9 批审查问题 4；2026-11-19 南澳采集完）——南澳、西澳都不再显示还在采集', async () => {
	const { data, world } = makeWorld();
	const near = async (id: string, loc: string) => {
		const a = await makeChar(world, id, '附近' + loc);
		const rec = data.get('save:' + a.cred.id) as any;
		rec.state.loc = loc;
		data.set('save:' + a.cred.id, rec);
		let html = '';
		await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
			after: async ({ click, el }) => {
				await click({ tab: 'near' });
				for (let i = 0; i < 100 && /正在载入/.test(el('panel').innerHTML); i++) await pause(20);
				html = el('panel').innerHTML;
			},
		});
		return html;
	};
	const sa = await near('near-sa-a', 'adelaide');
	assert.doesNotMatch(sa, /还在采集中/, '南澳的真实地点分包没载入');
	assert.doesNotMatch(sa, /没载入/);
	assert.match(sa, /打开定位，看看附近/);
	const wa = await near('near-wa-a', 'perth');
	assert.doesNotMatch(wa, /还在采集中/);
	assert.match(wa, /打开定位，看看附近/);
});

test('界面：「我 · 更新」页（第 48 轮）——没看过时标签标「新」，打开后记下已读、不再标；本机存的已读是坏值时当没看过', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'news-ui-a', '看更新');
	const rec = data.get('save:' + a.cred.id) as any;
	let before = '', news = '', after = '';
	const r = await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		extra: { 'earth.news.v1': '<b>' },
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			before = el('panel').innerHTML;
			await click({ metab: 'news' });
			news = el('panel').innerHTML;
			await click({ metab: 'overview' });
			after = el('panel').innerHTML;
		},
	});
	assert.match(before, /data-metab="news"[^>]*>更新<span class="new-tag">新<\/span>/, '坏值当没看过，标「新」');
	assert.match(news, /data-metab="news" class="on" aria-selected="true">更新</);
	assert.match(news, /<div class="card news"><h3>南澳大利亚 <span class="muted">2026-11-18<\/span><\/h3>/);
	assert.ok(news.indexOf('收尾整理') < news.indexOf('玩法加厚'), '新的在前');
	assert.deepEqual(a11yIssues(news), []);
	assert.doesNotMatch(after, /new-tag/, '看过以后不再标');
	assert.equal(r.store.get('earth.news.v1'), String((await import('../../src/game/data/changelog.ts')).CHANGELOG_LATEST));
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
		assert.match(el('c-start').textContent, /再勾选 2 个性格特质/);
		await tap({ origin: pickIn('c-origins', 'origin')[1] });
		// 入境卡（第 50 轮开场）：身份栏写出起始现金，照片栏放大显示选中的形象
		assert.match(el('c-origins').innerHTML, /ac-opt on" data-origin="fifo"[\s\S]*?\$2500/);
		const ava = pickIn('c-avatars', 'avatar')[2];
		await tap({ avatar: ava });
		// 照片栏：证件照按「出身-形象下标」取，emoji 垫在下面做加载失败的后备
		assert.match(el('c-photo').innerHTML, new RegExp(`<span class="ac-photo-emoji">${ava}</span><img class="ac-photo-img" src="/earth/char/fifo-2\\.webp" alt=""`));
		await tap({ origin: 'surfer' });
		assert.match(el('c-photo').innerHTML, /src="\/earth\/char\/surfer-2\.webp"/, '换出身，证件照跟着换');
		await tap({ origin: 'fifo' });
		await tap({ trait: pickIn('c-traits', 'trait')[0] });
		const second = pickIn('c-traits', 'trait').find((t) => !el('c-traits').innerHTML.includes(`trait on" data-trait="${t}"`));
		await tap({ trait: second! });
		assert.equal(el('c-start').disabled, false, '选够两个特质可以开始');
		assert.equal(el('c-start').textContent, '盖章入境 · 开始生活');
		assert.equal(el('c-trait-n').textContent, '已勾 2 项');
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

/** 假的 Web Audio（v37 声音系统）：记录建了几个 AudioContext、起了哪些噪声循环和振荡器、暂停/恢复了几次 */
function fakeWebAudio() {
	const log = { ctx: 0, srcStarted: 0, srcStopped: 0, filters: [] as string[], oscs: [] as number[], suspend: 0, resume: 0, gains: [] as number[][] };
	const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
	class Ctx {
		currentTime = 0; sampleRate = 8000; state = 'running'; destination = {};
		constructor() { log.ctx++; }
		suspend() { log.suspend++; this.state = 'suspended'; }
		resume() { log.resume++; this.state = 'running'; }
		// 每个增益节点记下设过的值（立即设置和平滑过渡都算）；前四个是混音台的总线、音效、环境音、音乐
		createGain() { const vals: number[] = []; log.gains.push(vals); return { gain: { ...param(), setValueAtTime: (v: number) => { vals.push(v); }, setTargetAtTime: (v: number) => { vals.push(v); } }, connect() {} }; }
		createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start() { log.oscs.push(o.frequency.value); }, stop() {} }; return o; }
		createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
		// 只数循环播放的声源（环境音）；提示音（P2 起也用缓冲声源）放完就结束，不算
		createBufferSource() { const o = { buffer: null, loop: false, connect() {}, start() { if (o.loop) log.srcStarted++; }, stop() { if (o.loop) log.srcStopped++; } }; return o; }
		createBiquadFilter() { const f = { type: '', frequency: param(), Q: { value: 0 }, connect() { log.filters.push(f.type); } }; return f; }
	}
	return { Ctx, log };
}

test('界面：声音（v37）——打开了环境音和音乐也要等玩家先点一下才出声；切后台暂停、回来恢复；关掉后停；音量存进本机', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'audio-v37', '听声');
	const { Ctx, log } = fakeWebAudio();
	const prefs = JSON.stringify({ ambience: true, music: true, sound: false });
	let afterBoot = -1;
	const r = await openWithHash('', a, world, true, {
		audio: Ctx,
		extra: { 'earth.prefs.v1': prefs },
		after: async ({ click, doc, hide, show }) => {
			afterBoot = log.ctx;
			// 第一次点页面（随便哪里）：这时才建音频，并按地点放环境音和音乐
			await click({ tab: 'me' });
			for (let i = 0; i < 20 && log.srcStarted === 0; i++) await pause(10);
			assert.equal(log.ctx, 1, '点了之后才建音频');
			assert.ok(log.srcStarted >= 1, '环境音的噪声循环起来了');
			assert.ok(log.filters.length >= 1, '噪声经过滤波');
			assert.ok(log.oscs.some((f) => f > 80 && f < 1200), '音乐排了和弦音');
			await click({ tab: 'place' });
			assert.equal(log.ctx, 1, '只建一次');
			// 混音台：音效默认关，音效分轨是 0；打开后马上变成 1（试听的那一声听得见）
			assert.equal(log.gains[1][0], 0, '音效分轨开始是 0');
			await click({ pref: 'sound' });
			assert.equal(log.gains[1].at(-1), 1, '打开音效后音效分轨打开');
			// 切到后台暂停，回来恢复
			hide(); doc.visibilitychange({});
			assert.equal(log.suspend, 1);
			const resumed = log.resume;
			show(); doc.visibilitychange({});
			assert.equal(log.resume, resumed + 1);
			// 关掉环境音：噪声循环全停
			await click({ pref: 'ambience' });
			assert.equal(log.srcStopped, log.srcStarted, '关掉后环境音全停');
			// 音量换成「轻」，存进本机
			await click({ pref: 'volume', val: 'low' });
			await click({ pref: 'volume', val: 'huge' });
		},
	});
	assert.equal(afterBoot, 0, '打开页面时不自动出声（没建 AudioContext）');
	const saved = JSON.parse(r.store.get('earth.prefs.v1')!);
	assert.equal(saved.ambience, false);
	assert.equal(saved.music, true);
	assert.equal(saved.volume, 'low', '不认识的音量档不改');
});

test('界面：声音（v37）——设置页有音效、环境音、背景音乐三个开关和音量，并写明不开声音不会错过信息；没有 Web Audio 的浏览器点了也不报错', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'audio-v37b', '无声');
	let html = '';
	await openWithHash('', a, world, true, {
		extra: { 'earth.prefs.v1': JSON.stringify({ ambience: true }) },
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			html = el('panel').innerHTML;
			await click({ pref: 'music' });
		},
	});
	for (const k of ['sound', 'ambience', 'music']) assert.match(html, new RegExp(`data-pref="${k}" aria-pressed="(true|false)"`), k);
	assert.match(html, /data-pref="ambience" aria-pressed="true">已开启/);
	assert.match(html, /data-pref="volume" data-val="low" class="on" aria-pressed="true"/, '默认最轻一档（P2）');
	assert.match(html, /不开声音不会错过/);
	assert.deepEqual(a11yIssues(html), []);
});

test('界面：新手引导（v36）——新角色先藏钓鱼等卡片并写明何时出现；出行页第一次有便签，关掉后马上消失并记进云端存档；全部显示', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'onboard-ui-a', '引导');
	let place = '', go = '', goAfter = '', placeAll = '';
	await openWithHash('', { cred: a.cred, state: a.state }, world, true, {
		after: async ({ click, el }) => {
			await pause(60);
			place = el('panel').innerHTML;
			await click({ tab: 'go' });
			go = el('panel').innerHTML;
			await click({ obTip: 'go' });
			goAfter = el('panel').innerHTML;
			await pause(80);
			await click({ tab: 'place' });
			await click({ obAll: '' });
			await pause(80);
			await click({ tab: 'place' });
			placeAll = el('panel').innerHTML;
		},
	});
	assert.match(place, /<div class="later"><p><b>之后会出现<\/b>钓鱼、摄影任务和星空（到第 2 天或去过第二个地方）/);
	assert.doesNotMatch(place, /<h3>🎣 钓鱼/);
	assert.match(go, /<section class="slip" aria-labelledby="slip-go">/);
	assert.match(go, /data-ob-tip="go" aria-label="关掉提示「出行：路费和时间出发前就写着」，以后不再出现">知道了/);
	assert.deepEqual(a11yIssues(go), []);
	assert.doesNotMatch(goAfter, /class="slip"/, '点了马上消失，不等服务器');
	const saved = (data.get('save:' + a.cred.id) as any).state.onboard;
	assert.ok(saved.tips.includes('go'), '记进云端存档');
	assert.deepEqual(saved.feats.length, 4, '全部显示');
	assert.doesNotMatch(placeAll, /class="later"/);
});

test('界面：回流卡片（v36）——离开 6 天后打开，今天页最上面是再入境卡片；点「知道了」后消失并记进存档', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'onboard-ui-b', '回来');
	const rec = data.get('save:' + a.cred.id) as any;
	const today = Math.floor((Date.now() + 8 * 3_600_000) / 86_400_000);
	data.set('save:' + a.cred.id, { ...rec, state: { ...rec.state, daily: { day: today - 6, streak: 5 } } });
	let first = '', loaded = '', after = '';
	await openWithHash('', { cred: a.cred, state: a.state }, world, true, {
		after: async ({ click, el }) => {
			await pause(80);
			await click({ tab: 'place' });
			first = el('panel').innerHTML;
			await pause(150);
			loaded = el('panel').innerHTML;
			await click({ obBack: '' });
			after = el('panel').innerHTML;
			await pause(80);
		},
	});
	assert.match(first, /<section class="back-card" aria-labelledby="back-title">/);
	assert.match(first, /欢迎回来，离开了 6 天/);
	assert.match(first, /主线停在<\/b>第一章/);
	// 更新日志按需加载（第 41 批）：下完后今天页自动重画，回流卡片列出离开期间的更新
	assert.match(loaded, /<b>离开期间更新了 [1-3] 次<\/b>/);
	assert.ok(first.indexOf('back-card') < first.indexOf('class="rings"'), '在需求卡前面');
	assert.deepEqual(a11yIssues(first), []);
	assert.doesNotMatch(after, /back-card/);
	assert.equal((data.get('save:' + a.cred.id) as any).state.onboard.back.seen, true);
});

test('界面：断网时关提示（v36）——便签照样马上消失，云端存档不变，留着联网后再交', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'onboard-ui-c', '断网');
	let after = '';
	await openWithHash('', { cred: a.cred, state: a.state }, world, true, {
		reply: async (body) => { if (body?.act?.t === 'onboard') throw new TypeError('offline'); return undefined; },
		after: async ({ click, el }) => {
			await pause(60);
			await click({ tab: 'grow' });
			assert.match(el('panel').innerHTML, /aria-labelledby="slip-grow"/);
			await click({ obTip: 'grow' });
			await pause(40);
			after = el('panel').innerHTML;
		},
	});
	assert.doesNotMatch(after, /slip-grow/);
	assert.deepEqual((data.get('save:' + a.cred.id) as any).state.onboard.tips, []);
});

test('界面：界面配图（第 21 批）——清单里有的键用小图、横幅和空状态插图，地址经过转义；清单里没有的照旧用原来的样式', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'cgi-ui-a', '看配图');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'perth';
	rec.state.cash = 5000;
	rec.state.inventory = {};
	rec.state.properties = [];
	data.set('save:' + a.cred.id, rec);
	let place = '', growSlip = '', grow = '', assets = '';
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		cgi: { 'exp:swan-cruise': '/earth/cgi/exp.webp?"><b>x', 'banner:grow': '/earth/cgi/banner-grow.webp', 'empty:bag': '/earth/cgi/empty-bag.webp' },
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			place = await withDrawers(click, el);
			await click({ tab: 'grow' });
			growSlip = el('panel').innerHTML;
			await click({ obTip: 'grow' });
			grow = el('panel').innerHTML;
			await click({ tab: 'me' });
			await click({ metab: 'assets' });
			assets = el('panel').innerHTML;
		},
	});
	assert.match(place, /<img class="thumb" src="\/earth\/cgi\/exp\.webp\?&quot;&gt;&lt;b&gt;x" alt="" loading="lazy" width="48" height="48" \/><span class="body">✨ 天鹅河日落游船/, '体验行左边是小图，地址转义');
	assert.doesNotMatch(place, /exp\.webp\?"><b>/, '地址里的引号和尖括号不能原样进 HTML');
	assert.equal((place.match(/class="thumb"/g) ?? []).length, 1, '清单里没有的（工作、住处……）不出小图');
	// 体验改造 P1：新角色第一次进成长页有新手便签，这时不放装饰横幅；关掉便签后顶上是横幅
	assert.match(growSlip, /<section class="slip"/);
	assert.doesNotMatch(growSlip, /class="banner"/, '有新手便签时不放横幅');
	assert.ok(grow.startsWith('<div class="banner"><img src="/earth/cgi/banner-grow.webp"'), '成长页顶上是横幅');
	assert.match(assets, /<div class="empty-art"><img src="\/earth\/cgi\/empty-bag\.webp" alt="" loading="lazy" \/><\/div><p>空的。/, '背包空的时候有插图');
	assert.doesNotMatch(assets, /empty-art"><img src="[^"]*estate/, '清单里没有的空状态不占位');
	assert.deepEqual(a11yIssues(place), []);
	assert.deepEqual(a11yIssues(assets), []);
});

test('界面：「我 · 资产」的理财卡（第 25 批）——行情来自服务端、能买入、净值算上持仓、行情种子不进本机存档', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'invest-ui-a', '理财');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.cash = 2000;
	let before = '', after = '';
	const r = await openWithHash('', { cred: a.cred, state: a.state }, world, true, {
		prompt: '500',
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'assets' });
			before = el('panel').innerHTML;
			await click({ asset: 'buy', assetId: 'asx-index' });
			after = el('panel').innerHTML;
		},
	});
	assert.match(before, /<div class="card invest"><h3>理财<\/h3>/, '没有持仓时标题不带金额');
	for (const id of ['savings', 'asx-index', 'gold', 'emu-coin']) assert.match(before, new RegExp(`data-asset="buy" data-asset-id="${id}"`), id);
	assert.match(before, /data-asset="sell" data-asset-id="gold" disabled/, '没有持仓不能卖');
	assert.match(before, /不能兑换真钱/);
	assert.deepEqual(a11yIssues(before), []);
	assert.equal(r.seen.prompts.length, 1, '问了一次金额');
	const saved = (data.get('save:' + a.cred.id) as any).state;
	assert.equal(saved.cash, 1500, '服务端扣了 $500');
	assert.ok(saved.holdings['asx-index'].units > 0, '服务端记下持仓');
	assert.match(after, /<h3>理财 · 持仓 \$4\d\d<\/h3>/, '买入后卡片显示持仓（扣手续费后不到 $500）');
	assert.match(after, /data-asset="sell" data-asset-id="asx-index">卖出/, '有持仓可以卖');
	assert.match(after, / · 理财 \$4\d\d<\/p>/, '资产卡算上理财');
	const local = JSON.parse(r.store.get('earth.save.v1')!);
	assert.equal(local.marketSeed, 0, '本机存档没有行情种子');
	assert.equal(local.seed, 0);
	assert.equal(local.quotes['asx-index'].length >= 1, true, '本机存档带着服务端算好的行情');
});

test('界面：理财下单时点取消不发动作；买鸸鹋币要先确认（第 25 批）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'invest-ui-b', '取消');
	(data.get('save:' + a.cred.id) as any).state.cash = 2000;
	const r = await openWithHash('', { cred: a.cred, state: a.state }, world, false, {
		prompt: '300',
		after: async ({ click }) => {
			await click({ tab: 'me' });
			await click({ metab: 'assets' });
			await click({ asset: 'buy', assetId: 'emu-coin' });
		},
	});
	assert.equal(r.seen.asked.filter((m) => m.includes('鸸鹋币')).length, 1, '买虚拟币前确认');
	assert.equal((data.get('save:' + a.cred.id) as any).state.cash, 2000, '确认时选了取消，没成交');
});

// ---------- 存档与多端同步（第 50 批，见 docs/earth-game/save-sync.md） ----------
const srv = async (world: EarthWorld, body: unknown) => (await world.fetch(new Request('https://game.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }))).json() as Promise<any>;
const waitFor = async (ok: () => boolean, n = 100) => { for (let i = 0; i < n && !ok(); i++) await pause(10); };

test('界面：凭证在、本机缓存坏了（比如新版本页面写的缓存），不显示创建页，自动从云端恢复；离线时等联网再恢复（审查问题 3）', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'cache-bad-a', '缓存坏');
	const ok = await openWithHash('', { cred: a.cred, state: { v: 'x' } }, world);
	assert.equal(ok.el('game').classList.contains('hidden'), false, '恢复后进入游戏');
	assert.deepEqual(JSON.parse(ok.store.get('earth.cred.v1')!), a.cred, '凭证还在');
	assert.equal(JSON.parse(ok.store.get('earth.save.v1')!).id, a.cred.id);
	assert.match(ok.el('toast').textContent, /已从云端恢复/);
	// 缓存是别的角色的：同样以凭证为准
	const other = await openWithHash('', { cred: a.cred, state: { ...a.state, id: 'someone-else' } }, world);
	assert.equal(JSON.parse(other.store.get('earth.save.v1')!).id, a.cred.id);
	// 离线：先显示创建页但不丢凭证；新建前会问；联网后自动恢复
	let offline = true;
	const off = await openWithHash('', { cred: a.cred, state: null }, world, false, {
		reply: async () => { if (offline) throw new TypeError('offline'); return undefined; },
		after: async ({ win, el }) => {
			assert.equal(el('game').classList.contains('hidden'), true);
			assert.match(el('toast').textContent, /联网后会自动从云端恢复/);
			el('c-start').ls.click({});
			await pause(20);
			offline = false;
			win.online?.({});
			await waitFor(() => !el('game').classList.contains('hidden'));
			assert.equal(el('game').classList.contains('hidden'), false, '联网后恢复');
			await pause(200); // 恢复后页面接着拉留言等，等它们落地再收尾
		},
	});
	assert.match(off.seen.asked[0] ?? '', /还保存着一个角色的同步码/, '新建前先问');
	assert.deepEqual(JSON.parse(off.store.get('earth.cred.v1')!), a.cred, '不同意就不覆盖凭证');
});

test('界面：删除本机存档时排队的动作一起清掉，之后用同一个码恢复不会悄悄补交（审查问题 4）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'reset-queue-a', '清队列');
	const queued = { 'earth.queue.v1': JSON.stringify({ id: a.cred.id, items: [{ act: { t: 'activity', id: 'rest' }, at: Date.now(), label: '休息', op: 'resetq000000001' }] }) };
	const r = await openWithHash('', a, world, true, {
		extra: queued,
		reply: async (body) => { if (body.action === 'act') throw new TypeError('offline'); return undefined; },
		after: async ({ click }) => { await click({ reset: '' }); },
	});
	assert.equal(r.seen.reloads, 1);
	for (const k of ['earth.queue.v1', 'earth.cred.v1', 'earth.save.v1', 'earth.cred.next.v1']) assert.equal(r.store.get(k), undefined, `${k} 已清`);
	assert.equal((data.get('save:' + a.cred.id) as any).state.rev, a.state.rev);
});

test('界面：补交途中另一台设备动过存档，冲突的那个按最新进度重交，后面的照常补交，不会全部取消（审查问题 6）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'flush-conflict-a', '冲突甲');
	const item = (op: string) => ({ act: { t: 'activity', id: 'rest' }, at: Date.now(), label: '休息', op });
	const queued = { 'earth.queue.v1': JSON.stringify({ id: a.cred.id, items: [item('flushc000000001'), item('flushc000000002')] }) };
	let other = 0;
	const rev = () => (data.get('save:' + a.cred.id) as any).state.rev;
	const r = await openWithHash('', a, world, true, {
		extra: queued,
		reply: async (body) => {
			// 页面交第一个排队动作之前，另一台设备抢先做了一件事
			if (body.action === 'act' && other === 0) { other++; const g = await srv(world, { action: 'act', ...a.cred, rev: rev(), act: { t: 'activity', id: 'rest' } }); assert.ok(g.ok, g.msg); }
			return undefined;
		},
		after: async ({ el }) => { await waitFor(() => /补交了/.test(el('toast').textContent)); },
	});
	assert.equal(rev(), a.state.rev + 3, '另一台设备 1 个 + 补交 2 个');
	assert.match(r.el('toast').textContent, /补交了 2 个排队的动作/);
	assert.match(r.el('toast').textContent, /另一台设备也有操作/);
	assert.equal(JSON.parse(r.store.get('earth.queue.v1')!).items.length, 0);
});

test('界面：更换同步码——本机改用新码、旧码立即失效、二维码收起；回复丢了联网后自动补完（审查问题 7）', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'ui-rekey-a', '换码甲');
	const r = await openWithHash('', a, world, true, { after: async ({ click }) => { await click({ tab: 'me' }); await click({ metab: 'sync' }); await click({ rekey: '' }); } });
	const now = JSON.parse(r.store.get('earth.cred.v1')!);
	assert.equal(now.id, a.cred.id);
	assert.notEqual(now.key, a.cred.key);
	assert.equal((await srv(world, { action: 'get', ...a.cred })).badKey, true, '旧码失效');
	assert.ok((await srv(world, { action: 'get', ...now })).ok);
	assert.ok(r.el('panel').innerHTML.includes(now.key), '面板显示新码');
	assert.ok(!r.el('panel').innerHTML.includes(a.cred.key));
	assert.equal(r.store.get('earth.cred.next.v1'), undefined);
	// 回复丢了：本机记着新码，联网后补完
	const b = await makeChar(world, 'ui-rekey-b', '换码乙');
	let dropped = 0;
	const lost = await openWithHash('', b, world, true, {
		reply: async (body, res) => { if (body.action === 'rekey' && !dropped) { dropped++; await res(); throw new TypeError('connection reset'); } return undefined; },
		after: async ({ click, win, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			await click({ rekey: '' });
			assert.match(el('toast').textContent, /联网后会自动把更换做完/);
			win.online?.({});
			await pause(60);
		},
	});
	const next = JSON.parse(lost.store.get('earth.cred.v1')!);
	assert.notEqual(next.key, b.cred.key, '补完后用上新码');
	assert.ok((await srv(world, { action: 'get', ...next })).ok);
	assert.equal(lost.store.get('earth.cred.next.v1'), undefined);
});

test('界面：同步码在另一台设备换过——这台不再发动作、排队留着；输入新码后接着玩并补交（审查问题 7）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'ui-badkey-a', '失效甲');
	const newKey = 'q'.repeat(24);
	assert.ok((await srv(world, { action: 'rekey', ...a.cred, newKey })).ok);
	const queued = { 'earth.queue.v1': JSON.stringify({ id: a.cred.id, items: [{ act: { t: 'activity', id: 'rest' }, at: Date.now(), label: '休息', op: 'badkey000000001' }] }) };
	const rev = () => (data.get('save:' + a.cred.id) as any).state.rev;
	const sent: string[] = [];
	const r = await openWithHash('', a, world, true, {
		extra: queued,
		reply: async (body) => { sent.push(body.action); return undefined; },
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			assert.match(el('panel').innerHTML, /同步码已失效/);
			assert.match(el('panel').innerHTML, /id="s-code"/);
			assert.equal(rev(), a.state.rev, '排队的没交出去');
			await click({ tab: 'place' });
			const act = el('panel').innerHTML.match(/data-act="([^"]+)"/)?.[1];
			if (act) { const before = sent.length; await click({ act }); assert.equal(sent.slice(before).filter((x) => x === 'act').length, 0, '失效时不发动作'); }
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			el('s-code').value = `${a.cred.id}.${newKey}`;
			await click({ recode: '' });
			await waitFor(() => rev() === a.state.rev + 1);
		},
	});
	assert.deepEqual(JSON.parse(r.store.get('earth.cred.v1')!), { id: a.cred.id, key: newKey });
	assert.equal(rev(), a.state.rev + 1, '输入新码后排队的补交了');
	assert.doesNotMatch(r.el('panel').innerHTML, /同步码已失效/);
});

test('界面：删除账号——问两次，服务器删掉后清空本机、重新载入；导出不带同步码（审查问题 8）', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'ui-delete-a', '删号甲');
	const bodies: any[] = [];
	const r = await openWithHash('', a, world, true, {
		reply: async (body, res) => {
			bodies.push(body);
			if (body.action !== 'export') return undefined;
			const j = (await (await res()).json()) as any;
			assert.ok(j.ok);
			assert.ok(!JSON.stringify(j).includes(a.cred.key));
			return new Response(JSON.stringify(j));
		},
		after: async ({ click }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			await click({ export: '' });
			await click({ delacct: '' });
		},
	});
	assert.ok(bodies.some((b) => b.action === 'export'), '导出请求发了');
	assert.equal(r.seen.asked.length, 2, '确认两次');
	assert.equal(r.seen.reloads, 1);
	assert.ok(!data.has('save:' + a.cred.id), '服务器上删了');
	assert.equal(r.store.get('earth.cred.v1'), undefined);
	assert.equal(r.store.get('earth.save.v1'), undefined);
	// 不同意就什么都不删
	const b = await makeChar(world, 'ui-delete-b', '删号乙');
	const no = await openWithHash('', b, world, false, { after: async ({ click }) => { await click({ tab: 'me' }); await click({ metab: 'sync' }); await click({ delacct: '' }); } });
	assert.ok(data.has('save:' + b.cred.id));
	assert.equal(no.seen.reloads, 0);
});

test('界面：留言列表拉取失败（限流、同步码失效、断网）时不会立刻再拉，变成请求死循环（第 50 批审查问题 10）', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'notes-loop-a', '留言环');
	let notes = 0;
	await openWithHash('', a, world, true, {
		reply: async (body) => {
			if (body.action !== 'notes') return undefined;
			notes++;
			await pause(1);
			return new Response(JSON.stringify({ ok: false, msg: '操作太频繁' }), { status: 429 });
		},
		// 体验改造 P1：留言板在「地点」抽屉里，打开抽屉才拉
		after: async ({ click }) => { await click({ tab: 'place' }); await click({ drawer: 'place' }); await pause(300); },
	});
	assert.ok(notes >= 1 && notes <= 3, `留言列表请求了 ${notes} 次`);
});

test('界面：体验改造 P1——今天页分三层，第 1 天不超过 6 张卡；商店、做事等收进底部抽屉，抽屉能开能关', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'ux-p1-a', '三层');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'perth';
	rec.state.cash = 500;
	data.set('save:' + a.cred.id, rec);
	let place = '', shop = '', shopOpen = false, closed = false, bogus = false, tabClosed = false;
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			place = el('panel').innerHTML;
			await click({ drawer: 'shop' });
			shop = el('modal').innerHTML;
			shopOpen = !el('modal').classList.contains('hidden');
			await click({ drawerClose: '' });
			closed = el('modal').classList.contains('hidden');
			await click({ drawer: 'constructor' });
			bogus = el('modal').classList.contains('hidden');
			await click({ drawer: 'do' });
			await click({ tab: 'go' });
			tabClosed = el('modal').classList.contains('hidden');
		},
	});
	const cards = (place.match(/class="card[ "]/g) ?? []).length;
	assert.ok(cards <= 6, `第 1 天今天页 ${cards} 张卡，门槛 6 张`);
	assert.doesNotMatch(place, /data-buy=/, '商品不摊在今天页上');
	assert.match(place, /<button class="row here-row" data-drawer="shop" aria-haspopup="dialog">/, '「买东西」是一行摘要');
	assert.match(place, /data-drawer="do"[^>]*>[\s\S]*?现在能做 \d+ 项/, '「做事」摘要写明现在能做几项');
	const at = (x: string) => place.indexOf(x);
	assert.ok(at('<h3>状态</h3>') >= 0 && at('<h3>状态</h3>') < at('class="next"') && at('class="next"') < at('class="card here"') && at('class="card here"') < at('class="later-zone"'), '现在 → 在这里 → 以后');
	assert.ok(shopOpen, '点摘要行打开抽屉');
	assert.match(shop, /<div class="sheet drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">/);
	assert.match(shop, /<h2 id="drawer-title"><svg class="lu drawer-ico" aria-hidden="true" focusable="false"><use href="#lu-shopping-bag"\/><\/svg> 买东西<\/h2>/, '抽屉标题用 Lucide 图标（P2）');
	assert.match(shop, /data-buy="/, '抽屉里是完整的商品列表');
	assert.ok(closed, '点「关闭」收起');
	assert.ok(bogus, '不认识的抽屉名不打开（原型链上的名字也不行）');
	assert.ok(tabClosed, '切到别的标签时抽屉收起');
	assert.deepEqual(a11yIssues(place), []);
	assert.deepEqual(a11yIssues(shop), []);
});

test('界面：体验改造 P1——做成一件事，变了的需求环飘出变化值、顶栏钱数也飘；在「做事」抽屉里做完自动收起，商店里买完不收', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'ux-p1-b', '反馈');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'perth';
	rec.state.cash = 500;
	rec.state.needs.hunger = 30;
	data.set('save:' + a.cred.id, rec);
	let panel = '', hud = '', doOpen = false, afterAct = false, shopHtml = '', afterBuy = '', buyOpen = false;
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			await click({ drawer: 'do' });
			doOpen = !el('modal').classList.contains('hidden');
			await click({ act: 'eat' });
			await pause(80);
			panel = el('panel').innerHTML;
			hud = el('hud').innerHTML;
			afterAct = el('modal').classList.contains('hidden');
			await click({ drawer: 'shop' });
			shopHtml = el('modal').innerHTML;
			const item = shopHtml.match(/<button class="row" data-buy="([^"]+)" >/)?.[1];
			assert.ok(item, '商店里有能买的东西');
			await click({ buy: item! });
			await pause(80);
			afterBuy = el('hud').innerHTML;
			buyOpen = !el('modal').classList.contains('hidden') && el('modal').innerHTML.includes('drawer-title');
		},
	});
	assert.ok(doOpen);
	assert.match(panel, /<div class="ring [^"]*bump" role="img" aria-label="饱食 \d+，刚才加了 \d+/, '饱食环跳一下，读屏念出变化');
	assert.match(panel, /<i class="ring-delta up" aria-hidden="true">\+\d+<\/i><b data-from="30">/, '饱食环飘出 +N，数字从 30 滚到新值');
	assert.match(panel, /<div class="result-strip">/, '状态环下面有「刚才」');
	assert.match(hud, /<span class="chip cash bump">\$\d+<i class="cash-delta down" aria-hidden="true">−\$\d+<\/i><\/span>/, '花了钱，顶栏钱数飘出 −$N');
	assert.ok(afterAct, '在「做事」抽屉里做完自动收起，看得到环的变化');
	assert.match(afterBuy, /class="cash-delta down"/);
	assert.ok(buyOpen, '商店里买完抽屉留着，可以接着买');
});

test('界面：体验改造 P1——「地点」抽屉关着时不拉留言板（留言到了要重画，会冲掉刚出现的环和钱数动画），打开才拉', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'ux-p1-c', '留言关');
	let notes = 0, afterOpen = 0;
	await openWithHash('', a, world, true, {
		reply: async (body) => {
			if (body.action !== 'notes') return undefined;
			notes++;
			return new Response(JSON.stringify({ ok: true, notes: [], at: Date.now() }));
		},
		after: async ({ click }) => {
			await click({ tab: 'place' });
			await pause(200);
			await click({ tab: 'go' });
			await click({ tab: 'place' });
			await pause(200);
			afterOpen = notes;
			await click({ drawer: 'place' });
			await pause(200);
		},
	});
	assert.equal(afterOpen, 0, '「地点」抽屉没打开时一次都不拉');
	assert.ok(notes >= 1, '打开「地点」抽屉才拉留言');
});

// 体验改造 P3：画面设置三档（docs/earth-game/ux-p3.md）
let heroSeq = 0;
async function heroUnder(prefs: Record<string, unknown> | null, saveData?: boolean) {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'p3-hero-' + ++heroSeq, '画面');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'perth';
	data.set('save:' + a.cred.id, rec);
	let html = '';
	const r = await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		extra: prefs ? { 'earth.prefs.v1': JSON.stringify(prefs) } : {},
		saveData,
		media: { loc: { perth: { src: '/earth/media/loc/perth.mp4', poster: '/earth/cgi/perth.webp' } }, voice: {} },
		cgi: { perth: '/earth/cgi/perth.webp', 'banner:grow': '/earth/cgi/banner-grow.webp' },
		after: async ({ click, el }) => {
			await click({ tab: 'place' });
			html = await withDrawers(click, el);
		},
	});
	return { html, root: r.root, fetched: r.seen.fetched };
}

test('界面：画面设置（P3）——标准档放地点短片；省电档只放静态高清图；省流量档放 1 倍小图，不出 <video>（不发视频请求）', async () => {
	const std = await heroUnder({ visual: 'standard' });
	assert.match(std.html, /<video class="loc-clip" src="\/earth\/media\/loc\/perth\.mp4"/, '标准档放短片');
	assert.equal(std.root.contains('calm'), false, '标准档不减少动画');

	const bat = await heroUnder({ visual: 'battery' });
	assert.doesNotMatch(bat.html, /<video|\/earth\/media\/loc\//, '省电档不出短片');
	assert.match(bat.html, /<div class="hero has-media"><img src="\/earth\/cgi\/perth\.webp"/, '省电档还是高清图');
	assert.equal(bat.root.contains('calm'), true, '省电档动画从简');

	const dat = await heroUnder({ visual: 'data' });
	assert.doesNotMatch(dat.html, /<video|\/earth\/media\/loc\//, '省流量档不出短片');
	assert.match(dat.html, /<div class="hero has-media"><img src="\/earth\/cgi\/1x\/perth\.webp"/, '省流量档换 1 倍图');
	assert.doesNotMatch(dat.html, /src="\/earth\/cgi\/(?!1x\/)/, '省流量档页面上没有一张 2 倍图');
	assert.deepEqual(dat.fetched.filter((u) => /openfreemap|maplibre|\.pbf|\/earth\/media\/loc\//.test(u)), [], '省流量档没有底图、短片请求');
	assert.ok(dat.fetched.includes('/earth/cgi/manifest.json'), '（对照）请求确实被记下了');
	assert.equal(dat.root.contains('calm'), true);

	// 动画明确设成「正常」：听玩家的，省电档也不减少动画；但短片照样不放
	const full = await heroUnder({ visual: 'battery', motion: 'full' });
	assert.equal(full.root.contains('calm'), false, '动画设成「正常」时不被画面档覆盖');
	assert.doesNotMatch(full.html, /<video/);
});

test('界面：画面设置（P3）——默认「跟随系统」：系统开了省流量就按省流量档；没开就按标准档', async () => {
	const sys = await heroUnder(null, true);
	assert.match(sys.html, /<img src="\/earth\/cgi\/1x\/perth\.webp"/, '系统省流量 → 1 倍图');
	assert.doesNotMatch(sys.html, /<video/, '系统省流量 → 不放短片');
	const plain = await heroUnder(null, false);
	assert.match(plain.html, /<video class="loc-clip"/, '系统没开省流量 → 标准档');
	// 玩家手动选了标准档：系统省流量也不改
	const pinned = await heroUnder({ visual: 'standard' }, true);
	assert.match(pinned.html, /<video class="loc-clip"/, '手动选的档位优先');
});

test('界面：画面设置（P3）——设置页四个选项、说明跟着档位换；暂停了的环境音、真实地图在开关旁边写明；不认识的值不改', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'p3-settings', '设置');
	let before = '', after = '';
	const r = await openWithHash('', a, world, true, {
		extra: { 'earth.prefs.v1': JSON.stringify({ ambience: true }) },
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			before = el('panel').innerHTML;
			await click({ pref: 'visual', val: 'data' });
			after = el('panel').innerHTML;
			await click({ pref: 'visual', val: 'ultra' });
		},
	});
	for (const v of ['auto', 'standard', 'battery', 'data']) assert.match(before, new RegExp(`data-pref="visual" data-val="${v}"`), v);
	assert.match(before, /data-pref="visual" data-val="auto" class="on" aria-pressed="true">跟随系统/, '默认跟随系统');
	assert.match(before, /短片自动播放、真实地图、全部动画、高清配图。/, '没有系统信号时按标准档说明');
	assert.doesNotMatch(before, /档下暂停/, '标准档什么都不暂停');
	assert.match(after, /data-pref="visual" data-val="data" class="on" aria-pressed="true">省流量/);
	assert.match(after, /不放短片、不下真实地图/);
	assert.match(after, /环境音[\s\S]*?（「省流量」档下暂停）[\s\S]*?data-pref="ambience" aria-pressed="true"/, '环境音开关保持打开，旁边写明暂停');
	assert.match(after, /真实地图<small>[^<]*（「省流量」档下暂停）/, '真实地图写明暂停');
	assert.equal(JSON.parse(r.store.get('earth.prefs.v1')!).visual, 'data', '存进本机，不认识的值不改');
	assert.deepEqual(a11yIssues(after), []);
});

test('界面：画面设置（P3）——省电档不放环境音和音乐，开关不动；换回标准档马上放', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'p3-audio', '省电');
	const { Ctx, log } = fakeWebAudio();
	const r = await openWithHash('', a, world, true, {
		audio: Ctx,
		extra: { 'earth.prefs.v1': JSON.stringify({ ambience: true, music: true, visual: 'battery' }) },
		after: async ({ click }) => {
			await click({ tab: 'me' });
			for (let i = 0; i < 10; i++) await pause(10);
			assert.equal(log.srcStarted, 0, '省电档：环境音不放');
			assert.ok(!log.oscs.some((f) => f > 80 && f < 1200), '省电档：音乐不放');
			await click({ metab: 'sync' });
			await click({ pref: 'visual', val: 'standard' });
			for (let i = 0; i < 20 && log.srcStarted === 0; i++) await pause(10);
			assert.ok(log.srcStarted >= 1, '换回标准档：环境音开始放');
		},
	});
	const saved = JSON.parse(r.store.get('earth.prefs.v1')!);
	assert.equal(saved.ambience, true, '画面档不改环境音开关');
	assert.equal(saved.music, true);
});

test('界面：画面设置（P3 复核）——玩的时候系统打开省流量：「跟随系统」马上换到省流量档，重画当前页', async () => {
	const { data, world } = makeWorld();
	const a = await makeChar(world, 'p3-follow', '跟随');
	const rec = data.get('save:' + a.cred.id) as any;
	rec.state.loc = 'perth';
	data.set('save:' + a.cred.id, rec);
	let before = '', after = '', calmAfter = false;
	await openWithHash('', { cred: a.cred, state: rec.state }, world, true, {
		saveData: false,
		media: { loc: { perth: { src: '/earth/media/loc/perth.mp4' } }, voice: {} },
		cgi: { perth: '/earth/cgi/perth.webp' },
		after: async ({ click, el }) => {
			await click({ drawer: 'place' });
			before = el('modal').innerHTML;
			const c = (globalThis as any).navigator.connection;
			assert.equal(typeof c.change, 'function', '页面注册了省流量变化的回调');
			c.saveData = true;
			c.change();
			await pause(30);
			after = el('modal').innerHTML + el('panel').innerHTML;
			calmAfter = (globalThis as any).document.documentElement.classList.contains('calm');
		},
	});
	assert.match(before, /<video class="loc-clip"/, '开始是标准档');
	assert.doesNotMatch(after, /<video/, '换档后不放短片');
	assert.match(after, /\/earth\/cgi\/1x\/perth\.webp/, '换档后用 1 倍图');
	assert.equal(calmAfter, true, '换档后动画从简');
});

test('界面：画面设置（P3 复核）——从标准换到省电：正在放的环境音停下', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'p3-audio-down', '降档');
	const { Ctx, log } = fakeWebAudio();
	await openWithHash('', a, world, true, {
		audio: Ctx,
		extra: { 'earth.prefs.v1': JSON.stringify({ ambience: true, visual: 'standard' }) },
		after: async ({ click }) => {
			await click({ tab: 'me' });
			for (let i = 0; i < 20 && log.srcStarted === 0; i++) await pause(10);
			assert.ok(log.srcStarted >= 1, '标准档在放环境音');
			await click({ metab: 'sync' });
			await click({ pref: 'visual', val: 'battery' });
			for (let i = 0; i < 20 && log.srcStopped < log.srcStarted; i++) await pause(10);
			assert.equal(log.srcStopped, log.srcStarted, '换到省电档后环境音全停');
		},
	});
});

test('界面：画面设置（P3 复核）——跟随系统并且系统开了省流量：说明开头写原因和档名', async () => {
	const { world } = makeWorld();
	const a = await makeChar(world, 'p3-why', '原因');
	let html = '';
	await openWithHash('', a, world, true, {
		saveData: true,
		after: async ({ click, el }) => {
			await click({ tab: 'me' });
			await click({ metab: 'sync' });
			html = el('panel').innerHTML;
		},
	});
	assert.match(html, /data-pref="visual" data-val="auto" class="on" aria-pressed="true">跟随系统/);
	assert.match(html, /<p class="muted" style="margin-top:4px">系统开了省流量，按「省流量」：不放短片、不下真实地图/, '写明按哪一档、为什么');
});
