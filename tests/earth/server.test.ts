// 云存档服务端（EarthWorld）的回归测试：用内存里的假存储直接调 fetch()，不联网。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { WA } from '../../src/game/data/wa.ts';
import { goalOfWeek, weekOf } from '../../src/game/core/weekly.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';

/** delayMs > 0 时每次读写都真的等一会儿，让同时到的请求在没有锁的情况下一定会交错（读到同一份旧存档） */
/** hooks 让测试精确安排先后：put 写入前先等 hooks.put()，list 读完、返回前等 hooks.list() */
function makeWorld(delayMs = 0, hooks: { put?: (k: string | Record<string, unknown>) => Promise<void>; list?: () => unknown } = {}) {
	const data = new Map<string, any>();
	let puts = 0;
	const wait = () => (delayMs ? new Promise((done) => setTimeout(done, delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			await wait();
			if (hooks.put) await hooks.put(k);
			puts++;
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => {
			await wait();
			const out = new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)]));
			await hooks.list?.();
			return out;
		},
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, world, puts: () => puts };
}
const ID = 'server-test-player';
const KEY = 'k'.repeat(24);
const cred = { id: ID, key: KEY };
const profile = { name: '测试', avatar: '🧑', origin: 'student', traits: [] };

test('服务端：创建、读取、动作都带服务器时间，版本冲突不执行', async () => {
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...cred, profile });
	assert.equal(created.status, 200);
	assert.equal(typeof created.data.at, 'number');
	assert.equal(created.data.state.seed, 0, '种子不外泄');
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.status, 200);
	assert.equal(typeof got.data.at, 'number');
	const act = await w.call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.ok(act.data.ok, act.data.msg);
	assert.equal(typeof act.data.at, 'number');
	const stale = await w.call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.equal(stale.status, 409);
	assert.equal(typeof stale.data.at, 'number');
	assert.equal(stale.data.state.rev, act.data.state.rev, '冲突时还回最新存档，没有再执行');
	assert.equal((await w.call({ action: 'get', id: ID, key: 'x'.repeat(24) })).status, 403, '同步码不对读不到');
});

test('服务端：存档里的所在地已不存在时挪到出生点并写回，进度保留', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, loc: 'removed-loc', cash: 4321 } });
	const before = w.puts();
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.status, 200, got.data.msg);
	assert.equal(got.data.state.loc, WA.spawn);
	assert.equal(got.data.state.cash, 4321);
	assert.equal(w.puts(), before + 1, '修过的存档写回一次');
	assert.equal(w.data.get('save:' + ID).state.loc, WA.spawn);
	await w.call({ action: 'get', ...cred });
	assert.equal(w.puts(), before + 1, '已经修好，再读不再写');
});

test('服务端：每日奖励日期在未来的存档，修正后写回，第二天能正常领', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, daily: { day: 9_000_000, streak: 3 } } });
	const today = realDayOf(Date.now());
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.data.daily, undefined, '当天按已领处理，不白发');
	assert.deepEqual(w.data.get('save:' + ID).state.daily, { day: today, streak: 0 }, '修正后的日期已落盘');
	// 把落盘的日期往前拨一天，模拟第二天上线：只读取就能领到
	const fixed = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...fixed, state: { ...fixed.state, daily: { day: today - 1, streak: 0 } } });
	const next = await w.call({ action: 'get', ...cred });
	assert.match(next.data.daily ?? '', /每日奖励/);
	assert.equal(w.data.get('save:' + ID).state.daily.day, today);
});

test('服务端：同一版本的两个动作同时到，只执行一个', async () => {
	const w = makeWorld(5);
	const created = await w.call({ action: 'create', ...cred, profile });
	const before = w.puts();
	const act = { action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'activity', id: 'rest' } };
	const [a, b] = await Promise.all([w.call(act), w.call(act)]);
	assert.deepEqual([a.status, b.status].sort(), [200, 409]);
	assert.equal(w.puts(), before + 1, '只落盘一次');
	assert.equal(w.data.get('save:' + ID).state.rev, created.data.state.rev + 1);
});

test('服务端：两个读取同时到，每日奖励只发一份', async () => {
	const w = makeWorld(5);
	await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	const today = realDayOf(Date.now());
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, daily: { day: today - 1, streak: 1 } } });
	const cash = rec.state.cash;
	const [a, b] = await Promise.all([w.call({ action: 'get', ...cred }), w.call({ action: 'get', ...cred })]);
	assert.equal([a, b].filter((r) => typeof r.data.daily === 'string').length, 1, '只有一个响应带领奖提示');
	const saved = w.data.get('save:' + ID).state;
	assert.deepEqual(saved.daily, { day: today, streak: 2 });
	assert.ok(saved.cash > cash);
	assert.equal(a.data.state.cash, saved.cash);
	assert.equal(b.data.state.cash, saved.cash);
});

test('服务端：入口保护的状态码', async () => {
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...cred, profile });
	const rev = created.data.state.rev;
	const cases: [string, Record<string, unknown>, number][] = [
		['重复创建', { action: 'create', ...cred, profile }, 409],
		['同步码不对', { action: 'get', id: ID, key: 'x'.repeat(24) }, 403],
		['同步码格式不对', { action: 'get', id: ID, key: 'short' }, 400],
		['没有这个存档', { action: 'get', id: 'nobody-here-1', key: KEY }, 404],
		['动作形状非法', { action: 'act', ...cred, rev, act: { t: 'teleport', to: 'moon' } }, 400],
		['未知请求', { action: 'upload', ...cred, state: { cash: 1e9 } }, 400],
		['请求体过大', { action: 'get', ...cred, pad: 'x'.repeat(60 * 1024) }, 413],
	];
	for (const [name, body, status] of cases) assert.equal((await w.call(body)).status, status, name);
	assert.equal(w.data.get('save:' + ID).state.rev, rev, '这些请求都没有改动存档');
	// 限流：同一来源一分钟内超过上限后被拒
	let last = 200;
	for (let i = 0; i < 100 && last !== 429; i++) last = (await w.call({ action: 'get', ...cred })).status;
	assert.equal(last, 429);
});

test('服务端：被规则拒绝的动作也会把修过的存档写回，但不顺带发奖', async () => {
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	const today = realDayOf(Date.now());
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, daily: { day: 9_000_000, streak: 3 } } });
	// 形状合法但会被规则拒绝的动作：没有工作却去上班
	const r = await w.call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'job', op: 'work' } });
	assert.equal(r.status, 200);
	assert.equal(r.data.ok, false);
	const saved = w.data.get('save:' + ID).state;
	assert.deepEqual(saved.daily, { day: today, streak: 0 }, '修正后的日期已落盘');
	assert.equal(saved.cash, rec.state.cash);
	assert.equal(saved.rev, rec.state.rev, '动作没执行，版本号不变');
});

test('服务端：上传得慢的旧请求排到后面执行时，不会用旧时间冲掉后到请求写入的每日奖励', async (t) => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	// 把时钟定在珀斯时间午夜前 30 秒
	const realNow = Date.now;
	t.after(() => { Date.now = realNow; });
	const midnight = (realDayOf(realNow()) + 2) * 86_400_000 - 8 * 3_600_000;
	let clock = midnight - 30_000;
	Date.now = () => clock;
	const day = realDayOf(clock);
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, daily: { day, streak: 2 } } });
	// 旧请求先到，但请求体迟迟没传完
	let finish!: () => void;
	const body = new ReadableStream<Uint8Array>({
		start(c) { finish = () => { c.enqueue(new TextEncoder().encode(JSON.stringify({ action: 'get', ...cred }))); c.close(); }; },
	});
	const world = w.world;
	const slow = world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body, duplex: 'half' } as RequestInit));
	// 两分钟后（已过午夜）另一个请求到达并领了新一天的奖励
	clock += 120_000;
	const fresh = await w.call({ action: 'get', ...cred });
	assert.match(fresh.data.daily ?? '', /每日奖励/);
	const claimed = w.data.get('save:' + ID).state;
	assert.deepEqual(claimed.daily, { day: day + 1, streak: 3 });
	// 这时旧请求才传完、开始执行
	finish();
	const late = (await (await slow).json()) as any;
	assert.equal(late.daily, undefined, '不重复发奖');
	const after = w.data.get('save:' + ID).state;
	assert.deepEqual(after.daily, { day: day + 1, streak: 3 }, '领奖记录没有被旧请求改回去');
	assert.equal(after.cash, claimed.cash);
	// 同一天再读一次也领不到第二份
	assert.equal((await w.call({ action: 'get', ...cred })).data.daily, undefined);
});

