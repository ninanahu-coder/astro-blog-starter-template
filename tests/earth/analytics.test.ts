// 数据统计（第 39 批，设计见 docs/earth-game/analytics.md）：
// 服务端只存按天汇总的计数；统计里没有坐标、同步码、名字、玩家 id；关掉统计后客户端不发送、服务端不记。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { EarthWorld, routeEarth } from '../../src/game/server/world.ts';
import { actionCounts, BATCH_MAX, cleanBatch, funnelSteps, perfBucket, StatsBuffer, STATS_KEEP_DAYS } from '../../src/game/server/stats.ts';
import { parseStatsPref, parseStatsQueue, QUEUE_CAP, STAT_EVENTS, STATS_QUEUE_KEY, statsDefault, Telemetry } from '../../src/game/ui/telemetry.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { WA } from '../../src/game/data/wa.ts';

function makeStorage() {
	const data = new Map<string, any>();
	return {
		data,
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		delete: async (k: string | string[]) => {
			for (const x of Array.isArray(k) ? k : [k]) data.delete(x);
			return true;
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix))),
	};
}
function makeWorld() {
	const storage = makeStorage();
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>, ip = '1.1.1.1') => {
		const res = await world.fetch(new Request('https://x.test/api/earth/save', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	const read = async (from: number, to: number) => {
		const res = await world.fetch(new Request(`https://internal/api/earth/stats/read?from=${from}&to=${to}`));
		return ((await res.json()) as any).days as Record<string, Record<string, number>>;
	};
	return { data: storage.data, world, call, read };
}

const NAME = '小明Zed';
const ID = 'analytics-player-1';
const KEY = 'SecretKey' + 'q'.repeat(20);
const cred = { id: ID, key: KEY };
const profile = { name: NAME, avatar: '🧑', origin: 'student', traits: [] };
const today = () => realDayOf(Date.now());
const hashOf = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);

/** 走一遍：建角色 → 出行 → 打工 → 真实 GPS 打卡，返回这期间统计相关的全部存储内容 */
async function playThrough(nt: boolean) {
	const w = makeWorld();
	const extra = nt ? { nt: true } : {};
	const c = await w.call({ action: 'create', ...cred, profile, ...extra });
	assert.ok(c.data.ok, c.data.msg);
	let rev = c.data.state.rev;
	const act = async (a: unknown) => {
		const r = await w.call({ action: 'act', ...cred, rev, act: a, ...extra });
		rev = r.data.state.rev;
		return r;
	};
	assert.ok((await act({ t: 'job', op: 'apply', career: c.data.state.job?.career ?? 'barista' })).status < 500);
	const poi = WA.pois.find((x) => x.loc === 'perth')!;
	// main 的 GPS 防作弊要求带定位精度（不带按旧页面拒绝），这里按真实手机给 10 米
	const gps = await act({ t: 'gps', lat: poi.lat, lon: poi.lon, acc: 10 });
	assert.ok(gps.data.ok, gps.data.msg);
	const trip = await act({ t: 'travel', to: 'fremantle', mode: 'road' });
	assert.ok(trip.data.ok, trip.data.msg);
	return { w, poi };
}

test('服务端：按结算记功能使用、经济流水、新增和漏斗；统计里没有坐标、同步码、名字、玩家 id', async () => {
	const { w, poi } = await playThrough(false);
	const d = today();
	const days = await w.read(d, d);
	const c = days[d];
	assert.ok(c, '今天有汇总');
	assert.equal(c.new, 1);
	assert.equal(c.active, 1, '建角色那天算一个活跃日');
	assert.ok(c['eco.in.daily'] > 0, '每日奖励算投放');
	assert.equal(c['use.gps'], 1);
	assert.equal(c['use.travel'], 1);
	assert.ok(c['eco.out.travel'] > 0, '出行车费算回收');
	assert.equal(c['fn.travel'], 1, '第一次出行记在注册日');
	assert.equal(c['fn.real'], 1, '第一次真实打卡记在注册日');
	// 隐私：统计相关的存储里找不到任何个人信息
	const h = await hashOf(ID);
	const statsDump = JSON.stringify([...w.data].filter(([k]) => k.startsWith('stats:')));
	for (const secret of [ID, KEY, NAME, h, String(poi.lat), String(poi.lon), poi.lat.toFixed(3), poi.lon.toFixed(3), poi.id]) {
		assert.ok(!statsDump.includes(secret), `统计里不该出现 ${secret}`);
	}
	for (const k of Object.keys(c)) assert.match(k, /^[a-z0-9.]+$/, `计数键只来自白名单：${k}`);
	// 注册日记录：键是 id 哈希前缀，值只有一个日期
	assert.equal(w.data.get('born:' + h), d);
	assert.ok(![...w.data.keys()].some((k) => k.startsWith('born:') && k.includes(ID)));
});

test('服务端：带 nt（玩家关了统计）时一条都不记，也不记注册日', async () => {
	const { w } = await playThrough(true);
	const d = today();
	assert.deepEqual(await w.read(d - 1, d + 1), {});
	assert.ok(![...w.data.keys()].some((k) => k.startsWith('stats:') || k.startsWith('born:')));
});

test('服务端：留存——注册后第 1 天第一次上线记 ret.1 到注册日；超过 30 天删掉注册日', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	const d = today();
	const h = await hashOf(ID);
	// 假装是昨天注册、昨天领过每日奖励
	w.data.set('born:' + h, d - 1);
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, daily: { day: d - 1, streak: 1 } } });
	const got = await w.call({ action: 'get', ...cred });
	assert.ok(got.data.daily, '今天第一次上线领了奖励');
	const again = await w.call({ action: 'get', ...cred });
	assert.equal(again.data.daily, undefined);
	const days = await w.read(d - 1, d);
	assert.equal(days[d - 1]['ret.1'], 1, '次日留存记在注册日');
	assert.equal(days[d].active, 2, '建角色那次 + 今天第一次（第二次读取不重复算）');
	// 31 天前注册的：不再记留存，注册日记录删掉
	w.data.set('born:' + h, d - 31);
	const rec2 = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec2, state: { ...rec2.state, daily: { day: d - 1, streak: 1 } } });
	await w.call({ action: 'get', ...cred });
	assert.equal(w.data.has('born:' + h), false);
	assert.equal((await w.read(d - 31, d - 31))[d - 31]?.['ret.31'], undefined);
});

