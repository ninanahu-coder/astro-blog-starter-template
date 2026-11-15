// 地球人生的离线外壳（Service Worker，作用域 /earth/）。
// 只缓存页面和静态资源，让断网时也能打开、查看本机缓存的存档；
// 游戏动作和存档接口（/api/）一律直连服务器，从不缓存。
const VERSION = 'earth-shell-v1';
const SHELL = ['/earth/', '/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg'];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith('earth-shell-') && k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

async function networkFirst(req, fallbackKey) {
	const cache = await caches.open(VERSION);
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(fallbackKey ?? req, res.clone());
		return res;
	} catch (e) {
		const hit = await cache.match(fallbackKey ?? req);
		if (hit) return hit;
		throw e;
	}
}

async function cacheFirst(req) {
	const cache = await caches.open(VERSION);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok) cache.put(req, res.clone());
	return res;
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
	// 页面：先联网（拿到最新版本），断网时用上次缓存的页面
	if (req.mode === 'navigate' && url.pathname.startsWith('/earth')) {
		event.respondWith(networkFirst(req, '/earth/'));
		return;
	}
	// 构建产物文件名带内容哈希，内容不会变：先用缓存
	if (url.pathname.startsWith('/_astro/')) {
		event.respondWith(cacheFirst(req));
		return;
	}
	// /earth/ 下的其他静态文件（图标、图片清单、CGI）：先联网，断网用缓存
	if (url.pathname.startsWith('/earth/') && !url.pathname.endsWith('/sw.js')) {
		event.respondWith(networkFirst(req));
	}
});
