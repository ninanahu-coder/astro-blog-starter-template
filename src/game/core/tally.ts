// 生涯统计（docs/earth-game/career-stats.md）：存档里只累积计数（收支按类别、公里、里程碑的日子、周期快照），不存逐条明细。
// 纯函数。记账的入口是 finishTally()：applyAction / applyCoop / applyTrade / applyWeeklyClaim / claimDaily 结算完都调一次。
// 钱按「这一步现金变化」记：引擎里自己分好类的部分（周结算的房租、保险）先用 tallyCash() 记，剩下的归到这个动作的类别。
import { dayOf } from './time.ts';
import type { PlayerState, Tally, TallyCard, TallyCat, TallySnap } from './types.ts';
import type { GameAction } from './actions.ts';
import { MILESTONES, type MilestoneDef } from '../data/milestones.ts';

export const TALLY_CATS = ['work', 'transport', 'shop', 'housing', 'vehicle', 'study', 'fun', 'social', 'event', 'daily', 'reward', 'other'] as const satisfies readonly TallyCat[];

export const CAT_LABEL: Record<TallyCat, string> = {
	work: '工作与零工', transport: '出行', shop: '吃喝购物', housing: '住房与房产', vehicle: '车辆', study: '学习考证',
	fun: '玩乐体验', social: '人情往来', event: '意外事件', daily: '日常', reward: '奖励', other: '其他',
};

/** 开局那一天（START_CLOCK 是第 0 天 08:00；不从 character.ts 引，免得循环引用，测试里核对两者一致） */
export const START_DAY = 0;
export const WEEK_DAYS = 7;
export const YEAR_DAYS = 365;
/** 累计金额、公里的上限（只有坏存档会碰到） */
export const TALLY_MAX = 1e12;

/** 来澳第几天（开局那天算第 1 天） */
export const arrivalDays = (s: Pick<PlayerState, 'clock'>) => Math.max(1, dayOf(s.clock) - START_DAY + 1);
/** 来澳第几周、第几年（从 0 起） */
export const weekIdx = (day: number) => Math.max(0, Math.floor((day - START_DAY) / WEEK_DAYS));
export const yearIdx = (day: number) => Math.max(0, Math.floor((day - START_DAY) / YEAR_DAYS));

export const placesOf = (s: Pick<PlayerState, 'visited'>) => Object.keys(s.visited).length;
/** 认识的人：有过互动的 NPC + 一起做过事的玩家（常遇见的人只留最近 30 位，所以这个数可能变小） */
export const peopleOf = (s: Pick<PlayerState, 'relations' | 'met'>) => Object.keys(s.relations).length + Object.keys(s.met ?? {}).length;

const sum = (m: Partial<Record<TallyCat, number>>) => TALLY_CATS.reduce((a, k) => a + (m[k] ?? 0), 0);
export const earnedOf = (t: Pick<Tally, 'in'>) => sum(t.in);
export const spentOf = (t: Pick<Tally, 'out'>) => sum(t.out);

export function newTally(s: Pick<PlayerState, 'clock' | 'visited' | 'relations' | 'met'> & { cash?: number }, pre = false): Tally {
	const day = dayOf(s.clock);
	const places = placesOf(s);
	const people = peopleOf(s);
	const snap = (i: number): TallySnap => ({ i, earned: 0, out: {}, km: 0, places, people });
	return { from: day, km: 0, in: {}, out: {}, ms: {}, pre, wk: snap(weekIdx(day)), yr: snap(yearIdx(day)), lastWk: null, lastYr: null, ...(typeof s.cash === 'number' ? { cash: Math.round(s.cash) } : {}) };
}

/** 深拷贝（finishTally 原地改 next.tally 之前用：claimDaily 之类按 {...prev} 浅拷贝的新存档和旧存档共用同一个对象） */
export const copyTally = (t: Tally): Tally => ({
	...t, in: { ...t.in }, out: { ...t.out }, ms: { ...t.ms },
	wk: { ...t.wk, out: { ...t.wk.out } }, yr: { ...t.yr, out: { ...t.yr.out } },
	lastWk: t.lastWk && { ...t.lastWk }, lastYr: t.lastYr && { ...t.lastYr },
});

const add = (m: Partial<Record<TallyCat, number>>, k: TallyCat, v: number) => { m[k] = Math.min(TALLY_MAX, (m[k] ?? 0) + v); };

/** 引擎内部按类别记一笔现金变化（正数收入、负数支出），原地改 state.tally。只在引擎自己 clone 出来的新存档上用 */
export function tallyCash(state: PlayerState, cat: TallyCat, delta: number) {
	const d = Math.round(delta);
	if (!d || !state.tally) return;
	if (d > 0) add(state.tally.in, cat, d);
	else add(state.tally.out, cat, -d);
}

