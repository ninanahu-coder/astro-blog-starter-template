// 排行榜与赛季（第一版，设计见 docs/earth-game/leaderboard.md）。
// 纯函数：不读时钟、不访问存储；服务端（server/world.ts）在存档落盘时调用 lbEntry / lbSeasonRec 写记录，
// 看榜时把内存里的记录交给 lbSort / lbView 排名。榜单数值全部由服务端从权威存档算出，客户端只能读。
import { netWorth } from './engine.ts';
import { dayOf } from './time.ts';
import { weekOf } from './weekly.ts';
import type { PlayerState } from './types.ts';
import { ANIMALS } from '../data/wildlife.ts';
import { FISH } from '../data/fish.ts';
import {
	LB_ANOMALY, LB_ANON, LB_CONTEST, LB_CONTEST_DAY_CAP, LB_DIMS, LB_FIRST_SEASON, LB_HOLD_DAYS, LB_SEASON_WEEKS, LB_TIERS, LB_TITLES_MAX, LB_TOP,
	type LbDim, type LbTier,
} from '../data/leaderboard.ts';

export type { LbDim, LbTier };
export type LbScope = 'season' | 'all';
export type LbBoard = 'global' | 'region' | 'friends';
/** 从存档算出来的四项（比赛积分不在存档里，单独记在赛季记录里） */
export type LbStatKey = 'worth' | 'places' | 'dex' | 'respect';
const STAT_KEYS: LbStatKey[] = ['worth', 'places', 'dex', 'respect'];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface LbStats {
	worth: number; // 净资产（取整）
	places: number; // 真实定位打卡过的地点数
	dex: number; // 图鉴完成度，千分比 0–1000
	respect: number; // 声望（取整）
}

// ---------- 从存档算榜单数值 ----------

const ANIMAL_IDS = new Set(ANIMALS.map((a) => a.id));
const FISH_IDS = new Set(FISH.map((f) => f.id));
/** 图鉴完成度（千分比）：见过的动物 + 钓到过的鱼种，按现在的图鉴总数算；只认图鉴里有的 id */
export function dexPermille(state: PlayerState): number {
	const total = ANIMAL_IDS.size + FISH_IDS.size;
	if (!total) return 0;
	const animals = new Set((state.dex ?? []).filter((id) => ANIMAL_IDS.has(id))).size;
	const fish = Object.entries(state.fish ?? {}).filter(([id, n]) => FISH_IDS.has(id) && n > 0).length;
	return Math.min(1000, Math.round(((animals + fish) * 1000) / total));
}

export function lbStats(state: PlayerState): LbStats {
	return {
		worth: Math.round(netWorth(state)),
		places: new Set(state.checkins ?? []).size,
		dex: dexPermille(state),
		respect: Math.max(0, Math.round(state.respect)),
	};
}

// ---------- 榜单记录（服务端 rank:<h>） ----------

export interface LbHold {
	at: number; // 挂起时间（毫秒，服务端时间）
	until: number; // 自动解除时间
	why: string; // 触发了哪条规则（只给复核的人看，不发给客户端）
}

/**
 * 每名玩家一条，键 rank:<id 哈希前 12 位>。是旧的净资产榜记录（core/board.ts 的 BoardEntry）的超集：
 * name、avatar、worth、day、at 的含义不变，旧代码照样能读。旧代码落盘时会丢掉多出来的字段，新代码下次落盘时从存档重新算。
 */
