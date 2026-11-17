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
	assert.deepEqual(s.dayMark, { ...markOf(s), at: START_CLOCK - 1 }, '记号早一分钟：开局那条日志算第 1 天');
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
	s = { ...make(), clock: 23 * 60 + 30, cash: 900, dayMark: { day: 0, at: 0, cash: 600, respect: 0, places: 1 } };
	const act = longest(s);
	const r = applyAction(s, WA, { t: 'activity', id: act.id });
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.clock >= 1440, '测试前提：跨过了午夜');
	const y = r.state.yday!;
	assert.equal(y.day, 0);
	assert.equal(y.days, 1);
	assert.equal(y.cash, r.state.cash - 600, '从早上的 $600 算起');
	assert.equal(y.from, 0);
	assert.equal(y.to, r.state.clock, '日志范围到跨日动作结束为止');
	// 跨午夜动作的日志写在次日（审查复现过：花费算进昨天、日志却不在昨天回顾里），回顾日志要包括它
	const last = r.state.journal.at(-1)!;
	assert.ok(last.t >= 1440, '测试前提：这条日志写在次日');
	assert.ok(recapLog(r.state, y).includes(last), '跨午夜动作的日志算进昨天回顾');
	// 之后同一天再做的事不算进昨天
	const later = { ...r.state, journal: [...r.state.journal, { t: r.state.clock + 30, text: '后来' }] };
	assert.ok(!recapLog(later, y).some((j) => j.text === '后来'));
	assert.deepEqual(r.state.dayMark, markOf(r.state));
	assert.deepEqual(recapFor(r.state), y, '第 2 天显示第 1 天的回顾');
	assert.equal(s.yday, null, '不改入参');
});

test('回顾只在之后那一天显示；跨好几天时记成「过去 N 天」', () => {
	const s = make({ clock: 2 * 1440 + 600, dayMark: { day: 2, at: 2 * 1440 + 10, cash: 0, respect: 0, places: 1 }, yday: { day: 1, days: 1, from: 1440 - 1, to: 2 * 1440 + 10, cash: 5, respect: 0, places: 0 } });
	assert.ok(recapFor(s));
	assert.equal(recapFor({ ...s, clock: 3 * 1440 + 10 }), null, '再过一天就过时了');
	const far = make({ clock: 1440 * 5 + 60, cash: 400, dayMark: { day: 1, at: 1440 + 5, cash: 600, respect: 0, places: 1 } });
	assert.equal(rollDay(far), true);
	assert.deepEqual(far.yday, { day: 1, days: 4, from: 1440 + 5, to: 1440 * 5 + 60, cash: -200, respect: 0, places: 0 });
	assert.equal(rollDay(far), false, '同一天再调不会重复记');
});

test('日志按记号的时刻筛：from 之后到 to 为止，最多取最后几条', () => {
	const s = make({
		journal: [
			{ t: START_CLOCK, text: '第 1 天' },
			{ t: 1440 + 60, text: '第 2 天 a' },
			{ t: 1440 + 120, text: '第 2 天 b' },
			{ t: 2 * 1440 + 5, text: '第 3 天' },
		],
	});
	const r0 = { cash: 0, respect: 0, places: 0 };
	assert.deepEqual(recapLog(s, { day: 1, days: 1, from: 1440 + 5, to: 2 * 1440 + 1, ...r0 }).map((j) => j.text), ['第 2 天 a', '第 2 天 b']);
	assert.deepEqual(recapLog(s, { day: 0, days: 2, from: START_CLOCK - 1, to: 2 * 1440 + 5, ...r0 }).map((j) => j.text), ['第 1 天', '第 2 天 a', '第 2 天 b', '第 3 天'], '跨日动作结束时写的日志也算');
	assert.deepEqual(recapLog(s, { day: 0, days: 2, from: START_CLOCK - 1, to: 2 * 1440 + 5, ...r0 }, 2).map((j) => j.text), ['第 2 天 b', '第 3 天']);
	assert.deepEqual(recapLog(s, { day: 1, days: 1, from: 1440 + 60, to: 2 * 1440, ...r0 }).map((j) => j.text), ['第 2 天 b'], 'from 那一刻的属于上一段');
});

