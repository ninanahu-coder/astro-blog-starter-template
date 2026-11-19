// 税务系统（docs/earth-game/tax.md）：税额计算、预扣、记账、财年结转、报税、存档清洗、动作协议、界面卡片。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, ORIGINS, sanitizeState } from '../../src/game/core/character.ts';
import { applyAbn, applyTfn, lodgeReturn } from '../../src/game/core/tax-actions.ts';
import { assess, cleanTax, emptyBook, latePenalty, lodgeWindow, returnPreview, taxStatus, taxTick, withholding } from '../../src/game/core/tax.ts';
import { YEAR_DAYS } from '../../src/game/core/time.ts';
import { ACTIVITY_INCOME, NO_TFN_RATE, ORIGIN_TAX, TAX_BANDS, TAX_GAME } from '../../src/game/data/tax.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { getProperty } from '../../src/game/core/engine.ts';
import { taxCard } from '../../src/game/ui/tax.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState, TaxBook } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (origin = 'student', over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'tax-player', name: '税', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const withTfn = (s: PlayerState, tax: Partial<PlayerState['tax']> = {}): PlayerState => ({ ...s, tax: { ...s.tax, tfn: 0, ...tax } });
const book = (b: Partial<TaxBook>): TaxBook => ({ ...emptyBook(), ...b });
const sc = TAX_GAME.scale;
/** 游戏里按 scale 缩小的现实金额：所有门槛都乘 scale、税率不变，所以税额也正好缩小 scale 倍 */
const real = (realIncome: number, origin: string) => assess(book({ wages: realIncome * sc }), taxStatus(origin)).tax;
const near = (actual: number, expected: number, msg: string) => assert.ok(Math.abs(actual - expected) <= 1, `${msg}：得到 ${actual}，应为 ${expected}`);

test('数据：税档从低到高、税率不降；每个出身都有税务身份；活动收入性质引用的活动都存在', () => {
	for (const [k, bands] of Object.entries(TAX_BANDS)) {
		assert.equal(bands.at(-1)!.upTo, null, `${k} 最后一档不封顶`);
		for (let i = 1; i < bands.length; i++) {
			assert.ok(bands[i].rate >= bands[i - 1].rate, `${k} 税率不降`);
			if (bands[i].upTo !== null) assert.ok(bands[i].upTo! > bands[i - 1].upTo!, `${k} 门槛递增`);
		}
	}
	for (const o of ORIGINS) assert.ok(ORIGIN_TAX[o.id], `${o.id} 有税务身份`);
	for (const id of Object.keys(ACTIVITY_INCOME)) assert.ok(ACTIVITIES.some((a) => a.id === id), `${id} 活动存在`);
	assert.ok(sc > 0 && sc < 1);
});

test('税额：按 ATO 2026–27 税率（现实金额 × scale）', () => {
	// 居民 $60,000：(45,000−18,200)×15% + 15,000×30% = 8,520；LITO 325 − 15,000×1.5% = 100；Medicare 2% = 1,200
	near(real(60000, 'fifo'), Math.round(9620 * sc), '居民 $60k');
	near(real(60000, 'student'), Math.round(8420 * sc), '留学生（居民、免 Medicare）$60k');
	// 打工度假 $60,000：45,000×15% + 15,000×30% = 11,250，没有 LITO、不交 Medicare
	near(real(60000, 'backpacker'), Math.round(11250 * sc), '打工度假 $60k');
	assert.equal(real(18000, 'fifo'), 0, '居民免税额以内不交税');
	assert.ok(real(18000, 'backpacker') > 0, '打工度假第一块钱起就交税');
	// 居民 $30,000：1,770 − LITO 700；Medicare 在低收入减免区间：(30,000 − 28,011)×10% = 198.9
	near(real(30000, 'fifo'), Math.round((1770 - 700 + 198.9) * sc), '居民 $30k 的 Medicare 减免');
	// 居民 $40,000：LITO 700 − 2,500×5% = 575
	near(real(40000, 'student'), Math.round((3270 - 575) * sc), '居民 $40k 的 LITO 第一段递减');
	// LITO 只抵到 0，不倒退钱
	assert.equal(assess(book({ wages: 19000 * sc }), taxStatus('student')).tax, 0);
	// 出租亏损抵工资（负扣税），应税收入不低于 0
	const a = assess(book({ wages: 50000 * sc, rent: 1000, rentCost: 3000 }), taxStatus('fifo'));
	assert.equal(a.taxable, Math.round(50000 * sc) - 2000);
	assert.equal(assess(book({ rent: 100, rentCost: 900 }), taxStatus('fifo')).taxable, 0);
});