test('服务端：时钟回拨时同一存档的时间不倒退，每日奖励不重复发、定位和上班卡不被清', async (t) => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	const realNow = Date.now;
	t.after(() => { Date.now = realNow; });
	const midnight = (realDayOf(realNow()) + 2) * 86_400_000 - 8 * 3_600_000;
	const day = realDayOf(midnight - 1);
	let clock = midnight + 100;
	Date.now = () => clock;
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, at: midnight - 5000, state: { ...rec.state, daily: { day, streak: 2 } } });
	// 午夜后 100ms 领了新一天的奖励
	const first = await w.call({ action: 'get', ...cred });
	assert.match(first.data.daily ?? '', /每日奖励/);
	const cash = w.data.get('save:' + ID).state.cash;
	// 时钟回拨到午夜前，再回到午夜后：都不能再发
	clock = midnight - 100;
	assert.equal((await w.call({ action: 'get', ...cred })).data.daily, undefined);
	assert.deepEqual(w.data.get('save:' + ID).state.daily, { day: day + 1, streak: 3 }, '领奖记录没有被改回前一天');
	clock = midnight + 200;
	assert.equal((await w.call({ action: 'get', ...cred })).data.daily, undefined);
	assert.equal(w.data.get('save:' + ID).state.cash, cash);
	// 回拨超过一分钟：刚写入的定位和上班卡仍然保留
	const cur = w.data.get('save:' + ID);
	const at = clock;
	w.data.set('save:' + ID, { ...cur, at, state: { ...cur.state, fix: { lat: -31.95, lon: 115.86, at }, clockIn: { venue: 'some-cafe', at }, venueCd: { meal: at } } });
	clock = at - 61_001;
	const back = await w.call({ action: 'get', ...cred });
	assert.equal(back.data.at, at, '响应里的时间也不倒退');
	assert.equal(back.data.state.fix?.at, at);
	assert.equal(back.data.state.clockIn?.at, at);
	assert.equal(back.data.state.venueCd.meal, at);
	// 落盘时间离谱地超前（坏数据）时不跟它走：按真实时间校验，未来的时间戳照常清掉
	const bad = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...bad, at: 1e15, state: { ...bad.state, fix: { lat: -31.95, lon: 115.86, at: 1e15 } } });
	const healed = await w.call({ action: 'get', ...cred });
	assert.equal(healed.data.at, clock);
	assert.equal(healed.data.state.fix, null);
});

test('服务端：区域名是 constructor / toString / __proto__ 时不会报错', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	for (const region of ['constructor', 'toString', '__proto__', 'nowhere']) {
		// 在线频道：未知区域一律 404，不能因为命中 Object.prototype 而抛异常
		const res = await w.world.fetch(new Request(`https://example.test/api/earth/ws?region=${region}&id=${ID}`, { headers: { Upgrade: 'websocket' } }));
		assert.equal(res.status, 404, region);
		// 云存档里的区域字段损坏：退回西澳，存档照常能用，区域字段被改正
		const rec = w.data.get('save:' + ID);
		w.data.set('save:' + ID, { ...rec, state: { ...rec.state, region } });
		const got = await w.call({ action: 'get', ...cred });
		assert.equal(got.status, 200, `${region}: ${got.data.msg}`);
		assert.equal(got.data.state.region, 'wa');
		assert.equal(w.data.get('save:' + ID).state.region, 'wa', '改正后的区域已落盘');
	}
});

test('服务端：版本号损坏的存档归零后能连续操作，不会每次都版本冲突', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, rev: 1e300, cash: 1e300 } });
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.data.state.rev, 0);
	assert.equal(got.data.state.cash, 1e9, '现金钳到上限');
	let rev = got.data.state.rev;
	for (let i = 0; i < 3; i++) {
		const r = await w.call({ action: 'act', ...cred, rev, act: { t: 'activity', id: 'recycle' } });
		assert.equal(r.status, 200, `第 ${i + 1} 次动作：${r.data.msg}`);
		assert.ok(r.data.ok, r.data.msg);
		assert.equal(r.data.state.rev, rev + 1);
		assert.equal(r.data.state.cash, 1e9, '已在上限，挣了钱也不超过上限');
		rev = r.data.state.rev;
		assert.equal(w.data.get('save:' + ID).state.rev, rev, '落盘的版本号和响应一致');
	}
});

test('服务端：落盘的存档永远是规范形式（再校验一次不变），响应和落盘一致', async () => {
	const { sanitizeState } = await import('../../src/game/core/character.ts');
	const locs = new Set(WA.locations.map((l) => l.id));
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...cred, profile });
	const rec = w.data.get('save:' + ID);
	// 班次计数顶在校验上限上（只有损坏的存档会这样），再上一个班会让它越过上限
	w.data.set('save:' + ID, { ...rec, state: { ...rec.state, job: { career: 'barista', loc: 'perth', level: 0, shifts: 1e300, good: 0, lastDay: -1 } } });
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.data.state.job.shifts, 1e6);
	const r = await w.call({ action: 'act', ...cred, rev: got.data.state.rev, act: { t: 'job', op: 'work' } });
	assert.ok(r.data.ok, r.data.msg);
	const saved = w.data.get('save:' + ID).state;
	assert.ok(saved.job.shifts <= 1e6, `班次 ${saved.job.shifts} 不越过上限`);
	assert.deepEqual(sanitizeState(saved, locs, { fallbackLoc: WA.spawn, now: Date.now() }), saved, '落盘的存档再校验一次不变');
	const { quotes, ...shown } = r.data.state;
	assert.deepEqual({ ...shown, seed: saved.seed, marketSeed: saved.marketSeed }, saved, '响应和落盘一致（除了隐藏的种子、行情种子和附带的行情）');
	assert.equal(r.data.state.marketSeed, 0, '行情种子不发给客户端');
	assert.ok(quotes && Object.values(quotes).every((q) => Array.isArray(q) && q.length >= 1), '响应带着行情');
	assert.equal(saved.quotes, undefined, '落盘的存档里没有行情');
	assert.equal(created.data.state.rev + 1, saved.rev);
	// 垃圾 id 塞满打卡记录的存档：真实打卡点的奖励只能领一次
	const poi = WA.pois.find((x) => x.loc === 'perth')!;
	const cur = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...cur, state: { ...cur.state, checkins: Array.from({ length: 2000 }, (_, i) => `junk-${i}`) } });
	const gps = { t: 'gps', lat: poi.lat, lon: poi.lon, acc: 10 };
	const a = await w.call({ action: 'act', ...cred, rev: saved.rev, act: gps });
	assert.ok(a.data.ok, a.data.msg);
	const b = await w.call({ action: 'act', ...cred, rev: a.data.state.rev, act: gps });
	assert.equal(b.data.state.respect, a.data.state.respect, '第二次打卡没有再加声望');
	assert.deepEqual(w.data.get('save:' + ID).state.checkins.filter((x: string) => x === poi.id), [poi.id]);
});

