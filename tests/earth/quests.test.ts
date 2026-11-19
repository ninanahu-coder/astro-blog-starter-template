// 任务和成就（第 28 批）：支线数据自洽与结算、成就领奖只发一次、称号只能戴拿到的、任务总览、服务端领奖防重复
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, type GameAction } from '../../src/game/core/actions.ts';
import { achievements } from '../../src/game/core/achievements.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { activitiesAt } from '../../src/game/core/engine.ts';
import { claimAchievement, questBoard, settleSide, wearTitle } from '../../src/game/core/quests.ts';
import { advanceSteps, checkMet } from '../../src/game/core/steps.ts';
import { allTitles, earnedTitles, wornTitle } from '../../src/game/core/titles.ts';
import type { PlayerState, Relation } from '../../src/game/core/types.ts';
import { ACH_DEFAULT_REWARD, ACHIEVEMENTS } from '../../src/game/data/achievements.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { FISH } from '../../src/game/data/fish.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { SIDE_QUESTS } from '../../src/game/data/quests.ts';
import { STORY } from '../../src/game/data/story.ts';
import { VENUE_OPS } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import { EarthWorld } from '../../src/game/server/world.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'quest-player', name: '任', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const rel = (score: number): Relation => ({ score, last: {}, seen: [], known: [] });
/** 模拟一次成功的动作：after 由 change 改出来，然后结算支线 */
function step(s: PlayerState, a: GameAction, change: (x: PlayerState) => void = () => {}) {
	const after = structuredClone(s);
	change(after);
	const notes = settleSide(s, after, a);
	return { after, notes };
}
const JACK = SIDE_QUESTS.find((q) => q.id === 'jack-early-boat')!;
const ROUTINE = SIDE_QUESTS.find((q) => q.id === 'local-routine')!;
const FISH_ACT: GameAction = { t: 'fish' };
const catchOne = (id = 'whiting') => (x: PlayerState) => { x.fish = { ...x.fish, [id]: (x.fish[id] ?? 0) + 1 }; };

test('支线数据：id 唯一；目标 id 唯一且只是一种目标；NPC、地点、活动、真实地点动作、心情都存在；带地点的目标不接受真实地点', () => {
	assert.equal(new Set(SIDE_QUESTS.map((q) => q.id)).size, SIDE_QUESTS.length);
	const locs = new Set(WA.locations.map((l) => l.id));
	const npcs = new Set(NPCS.map((n) => n.id));
	const acts = new Set(ACTIVITIES.map((a) => a.id));
	const ops = new Set(VENUE_OPS.map((o) => o.id));
	for (const q of SIDE_QUESTS) {
		assert.ok(q.steps.length >= 1 && q.steps.length <= 8, q.id);
		assert.ok(q.unlock.length >= 1, `${q.id} 至少一个解锁条件`);
		assert.equal(new Set(q.steps.map((s) => s.id)).size, q.steps.length, q.id);
		if (q.npc) assert.ok(npcs.has(q.npc), q.id);
		for (const c of q.unlock) {
			if (c.t === 'npc') assert.ok(npcs.has(c.npc), `${q.id} 解锁 NPC`);
			if (c.t === 'chapter') assert.ok(c.n >= 1 && c.n <= STORY.length, `${q.id} 章数`);
			if (c.t === 'side') assert.ok(SIDE_QUESTS.some((x) => x.id === c.id && x.id !== q.id), `${q.id} 前置支线`);
		}
		for (const s of q.steps) {
			assert.ok(!!s.state !== !!s.act, `${q.id}/${s.id} 只能是一种目标`);
			assert.ok(Number.isInteger(s.n ?? 1) && (s.n ?? 1) >= 1, s.id);
			if (s.at) {
				assert.ok(locs.has(s.at), `${s.id} 地点`);
				assert.equal(s.venue, undefined, `${s.id} 带地点的目标不接受真实地点`);
				assert.ok(s.act, `${s.id} 地点只用于动作目标`);
			}
			for (const op of s.venue ?? []) assert.ok(ops.has(op), `${s.id} 真实地点动作 ${op}`);
			if (s.act?.t === 'activity') for (const id of s.act.ids) assert.ok(acts.has(id), `${s.id} 活动 ${id}`);
			if (s.act?.t === 'npc' && s.act.npc) assert.ok(npcs.has(s.act.npc), s.id);
			// 限定地点的动作在那个地点真的做得了
			if (s.at && s.act?.t === 'activity') {
				const here = activitiesAt(make({ loc: s.at }), WA).map((x) => x.act.id);
				assert.ok(s.act.ids.some((id) => here.includes(id)), `${s.id}：${s.at} 能做 ${s.act.ids}`);
			}
			if (s.at && s.act?.t === 'fish') assert.ok(FISH.some((f) => f.where.locs?.includes(s.at!)), `${s.id}：${s.at} 有鱼`);
			if (s.state?.t === 'npc') assert.ok(npcs.has(s.state.npc), s.id);
		}
		const r = q.reward;
		assert.deepEqual(Object.keys(r).filter((k) => !['cash', 'respect', 'moodlet', 'rel', 'title'].includes(k)), [], q.id);
		assert.ok((r.cash ?? 0) >= 0 && (r.respect ?? 0) >= 0, q.id);
		if (r.moodlet) assert.ok(MOODLETS.some((m) => m.id === r.moodlet), `${q.id} 心情`);
		if (r.rel) assert.ok(npcs.has(r.rel.npc) && r.rel.n > 0 && r.rel.n <= 20, q.id);
	}
});

