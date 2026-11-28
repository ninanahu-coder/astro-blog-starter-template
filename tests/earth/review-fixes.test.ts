// v106：四维检查（2026-11-28）查出的 1 条高、5 条中级问题的回归测试。
//   1. 随机数密钥：行情和检定过 128 位密钥，不再能从行情价穷举种子
//   2. 事件至少有一个不花钱的选项（酒庄品酒把没钱的玩家卡住）
//   3. 屏蔽 / 举报落盘带上原存档（不丢别的分支的字段）
//   4. 不认识的成就、物品、工作 id 寄存起来，不删
//   5/6. 在线频道：没有存档的连接只能旁观
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld, routeEarth } from '../../src/game/server/world.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { publicState } from '../../src/game/core/actions.ts';
import { resolveEvent, roll } from '../../src/game/core/engine.ts';
import { validateEvents } from '../../src/game/core/event-rules.ts';
import { marketKeyOf, marketView, priceOn, shock } from '../../src/game/core/market.ts';
import { keyOf, prf32, RNG_KEY_RE, secretSeed } from '../../src/game/core/prf.ts';
import { HELD_MAX, stash, unstash } from '../../src/game/core/held.ts';
import { ASSETS } from '../../src/game/data/assets.ts';
import { ACHIEVEMENTS } from '../../src/game/data/achievements.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import type { GameEvent, PlayerState } from '../../src/game/core/types.ts';

const KEY_A = '00112233445566778899aabbccddeeff';
const KEY_B = '00112233445566778899aabbccddeefe'; // 只差最后一位
const LOCS = new Set(WORLD.locations.map((l) => l.id));
const fresh = (over: Partial<Parameters<typeof createCharacter>[0]> = {}): PlayerState =>
	createCharacter({ id: 'review-fix-01', name: '测试', avatar: '🧑', origin: 'student', region: 'wa', spawn: WORLD.spawn, seed: 12345, ...over });
const clean = (s: unknown) => sanitizeState(s, LOCS, { fallbackLoc: WORLD.spawn })!;

function makeWorld() {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		delete: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) data.delete(x); },
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, world };
}
const profile = { name: '测试', avatar: '🧑', origin: 'student', traits: [] };
const A = { id: 'review-player-a', key: 'a'.repeat(24) };
const B = { id: 'review-player-b', key: 'b'.repeat(24) };

// ---------- 1. 随机数密钥 ----------

test('prf32：同样的输入同样的输出；密钥或输入差一位，输出平均翻转约一半的位', () => {
	assert.equal(prf32(KEY_A, 1, 2, 3, 4), prf32(KEY_A, 1, 2, 3, 4));
	const bits = (x: number) => { let n = 0; for (let v = x >>> 0; v; v >>>= 1) n += v & 1; return n; };
	let byKey = 0;
	let byInput = 0;
	const N = 2000;
	for (let i = 0; i < N; i++) {
		byKey += bits(prf32(KEY_A, i, 7, 0, 0) ^ prf32(KEY_B, i, 7, 0, 0));
		byInput += bits(prf32(KEY_A, i, 7, 0, 0) ^ prf32(KEY_A, i, 7, 0, 1));
	}
	for (const [name, sum] of [['密钥', byKey], ['输入', byInput]] as const) {
		const avg = sum / N;
		assert.ok(avg > 15 && avg < 17, `${name}差一位，平均翻转 ${avg.toFixed(2)} 位，应在 16 左右`);
	}
});

