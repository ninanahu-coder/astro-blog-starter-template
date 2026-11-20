// 主要路线（实地路线，v22）：数据只引用已有的 seed / OSM 地点；GPS 按顺序到站、沿途触发事件；精度、瞬移、站间速度三道检查；存档不记轨迹。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { getPendingEvent, resolveEvent } from '../../src/game/core/engine.ts';
import { legProgress, trailsIn, trailStep } from '../../src/game/core/trails.ts';
import { queueable } from '../../src/game/ui/queue.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { STORY } from '../../src/game/data/story.ts';
import { TRAIL_EVENTS } from '../../src/game/data/trail-events.ts';
import { getTrail, TRAIL_RULES, TRAILS, type TrailStop } from '../../src/game/data/trails.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { haversineKm } from '../../src/game/core/geo.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const T0 = Date.UTC(2026, 10, 14, 1, 0); // 珀斯上午 9 点
const MIN = 60_000;
const CITY = getTrail('perth-city-walk')!;
const HILL = getTrail('perth-kings-park')!;
const GRID = getTrail('adelaide-grid-walk')!;

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'trail-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: 'perth', seed: 11 }),
	...over,
});
const at = (s: TrailStop, acc = 10) => ({ lat: s.lat, lon: s.lon, acc });
/** a→b 线段上比例 f 处的点 */
const between = (a: TrailStop, b: TrailStop, f: number, acc = 10) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, acc });
/** 处理掉到站 / 沿途事件（选第一个不要钱的选项） */
function clear(s: PlayerState): PlayerState {
	const ev = getPendingEvent(s);
	if (!ev) return s;
	const i = ev.choices.findIndex((c) => !c.cost);
	const r = resolveEvent(s, WA, i);
	assert.ok(r.ok, r.msg);
	return r.state;
}
/** 按正常步行速度（每站隔 30 分钟）走完一条路线的前 n 站 */
function walk(trail = CITY, n = trail.stops.length, s0 = make()): { s: PlayerState; now: number } {
	let s = s0;
	let now = T0;
	for (let i = 0; i < n; i++) {
		now += 30 * MIN;
		const r = trailStep(s, WORLD, at(trail.stops[i]), now);
		assert.ok(r.ok, `${trail.id} 第 ${i + 1} 站：${r.msg}`);
		s = clear(r.state);
	}
	return { s, now };
}

// ---------- 数据 ----------
test('路线数据：站引用已有的 seed / OSM 地点，名字和坐标与来源一致，在路线所在城市', () => {
	const sources = new Map<string, { loc: string; name: string; lat: number; lon: number; source: string }>();
	for (const p of WORLD.pois) sources.set(p.id, p);
	for (const v of WORLD.venues) sources.set(v.id, v);
	const ids = new Set<string>();
	for (const t of TRAILS) {
		assert.ok(!ids.has(t.id), `${t.id} 重复`);
		ids.add(t.id);
		assert.ok(WORLD.locations.some((l) => l.id === t.loc), `${t.id} 的城市存在`);
		assert.ok(Number.isInteger(t.chapter) && t.chapter >= 0 && t.chapter < STORY.length, `${t.id} 的章节存在`);
		assert.ok(t.stops.length >= 3, `${t.id} 至少 3 站`);
		assert.ok(t.reward.cash! > 0 && Object.keys(t.reward).every((k) => ['cash', 'respect', 'moodlet'].includes(k)), `${t.id} 奖励只用 cash、respect、moodlet`);
		const refs = new Set(t.stops.map((s) => s.ref));
		assert.equal(refs.size, t.stops.length, `${t.id} 站不重复`);
		t.stops.forEach((s, i) => {
			const src = sources.get(s.ref);
			assert.ok(src, `${t.id} 的站 ${s.ref} 在 pois / venues 里`);
			assert.ok(['seed', 'osm', 'wikidata'].includes(src!.source), `${s.ref} 来源只能是 seed / osm / wikidata`);
			assert.deepEqual({ loc: t.loc, name: s.name, lat: s.lat, lon: s.lon }, { loc: src!.loc, name: src!.name, lat: src!.lat, lon: src!.lon }, `${s.ref} 名字坐标抄对`);
			if (i === 0) assert.equal(s.along, undefined, `${t.id} 第一站没有上一段路`);
			if (i > 0) {
				const km = haversineKm(t.stops[i - 1].lat, t.stops[i - 1].lon, s.lat, s.lon);
				// 两站要分得开（不然一次定位连到两站），也不能远到走不动
				assert.ok(km * 1000 > 2 * (TRAIL_RULES.stopRadiusM + 50) && km < 5, `${t.id} 第 ${i} → ${i + 1} 站 ${km.toFixed(2)} km`);
			}
		});
	}
});

