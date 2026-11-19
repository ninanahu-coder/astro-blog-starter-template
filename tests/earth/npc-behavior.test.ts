// NPC 行为规则（第 43 批）：休假 / 病假 / 天气改日程、移动、空间分布、需求和心情、心情影响聊天
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import { interactNpc, npcPresent, npcsAt, npcStatus } from '../../src/game/core/engine.ts';
import { chatDc, leaveOn, npcMap, npcMood, npcNeeds, npcWhere, planFor, sickOn, slotMatches, travelHours } from '../../src/game/core/npc-behavior.ts';
import { inSpan, SEASON_DAYS, SEASONS, YEAR_DAYS } from '../../src/game/core/time.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { FESTIVALS } from '../../src/game/data/festivals.ts';
import { NPC_LEAVE, NPC_LINES, NPC_MOOD, NPC_SICK, NPC_TEMPER } from '../../src/game/data/npc-behavior.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WEATHERS } from '../../src/game/data/weather.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';

const get = (id: string) => NPCS.find((n) => n.id === id)!;
const at = (day: number, hour: number) => day * 1440 + hour * 60;
const seasonStart = (season: string) => SEASONS.findIndex((s) => s.id === season) * SEASON_DAYS;
const make = (seed = 3) => createCharacter({ id: 'beh-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed });
/** 这位 NPC 当天照常（不病、不休假、没有天气和节日安排） */
const usual = (id: string, day: number) => {
	const n = get(id);
	const c = day * 1440;
	return !sickOn(n, c) && !leaveOn(id, c) && !(n.schedule ?? []).some((sl) => (sl.weather || sl.festival) && slotMatches(n, sl, c));
};
const findDay = (pred: (d: number) => boolean, from = 0) => {
	for (let d = from; d < from + YEAR_DAYS * 8; d++) if (pred(d)) return d;
	throw new Error('找不到符合条件的一天');
};

test('行为数据自洽：假期、脾气、天气日程、台词', () => {
	const ids = new Set(NPCS.map((n) => n.id));
	const weathers = new Set(WEATHERS.map((w) => w.id));
	const locs = new Set(WORLD.locations.map((l) => l.id));
	for (const l of NPC_LEAVE) {
		assert.ok(ids.has(l.npc), `${l.npc} 存在`);
		assert.ok(l.day >= 1 && l.day <= SEASON_DAYS && l.days >= 1 && l.days <= 14, `${l.npc} 假期日期`);
		assert.ok(l.note.length > 0);
		// 假期不撞自己的节日安排：玩家冲着节日赶去，人却休假了
		for (const slot of get(l.npc).schedule ?? []) {
			if (!slot.festival) continue;
			const f = FESTIVALS.find((x) => x.id === slot.festival)!;
			for (let i = 0; i < l.days; i++) {
				const c = (seasonStart(l.season) + l.day - 1 + i) * 1440;
				assert.ok(!inSpan(c, f.season, f.day, f.days).active, `${l.npc} 的假期撞上了 ${f.id}`);
			}
		}
	}
	assert.equal(new Set(NPC_LEAVE.map((l) => l.npc)).size, NPC_LEAVE.length, '每位最多一段年假');
	for (const [id, t] of Object.entries(NPC_TEMPER)) {
		assert.ok(ids.has(id), `${id} 存在`);
		for (const w of Object.keys(t.weather ?? {})) assert.ok(weathers.has(w), `${id} 的天气 ${w} 存在`);
	}
	for (const n of NPCS) {
		assert.ok(NPC_TEMPER[n.id], `${n.id} 有脾气数据`);
		for (const slot of n.schedule ?? []) {
			for (const w of slot.weather ?? []) assert.ok(weathers.has(w), `${n.id} 日程天气 ${w} 存在`);
			if (slot.weatherAt) assert.ok(locs.has(slot.weatherAt), `${n.id} weatherAt 地点存在`);
		}
	}
	for (const [lv, table] of Object.entries(NPC_LINES)) {
		assert.ok(table.calm.length > 0, `${lv} 有兜底台词`);
		for (const lines of Object.values(table)) for (const line of lines!) assert.ok(!/[<>&]/.test(line), '台词不含 HTML 字符');
	}
	assert.ok(NPC_MOOD.chatDc.great < NPC_MOOD.chatDc.good && NPC_MOOD.chatDc.good < NPC_MOOD.chatDc.meh && NPC_MOOD.chatDc.meh < NPC_MOOD.chatDc.low, '心情越差越难聊');
});

test('确定性：同一时刻算两遍结果一样，不看玩家', () => {
	for (const n of NPCS) for (const c of [at(3, 9), at(40, 22), at(200, 13)]) {
		assert.deepEqual(planFor(n, c), planFor(n, c));
		assert.deepEqual(npcWhere(n, c, WORLD), npcWhere(n, c, WORLD));
		assert.deepEqual(npcMood(n, NPCS, c, WORLD), npcMood(n, NPCS, c, WORLD));
	}
});

test('年假：米娅冬季第 8–12 天不在，前后照常；优先于星期日程', () => {
	const mia = get('mia');
	const first = seasonStart('winter') + 7; // 冬季第 8 天
	for (let i = 0; i < 5; i++) {
		const p = planFor(mia, at(first + i, 10));
		assert.equal(p.away, 'leave', `第 ${i + 1} 天`);
		assert.equal(npcStatus(mia, at(first + i, 10)).state, 'away');
		assert.ok(!npcPresent(mia, 'perth', at(first + i, 10)) && !npcPresent(mia, 'fremantle', at(first + i, 10)) && !npcPresent(mia, 'rottnest', at(first + i, 10)));
		assert.equal(npcWhere(mia, at(first + i, 10), WORLD).kind, 'away');
	}
	assert.equal(planFor(mia, at(first - 1, 10)).away === 'leave', false);
	assert.equal(planFor(mia, at(first + 5, 10)).away === 'leave', false);
	// 第二年同一段也休
	assert.equal(planFor(mia, at(first + YEAR_DAYS, 10)).away, 'leave');
	const s = { ...make(), loc: 'perth', clock: at(first, 10) };
	assert.ok(!npcsAt(s, WA).some((a) => a.npc.id === 'mia'), '休假的人不在「这里的人」里');
	assert.equal(interactNpc(s, WA, 'mia', 'chat').ok, false);
});

test('病假：按季节的小概率，一病最多 maxDays 天，节日安排那几天不病', () => {
	let sick = 0, days = 0;
	for (const n of NPCS) {
		let run = 0;
		for (let d = 0; d < YEAR_DAYS * 4; d++) {
			const s = sickOn(n, d * 1440);
			days++;
			if (s) sick++;
			run = s ? run + 1 : 0;
			assert.ok(run <= NPC_SICK.maxDays * 2, `${n.id} 连病太久`);
			if (n.schedule?.some((sl) => sl.festival && slotMatches(n, sl, d * 1440))) assert.equal(s, false, `${n.id} 节日那天不病`);
			if (s && !leaveOn(n.id, d * 1440)) assert.equal(planFor(n, d * 1440).away, 'sick');
		}
	}
	const rate = sick / days;
	assert.ok(rate > 0.005 && rate < 0.05, `病假比例 ${rate}`);
	// 一病可能好几天：连着病的天数占病假天数的相当一部分（maxDays = 2 时约一半以上）
	let inRuns = 0;
	for (const n of NPCS) for (let d = 0; d < YEAR_DAYS * 4; d++) {
		const c = d * 1440;
		if (sickOn(n, c) && (sickOn(n, c - 1440) || sickOn(n, c + 1440))) inRuns++;
	}
	assert.ok(inRuns / sick > 0.3, `连病占比 ${inRuns / sick}`);
	// 节日安排那几天一律不病：查 200 年里每个有节日安排的 NPC 的每个节日日
	for (const n of NPCS) for (const slot of n.schedule ?? []) {
		if (!slot.festival) continue;
		const f = FESTIVALS.find((x) => x.id === slot.festival)!;
		for (let y = 0; y < 200; y++) for (let i = 0; i < f.days; i++) {
			const c = (y * YEAR_DAYS + seasonStart(f.season) + f.day - 1 + i) * 1440;
			assert.equal(sickOn(n, c), false, `${n.id} ${f.id} 第 ${y + 1} 年`);
		}
	}
	// 冬天比夏天多病
	const share = (season: string) => {
		let k = 0, t = 0;
		for (let y = 0; y < 8; y++) for (let i = 0; i < SEASON_DAYS; i++) for (const n of NPCS) { t++; if (sickOn(n, (y * YEAR_DAYS + seasonStart(season) + i) * 1440)) k++; }
		return k / t;
	};
	assert.ok(share('winter') > share('summer'), '冬天病得多');
});

test('天气改日程：岛上风暴的周六米娅留在城里；风暴天老杰克在码头补网；风暴天艾拉周日不过海', () => {
	const mia = get('mia');
	const d = findDay((d) => d % 7 === 5 && weatherOn('rottnest', d).id === 'storm' && !sickOn(mia, d * 1440) && !leaveOn('mia', d * 1440) && !FESTIVALS.some((f) => f.id === 'skyshow' && inSpan(d * 1440, f.season, f.day, f.days).active));
	assert.deepEqual([planFor(mia, at(d, 10)).loc, planFor(mia, at(d, 10)).note], ['perth', '岛上起风暴，渡轮停航，周六留在城里']);
	const calm = findDay((d) => d % 7 === 5 && weatherOn('rottnest', d).id !== 'storm' && usual('mia', d));
	assert.equal(planFor(mia, at(calm, 11)).loc, 'rottnest', '天好照常上岛');
	const jack = get('jack');
	const js = findDay((d) => weatherOn('fremantle', d).id === 'storm' && !sickOn(jack, d * 1440) && !leaveOn('jack', d * 1440));
	assert.deepEqual(planFor(jack, at(js, 10)).hours, [9, 15]);
	const ayla = get('ayla');
	const as = findDay((d) => d % 7 === 6 && weatherOn('kangaroo-island', d).id === 'storm' && !sickOn(ayla, d * 1440));
	assert.equal(planFor(ayla, at(as, 11)).loc, 'kangaroo-island');
	const ac = findDay((d) => d % 7 === 6 && weatherOn('kangaroo-island', d).id !== 'storm' && usual('ayla', d));
	assert.equal(planFor(ayla, at(ac, 11)).loc, 'victor-harbor');
});

test('移动：去外地那天先在路上，到了当班，收工再在路上回家，其余时间在家', () => {
	const mia = get('mia');
	const d = findDay((d) => d % 7 === 5 && usual('mia', d) && usual('mia', d - 1));
	const t = travelHours('perth', 'rottnest', WORLD);
	assert.equal(t, 1, '珀斯到罗特尼斯岛 1 小时');
	assert.ok(travelHours('port-hedland', 'broome', WORLD) >= 5, '黑德兰港到布鲁姆路很远');
	assert.equal(travelHours('perth', 'perth', WORLD), 0);
	assert.equal(travelHours('perth', 'nowhere', WORLD), 2, '找不到坐标用兜底值');
	const w = (h: number, m = 0) => npcWhere(mia, at(d, h) + m, WORLD);
	assert.deepEqual([w(8).kind, w(8).loc], ['off', 'perth']);
	assert.deepEqual([w(9, 30).kind, w(9, 30).loc, w(9, 30).to], ['travel', 'perth', 'rottnest']);
	assert.deepEqual([w(10).kind, w(10).loc], ['there', 'rottnest']);
	assert.deepEqual([w(16, 30).kind, w(16, 30).loc, w(16, 30).to], ['travel', 'rottnest', 'perth']);
	assert.deepEqual([w(18).kind, w(18).loc], ['off', 'perth']);
	// 夜班司机：周五跑布鲁姆，出发在开工前几小时，周六凌晨还在布鲁姆当班
	const dave = get('dave');
	const f = findDay((d) => d % 7 === 4 && usual('dave', d) && usual('dave', d + 1) && usual('dave', d - 1));
	const th = travelHours('port-hedland', 'broome', WORLD);
	assert.equal(npcWhere(dave, at(f, 20) - 30, WORLD).kind, 'travel');
	assert.equal(npcWhere(dave, at(f, 20) - th * 60 - 30, WORLD).kind, 'off');
	assert.deepEqual([npcWhere(dave, at(f + 1, 3), WORLD).kind, npcWhere(dave, at(f + 1, 3), WORLD).loc], ['there', 'broome']);
	assert.equal(npcWhere(dave, at(f + 1, 7), WORLD).kind, 'travel', '周六早上往回开');
});

test('空间分布：当班的地点和 npcPresent 完全一致，每位 NPC 同一时刻只在一处', () => {
	for (let c = 0; c < 70 * 1440; c += 90) {
		const map = npcMap(NPCS, c, WORLD);
		const seen = Object.values(map).flat();
		assert.equal(new Set(seen).size, seen.length, '没有分身');
		for (const n of NPCS) {
			const w = npcWhere(n, c, WORLD);
			for (const loc of [n.loc, ...(n.schedule ?? []).map((s) => s.loc)]) {
				assert.equal(w.kind === 'there' && w.loc === loc, npcPresent(n, loc, c), `${n.id} @${loc} clock=${c}`);
			}
			// 请假一致；唯一例外：昨天去外地、今天请假，凌晨收工后还在回家路上
			if (w.kind === 'away') assert.equal(npcStatus(n, c).state, 'away', `${n.id} clock=${c}`);
			if (npcStatus(n, c).state === 'away') assert.ok(w.kind === 'away' || w.kind === 'travel', `${n.id} 请假状态一致 clock=${c}`);
		}
	}
	// 周日上午弗里曼特尔集市：老杰克和米娅都在，彼此算有伴
	const d = findDay((d) => d % 7 === 6 && usual('mia', d) && usual('jack', d));
	const map = npcMap(NPCS, at(d, 10), WORLD);
	assert.deepEqual([...map.fremantle].sort(), ['jack', 'mia']);
	assert.equal(npcNeeds(get('mia'), NPCS, at(d, 10), WORLD).company, 1);
	assert.equal(npcNeeds(get('linda'), NPCS, at(d, 10), WORLD).company, 0, '琳达一个人在岛上');
});

test('需求：精力在班上逐渐下降，收工前比刚开工低；炎热更累', () => {
	const tom = get('tom');
	const d = findDay((d) => usual('tom', d) && d % 7 < 5 && weatherOn('geraldton', d).id !== 'hot');
	const early = npcNeeds(tom, NPCS, at(d, 5), WORLD).energy;
	const late = npcNeeds(tom, NPCS, at(d, 13), WORLD).energy;
	assert.ok(early > late, `${early} > ${late}`);
	const hot = findDay((d) => usual('kev', d) && weatherOn('coober-pedy', d).id === 'hot' && d % 7 < 6);
	const cool = findDay((d) => usual('kev', d) && weatherOn('coober-pedy', d).id === 'sunny' && d % 7 < 6);
	assert.ok(npcNeeds(get('kev'), NPCS, at(hot, 10), WORLD).energy < npcNeeds(get('kev'), NPCS, at(cool, 10), WORLD).energy);
});

test('心情：节日让人高兴，风暴让渔夫心烦；台词按心情挑，占位符都替换掉了', () => {
	// 金矿杯赛马周：比尔整天在赛马场，心情的主因是节日
	const bill = get('bill');
	const cup = FESTIVALS.find((f) => f.id === 'goldfields-cup')!;
	const cd = seasonStart(cup.season) + cup.day - 1;
	const m = npcMood(bill, NPCS, at(cd, 12), WORLD);
	assert.equal(m.cause, 'festival', '心情的主因是节日');
	const plain = findDay((d) => usual('bill', d) && d % 7 < 5 && !['hot'].includes(weatherOn('kalgoorlie', d).id));
	assert.ok(m.score > npcMood(bill, NPCS, at(plain, 17), WORLD).score, '节日比平常高兴');
	// 风暴天汤姆在码头修船，心情差
	const tom = get('tom');
	const sd = findDay((d) => weatherOn('geraldton', d).id === 'storm' && !sickOn(tom, d * 1440) && d % 7 < 5);
	const sunny = findDay((d) => weatherOn('geraldton', d).id === 'sunny' && usual('tom', d) && d % 7 < 5);
	assert.ok(npcMood(tom, NPCS, at(sd, 10), WORLD).score < npcMood(tom, NPCS, at(sunny, 10), WORLD).score);
	// 台词：一年里所有当班时刻，台词都来自对应心情的表，没有残留占位符
	for (let d = 0; d < YEAR_DAYS; d += 3) for (const n of NPCS) {
		const c = at(d, 11);
		if (npcWhere(n, c, WORLD).kind !== 'there') continue;
		const mood = npcMood(n, NPCS, c, WORLD);
		assert.ok(!/[{}]/.test(mood.line), mood.line);
		const pool = NPC_LINES[mood.level][mood.cause]!;
		const re = (t: string) => new RegExp('^' + t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '[^{}]+') + '$');
		assert.ok(pool.some((t) => re(t).test(mood.line)), `${mood.line} 来自 ${mood.level}/${mood.cause}`);
		assert.ok(NPC_LINES[mood.level][mood.cause] || mood.cause === 'calm', `${mood.level}/${mood.cause} 有台词`);
	}
});

test('心情影响聊天：开场是 TA 的招呼，心情差时聊得投机的概率更低', () => {
	// 找一个 TA 心情很好的时刻和一个心情差的时刻（同一位 NPC 也行，不同位也行）
	type Spot = { npc: string; loc: string; clock: number };
	let great: Spot | undefined, low: Spot | undefined;
	for (let d = 0; d < YEAR_DAYS * 2 && (!great || !low); d++) for (const n of NPCS) for (const h of [9, 12, 15]) {
		const c = at(d, h);
		const w = npcWhere(n, c, WA);
		if (w.kind !== 'there' || !WA.locations.some((l) => l.id === w.loc)) continue;
		const lv = npcMood(n, NPCS, c, WA).level;
		if (lv === 'great' && !great) great = { npc: n.id, loc: w.loc, clock: c };
		if (lv === 'low' && !low) low = { npc: n.id, loc: w.loc, clock: c };
	}
	assert.ok(great && low, '一年里有好有坏');
	const rate = (spot: Spot) => {
		let good = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const s = { ...make(seed), loc: spot.loc, clock: spot.clock };
			const here = npcsAt(s, WA).find((a) => a.npc.id === spot.npc)!;
			const r = interactNpc(s, WA, spot.npc, 'chat');
			assert.ok(r.ok, r.msg);
			assert.ok(r.msg.startsWith(`${here.npc.name}：${here.mood.line}`), r.msg);
			if (r.msg.includes('聊得很投机')) good++;
		}
		return good / 300;
	};
	assert.ok(rate(great!) > rate(low!) + 0.1, '心情好更容易聊得投机');
	assert.equal(chatDc({ level: 'low' } as never), 45 + NPC_MOOD.chatDc.low);
});
