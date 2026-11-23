// 银行、信用分、贷款和先买后付（docs/earth-game/banking.md）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, publicState } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { bankCapacity, bankIncome, buyFurnitureBnpl, homeLoanOffer } from '../../src/game/core/bank.ts';
import {
	amortized, bankDebt, bankWeekly, capacity, cardMinPay, repayDebt, cardOffer, carOffer, cashFee, cleanBank, creditScore, emptyBank, HIST_MAX, homeOffer, lenderScore, personalOffer, scoreBand, settleBank, type SettleHooks,
} from '../../src/game/core/credit.ts';
import { dealerAt, netWorth, resaleValue } from '../../src/game/core/engine.ts';
import { downPayment, FINANCE } from '../../src/game/core/finance.ts';
import { sellBlockedSwap } from '../../src/game/core/secondhand.ts';
import { SWAP_GOODS } from '../../src/game/data/secondhand.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { loanRateMult, rentOn } from '../../src/game/core/world.ts';
import { featureOf } from '../../src/game/server/stats.ts';
import { weeklyCosts } from '../../src/game/core/attributes.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import { BANK, BNPL_WARNING } from '../../src/game/data/credit.ts';
import { FURNITURE } from '../../src/game/data/furniture.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';
import { SHOP_SITES, SHOP_TYPES } from '../../src/game/data/business.ts';
import { bankCardHtml, bnplButton, bnplConfirmText, carLoanButton, homeLoanNote } from '../../src/game/ui/bank.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const JOB = (level = 2) => ({ career: 'barista', loc: 'perth', level, shifts: 0, good: 0, lastDay: -1 });
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'bank-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 5 }),
	...over,
});
/** 开了户、有工作的人 */
const worker = (over: Partial<PlayerState> = {}) => {
	const s = make({ cash: 5000, clock: at(10), job: JOB(), ...over });
	s.bank.open = true;
	return s;
};
const ok = (r: { ok: boolean; msg: string }) => assert.ok(r.ok, r.msg);
const flat = PROPERTIES.find((p) => p.id === 'perth-apartment')!;
const car = VEHICLES.find((v) => v.id === 'car')!;
const VEH = new Set(VEHICLES.map((v) => v.id));
const FURN = new Set(FURNITURE.map((f) => f.id));
const hooks = (day: number, over: Partial<SettleHooks> = {}): SettleHooks & { logs: string[] } => {
	const logs: string[] = [];
	return { day, log: (t) => logs.push(t), repossess: () => 0, before: [], after: [], propName: () => '房', logs, ...over };
};
/** 走到第 day 天晚上（中途的周结算都会执行） */
const passTo = (s: PlayerState, day: number) => applyAction({ ...s, clock: at(20, day) }, WA, { t: 'activity', id: 'sleep-camp' }).state;

// ---------- 数据 ----------
test('数据：分档从高到低、最后一档是 0；利率顺序 车贷 < 个人贷款 < 信用卡；风险提示三条', () => {
	const mins = BANK.bands.map((b) => b.min);
	assert.deepEqual([...mins].sort((a, b) => b - a), mins);
	assert.equal(mins.at(-1), 0);
	for (const t of [BANK.personalRates, BANK.carRates]) assert.equal(t.at(-1)!.min, 0);
	for (let i = 0; i < BANK.carRates.length; i++) assert.ok(BANK.carRates[i].rate < BANK.personalRates[i].rate, '有抵押的车贷利率低于无抵押的个人贷款（Moneysmart）');
	assert.ok(BANK.personalRates[0].rate < BANK.cardWeeklyRate);
	assert.equal(BANK.lateMissed * 7, 14, '逾期 14 天');
	assert.ok(BANK.defaultMissed * 7 >= 60, '违约 60 天以上');
	assert.ok((BANK.repossessMissed - 1) * 7 >= 28, '违约通知期 30 天，取整到结算日');
	assert.equal(BANK.lateDays, 728);
	assert.equal(BANK.defDays, 1825);
	assert.equal(BNPL_WARNING.length, 3);
});

// ---------- 信用分 ----------
test('信用分：没有记录是 null，审批按起点分；记录时长、按时还款加分，有上限', () => {
	const b = emptyBank();
	assert.equal(creditScore(b, 10), null);
	assert.equal(lenderScore(b, 10), BANK.base);
	b.hist.since = 0;
	assert.equal(creditScore(b, 0), BANK.base);
	assert.equal(creditScore(b, 70), BANK.base + 10 * BANK.perWeek);
	assert.equal(creditScore(b, 7000), BANK.base + BANK.weekCap);
	b.hist.ok = 3;
	assert.equal(creditScore(b, 0), BANK.base + 3 * BANK.perOk);
	b.hist.ok = 999;
	assert.equal(creditScore(b, 0), BANK.base + BANK.okCap * BANK.perOk);
	assert.equal(scoreBand(900), '优秀');
	assert.equal(scoreBand(0), '低');
});