test('roll：没有密钥走旧算法（结果和以前逐位相同）；有密钥时结果不同、仍在 [0,1)、分布均匀，种子照样每次前进一步', () => {
	const legacy = fresh();
	const keyed = fresh({ rngKey: KEY_A });
	assert.equal(legacy.rngKey, '');
	assert.equal(keyed.rngKey, KEY_A);
	// 旧算法的固定值：mulberry32，种子 12345 的前三个数。改了这三个数说明模拟和基线会跟着变
	const mulberry = (seed: number) => { let t = (seed + 0x6d2b79f5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
	let s = 12345;
	for (let i = 0; i < 3; i++) {
		assert.equal(roll(legacy), mulberry(s));
		s = (s + 0x6d2b79f5) >>> 0;
	}
	const other = fresh({ rngKey: KEY_B });
	let sum = 0;
	let same = 0;
	const N = 20000;
	const plain = fresh();
	for (let i = 0; i < N; i++) {
		const r = roll(keyed);
		assert.ok(r >= 0 && r < 1);
		sum += r;
		if (r === roll(plain)) same++;
		if (r === roll(other)) same++;
	}
	assert.equal(keyed.seed, plain.seed, '有没有密钥，种子都按同一个步长前进');
	assert.ok(Math.abs(sum / N - 0.5) < 0.01, `均值 ${(sum / N).toFixed(4)}`);
	assert.equal(same, 0, '换一把密钥或不用密钥，结果都对不上');
});

test('行情：换算法那天及以前的价格和旧算法一样，之后的不一样；不同密钥走势不同', () => {
	const def = ASSETS.find((a) => a.vol > 0)!;
	const seed = 987654321;
	const from = 40;
	for (let d = 0; d <= from; d++) assert.equal(priceOn(def, seed, d, { key: KEY_A, from }), priceOn(def, seed, d), `第 ${d} 天`);
	let diffLegacy = 0;
	let diffKey = 0;
	for (let d = from + 1; d <= from + 30; d++) {
		if (priceOn(def, seed, d, { key: KEY_A, from }) !== priceOn(def, seed, d)) diffLegacy++;
		if (priceOn(def, seed, d, { key: KEY_A, from }) !== priceOn(def, seed, d, { key: KEY_B, from })) diffKey++;
	}
	assert.equal(diffLegacy, 30);
	assert.equal(diffKey, 30);
	// 带密钥的 z 仍是标准正态：均值约 0、方差约 1
	let m = 0;
	let v = 0;
	const N = 20000;
	for (let d = 1; d <= N; d++) { const z = shock(seed, def.id, d, KEY_A); m += z; v += z * z; }
	assert.ok(Math.abs(m / N) < 0.03, `均值 ${(m / N).toFixed(4)}`);
	assert.ok(Math.abs(v / N - 1) < 0.05, `方差 ${(v / N).toFixed(4)}`);
});

test('从发给客户端的行情价对不上行情种子：用真种子按旧算法重算，和带密钥的行情不一致', () => {
	const s = { ...fresh({ rngKey: KEY_A }), clock: 60 * 1440 };
	assert.deepEqual(marketKeyOf(s), { key: KEY_A, from: 0 });
	const quotes = marketView(s);
	const legacy = marketView({ ...s, rngKey: '' });
	for (const def of ASSETS.filter((a) => a.vol > 0)) assert.notDeepEqual(quotes[def.id], legacy[def.id], def.id);
	const pub = publicState(s);
	assert.equal(pub.rngKey, '', '密钥不发给客户端');
	assert.equal(pub.seed, 0);
	assert.equal(pub.marketSeed, 0);
	assert.deepEqual(pub.held, {});
	assert.deepEqual(pub.quotes, quotes);
});

test('secretSeed：有密钥时换成派生数，推不回原种子；没有密钥原样返回', () => {
	const legacy = fresh();
	assert.equal(secretSeed(legacy, 0), legacy.seed);
	assert.equal(secretSeed(legacy, 1), legacy.marketSeed);
	const keyed = fresh({ rngKey: KEY_A });
	assert.notEqual(secretSeed(keyed, 0), keyed.seed);
	assert.notEqual(secretSeed(keyed, 1), keyed.marketSeed);
	assert.notEqual(secretSeed(keyed, 0), secretSeed({ ...keyed, rngKey: KEY_B }, 0));
	assert.equal(keyOf({ rngKey: 'xyz' }), '', '格式不对的密钥当作没有');
});

test('清洗：密钥只认 32 位十六进制，坏值变空串；没有密钥时 rngDay 归零；新建角色过一遍清洗不变', () => {
	const s = fresh({ rngKey: KEY_A });
	assert.deepEqual(clean(s), s);
	assert.equal(clean({ ...s, rngDay: 12 }).rngDay, 12);
	for (const bad of [null, 5, 'XYZ', KEY_A.toUpperCase(), KEY_A + '0', [], {}]) {
		const c = clean({ ...s, rngKey: bad, rngDay: 12 });
		assert.equal(c.rngKey, '');
		assert.equal(c.rngDay, 0);
	}
	const old = { ...s } as Record<string, unknown>;
	delete old.rngKey;
	delete old.rngDay;
	delete old.held;
	const c = clean(old);
	assert.equal(c.rngKey, '');
	assert.deepEqual(c.held, {});
});

test('服务端：新角色带密钥；没有密钥的旧存档读一次就补上并落盘，今天及以前的行情不变', async () => {
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...A, profile });
	assert.equal(created.data.state.rngKey, '');
	const saved = w.data.get('save:' + A.id).state;
	assert.match(saved.rngKey, RNG_KEY_RE);
	assert.equal(saved.rngDay, 0);
	// 改成旧存档：没有密钥，时钟在第 50 天
	const rec = w.data.get('save:' + A.id);
	const { rngKey: _k, rngDay: _d, held: _h, ...old } = rec.state;
	const oldState = { ...old, clock: 50 * 1440 + 600 };
	w.data.set('save:' + A.id, { ...rec, state: oldState });
	const before = marketView(clean(oldState));
	const got = await w.call({ action: 'get', ...A });
	assert.equal(got.status, 200);
	const after = w.data.get('save:' + A.id).state;
	assert.match(after.rngKey, RNG_KEY_RE);
	assert.notEqual(after.rngKey, saved.rngKey);
	assert.equal(after.rngDay, 50);
	assert.deepEqual(got.data.state.quotes, before, '补密钥当天，玩家看到的 30 天行情和之前一样');
	// 再读一次：密钥不换
	await w.call({ action: 'get', ...A });
	assert.equal(w.data.get('save:' + A.id).state.rngKey, after.rngKey);
	// 往后一天：新的一天按密钥算，和旧算法不同；前 29 天仍和旧算法一样
	const next = { ...after, clock: 51 * 1440 + 600 };
	const keyed = marketView(next);
	const legacy = marketView({ ...next, rngKey: '', rngDay: 0 });
	for (const def of ASSETS.filter((a) => a.vol > 0)) {
		assert.deepEqual(keyed[def.id].slice(0, -1), legacy[def.id].slice(0, -1), def.id);
		assert.notEqual(keyed[def.id].at(-1), legacy[def.id].at(-1), def.id);
	}
});

