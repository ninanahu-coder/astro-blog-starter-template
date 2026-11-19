// 真实底图（第 31 轮）：能不能用的判断、范围、标记内容与转义、地图生命周期（加载成功、失败退回手绘地图、拆掉）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { basemapBounds, BASEMAP_STYLE, canUseBasemap, createBasemap, exitPoint, mapLabel, pinClass, pinHtml, pinLabel, routesGeoJson, webglSupported, type MapLib, type Pin } from '../../src/game/ui/basemap.ts';
import { DEFAULT_PREFS, parsePrefs } from '../../src/game/ui/prefs.ts';
import { WA } from '../../src/game/data/wa.ts';
import { AREAS, exitsOf, WORLD_BASE } from '../../src/game/data/areas-base.ts';

const pin = (over: Partial<Pin> = {}): Pin => ({ id: 'perth', name: '珀斯', lon: 115.86, lat: -31.95, here: false, visited: true, selected: false, wx: '☀️', count: 0, ...over });

test('能不能用：设置开、联网、有 WebGL、没失败过，缺一样就用手绘地图', () => {
	const ok = { pref: true, online: true, webgl: true, failed: false };
	assert.equal(canUseBasemap(ok), true);
	for (const k of ['pref', 'online', 'webgl'] as const) assert.equal(canUseBasemap({ ...ok, [k]: false }), false, k);
	assert.equal(canUseBasemap({ ...ok, failed: true }), false);
	// WebGL 检测：没有 createElement（测试环境）、拿不到上下文、抛错都算不支持
	assert.equal(webglSupported(undefined), false);
	assert.equal(webglSupported({}), false);
	assert.equal(webglSupported({ createElement: () => ({ getContext: () => null }) }), false);
	assert.equal(webglSupported({ createElement: () => { throw new Error('x'); } }), false);
	assert.equal(webglSupported({ createElement: () => ({ getContext: (t: string) => (t === 'webgl' ? {} : null) }) }), true);
});

test('设置：真实地图默认开，坏值退回默认，旧设置没有这一项也是开', () => {
	assert.equal(DEFAULT_PREFS.basemap, true);
	assert.equal(parsePrefs(JSON.stringify({ basemap: false })).basemap, false);
	assert.equal(parsePrefs(JSON.stringify({ basemap: 'no' })).basemap, true);
	assert.equal(parsePrefs(JSON.stringify({ sound: true })).basemap, true);
	assert.equal(parsePrefs(JSON.stringify(Object.create({ basemap: false }))).basemap, true);
});

test('范围：框住西澳所有地点，四周留边', () => {
	const [[w, s], [e, n]] = basemapBounds(WA.locations);
	for (const l of WA.locations) assert.ok(l.lon > w && l.lon < e && l.lat > s && l.lat < n, l.id);
	// 只有一个点时也有一点范围，不会缩成一个点
	const [[w1, s1], [e1, n1]] = basemapBounds([{ lon: 115, lat: -32 }]);
	assert.ok(e1 - w1 > 0 && n1 - s1 > 0);
});

test('标记：名字转义、天气不给读屏念、读屏名字带状态和人数', () => {
	const h = pinHtml(pin({ name: '<b>x</b>', count: 2 }));
	assert.ok(!h.includes('<b>x</b>') && h.includes('&lt;b&gt;x&lt;/b&gt;'));
	assert.match(h, /<span aria-hidden="true">☀️<\/span>/);
	assert.match(h, /👥2/);
	assert.equal(pinLabel(pin({ here: true, count: 3 })), '珀斯（你在这里），3 位玩家');
	assert.equal(pinLabel(pin({ visited: false })), '珀斯（没去过）');
	const g = routesGeoJson([{ a: [1, 2], b: [3, 4], live: true }]);
	assert.deepEqual(g.features[0].geometry.coordinates, [[1, 2], [3, 4]]);
	assert.equal(g.features[0].properties.live, true);
});