test('成就奖励和称号数据：奖励非负且至少给一样；称号 id 唯一、名字不空', () => {
	for (const d of ACHIEVEMENTS) {
		const r = d.reward ?? ACH_DEFAULT_REWARD;
		assert.ok((r.cash ?? 0) >= 0 && (r.respect ?? 0) >= 0, d.id);
		assert.ok((r.cash ?? 0) > 0 || (r.respect ?? 0) > 0 || r.title, `${d.id} 至少给一样`);
	}
	const ts = allTitles();
	assert.equal(new Set(ts.map((t) => t.id)).size, ts.length);
	assert.ok(ts.every((t) => t.name.trim() && /^(area|ach|side)\./.test(t.id)));
});

test('支线：解锁前做的事不算；解锁的那次动作也不算；之后按次数推进', () => {
	let s = make({ loc: 'fremantle' });
	s = step(s, FISH_ACT, catchOne()).after;
	assert.equal(s.side.cur[JACK.id], undefined, '没解锁不记进度');
	// 这次聊天让好感到了 30：支线解锁，但聊天这个动作不算进支线
	s = step(s, { t: 'npc', npc: 'jack', act: 'help' }, (x) => { x.relations = { jack: rel(30) }; }).after;
	assert.deepEqual(s.side.cur[JACK.id], {}, '解锁后有进度表，但解锁那次的帮忙不算');
	s = step(s, { t: 'npc', npc: 'jack', act: 'help' }).after;
	assert.equal(s.side.cur[JACK.id]['help-jack'], 1);
	s = step(s, FISH_ACT, catchOne()).after;
	assert.equal(s.side.cur[JACK.id]['fish-freo'], 1);
});

test('支线：指定 NPC、指定地点的目标只认对的人和地方；空军不算钓到', () => {
	let s = make({ loc: 'fremantle', relations: { jack: rel(40), mia: rel(10) } });
	s = step(s, FISH_ACT).after; // 先建进度表
	s = step(s, { t: 'npc', npc: 'mia', act: 'help' }).after;
	assert.equal(s.side.cur[JACK.id]['help-jack'], undefined, '帮米娅不算帮老杰克');
	s = step(s, FISH_ACT).after;
	assert.equal(s.side.cur[JACK.id]['fish-freo'], undefined, '没钓到不算');
	s = step({ ...s, loc: 'perth' }, FISH_ACT, catchOne('black-bream')).after;
	assert.equal(s.side.cur[JACK.id]['fish-freo'], undefined, '在珀斯钓的不算弗里曼特尔');
	const venue: GameAction = { t: 'venue', venue: 'x', op: 'meal', lat: 0, lon: 0, acc: 10 };
	const steps = [{ id: 'a', text: '', act: { t: 'activity' as const, ids: ['eat'] }, at: 'perth', venue: ['meal' as const] }];
	assert.deepEqual(advanceSteps(steps, {}, make({ loc: 'perth' }), make({ loc: 'perth' }), venue, true), {}, '带地点的目标不认真实地点');
});

