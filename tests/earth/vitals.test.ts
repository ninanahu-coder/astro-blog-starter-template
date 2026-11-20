// 第 23 批：时间流逝对健康、麻烦值的影响（src/game/core/vitals.ts）。数值都是「待平衡」，测试只锁公式结构。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import { performActivity } from '../../src/game/core/engine.ts';
import { DECAY, minutesTo, needRate, passTime, VITALS, vitalsTick } from '../../src/game/core/vitals.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { Needs, PlayerState } from '../../src/game/core/types.ts';

const make = (needs: Partial<Needs> = {}, extra: Partial<PlayerState> = {}): PlayerState => {
	const s = createCharacter({ id: 'vitals-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 7 });
	return { ...s, ...extra, needs: { ...s.needs, ...needs } };
};
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≈ ${b}`);

test('需求衰减速度：现状数值不变，特质照乘', () => {
	assert.deepEqual(DECAY, { hunger: 0.07, energy: 0.05, hygiene: 0.035, fun: 0.04, social: 0.03 });
	near(needRate(make(), 'hunger'), 0.07);
	near(needRate(make({}, { traits: ['athletic'] }), 'hunger'), 0.07 * 1.15, '运动健将饿得快');
	near(needRate(make({}, { traits: ['loner'] }), 'social'), 0.03 * 0.5, '独行侠社交掉得慢');
	const s = make();
	passTime(s, 60);
	near(s.needs.hunger, 80 - 4.2);
	near(s.needs.social, 80 - 1.8);
});

test('minutesTo：匀速降到下限要几分钟', () => {
	near(minutesTo(7, 0.07, 0), 100);
	assert.equal(minutesTo(0, 0.07, 0), 0);
	assert.equal(minutesTo(40, 0.07, 50), 0, '已低于下限');
	near(minutesTo(60, 0.05, 50), 200);
	assert.equal(minutesTo(60, 0, 50), Infinity);
});

test('饿到见底才掉健康：只按见底之后的分钟数算', () => {
	// 饱食 7、每分钟 0.07：前 100 分钟还没见底，后 20 分钟才掉血
	const t = vitalsTick(make({ hunger: 7, energy: 90 }), 120);
	near(t.starveMin, 20);
	near(t.health, -(20 * VITALS.starvePerHour) / 60);
	// 精力先见底也算
	near(vitalsTick(make({ hunger: 90, energy: 2 }), 100).starveMin, 60);
	// 一直没见底：不掉
	assert.equal(vitalsTick(make({ hunger: 50, energy: 50 }), 60).starveMin, 0);
	// 已经见底：整段都掉，和旧规则一致
	near(vitalsTick(make({ hunger: 0 }), 90).starveMin, 90);
});

test('吃饱睡足慢慢回健康：只算两项都在门槛以上的分钟数', () => {
	const full = vitalsTick(make({ hunger: 100, energy: 100 }), 60);
	near(full.regenMin, 60);
	near(full.health, VITALS.regenPerHour);
	// 饱食 57、每分钟 0.07：100 分钟后跌破 50，之后不回
	near(vitalsTick(make({ hunger: 57, energy: 100 }), 300).regenMin, 100);
	assert.equal(vitalsTick(make({ hunger: 40, energy: 100 }), 60).regenMin, 0, '饱食低于门槛不回');
	assert.equal(vitalsTick(make({ hunger: 100, energy: 49 }), 60).regenMin, 0, '精力低于门槛不回');
	const s = make({ hunger: 100, energy: 100 }, { health: 99.9 });
	passTime(s, 600);
	assert.equal(s.health, 100, '健康钳制在 100');
});

test('麻烦值随时间冷却，最低到 0', () => {
	const s = make({}, { heat: 30 });
	passTime(s, 240);
	near(s.heat, 30 - 4 * VITALS.heatCoolPerHour);
	const cool = make({}, { heat: 0.1 });
	passTime(cool, 600);
	assert.equal(cool.heat, 0);
	assert.equal(vitalsTick(make(), 0).heat, 0, '不流逝时间不变');
});

test('接进引擎：活动的时间流逝走 vitals', () => {
	// 歇一会儿 60 分钟、精力 +4：饱食、精力都够 → 健康回 regenPerHour，麻烦值降 heatCoolPerHour
	const s = make({ hunger: 90, energy: 90 }, { health: 50, heat: 20 });
	const r = performActivity(s, WA, 'rest');
	assert.ok(r.ok);
	near(r.state.health, 50 + VITALS.regenPerHour);
	near(r.state.heat, 20 - VITALS.heatCoolPerHour);
	// 快饿死时歇一小时：饱食 3.5 → 50 分钟后见底，只掉 10 分钟的血
	const starving = performActivity(make({ hunger: 3.5, energy: 90 }, { health: 50 }), WA, 'rest');
	near(starving.state.health, 50 - (10 * VITALS.starvePerHour) / 60);
	assert.equal(s.health, 50, '不改入参');
});
