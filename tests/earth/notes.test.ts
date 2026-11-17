// 地点留言板：文字规则（纯函数）和服务端的发帖、限额、删除
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNote, NOTE_MAX, NOTES_LOC_DAY, NOTES_PER_DAY, NOTES_PER_LOC } from '../../src/game/core/notes.ts';
import { EarthWorld } from '../../src/game/server/world.ts';

test('留言文字：去掉控制字符和多余空白；空的、太长的、带网址或联系方式的不收', () => {
	assert.deepEqual(cleanNote('  这里的日落\n\t超美  '), { text: '这里的日落 超美' });
	assert.deepEqual(cleanNote('a‮b\u0007c'), { text: 'abc' }, '去掉方向控制符和响铃');
	assert.ok('error' in cleanNote('   '));
	assert.ok('error' in cleanNote('好'.repeat(NOTE_MAX + 1)));
	assert.deepEqual(cleanNote('好'.repeat(NOTE_MAX)), { text: '好'.repeat(NOTE_MAX) });
	for (const bad of ['看 https://x.y', 'www.abc', '加我 shop.com', '电话 0412 345 678', '微信@someone', '找我 ＠abc']) assert.ok('error' in cleanNote(bad), bad);
	assert.ok('text' in cleanNote('等了 20 分钟才看到海豚'), '短数字可以');
	// 审查问题 6：全角数字、点号分隔、拆开的网址、中文账号
	for (const bad of ['电话 ０４１２３４５６７８', '电话 0412.345.678', 'h t t p s : / / e x a m p l e . c o m', '微信 @微信号', 'w w w . a b c', '加微信 abcd1234']) assert.ok('error' in cleanNote(bad), bad);
	assert.ok('text' in cleanNote('2026 年第一次来，日落 6 点半'), '正常的年份和时间可以');
	// 复审问题 5：日期、营业时间、金额、普通提到平台名的句子不误杀
	for (const ok of ['2026-11-17 日落很美', '营业时间 09:00-17:00', '套餐一共 $1,234.56', '微信真的很好用', 'QQ音乐很好听', '2026年11月17日 到此一游']) assert.ok('text' in cleanNote(ok), ok);
	for (const bad of ['加 qq 12345678', '微信号: shop_abc', 'wx：abcde12', '电话 04 12 34 56 78']) assert.ok('error' in cleanNote(bad), bad);
});

function world(delayMs = 0) {
	const data = new Map<string, any>();
	const wait = () => (delayMs ? new Promise((d) => setTimeout(d, delayMs)) : Promise.resolve());
	const storage = {
		get: async (k: string) => { await wait(); return data.has(k) ? structuredClone(data.get(k)) : undefined; },
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			await wait();
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async () => new Map(),
	};
	const w = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await w.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call };
}
const profile = { name: '留言者', avatar: '🧑', origin: 'student', traits: [] };

test('留言板：同地点能看到，别处看不到；不发作者 id；同一地方一天一条、一天最多 3 条；只能删自己的', async () => {
	const { data, call } = world();
	const A = { id: 'notes-writer-1', key: 'a'.repeat(24) };
	const B = { id: 'notes-reader-1', key: 'b'.repeat(24) };
	await call({ action: 'create', ...A, profile });
	await call({ action: 'create', ...B, profile: { ...profile, name: '路过的' } });
	assert.equal((await call({ action: 'notes', op: 'post', ...A, text: 'www.spam' })).status, 400);
	const posted = await call({ action: 'notes', op: 'post', ...A, text: '<b>日落</b>很美' });
	assert.ok(posted.data.ok, posted.data.msg);
	assert.equal(posted.data.notes[0].text, '<b>日落</b>很美', '原样存下，界面负责转义');
	assert.equal(posted.data.notes[0].mine, true);
	assert.equal((await call({ action: 'notes', op: 'post', ...A, text: '再来一条' })).status, 429, '同一个地方一天一条');
	const seen = await call({ action: 'notes', op: 'list', ...B });
	assert.equal(seen.data.notes.length, 1);
	assert.equal(seen.data.notes[0].mine, false);
	assert.ok(!JSON.stringify(seen.data).includes(A.id), '不发作者的存档 id');
	assert.equal((await call({ action: 'notes', op: 'delete', ...B, note: seen.data.notes[0].id })).status, 403);
	// 换地方再留：一天最多 3 条
	const move = (loc: string) => { const rec = data.get('save:' + A.id); rec.state.loc = loc; data.set('save:' + A.id, rec); };
	for (const loc of ['fremantle', 'rottnest']) {
		move(loc);
		assert.ok((await call({ action: 'notes', op: 'post', ...A, text: `${loc} 打卡` })).data.ok);
	}
	move('bunbury');
	const fourth = await call({ action: 'notes', op: 'post', ...A, text: '第四条' });
	assert.equal(fourth.status, 429);
	assert.match(fourth.data.msg, new RegExp(`${NOTES_PER_DAY} 条`));
	assert.equal((await call({ action: 'notes', op: 'list', ...B })).data.notes.length, 1, 'B 在珀斯，只看到珀斯的');
	move('perth');
	const del = await call({ action: 'notes', op: 'delete', ...A, note: seen.data.notes[0].id });
	assert.ok(del.data.ok);
	assert.equal(del.data.notes.length, 0);
	assert.deepEqual(data.get('notes:perth'), []);
});