test('支线：做完发一次奖（钱、声望、好感、称号），清掉进度；之后再做同样的事不再发', () => {
	let s = make({ loc: 'fremantle', relations: { jack: rel(40) }, fish: { whiting: 1, squid: 1, 'black-bream': 1 } });
	s = step(s, FISH_ACT).after;
	s = step(s, FISH_ACT, catchOne()).after;
	s = step(s, { t: 'npc', npc: 'jack', act: 'help' }).after;
	const cash = s.cash, respect = s.respect;
	const done = step(s, FISH_ACT, catchOne());
	s = done.after;
	assert.deepEqual(done.notes, [`支线「${JACK.title}」完成`]);
	assert.ok(s.side.done.includes(JACK.id));
	assert.equal(s.side.cur[JACK.id], undefined);
	assert.equal(s.cash, cash + JACK.reward.cash!);
	assert.equal(s.respect, respect + JACK.reward.respect!);
	assert.equal(s.relations.jack.score, 40 + JACK.reward.rel!.n);
	assert.ok(earnedTitles(s).some((t) => t.id === `side.${JACK.id}`), '拿到称号');
	const again = step(s, FISH_ACT, catchOne());
	assert.deepEqual(again.notes, []);
	assert.equal(again.after.cash, s.cash, '不重复发');
	// 做完以后把目标再做一遍（帮忙、钓两回）也不再发
	let re = s;
	for (const a of [{ t: 'npc', npc: 'jack', act: 'help' }, FISH_ACT, FISH_ACT] as GameAction[]) re = step(re, a, a.t === 'fish' ? catchOne() : undefined).after;
	assert.equal(re.cash, s.cash, '做完的支线不再推进、不再发奖');
	assert.deepEqual(re.side.done, [JACK.id]);
	// 只有状态目标的支线：做完以后条件一直成立，也只发一次
	const stateOnly = { ...JACK, id: 'state-only', unlock: [{ t: 'chapter' as const, n: 0 }], steps: [{ id: 'k', text: '', state: { t: 'fishKinds' as const, n: 1 } }], reward: { cash: 10 } };
	const s0 = make({ fish: { whiting: 1 } });
	const a1 = structuredClone(s0);
	settleSide(s0, a1, { t: 'activity', id: 'rest' }, [stateOnly]);
	const a2 = structuredClone(a1);
	settleSide(a1, a2, { t: 'activity', id: 'rest' }, [stateOnly]);
	assert.equal(a1.cash, s0.cash + 10);
	assert.equal(a2.cash, a1.cash, '第二次不再发');
	// 好感钳在 100
	const high = make({ loc: 'fremantle', relations: { jack: rel(99) }, fish: { whiting: 1, squid: 1, 'black-bream': 1 }, side: { done: [], cur: { [JACK.id]: { 'fish-freo': 1, 'help-jack': 1 } } } });
	assert.equal(step(high, FISH_ACT, catchOne()).after.relations.jack.score, 100);
});

test('支线：真实地点也算，但不是唯一做法；写完第一章后才解锁「本地人的日子」', () => {
	let s = make();
	s = step(s, { t: 'buy', item: 'water' }).after;
	assert.equal(s.side.cur[ROUTINE.id], undefined, '主线第一章没写完不解锁');
	s = { ...s, story: { ch: 1, done: {} } };
	s = step(s, { t: 'activity', id: 'rest' }).after;
	s = step(s, { t: 'venue', venue: 'osm-1', op: 'groceries', lat: -31.95, lon: 115.86, acc: 20 }).after;
	assert.equal(s.side.cur[ROUTINE.id].groceries, 1, '真实超市采购算一次');
	s = step(s, { t: 'activity', id: 'gym' }).after;
	assert.equal(s.side.cur[ROUTINE.id].move, 1, '游戏里健身也算');
	const fin = step(s, { t: 'course', id: 'x' });
	assert.ok(fin.after.side.done.includes(ROUTINE.id));
});