test('服务端：净资产排行榜按净资产排名，标出自己，不泄露 id、同步码和种子', async () => {
	const w = makeWorld();
	const players = [
		{ id: 'board-alice-01', key: 'a'.repeat(24), name: '阿丽', cash: 5000 },
		{ id: 'board-bob-0002', key: 'b'.repeat(24), name: '阿博', cash: 900 },
		{ id: 'board-cat-0003', key: 'c'.repeat(24), name: '阿凯', cash: 20000 },
	];
	for (const p of players) {
		await w.call({ action: 'create', id: p.id, key: p.key, profile: { ...profile, name: p.name } });
		const rec = w.data.get('save:' + p.id);
		w.data.set('save:' + p.id, { ...rec, state: { ...rec.state, cash: p.cash } });
		await w.call({ action: 'act', id: p.id, key: p.key, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
	}
	const before = w.puts();
	const r = await w.call({ action: 'board', id: players[1].id, key: players[1].key });
	assert.equal(r.status, 200, r.data.msg);
	assert.equal(w.puts(), before, '看榜不写入任何东西');
	assert.deepEqual(r.data.top.map((x: { name: string }) => x.name), ['阿凯', '阿丽', '阿博']);
	assert.deepEqual(r.data.top.map((x: { rank: number }) => x.rank), [1, 2, 3]);
	assert.deepEqual(r.data.top.map((x: { me: boolean }) => x.me), [false, false, true]);
	assert.equal(r.data.me.rank, 3);
	assert.equal(r.data.total, 3);
	assert.ok(r.data.top[0].worth > r.data.top[1].worth);
	const text = JSON.stringify(r.data);
	for (const p of players) {
		assert.ok(!text.includes(p.id), '不含存档 id');
		assert.ok(!text.includes(p.key), '不含同步码');
		assert.ok(!text.includes(w.data.get('save:' + p.id).keyHash), '不含同步码哈希');
	}
	assert.ok(!/seed/.test(text), '不含种子');
	// 净资产变化后榜单跟着变：阿博发财了
	const bob = w.data.get('save:' + players[1].id);
	w.data.set('save:' + players[1].id, { ...bob, state: { ...bob.state, cash: 99999 } });
	await w.call({ action: 'act', id: players[1].id, key: players[1].key, rev: bob.state.rev, act: { t: 'activity', id: 'rest' } });
	const r2 = await w.call({ action: 'board', id: players[0].id, key: players[0].key });
	assert.deepEqual(r2.data.top.map((x: { name: string }) => x.name), ['阿博', '阿凯', '阿丽']);
	assert.equal(r2.data.me.rank, 3);
	assert.equal(r2.data.total, 3, '每人只占一条');
	// 同步码不对看不了，没有存档看不了
	assert.equal((await w.call({ action: 'board', id: players[0].id, key: 'x'.repeat(24) })).status, 403);
	assert.equal((await w.call({ action: 'board', id: 'nobody-here-9', key: 'x'.repeat(24) })).status, 404);
});

test('服务端：净资产没变的动作不会让同分的先到者掉到后面', async () => {
	const w = makeWorld();
	const a = { id: 'board-first-01', key: 'f'.repeat(24) };
	const b = { id: 'board-later-02', key: 'l'.repeat(24) };
	for (const p of [a, b]) await w.call({ action: 'create', ...p, profile: { ...profile, name: p === a ? '先到' : '后到' } });
	// 两人净资产一样，先到的记录时间更早
	const ranks = [...w.data.keys()].filter((k) => k.startsWith('rank:'));
	assert.equal(ranks.length, 2);
	const order = async () => (await w.call({ action: 'board', ...a })).data.top.map((x: { name: string }) => x.name);
	for (const k of ranks) w.data.set(k, { ...w.data.get(k), at: w.data.get(k).name === '先到' ? 1000 : 2000 });
	assert.equal(w.data.get(ranks[0]).worth, w.data.get(ranks[1]).worth);
	w.world['board'] = null;
	assert.deepEqual(await order(), ['先到', '后到']);
	// 先到的人做一个不改变净资产的动作
	const worth = w.data.get(ranks.find((k) => w.data.get(k).name === '先到')!).worth;
	const rec = w.data.get('save:' + a.id);
	const r = await w.call({ action: 'act', ...a, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.ok(r.data.ok, r.data.msg);
	const mine = w.data.get(ranks.find((k) => w.data.get(k).name === '先到')!);
	assert.equal(mine.worth, worth, '休息不改变净资产');
	assert.equal(mine.at, 1000, '沿用先达到的时间');
	assert.deepEqual(await order(), ['先到', '后到']);
});

test('服务端：看榜读列表时别人的存档正好写完，不出错，也不把旧列表留在缓存里', async () => {
	// 乙的动作停在写入前 → 甲看榜，列表读完的那一刻放行乙的写入。两种先后都要对：
	// late：乙写完、作废缓存时，甲的看榜还没排完（旧写法这里会拿着被清空的缓存排名而报错）
	// early：列表还没交给甲，乙就写完了（甲拿到的是旧列表，不能放进缓存）
	for (const order of ['late', 'early'] as const) {
		let armed = false;
		let release = () => {};
		let parked = () => {};
		const parkedP = new Promise<void>((done) => (parked = done));
		const gate = new Promise<void>((done) => (release = done));
		const w = makeWorld(0, {
			put: () => (armed ? (parked(), gate) : Promise.resolve()),
			list: () => {
				if (!armed) return;
				release();
				if (order === 'early') return new Promise((done) => setTimeout(done, 5));
			},
		});
		const a = { id: 'board-race-001', key: 'r'.repeat(24) };
		const b = { id: 'board-race-002', key: 's'.repeat(24) };
		await w.call({ action: 'create', ...a, profile });
		await w.call({ action: 'create', ...b, profile });
		const rec = w.data.get('save:' + b.id);
		w.data.set('save:' + b.id, { ...rec, state: { ...rec.state, cash: 77777 } });
		w.world['board'] = null;
		armed = true;
		const act = w.call({ action: 'act', ...b, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
		await parkedP;
		const board = await w.call({ action: 'board', ...a });
		armed = false;
		assert.equal(board.status, 200, order + ': ' + board.data.msg);
		assert.ok((await act).data.ok);
		// 乙的写入已经完成，再看榜必须是新数据
		const after = await w.call({ action: 'board', ...a });
		assert.ok(after.data.top[0].worth > 70000, order + '：缓存里不能是读榜期间拿到的旧列表');
	}
});

test('服务端：榜单记录损坏时跳过那一条，不影响其他人', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	w.data.set('rank:broken00001', { name: 7, worth: 'lots' });
	w.data.set('rank:broken00002', { name: '<b>坏</b>', avatar: '🧑', worth: Infinity, day: 1, at: 1 });
	const r = await w.call({ action: 'board', ...cred });
	assert.equal(r.status, 200);
	assert.equal(r.data.total, 1);
	assert.equal(r.data.me.rank, 1);
});

test('服务端：旧存档没有天气相册字段时读取后补上；抵达后照片落盘', async () => {
	const w = makeWorld();
	await w.call({ action: 'create', ...cred, profile });
	// 模拟上线前的旧存档：没有 photos 字段
	const rec = w.data.get('save:' + ID);
	const old = { ...rec.state };
	delete old.photos;
	w.data.set('save:' + ID, { ...rec, state: old });
	const got = await w.call({ action: 'get', ...cred });
	assert.equal(got.status, 200, got.data.msg);
	assert.deepEqual(got.data.state.photos, []);
	assert.deepEqual(w.data.get('save:' + ID).state.photos, [], '修正后写回');
	// 真实定位抵达弗里曼特尔：收一张照片并落盘
	const fre = WA.locations.find((l) => l.id === 'fremantle')!;
	const r = await w.call({ action: 'act', ...cred, rev: got.data.state.rev, act: { t: 'gps', lat: fre.lat, lon: fre.lon, acc: 10 } });
	assert.ok(r.data.ok, r.data.msg);
	assert.equal(r.data.state.photos.length, 1);
	assert.match(r.data.state.photos[0], /^fremantle\|/);
	assert.deepEqual(w.data.get('save:' + ID).state.photos, r.data.state.photos);
});

test('共同事件：发起、加入、只有发起人能开始、人够才开始，结算写进所有成员的存档，结果给队友留着', async () => {
	const w = makeWorld();
	const A = { id: 'coop-host-1', key: 'a'.repeat(24) };
	const B = { id: 'coop-mate-1', key: 'b'.repeat(24) };
	const a0 = (await w.call({ action: 'create', ...A, profile: { ...profile, name: '阿甲' } })).data.state;
	const b0 = (await w.call({ action: 'create', ...B, profile: { ...profile, name: '阿乙' } })).data.state;
	// 发起：珀斯有海滩
	const opened = await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 });
	assert.ok(opened.data.ok, opened.data.msg);
	assert.equal(opened.data.lobbies.length, 1);
	assert.equal(opened.data.lobbies[0].host, true);
	const lobby = opened.data.lobbies[0].id;
	assert.match(lobby, /^[a-f0-9]{8}$/);
	assert.equal((await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 1 })).data.msg, '你已经在一个队伍里了');
	assert.equal((await w.call({ action: 'coop', op: 'open', ...A, coop: 'nope', role: 0 })).data.ok, false);
	// 队友看到的大厅：有名字和分工，没有真实 id
	const seen = await w.call({ action: 'coop', op: 'list', ...B });
	assert.equal(seen.data.lobbies[0].mine, false);
	assert.equal(seen.data.lobbies[0].members[0].name, '阿甲');
	assert.ok(!JSON.stringify(seen.data).includes(A.id), '不能把别人的存档 id 发出去');
	// 一个人开始不了；不是发起人也开始不了
	assert.match((await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev })).data.msg, /人不够/);
	assert.equal((await w.call({ action: 'coop', op: 'start', ...B, lobby, rev: b0.rev })).data.msg, '只有发起人能开始');
	assert.equal((await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 9 })).data.msg, '分工无效');
	const joined = await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 });
	assert.ok(joined.data.ok, joined.data.msg);
	assert.equal(joined.data.lobbies[0].members.length, 2);
	assert.equal((await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 })).data.msg, '你已经在这个队伍里了');
	// 版本落后不执行
	const stale = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev + 5 });
	assert.equal(stale.status, 409);
	assert.match(stale.data.msg, /别的玩家/, '冲突提示要说明可能是别的玩家（共同事件、交易）');
	const started = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.ok(started.data.ok, started.data.msg);
	assert.match(started.data.msg, /海滩清洁/);
	assert.equal(started.data.state.seed, 0, '种子不外泄');
	assert.equal(started.data.state.rev, a0.rev + 1);
	const bSave = w.data.get('save:' + B.id).state;
	assert.equal(bSave.rev, b0.rev + 1, '队友的存档也结算了');
	assert.match(bSave.journal.at(-1).text, /和阿甲一起/);
	assert.match(w.data.get('save:' + A.id).state.journal.at(-1).text, /和阿乙一起/);
	// 结束后大厅不再列出，结果留给队友拉取；不能再开始一次
	const after = await w.call({ action: 'coop', op: 'list', ...B });
	assert.equal(after.data.lobbies.length, 0);
	assert.equal(after.data.results.length, 1);
	assert.equal(after.data.results[0].id, lobby);
	assert.equal((await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev + 1 })).status, 404);
	// 冷却：同一种共同事件每人每 5 个游戏日一次
	const again = await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 });
	assert.equal(again.data.ok, false);
	assert.match(again.data.msg, /今天已经做过/);
	assert.ok(Number.isInteger(w.data.get('save:' + B.id).state.coopDays['beach-cleanup']), '队友也记下了今天做过');
	assert.equal((await w.call({ action: 'coop', op: 'list', id: A.id, key: 'x'.repeat(24) })).status, 403, '同步码不对');
});