test('漏斗判定只看结算前后的存档：第一次出行、第一次算班次、第一次真实打卡', () => {
	const base = createCharacter({ id: 'x'.repeat(8), name: 'a', avatar: '🧑', origin: 'student', traits: [], region: 'perth', spawn: WA.spawn, seed: 1 });
	assert.deepEqual(funnelSteps(base, base), []);
	assert.deepEqual(funnelSteps(base, { ...base, visited: { ...base.visited, fremantle: 1 } }), ['travel']);
	const been = { ...base, visited: { ...base.visited, fremantle: 1 } };
	assert.deepEqual(funnelSteps(been, { ...been, visited: { ...been.visited, rottnest: 1 } }), [], '第二次去新地方不算第一次出行');
	assert.deepEqual(funnelSteps(base, { ...base, workDay: 0 }), ['work']);
	assert.deepEqual(funnelSteps({ ...base, workDay: 3 }, { ...base, workDay: 4 }), []);
	assert.deepEqual(funnelSteps(base, { ...base, checkins: ['p1'] }), ['real']);
	assert.deepEqual(funnelSteps(base, { ...base, venueCd: { meal: 1 } }), ['real']);
	assert.deepEqual(funnelSteps({ ...base, venueCd: { meal: 1 } }, { ...base, venueCd: { meal: 1 }, checkins: ['p1'] }), [], '已经真实打过卡');
	// 动作计数：失败只记失败，不记钱；钱只按存档现金差算
	assert.deepEqual(actionCounts({ t: 'travel', to: 'fremantle', mode: 'road' }, base, base, false), { 'fail.travel': 1 });
	assert.deepEqual(actionCounts({ t: 'job', op: 'work' }, base, { ...base, cash: base.cash + 120 }, true), { 'use.job.work': 1, 'eco.in.job': 120 });
	const venue = actionCounts({ t: 'venue', venue: 'osm-123', op: 'meal', lat: -31.9505, lon: 115.8605, acc: 12 }, base, { ...base, cash: base.cash - 18 }, true);
	assert.deepEqual(venue, { 'use.venue.meal': 1, 'eco.out.venue': 18 }, '真实地点动作不带地点 id、坐标');
});

