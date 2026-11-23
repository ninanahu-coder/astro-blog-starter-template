// 室友与合租（docs/earth-game/flatmates.md）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { rentHome } from '../../src/game/core/engine.ts';
import { cookBlocked, deliveryBlocked } from '../../src/game/core/cooking.ts';
import { resolveFlatEvent } from '../../src/game/core/flat-actions.ts';
import { homeKey, subletDays, subletIncome } from '../../src/game/core/flatmates.ts';
import { RECIPES } from '../../src/game/data/cooking.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { featureOf } from '../../src/game/server/stats.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { weeklyCosts, homeComfort } from '../../src/game/core/attributes.ts';
import { activeMates, afterSleepFlat, cleanFlatshare, dutyFor, eligibleEvents, emptyFlatshare, flatCandidates, flatRentDue, rentShare, settleFlatWeek } from '../../src/game/core/flatmates.ts';
import { FLAT_EVENTS, FLAT_RULES, FLATMATES } from '../../src/game/data/flatmates.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { flatHtml } from '../../src/game/ui/flatmates.ts';
import { WA } from '../../src/game/data/wa.ts';
import { NEED_KEYS, type PlayerState } from '../../src/game/core/types.ts';
import type { GameAction } from '../../src/game/core/actions.ts';

const fresh = (seed = 42) => {
	const s = createCharacter({ id: 'test-player', name: '测试', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed });
	s.cash = 5000;
	return s;
};
const run = (s: PlayerState, a: GameAction) => {
	const r = applyAction(s, WA, a);
	assert.ok(r.ok, `${JSON.stringify(a)}：${r.msg}`);
	return r.state;
};
const noHooks = { log: () => {}, mood: () => {} };
/** 合并 main 后：租房市场要先看房、递申请，房东挑人；这里直接签约（引擎的 rentHome），只测室友 */
const rentAt = (s: PlayerState, home: string) => {
	const r = rentHome(s, WA, home);
	assert.ok(r.ok, `租 ${home}：${r.msg}`);
	return r.state;
};
/** 在珀斯租一居室并请第一位候选人住进来 */
const withMate = (seed = 42) => {
	let s = rentAt(fresh(seed), 'flat');
	const c = flatCandidates(s)[0];
	s = run(s, { t: 'flat', op: 'invite', mate: c.def.id });
	return s;
};
/** 把时钟拨到下一个结算日前 10 分钟（只用来测结算，不经过动作） */
const nearSettle = (s: PlayerState) => {
	const out = structuredClone(s);
	out.clock = out.nextWeek * 1440 - 10;
	return out;
};

test('室友数据：id 唯一、性格在 0–2；事件选项至少两个、心情都存在、需求键合法；每个事件至少有一位室友能触发', () => {
	assert.equal(new Set(FLATMATES.map((m) => m.id)).size, FLATMATES.length);
	for (const m of FLATMATES) for (const k of ['tidy', 'noise', 'borrow', 'warm'] as const) assert.ok(m[k] >= 0 && m[k] <= 2, `${m.id}.${k}`);
	assert.equal(new Set(FLAT_EVENTS.map((e) => e.id)).size, FLAT_EVENTS.length);
	for (const e of FLAT_EVENTS) {
		assert.ok(e.choices.length >= 2, e.id);
		assert.ok(e.choices.some((c) => !c.cost && !c.lend), `${e.id} 要有不花钱的选项`);
		for (const c of e.choices) {
			if (c.moodlet) assert.ok(MOODLETS.some((m) => m.id === c.moodlet), `${e.id} 心情 ${c.moodlet}`);
			for (const k of Object.keys(c.needs ?? {})) assert.ok((NEED_KEYS as readonly string[]).includes(k), `${e.id} 需求 ${k}`);
		}
		const s = withMate();
		s.flatshare.clean = 0; // dirty 类事件要家里乱
		const fits = FLATMATES.some((m) => {
			s.flatshare.mates = [{ id: m.id, vibe: 0, since: 0, owes: 0 }];
			return eligibleEvents(s).some((x) => x.ev.id === e.id);
		});
		assert.ok(fits, `${e.id} 没有室友能触发`);
	}
	for (const id of Object.keys(FLAT_RULES.beds)) assert.ok(HOMES.some((h) => h.id === id), `beds 里的房型 ${id} 存在`);
	for (const [id, n] of Object.entries(FLAT_RULES.autoMates)) assert.ok(n < FLAT_RULES.beds[id], `${id} 自带室友少于床位`);
	assert.ok(FLAT_RULES.maxMates >= Math.max(...Object.values(FLAT_RULES.beds)) - 1);
});

