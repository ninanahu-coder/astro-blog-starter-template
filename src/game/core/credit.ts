// 银行、信用分、贷款和先买后付的规则：纯函数，只依赖类型和数据表（不引用 engine.ts，引擎反过来调用这里）。
// 数值和来源见 data/credit.ts，设计见 docs/earth-game/banking.md。只做游戏机制，不构成理财建议。
import { BANK, type DebtKind } from '../data/credit.ts';
import type { BankLoan, BankState, BnplPlan } from './types.ts';

export const emptyBank = (): BankState => ({ open: false, card: null, loans: [], bnpl: [], hist: { since: -1, ok: 0, late: [], def: [], enq: [] } });

/** 存档里每种日期记录最多留几条 */
export const HIST_MAX = 12;

// ---------- 信用分 ----------
const within = (list: number[], day: number, days: number) => list.filter((d) => d <= day && day - d < days).length;

/** 信用分 0–1000；没有信用记录返回 null（「无记录」） */
export function creditScore(b: BankState, day: number): number | null {
	const h = b.hist;
	if (h.since < 0) return null;
	const weeks = Math.max(0, Math.floor((day - h.since) / 7));
	let s = BANK.base + Math.min(BANK.weekCap, weeks * BANK.perWeek) + Math.min(BANK.okCap, h.ok) * BANK.perOk;
	s -= within(h.enq, day, BANK.enqDays) * BANK.enqPenalty;
	s -= within(h.late, day, BANK.lateDays) * BANK.latePenalty;
	s -= within(h.def, day, BANK.defDays) * BANK.defPenalty;
	if (b.card && b.card.limit > 0 && b.card.bal / b.card.limit > BANK.utilHigh) s -= BANK.utilPenalty;
	return Math.max(0, Math.min(BANK.scoreMax, Math.round(s)));
}

/** 审批用的分：没有记录的人按起点分算 */
export const lenderScore = (b: BankState, day: number) => creditScore(b, day) ?? BANK.base;

export const scoreBand = (score: number) => BANK.bands.find((x) => score >= x.min)!.name;

/** 信用分的构成，界面用来解释「为什么是这个分」 */
export function scoreParts(b: BankState, day: number) {
	const h = b.hist;
	return {
		weeks: h.since < 0 ? 0 : Math.max(0, Math.floor((day - h.since) / 7)),
		ok: Math.min(BANK.okCap, h.ok),
		enq: within(h.enq, day, BANK.enqDays),
		late: within(h.late, day, BANK.lateDays),
		def: within(h.def, day, BANK.defDays),
		highUse: !!b.card && b.card.limit > 0 && b.card.bal / b.card.limit > BANK.utilHigh,
	};
}

// ---------- 记录 ----------
const push = (list: number[], day: number) => {
	list.push(day);
	if (list.length > HIST_MAX) list.splice(0, list.length - HIST_MAX);
};
/** 开始有信用记录（第一次申请信用产品时） */
export const startFile = (b: BankState, day: number) => {
	if (b.hist.since < 0) b.hist.since = day;
};
export const addEnquiry = (b: BankState, day: number) => {
	startFile(b, day);
	push(b.hist.enq, day);
};
export const addLate = (b: BankState, day: number) => {
	startFile(b, day);
	push(b.hist.late, day);
	b.hist.ok = Math.max(0, b.hist.ok - BANK.okLost);
};
export const addDefault = (b: BankState, day: number) => {
	startFile(b, day);
	push(b.hist.def, day);
};

// ---------- 金额 ----------
/** 等额本息的每周还款：本金 p、每周利率 r、n 周 */
export function amortized(p: number, r: number, n: number): number {
	if (p <= 0) return 0;
	if (r <= 0) return Math.ceil(p / n);
	return Math.ceil((p * r) / (1 - Math.pow(1 + r, -n)));
}

export const rateFor = (table: readonly { min: number; rate: number }[], score: number) => table.find((x) => score >= x.min)!.rate;

/** 信用卡本周最低还款 */
export const cardMinPay = (bal: number) => (bal > 0 ? Math.min(bal, Math.max(BANK.cardMinFloor, Math.round(bal * BANK.cardMinPay))) : 0);

/** 取现手续费 */
export const cashFee = (amount: number) => Math.max(BANK.cashFeeMin, Math.round(amount * BANK.cashFee));

/** 银行这边每周要还的钱（信用卡按最低还款） */
export function bankWeekly(b: BankState): number {
	return (b.card ? cardMinPay(b.card.bal) : 0) + b.loans.reduce((s, l) => s + Math.min(l.pay, l.bal), 0) + b.bnpl.reduce((s, p) => s + p.amt + p.owe, 0);
}

