// 爱好与收集（docs/earth-game/hobbies.md）：数据自洽、钓鱼规定、熟练度和递减、六个爱好的动作、同好、收集册里程碑、动作协议、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { cleanHobby, createCharacter, emptyHobby, sanitizeState } from '../../src/game/core/character.ts';
import { fishingAt, npcPresent, takeQuestPhoto } from '../../src/game/core/engine.ts';
import { birdingAt, checkCollections, collections, doHobby, fishCm, fishRuleAt, gardenStatus, goFishing, hobbiesHere, hobbyLevel, judgeCatch, nextCraft, photoScore, rarityCounts, repeatMult, ruleLabel, songsKnown, stateOf } from '../../src/game/core/hobbies.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { FISH } from '../../src/game/data/fish.ts';
import { FISH_CM, FISH_LICENCE, FISH_RULES } from '../../src/game/data/fish-rules.ts';
import { BIRDS, COLLECTION_REWARD, CRAFTS, HOBBIES, HOBBY, HOBBY_IDS, INSTRUMENT, PHOTO_WORK, PLANTS, SONGS } from '../../src/game/data/hobbies.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { ANIMALS } from '../../src/game/data/wildlife.ts';
import { PHOTO_QUESTS } from '../../src/game/data/photo-quests.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { areaOf } from '../../src/game/data/areas-base.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import { activityClosed } from '../../src/game/core/disasters.ts';
import { HAZARDS } from '../../src/game/data/disasters.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { isFading } from '../../src/game/core/relations.ts';
import { RELATION_DECAY } from '../../src/game/data/relations.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, seed = 3): PlayerState => ({
	...createCharacter({ id: 'hobby-player', name: '好', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 50, social: 50 },
	clock: at(10),
	cash: 500,
	...over,
});
const calmDay = (loc: string, from = 0) => {
	for (let d = from; d < from + 200; d++) if (!weatherOn(loc, d).closesSea) return d;
	throw new Error('没有平静的日子');
};
const LOCS = new Set(WORLD.locations.map((l) => l.id));
const home = (loc: string) => ({ type: 'room', loc, furniture: {} });

test('数据：爱好、鸟、植物、手工、曲目自洽；同好 NPC 存在；乐器能买到', () => {
	assert.deepEqual(HOBBIES.map((h) => h.id), HOBBY_IDS);
	for (const h of HOBBIES) for (const p of h.pals) assert.ok(NPCS.some((n) => n.id === p), `${h.id} 的同好 ${p}`);
	assert.equal(new Set(BIRDS.map((b) => b.id)).size, BIRDS.length);
	for (const b of BIRDS) {
		assert.ok(b.weight > 0, b.id);
		for (const l of b.where.locs ?? []) assert.ok(LOCS.has(l), `${b.id} 的地点 ${l}`);
		assert.ok(WORLD.locations.some((l) => b.where.locs?.includes(l.id) || b.where.kinds?.includes(l.kind) || b.where.tags?.some((t) => l.tags.includes(t))), `${b.id} 至少有一个地方能看到`);
		// 和野生动物图鉴同 id 的鸟，名字要一致（看见了一起记）
		const a = ANIMALS.find((x) => x.id === b.id);
		if (a) assert.equal(a.name, b.name, b.id);
	}
	assert.equal(new Set(PLANTS.map((p) => p.id)).size, PLANTS.length);
	for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) assert.ok(PLANTS.some((p) => p.seasons.includes(season)), `${season} 有能种的`);
	for (const p of PLANTS) assert.ok(p.days >= 1 && p.seed > 0, p.id);
	assert.ok(CRAFTS.some((c) => c.level === 1), '1 级就有能做的手工');
	for (const c of CRAFTS) assert.ok(c.level >= 1 && c.level <= HOBBY.levels.length && c.cost > 0, c.id);
	assert.equal(SONGS[0].xp, 0);
	for (let i = 1; i < SONGS.length; i++) assert.ok(SONGS[i].xp > SONGS[i - 1].xp, '曲目按熟练度排好');
	assert.ok(ITEMS.some((i) => i.id === INSTRUMENT), '乐器是商店物品');
	assert.ok(WORLD.locations.some((l) => ITEMS.find((i) => i.id === INSTRUMENT)!.shop.kinds?.includes(l.kind)), '有地方卖乐器');
	assert.ok(MOODLETS.some((m) => m.id === HOBBY.moodlet));
});

