// 租房市场的纯函数（rental 批次）：申请成功率、租约、涨租、维修、退房押金结算、骗租广告。
// 不引用 engine.ts（engine 引用这里）；随机数用 weather.ts 的 unit()，种子来自存档 seed，确定性。
// 规则和数值说明见 docs/earth-game/rental.md。
import type { HomeDef, Lease, PlayerState, RentalState } from './types.ts';
import { BOND_WEEKS, HOMES } from '../data/housing.ts';
import { BOND_LAW, FAULTS, MARKET, ODDS, RENTAL, SCAM_KINDS } from '../data/rental.ts';
import { unit } from './weather.ts';
import { rentOn } from './world.ts';

export const emptyRental = (): RentalState => ({ lease: null, refs: 0, marks: 0, viewed: null, rejected: null, claim: null, scam: -1 });

/** 这种房型签不签租约：房车营地不是住宅租约，照旧直接租 */
export const needsLease = (home: HomeDef) => !home.vehicleSleep;

/** 真实规则：这个区域、这个周租下押金最多几周（BOND_LAW）。未知区域按最严的 4 周 */
export function bondCapWeeks(rentWeek: number, area: string): number {
	const law = BOND_LAW[area];
	if (!law) return 4;
	return rentWeek > law.above ? law.weeksAbove : law.weeks;
}

// ---------- 找房 ----------

/** 看房时来了几组人（含竞争者）：按区域市场表、地点、房型、日子从种子取 */
export function applicantsFor(seed: number, area: string, loc: string, home: string, day: number): number {
	const [lo, hi] = (MARKET[area] ?? MARKET.wa).applicants;
	return lo + Math.floor(unit(`crowd|${seed}|${loc}|${home}|${day}`) * (hi - lo + 1));
}

export interface OddsInput {
	rent: number; // 周租
	income: number; // 估算周收入，0 = 没工作
	cash: number;
	refs: number;
	marks: number;
	applicants: number;
}

/** 申请成功率（0.05–0.95），权重见 data/rental.ts ODDS */
export function applyOdds(o: OddsInput): number {
	let p: number = ODDS.base;
	if (o.income <= 0) p += ODDS.noJob;
	else {
		const share = o.rent / o.income;
		p += share <= ODDS.low ? ODDS.lowBonus : share <= ODDS.high ? ODDS.midBonus : ODDS.highPenalty;
	}
	if (o.cash >= o.rent * ODDS.savingsWeeks) p += ODDS.savingsBonus;
	p += Math.min(ODDS.refMax, Math.max(0, o.refs) * ODDS.refEach);
	p += Math.max(0, o.marks) * ODDS.markEach;
	p += Math.max(0, o.applicants - ODDS.crowdFree) * ODDS.crowdEach;
	return Math.min(ODDS.max, Math.max(ODDS.min, p));
}

/** 给玩家看的档位（不显示百分比） */
export const oddsLabel = (p: number) => (p >= 0.75 ? '希望很大' : p >= 0.55 ? '有希望' : p >= 0.35 ? '一般' : '悬');

/** 被拒时说出主要原因 */
export function rejectReason(o: OddsInput): string {
	if (o.marks > 0) return '中介查到你以前被收过房';
	if (o.income <= 0) return '你还没有工作，中介担心交不起房租';
	if (o.rent / o.income > ODDS.high) return '房租占你收入太高了';
	if (o.applicants > ODDS.crowdFree) return `这次有 ${o.applicants} 组人抢这套房`;
	return '房东选了别的申请人';
}

/** 看房记录还有效、是这套房 */
export const viewedOk = (r: RentalState, loc: string, home: string, day: number) =>
	!!r.viewed && r.viewed.loc === loc && r.viewed.home === home && day - r.viewed.day >= 0 && day - r.viewed.day < RENTAL.viewDays;

/** 今天在这里被这套房拒过 */
export const rejectedToday = (r: RentalState, loc: string, home: string, day: number) =>
	!!r.rejected && r.rejected.loc === loc && r.rejected.day === day && r.rejected.homes.includes(home);

