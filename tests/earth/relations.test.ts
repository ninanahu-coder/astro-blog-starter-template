// 第 29 批：关系变淡、帮个小忙（NPC 主动开口）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { getRelation, interactNpc, npcPresent, npcsAt } from '../../src/game/core/engine.ts';
import { applyAction, applyCoop, parseAction } from '../../src/game/core/actions.ts';
import { getCoop } from '../../src/game/data/coop.ts';
import { decayedScore, favorOn, favorPeriod, favorToday, isFading, lastTouch, settleDecay } from '../../src/game/core/relations.ts';
import { dayOf } from '../../src/game/core/time.ts';
import { NPC_FAVORS } from '../../src/game/data/npc-favors.ts';
import { FAVOR_RULE, RELATION_DECAY, RELATION_GAIN, RELATION_TIERS } from '../../src/game/data/relations.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState, Relation } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = () => createCharacter({ id: 'rel-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 3 });
const rel = (score: number, lastDay?: number): Relation => ({ score, last: lastDay === undefined ? {} : { chat: lastDay }, seen: [], known: [] });
const { grace, every, floor } = RELATION_DECAY;

test('数据：每位 NPC 一条小忙，物品存在且不是 TA 讨厌的，数值表自洽', () => {
	const items = new Set(ITEMS.map((i) => i.id));
	assert.equal(new Set(NPC_FAVORS.map((f) => f.npc)).size, NPC_FAVORS.length, '每位 NPC 最多一条');
	for (const n of NPCS) assert.ok(NPC_FAVORS.some((f) => f.npc === n.id), `${n.id} 有一条小忙`);
	for (const f of NPC_FAVORS) {
		const npc = NPCS.find((n) => n.id === f.npc);
		assert.ok(npc, `${f.npc} 存在`);
		assert.ok(items.has(f.item), `${f.npc} 要的物品存在`);
		assert.ok(!npc!.gifts.dislike.includes(f.item), `${f.npc} 不会要自己讨厌的东西`);
		assert.ok(Number.isInteger(f.qty) && f.qty >= 1 && f.qty <= (ITEMS.find((i) => i.id === f.item)!.max), `${f.npc} 数量合法且背包装得下`);
		assert.ok(f.ask && f.thanks, `${f.npc} 有文案`);
		assert.ok((f.fx.minutes ?? 0) <= 30, `${f.npc} 小忙不花太多时间`);
		if (f.fx.moodlet) assert.ok(MOODLETS.some((m) => m.id === f.fx.moodlet));
	}
	assert.ok(grace >= 1 && every >= 1);
	assert.ok(RELATION_TIERS.some((t) => t.min === floor), '变淡的底线是某一档的门槛');
	assert.ok(FAVOR_RULE.every >= 1 && FAVOR_RULE.odds >= 1 && RELATION_TIERS.some((t) => t.min === FAVOR_RULE.minScore));
	assert.ok(RELATION_GAIN.favor > 0);
});

test('变淡：宽限期内不变，之后每 every 天 −1，降到底线为止；负分往 0 回升；没互动过不变', () => {
	assert.equal(lastTouch(rel(50)), undefined);
	assert.equal(lastTouch({ ...rel(50), last: { chat: 3, gift: 9, perk: 5 } }), 9);
	assert.equal(decayedScore(rel(80, 0), 0, grace), 80, '宽限期内');
	assert.equal(decayedScore(rel(80, 0), 0, grace + every - 1), 80);
	assert.equal(decayedScore(rel(80, 0), 0, grace + every), 79, '过宽限期满一个周期 −1');
	assert.equal(decayedScore(rel(80, 0), 0, grace + every * 5), 75);
	assert.equal(decayedScore(rel(floor + 2, 0), 0, grace + every * 50), floor, '不低于底线');
	assert.equal(decayedScore(rel(floor, 0), 0, 1000), floor, '在底线上不变');
	assert.equal(decayedScore(rel(12, 0), 0, 1000), 12, '底线以下、0 以上的不变');
	assert.equal(decayedScore(rel(-10, 0), 0, grace + every * 3), -7, '有过节往 0 回升');
	assert.equal(decayedScore(rel(-2, 0), 0, 1000), 0, '回升到 0 为止');
	assert.equal(decayedScore(rel(80), 0, 1000), 80, '没互动过');
	assert.equal(decayedScore(rel(80, 0), 50, 50), 80, '没跨日');
	// 分段结算和一次结算结果一样（跨好几天的动作、连着几个动作都不会多扣或少扣）
	for (const [a, b, c] of [[0, 9, 31], [3, 10, 11], [0, 1, 200]]) {
		const once = decayedScore(rel(90, 0), a, c);
		const twice = decayedScore({ ...rel(90, 0), score: decayedScore(rel(90, 0), a, b) }, b, c);
		assert.equal(twice, once, `${a}→${b}→${c}`);
	}
});