test('客户端上报的批次：只认白名单，自由文本、坐标、未知事件全部丢掉；耗时分档', () => {
	const c = cleanBatch({ v: 1, ev: [['session'], ['tab', 'go'], ['tab', 'go'], ['err', 'js'], ['perf', 'load', 2500], ['perf', 'api', 12], ['tab', NAME], ['err', '-31.95,115.86'], ['name', NAME], ['session', KEY], ['perf', 'load', -1], ['perf', 'load', 'x'], ['err', 'js', 5], 'junk', ['__proto__'], ['constructor']] });
	assert.deepEqual(c, { 'c.session': 1, 'c.tab.go': 2, 'c.err.js': 1, 'c.perf.load.lt4s': 1, 'c.perf.api.lt1s': 1 });
	assert.equal(cleanBatch({ v: 2, ev: [] }), null);
	assert.equal(cleanBatch({ v: 1, ev: Array.from({ length: BATCH_MAX + 1 }, () => ['session']) }), null, '一批太多');
	assert.equal(cleanBatch([]), null);
	assert.equal(cleanBatch(null), null);
	assert.deepEqual([999, 1000, 1999, 3999, 7999, 8000].map(perfBucket), ['lt1s', 'lt2s', 'lt2s', 'lt4s', 'lt8s', 'ge8s']);
});

test('上报接口：格式不对 400、过大 413、限流 429；合格的批次只记计数', async () => {
	const w = makeWorld();
	const post = (body: string, ip = '2.2.2.2') => w.world.fetch(new Request('https://x.test/api/earth/stats', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body }));
	assert.equal((await post('{')).status, 400);
	assert.equal((await post(JSON.stringify({ v: 1, ev: 'x' }), '3.3.3.3')).status, 400);
	assert.equal((await post('x'.repeat(5000), '4.4.4.4')).status, 413);
	assert.equal((await w.world.fetch(new Request('https://x.test/api/earth/stats'))).status, 405);
	const ok = JSON.stringify({ v: 1, ev: [['session'], ['metab', 'sync']] });
	const statuses = [];
	for (let i = 0; i < 8; i++) statuses.push((await post(ok, '5.5.5.5')).status);
	assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
	const d = today();
	assert.deepEqual((await w.read(d, d))[d], { 'c.session': 6, 'c.metab.sync': 6 });
	assert.ok(![...w.data.keys()].some((k) => k.includes('5.5.5.5')), '不记 IP');
});

