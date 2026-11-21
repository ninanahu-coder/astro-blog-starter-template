// 随机事件引擎（docs/earth-game/event-engine.md）：内容校验、条件、冷却、上限、防厌倦、事件链、确定性、向后兼容。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	ARRIVAL_EVENT_CHANCE, eventMatches, getPendingEvent, HEAT_CHECK_AT, pickArrivalEvent, pickVenueEvent, resolveEvent, roll, startEvent,
} from '../../src/game/core/engine.ts';
import {
	assertEvents, cleanEvMem, dailyFull, emptyMemory, EVENT_POLICY, eventReady, memoryOn, needMet, noteResolved, noteTriggered, pickChain,
	RECENT_MAX, validateEvents, weightedPick, weightOf, type EventPolicy,
} from '../../src/game/core/event-rules.ts';
import { dateOf } from '../../src/game/core/time.ts';
import type { GameEvent, GameLocation, PlayerState, TravelMode } from '../../src/game/core/types.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';

const fresh = (seed = 42): PlayerState =>
	createCharacter({ id: 'event-engine', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed });
const DAY = 1440;
const OFF: EventPolicy = { dailyMax: 0, repeatGap: 0, fatigue: 1, fatigueN: 8 };
const ev = (id: string, extra: Partial<GameEvent> = {}): GameEvent => ({
	id, title: id, icon: '·', text: id, weight: 1, choices: [{ label: '好', ok: { text: '好', fx: {} } }], ...extra,
});

// ---------- 内容校验 ----------
test('现有事件全部通过校验；外部引用（地点、真实地点类型、NPC、物品、心情）都存在', () => {
	assert.deepEqual(validateEvents(EVENTS), []);
	assert.equal(EVENTS.length >= 84, true, `现有事件 ${EVENTS.length} 个`);
	const locs = new Set(WORLD.locations.map((l) => l.id));
	const venueTypes = new Set(VENUE_TYPES.map((v) => v.id));
	const npcs = new Set(NPCS.map((n) => n.id));
	const items = new Set(ITEMS.map((i) => i.id));
	const moods = new Set(MOODLETS.map((m) => m.id));
	for (const e of EVENTS) {
		for (const id of e.locs ?? []) assert.ok(locs.has(id), `${e.id}：地点 ${id}`);
		for (const id of e.venueTypes ?? []) assert.ok(venueTypes.has(id), `${e.id}：真实地点类型 ${id}`);
		for (const r of e.need?.rel ?? []) assert.ok(npcs.has(r.npc), `${e.id}：NPC ${r.npc}`);
		for (const id of e.need?.items ?? []) assert.ok(items.has(id), `${e.id}：物品 ${id}`);
		for (const c of e.choices) for (const o of [c.ok, c.fail]) {
			if (o?.fx.moodlet) assert.ok(moods.has(o.fx.moodlet), `${e.id}：心情 ${o.fx.moodlet}`);
			for (const id of Object.keys(o?.fx.items ?? {})) assert.ok(items.has(id), `${e.id}：物品 ${id}`);
		}
	}
});

