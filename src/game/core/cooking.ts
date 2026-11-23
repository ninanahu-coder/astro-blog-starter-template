// 做饭（cooking 分支第一版）：买食材、食材过期、照食谱做菜、烹饪技能成长、请客、叫外卖。
// 规则是纯函数（不改入参），数值全在 data/cooking.ts，都是「待平衡」。设计见 docs/earth-game/cooking.md。
import {
	ASIAN_GROCER_LOCS, COOK_GROWTH, COOK_QUALITY, DELIVERY, GROCER_BATCH_MAX, GROCER_HOURS, GROCER_KINDS, GROCER_MINUTES, HOSTING, INGREDIENTS, PANTRY_MAX, PANTRY_ROWS, RECIPES,
} from '../data/cooking.ts';
import { NPCS } from '../data/npcs.ts';
import { costMult, furnitureSets } from './attributes.ts';
import { applyEffect, clone, collapsedResult, fail, getFurniture, getLocation, getRelation, log } from './engine.ts';
import { moodletGainMult } from './formulas.ts';
import { outageBlocksCook } from './disasters.ts';
import { planFor } from './npc-behavior.ts';
import { dayOf, isOpen } from './time.ts';
import type { ActionResult, Effect, IngredientDef, NpcDef, PantryRow, PlayerState, RecipeDef, Region } from './types.ts';

export const getIngredient = (id: string): IngredientDef | undefined => INGREDIENTS.find((i) => i.id === id);
export const getRecipe = (id: string): RecipeDef | undefined => RECIPES.find((r) => r.id === id);

const atHome = (s: PlayerState) => !!s.home && s.home.loc === s.loc;

/** 住处厨房的设备等级：0 没有厨房家具，1 炉灶，2 烤箱 */
export function kitchenLevel(s: PlayerState): number {
	if (!s.home) return 0;
	return Object.values(s.home.furniture).reduce((m, id) => Math.max(m, getFurniture(id)?.kitchen ?? 0), 0);
}

// ---------- 食材柜 ----------
/** 没过期的食材，和过期的总份数 */
export function freshPantry(rows: PantryRow[], clock: number): { rows: PantryRow[]; spoiled: number } {
	const fresh = rows.filter((r) => r.exp > clock);
	return { rows: fresh, spoiled: rows.reduce((a, r) => a + (r.exp > clock ? 0 : r.n), 0) };
}

/** 每种食材现有几份（只算没过期的） */
export function pantryCount(s: PlayerState): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of freshPantry(s.cooking.pantry, s.clock).rows) out[r.id] = (out[r.id] ?? 0) + r.n;
	return out;
}

export const pantryTotal = (s: PlayerState) => Object.values(pantryCount(s)).reduce((a, n) => a + n, 0);

/** 按先过期先用的顺序取出食材；不够返回 null。不改入参 */
export function takeFromPantry(rows: PantryRow[], need: Record<string, number>): PantryRow[] | null {
	const out = rows.map((r) => ({ ...r }));
	for (const [id, want] of Object.entries(need)) {
		let left = want;
		for (const r of out.filter((x) => x.id === id).sort((a, b) => a.exp - b.exp)) {
			const k = Math.min(r.n, left);
			r.n -= k;
			left -= k;
			if (!left) break;
		}
		if (left > 0) return null;
	}
	return out.filter((r) => r.n > 0);
}

/** 过期的食材扔掉，记一笔日志。原地修改（调用方传入的是克隆） */
function tossSpoiled(state: PlayerState): number {
	const { rows, spoiled } = freshPantry(state.cooking.pantry, state.clock);
	state.cooking.pantry = rows;
	if (spoiled) log(state, `扔掉了 ${spoiled} 份过期的食材。`);
	return spoiled;
}

// ---------- 买食材 ----------
export interface GroceryOffer {
	item: IngredientDef;
	price: number; // 一份，已算特质折扣
	blocked?: string;
}

/** 这个地点有没有这类店：超市按地点类别，亚洲超市按地点（第一版近似，见 data/cooking.ts） */
export function hasStore(s: PlayerState, region: Region, store: IngredientDef['store']): boolean {
	const kind = getLocation(region, s.loc)?.kind;
	if (!kind || !GROCER_KINDS.includes(kind)) return false;
	return store === 'super' || ASIAN_GROCER_LOCS.includes(s.loc);
}

export const groceryPrice = (s: PlayerState, item: IngredientDef) => Math.max(1, Math.round(item.price * costMult(s)));