test('钓鱼规定数据：鱼种和地点存在、分区地点属于那个州、每条有官方来源、都标了待核实；每种鱼都有体长区间', () => {
	for (const r of FISH_RULES) {
		assert.ok(FISH.some((f) => f.id === r.fish), r.fish);
		for (const l of r.locs ?? []) assert.equal(areaOf(l)?.id, r.state, `${r.fish} 的分区地点 ${l} 在 ${r.state}`);
		assert.match(r.src, /^https:\/\/(www\.)?(dpird\.wa\.gov\.au|rules\.fish\.wa\.gov\.au|wa\.gov\.au|pir\.sa\.gov\.au)\//, `${r.fish}/${r.state} 的来源是官方网站`);
		assert.equal(r.verified, false);
		assert.ok(r.closed || r.closedSeasons || r.minCm !== undefined || r.bag !== undefined, `${r.fish}/${r.state} 至少有一条限制`);
		if (r.closed || r.closedSeasons) assert.ok(r.why, '禁捕要写原因');
	}
	// 同一州同一种鱼最多一条通用规定（不写 locs 的）
	const generic = FISH_RULES.filter((r) => !r.locs).map((r) => `${r.fish}|${r.state}`);
	assert.equal(new Set(generic).size, generic.length);
	for (const f of FISH) {
		const cm = FISH_CM[f.id];
		assert.ok(cm && cm[0] > 0 && cm[1] > cm[0], `${f.id} 的体长区间`);
	}
	for (const l of Object.values(FISH_LICENCE)) assert.match(l.src, /^https:\/\//);
});

test('规定查找：分区优先，其次州的通用规定；不在规定表里的鱼种是待核实', () => {
	assert.equal(stateOf('perth'), 'wa');
	assert.equal(stateOf('port-lincoln'), 'sa');
	assert.equal(fishRuleAt('blue-crab', 'perth')!.bag, 5, '天鹅河蓝花蟹每天 5 只');
	assert.equal(fishRuleAt('blue-crab', 'mandurah')!.bag, 10);
	assert.equal(fishRuleAt('whiting', 'port-lincoln')!.minCm, 32, '南澳海湾 32 cm');
	assert.equal(fishRuleAt('whiting', 'ceduna')!.minCm, 30, '南澳 136° 以西 30 cm');
	assert.equal(fishRuleAt('whiting', 'fremantle')!.minCm, 28, '西澳 28 cm');
	assert.equal(fishRuleAt('pink-snapper', 'monkey-mia')!.minCm, 45, '西海岸以外 45 cm');
	assert.equal(fishRuleAt('pink-snapper', 'geraldton')!.minCm, undefined, '西海岸分区没查到尺寸就不写');
	assert.ok(fishRuleAt('pink-snapper', 'kangaroo-island')!.closed);
	assert.equal(fishRuleAt('squid', 'ceduna')!.bag, 15);
	assert.ok(fishRuleAt('squid', 'glenelg')!.closed);
	assert.equal(fishRuleAt('mullet', 'fremantle'), undefined);
	assert.equal(ruleLabel(undefined), '规定待核实');
	assert.equal(ruleLabel(fishRuleAt('whiting', 'fremantle')), '最小 28 cm · 每天 12 条');
	assert.equal(ruleLabel(fishRuleAt('pink-snapper', 'kangaroo-island')), '禁捕');
	assert.match(ruleLabel(fishRuleAt('whiting', 'glenelg')), /秋季禁捕/);
});

test('判定一条鱼：禁捕、禁渔季、不够尺寸、超过数量都放生；正好够尺寸、数量差一条都能带走', () => {
	const rule = { fish: 'x', state: 'wa' as const, minCm: 28, bag: 2, src: 'https://x', verified: false as const };
	assert.deepEqual(judgeCatch(undefined, 1, 99, 'spring'), { keep: true }, '没有规定不限');
	assert.deepEqual(judgeCatch(rule, 28, 1, 'spring'), { keep: true }, '正好 28 cm、今天带走 1 条');
	assert.match((judgeCatch(rule, 27.9, 0, 'spring') as { why: string }).why, /28 cm/);
	assert.match((judgeCatch(rule, 40, 2, 'spring') as { why: string }).why, /最多 2 条/);
	assert.equal(judgeCatch({ ...rule, closed: true, why: '禁捕' }, 40, 0, 'spring').keep, false);
	assert.equal(judgeCatch({ ...rule, closedSeasons: ['autumn'], why: '产卵' }, 40, 0, 'autumn').keep, false);
	assert.equal(judgeCatch({ ...rule, closedSeasons: ['autumn'], why: '产卵' }, 40, 0, 'winter').keep, true);
});

test('体长：在区间里、可复现、不推进随机种子', () => {
	const s = make();
	for (const f of FISH) {
		const cm = fishCm(s, f.id);
		assert.ok(cm >= FISH_CM[f.id][0] && cm <= FISH_CM[f.id][1], `${f.id} ${cm}`);
		assert.equal(fishCm(s, f.id), cm);
	}
	assert.equal(s.seed, make().seed);
});

test('钓鱼：合规定的卖钱并计数；放生的不卖钱、不计数，但记进鱼种图鉴和最大尺寸', () => {
	const d = calmDay('fremantle');
	let kept = 0;
	let released = 0;
	for (let seed = 1; seed <= 200; seed++) {
		const s = make({ loc: 'fremantle', clock: at(10, d), inventory: { rod: 1 } }, seed);
		const r = goFishing(s, WA);
		assert.ok(r.ok, r.msg);
		const ids = Object.keys(r.state.fish);
		if (!ids.length) continue;
		const f = FISH.find((x) => x.id === ids[0])!;
		assert.ok(r.state.hobby.best[f.id] > 0, '记下了尺寸');
		if (/卖给鱼铺/.test(r.msg)) {
			kept++;
			assert.equal(r.state.cash, s.cash + f.price);
			assert.equal(r.state.hobby.bag[f.id], 1);
		} else {
			released++;
			assert.match(r.msg, /放生/);
			assert.equal(r.state.cash, s.cash);
			assert.equal(r.state.hobby.bag[f.id] ?? 0, 0);
		}
	}
	assert.ok(kept > 0 && released > 0, `带走 ${kept}、放生 ${released}`);
});

test('数量限制：今天已经带满就放生；换了一天数量清零', () => {
	const d = calmDay('fremantle', 3);
	const full = Object.fromEntries(FISH.map((f) => [f.id, 99]));
	let caught = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const base = make({ loc: 'fremantle', clock: at(10, d), inventory: { rod: 1 } }, seed);
		const today = goFishing({ ...base, hobby: { ...emptyHobby(), day: d, bag: full } }, WA);
		if (!Object.keys(today.state.fish).length) continue;
		caught++;
		const id = Object.keys(today.state.fish)[0];
		if (fishRuleAt(id, 'fremantle')?.bag !== undefined) {
			assert.match(today.msg, /每天最多/);
			assert.equal(today.state.cash, base.cash);
		}
		// 记的是昨天的数量：清零后照常判定
		const yday = goFishing({ ...base, hobby: { ...emptyHobby(), day: d - 1, bag: full } }, WA);
		assert.doesNotMatch(yday.msg, /每天最多/);
		assert.equal(yday.state.hobby.day, d);
	}
	assert.ok(caught > 0);
});

test('南澳禁捕：袋鼠岛钓到鲷鱼一律放生', () => {
	let snapper = 0;
	const day = calmDay('kangaroo-island');
	for (let seed = 1; seed <= 400; seed++) {
		const s = make({ loc: 'kangaroo-island', clock: at(12, day), inventory: { rod: 1 } }, seed);
		const r = goFishing(s, WORLD);
		if (!r.state.fish['pink-snapper']) continue;
		snapper++;
		assert.match(r.msg, /禁捕鲷鱼.*放生/);
		assert.equal(r.state.cash, s.cash);
	}
	assert.ok(snapper > 0, '至少钓到过一条鲷鱼');
	assert.ok(fishingAt(make({ loc: 'kangaroo-island', clock: at(12, calmDay('kangaroo-island')), inventory: { rod: 1 } }), WORLD), '南澳能钓鱼');
});

test('钓鱼熟练度越高越不容易空手', () => {
	const d = calmDay('fremantle');
	const count = (xp: number) => {
		let n = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const r = goFishing(make({ loc: 'fremantle', clock: at(10, d), inventory: { rod: 1 }, hobby: { ...emptyHobby(), xp: { fishing: xp } } }, seed), WA);
			if (Object.keys(r.state.fish).length) n++;
		}
		return n;
	};
	assert.ok(count(100) > count(0));
});

