// 离线外壳（public/earth/sw.js）的回归测试：在 vm 里模拟 Service Worker 环境（缓存、网络、事件）运行真实脚本。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://game.test';
const SW = readFileSync(new URL('../../public/earth/sw.js', import.meta.url), 'utf8');

class Res {
	body: string;
	ok: boolean;
	constructor(body: string, ok = true) { this.body = body; this.ok = ok; }
	clone() { return new Res(this.body, this.ok); }
	async text() { return this.body; }
}

function setup() {
	const stores = new Map<string, Map<string, Res>>();
	const net = { online: true, log: [] as string[], files: new Map<string, string>() };
	const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
	const fetch = async (r: string | { url: string }) => {
		const u = key(r);
		net.log.push(new URL(u).pathname);
		if (!net.online) throw new TypeError('offline');
		const body = net.files.get(new URL(u).pathname);
		return body === undefined ? new Res('not found', false) : new Res(body);
	};
	const caches = {
		async open(name: string) {
			if (!stores.has(name)) stores.set(name, new Map());
			const m = stores.get(name)!;
			return {
				async addAll(list: string[]) {
					const got = await Promise.all(list.map((u) => fetch(u)));
					if (got.some((r) => !r.ok)) throw new TypeError('addAll failed');
					list.forEach((u, i) => m.set(key(u), got[i]));
				},
				// 写入要过一会儿才生效：不交给 waitUntil 的写入，fire() 返回时还看不到
				async put(r: string | { url: string }, res: Res) { await new Promise((ok) => setTimeout(ok, 5)); m.set(key(r), res); },
				async match(r: string | { url: string }) { return m.get(key(r)); },
				async keys() { return [...m.keys()].map((url) => ({ url })); },
				async delete(r: { url: string }) { return m.delete(key(r)); },
			};
		},
		async keys() { return [...stores.keys()]; },
		async delete(k: string) { return stores.delete(k); },
	};
	const listeners: Record<string, (e: any) => void> = {};
	const self = { location: { origin: ORIGIN }, addEventListener: (t: string, f: (e: any) => void) => (listeners[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } };
	vm.runInNewContext(SW, { self, caches, fetch, URL, Promise, Set, Error, TypeError });
	// 模拟浏览器：响应给出后只等 waitUntil 托管的任务，其余的后台工作在 worker 被回收时丢失
	const fire = async (type: string, extra: Record<string, unknown> = {}) => {
		const waits: Promise<unknown>[] = [];
		let responded: Promise<Res> | null = null;
		listeners[type]({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Res>) => (responded = p) });
		const res = responded ? await (responded as Promise<Res>).then((r) => r, (e: Error) => 'ERR:' + e.message) : null;
		await Promise.all(waits);
		return res as Res | string | null;
	};
	/** 只等响应、不等 waitUntil：用来确认缓存写入确实交给了 waitUntil */
	const fireNoWait = async (type: string, extra: Record<string, unknown> = {}) => {
		const waits: Promise<unknown>[] = [];
		let responded: Promise<Res> | null = null;
		listeners[type]({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Res>) => (responded = p) });
		const res = responded ? await (responded as Promise<Res>) : null;
		return { res, waits };
	};
	const req = (path: string, o: { method?: string; mode?: string } = {}) => ({ url: ORIGIN + path, method: o.method ?? 'GET', mode: o.mode ?? 'cors' });
	const cached = () => [...(stores.get('earth-shell-v3')?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
	return { stores, net, fire, fireNoWait, req, cached };
}

const page = (js: string, css: string) => `<html><link rel="stylesheet" href="/_astro/${css}"><script type="module" src="/_astro/${js}"></script></html>`;

test('离线外壳：安装时预缓存页面和它引用的构建文件；断网能打开；不碰 /api/ 和 POST', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('a1.js', 'a1.css'));
	for (const f of ['/_astro/a1.js', '/_astro/a1.css', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	t.stores.set('earth-shell-v2', new Map()); // 旧版本的缓存
	await t.fire('install');
	assert.deepEqual(t.cached(), ['/_astro/a1.css', '/_astro/a1.js', '/earth/', '/earth/icon-192.png', '/earth/icon.svg', '/earth/manifest.webmanifest']);
	await t.fire('activate');
	assert.equal(t.stores.has('earth-shell-v2'), false, '旧版本缓存被删除');
	// 不拦截：接口、POST、其他域名
	assert.equal(await t.fire('fetch', { request: t.req('/api/earth/save') }), null);
	assert.equal(await t.fire('fetch', { request: t.req('/earth/', { method: 'POST' }) }), null);
	assert.equal(await t.fire('fetch', { request: { url: 'https://cdn.other/x.js', method: 'GET', mode: 'cors' } }), null);
	// 断网：页面和构建文件都从缓存来
	t.net.online = false;
	const nav = await t.fire('fetch', { request: t.req('/earth/?from=home', { mode: 'navigate' }) });
	assert.ok(nav instanceof Res && nav.body.includes('a1.js'));
	const js = await t.fire('fetch', { request: t.req('/_astro/a1.js') });
	assert.ok(js instanceof Res && js.ok);
	assert.match(String(await t.fire('fetch', { request: t.req('/earth/cgi/none.png') })), /^ERR:/, '没缓存过的文件断网时照常失败');
});

test('离线外壳：页面引用的文件缺一个就不算装好', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('b1.js', 'b1.css'));
	for (const f of ['/_astro/b1.js', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	const r = t.fire('install');
	await assert.rejects(r);
});

test('离线外壳：部署新版本后联网打开，补齐新构建文件、删掉旧的', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('v1.js', 'v1.css'));
	for (const f of ['/_astro/v1.js', '/_astro/v1.css', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	await t.fire('install');
	await t.fire('activate');
	// 新部署：页面换成引用 v2 文件
	t.net.files.set('/earth/', page('v2.js', 'v2.css'));
	t.net.files.set('/_astro/v2.js', 'x');
	t.net.files.set('/_astro/v2.css', 'x');
	const nav = await t.fire('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.ok(nav instanceof Res && nav.body.includes('v2.js'), '联网时拿到新页面');
	const assets = t.cached().filter((p) => p.startsWith('/_astro/'));
	assert.deepEqual(assets, ['/_astro/v2.css', '/_astro/v2.js'], '旧构建文件被清掉，新的已缓存');
	// 断网再打开：新页面和新文件都在
	t.net.online = false;
	const off = await t.fire('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.ok(off instanceof Res && off.body.includes('v2.js'));
	assert.ok((await t.fire('fetch', { request: t.req('/_astro/v2.js') })) instanceof Res);
});

test('离线外壳：以页面方式打开图标等文件不会把外壳换掉；缓存写入都交给 waitUntil', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('c1.js', 'c1.css'));
	for (const f of ['/_astro/c1.js', '/_astro/c1.css', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	await t.fire('install');
	await t.fire('activate');
	// 直接打开图标（导航请求）
	t.net.files.set('/earth/icon.svg', '<svg/>');
	const icon = await t.fire('fetch', { request: t.req('/earth/icon.svg', { mode: 'navigate' }) });
	assert.ok(icon instanceof Res && icon.body === '<svg/>');
	t.net.online = false;
	const off = await t.fire('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.ok(off instanceof Res && off.body.includes('c1.js'), '外壳仍是游戏首页');
	assert.deepEqual(t.cached().filter((p) => p.startsWith('/_astro/')), ['/_astro/c1.css', '/_astro/c1.js'], '构建文件没被清掉');
	// 联网打开首页：响应先回来，缓存更新在 waitUntil 里完成
	t.net.online = true;
	t.net.files.set('/earth/', page('c2.js', 'c2.css'));
	t.net.files.set('/_astro/c2.js', 'x');
	t.net.files.set('/_astro/c2.css', 'x');
	const { res, waits } = await t.fireNoWait('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.ok(res instanceof Res && res.body.includes('c2.js'));
	assert.ok(waits.length > 0, '缓存更新交给了 waitUntil');
	await Promise.all(waits);
	assert.deepEqual(t.cached().filter((p) => p.startsWith('/_astro/')), ['/_astro/c2.css', '/_astro/c2.js']);
});

test('离线外壳：没有新部署时，按需下载的分块（真实地点、地图库、更新日志）不会每次打开都被清掉（第 41 批）', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('d1.js', 'd1.css'));
	for (const f of ['/_astro/d1.js', '/_astro/d1.css', '/_astro/lazy.js', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	await t.fire('install');
	await t.fire('activate');
	// 页面运行时动态加载一个分块：经过外壳时被缓存下来
	assert.ok((await t.fire('fetch', { request: t.req('/_astro/lazy.js') })) instanceof Res);
	assert.ok(t.cached().includes('/_astro/lazy.js'));
	// 同一个版本再联网打开：分块还在，不用重新下载
	await t.fire('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.ok(t.cached().includes('/_astro/lazy.js'), '没有新部署，按需分块保留');
	t.net.log.length = 0;
	await t.fire('fetch', { request: t.req('/_astro/lazy.js') });
	assert.ok(!t.net.log.includes('/_astro/lazy.js'), '直接用缓存');
	// 新部署（页面引用的文件变了）：旧的按需分块照常清掉，缓存不会无限增长
	t.net.files.set('/earth/', page('d2.js', 'd2.css'));
	t.net.files.set('/_astro/d2.js', 'x');
	t.net.files.set('/_astro/d2.css', 'x');
	await t.fire('fetch', { request: t.req('/earth/', { mode: 'navigate' }) });
	assert.deepEqual(t.cached().filter((p) => p.startsWith('/_astro/')), ['/_astro/d2.css', '/_astro/d2.js']);
});
