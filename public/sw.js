// 百家乐 PWA Service Worker — 网络优先，离线回退缓存
const CACHE = 'baccarat-v1';
const PRECACHE = [
	'/baccarat',
	'/manifest.webmanifest',
	'/icons/baccarat-192.png',
	'/icons/baccarat-512.png',
	'/icons/baccarat-maskable-512.png',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
	event.respondWith(
		fetch(request)
			.then((response) => {
				if (response.ok) {
					const clone = response.clone();
					caches.open(CACHE).then((cache) => cache.put(request, clone));
				}
				return response;
			})
			.catch(() =>
				caches.match(request).then((hit) => hit || caches.match('/baccarat')),
			),
	);
});