test('信用分：申请、逾期、违约扣分，过了保留期不再扣；欠款超过额度一半扣分；钳在 0–1000', () => {
	const b = emptyBank();
	b.hist.since = 0;
	b.hist.enq = [100];
	assert.equal(creditScore(b, 100), BANK.base + 14 * BANK.perWeek - BANK.enqPenalty);
	assert.equal(creditScore(b, 100 + BANK.enqDays), BANK.base + Math.floor((100 + BANK.enqDays) / 7) * BANK.perWeek, '过了影响期不再扣');
	b.hist.enq = [];
	b.hist.late = [10];
	assert.equal(creditScore(b, 10), BANK.base + 1 * BANK.perWeek - BANK.latePenalty);
	assert.equal(creditScore(b, 10 + BANK.lateDays - 1)! < creditScore(b, 10 + BANK.lateDays)!, true, '逾期两年后不再扣');
	b.hist.late = [];
	b.hist.def = [10, 11, 12];
	assert.equal(creditScore(b, 12), 0, '钳到 0');
	assert.equal(creditScore(b, 10 + BANK.defDays + 2), BANK.base + BANK.weekCap, '违约五年后不再扣');
	b.hist.def = [];
	b.card = { limit: 1000, bal: 500, missed: 0 };
	const lo = creditScore(b, 0)!;
	b.card.bal = 501;
	assert.equal(creditScore(b, 0), lo - BANK.utilPenalty);
	b.hist.ok = 52;
	b.hist.since = -1;
	assert.equal(creditScore(b, 0), null, '日期记录在而 since=-1：按无记录（存档清洗会补 since）');
});

test('等额本息：每周还款 × 期数 ≥ 本金；零利率均摊；最低还款、手续费', () => {
	for (const [p, r, n] of [[1000, 0.003, 52], [5000, 0.0017, 52], [20000, 0.0021, 104]] as const) {
		const pay = amortized(p, r, n);
		let bal = p;
		for (let i = 0; i < n; i++) bal = bal + Math.round(bal * r) - Math.min(pay, bal + Math.round(bal * r));
		assert.ok(bal <= 0, `${p} 按期还清，剩 ${bal}`);
		assert.ok(pay * n >= p);
	}
	assert.equal(amortized(1000, 0, 4), 250);
	assert.equal(amortized(0, 0.01, 4), 0);
	assert.equal(cardMinPay(0), 0);
	assert.equal(cardMinPay(5), 5, '不超过欠款');
	assert.equal(cardMinPay(100), BANK.cardMinFloor);
	assert.equal(cardMinPay(1000), 30);
	assert.equal(cashFee(10), BANK.cashFeeMin);
	assert.equal(cashFee(1000), 30);
});

// ---------- 审批 ----------
test('审批：没开户、有违约、正在拖欠都不批；信用卡按分和「三年还清额度」给最高一档', () => {
	const b = emptyBank();
	assert.match((cardOffer(b, 0, 9999) as { blocked: string }).blocked, /开/);
	b.open = true;
	assert.deepEqual(cardOffer(b, 0, 9999), { limit: 500 }, '无记录按起点分，只能拿第一档');
	assert.match((cardOffer(b, 0, 0) as { blocked: string }).blocked, /收入/);
	b.hist = { since: 0, ok: 52, late: [], def: [], enq: [] };
	assert.deepEqual(cardOffer(b, 700, 9999), { limit: 3000 });
	const need3000 = amortized(3000, BANK.cardWeeklyRate, 156);
	assert.deepEqual(cardOffer(b, 700, need3000 - 1), { limit: 1500 }, '还款能力差一块钱就降一档');
	b.hist.def = [600];
	assert.match((cardOffer(b, 700, 9999) as { blocked: string }).blocked, /违约/);
	b.hist.def = [];
	b.loans.push({ kind: 'personal', bal: 100, pay: 10, rate: 0.003, missed: 1 });
	assert.match((cardOffer(b, 700, 9999) as { blocked: string }).blocked, /没按时/);
	b.loans = [];
	b.card = { limit: 500, bal: 0, missed: 0 };
	assert.match((cardOffer(b, 700, 9999) as { blocked: string }).blocked, /已经有/);
});

test('审批：个人贷款要 600 分、金额范围、只能一笔、还款不超过能力；利率随分数', () => {
	const b = emptyBank();
	b.open = true;
	assert.match((personalOffer(b, 0, 9999, 1000) as { blocked: string }).blocked, /600/, '无记录（按 500）不够');
	b.hist = { since: 0, ok: 52, late: [], def: [], enq: [] };
	const day = 700;
	assert.match((personalOffer(b, day, 9999, BANK.personal.max + 1) as { blocked: string }).blocked, /金额/);
	assert.match((personalOffer(b, day, 9999, BANK.personal.min - 1) as { blocked: string }).blocked, /金额/);
	const o = personalOffer(b, day, 9999, 2000) as { rate: number; pay: number };
	assert.equal(o.rate, BANK.personalRates[0].rate, `${creditScore(b, day)} 分拿最低档利率`);
	assert.equal(o.pay, amortized(2000, o.rate, 52));
	assert.match((personalOffer(b, day, o.pay - 1, 2000) as { blocked: string }).blocked, /还款能力/);
	b.hist.ok = 20;
	assert.ok((personalOffer(b, 300, 9999, 2000) as { rate: number }).rate > o.rate, '分低利率高');
	b.loans.push({ kind: 'personal', bal: 100, pay: 10, rate: 0.003, missed: 0 });
	assert.match((personalOffer(b, day, 9999, 2000) as { blocked: string }).blocked, /已有/);
});