test('熟练度：等级分界；当天第一次 +3 并给心情状态，再做 +1、乐趣打折；换一天重新算', () => {
	assert.equal(hobbyLevel(0), 1);
	assert.equal(hobbyLevel(9), 1);
	assert.equal(hobbyLevel(10), 2);
	assert.equal(hobbyLevel(100), 5);
	assert.equal(hobbyLevel(999), 5);
	assert.deepEqual([0, 1, 2, 5].map(repeatMult), [1, 0.5, 0.25, 0.25]);
	const s = make({ loc: 'perth', clock: at(12, calmDay('perth')) });
	const a = doHobby(s, WA, 'photo');
	assert.ok(a.ok, a.msg);
	assert.equal(a.state.hobby.xp.photo, HOBBY.xpFirst);
	assert.ok(a.state.moodlets.some((m) => m.id === HOBBY.moodlet));
	const funA = a.state.needs.fun - s.needs.fun;
	const b = doHobby(a.state, WA, 'photo');
	assert.equal(b.state.hobby.xp.photo, HOBBY.xpFirst + HOBBY.xpRepeat);
	assert.equal(b.state.hobby.today.photo, 2);
	assert.ok(b.state.needs.fun - a.state.needs.fun < funA, '第二次乐趣少');
	const next = doHobby({ ...b.state, clock: b.state.clock + 1440 }, WA, 'photo');
	assert.equal(next.state.hobby.today.photo, 1, '新的一天从 1 开始');
	assert.equal(next.state.hobby.xp.photo, HOBBY.xpFirst * 2 + HOBBY.xpRepeat);
});