// ---------- 2. 事件至少一个不花钱的选项 ----------

test('事件校验：所有选项都收费的事件报错；现有事件全部通过', () => {
	assert.deepEqual(validateEvents(EVENTS), []);
	const paid: GameEvent = { id: 'all-paid', title: 't', icon: '🍷', weight: 1, text: 'x', choices: [{ label: 'a', cost: 5, ok: { text: 'a', fx: {} } }, { label: 'b', cost: 1, ok: { text: 'b', fx: {} } }] } as GameEvent;
	assert.match(validateEvents([paid]).join('\n'), /所有选项都要花钱/);
	const ok: GameEvent = { ...paid, choices: [...paid.choices, { label: 'c', ok: { text: 'c', fx: {} } }] } as GameEvent;
	assert.deepEqual(validateEvents([ok]), []);
});

test('酒庄品酒：身上一分钱没有也能选一个选项脱身', () => {
	const ev = EVENTS.find((e) => e.id === 'margaret-cellar')!;
	const s = { ...fresh(), cash: 0, loc: 'margaret-river', pending: { eventId: ev.id } };
	const results = ev.choices.map((_, i) => resolveEvent(s, WORLD, i));
	const done = results.filter((r) => r.ok);
	assert.ok(done.length >= 1, '至少一个选项能选');
	for (const r of done) {
		assert.equal(r.state.pending, null);
		assert.equal(r.state.cash, 0);
	}
});

// ---------- 3. 屏蔽 / 举报落盘带上原存档 ----------

test('屏蔽、取消屏蔽落盘时保留别的分支加的字段', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...A, profile });
	await w.call({ action: 'create', ...B, profile: { ...profile, name: '乙' } });
	const hashB = [...w.data.entries()].find(([k, v]) => k.startsWith('h:') && v === B.id)![0].slice(2);
	const rec = w.data.get('save:' + A.id);
	w.data.set('save:' + A.id, { ...rec, state: { ...rec.state, otherBranchField: { kept: 1 } } });
	const got = await w.call({ action: 'get', ...A });
	const blocked = await w.call({ action: 'safety', op: 'block', peer: hashB, rev: got.data.state.rev, ...A });
	assert.ok(blocked.data.ok, blocked.data.msg);
	assert.deepEqual(w.data.get('save:' + A.id).state.otherBranchField, { kept: 1 }, '屏蔽之后还在');
	assert.ok(Object.hasOwn(w.data.get('save:' + A.id).state.blocked, hashB));
	const un = await w.call({ action: 'safety', op: 'unblock', hash: hashB, rev: blocked.data.state.rev, ...A });
	assert.ok(un.data.ok, un.data.msg);
	assert.deepEqual(w.data.get('save:' + A.id).state.otherBranchField, { kept: 1 }, '取消屏蔽之后还在');
	assert.equal(blocked.data.state.otherBranchField, undefined, '未知字段不发给客户端');
});

// ---------- 4. 不认识的 id 寄存 ----------