test('校验：常见写错都报出来，并带事件 id', () => {
	const errs = (list: GameEvent[]) => validateEvents(list).join('\n');
	const bad = (list: GameEvent[], re: RegExp) => assert.match(errs(list), re);
	assert.equal(errs([ev('a'), ev('b')]), '');
	bad([ev('a'), ev('a')], /a：id 重复/);
	bad([ev('Bad_ID')], /Bad_ID：id 只能用/);
	bad([{ ...ev('a'), cooldwon: 5 } as never], /a：不认识的字段「cooldwon」/);
	bad([ev('a', { weight: -1 })], /weight 必须/);
	bad([ev('a', { weight: NaN })], /weight 必须/);
	bad([ev('a', { title: ' ' })], /缺少 title/);
	bad([ev('a', { choices: [] })], /至少要有一个选项/);
	bad([ev('a', { weather: ['snow'] })], /weather 只能是/);
	bad([ev('a', { seasons: ['monsoon'] })], /seasons 只能是/);
	bad([ev('a', { periods: ['noon' as never] })], /periods 只能是/);
	bad([ev('a', { hours: [7, 25] })], /hours/);
	bad([ev('a', { venueTypes: ['cafe'], locs: ['perth'] })], /不能同时写/);
	bad([ev('a', { breakdown: true })], /抛锚事件 weight 必须写 0/);
	bad([ev('a', { cooldown: 0 })], /cooldown/);
	bad([ev('a', { daily: 1.5 })], /daily 必须是正整数/);
	bad([ev('a', { max: 0 })], /max 必须是正整数/);
	bad([ev('a', { unlockDays: 3 })], /unlockDays 只对 locked/);
	bad([ev('a', { need: { min: { charm: 3 } as never } })], /「charm」不是可比较的数值/);
	bad([ev('a', { need: { min: { cash: 100 }, max: { cash: 50 } } })], /need.min.cash 大于 need.max.cash/);
	bad([ev('a', { need: { rel: [{ npc: 'mia' }] } })], /至少写 min 或 max/);
	bad([ev('a', { need: { rel: [{ npc: 'mia', min: 50, max: 10 }] } })], /min 大于 max/);
	bad([ev('a', { need: { mood: 3 } as never })], /need 里不认识的字段「mood」/);
	bad([ev('a', { choices: [{ label: 'x', ok: { text: 'x', fx: {} }, fail: { text: 'y', fx: {} } }] })], /有 fail 却没有 check/);
	bad([ev('a', { choices: [{ label: 'x', check: { skill: 'luck' as never, dc: 3 }, ok: { text: 'x', fx: {} } }] })], /check 要写 skill/);
	bad([ev('a', { choices: [{ label: 'x', ok: { text: 'x' } as never }] })], /缺少 fx/);
	bad([ev('a', { choices: [{ label: 'x', exposed: 'sea', ok: { text: 'x', fx: {} } }] })], /至少留一个不下海的/);
	// 事件链
	bad([ev('a', { choices: [{ label: 'x', ok: { text: 'x', fx: {}, unlocks: ['nope'] } }] })], /unlocks 指向不存在的事件 nope/);
	bad([ev('a', { choices: [{ label: 'x', ok: { text: 'x', fx: {}, unlocks: ['b'] } }] }), ev('b')], /b 不是 locked 事件/);
	bad([ev('b', { locked: true })], /b：locked 事件没有任何结果解锁它/);
	bad([ev('a', { once: true, locked: true })], /once 和 locked 不能同时写/);
	bad([ev('a', { choices: [{ label: 'x', ok: { text: 'x', fx: {}, then: 'nope' } }] })], /then 指向不存在的事件 nope/);
	const loop = [
		ev('a', { choices: [{ label: 'x', ok: { text: 'x', fx: {}, then: 'b' } }] }),
		ev('b', { choices: [{ label: 'x', ok: { text: 'x', fx: {}, then: 'a' } }] }),
	];
	bad(loop, /then 绕成了圈/);
	// 正确的链：fail 结果也能解锁
	assert.equal(errs([
		ev('a', { choices: [{ label: 'x', check: { skill: 'charisma', dc: 30 }, ok: { text: 'x', fx: {}, then: 'c' }, fail: { text: 'y', fx: {}, unlocks: ['b'] } }] }),
		ev('b', { locked: true, unlockDays: 7 }), ev('c', { weight: 0 }),
	]), '');
});

test('加载时报错：assertEvents 一次列出全部问题', () => {
	assert.doesNotThrow(() => assertEvents(EVENTS));
	assert.throws(() => assertEvents([ev('a', { weight: -1 }), ev('b', { max: 0 })]), (e: Error) => /2 处问题/.test(e.message) && /a：/.test(e.message) && /b：/.test(e.message));
});

