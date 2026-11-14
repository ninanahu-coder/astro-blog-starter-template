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

// ---------- 阶段 B：家具、在家活动、每周结算 ----------
import { homeComfort, mood, weeklyCosts } from '../../src/game/core/attributes.ts';
import {
	buyFurniture, cookAtHome, firstRent, furnitureAt, furnitureValue, homeActionBlocked, leaveHome, relaxAtHome, rentHome,
	sellFurniture, sleepHome,
} from '../../src/game/core/engine.ts';
import { FURNITURE, FURNITURE_SLOTS } from '../../src/game/data/furniture.ts';
import { HOMES } from '../../src/game/data/housing.ts';

const housed = (over: Partial<PlayerState> = {}) => rentHome(make({ cash: 5000, clock: at(9), ...over }), WA, 'room').state;

test('家具数据自洽', () => {
	assert.equal(new Set(FURNITURE.map((f) => f.id)).size, FURNITURE.length);
	for (const f of FURNITURE) assert.ok(FURNITURE_SLOTS[f.slot], `${f.id} 槽位存在`);
	for (const op of ['cook', 'relax']) assert.ok(FURNITURE.some((f) => f.unlock === op));
});

test('租房首期按到结算日的天数折算', () => {
	const room = HOMES.find((h) => h.id === 'room')!;
	assert.equal(firstRent(make({ clock: at(9) }), room), 160, '第 1 天租：整周');
	assert.equal(firstRent(make({ clock: at(9, 5) }), room), Math.round((160 * 2) / 7), '第 6 天租：只付 2 天');
	const r = rentHome(make({ cash: 1000, clock: at(9, 5) }), WA, 'room');
	assert.equal(r.state.cash, 1000 - 46);
});

test('家具：要在住处买、同槽位替换半价折旧、可卖', () => {
	const s = housed();
	assert.equal(furnitureAt({ ...s, loc: 'fremantle' }).length, 0);
	assert.equal(buyFurniture(make({ cash: 5000 }), WA, 'mattress').ok, false, '没有住处');
	const r1 = buyFurniture(s, WA, 'mattress');
	assert.ok(r1.ok);
	assert.equal(r1.state.cash, s.cash - 400);
	const r2 = buyFurniture(r1.state, WA, 'kingbed');
	assert.equal(r2.state.cash, r1.state.cash - (1200 - 200), '旧床垫折 $200');
	assert.equal(r2.state.home!.furniture.bed, 'kingbed');
	const r3 = sellFurniture(r2.state, 'bed');
	assert.equal(r3.state.cash, r2.state.cash + 600);
	assert.equal(r3.state.home!.furniture.bed, undefined);
	assert.ok(r3.state.cash < s.cash, '买了再卖一定亏');
});

test('家具效果：睡得更好、在家做饭和放松、心情', () => {
	let s = housed();
	assert.equal(homeActionBlocked(s, 'cook'), '需要炊具');
	assert.equal(cookAtHome(s, WA).ok, false);
	for (const id of ['cookset', 'stereo', 'mattress', 'designer']) s = buyFurniture(s, WA, id).state;
	const hungry = { ...s, needs: { ...s.needs, hunger: 10, fun: 10 } };
	const cooked = cookAtHome(hungry, WA);
	assert.ok(cooked.ok);
	assert.equal(cooked.state.cash, hungry.cash - 6);
	assert.ok(cooked.state.needs.hunger > 55);
	assert.ok(relaxAtHome(hungry, WA).state.needs.fun > 35);
	assert.equal(cookAtHome({ ...hungry, loc: 'fremantle' }, WA).ok, false, '不在家');
	assert.equal(homeComfort(s), 5);
	assert.equal(mood(s) - mood({ ...s, home: { ...s.home!, furniture: {} } }), 5);
	const hurt = { ...s, health: 40 };
	const plain = { ...hurt, home: { ...s.home!, furniture: {} } };
	assert.equal(sleepHome(hurt, WA).state.health - sleepHome(plain, WA).state.health, 10, '好床垫 +10 健康');
});