test('查询接口：没配令牌或令牌不对一律 404，不会转到 Durable Object；令牌对时合并两个实例', async () => {
	const worlds = new Map<string, ReturnType<typeof makeWorld>>();
	let reached = 0;
	const env = (token?: string) => ({
		EARTH_STATS_TOKEN: token,
		EARTH_WORLD: {
			idFromName: (n: string) => n,
			get: (n: string) => {
				if (!worlds.has(n)) worlds.set(n, makeWorld());
				return { fetch: (r: Request) => { reached++; return worlds.get(n)!.world.fetch(r); } };
			},
		},
	});
	const token = 't'.repeat(40);
	const d = today();
	const req = (auth?: string, method = 'GET') => new Request(`https://x.test/api/earth/stats/read?from=${d}&to=${d}`, { method, headers: auth ? { Authorization: auth } : {} });
	for (const [e, r] of [[env(), req()], [env(token), req()], [env(token), req('Bearer ' + 't'.repeat(39))], [env('short'), req('Bearer short')], [env(token), req('Bearer ' + token, 'POST')]] as const) {
		assert.equal((await routeEarth(r, e)!).status, 404);
	}
	assert.equal(reached, 0, '令牌不对时不碰存储');
	// 存档实例记一次建角色，统计实例记一次会话
	const e = env(token);
	await routeEarth(new Request('https://x.test/api/earth/save', { method: 'POST', body: JSON.stringify({ action: 'create', ...cred, profile }) }), e);
	await routeEarth(new Request('https://x.test/api/earth/stats', { method: 'POST', body: JSON.stringify({ v: 1, ev: [['session']] }) }), e);
	const res = await routeEarth(req('Bearer ' + token), e)!;
	assert.equal(res.status, 200);
	const days = ((await res.json()) as any).days;
	assert.equal(days[d].new, 1);
	assert.equal(days[d]['c.session'], 1);
	const bad = await routeEarth(new Request(`https://x.test/api/earth/stats/read?from=${d - 500}&to=${d}`, { headers: { Authorization: 'Bearer ' + token } }), e)!;
	assert.equal(bad.status, 400, '一次最多查 120 天');
});

test('缓冲：攒够才写；写失败放回去不丢；超过保留期的汇总会被清掉', async () => {
	const s = makeStorage();
	let fail = true;
	const flaky = { ...s, put: async (k: Record<string, unknown>) => { if (fail) throw new Error('down'); return s.put(k); } };
	const b = new StatsBuffer(flaky, { maxPending: 3, flushMs: 1e9 });
	b.add(100, { a: 1 });
	b.add(100, { a: 2 });
	assert.equal(s.data.size, 0, '没攒够不写');
	b.add(100, { a: 4 });
	await b.flush();
	assert.equal(s.data.size, 0);
	assert.ok(b.size > 0, '写失败放回缓冲');
	fail = false;
	s.data.set('stats:' + (100 - STATS_KEEP_DAYS - 1), { old: 1 });
	s.data.set('stats:' + (100 - STATS_KEEP_DAYS), { keep: 1 });
	await b.flush();
	assert.deepEqual(s.data.get('stats:100'), { a: 7 });
	assert.equal(s.data.has('stats:' + (100 - STATS_KEEP_DAYS - 1)), false, '超过保留期的删掉');
	assert.equal(s.data.has('stats:' + (100 - STATS_KEEP_DAYS)), true);
	b.add(100, { a: 1 });
	await b.flush();
	assert.deepEqual(s.data.get('stats:100'), { a: 8 }, '和已落盘的合并');
});

// ---------- 客户端 ----------

function makeClient(on: boolean, opts: { fail?: boolean; random?: number } = {}) {
	const mem = new Map<string, string>();
	const sent: string[] = [];
	const state = { on };
	const t = new Telemetry({
		enabled: () => state.on,
		store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
		send: async (body) => {
			if (opts.fail) throw new Error('offline');
			sent.push(body);
			return true;
		},
		random: () => opts.random ?? 0,
	});
	return { t, sent, mem, state };
}

test('客户端：默认开；浏览器开了全局隐私控制或请勿跟踪时默认关；明确设过的以设置为准', () => {
	assert.equal(statsDefault({}), true);
	assert.equal(statsDefault(undefined), true);
	assert.equal(statsDefault({ globalPrivacyControl: true }), false);
	assert.equal(statsDefault({ doNotTrack: '1' }), false);
	assert.equal(parseStatsPref(null, {}), true);
	assert.equal(parseStatsPref('0', {}), false);
	assert.equal(parseStatsPref('1', { globalPrivacyControl: true }), true, '玩家自己打开的');
	assert.equal(parseStatsPref('garbage', { doNotTrack: '1' }), false);
});

