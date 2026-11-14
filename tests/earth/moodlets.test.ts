import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { activeMoodlets, mood, moodBreakdown } from '../../src/game/core/attributes.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { addMoodlet, pruneMoodlets, rentHome, sleepHome } from '../../src/game/core/engine.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { MOODLET_MAX, MOODLETS } from '../../src/game/data/moodlets.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'mood-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 41 }),
	...over,
});
const ids = (s: PlayerState) => activeMoodlets(s).map((m) => m.def.id).sort();

test('心情状态数据自洽，数据里引用的都存在', () => {
	assert.equal(new Set(MOODLETS.map((m) => m.id)).size, MOODLETS.length);
	for (const m of MOODLETS) assert.ok(m.value !== 0 && m.hours > 0, m.id);
	const known = new Set(MOODLETS.map((m) => m.id));
	for (const a of ACTIVITIES) if (a.fx.moodlet) assert.ok(known.has(a.fx.moodlet), a.id);
	for (const e of EVENTS) for (const c of e.choices) for (const o of [c.ok, c.fail]) if (o?.fx.moodlet) assert.ok(known.has(o.fx.moodlet), e.id);
});

test('获得、刷新、过期', () => {
	const s = structuredClone(make({ clock: at(8) }));
	addMoodlet(s, 'well-fed');
	assert.deepEqual(s.moodlets, [{ id: 'well-fed', until: at(14) }]);
	s.clock = at(10);
	addMoodlet(s, 'well-fed');
	assert.deepEqual(s.moodlets, [{ id: 'well-fed', until: at(16) }], '同种刷新时长，不叠加');
	addMoodlet(s, 'no-such-thing');
	assert.equal(s.moodlets.length, 1, '未知状态忽略');
	s.clock = at(16);
	assert.deepEqual(ids(s), [], '到点失效');
	pruneMoodlets(s);
	assert.deepEqual(s.moodlets, []);
	for (const m of MOODLETS) addMoodlet(s, m.id);
	assert.equal(s.moodlets.length, MOODLET_MAX, '有上限');
});

test('心情 = 需求 + 特质 + 住处 + 状态，钳制在 0–100', () => {
	const base = make({ clock: at(8), needs: { hunger: 60, energy: 60, hygiene: 60, fun: 60, social: 60 } });
	assert.equal(mood(base), 60);
	const happy = structuredClone(base);
	addMoodlet(happy, 'promoted');
	addMoodlet(happy, 'experience');
	assert.equal(mood(happy), 82);
	const b = moodBreakdown(happy);
	assert.deepEqual([b.needs, b.traits, b.home, b.moodlets.map((m) => m.def.id)], [60, 0, 0, ['promoted', 'experience']]);
	const sad = structuredClone(make({ clock: at(8), needs: { hunger: 5, energy: 5, hygiene: 5, fun: 5, social: 5 } }));
	addMoodlet(sad, 'evicted');
	addMoodlet(sad, 'collapsed');
	assert.equal(mood(sad), 0, '不会为负');
});

test('数据里的活动会留下状态：外出吃饭、住旅馆、露营', () => {
	const s = make({ clock: at(12), cash: 500, needs: { hunger: 30, energy: 20, hygiene: 60, fun: 60, social: 60 } });
	assert.deepEqual(ids(applyAction(s, WA, { t: 'activity', id: 'eat' }).state), ['well-fed']);
	assert.ok(ids(applyAction(s, WA, { t: 'activity', id: 'sleep-motel' }).state).includes('great-sleep'));
	assert.ok(ids(applyAction(s, WA, { t: 'activity', id: 'sleep-camp' }).state).includes('camp-calm'));
});

test('引擎时刻：新地方、乔迁、受伤、晕倒', () => {
	const s = make({ clock: at(9), cash: 2000 });
	const moved = applyAction(s, WA, { t: 'travel', to: 'fremantle', mode: 'road' }).state;
	assert.ok(ids(moved).includes('first-visit'));
	const rented = rentHome(s, WA, 'room').state;
	assert.ok(ids(rented).includes('new-home'));
	const slept = sleepHome({ ...rented, needs: { ...rented.needs, energy: 5 } }, WA).state;
	assert.ok(!ids(slept).includes('great-sleep'), '光板合租房间睡不出好觉');
	const collapsed = applyAction({ ...s, health: 3, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(collapsed.loc, WA.hospital);
	assert.ok(ids(collapsed).includes('collapsed'), '晕倒');
	const left = collapsed.moodlets.find((m) => m.id === 'collapsed')!.until - collapsed.clock;
	assert.equal(left, 48 * 60, '出院时「刚从医院出来」还剩满 48 小时');
	assert.ok(!ids(collapsed).includes('camp-calm'), '晕倒中止了原动作，不再拿露营的状态');
});

test('上班途中晕倒：不发工资、不计班次、心愿不算完成', () => {
	const hired = applyAction(make({ clock: at(7), cash: 0 }), WA, { t: 'job', op: 'apply', career: 'barista' }).state;
	const s = { ...hired, health: 1, wishes: ['work'], wishDay: 0, needs: { hunger: 0, energy: 90, hygiene: 80, fun: 60, social: 60 } };
	const r = applyAction(s, WA, { t: 'job', op: 'work' });
	assert.ok(r.ok && r.collapsed, r.msg);
	assert.equal(r.state.loc, WA.hospital);
	assert.equal(r.state.cash, 0, '没上完的班没有工资');
	assert.equal(r.state.job!.shifts, 0);
	assert.deepEqual(r.state.wishes, ['work'], '心愿还在');
	assert.ok(!ids(r.state).includes('wish-done'));
	// 对照：同样的人吃饱了上班，照常发工资、计班次、完成心愿
	const fine = applyAction({ ...s, needs: { ...s.needs, hunger: 90 }, health: 80 }, WA, { t: 'job', op: 'work' });
	assert.ok(fine.ok && !fine.collapsed);
	assert.ok(fine.state.cash >= 120);
	assert.equal(fine.state.job!.shifts, 1);
	assert.ok(ids(fine.state).includes('wish-done'));
});

test('心愿达成留下状态；失败的动作不留', () => {
	const s = make({ clock: at(12), wishes: ['eat-out'], wishDay: 0, needs: { hunger: 30, energy: 80, hygiene: 80, fun: 40, social: 40 } });
	const r = applyAction(s, WA, { t: 'activity', id: 'eat' });
	assert.deepEqual(ids(r.state), ['well-fed', 'wish-done']);
	const failed = applyAction(s, WA, { t: 'activity', id: 'work-mine' });
	assert.deepEqual(failed.state.moodlets, []);
});

test('存档校验：未知、重复、过期、超长的状态都会被处理', () => {
	const clock = at(10);
	const dirty = make({
		clock,
		moodlets: [
			{ id: 'well-fed', until: clock + 60 },
			{ id: 'well-fed', until: clock + 120 },
			{ id: 'won-lottery', until: clock + 60 },
			{ id: 'promoted', until: clock - 1 },
			{ id: 'experience', until: clock + 1e9 },
		],
	});
	const c = sanitizeState(dirty)!;
	assert.deepEqual(c.moodlets, [{ id: 'well-fed', until: clock + 60 }, { id: 'experience', until: clock + 48 * 60 }]);
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'moodlets');
	assert.deepEqual(sanitizeState(old)!.moodlets, []);
});
