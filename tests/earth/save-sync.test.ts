// 存档与多端同步（第 50 批）：格式版本和迁移、来回部署时保留别的分支加的字段、损坏存档、
// 更换同步码（含回复丢失重交、两台设备同时换）、导出、删除账号、限流表不会被刷空。
// 设计和问题清单见 docs/earth-game/save-sync.md。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarthWorld } from '../../src/game/server/world.ts';
import { sanitizeState } from '../../src/game/core/character.ts';
import { carryUnknown, FOREIGN_MAX_CHARS, migrateSave, SAVE_VERSION } from '../../src/game/core/save.ts';
import { WA } from '../../src/game/data/wa.ts';

/** 内存假存储（带 delete，和 Durable Object 存储一样：多键 put / delete 一次完成） */
function makeWorld(delayMs = 0) {
	const data = new Map<string, any>();
	let puts = 0;
	const wait = () => (delayMs ? new Promise((done) => setTimeout(done, delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			await wait();
			puts++;
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		delete: async (k: string | string[]) => { await wait(); for (const kk of Array.isArray(k) ? k : [k]) data.delete(kk); },
		list: async ({ prefix = '' }: { prefix?: string } = {}) => {
			await wait();
			return new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)]));
		},
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>, ip = 'local') => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': ip } }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, world, puts: () => puts };
}
const profile = { name: '同步', avatar: '🧑', origin: 'student', traits: [] };
const hashOf = async (id: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
async function player(w: ReturnType<typeof makeWorld>, id: string, key = 'k'.repeat(24)) {
	const c = { id, key };
	const r = await w.call({ action: 'create', ...c, profile });
	assert.ok(r.data.ok, r.data.msg);
	return { c, s0: r.data.state };
}

// ---------- core ----------

test('存档版本：没有版本号或不是正整数的不是存档；比这版代码新的不判损坏；不改入参', () => {
	for (const v of [undefined, 0, -1, 1.5, '1', null, NaN]) assert.equal(migrateSave({ v, id: 'abcdef', loc: 'perth' }), null, `v=${String(v)}`);
	assert.equal(migrateSave(null), null);
	assert.equal(migrateSave([1]), null);
	const cur = { v: SAVE_VERSION, id: 'abcdef' };
	assert.deepEqual(migrateSave(cur), cur);
	const newer = { v: SAVE_VERSION + 1, id: 'abcdef', pets: ['dog'] };
	const out = migrateSave(newer)!;
	assert.equal(out.v, SAVE_VERSION + 1, '新版本原样读，不降级');
	assert.notEqual(out, newer, '返回新对象');
	// 新版本存档用这版的 sanitizeState 也能读（回滚、正式环境切到旧分支时不会整份判损坏）
	const st = sanitizeState({ v: SAVE_VERSION + 1, id: 'newer-save', loc: WA.spawn, cash: 77 })!;
	assert.equal(st.cash, 77);
	assert.equal(st.v, 1);
});

test('存档迁移：按迁移表一步步升上来；缺一步就判损坏；迁移函数拿到的是拷贝', () => {
	const steps = {
		1: (r: Record<string, unknown>) => ({ ...r, money: r.cash, cash: undefined }),
		2: (r: Record<string, unknown>) => ({ ...r, money: Number(r.money) * 2 }),
	};
	const raw = { v: 1, cash: 10 };
	const out = migrateSave(raw, 3, steps)!;
	assert.equal(out.v, 3);
	assert.equal(out.money, 20);
	assert.deepEqual(raw, { v: 1, cash: 10 }, '入参不变');
	assert.equal(migrateSave({ v: 2, money: 5 }, 3, steps)!.money, 10, '从中间版本开始也行');
	assert.equal(migrateSave({ v: 1, cash: 10 }, 3, { 1: steps[1] }), null, '缺 2→3');
	assert.equal(migrateSave({ v: 1 }, 2, Object.create({ 1: steps[1] })), null, '原型链上的迁移不算');
});

test('未知字段：原样带上，认识的字段以清洗结果为准；怪键名、超限的整批丢掉；版本号取大的；重复执行结果不变', () => {
	const clean = { v: 1, id: 'abcdef', cash: 5 };
	const raw = JSON.parse('{"v":2,"id":"abcdef","cash":999999,"pets":{"dog":1},"__proto__":{"x":1},"1bad":1,"a-b":2,"fn":3}');
	const out = carryUnknown(raw, clean) as any;
	assert.deepEqual(out.pets, { dog: 1 });
	assert.equal(out.cash, 5, '认识的字段不被原存档盖掉');
	assert.equal(out.v, 2, '版本号不倒退');
	assert.equal(out.fn, 3);
	assert.ok(!Object.hasOwn(out, '__proto__') && !('1bad' in out) && !('a-b' in out));
	assert.equal(({} as any).x, undefined, '没有污染原型');
	assert.deepEqual(carryUnknown(out, clean), out, '幂等');
	const big = carryUnknown({ v: 1, huge: 'x'.repeat(FOREIGN_MAX_CHARS + 1) }, clean);
	assert.deepEqual(big, clean, '超限整批不带');
	const many: Record<string, unknown> = { v: 1 };
	for (let i = 0; i < 40; i++) many['k' + i] = i;
	assert.deepEqual(carryUnknown(many, clean), clean, '个数超限整批不带');
	assert.equal(carryUnknown('junk', clean), clean);
});

// ---------- 服务端 ----------

test('来回部署：别的分支加的字段和更新的版本号在这版代码结算后还在；没修改时读取不写盘（审查问题 1）', async () => {
	const w = makeWorld();
	const { c } = await player(w, 'deploy-a');
	const rec = w.data.get('save:' + c.id);
	rec.state = { ...rec.state, v: 2, pets: { cat: { name: '咪', hunger: 40 } } };
	w.data.set('save:' + c.id, rec);
	const got = await w.call({ action: 'get', ...c });
	assert.equal(got.status, 200, '新版本存档不判损坏');
	assert.equal(got.data.state.pets, undefined, '不认识的字段不发给客户端');
	const before = w.puts();
	await w.call({ action: 'get', ...c });
	assert.equal(w.puts(), before, '别的分支的字段不算「修过」，读取不重复写');
	const a = await w.call({ action: 'act', ...c, rev: got.data.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.ok(a.data.ok, a.data.msg);
	const saved = w.data.get('save:' + c.id).state;
	assert.deepEqual(saved.pets, { cat: { name: '咪', hunger: 40 } }, '结算后宠物还在');
	assert.equal(saved.v, 2);
	assert.equal(saved.rev, got.data.state.rev + 1);
});

test('来回部署：共同事件、送礼成交写别人存档时也保留对方的未知字段', async () => {
	const w = makeWorld();
	const A = (await player(w, 'deploy-gift-a', 'a'.repeat(24))).c;
	const B = (await player(w, 'deploy-gift-b', 'b'.repeat(24))).c;
	const ra = w.data.get('save:' + A.id);
	ra.state.inventory = { snack: 2 };
	ra.state.garden = ['tomato'];
	w.data.set('save:' + A.id, ra);
	const rb = w.data.get('save:' + B.id);
	rb.state.garden = ['basil'];
	w.data.set('save:' + B.id, rb);
	const sent = await w.call({ action: 'trade', op: 'gift', ...A, to: await hashOf(B.id), toName: '乙', item: 'snack' });
	assert.ok(sent.data.ok, sent.data.msg);
	const got = await w.call({ action: 'trade', op: 'accept', ...B, offer: sent.data.offers[0].id, rev: rb.state.rev });
	assert.ok(got.data.ok, got.data.msg);
	assert.deepEqual(w.data.get('save:' + A.id).state.garden, ['tomato']);
	assert.deepEqual(w.data.get('save:' + B.id).state.garden, ['basil']);
});

test('损坏存档：存档里的 id 和键对不上时判损坏、原样留着，不能新建同 id 的角色盖掉（审查问题 2）', async () => {
	const w = makeWorld();
	const { c } = await player(w, 'corrupt-a');
	const rec = w.data.get('save:' + c.id);
	rec.state.id = 'someone-else';
	w.data.set('save:' + c.id, rec);
	const got = await w.call({ action: 'get', ...c });
	assert.equal(got.status, 500);
	assert.equal(got.data.corrupt, true);
	assert.equal((await w.call({ action: 'act', ...c, rev: 0, act: { t: 'activity', id: 'rest' } })).status, 500);
	assert.equal((await w.call({ action: 'create', ...c, profile })).status, 409);
	assert.equal(w.data.get('save:' + c.id).state.id, 'someone-else', '没被覆盖');
});

test('更换同步码：旧码立即失效（带 badKey）、新码能用，进度和版本号不变；新码无效或和旧码一样都拒绝', async () => {
	const w = makeWorld();
	const { c, s0 } = await player(w, 'rekey-a');
	const newKey = 'n'.repeat(24);
	assert.equal((await w.call({ action: 'rekey', ...c, newKey: 'short' })).status, 400);
	assert.equal((await w.call({ action: 'rekey', ...c, newKey: c.key })).status, 400);
	const r = await w.call({ action: 'rekey', ...c, newKey });
	assert.ok(r.data.ok, r.data.msg);
	assert.equal(r.data.state.rev, s0.rev, '换码不算一次动作');
	const old = await w.call({ action: 'get', ...c });
	assert.equal(old.status, 403);
	assert.equal(old.data.badKey, true);
	const ok = await w.call({ action: 'get', id: c.id, key: newKey });
	assert.equal(ok.status, 200);
	assert.equal(ok.data.state.cash, s0.cash);
	assert.ok(!JSON.stringify(w.data.get('save:' + c.id)).includes(newKey), '服务端只存哈希');
});

test('更换同步码：回复丢了拿旧码重交同一个新码，当成功；换成别的新码不行', async () => {
	const w = makeWorld();
	const { c } = await player(w, 'rekey-dup');
	const newKey = 'm'.repeat(24);
	assert.ok((await w.call({ action: 'rekey', ...c, newKey })).data.ok);
	const again = await w.call({ action: 'rekey', ...c, newKey });
	assert.equal(again.status, 200);
	assert.equal(again.data.dup, true);
	assert.equal(again.data.state.id, c.id);
	assert.equal((await w.call({ action: 'rekey', ...c, newKey: 'z'.repeat(24) })).status, 403, '旧码不能再换成别的');
	assert.equal((await w.call({ action: 'get', id: c.id, key: 'z'.repeat(24) })).status, 403);
});

test('并发：两台设备同时换码只有一个生效；换码和另一台设备的动作同时到，排队执行，动作要么用旧码成功要么被拒', async () => {
	const w = makeWorld(3);
	const { c, s0 } = await player(w, 'rekey-race');
	const [x, y] = await Promise.all([
		w.call({ action: 'rekey', ...c, newKey: 'x'.repeat(24) }),
		w.call({ action: 'rekey', ...c, newKey: 'y'.repeat(24) }),
	]);
	assert.deepEqual([x.status, y.status].sort(), [200, 403]);
	const winner = x.status === 200 ? 'x'.repeat(24) : 'y'.repeat(24);
	assert.equal((await w.call({ action: 'get', id: c.id, key: winner })).status, 200);
	const k2 = 'w'.repeat(24);
	const [act, rk] = await Promise.all([
		w.call({ action: 'act', id: c.id, key: winner, rev: s0.rev, act: { t: 'activity', id: 'rest' }, op: 'race0000000001' }),
		w.call({ action: 'rekey', id: c.id, key: winner, newKey: k2 }),
	]);
	assert.ok(rk.data.ok);
	assert.ok(act.status === 200 || act.status === 403, String(act.status));
	const rev = w.data.get('save:' + c.id).state.rev;
	assert.equal(rev, act.status === 200 ? s0.rev + 1 : s0.rev, '动作最多结算一次，存档和回复一致');
});

test('并发：两台设备离线后同一版本各交一个动作，一个结算、一个 409 带回最新存档；带同一编号按新版本重交只结算一次', async () => {
	const w = makeWorld(3);
	const { c, s0 } = await player(w, 'offline-two');
	const act = { t: 'activity', id: 'rest' };
	const [a, b] = await Promise.all([
		w.call({ action: 'act', ...c, rev: s0.rev, act, op: 'devicea00000001' }),
		w.call({ action: 'act', ...c, rev: s0.rev, act, op: 'deviceb00000001' }),
	]);
	const lost = a.status === 409 ? a : b;
	const lostOp = a.status === 409 ? 'devicea00000001' : 'deviceb00000001';
	assert.deepEqual([a.status, b.status].sort(), [200, 409]);
	assert.equal(lost.data.conflict, true);
	assert.equal(lost.data.state.rev, s0.rev + 1, '冲突回复带回最新版本');
	const retry = await w.call({ action: 'act', ...c, rev: lost.data.state.rev, act, op: lostOp });
	assert.ok(retry.data.ok, retry.data.msg);
	const again = await w.call({ action: 'act', ...c, rev: retry.data.state.rev, act, op: lostOp });
	assert.equal(again.data.dup, true, '同一编号再交不再结算');
	assert.equal(w.data.get('save:' + c.id).state.rev, s0.rev + 2);
});

test('导出：有存档、自己的留言、榜单记录和未知字段；没有同步码、真实 id 和种子；别人的留言不在里面', async () => {
	const w = makeWorld();
	const A = (await player(w, 'export-a', 'a'.repeat(24))).c;
	const B = (await player(w, 'export-b', 'b'.repeat(24))).c;
	const rec = w.data.get('save:' + A.id);
	rec.state.pets = ['dog'];
	w.data.set('save:' + A.id, rec);
	assert.ok((await w.call({ action: 'notes', op: 'post', ...A, text: '甲的留言' })).data.ok);
	assert.ok((await w.call({ action: 'notes', op: 'post', ...B, text: '乙的留言' })).data.ok);
	const r = await w.call({ action: 'export', ...A });
	assert.ok(r.data.ok, r.data.msg);
	const ex = r.data.export;
	assert.equal(ex.format, 'earth-save-export');
	assert.equal(ex.v, SAVE_VERSION);
	assert.equal(ex.player, await hashOf(A.id));
	assert.deepEqual(ex.state.pets, ['dog']);
	assert.equal(ex.state.seed, 0);
	assert.equal(ex.notes.length, 1);
	assert.equal(ex.notes[0].text, '甲的留言');
	assert.ok(ex.rank, '榜单记录');
	const text = JSON.stringify(r.data);
	assert.ok(!text.includes(A.id), '不含真实 id');
	assert.ok(!text.includes(A.key), '不含同步码');
	assert.ok(!text.includes('乙的留言'));
	assert.equal((await w.call({ action: 'export', id: A.id, key: 'x'.repeat(24) })).status, 403);
});

test('删除账号：要确认；删掉存档、动作编号、榜单、哈希索引、留言、挂单和队伍，别人不受影响；删后同码 404', async () => {
	const w = makeWorld();
	const A = (await player(w, 'delete-a', 'a'.repeat(24))).c;
	const B = (await player(w, 'delete-b', 'b'.repeat(24))).c;
	const ra = w.data.get('save:' + A.id);
	ra.state.inventory = { snack: 2 };
	w.data.set('save:' + A.id, ra);
	const hA = await hashOf(A.id);
	assert.ok((await w.call({ action: 'act', ...A, rev: ra.state.rev, act: { t: 'activity', id: 'rest' }, op: 'deleteop000001' })).data.ok);
	assert.ok((await w.call({ action: 'notes', op: 'post', ...A, text: '要删的' })).data.ok);
	assert.ok((await w.call({ action: 'notes', op: 'post', ...B, text: '留着的' })).data.ok);
	assert.ok((await w.call({ action: 'trade', op: 'gift', ...A, to: await hashOf(B.id), toName: '乙', item: 'snack' })).data.ok);
	assert.equal((await w.call({ action: 'delete', ...A })).status, 400, '没确认不删');
	assert.equal((await w.call({ action: 'delete', id: A.id, key: 'x'.repeat(24), confirm: 'delete' })).status, 403, '码不对不删');
	const del = await w.call({ action: 'delete', ...A, confirm: 'delete' });
	assert.ok(del.data.ok, del.data.msg);
	for (const k of ['save:' + A.id, 'ops:' + A.id, 'rank:' + hA, 'h:' + hA, 'notecd:' + hA]) assert.ok(!w.data.has(k), `${k} 已删`);
	const leftovers = [...w.data.entries()].filter(([k]) => k.startsWith('notes:')).flatMap(([, v]) => v as any[]);
	assert.ok(!leftovers.some((n) => n.author === hA), '留言删了');
	assert.ok(leftovers.some((n) => n.text === '留着的'), '别人的留言还在');
	assert.equal((await w.call({ action: 'trade', op: 'list', ...B })).data.offers.length, 0, '给乙的礼物撤了');
	const board = await w.call({ action: 'board', ...B });
	assert.equal(board.data.total, 1, '榜上只剩乙');
	assert.equal((await w.call({ action: 'get', ...A })).status, 404);
	assert.equal((await w.call({ action: 'get', ...B })).status, 200);
	const notes = await w.call({ action: 'notes', op: 'list', ...B });
	assert.deepEqual(notes.data.notes.map((n: any) => n.text), ['留着的'], '内存里的留言列表也更新了');
});

test('删除账号和另一台设备的动作同时到：排队执行，删除后的动作 404，不会把存档写回来', async () => {
	const w = makeWorld(3);
	const { c, s0 } = await player(w, 'delete-race');
	const [del, act] = await Promise.all([
		w.call({ action: 'delete', ...c, confirm: 'delete' }),
		w.call({ action: 'act', ...c, rev: s0.rev, act: { t: 'activity', id: 'rest' } }),
	]);
	assert.ok(del.data.ok);
	assert.equal(act.status, 404);
	assert.ok(!w.data.has('save:' + c.id), '没被写回来');
});

test('限流：IP 表满了只清过期的，不会把正在被限的人一起清零（审查问题 5）', async () => {
	const w = makeWorld();
	const bad = { action: 'get', id: 'x', key: 'y' };
	for (let i = 0; i < 90; i++) await w.call(bad, 'abuser');
	assert.equal((await w.call(bad, 'abuser')).status, 429);
	for (let i = 0; i < 5001; i++) await w.call(bad, 'ip' + i);
	assert.equal((await w.call(bad, 'abuser')).status, 429, '还在限');
	assert.equal((await w.call(bad, 'fresh-ip')).status, 503, '表满且都没过期：新来的先拒绝，不清表');
});