test('applyAction：写完一章的同一个动作不会顺带算进新解锁的支线', () => {
	// 第一章只差「去过 3 个地方」，这次出行写完第一章、解锁「本地人的日子」；出行不是支线目标，结果只看到支线接下了
	const s = make({ story: { ch: 0, done: { meal: 1, chat: 2, buy: 1, freo: 1 } }, visited: { [WA.spawn]: 1, fremantle: 1 } });
	assert.ok(!checkMet(s, { t: 'chapter', n: 1 }));
	const r = applyAction({ ...s, cash: 500 }, WA, { t: 'travel', to: 'mandurah', mode: 'road' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.story.ch, 1);
	assert.deepEqual(r.state.side.cur[ROUTINE.id], {}, '解锁了，但进度为空');
});

test('成就领奖：没达成不行；达成领一次，记进存档；再领被拒；条件丢了已领的不收回', () => {
	const s = make({ relations: { mia: rel(40) } });
	const def = ACHIEVEMENTS.find((d) => d.id === 'friend-1')!;
	assert.equal(claimAchievement(make(), WA, 'friend-1').ok, false, '没达成');
	assert.equal(claimAchievement(s, WA, 'no-such').ok, false);
	const r = claimAchievement(s, WA, 'friend-1');
	assert.ok(r.ok, r.msg);
	assert.notEqual(r.state, s, '不改入参');
	assert.deepEqual(s.achClaimed, []);
	assert.deepEqual(r.state.achClaimed, ['friend-1']);
	assert.equal(r.state.respect, s.respect + (def.reward ?? ACH_DEFAULT_REWARD).respect!);
	assert.equal(claimAchievement(r.state, WA, 'friend-1').ok, false, '不能重复领');
	const lost = { ...r.state, relations: {} };
	assert.ok(achievements(lost, WA).find((a) => a.def.id === 'friend-1')!.claimed, '领过就是领过');
});

test('applyAction 领奖：版本号加一、不改入参；带称号的成就领完能戴', () => {
	const s = make({ fish: Object.fromEntries(FISH.slice(0, 5).map((f) => [f.id, 1])) });
	const r = applyAction(s, WA, { t: 'claim', id: 'fish-5' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rev, s.rev + 1);
	assert.deepEqual(s.achClaimed, []);
	assert.equal(wearTitle(s, 'ach.fish-5').ok, false, '没领不能戴');
	const w = applyAction(r.state, WA, { t: 'title', id: 'ach.fish-5' });
	assert.ok(w.ok, w.msg);
	assert.equal(wornTitle(w.state), ACHIEVEMENTS.find((d) => d.id === 'fish-5')!.name);
	assert.equal(applyAction(w.state, WA, { t: 'title', id: 'ach.fish-5' }).ok, false, '已经戴着');
	const off = applyAction(w.state, WA, { t: 'title', id: '' });
	assert.ok(off.ok);
	assert.equal(off.state.title, '');
});

test('parseAction：领奖和称号只收合法形状', () => {
	assert.deepEqual(parseAction({ t: 'claim', id: 'friend-1' }), { t: 'claim', id: 'friend-1' });
	assert.equal(parseAction({ t: 'claim', id: '<b>' }), null);
	assert.equal(parseAction({ t: 'claim' }), null);
	assert.deepEqual(parseAction({ t: 'title', id: '' }), { t: 'title', id: '' });
	assert.deepEqual(parseAction({ t: 'title', id: 'area.perth' }), { t: 'title', id: 'area.perth' });
	assert.equal(parseAction({ t: 'title', id: 'admin.x' }), null);
	assert.equal(parseAction({ t: 'title', id: 5 }), null);
});

test('存档校验：去掉不认识的成就、支线和伪造的称号；进度钳到目标次数；旧存档补默认值', () => {
	const base = make();
	const raw = {
		...base,
		achClaimed: ['friend-1', 'friend-1', 'fake', 3],
		side: { done: ['jack-early-boat', 'nope'], cur: { 'jack-early-boat': { 'fish-freo': 9 }, 'mia-coffee-map': { meals: 99, ghost: 1, snap: -1 }, nope: { a: 1 } } },
		title: 'ach.landlord',
	};
	const c = sanitizeState(raw)!;
	assert.deepEqual(c.achClaimed, ['friend-1']);
	assert.deepEqual(c.side.done, ['jack-early-boat']);
	assert.deepEqual(c.side.cur, { 'mia-coffee-map': { meals: 3 } }, '做完的支线不留进度，超出的钳住，坏的丢掉');
	assert.equal(c.title, '', '没领过的成就称号不能戴');
	assert.equal(sanitizeState({ ...raw, title: 'side.jack-early-boat' })!.title, 'side.jack-early-boat');
	const old = structuredClone(base) as any;
	delete old.achClaimed; delete old.side; delete old.title;
	const o = sanitizeState(old)!;
	assert.deepEqual(o.achClaimed, []);
	assert.deepEqual(o.side, { done: [], cur: {} });
	assert.equal(o.title, '');
	assert.deepEqual(sanitizeState(c), c, '清洗后再清洗不变');
});

test('任务总览：主线下一步、支线的解锁提示、今天的心愿、收集、可领的成就', () => {
	const s = make({ relations: { mia: rel(40) } });
	const board = questBoard(s, WA, (id) => NPCS.find((n) => n.id === id)!.name);
	const kinds = new Set(board.map((q) => q.kind));
	for (const k of ['main', 'side', 'daily', 'collect', 'ach']) assert.ok(kinds.has(k as never), k);
	assert.match(board[0].sub, /下一步/);
	assert.ok(board.find((q) => q.id === JACK.id)!.locked, '老杰克的支线还没解锁');
	assert.match(board.find((q) => q.id === JACK.id)!.sub, /解锁/);
	const mia = board.find((q) => q.id === 'mia-coffee-map')!;
	assert.ok(!mia.locked, '和米娅已经是朋友');
	assert.match(mia.reward!, /米娅好感/);
	assert.ok(board.find((q) => q.kind === 'ach')!.claimable, '交到朋友的成就可以领');
	const done = make({ side: { done: SIDE_QUESTS.map((q) => q.id), cur: {} }, story: { ch: STORY.length, done: {} } });
	const b2 = questBoard(done, WA);
	assert.ok(!b2.some((q) => q.kind === 'side'), '做完的支线不再列出');
	assert.equal(b2[0].id, 'story-end');
});

// ---------- 服务端：领奖走 act 入口，按版本号和动作编号防重复 ----------
function makeWorld() {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call };
}

test('服务端：成就领奖由服务端核对；同一动作编号重交不重复发；换设备（旧版本号）被拒；伪造的称号不落盘', async () => {
	const w = makeWorld();
	const cred = { id: 'quest-server-player', key: 'q'.repeat(24) };
	const created = await w.call({ action: 'create', ...cred, profile: { name: '测', avatar: '🧑', origin: 'student', traits: [] } });
	let rev = created.data.state.rev;
	const no = await w.call({ action: 'act', ...cred, rev, act: { t: 'claim', id: 'friend-1' }, op: 'a1a1a1a1a1a1a1a1' });
	assert.equal(no.data.ok, false, '没达成，服务端不发');
	// 存档里交到了朋友（服务端存档），再领
	const rec = w.data.get('save:' + cred.id);
	w.data.set('save:' + cred.id, { ...rec, state: { ...rec.state, relations: { mia: rel(40) } } });
	rev = (await w.call({ action: 'get', ...cred })).data.state.rev;
	const ok = await w.call({ action: 'act', ...cred, rev, act: { t: 'claim', id: 'friend-1' }, op: 'b2b2b2b2b2b2b2b2' });
	assert.ok(ok.data.ok, ok.data.msg);
	const respect = ok.data.state.respect;
	const dup = await w.call({ action: 'act', ...cred, rev, act: { t: 'claim', id: 'friend-1' }, op: 'b2b2b2b2b2b2b2b2' });
	assert.equal(dup.data.dup, true, '同一动作编号只认一次');
	assert.equal(dup.data.state.respect, respect);
	const stale = await w.call({ action: 'act', ...cred, rev, act: { t: 'claim', id: 'friend-1' }, op: 'c3c3c3c3c3c3c3c3' });
	assert.equal(stale.status, 409, '另一台设备拿着旧版本号来领，被拒');
	const again = await w.call({ action: 'act', ...cred, rev: ok.data.state.rev, act: { t: 'claim', id: 'friend-1' }, op: 'd4d4d4d4d4d4d4d4' });
	assert.equal(again.data.ok, false, '领过了');
	assert.equal(w.data.get('save:' + cred.id).state.respect, respect, '落盘的声望只加了一次');
	// 客户端改不了存档：直接把伪造称号写进存档也会在读取时清掉
	const rec2 = w.data.get('save:' + cred.id);
	w.data.set('save:' + cred.id, { ...rec2, state: { ...rec2.state, title: 'ach.worth-100k' } });
	assert.equal((await w.call({ action: 'get', ...cred })).data.state.title, '');
});
