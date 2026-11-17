// 车辆保养：里程累计、超过保养里程后自驾抵达可能抛锚、修车厂保养清零（第 15 轮）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyEffect, breakdownChance, buyVehicle, garageAt, getPendingEvent, sellVehicle, serviceVehicle, travel } from '../../src/game/core/engine.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { BREAKDOWN, SERVICE_KM, VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
// 留学生开局有一辆二手轿车
const make = (over: Partial<PlayerState> = {}, seed = 3): PlayerState => ({
	...createCharacter({ id: 'car-player', name: '车', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(10),
	cash: 5000,
	...over,
});

test('数据：每种车有保养价；抛锚事件不进普通抽取，且都有不花钱的选项', () => {
	for (const v of VEHICLES) assert.ok(v.service > 0, v.id);
	const bd = EVENTS.filter((e) => e.breakdown);
	assert.ok(bd.length >= 3);
	for (const e of bd) {
		assert.equal(e.weight, 0, `${e.id} 不进普通抽取`);
		assert.ok(e.choices.some((c) => !c.cost), `${e.id} 没钱也能处理`);
	}
});

test('抛锚几率：保养里程以内为 0，超过后随里程上涨，有上限；没车为 0', () => {
	assert.equal(breakdownChance(make({ car: { km: 9000, since: SERVICE_KM - 1 } })), 0);
	assert.equal(breakdownChance(make({ car: { km: 9000, since: SERVICE_KM } })), 0, '正好 5000 公里还不算超过');
	assert.ok(Math.abs(breakdownChance(make({ car: { km: 9000, since: SERVICE_KM + 1 } })) - BREAKDOWN.base) < 1e-3);
	assert.ok(breakdownChance(make({ car: { km: 0, since: SERVICE_KM + 4000 } })) > BREAKDOWN.base);
	assert.equal(breakdownChance(make({ car: { km: 0, since: 1e6 } })), BREAKDOWN.max);
	assert.equal(breakdownChance(make({ vehicle: 'none', car: { km: 0, since: 1e6 } })), 0);
});

test('里程：自驾累计、坐巴士不算；换车、卖车清零', () => {
	const s = make();
	const r = travel(s, WA, 'fremantle', 'road');
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.car.km > 0 && r.state.car.since === r.state.car.km);
	assert.deepEqual(s.car, { km: 0, since: 0 }, '不改入参');
	const bus = travel(make({ vehicle: 'none' }), WA, 'fremantle', 'road');
	assert.deepEqual(bus.state.car, { km: 0, since: 0 });
	const used = make({ cash: 50_000, car: { km: 8000, since: 6000 } });
	assert.deepEqual(buyVehicle(used, WA, '4wd').state.car, { km: 0, since: 0 });
	assert.deepEqual(sellVehicle(used, WA).state.car, { km: 0, since: 0 });
});

test('抛锚：没到保养里程从不抛锚、也不多掷骰；超了之后总会遇到，遇到的是抛锚事件', () => {
	let hits = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const fresh = travel(make({ car: { km: 0, since: SERVICE_KM - 500 } }, seed), WA, 'fremantle', 'road');
		const zero = travel(make({}, seed), WA, 'fremantle', 'road');
		assert.equal(fresh.state.seed, zero.state.seed, '没超里程不消耗随机数');
		assert.ok(!getPendingEvent(fresh.state)?.breakdown);
		const worn = travel(make({ car: { km: 0, since: 1e6 } }, seed), WA, 'fremantle', 'road');
		if (getPendingEvent(worn.state)?.breakdown) hits++;
	}
	assert.ok(hits > 0, '超了保养里程会抛锚');
});

test('修车厂：城镇白天开门，按车型收费，里程清零但总里程保留；岛上没有，没车没有', () => {
	const s = make({ car: { km: 12_000, since: 7000 } });
	const g = garageAt(s, WA)!;
	assert.equal(g.price, 220);
	assert.equal(g.blocked, undefined);
	assert.match(garageAt({ ...s, clock: at(20) }, WA)!.blocked!, /营业时间/);
	assert.match(garageAt({ ...s, cash: 100 }, WA)!.blocked!, /需要/);
	assert.equal(garageAt({ ...s, loc: 'rottnest' }, WA), null);
	assert.equal(garageAt({ ...s, vehicle: 'none' }, WA), null);
	assert.equal(serviceVehicle({ ...s, pending: { eventId: 'flat-tyre' } }, WA).ok, false);
	const r = serviceVehicle(s, WA);
	assert.ok(r.ok, r.msg);
	assert.deepEqual(r.state.car, { km: 12_000, since: 0 });
	assert.equal(r.state.cash, s.cash - 220);
	assert.equal(r.state.clock, s.clock + 120);
	assert.match(serviceVehicle(r.state, WA).msg, /刚保养过/);
});

