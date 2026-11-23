// 爱好与收集（第一版，设计见 docs/earth-game/hobbies.md）。
// 规则都是纯函数：不改入参，随机数只来自 state.seed（roll）或只读种子的哈希（unit，不推进种子）。
// 钓鱼的动作从 engine.ts 搬到这里，加上尺寸、数量限制、禁捕和熟练度。
import { addMoodlet, applyEffect, clone, collapsedResult, fail, fishingAt, getLocation, getRelation, log, npcPresent, recordAnimal, roll } from './engine.ts';
import { checkScore } from './attributes.ts';
import { dateOf, dayOf, period } from './time.ts';
import { unit, weatherAt } from './weather.ts';
import { activityClosed } from './disasters.ts';
import { NEED_KEYS } from './types.ts';
import type { ActionResult, GameLocation, HobbyState, Needs, PlayerState, Region } from './types.ts';
import { FISH, FISHING, type FishDef } from '../data/fish.ts';
import { FISH_CM, FISH_LICENCE, FISH_RULES, type FishRule, type StateId } from '../data/fish-rules.ts';
import { BIRDING, BIRDS, CHANCE_RARITY, COLLECTION_REWARD, CRAFTS, GARDEN, HOBBIES, HOBBY, INSTRUMENT, PHOTO_WORK, PLANTS, RARITY, SONGS, WEIGHT_RARITY, type BirdDef, type CraftDef, type HobbyDef, type HobbyId, type PlantDef, type Rarity } from '../data/hobbies.ts';
import { ANIMALS } from '../data/wildlife.ts';
import { NPCS } from '../data/npcs.ts';
import { WEATHERS } from '../data/weather.ts';
import { areaOf } from '../data/areas-base.ts';

/** 钓鱼熟练度每升一级，空手而归的权重少这么多（待平衡） */
export const FISH_EMPTY_PER_LEVEL = 3;

export const getHobby = (id: string): HobbyDef | undefined => HOBBIES.find((h) => h.id === id);

/** 熟练度对应的等级 1–5 */
export function hobbyLevel(xp: number): number {
	let lv = 0;
	for (let i = 0; i < HOBBY.levels.length; i++) if (xp >= HOBBY.levels[i]) lv = i + 1;
	return Math.max(1, lv);
}

/** 某个爱好现在的等级、等级名、离下一级还差多少 */
export function hobbyStatus(state: PlayerState, id: HobbyId): { xp: number; level: number; name: string; next: number | null } {
	const xp = state.hobby.xp[id] ?? 0;
	const level = hobbyLevel(xp);
	const next = HOBBY.levels[level] ?? null;
	return { xp, level, name: HOBBY.levelNames[level - 1], next: next === null ? null : next - xp };
}

/** 今天（游戏日 day）做过几次；存档记的是别的日子就算 0 */
export const timesToday = (h: HobbyState, id: HobbyId, day: number) => (h.day === day ? h.today[id] ?? 0 : 0);

/** 换了一天就清空当天计数和鱼获数量（原地修改，只用在引擎新建的对象上） */
function rollDay(h: HobbyState, day: number) {
	if (h.day === day) return;
	h.day = day;
	h.today = {};
	h.bag = {};
}

/** 同一天第 n 次（从 0 起）做的心情收益倍率 */
export const repeatMult = (n: number) => HOBBY.repeat[Math.min(n, HOBBY.repeat.length - 1)];

/** 按倍率打折正的需求收益；体力等消耗不打折 */
function scaleNeeds(needs: Partial<Needs>, mult: number): Partial<Needs> {
	const out: Partial<Needs> = {};
	for (const k of NEED_KEYS) {
		const v = needs[k];
		if (v) out[k] = v > 0 ? Math.round(v * mult) : v;
	}
	return out;
}

/** 此刻在场的同好 NPC */
export function palsHere(state: PlayerState, id: HobbyId): string[] {
	const def = getHobby(id);
	return (def?.pals ?? []).filter((n) => {
		const npc = NPCS.find((x) => x.id === n);
		return !!npc && npcPresent(npc, state.loc, state.clock);
	});
}

interface SessionOpts {
	minutes?: number;
	cash?: number; // 正数是收入，负数是花费
	extraNeeds?: Partial<Needs>;
	needsMult?: number; // 再乘一层（如园艺浇水）
}

