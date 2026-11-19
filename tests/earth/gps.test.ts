// 城市抵达（gps 动作）防伪造：精度、服务端时间、和上一次定位比的瞬移速度；旧客户端不带精度时拒绝
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { haversineKm } from '../../src/game/core/geo.ts';
import { GPS_FIX_RULES, VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import { queueable } from '../../src/game/ui/queue.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const T = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const loc = (id: string) => WA.locations.find((l) => l.id === id)!;
const fresh = (): PlayerState => createCharacter({ id: 'gps-cheat', name: '定位', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 4 });
const gps = (lat: number, lon: number, acc?: number) => (acc === undefined ? { t: 'gps' as const, lat, lon } : { t: 'gps' as const, lat, lon, acc });
const settle = (s: PlayerState) => {
	while (s.pending) s = applyAction(s, WA, { t: 'event', choice: 0 }).state;
	return s;
};

test('parseAction：gps 带上精度；精度不合法整条拒绝；不带精度（旧客户端）原样交给引擎', () => {
	assert.deepEqual(parseAction({ t: 'gps', lat: -31.95, lon: 115.86, acc: 12.5 }), { t: 'gps', lat: -31.95, lon: 115.86, acc: 12.5 });
	assert.deepEqual(parseAction({ t: 'gps', lat: -31.95, lon: 115.86 }), { t: 'gps', lat: -31.95, lon: 115.86 });
	for (const acc of [NaN, -1, '10', null, 1e7, Infinity]) assert.equal(parseAction({ t: 'gps', lat: -31.95, lon: 115.86, acc }), null, `acc=${String(acc)}`);
	assert.equal(parseAction({ t: 'gps', lat: 91, lon: 0, acc: 5 }), null);
});

test('旧客户端不带精度：拒绝并提示刷新，存档不变', () => {
	const s = fresh();
	const fre = loc('fremantle');
	const r = applyAction(s, WA, gps(fre.lat, fre.lon), T);
	assert.equal(r.ok, false);
	assert.match(r.msg, /刷新/);
	assert.equal(r.state, s);
	assert.equal(s.loc, 'perth');
});

test('没有服务端时间（离线）不能用真实定位抵达', () => {
	const fre = loc('fremantle');
	const r = applyAction(fresh(), WA, gps(fre.lat, fre.lon, 10), 0);
	assert.equal(r.ok, false);
	assert.match(r.msg, /联网/);
});

test('精度差于上限不受理；正好在上限内可以', () => {
	const fre = loc('fremantle');
	const bad = applyAction(fresh(), WA, gps(fre.lat, fre.lon, GPS_FIX_RULES.maxAccuracyM + 1), T);
	assert.equal(bad.ok, false);
	assert.match(bad.msg, /精度/);
	assert.equal(bad.state.loc, 'perth');
	assert.ok(applyAction(fresh(), WA, gps(fre.lat, fre.lon, GPS_FIX_RULES.maxAccuracyM), T).ok);
});

test('成功后记下定位（3 位小数、服务端时间）；失败不动', () => {
	const r = applyAction(fresh(), WA, gps(-32.05512, 115.74789, 10), T);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.loc, 'fremantle');
	assert.deepEqual(r.state.fix, { lat: -32.055, lon: 115.748, at: T });
	const s = settle(r.state);
	const fail = applyAction(s, WA, gps(0, 0, 10), T + HOUR);
	assert.equal(fail.ok, false);
	assert.deepEqual(fail.state.fix, s.fix);
});

test('瞬移：刚在珀斯定位过，一分钟后出现在布鲁姆不受理；按飞机速度过了足够久就可以', () => {
	const per = loc('perth'), bro = loc('broome');
	const km = haversineKm(per.lat, per.lon, bro.lat, bro.lon);
	assert.ok(km > 1500, '珀斯到布鲁姆一千多公里');
	const s = { ...fresh(), fix: { lat: per.lat, lon: per.lon, at: T } };
	const quick = applyAction(s, WA, gps(bro.lat, bro.lon, 10), T + MIN);
	assert.equal(quick.ok, false);
	assert.match(quick.msg, /跳得太快/);
	assert.equal(quick.state.loc, 'perth');
	assert.ok(!quick.state.checkins.length, '没打上卡');
	// 半小时一千七百公里（3000+ km/h）也不是飞机能到的速度
	assert.match(applyAction(s, WA, gps(bro.lat, bro.lon, 10), T + 30 * MIN).msg, /跳得太快/);
	// 坐飞机约 3 小时：合法
	const flight = applyAction(s, WA, gps(bro.lat, bro.lon, 10), T + 3 * HOUR);
	assert.ok(flight.ok, flight.msg);
	assert.equal(flight.state.loc, 'broome');
	// 速度刚好超上限仍拒绝
	const edge = Math.floor((km / GPS_FIX_RULES.maxSpeedKmh) * HOUR) - MIN;
	assert.equal(applyAction(s, WA, gps(bro.lat, bro.lon, 10), T + edge).ok, false);
});

test('瞬移检查和真实地点共用一份定位：gps 记下的定位会挡住远处的真实地点动作', () => {
	const bro = loc('broome');
	const venue = WA.venues.find((v) => v.loc === 'perth')!;
	const op = VENUE_TYPES.find((t) => t.id === venue.type)!.ops[0];
	const s = { ...fresh(), fix: { lat: bro.lat, lon: bro.lon, at: T } };
	const r = applyAction(s, WA, { t: 'venue', venue: venue.id, op, lat: venue.lat, lon: venue.lon, acc: 10 }, T + MIN);
	assert.equal(r.ok, false);
	assert.match(r.msg, /跳得太快/);
	// 反过来：真实地点在珀斯记的定位挡住一分钟后的远程 gps 抵达
	const v = { ...fresh(), fix: { lat: venue.lat, lon: venue.lon, at: T } };
	assert.match(applyAction(v, WA, gps(bro.lat, bro.lon, 10), T + MIN).msg, /跳得太快/);
});

test('同城几公里内的漂移不查速度', () => {
	const per = loc('perth');
	const poi = WA.pois.find((p) => p.loc === 'perth')!;
	const s = { ...fresh(), fix: { lat: poi.lat + 0.01, lon: poi.lon, at: T } }; // 约 1 公里外
	assert.ok(haversineKm(poi.lat + 0.01, poi.lon, poi.lat, poi.lon) < GPS_FIX_RULES.speedFreeKm);
	const r = applyAction(s, WA, gps(poi.lat, poi.lon, 10), T + 1000);
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.checkins.includes(poi.id));
	assert.equal(per.id, r.state.loc);
});

test('gps 仍然不能离线排队（带精度也一样）', () => {
	assert.equal(queueable({ t: 'gps', lat: -31.95, lon: 115.86, acc: 10 }), false);
});
