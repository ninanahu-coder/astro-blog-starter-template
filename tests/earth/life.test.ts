import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { mood } from '../../src/game/core/attributes.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	applyJob, careersAt, homesAt, performActivity, promotionStatus, quitJob, rentHome, shiftBlocked, sleepHome, workShift,
} from '../../src/game/core/engine.ts';
import { CAREERS, PROMOTE_SHIFTS } from '../../src/game/data/careers.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'life-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 5 }),
	...over,
});
const rested = (s: PlayerState): PlayerState => ({ ...s, needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 } });

test('职业与住房数据自洽', () => {
	assert.equal(new Set(CAREERS.map((c) => c.id)).size, CAREERS.length);
	for (const c of CAREERS) {
		assert.ok(c.levels.length >= 2, c.id);
		for (let i = 1; i < c.levels.length; i++) assert.ok(c.levels[i].pay > c.levels[i - 1].pay, `${c.id} 工资逐级上涨`);
		assert.ok(WA.locations.some((l) => c.where.kinds?.includes(l.kind) || c.where.tags?.some((t) => l.tags.includes(t))), `${c.id} 至少有一个地点能应聘`);
	}
	assert.equal(new Set(HOMES.map((h) => h.id)).size, HOMES.length);
});

test('应聘：地点与条件', () => {
	const s = make({ clock: at(9) });
	const ids = careersAt(s, WA).map((o) => o.career.id);
	assert.ok(ids.includes('barista') && ids.includes('lifeguard') && !ids.includes('miner'), ids.join());
	assert.match(applyJob(s, WA, 'lifeguard').msg, /游泳需达到/);
	assert.equal(applyJob(s, WA, 'miner').ok, false, '珀斯没有矿业公司');
	const r = applyJob(s, WA, 'barista');
	assert.ok(r.ok);
	assert.deepEqual({ ...r.state.job }, { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 });
});

test('上班：时段、地点、每天一次、发工资', () => {
	let s = applyJob(make({ clock: at(7) }), WA, 'barista').state;
	s = rested(s);
	assert.equal(shiftBlocked({ ...s, clock: at(15) }), '上班时间 6:00–11:00 开始');
	assert.equal(shiftBlocked({ ...s, loc: 'fremantle' }), '要到工作地点才能上班');
	assert.equal(shiftBlocked({ ...s, needs: { ...s.needs, energy: 10 } }), '太累了，先休息');
	const r = workShift(s, WA);
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.cash >= s.cash + 120 - 1);
	assert.equal(r.state.job!.shifts, 1);
	assert.equal(workShift(rested(r.state), WA).ok, false, '同一天不能上两个班');
});

test('升职：上满班次、表现好、满足下一级要求', () => {
	let s = applyJob(make({ clock: at(7) }), WA, 'barista').state;
	s = { ...s, skills: { ...s.skills, charisma: 100 } }; // 保证检定通过、满足下一级要求
	for (let day = 0; day < PROMOTE_SHIFTS; day++) {
		s = rested({ ...s, clock: at(7, day) });
		const r = workShift(s, WA);
		assert.ok(r.ok, r.msg);
		s = r.state;
	}
	assert.equal(s.job!.level, 1, '升到咖啡师');
	assert.equal(s.job!.shifts, 0, '新等级重新计数');
	assert.equal(promotionStatus(s)!.next.title, '店长');
	assert.match(promotionStatus(s)!.blocked ?? '', /声望/, '店长要声望');
	assert.ok(quitJob(s).ok);
	assert.equal(quitJob(s).state.job, null);
});

test('租房：首周租金、按周扣租、付不起被收回', () => {
	const s = make({ cash: 1000, clock: at(9) });
	assert.ok(homesAt(s, WA).some((o) => o.home.id === 'beach'), '珀斯有海滩，可租海景小屋');
	const r = rentHome(s, WA, 'room');
	assert.ok(r.ok);
	assert.equal(r.state.cash, 840);
	assert.equal(r.state.nextWeek, 7);
	// 第 8 天睡一觉：自动扣第二周
	const later = performActivity({ ...r.state, clock: at(20, 6) }, WA, 'sleep-camp').state;
	assert.equal(later.nextWeek, 14);
	assert.equal(later.cash, 840 - 160 - 25, '房租 + 轿车保险');
	// 没钱：被收回
	const broke = performActivity({ ...r.state, cash: 10, clock: at(20, 6) }, WA, 'sleep-camp').state;
	assert.equal(broke.home, null);
	assert.ok(broke.journal.some((j) => j.text.includes('收回')));
});

test('回家睡觉与住房心情加成', () => {
	const s = rentHome(make({ cash: 2000, clock: at(9) }), WA, 'beach').state;
	const tired = { ...s, needs: { hunger: 80, energy: 5, hygiene: 10, fun: 40, social: 60 } };
	const r = sleepHome(tired, WA);
	assert.ok(r.ok);
	assert.equal(r.state.needs.energy, 100);
	assert.equal(sleepHome({ ...tired, loc: 'fremantle' }, WA).ok, false, '不在住处');
	assert.equal(mood(s) - mood({ ...s, home: null }), 10, '海景小屋 +10 心情');
});

test('动作协议支持职业与住房', () => {
	assert.deepEqual(parseAction({ t: 'job', op: 'apply', career: 'barista' }), { t: 'job', op: 'apply', career: 'barista' });
	assert.deepEqual(parseAction({ t: 'home', op: 'sleep', home: 'x' }), { t: 'home', op: 'sleep' });
	assert.equal(parseAction({ t: 'job', op: 'promote' }), null);
	assert.equal(parseAction({ t: 'home', op: 'rent' }), null);
	const r = applyAction(make({ clock: at(9), cash: 500 }), WA, { t: 'home', op: 'rent', home: 'room' });
	assert.ok(r.ok && r.state.rev === 1);
});

test('存档校验：职业与住房', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const dirty = make({
		job: { career: 'barista', loc: 'perth', level: 99, shifts: -4, good: 2.5, lastDay: 3 },
		home: { type: 'castle', loc: 'perth', furniture: {} },
	});
	const clean = sanitizeState(dirty, locs)!;
	assert.deepEqual(clean.job, { career: 'barista', loc: 'perth', level: 2, shifts: 0, good: 2, lastDay: 3 });
	assert.equal(clean.home, null, '未知房型丢弃');
	assert.equal(sanitizeState(make({ job: { career: 'barista', loc: 'atlantis', level: 0, shifts: 0, good: 0, lastDay: -1 } }), locs)!.job, null);
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'job');
	Reflect.deleteProperty(old, 'home');
	const migrated = sanitizeState(old, locs)!;
	assert.equal(migrated.job, null);
	assert.equal(migrated.home, null);
});