test('审批：车贷首付 10%、按车款扣折抵；房贷首付不到 20% 加贷款保险，按利率 +3 个百分点测还款', () => {
	const b = emptyBank();
	b.open = true;
	const o = carOffer(b, 0, 9999, 10000) as { down: number; loan: number; pay: number; rate: number };
	assert.equal(o.down, 1000);
	assert.equal(o.loan, 9000);
	assert.equal(o.pay, amortized(9000, BANK.carRates.at(-1)!.rate, BANK.car.weeks));
	assert.match((carOffer(b, 0, 9999, 0) as { blocked: string }).blocked, /不用贷款/);
	assert.match((carOffer(b, 0, o.pay - 1, 10000) as { blocked: string }).blocked, /还款能力/);

	const down = downPayment(flat);
	const principal = Math.round(flat.price * FINANCE.weeklyPrincipal);
	const h = homeOffer(b, 0, 9999, flat.price, down, principal, FINANCE.weeklyRate) as { loan: number; lmi: number; test: number };
	assert.equal(h.lmi, Math.round((flat.price - down) * BANK.lmiRate));
	assert.equal(h.loan, flat.price - down + h.lmi);
	assert.equal(h.test, principal + Math.round(h.loan * (FINANCE.weeklyRate + 0.03 / 52)));
	assert.ok(h.test > principal + Math.round(h.loan * FINANCE.weeklyRate), '缓冲让测算还款比实际还款高');
	const big = homeOffer(b, 0, 9999, flat.price, flat.price * 0.2, principal, FINANCE.weeklyRate) as { lmi: number };
	assert.equal(big.lmi, 0, '首付 20% 不交贷款保险');
	assert.match((homeOffer(b, 0, h.test - 1, flat.price, down, principal, FINANCE.weeklyRate) as { blocked: string }).blocked, /3 个百分点/);
	b.hist = { since: 0, ok: 0, late: [0], def: [], enq: [] };
	assert.match((homeOffer(b, 0, 9999, flat.price, down, principal, FINANCE.weeklyRate) as { blocked: string }).blocked, /信用分/, '刚记了逾期的人房贷不批');
});

test('还款能力：正式工作按每周 5 班算收入；买房自住不算现在的房租；已有还款、信用卡额度算负担', () => {
	const s = worker();
	assert.equal(bankIncome(make()), 0, '没工作收入 0');
	const income = bankIncome(s);
	assert.ok(income > 0);
	assert.equal(bankCapacity(s), Math.floor(income * BANK.dsr));
	s.home = { type: 'flat', loc: 'perth', furniture: {} };
	assert.ok(bankCapacity(s) < bankCapacity(s, true), '房租算负担；按揭自住时不算');
	const before = bankCapacity(s, true);
	s.bank.card = { limit: 1000, bal: 0, missed: 0 };
	assert.equal(bankCapacity(s, true), Math.floor((income - 30) * BANK.dsr), '信用卡按额度 3% 算');
	assert.ok(bankCapacity(s, true) < before);
});

// ---------- 动作 ----------
test('开户和办卡：开户一次；没开户不能办卡；办卡记一次申请、开始有信用记录；不改入参', () => {
	const s = make({ clock: at(10), job: JOB() });
	assert.equal(s.bank.open, false);
	assert.ok(!applyAction(s, WA, { t: 'bank', op: 'card' }).ok);
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'bank', op: 'open' });
	ok(r);
	assert.deepEqual(s, before);
	assert.equal(r.state.bank.open, true);
	assert.equal(r.state.bank.hist.since, -1, '开户本身不产生信用记录');
	assert.ok(!applyAction(r.state, WA, { t: 'bank', op: 'open' }).ok);
	const c = applyAction(r.state, WA, { t: 'bank', op: 'card' });
	ok(c);
	assert.equal(c.state.bank.card!.limit, 500);
	assert.deepEqual(c.state.bank.hist.enq, [0]);
	assert.equal(c.state.bank.hist.since, 0);
	assert.ok(!applyAction(make({ clock: at(10) }), WA, { t: 'bank', op: 'open' }).state.bank.card);
	const jobless = applyAction(make({ clock: at(10) }), WA, { t: 'bank', op: 'open' }).state;
	assert.match(applyAction(jobless, WA, { t: 'bank', op: 'card' }).msg, /收入/, '没收入不批信用卡');
});

test('取现：额度内到账、收手续费、不超额度；欠着款不能取；还款', () => {
	let s = worker();
	s = applyAction(s, WA, { t: 'bank', op: 'card' }).state;
	const cash = s.cash;
	const r = applyAction(s, WA, { t: 'bank', op: 'draw', amount: 300 });
	ok(r);
	assert.equal(r.state.cash, cash + 300);
	assert.equal(r.state.bank.card!.bal, 300 + cashFee(300));
	assert.ok(!applyAction(r.state, WA, { t: 'bank', op: 'draw', amount: 500 - r.state.bank.card!.bal }).ok, '加上手续费超额度');
	const p = applyAction(r.state, WA, { t: 'bank', op: 'repay', kind: 'card', amount: 99999 });
	ok(p);
	assert.equal(p.state.bank.card!.bal, 0);
	assert.equal(p.state.cash, r.state.cash - r.state.bank.card!.bal, '只还欠的钱');
	assert.ok(!applyAction(p.state, WA, { t: 'bank', op: 'repay', kind: 'card', amount: 1 }).ok, '没欠款不能还');
	const stuck = structuredClone(r.state);
	stuck.bank.card!.missed = 1;
	assert.ok(!applyAction(stuck, WA, { t: 'bank', op: 'draw', amount: 10 }).ok);
});

test('每周结算：信用卡计息、自动还最低；还不上收罚金，连续 2 次记逾期，9 次且够 $30 记违约、催收', () => {
	const b = emptyBank();
	b.open = true;
	b.hist.since = 0;
	b.card = { limit: 1500, bal: 1000, missed: 0 };
	let cash = settleBank(b, 1000, hooks(7));
	const bal = 1000 + Math.round(1000 * BANK.cardWeeklyRate);
	assert.equal(cash, 1000 - cardMinPay(bal));
	assert.equal(b.card.bal, bal - cardMinPay(bal));
	assert.equal(b.hist.ok, 1, '按时还款的一周');
	cash = 0;
	for (let w = 1; w <= BANK.defaultMissed; w++) {
		const h = hooks(7 + w * 7);
		cash = settleBank(b, cash, h);
		assert.equal(b.card.missed, w);
		if (w === BANK.lateMissed) assert.deepEqual(b.hist.late, [7 + w * 7]);
		if (w === BANK.defaultMissed) {
			assert.deepEqual(b.hist.def, [7 + w * 7]);
			assert.equal(b.card.def, true);
			assert.ok(h.logs.some((l) => l.includes('催收')));
		}
	}
	assert.equal(b.hist.ok, 1 - BANK.okLost < 0 ? 0 : 1 - BANK.okLost, '逾期扣掉按时周数');
	const frozen = b.card.bal;
	settleBank(b, 0, hooks(200));
	assert.equal(b.card.bal, frozen, '违约后不再计息、不再罚');
	assert.equal(b.hist.def.length, 1, '同一笔违约只记一次');
});

