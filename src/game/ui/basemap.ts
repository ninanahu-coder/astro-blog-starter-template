// 真实底图（第 31 轮）：出行页用 MapLibre 画 OpenStreetMap 真实地图，地点、路线叠在上面。
// 图块来自 OpenFreeMap（OSM 数据，免费、不要 key）。地图库只在第一次要画真实地图时才下载，不拖慢首屏。
// 离线、浏览器不支持 WebGL、设置里关掉、或底图加载失败时，页面继续用原来的手绘 SVG 地图。

export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** 地图上的一个地点 */
export interface Pin {
	id: string;
	name: string;
	lon: number;
	lat: number;
	here: boolean; // 玩家现在在这里
	visited: boolean;
	selected: boolean;
	wx: string; // 天气图标
	count: number; // 在这里的其他玩家
}

/** 两个地点之间的一条路线；live 表示从玩家现在的地点出发 */
export interface RouteLine { a: [number, number]; b: [number, number]; live: boolean }

export interface BasemapView { pins: Pin[]; routes: RouteLine[] }

type Bounds = [[number, number], [number, number]];

/** 要不要用真实底图：设置开着、联网、浏览器支持 WebGL，且这次没有加载失败过 */
export const canUseBasemap = (o: { pref: boolean; online: boolean; webgl: boolean; failed: boolean }) => o.pref && o.online && o.webgl && !o.failed;

/** 浏览器能不能画 WebGL 地图（测试环境、很旧的浏览器、关了硬件加速时不能） */
export function webglSupported(doc: { createElement?: (t: string) => unknown } | undefined): boolean {
	try {
		const c = doc?.createElement?.('canvas') as { getContext?: (t: string) => unknown } | undefined;
		return !!(c?.getContext?.('webgl2') || c?.getContext?.('webgl'));
	} catch {
		return false;
	}
}

