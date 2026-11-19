// 离开地图的旅行（第 43 批）：跨州、回国探亲的票价、结算、回来的事件，以及州内自驾游规划。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { resolveEvent, shopAt } from '../../src/game/core/engine.ts';
import { awayPreview, fareDemand, packingCost, packingList, planRoadTrip, takeTrip, tripFare, tripOptions } from '../../src/game/core/trips.ts';
import { dateOf, SEASON_DAYS, SEASONS } from '../../src/game/core/time.ts';
import { AWAY_DESTS, DOMESTIC_PEAK_RATIO, FARE_SEASONS, JOB_LEAVE_DAYS, PACKING, RETURN_EVENTS, RETURN_NEEDS, ROAD_TRIP_DRIVE_MIN_PER_DAY, TRIP_DAY_MIN, TRIP_DAYS } from '../../src/game/data/trips.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { areaOf } from '../../src/game/data/areas-base.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const W = WORLD;
const mk = (over: Partial<PlayerState> = {}, origin = 'student'): PlayerState => ({
	...createCharacter({ id: 'trip-player', name: '旅', avatar: '🧑', origin, region: 'wa', spawn: 'perth', seed: 7 }),
	cash: 5000,
	...over,
});
/** 某季某天 10:00 的时钟（第 1 年） */
const at = (season: 'spring' | 'summer' | 'autumn' | 'winter', day: number) => (SEASONS.findIndex((s) => s.id === season) * SEASON_DAYS + day - 1) * 1440 + 600;
const OFF = at('autumn', 10); // 不在任何票价季节里
const dest = (id: string) => AWAY_DESTS.find((d) => d.id === id)!;
const fareOf = (id: string, from: string) => dest(id).fares.find((f) => f.from === from)!;

test('数据：出处、票价区间、出发机场、天数、纪念品、季节都合法', () => {
	assert.equal(new Set(AWAY_DESTS.map((d) => d.id)).size, AWAY_DESTS.length);
	for (const d of AWAY_DESTS) {
		assert.ok(d.fares.length, d.id);
		for (const f of d.fares) {
			assert.ok(f.source.length > 5, `${d.id} ${f.from} 没写出处`);
			assert.ok(f.low > 0 && f.low <= f.high, `${d.id} ${f.from} 票价区间`);
			const loc = W.locations.find((l) => l.id === f.from);
			assert.ok(loc?.tags.includes('airport'), `${f.from} 不是机场`);
			if (f.note === 'derived') assert.equal(f.high, Math.round(f.low * DOMESTIC_PEAK_RATIO), `${d.id} 推算上限`);
		}
		for (const n of d.days) assert.ok(Number.isInteger(n) && n >= TRIP_DAYS.min && n <= TRIP_DAYS.max, `${d.id} 天数 ${n}`);
		const item = ITEMS.find((i) => i.id === d.souvenir.item);
		assert.ok(item, `${d.id} 纪念品不存在`);
		assert.deepEqual(item!.shop, {}, '纪念品商店不卖');
		assert.ok(d.souvenir.n >= 1 && d.souvenir.n <= item!.max);
	}
	for (const s of FARE_SEASONS) {
		assert.ok(s.day >= 1 && s.day + s.days - 1 <= SEASON_DAYS, `${s.id} 越过季末`);
		for (const v of Object.values(s.demand)) assert.ok(v >= 0 && v <= 1, s.id);
	}
	for (const r of RETURN_EVENTS) {
		const ev = EVENTS.find((e) => e.id === r.id);
		assert.ok(ev, `${r.id} 事件不存在`);
		assert.equal(ev!.weight, 0, `${r.id} 不能进普通抽取`);
		assert.ok(r.chance > 0 && r.chance <= 1);
	}
	for (const p of PACKING) for (const id of p.items) assert.ok(ITEMS.some((i) => i.id === id), `${p.id} 的 ${id} 不存在`);
});

test('纪念品在任何地点的商店里都买不到', () => {
	for (const loc of W.locations) {
		const s = mk({ loc: loc.id });
		assert.ok(!shopAt(s, W).some((e) => e.item.id.startsWith('souvenir-')), loc.id);
	}
});