test('共同事件：发起人退出就解散；不在同一地点不能加入', async () => {
	const w = makeWorld();
	const A = { id: 'coop-host-2', key: 'a'.repeat(24) };
	const C = { id: 'coop-far-2', key: 'c'.repeat(24) };
	await w.call({ action: 'create', ...A, profile });
	const c0 = (await w.call({ action: 'create', ...C, profile })).data.state;
	const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
	const moved = await w.call({ action: 'act', ...C, rev: c0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } });
	assert.ok(moved.data.ok, moved.data.msg);
	assert.equal((await w.call({ action: 'coop', op: 'join', ...C, lobby, role: 0 })).data.msg, '要在同一个地点才能加入');
	assert.equal((await w.call({ action: 'coop', op: 'list', ...C })).data.lobbies.length, 0, '别的地点的队伍不列出');
	const left = await w.call({ action: 'coop', op: 'leave', ...A, lobby });
	assert.equal(left.data.msg, '队伍已解散');
	assert.equal(left.data.lobbies.length, 0);
});

test('共同事件：开始时锁住所有成员的存档，队友同时做的动作不会丢', async () => {
	const w = makeWorld(3);
	const A = { id: 'coop-host-3', key: 'a'.repeat(24) };
	const B = { id: 'coop-mate-3', key: 'b'.repeat(24) };
	const a0 = (await w.call({ action: 'create', ...A, profile })).data.state;
	const b0 = (await w.call({ action: 'create', ...B, profile })).data.state;
	const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
	await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 0 });
	// 开始和队友的动作同时到：两件事都要落进队友的存档
	const [s, act] = await Promise.all([
		w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev }),
		w.call({ action: 'act', ...B, rev: b0.rev, act: { t: 'activity', id: 'rest' } }),
	]);
	assert.ok(s.data.ok, s.data.msg);
	const final = w.data.get('save:' + B.id).state;
	const texts = final.journal.map((j: { text: string }) => j.text).join('\n');
	assert.match(texts, /海滩清洁/, '共同事件写进去了');
	if (act.data.ok) assert.equal(final.rev, b0.rev + 2, '两次都生效');
	else assert.equal(act.status, 409, '没生效的只能是版本冲突（不能静默丢失）');
});

test('在线频道：共同事件提醒只转给同一地点的其他人，不带内容', () => {
	const w = makeWorld();
	const world = w.world as any;
	const box = (loc: string) => ({ got: [] as string[], loc, send(m: string) { this.got.push(m); } });
	const me = box('perth'), mate = box('perth'), far = box('broome');
	for (const [ws, id] of [[me, 'aaaaaaaaaaaa'], [mate, 'bbbbbbbbbbbb'], [far, 'cccccccccccc']] as const) world.sockets.set(ws, { id, name: id, avatar: '🧑', loc: ws.loc });
	const locs = new Set(WA.locations.map((l) => l.id));
	world.onMessage(me, JSON.stringify({ t: 'coop', secret: 'x' }), locs);
	world.onMessage(me, JSON.stringify({ t: 'coop' }), locs);
	world.onMessage(me, JSON.stringify({ t: 'coop' }), locs);
	assert.deepEqual(mate.got.map((m) => JSON.parse(m)), [{ t: 'coop' }], '连发的提醒 1 秒内只转一次');
	assert.equal(me.got.length, 0, '不发回给自己');
	assert.equal(far.got.length, 0, '别的地点收不到');
});

async function twoInLobby(w: ReturnType<typeof makeWorld>, n: number) {
	const A = { id: `coop-host-${n}`, key: 'a'.repeat(24) };
	const B = { id: `coop-mate-${n}`, key: 'b'.repeat(24) };
	const a0 = (await w.call({ action: 'create', ...A, profile: { ...profile, name: '阿甲' } })).data.state;
	const b0 = (await w.call({ action: 'create', ...B, profile: { ...profile, name: '阿乙' } })).data.state;
	const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
	assert.ok((await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 })).data.ok);
	return { A, B, a0, b0, lobby };
}

test('共同事件：所有成员一次写入；写入失败谁都没拿到，重试只结算一次', async () => {
	let failNext = false;
	const w = makeWorld(0, {
		put: async (k) => {
			if (failNext && typeof k === 'object' && Object.keys(k).filter((x) => x.startsWith('save:')).length > 1) {
				failNext = false;
				throw new Error('storage down');
			}
		},
	});
	const { A, B, a0, b0, lobby } = await twoInLobby(w, 4);
	failNext = true;
	await assert.rejects(w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev }));
	assert.equal(w.data.get('save:' + A.id).state.rev, a0.rev, '发起人没结算');
	assert.equal(w.data.get('save:' + B.id).state.rev, b0.rev, '队友也没结算');
	const listed = await w.call({ action: 'coop', op: 'list', ...B });
	assert.equal(listed.data.lobbies.length, 1, '队伍还在');
	assert.equal(listed.data.lobbies[0].starting, false, '失败后解除冻结');
	const ok = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.ok(ok.data.ok, ok.data.msg);
	assert.equal(w.data.get('save:' + A.id).state.rev, a0.rev + 1);
	assert.equal(w.data.get('save:' + B.id).state.rev, b0.rev + 1);
	assert.equal((await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev })).status, 404, '不能再结算一次');
	assert.equal(w.data.get('save:' + B.id).state.rev, b0.rev + 1);
});

test('共同事件：开始已经排队时，别人加入、退出都被拒绝，不会显示已加入却被排除', async () => {
	const w = makeWorld(3);
	const { A, B, a0, lobby } = await twoInLobby(w, 5);
	const C = { id: 'coop-late-5', key: 'c'.repeat(24) };
	const c0 = (await w.call({ action: 'create', ...C, profile })).data.state;
	const [started, late, quit] = await Promise.all([
		w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev }),
		w.call({ action: 'coop', op: 'join', ...C, lobby, role: 0 }),
		w.call({ action: 'coop', op: 'leave', ...B, lobby }),
	]);
	assert.ok(started.data.ok, started.data.msg);
	assert.equal(late.data.ok, false, '晚到的加入不能报成功');
	assert.equal(late.status, 409);
	assert.equal(quit.data.ok, false, '队友的退出排在结算后面，队伍已经结束');
	assert.equal(w.data.get('save:' + C.id).state.rev, c0.rev, '没参加的人存档不动');
});

