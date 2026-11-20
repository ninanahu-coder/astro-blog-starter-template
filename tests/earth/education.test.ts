// 第 33 批：学历课程、证书门槛、留学生签证工时（docs/earth-game/education-career.md）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { programsAt, studyProgram } from '../../src/game/core/education.ts';
import { careersAt, performActivity, promotionStatus, shiftBlocked, workShift } from '../../src/game/core/engine.ts';
import { fortnightOf, inSession, visaBlocked, visaCapped, workedMinutes, workMinutesLeft } from '../../src/game/core/visa.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { AWARDS, credentialName, PROGRAMS, VISA, VISA_GIGS } from '../../src/game/data/education.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const LOCS = new Set(WA.locations.map((l) => l.id));
const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const rested = { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 };
const make = (over: Partial<PlayerState> = {}, origin = 'student'): PlayerState => ({
	...createCharacter({ id: 'edu-player', name: '学', avatar: '🧑', origin, region: 'wa', spawn: 'perth', seed: 9 }),
	loc: 'perth',
	cash: 5000,
	needs: { ...rested },
	...over,
});
const hourly = (minutes: number, pay: number) => pay / (minutes / 60);
/** 正在读英语班（第 day 天上过一次课） */
const enrolled = (day: number) => ({ 'english-class': { n: 1, day } });

test('学历课程数据自洽：id、学历唯一，前置条件和职业门槛都指向存在的证书或学历', () => {
	assert.equal(new Set(PROGRAMS.map((p) => p.id)).size, PROGRAMS.length);
	assert.equal(new Set(AWARDS).size, AWARDS.length);
	const known = new Set([...CERTS.map((c) => c.id), ...AWARDS]);
	for (const id of AWARDS) assert.ok(!CERTS.some((c) => c.id === id), `学历 ${id} 和证书重名`);
	for (const p of PROGRAMS) {
		assert.ok(p.sessions >= 1 && p.minutes > 0 && p.fee > 0 && p.respect >= 0, p.id);
		assert.ok(Object.keys(p.skills).length > 0, `${p.id} 有成长`);
		for (const id of p.needs ?? []) assert.ok(known.has(id), `${p.id} 的前置 ${id} 不存在`);
		assert.ok(!(p.needs ?? []).includes(p.award), `${p.id} 不能以自己为前置`);
		assert.ok(WA.locations.some((l) => p.where.kinds?.includes(l.kind) || p.where.tags?.some((t) => l.tags.includes(t))), `${p.id} 有地方上`);
		assert.notEqual(credentialName(p.award), p.award, `${p.award} 有显示名`);
	}
	for (const c of CAREERS) for (const lv of c.levels) for (const id of lv.req?.certs ?? []) assert.ok(known.has(id), `${c.id}/${lv.title} 的门槛 ${id} 不存在`);
	// 每个学历都有用：要么是职业门槛，要么是别的课程的前置
	for (const id of AWARDS) assert.ok(CAREERS.some((c) => c.levels.some((lv) => lv.req?.certs?.includes(id))) || PROGRAMS.some((p) => p.needs?.includes(id)), `${id} 没有用处`);
});

test('第 33 批新职业：入行要证书或学历，每级时薪不低于 $20、逐级上涨', () => {
	for (const id of ['builder', 'carer', 'it-support']) {
		const c = CAREERS.find((x) => x.id === id)!;
		assert.ok(c, id);
		assert.ok(c.levels[0].req?.certs?.length, `${id} 入行要证`);
		for (let i = 0; i < c.levels.length; i++) {
			assert.ok(hourly(c.minutes, c.levels[i].pay) >= 20, `${id} 等级 ${i} 时薪 ${hourly(c.minutes, c.levels[i].pay)}`);
			if (i) assert.ok(c.levels[i].pay > c.levels[i - 1].pay);
		}
	}
});

test('证书门槛：没有 White Card 不能应聘工地，有了就能；护理员要三级证书才能升', () => {
	const s = make({ clock: at(9) });
	const site = careersAt(s, WA).find((o) => o.career.id === 'builder')!;
	assert.equal(site.blocked, `需要${credentialName('white-card')}`);
	assert.equal(careersAt({ ...s, certs: ['white-card'] }, WA).find((o) => o.career.id === 'builder')!.blocked, undefined);
	const carer = { ...s, certs: ['first-aid'], skills: { ...s.skills, charisma: 60 }, job: { career: 'carer', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } };
	assert.equal(promotionStatus(carer)!.blocked, `需要${credentialName('cert3-support')}`);
	assert.equal(promotionStatus({ ...carer, certs: ['first-aid', 'cert3-support'] })!.blocked, undefined);
	// 门槛只看持有，证书和学历混在一个列表里也能认
	const it = { ...s, certs: ['cert4-it'], skills: { ...s.skills, street: 30 }, job: { career: 'it-support', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } };
	assert.match(promotionStatus(it)!.blocked!, /学士/);
	assert.equal(promotionStatus({ ...it, certs: ['cert4-it', 'bachelor'] })!.blocked, undefined);
});

