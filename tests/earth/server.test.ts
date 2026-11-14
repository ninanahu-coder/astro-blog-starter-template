// 云存档服务端（EarthWorld）的回归测试：用内存里的假存储直接调 fetch()，不联网。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { WA } from '../../src/game/data/wa.ts';

/** delayMs > 0 时每次读写都真的等一会儿，让同时到的请求在没有锁的情况下一定会交错（读到同一份旧存档） */
function makeWorld(delayMs = 0) {
	const data = new Map<string, any>();
	let puts = 0;
	const wait = () => (delayMs ? new Promise((done) => setTimeout(done, delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string, v: unknown) => { await wait(); puts++; data.set(k, structuredClone(v)); },
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, puts: () => puts };
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
