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
				async put(r: string | { url: string }, res: Res) { m.set(key(r), res); },
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
	const fire = async (type: string, extra: Record<string, unknown> = {}) => {
		const waits: Promise<unknown>[] = [];
		let responded: Promise<Res> | null = null;
		listeners[type]({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Res>) => (responded = p) });
		const res = responded ? await (responded as Promise<Res>).then((r) => r, (e: Error) => 'ERR:' + e.message) : null;
		await Promise.all(waits);
		return res as Res | string | null;
	};
	const req = (path: string, o: { method?: string; mode?: string } = {}) => ({ url: ORIGIN + path, method: o.method ?? 'GET', mode: o.mode ?? 'cors' });
	const cached = () => [...(stores.get('earth-shell-v2')?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
	return { stores, net, fire, req, cached };
}

const page = (js: string, css: string) => `<html><link rel="stylesheet" href="/_astro/${css}"><script type="module" src="/_astro/${js}"></script></html>`;

test('离线外壳：安装时预缓存页面和它引用的构建文件；断网能打开；不碰 /api/ 和 POST', async () => {
	const t = setup();
	t.net.files.set('/earth/', page('a1.js', 'a1.css'));
	for (const f of ['/_astro/a1.js', '/_astro/a1.css', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg']) t.net.files.set(f, 'x');
	t.stores.set('earth-shell-v1', new Map()); // 旧版本的缓存
	await t.fire('install');
	assert.deepEqual(t.cached(), ['/_astro/a1.css', '/_astro/a1.js', '/earth/', '/earth/icon-192.png', '/earth/icon.svg', '/earth/manifest.webmanifest']);
	await t.fire('activate');
	assert.equal(t.stores.has('earth-shell-v1'), false, '旧版本缓存被删除');
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