test('客户端：关掉后不排队、不发送，已经排着的清空', async () => {
	const c = makeClient(false);
	c.t.track('session');
	c.t.track('tab', 'go');
	c.t.track('err', 'js');
	assert.deepEqual(c.t.pending, [], '关着时连本机排队都不进');
	assert.equal(c.mem.get(STATS_QUEUE_KEY), '[]');
	await c.t.flush();
	assert.deepEqual(c.sent, []);
	assert.deepEqual(c.t.pending, []);
	// 开着时排了几条，还没发出去就关掉
	const d = makeClient(true);
	d.t.track('session');
	d.t.track('tab', 'go');
	assert.equal(d.t.pending.length, 2);
	d.state.on = false;
	await d.t.flush();
	assert.deepEqual(d.sent, [], '关掉后这批不发');
	assert.deepEqual(d.t.pending, []);
	assert.equal(d.mem.get(STATS_QUEUE_KEY), '[]', '本机排队也清掉');
	// 关着时启动：本机旧排队直接清掉
	const mem = new Map([[STATS_QUEUE_KEY, JSON.stringify([['session']])]]);
	const t = new Telemetry({ enabled: () => false, store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) }, send: async () => { throw new Error('不该发送'); } });
	await t.flush();
	assert.equal(mem.get(STATS_QUEUE_KEY), '[]');
});

test('客户端：只排白名单事件，批量发送；名字、同步码、坐标塞不进去', async () => {
	const c = makeClient(true);
	c.t.track('session');
	c.t.track('session');
	c.t.track('tab', 'go');
	c.t.track('tab', 'go');
	c.t.track('tab', NAME);
	c.t.track('err', KEY);
	c.t.track('err', '-31.95,115.86');
	c.t.track('name', NAME);
	c.t.track('perf', 'load', 1234.6);
	for (let i = 0; i < 6; i++) c.t.track('err', 'net');
	for (let i = 0; i < 9; i++) c.t.track('perf', 'api', 50);
	await c.t.flush();
	assert.equal(c.sent.length, 1);
	const body = JSON.parse(c.sent[0]);
	assert.deepEqual(body.ev.slice(0, 3), [['session'], ['tab', 'go'], ['perf', 'load', 1235]], '页面每个会话只记一次');
	assert.equal(body.ev.filter((e: string[]) => e[0] === 'err').length, 3, '同一种报错每会话最多 3 次');
	assert.equal(body.ev.filter((e: string[]) => e[1] === 'api').length, 5, '接口耗时每会话最多 5 次');
	for (const s of [NAME, KEY, '-31.95', '115.86', ID]) assert.ok(!c.sent[0].includes(s), s);
	assert.deepEqual(c.t.pending, [], '发出去的移出排队');
	// 服务端按同一份白名单能全部认出来
	const counted = cleanBatch(body)!;
	assert.equal(Object.values(counted).reduce((a, b) => a + b, 0), body.ev.length);
});

test('客户端：发送失败留在本机，下次再发；排队有上限；本机排队读回来当不可信数据', async () => {
	const c = makeClient(true, { fail: true });
	c.t.track('session');
	c.t.track('tab', 'me');
	await c.t.flush();
	assert.equal(c.t.pending.length, 2, '失败不丢');
	assert.deepEqual(parseStatsQueue(c.mem.get(STATS_QUEUE_KEY)!), [['session'], ['tab', 'me']], '断网时排在本机');
	assert.deepEqual(parseStatsQueue(JSON.stringify([['session'], ['tab', NAME], ['perf', 'load'], 'x', ['err', 'js', 1]])), [['session']]);
	assert.deepEqual(parseStatsQueue('{'), []);
	assert.equal(parseStatsQueue(JSON.stringify(Array.from({ length: 500 }, () => ['session']))).length, QUEUE_CAP);
	// 抽样没抽中的会话不报耗时
	const s = makeClient(true, { random: 0.9 });
	s.t.track('perf', 'load', 100);
	assert.deepEqual(s.t.pending, []);
});

