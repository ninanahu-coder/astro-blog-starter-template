// 随机动作序列的回归测试：多种出身、特质和随机动作（大部分合法，少量故意不合法）连续执行，
// 检查引擎不抛异常、不改入参、数值始终有限且在范围内，服务端的规范化（sanitizeState）对结果是稳定的。
// 随机数用固定种子，失败时能按 seed 复现。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, type GameAction } from '../../src/game/core/actions.ts';
import { CAPS, createCharacter, ORIGINS, sanitizeState } from '../../src/game/core/character.ts';
import { getPendingEvent, travelOptions } from '../../src/game/core/engine.ts';
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
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { VENUE_OPS } from '../../src/game/data/venues.ts';
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
	if (roll < 0.83) return { t: 'course', id: pick(COURSES).id };
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
}

test('随机动作序列：不抛异常、不改入参、数值在范围内、服务端规范化稳定', () => {
	const RUNS = 60;
	const STEPS = 120;
	let ok = 0;
	for (let run = 0; run < RUNS; run++) {
		const r = rng(1000 + run);
		const origin = ORIGINS[run % ORIGINS.length].id;
		const traits = run % 3 === 0 ? [] : [TRAITS[run % TRAITS.length].id, TRAITS[(run * 7 + 3) % TRAITS.length].id];
		let s = createCharacter({ id: 'fuzz-' + run, name: '随机' + run, avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 + run, traits: [...new Set(traits)] });
		s = sanitizeState(s, LOCS, { fallbackLoc: WA.spawn }) ?? s;
		let now = 1_800_000_000_000 + run * 3_600_000;
		for (let step = 0; step < STEPS; step++) {
			const where = `seed ${1000 + run} 第 ${step} 步`;
			now += Math.floor(r() * 3 * 3_600_000); // 现实时间往前走 0–3 小时，让冷却和上班卡有机会到期
			const a = randomAction(s, r, now);
			// 动作要能通过网络协议的校验（和服务端一样先 parseAction）
			const parsed = parseAction(JSON.parse(JSON.stringify(a)));
			assert.ok(parsed, `${where}: parseAction 拒绝了合法格式 ${JSON.stringify(a)}`);
			const before = structuredClone(s);
			const res = applyAction(s, WA, parsed!, now);
			assert.deepEqual(s, before, `${where}: ${a.t} 改了入参`);
			if (res.ok) {
				ok++;
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
	// 随机动作里得有相当一部分是成功的，不然这个测试只在测「失败路径」
	assert.ok(ok > 60 * 120 * 0.2, `成功的动作太少：${ok}`);
});
