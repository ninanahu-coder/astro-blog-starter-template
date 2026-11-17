// 随机动作序列的回归测试：多种出身、特质和随机动作（大部分合法，少量故意不合法）连续执行，
// 检查引擎不抛异常、不改入参、数值始终有限且在范围内，服务端的规范化（sanitizeState）对结果是稳定的。
// 随机数用固定种子，失败时能按 seed 复现。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, type GameAction } from '../../src/game/core/actions.ts';
import { CAPS, createCharacter, ORIGINS, sanitizeState } from '../../src/game/core/character.ts';
import { activitiesAt, careersAt, certsAt, coursesAt, garageAt, dealerAt, experiencesAt, furnitureAt, getPendingEvent, homeActionBlocked, homesAt, npcsAt, propertiesAt, shiftBlocked, shopAt, travelOptions } from '../../src/game/core/engine.ts';
import { NEED_KEYS, SKILL_KEYS, type PlayerState } from '../../src/game/core/types.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { COURSES } from '../../src/game/data/courses.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';
import { FURNITURE, FURNITURE_SLOTS } from '../../src/game/data/furniture.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { TRAITS } from '../../src/game/data/traits.ts';
import { CAR_KM_MAX, DEALER_HOURS, VEHICLES } from '../../src/game/data/vehicles.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { isOpen } from '../../src/game/core/time.ts';
import { VENUE_OPS, VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';

const LOCS = new Set(WA.locations.map((l) => l.id));

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomAction(s: PlayerState, r: () => number, now: number): GameAction {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const pending = getPendingEvent(s);
	if (pending && r() < 0.85) return { t: 'event', choice: Math.floor(r() * (pending.choices.length + 1)) };
	const roll = r();
	if (roll < 0.22) {
		const opts = travelOptions(s, WA);
		if (opts.length) { const o = pick(opts); return { t: 'travel', to: o.to, mode: o.mode }; }
	}
	if (roll < 0.45) return { t: 'activity', id: pick(ACTIVITIES).id };
	if (roll < 0.5) {
		const act = pick(['chat', 'help', 'perk', 'gift'] as const);
		// 只有送礼可以带物品（协议如此）；送礼不带物品时自动挑
		return act === 'gift' && r() < 0.6 ? { t: 'npc', npc: pick(NPCS).id, act, item: pick(ITEMS).id } : { t: 'npc', npc: pick(NPCS).id, act };
	}
	if (roll < 0.55) return { t: 'buy', item: pick(ITEMS).id };
	if (roll < 0.58) return { t: 'use', item: pick(ITEMS).id };
	if (roll < 0.63) return r() < 0.5 ? { t: 'job', op: 'apply', career: pick(CAREERS).id } : { t: 'job', op: pick(['work', 'work', 'quit'] as const) };
	if (roll < 0.69) return r() < 0.3 ? { t: 'home', op: 'rent', home: pick(HOMES).id } : { t: 'home', op: pick(['sleep', 'sleep', 'cook', 'relax', 'leave'] as const) };
	if (roll < 0.72) return r() < 0.7 ? { t: 'furniture', op: 'buy', id: pick(FURNITURE).id } : { t: 'furniture', op: 'sell', slot: pick(Object.keys(FURNITURE_SLOTS)) };
	if (roll < 0.75) return r() < 0.6 ? { t: 'vehicle', op: 'buy', id: pick(VEHICLES).id } : { t: 'vehicle', op: pick(['sell', 'sleep'] as const) };
	if (roll < 0.8) {
		const id = pick(PROPERTIES).id;
		const op = pick(['buy', 'buy', 'sell', 'movein', 'rentout', 'repay'] as const);
		if (op === 'buy') return { t: 'property', op, id, loan: r() < 0.6 };
		if (op === 'repay') return { t: 'property', op, id, amount: Math.floor(r() * 50000) + 1 };
		return { t: 'property', op, id };
	}
	if (roll < 0.81) return { t: 'course', id: pick(COURSES).id };
	if (roll < 0.83) return r() < 0.5 ? { t: 'cert', id: pick(CERTS).id } : { t: 'vehicle', op: 'service' };
	if (roll < 0.86) return { t: 'experience', id: pick(EXPERIENCES).id };
	if (roll < 0.95 && WA.venues.length) {
		// 真实地点：大多站在店门口，偶尔离得很远或精度很差
		const v = pick(WA.venues);
		const far = r() < 0.2;
		return { t: 'venue', venue: v.id, op: pick(VENUE_OPS).id, lat: v.lat + (far ? 0.05 : 0), lon: v.lon, acc: r() < 0.1 ? 500 : 10 };
	}
	if (roll < 0.98) {
		const l = pick(WA.locations);
		return { t: 'gps', lat: l.lat, lon: l.lon };
	}
	return { t: 'activity', id: 'no-such-activity' };
}

/** 看当前状态挑一个大概率能成功的动作（覆盖各类动作的成功路径）；没有可做的就退回纯随机 */
function smartAction(s: PlayerState, r: () => number, now: number): GameAction {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const pending = getPendingEvent(s);
	if (pending) return { t: 'event', choice: Math.floor(r() * pending.choices.length) };
	const c: GameAction[] = [];
	for (const x of activitiesAt(s, WA)) if (!x.blocked) c.push({ t: 'activity', id: x.act.id });
	for (const o of travelOptions(s, WA)) if (o.available) c.push({ t: 'travel', to: o.to, mode: o.mode });
	for (const n of npcsAt(s, WA)) for (const act of ['chat', 'help', 'gift', 'perk'] as const) if (act in n.blocked && !n.blocked[act]) c.push({ t: 'npc', npc: n.npc.id, act });
	for (const x of shopAt(s, WA)) if (!x.blocked) c.push({ t: 'buy', item: x.item.id });
	for (const id of Object.keys(s.inventory)) if (s.inventory[id] > 0 && ITEMS.find((i) => i.id === id)?.use) c.push({ t: 'use', item: id });
	for (const x of careersAt(s, WA)) if (!x.blocked) c.push({ t: 'job', op: 'apply', career: x.career.id });
	if (s.job && !shiftBlocked(s)) c.push({ t: 'job', op: 'work' }, { t: 'job', op: 'work' }, { t: 'job', op: 'work' });
	if (s.job && s.loc !== s.job.loc) for (const o of travelOptions(s, WA)) if (o.available && o.to === s.job.loc) c.push({ t: 'travel', to: o.to, mode: o.mode });
	for (const x of homesAt(s, WA)) if (!x.blocked) c.push({ t: 'home', op: 'rent', home: x.home.id });
	if (s.home && s.home.loc === s.loc) {
		c.push({ t: 'home', op: 'sleep' });
		for (const op of ['cook', 'relax'] as const) if (!homeActionBlocked(s, op)) c.push({ t: 'home', op });
	}
	if (s.home) for (const x of furnitureAt(s)) {
		if (x.owned) c.push({ t: 'furniture', op: 'sell', slot: x.item.slot });
		else if (!x.blocked) c.push({ t: 'furniture', op: 'buy', id: x.item.id });
	}
	const dealer = dealerAt(s, WA);
	for (const x of dealer) if (!x.blocked) c.push({ t: 'vehicle', op: 'buy', id: x.vehicle.id });
	// 车行开着门（有可买的车不是因为营业时间被拦）才去卖车
	if (s.vehicle !== 'none' && dealer.length && isOpen(DEALER_HOURS, s.clock)) c.push({ t: 'vehicle', op: 'sell' }, { t: 'vehicle', op: 'sell' });
	if (VEHICLES.find((v) => v.id === s.vehicle)?.sleep) c.push({ t: 'vehicle', op: 'sleep' });
	for (const x of propertiesAt(s, WA)) {
		if (!x.owned && !x.blockedCash) c.push({ t: 'property', op: 'buy', id: x.property.id, loan: false });
		if (!x.owned && !x.blockedLoan) c.push({ t: 'property', op: 'buy', id: x.property.id, loan: true });
	}
	for (const o of s.properties) {
		c.push({ t: 'property', op: 'rentout', id: o.id }, { t: 'property', op: 'movein', id: o.id });
		if (o.loan > 0 && s.cash > 0) c.push({ t: 'property', op: 'repay', id: o.id, amount: Math.max(1, Math.floor(Math.min(s.cash, o.loan) * r())) });
		if (r() < 0.2) c.push({ t: 'property', op: 'sell', id: o.id });
	}
	for (const x of coursesAt(s, WA)) if (!x.blocked) c.push({ t: 'course', id: x.course.id });
	for (const x of certsAt(s, WA)) if (!x.blocked) c.push({ t: 'cert', id: x.cert.id });
	if (garageAt(s, WA) && !garageAt(s, WA)!.blocked) c.push({ t: 'vehicle', op: 'service' });
	for (const x of experiencesAt(s, WA)) if (!x.blocked) c.push({ t: 'experience', id: x.exp.id });
	const here = WA.venues.filter((v) => v.loc === s.loc);
	if (here.length) {
		// 只挑这类地点有的动作，站在门口、精度 10 米
		const v = pick(here);
		const ops = VENUE_TYPES.find((t) => t.id === v.type)?.ops ?? [];
		for (let i = 0; i < 3 && ops.length; i++) c.push({ t: 'venue', venue: v.id, op: pick(ops), lat: v.lat, lon: v.lon, acc: 10 });
	}
	return c.length ? pick(c) : randomAction(s, r, now);
}

/** 动作的统计键：类型 + 子操作 */
const keyOf = (a: GameAction) => a.t + ('op' in a ? ':' + a.op : '');

function checkInvariants(s: PlayerState, where: string) {
	const inRange = (v: number, lo: number, hi: number, name: string) => {
		assert.ok(Number.isFinite(v), `${where}: ${name} 不是有限数 (${v})`);
		assert.ok(v >= lo && v <= hi, `${where}: ${name}=${v} 超出 [${lo}, ${hi}]`);
	};
	for (const k of NEED_KEYS) inRange(s.needs[k], 0, 100, 'needs.' + k);
	for (const k of SKILL_KEYS) inRange(s.skills[k], 0, 100, 'skills.' + k);
	inRange(s.health, 0, 100, 'health');
	inRange(s.heat, 0, 100, 'heat');
	inRange(s.cash, 0, CAPS.cash, 'cash');
	inRange(s.respect, 0, CAPS.respect, 'respect');
	inRange(s.clock, 0, CAPS.clock, 'clock');
	inRange(s.rev, 0, CAPS.rev - 1, 'rev');
	assert.ok(LOCS.has(s.loc), `${where}: 所在地 ${s.loc} 不存在`);
	for (const p of s.properties) inRange(p.loan, 0, CAPS.cash, `properties.${p.id}.loan`);
	inRange(s.car.km, 0, CAR_KM_MAX, 'car.km');
	inRange(s.car.since, 0, s.car.km, 'car.since');
	if (s.vehicle === 'none') assert.deepEqual(s.car, { km: 0, since: 0 }, `${where}: 没车却有里程`);
}

test('随机动作序列：不抛异常、不改入参、数值在范围内、服务端规范化稳定', () => {
	const RUNS = 60;
	const STEPS = 120;
	let ok = 0;
	const stats: Record<string, { tried: number; ok: number }> = {};
	for (let run = 0; run < RUNS; run++) {
		const r = rng(1000 + run);
		const origin = ORIGINS[run % ORIGINS.length].id;
		const traits = run % 3 === 0 ? [] : [TRAITS[run % TRAITS.length].id, TRAITS[(run * 7 + 3) % TRAITS.length].id];
		let s = createCharacter({ id: 'fuzz-' + run, name: '随机' + run, avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 + run, traits: [...new Set(traits)] });
		// 三分之一的角色开局很有钱，让买车、买房、贷款这些路径也能走到
		if (run % 3 === 2) s = { ...s, cash: 300_000 };
		s = sanitizeState(s, LOCS, { fallbackLoc: WA.spawn }) ?? s;
		let now = 1_800_000_000_000 + run * 3_600_000;
		for (let step = 0; step < STEPS; step++) {
			const where = `seed ${1000 + run} 第 ${step} 步`;
			now += Math.floor(r() * 3 * 3_600_000); // 现实时间往前走 0–3 小时，让冷却和上班卡有机会到期
			const a = r() < 0.75 ? smartAction(s, r, now) : randomAction(s, r, now);
			// 动作要能通过网络协议的校验（和服务端一样先 parseAction）
			const parsed = parseAction(JSON.parse(JSON.stringify(a)));
			assert.ok(parsed, `${where}: parseAction 拒绝了合法格式 ${JSON.stringify(a)}`);
			const before = structuredClone(s);
			const res = applyAction(s, WA, parsed!, now);
			assert.deepEqual(s, before, `${where}: ${a.t} 改了入参`);
			const k = keyOf(a);
			const st = (stats[k] ??= { tried: 0, ok: 0 });
			st.tried++;
			// 引擎直接输出的状态也要在范围内（不能指望服务端的清洗兜底）
			checkInvariants(res.state, where + ` ${k} 引擎直接输出`);
			if (res.ok) {
				ok++;
				st.ok++;
				assert.equal(res.state.rev, (before.rev + 1) % CAPS.rev, `${where}: 成功的动作版本号没 +1`);
			}
			// 服务端落盘前会再清洗一次（canon）；清洗结果必须可用，且再清洗一次不变
			const canon = sanitizeState(res.state, LOCS, { fallbackLoc: WA.spawn, now });
			assert.ok(canon, `${where}: ${a.t} 之后的存档清洗失败`);
			assert.deepEqual(sanitizeState(canon, LOCS, { fallbackLoc: WA.spawn, now }), canon, `${where}: 清洗不稳定`);
			checkInvariants(canon!, where);
			s = canon!;
		}
	}
	// 主要动作的成功路径都要真的走到过，不然这个测试只在测「失败路径」
	const MUST = ['travel', 'activity', 'event', 'gps', 'buy', 'use', 'npc', 'job:apply', 'job:work', 'job:quit', 'home:rent', 'home:sleep', 'home:cook', 'home:relax',
		'furniture:buy', 'furniture:sell', 'vehicle:buy', 'vehicle:sell', 'property:buy', 'property:rentout', 'property:movein', 'property:repay', 'property:sell', 'course', 'cert', 'vehicle:service', 'experience', 'venue:meal', 'venue:work'];
	const missing = MUST.filter((k) => !stats[k]?.ok);
	assert.deepEqual(missing, [], `这些动作一次都没成功过：${missing.join('、')}；统计 ${JSON.stringify(stats)}`);
	assert.ok(ok > 60 * 120 * 0.3, `成功的动作太少：${ok}`);
});