test('合租房间：租下就有两位室友，房租不变；不推进随机种子；同一种子结果相同', () => {
	const s0 = fresh();
	const a = rentAt(s0, 'room');
	assert.equal(a.flatshare.mates.length, FLAT_RULES.autoMates.room);
	assert.equal(new Set(a.flatshare.mates.map((m) => m.id)).size, a.flatshare.mates.length);
	assert.equal(a.seed, rentAt(fresh(), 'flat').seed, '室友用哈希，不额外推进 seed（和租一居室推进得一样多）');
	assert.equal(weeklyCosts(a).rent, 160);
	assert.equal(rentShare(a), 160);
	const b = rentAt(fresh(), 'room');
	assert.deepEqual(a.flatshare.mates, b.flatshare.mates);
	// 不能挑人、不能请人走
	assert.equal(flatCandidates(a).length, 0);
	assert.equal(applyAction(a, WA, { t: 'flat', op: 'askout', mate: a.flatshare.mates[0].id }).ok, false);
});

test('二房东找室友：房租和水电网按人头分，周结算按分摊后的数扣', () => {
	const s = withMate();
	assert.equal(activeMates(s).length, 1);
	const share = Math.round((320 + FLAT_RULES.billsWeek.flat) / 2);
	assert.equal(rentShare(s), share);
	assert.equal(weeklyCosts(s).rent, share);
	// 床满了：候选人都不能请
	assert.ok(flatCandidates(s).every((c) => c.blocked === '没有空床了'));
	const before = nearSettle(s);
	const after = run(before, { t: 'flat', op: 'chore' });
	const paid = after.journal.find((j) => j.text.includes('周结算：支付'));
	assert.ok(paid?.text.includes(`$${share}`), paid?.text);
	// 隐私：二房东每位室友心情 −1
	const solo = rentAt(fresh(), 'flat');
	assert.equal(homeComfort(s), homeComfort(solo) + FLAT_RULES.privacyPerMate);
});

test('请室友搬走：提前一周，关系 −10；到日子的那次结算后搬走，房租恢复整份', () => {
	let s = withMate();
	const id = s.flatshare.mates[0].id;
	const vibe = s.flatshare.mates[0].vibe;
	s = run(s, { t: 'flat', op: 'askout', mate: id });
	assert.equal(s.flatshare.mates[0].vibe, vibe + FLAT_RULES.askOutVibe);
	assert.equal(applyAction(s, WA, { t: 'flat', op: 'askout', mate: id }).ok, false, '不能重复请');
	const out = s.flatshare.mates[0].out!;
	// 第一个结算日还没到搬走那天
	const t = structuredClone(s);
	t.clock = t.nextWeek * 1440 + 60;
	settleFlatWeek(t, t.nextWeek, noHooks);
	if (out > t.nextWeek) assert.equal(t.flatshare.mates.length, 1);
	t.clock = out * 1440 + 60;
	settleFlatWeek(t, out, noHooks);
	assert.equal(t.flatshare.mates.length, 0);
	assert.equal(rentShare(t), 320);
});