test('搬走或被收房：家具半价折现', () => {
	let s = housed();
	s = buyFurniture(s, WA, 'mattress').state;
	s = buyFurniture(s, WA, 'plants').state;
	assert.equal(furnitureValue(s), 275);
	const left = leaveHome(s);
	assert.equal(left.state.cash, s.cash + 275);
	const evicted = applyAction({ ...s, cash: 10, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(evicted.home, null);
	assert.equal(evicted.cash, 10 + 275);
});

test('每周结算：房租 + 车辆保险；没钱续保记麻烦值', () => {
	const s = housed({ vehicle: '4wd' });
	assert.deepEqual(weeklyCosts(s), { rent: 160, vehicle: 40, property: 0, total: 200 });
	const after = applyAction({ ...s, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(after.cash, s.cash - 200);
	assert.equal(after.nextWeek, 14);
	const two = applyAction({ ...s, clock: at(20, 13) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(two.cash, s.cash - 400, '跨两周扣两次');
	const broke = applyAction(make({ vehicle: 'car', cash: 5, clock: at(20, 6) }), WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(broke.cash, 5);
	assert.ok(broke.heat > 0);
	assert.equal(broke.vehicle, 'car', '车不会被收走');
});

test('阶段 B 的动作协议与旧存档迁移', () => {
	assert.deepEqual(parseAction({ t: 'home', op: 'cook' }), { t: 'home', op: 'cook' });
	assert.deepEqual(parseAction({ t: 'furniture', op: 'buy', id: 'stereo' }), { t: 'furniture', op: 'buy', id: 'stereo' });
	assert.deepEqual(parseAction({ t: 'furniture', op: 'sell', slot: 'bed' }), { t: 'furniture', op: 'sell', slot: 'bed' });
	assert.equal(parseAction({ t: 'furniture', op: 'sell' }), null);

	// 旧存档：home.paidUntil，没有 nextWeek / furniture
	const old = { ...make({ clock: at(9, 10) }), home: { type: 'room', loc: 'perth', paidUntil: 12 } } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'nextWeek');
	const m = sanitizeState(old)!;
	assert.equal(m.nextWeek, 12, '沿用旧的房租到期日');
	assert.deepEqual(m.home, { type: 'room', loc: 'perth', furniture: {} });
	const dirty = housed();
	const c = sanitizeState({ ...dirty, nextWeek: -9999, home: { ...dirty.home, furniture: { bed: 'stereo', decor: 'plants', hax: 'x' } } })!;
	assert.deepEqual(c.home!.furniture, { decor: 'plants' }, '家具必须放在自己的槽位');
	assert.ok(c.nextWeek >= -7, '结算日不会落后太多，避免一次补扣几百周');
});

test('跨周结算前先发这一班的工资：工资够付刚到期的房租就不会被收房', () => {
	const s = housed({ clock: at(9) });
	const job = { career: 'barista', loc: s.loc, level: 0, shifts: 0, good: 0, lastDay: -1 };
	const due = { ...s, job, cash: 50, clock: at(7, 6), nextWeek: 6, needs: { hunger: 90, energy: 90, hygiene: 80, fun: 60, social: 60 } };
	const r = applyAction(due, WA, { t: 'job', op: 'work' });
	assert.ok(r.ok && !r.collapsed, r.msg);
	assert.ok(r.state.home, '$50 + 工资 ≥ 房租 $160，不该被收房');
	assert.equal(r.state.nextWeek, 13);
	assert.ok(r.state.cash < 50 + 200, '房租照扣');
});

test('直接耗时的动作途中晕倒也要停下：出行、买家具、应聘', () => {
	const weak = { health: 0.2, needs: { hunger: 0, energy: 90, hygiene: 80, fun: 60, social: 60 } };
	const trip = applyAction(make({ cash: 500, clock: at(9), wishes: ['road-trip'], wishDay: 0, ...weak }), WA, { t: 'travel', to: 'fremantle', mode: 'road' });
	assert.ok(trip.ok && trip.collapsed, trip.msg);
	assert.notEqual(trip.state.loc, 'fremantle', '没到达');
	assert.ok(!trip.state.moodlets.some((m) => m.id === 'wish-done'), '出行心愿不算完成');
	const home = housed();
	const bed = applyAction({ ...home, ...weak }, WA, { t: 'furniture', op: 'buy', id: 'mattress' });
	assert.ok(bed.ok && bed.collapsed, bed.msg);
	assert.equal(bed.state.home?.furniture.bed, 'mattress', '已经成交的家具保留');
	const hired = applyAction(make({ clock: at(9), ...weak }), WA, { t: 'job', op: 'apply', career: 'barista' });
	assert.ok(hired.ok && hired.collapsed, hired.msg);
});