test('寄存：这版不认识的成就、打卡、物品、工作不删，放进 held；清洗幂等', () => {
	const ach = ACHIEVEMENTS[0].id;
	const item = ITEMS[0].id;
	const raw = {
		...fresh(),
		achClaimed: [ach, 'future-ach'],
		checkins: ['future-poi'],
		inventory: { [item]: 1, 'future-item': 3 },
		job: { career: 'future-career', loc: WORLD.spawn, level: 2, shifts: 9, good: 4, lastDay: 3 },
	};
	const c = clean(raw);
	assert.deepEqual(c.achClaimed, [ach]);
	assert.deepEqual(c.inventory, { [item]: 1 });
	assert.equal(c.job, null);
	assert.deepEqual(c.held, {
		lists: { checkins: ['future-poi'], achClaimed: ['future-ach'] },
		inv: { 'future-item': 3 },
		job: { career: 'future-career', loc: WORLD.spawn, level: 2, shifts: 9, good: 4, lastDay: 3 },
	});
	assert.deepEqual(clean(c), c, '再清洗一次不变');
	// 落盘再读（JSON 往返）也不变
	assert.deepEqual(clean(JSON.parse(JSON.stringify(c))), c);
});

test('寄存：认识这些 id 的代码回来后，成就回到已领清单（不能再领一次），物品和工作回到原处', () => {
	const ach = ACHIEVEMENTS[0].id;
	const item = ITEMS[0].id;
	const career = 'barista';
	// 模拟「旧代码」留下的存档：这些 id 当时不认识，都在 held 里
	const parked = {
		...fresh(),
		held: { lists: { achClaimed: [ach] }, inv: { [item]: 2 }, job: { career, loc: WORLD.spawn, level: 0, shifts: 5, good: 1, lastDay: 2 } },
	};
	const c = clean(parked);
	assert.deepEqual(c.achClaimed, [ach]);
	assert.equal(c.inventory[item], 2);
	assert.equal(c.job?.career, career);
	assert.equal(c.job?.shifts, 5);
	assert.deepEqual(c.held, {});
	// 期间玩家又找了别的工作：寄存的工作不顶掉现在的，也不再留着
	const working = clean({ ...parked, job: { career: 'barista', loc: WORLD.spawn, level: 0, shifts: 1, good: 0, lastDay: 1 }, held: { job: { career: 'future-career', loc: WORLD.spawn, level: 3, shifts: 0, good: 0, lastDay: 0 } } });
	assert.equal(working.job?.shifts, 1);
	assert.deepEqual(working.held, {});
});

test('寄存：坏值不抛异常；有上限；奇怪的 id 不收', () => {
	for (const bad of [null, 5, 'x', [], { lists: 5 }, { lists: { achClaimed: 'x' } }, { inv: [] }, { job: 'x' }, { lists: { achClaimed: [1, null, {}] } }, { lists: { __proto__: ['x'] } }]) {
		const c = clean({ ...fresh(), held: bad });
		assert.deepEqual(c.held, {}, JSON.stringify(bad));
	}
	const many = Array.from({ length: 300 }, (_, i) => 'future-' + i);
	const c = clean({ ...fresh(), achClaimed: many, inventory: Object.fromEntries(many.map((id) => [id, 1])) });
	assert.ok(c.held.lists!.achClaimed.length <= HELD_MAX);
	assert.ok(Object.keys(c.held.inv!).length <= HELD_MAX);
	assert.deepEqual(clean(c), c);
	const weird = clean({ ...fresh(), achClaimed: ['<script>', 'a b', '', 'x'.repeat(80)], inventory: { '<b>': 1, ok_item: Number.NaN, 'neg-item': -2 } });
	assert.deepEqual(weird.held, {});
	// unstash 不改入参，没有寄存内容时原样返回
	const plain = { a: 1 };
	assert.equal(unstash(plain), plain);
	const withHeld = { achClaimed: ['a'], held: { lists: { achClaimed: ['b'] } } };
	assert.deepEqual(unstash(withHeld).achClaimed, ['a', 'b']);
	assert.deepEqual(withHeld.achClaimed, ['a']);
	assert.deepEqual(stash({ job: { career: 'known', loc: 'perth' } }, { job: null }, () => true), {}, '职业认识、只是地点没了的工作不寄存');
});

// ---------- 5/6. 在线频道：没有存档的连接只能旁观 ----------

class FakeSock {
	sent: string[] = [];
	accept() {}
	send(m: string) { this.sent.push(m); }
	close() {}
	addEventListener() {}
}
function fakePair(t: { after: (fn: () => void) => void }) {
	const g = globalThis as any;
	const had = 'WebSocketPair' in g;
	const prev = g.WebSocketPair;
	g.WebSocketPair = function () { return [new FakeSock(), new FakeSock()]; };
	t.after(() => { if (had) g.WebSocketPair = prev; else delete g.WebSocketPair; });
}

