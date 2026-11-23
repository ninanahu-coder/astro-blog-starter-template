// 税务规则：TFN、工资预扣、按游戏年结算的报税与退税、ABN 个体户收入、出租收入。纯函数 + 少量原地记账函数。
// 设计说明见 docs/earth-game/tax.md；真实规则和来源见 src/game/data/tax.ts。
import { ACTIVITY_INCOME, LITO, MEDICARE, NO_TFN_RATE, ORIGIN_TAX, TAX_BANDS, TAX_GAME, type IncomeKind, type Residency, type TaxBand } from '../data/tax.ts';
import { dateOf, dayOf, YEAR_DAYS } from './time.ts';
import type { PlayerState, TaxBook, TaxState } from './types.ts';
import { coverOf } from './health.ts';

// ---------- 身份 ----------
export interface TaxStatus {
	residency: Residency;
	medicareExempt: boolean;
}

export const taxStatus = (origin: string): TaxStatus => ORIGIN_TAX[origin] ?? { residency: 'resident', medicareExempt: false };

/**
 * 这个角色现在的税务身份（合并 main 后）：居民身份照出身定；Medicare 税免不免跟着签证带的医疗保障走——
 * 不享受 Medicare 的临时居民（持学生签证用 OSHC、毕业签和工作签自费）凭 Medicare Entitlement Statement 全免，拿到永居有了 Medicare 就要交
 */
export function taxStatusOf(state: PlayerState): TaxStatus {
	const base = taxStatus(state.origin);
	return { ...base, medicareExempt: coverOf(state).id !== 'medicare' };
}

/** 有没有 ABN：税务卡上注册的，或者副业与小生意里办的（两边是同一个号码，合并 main 后） */
export const hasAbn = (state: PlayerState) => state.tax.abn || state.biz?.lic.abn !== undefined;

export const RESIDENCY_LABEL: Record<Residency, string> = { resident: '税务居民', whm: '打工度假（WHM）', foreign: '外国税务居民' };

/** 某个地点活动的收入性质（没列出的不是收入） */
export const activityIncome = (activityId: string): IncomeKind => ACTIVITY_INCOME[activityId] ?? 'none';

// ---------- 税额计算（游戏金额：现实门槛 × TAX_GAME.scale） ----------
const sc = (n: number) => n * TAX_GAME.scale;

/** 按税档算税（不含抵税额和 Medicare 税），金额为游戏金额 */
export function bandTax(income: number, bands: TaxBand[]): number {
	let tax = 0;
	let floor = 0;
	for (const b of bands) {
		const top = b.upTo === null ? Infinity : sc(b.upTo);
		if (income > floor) tax += (Math.min(income, top) - floor) * b.rate;
		floor = top;
	}
	return tax;
}

/** 低收入抵税额（游戏金额）。只有税务居民有 */
export function lito(income: number): number {
	const full = sc(LITO.full);
	const mid = sc(LITO.mid);
	if (income <= full) return sc(LITO.max);
	if (income <= mid) return Math.max(0, sc(LITO.max) - (income - full) * LITO.step1);
	return Math.max(0, sc(LITO.midAmount) - (income - mid) * LITO.step2);
}

/** Medicare 税（游戏金额），含低收入减免 */
export function medicareLevy(income: number, st: TaxStatus): number {
	if (st.residency !== 'resident' || st.medicareExempt) return 0;
	const lower = sc(MEDICARE.lower);
	if (income <= lower) return 0;
	return Math.min(income * MEDICARE.rate, (income - lower) * MEDICARE.phaseIn);
}

export interface Assessment {
	taxable: number; // 应税收入 = 工资 + 生意 + 租金 − 出租费用（不低于 0）
	gross: number; // 按税档算的税
	offset: number; // 实际用上的低收入抵税额
	medicare: number;
	tax: number; // 全年应纳税额（取整）
}