test('学历课程：前置条件、上课时间、钱、每天一次；上满毕业拿学历和声望；不改入参', () => {
	const s = make({ clock: at(10) });
	const offer = (st: PlayerState, id: string) => programsAt(st, WA).find((o) => o.program.id === id)!;
	assert.equal(offer(s, 'cert4-it').blocked, `需要先拿到${credentialName('english')}`);
	assert.equal(offer(s, 'english-class').blocked, undefined);
	assert.match(offer({ ...s, clock: at(20) }, 'english-class').blocked!, /上课时间/);
	assert.equal(offer({ ...s, cash: 10 }, 'english-class').blocked, '需要 $25');
	assert.equal(offer({ ...s, needs: { ...rested, energy: 10 } }, 'english-class').blocked, '太累了');
	assert.ok(!programsAt({ ...s, loc: 'rottnest' }, WA).some((o) => o.program.id === 'english-class'), '岛上没有语言班');

	const before = structuredClone(s);
	const r = studyProgram(s, WA, 'english-class');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不改入参');
	assert.equal(r.state.cash, s.cash - 25);
	assert.deepEqual(r.state.study['english-class'], { n: 1, day: 0 });
	assert.ok(r.state.skills.charisma > s.skills.charisma);
	assert.ok(r.state.clock >= s.clock + 120);
	assert.equal(offer(r.state, 'english-class').blocked, '今天已经上过这门课');
	assert.equal(studyProgram(r.state, WA, 'english-class').ok, false);
	assert.equal(studyProgram({ ...s, pending: { eventId: 'x' } }, WA, 'english-class').ok, false);

	// 最后一次课：毕业
	const last = { ...s, study: { 'english-class': { n: 9, day: -1 } } };
	const g = studyProgram(last, WA, 'english-class');
	assert.ok(g.ok && g.state.certs.includes('english'), g.msg);
	assert.equal(g.state.respect, s.respect + PROGRAMS[0].respect);
	assert.equal(offer(g.state, 'english-class').blocked, '已经毕业');
	assert.equal(offer(g.state, 'cert4-it').blocked, undefined, '毕业后能报 IT');
	// 已经开读的课不再查前置（前置只管报名）
	assert.equal(offer({ ...s, study: { 'cert4-it': { n: 3, day: -5 } } }, 'cert4-it').blocked, undefined);
});

