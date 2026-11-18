// 新手指南（第 26 轮）：前三天分步解开；做到就打勾；提前做完提前解开；过了第三天或全部做完就不显示
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, START_CLOCK } from '../../src/game/core/character.ts';
import { GUIDE_DAYS, guideView } from '../../src/game/core/guide.ts';
import { GUIDE_STEPS } from '../../src/game/data/guide.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'guide-player', name: '新', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 2 }),
	...over,
});
const ids = (s: PlayerState) => guideView(s)!.steps.map((x) => x.id);
const day1 = GUIDE_STEPS.filter((g) => g.day === 1).map((g) => g.id);
const upTo2 = GUIDE_STEPS.filter((g) => g.day <= 2).map((g) => g.id);

test('指南数据：id 唯一，每天一组都有步骤，跳转页是已有标签', () => {
	assert.equal(new Set(GUIDE_STEPS.map((g) => g.id)).size, GUIDE_STEPS.length);
	for (let d = 1; d <= GUIDE_DAYS; d++) assert.ok(GUIDE_STEPS.some((g) => g.day === d), `第 ${d} 天没有步骤`);
	for (const g of GUIDE_STEPS) if (g.tab) assert.ok(['place', 'go', 'near', 'grow', 'social', 'me'].includes(g.tab), g.id);
});

test('开局：只解开第 1 天这组，下一步是第一条，预告第 2 天', () => {
	const g = guideView(make())!;
	assert.equal(g.day, 1);
	assert.deepEqual(ids(make()), day1);
	assert.equal(g.current, day1[0]);
	assert.equal(g.done, 0);
	assert.ok(g.next && g.next.includes('出行'), '预告第 2 天');
});

test('真实动作打勾：和当地人聊天（要花时间）后，前两步打勾，下一步变成过夜', () => {
	const npc = NPCS.find((n) => n.loc === WA.spawn)!;
	const r = applyAction(make(), WA, { t: 'npc', npc: npc.id, act: 'chat' });
	assert.ok(r.ok, r.msg);
	const g = guideView(r.state)!;
	assert.ok(g.steps.find((x) => x.id === 'next')!.done, '时间走了');
	assert.ok(g.steps.find((x) => x.id === 'chat')!.done, '聊过天');
	assert.equal(g.current, 'night');
});

test('到了第 2 天解开第 2 组（前面没做完的也留着）；第 1 组提前做完也会提前解开', () => {
	const tomorrow = make({ clock: START_CLOCK + 1440 });
	assert.equal(guideView(tomorrow)!.day, 2);
	assert.deepEqual(ids(tomorrow), upTo2);
	assert.equal(guideView(tomorrow)!.current, 'chat', '第 1 天没做完的排在前面');
	// 第 1 组的「过夜」要到第 2 天才算做完：在第 2 天把前两组都做完，应该直接跳到第 3 组
	const busy = make({
		clock: START_CLOCK + 1440 + 60,
		relations: { [NPCS[0].id]: { score: 5 } } as never,
		visited: { perth: 1, fremantle: 1 },
		job: { career: 'barista', level: 0 } as never,
		workDay: 1,
	});
	const g = guideView(busy)!;
	assert.equal(g.day, 3, '第 1、2 组都做完，提前解开第 3 组');
	assert.equal(g.next, null, '第 3 组之后没有预告');
	assert.ok(['home', 'places', 'nearby'].includes(g.current!));
});

test('过了第三天、或者九步全做完就不显示', () => {
	assert.equal(guideView(make({ clock: 3 * 1440 })), null, '第 4 天 0 点起不显示');
	assert.ok(guideView(make({ clock: 3 * 1440 - 1 })), '第 3 天 23:59 还显示');
	const all = make({
		clock: START_CLOCK + 1440 + 60,
		relations: { [NPCS[0].id]: { score: 5 } } as never,
		visited: { perth: 1, fremantle: 1, rottnest: 1 },
		job: { career: 'barista', level: 0 } as never,
		workDay: 1,
		home: { type: 'room', loc: 'perth', furniture: {} } as never,
		venueCd: { meal: 1 },
	});
	assert.equal(guideView(all), null);
});

test('指南只读存档，不改入参', () => {
	const s = make();
	const before = structuredClone(s);
	guideView(s);
	assert.deepEqual(s, before);
});