// ---------- 租约 ----------

/** 新租约：原有损坏按种子定 */
export function startLease(seed: number, home: HomeDef, loc: string, day: number, term: 'fixed' | 'periodic'): Lease {
	return {
		home: home.id, loc, start: day, end: term === 'fixed' ? day + RENTAL.fixedDays : 0,
		rent: rentOn(home.rentWeek, day), lastRise: day, rise: null, report: 0, // 签约那天的行情价（世界事件的租金指数，合并 main 后）
		prior: Math.floor(unit(`prior|${seed}|${loc}|${home.id}|${day}`) * (RENTAL.priorMax + 1)),
		wear: 0, fault: null,
	};
}

/**
 * 这周要交的房租：有租约按租约（签约时的行情价，之后只按租约规则涨）；没有（营地、旧数据）按租金指数（世界事件，合并 main 后）。
 * day：按哪天的行情算，周结算传正在结算的那个结算日
 */
export function rentDue(state: PlayerState, def: HomeDef, day = Math.floor(state.clock / 1440)): number {
	const l = state.rental.lease;
	// 已通知的涨租在那天之前生效：按新房租（每周开销、住处卡和结算扣的一致；合并 main 后复核）
	return l && state.home && l.home === state.home.type && l.loc === state.home.loc ? (l.rise && day >= l.rise.at ? l.rise.to : l.rent) : rentOn(def.rentWeek, day);
}

/** 还在固定期内 */
export const inFixedTerm = (l: Lease | null, day: number) => !!l && l.end > 0 && day < l.end;

/** 固定期内提前走的违约金（游戏设定） */
export const breakFee = (state: PlayerState, day: number) => {
	const l = state.rental.lease;
	return inFixedTerm(l, day) ? Math.round(l!.rent * RENTAL.breakWeeks) : 0;
};

/** 能不能续约：周期租约，或固定期最后 renewWindow 天 */
export function renewBlocked(state: PlayerState, day: number): string | undefined {
	const l = state.rental.lease;
	if (!l) return '你没有租约';
	if (l.end > 0 && l.end - day > RENTAL.renewWindow) return `固定期还有 ${l.end - day} 天，最后 ${RENTAL.renewWindow} 天才能续约`;
	return undefined;
}

/**
 * 续约：从今天和原到期日中较晚的那天起，再签一个固定期。
 * 新期开始时距上次涨租满一年（西澳 WA2：续约也要满 12 个月），房东在新合同里按涨幅加租，从新期第一天起算（合同写明，不另发通知）；
 * 不满一年房租不变。已经收到涨租通知的，照通知生效。返回新合同的房租。
 */
export function renew(l: Lease, day: number): number {
	const from = Math.max(day, l.end);
	l.end = from + RENTAL.fixedDays;
	if (!l.rise && from >= l.lastRise + RENTAL.riseEveryDays) l.rise = { at: from, to: Math.round(l.rent * (1 + RENTAL.risePct)) };
	return l.rise && l.rise.at <= from ? l.rise.to : l.rent;
}

/** 紧急故障没修好时，住处舒适度要减的量 */
export const faultComfort = (state: PlayerState) => (state.rental?.lease?.fault?.urgent ? RENTAL.urgentComfort : 0);

/**
 * 每次时间推进时检查的日期类变化（不掷随机数）：报告过期、报修后修好、涨租生效、固定期到期转周期。返回要写进日志的话。
 */
export function rentalTick(state: PlayerState, day: number): string[] {
	const l = state.rental.lease;
	const out: string[] = [];
	if (!l) return out;
	if (l.report === 0 && day - l.start >= RENTAL.reportDays) {
		l.report = -1;
		out.push('入住检查报告过了交回期限，没交上。退房时房子原有的损坏可能算到你头上。');
	}
	if (l.fault && l.fault.asked >= 0 && day - l.fault.asked >= (l.fault.urgent ? RENTAL.urgentFixDays : RENTAL.minorFixDays)) {
		out.push(`房东派人修好了：${l.fault.name}。`);
		l.fault = null;
	}
	if (l.rise && day >= l.rise.at) {
		out.push(`新房租生效：每周 $${l.rent} → $${l.rise.to}。`);
		l.rent = l.rise.to;
		l.lastRise = l.rise.at;
		l.rise = null;
	}
	if (l.end > 0 && day >= l.end) {
		l.end = 0;
		out.push('固定期租约到期，自动转为周期租约。');
	}
	return out;
}