/** 动作的钱记在哪一类：[收入来源, 支出去向] */
export function actionCats(a: GameAction): [TallyCat, TallyCat] {
	switch (a.t) {
		case 'travel': return ['transport', 'transport'];
		case 'activity': return ['work', 'daily']; // 活动里赚钱的是零工，花钱的是日常
		case 'event': return ['event', 'event'];
		case 'gps': return ['fun', 'fun'];
		case 'buy':
		case 'use': return ['shop', 'shop'];
		case 'npc': return ['social', 'social'];
		case 'job': return ['work', 'work'];
		case 'home': return a.op === 'cook' || a.op === 'host' || a.op === 'delivery' ? ['shop', 'shop'] : ['housing', 'housing']; // 在家做饭、请客、叫外卖算吃喝
		case 'grocery': return ['shop', 'shop']; // 买食材
		case 'furniture':
		case 'rental': // 租房市场：骗租被骗的钱、押金扣款（合并 main 后）
		case 'property': return ['housing', 'housing'];
		case 'vehicle': return ['vehicle', 'vehicle'];
		case 'course':
		case 'cert': return ['study', 'study'];
		case 'fish':
		case 'photo':
		case 'experience': return ['fun', 'fun'];
		case 'venue':
			return a.op === 'work' ? ['work', 'work'] : a.op === 'meal' || a.op === 'drink' || a.op === 'groceries' ? ['shop', 'shop'] : a.op === 'study' ? ['study', 'study'] : ['daily', 'daily'];
		// 合并 main 后新加的动作（第 25–43 批）
		case 'sell': // 卖二手物品
		case 'swap': return ['shop', 'shop']; // 二手市场「邻里换手墙」的买卖（含被骗的钱，合并 main 后）
		case 'study': return ['study', 'study']; // 学历课程
		case 'care':
		case 'pet': return ['daily', 'daily']; // 看病、养宠物的日常开销
		case 'trail':
		case 'hobby': // 爱好：种子、手工材料（爱好与收集）
		case 'sport': return ['fun', 'fun']; // 运动：报名费、俱乐部会费、取消退费（第 43 批）
		case 'claim':
		case 'live':
		case 'onboard': return ['reward', 'reward']; // 成就奖励、现实活动、新手引导的奖励
		case 'insure': { // 保费：车险算车，租客险算住房，旅行险算出行（第 43 批）
			const c: TallyCat = a.id === 'contents' ? 'housing' : a.id === 'travel' ? 'transport' : 'vehicle';
			return [c, c];
		}
		case 'asset': // 理财买卖：钱换成了资产，不是花掉，放「其他」
		case 'visa': // 签证申请费、雅思报名费
		case 'title':
		default: return ['other', 'other'];
	}
}

/** 现在的累计数快照，作为第 i 个周期的起点 */
export const snapOf = (s: PlayerState, i: number): TallySnap => ({ i, earned: earnedOf(s.tally), out: { ...s.tally.out }, km: s.tally.km, places: placesOf(s), people: peopleOf(s) });

/** 从快照到现在的小结（n 个周期）。人数、地点数只算增加的 */
export function cardOf(s: PlayerState, snap: TallySnap, n = 1): TallyCard {
	const t = s.tally;
	let top: TallyCat | null = null, topAmt = 0, spent = 0;
	for (const k of TALLY_CATS) {
		const v = Math.max(0, (t.out[k] ?? 0) - (snap.out[k] ?? 0));
		spent += v;
		if (v > topAmt) { top = k; topAmt = v; }
	}
	return {
		i: snap.i, n, earned: Math.max(0, earnedOf(t) - snap.earned), spent, top, topAmt,
		km: Math.max(0, t.km - snap.km), places: Math.max(0, placesOf(s) - snap.places), people: Math.max(0, peopleOf(s) - snap.people),
	};
}

/** 里程碑用的计数 */
export function milestoneValue(s: PlayerState, kind: MilestoneDef['kind']): number {
	switch (kind) {
		case 'days': return arrivalDays(s);
		case 'places': return placesOf(s);
		case 'km': return s.tally.km;
		case 'earned': return earnedOf(s.tally);
		case 'people': return peopleOf(s);
		case 'job': return s.job ? 1 : 0;
		case 'home': return s.home ? 1 : 0;
		case 'property': return s.properties.length;
		case 'vehicle': return s.vehicle && s.vehicle !== 'none' ? 1 : 0;
		case 'cert': return s.certs.length;
	}
}

/** 这一刻已经满足的里程碑 */
export const reachedMilestones = (s: PlayerState) => MILESTONES.filter((m) => milestoneValue(s, m.kind) >= m.n);