// ---------- 条件 ----------
test('属性、关系、物品条件：边界值算满足', () => {
	const s = { ...fresh(), cash: 500, heat: 20, needs: { ...fresh().needs, energy: 30 }, skills: { ...fresh().skills, charisma: 40 } };
	assert.equal(needMet(ev('a'), s), true);
	assert.equal(needMet(ev('a', { need: { min: { cash: 500, charisma: 40 } } }), s), true);
	assert.equal(needMet(ev('a', { need: { min: { cash: 501 } } }), s), false);
	assert.equal(needMet(ev('a', { need: { max: { energy: 30 } } }), s), true);
	assert.equal(needMet(ev('a', { need: { max: { energy: 29 } } }), s), false);
	assert.equal(needMet(ev('a', { need: { max: { heat: 19 } } }), s), false);
	// 没认识过的 NPC 关系算 0
	assert.equal(needMet(ev('a', { need: { rel: [{ npc: 'mia', min: 0 }] } }), s), true);
	assert.equal(needMet(ev('a', { need: { rel: [{ npc: 'mia', min: 1 }] } }), s), false);
	const friend = { ...s, relations: { mia: { score: 60, last: {}, seen: [], known: [] } } };
	assert.equal(needMet(ev('a', { need: { rel: [{ npc: 'mia', min: 60 }] } }), friend), true);
	assert.equal(needMet(ev('a', { need: { rel: [{ npc: 'mia', max: 59 }] } }), friend), false);
	assert.equal(needMet(ev('a', { need: { items: ['water'] } }), s), true, '新角色带着水');
	assert.equal(needMet(ev('a', { need: { items: ['water', 'tent'] } }), s), false);
	assert.equal(needMet(ev('a', { need: { items: ['water'] } }), { ...s, inventory: { water: 0 } }), false);
});

// ---------- 冷却、上限、链、防厌倦 ----------
test('冷却：差一分钟不行，满了就行', () => {
	const e = ev('a', { cooldown: 24 });
	const m = noteTriggered(emptyMemory(), e, 1000, 'random');
	assert.equal(m.last.a, 1000);
	assert.equal(eventReady(e, memoryOn(m, 1000 + 24 * 60 - 1), 1000 + 24 * 60 - 1, OFF), false);
	assert.equal(eventReady(e, memoryOn(m, 1000 + 24 * 60), 1000 + 24 * 60, OFF), true);
	assert.equal(eventReady(ev('b'), m, 1001, OFF), true, '没写冷却的不受影响');
});

test('每日次数换日清零；总次数不清零', () => {
	const e = ev('a', { daily: 2, max: 3 });
	let m = emptyMemory();
	m = noteTriggered(m, e, DAY + 10, 'random');
	m = noteTriggered(m, e, DAY + 20, 'random');
	assert.equal(eventReady(e, memoryOn(m, DAY + 30), DAY + 30, OFF), false, '今天已经 2 次');
	const tomorrow = memoryOn(m, 2 * DAY);
	assert.equal(tomorrow.rand, 0);
	assert.deepEqual(tomorrow.today, {});
	assert.equal(eventReady(e, tomorrow, 2 * DAY, OFF), true);
	m = noteTriggered(tomorrow, e, 2 * DAY, 'random');
	assert.equal(m.n.a, 3);
	assert.equal(eventReady(e, memoryOn(m, 9 * DAY), 9 * DAY, OFF), false, '一共 3 次用完');
});

test('全局每日上限只数随机抽中的；签名、链式、强制事件不占名额', () => {
	const pol = { ...OFF, dailyMax: 2 };
	let m = memoryOn(emptyMemory(), DAY);
	m = noteTriggered(m, ev('s', { once: true }), DAY + 1, 'signature');
	m = noteTriggered(m, ev('c'), DAY + 2, 'chain');
	m = noteTriggered(m, ev('f'), DAY + 3, 'forced');
	assert.equal(dailyFull(m, pol), false);
	m = noteTriggered(m, ev('r1'), DAY + 4, 'random');
	m = noteTriggered(m, ev('r2'), DAY + 5, 'random');
	assert.equal(m.rand, 2);
	assert.equal(dailyFull(m, pol), true);
	assert.equal(dailyFull(m, OFF), false, '0 = 不限');
	assert.equal(dailyFull(memoryOn(m, 2 * DAY), pol), false, '第二天重新算');
});