/**
 * 做一次爱好的共通结算：花时间、按当天第几次打折的心情收益、能力成长、熟练度、同好在场加好感和社交、当天第一次给心情状态。
 * 原地修改 state（调用方已 clone）；途中晕倒返回 true，此时熟练度不涨。
 */
function session(state: PlayerState, region: Region, id: HobbyId, o: SessionOpts = {}): { collapsed: boolean; pals: string[]; levelUp: number | null } {
	const def = getHobby(id)!;
	const day = dayOf(state.clock);
	rollDay(state.hobby, day);
	const n = timesToday(state.hobby, id, day);
	const pals = palsHere(state, id);
	const needs = scaleNeeds(def.needs, repeatMult(n) * (o.needsMult ?? 1));
	for (const [k, v] of Object.entries(o.extraNeeds ?? {})) needs[k as keyof Needs] = (needs[k as keyof Needs] ?? 0) + v;
	if (pals.length) needs.social = (needs.social ?? 0) + HOBBY.palSocial;
	if (applyEffect(state, { minutes: o.minutes ?? def.minutes, needs, skills: def.skills, cash: o.cash }, region)) return { collapsed: true, pals: [], levelUp: null };
	const before = hobbyLevel(state.hobby.xp[id] ?? 0);
	state.hobby.xp[id] = Math.min(HOBBY.xpMax, (state.hobby.xp[id] ?? 0) + (n === 0 ? HOBBY.xpFirst : HOBBY.xpRepeat));
	state.hobby.today[id] = n + 1;
	const after = hobbyLevel(state.hobby.xp[id]);
	if (n === 0) addMoodlet(state, HOBBY.moodlet);
	for (const p of pals) {
		const rel = structuredClone(getRelation(state, p));
		// 好感每位同好每天只涨一次，和聊天、送礼、帮忙「每天一次」同一条规矩（合并 main 后复核：原来反复拍照能无限刷好感）
		if (rel.last.hobby !== day) rel.score = Math.max(-100, Math.min(100, rel.score + HOBBY.palGain));
		rel.last = { ...rel.last, hobby: day }; // 一起做爱好算见过面：关系不会因为「好久没联系」变淡（合并 main 后）
		state.relations[p] = rel;
	}
	return { collapsed: false, pals, levelUp: after > before ? after : null };
}

/** 把共通结算的附带消息（同好、升级、收集里程碑）拼到主消息后面，写日志 */
function finish(state: PlayerState, region: Region, id: HobbyId, msg: string, s: { pals: string[]; levelUp: number | null }): ActionResult {
	const def = getHobby(id)!;
	const extra: string[] = [];
	if (s.pals.length) extra.push(`和${s.pals.map((p) => NPCS.find((x) => x.id === p)!.name).join('、')}一起，聊得很开心。`);
	if (s.levelUp) extra.push(`${def.name}升到 ${s.levelUp} 级「${HOBBY.levelNames[s.levelUp - 1]}」！`);
	extra.push(...checkCollections(state, region));
	const full = [msg, ...extra].join(' ');
	log(state, full);
	return { ok: true, state, msg: full };
}

// ---------- 钓鱼：规定 ----------
/** 地点属于哪个州（游戏的区域 id 就是州的缩写） */
export const stateOf = (locId: string): StateId | undefined => {
	const id = areaOf(locId)?.id;
	return id === 'wa' || id === 'sa' ? id : undefined;
};

/** 这种鱼在这个地点适用的规定：先找写了这个地点的分区规定，再找这个州的通用规定；没有就是规定待核实 */
export function fishRuleAt(fishId: string, locId: string): FishRule | undefined {
	const st = stateOf(locId);
	if (!st) return undefined;
	const rules = FISH_RULES.filter((r) => r.fish === fishId && r.state === st);
	return rules.find((r) => r.locs?.includes(locId)) ?? rules.find((r) => !r.locs);
}

/** 这条鱼的体长（cm，一位小数）。只读种子做哈希、不推进它，所以加了尺寸也不改变别的随机结果 */
export function fishCm(state: PlayerState, fishId: string): number {
	const [lo, hi] = FISH_CM[fishId] ?? [10, 40];
	const u = unit(`${state.seed}|${state.clock}|${fishId}|cm`);
	// 两个均匀数取平均，中间的尺寸多、两头少
	const u2 = unit(`${state.seed}|${state.clock}|${fishId}|cm2`);
	return Math.round((lo + (hi - lo) * (u + u2) / 2) * 10) / 10;
}

