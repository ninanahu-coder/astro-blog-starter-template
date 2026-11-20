// 屏蔽与举报（第 24 批）：纯函数规则、服务端的屏蔽 / 举报 / 自动隐藏 / 送礼拦截、在线频道的屏蔽和联系方式过滤
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { addReport, BLOCK_MAX, blockPlayer, isBlocked, REPORT_HIDE_BY, REPORT_WINDOW_DAYS, REPORTS_PER_DAY, reportHidden, unblockPlayer, type ReportRec } from '../../src/game/core/safety.ts';
import { contactError } from '../../src/game/core/notes.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { EarthWorld } from '../../src/game/server/world.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { saleRange } from '../../src/game/core/trade.ts';

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const base = () => createCharacter({ id: 'safety-x', name: '甲', avatar: '🧑', origin: 'student', traits: [], region: 'wa', spawn: 'perth', seed: 1 });

test('屏蔽名单：加、去重、解除；不改入参；不能屏蔽自己；坏哈希不收；有上限', () => {
	const s = base();
	const h = 'abcdef012345';
	const b = blockPlayer(s, { hash: h, name: '乙', avatar: '😀' }, 100) as ReturnType<typeof base>;
	assert.ok(isBlocked(b, h));
	assert.ok(!isBlocked(s, h), '入参没被改');
	assert.equal(blockPlayer(b, { hash: h, name: '乙', avatar: '😀' }, 101), b, '重复屏蔽什么也不变');
	assert.equal(typeof blockPlayer(s, { hash: h, name: '乙', avatar: '' }, 1, h), 'string', '不能屏蔽自己');
	assert.equal(typeof blockPlayer(s, { hash: 'XYZ', name: '乙', avatar: '' }, 1), 'string');
	assert.ok(!isBlocked(unblockPlayer(b, h), h));
	assert.ok(isBlocked(b, h), '解除也不改入参');
	let full = s;
	for (let i = 0; i < BLOCK_MAX; i++) full = blockPlayer(full, { hash: i.toString(16).padStart(12, '0'), name: 'x', avatar: '' }, 1) as typeof s;
	assert.equal(Object.keys(full.blocked).length, BLOCK_MAX);
	assert.match(blockPlayer(full, { hash: 'ffffffffffff', name: 'x', avatar: '' }, 1) as string, /最多/);
	// 存档校验：坏键、超量丢掉，名字头像清洗
	const raw = { ...s, blocked: { ...full.blocked, ffffffffffff: { name: 'y', avatar: '', day: 1 }, bad: { name: 'z' }, abcdef012345: { name: '<b>', avatar: '<img>', day: 'x' } } };
	const clean = sanitizeState(raw, new Set(WORLD.locations.map((l) => l.id)))!;
	assert.ok(Object.keys(clean.blocked).length <= BLOCK_MAX);
	assert.ok(!('bad' in clean.blocked));
	for (const v of Object.values(clean.blocked)) assert.ok(!/[<>]/.test(v.name + v.avatar));
});

test('举报：同一人同一天对同一人只算一次；原话截断；最近 7 天 3 个不同的人举报才隐藏（窗口边界）', () => {
	const r = (by: string, day: number): ReportRec => ({ by, reason: 'spam', ctx: 'note', day, quote: 'x'.repeat(500) });
	const one = addReport([], r('aaaaaaaaaaaa', 100)) as ReportRec[];
	assert.equal(one[0].quote.length, 120);
	assert.equal(typeof addReport(one, r('aaaaaaaaaaaa', 100)), 'string', '同一天重复举报');
	assert.equal((addReport(one, r('aaaaaaaaaaaa', 101)) as ReportRec[]).length, 2, '第二天可以再报');
	assert.equal(REPORT_HIDE_BY, 3);
	const today = 200;
	const edge = today - REPORT_WINDOW_DAYS + 1; // 窗口里最早的一天
	const two = [r('aaaaaaaaaaaa', edge), r('bbbbbbbbbbbb', today), r('bbbbbbbbbbbb', today - 1)];
	assert.equal(reportHidden(two, today), false, '两个人举报三次也不隐藏');
	assert.equal(reportHidden([...two, r('cccccccccccc', today)], today), true, '第三个人');
	assert.equal(reportHidden([r('aaaaaaaaaaaa', edge - 1), two[1], r('cccccccccccc', today)], today), false, '窗口外的那次不算');
	assert.equal(reportHidden([r('aaaaaaaaaaaa', edge), two[1], r('cccccccccccc', today)], today), true, '窗口最早一天算');
	assert.equal(reportHidden(undefined, today), false);
});

