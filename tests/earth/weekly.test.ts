// 全服周目标的规则（纯函数）：按周轮换、出力计数跨周归零、领奖条件
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyWeeklyClaim } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { addWeekly, goalOfWeek, weekDaysLeft, weeklyBlocked, weeklyMine, weekOf } from '../../src/game/core/weekly.ts';
import { WEEKLY_GOALS } from '../../src/game/data/weekly.ts';
import { WA } from '../../src/game/data/wa.ts';

const mk = () => createCharacter({ id: 'weekly-aa', name: 'w', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 1 });

test('周目标数据：id 唯一、目标和奖励为正、四类指标都有；按周轮换，每周 7 天', () => {
	assert.equal(new Set(WEEKLY_GOALS.map((g) => g.id)).size, WEEKLY_GOALS.length);
	for (const g of WEEKLY_GOALS) assert.ok(g.target > 0 && g.reward.cash > 0 && g.reward.respect > 0, g.id);
	assert.deepEqual(new Set(WEEKLY_GOALS.map((g) => g.metric)), new Set(['coop', 'trade', 'experience', 'travel']));
	assert.equal(weekOf(13), 1);
	assert.equal(weekOf(14), 2);
	assert.equal(weekDaysLeft(14), 7);
	assert.equal(weekDaysLeft(20), 1);
	assert.notEqual(goalOfWeek(5).id, goalOfWeek(6).id, '相邻两周目标不同');
	assert.equal(goalOfWeek(5).id, goalOfWeek(5 + WEEKLY_GOALS.length).id);
});

test('出力计数：同一周累加，跨周归零；不改入参', () => {
	const a = mk();
	const b = addWeekly(addWeekly(a, 10), 10);
	assert.deepEqual(a.weekly, { week: 0, n: 0, claimed: false }, '入参没被改');
	assert.deepEqual(weeklyMine(b, 10), { n: 2, claimed: false });
	assert.deepEqual(weeklyMine(b, 11), { n: 0, claimed: false });
	assert.deepEqual(addWeekly(b, 11).weekly, { week: 11, n: 1, claimed: false });
});

test('领奖：全服没达成、自己没出力、已经领过都不行；领了加钱加声望、版本号加一，只能领一次', () => {
	const goal = goalOfWeek(10);
	const s = addWeekly(mk(), 10);
	assert.match(weeklyBlocked(mk(), 10, goal.target)!, /没出过力/);
	assert.match(weeklyBlocked(s, 10, goal.target - 1)!, /还差 1 次/);
	const r = applyWeeklyClaim(s, 10, goal.target);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, s.cash + goal.reward.cash);
	assert.equal(r.state.respect, s.respect + goal.reward.respect);
	assert.equal(r.state.rev, s.rev + 1);
	assert.equal(applyWeeklyClaim(r.state, 10, goal.target).ok, false, '不能领两次');
	assert.equal(weeklyBlocked(addWeekly(r.state, 11), 11, goalOfWeek(11).target), undefined, '下周重新算');
});

test('存档校验：weekly 钳到合法范围，旧存档补默认值', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const s = sanitizeState({ ...mk(), weekly: { week: 3.5, n: -1, claimed: 'yes' } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(s.weekly, { week: 3, n: 0, claimed: false });
	const old: Record<string, unknown> = { ...mk() };
	delete old.weekly;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.weekly, { week: 0, n: 0, claimed: false });
});

test('周序号只往前走：服务器时钟回拨到上一周时不记旧周、也不能领旧周（审查问题 2）', () => {
	const goal = goalOfWeek(10);
	const claimed = applyWeeklyClaim(addWeekly(mk(), 10), 10, goal.target).state;
	const next = addWeekly(claimed, 11);
	assert.equal(addWeekly(next, 10), next, '回拨到第 10 周：不把第 11 周的记录冲掉');
	assert.match(weeklyBlocked(next, 10, goalOfWeek(10).target)!, /过去/);
	assert.equal(applyWeeklyClaim(next, 10, goalOfWeek(10).target).ok, false, '不能重领第 10 周');
});