/** 涨租通知最早哪天能发：保证生效日不早于「上次涨租 + 一年」，通知期不短于 noticeDays；固定期内不涨，生效日也不早于到期日 */
export function riseNoticeFrom(l: Lease): number {
	const effective = Math.max(l.lastRise + RENTAL.riseEveryDays, l.end);
	return effective - RENTAL.noticeDays;
}

/** 每周结算里的租约部分（掷种子随机数）：损坏增长、新故障、涨租通知。返回日志 */
export function rentalWeek(state: PlayerState, day: number): string[] {
	const l = state.rental.lease;
	const out: string[] = [];
	if (!l) return out;
	const key = `${state.seed}|${l.loc}|${l.home}|${day}`;
	l.wear = Math.min(100, l.wear + RENTAL.wearWeek + (l.fault && l.fault.asked < 0 ? RENTAL.wearUnreported : 0));
	if (!l.fault && unit(`fault|${key}`) < RENTAL.faultChance) {
		const urgent = unit(`urgent|${key}`) < RENTAL.urgentShare;
		const list = urgent ? FAULTS.urgent : FAULTS.minor;
		const name = list[Math.floor(unit(`fname|${key}`) * list.length)];
		l.fault = { urgent, name, since: day, asked: -1 };
		out.push(`住处${urgent ? '出了紧急状况' : '有东西坏了'}：${name}。记得报修，不报房东不会来修。`);
	}
	if (!l.rise && l.end === 0 && day >= riseNoticeFrom(l) && unit(`rise|${key}`) < RENTAL.riseChance) {
		const at = Math.max(day + RENTAL.noticeDays, l.lastRise + RENTAL.riseEveryDays);
		const to = Math.round(l.rent * (1 + RENTAL.risePct));
		l.rise = { at, to };
		out.push(`收到涨租通知：${at - day} 天后每周房租 $${l.rent} → $${to}。一年最多涨一次，至少提前通知。`);
	}
	return out;
}

// ---------- 退房与押金 ----------

/** 房东按损坏申请扣的押金：租住损坏 + 没有检查报告佐证的原有损坏 */
export function damageClaim(l: Lease | null, bondLeft: number): { amount: number; prior: number } {
	if (!l || bondLeft <= 0) return { amount: 0, prior: 0 };
	const amount = Math.min(bondLeft, Math.round((bondLeft * Math.min(100, l.wear + l.prior)) / 100));
	const priorPart = Math.min(amount, Math.round((bondLeft * l.prior) / 100));
	return { amount, prior: priorPart };
}

/**
 * 退房时结算租约：bondLeft 是扣完欠租、违约金后还剩的押金。
 * 房东申请扣的部分（damageClaim）留在托管机构等玩家处理；返回留下的金额和日志。
 * 已有一笔没处理的扣款时，旧的按接受处理。
 */
export function endLease(state: PlayerState, day: number, bondLeft: number, evicted: boolean): { held: number; notes: string[] } {
	const r = state.rental;
	const l = r.lease;
	const notes: string[] = [];
	if (!l) return { held: 0, notes };
	if (evicted) r.marks = Math.min(RENTAL.recordMax, r.marks + 1);
	else if (day - l.start >= RENTAL.cleanDays) r.refs = Math.min(RENTAL.recordMax, r.refs + 1);
	const c = damageClaim(l, bondLeft);
	if (c.amount > 0) {
		if (r.claim) notes.push(`上一笔 $${r.claim.amount} 押金扣款没处理，按接受算。`);
		// 申诉能要回的只有原有损坏那部分，而且要有入住检查报告作证
		r.claim = { amount: c.amount, prior: l.report === 1 ? c.prior : 0, day };
		notes.push(`房东申请从押金里扣 $${c.amount} 修损坏，这部分先留在托管机构，等你接受或申诉。`);
	}
	r.lease = null;
	return { held: c.amount, notes };
}