test('路线事件：都在 EVENTS 里、不进普通抽取，路线引用的事件都存在且都被用到', () => {
	const used = new Set(TRAILS.flatMap((t) => t.stops.flatMap((s) => [s.event, s.along].filter(Boolean) as string[])));
	for (const e of TRAIL_EVENTS) {
		assert.equal(e.weight, 0, `${e.id} 不进普通抽取`);
		assert.ok(!e.venueTypes && !e.locs && !e.tags && !e.kinds, `${e.id} 不按地点匹配`);
		assert.ok(EVENTS.includes(e), `${e.id} 在 EVENTS 里`);
		assert.ok(used.has(e.id), `${e.id} 有路线用到`);
		assert.ok(e.choices.length >= 2 && e.choices.some((c) => !c.cost), `${e.id} 至少有一个不要钱的选项`);
	}
	for (const id of used) assert.ok(TRAIL_EVENTS.some((e) => e.id === id), `${id} 存在`);
});

test('legProgress：沿线比例和离线段的距离', () => {
	const a = { lat: -31.95, lon: 115.86 };
	const b = { lat: -31.95, lon: 115.87 }; // 正东约 945 米
	const mid = legProgress(a, b, { lat: -31.95, lon: 115.865 });
	assert.ok(Math.abs(mid.t - 0.5) < 0.01 && mid.offM < 1, JSON.stringify(mid));
	const side = legProgress(a, b, { lat: -31.951, lon: 115.865 }); // 偏南约 110 米
	assert.ok(Math.abs(side.t - 0.5) < 0.01 && side.offM > 100 && side.offM < 120, JSON.stringify(side));
	const behind = legProgress(a, b, { lat: -31.95, lon: 115.855 });
	assert.ok(behind.t < 0 && behind.offM > 400, JSON.stringify(behind));
	assert.deepEqual(legProgress(a, a, a), { t: 0, offM: 0 });
});

// ---------- 推进 ----------
test('按顺序走完一条路线：每站一次收获，到站事件挂上，走完发奖励，进度只记站数', () => {
	const s0 = make();
	const snap = structuredClone(s0);
	const first = trailStep(s0, WORLD, at(CITY.stops[0]), T0);
	assert.ok(first.ok, first.msg);
	assert.deepEqual(s0, snap, '不修改入参');
	assert.deepEqual(first.state.trails[CITY.id], { at: 1, leg: false, t: T0 });
	assert.equal(first.state.pending?.eventId, CITY.stops[0].event, '到站事件');
	assert.equal(first.state.clock, s0.clock + TRAIL_RULES.stopMinutes, '到站花游戏时间');
	assert.equal(trailStep(first.state, WORLD, at(CITY.stops[1]), T0 + 30 * MIN).msg, '先处理眼前的事件。');

	const { s } = walk();
	assert.equal(s.trails[CITY.id].at, CITY.stops.length);
	assert.equal(s.cash, s0.cash + CITY.reward.cash!, '奖励到账（路上只选不要钱的选项）');
	assert.ok(s.respect >= s0.respect + CITY.reward.respect!);
	assert.ok(s.moodlets.some((m) => m.id === CITY.reward.moodlet));
	assert.ok(s.journal.some((j) => j.text.includes(`走完了「${CITY.title}」`)));
	// 隐私：路线进度里没有坐标；唯一的坐标是最近一次定位，保留 3 位小数
	assert.doesNotMatch(JSON.stringify(s.trails), /lat|lon|\.\d{4}/);
	const last = CITY.stops[CITY.stops.length - 1];
	assert.deepEqual(s.fix, { lat: Math.round(last.lat * 1000) / 1000, lon: Math.round(last.lon * 1000) / 1000, at: s.fix!.at });
	// 走完以后不能再刷
	const again = trailStep(s, WORLD, at(last), T0 + 600 * MIN);
	assert.equal(again.ok, false);
	assert.equal(trailsIn(s, WORLD).find((v) => v.trail.id === CITY.id)?.done, true);
});

test('站要按顺序到：直接去第二站不算，告诉玩家离下一站多远', () => {
	const r = trailStep(make(), WORLD, at(CITY.stops[1]), T0);
	assert.equal(r.ok, false);
	assert.match(r.msg, new RegExp(`离「${CITY.stops[0].name}」还有 \\d+ 米`));
	assert.equal(r.state.trails[CITY.id], undefined);
});