test('不重复：repeatGap 内的不进池；recent 最多 RECENT_MAX 条', () => {
	const pol = { ...OFF, repeatGap: 2 };
	let m = emptyMemory();
	for (const id of ['a', 'b']) m = noteTriggered(m, ev(id), 10, 'random');
	assert.equal(eventReady(ev('a'), m, 10, pol), false, 'a 后面只隔了 1 个');
	m = noteTriggered(m, ev('c'), 10, 'random');
	assert.equal(eventReady(ev('a'), m, 10, pol), true, '隔了 2 个');
	assert.equal(eventReady(ev('c'), m, 10, OFF), true, '关着就不管');
	for (let i = 0; i < 40; i++) m = noteTriggered(m, ev(`x${i}`), 10, 'random');
	assert.equal(m.recent.length, RECENT_MAX);
	assert.equal(m.recent.at(-1), 'x39');
});

test('防厌倦：最近出现过的权重打折；关着时权重原样', () => {
	const pol = { ...OFF, fatigue: 0.25, fatigueN: 2 };
	let m = emptyMemory();
	m = noteTriggered(m, ev('a', { weight: 8 }), 10, 'random');
	assert.equal(weightOf(ev('a', { weight: 8 }), m, pol), 2);
	assert.equal(weightOf(ev('a', { weight: 8 }), m, OFF), 8);
	assert.equal(weightOf(ev('b', { weight: 8 }), m, pol), 8);
	m = noteTriggered(noteTriggered(m, ev('b'), 11, 'random'), ev('c'), 12, 'random');
	assert.equal(weightOf(ev('a', { weight: 8 }), m, pol), 8, '已经滑出最近 2 个');
	assert.equal(EVENT_POLICY.dailyMax === 0 && EVENT_POLICY.repeatGap === 0 && EVENT_POLICY.fatigue === 1, true, '第一版默认全关，现有事件行为不变【待平衡】');
});

test('链式事件：解锁→出现一次就消耗；过期作废；重复解锁不续期；最早解锁的先出', () => {
	const a = ev('a', { locked: true, unlockDays: 2 });
	const b = ev('b', { locked: true });
	assert.equal(eventReady(a, emptyMemory(), 0, OFF), false, '没解锁');
	let m = noteResolved(emptyMemory(), { text: '', fx: {}, unlocks: ['b'] }, 100);
	m = noteResolved(m, { text: '', fx: {}, unlocks: ['a', 'b'] }, 200);
	assert.deepEqual(m.open, { b: 100, a: 200 }, 'b 不续期');
	assert.equal(eventReady(a, m, 200 + 2 * DAY, OFF), true);
	assert.equal(eventReady(a, m, 200 + 2 * DAY + 1, OFF), false, '过期');
	assert.equal(eventReady(b, m, 1e7, OFF), true, '不写 unlockDays 不过期');
	assert.equal(pickChain([a, ev('n'), b], m)!.id, 'b');
	assert.equal(pickChain([ev('n')], m), null);
	const after = noteTriggered(m, b, 300, 'chain');
	assert.deepEqual(after.open, { a: 200 });
	assert.deepEqual(m.open, { b: 100, a: 200 }, '不改入参');
	assert.equal(noteResolved(m, { text: '', fx: {} }, 5), m, '没有 unlocks 原样返回');
});

