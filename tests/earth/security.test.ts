// 安全加固（v40）的回归测试：限流、请求体上限、连接数上限、安全响应头。
// 威胁模型和问题清单见 docs/earth-game/security-review.md，测试名里的编号对应文档里的问题编号。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { ipKey, RateLimiter, readBounded } from '../../src/game/server/ratelimit.ts';
import { WA } from '../../src/game/data/wa.ts';

function makeWorld() {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>, ip?: string) => {
		const headers: Record<string, string> = {};
		if (ip) headers['CF-Connecting-IP'] = ip;
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body), headers }));
		return { status: res.status, headers: res.headers, data: (await res.json()) as any };
	};
	return { data, world, call };
}
const profile = { name: '测试', avatar: '🧑', origin: 'student', traits: [] };
const KEY = 'k'.repeat(24);

test('S-08 来源地址归一：IPv6 按 /64 算，IPv4 和 IPv4 映射地址按完整地址算', () => {
	assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:ffff:eeee:dddd:cccc'), '同一 /64 里换地址还是同一个键');
	assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'), '不同 /64 是不同的键');
	assert.equal(ipKey('2001:0db8:0001:0002::1'), ipKey('2001:db8:1:2::9'), '前导零写法不同也是同一个键');
	assert.equal(ipKey('2001:db8::1'), ipKey('2001:db8:0:0:1::'), "'::' 展开后再取前缀");
	assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
	assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
	assert.notEqual(ipKey('::ffff:203.0.113.7'), ipKey('::ffff:203.0.113.8'), '映射地址不挤进同一个 /64');
	assert.equal(ipKey(null), 'local');
	assert.equal(ipKey(''), 'local');
});

test('S-08 限流表：满了不再整表清空，正在刷的来源的计数换地址也挤不掉', () => {
	const r = new RateLimiter(2, 1000, 10);
	assert.ok(r.hit('heavy', 0));
	assert.ok(r.hit('heavy', 1));
	assert.equal(r.hit('heavy', 2), false, '超过上限被拦');
	for (let i = 0; i < 50; i++) r.hit('rot-' + i, 3); // 换着地址把表挤满好几轮
	assert.ok(r.size <= 10, '表的大小有上限');
	assert.equal(r.hit('heavy', 4), false, '主地址的计数还在，仍然被拦');
	assert.ok(r.hit('heavy', 1002), '窗口过了恢复');
});

test('S-09 请求体边读边数：声明超限、分块超限都返回 null，不超限照常读出（含多字节字符）', async () => {
	const big = new Request('https://x.test/', { method: 'POST', body: 'x'.repeat(2000) });
	assert.equal(await readBounded(big, 1000), null);
	const enc = new TextEncoder();
	let pulled = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(c) {
			pulled++;
			if (pulled > 1000) return c.close();
			c.enqueue(enc.encode('y'.repeat(100)));
		},
	});
	const chunked = new Request('https://x.test/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
	assert.equal(await readBounded(chunked, 1000), null);
	assert.ok(pulled < 50, `超限后立刻停，不把剩下的都读完（读了 ${pulled} 块）`);
	const ok = new Request('https://x.test/', { method: 'POST', body: '地球人生' });
	assert.equal(await readBounded(ok, 1000), '地球人生');
	assert.equal(await readBounded(new Request('https://x.test/', { method: 'POST', body: '地球人生' }), 11), null, '按字节算：4 个汉字 12 字节');
});

test('S-05 新建角色按来源限流：同一网络每小时 20 个，换 /64 里的地址也算在一起，别的网络不受影响', async () => {
	const w = makeWorld();
	for (let i = 0; i < 20; i++) {
		const r = await w.call({ action: 'create', id: `bulk-${i}-abcdef`, key: KEY, profile }, `2001:db8:5:5::${i + 1}`);
		assert.equal(r.status, 200, `第 ${i + 1} 个`);
	}
	const over = await w.call({ action: 'create', id: 'bulk-over-abcdef', key: KEY, profile }, '2001:db8:5:5:ffff::9');
	assert.equal(over.status, 429);
	assert.equal(w.data.has('save:bulk-over-abcdef'), false, '被拦的没有落盘');
	assert.equal((await w.call({ action: 'create', id: 'other-net-abcdef', key: KEY, profile }, '198.51.100.4')).status, 200, '别的网络照常');
	// 已有角色的读取、动作不受新建限流影响
	assert.equal((await w.call({ action: 'get', id: 'bulk-0-abcdef', key: KEY }, '2001:db8:5:5::1')).status, 200);
	// 格式不对的请求不占名额
	const w2 = makeWorld();
	for (let i = 0; i < 30; i++) await w2.call({ action: 'create', id: 'x', key: KEY, profile }, '192.0.2.1');
	assert.equal((await w2.call({ action: 'create', id: 'fresh-player-1', key: KEY, profile }, '192.0.2.1')).status, 200);
});

