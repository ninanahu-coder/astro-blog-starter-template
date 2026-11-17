// 每日摘要（第 27 轮）：跨日时记下上一天的变化；只在之后那一天显示；日志按天筛；存档清洗
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState, START_CLOCK } from '../../src/game/core/character.ts';
import { activitiesAt } from '../../src/game/core/engine.ts';
import { markOf, recapFor, recapLog, rollDay } from '../../src/game/core/recap.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'recap-player', name: '回', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 4 }),
	...over,
});

/** 现在能做的、最花时间的一个活动（用来跨过午夜） */
function longest(s: PlayerState) {
	const xs = activitiesAt(s, WA).filter((x) => !x.blocked).sort((a, b) => b.act.minutes - a.act.minutes);
	assert.ok(xs.length, '现在没有能做的活动');
	return xs[0].act;
}

test('开局：今天的记号是第 1 天、开局现金，没有昨天回顾', () => {
	const s = make();
	assert.deepEqual(s.dayMark, markOf(s));
	assert.equal(s.yday, null);
	assert.equal(recapFor(s), null);
});

test('同一天里的动作不动记号；跨过午夜的动作把上一天的变化记进 yday、换成新一天的记号', () => {
	let s = make();
	const a = longest(s);
	const same = applyAction(s, WA, { t: 'activity', id: a.id });
	assert.ok(same.ok, same.msg);
	assert.deepEqual(same.state.dayMark, s.dayMark, '没跨日不动');
	assert.equal(same.state.yday, null);
	// 晚上 23:30 起做一件长事，跨过午夜
	s = { ...make(), clock: 23 * 60 + 30, cash: 900, dayMark: { day: 0, cash: 600, respect: 0, places: 1 } };
	const act = longest(s);
	const r = applyAction(s, WA, { t: 'activity', id: act.id });
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.clock >= 1440, '测试前提：跨过了午夜');
	const y = r.state.yday!;
	assert.equal(y.day, 0);
	assert.equal(y.days, 1);
	assert.equal(y.cash, r.state.cash - 600, '从早上的 $600 算起');
	assert.deepEqual(r.state.dayMark, markOf(r.state));
	assert.deepEqual(recapFor(r.state), y, '第 2 天显示第 1 天的回顾');
	assert.equal(s.yday, null, '不改入参');
});

test('回顾只在之后那一天显示；跨好几天时记成「过去 N 天」', () => {
	const s = make({ clock: 2 * 1440 + 600, dayMark: { day: 2, cash: 0, respect: 0, places: 1 }, yday: { day: 1, days: 1, cash: 5, respect: 0, places: 0 } });
	assert.ok(recapFor(s));
	assert.equal(recapFor({ ...s, clock: 3 * 1440 + 10 }), null, '再过一天就过时了');
	const far = make({ clock: 1440 * 5 + 60, cash: 400, dayMark: { day: 1, cash: 600, respect: 0, places: 1 } });
	assert.equal(rollDay(far), true);
	assert.deepEqual(far.yday, { day: 1, days: 4, cash: -200, respect: 0, places: 0 });
	assert.equal(rollDay(far), false, '同一天再调不会重复记');
});

test('日志按游戏日筛：只要那几天里的，最多取最后几条', () => {
	const s = make({
		journal: [
			{ t: START_CLOCK, text: '第 1 天' },
			{ t: 1440 + 60, text: '第 2 天 a' },
			{ t: 1440 + 120, text: '第 2 天 b' },
			{ t: 2 * 1440 + 5, text: '第 3 天' },
		],
	});
	assert.deepEqual(recapLog(s, { day: 1, days: 1, cash: 0, respect: 0, places: 0 }).map((j) => j.text), ['第 2 天 a', '第 2 天 b']);
	assert.deepEqual(recapLog(s, { day: 0, days: 2, cash: 0, respect: 0, places: 0 }, 2).map((j) => j.text), ['第 2 天 a', '第 2 天 b']);
});

test('存档清洗：旧存档、坏记号从现在算起；yday 不在记号之前结束就丢掉；数值钳住', () => {
	const base = make({ clock: 3 * 1440 + 100, cash: 777 });
	const old = structuredClone(base) as unknown as Record<string, unknown>;
	delete old.dayMark;
	delete old.yday;
	const a = sanitizeState(old)!;
	assert.deepEqual(a.dayMark, { day: 3, cash: 777, respect: a.respect, places: 1 }, '旧存档从现在算起');
	assert.equal(a.yday, null);
	for (const bad of [{ day: 9, cash: 1, respect: 0, places: 1 }, { day: -1 }, { day: 'x' }, null, 'junk', { day: Infinity }]) {
		const b = sanitizeState({ ...base, dayMark: bad } as never)!;
		assert.equal(b.dayMark.day, 3, JSON.stringify(bad));
	}
	const c = sanitizeState({ ...base, dayMark: { day: 3, cash: 1e12, respect: -5, places: 99 }, yday: { day: 2, days: 1, cash: -1e12, respect: 3, places: 1e9 } } as never)!;
	assert.ok(c.dayMark.cash <= 1e9 && c.dayMark.respect >= 0 && c.dayMark.places <= Object.keys(c.visited).length);
	assert.ok(c.yday && c.yday.cash >= -1e9 && c.yday.places <= 1000);
	assert.equal(sanitizeState({ ...base, yday: { day: 2, days: 2, cash: 0, respect: 0, places: 0 } } as never)!.yday, null, '结束在记号之后');
	assert.equal(sanitizeState({ ...base, yday: { day: 2, days: 0, cash: 0, respect: 0, places: 0 } } as never)!.yday, null, '天数为 0');
	assert.equal(sanitizeState({ ...base, yday: { __proto__: { day: 1, days: 1 } } } as never)!.yday, null, '原型链上的字段不算');
	// 清洗后的存档再清洗不变
	assert.deepEqual(sanitizeState(structuredClone(c))!.yday, c.yday);
	assert.deepEqual(sanitizeState(structuredClone(c))!.dayMark, c.dayMark);
});
