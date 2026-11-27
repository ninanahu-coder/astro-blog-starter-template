// 银行相关的动作：开户、申请信用卡、取现、个人贷款、车贷、房贷审批、先买后付、还款。
// 规则和数值在 credit.ts / data/credit.ts；这里把它们和引擎的买车、买房、买家具接起来。只由 applyAction（服务端）调用。
// 设计见 docs/earth-game/banking.md。只做游戏机制，不构成理财建议。
import { BANK, type DebtKind } from '../data/credit.ts';
import { weeklyCosts } from './attributes.ts';
import { addEnquiry, bankWeekly, bnplBlocked, bnplSplit, capacity, cardOffer, carOffer, cashFee, homeOffer, newBnpl, newLoan, personalOffer, repayDebt } from './credit.ts';
import { buyFurniture, buyProperty, buyVehicle, careerPay, clone, dealerAt, fail, furnitureAt, getProperty, log, propertiesAt } from './engine.ts';
import { downPayment, FINANCE, loanPayment } from './finance.ts';
import { dayOf } from './time.ts';
import { loanRateMult, rentOn } from './world.ts';
import { shopDailyCost } from './business.ts';
import { TAX_GAME } from '../data/tax.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

const today = (s: PlayerState) => dayOf(s.clock);

/** 银行估的每周收入：正式工作按每周 BANK.shiftsPerWeek 班算（零工不算） */
export function bankIncome(s: PlayerState): number {
	return s.job ? careerPay(s, s.job.career, s.job.level) * BANK.shiftsPerWeek : 0;
}

/** 出租中的房产每周租金合计 */
const rentIncome = (s: PlayerState) => s.properties.reduce((sum, p) => sum + (p.rented ? rentOn(getProperty(p.id)?.rentIncome ?? 0, today(s)) : 0), 0); // 按租金指数实收（合并 main 后）

/**
 * 每周还款能力（审批用）。dropRent：买房自住时现在的房租会停，不算进已有开销。
 * extraRent：正在申请的投资房预期租金；capacity 会统一按 BANK.rentShade 打折。
 * 已有开销 = 房租 + 车辆 + 房产（物业费与还款）+ 银行这边的还款 + 信用卡额度 × 3%
 */
export function bankCapacity(s: PlayerState, dropRent = false, extraRent = 0): number {
	const wc = weeklyCosts(s);
	// 合并 main 后：自己开的店每周的固定开销、欠 ATO 的税每周分期也算已有开销（复核）
	const shop = s.biz?.shop ? shopDailyCost(s.biz.shop).total * 7 : 0;
	const taxPlan = s.tax?.debt ? Math.min(s.tax.debt, Math.max(TAX_GAME.planMin, Math.ceil(s.tax.debt * TAX_GAME.planShare))) : 0;
	const commitments = wc.total - (dropRent ? wc.rent : 0) + bankWeekly(s.bank) + Math.round((s.bank.card?.limit ?? 0) * BANK.cardCommit) + shop + taxPlan;
	return capacity(bankIncome(s), rentIncome(s) + extraRent, commitments);
}

const done = (state: PlayerState, msg: string): ActionResult => {
	log(state, msg);
	return { ok: true, state, msg };
};

export function openAccount(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (prev.bank.open) return fail(prev, '你已经开过户了。');
	const state = clone(prev);
	state.bank.open = true;
	return done(state, '用护照在手机上验证了身份，开了一个银行账户，拿到一张借记卡。');
}

export function applyCard(prev: PlayerState): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = cardOffer(prev.bank, today(prev), bankCapacity(prev));
	if ('blocked' in offer) return fail(prev, offer.blocked);
	const state = clone(prev);
	addEnquiry(state.bank, today(state));
	state.bank.card = { limit: offer.limit, bal: 0, missed: 0 };
	return done(state, `信用卡批下来了，额度 $${offer.limit}。取现从当天起计息、没有免息期，每周结算自动扣最低还款。`);
}

/** 信用卡取现：额度内取到现金，收手续费 */
export function cashAdvance(prev: PlayerState, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const c = prev.bank.card;
	if (!c) return fail(prev, '你没有信用卡。');
	if (c.def || c.missed) return fail(prev, '信用卡有欠款没还上，暂停使用。');
	const amt = Math.floor(amount);
	const fee = cashFee(amt);
	if (!(amt > 0) || amt + fee > c.limit - c.bal) return fail(prev, `可用额度 $${Math.max(0, c.limit - c.bal)}（含手续费）。`);
	const state = clone(prev);
	state.cash += amt;
	state.bank.card!.bal += amt + fee;
	return done(state, `信用卡取现 $${amt}，手续费 $${fee}，信用卡欠款 $${state.bank.card!.bal}。`);
}

export function personalLoan(prev: PlayerState, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const amt = Math.floor(amount);
	const offer = personalOffer(prev.bank, today(prev), bankCapacity(prev), amt);
	if ('blocked' in offer) return fail(prev, offer.blocked);
	const state = clone(prev);
	addEnquiry(state.bank, today(state));
	state.bank.loans.push(newLoan('personal', amt, offer.rate, offer.pay));
	state.cash += amt;
	return done(state, `个人贷款 $${amt} 到账，${BANK.personal.weeks} 周还清，每周还 $${offer.pay}。`);
}