/** 把所有地点框进来的经纬度范围，四周各留一点边 */
export function basemapBounds(pts: { lon: number; lat: number }[], pad = 0.08): Bounds {
	const lons = pts.map((p) => p.lon);
	const lats = pts.map((p) => p.lat);
	const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
	const dx = Math.max((e - w) * pad, 0.05);
	const dy = Math.max((n - s) * pad, 0.05);
	return [[w - dx, s - dy], [e + dx, n + dy]];
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 地点标记的样式类 */
export const pinClass = (p: Pin) => `pin${p.here ? ' here' : p.visited ? '' : ' new'}${p.selected ? ' sel' : ''}`;

/** 地点标记按钮的内容：圆点 + 名字 + 天气（读屏跳过）+ 在线人数 */
export const pinHtml = (p: Pin) =>
	`<span class="pin-dot" aria-hidden="true"></span><span class="pin-label">${esc(p.name)}<span aria-hidden="true">${esc(p.wx)}</span>${p.count ? ` <span class="cnt">👥${p.count}</span>` : ''}</span>`;

/** 读屏念的名字：地点名，加上「你在这里」「没去过」和在线人数 */
export const pinLabel = (p: Pin) => `${p.name}${p.here ? '（你在这里）' : p.visited ? '' : '（没去过）'}${p.count ? `，${p.count} 位玩家` : ''}`;

/** 路线的 GeoJSON */
export const routesGeoJson = (rs: RouteLine[]) => ({
	type: 'FeatureCollection' as const,
	features: rs.map((r) => ({ type: 'Feature' as const, properties: { live: r.live }, geometry: { type: 'LineString' as const, coordinates: [r.a, r.b] } })),
});

/** 地图库里用到的那部分接口（测试里换成假的） */
export interface MapLib {
	Map: new (o: Record<string, unknown>) => MapLike;
	Marker: new (o: { element: unknown; anchor?: string }) => MarkerLike;
}
export interface MapLike {
	on(t: string, f: (e?: unknown) => void): unknown;
	addSource(id: string, s: unknown): unknown;
	addLayer(l: unknown): unknown;
	getSource(id: string): { setData(d: unknown): unknown } | undefined;
	resize(): unknown;
	remove(): unknown;
	touchZoomRotate?: { disableRotation(): unknown };
}
export interface MarkerLike { setLngLat(ll: [number, number]): MarkerLike; addTo(m: MapLike): MarkerLike; remove(): unknown }
interface PinEl { className: string; innerHTML: string; dataset: Record<string, string>; setAttribute(k: string, v: string): void }
export interface DocLike { createElement(t: string): unknown }

/** 真正的地图库：动态加载（单独打包，打开出行页时才下载），后台线程用构建出来的文件 */
export async function loadMapLibre(): Promise<MapLib> {
	const [ml, worker] = await Promise.all([
		import('maplibre-gl'),
		import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
		import('maplibre-gl/dist/maplibre-gl.css'),
	]);
	ml.setWorkerUrl(worker.default);
	return ml as unknown as MapLib;
}

/** 手势提示改成中文（单指拖动页面、双指移动地图） */
const LOCALE = {
	'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 再滚动来缩放地图',
	'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 再滚动来缩放地图',
	'CooperativeGesturesHandler.MobileHelpText': '用两根手指移动地图',
	'AttributionControl.ToggleAttribution': '地图来源',
	'NavigationControl.ZoomIn': '放大',
	'NavigationControl.ZoomOut': '缩小',
};

export interface Basemap {
	readonly ready: boolean;
	readonly failed: boolean;
	update(v: BasemapView): void;
	resize(): void;
	destroy(): void;
}

/**
 * 在 container 里建一张真实地图。加载成功调 onState('ready')；还没加载好就出错（断网、图块服务挂了、
 * 地图库下载失败）调 onState('failed')，页面就退回手绘地图。地点标记是带 data-loc 的按钮，点击走页面原来的处理。
 */
export function createBasemap(o: {
	container: unknown;
	bounds: Bounds;
	doc: DocLike;
	routeColor: string;
	onState: (s: 'ready' | 'failed') => void;
	load?: () => Promise<MapLib>;
}): Basemap {
	let map: MapLike | null = null;
	let lib: MapLib | null = null;
	let ready = false;
	let failed = false;
	let gone = false;
	let last: BasemapView | null = null;
	const pins = new Map<string, { m: MarkerLike; el: PinEl; key: string }>();
	const drop = () => {
		for (const p of pins.values()) p.m.remove();
		pins.clear();
		try { map?.remove(); } catch {}
		map = null;
	};
	const fail = () => {
		if (failed || gone) return;
		failed = true;
		drop();
		o.onState('failed');
	};
	const apply = (v: BasemapView) => {
		if (!map || !lib || !ready) return;
		for (const p of v.pins) {
			let hit = pins.get(p.id);
			if (!hit) {
				const el = o.doc.createElement('button') as PinEl;
				el.dataset.loc = p.id;
				hit = { el, m: new lib.Marker({ element: el, anchor: 'left' }).setLngLat([p.lon, p.lat]).addTo(map), key: '' };
				pins.set(p.id, hit);
			}
			// 内容没变就不碰 DOM：在线人数一变就会整体更新，几十个标记每次都重写会卡（第 35 轮）
			const cls = pinClass(p), html = pinHtml(p), label = pinLabel(p);
			const key = `${cls}|${html}|${label}`;
			if (hit.key === key) continue;
			hit.key = key;
			hit.el.className = cls;
			hit.el.innerHTML = html;
			hit.el.setAttribute('aria-label', label);
		}
		map.getSource('game-routes')?.setData(routesGeoJson(v.routes));
	};
	(o.load ?? loadMapLibre)()
		.then((ml) => {
			if (gone || failed) return;
			lib = ml;
			map = new ml.Map({
				container: o.container,
				style: BASEMAP_STYLE,
				bounds: o.bounds,
				fitBoundsOptions: { padding: 16 },
				attributionControl: { compact: true },
				cooperativeGestures: true,
				dragRotate: false,
				pitchWithRotate: false,
				locale: LOCALE,
			});
			map.touchZoomRotate?.disableRotation();
			map.on('error', () => { if (!ready) fail(); });
			map.on('load', () => {
				if (!map || gone) return;
				map.addSource('game-routes', { type: 'geojson', data: routesGeoJson([]) });
				map.addLayer({
					id: 'game-routes', type: 'line', source: 'game-routes',
					paint: { 'line-color': o.routeColor, 'line-width': ['case', ['get', 'live'], 2.5, 1.2], 'line-opacity': ['case', ['get', 'live'], 0.9, 0.4], 'line-dasharray': [2, 1.5] },
				});
				ready = true;
				if (last) apply(last);
				o.onState('ready');
			});
		})
		.catch(fail);
	return {
		get ready() { return ready; },
		get failed() { return failed; },
		update(v) { last = v; apply(v); },
		resize() { try { map?.resize(); } catch {} },
		destroy() { gone = true; drop(); },
	};
}
