// 离线排队（第 33 轮）：白名单、上限、本机数据当不可信输入清洗、过期、提示文字
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameAction } from '../../src/game/core/actions.ts';
import { actLabel, enqueue, flushSummary, parseQueue, QUEUE_MAX, QUEUE_TTL_MS, queueable, queueJson } from '../../src/game/ui/queue.ts';

const names = { activity: (id: string) => (id === 'jog' ? '晨跑' : undefined), loc: (id: string) => (id === 'perth' ? '珀斯' : undefined), item: () => '雨衣', npc: () => '米娅' };
const NOW = 1_800_000_000_000;

test('白名单：一个人做的日常动作能排；看真实位置、看事件、大笔买卖不排', () => {
	const yes: GameAction[] = [{ t: 'activity', id: 'jog' }, { t: 'use', item: 'x' }, { t: 'travel', to: 'perth', mode: 'road' }, { t: 'fish' }, { t: 'photo' }, { t: 'home', op: 'sleep' }, { t: 'job', op: 'work' }, { t: 'npc', npc: 'mia', act: 'chat' }];
	const no: GameAction[] = [{ t: 'gps', lat: 0, lon: 0 }, { t: 'event', choice: 0 }, { t: 'buy', item: 'x' }, { t: 'home', op: 'rent', home: 'x' }, { t: 'job', op: 'quit' }, { t: 'npc', npc: 'mia', act: 'gift', item: 'x' }, { t: 'property', op: 'buy', id: 'x', loan: true }, { t: 'vehicle', op: 'sell' }, { t: 'course', id: 'x' }, { t: 'venue', venue: 'x', op: 'eat' as never, lat: 0, lon: 0, acc: 5 }];
	for (const a of yes) assert.equal(queueable(a), true, JSON.stringify(a));
	for (const a of no) assert.equal(queueable(a), false, JSON.stringify(a));
});

test('排队：最多 5 个，不能排的返回 null，原列表不变', () => {
	let q = enqueue([], { t: 'activity', id: 'jog' }, '晨跑', NOW)!;
	assert.equal(q.length, 1);
	assert.equal(enqueue(q, { t: 'gps', lat: 0, lon: 0 }, 'x', NOW), null);
	for (let i = 1; i < QUEUE_MAX; i++) q = enqueue(q, { t: 'fish' }, '钓鱼', NOW)!;
	assert.equal(q.length, QUEUE_MAX);
	assert.equal(enqueue(q, { t: 'fish' }, '钓鱼', NOW), null, '排满了');
	assert.equal(enqueue([], { t: 'fish' }, 'x'.repeat(100), NOW)![0].label.length, 40, '名字截短');
});

test('读本机：只认这个角色的；动作重新校验；未来的、坏的丢掉，过期的计数', () => {
	const good = { act: { t: 'activity', id: 'jog' }, at: NOW - 1000, label: '晨跑' };
	assert.deepEqual(parseQueue(queueJson('p1', [good as never]), 'p1', NOW).items, [good]);
	assert.deepEqual(parseQueue(queueJson('p1', [good as never]), 'p2', NOW).items, [], '别的角色的不认');
	for (const raw of [null, '', '{', '[]', '"x"', JSON.stringify({ id: 'p1' }), JSON.stringify({ id: 'p1', items: {} }), JSON.stringify(Object.create({ id: 'p1', items: [good] }))]) {
		assert.deepEqual(parseQueue(raw, 'p1', NOW).items, [], String(raw));
	}
	const mixed = [
		good,
		{ ...good, act: { t: 'gps', lat: 0, lon: 0 } }, // 不在白名单
		{ ...good, act: { t: 'activity', id: '<script>' } }, // 网络输入校验不过
		{ ...good, at: NOW + 3_600_000 }, // 未来
		{ ...good, at: 'x' },
		{ ...good, at: NOW - QUEUE_TTL_MS - 1 }, // 过期
		{ ...good, label: 42 }, // 名字坏了用默认
		null, [], 'junk',
	];
	const r = parseQueue(JSON.stringify({ id: 'p1', items: mixed }), 'p1', NOW);
	assert.equal(r.expired, 1);
	assert.deepEqual(r.items.map((i) => i.label), ['晨跑', '动作']);
	// 存了超过上限的也只读前 5 个
	assert.equal(parseQueue(queueJson('p1', Array(9).fill(good)), 'p1', NOW).items.length, QUEUE_MAX);
});

test('名字和汇总', () => {
	assert.equal(actLabel({ t: 'activity', id: 'jog' }, names), '晨跑');
	assert.equal(actLabel({ t: 'activity', id: 'nope' }, names), '做一件事');
	assert.equal(actLabel({ t: 'travel', to: 'perth', mode: 'road' }, names), '去珀斯');
	assert.equal(actLabel({ t: 'npc', npc: 'mia', act: 'help' }, names), '帮米娅个忙');
	assert.equal(actLabel({ t: 'home', op: 'sleep' }, names), '在家睡觉');
	assert.equal(flushSummary({ done: 2, cancelled: 0, expired: 0 }), '补交了 2 个排队的动作');
	assert.equal(flushSummary({ done: 1, failed: { label: '晨跑', msg: '太累了' }, cancelled: 2, expired: 1 }), '补交了 1 个排队的动作；「晨跑」没成功：太累了；后面 2 个已取消；1 个排队超过一天，已取消');
	assert.equal(flushSummary({ done: 0, cancelled: 0, expired: 0 }), '');
});
