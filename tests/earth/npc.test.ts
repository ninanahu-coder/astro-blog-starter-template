import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { GIFT_GAIN, getRelation, giftReaction, interactNpc, npcPlan, npcsAt, performActivity, relationTier } from '../../src/game/core/engine.ts';
import { FESTIVALS } from '../../src/game/data/festivals.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { parseAction, applyAction } from '../../src/game/core/actions.ts';
import { isOpen, period } from '../../src/game/core/time.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { WA } from '../../src/game/data/wa.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = () => createCharacter({ id: 'npc-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 3 });

test('NPC 数据自洽', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const items = new Set(ITEMS.map((i) => i.id));
	assert.equal(new Set(NPCS.map((n) => n.id)).size, NPCS.length);
	for (const n of NPCS) {
		assert.ok(locs.has(n.loc), `${n.id} 地点存在`);
		const g = [...n.gifts.love, ...n.gifts.like, ...n.gifts.dislike];
		assert.ok(n.gifts.love.length, `${n.id} 至少有一件最爱`);
		assert.ok(g.every((i) => items.has(i)), `${n.id} 礼物物品存在`);
		assert.equal(new Set(g).size, g.length, `${n.id} 同一件物品只能在一档`);
		const gates = n.stories.map((st) => st.at);
		assert.deepEqual(gates, [...gates].sort((a, b) => a - b), `${n.id} 剧情按门槛排序`);
		assert.equal(new Set(gates).size, gates.length, `${n.id} 剧情门槛不重复`);
		assert.ok(gates.includes(60), `${n.id} 有「好友」剧情`);
		for (const st of n.stories) {
			assert.ok(st.at > 0 && st.at <= 100, `${n.id} 门槛在 1–100`);
			for (const i of Object.keys(st.fx?.items ?? {})) assert.ok(items.has(i), `${n.id} 回报物品存在`);
			if (st.fx?.moodlet) assert.ok(MOODLETS.some((m) => m.id === st.fx!.moodlet), `${n.id} 心情状态存在`);
		}
		if (n.perk) {
			assert.ok(n.perk.at > 0 && n.perk.at <= 100 && n.perk.every >= 1, `${n.id} 专属互动参数`);
			if (n.perk.fx.moodlet) assert.ok(MOODLETS.some((m) => m.id === n.perk!.fx.moodlet));
		}
		for (const slot of n.schedule ?? []) {
			assert.ok(locs.has(slot.loc), `${n.id} 日程地点存在`);
			assert.ok(slot.weekdays?.every((d) => Number.isInteger(d) && d >= 0 && d < 7) ?? true, `${n.id} 星期 0–6`);
			if (slot.festival) assert.ok(FESTIVALS.some((f) => f.id === slot.festival), `${n.id} 节日存在`);
		}
	}
});

test('时段与营业时间（含跨午夜）', () => {
	assert.equal(period(at(6)).name, '清晨');
	assert.equal(period(at(12)).name, '白天');
	assert.equal(period(at(18)).name, '傍晚');
	assert.equal(period(at(23)).name, '夜晚');
	assert.ok(isOpen([9, 17], at(9)) && !isOpen([9, 17], at(17)));
	assert.ok(isOpen([20, 6], at(23)) && isOpen([20, 6], at(3)) && !isOpen([20, 6], at(12)));
	assert.ok(isOpen(undefined, at(3)));
});

test('酒吧凌晨关门、白天营业', () => {
	const s = { ...make(), loc: 'fremantle', cash: 500 };
	const closed = performActivity({ ...s, clock: at(2) }, WA, 'pub');
	assert.equal(closed.ok, false);
	assert.match(closed.msg, /营业时间/);
	assert.equal(performActivity({ ...s, clock: at(15) }, WA, 'pub').ok, true);
});

test('NPC 只在自己的地点和作息时间出现', () => {
	const s = make();
	assert.deepEqual(npcsAt({ ...s, clock: at(9, 1) }, WA).map((a) => a.npc.id), ['mia'], '周二');
	assert.deepEqual(npcsAt({ ...s, clock: at(9) }, WA).map((a) => a.npc.id), ['mia', 'linda'], '周一琳达回珀斯开会');
	assert.deepEqual(npcsAt({ ...s, clock: at(20) }, WA), [], '下班了');
	assert.deepEqual(npcsAt({ ...s, loc: 'port-hedland', clock: at(2) }, WA).map((a) => a.npc.id), ['dave'], '夜班司机');
});

test('聊天、送礼、帮忙：每种每天一次，涨关系', () => {
	let s = { ...make(), clock: at(9) };
	const r1 = interactNpc(s, WA, 'mia', 'chat');
	assert.ok(r1.ok);
	assert.ok(getRelation(r1.state, 'mia').score >= 3);
	assert.equal(interactNpc(r1.state, WA, 'mia', 'chat').ok, false, '同一天不能再聊');
	const r2 = interactNpc(r1.state, WA, 'mia', 'gift');
	assert.ok(r2.ok, r2.msg);
	assert.equal(r2.state.inventory.snack, undefined, '送掉了唯一的能量棒');
	assert.equal(interactNpc(r2.state, WA, 'mia', 'gift').ok, false);
	s = { ...r2.state, clock: at(9, 1) };
	assert.ok(interactNpc(s, WA, 'mia', 'chat').ok, '第二天可以再聊');
	assert.equal(interactNpc({ ...s, loc: 'broome' }, WA, 'mia', 'chat').ok, false, '人不在');
});

test('第一次成为好友发放一次性回报', () => {
	const s = { ...make(), clock: at(9), relations: { mia: { score: 55, last: {}, seen: [10, 30], known: [] } } };
	const r = interactNpc(s, WA, 'mia', 'help');
	assert.ok(r.ok);
	assert.equal(relationTier(getRelation(r.state, 'mia').score), '好友');
	assert.deepEqual(getRelation(r.state, 'mia').seen, [10, 30, 60]);
	assert.ok(r.state.moodlets.some((m) => m.id === 'new-friend'));
	assert.equal(r.state.cash, s.cash + 250);
	const again = interactNpc({ ...r.state, clock: at(9, 1) }, WA, 'mia', 'help');
	assert.equal(again.state.cash, r.state.cash, '回报只发一次');
});

test('存档校验：关系', () => {
	const dirty = { ...make(), relations: { mia: { score: 999, last: { chat: -3, gift: 2.7 }, bonded: 'yes' }, ghost: { score: 50 } } };
	const clean = sanitizeState(dirty)!;
	assert.deepEqual(clean.relations, { mia: { score: 100, last: { gift: 2 }, seen: [10, 30, 60, 90], known: [] } }, '旧存档：越过的门槛记为看过');
	const old = { ...make() } as Record<string, unknown>;
	Reflect.deleteProperty(old, 'relations');
	assert.deepEqual(sanitizeState(old)!.relations, {});
});

// 第 day 天（0 = 周一）hour 点
const on = (day: number, hour: number) => at(hour, day);

test('日程：按星期换地点，凌晨跨午夜沿用前一天的安排', () => {
	const mia = NPCS.find((n) => n.id === 'mia')!;
	assert.equal(npcPlan(mia, on(0, 9)).loc, 'perth', '周一在珀斯');
	assert.equal(npcPlan(mia, on(5, 11)).loc, 'rottnest', '周六去岛上');
	assert.equal(npcPlan(mia, on(6, 10)).loc, 'fremantle', '周日赶集');
	const s = make();
	assert.deepEqual(npcsAt({ ...s, loc: 'fremantle', clock: on(6, 10) }, WA).map((a) => a.npc.id).sort(), ['jack', 'mia']);
	assert.ok(!npcsAt({ ...s, loc: 'perth', clock: on(6, 10) }, WA).some((a) => a.npc.id === 'mia'), '周日不在珀斯');
	// 戴夫周五夜里跑布鲁姆线，周六凌晨 3 点仍在布鲁姆
	assert.ok(npcsAt({ ...s, loc: 'broome', clock: on(4, 22) }, WA).some((a) => a.npc.id === 'dave'));
	assert.ok(npcsAt({ ...s, loc: 'broome', clock: on(5, 3) }, WA).some((a) => a.npc.id === 'dave'));
	assert.ok(!npcsAt({ ...s, loc: 'port-hedland', clock: on(5, 3) }, WA).some((a) => a.npc.id === 'dave'));
	assert.ok(npcsAt({ ...s, loc: 'port-hedland', clock: on(6, 3) }, WA).some((a) => a.npc.id === 'dave'), '周日凌晨回到黑德兰港');
});

test('日程：节日优先', () => {
	const bill = NPCS.find((n) => n.id === 'bill')!;
	const cup = FESTIVALS.find((f) => f.id === 'goldfields-cup')!;
	const day = cup.day - 1; // 春季，第 1 年
	assert.deepEqual(npcPlan(bill, at(12, day)).hours, [10, 23]);
	assert.equal(day % 7, 5, '赛马周第一天是周六');
	assert.deepEqual(npcPlan(bill, at(12, day + 7)).hours, [16, 23], '下周六节日结束，回到平时作息');
	assert.deepEqual(npcPlan(bill, at(12, day + 8)).hours, [12, 23], '周日中午就到酒吧');
});

test('送礼：四档反应，送过一次就记住', () => {
	const mia = NPCS.find((n) => n.id === 'mia')!;
	assert.equal(giftReaction(mia, 'snack'), 'love');
	assert.equal(giftReaction(mia, 'water'), 'like');
	assert.equal(giftReaction(mia, 'coffee'), 'dislike');
	assert.equal(giftReaction(mia, 'firstaid'), 'neutral');
	const base = { ...make(), clock: on(0, 9), inventory: { coffee: 1, firstaid: 1, water: 1 }, relations: {} };
	const bad = interactNpc(base, WA, 'mia', 'gift', 'coffee');
	assert.ok(bad.ok);
	assert.equal(getRelation(bad.state, 'mia').score, GIFT_GAIN.dislike);
	assert.deepEqual(getRelation(bad.state, 'mia').known, ['coffee']);
	assert.ok(bad.state.moodlets.some((m) => m.id === 'gift-awkward'));
	const auto = interactNpc(base, WA, 'mia', 'gift');
	assert.equal(auto.state.inventory.water, undefined, '不指定物品时挑反应最好的（喜欢 > 一般，不挑讨厌的）');
	assert.equal(getRelation(auto.state, 'mia').score, GIFT_GAIN.like);
	assert.equal(interactNpc(base, WA, 'mia', 'gift', 'snack').ok, false, '没有的东西送不了');
	assert.equal(interactNpc({ ...base, inventory: {} }, WA, 'mia', 'gift').ok, false);
});

test('剧情：一次跨过多档全部触发，各触发一次', () => {
	const s = { ...make(), clock: on(0, 9), inventory: { snack: 2 }, relations: { mia: { score: 28, last: {}, seen: [], known: [] } } };
	const r = interactNpc(s, WA, 'mia', 'gift', 'snack');
	assert.deepEqual(getRelation(r.state, 'mia').seen, [10, 30]);
	assert.match(r.msg, /记住你的口味/);
	assert.match(r.msg, /打烊后的闲聊/);
	const again = interactNpc({ ...r.state, clock: on(1, 9) }, WA, 'mia', 'gift', 'snack');
	assert.doesNotMatch(again.msg, /打烊后的闲聊/);
	assert.deepEqual(getRelation(again.state, 'mia').seen, [10, 30]);
});

test('专属互动：关系够了才解锁，有冷却', () => {
	const leo = { ...make(), loc: 'margaret-river', clock: on(2, 9) };
	const low = npcsAt({ ...leo, relations: { leo: { score: 40, last: {}, seen: [10, 30], known: [] } } }, WA)[0];
	assert.match(low.blocked.perk!, /好友/);
	const ok = { ...leo, relations: { leo: { score: 65, last: {}, seen: [10, 30, 60], known: [] } } };
	const r = interactNpc(ok, WA, 'leo', 'perk');
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.skills.swimming > ok.skills.swimming);
	assert.equal(interactNpc({ ...r.state, clock: on(3, 9) }, WA, 'leo', 'perk').ok, false, '每 3 天一次');
	assert.ok(interactNpc({ ...r.state, clock: on(5, 9) }, WA, 'leo', 'perk').ok);
	assert.equal(interactNpc({ ...make(), clock: on(0, 9) }, WA, 'mia', 'perk').ok, false, '米娅的早餐要到「朋友」');
	assert.equal(interactNpc({ ...make(), loc: 'rottnest', clock: on(1, 9) }, WA, 'linda', 'perk').ok, false);
});