export type CatchVerdict = { keep: true } | { keep: false; why: string };

/** 按规定判断这条鱼能不能带走。bagged：今天已经带走的同种鱼条数 */
export function judgeCatch(rule: FishRule | undefined, cm: number, bagged: number, season: string): CatchVerdict {
	if (!rule) return { keep: true };
	if (rule.closed || rule.closedSeasons?.includes(season as never)) return { keep: false, why: rule.why ?? '这里现在禁捕' };
	if (rule.minCm !== undefined && cm < rule.minCm) return { keep: false, why: `不够 ${rule.minCm} cm 的最小尺寸` };
	if (rule.bag !== undefined && bagged >= rule.bag) return { keep: false, why: `今天已经带走 ${bagged} 条，每天最多 ${rule.bag} 条` };
	return { keep: true };
}

/** 规定的一句话说明（界面用） */
export function ruleLabel(rule: FishRule | undefined): string {
	if (!rule) return '规定待核实';
	if (rule.closed) return '禁捕';
	const parts: string[] = [];
	parts.push(rule.minCm !== undefined ? `最小 ${rule.minCm} cm` : '不限尺寸');
	if (rule.bag !== undefined) parts.push(`每天 ${rule.bag} 条`);
	if (rule.closedSeasons?.length) parts.push(`${rule.closedSeasons.map((s) => ({ spring: '春', summer: '夏', autumn: '秋', winter: '冬' })[s]).join('、')}季禁捕`);
	return parts.join(' · ');
}

/** 执照说明（按所在州） */
export const licenceAt = (locId: string) => {
	const st = stateOf(locId);
	return st ? FISH_LICENCE[st] : undefined;
};

/** 钓一次鱼：花时间和体力；按生存能力和钓鱼熟练度决定空手几率；钓到后量尺寸、按规定决定带走卖掉还是放生 */
export function goFishing(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const spot = fishingAt(prev, region);
	if (!spot) return fail(prev, '这里没有能钓鱼的水。');
	if (spot.blocked) return fail(prev, spot.blocked + '。');
	const state = clone(prev);
	const level = hobbyLevel(state.hobby.xp.fishing ?? 0);
	const survival = checkSurvival(state);
	const empty = Math.max(FISHING.emptyMin, FISHING.emptyBase - survival * FISHING.emptyPerSkill - (level - 1) * FISH_EMPTY_PER_LEVEL);
	let r = roll(state) * (empty + spot.fish.reduce((s, f) => s + f.weight, 0)) - empty;
	const caught: FishDef | undefined = r < 0 ? undefined : spot.fish.find((f) => (r -= f.weight) < 0) ?? spot.fish[spot.fish.length - 1];
	const day = dayOf(state.clock);
	rollDay(state.hobby, day);
	let verdict: CatchVerdict = { keep: true };
	let cm = 0;
	if (caught) {
		cm = fishCm(state, caught.id);
		verdict = judgeCatch(fishRuleAt(caught.id, state.loc), cm, state.hobby.bag[caught.id] ?? 0, dateOf(state.clock).season);
	}
	// 鱼款走 applyEffect 的收获：没晕倒才到账，而且在跨周结算之前，能付刚到期的房租
	const s = session(state, region, 'fishing', { minutes: FISHING.minutes, cash: caught && verdict.keep ? caught.price : undefined });
	if (s.collapsed) return collapsedResult(state);
	if (!caught) return finish(state, region, 'fishing', '钓了一个半小时，一条也没上钩，不过吹了吹风。', s);
	const isNew = !state.fish[caught.id];
	state.fish[caught.id] = (state.fish[caught.id] ?? 0) + 1;
	const record = cm > (state.hobby.best[caught.id] ?? 0);
	if (record) state.hobby.best[caught.id] = cm;
	const tag = `${cm} cm${isNew ? '，新鱼种！' : record ? '，个人纪录！' : ''}`;
	let msg: string;
	if (verdict.keep) {
		state.hobby.bag[caught.id] = (state.hobby.bag[caught.id] ?? 0) + 1;
		msg = `钓到一条${caught.icon}${caught.name}（${tag}），卖给鱼铺得 $${caught.price}。`;
	} else {
		msg = `钓到一条${caught.icon}${caught.name}（${tag}），${verdict.why}，按规定放生了。`;
	}
	return finish(state, region, 'fishing', msg, s);
}