/** 欠银行的钱合计（净资产里扣掉） */
export function bankDebt(b: BankState): number {
	return (b.card?.bal ?? 0) + b.loans.reduce((s, l) => s + l.bal, 0) + b.bnpl.reduce((s, p) => s + p.amt * p.left + p.owe, 0);
}

/** 正在违约（催收中）的产品数 */
export const inDefault = (b: BankState) => (b.card?.def ? 1 : 0) + b.loans.filter((l) => l.def).length + b.bnpl.filter((p) => p.def).length;

/** 有没有正在拖欠的 */
export const behind = (b: BankState) => !!b.card?.missed || b.loans.some((l) => l.missed > 0) || b.bnpl.some((p) => p.missed > 0);

// ---------- 审批 ----------
/** 每周还款能力：(收入 + 打折的租金收入 − 已有固定开销) × dsr */
export function capacity(income: number, rentIncome: number, commitments: number): number {
	return Math.max(0, Math.floor((income + rentIncome * BANK.rentShade - commitments) * BANK.dsr));
}

/** 所有信用申请共用的门槛；能申请返回 undefined */
export function creditBlocked(b: BankState, day: number): string | undefined {
	if (!b.open) return '先开一个银行账户';
	if (within(b.hist.def, day, BANK.defDays) || inDefault(b)) return '五年内有违约记录，银行不批新的信用';
	if (behind(b)) return '有还款没按时还上，先补上欠款';
	return undefined;
}

/** 信用卡：能批的最高额度；批不了返回原因 */
export function cardOffer(b: BankState, day: number, cap: number): { limit: number } | { blocked: string } {
	const why = creditBlocked(b, day);
	if (why) return { blocked: why };
	if (b.card) return { blocked: '你已经有一张信用卡' };
	const score = lenderScore(b, day);
	const weeks = BANK.cardYears * 52;
	const ok = BANK.cardTiers.filter((t) => score >= t.minScore && amortized(t.limit, BANK.cardWeeklyRate, weeks) <= cap);
	if (!ok.length) {
		return { blocked: score < BANK.cardTiers[0].minScore ? `信用分 ${score}，不到 ${BANK.cardTiers[0].minScore}` : `收入不够：要能在 ${BANK.cardYears} 年内还清 $${BANK.cardTiers[0].limit} 的额度` };
	}
	return { limit: ok[ok.length - 1].limit };
}

/** 个人贷款：每周利率、每周还款；批不了返回原因 */
export function personalOffer(b: BankState, day: number, cap: number, amount: number): { rate: number; pay: number } | { blocked: string } {
	const why = creditBlocked(b, day);
	if (why) return { blocked: why };
	if (b.loans.some((l) => l.kind === 'personal')) return { blocked: '已有一笔个人贷款，先还清' };
	const P = BANK.personal;
	if (!(amount >= P.min && amount <= P.max)) return { blocked: `金额要在 $${P.min}–$${P.max}` };
	const score = lenderScore(b, day);
	if (score < P.minScore) return { blocked: `信用分 ${score}，个人贷款要 ${P.minScore} 以上` };
	const rate = rateFor(BANK.personalRates, score);
	const pay = amortized(amount, rate, P.weeks);
	if (pay > cap) return { blocked: `每周要还 $${pay}，超过还款能力 $${cap}` };
	return { rate, pay };
}

/** 车贷：首付、贷款额、每周利率和还款；批不了返回原因。net 是车价扣掉旧车折抵后要付的钱 */
export function carOffer(b: BankState, day: number, cap: number, net: number): { down: number; loan: number; rate: number; pay: number } | { blocked: string } {
	const why = creditBlocked(b, day);
	if (why) return { blocked: why };
	if (b.loans.some((l) => l.kind === 'car')) return { blocked: '已有一笔车贷，先还清' };
	const down = Math.ceil(net * BANK.car.minDown);
	const loan = net - down;
	if (loan <= 0) return { blocked: '旧车折抵后不用贷款' };
	const score = lenderScore(b, day);
	if (score < BANK.car.minScore) return { blocked: `信用分 ${score}，车贷要 ${BANK.car.minScore} 以上` };
	const rate = rateFor(BANK.carRates, score);
	const pay = amortized(loan, rate, BANK.car.weeks);
	if (pay > cap) return { blocked: `每周要还 $${pay}，超过还款能力 $${cap}` };
	return { down, loan, rate, pay };
}