test('到站半径：站半径 + 定位误差（误差最多算 50 米）', () => {
	const s = CITY.stops[0];
	const north = (m: number, acc: number) => ({ lat: s.lat + m / 110_540, lon: s.lon, acc });
	assert.ok(trailStep(make(), WORLD, north(TRAIL_RULES.stopRadiusM - 5, 5), T0).ok);
	assert.equal(trailStep(make(), WORLD, north(TRAIL_RULES.stopRadiusM + 20, 5), T0).ok, false);
	assert.ok(trailStep(make(), WORLD, north(TRAIL_RULES.stopRadiusM + 20, 40), T0).ok, '误差 40 米时放宽');
	assert.equal(trailStep(make(), WORLD, north(TRAIL_RULES.stopRadiusM + 70, 140), T0).ok, false, '误差再大也最多放宽 50 米');
});

test('防作弊：精度太差、精度可疑（0 米）、瞬移、站间太快都不受理', () => {
	const s0 = CITY.stops[0];
	assert.match(trailStep(make(), WORLD, at(s0, 200), T0).msg, /精度不够/);
	assert.match(trailStep(make(), WORLD, at(s0, 0), T0).msg, /模拟定位/);
	assert.match(trailStep(make(), WORLD, at(s0, 0.5), T0).msg, /模拟定位/);
	// 瞬移：一分钟前还在阿德莱德
	assert.match(trailStep(make({ fix: { lat: -34.92, lon: 138.6, at: T0 - MIN } }), WORLD, at(s0), T0).msg, /定位跳得太快/);
	// 站间：第 2 → 3 站约 700 米，1 分钟走到 = 40 多公里/小时
	const { s, now } = walk(CITY, 2);
	const fast = trailStep(s, WORLD, at(CITY.stops[2]), now + MIN);
	assert.equal(fast.ok, false);
	assert.match(fast.msg, /太快了.*分钟后再试/);
	assert.ok(trailStep(s, WORLD, at(CITY.stops[2]), now + 10 * MIN).ok, '10 分钟走 700 米可以');
});

test('沿途：走在两站之间的走廊里触发这一段的沿途事件，每段一次；偏离路线或刚出发不算', () => {
	const { s, now } = walk(CITY, 1);
	const [a, b] = [CITY.stops[0], CITY.stops[1]];
	assert.ok(b.along);
	const r = trailStep(s, WORLD, between(a, b, 0.5), now + 3 * MIN);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.pending?.eventId, b.along);
	assert.deepEqual(r.state.trails[CITY.id], { at: 1, leg: true, t: now });
	// 同一段不再出
	const again = trailStep(clear(r.state), WORLD, between(a, b, 0.6), now + 4 * MIN);
	assert.equal(again.ok, false);
	assert.match(again.msg, /还有 \d+ 米/);
	// 到站后沿途标记清掉
	const arrived = trailStep(clear(r.state), WORLD, at(b), now + 6 * MIN);
	assert.ok(arrived.ok, arrived.msg);
	assert.equal(arrived.state.trails[CITY.id].leg, false);
	// 刚出发（10%）、偏离 300 米都不算
	assert.equal(trailStep(s, WORLD, between(a, b, 0.1), now + 3 * MIN).ok, false);
	const off = between(a, b, 0.5);
	assert.equal(trailStep(s, WORLD, { ...off, lat: off.lat + 300 / 110_540 }, now + 3 * MIN).ok, false);
	// 沿途也查速度：第 2 → 3 站中途，离第 2 站约 350 米，几秒钟就到不行
	const w2 = walk(CITY, 2);
	assert.match(trailStep(w2.s, WORLD, between(CITY.stops[1], CITY.stops[2], 0.5), w2.now + 5_000).msg, /太快了/);
});

test('章节开放、城市、联网、待处理事件', () => {
	// 第 2 章的路线在第 1 章还没开放
	const locked = trailStep(make(), WORLD, at(HILL.stops[0]), T0);
	assert.equal(locked.ok, false);
	assert.equal(trailsIn(make(), WORLD).find((v) => v.trail.id === HILL.id)?.open, false);
	assert.ok(trailStep(make({ story: { ch: 1, done: {} } }), WORLD, at(HILL.stops[0]), T0).ok, '进了第 2 章就开放');
	assert.ok(trailStep(make({ story: { ch: STORY.length, done: {} } }), WORLD, at(HILL.stops[0]), T0).ok, '主线写完后一直开放');
	// 人在阿德莱德、游戏里还在珀斯：先用真实定位抵达
	assert.match(trailStep(make(), WORLD, at(GRID.stops[0]), T0).msg, /先用真实定位抵达阿德莱德/);
	assert.ok(trailStep(make({ loc: 'adelaide' }), WORLD, at(GRID.stops[0]), T0).ok);
	// 区域里没有这条路线（只给西澳区域）
	assert.match(trailStep(make({ loc: 'adelaide' }), WA, at(GRID.stops[0]), T0).msg, /先用真实定位抵达|没有能走的路线/);
	assert.match(trailStep(make(), WORLD, at(CITY.stops[0]), 0).msg, /联网/);
	assert.match(trailStep(make({ pending: { eventId: 'trail-quay-start' } }), WORLD, at(CITY.stops[0]), T0).msg, /先处理眼前的事件/);
});

