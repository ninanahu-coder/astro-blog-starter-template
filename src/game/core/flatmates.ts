// 室友与合租的规则：纯函数，不引用 engine.ts（engine 的周结算和睡觉会调用这里）。
// 改存档的函数都是「原地修改」，调用方传入的必须是引擎已经 clone 过的状态。
// 随机数：不推进 state.seed，而是用 seed + 时钟 + 用途做哈希（unit）。这样加了室友不会打乱其他系统的随机序列；seed 不发给客户端，结果照样不可预知。
import { HOMES } from '../data/housing.ts';
import { FLAT_EVENTS, FLAT_RULES, FLATMATES, type FlatChoice, type FlatEventDef, type FlatmateDef } from '../data/flatmates.ts';
import { dayOf } from './time.ts';
import { secretSeed } from './prf.ts';
import { rentDue } from './rental.ts';
import { unit } from './weather.ts';
import type { Flatmate, Flatshare, Home, PlayerState } from './types.ts';

export const emptyFlatshare = (): Flatshare => ({ mates: [], clean: FLAT_RULES.cleanStart, ev: null, chore: -1, sublet: false });
export const getFlatmate = (id: string): FlatmateDef | undefined => FLATMATES.find((m) => m.id === id);
export const getFlatEvent = (id: string): FlatEventDef | undefined => FLAT_EVENTS.find((e) => e.id === id);

/** 把文案里的 {name} 换成室友名字 */
export const flatText = (text: string, mateId: string) => text.split('{name}').join(getFlatmate(mateId)?.name ?? '室友');

const clampVibe = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** 私密随机数：seed + 时钟 + 用途 */
export const flatRand = (state: PlayerState, salt: string) => unit(`${secretSeed(state)}|${state.clock}|${salt}`);

/** 住处最多住几个人（含自己）。没有住处、住自有房（第一版不做）、营地这类房型为 1 */
export function flatBeds(state: PlayerState): number {
	if (!state.home || state.home.owned) return 1;
	return FLAT_RULES.beds[state.home.type] ?? 1;
}

/** 合租房间这类「自带室友」的房型：你只是租客，不能挑人、不能请人搬走，房租不分摊（按租约或租金行情付整份） */
export function flatAuto(state: PlayerState): number {
	if (!state.home || state.home.owned) return 0;
	return FLAT_RULES.autoMates[state.home.type] ?? 0;
}

/** 现在真正住在一起的室友（住处不支持合租时为空；不超过空床数） */
export function activeMates(state: PlayerState): Flatmate[] {
	const beds = flatBeds(state);
	return beds > 1 ? state.flatshare.mates.slice(0, beds - 1) : [];
}

/** 住处的标识（房型@地点）：室友记录跟着它走 */
export const homeKey = (home: Pick<Home, 'type' | 'loc'>) => `${home.type}@${home.loc}`;

/** 正在算的那个结算日（和 attributes.ts 的 settleDay 一样；这里不 import attributes，避免循环引用） */
const settleOn = (state: PlayerState) => Math.max(dayOf(state.clock), state.nextWeek);

/**
 * 你这周的那份房租（含分摊的水电网）。二房东有室友时：（房租 + 水电网）÷ 人数；其他情况就是整份房租。
 * full：这周的整份房租。合并 main 后由调用方按租约房租或租金指数算好传进来（attributes.ts 的 weeklyCosts、engine.ts 的周结算）；不传按房型标价
 */
export function rentShare(state: PlayerState, full?: number): number {
	if (!state.home || state.home.owned) return 0;
	const def = HOMES.find((h) => h.id === state.home!.type);
	// 不传 full 时按 main 的租房规则现算（租约房租、已通知的涨租、租金指数），界面和消息里的数和结算扣的一致（合并 main 时复核）
	const rent = full ?? (def ? rentDue(state, def, settleOn(state)) : 0);
	const mates = activeMates(state).length;
	if (flatAuto(state) || mates === 0) return rent;
	return Math.round((rent + (FLAT_RULES.billsWeek[state.home.type] ?? 0)) / (mates + 1));
}

/** 转租时每周收回的钱 */
/** 到 weekEnd 这个结算日为止，这一周转租了几天（0–7） */
export function subletDays(state: PlayerState, weekEnd = settleOn(state)): number {
	if (!state.flatshare.sublet) return 0;
	const from = Math.max(state.flatshare.subFrom ?? weekEnd, weekEnd - 7);
	return Math.max(0, Math.min(7, weekEnd - from));
}