test('存档清洗：旧存档、坏记号从现在算起；yday 不在记号之前结束就丢掉；数值钳住', () => {
	const base = make({ clock: 3 * 1440 + 100, cash: 777 });
	const old = structuredClone(base) as unknown as Record<string, unknown>;
	delete old.dayMark;
	delete old.yday;
	const a = sanitizeState(old)!;
	assert.deepEqual(a.dayMark, { day: 3, at: a.clock, cash: 777, respect: a.respect, places: 1 }, '旧存档从现在算起');
	assert.equal(a.yday, null);
	const okMark = { day: 2, at: 2 * 1440 + 30, cash: 1, respect: 0, places: 1 };
	assert.deepEqual(sanitizeState({ ...base, dayMark: okMark } as never)!.dayMark, okMark, '好的记号原样保留');
	const bads: unknown[] = [{ ...okMark, day: 9 }, { day: -1 }, { day: 'x' }, null, 'junk', [], { day: Infinity }, { ...okMark, at: undefined }, { ...okMark, at: 3 * 1440 + 50 }, { ...okMark, at: 3 * 1440 + 200 }, { ...okMark, at: 1440 }, Object.create(okMark), { __proto__: { day: 2 }, at: 2 * 1440 + 30 }];
	for (const bad of bads) {
		const b = sanitizeState({ ...base, dayMark: bad } as never)!;
		assert.deepEqual([b.dayMark.day, b.dayMark.at], [3, b.clock], JSON.stringify(bad));
	}
	// 必需字段是自己的、选填的数值在原型链上：不采用继承来的值
	const inh = sanitizeState({ ...base, dayMark: Object.assign(Object.create({ cash: 5 }), { day: 2, at: 2 * 1440 + 30 }) } as never)!;
	assert.equal(inh.dayMark.cash, 777, '继承来的现金不算');
	// 记号在第 3 天 00:20 记下；昨天（第 2 天）的日志范围到那一刻为止
	const mark3 = { day: 3, at: 3 * 1440 + 20, cash: 1, respect: 0, places: 1 };
	const yOk = { day: 2, days: 1, from: 2 * 1440 + 5, to: 3 * 1440 + 20, cash: -3, respect: 1, places: 1 };
	const withY = (y: unknown) => sanitizeState({ ...base, dayMark: mark3, yday: y } as never)!.yday;
	assert.deepEqual(withY(yOk), yOk, '好的 yday 原样保留');
	const c = sanitizeState({ ...base, dayMark: { ...mark3, cash: 1e12, respect: -5, places: 99 }, yday: { ...yOk, cash: -1e12, places: 1e9 } } as never)!;
	assert.ok(c.dayMark.cash <= 1e9 && c.dayMark.respect >= 0 && c.dayMark.places <= Object.keys(c.visited).length);
	assert.ok(c.yday && c.yday.cash >= -1e9);
	assert.equal(c.yday.places, Object.keys(c.visited).length, '新去的地方不超过到过的地方');
	assert.equal(withY({ ...yOk, days: 2 }), null, '结束在记号之后');
	assert.equal(withY({ ...yOk, days: 0 }), null, '天数为 0');
	assert.equal(withY({ ...yOk, to: 3 * 1440 + 21 }), null, '日志范围越过记号');
	assert.equal(withY({ ...yOk, to: 3 * 1440 - 1 }), null, '日志范围没到跨日那天');
	assert.equal(withY({ ...yOk, from: yOk.to }), null, '日志范围为空');
	assert.equal(withY({ ...yOk, from: 1440 }), null, '日志范围早于那段日子');
	assert.equal(withY({ ...yOk, from: undefined }), null, '缺日志范围');
	// 原型链：整个对象继承、或必需字段继承，都不算（夹具的记号在第 3 天，yday 只差所有权这一条）
	assert.equal(withY(Object.create(yOk)), null, '原型链上的字段不算');
	assert.equal(withY(Object.assign(Object.create({ days: 1 }), { ...yOk, days: undefined })), null, '继承来的天数不算');
	assert.equal(withY(Object.assign(Object.create({ cash: 99 }), { ...yOk, cash: undefined }))!.cash, 0, '继承来的现金不算');
	// 清洗后的存档再清洗不变
	assert.deepEqual(sanitizeState(structuredClone(c))!.yday, c.yday);
	assert.deepEqual(sanitizeState(structuredClone(c))!.dayMark, c.dayMark);
});