test('预扣：没 TFN 按最高税率，在等号码和已有 TFN 按正常税率，按一笔 × 一年工作日折年', () => {
	const s = make('student');
	assert.equal(s.tax.tfn, -1, '新角色没有 TFN');
	assert.equal(withholding(s, 100), Math.round(100 * NO_TFN_RATE.resident));
	assert.equal(withholding(make('backpacker'), 100), Math.round(100 * NO_TFN_RATE.whm));
	const waiting = { ...s, tax: { ...s.tax, tfn: 99 } };
	const ok = withTfn(s);
	const d = TAX_GAME.payDaysPerYear;
	const expect = Math.round(assess(book({ wages: 300 * d }), taxStatus('student')).tax / d);
	assert.equal(withholding(ok, 300), expect);
	assert.equal(withholding(waiting, 300), expect, '等号码期间雇主有宽限，按正常税率');
	assert.equal(withholding(ok, 0), 0);
	assert.ok(withholding(ok, 300) < withholding(s, 300), '有 TFN 比没有扣得少');
	for (const g of [1, 50, 120, 620, 5000]) assert.ok(withholding(ok, g) <= g && withholding(ok, g) >= 0, `预扣不超过工资：${g}`);
});

test('上班：到手 = 工资 − 预扣，税前工资和预扣记进本财年账目；入参不变', () => {
	const hired = applyAction(withTfn(make('fifo', { clock: at(5), loc: 'kalgoorlie', skills: { ...make('fifo').skills, strength: 40 } })), WA, { t: 'job', op: 'apply', career: 'miner' }).state;
	const s = { ...hired, needs: { hunger: 95, energy: 95, hygiene: 90, fun: 80, social: 80 } };
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'job', op: 'work' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不修改入参');
	const b = r.state.tax.book;
	assert.ok(b.wages >= 300 && b.withheld > 0, `记账 ${JSON.stringify(b)}`);
	assert.equal(b.withheld, withholding(s, b.wages));
	assert.equal(r.state.cash, s.cash + b.wages - b.withheld);
	assert.match(r.msg, /预扣税/);
});

test('零工与街头表演：临时工预扣；街头表演没 ABN 是爱好不计税，有 ABN 多挣且记生意收入；捡瓶子不是收入', () => {
	const base = withTfn(make('student', { clock: at(10), needs: { hunger: 95, energy: 95, hygiene: 90, fun: 80, social: 80 } }));
	const cafe = applyAction(base, WA, { t: 'activity', id: 'work-cafe' });
	assert.ok(cafe.ok, cafe.msg);
	const gross = ACTIVITIES.find((a) => a.id === 'work-cafe')!.fx.cash!;
	assert.equal(cafe.state.tax.book.wages, gross);
	assert.ok(cafe.state.tax.book.withheld > 0, '临时工也预扣');
	assert.equal(cafe.state.tax.book.withheld, withholding(base, gross));
	assert.equal(cafe.state.cash, base.cash + gross - cafe.state.tax.book.withheld);

	const busk = ACTIVITIES.find((a) => a.id === 'busk')!.fx.cash!;
	const hobby = applyAction(base, WA, { t: 'activity', id: 'busk' });
	assert.ok(hobby.ok, hobby.msg);
	assert.equal(hobby.state.cash, base.cash + busk, '爱好收入原样到手');
	assert.deepEqual(hobby.state.tax.book, emptyBook(), '爱好收入不记账');
	const biz = applyAction({ ...base, tax: { ...base.tax, abn: true } }, WA, { t: 'activity', id: 'busk' });
	assert.equal(biz.state.tax.book.biz, Math.round(busk * (1 + TAX_GAME.abnBonus)));
	assert.equal(biz.state.cash, base.cash + biz.state.tax.book.biz, '个体户收入不预扣');

	const bottles = applyAction(base, WA, { t: 'activity', id: 'recycle' });
	assert.ok(bottles.ok, bottles.msg);
	assert.deepEqual(bottles.state.tax.book, emptyBook());
});