test('体力见底时到站晕倒：这一站不算，进度不变', () => {
	const weak = make({ health: 0.3, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } });
	const r = trailStep(weak, WORLD, at(CITY.stops[0]), T0);
	assert.ok(r.ok && r.collapsed, r.msg);
	assert.equal(r.state.trails[CITY.id], undefined);
	assert.equal(r.state.pending, null);
});

// ---------- 协议、存档 ----------
test('动作协议：trail 只认有限的坐标和精度；经 applyAction 结算、版本号加一；不能离线排队', () => {
	assert.deepEqual(parseAction({ t: 'trail', lat: -31.958, lon: 115.8573, acc: 12 }), { t: 'trail', lat: -31.958, lon: 115.8573, acc: 12 });
	for (const bad of [{ t: 'trail', lat: 91, lon: 0, acc: 5 }, { t: 'trail', lat: 0, lon: 0, acc: -1 }, { t: 'trail', lat: 0, lon: 0 }, { t: 'trail', lat: '0', lon: 0, acc: 5 }, { t: 'trail', lat: 0, lon: 0, acc: 20000 }, { t: 'trail', lat: NaN, lon: 0, acc: 5 }]) {
		assert.equal(parseAction(bad), null, JSON.stringify(bad));
	}
	const a = parseAction({ t: 'trail', ...at(CITY.stops[0]) })!;
	const s = make();
	const r = applyAction(s, WORLD, a, T0);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rev, s.rev + 1);
	assert.equal(applyAction(s, WORLD, a).ok, false, '不传服务端时间就不能走');
	assert.equal(queueable(a), false);
});

test('存档校验：只留已知路线，站数钳到范围，沿途标记只在半路有效，时间不能在未来', () => {
	const raw = {
		...make(),
		trails: {
			[CITY.id]: { at: 99, leg: true, t: T0 },
			[GRID.id]: { at: 0, leg: true, t: T0 + 10 * 24 * 60 * MIN },
			[HILL.id]: { at: 1, leg: true, t: -5 },
			'no-such-trail': { at: 1, leg: false, t: T0 },
			constructor: { at: 1 },
		},
	};
	const s = sanitizeState(raw, undefined, { now: T0 })!;
	assert.deepEqual(s.trails, {
		[CITY.id]: { at: CITY.stops.length, leg: false, t: T0 },
		[HILL.id]: { at: 1, leg: true, t: 0 },
	});
	assert.deepEqual(sanitizeState({ ...make(), trails: 'x' })!.trails, {});
	assert.deepEqual(sanitizeState({ ...make(), trails: undefined })!.trails, {}, '旧存档没有这个字段');
});

// ---------- 服务端入口 ----------
test('服务端：路线动作用服务端时间结算并落盘；坏坐标 400；落盘的存档里路线进度没有坐标', async () => {
	const { EarthWorld } = await import('../../src/game/server/world.ts');
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	const cred = { id: 'trail-server-player', key: 'k'.repeat(24) };
	const created = await call({ action: 'create', ...cred, profile: { name: '测试', avatar: '🧑', origin: 'student', traits: [] } });
	assert.equal(created.status, 200, created.data.msg);
	assert.equal(created.data.state.loc, 'perth');
	const bad = await call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'trail', lat: 'x', lon: 0, acc: 5 } });
	assert.equal(bad.status, 400);
	const r = await call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'trail', ...at(CITY.stops[0]) } });
	assert.ok(r.data.ok, r.data.msg);
	const saved = data.get('save:' + cred.id).state as PlayerState;
	assert.equal(saved.trails[CITY.id].at, 1);
	assert.ok(Math.abs(saved.trails[CITY.id].t - r.data.at) < 5_000, '到站时间是服务端时间');
	assert.deepEqual(Object.keys(saved.trails[CITY.id]).sort(), ['at', 'leg', 't']);
	assert.equal(saved.pending?.eventId, CITY.stops[0].event);
});

test('附近页（页面模板）：路线卡挂在定位卡后面，路线按钮的点击接上了（合并 main 时这两处都有冲突）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /<\/div>` \+ trailCards\(s\);/, '附近页路线卡');
	const click = src.match(/closest<HTMLElement>\('\[data-tab\][^']*'\)/)?.[0] ?? '';
	for (const a of ['trail', 'live', 'pet', 'venue']) assert.ok(click.includes(`[data-${a}]`), `点击委托缺 data-${a}`);
});