/** 此地能买的食材；一家店都没有时返回空 */
export function groceriesAt(s: PlayerState, region: Region): GroceryOffer[] {
	const open = isOpen(GROCER_HOURS, s.clock);
	const room = PANTRY_MAX - pantryTotal(s);
	return INGREDIENTS.filter((i) => hasStore(s, region, i.store)).map((item) => {
		const price = groceryPrice(s, item);
		const blocked = !open ? `超市 ${GROCER_HOURS[0]}:00–${GROCER_HOURS[1]}:00 营业` : room < 1 ? `食材柜满了（最多 ${PANTRY_MAX} 份）` : s.cash < price ? `需要 $${price}` : undefined;
		return { item, price, blocked };
	});
}

/** 一次买 n 份同一种食材（1–GROCER_BATCH_MAX）。保质期从今天结束算起：今天买的同种食材合并成一批 */
export function buyGroceries(prev: PlayerState, region: Region, id: string, n: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const k = Math.floor(n);
	if (!(k >= 1 && k <= GROCER_BATCH_MAX)) return fail(prev, `一次买 1 到 ${GROCER_BATCH_MAX} 份。`);
	const offer = groceriesAt(prev, region).find((o) => o.item.id === id);
	if (!offer) return fail(prev, '这里买不到。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const cost = offer.price * k;
	if (prev.cash < cost) return fail(prev, `需要 $${cost}`);
	if (pantryTotal(prev) + k > PANTRY_MAX) return fail(prev, `食材柜放不下（最多 ${PANTRY_MAX} 份）`);
	const state = clone(prev);
	tossSpoiled(state);
	const exp = (dayOf(state.clock) + offer.item.days + 1) * 1440;
	// 先把食材放进柜子再过时间（和 buyItem 一样）：路上晕倒，买到的东西还在（合并 main 后复核）
	const row = state.cooking.pantry.find((r) => r.id === id && r.exp === exp);
	if (row) row.n += k;
	else if (state.cooking.pantry.length < PANTRY_ROWS) state.cooking.pantry.push({ id, n: k, exp });
	else return fail(prev, '食材柜太乱了，先用掉一些。');
	if (applyEffect(state, { cash: -cost, minutes: GROCER_MINUTES }, region)) return collapsedResult(state);
	const msg = `${offer.item.icon} 买了 ${k} 份${offer.item.name}，$${cost}，${offer.item.days} 天内用掉。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 食谱 ----------
/** 会不会做：技能门槛或 NPC 关系；不写解锁条件的一开始就会 */
export function recipeKnown(s: PlayerState, r: RecipeDef): boolean {
	const u = r.unlock;
	if (!u) return true;
	if ('skill' in u) return s.cooking.xp >= u.skill;
	return getRelation(s, u.npc).score >= u.at;
}

/** 解锁条件的说明 */
export function unlockLabel(r: RecipeDef): string {
	const u = r.unlock;
	if (!u) return '一开始就会';
	if ('skill' in u) return `烹饪 ${u.skill}`;
	const npc = NPCS.find((n) => n.id === u.npc);
	return `${npc?.name ?? '朋友'}教（关系 ${u.at}）`;
}

/** 做得好不好：见 COOK_QUALITY；随手做一顿固定 1 */
export function cookQuality(s: PlayerState, r: RecipeDef): number {
	if (r.cuisine === 'basic') return 1;
	const q = COOK_QUALITY;
	const gate = r.unlock && 'skill' in r.unlock ? r.unlock.skill : 0;
	const tries = Math.min(q.tryMax, (s.cooking.made[r.id] ?? 0) * q.perTry);
	return Math.max(q.min, Math.min(q.max, q.base + (s.cooking.xp - gate) * q.perSkill + tries));
}

/** 一次做菜涨多少烹饪技能：基础 × 第一次加倍 × 心情倍率 × scale × (1 − 当前 / cap) */
export function cookGain(s: PlayerState, r: RecipeDef): number {
	const g = COOK_GROWTH;
	const first = s.cooking.made[r.id] ? 1 : g.first;
	return r.xp * first * moodletGainMult(s) * g.scale * Math.max(0, 1 - s.cooking.xp / g.cap);
}

/** 做 batches 锅要的食材 */
const needFor = (r: RecipeDef, batches: number) => Object.fromEntries(Object.entries(r.ingredients).map(([id, n]) => [id, n * batches]));

/** 缺什么食材（份数） */
function missing(s: PlayerState, r: RecipeDef, batches: number): string | undefined {
	const have = pantryCount(s);
	const lack = Object.entries(needFor(r, batches)).filter(([id, n]) => (have[id] ?? 0) < n).map(([id, n]) => `${getIngredient(id)?.name ?? id} ${n - (have[id] ?? 0)} 份`);
	return lack.length ? `还缺${lack.join('、')}` : undefined;
}

/** 在家能不能做这道菜；batches 是做几锅（请客时多于 1）。传了 region 才看停电（和 main 的 homeActionBlocked 一样，见 disasters.md） */
function recipeBlocked(s: PlayerState, r: RecipeDef, batches = 1, region?: Region): string | undefined {
	if (!atHome(s)) return '要在住处';
	const lv = kitchenLevel(s);
	if (lv < 1) return '需要炊具';
	if (lv < r.kitchen) return '需要带烤箱的厨房';
	const where = region ? getLocation(region, s.loc) : undefined;
	const dark = where ? outageBlocksCook(s, where, dayOf(s.clock)) : undefined;
	if (dark) return dark;
	if (!recipeKnown(s, r)) return `还不会（${unlockLabel(r)}）`;
	if (r.cash && s.cash < r.cash) return `需要 $${r.cash}`;
	return missing(s, r, batches);
}

export function cookBlocked(s: PlayerState, id: string, region?: Region): string | undefined {
	const r = getRecipe(id);
	return r ? recipeBlocked(s, r, 1, region) : '没有这道菜。';
}

const moodletOf = (r: RecipeDef) => (r.cuisine === 'zh' ? 'taste-of-home' : r.cuisine === 'au' ? 'home-cooked' : 'well-fed');

/** 自己吃的那份效果 */
function mealEffect(s: PlayerState, r: RecipeDef, q: number): Effect {
	return { cash: r.cash ? -r.cash : undefined, minutes: r.minutes, needs: { hunger: Math.round(r.hunger * q), fun: Math.round(r.fun * q) }, health: r.health || undefined, moodlet: moodletOf(r) };
}

/** 记一次做菜：技能成长、做过次数。原地修改；要在时间流逝前调用（和 applyEffect 一样，学到的就是学到的） */
function practice(state: PlayerState, r: RecipeDef): { before: number; firstTime: boolean } {
	const before = state.cooking.xp;
	const firstTime = !state.cooking.made[r.id];
	state.cooking.xp = Math.min(100, before + cookGain(state, r));
	state.cooking.made[r.id] = Math.min(1e6, (state.cooking.made[r.id] ?? 0) + 1);
	return { before, firstTime };
}

/** 技能涨过门槛新会的菜 */
function newlyKnown(before: PlayerState, after: PlayerState): RecipeDef[] {
	return RECIPES.filter((r) => !recipeKnown(before, r) && recipeKnown(after, r));
}

/** 在家照食谱做一顿（不写食谱 = 随手做一顿，和旧版在家做饭一样 $6） */
export function cookRecipe(prev: PlayerState, region: Region, id = 'quick'): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const r = getRecipe(id);
	if (!r) return fail(prev, '没有这道菜。');
	// 能不能做只看没过期的食材，所以先判断、做不了就什么都不改
	const why = recipeBlocked(prev, r, 1, region);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const spoiled = tossSpoiled(state);
	const q = cookQuality(state, r);
	state.cooking.pantry = takeFromPantry(state.cooking.pantry, needFor(r, 1))!;
	const { firstTime } = practice(state, r);
	if (applyEffect(state, mealEffect(state, r, q), region)) return collapsedResult(state);
	const learned = newlyKnown(prev, state);
	const parts = [r.cuisine === 'basic' ? '🍳 在家吃了顿饭。' : `${r.icon} 做了${r.name}${q >= COOK_QUALITY.great ? '，做得很成功' : ''}。`];
	if (firstTime && r.cuisine !== 'basic') parts.push('第一次做，学到不少。');
	if (learned.length) parts.push(`烹饪到了 ${Math.floor(state.cooking.xp)}，学会了${learned.map((x) => `「${x.name}」`).join('')}。`);
	if (spoiled) parts.push(`（扔掉了 ${spoiled} 份过期食材）`);
	log(state, r.cuisine === 'basic' ? '在家做了顿饭。' : `在家做了${r.name}。`);
	return { ok: true, state, msg: parts.join(' ') };
}

// ---------- 请客 ----------
/** 能请来的朋友：常住住处所在地、关系到「朋友」、今天没请假（休假 / 病假），按关系从高到低，最多 maxGuests 位。白天在别处上班不影响，下班过来吃饭 */
export function hostGuests(s: PlayerState): NpcDef[] {
	if (!s.home) return [];
	return NPCS.filter((n) => n.loc === s.home!.loc && !planFor(n, s.clock).away && getRelation(s, n.id).score >= HOSTING.friendAt)
		.sort((a, b) => getRelation(s, b.id).score - getRelation(s, a.id).score)
		.slice(0, HOSTING.maxGuests);
}

/** 请客要做几锅：朋友 + 自己；没有朋友时请两位邻居 */
export function hostBatches(s: PlayerState, r: RecipeDef): number {
	const people = (hostGuests(s).length || 2) + 1;
	return Math.ceil(people / Math.max(1, r.serves));
}

export function hostBlocked(s: PlayerState, id: string, region?: Region): string | undefined {
	const r = getRecipe(id);
	if (!r) return '没有这道菜。';
	if (r.cuisine === 'basic') return '请客要照食谱做菜';
	if (s.cooking.hostDay === dayOf(s.clock)) return '今天已经请过客了';
	if (!isOpen(HOSTING.hours, s.clock)) return `饭点才请客（${HOSTING.hours[0]}:00–${HOSTING.hours[1]}:00）`;
	if (s.needs.energy < HOSTING.minEnergy) return '太累了';
	return recipeBlocked(s, r, hostBatches(s, r), region);
}

/** 请客：做够一桌人吃的量，涨社交、娱乐、声望；来的朋友关系上涨（摆齐「待客之家」更多） */
export function hostDinner(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const r = getRecipe(id);
	if (!r) return fail(prev, '没有这道菜。');
	const why = hostBlocked(prev, id, region);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const spoiled = tossSpoiled(state);
	const guests = hostGuests(state);
	const q = cookQuality(state, r);
	state.cooking.pantry = takeFromPantry(state.cooking.pantry, needFor(r, hostBatches(state, r)))!;
	state.cooking.hostDay = dayOf(state.clock);
	practice(state, r);
	const set = furnitureSets(state).some((x) => x.done && x.set.id === HOSTING.hostSet);
	const gain = HOSTING.rel + (set ? HOSTING.setRel : 0);
	// 关系先记上（和 NPC 互动一样：开始时就算数，途中晕倒也不能再请一次）
	for (const n of guests) {
		const rel = structuredClone(getRelation(state, n.id));
		rel.score = Math.min(100, rel.score + gain);
		rel.last.host = dayOf(state.clock); // 来吃过饭也算见过面，关系不会因为「好久没联系」变淡（合并 main 后复核）
		state.relations[n.id] = rel;
	}
	const meal = mealEffect(state, r, q);
	const fx: Effect = {
		...meal,
		minutes: r.minutes + HOSTING.extraMinutes,
		needs: { hunger: meal.needs!.hunger, fun: (meal.needs!.fun ?? 0) + HOSTING.fun, social: HOSTING.social + HOSTING.perGuest * guests.length },
		respect: HOSTING.respect,
		moodlet: 'hosted',
	};
	if (applyEffect(state, fx, region)) return collapsedResult(state);
	const who = guests.length ? guests.map((n) => n.name).join('、') : '邻居和室友';
	const msg = `${r.icon} 请${who}来家里吃了${r.name}${q >= COOK_QUALITY.great ? '，大家都说好吃' : ''}。${guests.length ? `关系 +${gain}${set ? '（待客之家）' : ''}。` : ''}${spoiled ? `（扔掉了 ${spoiled} 份过期食材）` : ''}`;
	log(state, `请${who}来家里吃了${r.name}。`);
	return { ok: true, state, msg };
}

// ---------- 外卖 ----------
export const deliveryPrice = (s: PlayerState) => Math.round(DELIVERY.cost * costMult(s));

export function deliveryBlocked(s: PlayerState, region: Region): string | undefined {
	if (!atHome(s)) return '要在住处';
	const kind = getLocation(region, s.loc)?.kind;
	if (!kind || !DELIVERY.kinds.includes(kind)) return '这里没有外卖送';
	if (!isOpen(DELIVERY.hours, s.clock)) return `外卖 ${DELIVERY.hours[0]}:00–${DELIVERY.hours[1]}:00`;
	const price = deliveryPrice(s);
	if (s.cash < price) return `需要 $${price}`;
	return undefined;
}

export function orderDelivery(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = deliveryBlocked(prev, region);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const price = deliveryPrice(state);
	if (applyEffect(state, { cash: -price, minutes: DELIVERY.minutes, needs: { hunger: DELIVERY.hunger, fun: DELIVERY.fun }, health: DELIVERY.health || undefined, moodlet: 'well-fed' }, region)) return collapsedResult(state);
	log(state, '在家叫了外卖。');
	return { ok: true, state, msg: `🛵 叫了外卖，$${price}。` };
}

/** 旧入口：随手做一顿（$6，和做饭分支之前的在家做饭一样） */
export const cookAtHome = (prev: PlayerState, region: Region): ActionResult => cookRecipe(prev, region, 'quick');
