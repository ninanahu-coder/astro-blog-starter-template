// 签证路线（第 43 批）：数据自洽、存档、打分、毕业和到期、各条路线的条件、雅思、动作协议、卡片转义
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyVisa, canWork, ieltsAt, regionalCategory, routeUnmet, settleVisa, takeIelts, visaAge, visaKindNow, visaOptions, visaPoints, visaWorkBlocked } from '../../src/game/core/immigration.ts';
import { cleanVisa, newVisa } from '../../src/game/core/visa-save.ts';
import { visaCardHtml } from '../../src/game/ui/visa-card.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { WORLD_BASE } from '../../src/game/data/areas-base.ts';
import { CATEGORY2_POSTCODES, CATEGORY2_RANGES, OCCUPATIONS, POINTS, VISA_GIGS, VISA_KINDS, VISA_ROUTES, VISA_RULES } from '../../src/game/data/visas.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState, VisaState } from '../../src/game/core/types.ts';

const R = VISA_RULES;
const Y = R.daysPerYear;
const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const careers = new Set(CAREERS.map((c) => c.id));
const make = (over: Partial<PlayerState> = {}, visa: Partial<VisaState> = {}): PlayerState => {
	const s = createCharacter({ id: 'visa-player', name: '签', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 11 });
	return { ...s, needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 }, cash: 20000, ...over, visa: { ...s.visa, ...visa } };
};
/** 毕业了、还持学生签的留学生 */
const graduate = (over: Partial<PlayerState> = {}, visa: Partial<VisaState> = {}) => make({ clock: at(10, 95), ...over }, { degree: 'bachelor', course: null, ...visa });

test('数据：路线 id 唯一、起止状态存在、费用为正；职业对应已有职业和等级；打分年龄段连续', () => {
	const kinds = new Set(VISA_KINDS.map((k) => k.id));
	assert.equal(new Set(VISA_ROUTES.map((r) => r.id)).size, VISA_ROUTES.length);
	for (const r of VISA_ROUTES) {
		assert.ok(kinds.has(r.to) && r.from.length && r.from.every((k) => kinds.has(k)), r.id);
		assert.ok(r.fee > 0, r.id);
		assert.ok(!r.from.includes('pr') && !r.from.includes('none'), `${r.id}：PR 和非签证出身不能再申请`);
	}
	for (const o of OCCUPATIONS) {
		const c = CAREERS.find((x) => x.id === o.career);
		assert.ok(c, o.career);
		assert.ok(o.minLevel >= 0 && o.minLevel < c!.levels.length, o.career);
		assert.ok(o.skilled || o.sponsor, o.career);
	}
	for (let i = 1; i < POINTS.age.length; i++) assert.equal(POINTS.age[i][0], POINTS.age[i - 1][1] + 1);
	assert.equal(POINTS.age.at(-1)![1], R.points.maxAge - 1, '45 岁起不能打分');
	for (const g of VISA_GIGS) assert.ok(ACTIVITIES.some((a) => a.id === g), g);
});

test('地区类别：表里的地点都存在、邮编都在第二类范围；珀斯、阿德莱德第二类，卡尔古利、布鲁姆第三类', () => {
	const ids = new Set(WORLD_BASE.locations.map((l) => l.id));
	for (const [id, pc] of Object.entries(CATEGORY2_POSTCODES)) {
		assert.ok(ids.has(id), id);
		assert.ok(CATEGORY2_RANGES.some(([lo, hi]) => pc >= lo && pc <= hi), `${id} ${pc}`);
	}
	assert.equal(regionalCategory(make({ loc: 'perth' })), 2);
	assert.equal(regionalCategory(make({ loc: 'adelaide' })), 2);
	assert.equal(regionalCategory(make({ loc: 'kalgoorlie' })), 3);
	assert.equal(regionalCategory(make({ loc: 'broome' })), 3);
});