test('留言板：每个地点每天最多新增 10 条，同时来的不丢、不超；只留最近 20 条', async () => {
	const { data, call } = world();
	const ids = Array.from({ length: NOTES_LOC_DAY + 3 }, (_, i) => ({ id: `notes-crowd-${String(i).padStart(2, '0')}`, key: 'c'.repeat(24) }));
	for (const p of ids) await call({ action: 'create', ...p, profile });
	// 先放 19 条以前的留言：今天再加 10 条后只留最近 20 条
	data.set('notes:perth', Array.from({ length: 19 }, (_, i) => ({ id: i.toString(16).padStart(8, '0'), author: 'eeeeeeeeeeee', name: '旧', avatar: '🧑', text: `旧 ${i}`, at: 0, day: 1 })));
	const res = await Promise.all(ids.map((p, i) => call({ action: 'notes', op: 'post', ...p, text: `第 ${i} 位` })));
	assert.equal(res.filter((r) => r.data.ok).length, NOTES_LOC_DAY, '每天最多 10 条');
	assert.ok(res.filter((r) => !r.data.ok).every((r) => r.status === 429));
	const stored = data.get('notes:perth') as { text: string; day: number }[];
	assert.equal(stored.length, NOTES_PER_LOC);
	assert.equal(stored.filter((n) => n.day !== 1).length, NOTES_LOC_DAY, '今天的 10 条都在');
});

test('留言板：删帖不退地点额度；读写交错的同时发帖也不超过 10 条（复审问题 2）', async () => {
	const { data, call } = world(2);
	const ids = Array.from({ length: NOTES_LOC_DAY + 3 }, (_, i) => ({ id: `notes-churn-${String(i).padStart(2, '0')}`, key: 'c'.repeat(24) }));
	for (const p of ids) await call({ action: 'create', ...p, profile });
	// 前 6 个人发了又删
	for (const p of ids.slice(0, 6)) {
		const r = await call({ action: 'notes', op: 'post', ...p, text: '发了就删' });
		assert.ok(r.data.ok);
		assert.ok((await call({ action: 'notes', op: 'delete', ...p, note: r.data.notes[0].id })).data.ok);
	}
	const res = await Promise.all(ids.slice(6).map((p, i) => call({ action: 'notes', op: 'post', ...p, text: `第 ${i} 位` })));
	assert.equal(res.filter((r) => r.data.ok).length, NOTES_LOC_DAY - 6, '删掉的也算今天新增过的');
	assert.equal((data.get('notes:perth') as unknown[]).length, NOTES_LOC_DAY - 6);
});

test('留言板：发留言后时钟回拨到前一天，同一地点也不能再留（复审问题 4）', async () => {
	const realNow = Date.now;
	try {
		const { call } = world();
		const A = { id: 'notes-clock-1', key: 'a'.repeat(24) };
		// 珀斯午夜前 10 分钟建档（存档时间落在前一天）
		const day0 = Math.ceil(realNow() / 86_400_000) * 86_400_000 - 8 * 3_600_000; // 某个珀斯午夜（UTC+8）
		Date.now = () => day0 - 600_000;
		await call({ action: 'create', ...A, profile });
		Date.now = () => day0 + 100;
		assert.ok((await call({ action: 'notes', op: 'post', ...A, text: '过了午夜' })).data.ok);
		Date.now = () => day0 - 100;
		const again = await call({ action: 'notes', op: 'post', ...A, text: '回拨再来' });
		assert.equal(again.status, 429);
	} finally {
		Date.now = realNow;
	}
});