/** 生存检定总分（钓鱼空手几率用） */
const checkSurvival = (state: PlayerState) => checkScore(state, 'survival').total;

// ---------- 摄影：随手拍 ----------
/** 这张作品的分数（0–100）：熟练度 + 清晨傍晚的光 + 坏天气加成 + 运气 */
export function photoScore(level: number, periodId: string, weatherId: string, luck: number): number {
	const golden = periodId === 'dawn' || periodId === 'dusk' ? PHOTO_WORK.golden : 0;
	const raw = PHOTO_WORK.base + (level - 1) * PHOTO_WORK.perLevel + golden + (PHOTO_WORK.weather[weatherId] ?? 0) + Math.floor(luck * PHOTO_WORK.luck);
	return Math.max(0, Math.min(100, raw));
}

function shootPhoto(prev: PlayerState, region: Region): ActionResult {
	const loc = getLocation(region, prev.loc);
	if (!loc) return fail(prev, '这里拍不了。');
	const state = clone(prev);
	const level = hobbyLevel(state.hobby.xp.photo ?? 0);
	const p = period(state.clock).id;
	const w = weatherAt(state);
	const score = photoScore(level, p, w.id, roll(state));
	const s = session(state, region, 'photo');
	if (s.collapsed) return collapsedResult(state);
	const old = state.hobby.works[loc.id] ?? 0;
	if (score > old) state.hobby.works[loc.id] = score;
	const good = score >= PHOTO_WORK.good ? '，是一张佳作' : '';
	const msg = `在${loc.name}拍了一组，最好的一张 ${score} 分${good}。${score > old ? (old ? `比原来的 ${old} 分好，换进作品集。` : '放进了作品集。') : `没超过作品集里的 ${old} 分。`}`;
	return finish(state, region, 'photo', msg, s);
}

// ---------- 观鸟 ----------
const birdHere = (b: BirdDef, loc: GameLocation) => !!(b.where.locs?.includes(loc.id) || b.where.kinds?.includes(loc.kind) || b.where.tags?.some((t) => loc.tags.includes(t)));

/** 这个地方此刻能看到的鸟；一种都没有的地方返回 null（不显示观鸟） */
export function birdingAt(state: PlayerState, region: Region): { birds: BirdDef[]; blocked?: string } | null {
	const loc = getLocation(region, state.loc);
	if (!loc || !BIRDS.some((b) => birdHere(b, loc))) return null;
	const season = dateOf(state.clock).season;
	const p = period(state.clock).id;
	const birds = BIRDS.filter((b) => birdHere(b, loc) && (!b.seasons || b.seasons.includes(season)) && (!b.periods || b.periods.includes(p)));
	// 合并 main 后：自然灾害让户外活动暂停时（山火、气旋、热浪、洪水预警，见 core/disasters.ts）也不能观鸟
	const closed = activityClosed(loc, dayOf(state.clock), 'birding');
	const blocked = state.pending ? '先处理眼前的事件' : closed ?? (weatherAt(state).id === 'storm' ? '风暴天鸟都躲起来了' : !birds.length ? '这个时候这里看不到鸟' : undefined);
	return { birds, blocked };
}

function goBirding(prev: PlayerState, region: Region): ActionResult {
	const spot = birdingAt(prev, region);
	if (!spot) return fail(prev, '这里没什么鸟可看。');
	if (spot.blocked) return fail(prev, spot.blocked + '。');
	const state = clone(prev);
	const level = hobbyLevel(state.hobby.xp.birding ?? 0);
	const empty = Math.max(BIRDING.emptyMin, BIRDING.emptyBase - (level - 1) * BIRDING.emptyPerLevel);
	let r = roll(state) * (empty + spot.birds.reduce((s, b) => s + b.weight, 0)) - empty;
	const bird = r < 0 ? undefined : spot.birds.find((b) => (r -= b.weight) < 0) ?? spot.birds[spot.birds.length - 1];
	const s = session(state, region, 'birding');
	if (s.collapsed) return collapsedResult(state);
	if (!bird) return finish(state, region, 'birding', '举着望远镜等了一个小时，只听见叫声没看见鸟。', s);
	const isNew = !state.hobby.birds.includes(bird.id);
	if (isNew) state.hobby.birds.push(bird.id);
	// 和野生动物图鉴里同一种鸟：一起记下（图鉴分组奖励照旧）
	if (ANIMALS.some((a) => a.id === bird.id)) recordAnimal(state, bird.id);
	return finish(state, region, 'birding', `看见了${bird.icon}${bird.name}${isNew ? '（新记录！）' : ''}：${bird.desc}`, s);
}