test('动作协议：送礼可指定物品，其余互动不接受物品', () => {
	assert.deepEqual(parseAction({ t: 'npc', npc: 'mia', act: 'gift', item: 'snack' }), { t: 'npc', npc: 'mia', act: 'gift', item: 'snack' });
	assert.deepEqual(parseAction({ t: 'npc', npc: 'mia', act: 'perk' }), { t: 'npc', npc: 'mia', act: 'perk' });
	assert.equal(parseAction({ t: 'npc', npc: 'mia', act: 'chat', item: 'snack' }), null);
	assert.equal(parseAction({ t: 'npc', npc: 'mia', act: 'gift', item: '<b>' }), null);
	const s = { ...make(), clock: on(0, 9), inventory: { snack: 1 } };
	const r = applyAction(s, WA, { t: 'npc', npc: 'mia', act: 'gift', item: 'snack' });
	assert.ok(r.ok, r.msg);
	assert.equal(getRelation(r.state, 'mia').score, GIFT_GAIN.love);
});

test('存档校验：剧情门槛和已知物品只留合法的', () => {
	const dirty = { ...make(), relations: { mia: { score: 20, last: { perk: 3 }, seen: [10, 77, '30'], known: ['snack', 'ghost', 5, 'snack'] } } };
	assert.deepEqual(sanitizeState(dirty)!.relations.mia, { score: 20, last: { perk: 3 }, seen: [10], known: ['snack'] });
	const legacy = { ...make(), relations: { mia: { score: 45, last: {}, bonded: true } } };
	assert.deepEqual(sanitizeState(legacy)!.relations.mia.seen, [10, 30, 60], '旧存档领过好友回报的不再发');
});
