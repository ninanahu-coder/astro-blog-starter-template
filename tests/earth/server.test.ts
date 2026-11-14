// 云存档服务端（EarthWorld）的回归测试：用内存里的假存储直接调 fetch()，不联网。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { WA } from '../../src/game/data/wa.ts';

function makeWorld() {
	const data = new Map<string, any>();
	let puts = 0;
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string, v: unknown) => { puts++; data.set(k, structuredClone(v)); },
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