test('票价：淡季是下限、旺季推到上限；春节只推回国；精打细算打折', () => {
	const s = mk({ clock: OFF });
	assert.equal(fareDemand(OFF, 'home'), 0);
	assert.equal(tripFare(s, fareOf('home-cn', 'perth'), 'home'), 773);
	assert.equal(tripFare(s, fareOf('melbourne', 'perth'), 'interstate'), 658);
	const xmas = mk({ clock: at('summer', 3) });
	assert.equal(dateOf(xmas.clock).season, 'summer');
	assert.equal(tripFare(xmas, fareOf('melbourne', 'perth'), 'interstate'), fareOf('melbourne', 'perth').high);
	const cny = mk({ clock: at('summer', 22) });
	assert.equal(tripFare(cny, fareOf('home-cn', 'perth'), 'home'), 1423);
	assert.ok(tripFare(cny, fareOf('melbourne', 'perth'), 'interstate') < fareOf('melbourne', 'perth').high);
	// 重叠段取最大：夏 16–18 天同时在圣诞和春节里
	assert.equal(fareDemand(at('summer', 17), 'interstate'), 1);
	assert.equal(fareDemand(at('summer', 17), 'home'), 1);
	const frugal = mk({ clock: OFF, traits: ['frugal'] });
	assert.equal(tripFare(frugal, fareOf('home-cn', 'perth'), 'home'), Math.round(773 * 0.85));
});

test('选项：只在珀斯、阿德莱德机场出现；事件、上班、现金不够时挡住', () => {
	assert.deepEqual(tripOptions(mk({ loc: 'fremantle' })), []);
	assert.deepEqual(tripOptions(mk({ loc: 'kalgoorlie' })), [], '有机场但没有这些航线');
	const perth = tripOptions(mk({ clock: OFF }));
	assert.deepEqual(perth.map((o) => o.dest.id).sort(), ['brisbane', 'home-cn', 'melbourne', 'sydney']);
	assert.ok(perth.every((o) => !o.blocked));
	const adl = tripOptions(mk({ loc: 'adelaide', clock: OFF }));
	assert.deepEqual(adl.map((o) => o.dest.id).sort(), ['home-cn', 'melbourne', 'sydney']);
	assert.equal(adl.find((o) => o.dest.id === 'home-cn')!.fare.note, 'verify');
	assert.match(tripOptions(mk({ pending: { eventId: 'flies' } }))[0].blocked!, /事件/);
	assert.match(tripOptions(mk({ clockIn: { venue: 'x', at: 1 } }))[0].blocked!, /上班/);
	const poor = tripOptions(mk({ clock: OFF, cash: 700 }));
	assert.ok(poor.find((o) => o.dest.id === 'home-cn')!.blocked, '773 买不起');
	assert.ok(!poor.find((o) => o.dest.id === 'sydney')!.blocked, '598 + 补买买得起');
	const tight = tripOptions(mk({ clock: OFF, cash: 650, inventory: {} })).find((o) => o.dest.id === 'sydney')!;
	assert.equal(tight.price + tight.packing, 598 + 85);
	assert.ok(tight.blocked, '机票够、加上补买行李就不够');
});

test('行李清单：带了对应物品就不用补买，补买费乘特质倍率', () => {
	const bare = mk({ inventory: {} });
	assert.ok(packingList(bare, 'interstate').every((p) => !p.packed));
	assert.equal(packingCost(bare, 'interstate'), 25 + 20 + 30 + 10);
	assert.equal(packingCost(bare, 'home'), 20 + 30 + 10, '回国不用带雨具');
	const packed = mk({ inventory: { umbrella: 1, sunhat: 1, firstaid: 1, snack: 2 } });
	assert.equal(packingCost(packed, 'interstate'), 0);
	assert.equal(packingCost(mk({ inventory: {}, traits: ['frugal'] }), 'home'), Math.round(60 * 0.85));
});

test('出发：扣钱、时钟走整天数、需求重置、纪念品和心情；不改入参', () => {
	const s = mk({ clock: OFF, vehicle: 'none', nextWeek: 999, inventory: {}, needs: { hunger: 5, energy: 5, hygiene: 5, fun: 5, social: 5 } });
	const before = structuredClone(s);
	const r = takeTrip(s, W, 'melbourne', 5);
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '入参没被改');
	assert.equal(r.state.clock, OFF + 5 * TRIP_DAY_MIN);
	assert.equal(r.state.loc, 'perth', '回到出发的机场');
	assert.deepEqual(r.state.needs, RETURN_NEEDS.interstate);
	assert.equal(r.state.health, s.health, '离开期间不饿晕');
	assert.equal(r.state.inventory['souvenir-mel'], 1);
	const ids = r.state.moodlets.map((m) => m.id);
	assert.ok(ids.includes('trip-glow'));
	assert.ok(ids.includes('jetlag'), '珀斯到墨尔本差 2 小时');
	assert.equal(s.cash - r.state.cash, 658 + 85, '机票 + 补买四类行李；期间没有周结算');
});