test('值日：轮到你那周做了家务关系 +3，没做 −8；卫生按人数下降，家务 +30', () => {
	const s = withMate();
	// 找一个轮到你的结算日
	let weekEnd = s.nextWeek;
	while (dutyFor(s, weekEnd) !== 'me') weekEnd += 7;
	const skip = structuredClone(s);
	skip.clock = weekEnd * 1440;
	const v0 = skip.flatshare.mates[0].vibe;
	settleFlatWeek(skip, weekEnd, noHooks);
	assert.equal(skip.flatshare.mates[0].vibe, v0 + FLAT_RULES.dutySkipVibe);
	const done = structuredClone(s);
	done.clock = weekEnd * 1440;
	done.flatshare.chore = weekEnd - 1;
	settleFlatWeek(done, weekEnd, noHooks);
	assert.equal(done.flatshare.mates[0].vibe, v0 + FLAT_RULES.dutyDoneVibe);
	const tidy = FLATMATES.find((m) => m.id === s.flatshare.mates[0].id)!.tidy;
	assert.equal(done.flatshare.clean, s.flatshare.clean - FLAT_RULES.cleanDecayMe - FLAT_RULES.cleanDecay[tidy]);
	// 家务
	const dirty = structuredClone(s);
	dirty.flatshare.clean = 20;
	const c = run(dirty, { t: 'flat', op: 'chore' });
	assert.equal(c.flatshare.clean, 20 + FLAT_RULES.choreClean);
	assert.ok(c.flatshare.chore >= 0);
	// 轮到室友值日：按 TA 的 tidy 打扫回来
	let mateWeek = s.nextWeek;
	while (dutyFor(s, mateWeek) === 'me') mateWeek += 7;
	const m = structuredClone(s);
	m.clock = mateWeek * 1440;
	settleFlatWeek(m, mateWeek, noHooks);
	assert.equal(m.flatshare.clean, s.flatshare.clean - FLAT_RULES.cleanDecayMe - FLAT_RULES.cleanDecay[tidy] + FLAT_RULES.dutyClean[tidy]);
});

test('回家睡觉：每位室友加社交；家里乱少恢复清洁并有心情；相处融洽有心情', () => {
	const base = withMate();
	const s = structuredClone(base);
	s.needs.social = 10;
	s.needs.hygiene = 50;
	s.flatshare.clean = 10;
	const moods: string[] = [];
	afterSleepFlat(s, { log: () => {}, mood: (id) => moods.push(id) });
	assert.equal(s.needs.social, 10 + FLAT_RULES.socialPerMate);
	assert.equal(s.needs.hygiene, 50 + FLAT_RULES.messyHygiene);
	assert.deepEqual(moods, ['flat-messy']);
	assert.equal(homeComfort(s), homeComfort(base) + FLAT_RULES.messyComfort, '家里乱住处心情 −3');
	const h = structuredClone(base);
	h.flatshare.mates[0].vibe = FLAT_RULES.harmonyAbove;
	const m2: string[] = [];
	afterSleepFlat(h, { log: () => {}, mood: (id) => m2.push(id) });
	assert.deepEqual(m2, ['flat-harmony']);
	// 社交按人数算，最多算 2 位
	const three = structuredClone(base);
	three.needs.social = 10;
	three.flatshare.mates = ['fm-mia', 'fm-dan', 'fm-kenji'].map((id) => ({ id, vibe: 0, since: 0, owes: 0 }));
	three.home!.type = 'beach'; // 能住 3 人
	afterSleepFlat(three, noHooks);
	assert.equal(three.needs.social, 10 + FLAT_RULES.socialPerMate * 2);
	// 经过引擎：转租中不能睡
	const away = structuredClone(base);
	away.flatshare.sublet = true;
	assert.equal(applyAction(away, WA, { t: 'home', op: 'sleep' }).ok, false);
});

test('室友事件：睡觉时按几率出现，处理后改关系、卫生、借钱记账；付不起的选项不能选；没处理的 3 天后作废扣关系', () => {
	let hit: PlayerState | undefined;
	for (let seed = 1; seed < 400 && !hit; seed++) {
		const s = withMate(seed);
		s.flatshare.mates = [{ id: 'fm-lingling', vibe: 10, since: 0, owes: 0 }]; // 爱借东西：一定有借钱事件可抽
		s.clock += 900; // 晚上
		const r = applyAction(s, WA, { t: 'home', op: 'sleep' });
		if (r.ok && r.state.flatshare.ev) hit = r.state;
	}
	assert.ok(hit, '几百个种子里总该抽到一次');
	const ev = FLAT_EVENTS.find((e) => e.id === hit!.flatshare.ev!.id)!;
	assert.ok(ev);
	const r = run(hit!, { t: 'flat', op: 'resolve', choice: 0 });
	assert.equal(r.flatshare.ev, null);
	assert.equal(r.flatshare.mates[0].vibe, Math.max(-100, Math.min(100, hit!.flatshare.mates[0].vibe + ev.choices[0].vibe)));
	// 借钱
	const lend = structuredClone(hit!);
	lend.flatshare.ev = { id: 'fe-borrow-cash', mate: 'fm-lingling', day: 0 };
	const l = run(lend, { t: 'flat', op: 'resolve', choice: 0 });
	assert.equal(l.cash, lend.cash - 40);
	assert.equal(l.flatshare.mates[0].owes, 40);
	lend.cash = 10;
	assert.equal(applyAction(lend, WA, { t: 'flat', op: 'resolve', choice: 0 }).ok, false, '钱不够不能借');
	assert.equal(applyAction(lend, WA, { t: 'flat', op: 'resolve', choice: 7 }).ok, false);
	// 作废
	const old = structuredClone(hit!);
	old.flatshare.ev = { id: 'fe-chat', mate: 'fm-lingling', day: 0 };
	old.clock = (FLAT_RULES.eventExpireDays) * 1440 + 60;
	old.nextWeek = 99; // 不触发周结算
	const v = old.flatshare.mates[0].vibe;
	afterSleepFlat(old, noHooks);
	assert.equal(old.flatshare.mates[0].vibe, v + FLAT_RULES.eventExpireVibe);
});

