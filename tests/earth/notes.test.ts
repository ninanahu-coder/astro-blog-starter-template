// 地点留言板：文字规则（纯函数）和服务端的发帖、限额、删除
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNote, NOTE_MAX, NOTES_PER_DAY, NOTES_PER_LOC } from '../../src/game/core/notes.ts';
import { EarthWorld } from '../../src/game/server/world.ts';

test('留言文字：去掉控制字符和多余空白；空的、太长的、带网址或联系方式的不收', () => {
	assert.deepEqual(cleanNote('  这里的日落\n\t超美  '), { text: '这里的日落 超美' });
	assert.deepEqual(cleanNote('a‮b\u0007c'), { text: 'abc' }, '去掉方向控制符和响铃');
	assert.ok('error' in cleanNote('   '));
	assert.ok('error' in cleanNote('好'.repeat(NOTE_MAX + 1)));
	assert.deepEqual(cleanNote('好'.repeat(NOTE_MAX)), { text: '好'.repeat(NOTE_MAX) });
	for (const bad of ['看 https://x.y', 'www.abc', '加我 shop.com', '电话 0412 345 678', '微信@someone', '找我 ＠abc']) assert.ok('error' in cleanNote(bad), bad);
	assert.ok('text' in cleanNote('等了 20 分钟才看到海豚'), '短数字可以');
});

function world() {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
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

test('留言板：每个地点只留最近 20 条；同时来的留言都不丢', async () => {
	const { data, call } = world();
	const ids = Array.from({ length: NOTES_PER_LOC + 3 }, (_, i) => ({ id: `notes-crowd-${String(i).padStart(2, '0')}`, key: 'c'.repeat(24) }));
	for (const p of ids) await call({ action: 'create', ...p, profile });
	const res = await Promise.all(ids.map((p, i) => call({ action: 'notes', op: 'post', ...p, text: `第 ${i} 位` })));
	assert.ok(res.every((r) => r.data.ok));
	const stored = data.get('notes:perth') as { text: string }[];
	assert.equal(stored.length, NOTES_PER_LOC);
	assert.equal(stored.at(-1)!.text, `第 ${ids.length - 1} 位`);
});
