// 第 23 批：隐藏属性（体质 → 精力上限 / 省力 / 恢复；睡眠；压力；维生素）怎么牵动精力和健康。
// 数值都是「待平衡」，测试只锁公式结构：改数值改 HIDDEN / VITALS，不用改这里。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import { derivedStats } from '../../src/game/core/formulas.ts';
import { performActivity, useItem } from '../../src/game/core/engine.ts';
import { bodyScaled, DECAY, energyCap, gainNeed, HIDDEN, moodletRegenMult, needRate, passTime, stress, VITALS, vitalsTick } from '../../src/game/core/vitals.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { Needs, PlayerState, Skills } from '../../src/game/core/types.ts';

const make = (needs: Partial<Needs> = {}, extra: Partial<PlayerState> = {}, skills: Partial<Skills> = {}): PlayerState => {
	const s = createCharacter({ id: 'hidden-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 3 });
	return { ...s, ...extra, needs: { ...s.needs, ...needs }, skills: { ...s.skills, ...skills } };
};
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≈ ${b}`);
const weak = () => make({}, {}, { stamina: 5, strength: 5, swimming: 5 });
const fit = () => make({}, {}, { stamina: 100, strength: 100, swimming: 100 });

test('精力上限 = base + 体质 × perFitness，最高 100；练体能会永久提高', () => {
	near(energyCap(weak()), HIDDEN.energyCap.base + derivedStats(weak()).fitness * HIDDEN.energyCap.perFitness);
	assert.equal(energyCap(fit()), 100);
	assert.ok(energyCap(make({}, {}, { stamina: 60 })) > energyCap(make({}, {}, { stamina: 30 })), '体能越高上限越高');
	assert.ok(energyCap(weak()) < 100);
});

test('精力增加不超过上限，但不会把本来更高的精力拉低；其他需求照常钳到 100', () => {
	const s = weak();
	const cap = energyCap(s);
	s.needs.energy = cap - 10;
	gainNeed(s, 'energy', 50);
	near(s.needs.energy, cap);
	s.needs.energy = 99;
	gainNeed(s, 'energy', 5);
	assert.equal(s.needs.energy, 99, '老存档的高精力不被压低');
	gainNeed(s, 'energy', -9);
	assert.equal(s.needs.energy, 90, '扣减不受上限影响');
	s.needs.fun = 95;
	gainNeed(s, 'fun', 20);
	assert.equal(s.needs.fun, 100);
});

test('睡着时：精力不降，饱食 / 娱乐 / 社交按睡眠倍率，清洁照常', () => {
	const s = make({ fun: 10, social: 10 }); // 醒着压力很大，睡着不算压力
	for (const k of ['hunger', 'energy', 'hygiene', 'fun', 'social'] as const) near(needRate(s, k, true), DECAY[k] * HIDDEN.sleepDecay[k], k);
	const before = { ...s.needs };
	passTime(s, 480, true);
	assert.equal(s.needs.energy, before.energy);
	near(s.needs.hunger, before.hunger - DECAY.hunger * HIDDEN.sleepDecay.hunger * 480);
	assert.equal(vitalsTick(make({ hunger: 80, energy: 0 }), 60, true).starveMin, 0, '睡着时精力不会继续见底');
});

test('压力：娱乐或社交跌到 stressAt 以下开始有，让醒着时饿得更快', () => {
	assert.equal(stress(make({ fun: 80, social: 80 })), 0);
	near(stress(make({ fun: HIDDEN.stressAt / 2, social: 80 })), 0.5);
	assert.equal(stress(make({ fun: 80, social: 0 })), 1);
	near(needRate(make({ social: 0 }), 'hunger'), DECAY.hunger * (1 + HIDDEN.hungerPerStress));
	near(needRate(make({ social: 0 }), 'energy'), DECAY.energy, '压力只影响饱食');
	// 压力看流逝前的娱乐 / 社交：同一段时间里，社交低的人饱食掉得更多
	const calm = make({ hunger: 80 });
	const tense = make({ hunger: 80, social: 0 });
	passTime(calm, 60);
	passTime(tense, 60);
	assert.ok(tense.needs.hunger < calm.needs.hunger);
});

test('体质：消耗的精力 × 体力消耗系数，睡觉恢复的精力 × 恢复系数，其他不变', () => {
	const w = weak();
	const f = fit();
	const work = { minutes: 60, needs: { energy: -20, fun: -5 } };
	near(bodyScaled(f, work).needs!.energy!, Math.round(-20 * derivedStats(f).exertion * 10) / 10);
	assert.equal(bodyScaled(f, work).needs!.fun, -5);
	assert.ok(bodyScaled(f, work).needs!.energy! > bodyScaled(w, work).needs!.energy!, '体质好更省力');
	const nap = { minutes: 60, asleep: true, needs: { energy: 40 } };
	near(bodyScaled(f, nap).needs!.energy!, Math.round(40 * derivedStats(f).recovery * 10) / 10);
	assert.equal(bodyScaled(f, { needs: { energy: 40 } }).needs!.energy, 40, '醒着加的精力（咖啡等）不乘恢复系数');
	assert.deepEqual(bodyScaled(f, { cash: 5 }), { cash: 5 });
});

test('接进引擎：同样的活动，体质好的人精力剩得多；露营醒来不超过上限', () => {
	const w = performActivity(weak(), WA, 'recycle'); // 哪里都能做，精力 −8
	const f = performActivity(fit(), WA, 'recycle');
	assert.ok(w.ok && f.ok);
	assert.ok(f.state.needs.energy > w.state.needs.energy, '体质好更省力');
	const camp = performActivity(make({ energy: 70 }, {}, { stamina: 5, strength: 5, swimming: 5 }), WA, 'sleep-camp');
	assert.ok(camp.ok);
	near(camp.state.needs.energy, energyCap(camp.state));
	const motel = performActivity(make({ energy: 5 }, { cash: 500 }, { stamina: 5, strength: 5, swimming: 5 }), WA, 'sleep-motel');
	near(motel.state.needs.energy, energyCap(motel.state));
	assert.ok(motel.state.needs.energy < 100);
});

test('接进引擎：睡觉的动作按睡眠倍率结算饱食', () => {
	const r = performActivity(make({ hunger: 80, fun: 80, social: 80 }), WA, 'sleep-camp');
	assert.ok(r.ok);
	near(r.state.needs.hunger, 80 - DECAY.hunger * HIDDEN.sleepDecay.hunger * 480, '露营 8 小时饱食按睡眠倍率掉');
	const awake = performActivity(make({ hunger: 80, fun: 80, social: 80 }), WA, 'lay-low'); // 醒着的 5 小时
	near(awake.state.needs.hunger, 80 - DECAY.hunger * 300);
});

test('维生素：吃一片得到「吃了维生素」，期间健康自然恢复 × regen', () => {
	const s = make({ hunger: 100, energy: 100 }, { inventory: { vitamins: 1 }, health: 50 });
	const r = useItem(s, WA, 'vitamins');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.inventory.vitamins, undefined);
	assert.ok(r.state.moodlets.some((m) => m.id === 'vitamins'));
	assert.equal(moodletRegenMult(r.state), 2);
	const on = vitalsTick({ ...r.state, needs: { ...r.state.needs, hunger: 100, energy: 100 } }, 60).health;
	near(on, VITALS.regenPerHour * 2);
	assert.equal(moodletRegenMult(s), 1);
});
