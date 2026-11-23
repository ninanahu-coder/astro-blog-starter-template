// 第 26 批：租房押金、车辆过户印花税、车按里程折旧、天气影响路况。数值都是待平衡的初始值，
// 印花税公式是真实规则（西澳 Department of Treasury and Finance、南澳 RevenueSA，见 docs/earth-game/home-and-vehicle.md）。
import { fuelMult } from '../../src/game/core/world.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	bondFor, buyProperty, buyVehicle, dealerAt, homesAt, leaveHome, moveIntoProperty, moveInCost, netWorth, rentHome as signLease, resaleValue, sellVehicle, travel, travelOptions,
} from '../../src/game/core/engine.ts';
import { vehicleDuty } from '../../src/game/core/finance.ts';
import { dayOf } from '../../src/game/core/time.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { BOND_WEEKS, HOMES } from '../../src/game/data/housing.ts';
import { DEPRECIATION, VEHICLES } from '../../src/game/data/vehicles.ts';
import { WEATHERS } from '../../src/game/data/weather.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

/** 这里只测押金本身：把签约时种子定的「入住时原有损坏」（租房市场 rental 批次）清零，退房时房东没有可扣的；扣损坏的规则见 rental.test.ts */
const rentHome = (...a: Parameters<typeof signLease>) => {
	const r = signLease(...a);
	if (r.state.rental.lease) r.state.rental.lease.prior = 0;
	return r;
};

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'homecar-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 26 }),
	...over,
});
const home = (id: string) => HOMES.find((h) => h.id === id)!;
const locs = new Set(WORLD.locations.map((l) => l.id));

// ---------- 过户印花税 ----------
test('过户印花税：西澳按 2.75% / 滑动费率 / 6.5% 三档', () => {
	assert.equal(vehicleDuty(4500, 'wa'), 124, '4,500 × 2.75% = 123.75');
	assert.equal(vehicleDuty(25000, 'wa'), 688, '上限内仍是 2.75%');
	assert.equal(vehicleDuty(28000, 'wa'), 896, '28,000：R = 2.75 + 3000 / 6666.66 = 3.20%');
	assert.equal(vehicleDuty(50000, 'wa'), 3250, '50,000：R = 6.50%');
	assert.equal(vehicleDuty(60000, 'wa'), 3900, '超过 50,000 按 6.5%');
	assert.equal(vehicleDuty(0, 'wa'), 0);
	assert.equal(vehicleDuty(4500, 'nt'), vehicleDuty(4500, 'wa'), '没有公式的区域按西澳算');
});

test('过户印花税：南澳按每 $100 阶梯，不足 $100 按 $100 算，最低 $5', () => {
	assert.equal(vehicleDuty(300, 'sa'), 5, '最低 $5');
	assert.equal(vehicleDuty(1000, 'sa'), 10);
	assert.equal(vehicleDuty(1500, 'sa'), 20, '$10 + 5 × $2');
	assert.equal(vehicleDuty(2500, 'sa'), 45, '$30 + 5 × $3');
	assert.equal(vehicleDuty(3001, 'sa'), 64, '超出 $1 也按一个 $100 算');
	assert.equal(vehicleDuty(4500, 'sa'), 120, '$60 + 15 × $4');
	assert.equal(vehicleDuty(28000, 'sa'), 1060);
});