test('动作协议和存档校验', () => {
	assert.deepEqual(parseAction({ t: 'vehicle', op: 'service' }), { t: 'vehicle', op: 'service' });
	const locs = new Set(WA.locations.map((l) => l.id));
	const bad = sanitizeState({ ...make(), car: { km: -5, since: 'x' } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(bad.car, { km: 0, since: 0 });
	const old: Record<string, unknown> = { ...make() };
	delete old.car;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.car, { km: 0, since: 0 });
	assert.deepEqual(sanitizeState({ ...make(), car: { km: 1234.7, since: 99.2 } }, locs, { fallbackLoc: 'perth', now: Date.now() })!.car, { km: 1234, since: 99 });
});

test('抛锚的先后：被盘查时不抛锚也不掷骰；否则抛锚优先于普通到达事件，实际几率就是标的几率（复审问题 2）', () => {
	const N = 600;
	let hits = 0;
	for (let seed = 1; seed <= N; seed++) {
		const r = travel(make({ car: { km: 0, since: 1e6 } }, seed), WA, 'fremantle', 'road');
		if (getPendingEvent(r.state)?.breakdown) hits++;
	}
	const rate = hits / N;
	assert.ok(Math.abs(rate - BREAKDOWN.max) < 0.07, `标 ${BREAKDOWN.max}，实际 ${rate}`);
	for (let seed = 1; seed <= 30; seed++) {
		const hot = travel(make({ heat: 80, car: { km: 0, since: 1e6 } }, seed), WA, 'fremantle', 'road');
		assert.equal(getPendingEvent(hot.state)?.id, 'heat-check', '盘查优先');
		const cold = travel(make({ heat: 80 }, seed), WA, 'fremantle', 'road');
		assert.equal(hot.state.seed, cold.state.seed, '被盘查时不为抛锚掷骰');
	}
});

test('保养途中晕倒：保养没做、不收钱，和没去保养的结果一样（复审问题 3）', () => {
	const weak = make({ health: 1, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 }, car: { km: 9000, since: 7000 } });
	const r = serviceVehicle(weak, WA);
	assert.ok(r.collapsed);
	assert.equal(r.state.car.since, 7000, '没保养');
	assert.ok(r.state.journal.some((j) => /不收钱/.test(j.text)));
	// 和同样晕倒、但没去保养的情况比：现金一样（只扣了住院费）
	const control = structuredClone(weak);
	assert.ok(applyEffect(control, { minutes: 120 }, WA));
	assert.equal(r.state.cash, control.cash);
});

test('里程存档约束：没车清零、保养里程不超过总里程、引擎输出不超上限（复审问题 4）', async () => {
	const { CAR_KM_MAX } = await import('../../src/game/data/vehicles.ts');
	const locs = new Set(WA.locations.map((l) => l.id));
	const fix = (over: Partial<PlayerState>) => sanitizeState({ ...make(), ...over }, locs, { fallbackLoc: 'perth', now: Date.now() })!.car;
	assert.deepEqual(fix({ vehicle: 'none', car: { km: 9000, since: 100 } }), { km: 0, since: 0 });
	assert.deepEqual(fix({ car: { km: 100, since: 1000 } }), { km: 100, since: 100 });
	const r = travel(make({ car: { km: CAR_KM_MAX, since: CAR_KM_MAX } }), WA, 'fremantle', 'road');
	assert.deepEqual(r.state.car, { km: CAR_KM_MAX, since: CAR_KM_MAX });
});

test('首次到访的签名事件优先于抛锚：抛锚不会挤掉「首次必出」（二次复审问题 1）', () => {
	const sig = EVENTS.filter((e) => e.once && e.locs?.includes('kalgoorlie'));
	assert.ok(sig.length, '卡尔古利有签名事件');
	let later = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const worn = make({ cash: 50_000, car: { km: 0, since: 1e6 } }, seed);
		const first = travel(worn, WA, 'kalgoorlie', 'road');
		assert.ok(first.ok, first.msg);
		assert.ok(getPendingEvent(first.state)?.once, `seed ${seed} 首次到访出签名事件`);
		// 来过了：抛锚照常
		const again = travel({ ...worn, visited: { ...worn.visited, kalgoorlie: 1 }, seen: sig.map((e) => e.id) }, WA, 'kalgoorlie', 'road');
		if (getPendingEvent(again.state)?.breakdown) later++;
	}
	assert.ok(later > 0, '再来时会抛锚');
});