/**
 * 转租时这个结算日收回的钱：你那份房租 × 收回比例 × 这周实际转租的天数 ÷ 7。
 * 按天折算：结算前一刻才转租、结算后马上收回，只算 0 天（合并 main 时复核：原来按结算那一刻的开关算整周，可以每周只付一成房租）
 */
export const subletIncome = (state: PlayerState, full?: number, weekEnd?: number) =>
	state.flatshare.sublet && state.home && !state.home.owned ? Math.round((rentShare(state, full) * FLAT_RULES.subletRate * subletDays(state, weekEnd)) / 7) : 0;

/** 结算日实际要掏的钱 = 你那份 − 转租收入 */
export const flatRentDue = (state: PlayerState, full?: number, weekEnd?: number) => rentShare(state, full) - subletIncome(state, full, weekEnd);

/** 某个结算日之前那一周轮到谁值日：'me' 或室友 id。weekEnd 默认是下一个结算日（也就是「这周」） */
export function dutyFor(state: PlayerState, weekEnd = state.nextWeek): string {
	const order = ['me', ...activeMates(state).map((m) => m.id)];
	return order[Math.floor(weekEnd / 7) % order.length];
}

/** 这周（到 weekEnd 为止的 7 天）你做过家务没有 */
export const choreDone = (state: PlayerState, weekEnd = state.nextWeek) => state.flatshare.chore >= weekEnd - 7;

/** 室友对住处心情的影响：二房东每多一位室友 −1（隐私）；家里太乱 −3 */
export function flatComfort(state: PlayerState): number {
	const mates = activeMates(state).length;
	if (!mates) return 0;
	const privacy = flatAuto(state) ? 0 : FLAT_RULES.privacyPerMate * mates;
	return privacy + (state.flatshare.clean < FLAT_RULES.messyBelow ? FLAT_RULES.messyComfort : 0);
}

/** 平均关系（没有室友时为 0） */
export function avgVibe(state: PlayerState): number {
	const m = activeMates(state);
	return m.length ? m.reduce((a, x) => a + x.vibe, 0) / m.length : 0;
}

export interface FlatCandidate {
	def: FlatmateDef;
	blocked?: string;
}

/**
 * 这周来看房的人：只有二房东、人在住处、还有空床时才有。由玩家 id + 住处 + 第几周决定（不用私密种子，客户端能算出同样的名单）。
 * 刚请走或自己搬走的人不会马上回来：已经住着的人不在名单里。
 */
export function flatCandidates(state: PlayerState): FlatCandidate[] {
	if (!state.home || state.home.owned || flatAuto(state) || flatBeds(state) <= 1) return [];
	const week = Math.floor(dayOf(state.clock) / 7);
	const here = new Set(state.flatshare.mates.map((m) => m.id));
	const pool = FLATMATES.filter((m) => !here.has(m.id))
		.map((def) => ({ def, k: unit(`${state.id}|${state.home!.loc}|${week}|${def.id}`) }))
		.sort((a, b) => a.k - b.k)
		.slice(0, FLAT_RULES.candidates);
	const full = state.flatshare.mates.length + 1 >= flatBeds(state);
	return pool.map(({ def }) => ({
		def,
		blocked: state.flatshare.sublet ? '房间转租中，先收回来'
			: full ? '没有空床了'
			: state.home!.loc !== state.loc ? '要回到住处才能见面看房'
			: undefined,
	}));
}

/** 新室友 */
export const newMate = (id: string, day: number): Flatmate => ({ id, vibe: FLAT_RULES.vibeStart, since: day, owes: 0 });

/** 合租房间补满自带的室友（租下时、旧存档、有人搬走后）。原地修改 */
export function fillAutoMates(state: PlayerState, salt: string): string[] {
	const want = flatAuto(state);
	const added: string[] = [];
	let i = 0;
	while (state.flatshare.mates.length < want && i < 20) {
		const here = new Set(state.flatshare.mates.map((m) => m.id));
		const pool = FLATMATES.filter((m) => !here.has(m.id));
		if (!pool.length) break;
		const pick = pool[Math.floor(flatRand(state, `${salt}|${i}`) * pool.length)];
		state.flatshare.mates.push(newMate(pick.id, dayOf(state.clock)));
		added.push(pick.name);
		i++;
	}
	return added;
}

/** 事件能不能落在这位室友身上 */
function eventFits(ev: FlatEventDef, def: FlatmateDef, clean: number): boolean {
	const n = ev.needs;
	return (n.noise === undefined || def.noise >= n.noise)
		&& (n.borrow === undefined || def.borrow >= n.borrow)
		&& (n.warm === undefined || def.warm >= n.warm)
		&& (n.untidy === undefined || 2 - def.tidy >= n.untidy)
		&& (!n.dirty || clean < FLAT_RULES.messyBelow);
}