/** 租约是不是对得上现在的住处（租的、同房型、同地点） */
export const leaseMatches = (state: PlayerState) => {
	const l = state.rental.lease;
	return !!l && !!state.home && !state.home.owned && l.home === state.home.type && l.loc === state.home.loc;
};

/**
 * 现在搬走，押金怎么分（判断换房钱够不够、实际退房结算共用）。arrears 是先扣的欠租。
 * 违约金先从押金扣，不够的从现金扣（extra）；剩下的押金里，房东按损坏申请扣的 held 留在托管机构，其余 refund 马上退。
 */
export function moveOutSplit(state: PlayerState, day: number, arrears = 0, evicted = false): { fee: number; extra: number; held: number; refund: number } {
	const bond0 = state.home && !state.home.owned ? (state.home.bond ?? 0) : 0;
	const afterRent = Math.max(0, bond0 - arrears);
	const fee = evicted || !leaseMatches(state) ? 0 : breakFee(state, day);
	const left = Math.max(0, afterRent - fee);
	const held = leaseMatches(state) ? damageClaim(state.rental.lease, left).amount : 0;
	return { fee, extra: Math.max(0, fee - afterRent), held, refund: left - held };
}

/** 处理押金扣款：接受全归房东，申诉要回 claim.prior（只有交过入住检查报告时不为 0） */
export const claimOutcome = (claim: { prior: number }, dispute: boolean) => (dispute ? claim.prior : 0);

// ---------- 骗租 ----------

export interface ScamAd {
	home: HomeDef;
	rent: number; // 广告上的周租
	ask: number; // 要你先转的钱：押金 + 几周房租
}

/** 今天这个地点有没有骗租广告：按地点、日期定（所有人看到的一样），只在有房源的城镇类地点 */
export function scamAd(loc: { id: string; kind: string }, day: number, homesHere: HomeDef[]): ScamAd | undefined {
	if (!(SCAM_KINDS as readonly string[]).includes(loc.kind)) return undefined;
	const pool = homesHere.filter(needsLease);
	if (!pool.length || unit(`scam|${loc.id}|${day}`) >= RENTAL.scamChance) return undefined;
	const home = pool[Math.floor(unit(`scamhome|${loc.id}|${day}`) * pool.length)];
	const rent = Math.round(home.rentWeek * RENTAL.scamRentShare);
	return { home, rent, ask: rent * (BOND_WEEKS + RENTAL.scamWeeks) };
}

/** 存档里房型 id 是否已知（cleanRental 用） */
export const knownHome = (id: unknown): id is string => typeof id === 'string' && HOMES.some((h) => h.id === id);

// ---------- 存档清洗（save-sync.md §5） ----------

const own = (o: unknown, k: string): unknown => (o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);
const isObj = (o: unknown) => !!o && typeof o === 'object' && !Array.isArray(o);
/** 有限数取整并钳到 [lo, hi]；不是有限数给 dflt */
const int = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt);
const idOk = (v: unknown, known?: Set<string>): v is string => typeof v === 'string' && v.length <= 64 && (!known || known.has(v));
const FAULT_NAMES = new Set<string>([...FAULTS.urgent, ...FAULTS.minor]);

/** 旧存档在租房、没有租约：补一个周期租约，房租按当天行情（租金指数），报告算已交（不追溯惩罚） */
const legacyLease = (def: HomeDef, loc: string, today: number): Lease => ({
	home: def.id, loc, start: today, end: 0, rent: rentOn(def.rentWeek, today), lastRise: today, rise: null, report: 1, prior: 0, wear: 0, fault: null,
});