test('出租：租金和可抵扣费用（物业费、利息、维修）在周结算时记账；自住不记', () => {
	const def = getProperty('perth-apartment')!;
	const s = withTfn(make('fifo', { clock: at(23, 6), cash: 50000, nextWeek: 7, properties: [{ id: def.id, loan: 50000, rented: true, missed: 0 }] }));
	const r = applyAction(s, WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok, r.msg);
	const b = r.state.tax.book;
	let paid = 0;
	for (let seed = 1; seed <= 8; seed++) {
		const x = applyAction({ ...s, seed }, WA, { t: 'activity', id: 'rest' }).state;
		const vacant = x.journal.some((j) => j.text.includes('空置'));
		assert.equal(x.tax.book.rent, vacant ? 0 : def.rentIncome, '租金收入（空置那周没有）');
		if (!vacant) paid++;
	}
	assert.ok(paid > 0, '几个种子里总有收到租金的');
	assert.ok(b.rentCost >= def.weekly + 50, `物业费 + 利息：${b.rentCost}`);
	const own = applyAction({ ...s, properties: [{ id: def.id, loan: 50000, rented: false, missed: 0 }] }, WA, { t: 'activity', id: 'rest' });
	assert.deepEqual(own.state.tax.book, emptyBook(), '自住的费用不能抵税');
});

