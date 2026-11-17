// 钓鱼：数据自洽、要鱼竿、风暴天不行、按季节时段天气筛鱼、钓到当场卖钱并记进鱼获、生存能力降低空手几率、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { fishingAt, goFishing } from '../../src/game/core/engine.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { FISH, FISHING } from '../../src/game/data/fish.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, seed = 3): PlayerState => ({
	...createCharacter({ id: 'fish-player', name: '钓', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(10),
	cash: 500,
	inventory: { rod: 1 },
	...over,
});
/** 某地点第一个不是风暴的游戏日 */
const calmDay = (loc: string, from = 0) => {
	for (let d = from; d < from + 200; d++) if (!weatherOn(loc, d).closesSea) return d;
	throw new Error('没有平静的日子');
};

test('鱼种数据：id 唯一、价格权重为正、每种鱼至少有一个地方能钓到；鱼竿能在钓鱼的地方买到', () => {
	assert.equal(new Set(FISH.map((f) => f.id)).size, FISH.length);
	for (const f of FISH) {
		assert.ok(f.price > 0 && f.weight > 0, f.id);
		for (const l of f.where.locs ?? []) assert.ok(WA.locations.some((x) => x.id === l), `${f.id} 的地点 ${l}`);
		assert.ok(WA.locations.some((l) => f.where.locs?.includes(l.id) || f.where.kinds?.includes(l.kind) || f.where.tags?.some((t) => l.tags.includes(t))), f.id);
	}
	assert.ok(ITEMS.some((i) => i.id === FISHING.rod));
});

test('能不能钓：内陆没有水不显示；没鱼竿、风暴天、有待处理事件都不行', () => {
	assert.equal(fishingAt(make({ loc: 'wave-rock' }), WA), null);
	const d = calmDay('fremantle');
	const s = make({ loc: 'fremantle', clock: at(10, d) });
	assert.equal(fishingAt(s, WA)!.blocked, undefined);
	assert.match(fishingAt({ ...s, inventory: {} }, WA)!.blocked!, /鱼竿/);
	assert.equal(goFishing({ ...s, inventory: {} }, WA).ok, false);
	assert.equal(goFishing({ ...s, pending: { eventId: 'quokka-selfie' } }, WA).ok, false);
	for (let day = 0; day < 200; day++) {
		if (!weatherOn('fremantle', day).closesSea) continue;
		const storm = make({ loc: 'fremantle', clock: at(10, day) });
		assert.match(fishingAt(storm, WA)!.blocked!, /风暴/);
		assert.equal(goFishing(storm, WA).ok, false);
		break;
	}
});

test('季节和时段：黑鲷只在清晨傍晚，枪乌贼只在天黑后，澳洲鲑只在秋天', () => {
	const d = calmDay('fremantle');
	const noon = fishingAt(make({ loc: 'fremantle', clock: at(12, d) }), WA)!.fish.map((f) => f.id);
	const dusk = fishingAt(make({ loc: 'fremantle', clock: at(18, d) }), WA)!.fish.map((f) => f.id);
	assert.ok(!noon.includes('black-bream') && dusk.includes('black-bream'));
	assert.ok(!noon.includes('squid') && dusk.includes('squid'));
	// 一季 28 天：第 0–27 天春，第 56–83 天秋
	const spring = fishingAt(make({ loc: 'albany', clock: at(12, calmDay('albany', 0)) }), WA)!.fish.map((f) => f.id);
	const autumn = fishingAt(make({ loc: 'albany', clock: at(12, calmDay('albany', 56)) }), WA)!.fish.map((f) => f.id);
	assert.ok(!spring.includes('salmon') && autumn.includes('salmon'));
});

test('钓一次：花时间和体力；钓到就卖钱、记进鱼获；不改入参；结果可复现', () => {
	const d = calmDay('fremantle');
	let caught = 0;
	let empty = 0;
	for (let seed = 1; seed <= 100; seed++) {
		const s = make({ loc: 'fremantle', clock: at(10, d) }, seed);
		const before = structuredClone(s);
		const r = goFishing(s, WA);
		assert.ok(r.ok, r.msg);
		assert.deepEqual(s, before, '不改入参');
		assert.deepEqual(goFishing(s, WA), r, '同样的存档钓出同样的结果');
		assert.equal(r.state.clock, s.clock + FISHING.minutes);
		const got = Object.keys(r.state.fish);
		if (got.length) {
			caught++;
			const f = FISH.find((x) => x.id === got[0])!;
			assert.equal(r.state.cash, s.cash + f.price);
			assert.ok(fishingAt(s, WA)!.fish.includes(f), '只会钓到此刻能钓的鱼');
		} else {
			empty++;
			assert.equal(r.state.cash, s.cash);
		}
	}
	assert.ok(caught > 0 && empty > 0, `钓到 ${caught} 次、空手 ${empty} 次`);
});

test('生存能力越高越不容易空手', () => {
	const d = calmDay('fremantle');
	const count = (survival: number) => {
		let n = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const base = make({ loc: 'fremantle', clock: at(10, d) }, seed);
			const r = goFishing({ ...base, skills: { ...base.skills, survival } }, WA);
			if (Object.keys(r.state.fish).length) n++;
		}
		return n;
	};
	assert.ok(count(90) > count(0));
});

test('走动作协议；存档校验去掉不认识的鱼和非法条数', () => {
	assert.deepEqual(parseAction({ t: 'fish' }), { t: 'fish' });
	assert.deepEqual(parseAction({ t: 'course', id: 'x' }), { t: 'course', id: 'x' }, '课程动作没被钓鱼吞掉');
	const d = calmDay('fremantle');
	const r = applyAction(make({ loc: 'fremantle', clock: at(10, d) }), WA, { t: 'fish' });
	assert.ok(r.ok && r.state.rev === 1);
	const locs = new Set(WA.locations.map((l) => l.id));
	const s = sanitizeState({ ...make(), fish: { herring: 3.7, shark: 2, whiting: -1, squid: 'x' } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(s.fish, { herring: 3 });
	const old: Record<string, unknown> = { ...make() };
	delete old.fish;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.fish, {});
});
