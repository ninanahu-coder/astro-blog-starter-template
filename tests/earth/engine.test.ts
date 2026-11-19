// 运行：npm test（Node ≥ 22.18 原生执行 TypeScript）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { choiceLabel, netWorth } from '../../src/game/core/engine.ts';
import { boardEntry, rankBoard } from '../../src/game/core/board.ts';
import { VENUE_EVENTS } from '../../src/game/data/venue-events.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	activitiesAt, getPendingEvent, gpsCheckIn, performActivity, resolveEvent, travel, travelOptions,
} from '../../src/game/core/engine.ts';
import { haversineKm, locateInRegion } from '../../src/game/core/geo.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { sleepQuality } from '../../src/game/core/sleep.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { FULL_AREAS, WA, WORLD } from '../../src/game/data/wa.ts';

/** gps 动作要服务端时间（没有就当离线拒绝） */
const GPS_NOW = 1_800_000_000_000;

const fresh = (origin = 'backpacker', seed = 42) =>
	createCharacter({ id: 'test-player', name: '测试', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed });

test('区域数据自洽', () => {
	// 第 42 轮起世界由几个区域组成：地点 id 全世界唯一，每个区域的地点在它自己的范围里
	const ids = new Set(WORLD.locations.map((l) => l.id));
	assert.equal(ids.size, WORLD.locations.length, '地点 id 唯一');
	for (const r of WORLD.routes) assert.ok(ids.has(r.a) && ids.has(r.b), `路线端点存在: ${r.a}-${r.b}`);
	for (const p of WORLD.pois) assert.ok(ids.has(p.loc), `POI 所属地点存在: ${p.id}`);
	for (const area of FULL_AREAS) for (const l of area.locations) {
		const b = area.bounds;
		assert.ok(l.lon > b.minLon && l.lon < b.maxLon && l.lat > b.minLat && l.lat < b.maxLat, l.id);
		assert.ok(WORLD.routes.some((r) => r.a === l.id || r.b === l.id), `${l.id} 至少有一条路线`);
	}
	for (const e of EVENTS) for (const id of e.locs ?? []) assert.ok(ids.has(id), `事件地点存在: ${e.id}`);
	assert.equal(new Set(EVENTS.map((e) => e.id)).size, EVENTS.length);
	assert.equal(new Set(ACTIVITIES.map((a) => a.id)).size, ACTIVITIES.length);
});

test('距离计算：珀斯—布鲁姆约 1680km', () => {
	const km = haversineKm(-31.95, 115.86, -17.96, 122.24);
	assert.ok(km > 1600 && km < 1750, String(km));
});

test('出行扣钱、耗时并到达；首次到访签名事件必出', () => {
	const s0 = fresh();
	const r1 = travel(s0, WA, 'fremantle', 'road');
	assert.ok(r1.ok);
	assert.equal(r1.state.loc, 'fremantle');
	assert.ok(r1.state.cash < s0.cash && r1.state.clock > s0.clock);
	assert.equal(s0.loc, 'perth', '不修改入参');
	let s = r1.state;
	if (s.pending) s = resolveEvent(s, WA, 0).state;
	const r2 = travel(s, WA, 'rottnest', 'ferry');
	assert.ok(r2.ok);
	assert.equal(getPendingEvent(r2.state)?.id, 'quokka-selfie');
	assert.equal(travel(r2.state, WA, 'fremantle', 'ferry').ok, false, '事件未处理不能走');
	const r3 = resolveEvent(r2.state, WA, 0);
	assert.ok(r3.ok && r3.state.pending === null && r3.state.seen.includes('quokka-selfie'));
});

test('越野土路需要四驱；现金不足不能出行', () => {
	let s = { ...fresh(), loc: 'exmouth', cash: 5000 };
	const opt = travelOptions(s, WA).find((o) => o.to === 'karijini')!;
	assert.equal(opt.available, false);
	s = { ...s, vehicle: '4wd' };
	assert.equal(travelOptions(s, WA).find((o) => o.to === 'karijini')!.available, true);
	assert.equal(travel({ ...fresh(), cash: 0 }, WA, 'kalgoorlie', 'air').ok, false);
	assert.equal(travel(fresh(), WA, 'broome', 'road').ok, false, '无直达路线');
});

