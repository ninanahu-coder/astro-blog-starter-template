// 出身（初始属性）数据自洽。只检查结构和设计约束，不检查平衡数值。设计见 docs/earth-game/initial-stats.md
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validTraits } from '../../src/game/core/attributes.ts';
import { BASE_SKILL, START_NEED, ORIGINS, createCharacter, getOrigin, originSkills } from '../../src/game/core/character.ts';
import { SKILL_KEYS } from '../../src/game/core/types.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { MAX_TRAITS } from '../../src/game/data/traits.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';

test('出身数据自洽', () => {
	assert.equal(new Set(ORIGINS.map((o) => o.id)).size, ORIGINS.length, 'id 不重复');
	for (const o of ORIGINS) {
		assert.ok(o.cash > 0 && Number.isInteger(o.cash), `${o.id} 起始现金是正整数`);
		assert.ok(o.vehicle === 'none' || VEHICLES.some((v) => v.id === o.vehicle), `${o.id} 交通工具存在`);
		for (const [k, v] of Object.entries(o.skills)) {
			assert.ok((SKILL_KEYS as readonly string[]).includes(k), `${o.id} 能力 ${k} 存在`);
			assert.ok(v! > BASE_SKILL && v! <= 100, `${o.id} 只写高于起步值的能力`);
		}
		assert.ok(o.role && o.role.length <= 8, `${o.id} 定位是短标签`);
		assert.ok(validTraits(o.suggestTraits, MAX_TRAITS) && o.suggestTraits.length === MAX_TRAITS, `${o.id} 推荐特质是合法的一组`);
	}
});

test('出身对口的职业开局就能入职', () => {
	for (const o of ORIGINS) {
		const skills = originSkills(o);
		assert.ok(o.careers.length > 0, `${o.id} 至少一个对口职业`);
		for (const id of o.careers) {
			const c = CAREERS.find((x) => x.id === id);
			assert.ok(c, `${o.id} 的职业 ${id} 存在`);
			const req = c!.levels[0].req;
			assert.ok(!req?.respect, `${id} 第一级不要声望`);
			for (const k of SKILL_KEYS) assert.ok(skills[k] >= (req?.skills?.[k] ?? 0), `${o.id} 开局满足 ${id} 第一级的${k}要求`);
		}
	}
});

test('创建角色用出身的完整起步值', () => {
	for (const o of ORIGINS) {
		const s = createCharacter({ id: `origin-${o.id}`, name: '测', avatar: '🧑', origin: o.id, region: 'wa', spawn: WA.spawn, seed: 1 });
		assert.deepEqual(s.skills, originSkills(o));
		assert.equal(Object.keys(s.skills).length, SKILL_KEYS.length);
		assert.equal(s.cash, o.cash);
		assert.equal(s.vehicle, o.vehicle);
		assert.ok(Object.values(s.needs).every((n) => n === START_NEED));
	}
	assert.equal(getOrigin('nope').id, ORIGINS[0].id, '未知出身回落到第一个');
	assert.equal(createCharacter({ id: 'origin-x', name: '测', avatar: '🧑', origin: 'nope', region: 'wa', spawn: WA.spawn, seed: 1 }).origin, ORIGINS[0].id);
});