/** 现在可能发生的（事件，室友）组合 */
export function eligibleEvents(state: PlayerState): { ev: FlatEventDef; mate: string }[] {
	const out: { ev: FlatEventDef; mate: string }[] = [];
	for (const m of activeMates(state)) {
		const def = getFlatmate(m.id);
		if (!def || m.out !== undefined) continue; // 定好要搬走的人不再惹事
		for (const ev of FLAT_EVENTS) if (eventFits(ev, def, state.flatshare.clean)) out.push({ ev, mate: m.id });
	}
	return out;
}

export interface FlatHooks {
	log: (text: string) => void;
	mood: (id: string) => void;
}

/** 过期没处理的事件作废：那位室友关系 −4。原地修改 */
function expireEvent(state: PlayerState, hooks: FlatHooks) {
	const ev = state.flatshare.ev;
	if (!ev || dayOf(state.clock) - ev.day < FLAT_RULES.eventExpireDays) return;
	const mate = state.flatshare.mates.find((m) => m.id === ev.mate);
	if (mate) mate.vibe = clampVibe(mate.vibe + FLAT_RULES.eventExpireVibe);
	state.flatshare.ev = null;
	hooks.log(`没理会「${getFlatEvent(ev.id)?.title ?? '室友的事'}」，${getFlatmate(ev.mate)?.name ?? '室友'}有点不高兴。`);
}

/**
 * 回家睡醒以后：室友带来社交恢复；家里太乱少恢复清洁；相处融洽有心情；按几率抽一个室友事件。原地修改。
 * 只在人睡在自己住处、房间没转租时调用。
 */
export function afterSleepFlat(state: PlayerState, hooks: FlatHooks) {
	const mates = activeMates(state);
	if (!mates.length) return;
	const f = state.flatshare;
	state.needs.social = clamp100(state.needs.social + FLAT_RULES.socialPerMate * Math.min(2, mates.length));
	if (f.clean < FLAT_RULES.messyBelow) {
		state.needs.hygiene = clamp100(state.needs.hygiene + FLAT_RULES.messyHygiene);
		hooks.mood('flat-messy');
	} else if (avgVibe(state) >= FLAT_RULES.harmonyAbove) hooks.mood('flat-harmony');
	expireEvent(state, hooks);
	if (f.ev || flatRand(state, 'ev') >= FLAT_RULES.eventChance) return;
	const pool = eligibleEvents(state);
	const total = pool.reduce((a, x) => a + x.ev.weight, 0);
	if (!total) return;
	let r = flatRand(state, 'pick') * total;
	const hit = pool.find((x) => (r -= x.ev.weight) < 0) ?? pool[pool.length - 1];
	f.ev = { id: hit.ev.id, mate: hit.mate, day: dayOf(state.clock) };
}

/**
 * 每周结算（房租付完之后）。weekEnd 是刚过去的那个结算日。原地修改：
 * 1. 卫生：每人弄脏一点；轮到室友值日就打扫；轮到你、做没做家务影响所有人的关系
 * 2. 家里太乱，爱干净的室友不满  3. 欠钱的按几率还  4. 过期事件作废
 * 5. 到日子的人搬走；关系太差的人提出下周搬走  6. 合租房间补满室友
 */