// ---------- 园艺 ----------
const atHome = (state: PlayerState) => !!state.home && state.home.loc === state.loc;

/** 菜园现在能做什么：播种（种哪个）、收成、浇水（还差几天）；不能做时有 blocked */
export function gardenStatus(state: PlayerState): { op: 'plant' | 'harvest' | 'water'; plant: PlantDef; daysLeft: number; blocked?: string } | { op: 'none'; blocked: string } {
	if (!state.home) return { op: 'none', blocked: '要先有住处' };
	const today = dayOf(state.clock);
	const bed = state.hobby.bed;
	const away = !atHome(state) ? '要回到住处' : state.pending ? '先处理眼前的事件' : undefined;
	if (bed) {
		const plant = PLANTS.find((p) => p.id === bed.plant)!;
		const left = Math.max(0, bed.day + plant.days - today);
		return { op: left ? 'water' : 'harvest', plant, daysLeft: left, blocked: away };
	}
	const season = dateOf(state.clock).season;
	const can = PLANTS.filter((p) => p.seasons.includes(season));
	// 先种没种成过的
	const plant = can.find((p) => !state.hobby.plants.includes(p.id)) ?? can[0];
	if (!plant) return { op: 'none', blocked: '这个季节没什么能种' };
	return { op: 'plant', plant, daysLeft: plant.days, blocked: away ?? (state.cash < plant.seed ? `需要 $${plant.seed} 买种子` : undefined) };
}

function tendGarden(prev: PlayerState, region: Region): ActionResult {
	const g = gardenStatus(prev);
	if (g.blocked) return fail(prev, g.blocked + '。');
	if (g.op === 'none') return fail(prev, '现在没什么能做。');
	const state = clone(prev);
	if (g.op === 'plant') {
		const s = session(state, region, 'garden', { cash: -g.plant.seed });
		if (s.collapsed) return collapsedResult(state);
		state.hobby.bed = { plant: g.plant.id, day: dayOf(prev.clock) };
		return finish(state, region, 'garden', `花 $${g.plant.seed} 买种子，种下了${g.plant.icon}${g.plant.name}，大约 ${g.plant.days} 天后能收。`, s);
	}
	if (g.op === 'water') {
		const s = session(state, region, 'garden', { needsMult: GARDEN.waterFun });
		if (s.collapsed) return collapsedResult(state);
		return finish(state, region, 'garden', `给${g.plant.icon}${g.plant.name}浇了水，还要 ${g.daysLeft} 天。`, s);
	}
	const s = session(state, region, 'garden', { extraNeeds: g.plant.harvest });
	if (s.collapsed) return collapsedResult(state);
	state.hobby.bed = null;
	const isNew = !state.hobby.plants.includes(g.plant.id);
	if (isNew) state.hobby.plants.push(g.plant.id);
	return finish(state, region, 'garden', `收了自己种的${g.plant.icon}${g.plant.name}${isNew ? '（第一次种成！）' : ''}。`, s);
}

// ---------- 手工 ----------
/** 下一件手工：先做这个等级会做、还没做过的；都做过就从会做的里按时刻挑一件 */
export function nextCraft(state: PlayerState): CraftDef {
	const level = hobbyLevel(state.hobby.xp.craft ?? 0);
	const can = CRAFTS.filter((c) => c.level <= level);
	return can.find((c) => !state.hobby.made.includes(c.id)) ?? can[Math.floor(unit(`${state.seed}|${state.clock}|craft`) * can.length)];
}

export function craftBlocked(state: PlayerState): string | undefined {
	if (!state.home) return '要先有住处';
	if (!atHome(state)) return '要回到住处';
	if (state.pending) return '先处理眼前的事件';
	const c = nextCraft(state);
	return state.cash < c.cost ? `材料要 $${c.cost}` : undefined;
}