test('互动：条件校验与效果', () => {
	const s = fresh();
	assert.equal(performActivity(s, WA, 'work-mine').ok, false, '珀斯没有矿场');
	assert.equal(performActivity(s, WA, 'buy-car').ok, false, '钱不够');
	const r = performActivity({ ...s, needs: { ...s.needs, hunger: 20 } }, WA, 'eat');
	assert.ok(r.ok && r.state.needs.hunger > 60 && r.state.cash === s.cash - 18);
	// 第 43 批：一觉恢复的精力乘睡眠质量（旅馆的床、城里的噪音、几点睡）；精力 5 睡 8 小时先衰减到 0，醒来 = 100 × 质量
	const night = { ...s, clock: 22 * 60, needs: { ...s.needs, energy: 5 } };
	const slept = performActivity(night, WA, 'sleep-motel');
	assert.equal(slept.state.needs.energy, Math.round(100 * sleepQuality(night, WA, { bed: 'motel' }).q * 10) / 10);
	assert.ok(slept.state.needs.energy >= 85, '夜里住旅馆睡得不差');
	assert.ok(activitiesAt(s, WA).some((a) => a.act.id === 'gym'));
});

test('饿到晕倒会被送医而不是卡死', () => {
	let s = { ...fresh(), health: 3, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } };
	s = performActivity(s, WA, 'sleep-camp').state;
	s = performActivity({ ...s, health: 1, needs: { ...s.needs, hunger: 0 } }, WA, 'lay-low').state;
	assert.equal(s.loc, WA.hospital);
	assert.ok(s.health >= 50);
});

test('GPS 打卡：真实到达 + POI 奖励，不可重复领取', () => {
	assert.equal(locateInRegion(WA, -32.055, 115.7536)?.id, 'fremantle');
	assert.equal(locateInRegion(WA, -25.0, 125.0), null);
	const r = gpsCheckIn(fresh(), WA, -32.055, 115.7536, 10, GPS_NOW);
	assert.ok(r.ok);
	assert.equal(r.state.loc, 'fremantle');
	assert.ok(r.state.checkins.includes('seed-freo-prison'));
	const again = gpsCheckIn({ ...r.state, pending: null }, WA, -32.055, 115.7536, 10, GPS_NOW + 60_000);
	assert.equal(again.ok, false);
	assert.equal(gpsCheckIn(fresh(), WA, 0, 0, 10, GPS_NOW).ok, false);
});

test('相同 seed 结果确定', () => {
	const run = () => {
		let s = fresh('student', 7);
		for (const [to, mode] of [['bunbury', 'road'], ['margaret-river', 'road'], ['albany', 'road']] as const) {
			s = travel(s, WA, to, mode).state;
			if (s.pending) s = resolveEvent(s, WA, 0).state;
		}
		return s;
	};
	assert.deepEqual(run(), run());
});

test('存档校验：拒绝畸形数据并钳制数值', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	assert.equal(sanitizeState(null), null);
	assert.equal(sanitizeState({ v: 2 }), null);
	assert.equal(sanitizeState({ ...fresh(), loc: 'atlantis' }, locs), null);
	const dirty = { ...fresh(), cash: 1e99, health: -5, name: '<script>x', skills: { driving: 9999 }, heat: NaN };
	const clean = sanitizeState(dirty, locs)!;
	assert.equal(clean.cash, 1e9);
	assert.equal(clean.health, 0);
	assert.equal(clean.skills.driving, 100);
	assert.equal(clean.heat, 0);
	assert.ok(!clean.name.includes('<'));
	assert.deepEqual(sanitizeState(fresh(), locs), fresh());
});

test('身无分文不会卡死：每个地点都有不要钱、不挑时间、不要能力的收入', () => {
	for (const l of WA.locations) {
		const s = { ...fresh(), loc: l.id, cash: 0, vehicle: 'none' };
		const earn = activitiesAt(s, WA).filter(({ act, blocked }) => (act.fx.cash ?? 0) > 0 && !act.requires && !act.hours && !blocked);
		assert.ok(earn.length, `${l.id} 没钱时没有任何收入来源`);
	}
	// 波浪岩：没车没钱时所有路线都走不了，也没有职业，只能靠这个凑路费
	const stuck = { ...fresh(), loc: 'wave-rock', cash: 0, vehicle: 'none', visited: { 'wave-rock': 1 } };
	assert.ok(travelOptions(stuck, WA).every((o) => !o.available));
	const r = performActivity(stuck, WA, 'recycle');
	assert.ok(r.ok && r.state.cash > 0, r.msg);
	// 收入垫底：不能比任何别的挣钱活动划算
	const perHour = (id: string) => { const a = ACTIVITIES.find((x) => x.id === id)!; return (a.fx.cash ?? 0) / (a.minutes / 60); };
	for (const a of ACTIVITIES) if ((a.fx.cash ?? 0) > 0 && a.id !== 'recycle') assert.ok(perHour(a.id) > perHour('recycle') * 2, a.id);
});