/** 跨过周、年的边界：把结束的周期写成小结，换成新周期的快照。跨好几周的一步（住院、长途）合成一张，n 记跨了几个 */
export function rollPeriods(s: PlayerState) {
	const t = s.tally;
	const day = dayOf(s.clock);
	const w = weekIdx(day);
	if (w > t.wk.i) { t.lastWk = cardOf(s, t.wk, w - t.wk.i); t.wk = snapOf(s, w); }
	const y = yearIdx(day);
	if (y > t.yr.i) { t.lastYr = cardOf(s, t.yr, y - t.yr.i); t.yr = snapOf(s, y); }
}

/**
 * 一步结算后的记账（原地改 next，next 必须是这一步新建的存档）：
 * 1. 现金变化减去引擎已经分好类的部分，剩下的按 cats 记成收入或支出；
 * 2. 出行公里；3. 新达成的里程碑记下今天（旧存档第一次结算时，之前就满足的记 −1）；4. 跨周、跨年时出小结。
 */
export function finishTally(prev: PlayerState, next: PlayerState, cats: [TallyCat, TallyCat], km = 0) {
	if (!next.tally) return;
	next.tally = copyTally(next.tally);
	const t = next.tally;
	const p = prev.tally;
	const engineNet = p ? (earnedOf(t) - earnedOf(p)) - (spentOf(t) - spentOf(p)) : 0;
	const rest = Math.round(next.cash) - Math.round(prev.cash) - engineNet;
	// 上次记账之后、这一步之前在别处变了的现金：补记到「其他」（服务端交易所、别的部署上的动作；合并 main 后复核）。
	// 锚点存在 prev 的统计里（next 的统计在这一步可能已被引擎记过账），算完这一步的净额之后再补，不影响上面的分类
	const anchor = p?.cash ?? t.cash;
	if (typeof anchor === 'number') {
		const gap = Math.round(prev.cash) - anchor;
		if (gap > 0) add(t.in, 'other', gap);
		else if (gap < 0) add(t.out, 'other', -gap);
	}
	if (rest > 0) add(t.in, cats[0], rest);
	else if (rest < 0) add(t.out, cats[1], -rest);
	t.cash = Math.round(next.cash);
	if (km > 0) t.km = Math.min(TALLY_MAX, t.km + Math.round(km));
	if (t.pre) {
		for (const m of reachedMilestones(prev)) t.ms[m.id] = -1;
		t.pre = false;
	}
	const today = dayOf(next.clock);
	for (const m of reachedMilestones(next)) if (!Object.hasOwn(t.ms, m.id)) t.ms[m.id] = today;
	rollPeriods(next);
}

// ---------- 存档清洗（save-sync.md §5） ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
const catMap = (v: unknown, cap: (k: TallyCat) => number = () => TALLY_MAX) => {
	const out: Partial<Record<TallyCat, number>> = {};
	if (!isObj(v)) return out;
	for (const k of TALLY_CATS) {
		const n = int(own(v, k), 0, cap(k), 0);
		if (n > 0) out[k] = n;
	}
	return out;
};
const MS_IDS = new Set(MILESTONES.map((m) => m.id));

/** 存档里认得的计数现状，用来给旧存档建统计、给快照设上限 */
export interface TallyCtx { clock: number; places: number; people: number; cash?: number }

/**
 * 校验生涯统计：旧存档没有这个字段时从现在开始统计（pre=true，之前就满足的里程碑下次结算记成「统计前」）；
 * 不抛异常、数值钳制、里程碑只认已知 id、快照不超过现在的累计数、周期序号不超过现在。幂等。
 */
