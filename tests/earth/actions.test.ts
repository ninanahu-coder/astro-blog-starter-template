import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, publicState } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { WA } from '../../src/game/data/wa.ts';

const make = () => createCharacter({ id: 'act-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 9 });

test('parseAction 只接受合法形状', () => {
	assert.deepEqual(parseAction({ t: 'travel', to: 'fremantle', mode: 'road' }), { t: 'travel', to: 'fremantle', mode: 'road' });
	assert.deepEqual(parseAction({ t: 'npc', npc: 'mia', act: 'gift', extra: 1 }), { t: 'npc', npc: 'mia', act: 'gift' }, '多余字段被丢弃');
	for (const bad of [
		null, 'travel', {}, { t: 'hack' },
		{ t: 'travel', to: 'fremantle', mode: 'teleport' },
		{ t: 'travel', to: '../etc', mode: 'road' },
		{ t: 'event', choice: -1 }, { t: 'event', choice: 1.5 }, { t: 'event', choice: '0' },
		{ t: 'gps', lat: 200, lon: 0 }, { t: 'gps', lat: NaN, lon: 0 },
		{ t: 'buy', item: 'A'.repeat(100) }, { t: 'npc', npc: 'mia', act: 'rob' },
		{ t: 'activity', id: { toString: () => 'eat' } },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
});

test('applyAction：成功时版本号 +1，失败时存档不变', () => {
	const s = make();
	const ok = applyAction(s, WA, { t: 'activity', id: 'eat' });
	assert.ok(ok.ok);
	assert.equal(ok.state.rev, s.rev + 1);
	const bad = applyAction(s, WA, { t: 'activity', id: 'work-mine' });
	assert.equal(bad.ok, false);
	assert.equal(bad.state, s, '失败时返回原对象，服务端不写盘');
});

test('applyAction 覆盖所有动作类型', () => {
	let s = { ...make(), cash: 1000 };
	for (const a of [
		{ t: 'buy', item: 'coffee' },
		{ t: 'use', item: 'coffee' },
		{ t: 'npc', npc: 'mia', act: 'chat' },
		{ t: 'travel', to: 'fremantle', mode: 'road' },
	] as const) {
		const r = applyAction(s, WA, a);
		assert.ok(r.ok, `${a.t}: ${r.msg}`);
		s = r.state;
	}
	if (s.pending) s = applyAction(s, WA, { t: 'event', choice: 0 }).state;
	assert.ok(applyAction(s, WA, { t: 'gps', lat: -31.96, lon: 115.832 }).ok, 'GPS 打卡回珀斯');
});

test('publicState 隐去随机数种子', () => {
	const s = make();
	assert.equal(publicState(s).seed, 0);
	assert.equal(s.seed, 9, '不修改原存档');
});