test('苍蝇大军：买防蝇网帽真的拿到网帽', () => {
	const s = { ...createCharacter({ id: 'fly-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 }), cash: 100, pending: { eventId: 'flies' } };
	const r = applyAction(s, WA, { t: 'event', choice: 0 });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.cash, 88);
	assert.equal(r.state.inventory.flynet, 1);
	assert.equal(r.state.pending, null);
});

test('要先付钱的事件选项，显示给玩家的文字一律带金额且只出现一次', () => {
	let n = 0;
	for (const ev of [...EVENTS, ...VENUE_EVENTS]) {
		for (const c of ev.choices) {
			const shown = choiceLabel(c);
			if (!c.cost) { assert.equal(shown, c.label); continue; }
			n++;
			assert.equal(shown.split(`$${c.cost}`).length - 1, 1, `${ev.id}：${shown}`);
		}
	}
	assert.ok(n >= 11, `检查了 ${n} 个付费选项`);
	assert.equal(choiceLabel({ label: '叫道路救援', cost: 220 }), '叫道路救援（$220）');
});

test('受伤直接晕倒住院跨过结算日也要结算', () => {
	const base = createCharacter({ id: 'hurt-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	const ev = EVENTS.find((e) => e.choices.some((c) => !c.cost && (c.fail?.fx.health ?? 0) <= -5))!;
	const i = ev.choices.findIndex((c) => !c.cost && (c.fail?.fx.health ?? 0) <= -5);
	// 第 6 天 23:30、只剩一丝血、租着房却身无分文；能力清零让检定必然失败
	const s = {
		...base, cash: 0, health: 0.5, clock: 6 * 1440 + 23 * 60 + 30, nextWeek: 7, pending: { eventId: ev.id },
		skills: Object.fromEntries(Object.keys(base.skills).map((k) => [k, 0])) as typeof base.skills,
		home: { type: 'room', loc: base.loc, furniture: {} },
	};
	let hit = false;
	for (let seed = 1; seed <= 40 && !hit; seed++) {
		const r = applyAction({ ...s, seed }, WA, { t: 'event', choice: i });
		if (!r.collapsed) continue;
		hit = true;
		assert.ok(Math.floor(r.state.clock / 1440) >= 7);
		assert.ok(r.state.nextWeek > Math.floor(r.state.clock / 1440), '住院后已补结算');
		assert.equal(r.state.home, null, '付不起房租，房子已被收回');
	}
	assert.ok(hit, `${ev.id} 应能造成受伤晕倒`);
});

test('存档校验：待处理事件不存在时清掉，不然所有动作都被挡住又没有界面能处理', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'pend-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	const clean = (pending: unknown) => sanitizeState({ ...base, pending } as never, locs)!;
	assert.deepEqual(clean({ eventId: EVENTS[0].id }).pending, { eventId: EVENTS[0].id }, '存在的事件保留');
	assert.deepEqual(clean({ eventId: VENUE_EVENTS[0].id }).pending, { eventId: VENUE_EVENTS[0].id }, '到店事件也保留');
	assert.equal(clean({ eventId: 'removed-event' }).pending, null);
	assert.equal(clean({ eventId: 7 }).pending, null);
	assert.equal(clean({}).pending, null);
	// 清掉之后动作恢复正常
	const r = applyAction(clean({ eventId: 'removed-event' }), WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok, r.msg);
});

test('存档校验：当前所在地不存在时挪到安全落点，而不是判整份存档损坏', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'loc-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	const lost = { ...base, loc: 'removed-loc', cash: 777, visited: { 'removed-loc': 3, fremantle: 2 } };
	assert.equal(sanitizeState(lost, locs), null, '没给落点时仍然判损坏（客户端本地存档的旧行为）');
	assert.equal(sanitizeState(lost, locs, { fallbackLoc: 'nowhere' }), null, '落点本身不存在也不行');
	const moved = sanitizeState(lost, locs, { fallbackLoc: WA.spawn })!;
	assert.equal(moved.loc, WA.spawn);
	assert.equal(moved.cash, 777, '其余进度保留');
	assert.deepEqual(Object.keys(moved.visited).sort(), ['fremantle', WA.spawn].sort());
	assert.equal(lost.loc, 'removed-loc', '不修改入参');
	assert.deepEqual(sanitizeState(moved, locs, { fallbackLoc: WA.spawn }), moved, '再校验一次不变');
	assert.ok(applyAction(moved, WA, { t: 'activity', id: 'rest' }).ok);
});

test('存档校验：晚于服务端时间的定位、冷却、上班卡和每日奖励日期会被清掉', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'time-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	const now = Date.UTC(2026, 10, 15, 4);
	const today = Math.floor((now + 8 * 3_600_000) / 86_400_000);
	const far = 1e15;
	const bad = {
		...base, fix: { lat: -31.95, lon: 115.86, at: far }, venueCd: { meal: far, train: now - 1000 }, venueEvAt: far,
		clockIn: { venue: 'some-cafe', at: far }, daily: { day: 9_000_000, streak: 5 },
	};
	const clean = sanitizeState(bad, locs, { now })!;
	assert.equal(clean.fix, null);
	assert.deepEqual(clean.venueCd, { train: now - 1000 }, '未来的冷却清掉，正常的保留');
	assert.equal(clean.venueEvAt, 0);
	assert.equal(clean.clockIn, null);
	assert.deepEqual(clean.daily, { day: today, streak: 0 }, '按今天已领处理，明天能正常领');
	// 正常的时间不受影响（含一分钟内的时钟误差）
	const ok = { ...base, fix: { lat: -31.95, lon: 115.86, at: now + 30_000 }, clockIn: { venue: 'some-cafe', at: now - 60_000 }, daily: { day: today, streak: 5 } };
	const kept = sanitizeState(ok, locs, { now })!;
	assert.equal(kept.fix?.at, now + 30_000);
	assert.equal(kept.clockIn?.at, now - 60_000);
	assert.deepEqual(kept.daily, { day: today, streak: 5 });
	// 不传 now（客户端）时不做这项检查
	assert.equal(sanitizeState(bad, locs)!.fix?.at, far);
});

test('动作结算的结果不越过存档校验的上限：校验一个刚结算完的状态不会改动它', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'caps-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	// 各项都顶在上限上，再做一个会挣钱、涨声望、花时间的动作
	const top = sanitizeState({ ...base, cash: 1e300, respect: 1e300, clock: 1e300, rev: 1e9 - 1, wishes: ['walk'], wishDay: 0 }, locs)!;
	assert.deepEqual([top.cash, top.respect, top.clock, top.rev], [1e9, 1e6, 1e9, 1e9 - 1]);
	const r = applyAction(top, WA, { t: 'activity', id: 'recycle' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual([r.state.cash, r.state.respect, r.state.clock], [1e9, 1e6, 1e9], '不超过上限');
	assert.equal(r.state.rev, 0, '版本号到上限回到 0');
	assert.deepEqual(sanitizeState(r.state, locs), r.state, '再校验一次不变');
	// 版本号超出范围的存档归零，而不是钳到上限
	for (const rev of [1e9, 1e300, -1, NaN, '7']) assert.equal(sanitizeState({ ...base, rev } as never, locs)!.rev, 0, String(rev));
	assert.equal(sanitizeState({ ...base, rev: 41.9 }, locs)!.rev, 41);
	// 区域字段只认存在的区域
	for (const region of ['constructor', '__proto__', 'mars', 7]) assert.equal(sanitizeState({ ...base, region } as never, locs)!.region, 'wa', String(region));
});

test('一次性奖励的记录被垃圾 id 塞满时，真实的记录不会被挤掉，奖励不能再领', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'once-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	const junk = Array.from({ length: 2000 }, (_, i) => `junk-${i}`);
	const poi = WA.pois.find((x) => x.loc === 'perth')!;
	const dirty = sanitizeState({ ...base, checkins: junk, seen: junk.slice(0, 500) }, locs)!;
	assert.deepEqual(dirty.checkins, [], '不存在的打卡点不保留');
	assert.deepEqual(dirty.seen, []);
	// 打卡一次，过一遍存档校验（服务端每次读取都会做），再打一次
	const first = applyAction({ ...base, checkins: junk }, WA, { t: 'gps', lat: poi.lat, lon: poi.lon, acc: 10 }, GPS_NOW);
	assert.ok(first.ok, first.msg);
	assert.ok(first.state.respect > base.respect, '第一次有奖励');
	const reloaded = sanitizeState(first.state, locs)!;
	assert.ok(reloaded.checkins.includes(poi.id), '真实的打卡记录还在');
	const second = applyAction(reloaded, WA, { t: 'gps', lat: poi.lat, lon: poi.lon, acc: 10 }, GPS_NOW);
	assert.equal(second.state.respect, reloaded.respect, '第二次没有奖励');
	// 一次性事件同理；重复的 id 去重
	const once = EVENTS.find((e) => e.once)!;
	const seen = sanitizeState({ ...base, seen: [...junk.slice(0, 500), once.id, once.id] }, locs)!.seen;
	assert.deepEqual(seen, [once.id]);
});

test('每日奖励和欠息也不越过存档校验的上限', async () => {
	const { claimDaily } = await import('../../src/game/core/daily.ts');
	const { PROPERTIES } = await import('../../src/game/data/properties.ts');
	const locs = new Set(WA.locations.map((l) => l.id));
	const base = createCharacter({ id: 'cap2-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 });
	// 现金、声望、版本号都顶在上限：领第 7 天的大礼（加现金也加声望）
	const top = sanitizeState({ ...base, cash: 1e300, respect: 1e300, rev: 1e9 - 1, daily: { day: 99, streak: 6 } }, locs)!;
	const claim = claimDaily(top, 100)!;
	assert.match(claim.msg, /满 7 天/);
	assert.deepEqual([claim.state.cash, claim.state.respect, claim.state.rev], [1e9, 1e6, 0]);
	assert.deepEqual(sanitizeState(claim.state, locs), claim.state, '再校验一次不变');
	// 贷款已等于房价（只有损坏的存档会这样），付不起这周的钱：欠的利息不再往上加
	const def = PROPERTIES[0];
	const owner = sanitizeState({ ...base, cash: 0, clock: 6 * 1440 + 23 * 60, nextWeek: 7, properties: [{ id: def.id, loan: 1e300, rented: false, missed: 0 }] }, locs)!;
	assert.equal(owner.properties[0].loan, def.price);
	const r = applyAction(owner, WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.properties[0].missed, 1, '这周确实欠款了');
	assert.equal(r.state.properties[0].loan, def.price, '本金不超过房价');
	assert.deepEqual(sanitizeState(r.state, locs), r.state);
});

test('排行榜：排名规则（净资产、先达到者、稳定）和名次截取', () => {
	const e = (worth: number, at: number, name = 'x') => ({ name, avatar: '🧑', worth, day: 3, at });
	const entries: [string, unknown][] = [['rank:b', e(500, 2, '乙')], ['rank:a', e(900, 5, '甲')], ['rank:c', e(500, 1, '丙')], ['rank:d', e(500, 1, '丁')], ['rank:bad', { worth: NaN }]];
	const b = rankBoard(entries, 'rank:d', 3);
	assert.deepEqual(b.top.map((r) => r.name), ['甲', '丙', '丁'], '同样 500：先达到的在前，同时达到的按键排');
	assert.equal(b.total, 4, '坏记录不计');
	assert.deepEqual(b.me, { rank: 3, name: '丁', avatar: '🧑', worth: 500, day: 3, me: true });
	assert.equal(rankBoard(entries, 'rank:b', 2).me?.rank, 4, '在前几名之外也能拿到自己的名次');
	assert.equal(rankBoard(entries, 'rank:zzz').me, null, '没上榜');
	assert.equal(rankBoard([], 'rank:a').total, 0);
	// 榜单记录就是净资产，只放展示用的字段
	const s = createCharacter({ id: 'board-player', name: '榜', avatar: '🧑', origin: 'fifo', region: 'wa', spawn: WA.spawn, seed: 3 });
	assert.deepEqual(Object.keys(boardEntry(s, 123)).sort(), ['at', 'avatar', 'day', 'name', 'worth']);
	assert.equal(boardEntry(s, 123).worth, Math.round(netWorth(s)));
	// 净资产没变时沿用上一条记录的时间；变了、旧记录损坏或时间在未来，都用这次的时间
	const w0 = Math.round(netWorth(s));
	assert.equal(boardEntry(s, 500, e(w0, 100)).at, 100, '同样的净资产，保留先达到的时间');
	assert.equal(boardEntry(s, 500, e(w0 + 1, 100)).at, 500, '净资产变了，换成这次的时间');
	assert.equal(boardEntry(s, 500, e(w0, 900)).at, 500, '旧时间在未来，不沿用');
	assert.equal(boardEntry(s, 500, { worth: w0 }).at, 500, '旧记录损坏，不沿用');
	assert.equal(boardEntry(s, 500, undefined).at, 500);
});