test('摄影：分数构成；作品集留最好的；摄影任务的照片也进作品集', () => {
	assert.equal(photoScore(1, 'day', 'sunny', 0), PHOTO_WORK.base);
	assert.equal(photoScore(1, 'dusk', 'sunny', 0), PHOTO_WORK.base + PHOTO_WORK.golden);
	assert.equal(photoScore(3, 'day', 'storm', 0), PHOTO_WORK.base + 2 * PHOTO_WORK.perLevel + PHOTO_WORK.weather.storm);
	assert.equal(photoScore(5, 'dawn', 'storm', 0.999), 100, '封顶 100');
	const s = make({ loc: 'perth', hobby: { ...emptyHobby(), works: { perth: 99 } } });
	const r = doHobby(s, WA, 'photo');
	assert.equal(r.state.hobby.works.perth, 99, '没超过原来的不替换');
	const r2 = doHobby({ ...s, hobby: emptyHobby() }, WA, 'photo');
	assert.ok(r2.state.hobby.works.perth > 0);
	// 摄影任务：第一个任务在珀斯傍晚
	const q = PHOTO_QUESTS[0];
	let qs: PlayerState | null = null;
	for (let d = 0; d < 200 && !qs; d++) {
		const t = make({ loc: q.loc, clock: at(18, d), photoQuest: 0 });
		const res = takeQuestPhoto(t, WA);
		if (res.ok) qs = res.state;
	}
	assert.equal(qs!.hobby.works[q.loc], PHOTO_WORK.quest);
});