/**
 * 房贷：贷款额（含贷款保险）、保险费、按缓冲利率测的每周还款；批不了返回原因。
 * principalWeek 是这套房每周固定还的本金，weeklyRate 是房贷每周利率（都来自 finance.ts，现状规则不变）。
 */
export function homeOffer(b: BankState, day: number, cap: number, price: number, down: number, principalWeek: number, weeklyRate: number): { loan: number; lmi: number; test: number } | { blocked: string } {
	const why = creditBlocked(b, day);
	if (why) return { blocked: why };
	const score = lenderScore(b, day);
	if (score < BANK.homeMinScore) return { blocked: `信用分 ${score}，房贷要 ${BANK.homeMinScore} 以上` };
	const base = price - down;
	const lmi = down / price < BANK.lmiBelow ? Math.round(base * BANK.lmiRate) : 0;
	const loan = Math.min(price, base + lmi);
	const test = principalWeek + Math.round(loan * (weeklyRate + BANK.homeBuffer / 52));
	if (test > cap) return { blocked: `按利率上浮 3 个百分点测算每周要还 $${test}，超过还款能力 $${cap}` };
	return { loan, lmi, test };
}

/** 先买后付：能不能开一笔；不能返回原因 */
export function bnplBlocked(b: BankState, day: number): string | undefined {
	const why = creditBlocked(b, day);
	if (why) return why;
	if (b.bnpl.length >= BANK.bnplMax) return `同时最多 ${BANK.bnplMax} 笔先买后付`;
	return undefined;
}

/** 先买后付的分期：第一期（下单时付）和之后每期 */
export function bnplSplit(total: number): { first: number; amt: number } {
	const amt = Math.floor(total / BANK.bnplParts);
	return { first: total - amt * (BANK.bnplParts - 1), amt };
}

// ---------- 每周结算 ----------
export interface SettleHooks {
	day: number;
	log: (text: string) => void;
	/** 收车：把车收走并返回到手价（引擎实现，这里不碰车辆数据） */
	repossess: (vehicle: string) => number;
	/** 结算前各套房的贷款和欠款次数（用来认出本周被强制卖掉的房） */
	before: { id: string; loan: number }[];
	after: { id: string; loan: number; missed: number }[];
	/** 房产名，用于日志 */
	propName: (id: string) => string;
}

/** 一笔欠款这周没还上：记欠款次数，到 14 天记逾期，到 60 天且够 $30 记违约。返回本周新记的标记 */
function missOnce(x: { missed: number; def?: true }, bal: number, b: BankState, day: number): 'late' | 'default' | undefined {
	x.missed++;
	if (x.missed === BANK.lateMissed) {
		addLate(b, day);
		return 'late';
	}
	if (x.missed >= BANK.defaultMissed && !x.def && bal >= BANK.defaultMin) {
		x.def = true;
		addDefault(b, day);
		return 'default';
	}
	return undefined;
}

/**
 * 银行部分的每周结算（在房产结算之后）：信用卡 → 贷款 → 先买后付 → 房贷的信用记录 → 催收。原地修改 cash 和 b，返回新的现金。
 * 只有开了户的人才有信用产品；没开户直接跳过（房贷的信用记录也要开户才记，旧存档有房贷的在存档清洗时自动开户）。
 */