test('开局：留学生持学生签、在读本科，签证比课程晚到期；其他出身不走签证路线', () => {
	const s = make();
	assert.equal(s.visa.kind, 'student');
	assert.equal(s.visa.course!.award, 'bachelor');
	assert.equal(s.visa.course!.end, R.startCourseDays);
	assert.equal(s.visa.until, R.startCourseDays + R.courseTailDays);
	assert.equal(visaAge(s), R.startAge);
	for (const o of ['backpacker', 'fifo', 'surfer']) {
		const c = createCharacter({ id: 'visa-other', name: 'x', avatar: '🧑', origin: o, region: 'wa', spawn: WA.spawn, seed: 1 });
		assert.equal(c.visa.kind, 'none', o);
		assert.equal(visaOptions(c, WA).length, 0);
		assert.equal(visaCardHtml(c, WA), '');
		assert.ok(canWork(c));
	}
});

test('存档：旧存档没有 visa 按今天补开局签证；坏值不抛异常；幂等', () => {
	const s = make({ clock: at(9, 200) });
	const { visa: _v, ...old } = s;
	const a = sanitizeState(old)!;
	assert.equal(a.visa.kind, 'student');
	assert.equal(a.visa.until, 200 + R.startCourseDays + R.courseTailDays, '老玩家不会一读档就过期');
	for (const bad of [null, [], 'x', 42, NaN, { kind: 'alien' }, { kind: 'student', until: 1e30, ielts: -3, exp: 'a', occ: 'ceo', had: ['pr', 'pr', 'bogus'], course: { end: NaN, award: 'phd' } }, { kind: 'sponsored', sponsor: { career: 'nope', days: 5 } }, Object.create({ kind: 'pr' })]) {
		const v = cleanVisa(bad, 'student', 10, careers);
		assert.ok(VISA_KINDS.some((k) => k.id === v.kind));
		assert.ok(v.ielts >= 0 && v.ielts <= 9 && Number.isFinite(v.until) && v.exp >= 0 && v.expAt <= v.exp);
		assert.deepEqual(cleanVisa(v, 'student', 10, careers), v, '幂等');
		assert.ok(v.occ === null || careers.has(v.occ));
	}
	const weird = cleanVisa({ kind: 'student', until: 1e30, ielts: 7.3, had: ['pr', 'pr', 'bogus'] }, 'student', 10, careers);
	assert.equal(weird.ielts, 7.5);
	assert.deepEqual(weird.had, ['pr']);
	const twice = sanitizeState(sanitizeState({ ...s, visa: { ...s.visa, kind: 'sponsored', sponsor: { career: 'barista', days: 3 } } }));
	assert.deepEqual(twice!.visa.sponsor, { career: 'barista', days: 3 });
	assert.equal(cleanVisa({ kind: 'pr', until: 99 }, 'student', 5, careers).until, -1, 'PR 不会到期');
	assert.equal(newVisa('fifo', 3).kind, 'none');
	assert.deepEqual(cleanVisa({ kind: 'graduate', had: 'graduate' }, 'student', 5, careers).had, [], '坏的 had 清成空列表');
});

test('打分：刚毕业的留学生 60 分；190 加 5、491 加 15；年龄、英语、经验分档', () => {
	const s = graduate();
	assert.equal(visaPoints(s).total, 25 + 15 + 5 + 5 + 10);
	assert.equal(visaPoints(s, 'state').total, 65);
	assert.equal(visaPoints(s, 'regional').total, 75);
	const age = (a: number) => visaPoints(graduate({}, { age0: a })).lines[0].pts;
	assert.deepEqual([24, 25, 32, 33, 39, 40, 44, 45].map((a) => age(a - Math.floor(95 / Y))), [25, 30, 30, 25, 25, 15, 15, 0]);
	const eng = (i: number) => visaPoints(graduate({}, { ielts: i })).lines[1].pts;
	assert.deepEqual([6, 6.5, 7, 7.5, 8, 9].map(eng), [0, 0, 10, 10, 20, 20]);
	const exp = (y: number) => visaPoints(graduate({}, { exp: Math.round(y * Y) })).lines[2].pts;
	assert.deepEqual([0.9, 1, 3, 5, 8].map(exp), [0, 5, 10, 15, 20]);
	assert.equal(visaPoints(make()).lines.find((l) => l.label.includes('学历'))!.pts, 0, '没毕业不算学历分');
	assert.equal(visaPoints(make()).total, 25 + 10, '没毕业：只有年龄和单身');
});