function doCraft(prev: PlayerState, region: Region): ActionResult {
	const why = craftBlocked(prev);
	if (why) return fail(prev, why + '。');
	const state = clone(prev);
	const c = nextCraft(state);
	const s = session(state, region, 'craft', { cash: -c.cost });
	if (s.collapsed) return collapsedResult(state);
	const isNew = !state.hobby.made.includes(c.id);
	if (isNew) state.hobby.made.push(c.id);
	return finish(state, region, 'craft', `花 $${c.cost} 买材料，做了一个${c.icon}${c.name}${isNew ? '（第一次做成！）' : ''}。`, s);
}

// ---------- 乐器 ----------
/** 按熟练度已经学会的曲子 */
export const songsKnown = (xp: number) => SONGS.filter((s) => xp >= s.xp);

export const musicBlocked = (state: PlayerState) => (state.pending ? '先处理眼前的事件' : !state.inventory[INSTRUMENT] ? '要先买一把尤克里里' : undefined);

function playMusic(prev: PlayerState, region: Region): ActionResult {
	const why = musicBlocked(prev);
	if (why) return fail(prev, why + '。');
	const state = clone(prev);
	const before = songsKnown(state.hobby.xp.music ?? 0).length;
	const s = session(state, region, 'music');
	if (s.collapsed) return collapsedResult(state);
	const known = songsKnown(state.hobby.xp.music ?? 0);
	const learned = known.slice(before);
	const msg = learned.length ? `练了一个小时琴，学会了《${learned.map((x) => x.name).join('》《')}》！` : `练了一个小时琴，${known.length ? `把《${known[known.length - 1].name}》弹得更顺了。` : '手指有点疼。'}`;
	return finish(state, region, 'music', msg, s);
}

// ---------- 动作入口 ----------
/** 做一次爱好（钓鱼走 { t: 'fish' }，这里是其余五个） */
export function doHobby(prev: PlayerState, region: Region, id: HobbyId): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	switch (id) {
		case 'photo': return shootPhoto(prev, region);
		case 'birding': return goBirding(prev, region);
		case 'garden': return tendGarden(prev, region);
		case 'craft': return doCraft(prev, region);
		case 'music': return playMusic(prev, region);
		case 'fishing': return goFishing(prev, region);
	}
}

/** 此刻在这里能做的爱好（界面用；钓鱼有自己的卡片，不在这里）。不显示的爱好不返回 */
export function hobbiesHere(state: PlayerState, region: Region): { hobby: HobbyDef; label: string; blocked?: string }[] {
	const out: { hobby: HobbyDef; label: string; blocked?: string }[] = [];
	const pending = state.pending ? '先处理眼前的事件' : undefined;
	const h = (id: HobbyId) => getHobby(id)!;
	out.push({ hobby: h('photo'), label: '随手拍一组', blocked: pending });
	const b = birdingAt(state, region);
	if (b) out.push({ hobby: h('birding'), label: '找找鸟', blocked: b.blocked });
	if (atHome(state)) {
		const g = gardenStatus(state);
		const label = g.op === 'plant' ? `种${g.plant.name}（种子 $${g.plant.seed}）` : g.op === 'harvest' ? `收${g.plant.name}` : g.op === 'water' ? `照看${g.plant.name}（还要 ${g.daysLeft} 天）` : '打理菜园';
		out.push({ hobby: h('garden'), label, blocked: g.blocked });
		const c = nextCraft(state);
		out.push({ hobby: h('craft'), label: `做${c.name}（材料 $${c.cost}）`, blocked: craftBlocked(state) });
	}
	if (state.inventory[INSTRUMENT]) out.push({ hobby: h('music'), label: '练琴', blocked: musicBlocked(state) });
	return out;
}

// ---------- 收集册：统一框架 ----------
export interface CollectionEntry { id: string; name: string; icon: string; rarity?: Rarity; got: boolean; detail?: string }
export interface CollectionView {
	id: string;
	name: string;
	icon: string;
	reward: boolean; // 收到一半、收齐时发奖（野生动物图鉴、天气相册沿用各自原来的规则，不在这里发）
	entries: CollectionEntry[];
	got: number;
	total: number;
}