/** 一年的应纳税额。出租亏损可以抵工资等其他收入（负扣税，ATO：negative gearing） */
export function assess(book: TaxBook, st: TaxStatus): Assessment {
	// 生意全年亏了按 0 计，不抵工资（接近 ATO 对非商业亏损的处理）；出租亏损照旧可以抵（负扣税）
	const taxable = Math.max(0, Math.round(book.wages + Math.max(0, book.biz) + book.rent - book.rentCost));
	const gross = bandTax(taxable, TAX_BANDS[st.residency]);
	const offset = st.residency === 'resident' ? Math.min(gross, lito(taxable)) : 0;
	// Medicare 税：这一年记过几周的保障（wk 周里 mx 周不享受 Medicare、免税）就按比例算，和 ATO 按天数部分免除一样；没有记录（预扣时临时算）按眼下的身份
	const medicare = (book.wk ?? 0) > 0 ? medicareLevy(taxable, { ...st, medicareExempt: false }) * (1 - Math.min(book.wk!, book.mx ?? 0) / book.wk!) : medicareLevy(taxable, st);
	return { taxable, gross: Math.round(gross), offset: Math.round(offset), medicare: Math.round(medicare), tax: Math.max(0, Math.round(gross - offset + medicare)) };
}

// ---------- TFN 与预扣 ----------
/** TFN 状态：none 没申请；waiting 已申请、在等号码（雇主宽限期，按正常税率扣）；ok 已有 */
export function tfnState(tax: TaxState, day: number): 'none' | 'waiting' | 'ok' {
	if (tax.tfn < 0) return 'none';
	return day >= tax.tfn ? 'ok' : 'waiting';
}

/**
 * 一笔工资要预扣多少：没 TFN 按最高税率；否则把这一笔当作一天的工资，× TAX_GAME.payDaysPerYear 折成全年收入，
 * 算出全年税再摊回这一笔（和现实 PAYG 按发薪周期折年一样）。
 */
export function withholding(state: PlayerState, gross: number): number {
	if (gross <= 0) return 0;
	const st = taxStatusOf(state);
	if (tfnState(state.tax, dayOf(state.clock)) === 'none') return Math.round(gross * NO_TFN_RATE[st.residency]);
	const days = TAX_GAME.payDaysPerYear;
	const yearTax = assess({ wages: gross * days, withheld: 0, biz: 0, rent: 0, rentCost: 0 }, st).tax;
	return Math.min(gross, Math.round(yearTax / days));
}

/** 工资到手：返回税后金额和预扣额（不改状态；发成功后再调 recordWage 记账） */
export function wageSplit(state: PlayerState, gross: number): { net: number; withheld: number } {
	const withheld = withholding(state, gross);
	return { net: gross - withheld, withheld };
}

// ---------- 记账（原地修改，调用方传入的是引擎新建的对象） ----------
const cap = (n: number) => Math.min(TAX_GAME.debtMax, n);

export function recordWage(state: PlayerState, gross: number, withheld: number) {
	state.tax.book.wages = cap(state.tax.book.wages + gross);
	state.tax.book.withheld = cap(state.tax.book.withheld + withheld);
}
export function recordBiz(state: PlayerState, amount: number) {
	// 个体户收入按本年净额带符号累计（开店装修、进货这些先发生的亏损也能扣），算税时才按不低于 0 计（assess）。合并 main 后复核：原来每笔都钳到 0，先亏后赚的亏损被丢掉
	state.tax.book.biz = Math.max(-TAX_GAME.debtMax, cap(state.tax.book.biz + Math.round(amount)));
}
export function recordRent(state: PlayerState, income: number) {
	state.tax.book.rent = cap(state.tax.book.rent + income);
}
/** 出租的可抵扣费用：物业费、维修、贷款利息（不含本金） */
export function recordRentCost(state: PlayerState, cost: number) {
	state.tax.book.rentCost = cap(state.tax.book.rentCost + cost);
}