test('毕业和到期：课程结束那天毕业；过了到期日改为过期，不能打工、应聘、上班；之前提醒一次', () => {
	const s = make({ clock: at(23, R.startCourseDays - 1), loc: 'perth' });
	const r = applyAction(s, WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.visa.degree, 'bachelor');
	assert.equal(r.state.visa.course, null);
	assert.match(r.msg, /本科毕业/);
	assert.equal(s.visa.degree, 'none', '不改入参');

	const until = r.state.visa.until;
	const warn = applyAction({ ...r.state, clock: at(10, until - R.warnDays) }, WA, { t: 'activity', id: 'rest' });
	assert.equal(warn.state.visa.warned, true);
	assert.match(warn.msg, /到期/);
	const again = applyAction({ ...warn.state, clock: at(12, until - 2) }, WA, { t: 'activity', id: 'rest' });
	assert.doesNotMatch(again.msg, /到期/, '只提醒一次');

	const late = { ...again.state, clock: at(10, until + 1) };
	assert.equal(visaKindNow(late), 'expired', '没结算也按过期算');
	assert.match(applyAction(late, WA, { t: 'job', op: 'apply', career: 'barista' }).msg, /签证已过期/);
	assert.match(applyAction(late, WA, { t: 'activity', id: 'work-cafe' }).msg, /签证已过期/);
	const e = applyAction(late, WA, { t: 'activity', id: 'rest' });
	assert.ok(e.ok);
	assert.equal(e.state.visa.kind, 'expired');
	assert.equal(e.state.visa.until, -1);
	assert.equal(visaWorkBlocked(e.state, { t: 'job', op: 'work' }) !== undefined, true);
	assert.equal(visaWorkBlocked(e.state, { t: 'venue', op: 'work' }) !== undefined, true);
	assert.equal(visaWorkBlocked(e.state, { t: 'activity', id: 'busk' }), undefined, '街头表演不是雇佣');
	assert.equal(visaWorkBlocked(e.state, { t: 'job', op: 'quit' }), undefined);

	// 续读：过期后重新申请学生签证，签证跟硕士课程走，又能工作
	const back = applyAction({ ...e.state, cash: 5000 }, WA, { t: 'visa', op: 'apply', route: 'student' });
	assert.ok(back.ok, back.msg);
	assert.equal(back.state.visa.kind, 'student');
	assert.equal(back.state.visa.course!.award, 'master');
	assert.equal(back.state.visa.until, until + 1 + R.masterCourseDays + R.courseTailDays);
	assert.equal(back.state.cash, 5000 - VISA_ROUTES.find((x) => x.id === 'student')!.fee);
	assert.ok(canWork(back.state));
});

test('485：要毕业、35 岁以下、雅思 6.5；只能拿一次；批下来有效 2 个签证年', () => {
	assert.match(routeUnmet(make({ clock: at(10, 20) }), WA, 'graduate')!, /天后毕业/);
	assert.match(routeUnmet(graduate(), WA, 'graduate')!, /雅思要 6.5/);
	assert.match(routeUnmet(graduate({}, { ielts: 7, age0: 40 }), WA, 'graduate')!, /35 岁以下/);
	const g35 = (age: number) => graduate({}, { ielts: 6.5, age0: age - Math.floor(95 / Y) });
	assert.equal(routeUnmet(g35(35), WA, 'graduate'), undefined, '35 岁还行');
	assert.match(routeUnmet(g35(36), WA, 'graduate')!, /35 岁以下/);
	const g = graduate({}, { ielts: 6.5 });
	assert.match(routeUnmet({ ...g, visa: { ...g.visa, kind: 'graduate', until: 300, had: ['student', 'graduate', 'graduate2'] } }, WA, 'graduate2')!, /只能拿一次/);
	const r = applyVisa(graduate({}, { ielts: 6.5 }), WA, 'graduate');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.visa.kind, 'graduate');
	assert.equal(r.state.visa.until, 95 + 2 * Y);
	assert.deepEqual(r.state.visa.had, ['student', 'graduate']);
	assert.equal(applyVisa({ ...r.state, cash: 10 }, WA, 'graduate2').ok, false, '钱不够');
	assert.match(applyVisa(graduate({}, { ielts: 6.5, had: ['student', 'graduate'] }), WA, 'graduate').msg, /只能拿一次/);
});