test('观鸟：没有鸟的地方不显示；看见新鸟记下；和图鉴同一种鸟一起记进图鉴', () => {
	assert.equal(birdingAt(make({ loc: 'karijini' }), WA)?.birds.some((b) => b.id === 'wedge-tailed-eagle'), true, '公园白天有楔尾雕');
	let found = 0;
	let dexToo = 0;
	for (let seed = 1; seed <= 200; seed++) {
		const s = make({ loc: 'perth', clock: at(10, calmDay('perth')) }, seed);
		const spot = birdingAt(s, WA)!;
		if (spot.blocked) continue;
		const r = doHobby(s, WA, 'birding');
		assert.ok(r.ok, r.msg);
		const got = r.state.hobby.birds[0];
		if (!got) continue;
		found++;
		assert.ok(spot.birds.some((b) => b.id === got), '只会看到此刻能看到的');
		if (ANIMALS.some((a) => a.id === got)) {
			dexToo++;
			assert.ok(r.state.dex.includes(got));
		} else assert.ok(!r.state.dex.includes(got));
	}
	assert.ok(found > 0 && dexToo > 0, `看见 ${found} 次，其中图鉴里也有的 ${dexToo} 次`);
	for (let day = 0; day < 200; day++) {
		if (weatherOn('perth', day).id !== 'storm') continue;
		assert.match(birdingAt(make({ loc: 'perth', clock: at(10, day) }), WA)!.blocked!, /风暴/);
		break;
	}
});

test('园艺：要住处、人在住处；播种花种子钱，没熟只能浇水，熟了收成记进菜园', () => {
	const spring = at(10, 1);
	assert.equal(gardenStatus(make()).op, 'none');
	assert.equal(doHobby(make(), WA, 'garden').ok, false);
	assert.match(doHobby(make({ home: home('fremantle'), loc: 'perth' }), WA, 'garden').msg, /回到住处/);
	const s = make({ home: home('perth'), loc: 'perth', clock: spring });
	const g = gardenStatus(s);
	assert.equal(g.op, 'plant');
	const planted = doHobby(s, WA, 'garden');
	assert.ok(planted.ok, planted.msg);
	const plant = PLANTS.find((p) => p.id === planted.state.hobby.bed!.plant)!;
	assert.ok(plant.seasons.includes('spring'));
	assert.equal(planted.state.cash, s.cash - plant.seed);
	const water = doHobby(planted.state, WA, 'garden');
	assert.match(water.msg, /浇了水/);
	assert.ok(water.state.hobby.bed);
	assert.equal(gardenStatus({ ...water.state, clock: water.state.clock + (plant.days - 1) * 1440 }).op, 'water', '差一天还不能收');
	const ripe = { ...water.state, clock: water.state.clock + plant.days * 1440 };
	assert.equal(gardenStatus(ripe).op, 'harvest');
	const h = doHobby(ripe, WA, 'garden');
	assert.equal(h.state.hobby.bed, null);
	assert.deepEqual(h.state.hobby.plants, [plant.id]);
	// 下一次优先种没种成过的
	assert.notEqual((gardenStatus(h.state) as { plant: { id: string } }).plant.id, plant.id);
	assert.equal(doHobby({ ...s, cash: 0 }, WA, 'garden').ok, false, '没钱买种子');
});

test('手工：要住处；先做会做、没做过的；熟练度不够做不了难的；材料要钱', () => {
	assert.equal(doHobby(make(), WA, 'craft').ok, false);
	const s = make({ home: home('perth'), loc: 'perth' });
	assert.equal(nextCraft(s).level, 1);
	const a = doHobby(s, WA, 'craft');
	assert.ok(a.ok, a.msg);
	const first = CRAFTS.find((c) => c.id === a.state.hobby.made[0])!;
	assert.equal(a.state.cash, s.cash - first.cost);
	const b = doHobby(a.state, WA, 'craft');
	assert.equal(b.state.hobby.made.length, 2, '第二次做另一件');
	assert.ok(b.state.hobby.made.every((id) => CRAFTS.find((c) => c.id === id)!.level === 1));
	const c = doHobby(b.state, WA, 'craft');
	assert.equal(c.state.hobby.made.length, 2, '1 级的都做过了，又做了一件');
	assert.equal(nextCraft({ ...s, hobby: { ...emptyHobby(), xp: { craft: 100 } } }).level, 1, '高等级也先做没做过的');
	assert.equal(doHobby({ ...s, cash: 0 }, WA, 'craft').ok, false);
});

test('乐器：要有尤克里里；熟练度到了学会新曲子', () => {
	assert.match(doHobby(make(), WA, 'music').msg, /尤克里里/);
	assert.deepEqual(songsKnown(0).map((x) => x.id), ['scales']);
	assert.equal(songsKnown(999).length, SONGS.length);
	let s = make({ inventory: { [INSTRUMENT]: 1 } });
	const r = doHobby(s, WA, 'music');
	assert.ok(r.ok);
	assert.match(r.msg, /音阶练习/);
	s = { ...r.state, hobby: { ...r.state.hobby, xp: { music: SONGS[1].xp - 1 } }, clock: r.state.clock + 1440 };
	assert.match(doHobby(s, WA, 'music').msg, new RegExp(SONGS[1].name));
});