test('借钱：结算日按几率还；关系太差的室友提出下周搬走；合租房间有人走了补新人', () => {
	const s = withMate();
	s.flatshare.mates = [{ id: 'fm-xiaoyu', vibe: 10, since: 0, owes: 30 }]; // borrow 0：几乎一定还
	let repaid = 0;
	for (let i = 0; i < 20; i++) {
		const t = structuredClone(s);
		t.seed = i;
		t.clock = s.nextWeek * 1440;
		settleFlatWeek(t, s.nextWeek, noHooks);
		if (t.flatshare.mates[0].owes === 0) {
			assert.equal(t.cash, s.cash + 30);
			repaid++;
		}
	}
	assert.ok(repaid >= 15, `还钱 ${repaid}/20`);
	const bad = structuredClone(s);
	bad.flatshare.mates[0].vibe = FLAT_RULES.leaveBelow;
	bad.clock = s.nextWeek * 1440;
	settleFlatWeek(bad, s.nextWeek, noHooks);
	assert.equal(bad.flatshare.mates[0].out, s.nextWeek + 7);
	// 合租房间
	const room = rentAt(fresh(), 'room');
	room.flatshare.mates[0].out = 0;
	room.clock = room.nextWeek * 1440;
	const gone = room.flatshare.mates[0].id;
	settleFlatWeek(room, room.nextWeek, noHooks);
	assert.equal(room.flatshare.mates.length, FLAT_RULES.autoMates.room);
	assert.ok(!room.flatshare.mates.some((m) => m.id === gone && m.out !== undefined));
	// 旧存档：合租房间没有室友字段，结算时补上
	const legacy = structuredClone(room);
	legacy.flatshare = emptyFlatshare();
	settleFlatWeek(legacy, legacy.nextWeek, noHooks);
	assert.equal(legacy.flatshare.mates.length, FLAT_RULES.autoMates.room);
});

test('转租：在家不能转；出门后转租，结算时收回 90%，不能回去住和做饭；收回后恢复', () => {
	const home = rentAt(fresh(), 'flat');
	assert.equal(applyAction(home, WA, { t: 'flat', op: 'sublet' }).ok, false);
	const away = structuredClone(home);
	away.loc = 'fremantle';
	const s = run(away, { t: 'flat', op: 'sublet' });
	assert.equal(s.flatshare.sublet, true);
	assert.equal(flatRentDue(s), 320 - Math.round(320 * FLAT_RULES.subletRate));
	assert.equal(weeklyCosts(s).rent, flatRentDue(s));
	const back = structuredClone(s);
	back.loc = home.home!.loc;
	back.home!.furniture = { kitchen: 'cookset' }; // 有炊具：只因为转租才不能做饭
	const cookable = structuredClone(back);
	cookable.flatshare.sublet = false;
	assert.equal(applyAction(cookable, WA, { t: 'home', op: 'cook' }).ok, true);
	assert.equal(applyAction(back, WA, { t: 'home', op: 'sleep' }).ok, false);
	assert.equal(applyAction(back, WA, { t: 'home', op: 'cook' }).ok, false);
	const un = run(back, { t: 'flat', op: 'unsublet' });
	assert.equal(un.flatshare.sublet, false);
	assert.equal(flatRentDue(un), 320);
	// 营地、自有房不能转租
	const camp = structuredClone(away);
	camp.home = { type: 'campground', loc: 'perth', furniture: {} };
	assert.equal(applyAction(camp, WA, { t: 'flat', op: 'sublet' }).ok, false);
});