test('第二次 485：珀斯多 1 年，卡尔古利（第三类）多 2 年，从原到期日接着算；只能一次', () => {
	const g = applyVisa(graduate({}, { ielts: 6.5 }), WA, 'graduate').state;
	const perth = applyVisa({ ...g, loc: 'perth' }, WA, 'graduate2');
	const kal = applyVisa({ ...g, loc: 'kalgoorlie' }, WA, 'graduate2');
	assert.ok(perth.ok && kal.ok);
	assert.equal(perth.state.visa.until, g.visa.until + Y);
	assert.equal(kal.state.visa.until, g.visa.until + 2 * Y);
	assert.equal(perth.state.visa.kind, 'graduate2');
	assert.ok(!visaOptions(perth.state, WA).some((o) => o.route.id === 'graduate2'), '第二次 485 之后没有这条路线');
});

test('482 → 186：要在担保职业的对应等级、经验 1 年；担保下上班记天数，满 2 年转 PR', () => {
	const base = graduate({ loc: 'perth', clock: at(7, 95) }, { ielts: 6 });
	assert.match(routeUnmet(base, WA, 'sponsored')!, /先有一份工作/);
	const junior = { ...base, job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } };
	assert.match(routeUnmet(junior, WA, 'sponsored')!, /不在担保职业/);
	assert.match(routeUnmet({ ...junior, job: { ...junior.job, level: 1 } }, WA, 'sponsored')!, /不在担保职业/, '咖啡师还不算，要店长');
	const manager = { ...junior, job: { ...junior.job, level: 2 } };
	assert.match(routeUnmet(manager, WA, 'sponsored')!, /经验要 1 年/);
	const r = applyVisa({ ...manager, visa: { ...manager.visa, exp: Y } }, WA, 'sponsored');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(r.state.visa.sponsor, { career: 'barista', days: 0 });
	assert.equal(r.state.visa.until, 95 + 4 * Y);
	// 上一天班：经验和担保天数都 +1；同一天再结算不重复记
	const shift = applyAction(r.state, WA, { t: 'job', op: 'work' });
	assert.ok(shift.ok, shift.msg);
	assert.equal(shift.state.visa.exp, Y + 1);
	assert.equal(shift.state.visa.sponsor!.days, 1);
	assert.equal(shift.state.visa.occ, 'barista');
	const after = applyAction(shift.state, WA, { t: 'activity', id: 'rest' });
	assert.equal(after.state.visa.exp, Y + 1);
	assert.match(routeUnmet(shift.state, WA, 'ens')!, /担保下工作满 2 年/);
	const ens = applyVisa({ ...shift.state, visa: { ...shift.state.visa, sponsor: { career: 'barista', days: 2 * Y } } }, WA, 'ens');
	assert.ok(ens.ok, ens.msg);
	assert.equal(ens.state.visa.kind, 'pr');
	assert.equal(ens.state.visa.until, -1);
	assert.equal(visaOptions(ens.state, WA).length, 0, 'PR 之后没有路线');
	assert.ok(canWork({ ...ens.state, clock: at(10, 9999) }), 'PR 不会过期');
});