test('同好在场一起做：好感和社交增加', () => {
	// 老杰克早上在弗里曼特尔
	const jack = NPCS.find((n) => n.id === 'jack')!;
	let t = -1;
	for (let m = at(5); m < at(5, 14); m += 60) if (npcPresent(jack, 'fremantle', m) && npcPresent(jack, 'fremantle', m + 30) && !weatherOn('fremantle', Math.floor(m / 1440)).closesSea) { t = m; break; }
	assert.ok(t >= 0);
	const s = make({ loc: 'fremantle', clock: t, inventory: { rod: 1 } });
	const r = goFishing(s, WA);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.relations.jack?.score, HOBBY.palGain);
	assert.match(r.msg, /老杰克/);
	const alone = goFishing({ ...s, clock: at(22, Math.floor(t / 1440)) }, WA);
	if (alone.ok) assert.equal(alone.state.relations.jack, undefined);
});

test('收集册：进度和稀有度；收到一半、收齐各发一次，不重发', () => {
	const s = make();
	const cs = collections(s, WA);
	assert.deepEqual(cs.map((c) => c.id), ['fish', 'birds', 'works', 'plants', 'crafts', 'songs', 'animals', 'album']);
	const fish = cs.find((c) => c.id === 'fish')!;
	assert.equal(fish.total, FISH.length);
	assert.equal(rarityCounts(fish).reduce((n, r) => n + r.total, 0), FISH.length, '每种鱼都有稀有度');
	const st = { ...s, hobby: { ...emptyHobby(), plants: PLANTS.slice(0, PLANTS.length / 2).map((p) => p.id) } };
	const msgs = checkCollections(st, WA);
	assert.equal(msgs.length, 1);
	assert.equal(st.respect, s.respect + COLLECTION_REWARD.half.respect);
	assert.deepEqual(st.hobby.got, ['plants:half']);
	assert.deepEqual(checkCollections(st, WA), [], '不重发');
	st.hobby.plants = PLANTS.map((p) => p.id);
	checkCollections(st, WA);
	assert.deepEqual(st.hobby.got, ['plants:half', 'plants:full']);
	assert.equal(st.respect, s.respect + COLLECTION_REWARD.half.respect + COLLECTION_REWARD.full.respect);
	// 不发奖的收集册：野生动物、天气相册
	const all = { ...s, dex: ANIMALS.map((a) => a.id), hobby: emptyHobby() };
	assert.deepEqual(checkCollections(all, WA), []);
	// 少一半不发
	const less = { ...s, hobby: { ...emptyHobby(), plants: PLANTS.slice(0, PLANTS.length / 2 - 1).map((p) => p.id) } };
	assert.deepEqual(checkCollections(less, WA), []);
});

test('今天页的爱好列表：照相到处都有；住处才有园艺手工；有琴才有练琴', () => {
	const ids = (s: PlayerState) => hobbiesHere(s, WA).map((x) => x.hobby.id);
	assert.deepEqual(ids(make({ loc: 'wave-rock' })).includes('photo'), true);
	assert.ok(!ids(make()).includes('garden') && !ids(make()).includes('music'));
	const s = make({ home: home('perth'), loc: 'perth', inventory: { [INSTRUMENT]: 1 } });
	assert.ok(['garden', 'craft', 'music'].every((h) => ids(s).includes(h as never)));
	assert.ok(hobbiesHere({ ...s, pending: { eventId: 'quokka-selfie' } }, WA).every((x) => x.blocked));
});

test('动作协议：t:hobby 只认五个爱好（钓鱼走 t:fish）；走 applyAction 版本号 +1，不改入参', () => {
	for (const id of ['photo', 'birding', 'garden', 'craft', 'music']) assert.deepEqual(parseAction({ t: 'hobby', id }), { t: 'hobby', id });
	for (const id of ['fishing', 'x', '', 3, undefined, '__proto__']) assert.equal(parseAction({ t: 'hobby', id }), null, String(id));
	const s = make({ loc: 'perth' });
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'hobby', id: 'photo' });
	assert.ok(r.ok && r.state.rev === s.rev + 1);
	assert.deepEqual(s, before);
	assert.equal(applyAction({ ...s, pending: { eventId: 'quokka-selfie' } }, WA, { t: 'hobby', id: 'photo' }).ok, false);
});