test('退租、搬家：室友清空；动作不修改入参', () => {
	const s = withMate();
	const snap = structuredClone(s);
	const left = run(s, { t: 'home', op: 'leave' });
	assert.deepEqual(left.flatshare, emptyFlatshare());
	run(s, { t: 'flat', op: 'chore' });
	run(s, { t: 'flat', op: 'askout', mate: s.flatshare.mates[0].id });
	assert.deepEqual(s, snap);
});

test('协议：flat 动作的形状校验', () => {
	assert.deepEqual(parseAction({ t: 'flat', op: 'chore' }), { t: 'flat', op: 'chore' });
	assert.deepEqual(parseAction({ t: 'flat', op: 'invite', mate: 'fm-mia' }), { t: 'flat', op: 'invite', mate: 'fm-mia' });
	assert.deepEqual(parseAction({ t: 'flat', op: 'resolve', choice: 2 }), { t: 'flat', op: 'resolve', choice: 2 });
	for (const bad of [{ t: 'flat' }, { t: 'flat', op: 'invite' }, { t: 'flat', op: 'invite', mate: '<b>' }, { t: 'flat', op: 'resolve', choice: -1 }, { t: 'flat', op: 'resolve', choice: 1.5 }, { t: 'flat', op: 'evict' }]) {
		assert.equal(parseAction(bad), null, JSON.stringify(bad));
	}
	assert.equal(applyAction(fresh(), WA, { t: 'flat', op: 'invite', mate: 'fm-mia' }).ok, false, '没住处不能找室友');
	assert.equal(applyAction(fresh(), WA, { t: 'flat', op: 'chore' }).ok, false);
});

test('存档清洗：旧存档补默认；坏值钳住；未知、重复的室友去掉；对不上室友的事件丢掉；幂等', () => {
	assert.deepEqual(cleanFlatshare(undefined), emptyFlatshare());
	for (const bad of [null, [], 'x', 3, NaN, { mates: 'x' }, Object.create({ mates: [{ id: 'fm-mia' }] })]) assert.deepEqual(cleanFlatshare(bad), emptyFlatshare());
	const c = cleanFlatshare({
		mates: [{ id: 'fm-mia', vibe: 999, since: -5, owes: 1e12, out: 3.6 }, { id: 'fm-mia', vibe: 0 }, { id: '<script>', vibe: 0 }, { id: 'fm-dan', vibe: NaN }, { id: 'fm-kenji' }, { id: 'fm-ajie' }, { id: 'fm-xiaoyu' }],
		clean: 400,
		ev: { id: 'fe-party', mate: 'fm-xiaoyu', day: 2 },
		chore: 'x',
		sublet: 'yes',
	});
	assert.deepEqual(c.mates.map((m) => m.id), ['fm-mia', 'fm-dan', 'fm-kenji', 'fm-ajie']);
	assert.equal(c.mates.length, FLAT_RULES.maxMates);
	assert.deepEqual(c.mates[0], { id: 'fm-mia', vibe: 100, since: 0, owes: 10000, out: 4 });
	assert.equal(c.mates[1].vibe, FLAT_RULES.vibeStart);
	assert.equal(c.clean, 100);
	assert.equal(c.ev, null, '事件的室友不在名单里');
	assert.equal(c.chore, -1);
	assert.equal(c.sublet, false);
	assert.deepEqual(cleanFlatshare(c), c);
	const s = withMate();
	const raw = JSON.parse(JSON.stringify(s));
	delete raw.flatshare;
	const legacy = sanitizeState(raw)!;
	assert.deepEqual(legacy.flatshare, emptyFlatshare());
	const once = sanitizeState(JSON.parse(JSON.stringify(s)))!;
	assert.deepEqual(once.flatshare, s.flatshare);
	assert.deepEqual(sanitizeState(once), once);
});