test('每周结算：一周里有一笔没还上，这周不算按时还款', () => {
	const b = emptyBank();
	b.open = true;
	b.loans.push({ kind: 'personal', bal: 1000, pay: 50, rate: 0.003, missed: 0 });
	b.bnpl.push({ item: 'mattress', amt: 100, left: 2, missed: 0, fees: 0, owe: 0 });
	settleBank(b, 60, hooks(7));
	assert.equal(b.loans[0].missed, 0, '贷款还上了');
	assert.equal(b.bnpl[0].missed, 1, '分期没还上');
	assert.equal(b.hist.ok, 0);
	settleBank(b, 1000, hooks(14));
	assert.equal(b.hist.ok, 1, '全都还上才算');
});

test('先买后付：引擎本身也要 ack（不只靠协议校验）', () => {
	const s = worker({ cash: 1000 });
	s.home = { type: 'flat', loc: 'perth', furniture: {} };
	const item = FURNITURE.find((f) => f.price >= 100)!;
	const r = buyFurnitureBnpl(s, WA, item.id, false);
	assert.ok(!r.ok);
	assert.match(r.msg, /风险提示/);
	assert.equal(r.state, s);
	ok(buyFurnitureBnpl(s, WA, item.id, true));
});

test('每周结算：欠款不到 $30 不记违约（$150 ÷ 5）', () => {
	const b = emptyBank();
	b.open = true;
	b.bnpl.push({ item: 'mattress', amt: 5, left: 3, missed: BANK.defaultMissed - 1, fees: 0, owe: 0 });
	settleBank(b, 0, hooks(100));
	assert.equal(b.bnpl[0].def, undefined);
	assert.deepEqual(b.hist.def, []);
});

test('每周结算：贷款等额本息还清后移除；没开户直接跳过', () => {
	const b = emptyBank();
	b.loans.push({ kind: 'personal', bal: 100, pay: 60, rate: 0.01, missed: 0 });
	assert.equal(settleBank(b, 500, hooks(7)), 500, '没开户不结算');
	b.open = true;
	let cash = settleBank(b, 500, hooks(7));
	assert.equal(cash, 440);
	assert.equal(b.loans[0].bal, 100 + 1 - 60);
	cash = settleBank(b, cash, hooks(14));
	assert.equal(b.loans.length, 0, '最后一期只还剩下的');
	assert.equal(cash, 440 - (41 + 0));
});

test('车贷：付首付买车；车是抵押物，还清前不能卖或换；连续欠款 5 次收车，拍卖不够的照样欠', () => {
	let s = worker({ cash: 3000, clock: at(10) });
	const deal = applyAction(s, WA, { t: 'bank', op: 'carloan', id: car.id });
	ok(deal);
	s = deal.state;
	const loan = s.bank.loans.find((l) => l.kind === 'car')!;
	assert.equal(s.vehicle, car.id);
	// 合并 main 后：车款含过户印花税（dealerAt 的 net），首付按含税车款的 10%
	const net = dealerAt(worker({ cash: 3000, clock: at(10) }), WA).find((o) => o.vehicle.id === car.id)!.net;
	assert.ok(net > car.price, '车款含印花税');
	assert.equal(loan.bal, net - Math.ceil(net * 0.1));
	assert.equal(s.cash, 3000 - Math.ceil(net * 0.1));
	assert.equal(loan.vehicle, car.id);
	assert.match(applyAction(s, WA, { t: 'vehicle', op: 'sell' }).msg, /车贷/);
	assert.match(applyAction(s, WA, { t: 'vehicle', op: 'buy', id: 'camper' }).msg, /车贷/);
	assert.ok(!applyAction(s, WA, { t: 'bank', op: 'carloan', id: 'camper' }).ok, '已有车贷不能再贷');

	const b = structuredClone(s.bank);
	const l = b.loans[0];
	let taken = '';
	for (let w = 1; w <= BANK.repossessMissed; w++) {
		const h = hooks(w * 7, { repossess: (v) => { taken = v; return 1000; } });
		settleBank(b, 0, h);
		if (w === 1) assert.ok(h.logs.some((x) => x.includes('30 天')), '第一次欠款发违约通知');
	}
	assert.equal(taken, car.id);
	assert.equal(l.vehicle, undefined);
	assert.ok(l.bal > 0, '拍卖不够，差额照样欠');
	assert.equal(b.loans.length, 1);
});

test('车贷收车（经引擎）：车没了、里程清零；之后不再收车', () => {
	const s = worker({ cash: 3000 });
	let t = applyAction(s, WA, { t: 'bank', op: 'carloan', id: car.id }).state;
	t = { ...t, cash: 0, job: null };
	const resale = resaleValue(car.id);
	t = passTo(t, 7 * BANK.repossessMissed + 1);
	assert.equal(t.vehicle, 'none');
	assert.deepEqual(t.car, { km: 0, since: 0 });
	const l = t.bank.loans.find((x) => x.kind === 'car')!;
	assert.ok(l && !l.vehicle);
	assert.ok(t.journal.some((j) => j.text.includes(`拍卖抵了 $${Math.round(resale * BANK.repossessShare)}`)));
});