test('存档：旧存档没有 hobby 给空的；坏值清洗；只留认识的 id；幂等', () => {
	const opts = { fallbackLoc: 'perth', now: Date.now() };
	const old: Record<string, unknown> = { ...make() };
	delete old.hobby;
	assert.deepEqual(sanitizeState(old, LOCS, opts)!.hobby, emptyHobby());
	for (const bad of [null, 1, 'x', [], { xp: [] }, { works: 'x' }]) assert.deepEqual(cleanHobby(bad), emptyHobby(), JSON.stringify(bad));
	const dirty = {
		xp: { photo: 5.7, fishing: 1e9, nope: 3, music: -2, birding: NaN },
		day: 1e12,
		today: { photo: 3, craft: 'x' },
		bag: { herring: 2, shark: 9 },
		best: { whiting: 31.26, herring: 1e6 },
		birds: ['galah', 'galah', 'dodo', 7],
		works: { perth: 150, atlantis: 50, fremantle: 0 },
		plants: ['basil', 'weed'],
		bed: { plant: 'basil', day: -3 },
		made: ['tote', 'rocket'],
		got: ['birds:half', 'birds:half', 'x', 'birds:all', '__proto__:half'.slice(0, 5)],
		extra: 'drop me',
	};
	const c = cleanHobby(JSON.parse(JSON.stringify(dirty)), LOCS);
	assert.deepEqual(c.xp, { photo: 5, fishing: HOBBY.xpMax });
	assert.equal(c.day, 1e7);
	assert.deepEqual(c.today, { photo: 3 });
	assert.deepEqual(c.bag, { herring: 2 });
	assert.deepEqual(c.best, { whiting: 31.3, herring: 999 });
	assert.deepEqual(c.birds, ['galah']);
	assert.deepEqual(c.works, { perth: 100 });
	assert.deepEqual(c.plants, ['basil']);
	assert.equal(c.bed, null, '播种日不合法');
	assert.deepEqual(c.made, ['tote']);
	assert.deepEqual(c.got, ['birds:half']);
	assert.deepEqual(cleanHobby(c, LOCS), c, '幂等');
	assert.deepEqual(cleanHobby({ bed: { plant: 'basil', day: 4.5 } }).bed, { plant: 'basil', day: 4 });
	// 原型链上的键不算
	const proto = Object.create({ xp: { photo: 50 } });
	assert.deepEqual(cleanHobby(proto), emptyHobby());
	assert.deepEqual(cleanHobby({ xp: Object.create({ photo: 50 }) }).xp, {});
	const full = sanitizeState({ ...make(), hobby: dirty }, LOCS, opts)!;
	assert.deepEqual(sanitizeState(full, LOCS, opts), full, '整份存档幂等');
	assert.ok(JSON.stringify(cleanHobby({ ...emptyHobby(), works: Object.fromEntries([...LOCS].map((l) => [l, 100])), birds: BIRDS.map((b) => b.id), best: Object.fromEntries(FISH.map((f) => [f.id, 99.9])) })).length < 4096, '字段在 4 KB 以内');
});

// ---------- 合并 main 后：和野生动物、灾害、生涯统计、关系变淡的接法 ----------
test('观鸟包含图鉴里所有的鸟（同 id 同名），看见一起记进图鉴（合并 main 后）', () => {
	for (const a of ANIMALS.filter((x) => x.group === 'bird')) {
		const b = BIRDS.find((x) => x.id === a.id);
		assert.ok(b, `图鉴里的鸟 ${a.id} 不在观鸟列表`);
		assert.equal(b!.name, a.name, a.id);
	}
});