export const weightRarity = (w: number): Rarity => (w >= WEIGHT_RARITY.common ? 'common' : w >= WEIGHT_RARITY.uncommon ? 'uncommon' : w >= WEIGHT_RARITY.rare ? 'rare' : 'legend');
export const chanceRarity = (c: number): Rarity => (c >= CHANCE_RARITY.common ? 'common' : c >= CHANCE_RARITY.uncommon ? 'uncommon' : c >= CHANCE_RARITY.rare ? 'rare' : 'legend');

/** 所有收集册的现状。region 决定作品集和天气相册的地点范围（服务器用 WORLD） */
export function collections(state: PlayerState, region: Region): CollectionView[] {
	const h = state.hobby;
	const view = (id: string, name: string, icon: string, reward: boolean, entries: CollectionEntry[]): CollectionView =>
		({ id, name, icon, reward, entries, got: entries.filter((e) => e.got).length, total: entries.length });
	const dex = new Set(state.dex);
	const photos = new Set(state.photos);
	const music = h.xp.music ?? 0;
	return [
		view('fish', '鱼种图鉴', '🎣', true, FISH.map((f) => ({ id: f.id, name: f.name, icon: f.icon, rarity: weightRarity(f.weight), got: !!state.fish[f.id], detail: h.best[f.id] ? `最大 ${h.best[f.id]} cm` : undefined }))),
		view('birds', '观鸟记录', '🐦', true, BIRDS.map((b) => ({ id: b.id, name: b.name, icon: b.icon, rarity: weightRarity(b.weight), got: h.birds.includes(b.id) }))),
		view('works', '摄影作品集', '📷', true, region.locations.map((l) => ({ id: l.id, name: l.name, icon: '🖼️', got: (h.works[l.id] ?? 0) >= PHOTO_WORK.good, detail: h.works[l.id] ? `${h.works[l.id]} 分` : undefined }))),
		view('plants', '菜园', '🌱', true, PLANTS.map((p) => ({ id: p.id, name: p.name, icon: p.icon, rarity: p.rarity, got: h.plants.includes(p.id) }))),
		view('crafts', '手工', '🧶', true, CRAFTS.map((c) => ({ id: c.id, name: c.name, icon: c.icon, rarity: c.rarity, got: h.made.includes(c.id) }))),
		view('songs', '曲目', '🪕', true, SONGS.map((s) => ({ id: s.id, name: s.name, icon: '🎵', rarity: s.rarity, got: music > 0 && music >= s.xp }))),
		view('animals', '野生动物图鉴', '🦘', false, ANIMALS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, rarity: chanceRarity(a.chance), got: dex.has(a.id) }))),
		view('album', '天气相册', '🌦️', false, region.locations.flatMap((l) => WEATHERS.map((w) => ({ id: `${l.id}|${w.id}`, name: `${l.name}·${w.name}`, icon: w.icon, got: photos.has(`${l.id}|${w.id}`) })))),
	];
}

/** 各稀有度收到几个、一共几个 */
export function rarityCounts(c: CollectionView): { rarity: Rarity; name: string; icon: string; got: number; total: number }[] {
	return (Object.keys(RARITY) as Rarity[]).map((r) => {
		const es = c.entries.filter((e) => e.rarity === r);
		return { rarity: r, ...RARITY[r], got: es.filter((e) => e.got).length, total: es.length };
	}).filter((x) => x.total > 0);
}

/** 收集册里程碑：收到一半、收齐。原地发奖（声望）并记进 hobby.got，返回要显示的消息。发过的不重发，以后加了新条目也不收回 */
export function checkCollections(state: PlayerState, region: Region): string[] {
	const msgs: string[] = [];
	for (const c of collections(state, region)) {
		if (!c.reward || !c.total) continue;
		for (const [key, ok] of [['half', c.got * 2 >= c.total], ['full', c.got >= c.total]] as const) {
			const id = `${c.id}:${key}`;
			if (!ok || state.hobby.got.includes(id)) continue;
			state.hobby.got.push(id);
			const respect = COLLECTION_REWARD[key].respect;
			state.respect += respect;
			msgs.push(`${c.icon}${c.name}${key === 'half' ? '收到一半' : '全部收齐'}！声望 +${respect}。`);
		}
	}
	return msgs;
}