test('车行：价钱里含所在区域的印花税；阿德莱德有车行，按南澳算', () => {
	const perth = make({ cash: 50000, clock: at(10) });
	const adl = { ...perth, loc: 'adelaide' };
	for (const v of VEHICLES) {
		const p = dealerAt(perth, WORLD).find((o) => o.vehicle.id === v.id)!;
		const a = dealerAt(adl, WORLD).find((o) => o.vehicle.id === v.id)!;
		assert.equal(p.duty, vehicleDuty(v.price, 'wa'), `${v.id} 珀斯`);
		assert.equal(a.duty, vehicleDuty(v.price, 'sa'), `${v.id} 阿德莱德`);
		assert.equal(p.net, v.price + p.duty, `${v.id} 没有旧车时付车价 + 印花税`);
	}
	const r = buyVehicle(adl, WORLD, 'car');
	assert.ok(r.ok);
	assert.equal(r.state.cash, 50000 - 4500 - 120);
	assert.match(r.msg, /印花税 \$120/);
	assert.equal(adl.cash, 50000, '入参没被改');
	// 钱只够车价、不够印花税：买不了
	const tight = make({ cash: 4500, clock: at(10) });
	assert.match(dealerAt(tight, WA).find((o) => o.vehicle.id === 'car')!.blocked!, /还差 \$124/);
	assert.equal(buyVehicle(tight, WA, 'car').ok, false);
});

// ---------- 按里程折旧 ----------
test('转手价随里程下降：每 1 万公里少 2 个百分点，最低 30%', () => {
	assert.equal(resaleValue('car'), 2700, '新车 4500 × 0.6');
	assert.equal(resaleValue('car', 50000), Math.round(4500 * (0.6 - 50000 * DEPRECIATION.perKm)), '5 万公里');
	assert.equal(resaleValue('car', 50000), 2250);
	assert.equal(resaleValue('car', 1e7), Math.round(4500 * DEPRECIATION.floor), '开到底也剩 30%');
	assert.equal(resaleValue('car', -500), resaleValue('car'), '负里程按 0');
	assert.equal(resaleValue('none', 1000), 0);
	for (const v of VEHICLES) {
		assert.ok(resaleValue(v.id, 30000) < resaleValue(v.id, 0), `${v.id} 开过的车更不值钱`);
		assert.ok(resaleValue(v.id, 1e6) <= resaleValue(v.id, 30000), `${v.id} 单调不增`);
	}
});

test('卖车、折抵、净资产都按现在的里程算', () => {
	const s = make({ cash: 1000, clock: at(10), vehicle: 'car', car: { km: 50000, since: 2000 } });
	const sold = sellVehicle(s, WA);
	assert.ok(sold.ok);
	assert.equal(sold.state.cash, 1000 + 2250);
	assert.equal(netWorth(s), 1000 + 2250);
	const rich = { ...s, cash: 20000 };
	const swap = dealerAt(rich, WA).find((o) => o.vehicle.id === '4wd')!;
	assert.equal(swap.net, 12000 + 330 - 2250);
	const r = buyVehicle(rich, WA, '4wd');
	assert.equal(r.state.cash, 20000 - swap.net);
	assert.match(r.msg, /折抵 \$2250/);
});

// ---------- 租房押金 ----------
test('押金：周租 × BOND_WEEKS，房车营地免押金', () => {
	assert.equal(bondFor(home('room')), 160 * BOND_WEEKS);
	assert.equal(bondFor(home('campground')), 0);
	for (const h of HOMES) assert.ok(bondFor(h) <= h.rentWeek * 4, `${h.id} 不超过真实上限 4 周`);
});

test('租房先付首期 + 押金；押金搬走全退、算进净资产', () => {
	const s = make({ cash: 1000, clock: at(9) });
	const r = rentHome(s, WA, 'room');
	assert.ok(r.ok);
	assert.equal(r.state.home!.bond, 320);
	assert.equal(r.state.cash, 1000 - 160 - 320);
	assert.match(r.msg, /押金 \$320/);
	assert.equal(netWorth(r.state), r.state.cash + 320, '押金是自己的钱');
	const left = leaveHome(r.state);
	assert.equal(left.state.cash, r.state.cash + 320);
	assert.match(left.msg, /押金退回 \$320/);
	assert.equal(s.home, null, '入参没被改');
});