test('按权重抽：和第一版之前的累减写法逐个一致', () => {
	const legacy = (pool: GameEvent[], r: number) => {
		let x = r * pool.reduce((s, e) => s + e.weight, 0);
		for (const e of pool) if ((x -= e.weight) <= 0) return e;
		return pool[pool.length - 1];
	};
	// 正好落在分界上算前一个
	const [x, y] = [ev('x'), ev('y')];
	assert.equal(weightedPick([x, y], [1, 1], 0.5), x);
	assert.equal(weightedPick([x, y], [1, 3], 0.25), x);
	assert.equal(weightedPick([x, y], [1, 3], 0.2500001), y);
	const pool = EVENTS.filter((e) => e.weight > 0).slice(0, 30);
	for (let i = 0; i <= 2000; i++) {
		const r = i / 2000 - (i === 2000 ? 1e-12 : 0);
		assert.equal(weightedPick(pool, pool.map((e) => e.weight), r).id, legacy(pool, r).id);
	}
});

// ---------- 引擎：向后兼容 ----------
/** 第一版之前的 pickArrivalEvent 原样搬过来做参照（加上 need/locked 两条新过滤；现有事件都没写） */
function legacyPick(state: PlayerState, loc: GameLocation, mode: TravelMode | null, first: boolean, override: GameEvent | null): GameEvent | null {
	if (state.heat >= HEAT_CHECK_AT) return EVENTS.find((e) => e.id === 'heat-check') ?? null;
	const pool = EVENTS.filter((e) => e.weight > 0 && !e.locked && needMet(e, state) && eventMatches(e, loc, mode, state.clock) && !(e.once && state.seen.includes(e.id)));
	const signature = pool.filter((e) => e.once);
	if (first && signature.length) return signature[Math.floor(roll(state) * signature.length)];
	if (override) return override;
	if (!pool.length) return null;
	if (roll(state) > ARRIVAL_EVENT_CHANCE) return null;
	let r = roll(state) * pool.reduce((s, e) => s + e.weight, 0);
	for (const e of pool) if ((r -= e.weight) <= 0) return e;
	return pool[pool.length - 1];
}
function legacyVenue(state: PlayerState, type: string, chance: number): GameEvent | null {
	const pool = EVENTS.filter((e) => e.weight > 0 && e.venueTypes?.includes(type) && (!e.seasons || e.seasons.includes(dateOf(state.clock).season)) && !(e.once && state.seen.includes(e.id)));
	if (!pool.length || roll(state) > chance) return null;
	let r = roll(state) * pool.reduce((s, e) => s + e.weight, 0);
	for (const e of pool) if ((r -= e.weight) <= 0) return e;
	return pool[pool.length - 1];
}

test('向后兼容：4000 个随机局面里，到达事件和真实地点事件抽到的和第一版之前一样，种子走到同一处', () => {
	let x = 7;
	const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
	const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
	const onces = EVENTS.filter((e) => e.once).map((e) => e.id);
	const breakdowns = EVENTS.filter((e) => e.breakdown);
	const modes: (TravelMode | null)[] = ['road', 'track', 'ferry', 'air', null];
	let hits = 0;
	for (let i = 0; i < 4000; i++) {
		const base = fresh(Math.floor(rnd() * 2 ** 32));
		const s0: PlayerState = {
			...base,
			clock: Math.floor(rnd() * 400 * DAY),
			heat: rnd() < 0.05 ? 70 : Math.floor(rnd() * 50),
			seen: onces.filter(() => rnd() < 0.5),
		};
		const loc = pick(WORLD.locations);
		const mode = pick(modes);
		const first = rnd() < 0.3;
		const override = rnd() < 0.2 ? pick(breakdowns) : null;
		const a = structuredClone(s0);
		const b = structuredClone(s0);
		const want = legacyPick(a, loc, mode, first, override);
		const got = pickArrivalEvent(b, loc, mode, first, override);
		assert.equal(got?.ev.id ?? null, want?.id ?? null, `第 ${i} 个局面`);
		assert.equal(b.seed, a.seed, `第 ${i} 个局面掷骰次数一致`);
		if (want) hits++;
		const type = pick(VENUE_TYPES).id;
		const c = structuredClone(s0);
		const d = structuredClone(s0);
		assert.equal(pickVenueEvent(d, type, 0.35)?.ev.id ?? null, legacyVenue(c, type, 0.35)?.id ?? null);
		assert.equal(d.seed, c.seed);
	}
	assert.ok(hits > 1000, `抽到事件的局面 ${hits}`);
});