/** 假的地图库：记下建了几张地图、标记、事件处理，手动触发 load / error */
function fakeLib() {
	const log = { maps: 0, removed: 0, markers: [] as { el: any; ll: [number, number]; removed: boolean }[], data: null as unknown, opts: null as Record<string, unknown> | null, layers: 0, resized: 0 };
	const handlers: Record<string, (e?: unknown) => void> = {};
	class FakeMap {
		touchZoomRotate = { disableRotation() {} };
		constructor(o: Record<string, unknown>) { log.maps++; log.opts = o; }
		on(t: string, f: (e?: unknown) => void) { handlers[t] = f; }
		addSource() {}
		addLayer() { log.layers++; }
		getSource() { return { setData: (d: unknown) => { log.data = d; } }; }
		resize() { log.resized++; }
		remove() { log.removed++; }
	}
	class FakeMarker {
		rec: { el: any; ll: [number, number]; removed: boolean };
		constructor(o: { element: unknown }) { this.rec = { el: o.element, ll: [0, 0], removed: false }; log.markers.push(this.rec); }
		setLngLat(ll: [number, number]) { this.rec.ll = ll; return this; }
		addTo() { return this; }
		remove() { this.rec.removed = true; }
	}
	const doc = { createElement: () => { const a: Record<string, string> = {}; return { className: '', innerHTML: '', dataset: {} as Record<string, string>, attrs: a, setAttribute(k: string, v: string) { a[k] = v; } }; } };
	return { lib: { Map: FakeMap, Marker: FakeMarker } as unknown as MapLib, log, handlers, doc };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('地图生命周期：加载好之前不建标记；加载好后标记是带 data-loc 的按钮，再更新只改内容不重建', async () => {
	const { lib, log, handlers, doc } = fakeLib();
	const states: string[] = [];
	const bm = createBasemap({ container: {}, bounds: [[0, 0], [1, 1]], doc, routeColor: '#123456', onState: (s) => states.push(s), load: async () => lib });
	bm.update({ pins: [pin()], routes: [] });
	await tick();
	assert.equal(log.maps, 1);
	assert.equal(log.opts!.style, BASEMAP_STYLE);
	assert.equal(bm.ready, false);
	assert.equal(log.markers.length, 0, '还没加载好');
	handlers.load();
	assert.equal(bm.ready, true);
	assert.deepEqual(states, ['ready']);
	assert.equal(log.markers.length, 1, '加载好后补上之前的更新');
	const el = log.markers[0].el;
	assert.equal(el.dataset.loc, 'perth');
	assert.deepEqual(log.markers[0].ll, [115.86, -31.95]);
	assert.equal(el.attrs['aria-label'], '珀斯');
	bm.update({ pins: [pin({ here: true, name: '珀斯市' })], routes: [{ a: [1, 2], b: [3, 4], live: true }] });
	assert.equal(log.markers.length, 1, '同一个地点不重建标记');
	assert.match(el.className, /here/);
	assert.match(el.innerHTML, /珀斯市/);
	assert.equal((log.data as { features: unknown[] }).features.length, 1, '路线画上了');
	// 内容没变时不重写标记（第 35 轮）：手动改掉的内容保持原样，说明没碰 DOM
	el.innerHTML = '未动';
	bm.update({ pins: [pin({ here: true, name: '珀斯市' })], routes: [] });
	assert.equal(el.innerHTML, '未动', '内容没变不重写');
	bm.update({ pins: [pin({ here: true, name: '珀斯市', count: 4 })], routes: [] });
	assert.match(el.innerHTML, /👥4/, '内容变了才重写');
	// 加载好之后个别图块出错不算失败
	handlers.error();
	assert.equal(bm.failed, false);
	bm.destroy();
	assert.equal(log.removed, 1);
	assert.equal(log.markers[0].removed, true);
});

test('加载失败：地图库下载失败、或加载好之前出错，都通知页面退回手绘地图', async () => {
	const states: string[] = [];
	const a = createBasemap({ container: {}, bounds: [[0, 0], [1, 1]], doc: fakeLib().doc, routeColor: '#000', onState: (s) => states.push(s), load: async () => { throw new Error('offline'); } });
	await tick();
	assert.equal(a.failed, true);
	assert.deepEqual(states, ['failed']);
	const { lib, log, handlers, doc } = fakeLib();
	const b = createBasemap({ container: {}, bounds: [[0, 0], [1, 1]], doc, routeColor: '#000', onState: (s) => states.push(s), load: async () => lib });
	await tick();
	handlers.error();
	handlers.error();
	assert.equal(b.failed, true);
	assert.equal(log.removed, 1, '失败后拆掉地图');
	assert.deepEqual(states, ['failed', 'failed'], '只通知一次');
	// 拆掉之后地图库才下载完：不再建地图
	const c = fakeLib();
	const d = createBasemap({ container: {}, bounds: [[0, 0], [1, 1]], doc: c.doc, routeColor: '#000', onState: (s) => states.push(s), load: async () => c.lib });
	d.destroy();
	await tick();
	assert.equal(c.log.maps, 0);
});

test('页面：地图库不进首屏脚本（只能动态加载），设置页有真实地图开关并写明图块来源', () => {
	const astro = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.doesNotMatch(astro, /from 'maplibre-gl'/, '页面不能静态导入地图库');
	const mod = readFileSync(new URL('../../src/game/ui/basemap.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(mod, /^import .*maplibre-gl/m, 'basemap.ts 也只能动态导入');
	assert.match(astro, /data-pref="basemap"/);
	assert.match(astro, /OpenFreeMap/);
});

// ---------- v42：跨区域出口、读屏说明、深色模式、联网重试 ----------

test('读屏说明：按区域名写，真实地图多「真实」二字，都保留「下面的列表是同样的内容」', () => {
	assert.equal(mapLabel('南澳大利亚', true), '南澳大利亚真实地图：点地点看去那里的走法；下面的列表是同样的内容');
	assert.equal(mapLabel('西澳大利亚', false), '西澳大利亚地图：点地点看去那里的走法；下面的列表是同样的内容');
	const astro = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(astro, /\$\('basemap'\)\.setAttribute\('aria-label', mapLabel\(area\.name, true\)\)/, '底图换区域时读屏说明跟着换');
	assert.doesNotMatch(astro, /\$\('basemap'\)[^\n]*西澳/, '不能写死西澳');
});

test('出口位置：目的地在范围里就放在目的地；在范围外就停在范围边上（往里收一点），方向不变', () => {
	const b: [[number, number], [number, number]] = [[0, 0], [10, 10]];
	assert.deepEqual(exitPoint([5, 5], [7, 6], b), [7, 6]);
	// 往东出界：停在 x = 10 - 0.6
	const [x, y] = exitPoint([5, 5], [25, 5], b);
	assert.ok(Math.abs(x - 9.4) < 1e-9 && Math.abs(y - 5) < 1e-9, `${x},${y}`);
	// 往西南出界：先碰到的那条边为准，方向保持在连线上
	const [x2, y2] = exitPoint([5, 5], [-5, 3], b);
	assert.ok(Math.abs(x2 - 0.6) < 1e-9 && Math.abs(y2 - (5 - 4.4 * 0.2)) < 1e-9, `${x2},${y2}`);
	// 往北出界
	const [x3, y3] = exitPoint([5, 5], [5, 30], b);
	assert.ok(Math.abs(x3 - 5) < 1e-9 && Math.abs(y3 - 9.4) < 1e-9);
	// 往南出界
	const [, y4] = exitPoint([5, 5], [5, -30], b);
	assert.ok(Math.abs(y4 - 0.6) < 1e-9);
	// 斜着往东北出界：停在先碰到的东边，纬度按连线算（不是直接把终点夹到边上）
	const [x6, y6] = exitPoint([5, 5], [25, 7], b);
	assert.ok(Math.abs(x6 - 9.4) < 1e-9 && Math.abs(y6 - (5 + 2 * 0.22)) < 1e-9, `${x6},${y6}`);
	const [x7, y7] = exitPoint([5, 5], [6, 25], b);
	assert.ok(Math.abs(x7 - (5 + 0.22)) < 1e-9 && Math.abs(y7 - 9.4) < 1e-9, `${x7},${y7}`);
	// 起点已在收边之外：不往回走（纬度不往反方向偏）
	assert.deepEqual(exitPoint([9.9, 5], [39.9, 8], b), [9.4, 5]);
	// 起点自己在边缘外也不会跑出范围
	const [x5, y5] = exitPoint([9.9, 9.9], [40, 40], b);
	assert.ok(x5 <= 9.4 + 1e-9 && y5 <= 9.4 + 1e-9 && x5 >= 0.6 && y5 >= 0.6);
	// 真实数据：每个区域的每个出口都落在该区域底图范围里
	for (const area of AREAS) {
		const bounds = basemapBounds(area.locations);
		for (const r of exitsOf(area)) {
			const mine = area.locations.find((l) => l.id === r.a || l.id === r.b)!;
			const far = WORLD_BASE.locations.find((l) => l.id === (mine.id === r.a ? r.b : r.a))!;
			const [lon, lat] = exitPoint([mine.lon, mine.lat], [far.lon, far.lat], bounds);
			assert.ok(lon > bounds[0][0] && lon < bounds[1][0] && lat > bounds[0][1] && lat < bounds[1][1], `${area.id}→${far.id}`);
			// 朝目的地方向：离目的地比起点更近
			assert.ok(Math.hypot(far.lon - lon, far.lat - lat) < Math.hypot(far.lon - mine.lon, far.lat - mine.lat), `${area.id}→${far.id} 方向`);
		}
	}
});

test('出口标记：图标 + 目的地（区域），名字转义，读屏念去哪的航线/公路，往东的靠右放', () => {
	const ex = pin({ id: 'adelaide', name: '<i>阿德莱德</i>', exit: { mode: 'air', area: '南澳<大利亚>', end: true } });
	const h = pinHtml(ex);
	assert.ok(!h.includes('<i>') && h.includes('&lt;i&gt;阿德莱德&lt;/i&gt;'));
	assert.ok(h.includes('（南澳&lt;大利亚&gt;）'));
	assert.match(h, /<span aria-hidden="true">✈️ <\/span>/);
	assert.ok(!h.includes('☀️'), '出口不显示天气');
	assert.equal(pinLabel(pin({ name: '阿德莱德', exit: { mode: 'air', area: '南澳大利亚', end: true } })), '去阿德莱德（南澳大利亚）的航线');
	assert.equal(pinLabel(pin({ name: '锡杜纳', exit: { mode: 'road', area: '南澳大利亚', end: true } })), '去锡杜纳（南澳大利亚）的公路');
	assert.match(pinHtml(pin({ exit: { mode: 'road', area: 'x', end: false } })), /🛣️/);
	assert.equal(pinClass(ex), 'pin exit end');
	assert.equal(pinClass({ ...ex, selected: true, exit: { ...ex.exit!, end: false } }), 'pin exit sel');
	// 普通地点照旧
	assert.equal(pinClass(pin({ here: true })), 'pin here');
	assert.equal(pinClass(pin({ visited: false, selected: true })), 'pin new sel');
});

test('出口标记在地图上：带 data-loc（点它出目的地卡片），往东的锚在右边', async () => {
	const { lib, log, handlers, doc } = fakeLib();
	const anchors: string[] = [];
	const Marker = (lib as unknown as { Marker: new (o: { element: unknown; anchor?: string }) => unknown }).Marker;
	class SpyMarker extends (Marker as unknown as new (o: { element: unknown; anchor?: string }) => object) {
		constructor(o: { element: unknown; anchor?: string }) { super(o); anchors.push(o.anchor ?? ''); }
	}
	const bm = createBasemap({ container: {}, bounds: [[0, 0], [1, 1]], doc, routeColor: '#000', onState: () => {}, load: async () => ({ ...lib, Marker: SpyMarker } as unknown as MapLib) });
	await tick();
	handlers.load();
	bm.update({ pins: [pin(), pin({ id: 'adelaide', name: '阿德莱德', exit: { mode: 'air', area: '南澳大利亚', end: true } }), pin({ id: 'x', exit: { mode: 'road', area: '西澳', end: false } })], routes: [] });
	assert.deepEqual(anchors, ['left', 'right', 'left']);
	assert.equal(log.markers[1].el.dataset.loc, 'adelaide');
	assert.equal(log.markers[1].el.attrs['aria-label'], '去阿德莱德（南澳大利亚）的航线');
	bm.destroy();
});

test('页面：深色模式下真实地图也压暗；断网失败的底图联网后重试；出口标记接上了', () => {
	const astro = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(astro, /@media \(prefers-color-scheme: dark\) \{\s*#basemap \.maplibregl-canvas \{ filter: invert/);
	const online = astro.slice(astro.indexOf("window.addEventListener('online'"));
	assert.match(online.slice(0, 600), /if \(basemapFailed\) \{ basemapFailed = false; if \(state && tab === 'go'\) renderMap\(\); \}/);
	assert.match(astro, /exitPoint\(\[mine\.lon, mine\.lat\], \[far\.lon, far\.lat\], bounds\)/);
	assert.match(astro, /pins: \[\.\.\.area\.locations\.map\([\s\S]{0,400}\.\.\.exitPins\]/);
});