export function cleanTally(raw: unknown, ctx: TallyCtx): Tally {
	const day = Math.floor(ctx.clock / 1440);
	const fresh = () => {
		const snap = (i: number): TallySnap => ({ i, earned: 0, out: {}, km: 0, places: ctx.places, people: ctx.people });
		return { from: day, km: 0, in: {}, out: {}, ms: {}, pre: true, wk: snap(weekIdx(day)), yr: snap(yearIdx(day)), lastWk: null, lastYr: null, ...(typeof ctx.cash === 'number' ? { cash: Math.round(ctx.cash) } : {}) } satisfies Tally;
	};
	if (!isObj(raw)) return fresh();
	const inMap = catMap(own(raw, 'in'));
	const outMap = catMap(own(raw, 'out'));
	const km = int(own(raw, 'km'), 0, TALLY_MAX, 0);
	const earned = sum(inMap);
	const ms: Record<string, number> = {};
	const msRaw = own(raw, 'ms');
	if (isObj(msRaw)) for (const id of MS_IDS) { const d = own(msRaw, id); if (typeof d === 'number' && Number.isFinite(d) && d >= -1 && d <= day) ms[id] = Math.floor(d); }
	const snap = (v: unknown, cur: number): TallySnap => {
		if (!isObj(v)) return { i: cur, earned, out: { ...outMap }, km, places: ctx.places, people: ctx.people };
		return {
			i: int(own(v, 'i'), 0, cur, cur),
			earned: int(own(v, 'earned'), 0, earned, 0),
			out: catMap(own(v, 'out'), (k) => outMap[k] ?? 0),
			km: int(own(v, 'km'), 0, km, 0),
			places: int(own(v, 'places'), 0, ctx.places, 0),
			people: int(own(v, 'people'), 0, 1e6, 0),
		};
	};
	const wk = snap(own(raw, 'wk'), weekIdx(day));
	const yr = snap(own(raw, 'yr'), yearIdx(day));
	const card = (v: unknown, before: number): TallyCard | null => {
		if (!isObj(v)) return null;
		const i = int(own(v, 'i'), -1, before - 1, -1);
		if (i < 0) return null;
		const spent = int(own(v, 'spent'), 0, TALLY_MAX, 0);
		const top = own(v, 'top');
		const okTop = typeof top === 'string' && (TALLY_CATS as readonly string[]).includes(top) ? (top as TallyCat) : null;
		return {
			i, n: int(own(v, 'n'), 1, before - i, 1),
			earned: int(own(v, 'earned'), 0, TALLY_MAX, 0), spent,
			top: okTop, topAmt: okTop ? int(own(v, 'topAmt'), 0, spent, 0) : 0,
			km: int(own(v, 'km'), 0, TALLY_MAX, 0), places: int(own(v, 'places'), 0, 1e6, 0), people: int(own(v, 'people'), 0, 1e6, 0),
		};
	};
	return {
		from: int(own(raw, 'from'), 0, day, day),
		km, in: inMap, out: outMap, ms,
		pre: own(raw, 'pre') === true,
		wk, yr,
		lastWk: card(own(raw, 'lastWk'), wk.i),
		lastYr: card(own(raw, 'lastYr'), yr.i),
		// 锚点：存档里有就留（钳在现金上限内），没有就从现在的现金开始（之前的差额不补，和「从迁移日开始统计」一致）
		...(typeof own(raw, 'cash') === 'number' && Number.isFinite(own(raw, 'cash')) ? { cash: int(own(raw, 'cash'), 0, 1e9, 0) } : typeof ctx.cash === 'number' ? { cash: Math.round(ctx.cash) } : {}),
	};
}

// ---------- 给界面用的汇总 ----------

export interface CareerSummary {
	days: number;
	from: number; // 统计从第几天开始（0 = 开局就在统计）
	places: number;
	km: number;
	earned: number;
	spent: number;
	/** 支出去向，从多到少；share 是占总支出的比例 0–1 */
	outs: { cat: TallyCat; label: string; amt: number; share: number }[];
	ins: { cat: TallyCat; label: string; amt: number; share: number }[];
	people: { npc: number; players: number };
	/** 最常去的地方：地点 id 和次数，前 n 个（地点名由界面查；分享卡不用） */
	topPlaces: { id: string; n: number }[];
	/** 里程碑时间线，按日子排；day = −1 是统计上线前就达成的 */
	timeline: { id: string; title: string; day: number }[];
	week: TallyCard; // 本周至今
	year: TallyCard; // 本年至今
	lastWk: TallyCard | null;
	lastYr: TallyCard | null;
}

const share = (m: Partial<Record<TallyCat, number>>) => {
	const total = sum(m);
	return TALLY_CATS.filter((k) => (m[k] ?? 0) > 0).map((k) => ({ cat: k, label: CAT_LABEL[k], amt: m[k]!, share: total ? m[k]! / total : 0 })).sort((a, b) => b.amt - a.amt);
};

export function careerSummary(s: PlayerState, topN = 3): CareerSummary {
	const t = s.tally;
	// 还没结算过的旧存档（pre）：已经满足的里程碑先按「统计前」显示，和下次结算记下的一致
	const ms: Record<string, number> = { ...t.ms };
	if (t.pre) for (const m of reachedMilestones(s)) if (!Object.hasOwn(ms, m.id)) ms[m.id] = -1;
	const timeline = MILESTONES.filter((m) => Object.hasOwn(ms, m.id)).map((m) => ({ id: m.id, title: m.title, day: ms[m.id] }));
	timeline.sort((a, b) => a.day - b.day || MILESTONES.findIndex((m) => m.id === a.id) - MILESTONES.findIndex((m) => m.id === b.id));
	return {
		days: arrivalDays(s), from: t.from, places: placesOf(s), km: t.km, earned: earnedOf(t), spent: spentOf(t),
		outs: share(t.out), ins: share(t.in),
		people: { npc: Object.keys(s.relations).length, players: Object.keys(s.met ?? {}).length },
		topPlaces: Object.entries(s.visited).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)).slice(0, topN),
		timeline,
		week: cardOf(s, t.wk), year: cardOf(s, t.yr), lastWk: t.lastWk, lastYr: t.lastYr,
	};
}