test('共同事件：走开以后还能看到自己的队伍并退出', async () => {
	const w = makeWorld();
	const { A, B, a0, b0, lobby } = await twoInLobby(w, 6);
	assert.ok((await w.call({ action: 'act', ...B, rev: b0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	const seen = await w.call({ action: 'coop', op: 'list', ...B });
	assert.equal(seen.data.lobbies.length, 1);
	assert.equal(seen.data.lobbies[0].mine, true);
	assert.equal(seen.data.lobbies[0].away, true);
	assert.match((await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev })).data.msg, /人不够/, '走开的人不结算');
	assert.equal((await w.call({ action: 'coop', op: 'leave', ...B, lobby })).data.msg, '已退出');
	assert.equal((await w.call({ action: 'coop', op: 'list', ...B })).data.lobbies.length, 0);
});

test('共同事件：每个队友用自己存档的时间落盘，不被发起人那边的时间带偏', async () => {
	const w = makeWorld();
	const { A, B, a0, lobby } = await twoInLobby(w, 7);
	// 模拟服务器时钟回拨：队友上次落盘的时间比现在晚 1 小时
	const ahead = Date.now() + 3600_000;
	const recB = w.data.get('save:' + B.id);
	w.data.set('save:' + B.id, { ...recB, at: ahead });
	const started = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.ok(started.data.ok, started.data.msg);
	assert.ok(w.data.get('save:' + B.id).at >= ahead, '队友的时间不倒退');
	assert.ok(w.data.get('save:' + A.id).at < ahead, '发起人用自己的时间');
});

test('共同事件：开始失败的响应里队伍已经解冻，界面不会停在「正在开始」', async () => {
	const w = makeWorld();
	const { A, B, a0, b0, lobby } = await twoInLobby(w, 8);
	assert.ok((await w.call({ action: 'act', ...B, rev: b0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	const few = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.match(few.data.msg, /人不够/);
	assert.equal(few.data.lobbies[0].starting, false, '人不够');
	const stale = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev + 3 });
	assert.equal(stale.status, 409);
	assert.equal(stale.data.lobbies[0].starting, false, '版本冲突');
});

test('共同事件：结算途中队伍到了 5 分钟也不被过期清掉，队友能拉到结果', async () => {
	let during: (() => Promise<unknown>) | null = null;
	const w = makeWorld(0, {
		put: async (k) => {
			// 正在写所有成员存档的那一刻：队伍刚好过期，旁人（存档没被锁）来拉列表，会触发过期清理
			if (during && typeof k === 'object' && Object.keys(k).filter((x) => x.startsWith('save:')).length > 1) {
				const f = during;
				during = null;
				await f();
			}
		},
	});
	const { A, B, a0, lobby } = await twoInLobby(w, 9);
	const C = { id: 'coop-other-9', key: 'c'.repeat(24) };
	await w.call({ action: 'create', ...C, profile });
	const lobbies = (w.world as any).lobbies as Map<string, { at: number }>;
	during = async () => {
		lobbies.get(lobby)!.at = 0;
		await w.call({ action: 'coop', op: 'list', ...C });
	};
	const started = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.ok(started.data.ok, started.data.msg);
	assert.equal(during, null, '旁人确实在结算途中拉了列表');
	assert.equal(started.data.results.length, 1, '发起人的响应里有结果');
	assert.equal((await w.call({ action: 'coop', op: 'list', ...B })).data.results.length, 1, '队友拉得到结果');
});

const peerHash = async (id: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
async function twoPlayers(w: ReturnType<typeof makeWorld>, n: number | string, inv: Record<string, number> = { snack: 2 }) {
	const A = { id: `trade-from-${n}`, key: 'a'.repeat(24) };
	const B = { id: `trade-to-${n}`, key: 'b'.repeat(24) };
	await w.call({ action: 'create', ...A, profile: { ...profile, name: '阿甲' } });
	await w.call({ action: 'create', ...B, profile: { ...profile, name: '阿乙' } });
	const recA = w.data.get('save:' + A.id);
	recA.state.inventory = inv;
	w.data.set('save:' + A.id, recA);
	return { A, B, a0: recA.state, b0: w.data.get('save:' + B.id).state };
}

test('送礼：指定同地点的人，只有对方能收下；收下后双方存档一次写入，单子消失，不泄露真实 id', async () => {
	const w = makeWorld();
	const { A, B, a0, b0 } = await twoPlayers(w, 1);
	const C = { id: 'trade-other-1', key: 'c'.repeat(24) };
	await w.call({ action: 'create', ...C, profile });
	const toB = await peerHash(B.id);
	assert.equal((await w.call({ action: 'trade', op: 'gift', ...A, to: await peerHash(A.id), item: 'snack' })).data.msg, '不能送给自己');
	assert.match((await w.call({ action: 'trade', op: 'gift', ...A, to: toB, item: 'swag' })).data.msg, /没有这件/);
	const sent = await w.call({ action: 'trade', op: 'gift', ...A, to: toB, toName: '阿乙', item: 'snack' });
	assert.ok(sent.data.ok, sent.data.msg);
	assert.equal(sent.data.offers[0].mine, true);
	const oid = sent.data.offers[0].id;
	const seenB = await w.call({ action: 'trade', op: 'list', ...B });
	assert.equal(seenB.data.offers.length, 1);
	assert.equal(seenB.data.offers[0].name, '阿甲');
	assert.ok(!JSON.stringify(seenB.data).includes(A.id), '不能把别人的存档 id 发出去');
	assert.equal((await w.call({ action: 'trade', op: 'list', ...C })).data.offers.length, 0, '别人看不到');
	assert.equal((await w.call({ action: 'trade', op: 'accept', ...C, offer: oid, rev: 0 })).data.msg, '这不是给你的');
	assert.equal((await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev + 3 })).status, 409, '版本落后');
	const got = await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev });
	assert.ok(got.data.ok, got.data.msg);
	assert.equal(got.data.state.inventory.snack, (b0.inventory.snack ?? 0) + 1);
	assert.equal(got.data.state.rev, b0.rev + 1);
	const aSave = w.data.get('save:' + A.id).state;
	assert.equal(aSave.inventory.snack, 1, '送礼的人少了一件');
	assert.equal(aSave.rev, a0.rev + 1);
	assert.equal((await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev + 1 })).status, 404, '不能收两次');
	assert.equal((await w.call({ action: 'trade', op: 'list', ...A })).data.offers.length, 0);
});

test('送礼：撤回、拒绝、同时最多挂 3 件、挂单数不超过背包数量；送出前东西没了单子作废', async () => {
	const w = makeWorld();
	const { A, B, b0 } = await twoPlayers(w, 2, { snack: 1, water: 5 });
	const toB = await peerHash(B.id);
	const s1 = await w.call({ action: 'trade', op: 'gift', ...A, to: toB, toName: '阿乙', item: 'snack' });
	assert.match((await w.call({ action: 'trade', op: 'gift', ...A, to: toB, item: 'snack' })).data.msg, /都挂出去了/);
	await w.call({ action: 'trade', op: 'gift', ...A, to: toB, item: 'water' });
	await w.call({ action: 'trade', op: 'gift', ...A, to: toB, item: 'water' });
	assert.match((await w.call({ action: 'trade', op: 'gift', ...A, to: toB, item: 'water' })).data.msg, /最多挂 3 件/);
	const list = (await w.call({ action: 'trade', op: 'list', ...B })).data.offers as { id: string; item: string }[];
	const water = list.filter((o) => o.item === 'water').map((o) => o.id);
	assert.equal((await w.call({ action: 'trade', op: 'decline', ...B, offer: water[0] })).data.ok, true);
	assert.equal((await w.call({ action: 'trade', op: 'cancel', ...B, offer: water[1] })).data.msg, '只能撤回自己挂的');
	assert.equal((await w.call({ action: 'trade', op: 'cancel', ...A, offer: water[1] })).data.ok, true);
	// 送出前把能量棒吃掉了：对方收下时单子作废，谁的存档都不动
	const rec = w.data.get('save:' + A.id);
	delete rec.state.inventory.snack;
	w.data.set('save:' + A.id, rec);
	const late = await w.call({ action: 'trade', op: 'accept', ...B, offer: s1.data.offers[0].id, rev: b0.rev });
	assert.equal(late.data.ok, false);
	assert.match(late.data.msg, /没有这件/);
	assert.equal(w.data.get('save:' + B.id).state.rev, b0.rev);
	assert.equal((await w.call({ action: 'trade', op: 'list', ...B })).data.offers.length, 0, '作废的单子撤下');
});