test('在线频道：没有存档的连接不能自己起名字，不能聊天、发表情；有存档的照常', async (t) => {
	fakePair(t);
	const w = makeWorld();
	const world = w.world as any;
	// Node 的 Response 不接受 101：连接已经登记，构造响应时抛错不影响这里要测的内容
	const open = (id: string, extra: string) => world.fetch(new Request(`https://example.test/api/earth/ws?region=wa&id=${id}&name=${encodeURIComponent('管理员')}&avatar=${encodeURIComponent('👑')}&loc=perth${extra}`, { headers: { Upgrade: 'websocket' } })).catch(() => null);
	await open('guest-conn-000001', '');
	await open('guest-conn-000002', '&known=0');
	await open('saved-conn-000001', '&known=1');
	const socks = [...world.sockets.entries()] as [FakeSock, { id: string; name: string; avatar: string }][];
	assert.equal(socks.length, 3);
	const [g1, g2, real] = socks;
	assert.equal(g1[1].name, '旅人');
	assert.equal(g1[1].avatar, '🧑');
	assert.equal(g2[1].name, '旅人');
	assert.equal(real[1].name, '管理员');
	const locs = new Set(WORLD.locations.map((l) => l.id));
	const chatsAt = (s: FakeSock) => s.sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'chat');
	world.onMessage(g1[0], JSON.stringify({ t: 'chat', text: '大家好' }), locs);
	assert.equal(chatsAt(real[0]).length, 0, '没有存档的连接发的聊天不转发');
	assert.match(g1[0].sent.map((m) => JSON.parse(m)).find((m) => m.t === 'notice')?.msg ?? '', /先创建角色/);
	world.onMessage(g1[0], JSON.stringify({ t: 'emote', kind: JSON.parse(g1[0].sent[0]).emotes[0], to: real[1].id }), locs);
	assert.equal(real[0].sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'emote').length, 0, '表情也不转发');
	world.onMessage(real[0], JSON.stringify({ t: 'chat', text: '大家好' }), locs);
	assert.equal(chatsAt(g1[0]).length, 1, '有存档的照常能说话，旁观的人看得到');
	world.onMessage(real[0], JSON.stringify({ t: 'emote', kind: JSON.parse(real[0].sent[0]).emotes[0], to: g1[1].id }), locs);
	assert.equal(g1[0].sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'emote').length, 1);
	world.onClose(g1[0]);
	assert.equal(world.guests.has(g1[0]), false, '断开后清掉旁观标记');
	// 全部断开：留着连接的话，清理心跳的定时器会让测试进程退不出去
	for (const [sock] of socks) world.onClose(sock);
	assert.equal(world.sockets.size, 0);
});

test('routeEarth：转发在线频道连接前先向存档实例查有没有存档；客户端自己带的 known 被覆盖', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...A, profile });
	const seen: string[] = [];
	const env = {
		EARTH_WORLD: {
			idFromName: (name: string) => name,
			get: (name: string) => ({
				fetch: async (req: Request) => {
					if (name === '@SAVES') return w.world.fetch(req);
					seen.push(`${name} ${new URL(req.url).searchParams.get('known')} ${req.headers.get('Upgrade')}`);
					return new Response('ok');
				},
			}),
		},
	};
	const ws = (id: string, extra = '') => routeEarth(new Request(`https://example.test/api/earth/ws?region=wa&id=${id}${extra}`, { headers: { Upgrade: 'websocket' } }), env)!;
	await ws(A.id);
	await ws('never-created-0001', '&known=1');
	await ws('bad', '&known=1');
	assert.deepEqual(seen, ['wa 1 websocket', 'wa 0 websocket', 'wa 0 websocket']);
	// 存档实例查询出错：按没有存档算
	const broken = { EARTH_WORLD: { idFromName: (n: string) => n, get: (n: string) => ({ fetch: async (req: Request) => { if (n === '@SAVES') throw new Error('down'); seen.push(new URL(req.url).searchParams.get('known')!); return new Response('ok'); } }) } };
	await routeEarth(new Request(`https://example.test/api/earth/ws?region=wa&id=${A.id}`, { headers: { Upgrade: 'websocket' } }), broken)!;
	assert.equal(seen.at(-1), '0');
	// 内部查询路径外部到不了
	assert.equal(routeEarth(new Request(`https://example.test/api/earth/known?id=${A.id}`), env), null);
});