test('settleDecay：不改入参，没变化时返回原对象', () => {
	const s: PlayerState = { ...make(), relations: { mia: rel(80, 0), jack: rel(20, 0) } };
	const snap = structuredClone(s);
	assert.equal(settleDecay(s, 0, 3), s, '宽限期内原样返回');
	const out = settleDecay(s, 0, grace + every * 2);
	assert.notEqual(out, s);
	assert.equal(out.relations.mia.score, 78);
	assert.equal(out.relations.jack, s.relations.jack, '没变的关系沿用原对象');
	assert.deepEqual(s, snap, '入参没被改');
	assert.ok(isFading(s.relations.mia, grace + 1) && !isFading(s.relations.mia, grace) && !isFading(s.relations.jack, 100));
});

test('跨过午夜的动作会结算变淡；不跨日的不结算', () => {
	// 第 0 天聊过天，第 9 天 23:59 出发去弗里曼特尔，到达已是第 10 天：第一次变淡
	const base: PlayerState = { ...make(), loc: 'perth', cash: 500, relations: { mia: rel(80, 0) } };
	const night = applyAction({ ...base, clock: at(23, 9) + 59 }, WA, { t: "travel", to: "fremantle", mode: "road" });
	assert.ok(night.ok, night.msg);
	assert.equal(dayOf(night.state.clock), 10);
	assert.equal(night.state.relations.mia.score, decayedScore(rel(80, 0), 9, 10));
	assert.equal(night.state.relations.mia.score, 79);
	const noon = applyAction({ ...base, clock: at(12, 9) }, WA, { t: 'travel', to: 'fremantle', mode: 'road' });
	assert.ok(noon.ok);
	assert.equal(noon.state.relations.mia.score, 80);
});

/** 找一个米娅在珀斯上班（周一到周五）、这一期有事相求的游戏日 */
function miaFavorDay(): number {
	const mia = NPCS.find((n) => n.id === 'mia')!;
	for (let d = 1; d < 300; d++) if (npcPresent(mia, 'perth', at(10, d)) && favorOn('mia', d) && npcPresent(mia, 'perth', at(10, d + 1)) && favorPeriod(d + 1) === favorPeriod(d)) return d;
	throw new Error('找不到');
}

test('小忙：每位 NPC 大约一半的期数开口，同一期内每天一样', () => {
	for (const n of NPCS) {
		let on = 0;
		for (let p = 0; p < 200; p++) if (favorOn(n.id, p * FAVOR_RULE.every)) on++;
		assert.ok(on > 60 && on < 140, `${n.id} 开口 ${on}/200 期`);
		for (let d = 0; d < 30; d++) assert.equal(favorOn(n.id, d), favorOn(n.id, favorPeriod(d) * FAVOR_RULE.every));
	}
	assert.equal(favorOn('nobody', 0), undefined);
});