export interface LbEntry {
	name: string;
	avatar: string;
	worth: number;
	day: number;
	at: number; // 净资产达到当前值的时间（旧榜单的「同分先达到的在前」）
	stats: LbStats;
	ats: Record<LbStatKey, number>; // 每一项达到当前值的时间
	rev: number; // 存档版本号：两次落盘之间做了几个动作
	win: { at: number; worth: number }; // 一小时窗口的起点：净资产涨速检查用
	hold: LbHold | null;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const int = (x: unknown, d = 0) => (finite(x) ? Math.round(x) : d);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanStats(v: unknown, worth: number): LbStats {
	const s = isObj(v) ? v : {};
	return {
		worth,
		places: Math.max(0, int(s.places)),
		dex: Math.min(1000, Math.max(0, int(s.dex))),
		respect: Math.max(0, int(s.respect)),
	};
}

/** 存储里读出来的记录不可全信（旧版本、损坏、旧代码写的）：缺的字段补默认，必需字段不对整条丢掉 */
export function cleanLbEntry(v: unknown): LbEntry | null {
	if (!isObj(v)) return null;
	const e = v;
	if (typeof e.name !== 'string' || typeof e.avatar !== 'string' || !finite(e.worth) || !finite(e.day) || !finite(e.at)) return null;
	const worth = Math.round(e.worth);
	const at = e.at;
	const ats0 = isObj(e.ats) ? e.ats : {};
	const ats = Object.fromEntries(STAT_KEYS.map((k) => [k, finite(ats0[k]) ? ats0[k] : at])) as Record<LbStatKey, number>;
	ats.worth = at;
	const w = isObj(e.win) && finite(e.win.at) && finite(e.win.worth) ? { at: e.win.at, worth: Math.round(e.win.worth) } : { at, worth };
	const h = isObj(e.hold) && finite(e.hold.at) && finite(e.hold.until) ? { at: e.hold.at, until: e.hold.until, why: String(e.hold.why ?? '').slice(0, 80) } : null;
	return {
		name: e.name.slice(0, 24),
		avatar: e.avatar.slice(0, 8),
		worth,
		day: Math.max(0, Math.floor(e.day)),
		at,
		stats: cleanStats(e.stats, worth),
		ats,
		rev: Math.max(-1, int(e.rev, -1)), // -1：旧记录不知道版本号
		win: w,
		hold: h,
	};
}

/**
 * 异常值检查：这次落盘比上一条记录涨得太多就返回原因（挂起复核），正常返回 null。
 * 只看涨：卖房、被罚、晕倒导致的下跌不算异常。上一条记录没有版本号（旧代码写的）时只做绝对值检查。
 */
export function lbAnomaly(prev: LbEntry | null, next: LbStats, rev: number, now: number, limits = LB_ANOMALY, caps = { places: Infinity }): string | null {
	if (next.places > caps.places) return `打卡地点数 ${next.places} 超过地点总数 ${caps.places}`;
	if (!prev) return null;
	const n = prev.rev >= 0 && rev > prev.rev ? rev - prev.rev : 0;
	if (n > 0) {
		const up = (k: LbStatKey) => next[k] - prev.stats[k];
		if (up('worth') > limits.worthPerRev * n) return `净资产 ${n} 个动作涨了 ${up('worth')}`;
		if (up('places') > limits.placesPerRev * n) return `打卡 ${n} 个动作多了 ${up('places')} 个`;
		if (up('dex') > limits.dexPerRev * n) return `图鉴 ${n} 个动作涨了 ${up('dex')}‰`;
		if (up('respect') > limits.respectPerRev * n) return `声望 ${n} 个动作涨了 ${up('respect')}`;
	}
	const base = now - prev.win.at <= HOUR_MS ? prev.win.worth : prev.stats.worth;
	if (next.worth - base > limits.worthPerHour) return `净资产一小时内涨了 ${next.worth - base}`;
	return null;
}

/** 挂起是否还生效 */
export const lbHeld = (e: LbEntry | null | undefined, now: number) => !!e?.hold && e.hold.until > now;

/**
 * 这次落盘后的榜单记录。prev 是上一条（存储里读出来的，不可信）。
 * 每一项数值没变时沿用上一条的达到时间（同分先达到的在前）；触发异常就挂起 LB_HOLD_DAYS 天，期间再触发就从那次重新算。
 */
export function lbEntry(state: PlayerState, now: number, prev?: unknown, caps?: { places: number }): LbEntry {
	const stats = lbStats(state);
	const old = cleanLbEntry(prev);
	const ats = Object.fromEntries(STAT_KEYS.map((k) => [k, old && old.stats[k] === stats[k] && old.ats[k] <= now ? old.ats[k] : now])) as Record<LbStatKey, number>;
	const why = lbAnomaly(old, stats, state.rev, now, LB_ANOMALY, caps);
	const hold = why ? { at: now, until: now + LB_HOLD_DAYS * DAY_MS, why } : old && lbHeld(old, now) ? old.hold : null;
	const win = old && now - old.win.at <= HOUR_MS && old.win.at <= now ? old.win : { at: now, worth: old ? Math.min(old.stats.worth, stats.worth) : stats.worth };
	return { name: state.name, avatar: state.avatar, worth: stats.worth, day: dayOf(state.clock), at: ats.worth, stats, ats, rev: state.rev, win, hold };
}

// ---------- 上榜同意（服务端 lbp:<h>） ----------

export interface LbPref {
	on: boolean; // 同意上榜。默认不上榜
	anon: boolean; // 匿名：榜上只显示「匿名旅人」
	region: boolean; // 参加地区榜
	friends: boolean; // 出现在好友榜
	at: number; // 最近一次修改的时间
}
export const LB_PREF_DEFAULT: LbPref = { on: false, anon: false, region: true, friends: true, at: 0 };

export function cleanPref(v: unknown): LbPref {
	if (!isObj(v)) return { ...LB_PREF_DEFAULT };
	const b = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
	return { on: b(v.on, false), anon: b(v.anon, false), region: b(v.region, true), friends: b(v.friends, true), at: finite(v.at) ? v.at : 0 };
}

/** 客户端发来的修改：只认这四个布尔开关，别的字段一概不收 */
export function patchPref(prev: unknown, patch: unknown, now: number): LbPref | null {
	if (!isObj(patch)) return null;
	const next = cleanPref(prev);
	let touched = false;
	for (const k of ['on', 'anon', 'region', 'friends'] as const) {
		if (k in patch) {
			if (typeof patch[k] !== 'boolean') return null;
			next[k] = patch[k] as boolean;
			touched = true;
		}
	}
	return touched ? { ...next, at: now } : null;
}

// ---------- 赛季 ----------

/** 现实日（珀斯时间）属于第几个赛季（内部序号） */
export const seasonOfDay = (realDay: number) => Math.floor(weekOf(realDay) / LB_SEASON_WEEKS);
/** 赛季第一天的现实日序号 */
export const seasonStartDay = (sid: number) => sid * LB_SEASON_WEEKS * 7;
/** 这个赛季还剩几天（含今天） */
export const seasonDaysLeft = (realDay: number) => seasonStartDay(seasonOfDay(realDay) + 1) - realDay;
/** 给玩家看的赛季编号：S1、S2…… */
export const seasonLabel = (sid: number) => `S${sid - LB_FIRST_SEASON + 1}`;

/** 一名玩家在一个赛季里的记录，键 lbs:<赛季>:<h> */
export interface LbSeason {
	base: LbStats; // 本赛季第一次落盘前的数值
	last: LbStats; // 本赛季最近一次落盘的数值（赛季结束后就是期末值）
	contest: number; // 本赛季比赛积分
	cday: number; // 比赛积分按现实日封顶：最近记分的现实日
	cn: number; // 那一天已经记了几分
	region: string; // 本赛季登记的地区（第一次落盘时所在区域，整个赛季不变）
	at: number; // 第一次落盘的时间
}

export function cleanSeason(v: unknown): LbSeason | null {
	if (!isObj(v) || !isObj(v.base) || !isObj(v.last)) return null;
	const st = (x: Record<string, unknown>): LbStats => ({ ...cleanStats(x, int(x.worth)) });
	return {
		base: st(v.base),
		last: st(v.last),
		contest: Math.max(0, int(v.contest)),
		cday: int(v.cday),
		cn: Math.max(0, int(v.cn)),
		region: typeof v.region === 'string' ? v.region.slice(0, 16) : '',
		at: finite(v.at) ? v.at : 0,
	};
}

/** 一个共同事件结算后给每个成员记几分比赛积分（不是比赛的返回 0） */
export function contestPoints(coopId: string, success: boolean): number {
	const c = Object.prototype.hasOwnProperty.call(LB_CONTEST, coopId) ? LB_CONTEST[coopId] : undefined;
	return c ? (success ? c.ok : c.fail) : 0;
}

/**
 * 这次落盘后的赛季记录。prev 是这一季已有的记录（没有就新建：起点取上一条榜单记录的数值，
 * 赛季开始后的第一个动作也算进本赛季）。contest 是这次要加的比赛积分，按现实日封顶。
 */
export function lbSeasonRec(prev: unknown, opts: { stats: LbStats; before: LbStats | null; region: string; now: number; realDay: number; contest?: number }): LbSeason {
	const old = cleanSeason(prev);
	const rec: LbSeason = old ?? { base: opts.before ?? opts.stats, last: opts.stats, contest: 0, cday: opts.realDay, cn: 0, region: opts.region, at: opts.now };
	const add = Math.max(0, Math.floor(opts.contest ?? 0));
	let { contest, cday, cn } = rec;
	if (add > 0) {
		if (opts.realDay > cday) { cday = opts.realDay; cn = 0; }
		const room = Math.max(0, LB_CONTEST_DAY_CAP - cn);
		const got = Math.min(add, room);
		contest += got;
		cn += got;
	}
	return { ...rec, last: opts.stats, contest, cday, cn };
}

// ---------- 赛季称号（服务端 lbt:<h>） ----------

export interface LbTitle {
	s: number; // 赛季序号
	dim: LbDim;
	tier: LbTier;
	rank: number;
}

export function cleanTitles(v: unknown): LbTitle[] {
	if (!Array.isArray(v)) return [];
	const dims = new Set(LB_DIMS.map((d) => d.id));
	const tiers = new Set(LB_TIERS.map((t) => t.tier));
	const out: LbTitle[] = [];
	for (const t of v) {
		if (!isObj(t) || !finite(t.s) || !dims.has(t.dim as LbDim) || !tiers.has(t.tier as LbTier) || !finite(t.rank)) continue;
		if (out.some((x) => x.s === t.s && x.dim === t.dim)) continue;
		out.push({ s: Math.round(t.s), dim: t.dim as LbDim, tier: t.tier as LbTier, rank: Math.max(1, Math.round(t.rank)) });
	}
	return out.slice(-LB_TITLES_MAX);
}

/** 加称号：同一赛季同一维度只有一条（结算重跑不会重复发），最多保留 LB_TITLES_MAX 条 */
export function addTitles(prev: unknown, add: LbTitle[]): LbTitle[] {
	const list = cleanTitles(prev);
	for (const t of add) if (!list.some((x) => x.s === t.s && x.dim === t.dim)) list.push(t);
	return list.sort((a, b) => a.s - b.s).slice(-LB_TITLES_MAX);
}

export const tierOfRank = (rank: number): LbTier | null => LB_TIERS.find((t) => rank <= t.upTo)?.tier ?? null;

/** 称号文字：「S1 身家榜冠军」 */
export function titleText(t: LbTitle): string {
	const dim = LB_DIMS.find((d) => d.id === t.dim)!;
	const tier = LB_TIERS.find((x) => x.tier === t.tier)!;
	return `${seasonLabel(t.s)} ${dim.name}榜${tier.label}`;
}

/** 榜单上名字旁边的徽章：最近一个赛季拿到的最好档位 */
export function badgeOf(titles: LbTitle[]): string {
	if (!titles.length) return '';
	const last = Math.max(...titles.map((t) => t.s));
	const order = LB_TIERS.map((t) => t.tier);
	const best = titles.filter((t) => t.s === last).sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))[0];
	return LB_TIERS.find((t) => t.tier === best.tier)!.badge;
}