test('送礼：收下和撤回同时到，只有一个生效', async () => {
	const w = makeWorld(3);
	const { A, B, b0 } = await twoPlayers(w, 3);
	const oid = (await w.call({ action: 'trade', op: 'gift', ...A, to: await peerHash(B.id), toName: '阿乙', item: 'snack' })).data.offers[0].id;
	const [take, cancel] = await Promise.all([
		w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev }),
		w.call({ action: 'trade', op: 'cancel', ...A, offer: oid }),
	]);
	assert.ok(take.data.ok, take.data.msg);
	assert.equal(cancel.data.ok, false, '撤回排在收下后面，单子已经没了');
	const total = (w.data.get('save:' + A.id).state.inventory.snack ?? 0) + (w.data.get('save:' + B.id).state.inventory.snack ?? 0);
	assert.equal(total, 2 + (b0.inventory.snack ?? 0), '东西不多不少');
});

test('二手摊：价格在商店价 50%–150% 之间；同地点的人都能买，买方付钱给卖方，一次写入；别处的人看不到', async () => {
	const w = makeWorld();
	const { A, B, a0, b0 } = await twoPlayers(w, 4, { firstaid: 1 });
	const C = { id: 'trade-far-4', key: 'c'.repeat(24) };
	const c0 = (await w.call({ action: 'create', ...C, profile })).data.state;
	assert.ok((await w.call({ action: 'act', ...C, rev: c0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	assert.match((await w.call({ action: 'trade', op: 'sale', ...A, item: 'firstaid', price: 60 })).data.msg, /\$18–\$52/);
	assert.match((await w.call({ action: 'trade', op: 'sale', ...A, item: 'firstaid', price: 20.5 })).data.msg, /之间/);
	const up = await w.call({ action: 'trade', op: 'sale', ...A, item: 'firstaid', price: 40 });
	assert.ok(up.data.ok, up.data.msg);
	const oid = up.data.offers[0].id;
	assert.equal((await w.call({ action: 'trade', op: 'list', ...C })).data.offers.length, 0, '别处看不到');
	assert.equal((await w.call({ action: 'trade', op: 'accept', ...A, offer: oid, rev: a0.rev })).data.ok, false, '不能买自己的');
	const seen = await w.call({ action: 'trade', op: 'list', ...B });
	assert.deepEqual([seen.data.offers[0].kind, seen.data.offers[0].price, seen.data.offers[0].mine], ['sale', 40, false]);
	const bought = await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev });
	assert.ok(bought.data.ok, bought.data.msg);
	assert.equal(bought.data.state.cash, b0.cash - 40);
	assert.equal(bought.data.state.inventory.firstaid, (b0.inventory.firstaid ?? 0) + 1);
	const aSave = w.data.get('save:' + A.id).state;
	assert.equal(aSave.cash, a0.cash + 40);
	assert.equal(aSave.inventory.firstaid ?? 0, 0);
	assert.match(aSave.journal.at(-1).text, /卖给了阿乙/);
});

test('常遇见的人：送礼成交、共同事件结束后，双方存档里都记下对方（只存 id 哈希前缀）', async () => {
	const w = makeWorld();
	const { A, B, b0 } = await twoPlayers(w, 5);
	const hA = await peerHash(A.id), hB = await peerHash(B.id);
	const oid = (await w.call({ action: 'trade', op: 'gift', ...A, to: hB, toName: '阿乙', item: 'snack' })).data.offers[0].id;
	const got = await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev });
	assert.equal(got.data.state.met[hA].name, '阿甲');
	assert.equal(w.data.get('save:' + A.id).state.met[hB].n, 1);
	assert.ok(!JSON.stringify(got.data.state.met).includes(A.id), '不存真实 id');
	// 共同事件
	const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
	await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 });
	const aRev = w.data.get('save:' + A.id).state.rev;
	const done = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: aRev });
	assert.ok(done.data.ok, done.data.msg);
	assert.equal(done.data.state.met[hB].n, 2, '交易一次 + 共同事件一次');
	assert.equal(w.data.get('save:' + B.id).state.met[hA].n, 2);
});

async function weeklyScenario(k: number) {
	const w = makeWorld();
	const week = weekOf(realDayOf(Date.now()));
	const goal = goalOfWeek(week);
	const A = { id: `weekly-host-1${k}`, key: 'a'.repeat(24) };
	const B = { id: `weekly-mate-1${k}`, key: 'b'.repeat(24) };
	const a0 = (await w.call({ action: 'create', ...A, profile: { ...profile, name: '阿甲' } })).data.state;
	const b0 = (await w.call({ action: 'create', ...B, profile: { ...profile, name: '阿乙' } })).data.state;
	const before = await w.call({ action: 'weekly', op: 'status', ...A });
	assert.equal(before.data.week.goal.id, goal.id);
	assert.equal(before.data.week.count, 0);
	// 做一次这周目标对应的事
	let expect = 1;
	if (goal.metric === 'travel') {
		assert.ok((await w.call({ action: 'act', ...A, rev: a0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	} else if (goal.metric === 'experience') {
		const exp = EXPERIENCES.find((e) => e.loc === 'perth' && !e.festival)!;
		const rec = w.data.get('save:' + A.id);
		rec.state.cash = 1000;
		rec.state.clock = 1440 + ((exp.hours?.[0] ?? 9) + 1) * 60;
		w.data.set('save:' + A.id, rec);
		const r = await w.call({ action: 'act', ...A, rev: a0.rev, act: { t: 'experience', id: exp.id } });
		assert.ok(r.data.ok, r.data.msg);
	} else if (goal.metric === 'coop') {
		const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
		await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 });
		assert.ok((await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev })).data.ok);
		expect = 2;
	} else {
		const rec = w.data.get('save:' + A.id);
		rec.state.inventory = { water: 1 };
		w.data.set('save:' + A.id, rec);
		const oid = (await w.call({ action: 'trade', op: 'gift', ...A, to: await peerHash(B.id), toName: '阿乙', item: 'water' })).data.offers[0].id;
		assert.ok((await w.call({ action: 'trade', op: 'accept', ...B, offer: oid, rev: b0.rev })).data.ok);
	}
	const after = await w.call({ action: 'weekly', op: 'status', ...A });
	assert.equal(after.data.week.count, expect, `${goal.metric} 算进全服`);
	assert.equal(after.data.week.mine.n, 1, '自己记一份力');
	assert.equal(w.data.get('week:' + week), expect, '全服计数落盘');
	// 没达成不能领；把全服计数调到达成后能领一次
	const rev1 = w.data.get('save:' + A.id).state.rev;
	assert.match((await w.call({ action: 'weekly', op: 'claim', ...A, rev: rev1 })).data.msg, /还差/);
	(w.world as any).week.count = goal.target;
	const got = await w.call({ action: 'weekly', op: 'claim', ...A, rev: rev1 });
	assert.ok(got.data.ok, got.data.msg);
	assert.equal(got.data.state.rev, rev1 + 1);
	assert.equal(got.data.week.mine.claimed, true);
	assert.match((await w.call({ action: 'weekly', op: 'claim', ...A, rev: rev1 + 1 })).data.msg, /领过/);
	assert.equal((await w.call({ action: 'weekly', op: 'claim', ...A, rev: rev1 })).status, 409, '版本落后');
	return goal.metric;
}

test('全服周目标：四类目标轮流当值时，对应的事做完全服加一、自己记一份力；达成后领奖，只能领一次', async () => {
	const realNow = Date.now;
	const seen = new Set<string>();
	try {
		for (let k = 0; k < 4; k++) {
			const shift = k * 7 * 86_400_000;
			Date.now = () => realNow() + shift; // 往后挪 k 周，轮到别的目标
			seen.add(await weeklyScenario(k));
		}
	} finally {
		Date.now = realNow;
	}
	assert.equal(seen.size, 4, '四类都测到了');
});

test('全服周目标：实例重启后从存储读回这周的累计数；并发读取只读一次', async () => {
	const w = makeWorld(3);
	const week = weekOf(realDayOf(Date.now()));
	w.data.set('week:' + week, 7);
	const A = { id: 'weekly-host-2', key: 'a'.repeat(24) };
	await w.call({ action: 'create', ...A, profile });
	const [x, y] = await Promise.all([w.call({ action: 'weekly', op: 'status', ...A }), w.call({ action: 'weekly', op: 'status', ...A })]);
	assert.equal(x.data.week.count, 7);
	assert.equal(y.data.week.count, 7);
});