test('联系方式检测：聊天和留言共用；坐标、电话、网址不能发，正常的话照发', () => {
	for (const bad of ['我在 -31.9505, 115.8605', '坐标 -34.93,138.60', '0412 345 678', 'wa.me/123', '加我 wx: abc12345']) assert.ok(contactError(bad), bad);
	for (const ok of ['一起去海边吗', '我在珀斯，下午 3:30 出发', '门票 $45']) assert.equal(contactError(ok), undefined, ok);
});

function world() {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv)); },
		list: async () => new Map(),
	};
	const w = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await w.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { w, data, call };
}
const profile = (name: string) => ({ name, avatar: '🧑', origin: 'student', traits: [] });
const P = (n: string) => ({ id: `safety-player-${n}`, key: n.repeat(24) });
async function rev(call: ReturnType<typeof world>['call'], who: { id: string; key: string }) {
	return (await call({ action: 'get', ...who })).data.state.rev;
}

test('服务端：屏蔽在线的人，看不到他的留言；解除后又能看到；不能屏蔽自己；版本不对返回 409', async () => {
	const { call } = world();
	const A = P('a'), B = P('b');
	await call({ action: 'create', ...A, profile: profile('阿甲') });
	await call({ action: 'create', ...B, profile: profile('阿乙') });
	assert.ok((await call({ action: 'notes', op: 'post', ...B, text: '日落很美' })).data.ok);
	assert.equal((await call({ action: 'notes', op: 'list', ...A })).data.notes.length, 1);
	assert.equal((await call({ action: 'safety', op: 'block', ...A, peer: hashOf(B.id), rev: 999 })).status, 409);
	assert.equal((await call({ action: 'safety', op: 'block', ...A, peer: hashOf(A.id), rev: await rev(call, A) })).status, 400);
	assert.equal((await call({ action: 'safety', op: 'block', ...A, peer: 'ffffffffffff', rev: await rev(call, A) })).status, 404, '不存在的玩家');
	const blk = await call({ action: 'safety', op: 'block', ...A, peer: hashOf(B.id), rev: await rev(call, A) });
	assert.ok(blk.data.ok, blk.data.msg);
	assert.equal(blk.data.state.blocked[hashOf(B.id)].name, '阿乙', '名字由服务端从存档取');
	assert.equal(JSON.stringify(blk.data).includes(B.id), false, '对方的真实 id 不出服务端');
	assert.equal((await call({ action: 'notes', op: 'list', ...A })).data.notes.length, 0, '屏蔽后看不到');
	assert.equal((await call({ action: 'notes', op: 'list', ...B })).data.notes.length, 1, '自己的照常看得到');
	const un = await call({ action: 'safety', op: 'unblock', ...A, hash: hashOf(B.id), rev: blk.data.state.rev });
	assert.ok(un.data.ok);
	assert.equal((await call({ action: 'notes', op: 'list', ...A })).data.notes.length, 1);
});

test('服务端：举报留言顺手屏蔽；3 个不同的人举报后这人的留言对其他人也隐藏；每人每天最多举报 5 次', async () => {
	const { call, data } = world();
	const bad = P('z');
	await call({ action: 'create', ...bad, profile: profile('捣乱的') });
	const note = (await call({ action: 'notes', op: 'post', ...bad, text: '来玩呀来玩呀' })).data.notes[0].id;
	const reporters = ['c', 'd', 'e'].map(P);
	const bystander = P('f');
	for (const r of [...reporters, bystander]) await call({ action: 'create', ...r, profile: profile('路人') });
	assert.equal((await call({ action: 'safety', op: 'report', ...reporters[0], note, reason: 'nope', rev: await rev(call, reporters[0]) })).status, 400, '原因必须在列表里');
	for (const [i, r] of reporters.entries()) {
		const res = await call({ action: 'safety', op: 'report', ...r, note, reason: 'spam', rev: await rev(call, r) });
		assert.ok(res.data.ok, res.data.msg);
		assert.ok(isBlocked(res.data.state, hashOf(bad.id)), '举报的人顺手屏蔽了');
		const seen = (await call({ action: 'notes', op: 'list', ...bystander })).data.notes.length;
		assert.equal(seen, i < 2 ? 1 : 0, `第 ${i + 1} 个举报后旁观者${i < 2 ? '还能' : '看不到'}`);
	}
	assert.equal((await call({ action: 'notes', op: 'list', ...bad })).data.notes.length, 1, '本人看得到自己的（不知道被隐藏）');
	const rec = data.get('report:' + hashOf(bad.id));
	assert.equal(rec.length, 3);
	assert.equal(rec[0].quote, '来玩呀来玩呀', '留言原话由服务端取');
	assert.equal(JSON.stringify(rec).includes(reporters[0].id), false, '举报记录里没有真实 id');
	// 每天最多 5 次
	const spammer = P('g');
	await call({ action: 'create', ...spammer, profile: profile('爱举报') });
	const targets = ['h', 'i', 'j', 'k', 'l', 'm'].map(P);
	for (const t of targets) await call({ action: 'create', ...t, profile: profile('谁') });
	const results = [];
	for (const t of targets) results.push((await call({ action: 'safety', op: 'report', ...spammer, peer: hashOf(t.id), reason: 'other', rev: await rev(call, spammer) })).status);
	assert.deepEqual(results, [200, 200, 200, 200, 200, 429].slice(0, REPORTS_PER_DAY + 1));
});

