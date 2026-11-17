// 野生动物图鉴：数据自洽、抵达时可能看见、不消耗随机种子、事件里的动物也记、集齐一组只发一次奖、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { achievements } from '../../src/game/core/achievements.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { animalsAt, dexProgress, getLocation, travel } from '../../src/game/core/engine.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { ANIMALS, DEX_GROUPS } from '../../src/game/data/wildlife.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, seed = 3): PlayerState => ({
	...createCharacter({ id: 'dex-player', name: '鉴', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(10),
	cash: 5000,
	...over,
});
const ALL = ANIMALS.map((a) => a.id);

test('图鉴数据：id 唯一、分组有效、几率在 0–1、每种动物至少有一个地方能遇到；事件里写的动物都存在', () => {
	assert.equal(new Set(ALL).size, ALL.length);
	for (const a of ANIMALS) {
		assert.ok(Object.hasOwn(DEX_GROUPS, a.group), a.id);
		assert.ok(a.chance > 0 && a.chance < 1, a.id);
		for (const l of a.where.locs ?? []) assert.ok(getLocation(WA, l), `${a.id} 的地点 ${l} 存在`);
		const somewhere = WA.locations.some((l) => a.where.locs?.includes(l.id) || a.where.kinds?.includes(l.kind) || a.where.tags?.some((t) => l.tags.includes(t)));
		assert.ok(somewhere, `${a.id} 有地方能遇到`);
	}
	for (const g of Object.keys(DEX_GROUPS)) assert.ok(ANIMALS.some((a) => a.group === g), `${g} 组不为空`);
	for (const e of EVENTS) if (e.animal) assert.ok(ALL.includes(e.animal), `${e.id} 的动物 ${e.animal}`);
});

test('季节和时段：只在对应季节、时段出现；见过的不再列出', () => {
	const rott = getLocation(WA, 'rottnest')!;
	assert.ok(animalsAt(make(), rott).some((a) => a.id === 'quokka'));
	assert.ok(!animalsAt(make({ dex: ['quokka'] }), rott).some((a) => a.id === 'quokka'));
	const albany = getLocation(WA, 'albany')!;
	// 第 0 天是春季；冬季从第 3 个季度开始
	const winter = ANIMALS.find((a) => a.id === 'southern-right-whale')!;
	assert.ok(!animalsAt(make({ clock: at(10) }), albany).includes(winter), '春天没有南露脊鲸');
	const perth = getLocation(WA, 'perth')!;
	assert.ok(!animalsAt(make({ clock: at(12) }), perth).some((a) => a.id === 'quenda'), '白天看不到短鼻袋狸');
	assert.ok(animalsAt(make({ clock: at(22) }), perth).some((a) => a.id === 'quenda'), '夜里能看到');
});

test('抵达时看见动物：不消耗随机种子，不改变到达事件；每次最多新记一只（事件里的动物另算）', () => {
	let spotted = 0;
	for (let seed = 1; seed <= 200; seed++) {
		const fresh = travel(make({}, seed), WA, 'fremantle', 'road');
		const full = travel(make({ dex: [...ALL] }, seed), WA, 'fremantle', 'road');
		assert.ok(fresh.ok && full.ok);
		assert.equal(fresh.state.seed, full.state.seed, `seed ${seed}：图鉴不推进种子`);
		assert.deepEqual(fresh.state.pending, full.state.pending, `seed ${seed}：到达事件一样`);
		const ev = EVENTS.find((e) => e.id === fresh.state.pending?.eventId);
		const fromEvent = ev?.animal ? 1 : 0;
		assert.ok(fresh.state.dex.length <= 1 + fromEvent, `seed ${seed}：最多一只`);
		if (fresh.state.dex.length > fromEvent) spotted++;
	}
	assert.ok(spotted > 0, '200 次里总能看见几次');
});

test('首次到罗特尼斯岛的短尾矮袋鼠事件会记进图鉴；补齐陆地组发一次声望，再集齐也不重发', () => {
	const land = ANIMALS.filter((a) => a.group === 'land').map((a) => a.id);
	const s = make({ loc: 'fremantle', visited: { perth: 1, fremantle: 1 }, dex: land.filter((id) => id !== 'quokka') });
	const r = travel(s, WA, 'rottnest', 'ferry');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.pending?.eventId, 'quokka-selfie');
	assert.ok(r.state.dex.includes('quokka'));
	assert.deepEqual(r.state.dexSets, ['land']);
	assert.equal(r.state.respect - s.respect, 1 + DEX_GROUPS.land.respect, '首次到访 +1，集齐陆地 +4');
	assert.ok(r.state.journal.some((j) => /陆地动物全部见过了/.test(j.text)));
	assert.equal(dexProgress(r.state).find((g) => g.group === 'land')!.done, true);
	// 已经发过奖：存档里记着，不再发
	const again = travel({ ...s, dexSets: ['land'] }, WA, 'rottnest', 'ferry');
	assert.equal(again.state.respect - s.respect, 1);
});

test('存档校验：去掉不认识的动物和分组、去重；旧存档补空列表；成就按图鉴数计', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const s = sanitizeState({ ...make(), dex: ['quokka', 'quokka', 'dragon', 5], dexSets: ['land', 'land', 'toString', 'x'] }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(s.dex, ['quokka']);
	assert.deepEqual(s.dexSets, ['land']);
	const old: Record<string, unknown> = { ...make() };
	delete old.dex;
	delete old.dexSets;
	const o = sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual([o.dex, o.dexSets], [[], []]);
	const a = achievements(make({ dex: ALL.slice(0, 5) }), WA).find((x) => x.def.id === 'dex-5')!;
	assert.ok(a.done);
});