test('S-09 存档接口的响应不进缓存、不让浏览器猜类型', async () => {
	const w = makeWorld();
	const r = await w.call({ action: 'create', id: 'header-check-1', key: KEY, profile });
	assert.equal(r.headers.get('Cache-Control'), 'no-store');
	assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('S-06 聊天按来源限流：10 秒内 6 句，同一来源开几个连接也算在一起；别的来源、别的消息不受影响', (t) => {
	let clock = 1_000_000;
	t.mock.method(Date, 'now', () => clock);
	const w = makeWorld();
	const world = w.world as any;
	const box = (loc: string) => ({ got: [] as any[], loc, send(m: string) { this.got.push(JSON.parse(m)); } });
	const a1 = box('perth'), a2 = box('perth'), b = box('perth'), ear = box('perth');
	for (const [ws, id, ip] of [[a1, 'aaaaaaaaaaaa', '203.0.113.1'], [a2, 'aaaaaaaaaaab', '203.0.113.1'], [b, 'bbbbbbbbbbbb', '203.0.113.2'], [ear, 'cccccccccccc', '203.0.113.3']] as const) {
		world.sockets.set(ws, { id, name: id, avatar: '🧑', loc: 'perth' });
		world.sockIp.set(ws, ip);
	}
	const locs = new Set(WA.locations.map((l) => l.id));
	const chats = () => ear.got.filter((m) => m.t === 'chat').length;
	for (let i = 0; i < 4; i++) world.onMessage(a1, JSON.stringify({ t: 'chat', text: 'spam' + i }), locs);
	for (let i = 0; i < 4; i++) world.onMessage(a2, JSON.stringify({ t: 'chat', text: 'spam' + i }), locs);
	assert.equal(chats(), 6, '两个连接合计只放过 6 句');
	world.onMessage(b, JSON.stringify({ t: 'chat', text: 'hi' }), locs);
	assert.equal(chats(), 7, '别的来源照常');
	world.onMessage(a1, JSON.stringify({ t: 'ping' }), locs);
	assert.ok(a1.got.some((m) => m.t === 'pong'), '心跳不受聊天限流影响');
	clock += 10_001;
	world.onMessage(a1, JSON.stringify({ t: 'chat', text: 'later' }), locs);
	assert.equal(chats(), 8, '窗口过了恢复');
});

test('S-04 在线频道按来源限连接数：同一网络最多 6 个，断开一个就能再连；别的网络不受影响', async (t) => {
	class FakeSock {
		sent: string[] = [];
		listeners: Record<string, (() => void)[]> = {};
		accept() {}
		send(m: string) { this.sent.push(m); }
		close() {}
		addEventListener(ev: string, fn: () => void) { (this.listeners[ev] ??= []).push(fn); }
	}
	const g = globalThis as any;
	const had = 'WebSocketPair' in g;
	const prev = g.WebSocketPair;
	g.WebSocketPair = function () { return [new FakeSock(), new FakeSock()]; };
	t.after(() => { if (had) g.WebSocketPair = prev; else delete g.WebSocketPair; });
	const w = makeWorld();
	const world = w.world as any;
	// Node 的 Response 不接受 101，真实运行时才接受：连接已经登记，构造响应时抛错不影响这里要测的计数
	const open = (ip: string, n: number) =>
		world.fetch(new Request(`https://example.test/api/earth/ws?region=wa&id=sock-${n}-abcdef&loc=perth`, { headers: { Upgrade: 'websocket', 'CF-Connecting-IP': ip } })).catch(() => null);
	for (let i = 0; i < 6; i++) await open('203.0.113.9', i);
	assert.equal(world.sockets.size, 6);
	const over = await open('203.0.113.9', 99);
	assert.equal(over?.status, 429, '第 7 个被拒');
	assert.equal(world.sockets.size, 6);
	await open('198.51.100.9', 7);
	assert.equal(world.sockets.size, 7, '别的网络照常');
	const first = [...world.sockets.keys()][0];
	for (const fn of first.listeners.close ?? []) fn();
	await open('203.0.113.9', 100);
	assert.equal(world.sockets.size, 7, '断开一个后能再连');
	assert.equal([...world.sockIp.values()].filter((v: string) => v === '203.0.113.9').length, 6);
	clearInterval(world.sweeper);
});

test('S-10 静态页安全响应头：禁止被嵌进框架、禁止改 base、禁止插件、不猜类型；定位只给本站', () => {
	const raw = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
	const lines = raw.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
	assert.equal(lines[0], '/*', '对所有静态路径生效');
	const h = new Map(lines.slice(1).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
	const csp = h.get('content-security-policy') ?? '';
	for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
	assert.ok(!/unsafe-eval/.test(csp), '不放开 eval');
	assert.equal(h.get('x-frame-options'), 'DENY');
	assert.equal(h.get('x-content-type-options'), 'nosniff');
	assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
	assert.match(h.get('permissions-policy') ?? '', /geolocation=\(self\)/, 'GPS 打卡要用定位');
	assert.match(h.get('permissions-policy') ?? '', /camera=\(\)/);
});
