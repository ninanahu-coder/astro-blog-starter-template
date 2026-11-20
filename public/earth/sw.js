// 地球人生的离线外壳（Service Worker，作用域 /earth/）。
// 只缓存页面和静态资源，让断网时也能打开、查看本机缓存的存档；
// 游戏动作和存档接口（/api/）一律直连服务器，从不缓存。
//
// 页面引用的构建文件（/_astro/ 下，文件名带内容哈希）从页面 HTML 里现场解析：
// 安装时连同页面一起预缓存，全部成功才算装好；之后每次联网打开页面都按最新 HTML 补齐，
// 并删掉新页面不再引用的旧构建文件，缓存不会随部署无限增长。
const VERSION = 'earth-shell-v3';
const PAGE = '/earth/';
const STATIC = ['/earth/manifest.webmanifest', '/earth/icon-192.png', '/earth/icon.svg'];

/** 页面 HTML 里引用的同源构建文件 */
function assetsOf(html) {
	return [...new Set(html.match(/\/_astro\/[^"'\s)>]+/g) ?? [])];
}

/** 按这份 HTML 更新缓存：存页面、补齐它引用的构建文件、删掉不再引用的旧构建文件 */
async function refreshFrom(cache, html, pageRes) {
	const assets = assetsOf(html);
	const old = await cache.match(PAGE);
	const before = old ? assetsOf(await old.text()) : null;
	const missing = [];
	for (const a of assets) if (!(await cache.match(a))) missing.push(a);
	await cache.addAll(missing);
	await cache.put(PAGE, pageRes);
	// 页面引用的构建文件和上次一样（没有新部署）就不清理（第 41 批，性能）：按需下载的分块（真实地点、地图库、
	// 更新日志）不写在页面里，以前每次联网打开都会被当成旧文件删掉，下次又得重新下载
	if (before && before.length === assets.length && before.every((a) => assets.includes(a))) return;
	const keep = new Set(assets.map((a) => new URL(a, self.location.origin).pathname));
	for (const req of await cache.keys()) {
		const path = new URL(req.url).pathname;
		if (path.startsWith('/_astro/') && !keep.has(path)) await cache.delete(req);
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil((async () => {
		const cache = await caches.open(VERSION);
		const res = await fetch(PAGE, { cache: 'reload' });
		if (!res.ok) throw new Error('page ' + res.status);
		await cache.addAll(STATIC);
		await refreshFrom(cache, await res.clone().text(), res);
		await self.skipWaiting();
	})());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const k of await caches.keys()) if (k.startsWith('earth-shell-') && k !== VERSION) await caches.delete(k);
		await self.clients.claim();
	})());
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
	// AIGC 短片和语音（docs/earth-game/aigc-media.md）：浏览器按 Range 分段拉取，交给浏览器自己处理，不进离线缓存
	if (url.pathname.startsWith('/earth/media/') && /\.(mp4|webm|mp3)$/.test(url.pathname)) return;
	// 页面：先联网（拿到最新版本，并在后台按它更新缓存），断网时用上次缓存的页面
	if (req.mode === 'navigate' && url.pathname.startsWith('/earth')) {
		event.respondWith((async () => {
			const cache = await caches.open(VERSION);
			try {
				const res = await fetch(req);
				// 只有真正的首页才拿来刷新外壳：以页面方式打开 /earth/ 下的图标等文件不能把外壳换掉
				if (res.ok && url.pathname === PAGE) {
					const copy = res.clone();
					event.waitUntil(copy.clone().text().then((html) => refreshFrom(cache, html, copy)).catch(() => {}));
				}
				return res;
			} catch (e) {
				// 断网：首页用缓存的外壳；其他地址先找它自己的缓存
				const hit = url.pathname === PAGE ? await cache.match(PAGE) : await cache.match(req);
				if (hit) return hit;
				throw e;
			}
		})());
		return;
	}
	// 构建文件名带内容哈希，内容不会变：先用缓存，没有再联网并存下
	if (url.pathname.startsWith('/_astro/')) {
		event.respondWith((async () => {
			const cache = await caches.open(VERSION);
			const hit = await cache.match(req);
			if (hit) return hit;
			const res = await fetch(req);
			if (res.ok) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
			return res;
		})());
		return;
	}
	// /earth/ 下的其他静态文件（图标、图片清单、CGI）：先联网，断网用缓存
	if (url.pathname.startsWith('/earth/') && !url.pathname.endsWith('/sw.js')) {
		event.respondWith((async () => {
			const cache = await caches.open(VERSION);
			try {
				const res = await fetch(req);
				if (res.ok) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
				return res;
			} catch (e) {
				const hit = await cache.match(req);
				if (hit) return hit;
				throw e;
			}
		})());
	}
});
