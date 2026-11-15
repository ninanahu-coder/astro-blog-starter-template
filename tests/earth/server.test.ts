// 云存档服务端（EarthWorld）的回归测试：用内存里的假存储直接调 fetch()，不联网。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { WA } from '../../src/game/data/wa.ts';

/** delayMs > 0 时每次读写都真的等一会儿，让同时到的请求在没有锁的情况下一定会交错（读到同一份旧存档） */
/** hooks 让测试精确安排先后：put 写入前先等 hooks.put()，list 读完、返回前等 hooks.list() */
function makeWorld(delayMs = 0, hooks: { put?: () => Promise<void>; list?: () => unknown } = {}) {
	const data = new Map<string, any>();
	let puts = 0;
	const wait = () => (delayMs ? new Promise((done) => setTimeout(done, delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			await wait();
			if (hooks.put) await hooks.put();
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
	assert.deepEqual({ ...r.data.state, seed: saved.seed }, saved, '响应和落盘一致（除了隐藏的种子）');
	assert.equal(created.data.state.rev + 1, saved.rev);
	// 垃圾 id 塞满打卡记录的存档：真实打卡点的奖励只能领一次
	const poi = WA.pois.find((x) => x.loc === 'perth')!;
	const cur = w.data.get('save:' + ID);
	w.data.set('save:' + ID, { ...cur, state: { ...cur.state, checkins: Array.from({ length: 2000 }, (_, i) => `junk-${i}`) } });
	const gps = { t: 'gps', lat: poi.lat, lon: poi.lon };
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
