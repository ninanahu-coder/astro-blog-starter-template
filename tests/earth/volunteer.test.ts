// 志愿者与社区声望（docs/earth-game/volunteer.md）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { festivalsNow, npcPresent, promotionStatus } from '../../src/game/core/engine.ts';
import { cleanVolunteer, emptyVolunteer, refRespect, volShifts, volTier } from '../../src/game/core/respect.ts';
import { doVolunteer, volunteerAt } from '../../src/game/core/volunteer.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { FESTIVALS } from '../../src/game/data/festivals.ts';
import { VOL_RULES, VOL_TIERS, VOLUNTEER_GIGS, VOLUNTEER_ORGS } from '../../src/game/data/volunteer.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { inSpan } from '../../src/game/core/time.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'vol-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: 'perth', seed: 7 }),
	clock: at(10, 2),
	...over,
});
/** n 次志愿记录（不同 id 混着算总次数） */
const withShifts = (n: Record<string, number>, refs: string[] = []) => ({ day: -1, today: [], n, refs });

test('数据：id 唯一；每项志愿至少一个地点能做；组织存在、区域对得上、有 https 来源；不发钱、声望单独写', () => {
	const ids = VOLUNTEER_GIGS.map((g) => g.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(new Set(VOLUNTEER_ORGS.map((o) => o.id)).size, VOLUNTEER_ORGS.length);
	for (const g of VOLUNTEER_GIGS) {
		assert.ok(g.respect > 0 && g.minutes > 0, g.id);
		assert.equal(g.fx.cash, undefined, `${g.id} 志愿没有报酬`);
		assert.equal(g.fx.respect, undefined, `${g.id} 声望写在 respect 字段`);
		assert.ok(g.hours[0] < g.hours[1]);
		if (g.minTier !== undefined) assert.ok(g.minTier > 0 && g.minTier < VOL_TIERS.length, g.id);
		if (!g.festival) assert.ok(WORLD.locations.some((l) => g.locs?.includes(l.id) || g.kinds?.includes(l.kind) || g.tags?.some((t) => l.tags.includes(t))), `${g.id} 没有地点`);
		for (const l of g.locs ?? []) assert.ok(WORLD.locations.some((x) => x.id === l), `${g.id} 地点 ${l} 不存在`);
		for (const [area, oid] of Object.entries(g.orgs)) {
			const org = VOLUNTEER_ORGS.find((o) => o.id === oid);
			assert.ok(org, `${g.id} 组织 ${oid} 不存在`);
			assert.equal(org!.area, area, `${oid} 区域`);
		}
		for (const n of g.npcs ?? []) assert.ok(NPCS.some((x) => x.id === n), `${g.id} NPC ${n}`);
	}
	for (const o of VOLUNTEER_ORGS) assert.match(o.source, /^https:\/\//, o.id);
	for (let i = 1; i < VOL_TIERS.length; i++) assert.ok(VOL_TIERS[i].at > VOL_TIERS[i - 1].at);
});

test('做一次：花时间、加声望和次数，记今天；声望来自数据表', () => {
	const s = make();
	const gig = VOLUNTEER_GIGS.find((g) => g.id === 'food-bank')!;
	const r = applyAction(s, WA, { t: 'volunteer', id: 'food-bank' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.respect, s.respect + gig.respect);
	assert.equal(r.state.clock, s.clock + gig.minutes);
	assert.deepEqual(r.state.volunteer, { day: 2, today: ['food-bank'], n: { 'food-bank': 1 }, refs: [] });
	assert.ok(r.state.skills.strength > s.skills.strength);
	assert.deepEqual(s.volunteer, emptyVolunteer(), '不改入参');
});

test('防刷：同一项一天一次；每天最多 dailyMax 次；跨日恢复', () => {
	let s = make({ loc: 'fremantle', clock: at(9, 3) }); // 弗里曼特尔：海滩 + 集市
	const r1 = doVolunteer(s, WA, 'beach-cleanup');
	assert.ok(r1.ok, r1.msg);
	const again = doVolunteer({ ...r1.state, clock: at(9, 3) + 130 }, WA, 'beach-cleanup');
	assert.equal(again.ok, false);
	assert.match(again.msg, /今天已经做过/);
	const r2 = doVolunteer(r1.state, WA, 'sausage-sizzle');
	assert.ok(r2.ok, r2.msg);
	assert.equal(VOL_RULES.dailyMax, 2);
	// 珀斯同一天：第三次被每日上限挡住
	s = { ...r2.state, loc: 'perth', needs: { ...r2.state.needs, energy: 90 }, clock: at(13, 3) };
	const r3 = doVolunteer(s, WA, 'food-bank');
	assert.equal(r3.ok, false);
	assert.match(r3.msg, /每天最多做 2 次/);
	assert.ok(volunteerAt(s, WA).every((o) => o.blocked));
	const next = doVolunteer({ ...s, clock: at(10, 4) }, WA, 'food-bank');
	assert.ok(next.ok, '第二天又能做');
	assert.deepEqual(next.state.volunteer.today, ['food-bank']);
});

test('时段、精力、待处理事件、地点不对都不行', () => {
	assert.match(doVolunteer(make({ clock: at(20, 2) }), WA, 'food-bank').msg, /9:00–15:00/);
	const tired = make();
	tired.needs.energy = VOL_RULES.minEnergy - 1;
	assert.match(doVolunteer(tired, WA, 'food-bank').msg, /太累/);
	assert.equal(doVolunteer(make({ pending: { eventId: 'x' } }), WA, 'food-bank').ok, false);
	assert.equal(doVolunteer(make({ loc: 'karijini' }), WA, 'food-bank').ok, false, '峡谷没有食物银行');
	assert.equal(doVolunteer(make(), WA, 'nope').ok, false);
	assert.ok(!volunteerAt(make({ loc: 'karijini' }), WA).some((o) => o.gig.id === 'food-bank'));
});

test('社区信誉：按总次数分档；动物救助、陪伴老人要第二档', () => {
	assert.deepEqual(volTier({ volunteer: emptyVolunteer() }), { lv: 0, name: '新面孔', shifts: 0, next: 5 });
	assert.equal(volTier({ volunteer: withShifts({ 'food-bank': 3, 'beach-cleanup': 1 }) }).lv, 0);
	assert.equal(volTier({ volunteer: withShifts({ 'food-bank': 3, 'beach-cleanup': 2 }) }).lv, 1);
	assert.deepEqual(volTier({ volunteer: withShifts({ 'food-bank': 40 }) }), { lv: 3, name: '社区之星', shifts: 40, next: null });
	const s = make({ volunteer: withShifts({ 'food-bank': 4 }) });
	const blocked = volunteerAt(s, WA).find((o) => o.gig.id === 'wildlife-rescue')!;
	assert.match(blocked.blocked!, /社区信誉要到第 2 档（再做 1 次/);
	assert.equal(doVolunteer(s, WA, 'elder-visit').ok, false);
	const ok = doVolunteer(make({ volunteer: withShifts({ 'food-bank': 5 }) }), WA, 'wildlife-rescue');
	assert.ok(ok.ok, ok.msg);
});

test('推荐信：同一项做满 refShifts 次给一封，不重发；在职位声望门槛上抵 refRespect，封数封顶', () => {
	const s = make({ volunteer: withShifts({ 'food-bank': VOL_RULES.refShifts - 1 }) });
	const r = doVolunteer(s, WA, 'food-bank');
	assert.ok(r.ok);
	assert.deepEqual(r.state.volunteer.refs, ['food-bank']);
	assert.match(r.msg, /推荐信/);
	assert.match(r.msg, /西澳食物银行/);
	const r2 = doVolunteer({ ...r.state, clock: at(10, 5) }, WA, 'food-bank');
	assert.deepEqual(r2.state.volunteer.refs, ['food-bank'], '不重发');
	assert.doesNotMatch(r2.msg, /推荐信/);
	const before = doVolunteer(make({ volunteer: withShifts({ 'food-bank': VOL_RULES.refShifts - 2 }) }), WA, 'food-bank');
	assert.deepEqual(before.state.volunteer.refs, [], '没做满不给');

	assert.equal(refRespect({ volunteer: withShifts({}, []) }), 0);
	assert.equal(refRespect({ volunteer: withShifts({}, ['food-bank']) }), VOL_RULES.refRespect);
	assert.equal(refRespect({ volunteer: withShifts({}, ['food-bank', 'beach-cleanup', 'cn-assoc']) }), VOL_RULES.refMax * VOL_RULES.refRespect);

	// 咖啡店升店长要声望 25：声望 20 + 一封推荐信（5）够了，19 不够
	const job = { career: 'barista', loc: 'perth', level: 1, shifts: 99, good: 99, lastDay: -1 };
	const skilled = (respect: number, refs: string[]) => {
		const p = make({ respect, job, volunteer: withShifts({}, refs) });
		p.skills.charisma = 60;
		return p;
	};
	assert.match(promotionStatus(skilled(24, []))!.blocked ?? '', /声望需达到 25/);
	assert.equal(promotionStatus(skilled(20, ['food-bank']))!.blocked, undefined);
	assert.match(promotionStatus(skilled(19, ['food-bank']))!.blocked ?? '', /声望需达到 25/);
});

test('一起做志愿的 NPC 在场：关系 +npcGain；不在场不加', () => {
	const rosa = NPCS.find((n) => n.id === 'rosa')!;
	let clock = -1;
	for (let d = 0; d < 28 && clock < 0; d++) for (let h = 8; h < 16; h++) if (npcPresent(rosa, 'bunbury', at(h, d))) { clock = at(h, d); break; }
	assert.ok(clock >= 0, '找得到罗莎在班伯里的时候');
	const s = make({ loc: 'bunbury', clock, volunteer: withShifts({ 'food-bank': 5 }) });
	const r = doVolunteer(s, WA, 'wildlife-rescue');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.relations.rosa.score, VOL_RULES.npcGain);
	assert.match(r.msg, /罗莎也在/);
	// 罗莎不在的时候
	let away = -1;
	for (let d = 0; d < 28 && away < 0; d++) for (let h = 8; h < 16; h++) if (!npcPresent(rosa, 'bunbury', at(h, d))) { away = at(h, d); break; }
	if (away >= 0) {
		const r2 = doVolunteer({ ...s, clock: away }, WA, 'wildlife-rescue');
		assert.ok(r2.ok, r2.msg);
		assert.equal(r2.state.relations.rosa, undefined);
	}
});

test('节日志愿者：只在这里办节日的那几天出现', () => {
	const f = FESTIVALS.find((x) => x.id === 'skyshow')!;
	let day = 0;
	while (!inSpan(at(12, day), f.season, f.day, f.days).active) day++;
	const on = make({ loc: f.loc, clock: at(12, day) });
	assert.ok(festivalsNow(on.clock).some((x) => x.id === f.id));
	assert.ok(volunteerAt(on, WA).some((o) => o.gig.id === 'festival-helper' && !o.blocked));
	assert.ok(doVolunteer(on, WA, 'festival-helper').ok);
	const off = make({ loc: f.loc, clock: at(12, day + 10) });
	assert.ok(!volunteerAt(off, WA).some((o) => o.gig.id === 'festival-helper'));
	assert.equal(doVolunteer(off, WA, 'festival-helper').ok, false);
});

test('组织按区域：珀斯列西澳的，阿德莱德列南澳的；香肠摊不写真实组织', () => {
	const perth = volunteerAt(make(), WORLD).find((o) => o.gig.id === 'food-bank')!;
	assert.equal(perth.org?.id, 'foodbank-wa');
	const adl = volunteerAt(make({ loc: 'adelaide' }), WORLD).find((o) => o.gig.id === 'food-bank')!;
	assert.equal(adl.org?.id, 'foodbank-sa');
	assert.equal(volunteerAt(make({ loc: 'adelaide' }), WORLD).find((o) => o.gig.id === 'cn-assoc')!.org, undefined, '南澳没有核实到办活动的华人社团');
	const sizzle = volunteerAt(make({ loc: 'fremantle' }), WORLD).find((o) => o.gig.id === 'sausage-sizzle')!;
	assert.equal(sizzle.org, undefined);
});

test('途中晕倒：次数照记（防止靠晕倒刷），不发声望', () => {
	const s = make();
	s.health = 0.1;
	for (const k of Object.keys(s.needs) as (keyof PlayerState['needs'])[]) s.needs[k] = 0;
	s.needs.energy = VOL_RULES.minEnergy;
	const r = doVolunteer(s, WA, 'food-bank');
	assert.ok(r.collapsed, r.msg);
	assert.equal(r.state.respect, s.respect);
	assert.equal(r.state.volunteer.n['food-bank'], 1);
});

test('动作校验：volunteer 只认合法 id', () => {
	assert.deepEqual(parseAction({ t: 'volunteer', id: 'food-bank' }), { t: 'volunteer', id: 'food-bank' });
	assert.equal(parseAction({ t: 'volunteer', id: 'Food Bank' }), null);
	assert.equal(parseAction({ t: 'volunteer' }), null);
	assert.equal(parseAction({ t: 'volunteer', id: 3 }), null);
});

test('存档清洗：旧存档补空记录；坏值不抛；只留已知 id；未来日期作废；幂等', () => {
	const base = make();
	const { volunteer: _drop, ...old } = base;
	assert.deepEqual(sanitizeState(old)!.volunteer, emptyVolunteer());
	for (const bad of [null, 1, 'x', [], { n: [] }, { n: null, refs: 'a' }, { day: NaN, today: {} }, { n: { constructor: 5, __proto__: 3 } }])
		assert.deepEqual(cleanVolunteer(bad, base.clock), emptyVolunteer(), JSON.stringify(bad));
	const dirty = { day: 2, today: ['food-bank', 'food-bank', 'nope', 'beach-cleanup', 'cn-assoc'], n: { 'food-bank': 3.7, nope: 9, 'beach-cleanup': -1, 'cn-assoc': 1e12 }, refs: ['food-bank', 'nope', 'food-bank'] };
	const c = cleanVolunteer(dirty, base.clock);
	assert.deepEqual(c, { day: 2, today: ['food-bank', 'beach-cleanup'], n: { 'food-bank': 3, 'cn-assoc': 1e6 }, refs: ['food-bank'] });
	assert.deepEqual(cleanVolunteer(c, base.clock), c, '幂等');
	assert.deepEqual(cleanVolunteer({ day: 99, today: ['food-bank'], n: {} }, base.clock), emptyVolunteer(), '比存档时钟还晚的日子作废');
	const s1 = sanitizeState({ ...base, volunteer: dirty })!;
	assert.deepEqual(sanitizeState(s1), s1);
	assert.equal(volShifts(s1.volunteer), 1e6 + 3);
});