test('财年结转：跨进新一年时账目转成待申报，没有收入的年份不用报', () => {
	const end = YEAR_DAYS - 1;
	const s = withTfn(make('fifo', { clock: at(23, end), nextWeek: YEAR_DAYS }), { book: book({ wages: 5000, withheld: 700 }) });
	const r = applyAction(s, WA, { t: 'activity', id: 'rest' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tax.fy, 2);
	assert.deepEqual(r.state.tax.ret, { fy: 1, ...book({ wages: 5000, withheld: 700 }) });
	assert.deepEqual(r.state.tax.book, emptyBook());
	assert.ok(r.state.journal.some((j) => j.text.includes('报税期开始')));
	const quiet = applyAction(withTfn(make('fifo', { clock: at(23, end), nextWeek: YEAR_DAYS })), WA, { t: 'activity', id: 'rest' });
	assert.equal(quiet.state.tax.ret, null);
	assert.equal(quiet.state.tax.fy, 2);
});

test('报税：退税入账、补税扣钱，付不起的进分期；要有 TFN；不修改入参', () => {
	const day = YEAR_DAYS + 3;
	const refund = withTfn(make('fifo', { clock: at(10, day), cash: 100 }), { fy: 2, ret: { fy: 1, ...book({ wages: 3000, withheld: 900 }) } });
	const p = returnPreview(refund)!;
	assert.ok(p.due < 0 && !p.late && p.daysLeft === TAX_GAME.lodgeDays - 3);
	const before = structuredClone(refund);
	const r1 = lodgeReturn(refund);
	assert.ok(r1.ok, r1.msg);
	assert.deepEqual(refund, before);
	assert.equal(r1.state.cash, 100 - p.due);
	assert.equal(r1.state.tax.ret, null);
	assert.deepEqual(r1.state.tax.last, { fy: 1, due: p.due, penalty: 0 });
	assert.equal(lodgeReturn(r1.state).ok, false, '报过了不能再报');

	const owe = { ...refund, tax: { ...refund.tax, ret: { fy: 1, ...book({ wages: 9000, withheld: 0 }) } } };
	const due = returnPreview(owe)!.due;
	const r2 = lodgeReturn({ ...owe, cash: 100 });
	assert.equal(r2.state.cash, 0);
	assert.equal(r2.state.tax.debt, due - 100, '付不起的进分期');
	const r3 = lodgeReturn({ ...owe, cash: 1e6 });
	assert.equal(r3.state.cash, 1e6 - due);
	assert.equal(r3.state.tax.debt, 0);

	const noTfn = lodgeReturn({ ...refund, tax: { ...refund.tax, tfn: -1 } });
	assert.equal(noTfn.ok, false);
	assert.match(noTfn.msg, /先有 TFN/);
	assert.equal(lodgeReturn(withTfn(make())).ok, false, '没有待申报的税表');
	assert.equal(lodgeReturn({ ...refund, pending: { eventId: 'x' } }).ok, false);
});

test('逾期：报税期过后要补税的按逾期天数罚款（有上限），退税的不罚', () => {
	const { end } = lodgeWindow(1);
	assert.equal(latePenalty(1, end - 1, 500), 0);
	assert.equal(latePenalty(1, end, 500), TAX_GAME.lateUnit);
	assert.equal(latePenalty(1, end + TAX_GAME.lateEveryDays, 500), 2 * TAX_GAME.lateUnit);
	assert.equal(latePenalty(1, end + 1000, 500), TAX_GAME.lateMaxUnits * TAX_GAME.lateUnit);
	assert.equal(latePenalty(1, end + 50, -500), 0, '退税的不罚');
	assert.equal(latePenalty(1, end + 50, 0), 0);
	const s = withTfn(make('fifo', { clock: at(10, end + 1), cash: 1e6 }), { fy: 2, ret: { fy: 1, ...book({ wages: 9000 }) } });
	const p = returnPreview(s)!;
	assert.ok(p.late && p.penalty === TAX_GAME.lateUnit);
	assert.equal(lodgeReturn(s).state.cash, 1e6 - p.due - p.penalty);
});

test('一直不报：下一个财年结转时 ATO 默认评税；没有 TFN 多扣的退不回', () => {
	const day = 2 * YEAR_DAYS;
	const mk = (tfn: number, ret: TaxBook) => ({ ...make('fifo', { clock: at(10, day), cash: 1000 }), tax: { ...make('fifo').tax, tfn, fy: 2, ret: { fy: 1, ...ret } } });
	const keep = mk(-1, book({ wages: 1000, withheld: 470 }));
	const t = structuredClone(keep);
	const msgs = taxTick(t);
	assert.ok(msgs.some((m) => m.includes('默认评税') && m.includes('退不回')), msgs.join(' / '));
	assert.equal(t.cash, 1000);
	assert.equal(t.tax.ret, null);
	assert.equal(t.tax.fy, 3);
	const paid = structuredClone(mk(0, book({ wages: 1000, withheld: 470 })));
	taxTick(paid);
	assert.ok(paid.cash > 1000, '有 TFN 的照样退');
	const owe = structuredClone(mk(0, book({ wages: 9000 })));
	const due = returnPreview(owe)!;
	taxTick(owe);
	assert.ok(owe.cash <= 1000 - Math.min(1000, due.due), '默认评税补税加罚款');
	assert.ok(owe.tax.last!.penalty > 0);
});

test('欠税每周分期扣，不超过现金', () => {
	const s = structuredClone(withTfn(make('fifo', { clock: at(10, 3), cash: 50 }), { debt: 1000 }));
	taxTick(s);
	assert.equal(s.cash, 0);
	assert.equal(s.tax.debt, 950);
	const rich = structuredClone(withTfn(make('fifo', { clock: at(10, 3), cash: 1e5 }), { debt: 1000 }));
	taxTick(rich);
	assert.equal(rich.tax.debt, 1000 - Math.max(TAX_GAME.planMin, Math.ceil(1000 * TAX_GAME.planShare)));
	const tiny = structuredClone(withTfn(make('fifo', { clock: at(10, 3), cash: 1e5 }), { debt: 5 }));
	taxTick(tiny);
	assert.equal(tiny.tax.debt, 0, '最后一笔不多扣');
	assert.equal(tiny.cash, 1e5 - 5);
});

test('TFN 和 ABN：申请一次、等几天到；ABN 要先有 TFN', () => {
	const s = make('backpacker', { clock: at(9, 2) });
	assert.match(applyAbn(s).msg, /先有 TFN/);
	const r = applyTfn(s);
	assert.ok(r.ok);
	assert.equal(r.state.tax.tfn, 2 + TAX_GAME.tfnWaitDays);
	assert.equal(r.state.clock, s.clock, '网上申请不花时间');
	assert.equal(applyTfn(r.state).ok, false, '不能重复申请');
	assert.match(applyAbn(r.state).msg, /先有 TFN/, '号码还没到');
	const later = { ...r.state, clock: at(9, 2 + TAX_GAME.tfnWaitDays) };
	const abn = applyAbn(later);
	assert.ok(abn.ok, abn.msg);
	assert.equal(abn.state.tax.abn, true);
	assert.equal(applyAbn(abn.state).ok, false);
});

test('动作协议：只认三种税务操作', () => {
	for (const op of ['tfn', 'abn', 'lodge']) assert.deepEqual(parseAction({ t: 'tax', op }), { t: 'tax', op });
	for (const bad of [{ t: 'tax' }, { t: 'tax', op: 'refund' }, { t: 'tax', op: 1 }, { t: 'tax', op: '__proto__' }]) assert.equal(parseAction(bad), null);
	const r = applyAction(make(), WA, { t: 'tax', op: 'tfn' });
	assert.ok(r.ok && r.state.tax.tfn > 0);
});

test('存档清洗：旧存档缺字段视为已有 TFN；坏值钳住；幂等', () => {
	const s = make('fifo', { clock: at(9, YEAR_DAYS + 5) });
	const old = structuredClone(s) as any;
	delete old.tax;
	const c = sanitizeState(old)!;
	assert.equal(c.tax.tfn, 0, '老玩家不突然按 47% 扣');
	assert.equal(c.tax.fy, 2);
	assert.deepEqual(c.tax.book, emptyBook());
	for (const junk of [null, 1, 'x', [], { tfn: 'a', fy: 1e9, book: [], ret: 5, debt: -9, last: [] }, { tfn: 1e12, abn: 'yes', debt: NaN, book: { wages: -5, withheld: Infinity } }]) {
		const t = cleanTax(junk, s.clock);
		assert.ok(t.fy >= 1 && t.fy <= 2, JSON.stringify(t));
		assert.ok(t.debt >= 0 && t.tfn <= YEAR_DAYS + 5 + TAX_GAME.tfnWaitDays && t.book.wages >= 0 && t.book.withheld >= 0);
		assert.ok(t.abn === false);
		assert.deepEqual(cleanTax(t, s.clock), t, '幂等');
	}
	const ret = cleanTax({ fy: 2, ret: { fy: 2, wages: 10 } }, s.clock);
	assert.equal(ret.ret, null, '待申报的必须是更早的财年');
	const ok = cleanTax({ tfn: 3, abn: true, fy: 2, book: { wages: 10 }, ret: { fy: 1, wages: 5, withheld: 1 }, debt: 7, last: { fy: 1, due: -3, penalty: 0 } }, s.clock);
	assert.deepEqual(ok, { tfn: 3, abn: true, fy: 2, book: book({ wages: 10 }), ret: { fy: 1, ...book({ wages: 5, withheld: 1 }) }, debt: 7, last: { fy: 1, due: -3, penalty: 0 } });
	const full = sanitizeState({ ...s, tax: ok })!;
	assert.deepEqual(sanitizeState(full), full, '整份存档幂等');
});

test('界面卡片：按状态出按钮；插值都经过 esc', () => {
	const esc = (v: unknown) => `«${String(v)}»`;
	const none = taxCard(make('student'), esc);
	assert.match(none, /data-tax="tfn"/);
	assert.doesNotMatch(none, /data-tax="abn"|data-tax="lodge"/);
	const ok = withTfn(make('student', { clock: at(9, YEAR_DAYS + 1) }), { fy: 2, ret: { fy: 1, ...book({ wages: 3000, withheld: 900 }) } });
	const html = taxCard(ok, esc);
	assert.match(html, /data-tax="abn"/);
	assert.match(html, /data-tax="lodge" >/);
	assert.match(html, /退税/);
	assert.match(html, /«第 1 财年待申报»|«1»/, '数字经过 esc');
	assert.match(taxCard({ ...ok, tax: { ...ok.tax, tfn: -1 } }, esc), /data-tax="lodge" disabled/);
	assert.match(taxCard({ ...ok, tax: { ...ok.tax, debt: 300 } }, esc), /欠税/);
});