export function settleFlatWeek(state: PlayerState, weekEnd: number, hooks: FlatHooks) {
	const f = state.flatshare;
	const mates = activeMates(state);
	if (!mates.length) {
		if (flatAuto(state)) {
			const added = fillAutoMates(state, `fill|${weekEnd}`);
			if (added.length) hooks.log(`合租房间搬进了新室友：${added.join('、')}。`);
		}
		return;
	}
	const day = dayOf(state.clock);
	const duty = dutyFor(state, weekEnd);
	let clean = f.clean - FLAT_RULES.cleanDecayMe;
	for (const m of mates) clean -= FLAT_RULES.cleanDecay[getFlatmate(m.id)?.tidy ?? 1];
	if (duty === 'me') {
		const done = choreDone(state, weekEnd);
		for (const m of mates) m.vibe = clampVibe(m.vibe + (done ? FLAT_RULES.dutyDoneVibe : FLAT_RULES.dutySkipVibe));
		if (!done) hooks.log('上周轮到你值日，你没做家务，室友们有点意见。');
	} else {
		clean += FLAT_RULES.dutyClean[getFlatmate(duty)?.tidy ?? 1];
	}
	f.clean = clamp100(clean);
	if (f.clean < FLAT_RULES.messyBelow) {
		for (const m of mates) if (getFlatmate(m.id)?.tidy === 2) m.vibe = clampVibe(m.vibe + FLAT_RULES.messyTidyVibe);
	}
	for (const m of mates) {
		if (m.owes <= 0) continue;
		const name = getFlatmate(m.id)?.name ?? '室友';
		if (flatRand(state, `repay|${m.id}|${weekEnd}`) < FLAT_RULES.repayChance[getFlatmate(m.id)?.borrow ?? 1]) {
			state.cash += m.owes;
			hooks.log(`${name}还了你 $${m.owes}。`);
			m.owes = 0;
		} else hooks.log(`${name}借的 $${m.owes} 还没还。`);
	}
	expireEvent(state, hooks);
	const leaving = mates.filter((m) => m.out !== undefined && m.out <= day);
	for (const m of leaving) {
		const name = getFlatmate(m.id)?.name ?? '室友';
		if (m.owes > 0) hooks.log(`${name}搬走了，借的 $${m.owes} 没还上。`);
		else hooks.log(`${name}搬走了。`);
	}
	f.mates = f.mates.filter((m) => !leaving.includes(m));
	if (f.ev && !f.mates.some((m) => m.id === f.ev!.mate)) f.ev = null;
	for (const m of f.mates) {
		if (m.out === undefined && m.vibe <= FLAT_RULES.leaveBelow) {
			m.out = day + 7;
			hooks.log(`${getFlatmate(m.id)?.name ?? '室友'}说住不下去了，下周搬走。`);
		}
	}
	if (flatAuto(state)) {
		const added = fillAutoMates(state, `fill|${weekEnd}`);
		if (added.length) hooks.log(`合租房间搬进了新室友：${added.join('、')}。`);
	}
}

/** 事件选项现在能不能选 */
export function flatChoiceBlocked(state: PlayerState, c: FlatChoice): string | undefined {
	const pay = (c.cost ?? 0) + (c.lend ?? 0);
	return pay > state.cash ? `需要 $${pay}` : undefined;
}

/** 存档清洗：旧存档没有这个字段给默认值；室友只留已知人设、去重、限数量；数值钳到范围；事件要对得上室友。幂等 */
export function cleanFlatshare(raw: unknown, home?: Home | null, day = Number.MAX_SAFE_INTEGER): Flatshare {
	const out = emptyFlatshare();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	// 没有住处、住自有房，或记录的住处对不上现在的住处：室友和转租都不算数（合并 main 时复核）
	if (home !== undefined && (!home || home.owned)) return out;
	const rawHome = Object.prototype.hasOwnProperty.call(raw, 'home') ? (raw as Record<string, unknown>).home : undefined;
	if (home && typeof rawHome === 'string' && rawHome !== homeKey(home)) return out;
	// 只读自有键：原型链上的 mates、ev 之类不算
	const r: Record<string, unknown> = {};
	for (const k of ['mates', 'clean', 'ev', 'chore', 'sublet', 'subFrom']) if (Object.prototype.hasOwnProperty.call(raw, k)) r[k] = (raw as Record<string, unknown>)[k];
	const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
	if (Array.isArray(r.mates)) {
		for (const m of r.mates.slice(0, 20)) {
			if (!m || typeof m !== 'object' || !getFlatmate((m as any).id) || out.mates.some((x) => x.id === (m as any).id)) continue;
			const x = m as Record<string, unknown>;
			const mate: Flatmate = { id: x.id as string, vibe: int(x.vibe, -100, 100, FLAT_RULES.vibeStart), since: int(x.since, 0, 1e7, 0), owes: int(x.owes, 0, 10000, 0) };
			if (typeof x.out === 'number' && Number.isFinite(x.out)) mate.out = int(x.out, 0, 1e7, 0);
			out.mates.push(mate);
			if (out.mates.length >= FLAT_RULES.maxMates) break;
		}
	}
	out.clean = int(r.clean, 0, 100, FLAT_RULES.cleanStart);
	const ev = r.ev as Record<string, unknown> | null | undefined;
	if (ev && typeof ev === 'object' && typeof ev.id === 'string' && getFlatEvent(ev.id) && typeof ev.mate === 'string' && out.mates.some((m) => m.id === ev.mate)) {
		out.ev = { id: ev.id, mate: ev.mate, day: int(ev.day, 0, 1e7, 0) };
	}
	out.chore = int(r.chore, -1, 1e7, -1);
	out.sublet = r.sublet === true;
	// 转租起始日：不晚于今天；旧存档没有就从今天算（不补算过去的转租收入）
	if (out.sublet) out.subFrom = int(r.subFrom, 0, Math.min(1e7, day), Math.min(1e7, day));
	if (home) out.home = homeKey(home);
	return out;
}