/** 车贷买车：付 10% 首付（扣掉旧车折抵后的车款），其余贷款；车是抵押物 */
export function buyVehicleWithLoan(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const deal = dealerAt(prev, region).find((o) => o.vehicle.id === id);
	if (!deal) return fail(prev, '这里没有车行。');
	if (prev.bank.loans.some((l) => l.kind === 'car')) return fail(prev, '已有一笔车贷，先还清。'); // 换车要先还清旧车贷
	const offer = carOffer(prev.bank, today(prev), bankCapacity(prev), deal.net);
	if ('blocked' in offer) return fail(prev, offer.blocked);
	if (prev.cash < offer.down) return fail(prev, `首付需要 $${offer.down}`);
	// 银行把贷款打给车行：先记到现金里，再走正常的买车流程（同样的营业时间、营地等检查）
	const lent = clone(prev);
	lent.cash += offer.loan;
	const r = buyVehicle(lent, region, id);
	if (!r.ok) return fail(prev, r.msg);
	const state = r.state;
	addEnquiry(state.bank, today(prev));
	state.bank.loans.push(newLoan('car', offer.loan, offer.rate, offer.pay, id));
	const msg = `${r.msg} 首付 $${offer.down}，车贷 $${offer.loan}，${BANK.car.weeks} 周还清，每周还 $${offer.pay}；车是抵押物，还清前不能卖或换。`;
	log(state, msg);
	return { ...r, state, msg };
}

/** 有车贷时卖车、换车要先还清（抵押车贷：车是贷款的抵押物）。能卖返回 undefined */
export function carLoanBlocks(s: PlayerState): string | undefined {
	const l = s.bank.loans.find((x) => x.kind === 'car' && x.vehicle && x.vehicle === s.vehicle);
	return l ? `车贷还欠 $${l.bal}，车是抵押物，先在银行还清` : undefined;
}

/** 房贷审批（买房按揭时先过这一关）：返回审批结果或原因 */
export function homeLoanOffer(s: PlayerState, id: string, use: 'home' | 'invest' = 'home') {
	const def = getProperty(id);
	if (!def) return { blocked: '没有这套房。' } as const;
	const cap = use === 'invest'
		? bankCapacity(s, false, rentOn(def.rentIncome, today(s)))
		: bankCapacity(s, true);
	return homeOffer(s.bank, today(s), cap, def.price, downPayment(def), Math.round(def.price * FINANCE.weeklyPrincipal), FINANCE.weeklyRate * loanRateMult(today(s))); // 按今天的利率指数测算，和实际扣的利息一致（合并 main 后）
}

/** 按揭买房：先过审批，再走原来的买房流程；首付不足 20% 的加贷款保险，并进贷款 */
export function buyPropertyWithLoan(prev: PlayerState, region: Region, id: string, use: 'home' | 'invest' = 'home'): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const listed = propertiesAt(prev, region).find((o) => o.property.id === id);
	if (!listed) return fail(prev, '这里没有这套房。');
	if (listed.blockedLoan) return fail(prev, listed.blockedLoan);
	const offer = homeLoanOffer(prev, id, use);
	if ('blocked' in offer) return fail(prev, `房贷没批：${offer.blocked}`);
	const r = buyProperty(prev, region, id, true);
	if (!r.ok) return r;
	const state = r.state;
	addEnquiry(state.bank, today(prev));
	const mine = state.properties.find((p) => p.id === id);
	if (mine && offer.lmi) mine.loan = Math.min(listed.property.price, mine.loan + offer.lmi);
	// 贷款保险并进贷款后，贷款额和每周还款都按并进之后的说（复核：原来只写并进之前的数）
	const lmiNote = offer.lmi && mine ? `首付不到 20%，贷款保险 $${offer.lmi} 并进了贷款，贷款共 $${mine.loan}，每周还款约 $${loanPayment(listed.property, mine.loan, loanRateMult(today(state)))}。` : '';
	const msg = lmiNote ? `${r.msg} ${lmiNote}` : r.msg;
	if (lmiNote) log(state, lmiNote);
	return { ...r, state, msg };
}

/** 先买后付买家具：下单付第一期，之后每周一期；ack 必须为 true（玩家看过风险提示） */
export function buyFurnitureBnpl(prev: PlayerState, region: Region, id: string, ack: boolean): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!ack) return fail(prev, '先看完先买后付的风险提示。');
	const why = bnplBlocked(prev.bank, today(prev));
	if (why) return fail(prev, why);
	const offer = furnitureAt(prev).find((o) => o.item.id === id);
	if (!offer) return fail(prev, '要在住处才能添置家具。');
	if (offer.owned) return fail(prev, '已拥有');
	const { first, amt } = bnplSplit(offer.net);
	if (amt <= 0) return fail(prev, '金额太小，不能分期。');
	if (prev.cash < first) return fail(prev, `第一期需要 $${first}`);
	const lent = clone(prev);
	lent.cash += offer.net - first;
	const r = buyFurniture(lent, region, id);
	if (!r.ok) return fail(prev, r.msg);
	const state = r.state;
	addEnquiry(state.bank, today(prev));
	state.bank.bnpl.push(newBnpl(id, amt));
	const msg = `${r.msg} 先买后付：今天付了 $${first}，之后每周 $${amt}，共 ${BANK.bnplParts - 1} 期。`;
	log(state, msg);
	return { ...r, state, msg };
}

/** 还款：信用卡、个人贷款或车贷 */
export function repayBank(prev: PlayerState, kind: DebtKind, amount: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const state = clone(prev);
	const paid = repayDebt(state.bank, kind, amount, state.cash);
	if (!paid) return fail(prev, '没有可还的欠款，或金额、现金不足。');
	state.cash -= paid;
	const name = { card: '信用卡', personal: '个人贷款', car: '车贷' }[kind];
	const left = kind === 'card' ? state.bank.card?.bal ?? 0 : state.bank.loans.find((l) => l.kind === kind)?.bal ?? 0;
	return done(state, left ? `还了${name} $${paid}，还欠 $${left}。` : `${name}还清了！`);
}