// ---------- 排名 ----------

/** 服务端内存里一名玩家的全部榜单信息 */
export interface LbItem {
	h: string; // id 哈希前 12 位
	entry: LbEntry | null;
	pref: LbPref;
	season: LbSeason | null; // 当前赛季的记录（这一季还没落过盘为 null）
	titles: LbTitle[];
}

export interface LbQuery {
	dim: LbDim;
	scope: LbScope;
	board: LbBoard;
}

/** 客户端发来的查询：不认识的值回到默认（全服、总榜、身家），和旧版「净资产排行」完全一样 */
export function parseQuery(v: unknown): LbQuery {
	const o = isObj(v) ? v : {};
	const dim = LB_DIMS.find((d) => d.id === o.dim)?.id ?? 'worth';
	let scope: LbScope = o.scope === 'season' ? 'season' : 'all';
	if (!LB_DIMS.find((d) => d.id === dim)!.allTime) scope = 'season';
	const board: LbBoard = o.board === 'region' || o.board === 'friends' ? o.board : 'global';
	return { dim, scope, board };
}

/** 这个人在这个维度、这个范围的分数；没有（没上过这一季、旧记录）返回 null */
export function lbScore(it: LbItem, dim: LbDim, scope: LbScope): number | null {
	if (scope === 'season' || dim === 'contest') {
		const s = it.season;
		if (!s) return null;
		return dim === 'contest' ? s.contest : s.last[dim] - s.base[dim];
	}
	return it.entry ? it.entry.stats[dim] : null;
}