test('页面里每一处 tm.track 的事件名和参数都是白名单里的字面量（不会把玩家数据传进去）', () => {
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	const calls = [...page.matchAll(/tm\.track\(([^)]*)\)/g)].map((m) => m[1]);
	assert.ok(calls.length >= 8, `找到 ${calls.length} 处`);
	for (const args of calls) {
		const [name, arg] = args.split(',').map((x) => x.trim());
		assert.match(name, /^'[a-z]+'$/, args);
		const n = name.slice(1, -1);
		assert.ok(Object.hasOwn(STAT_EVENTS, n), n);
		if (arg && arg.startsWith("'")) assert.ok(STAT_EVENTS[n]!.includes(arg.slice(1, -1)), args);
		else if (arg) assert.ok(['tab', 'meTab'].includes(arg), `变量参数只能是当前页面：${args}`);
	}
	// 关掉统计时，存档请求带 nt
	assert.match(page, /statsOn \? body : \{ \.\.\.\(body as object\), nt: true \}/);
});

test('合并 main 后新加的动作（宠物、理财、现实活动、路线、领成就、新手引导）也只按类型计数，玩家输入的名字和 id 不进统计键', () => {
	const s = createCharacter({ id: 'y'.repeat(8), name: '统计', avatar: '🙂', origin: 'student', traits: [], region: 'perth', spawn: WA.spawn, seed: 2 });
	const acts = [
		{ t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter', name: 'Secret狗名' },
		{ t: 'asset', op: 'buy', id: 'asx-index', amount: 500 },
		{ t: 'live', id: 'perth-festival-2027' },
		{ t: 'trail', lat: -31.95, lon: 115.86, acc: 10 },
		{ t: 'claim', id: 'first-step' },
		{ t: 'onboard', op: 'tip', id: 'go' },
	] as any[];
	for (const a of acts) {
		const c = actionCounts(a, s, { ...s, cash: s.cash - 7 }, true);
		const keys = Object.keys(c);
		assert.ok(keys.includes('use.' + a.t) || keys.some((k) => k.startsWith('use.' + a.t + '.')), `${a.t} 记了 use`);
		for (const k of keys) {
			assert.match(k, /^[a-z0-9.]+$/, k);
			for (const secret of ['Secret', 'asx', 'perth', 'first', '31.95', '115.86']) assert.ok(!k.includes(secret), `${k} 不该带 ${secret}`);
		}
	}
	assert.deepEqual(actionCounts(acts[1], s, { ...s, cash: s.cash - 500 }, true), { 'use.asset.buy': 1, 'eco.out.asset': 500 }, '理财买入记成 eco.out.asset（文档写明不是回收）');
});

test('页面模板（第 39 批，合并 main 时开场换成了入境卡）：入境卡底部有统计告知和开关，设置里有隐私卡，切「我」的分栏会记一次', () => {
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	const card = src.slice(src.indexOf('id="c-card"'), src.indexOf('</section>', src.indexOf('id="c-card"')));
	assert.match(card, /<p class="ac-privacy stats-note"><span id="c-stats-text"><\/span> <button id="c-stats" type="button">关闭统计<\/button><\/p>/, '告知在入境卡里，创建前就能看到并关掉');
	assert.match(src, /\.ac-privacy button \{ min-height: 44px;/, '开关点击区不小于 44px');
	assert.match(src, /<div class="card"><h3>隐私<\/h3>[^\n]*\$\{STATS_NOTE\}[^\n]*data-pref="stats" aria-pressed="\$\{statsOn\}"/, '设置里的隐私卡和开关');
	assert.match(src, /meTab = d\.metab; tm\.track\('metab', meTab\); renderPanel\(\);/, '切分栏记一次（只记分栏名）');
});