/** 街头表演这类爱好收入：有 ABN 时按生意收入记账并上浮 abnBonus；没 ABN 不计税，原样返回 */
export function hobbyIncome(state: PlayerState, cash: number): number {
	if (!hasAbn(state) || cash <= 0) return cash;
	return Math.round(cash * (1 + TAX_GAME.abnBonus));
}

// ---------- 财年与报税期 ----------
/** 游戏财年 = 游戏年（春季第 1 天到冬季最后一天） */
export const fyOf = (day: number) => dateOf(day * 1440).year;
/** 某财年的报税期：下一年开头 lodgeDays 天，[start, end) */
export function lodgeWindow(fy: number): { start: number; end: number } {
	const start = fy * YEAR_DAYS;
	return { start, end: start + TAX_GAME.lodgeDays };
}

/** 逾期罚款：只对要补税的申报 */
export function latePenalty(fy: number, day: number, due: number): number {
	const over = day - lodgeWindow(fy).end;
	if (due <= 0 || over < 0) return 0;
	return Math.min(TAX_GAME.lateMaxUnits, Math.floor(over / TAX_GAME.lateEveryDays) + 1) * TAX_GAME.lateUnit;
}

export const emptyBook = (): TaxBook => ({ wages: 0, withheld: 0, biz: 0, rent: 0, rentCost: 0 });
const bookEmpty = (b: TaxBook) => !b.wages && !b.withheld && !b.biz && !b.rent && !b.rentCost;

export interface ReturnPreview {
	fy: number;
	assess: Assessment;
	withheld: number;
	due: number; // 正数要补税，负数退税
	penalty: number; // 现在申报要交的逾期罚款
	late: boolean; // 已过报税期
	daysLeft: number; // 报税期还剩几天（过了为 0）
}

/** 待申报那一年现在申报的结果预览 */
export function returnPreview(state: PlayerState): ReturnPreview | null {
	const ret = state.tax.ret;
	if (!ret) return null;
	const day = dayOf(state.clock);
	const a = assess(ret, taxStatusOf(state));
	const due = a.tax - ret.withheld;
	const end = lodgeWindow(ret.fy).end;
	return { fy: ret.fy, assess: a, withheld: ret.withheld, due, penalty: latePenalty(ret.fy, day, due), late: day >= end, daysLeft: Math.max(0, end - day) };
}

/** 结清一份申报：退税入账，补税和罚款先从现金扣，不够的记欠税。返回日志文案 */
export function settle(state: PlayerState, forced: boolean): string {
	const p = returnPreview(state)!;
	const hasTfn = tfnState(state.tax, dayOf(state.clock)) === 'ok';
	state.tax.ret = null;
	state.tax.last = { fy: p.fy, due: p.due, penalty: p.penalty };
	const head = forced ? `ATO 按第 ${p.fy} 财年的记录默认评税` : `第 ${p.fy} 财年报税完成`;
	if (p.due < 0) {
		if (!hasTfn) return `${head}：没有 TFN，多扣的 $${-p.due} 退不回来了。`;
		state.cash += -p.due;
		return `${head}：退税 $${-p.due}。`;
	}
	const owe = p.due + p.penalty;
	if (owe <= 0) return `${head}：不用补也不退。`;
	const paid = Math.min(state.cash, owe);
	state.cash -= paid;
	state.tax.debt = cap(state.tax.debt + owe - paid);
	const pen = p.penalty ? `（含逾期罚款 $${p.penalty}）` : '';
	return `${head}：补税 $${owe}${pen}${owe > paid ? `，现金付了 $${paid}，剩下 $${owe - paid} 每周分期扣` : ''}。`;
}

/**
 * 每周结算里的税务部分（原地修改）：
 * 1. 跨进新财年：上一份没申报的按默认评税结清；本年账目结转成待申报（没有任何收入就不用报）；
 * 2. 欠税分期扣款。返回要写进日志的文案。
 */