function cleanLease(raw: unknown, home: { type: string; loc: string; owned?: string } | null, today: number): Lease | null {
	const def = home && !home.owned ? HOMES.find((h) => h.id === home.type) : undefined;
	if (!home || !def || !needsLease(def)) return null;
	if (!isObj(raw) || own(raw, 'home') !== home.type || own(raw, 'loc') !== home.loc) return legacyLease(def, home.loc, today);
	const start = int(own(raw, 'start'), 0, today, today);
	const endRaw = int(own(raw, 'end'), 0, today + RENTAL.fixedDays + RENTAL.renewWindow, 0);
	const rent = int(own(raw, 'rent'), Math.round(def.rentWeek * 0.5), def.rentWeek * 3, def.rentWeek);
	const lastRise = int(own(raw, 'lastRise'), start, today, start);
	const r = own(raw, 'rise');
	const at = int(own(r, 'at'), today, today + RENTAL.riseEveryDays, -1);
	const to = int(own(r, 'to'), 0, rent * 2, -1);
	const f = own(raw, 'fault');
	const name = own(f, 'name');
	const since = int(own(f, 'since'), 0, today, -1);
	const report = own(raw, 'report');
	return {
		home: def.id, loc: home.loc, start, end: endRaw > start ? endRaw : 0, rent, lastRise,
		rise: at >= 0 && to > rent ? { at, to } : null, // 不涨的通知没有意义，作废
		report: report === -1 || report === 0 || report === 1 ? report : 1,
		prior: int(own(raw, 'prior'), 0, 100, 0),
		wear: int(own(raw, 'wear'), 0, 100, 0),
		fault: typeof name === 'string' && FAULT_NAMES.has(name) && since >= 0
			? { urgent: own(f, 'urgent') === true, name, since, asked: int(own(f, 'asked'), -1, today, -1) < since ? -1 : int(own(f, 'asked'), -1, today, -1) }
			: null,
	};
}

/**
 * 清洗存档里的 rental：旧存档没有给默认值；租约必须对上清洗后的住处；记录、日期、金额都钳住。幂等，对任何输入不抛异常。
 * home 是清洗后的 state.home，today 是存档时钟所在的游戏日。
 */
export function cleanRental(raw: unknown, home: { type: string; loc: string; owned?: string } | null, today: number, knownLocs?: Set<string>): RentalState {
	const out = emptyRental();
	out.lease = cleanLease(own(raw, 'lease'), home, today);
	if (!isObj(raw)) return out;
	out.refs = int(own(raw, 'refs'), 0, RENTAL.recordMax, 0);
	out.marks = int(own(raw, 'marks'), 0, RENTAL.recordMax, 0);
	const v = own(raw, 'viewed');
	// 只留还在有效期里的看房记录；过期或未来的直接丢掉（合并 main 后复核：原来钳进有效期，过期的看房读档后又能用）
	const rd = own(v, 'day');
	const vDay = typeof rd === 'number' && Number.isInteger(rd) && rd <= today && today - rd < RENTAL.viewDays ? rd : -1;
	if (idOk(own(v, 'loc'), knownLocs) && knownHome(own(v, 'home')) && vDay >= 0) {
		out.viewed = { loc: own(v, 'loc') as string, home: own(v, 'home') as string, day: vDay, n: int(own(v, 'n'), 1, 20, ODDS.crowdFree) };
	}
	const j = own(raw, 'rejected');
	if (idOk(own(j, 'loc'), knownLocs) && own(j, 'day') === today) {
		// 旧形状 { loc, home, day } 转成 homes: [home]
		const list = Array.isArray(own(j, 'homes')) ? (own(j, 'homes') as unknown[]) : [own(j, 'home')];
		const homes = [...new Set(list.filter((h): h is string => knownHome(h)))].slice(0, HOMES.length);
		if (homes.length) out.rejected = { loc: own(j, 'loc') as string, day: today, homes };
	}
	const c = own(raw, 'claim');
	const amount = int(own(c, 'amount'), 0, 100000, 0);
	if (amount > 0) out.claim = { amount, prior: int(own(c, 'prior'), 0, amount, 0), day: int(own(c, 'day'), 0, today, today) };
	out.scam = int(own(raw, 'scam'), -1, today, -1);
	return out;
}
