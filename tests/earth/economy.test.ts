import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	areaTitles, buyVehicle, coursePrice, coursesAt, dealerAt, doExperience, experiencesAt, resaleValue, sellVehicle,
	sleepInVehicle, takeCourse, travelOptions,
} from '../../src/game/core/engine.ts';
import { COURSES } from '../../src/game/data/courses.ts';
import { AREAS, EXPERIENCES } from '../../src/game/data/experiences.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'econ-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 11 }),
	...over,
});

test('消费数据自洽', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	for (const v of VEHICLES) assert.ok(v.resale > 0 && v.resale < 1, `${v.id} 转手必亏`);
	assert.ok(WA.locations.some((l) => l.tags.includes('dealer')), '至少有一个车行');
	for (const e of EXPERIENCES) {
		assert.ok(locs.has(e.loc), `${e.id} 地点存在`);
		assert.ok(AREAS[e.area], `${e.id} 片区存在`);
	}
	assert.equal(new Set(EXPERIENCES.map((e) => e.id)).size, EXPERIENCES.length);
	for (const c of COURSES) {
		assert.ok(WA.locations.some((l) => c.where.kinds?.includes(l.kind) || c.where.tags?.some((t) => l.tags.includes(t))), `${c.id} 至少一个地点能上`);
	}
});

test('车行：买、换、卖；营业时间；钱不够', () => {
	const s = make({ cash: 20000, clock: at(10) });
	assert.equal(dealerAt({ ...s, loc: 'broome' }, WA).length, 0, '布鲁姆没有车行');
	assert.match(dealerAt({ ...s, clock: at(20) }, WA)[0].blocked!, /营业时间/);
	const r1 = buyVehicle(s, WA, 'car');
	assert.ok(r1.ok);
	assert.equal(r1.state.vehicle, 'car');
	assert.equal(r1.state.cash, 15500);
	const r2 = buyVehicle({ ...r1.state, clock: at(10, 1) }, WA, '4wd');
	assert.ok(r2.ok, '以旧换新');
	assert.equal(r2.state.cash, 15500 - (12000 - resaleValue('car')));
	const r3 = sellVehicle({ ...r2.state, clock: at(10, 2) }, WA);
	assert.ok(r3.ok);
	assert.equal(r3.state.vehicle, 'none');
	assert.equal(buyVehicle(make({ cash: 100, clock: at(10) }), WA, 'car').ok, false);
});

test('买了马上卖一定亏钱（没有套利）', () => {
	for (const v of VEHICLES) {
		const s = make({ cash: 50000, clock: at(10) });
		const bought = buyVehicle(s, WA, v.id).state;
		const sold = sellVehicle(bought, WA).state;
		assert.ok(sold.cash < s.cash, `${v.id}: ${s.cash} → ${sold.cash}`);
	}
});

test('车型决定能不能走土路、开多快、花多少', () => {
	const base = make({ loc: 'exmouth', cash: 5000 });
	const karijini = (v: string) => travelOptions({ ...base, vehicle: v }, WA).find((o) => o.to === 'karijini')!;
	assert.equal(karijini('car').available, false);
	assert.equal(karijini('motorbike').available, false);
	assert.equal(karijini('4wd').available, true);
	assert.equal(karijini('campervan').available, true);
	const toHedland = (v: string) => travelOptions({ ...base, vehicle: v }, WA).find((o) => o.to === 'port-hedland' && o.mode === 'road')!;
	assert.ok(toHedland('motorbike').minutes < toHedland('car').minutes, '摩托更快');
	assert.ok(toHedland('motorbike').cost < toHedland('campervan').cost, '摩托更省油');
	assert.match(toHedland('none').label, /巴士/);
});