test('送礼：收件人必须是真实存在、在同一地点的玩家；每人最多 3 份待收；送礼人走了就作废（审查问题 1、5）', async () => {
	const w = makeWorld();
	const { A, B, b0 } = await twoPlayers(w, 6, { water: 6 });
	await w.call({ action: 'get', ...B }); // 落过一次盘，服务端才有哈希到存档的对应
	assert.match((await w.call({ action: 'trade', op: 'gift', ...A, to: 'aaaaaaaaaaaa', item: 'water' })).data.msg, /不在这里/, '不存在的哈希');
	const C = { id: 'trade-far-6', key: 'c'.repeat(24) };
	const c0 = (await w.call({ action: 'create', ...C, profile })).data.state;
	assert.ok((await w.call({ action: 'act', ...C, rev: c0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	assert.match((await w.call({ action: 'trade', op: 'gift', ...A, to: await peerHash(C.id), item: 'water' })).data.msg, /不在这里/, '别处的人');
	const toB = await peerHash(B.id);
	const D = { id: 'trade-also-6', key: 'd'.repeat(24) };
	await w.call({ action: 'create', ...D, profile });
	const recD = w.data.get('save:' + D.id);
	recD.state.inventory = { water: 2 };
	w.data.set('save:' + D.id, recD);
	for (let i = 0; i < 3; i++) assert.ok((await w.call({ action: 'trade', op: 'gift', ...(i < 2 ? A : D), to: toB, toName: '随便写', item: 'water' })).data.ok);
	const sent = await w.call({ action: 'trade', op: 'gift', ...D, to: toB, item: 'water' });
	assert.match(sent.data.msg, /好几份礼物没收/, '每人最多 3 份待收');
	assert.ok(sent.data.offers.every((o: { mine: boolean; toName: string }) => !o.mine || o.toName === '阿乙'), '收件人名字以服务端存档为准');
	// A 送完就走了：B 收不了，单子撤下
	const offers = (await w.call({ action: 'trade', op: 'list', ...B })).data.offers as { id: string; name: string }[];
	const fromA = offers.find((o) => o.name === '阿甲')!;
	const aRev = w.data.get('save:' + A.id).state.rev;
	assert.ok((await w.call({ action: 'act', ...A, rev: aRev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
	const late = await w.call({ action: 'trade', op: 'accept', ...B, offer: fromA.id, rev: b0.rev });
	assert.match(late.data.msg, /离开/);
	assert.equal(w.data.get('save:' + B.id).state.rev, b0.rev, '没成交');
	assert.ok(!late.data.offers.some((o: { id: string }) => o.id === fromA.id), '单子撤下');
});

/** 把时间往后挪到这类目标当值的那一周 */
function shiftToGoal(metric: string): () => void {
	const realNow = Date.now;
	for (let k = 0; k < 8; k++) {
		const shift = k * 7 * 86_400_000;
		if (goalOfWeek(weekOf(realDayOf(realNow() + shift))).metric === metric) {
			Date.now = () => realNow() + shift;
			return () => { Date.now = realNow; };
		}
	}
	throw new Error('找不到 ' + metric);
}

test('全服周目标：存档和全服计数一次写入，写失败时两边都不变（审查问题 3）', async () => {
	const restore = shiftToGoal('travel');
	try {
		let fail = false;
		const w = makeWorld(0, { put: async (k) => { if (fail && typeof k === 'object' && Object.keys(k).some((x) => x.startsWith('week:'))) throw new Error('storage down'); } });
		const A = { id: 'weekly-atomic-1', key: 'a'.repeat(24) };
		const a0 = (await w.call({ action: 'create', ...A, profile })).data.state;
		fail = true;
		await assert.rejects(w.call({ action: 'act', ...A, rev: a0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } }));
		assert.equal(w.data.get('save:' + A.id).state.loc, 'perth', '存档没写');
		assert.equal((w.world as any).week.count, 0, '内存里的计数没变');
		fail = false;
		assert.ok((await w.call({ action: 'act', ...A, rev: a0.rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } })).data.ok);
		const week = weekOf(realDayOf(Date.now()));
		assert.equal(w.data.get('week:' + week), 1);
		assert.equal(w.data.get('save:' + A.id).state.weekly.n, 1);
	} finally {
		restore();
	}
});

test('全服周目标：免费的节日体验不算「收费体验」（审查问题 7）', async () => {
	const restore = shiftToGoal('experience');
	try {
		const w = makeWorld();
		const A = { id: 'weekly-free-1', key: 'a'.repeat(24) };
		const a0 = (await w.call({ action: 'create', ...A, profile })).data.state;
		const rec = w.data.get('save:' + A.id);
		rec.state.clock = (28 + 13) * 1440 + 19 * 60; // 夏季第 14 天 19 点，天鹅河烟火夜
		w.data.set('save:' + A.id, rec);
		const r = await w.call({ action: 'act', ...A, rev: a0.rev, act: { t: 'experience', id: 'fest-skyshow' } });
		assert.ok(r.data.ok, r.data.msg);
		assert.equal(r.data.state.weekly.n, 0, '免费体验不记');
		assert.equal((await w.call({ action: 'weekly', op: 'status', ...A })).data.week.count, 0);
	} finally {
		restore();
	}
});

/** 新建一个存档，返回凭证和初始存档 */
async function newPlayer(w: ReturnType<typeof makeWorld>, id: string) {
	const P = { id, key: 'p'.repeat(24) };
	const st = (await w.call({ action: 'create', ...P, profile })).data.state;
	return { P, st };
}
const travel = (P: { id: string; key: string }, rev: number) => ({ action: 'act', ...P, rev, act: { t: 'travel', to: 'fremantle', mode: 'road' } });

test('全服周计数并发：后写的不会用旧数盖掉先写的；一笔写失败不影响别人，也不留下没落盘的数（复审问题 1）', async () => {
	const restore = shiftToGoal('travel');
	try {
		// 第一笔带周计数的写入故意慢：以前后到的小数会盖掉先到的大数
		let first = true;
		const w = makeWorld(0, { put: async (k) => {
			if (typeof k === 'object' && Object.keys(k).some((x) => x.startsWith('week:')) && first) { first = false; await new Promise((d) => setTimeout(d, 30)); }
		} });
		const a = await newPlayer(w, 'weekly-race-a');
		const b = await newPlayer(w, 'weekly-race-b');
		const [ra, rb] = await Promise.all([w.call(travel(a.P, a.st.rev)), w.call(travel(b.P, b.st.rev))]);
		assert.ok(ra.data.ok && rb.data.ok);
		const week = weekOf(realDayOf(Date.now()));
		assert.equal(w.data.get('week:' + week), 2, '两笔都记上');
		assert.equal((w.world as any).week.count, 2);

		// 一笔失败、一笔成功：落盘和内存都只算成功的那笔
		let failNext = true;
		const w2 = makeWorld(0, { put: async (k) => {
			if (typeof k === 'object' && Object.keys(k).some((x) => x.startsWith('week:')) && failNext) { failNext = false; await new Promise((d) => setTimeout(d, 20)); throw new Error('storage down'); }
		} });
		const c = await newPlayer(w2, 'weekly-race-c');
		const d = await newPlayer(w2, 'weekly-race-d');
		const settled = await Promise.allSettled([w2.call(travel(c.P, c.st.rev)), w2.call(travel(d.P, d.st.rev))]);
		// 哪一笔先到存储、吃到那次失败，取决于并发调度（全套测试并行时会变）：只要求恰好一笔失败、一笔成功
		const failed = settled.findIndex((r) => r.status === 'rejected');
		assert.ok(failed >= 0, '应该有一笔写失败');
		const ok = settled[1 - failed];
		assert.ok(ok.status === 'fulfilled' && ok.value.data.ok, '另一笔应该成功');
		assert.equal(w2.data.get('week:' + week), 1);
		assert.equal((w2.world as any).week.count, 1);
		const [lost, won] = failed === 0 ? [c, d] : [d, c];
		assert.equal(w2.data.get('save:' + lost.P.id).state.loc, 'perth', '失败的那笔存档没写');
		assert.equal(w2.data.get('save:' + won.P.id).state.loc, 'fremantle', '成功的那笔存档写了');
	} finally {
		restore();
	}
});

test('全服周计数：写入还没落盘时别人看到的、领奖用的都是已落盘的数（复审问题 1）', async () => {
	const restore = shiftToGoal('travel');
	try {
		let release!: () => void;
		const gate = new Promise<void>((d) => { release = d; });
		let reached!: () => void;
		const atPut = new Promise<void>((d) => { reached = d; });
		const w = makeWorld(0, { put: async (k) => {
			if (typeof k === 'object' && Object.keys(k).some((x) => x.startsWith('week:'))) { reached(); await gate; }
		} });
		const a = await newPlayer(w, 'weekly-gate-a');
		const b = await newPlayer(w, 'weekly-gate-b');
		const pending = w.call(travel(a.P, a.st.rev));
		await atPut;
		assert.equal((await w.call({ action: 'weekly', op: 'status', ...b.P })).data.week.count, 0, '没落盘的不算');
		release();
		assert.ok((await pending).data.ok);
		assert.equal((await w.call({ action: 'weekly', op: 'status', ...b.P })).data.week.count, 1);
	} finally {
		restore();
	}
});

test('挂单：同时挂单也不会超过每个地点 30 单（复审问题 3）', async () => {
	const w = makeWorld(3); // 每次读写都等一会儿，让两份礼物的检查交错
	const { A, B } = await twoPlayers(w, 31, { water: 2 });
	const C = { id: 'trade-also-31', key: 'c'.repeat(24) };
	await w.call({ action: 'create', ...C, profile });
	const recC = w.data.get('save:' + C.id);
	recC.state.inventory = { water: 2 };
	w.data.set('save:' + C.id, recC);
	await w.call({ action: 'get', ...B });
	const offers = (w.world as any).offers as Map<string, any>;
	for (let i = 0; i < 29; i++) offers.set('f' + i, { id: 'f' + i, kind: 'sale', from: 'x' + i, fromName: 'x', fromAvatar: '🧑', to: null, toId: null, toName: '', item: 'snack', price: 3, loc: 'perth', at: Date.now() });
	const toB = await peerHash(B.id);
	const res = await Promise.all([A, C].map((P) => w.call({ action: 'trade', op: 'gift', ...P, to: toB, item: 'water' })));
	assert.equal(res.filter((r) => r.data.ok).length, 1, '只有一份挂上');
	assert.equal([...offers.values()].filter((o) => o.loc === 'perth').length, 30);
});

test('服务端：动作编号去重——同一编号的动作只结算一次，重交时返回当时的结果和最新存档（第 7 批审查问题 1）', async () => {
	const w = makeWorld();
	const created = await w.call({ action: 'create', ...cred, profile });
	const rev0 = created.data.state.rev;
	const op = 'aaaaaaaaaaaaaaa1';
	const first = await w.call({ action: 'act', ...cred, rev: rev0, act: { t: 'activity', id: 'rest' }, op });
	assert.ok(first.data.ok, first.data.msg);
	const rev1 = first.data.state.rev;
	// 回复丢了，客户端同步后带着新版本号重交：不再执行
	const again = await w.call({ action: 'act', ...cred, rev: rev1, act: { t: 'activity', id: 'rest' }, op });
	assert.equal(again.status, 200);
	assert.equal(again.data.dup, true);
	assert.equal(again.data.ok, true);
	assert.equal(again.data.msg, first.data.msg, '返回当时的结果');
	assert.equal(again.data.state.rev, rev1, '存档没再前进');
	assert.equal(w.data.get('save:' + ID).state.rev, rev1);
	// 带旧版本号重交也一样（不报版本冲突）
	assert.equal((await w.call({ action: 'act', ...cred, rev: rev0, act: { t: 'activity', id: 'rest' }, op })).data.dup, true);
	// 新编号照常执行
	const next = await w.call({ action: 'act', ...cred, rev: rev1, act: { t: 'activity', id: 'rest' }, op: 'aaaaaaaaaaaaaaa2' });
	assert.equal(next.data.dup, undefined);
	assert.equal(next.data.state.rev, rev1 + 1);
	// 被规则拒绝的也记下：重交拿到同样的拒绝，不会换个时机又做成了
	const no = await w.call({ action: 'act', ...cred, rev: rev1 + 1, act: { t: 'use', item: 'no-such-item' }, op: 'aaaaaaaaaaaaaaa3' });
	assert.equal(no.data.ok, false);
	const noAgain = await w.call({ action: 'act', ...cred, rev: rev1 + 1, act: { t: 'use', item: 'no-such-item' }, op: 'aaaaaaaaaaaaaaa3' });
	assert.equal(noAgain.data.dup, true);
	assert.equal(noAgain.data.ok, false);
	assert.equal(noAgain.data.msg, no.data.msg);
	// 格式不对的编号当作没带：不去重（同一版本再交一次就是版本冲突）
	const bad = await w.call({ action: 'act', ...cred, rev: rev1 + 1, act: { t: 'activity', id: 'rest' }, op: 'BAD!' });
	assert.ok(bad.data.ok);
	assert.equal((await w.call({ action: 'act', ...cred, rev: rev1 + 1, act: { t: 'activity', id: 'rest' }, op: 'BAD!' })).status, 409);
	// 只记最近 16 个，不会无限长；存储里的记录不外泄到响应
	let r = w.data.get('save:' + ID).state.rev;
	for (let i = 0; i < 20; i++) r = (await w.call({ action: 'act', ...cred, rev: r, act: { t: 'activity', id: 'rest' }, op: 'bbbbbbbbbbbbbb' + String(i).padStart(2, '0') })).data.state.rev;
	const ops = w.data.get('ops:' + ID);
	assert.equal(ops.length, 16);
	assert.equal(ops.at(-1).op, 'bbbbbbbbbbbbbb19');
	assert.ok(!('ops' in next.data.state));
});

test('服务端：动作编号和存档一次写入——写失败时编号也没记下，重交照常结算一次', async () => {
	let failNext = false;
	const w = makeWorld(0, { put: async (k) => { if (failNext && typeof k === 'object' && Object.keys(k).some((x) => x.startsWith('ops:'))) { failNext = false; throw new Error('disk'); } } });
	const created = await w.call({ action: 'create', ...cred, profile });
	const rev0 = created.data.state.rev;
	failNext = true;
	await assert.rejects(w.call({ action: 'act', ...cred, rev: rev0, act: { t: 'activity', id: 'rest' }, op: 'cccccccccccccccc' }), /disk/);
	assert.equal(w.data.get('save:' + ID).state.rev, rev0, '存档没写');
	assert.equal(w.data.get('ops:' + ID), undefined, '编号也没记');
	const retry = await w.call({ action: 'act', ...cred, rev: rev0, act: { t: 'activity', id: 'rest' }, op: 'cccccccccccccccc' });
	assert.ok(retry.data.ok, retry.data.msg);
	assert.equal(retry.data.dup, undefined);
	assert.equal(retry.data.state.rev, rev0 + 1);
});

test('南澳（第 9 批审查问题 6）：双方都在南澳时，共同事件和送礼照常结算，存档的地点和区域留在南澳，不被打回珀斯', async () => {
	const w = makeWorld();
	const toSa = (id: string, loc: string) => {
		const rec = w.data.get('save:' + id);
		rec.state.loc = loc;
		rec.state.region = 'sa';
		w.data.set('save:' + id, rec);
		return rec.state;
	};
	// 共同事件：格莱内尔格的海滩清洁
	const A = { id: 'sa-coop-host', key: 'a'.repeat(24) };
	const B = { id: 'sa-coop-mate', key: 'b'.repeat(24) };
	await w.call({ action: 'create', ...A, profile: { ...profile, name: '阿甲' } });
	await w.call({ action: 'create', ...B, profile: { ...profile, name: '阿乙' } });
	const a0 = toSa(A.id, 'glenelg');
	toSa(B.id, 'glenelg');
	const opened = await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 });
	assert.ok(opened.data.ok, opened.data.msg);
	const lobby = opened.data.lobbies[0].id;
	assert.ok((await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 })).data.ok);
	const started = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
	assert.ok(started.data.ok, started.data.msg);
	for (const id of [A.id, B.id]) {
		const st = w.data.get('save:' + id).state;
		assert.equal(st.loc, 'glenelg', `${id} 还在格莱内尔格`);
		assert.equal(st.region, 'sa', `${id} 区域是南澳`);
		assert.match(st.journal.at(-1).text, /海滩清洁/);
	}
	// 送礼：阿德莱德
	const { A: C, B: D, b0 } = await twoPlayers(w, 'sa');
	toSa(C.id, 'adelaide');
	const d0 = toSa(D.id, 'adelaide');
	const sent = await w.call({ action: 'trade', op: 'gift', ...C, to: await peerHash(D.id), toName: '阿乙', item: 'snack' });
	assert.ok(sent.data.ok, sent.data.msg);
	const got = await w.call({ action: 'trade', op: 'accept', ...D, offer: sent.data.offers[0].id, rev: d0.rev });
	assert.ok(got.data.ok, got.data.msg);
	assert.equal(got.data.state.inventory.snack, (b0.inventory.snack ?? 0) + 1);
	for (const id of [C.id, D.id]) {
		const st = w.data.get('save:' + id).state;
		assert.equal(st.loc, 'adelaide', `${id} 还在阿德莱德`);
		assert.equal(st.region, 'sa');
	}
});