export function settleBank(b: BankState, cash: number, h: SettleHooks): number {
	if (!b.open) return cash;
	const { day, log } = h;
	let paidAny = false;
	let missedAny = false;
	const note = (what: string, mark: 'late' | 'default' | undefined) => {
		if (mark === 'late') log(`${what}拖欠已满 14 天，记了一条逾期，信用分下降。`);
		if (mark === 'default') log(`${what}拖欠超过 60 天，记了一条违约（保留 5 年），转入催收。`);
	};

	// 信用卡：全部是取现，按天计息（游戏按周），没有免息期
	const c = b.card;
	if (c && c.bal > 0) {
		if (!c.def) c.bal += Math.round(c.bal * BANK.cardWeeklyRate);
		const due = cardMinPay(c.bal);
		if (cash >= due) {
			cash -= due;
			c.bal -= due;
			c.missed = 0;
			paidAny = true;
			log(`周结算：信用卡自动还最低 $${due}（还欠 $${c.bal}）。`);
		} else {
			const fee = c.def ? 0 : BANK.lateFee;
			c.bal += fee;
			missedAny = true;
			const mark = missOnce(c, c.bal, b, day);
			log(`没钱还信用卡最低 $${due}${fee ? `，收了 $${fee} 罚金` : ''}（第 ${c.missed} 次）。`);
			note('信用卡', mark);
		}
		if (c.bal <= 0) {
			c.bal = 0;
			c.missed = 0;
			delete c.def;
		}
	}

	// 贷款：等额本息；违约后停止计息（游戏简化），但每周照样尝试扣款
	for (const l of [...b.loans]) {
		const name = l.kind === 'car' ? '车贷' : '个人贷款';
		const interest = l.def ? 0 : Math.round(l.bal * l.rate);
		const due = Math.min(l.pay, l.bal + interest);
		if (cash >= due) {
			cash -= due;
			l.bal = l.bal + interest - due;
			l.missed = 0;
			paidAny = true;
			if (l.bal <= 0) {
				b.loans = b.loans.filter((x) => x !== l);
				log(`周结算：${name}还清了！`);
			} else log(`周结算：${name}还款 $${due}（还欠 $${l.bal}）。`);
			continue;
		}
		const fee = l.def ? 0 : BANK.lateFee;
		l.bal += interest + fee;
		missedAny = true;
		const mark = missOnce(l, l.bal, b, day);
		log(`没钱还${name}这周的 $${due}${fee ? `，收了 $${fee} 罚金` : ''}（第 ${l.missed} 次）。`);
		if (l.kind === 'car' && l.vehicle && l.missed === 1) log(`银行寄来违约通知：30 天内补上车贷欠款，不然会收车。`);
		if (l.kind === 'car' && l.vehicle && l.missed >= BANK.repossessMissed) {
			const got = h.repossess(l.vehicle);
			delete l.vehicle;
			l.bal = Math.max(0, l.bal - got);
			log(`车贷违约通知期满，银行收走了车，拍卖抵了 $${got}${l.bal ? `，还欠 $${l.bal}` : ''}。`);
			if (!l.bal) {
				b.loans = b.loans.filter((x) => x !== l);
				continue;
			}
		}
		note(name, mark);
	}

	// 先买后付：每期固定金额，不计利息；逾期费另记，随下一期一起扣，合计有上限
	for (const p of [...b.bnpl]) {
		const due = p.amt + p.owe;
		if (cash >= due) {
			cash -= due;
			p.left--;
			p.owe = 0;
			p.missed = 0;
			paidAny = true;
			if (p.left <= 0) {
				b.bnpl = b.bnpl.filter((x) => x !== p);
				log(`周结算：先买后付最后一期 $${due} 付清了。`);
			} else log(`周结算：先买后付付了一期 $${due}（还剩 ${p.left} 期）。`);
			continue;
		}
		const fee = Math.min(BANK.bnplLateFee, Math.max(0, Math.floor(p.amt * BANK.bnplParts * BANK.bnplFeeCap) - p.fees));
		p.fees += fee;
		p.owe += fee;
		missedAny = true;
		const mark = missOnce(p, p.amt * p.left + p.owe, b, day);
		log(`先买后付这期 $${due} 没付上${fee ? `，收了 $${fee} 逾期费` : ''}（第 ${p.missed} 次）。`);
		note('先买后付', mark);
	}

	// 房贷：现有规则在 engine 的 settleProperties 里结算，这里只记信用记录
	for (const was of h.before) {
		if (was.loan <= 0) continue;
		const now = h.after.find((p) => p.id === was.id);
		if (!now) {
			// 本周被强制卖掉（结算期间只有断供会让房产消失）
			addDefault(b, day);
			missedAny = true;
			log(`${h.propName(was.id)}断供被强制卖出，记了一条违约（保留 5 年）。`);
			continue;
		}
		if (now.missed === 0) paidAny = true;
		else {
			missedAny = true;
			if (now.missed === BANK.lateMissed) {
				addLate(b, day);
				log(`${h.propName(was.id)}房贷拖欠已满 14 天，记了一条逾期，信用分下降。`);
			}
		}
	}

	if (paidAny && !missedAny) b.hist.ok = Math.min(BANK.okCap, b.hist.ok + 1);
	if (inDefault(b)) log(`催收公司来电，要求还上违约的欠款（每周最多 ${BANK.collectorCallsPerWeek} 次，只能在规定时段）。`);
	return cash;
}