test('摩托车长途更累；露营车可以睡', () => {
	const s = make({ cash: 5000, clock: at(8) });
	const ride = (v: string) => applyAction({ ...s, vehicle: v }, WA, { t: 'travel', to: 'pinnacles', mode: 'road' }).state.needs.energy;
	assert.ok(ride('motorbike') < ride('car'));
	assert.equal(sleepInVehicle(s, WA).ok, false);
	const slept = sleepInVehicle({ ...s, vehicle: 'campervan', needs: { ...s.needs, energy: 10 } }, WA);
	assert.ok(slept.ok);
	const camped = applyAction({ ...s, needs: { ...s.needs, energy: 10 } }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.ok(slept.state.needs.energy > camped.needs.energy, '露营车比露营睡得好');
});

test('课程：价格随能力上涨、每天一次、比自练快', () => {
	const s = make({ cash: 2000, clock: at(9) });
	const drive = COURSES.find((c) => c.id === 'driving-school')!;
	assert.ok(coursePrice({ ...s, skills: { ...s.skills, driving: 60 } }, drive) > coursePrice(s, drive) * 2);
	const r = takeCourse(s, WA, 'driving-school');
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.skills.driving > s.skills.driving + 1);
	assert.equal(r.state.cash, s.cash - coursePrice(s, drive));
	assert.equal(takeCourse({ ...r.state, clock: at(14) }, WA, 'driving-school').ok, false, '同一天不能再上');
	assert.ok(takeCourse({ ...r.state, clock: at(9, 1) }, WA, 'driving-school').ok, '第二天可以');
	assert.match(coursesAt({ ...s, clock: at(3) }, WA).find((o) => o.course.id === 'driving-school')!.blocked!, /上课时间/);
});

test('体验：首次进收藏册加声望，重复只给心情；集齐片区得称号', () => {
	let s = make({ cash: 5000, clock: at(17) });
	const r = doExperience(s, WA, 'swan-cruise');
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.collected.includes('swan-cruise'));
	assert.ok(r.state.respect > s.respect);
	const again = doExperience({ ...r.state, clock: at(17, 1) }, WA, 'swan-cruise');
	assert.ok(again.ok);
	assert.equal(again.state.respect, r.state.respect, '重复不加声望');
	assert.equal(experiencesAt({ ...s, clock: at(10) }, WA)[0].blocked, '开放时间 16:00–20:00');

	s = { ...r.state, loc: 'rottnest', clock: at(10, 2) };
	s = doExperience(s, WA, 'rottnest-cycle').state;
	assert.deepEqual(areaTitles(s), []);
	s = doExperience({ ...s, loc: 'fremantle', clock: at(19, 2) }, WA, 'prison-night').state;
	assert.deepEqual(areaTitles(s), ['珀斯通']);
});

test('动作协议与存档校验', () => {
	assert.deepEqual(parseAction({ t: 'vehicle', op: 'buy', id: 'campervan' }), { t: 'vehicle', op: 'buy', id: 'campervan' });
	assert.deepEqual(parseAction({ t: 'vehicle', op: 'sleep' }), { t: 'vehicle', op: 'sleep' });
	assert.equal(parseAction({ t: 'vehicle', op: 'steal' }), null);
	assert.deepEqual(parseAction({ t: 'course', id: 'surf-school' }), { t: 'course', id: 'surf-school' });
	assert.equal(parseAction({ t: 'experience' }), null);

	const dirty = make({ vehicle: 'tank', collected: ['swan-cruise', 'swan-cruise', 'moon-landing'], courseDays: { 'surf-school': 3.6, hacking: 1 } });
	const clean = sanitizeState(dirty)!;
	assert.equal(clean.vehicle, 'none');
	assert.deepEqual(clean.collected, ['swan-cruise']);
	assert.deepEqual(clean.courseDays, { 'surf-school': 3 });
	assert.equal(sanitizeState(make({ vehicle: 'campervan' }))!.vehicle, 'campervan');
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'collected');
	Reflect.deleteProperty(old, 'courseDays');
	const migrated = sanitizeState(old)!;
	assert.deepEqual(migrated.collected, []);
	assert.deepEqual(migrated.courseDays, {});
});