test('确定性：同一个种子、同一串动作，结果逐字相同；换种子不同', () => {
	const run = (seed: number) => {
		let s = fresh(seed);
		const out: string[] = [];
		const loc = WA.locations.find((l) => l.id === 'fremantle')!;
		for (let i = 0; i < 200; i++) {
			s = { ...s, clock: s.clock + 97 };
			const p = pickArrivalEvent(s, loc, 'road', false, null);
			out.push(p ? `${p.ev.id}/${p.src}` : '-');
			if (p) startEvent(s, p.ev, p.src);
			if (s.pending) s = resolveEvent(s, WA, 0).state;
		}
		return { out, s };
	};
	const a = run(123), b = run(123), c = run(124);
	assert.deepEqual(a.out, b.out);
	assert.deepEqual(a.s, b.s);
	assert.notDeepEqual(a.out, c.out);
});

// ---------- 引擎：新规则接进抽取（临时往 EVENTS 里加测试事件；node --test 每个文件单独进程） ----------
function withEvents<T>(extra: GameEvent[], fn: () => T): T {
	assert.deepEqual(validateEvents([...EVENTS, ...extra]), [], '测试事件本身要合规');
	const n = EVENTS.length;
	EVENTS.push(...extra);
	try { return fn(); } finally { EVENTS.length = n; }
}

test('事件链：选项解锁后续事件，到了合适的地方优先出（不掷骰）；then 立刻接下一幕', () => {
	const start = ev('t-start', {
		weight: 0,
		choices: [
			{ label: '答应帮忙', ok: { text: '他说过两天在弗里曼特尔等你。', fx: {}, unlocks: ['t-meet'] } },
			{ label: '先听他说完', ok: { text: '他压低声音。', fx: {}, then: 't-whisper' } },
		],
	});
	const meet = ev('t-meet', { locked: true, locs: ['fremantle'], unlockDays: 3 });
	const whisper = ev('t-whisper', { weight: 0, animal: 'bottlenose-dolphin' });
	withEvents([start, meet, whisper], () => {
		const loc = (id: string) => WA.locations.find((l) => l.id === id)!;
		let s = fresh(5);
		startEvent(s, start, 'forced');
		// 选 1：解锁
		const r = resolveEvent(s, WA, 0);
		assert.ok(r.ok);
		assert.equal(r.state.pending, null);
		assert.equal(r.state.evMem.open['t-meet'], s.clock);
		// 别的地方不出
		const elsewhere = structuredClone(r.state);
		assert.notEqual(pickArrivalEvent(elsewhere, loc('perth'), 'road', false, null)?.ev.id, 't-meet');
		// 到弗里曼特尔：链式事件优先，不消耗种子
		s = structuredClone(r.state);
		const seed = s.seed;
		const p = pickArrivalEvent(s, loc('fremantle'), 'road', false, null)!;
		assert.deepEqual([p.ev.id, p.src], ['t-meet', 'chain']);
		assert.equal(s.seed, seed);
		startEvent(s, p.ev, p.src);
		assert.equal(s.evMem.open['t-meet'], undefined, '出现一次就消耗');
		assert.equal(s.evMem.rand, 0, '链式事件不占每日上限');
		// 首次到访的签名事件仍然排在链式事件前面
		const firstVisit = structuredClone(r.state);
		const sig = pickArrivalEvent(firstVisit, loc('fremantle'), 'road', true, null)!;
		assert.equal(sig.src, EVENTS.some((e) => e.once && e.locs?.includes('fremantle')) ? 'signature' : 'chain');
		// 过期：3 天后不再出
		const late = { ...structuredClone(r.state), clock: r.state.clock + 3 * DAY + 1 };
		assert.notEqual(pickArrivalEvent(late, loc('fremantle'), 'road', false, null)?.ev.id, 't-meet');
		// 选 2：then 立刻挂上下一幕
		let s2 = fresh(5);
		startEvent(s2, start, 'forced');
		s2 = resolveEvent(s2, WA, 1).state;
		assert.equal(getPendingEvent(s2)?.id, 't-whisper');
		assert.ok(s2.dex.includes('bottlenose-dolphin'), '下一幕带的动物也记进图鉴（合并 main 后复核）');
		assert.equal(resolveEvent(s2, WA, 0).state.pending, null);
	});
});