test('小忙：关系到「认识」才开口，交出东西拿跑腿费，同一期只帮一次', () => {
	const d = miaFavorDay();
	const f = NPC_FAVORS.find((x) => x.npc === 'mia')!;
	const base: PlayerState = { ...make(), loc: 'perth', clock: at(10, d), cash: 100, relations: { mia: rel(20, d - 1) } };

	// 关系不够：不开口，也不能硬做
	const stranger = { ...base, relations: { mia: rel(FAVOR_RULE.minScore - 1, d - 1) } };
	assert.equal(favorToday(stranger, 'mia', d), undefined);
	assert.equal(npcsAt(stranger, WA).find((x) => x.npc.id === 'mia')!.favor, undefined);
	assert.equal(interactNpc(stranger, WA, 'mia', 'favor').ok, false);

	// 东西不够：看得到请求，按钮不可用
	const poor = { ...base, inventory: {} };
	const here = npcsAt(poor, WA).find((x) => x.npc.id === 'mia')!;
	assert.equal(here.favor, f);
	assert.ok(here.blocked.favor, '缺东西时有原因');
	assert.equal(interactNpc(poor, WA, 'mia', 'favor').ok, false);

	const rich = { ...base, inventory: { [f.item]: f.qty + 1 } };
	assert.equal(npcsAt(rich, WA).find((x) => x.npc.id === 'mia')!.blocked.favor, undefined);
	const snap = structuredClone(rich);
	const r = applyAction(rich, WA, { t: 'npc', npc: 'mia', act: 'favor' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(rich, snap, '不改入参');
	assert.equal(r.state.inventory[f.item], 1, '交出要的数量');
	assert.equal(r.state.cash, rich.cash + (f.fx.cash ?? 0), '跑腿费');
	assert.equal(getRelation(r.state, 'mia').score, 20 + RELATION_GAIN.favor);
	assert.equal(getRelation(r.state, 'mia').last.favor, d);
	assert.ok(r.msg.includes(f.thanks));

	// 同一期再来：不再开口
	const again = { ...r.state, clock: at(10, d + 1), inventory: { [f.item]: 5 } };
	assert.equal(favorToday(again, 'mia', d + 1), undefined);
	assert.equal(applyAction(again, WA, { t: 'npc', npc: 'mia', act: 'favor' }).ok, false);

	// 下一个开口的期数又可以
	let next = d + 1;
	while (!(favorPeriod(next) > favorPeriod(d) && favorOn('mia', next) && npcPresent(NPCS.find((n) => n.id === 'mia')!, 'perth', at(10, next)))) next++;
	const later = { ...r.state, clock: at(10, next), inventory: { [f.item]: 5 } };
	assert.ok(favorToday(later, 'mia', next));
	assert.ok(applyAction(later, WA, { t: 'npc', npc: 'mia', act: 'favor' }).ok);
});

test('服务端校验：favor 不接受客户端指定物品；存档清洗保留 last.favor', () => {
	assert.deepEqual(parseAction({ t: 'npc', npc: 'mia', act: 'favor' }), { t: 'npc', npc: 'mia', act: 'favor' });
	assert.equal(parseAction({ t: 'npc', npc: 'mia', act: 'favor', item: 'water' }), null);
	assert.equal(parseAction({ t: 'npc', npc: 'mia', act: 'flirt' }), null);
	const raw = { ...make(), relations: { mia: { score: 40, last: { favor: 12, chat: -3, gift: 'x' }, seen: [10, 30], known: [] } } };
	const clean = sanitizeState(JSON.parse(JSON.stringify(raw)));
	assert.ok(clean);
	assert.deepEqual(clean!.relations.mia.last, { favor: 12 });
});

test('界面数据：好久没来往的 NPC 标记 fading', () => {
	let d = 40;
	while (!npcPresent(NPCS.find((n) => n.id === 'mia')!, 'perth', at(10, d))) d++;
	const s: PlayerState = { ...make(), loc: 'perth', clock: at(10, d), relations: { mia: rel(70, d - grace - 1) } };
	const mia = npcsAt(s, WA).find((x) => x.npc.id === 'mia');
	assert.ok(mia);
	assert.equal(mia!.fading, true);
	const fresh = npcsAt({ ...s, relations: { mia: rel(70, d - 1) } }, WA).find((x) => x.npc.id === 'mia')!;
	assert.equal(fresh.fading, false);
});

test('共同事件跨过午夜也结算变淡', () => {
	const def = getCoop('busk-band')!;
	const mk = (id: string): PlayerState => ({ ...createCharacter({ id, name: id, avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 5 }), clock: at(23, 9) + 59, relations: { mia: rel(80, 0) } });
	const r = applyCoop(def, WA, [{ state: mk('coop-a'), role: 0, name: 'A' }, { state: mk('coop-b'), role: 1, name: 'B' }]);
	for (const x of r.results) {
		assert.equal(dayOf(x.state.clock), 10);
		assert.equal(x.state.relations.mia.score, 79);
	}
});