test('钱够首期不够押金：租不了；换房时旧押金先退回再算', () => {
	const poor = make({ cash: 300, clock: at(9) });
	const room = homesAt(poor, WA).find((o) => o.home.id === 'room')!;
	assert.match(room.blocked!, /押金 \$320/);
	assert.equal(rentHome(poor, WA, 'room').ok, false);
	// 已经住合租（押金 $320），手头 $300：换一居室要首期 320 + 押金 640 − 退回 320 = 640，仍不够
	const housed = rentHome(make({ cash: 780, clock: at(9) }), WA, 'room').state;
	assert.equal(housed.cash, 300);
	assert.equal(moveInCost(housed, home('flat')), 320 + 640 - 320);
	assert.ok(homesAt(housed, WA).find((o) => o.home.id === 'flat')!.blocked);
	const richer = { ...housed, cash: 640 };
	const moved = rentHome(richer, WA, 'flat');
	assert.ok(moved.ok, moved.msg);
	assert.equal(moved.state.cash, 0, '旧押金退回后正好付清');
	assert.equal(moved.state.home!.bond, 640);
	assert.match(moved.msg, /旧住处押金退回 \$320/);
});

test('付不起房租被收房：押金先抵一周房租，剩下的退回', () => {
	const s = rentHome(make({ cash: 1000, clock: at(9) }), WA, 'flat').state; // 押金 640
	const evicted = applyAction({ ...s, cash: 10, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(evicted.home, null);
	assert.equal(evicted.cash, 10 + 640 - 320);
	assert.ok(evicted.journal.some((j) => j.text.includes('押金扣了 $320')));
});

test('搬进自己的房子：租房押金退回；自有房没有押金', () => {
	let s = rentHome(make({ cash: 200000, clock: at(9) }), WA, 'room').state;
	s = buyProperty(s, WA, 'perth-apartment', false).state;
	const before = s.cash;
	const r = moveIntoProperty(s, 'perth-apartment');
	assert.ok(r.ok);
	assert.equal(r.state.cash, before + 320);
	assert.equal(r.state.home!.bond, undefined);
	assert.match(r.msg, /押金退回 \$320/);
});

test('存档清洗：押金钳到这种房型的上限，自有房去掉押金，旧存档按 0', () => {
	const base = rentHome(make({ cash: 1000, clock: at(9) }), WA, 'room').state;
	const clean = (h: unknown, extra: object = {}) => sanitizeState({ ...base, ...extra, home: h }, locs)!.home;
	assert.equal(clean({ ...base.home, bond: 320 })!.bond, 320);
	assert.equal(clean({ ...base.home, bond: 99999 })!.bond, 320, '不超过 2 周房租');
	assert.equal(clean({ ...base.home, bond: -5 })!.bond, undefined);
	assert.equal(clean({ ...base.home, bond: 'x' })!.bond, undefined);
	assert.equal(clean({ type: 'room', loc: 'perth', furniture: {} })!.bond, undefined, '旧存档没有押金');
	assert.equal(clean({ type: 'campground', loc: 'perth', furniture: {}, bond: 50 })!.bond, undefined, '营地免押金');
	const owned = { properties: [{ id: 'perth-apartment', loan: 0, rented: false, missed: 0 }] };
	const h = clean({ type: 'flat', loc: 'perth', furniture: {}, owned: 'perth-apartment', bond: 640 }, owned)!;
	assert.equal(h.owned, 'perth-apartment');
	assert.equal(h.bond, undefined, '自有房没有押金');
});

// ---------- 天气与路况 ----------
/** 找到某地点第一个指定天气的游戏日 */
function dayWith(loc: string, wx: string, from = 0): number {
	for (let d = from; d < from + 2000; d++) if (weatherOn(loc, d).id === wx) return d;
	throw new Error(`${loc} 找不到 ${wx}`);
}

test('天气数据：只有小雨、风暴影响陆路，倍数不小于 1', () => {
	for (const w of WEATHERS) {
		if (!w.road) continue;
		assert.ok(w.road.mult >= 1 && w.road.trackMult >= 1, w.id);
	}
	assert.deepEqual(WEATHERS.filter((w) => w.road).map((w) => w.id), ['rain', 'storm']);
	assert.ok(WEATHERS.find((w) => w.id === 'storm')!.road!.trackClosed);
});

test('风暴天：出发地的土路封闭、渡轮停航；晴天照常', () => {
	const storm = dayWith('exmouth', 'storm');
	const sunny = dayWith('exmouth', 'sunny');
	const s = (day: number) => make({ loc: 'exmouth', vehicle: '4wd', cash: 5000, clock: at(9, day) });
	const track = (day: number) => travelOptions(s(day), WA).find((o) => o.to === 'karijini')!;
	assert.equal(track(sunny).available, true);
	assert.equal(track(storm).available, false);
	assert.match(track(storm).reason!, /风暴.*土路封闭/);
	assert.equal(travel(s(storm), WA, 'karijini', 'track').ok, false, '动作本身也拦');
	const fs = dayWith('fremantle', 'storm');
	const ferry = (day: number) => travelOptions(make({ loc: 'fremantle', cash: 5000, clock: at(9, day) }), WA).find((o) => o.mode === 'ferry')!;
	assert.equal(ferry(fs).available, false);
	assert.match(ferry(fs).reason!, /渡轮停航/);
	assert.equal(ferry(dayWith('fremantle', 'sunny')).available, true);
});

test('小雨、风暴天公路更慢（自驾和巴士），钱不变；航班不受影响', () => {
	const loc = 'perth';
	const opt = (day: number, vehicle: string, to: string, mode = 'road') =>
		travelOptions(make({ loc, vehicle, cash: 5000, clock: at(9, day) }), WA).find((o) => o.to === to && o.mode === mode)!;
	const sunny = dayWith(loc, 'sunny'), rain = dayWith(loc, 'rain'), storm = dayWith(loc, 'storm');
	assert.equal(dayOf(at(9, rain)), rain);
	for (const v of ['car', 'none']) {
		const a = opt(sunny, v, 'kalgoorlie'), b = opt(rain, v, 'kalgoorlie'), c = opt(storm, v, 'kalgoorlie');
		assert.ok(b.minutes > a.minutes && c.minutes > b.minutes, `${v}：${a.minutes} < ${b.minutes} < ${c.minutes}`);
		// 天气不改车费；不同日子油价不同（世界事件），按油价系数折回去比
		const kind = v === 'none' ? 'bus' : 'road';
		assert.ok(Math.abs(b.cost - (a.cost / fuelMult(sunny, kind)) * fuelMult(rain, kind)) <= 1, `${v} 车费只随油价变：${a.cost} → ${b.cost}`);
		const drive = v === 'none' ? a.minutes - 20 : a.minutes;
		assert.ok(Math.abs((v === 'none' ? b.minutes - 20 : b.minutes) - drive * 1.1) <= 1, `${v} 小雨 ×1.1`);
		assert.ok(Math.abs((v === 'none' ? c.minutes - 20 : c.minutes) - drive * 1.25) <= 1, `${v} 风暴 ×1.25`);
	}
	assert.equal(opt(storm, 'car', 'kalgoorlie', 'air').minutes, opt(sunny, 'car', 'kalgoorlie', 'air').minutes, '航班不受影响');
});

test('小雨天土路慢 30%', () => {
	const rain = dayWith('exmouth', 'rain'), sunny = dayWith('exmouth', 'sunny');
	const m = (day: number) => travelOptions(make({ loc: 'exmouth', vehicle: '4wd', cash: 5000, clock: at(9, day) }), WA).find((o) => o.to === 'karijini')!.minutes;
	assert.ok(Math.abs(m(rain) - m(sunny) * 1.3) <= 1, `${m(sunny)} → ${m(rain)}`);
});

test('页面：显示车辆残值的地方都带上里程（不带就是新车价，和净资产对不上）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	const calls = [...src.matchAll(/resaleValue\(([^()]*)\)/g)].map((m) => m[1]);
	assert.ok(calls.length >= 1, '页面里找不到 resaleValue 调用');
	assert.deepEqual(calls.filter((a) => !a.includes(',')), [], '这些调用没传里程');
});