test('签证工时：留学生在读时每两周最多 48 小时，第 9 个 6 小时班被拦；新的两周重置', () => {
	let s = make({ clock: at(7, 0), study: enrolled(0), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	assert.ok(visaCapped(s));
	assert.equal(workMinutesLeft(s), VISA.capHours * 60);
	const shift = CAREERS.find((c) => c.id === 'barista')!.minutes;
	let worked = 0;
	for (let day = 0; day < 13; day++) {
		s = { ...s, clock: at(7, day), needs: { ...rested }, study: enrolled(day) };
		if (shiftBlocked(s)) break;
		const r = workShift(s, WA);
		assert.ok(r.ok, r.msg);
		s = r.state;
		worked++;
	}
	assert.equal(worked, Math.floor((VISA.capHours * 60) / shift), '48 小时正好 8 个 6 小时班');
	assert.equal(workedMinutes(s), worked * shift);
	const blockedDay = { ...s, clock: at(7, 8), needs: { ...rested }, study: enrolled(8) };
	assert.match(shiftBlocked(blockedDay)!, /48 小时/);
	assert.equal(workShift(blockedDay, WA).ok, false);
	// 零工也算雇佣工时，同样被拦
	assert.match(performActivity({ ...blockedDay, clock: at(9, 8) }, WA, 'work-cafe').msg, /48 小时/);
	// 新的两周：重新计数
	const nextFortnight = { ...blockedDay, clock: at(7, VISA.periodDays), study: enrolled(VISA.periodDays) };
	assert.equal(fortnightOf(nextFortnight.clock), 1);
	assert.equal(workedMinutes(nextFortnight), 0);
	assert.equal(shiftBlocked(nextFortnight), undefined);
});

test('签证工时只管在读的留学生：别的出身、没报名、停课超过两周、已经毕业都不限', () => {
	const busy = { workLog: { f: 0, min: VISA.capHours * 60 } };
	assert.ok(visaBlocked(make({ ...busy, study: enrolled(0) }), 60), '在读留学生超时被拦');
	assert.equal(visaBlocked(make({ ...busy, study: enrolled(0) }, 'backpacker'), 60), undefined, '背包客不受学生签证限制');
	assert.equal(visaBlocked(make({ ...busy }), 60), undefined, '没在读算假期');
	assert.equal(visaBlocked(make({ ...busy, clock: at(9, 13), study: enrolled(13 - VISA.inSessionDays - 1) }), 60), undefined, '停课超过两周不算学期内');
	assert.ok(visaBlocked(make({ ...busy, clock: at(9, 13), study: enrolled(13 - VISA.inSessionDays) }), 60), '正好两周内还算学期内');
	assert.ok(!inSession(make({ study: { 'english-class': { n: 10, day: 0 } }, certs: ['english'] })), '读完不算在读');
	assert.equal(workMinutesLeft(make({ ...busy })), null);
	// 剩余分钟数正好够时放行，差一分钟拦下
	const edge = make({ study: enrolled(0), workLog: { f: 0, min: VISA.capHours * 60 - 240 } });
	assert.equal(visaBlocked(edge, 240), undefined);
	assert.ok(visaBlocked(edge, 241));
});

test('签证工时：零工记工时，街头表演和捡瓶子不记；没在读时也记（之后报名接着算）', () => {
	for (const id of VISA_GIGS) assert.ok(ACTIVITIES.some((a) => a.id === id), `${id} 存在`);
	const s = make({ clock: at(9) });
	const gig = performActivity(s, WA, 'work-cafe');
	assert.ok(gig.ok, gig.msg);
	assert.equal(gig.state.workLog.min, ACTIVITIES.find((a) => a.id === 'work-cafe')!.minutes);
	const busk = ACTIVITIES.find((a) => a.id === 'busk');
	if (busk) {
		const r = performActivity({ ...s, clock: at(busk.hours?.[0] ?? 12) }, WA, 'busk');
		if (r.ok) assert.equal(r.state.workLog.min, 0, '街头表演不算雇佣');
	}
});

test('学历课程走动作协议；存档校验保留学历、去掉不认识的，钳制上课次数和工时', () => {
	assert.deepEqual(parseAction({ t: 'study', id: 'english-class' }), { t: 'study', id: 'english-class' });
	assert.equal(parseAction({ t: 'study', id: '<script>' }), null);
	assert.equal(parseAction({ t: 'study' }), null);
	const s = make({ clock: at(10) });
	const r = applyAction(s, WA, { t: 'study', id: 'english-class' });
	assert.ok(r.ok && r.state.rev !== s.rev);
	const dirty = {
		...s,
		certs: ['english', 'rsa', 'phd-from-nowhere'],
		study: { 'english-class': { n: 999, day: 3 }, 'fake': { n: 1, day: 1 }, bachelor: 'x' },
		workLog: { f: -5, min: 1e12 },
	};
	const clean = sanitizeState(dirty, LOCS, { fallbackLoc: 'perth' })!;
	assert.deepEqual(clean.certs, ['english', 'rsa']);
	assert.deepEqual(clean.study, { 'english-class': { n: 10, day: 3 } }, '次数钳到课程总数，不认识的课和格式不对的记录丢掉');
	assert.deepEqual(clean.workLog, { f: 0, min: 1e6 });
	const old = sanitizeState({ ...s, study: undefined, workLog: undefined }, LOCS, { fallbackLoc: 'perth' })!;
	assert.deepEqual(old.study, {}, '旧存档没有学业记录');
	assert.deepEqual(old.workLog, { f: 0, min: 0 });
});

test('随机序列：在读留学生做受限动作前没超时，做完也不会超过 48 小时', () => {
	let seed = 42;
	const r = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	for (let run = 0; run < 20; run++) {
		let s = make({ clock: at(6, 0), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
		for (let step = 0; step < 80; step++) {
			const roll = r();
			const a = roll < 0.3 ? { t: 'study' as const, id: 'english-class' } : roll < 0.6 ? { t: 'job' as const, op: 'work' as const } : roll < 0.8 ? { t: 'activity' as const, id: 'work-cafe' } : { t: 'activity' as const, id: 'sleep-motel' };
			const capped = visaCapped(s);
			const before = structuredClone(s);
			const res = applyAction(s, WA, a);
			assert.deepEqual(s, before, '不改入参');
			if (capped && res.ok && (a.t === 'job' || a.id === 'work-cafe')) assert.ok(workedMinutes(res.state) <= VISA.capHours * 60 || fortnightOf(res.state.clock) !== fortnightOf(s.clock), `run ${run} step ${step} 超时`);
			s = sanitizeState(res.state, LOCS, { fallbackLoc: 'perth' })!;
			s = { ...s, needs: { ...rested }, clock: s.clock + Math.floor(r() * 600) };
		}
	}
});