export function taxTick(state: PlayerState): string[] {
	const out: string[] = [];
	const fyNow = fyOf(dayOf(state.clock));
	const t = state.tax;
	// 这一周的 Medicare 保障记进本年账目（报税时按比例算 Medicare 税，不按报税那天的身份算整年；合并 main 后复核）
	if (fyNow === t.fy) {
		t.book.wk = (t.book.wk ?? 0) + 1;
		if (taxStatusOf(state).medicareExempt) t.book.mx = (t.book.mx ?? 0) + 1;
	}
	if (fyNow > t.fy) {
		if (t.ret) out.push(settle(state, true));
		if (!bookEmpty(t.book)) {
			t.ret = { fy: t.fy, ...t.book };
			const w = lodgeWindow(t.fy);
			out.push(`第 ${t.fy} 财年结束，报税期开始（${w.end - w.start} 天内申报，逾期要补税的会被罚款）。`);
		}
		t.book = emptyBook();
		t.fy = fyNow;
	}
	if (t.debt > 0 && state.cash > 0) {
		const pay = Math.min(state.cash, t.debt, Math.max(TAX_GAME.planMin, Math.ceil(t.debt * TAX_GAME.planShare)));
		state.cash -= pay;
		t.debt -= pay;
		out.push(`周结算：分期补税 $${pay}${t.debt ? `（还欠 $${t.debt}）` : '，欠税还清'}。`);
	}
	return out;
}

// ---------- 存档 ----------
const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

function cleanBook(raw: any): TaxBook {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	return {
		wages: n(r.wages, 0, TAX_GAME.debtMax, 0),
		withheld: n(r.withheld, 0, TAX_GAME.debtMax, 0),
		biz: n(r.biz, -TAX_GAME.debtMax, TAX_GAME.debtMax, 0),
		rent: n(r.rent, 0, TAX_GAME.debtMax, 0),
		rentCost: n(r.rentCost, 0, TAX_GAME.debtMax, 0),
		...(() => {
			const wk = n(r.wk, 0, 1000, 0);
			return wk ? { wk, mx: n(r.mx, 0, wk, 0) } : {};
		})(),
	};
}

/** 新角色的税务状态：没有 TFN、没有 ABN，从当前财年记账 */
export function newTaxState(clock: number): TaxState {
	return { tfn: -1, abn: false, fy: fyOf(dayOf(clock)), book: emptyBook(), ret: null, debt: 0, last: null };
}

/**
 * 存档清洗（docs/earth-game/save-sync.md §5）。旧存档没有这个字段：视为早就有 TFN（tfn = 0），
 * 免得已经在上班的老玩家突然被按 47% 预扣；从当前财年开始记账。对任何输入不抛异常、幂等。
 */
export function cleanTax(raw: unknown, clock: number): TaxState {
	const fyNow = fyOf(dayOf(clock));
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...newTaxState(clock), tfn: 0 };
	const r = raw as Record<string, any>;
	const fy = n(r.fy, 1, fyNow, fyNow);
	// 待申报的一定是更早的财年；对不上的整份丢掉（不钳：钳过去会把本年账目当成上一年的报掉）
	const retFy = r.ret && typeof r.ret === 'object' && !Array.isArray(r.ret) ? r.ret.fy : undefined;
	const ret = Number.isInteger(retFy) && retFy >= 1 && retFy < fy ? { fy: retFy as number, ...cleanBook(r.ret) } : null;
	const last = r.last && typeof r.last === 'object' && !Array.isArray(r.last)
		? { fy: n(r.last.fy, 1, fyNow, 1), due: n(r.last.due, -TAX_GAME.debtMax, TAX_GAME.debtMax, 0), penalty: n(r.last.penalty, 0, TAX_GAME.debtMax, 0) }
		: null;
	return {
		tfn: n(r.tfn, -1, dayOf(clock) + TAX_GAME.tfnWaitDays, -1),
		abn: r.abn === true,
		fy,
		book: cleanBook(r.book),
		ret,
		debt: n(r.debt, 0, TAX_GAME.debtMax, 0),
		last,
	};
}