/** 同分时比谁先达到：总榜用这一项的达到时间；赛季榜同样用（达到当前总值的时间就是赛季分数定下来的时间） */
function reachedAt(it: LbItem, dim: LbDim): number {
	if (dim === 'contest') return it.season?.at ?? Infinity;
	return it.entry?.ats[dim] ?? Infinity;
}

/** 能不能出现在公开榜上：同意上榜、没在复核、有记录 */
export function lbPublic(it: LbItem, now: number): boolean {
	return it.pref.on && !!it.entry && !lbHeld(it.entry, now);
}

export interface LbRanked {
	h: string;
	score: number;
	at: number;
}

/**
 * 排名（全服或地区）：分数高的在前，同分先达到的在前，再同按哈希排保证稳定。
 * 赛季榜只排本赛季分数大于 0 的人；地区榜只排本赛季登记在这个地区、没关掉地区榜的人。
 */
export function lbSort(items: Iterable<LbItem>, q: { dim: LbDim; scope: LbScope; region?: string; only?: Set<string> }, now: number): LbRanked[] {
	const out: LbRanked[] = [];
	for (const it of items) {
		if (!lbPublic(it, now)) continue;
		if (q.region !== undefined && (!it.pref.region || it.season?.region !== q.region)) continue;
		if (q.only && (!q.only.has(it.h) || !it.pref.friends)) continue;
		const score = lbScore(it, q.dim, q.scope);
		if (score === null) continue;
		if ((q.scope === 'season' || q.dim === 'contest') && score <= 0) continue;
		out.push({ h: it.h, score, at: reachedAt(it, q.dim) });
	}
	return out.sort((a, b) => b.score - a.score || a.at - b.at || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
}

export interface LbRow {
	rank: number;
	name: string;
	avatar: string;
	score: number;
	day: number;
	me: boolean;
	badge: string;
	worth?: number; // 身家榜多带一份，兼容旧页面
}

export interface LbMine {
	/** on：在榜上；off：没同意上榜；hold：复核中；none：这一季还没有成绩 */
	status: 'on' | 'off' | 'hold' | 'none';
	score: number | null;
}

/** 把排名结果变成发给客户端的样子：只有展示字段，匿名的人换成「匿名旅人」，不含哈希、地区、坐标 */
export function lbView(ranked: LbRanked[], get: (h: string) => LbItem | undefined, meH: string, q: LbQuery, now: number, top = LB_TOP): { top: LbRow[]; me: LbRow | null; total: number; mine: LbMine } {
	// 排名结果可能是缓存的（最多 LB_CACHE_MS）：刚退出、被挂起、删了号的人在这里再滤一次，不等缓存过期
	ranked = ranked.filter((r) => { const it = get(r.h); return !!it && lbPublic(it, now); });
	const row = (r: LbRanked, i: number): LbRow => {
		const it = get(r.h)!;
		const anon = it.pref.anon;
		const out: LbRow = {
			rank: i + 1,
			name: anon ? LB_ANON.name : it.entry!.name,
			avatar: anon ? LB_ANON.avatar : it.entry!.avatar,
			score: r.score,
			day: it.entry!.day,
			me: r.h === meH,
			badge: badgeOf(it.titles),
		};
		if (q.dim === 'worth') out.worth = r.score;
		return out;
	};
	const i = ranked.findIndex((r) => r.h === meH);
	const it = get(meH);
	const score = it ? lbScore(it, q.dim, q.scope) : null;
	const status: LbMine['status'] = !it || !it.pref.on ? 'off' : lbHeld(it.entry, now) ? 'hold' : i >= 0 ? 'on' : 'none';
	return { top: ranked.slice(0, top).map(row), me: i >= 0 ? row(ranked[i], i) : null, total: ranked.length, mine: { status, score } };
}

/**
 * 赛季结算：按全服赛季榜给前 100 名发称号（只发称号和徽章）。
 * items 里的 season 必须是要结算的那一季的记录；结算时还在复核期、或这一季里被挂起过的人不发（记进复核名单）。
 */
export function lbAwards(items: LbItem[], sid: number, seasonEndMs: number, seasonStartMs: number): { awards: Map<string, LbTitle[]>; withheld: { h: string; dim: LbDim; rank: number }[] } {
	const awards = new Map<string, LbTitle[]>();
	const withheld: { h: string; dim: LbDim; rank: number }[] = [];
	const lastTier = LB_TIERS[LB_TIERS.length - 1].upTo;
	for (const d of LB_DIMS) {
		// 结算看的是「这一季里有没有被挂起过」，用赛季结束时刻判断公开与否：结算晚几天跑也是同一个结果
		const tainted = (it: LbItem) => !!it.entry?.hold && it.entry.hold.at < seasonEndMs && it.entry.hold.until > seasonStartMs;
		const ranked = lbSort(items.map((it) => (it.entry?.hold && !tainted(it) ? { ...it, entry: { ...it.entry, hold: null } } : it)), { dim: d.id, scope: 'season' }, seasonEndMs);
		// 被挂起的人排在 lbSort 之外：单独找出他们本来的名次，记进复核名单
		const held = lbSort(items.filter(tainted).map((it) => ({ ...it, entry: { ...it.entry!, hold: null } })), { dim: d.id, scope: 'season' }, seasonEndMs);
		for (const x of held) {
			const rank = ranked.filter((r) => r.score > x.score || (r.score === x.score && r.at < x.at)).length + 1;
			if (rank <= lastTier) withheld.push({ h: x.h, dim: d.id, rank });
		}
		ranked.slice(0, lastTier).forEach((r, i) => {
			const tier = tierOfRank(i + 1);
			if (!tier) return;
			const list = awards.get(r.h) ?? [];
			list.push({ s: sid, dim: d.id, tier, rank: i + 1 });
			awards.set(r.h, list);
		});
	}
	return { awards, withheld };
}