test('界面：室友区块的插值都经过 esc；按钮和动作协议对得上', () => {
	const s = withMate();
	s.flatshare.ev = { id: 'fe-party', mate: s.flatshare.mates[0].id, day: 0 };
	const seen: string[] = [];
	const esc = (v: unknown) => {
		seen.push(String(v));
		return String(v).replace(/[&<>"']/g, '');
	};
	const html = flatHtml(s, esc);
	const name = FLATMATES.find((m) => m.id === s.flatshare.mates[0].id)!.name;
	assert.ok(seen.some((x) => x === name), '名字经过 esc');
	assert.ok(seen.some((x) => x.includes(name) && x.includes('客厅')), '事件文案经过 esc');
	assert.ok(html.includes('data-flat="chore"'));
	assert.ok(html.includes('data-flat="resolve" data-flat-choice="0"'));
	assert.ok(html.includes('data-flat="askout"'));
	assert.equal(flatHtml(fresh(), esc), '', '没住处不显示');
	// 用真的 esc 和带标签的名字：输出里不能出现原样的标签
	const realEsc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
	const defs = FLATMATES.map((m) => ({ ...m }));
	try {
		for (const m of FLATMATES) Object.assign(m, { name: `<x-n>${m.id}</x-n>`, bio: `<x-b>${m.id}</x-b>`, avatar: '<x-a>' });
		const out = flatHtml(s, realEsc);
		assert.ok(!/<x-/.test(out), out);
		assert.ok(out.includes('&lt;x-n&gt;'));
	} finally {
		FLATMATES.forEach((m, i) => Object.assign(m, defs[i]));
	}
	const away = structuredClone(s);
	away.loc = 'fremantle';
	assert.ok(flatHtml(away, esc).includes('data-flat="sublet"'));
});

// ---------- 合并 main 后（租房市场、做饭、心事、生涯统计） ----------
test('合并 main：分摊按租约房租算（含已通知的涨租），周结算扣的和每周开销一致', () => {
	let s = withMate();
	const lease = s.rental.lease!;
	assert.ok(lease, '一居室有租约');
	s = structuredClone(s);
	s.rental.lease!.rent = lease.rent + 100; // 租约房租和房型标价不同
	const bills = FLAT_RULES.billsWeek.flat ?? 0;
	const want = Math.round((s.rental.lease!.rent + bills) / 2);
	assert.equal(weeklyCosts(s).rent, want, '每周开销按租约房租分摊');
	const before = s.cash;
	const t = run(nearSettle(s), { t: 'flat', op: 'chore' });
	const paid = t.journal.find((j) => j.text.includes('周结算：支付'));
	assert.ok(paid?.text.includes(`$${want}`), paid?.text);
	assert.ok(before - t.cash >= want - 50);
});

test('合并 main：转租期间不能在家做饭、请客、叫外卖', () => {
	let s = withMate();
	s = structuredClone(s);
	s.flatshare.sublet = true;
	const r = RECIPES[0];
	assert.equal(cookBlocked(s, r.id, WA), '房间转租中');
	assert.equal(deliveryBlocked(s, WA), '房间转租中');
});

test('合并 main：室友相处融洽能缓解孤单；生涯统计记社交；使用统计按操作分开', () => {
	const h = MOODLETS.find((m) => m.id === 'flat-harmony')!;
	assert.deepEqual(h.relieves, ['lonely']);
	assert.deepEqual(actionCats({ t: 'flat', op: 'resolve', choice: 0 }), ['social', 'social']);
	for (const op of ['chore', 'sublet', 'unsublet'] as const) assert.equal(featureOf({ t: 'flat', op }), `flat.${op}`);
	assert.equal(featureOf({ t: 'flat', op: 'invite', mate: 'x' }), 'flat.invite');
	assert.equal(featureOf({ t: 'flat', op: 'resolve', choice: 1 }), 'flat.resolve');
});

// ---------- 合并 main 时复核修正 ----------
test('复核：转租收入按这周实际转租的天数折算；结算前一刻才转租几乎收不回钱', () => {
	const home = rentAt(fresh(), 'flat');
	const away = structuredClone(home);
	away.loc = 'fremantle';
	// 第 6 天晚上才转租，第 7 天结算：只算 1 天
	const late = run({ ...away, clock: 6 * 1440 + 20 * 60 }, { t: 'flat', op: 'sublet' });
	assert.equal(late.flatshare.subFrom, 6);
	assert.equal(subletDays(late), 1);
	assert.equal(subletIncome(late), Math.round((320 * FLAT_RULES.subletRate * 1) / 7));
	// 结算：扣的是按 1 天折算后的房租；结算后起点挪到结算日，下一整周都转租就收回整周
	const kept = run(nearSettle(late), { t: 'activity', id: 'rest' } as GameAction);
	const paid = kept.journal.find((j) => j.text.includes('周结算：支付'));
	assert.ok(paid?.text.includes(`$${320 - Math.round((320 * FLAT_RULES.subletRate) / 7)}`), paid?.text);
	assert.equal(kept.flatshare.subFrom, 7, '结算后从结算日算起');
	assert.equal(subletDays(kept), 7);
	// 收回后再转租：从当天算
	const again = run(run({ ...kept, clock: 8 * 1440 + 600 }, { t: 'flat', op: 'unsublet' }), { t: 'flat', op: 'sublet' });
	assert.equal(again.flatshare.subFrom, 8);
});

test('复核：室友记录跟住处走——对不上现在住处、住自有房或没住处时存档清洗清空；室友不超过空床', () => {
	const s = withMate();
	assert.equal(s.flatshare.home, homeKey(s.home!));
	const raw = JSON.parse(JSON.stringify(s));
	raw.flatshare.sublet = true;
	raw.flatshare.home = 'room@perth-other';
	assert.deepEqual(sanitizeState(raw)!.flatshare.mates, [], '住处对不上：室友不算数');
	assert.equal(sanitizeState(raw)!.flatshare.sublet, false);
	const owned = JSON.parse(JSON.stringify(s));
	owned.flatshare.sublet = true;
	owned.home = { ...owned.home, owned: 'perth-apartment' };
	owned.properties = [{ id: 'perth-apartment', loan: 0, rented: false, missed: 0 }];
	assert.equal(sanitizeState(owned)!.flatshare.sublet, false, '自有房不会卡在转租里');
	const ok = sanitizeState(JSON.parse(JSON.stringify(s)))!;
	assert.equal(ok.flatshare.mates.length, 1, '对得上的照常保留');
	assert.equal(sanitizeState(ok)!.flatshare.home, ok.flatshare.home, '幂等');
	// 一居室最多 1 位室友：多出来的不算
	const crowded = structuredClone(s);
	crowded.flatshare.mates = ['fm-mia', 'fm-dan', 'fm-kenji'].map((id) => ({ id, vibe: 0, since: 0, owes: 0 }));
	assert.equal(activeMates(crowded).length, 1);
});

test('复核：室友的事要回住处处理；室友还钱记「社交」；分摊按租约房租显示', () => {
	const s = withMate();
	const ev = structuredClone(s);
	ev.flatshare.ev = { id: FLAT_EVENTS[0].id, mate: ev.flatshare.mates[0].id, day: 0 };
	const away = { ...ev, loc: 'fremantle' };
	assert.match(resolveFlatEvent(away, WA, 0).msg, /回到住处/);
	// 还钱
	const lend = structuredClone(s);
	lend.flatshare.mates = [{ id: 'fm-xiaoyu', vibe: 10, since: 0, owes: 30 }];
	const before = lend.tally!.in.social ?? 0;
	// 用别的动作触发结算：还的钱不能靠动作本身的分类记进社交。还不还看随机数，换几个结算前的时刻找一次还了的
	let found = false;
	for (let back = 10; back <= 300 && !found; back += 10) {
		const t = structuredClone(lend);
		t.clock = t.nextWeek * 1440 - back;
		const after = run(t, { t: 'activity', id: 'rest' } as GameAction);
		if (!after.journal.some((j) => j.text.includes('还了你 $30'))) continue;
		found = true;
		assert.equal((after.tally!.in.social ?? 0) - before, 30);
	}
	assert.ok(found, 'fm-xiaoyu 几乎一定还钱');
	// 不传整份房租时按租约算
	const leased = structuredClone(s);
	leased.rental.lease!.rent += 60;
	assert.equal(rentShare(leased), Math.round((leased.rental.lease!.rent + FLAT_RULES.billsWeek.flat) / 2));
});