test('冷却和条件接进到达抽取：冷却中、条件不满足的事件不会被抽到', () => {
	const hot = ev('t-hot', { locs: ['fremantle'], weight: 1e9, cooldown: 48 });
	const rich = ev('t-rich', { locs: ['fremantle'], weight: 1e12, need: { min: { cash: 1e6 } } });
	withEvents([hot, rich], () => {
		const loc = WA.locations.find((l) => l.id === 'fremantle')!;
		let s = fresh(9);
		let firstAt = -1;
		let n = 0;
		for (let i = 0; i < 300; i++) {
			s = { ...s, clock: s.clock + 60 };
			const p = pickArrivalEvent(s, loc, 'road', false, null);
			assert.notEqual(p?.ev.id, 't-rich', '没钱时不出');
			if (p?.ev.id !== 't-hot') continue;
			if (firstAt >= 0) assert.ok(s.clock - firstAt >= 48 * 60, '冷却 48 小时');
			firstAt = s.clock;
			n++;
			startEvent(s, p.ev, p.src);
			s = resolveEvent(s, WA, 0).state;
		}
		assert.ok(n >= 3, `冷却过后会再出（出了 ${n} 次）`);
	});
});

test('真实地点事件也走同一套规则：链式优先、每日次数', () => {
	const cafeOnce = ev('t-cafe', { venueTypes: ['cafe'], weight: 1e9, daily: 1 });
	withEvents([cafeOnce], () => {
		let s = fresh(11);
		let n = 0;
		for (let i = 0; i < 50; i++) {
			const p = pickVenueEvent(s, 'cafe', 1);
			if (p?.ev.id === 't-cafe') { n++; startEvent(s, p.ev, p.src); s = resolveEvent(s, WA, 0).state; }
		}
		assert.equal(n, 1, '同一天只出 1 次');
		s = { ...s, clock: s.clock + DAY };
		assert.equal(pickVenueEvent(s, 'cafe', 1)?.ev.id, 't-cafe', '第二天又可以');
	});
});

test('全局规则打开后引擎照办：每日上限、不重复（临时改 EVENT_POLICY，测完恢复）', () => {
	const saved = { ...EVENT_POLICY };
	const loc = WA.locations.find((l) => l.id === 'fremantle')!;
	try {
		Object.assign(EVENT_POLICY, { dailyMax: 1, repeatGap: 0 });
		let s = { ...fresh(21), clock: 10 * DAY };
		const perDay = new Map<number, number>();
		for (let i = 0; i < 400; i++) {
			s = { ...s, clock: s.clock + 50 };
			const p = pickArrivalEvent(s, loc, 'road', false, null);
			if (!p) continue;
			assert.equal(p.src, 'random');
			const d = Math.floor(s.clock / DAY);
			perDay.set(d, (perDay.get(d) ?? 0) + 1);
			startEvent(s, p.ev, p.src);
			s = resolveEvent(s, WA, 0).state;
		}
		assert.ok(perDay.size >= 10, `${perDay.size} 天有事件`);
		assert.ok([...perDay.values()].every((n) => n === 1), '每天最多 1 个随机事件');
		Object.assign(EVENT_POLICY, { dailyMax: 0, repeatGap: 3 });
		s = { ...fresh(22), clock: 10 * DAY };
		const seq: string[] = [];
		for (let i = 0; i < 400; i++) {
			s = { ...s, clock: s.clock + 50 };
			const p = pickArrivalEvent(s, loc, 'road', false, null);
			if (!p) continue;
			seq.push(p.ev.id);
			startEvent(s, p.ev, p.src);
			s = resolveEvent(s, WA, 0).state;
		}
		assert.ok(seq.length > 30, `抽到 ${seq.length} 个`);
		seq.forEach((id, i) => assert.ok(!seq.slice(Math.max(0, i - 3), i).includes(id), `第 ${i} 个 ${id} 和前 3 个重复`));
	} finally {
		Object.assign(EVENT_POLICY, saved);
	}
});