test('服务端：对方屏蔽了我，送不了礼；我屏蔽的人的二手摊我看不到', async () => {
	const { call, data } = world();
	const A = P('n'), B = P('o');
	await call({ action: 'create', ...A, profile: profile('送礼的') });
	await call({ action: 'create', ...B, profile: profile('收礼的') });
	data.get('save:' + A.id).state.inventory = { snack: 3 };
	const gift = { action: 'trade', op: 'gift', ...A, to: hashOf(B.id), item: 'snack' };
	const first = await call(gift);
	assert.ok(first.data.ok, first.data.msg);
	await call({ action: 'trade', op: 'cancel', ...A, offer: first.data.offers[0].id });
	const sale = await call({ action: 'trade', op: 'sale', ...A, item: 'snack', price: saleRange('snack')!.min });
	assert.ok(sale.data.ok, sale.data.msg);
	assert.equal((await call({ action: 'trade', op: 'list', ...B })).data.offers.length, 1, '屏蔽前 B 看得到 A 的摊');
	const blk = await call({ action: 'safety', op: 'block', ...B, peer: hashOf(A.id), rev: await rev(call, B) });
	assert.ok(blk.data.ok, blk.data.msg);
	const no = await call(gift);
	assert.equal(no.data.ok, false);
	assert.match(no.data.msg, /收不到/);
	assert.equal((await call({ action: 'trade', op: 'list', ...B })).data.offers.length, 0, '屏蔽的人的挂单看不到');
	assert.equal((await call({ action: 'trade', op: 'list', ...A })).data.offers.length, 1, 'A 自己的摊照常在');
	const un = await call({ action: 'safety', op: 'unblock', ...B, hash: hashOf(A.id), rev: blk.data.state.rev });
	assert.ok(un.data.ok);
	assert.equal((await call({ action: 'trade', op: 'list', ...B })).data.offers.length, 1, '解除后又看得到');
});

test('在线频道：屏蔽了谁就收不到他的聊天和表情；带联系方式的聊天不转发、只告诉发的人', () => {
	const w = new EarthWorld({ storage: {} } as never, {}) as any;
	const box = (loc: string) => ({ got: [] as any[], loc, send(m: string) { this.got.push(JSON.parse(m)); } });
	const a = box('perth'), b = box('perth'), c = box('perth');
	w.sockets.set(a, { id: 'aaaaaaaaaaaa', name: 'A', avatar: '🧑', loc: 'perth' });
	w.sockets.set(b, { id: 'bbbbbbbbbbbb', name: 'B', avatar: '🧑', loc: 'perth' });
	w.sockets.set(c, { id: 'cccccccccccc', name: 'C', avatar: '🧑', loc: 'perth' });
	const locs = new Set(WA.locations.map((l) => l.id));
	w.onMessage(b, JSON.stringify({ t: 'mute', ids: ['aaaaaaaaaaaa', 'not-a-hash'] }), locs);
	w.onMessage(a, JSON.stringify({ t: 'chat', text: '大家好' }), locs);
	assert.equal(b.got.length, 0, 'B 屏蔽了 A');
	assert.equal(c.got.filter((m) => m.t === 'chat').length, 1, 'C 照常收到');
	w.onMessage(a, JSON.stringify({ t: 'emote', to: 'bbbbbbbbbbbb', kind: '👋' }), locs);
	assert.equal(b.got.length, 0, '表情也收不到');
	w.onMessage(a, JSON.stringify({ t: 'emote', to: 'cccccccccccc', kind: '👋' }), locs);
	assert.equal(c.got.filter((m) => m.t === 'emote').length, 1);
	const before = c.got.length;
	w.onMessage(a, JSON.stringify({ t: 'chat', text: '我在 -31.9505, 115.8605 来找我' }), locs);
	assert.equal(c.got.length, before, '坐标不转发');
	assert.equal(a.got.at(-1).t, 'notice');
	w.onMessage(b, JSON.stringify({ t: 'mute', ids: [] }), locs);
	w.onMessage(a, JSON.stringify({ t: 'chat', text: '又见面了' }), locs);
	assert.equal(b.got.filter((m) => m.t === 'chat').length, 1, '解除后又能收到');
});