test('回国探亲：珀斯和广州同时区不倒时差；带回家乡零食；可能抽到入境申报', () => {
	let hit = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const r = takeTrip(mk({ clock: OFF, seed, vehicle: 'none', inventory: { firstaid: 1, sunscreen: 1, snack: 1 } }), W, 'home-cn', 7);
		assert.ok(r.ok, r.msg);
		assert.deepEqual(r.state.needs, RETURN_NEEDS.home);
		assert.ok(r.state.moodlets.some((m) => m.id === 'family-time'));
		assert.ok(!r.state.moodlets.some((m) => m.id === 'jetlag'));
		assert.equal(r.state.inventory['souvenir-home'], 2);
		const ev = r.state.pending?.eventId;
		if (ev) assert.ok(['trip-biosecurity', 'trip-jetlag-night'].includes(ev), `没租房不会有信箱事件：${ev}`);
		if (ev === 'trip-biosecurity') hit++;
	}
	assert.ok(hit > 15 && hit < 40, `入境申报大约七成：${hit}/40`);
	// 从阿德莱德回国时差 1.5 小时，也不倒时差
	const adl = takeTrip(mk({ loc: 'adelaide', clock: OFF }), W, 'home-cn', 7);
	assert.ok(adl.ok && !adl.state.moodlets.some((m) => m.id === 'jetlag'));
});

test('入境申报：如实申报只少一份零食；不申报被抓扣更多', () => {
	const base = mk({ clock: OFF, vehicle: 'none', nextWeek: 999, inventory: { 'souvenir-home': 2 }, pending: { eventId: 'trip-biosecurity' } });
	const honest = resolveEvent(base, W, 0);
	assert.ok(honest.ok);
	assert.equal(honest.state.inventory['souvenir-home'], 1);
	assert.equal(honest.state.cash, base.cash);
	let caught = 0;
	for (let seed = 1; seed <= 30; seed++) {
		const r = resolveEvent({ ...base, seed }, W, 1);
		if (!r.state.inventory['souvenir-home']) {
			caught++;
			assert.ok(r.state.heat > base.heat && r.state.cash < base.cash);
		}
	}
	assert.ok(caught > 0, '街头分低的人会被抓到');
});

test('离开期间：房租照常扣、预估的结算次数和实际一致；付不起会被收房', () => {
	for (const days of [3, 5, 7]) {
		const s = mk({ clock: OFF, vehicle: 'none', inventory: {}, home: { type: 'room', loc: 'perth', furniture: {} }, nextWeek: Math.floor(OFF / 1440) + 2 });
		const opt = tripOptions(s).find((o) => o.dest.id === 'sydney')!;
		const pv = awayPreview(s, days, opt.price + opt.packing);
		const r = takeTrip(s, W, 'sydney', days);
		assert.ok(r.ok);
		const paid = r.state.journal.filter((j) => j.text.includes('房租 $160')).length;
		assert.equal(paid, pv.settlements, `${days} 天`);
		assert.equal(pv.weeklyDue, 160 * pv.settlements);
		assert.equal(s.cash - r.state.cash, opt.price + opt.packing + pv.weeklyDue);
	}
	const broke = mk({ clock: OFF, cash: 700, vehicle: 'none', inventory: { umbrella: 1, sunhat: 1, firstaid: 1, snack: 1 }, home: { type: 'room', loc: 'perth', furniture: {} }, nextWeek: Math.floor(OFF / 1440) + 1 });
	const pv = awayPreview(broke, 7, 598);
	assert.ok(pv.short, '预估里提示现金不够');
	const r = takeTrip(broke, W, 'sydney', 7);
	assert.ok(r.ok);
	assert.equal(r.state.home, null, '房租付不起被收房');
});

test('工作：请假不超过上限保留，超过就丢', () => {
	const job = { career: 'barista', loc: 'perth', level: 1, shifts: 3, good: 2, lastDay: 1 };
	const kept = takeTrip(mk({ clock: OFF, job }), W, 'melbourne', 7);
	assert.ok(kept.ok);
	assert.deepEqual(kept.state.job, job);
	assert.ok(7 <= JOB_LEAVE_DAYS);
	assert.ok(!awayPreview(mk({ job }), 7, 0).loseJob);
	assert.ok(awayPreview(mk({ job }), 14, 0).loseJob);
	assert.ok(!awayPreview(mk({ job }), JOB_LEAVE_DAYS, 0).loseJob, '正好上限不丢');
	assert.ok(awayPreview(mk({ job }), JOB_LEAVE_DAYS + 1, 0).loseJob);
	const lost = takeTrip(mk({ clock: OFF, job }), W, 'home-cn', 14);
	assert.ok(lost.ok);
	assert.equal(lost.state.job, null);
	assert.match(lost.msg, /工作已经没了/);
	assert.ok(lost.state.journal.some((j) => j.text.includes('工作没了')));
});

