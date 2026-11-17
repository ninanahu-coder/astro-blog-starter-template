// NPC 联动剧情：数据自洽；两人好感都够了、和其中一位互动时触发一次；只有一人够不触发；存档清洗
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { duosReady, npcsAt } from '../../src/game/core/engine.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPC_DUOS } from '../../src/game/data/npc-duos.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState, Relation } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const rel = (score: number): Relation => ({ score, last: {}, seen: [10, 30], known: [] });
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'duo-player', name: '牵', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 4 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 50, social: 50 },
	clock: at(9),
	...over,
});
const DUO = NPC_DUOS.find((d) => d.id === 'market-sandwich')!;

test('联动数据：id 唯一、两位 NPC 存在且不同、每对只有一段；效果不花时间，只用钱、声望、需求、心情', () => {
	assert.equal(new Set(NPC_DUOS.map((d) => d.id)).size, NPC_DUOS.length);
	const ids = new Set(NPCS.map((n) => n.id));
	const pairs = new Set<string>();
	for (const d of NPC_DUOS) {
		assert.ok(ids.has(d.a) && ids.has(d.b) && d.a !== d.b, d.id);
		const key = [d.a, d.b].sort().join('+');
		assert.ok(!pairs.has(key), `${d.id} 和别的联动是同一对`);
		pairs.add(key);
		assert.ok(d.at > 0 && d.at <= 100, d.id);
		assert.deepEqual(Object.keys(d.fx).filter((k) => !['cash', 'respect', 'needs', 'moodlet'].includes(k)), [], d.id);
		if (d.fx.moodlet) assert.ok(MOODLETS.some((m) => m.id === d.fx.moodlet), d.id);
	}
});

test('两人好感都够了：和其中一位聊天后触发一次，记进存档和日志，发效果；再聊不重复', () => {
	const s = make({ relations: { mia: rel(DUO.at - 2), jack: rel(DUO.at) } });
	assert.ok(npcsAt(s, WA).some((a) => a.npc.id === 'mia'), '米娅这时在珀斯');
	assert.deepEqual(duosReady(s, 'mia'), [], '聊天前米娅的好感还差一点');
	const r = applyAction(s, WA, { t: 'npc', npc: 'mia', act: 'chat' });
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.relations.mia.score >= DUO.at);
	assert.deepEqual(r.state.duos, [DUO.id]);
	assert.match(r.msg, new RegExp(DUO.title));
	assert.equal(r.state.respect, s.respect + (DUO.fx.respect ?? 0));
	assert.ok(r.state.journal.some((j) => j.text.includes(DUO.title)));
	assert.deepEqual(duosReady(r.state, 'mia'), [], '触发过就不再够格');
	const again = applyAction({ ...r.state, clock: at(9, 1) }, WA, { t: 'npc', npc: 'mia', act: 'chat' });
	assert.ok(again.ok, again.msg);
	assert.deepEqual(again.state.duos, [DUO.id]);
	assert.doesNotMatch(again.msg, new RegExp(DUO.title));
});

test('只有一人好感够：不触发', () => {
	const s = make({ relations: { mia: rel(DUO.at - 2), jack: rel(DUO.at - 1) } });
	const r = applyAction(s, WA, { t: 'npc', npc: 'mia', act: 'chat' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(r.state.duos, []);
});

test('存档清洗：去掉不认识的和重复的联动 id；旧存档没有这个字段时为空', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const clean = (duos: unknown) => sanitizeState({ ...make(), duos }, locs, { fallbackLoc: 'perth', now: Date.now() })!.duos;
	assert.deepEqual(clean([DUO.id, DUO.id, 'hax', 'constructor', 3]), [DUO.id]);
	assert.deepEqual(clean(undefined), []);
	assert.deepEqual(clean('x'), []);
});