/** 还款：把现金还进一种欠款，不超过欠款和现金。返回实还金额；kind 不存在返回 0 */
export function repayDebt(b: BankState, kind: DebtKind, amount: number, cash: number): number {
	const target: { bal: number; missed: number; def?: true } | undefined = kind === 'card' ? b.card ?? undefined : b.loans.find((l) => l.kind === kind);
	if (!target || target.bal <= 0) return 0;
	const pay = Math.floor(Math.min(amount, target.bal, cash));
	if (!(pay > 0)) return 0;
	target.bal -= pay;
	if (target.bal <= 0) {
		target.bal = 0;
		target.missed = 0;
		delete target.def;
		if (kind !== 'card') b.loans = b.loans.filter((l) => l !== target);
	} else if (target.missed) target.missed = 0; // 补上了欠款：不再算拖欠（已记的逾期、违约记录不撤销）
	return pay;
}

/** 新建一笔贷款 */
export const newLoan = (kind: BankLoan['kind'], bal: number, rate: number, pay: number, vehicle?: string): BankLoan => ({ kind, bal, pay, rate, missed: 0, ...(vehicle ? { vehicle } : {}) });
export const newBnpl = (item: string, amt: number): BnplPlan => ({ item, amt, left: BANK.bnplParts - 1, missed: 0, fees: 0, owe: 0 });

// ---------- 存档清洗（save-sync.md §5） ----------
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.min(hi, Math.max(lo, v))) : d);
const days = (v: unknown, today: number) => (Array.isArray(v) ? v.slice(-HIST_MAX).filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= today).sort((a, b) => a - b) : []);
const DEBT_MAX = 1e6;

/**
 * 清洗存档里的 bank 字段：任何输入都不抛异常；旧存档没有这个字段时，有房贷的人视为已开户（房贷本来就是银行给的）。
 * vehicles：已知车型 id；today：存档的游戏日；furniture：已知家具 id。
 */
export function cleanBank(raw: unknown, today: number, hasMortgage: boolean, vehicles: Set<string>, furniture: Set<string>): BankState {
	const b = emptyBank();
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null;
	b.open = r ? r.open === true || hasMortgage : hasMortgage;
	if (!r || !b.open) return b;
	const h = r.hist && typeof r.hist === 'object' ? r.hist : {};
	b.hist = {
		since: int(h.since, -1, today, -1),
		ok: int(h.ok, 0, BANK.okCap, 0),
		late: days(h.late, today),
		def: days(h.def, today),
		enq: days(h.enq, today),
	};
	if (b.hist.since < 0 && (b.hist.late.length || b.hist.def.length || b.hist.enq.length)) b.hist.since = Math.min(...b.hist.late, ...b.hist.def, ...b.hist.enq);
	const c = r.card;
	if (c && typeof c === 'object' && !Array.isArray(c)) {
		const tier = BANK.cardTiers.find((t) => t.limit === c.limit);
		if (tier) {
			const missed = int(c.missed, 0, 520, 0);
			b.card = { limit: tier.limit, bal: int(c.bal, 0, DEBT_MAX, 0), missed };
			if (c.def === true && b.card.bal > 0) b.card.def = true;
		}
	}
	if (Array.isArray(r.loans)) {
		for (const kind of ['personal', 'car'] as const) {
			const l = r.loans.find((x: any) => x && typeof x === 'object' && x.kind === kind);
			if (!l) continue;
			const bal = int(l.bal, 0, DEBT_MAX, 0);
			if (!bal) continue;
			const table = kind === 'car' ? BANK.carRates : BANK.personalRates;
			const rate = table.some((t) => t.rate === l.rate) ? (l.rate as number) : table[table.length - 1].rate;
			const loan = newLoan(kind, bal, rate, int(l.pay, 1, DEBT_MAX, Math.max(1, amortized(bal, rate, kind === 'car' ? BANK.car.weeks : BANK.personal.weeks))), kind === 'car' && typeof l.vehicle === 'string' && vehicles.has(l.vehicle) ? l.vehicle : undefined);
			loan.missed = int(l.missed, 0, 520, 0);
			if (l.def === true) loan.def = true;
			b.loans.push(loan);
		}
	}
	if (Array.isArray(r.bnpl)) {
		for (const p of r.bnpl.slice(0, BANK.bnplMax)) {
			if (!p || typeof p !== 'object' || typeof p.item !== 'string' || !furniture.has(p.item)) continue;
			const amt = int(p.amt, 0, DEBT_MAX, 0);
			const left = int(p.left, 0, BANK.bnplParts - 1, 0);
			if (!amt || !left) continue;
			const fees = int(p.fees, 0, DEBT_MAX, 0);
			const plan: BnplPlan = { item: p.item, amt, left, missed: int(p.missed, 0, 520, 0), fees, owe: int(p.owe, 0, fees, 0) };
			if (p.def === true) plan.def = true;
			b.bnpl.push(plan);
		}
	}
	return b;
}