// ---------- 存档 ----------
test('存档：旧存档没有 evMem 给空记录；坏值、未知事件、未来时间都清掉；幂等', () => {
	const locs = new Set(WORLD.locations.map((l) => l.id));
	const base = fresh(3);
	assert.deepEqual(base.evMem, emptyMemory());
	const { evMem: _drop, ...old } = base;
	assert.deepEqual(sanitizeState(old, locs)!.evMem, emptyMemory(), '旧存档');
	for (const junk of [null, 7, 'x', [], { day: NaN, recent: 'a', open: [] }]) {
		assert.deepEqual(sanitizeState({ ...base, evMem: junk } as never, locs)!.evMem, emptyMemory(), JSON.stringify(junk));
	}
	const extra = [ev('t-cd', { cooldown: 5 }), ev('t-lock', { locked: true }), ev('t-day', { daily: 1, max: 2 })];
	const all = [...EVENTS, ...extra];
	const today = Math.floor(base.clock / DAY);
	const raw = JSON.parse(`{"day":${today},"rand":3,"today":{"t-day":1,"t-cd":4,"__proto__":1},"last":{"t-cd":${base.clock + 999},"quokka-selfie":5},"n":{"t-day":2.7,"gone":1},"recent":["t-cd","gone",3,"quokka-selfie"],"open":{"t-lock":-5,"t-cd":1}}`);
	const m = cleanEvMem(raw, all, base.clock);
	assert.deepEqual(m, { day: today, rand: 3, today: { 't-day': 1 }, last: { 't-cd': base.clock }, n: { 't-day': 2 }, recent: ['t-cd', 'quokka-selfie'], open: {} });
	assert.equal(Object.getPrototypeOf(m.today), Object.prototype);
	assert.deepEqual(cleanEvMem(m, all, base.clock), m, '幂等');
	// 换日：今天的计数作废；记号晚于今天视为坏值
	assert.deepEqual(cleanEvMem({ ...raw, day: today - 1 }, all, base.clock).today, {});
	assert.equal(cleanEvMem({ ...raw, day: today + 5 }, all, base.clock).day, -1);
	assert.equal(cleanEvMem({ ...raw, day: today + 5 }, all, base.clock).rand, 0);
	// 走一遍 sanitizeState 也幂等
	const once = sanitizeState({ ...base, evMem: raw }, locs)!;
	assert.deepEqual(sanitizeState(once, locs), once);
});

test('startEvent 统一做事件的附带效果：被查挂上「有麻烦」状态（合并 main 后复核）', () => {
	const heat = EVENTS.find((e) => e.id === 'heat-check');
	assert.ok(heat, '数据里有被查事件');
	const s = fresh(3);
	startEvent(s, heat!, 'forced');
	assert.equal(s.pending?.eventId, 'heat-check');
	assert.ok(s.moodlets.some((m) => m.id === 'in-trouble'), '挂上了「有麻烦」');
	assert.deepEqual(s.evMem.recent.slice(-1), ['heat-check']);
});