test('学徒的班不算清单职业经验', () => {
	const s = make({ loc: 'perth', clock: at(7, 3), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	const r = applyAction(s, WA, { t: 'job', op: 'work' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.visa.exp, 0);
	const after = { ...s, workDay: 3, job: { ...s.job!, level: 2 } };
	const v = structuredClone(after);
	settleVisa(s, v);
	assert.equal(v.visa.exp, 1, '直接调用：换日上过班、等级够就记');
});

test('打分类：要技术移民清单职业的经验、45 岁以下、雅思 6、分数够；491 担保清单职业也行', () => {
	const g = graduate({}, { ielts: 6, exp: Y, occ: 'barista' });
	assert.match(routeUnmet(g, WA, 'skilled')!, /技术移民清单/);
	assert.equal(routeUnmet(g, WA, 'regional'), undefined, '咖啡馆经理能走 491');
	const m = graduate({}, { ielts: 6, exp: Y, occ: 'miner' });
	assert.match(routeUnmet(graduate({}, { ielts: 6, exp: Y - 1, occ: 'miner' }), WA, 'skilled')!, /经验要 1 年/);
	assert.equal(visaPoints(m).total, 65, '60 + 一年经验 5 分');
	assert.equal(routeUnmet(m, WA, 'skilled'), undefined);
	assert.match(routeUnmet(graduate({}, { ielts: 5.5, exp: Y, occ: 'miner' }), WA, 'state')!, /雅思要 6/);
	assert.match(routeUnmet(graduate({}, { ielts: 8, exp: Y, occ: 'miner', age0: 50 }), WA, 'state')!, /45 岁以下/);
	const a45 = (age: number) => graduate({}, { ielts: 8, exp: Y, occ: 'miner', age0: age - Math.floor(95 / Y) });
	assert.match(routeUnmet(a45(45), WA, 'skilled')!, /45 岁以下/);
	assert.equal(routeUnmet(a45(44), WA, 'state'), undefined);
	// 60 分不及格：40 岁 15 + 经验 3 年 10 + 学历 15 + 两项学习 10 + 单身 10
	const sixty = graduate({}, { ielts: 6, exp: 3 * Y, occ: 'miner', age0: 40 - Math.floor(95 / Y) });
	assert.equal(visaPoints(sixty).total, 60);
	assert.match(routeUnmet(sixty, WA, 'skilled')!, /打分 60，要 65/);
	assert.equal(routeUnmet(sixty, WA, 'state'), undefined, '州提名 +5 刚好及格');
	const pr = applyVisa(m, WA, 'state');
	assert.ok(pr.ok && pr.state.visa.kind === 'pr', pr.msg);
	assert.equal(pr.state.respect, m.respect + 10);
});

test('491 → 191：住满 3 年、期间一半日子在上班才能转永居', () => {
	const g = graduate({ loc: 'kalgoorlie' }, { ielts: 6, exp: Y, occ: 'miner' });
	const r = applyVisa(g, WA, 'regional');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.visa.until, 95 + 5 * Y);
	assert.equal(r.state.visa.expAt, Y);
	const later = (days: number, worked: number) => ({ ...r.state, clock: at(10, 95 + days), visa: { ...r.state.visa, exp: Y + worked } });
	assert.match(routeUnmet(later(3 * Y - 1, 3 * Y), WA, 'regionalPr')!, /要满 3 年/);
	assert.match(routeUnmet(later(3 * Y, 3 * Y * R.regionalPr.workShare - 1), WA, 'regionalPr')!, /上班的日子/);
	assert.equal(routeUnmet(later(3 * Y, 3 * Y * R.regionalPr.workShare), WA, 'regionalPr'), undefined);
});

test('雅思：只在城市考；先交钱、花时间；有几率涨半分、不会掉分；同一种子结果固定', () => {
	assert.equal(ieltsAt(make({ loc: 'kalgoorlie' }), WA), null);
	const s = make({ loc: 'perth', clock: at(10, 2) });
	const o = ieltsAt(s, WA)!;
	assert.ok(o && !o.blocked && o.chance > 0 && o.chance <= R.ielts.max);
	assert.match(ieltsAt({ ...s, cash: 10 }, WA)!.blocked!, /需要/);
	let x = s;
	let ups = 0;
	for (let i = 0; i < 40 && x.visa.ielts < 9; i++) {
		const r = takeIelts({ ...x, needs: s.needs, cash: 20000, clock: at(10, 2 + i) }, WA);
		assert.ok(r.ok, r.msg);
		assert.ok(r.state.visa.ielts >= x.visa.ielts && r.state.visa.ielts - x.visa.ielts <= 0.5);
		assert.ok(r.state.cash <= 20000 - R.ielts.fee, '交了报名费（跨周结算可能另扣车险）');
		if (r.state.visa.ielts > x.visa.ielts) ups++;
		x = r.state;
	}
	assert.ok(ups > 0 && x.visa.ielts <= 9);
	let tries = 0;
	let fails = 0;
	for (let i = 0; i < 60; i++) {
		const r = takeIelts({ ...s, seed: 1000 + i, visa: { ...s.visa, ielts: 6 } }, WA);
		tries++;
		if (r.state.visa.ielts === 6) fails++;
	}
	assert.ok(fails > tries * 0.2 && fails < tries * 0.9, `不是每次都涨（${fails}/${tries} 次没涨）`);
	assert.match(ieltsAt({ ...x, visa: { ...x.visa, ielts: 9 } }, WA)!.blocked!, /满分/);
	assert.deepEqual(takeIelts(s, WA).state.visa, takeIelts(s, WA).state.visa);
	assert.equal(s.visa.ielts, R.startIelts, '不改入参');
});

test('动作协议：visa 两种动作；路线不认识、字段不对一律拒绝；非留学生出身申请不了', () => {
	assert.deepEqual(parseAction({ t: 'visa', op: 'ielts' }), { t: 'visa', op: 'ielts' });
	assert.deepEqual(parseAction({ t: 'visa', op: 'apply', route: 'graduate' }), { t: 'visa', op: 'apply', route: 'graduate' });
	for (const bad of [{ t: 'visa' }, { t: 'visa', op: 'apply' }, { t: 'visa', op: 'apply', route: 'pr' }, { t: 'visa', op: 'apply', route: '__proto__' }, { t: 'visa', op: 'grant' }]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
	const other = createCharacter({ id: 'visa-other', name: 'x', avatar: '🧑', origin: 'fifo', region: 'wa', spawn: WA.spawn, seed: 1 });
	assert.equal(applyAction(other, WA, { t: 'visa', op: 'apply', route: 'graduate' }).ok, false);
	assert.equal(applyAction({ ...other, loc: 'perth' }, WA, { t: 'visa', op: 'ielts' }).ok, false);
	const r = applyAction(graduate({ pending: { eventId: 'quokka-selfie' } }, { ielts: 7 }), WA, { t: 'visa', op: 'apply', route: 'graduate' });
	assert.equal(r.ok, false, '有待处理事件不能申请');
});

test('签证卡片：数据文字都经过 esc；有出处和免责声明；按钮和路线对应', () => {
	const marks: string[] = [];
	const esc = (x: unknown) => { marks.push(String(x)); return `⟦${String(x)}⟧`; };
	const s = graduate({ loc: 'perth', clock: at(10, 95) }, { ielts: 6 });
	const html = visaCardHtml(s, WA, esc);
	for (const o of visaOptions(s, WA)) {
		assert.ok(html.includes(`⟦${o.route.name}⟧`), o.route.id);
		assert.ok(html.includes(`data-visa="⟦${o.route.id}⟧"`), o.route.id);
	}
	assert.ok(html.includes('⟦Home Affairs⟧'));
	assert.ok(marks.some((m) => m.includes('以官方为准、游戏简化')));
	assert.ok(html.includes('data-visa-ielts'));
	const plain = visaCardHtml(s, WA);
	assert.doesNotMatch(plain.replace(/<\/?[a-z][^>]*>/g, ''), /[<>]/, '默认 esc 之后正文里没有裸尖括号');
});