test('自然灾害让户外活动暂停时不能观鸟，和徒步同进退（合并 main 后）', () => {
	for (const h of Object.values(HAZARDS)) {
		const out = (h as { outdoor?: string[] }).outdoor;
		if (out?.includes('hike')) assert.ok(out.includes('birding'), h.id);
	}
	// 找一个能观鸟、当天徒步被灾害关掉的地点和日子
	for (const loc of WORLD.locations) {
		for (let d = 0; d < 3650; d++) {
			const why = activityClosed(loc, d, 'hike');
			if (!why) continue;
			const s = make({ loc: loc.id, clock: at(10, d) });
			const spot = birdingAt(s, WORLD);
			if (!spot) break;
			assert.equal(spot.blocked, why);
			const r = applyAction(s, WORLD, { t: 'hobby', id: 'birding' });
			assert.equal(r.ok, false);
			return;
		}
	}
	assert.fail('十年里没有一处能观鸟的地方碰上灾害');
});

test('生涯统计：爱好的花费记「玩乐」（合并 main 后）', () => {
	assert.deepEqual(actionCats({ t: 'hobby', id: 'garden' }), ['fun', 'fun']);
	assert.deepEqual(actionCats({ t: 'fish' }), ['fun', 'fun']);
});

test('和同好一起做爱好算见过面：关系不因「好久没联系」变淡，读档保留（合并 main 后）', () => {
	const hobby = HOBBIES.find((h) => h.pals.length && h.id !== 'fishing' && h.id !== 'garden' && h.id !== 'craft')!;
	const pal = NPCS.find((n) => n.id === hobby.pals[0])!;
	// 找同好在场的时刻（在同好的地点逐小时找）
	let s: PlayerState | null = null;
	for (let t = 0; t < 60 * 24 && !s; t++) {
		for (const loc of WORLD.locations) {
			if (!npcPresent(pal, loc.id, t * 60)) continue;
			const c = make({ loc: loc.id, clock: t * 60, inventory: { [INSTRUMENT]: 1 } });
			if (hobbiesHere(c, WORLD).some((o) => o.hobby.id === hobby.id && !o.blocked)) { s = c; break; }
		}
	}
	assert.ok(s, `找不到和 ${pal.id} 一起做 ${hobby.id} 的时刻`);
	// 很久以前聊过、关系还不错：不做爱好的话到期会变淡
	const d0 = Math.floor(s!.clock / 1440);
	const old = { score: 50, last: { chat: d0 - 20 }, seen: [] } as unknown as PlayerState['relations'][string];
	const withRel = { ...s!, relations: { [pal.id]: old } };
	const d1 = d0;
	assert.equal(isFading(old, d1 + RELATION_DECAY.grace), true, '前提：没再联系会变淡');
	const r = applyAction(withRel, WORLD, { t: 'hobby', id: hobby.id as never });
	assert.ok(r.ok, r.msg);
	const rel = r.state.relations[pal.id];
	assert.equal(rel.last.hobby, d1);
	assert.equal(rel.score, 50 + HOBBY.palGain);
	assert.equal(isFading(rel, d1 + RELATION_DECAY.grace), false, '一起做爱好算见过面');
	assert.equal(sanitizeState(r.state)!.relations[pal.id].last.hobby, d1, '读档保留');
	// 同一天再做一次：好感不再涨（每天一次），但照样记见面
	const again = applyAction({ ...r.state, needs: { hunger: 90, energy: 90, hygiene: 90, fun: 50, social: 50 } }, WORLD, { t: 'hobby', id: hobby.id as never });
	assert.ok(npcPresent(pal, r.state.loc, r.state.clock), '前提：第二次开始时同好还在');
	assert.ok(again.ok, again.msg);
	assert.equal(again.state.relations[pal.id].score, 50 + HOBBY.palGain, '同一天第二次不再涨好感');
});

test('页面：成长页有「爱好」「收集册」卡，鱼获卡写最大尺寸（合并 main 后）', async () => {
	const { readFileSync } = await import('node:fs');
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(page, /\['quests', 'daily', 'ach', 'titles', 'hobby', 'collect', /, '成长页卡片顺序：任务、成就、称号之后是爱好和收集册');
	assert.match(page, /hobby: hobbyLv,\n\t*collect: colHtml,/);
	assert.match(page, /\$\{s\.hobby\.best\[f\.id\] \? `最大 \$\{s\.hobby\.best\[f\.id\]\} cm · ` : ''\}\$\{esc\(f\.desc\)\}/, '鱼获卡写最大尺寸');
});