test('个人贷款（经动作）：没记录不批；记录够了到账、每周扣；还清', () => {
	const s = worker({ cash: 100 });
	assert.match(applyAction(s, WA, { t: 'bank', op: 'loan', amount: 1000 }).msg, /600/);
	s.bank.hist = { since: 0, ok: 30, late: [], def: [], enq: [] };
	const r = applyAction(s, WA, { t: 'bank', op: 'loan', amount: 1000 });
	ok(r);
	assert.equal(r.state.cash, 1100);
	assert.equal(r.state.bank.loans[0].bal, 1000);
	const p = applyAction(r.state, WA, { t: 'bank', op: 'repay', kind: 'personal', amount: 5000 });
	ok(p);
	assert.equal(p.state.bank.loans.length, 0);
	assert.equal(p.state.cash, 100);
});

test('房贷（经动作）：要开户；批了加贷款保险、记申请；低收入不批；全款不受影响', () => {
	const s = worker({ cash: 20000 });
	const r = applyAction(s, WA, { t: 'property', op: 'buy', id: flat.id, loan: true });
	ok(r);
	const offer = homeLoanOffer(s, flat.id) as { lmi: number };
	assert.equal(r.state.properties[0].loan, flat.price - downPayment(flat) + offer.lmi);
	assert.ok(r.msg.includes(`贷款共 $${r.state.properties[0].loan}，`), '提示按并进贷款保险之后的贷款额说（合并 main 时复核）');
	assert.equal(r.state.bank.hist.enq.length, 1);
	const lowJob = make({ cash: 20000, clock: at(10), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	lowJob.bank.open = true;
	const no = applyAction(lowJob, WA, { t: 'property', op: 'buy', id: flat.id, loan: true });
	assert.ok(!no.ok);
	assert.match(no.msg, /房贷没批/);
	assert.deepEqual(no.state, lowJob, '没批不改存档、不记申请');
	ok(applyAction(make({ cash: 100000, clock: at(10) }), WA, { t: 'property', op: 'buy', id: flat.id, loan: false }));
});

test('房贷的信用记录：欠款满 14 天记逾期；断供强制卖房记违约', () => {
	const b = emptyBank();
	b.open = true;
	settleBank(b, 0, hooks(14, { before: [{ id: flat.id, loan: 1000 }], after: [{ id: flat.id, loan: 1001, missed: 2 }] }));
	assert.deepEqual(b.hist.late, [14]);
	settleBank(b, 0, hooks(21, { before: [{ id: flat.id, loan: 1001 }], after: [] }));
	assert.deepEqual(b.hist.def, [21]);
	settleBank(b, 0, hooks(28, { before: [{ id: 'x', loan: 0 }], after: [] }));
	assert.equal(b.hist.def.length, 1, '没贷款的房（结算期间不会消失）不记');
	const ok1 = emptyBank();
	ok1.open = true;
	settleBank(ok1, 0, hooks(7, { before: [{ id: flat.id, loan: 1000 }], after: [{ id: flat.id, loan: 990, missed: 0 }] }));
	assert.equal(ok1.hist.ok, 1, '按时还房贷算按时周');
});

test('房贷断供（经引擎）：强制卖房后信用记录有违约', () => {
	let s = worker({ cash: 20000 });
	s = applyAction(s, WA, { t: 'property', op: 'buy', id: flat.id, loan: true }).state;
	s = { ...s, cash: 0, job: null };
	s = passTo(s, 7 * (FINANCE.graceWeeks + 2));
	assert.equal(s.properties.length, 0);
	assert.equal(s.bank.hist.late.length, 1);
	assert.equal(s.bank.hist.def.length, 1);
	assert.ok(creditScore(s.bank, Math.floor(s.clock / 1440))! < BANK.homeMinScore);
});

test('先买后付：要确认风险提示；付第一期、之后每周一期；每次申请记一次查询；最多 4 笔', () => {
	assert.equal(parseAction({ t: 'bank', op: 'bnpl', id: 'mattress' }), null, '不带 ack 不受理');
	assert.equal(parseAction({ t: 'bank', op: 'bnpl', id: 'mattress', ack: 'yes' }), null);
	let s = worker({ cash: 1000 });
	s.home = { type: 'flat', loc: 'perth', furniture: {} };
	const item = FURNITURE.find((f) => f.price >= 100)!;
	const r = applyAction(s, WA, { t: 'bank', op: 'bnpl', id: item.id, ack: true });
	ok(r);
	const amt = Math.floor(item.price / 4);
	const first = item.price - amt * 3;
	assert.equal(r.state.cash, 1000 - first);
	assert.equal(r.state.home!.furniture[item.slot], item.id);
	assert.deepEqual(r.state.bank.bnpl, [{ item: item.id, amt, left: 3, missed: 0, fees: 0, owe: 0 }]);
	assert.equal(r.state.bank.hist.enq.length, 1);
	assert.equal(netWorth(r.state), netWorth({ ...r.state, bank: { ...r.state.bank, bnpl: [] } }) - amt * 3, '净资产扣掉没付的分期');
	s = r.state;
	assert.ok(!applyAction({ ...s, cash: 0 }, WA, { t: 'bank', op: 'bnpl', id: FURNITURE.find((f) => f.slot !== item.slot && f.price >= 8)!.id, ack: true }).ok, '第一期付不起');
	const b = structuredClone(s.bank);
	b.bnpl = Array.from({ length: BANK.bnplMax }, () => ({ item: item.id, amt: 1, left: 1, missed: 0, fees: 0, owe: 0 }));
	assert.ok(!applyAction({ ...s, bank: b }, WA, { t: 'bank', op: 'bnpl', id: item.id, ack: true }).ok, '满 4 笔');
});

test('先买后付结算：付不上收逾期费、随下一期扣；逾期费合计不超过订单 25%；付完移除', () => {
	const b = emptyBank();
	b.open = true;
	b.bnpl.push({ item: 'mattress', amt: 4, left: 2, missed: 0, fees: 0, owe: 0 });
	for (let i = 0; i < 6; i++) settleBank(b, 0, hooks(7 * (i + 1)));
	const p = b.bnpl[0];
	assert.equal(p.fees, Math.floor(4 * 4 * BANK.bnplFeeCap), '封顶');
	assert.equal(p.owe, p.fees);
	assert.deepEqual(b.hist.late, [14]);
	let cash = settleBank(b, 100, hooks(60));
	assert.equal(cash, 100 - 4 - p.fees);
	assert.equal(b.bnpl[0].owe, 0);
	cash = settleBank(b, cash, hooks(67));
	assert.equal(b.bnpl.length, 0);
});

test('净资产扣掉欠银行的钱', () => {
	const s = worker({ cash: 1000 });
	const base = netWorth(s);
	s.bank.card = { limit: 500, bal: 120, missed: 0 };
	s.bank.loans.push({ kind: 'personal', bal: 300, pay: 10, rate: 0.003, missed: 0 });
	assert.equal(bankDebt(s.bank), 420);
	assert.equal(netWorth(s), base - 420);
});

test('界面：银行卡片各种状态都能画；插值走 esc；先买后付确认框带全部风险提示', () => {
	const esc = (v: unknown) => String(v).replace(/[&<>"']/g, '_');
	const closed = bankCardHtml(make(), esc);
	assert.match(closed, /data-bank="open"/);
	assert.match(closed, /不是理财建议/);
	const s = worker();
	s.bank.hist = { since: 0, ok: 5, late: [0], def: [], enq: [0] };
	s.bank.card = { limit: 500, bal: 300, missed: 1 };
	s.bank.loans.push({ kind: 'car', bal: 900, pay: 10, rate: 0.0021, missed: 0, vehicle: 'car' });
	s.bank.bnpl.push({ item: 'mattress', amt: 10, left: 2, missed: 0, fees: 2, owe: 2 });
	const html = bankCardHtml(s, esc);
	for (const want of ['信用分', '已欠款 1 次', '车是抵押物', '另欠逾期费 $2', 'data-bank-kind="car"']) assert.ok(html.includes(want), want);
	assert.ok(!/<[^>]*<[^>]*>/.test(html.replace(/<[^<>]*>/g, '')), '没有残缺标签');
	assert.match(carLoanButton(s, 'a"b', 5000, esc), /data-bank-id="a_b"/, 'id 也经过 esc');
	assert.equal(bnplButton(make(), 'mattress', 100, esc), '', '没开户不显示');
	const t = bnplConfirmText('床垫', 25, 25);
	for (const w of BNPL_WARNING) assert.ok(t.includes(w));
	assert.equal(homeLoanNote(make(), flat.id).ok, false);
	assert.equal(homeLoanNote(worker(), flat.id).ok, true);
});

// ---------- 协议和存档 ----------
test('parseAction：银行动作只收形状对的；金额取整、要 ≥1 且有上限；利率、额度不收客户端的', () => {
	assert.deepEqual(parseAction({ t: 'bank', op: 'open', rate: 0 }), { t: 'bank', op: 'open' });
	assert.deepEqual(parseAction({ t: 'bank', op: 'draw', amount: 99.9 }), { t: 'bank', op: 'draw', amount: 99 });
	assert.deepEqual(parseAction({ t: 'bank', op: 'loan', amount: 500, rate: 0, weeks: 9999 }), { t: 'bank', op: 'loan', amount: 500 });
	assert.deepEqual(parseAction({ t: 'bank', op: 'repay', kind: 'car', amount: 1 }), { t: 'bank', op: 'repay', kind: 'car', amount: 1 });
	assert.deepEqual(parseAction({ t: 'bank', op: 'carloan', id: 'car' }), { t: 'bank', op: 'carloan', id: 'car' });
	for (const bad of [
		{ t: 'bank', op: 'draw', amount: 0 }, { t: 'bank', op: 'draw', amount: 0.5 }, { t: 'bank', op: 'draw', amount: -5 }, { t: 'bank', op: 'draw', amount: NaN },
		{ t: 'bank', op: 'draw', amount: 1e7 }, { t: 'bank', op: 'draw', amount: '100' }, { t: 'bank', op: 'loan' }, { t: 'bank', op: 'repay', kind: 'house', amount: 5 },
		{ t: 'bank', op: 'repay', kind: '__proto__', amount: 5 }, { t: 'bank', op: 'carloan', id: '../x' }, { t: 'bank', op: 'steal' }, { t: 'bank' },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
});

test('存档清洗：旧存档没有 bank 是未开户；有房贷的旧存档视为已开户；坏值不抛、钳住；幂等', () => {
	const s = make({ clock: at(10, 30) });
	const old: Record<string, unknown> = structuredClone(s) as unknown as Record<string, unknown>;
	delete old.bank;
	assert.deepEqual(sanitizeState(old)!.bank, emptyBank());
	const withMortgage = { ...old, properties: [{ id: flat.id, loan: 5000, rented: false, missed: 0 }] };
	assert.equal(sanitizeState(withMortgage)!.bank.open, true);
	for (const raw of [null, 5, 'x', [], { open: 'yes' }, { open: true, hist: null, card: [], loans: {}, bnpl: 'x' }, Object.create({ open: true })]) {
		const c = sanitizeState({ ...old, bank: raw })!;
		assert.ok(c, JSON.stringify(raw));
		assert.deepEqual(sanitizeState(c), c, '幂等');
	}
	const dirty = {
		...old,
		bank: {
			open: true,
			card: { limit: 999999, bal: 5 },
			loans: [{ kind: 'personal', bal: 1e12, pay: -3, rate: 5, missed: 1e9 }, { kind: 'personal', bal: 50 }, { kind: 'car', bal: 900, vehicle: 'tank', rate: BANK.carRates[0].rate, pay: 30 }, { kind: 'boat', bal: 9 }],
			bnpl: [{ item: 'mattress', amt: 10, left: 99, fees: 1, owe: 50 }, { item: 'nope', amt: 1, left: 1 }, ...Array(9).fill({ item: 'mattress', amt: 1, left: 1 })],
			hist: { since: 9999, ok: 1e6, late: [1, 2, 'x', 99999, -1], def: Array(50).fill(3), enq: [5.5, 6] },
		},
	};
	const c = sanitizeState(dirty)!;
	assert.equal(c.bank.card, null, '不存在的额度档：卡作废');
	assert.equal(c.bank.loans.length, 2);
	const p = c.bank.loans[0];
	assert.equal(p.bal, 1e6);
	assert.ok(p.pay >= 1 && p.rate === BANK.personalRates.at(-1)!.rate && p.missed === 520);
	assert.equal(c.bank.loans[1].vehicle, undefined, '不认识的车：抵押物去掉');
	assert.equal(c.bank.bnpl.length, BANK.bnplMax - 1, '不认识的家具丢掉，总数有上限');
	assert.equal(c.bank.bnpl[0].left, BANK.bnplParts - 1);
	assert.equal(c.bank.bnpl[0].owe, 1, '没付的逾期费不超过已收的');
	assert.equal(c.bank.hist.since, 30, '不晚于今天');
	assert.equal(c.bank.hist.ok, BANK.okCap);
	assert.deepEqual(c.bank.hist.late, [1, 2], '未来、负数、非整数的日期丢掉');
	assert.equal(c.bank.hist.def.length, HIST_MAX);
	assert.deepEqual(c.bank.hist.enq, [6]);
	assert.deepEqual(sanitizeState(c), c, '幂等');
	const noSince = sanitizeState({ ...old, bank: { open: true, hist: { since: -1, enq: [4, 9] } } })!;
	assert.equal(noSince.bank.hist.since, 4, '有记录却没写 since：从最早一条算');
	assert.deepEqual(cleanBank({ open: false, card: { limit: 500, bal: 0 } }, 0, false, VEH, FURN), emptyBank(), '没开户的不留信用产品');
	assert.deepEqual(publicState(c).bank, c.bank, '银行数据不是秘密，客户端要显示');
});

// ---------- 合并 main 后（世界经济、印花税和里程、二手市场、生涯统计） ----------
test('合并 main：房贷审批按今天的利率指数测算，和实际扣的利息一致', () => {
	let day = -1;
	for (let d = 0; d < 3000 && day < 0; d++) if (Math.abs(loanRateMult(d) - 1) > 0.05) day = d;
	assert.ok(day >= 0, '找得到利率明显偏离中枢的一天');
	const s = worker({ clock: at(10, day), job: JOB(2) });
	const o = homeLoanOffer(s, flat.id);
	const want = homeOffer(s.bank, day, bankCapacity(s, true), flat.price, downPayment(flat), Math.round(flat.price * FINANCE.weeklyPrincipal), FINANCE.weeklyRate * loanRateMult(day));
	const flatRate = homeOffer(s.bank, day, bankCapacity(s, true), flat.price, downPayment(flat), Math.round(flat.price * FINANCE.weeklyPrincipal), FINANCE.weeklyRate);
	assert.deepEqual(o, want);
	if ('test' in want && 'test' in flatRate) assert.notEqual(want.test, flatRate.test, '利率指数确实改变了测算还款');
});

test('合并 main：邻里换手墙卖车也要先还清车贷', () => {
	const s = applyAction(worker({ cash: 3000 }), WA, { t: 'bank', op: 'carloan', id: car.id }).state;
	const good = SWAP_GOODS.find((g) => g.kind === 'vehicle' && g.ref === car.id)!;
	assert.match(sellBlockedSwap(s, good) ?? '', /车贷/);
	const paid = { ...s, bank: { ...s.bank, loans: [] } };
	assert.doesNotMatch(sellBlockedSwap(paid, good) ?? '', /车贷/);
});

test('合并 main：收车按里程折旧后的残值拍卖', () => {
	const s = worker({ cash: 3000 });
	let t = applyAction(s, WA, { t: 'bank', op: 'carloan', id: car.id }).state;
	t = { ...t, cash: 0, job: null, car: { km: 60000, since: 0 } };
	const got = Math.round(resaleValue(car.id, 60000) * BANK.repossessShare);
	assert.ok(got < Math.round(resaleValue(car.id) * BANK.repossessShare), '开得多的车更不值钱');
	t = passTo(t, 7 * BANK.repossessMissed + 1);
	assert.equal(t.vehicle, 'none');
	assert.ok(t.journal.some((j) => j.text.includes(`拍卖抵了 $${got}`)));
});

test('合并 main：生涯统计——车贷算车、先买后付算住房、其他银行动作和周结算扣的还款算「其他」', () => {
	assert.deepEqual(actionCats({ t: 'bank', op: 'carloan', id: car.id }), ['vehicle', 'vehicle']);
	assert.deepEqual(actionCats({ t: 'bank', op: 'bnpl', id: 'mattress', ack: true }), ['housing', 'housing']);
	assert.deepEqual(actionCats({ t: 'bank', op: 'loan', amount: 500 }), ['other', 'other']);
	const s = worker({ cash: 3000 });
	s.bank.loans.push({ kind: 'personal', bal: 500, pay: 60, rate: 0.003, missed: 0 });
	const before = s.tally!.out.other ?? 0;
	const t = passTo(s, 8);
	assert.ok((t.tally!.out.other ?? 0) - before >= 60, '周结算自动扣的贷款还款记「其他」');
});

test('合并 main：还款能力里的出租收入按租金指数实收；使用统计按银行动作分开记', () => {
	let day = -1;
	for (let d = 0; d < 3000 && day < 0; d++) if (Math.abs(rentOn(flat.rentIncome, d) - flat.rentIncome) >= 5) day = d;
	assert.ok(day >= 0, '找得到租金指数明显偏离的一天');
	const s = worker({ clock: at(10, day), properties: [{ id: flat.id, loan: 0, rented: true, missed: 0 } as PlayerState['properties'][number]] });
	const commit = weeklyCosts(s).total + bankWeekly(s.bank) + Math.round((s.bank.card?.limit ?? 0) * BANK.cardCommit);
	assert.equal(bankCapacity(s), capacity(bankIncome(s), rentOn(flat.rentIncome, day), commit));
	assert.notEqual(bankCapacity(s), capacity(bankIncome(s), flat.rentIncome, commit), '和不按指数的结果不同（测试本身有区分力）');
	for (const op of ['open', 'card', 'draw', 'loan', 'carloan', 'bnpl', 'repay'] as const) assert.equal(featureOf({ t: 'bank', op } as never), `bank.${op}`);
});

// ---------- 合并 main 时复核修正 ----------
test('复核：手动少还不能清零拖欠次数；补上几期减几次，补齐才清零', () => {
	const b = emptyBank();
	b.open = true;
	b.loans.push({ kind: 'car', bal: 3000, pay: 60, rate: 0.002, missed: 3, vehicle: car.id });
	assert.equal(repayDebt(b, 'car', 1, 1000), 1);
	assert.equal(b.loans[0].missed, 3, '还 $1 不算补上');
	repayDebt(b, 'car', 60, 1000);
	assert.equal(b.loans[0].missed, 2, '补上一期少算一次');
	repayDebt(b, 'car', 120, 1000);
	assert.equal(b.loans[0].missed, 0, '补齐才清零');
	b.card = { limit: 1500, bal: 1000, missed: 2 };
	repayDebt(b, 'card', 1, 1000);
	assert.equal(b.card.missed, 2);
	repayDebt(b, 'card', cardMinPay(999) * 2, 5000);
	assert.equal(b.card.missed, 0);
	// 每周还 $1 的老办法：照样走到收车
	const c = emptyBank();
	c.open = true;
	c.loans.push({ kind: 'car', bal: 3000, pay: 60, rate: 0.002, missed: 0, vehicle: car.id });
	let taken = '';
	for (let w = 1; w <= BANK.repossessMissed; w++) {
		settleBank(c, 0, hooks(w * 7, { repossess: (v) => { taken = v; return 100; } }));
		if (c.loans[0]?.vehicle) repayDebt(c, 'car', 1, 1);
	}
	assert.equal(taken, car.id, '每周只还 $1 躲不过收车');
});

test('复核：收车拍卖款超过欠款时，多出的退给玩家', () => {
	const b = emptyBank();
	b.open = true;
	b.loans.push({ kind: 'car', bal: 500, pay: 60, rate: 0, missed: BANK.repossessMissed - 1, vehicle: car.id });
	const h = hooks(70, { repossess: () => 2000 });
	const cash = settleBank(b, 0, h);
	assert.equal(b.loans.length, 0, '还清了');
	assert.ok(cash > 1400 && cash <= 1500, `多出的退回现金：${cash}`);
	assert.ok(h.logs.some((x) => x.includes('退给了你')));
});

test('复核：还款能力算上自己店每周的固定开销和欠税分期；车贷按钮在已有车贷时禁用；房产卡的贷款额含贷款保险', () => {
	const s = worker();
	const base = bankCapacity(s);
	const taxed = worker();
	taxed.tax = { ...taxed.tax, debt: 400 };
	assert.ok(bankCapacity(taxed) < base, '欠税分期算开销');
	const shopped = worker();
	shopped.biz = { ...shopped.biz!, shop: { type: SHOP_TYPES[0].id, site: SHOP_SITES[0].id, day: 0, last: 0, stock: 0, staff: 1, tend: -1, rep: 50, debt: 0, bond: 0, hist: [] } };
	assert.ok(bankCapacity(shopped) < base, '店的房租和工资算开销');
	const held = worker({ cash: 3000 });
	held.bank.loans.push({ kind: 'car', bal: 500, pay: 60, rate: 0, missed: 0 });
	assert.match(carLoanButton(held, car.id, 4000, (x) => String(x)), /disabled title="已有一笔车贷/);
	const rich = worker({ job: JOB(2), cash: 50000 });
	const note = homeLoanNote(rich, 'kal-cottage');
	const offer = homeLoanOffer(rich, 'kal-cottage');
	assert.ok('loan' in offer, '有工作、现金够的人能批小屋');
	if ('loan' in offer) {
		assert.equal(note.loan, offer.loan);
		assert.ok(offer.lmi > 0 && note.loan! > offer.loan - offer.lmi);
	}
});