test('出发失败：天数不在列表、不在机场、有事件、现金不够', () => {
	assert.match(takeTrip(mk(), W, 'melbourne', 4).msg, /天数/);
	assert.match(takeTrip(mk(), W, 'melbourne', 30).msg, /天数/);
	assert.match(takeTrip(mk(), W, 'atlantis', 5).msg, /航线/);
	assert.match(takeTrip(mk({ loc: 'fremantle' }), W, 'melbourne', 5).msg, /机场/);
	assert.match(takeTrip(mk({ loc: 'adelaide' }), W, 'brisbane', 5).msg, /机场/, '阿德莱德没有布里斯班的数据');
	assert.match(takeTrip(mk({ pending: { eventId: 'flies' } }), W, 'melbourne', 5).msg, /事件/);
	assert.match(takeTrip(mk({ cash: 100 }), W, 'melbourne', 5).msg, /现金/);
	for (const r of [takeTrip(mk({ cash: 100 }), W, 'melbourne', 5), takeTrip(mk(), W, 'melbourne', 4)]) assert.equal(r.ok, false);
});

test('动作协议：trip 校验形状并走 applyAction', () => {
	assert.deepEqual(parseAction({ t: 'trip', dest: 'home-cn', days: 7 }), { t: 'trip', dest: 'home-cn', days: 7 });
	for (const bad of [{ t: 'trip', dest: 'home-cn', days: 7.5 }, { t: 'trip', dest: 'home-cn', days: 0 }, { t: 'trip', dest: 'home-cn', days: 61 }, { t: 'trip', dest: 'HOME', days: 7 }, { t: 'trip', days: 7 }, { t: 'trip', dest: 'home-cn', days: '7' }]) {
		assert.equal(parseAction(bad), null, JSON.stringify(bad));
	}
	const s = mk({ clock: OFF });
	const r = applyAction(s, W, { t: 'trip', dest: 'sydney', days: 3 });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rev, s.rev + 1);
	assert.ok(r.state.yday && r.state.yday.days >= 3, '跨日回顾记下了离开的几天');
});

test('自驾游规划：不出州、不坐飞机、不超时长、先去没去过的；不改入参', () => {
	const s = mk({ clock: OFF, visited: { perth: 1, fremantle: 3 } });
	const before = structuredClone(s);
	const plan = planRoadTrip(s, W, 3);
	assert.deepEqual(s, before);
	assert.ok(plan.stops.length >= 2, `至少两站：${plan.stops.length}`);
	assert.ok(plan.minutes <= 3 * ROAD_TRIP_DRIVE_MIN_PER_DAY);
	assert.equal(plan.minutes, plan.stops.reduce((a, b) => a + b.minutes, 0));
	assert.equal(plan.km, plan.stops.reduce((a, b) => a + b.km, 0));
	assert.ok(plan.stops.every((st) => st.mode !== 'air' && areaOf(st.to)?.id === 'wa'));
	assert.equal(new Set(plan.stops.map((st) => st.to)).size, plan.stops.length, '不重复');
	assert.ok(plan.stops[0].to !== 'fremantle', '弗里曼特尔去过，先去别处');
	assert.deepEqual(planRoadTrip(s, W, 0).stops, []);
	// 只剩飞机能到的地方没去过时也不坐飞机
	const flyOnly = mk({ clock: OFF, visited: Object.fromEntries(W.locations.filter((l) => l.id !== 'broome').map((l) => [l.id, 1])) });
	assert.ok(planRoadTrip(flyOnly, W, 3).stops.every((st) => st.mode !== 'air'));
	// 跨州：卡尔古利出发、西澳都去过了，允许跨州时第一站就是没去过的锡杜纳（公路）
	const waAll = Object.fromEntries(W.locations.filter((l) => areaOf(l.id)?.id === 'wa').map((l) => [l.id, 1]));
	const k = mk({ loc: 'kalgoorlie', clock: OFF, vehicle: 'car', visited: waAll });
	assert.ok(!planRoadTrip(k, W, 5).stops.some((st) => areaOf(st.to)?.id === 'sa'));
	assert.equal(planRoadTrip(k, W, 5, true).stops[0]?.to, 'ceduna');
});
