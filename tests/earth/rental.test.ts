// 租房市场（rental 批次）：看房、申请、租约、涨租、维修、退房押金结算、骗租、存档清洗。规则见 docs/earth-game/rental.md
import { rentOn } from '../../src/game/core/world.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import {
	applyForHome, bondFor, buyProperty, handleScam, homesAt, inspectHome, leaseAction, leaseBlocked, leaveHome, moveInCost, moveInWarn, moveIntoProperty, rentHome, scamHere, settleBondClaim, spendWarn, CASH_CUSHION,
} from '../../src/game/core/engine.ts';
import { homeComfort } from '../../src/game/core/attributes.ts';
import {
	applicantsFor, applyOdds, bondCapWeeks, cleanRental, damageClaim, emptyRental, oddsLabel, renew, rentalTick, rentalWeek, riseNoticeFrom, scamAd, startLease, type OddsInput,
} from '../../src/game/core/rental.ts';
import { dayOf } from '../../src/game/core/time.ts';
import type { Lease, PlayerState } from '../../src/game/core/types.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { MARKET, ODDS, RENTAL } from '../../src/game/data/rental.ts';
import { rentDue } from '../../src/game/core/rental.ts';
import { weeklyCosts } from '../../src/game/core/attributes.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { featureOf } from '../../src/game/server/stats.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'rental-player', name: '租', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 41 }),
	...over,
});
const home = (id: string) => HOMES.find((h) => h.id === id)!;
const locs = new Set(WORLD.locations.map((l) => l.id));
/** 直接签约（跳过找房），并把原有损坏定成 prior */
const housed = (over: Partial<PlayerState> = {}, id = 'room', term: 'fixed' | 'periodic' = 'periodic', prior = 0) => {
	const r = rentHome(make({ cash: 5000, clock: at(9), ...over }), WA, id, term);
	assert.ok(r.ok, r.msg);
	r.state.rental.lease!.prior = prior;
	return r.state;
};
const odds = (o: Partial<OddsInput>) => applyOdds({ rent: 160, income: 1000, cash: 0, refs: 0, marks: 0, applicants: ODDS.crowdFree, ...o });

// ---------- 真实规则：押金上限 ----------
test('押金上限：西澳 4 周（周租 > $1,200 不设上限），南澳 ≤ $800 为 4 周、> $800 为 6 周', () => {
	assert.equal(bondCapWeeks(1200, 'wa'), 4);
	assert.equal(bondCapWeeks(1201, 'wa'), Infinity);
	assert.equal(bondCapWeeks(800, 'sa'), 4);
	assert.equal(bondCapWeeks(801, 'sa'), 6);
	assert.equal(bondCapWeeks(500, 'nt'), 4, '没有规则的区域按最严的 4 周');
	for (const h of HOMES) for (const area of ['wa', 'sa']) {
		assert.ok(bondFor(h) <= h.rentWeek * bondCapWeeks(h.rentWeek, area), `${h.id} 的押金不超过${area}的法定上限`);
	}
});

test('换算：涨租一年一次 = 游戏一年，60 天通知按 112/365 折算', () => {
	assert.equal(RENTAL.riseEveryDays, 112);
	assert.equal(RENTAL.noticeDays, Math.round((60 * 112) / 365));
	assert.equal(RENTAL.fixedDays, 56);
});

// ---------- 申请成功率 ----------
test('申请成功率：收入、存款、推荐人、被收房记录、竞争人数各自起作用，钳在 0.05–0.95', () => {
	const base = odds({});
	assert.ok(Math.abs(base - (ODDS.base + ODDS.lowBonus)) < 1e-9, '房租占收入 16%：底数 + 低占比加分');
	assert.ok(odds({ income: 400 }) < base, '房租占 40%：加分少');
	assert.ok(odds({ income: 200 }) < odds({ income: 400 }), '房租占 80%：扣分');
	assert.ok(odds({ income: 0 }) < odds({ income: 200 }), '没工作最低');
	assert.ok(odds({ income: 400, cash: 160 * ODDS.savingsWeeks }) > odds({ income: 400 }), '存款够 4 周房租加分');
	assert.ok(odds({ income: 400, refs: 1 }) > odds({ income: 400 }), '推荐人加分');
	assert.equal(odds({ income: 400, refs: 9 }), odds({ income: 400, refs: 3 }), '推荐人加分有上限');
	assert.ok(odds({ marks: 1 }) < base, '被收房记录扣分');
	assert.ok(odds({ applicants: 8 }) < base, '人多扣分');
	assert.equal(odds({ applicants: 1 }), base, '人少不加分');
	assert.equal(odds({ income: 0, marks: 9, applicants: 20 }), ODDS.min);
	assert.equal(odds({ refs: 9, cash: 1e6 }), ODDS.max);
	assert.deepEqual([0.8, 0.6, 0.4, 0.1].map(oddsLabel), ['希望很大', '有希望', '一般', '悬']);
});

test('看房人数：在市场表的范围内，同一天同一套房对同一个人不变', () => {
	const [lo, hi] = MARKET.wa.applicants;
	const seen = new Set<number>();
	for (let d = 0; d < 200; d++) {
		const n = applicantsFor(41, 'wa', 'perth', 'room', d);
		assert.ok(n >= lo && n <= hi, `第 ${d} 天 ${n} 组`);
		seen.add(n);
	}
	assert.equal(seen.size, hi - lo + 1, '每个人数都会出现');
	assert.equal(applicantsFor(41, 'wa', 'perth', 'room', 5), applicantsFor(41, 'wa', 'perth', 'room', 5));
});

// ---------- 看房与申请 ----------
test('看房：花 30 分钟，记下人数；营地不用看房', () => {
	const s = make({ cash: 2000, clock: at(9) });
	const r = inspectHome(s, WA, 'room');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.clock, s.clock + RENTAL.inspectMin);
	assert.deepEqual(r.state.rental.viewed, { loc: 'perth', home: 'room', day: 0, n: applicantsFor(s.marketSeed, 'wa', 'perth', 'room', 0) });
	// 合并 main 后复核：人数按不会变的行情种子定，推进了随机种子再看一次，人数不变（不能重抽）
	const again = inspectHome({ ...r.state, seed: r.state.seed + 12345, clock: s.clock }, WA, 'room');
	assert.equal(again.state.rental.viewed!.n, r.state.rental.viewed!.n);
	assert.match(r.msg, /组人/);
	assert.equal(s.rental.viewed, null, '入参没被改');
	assert.equal(inspectHome(s, WA, 'campground').ok, false);
	assert.equal(inspectHome(s, WA, 'nope').ok, false);
});

test('申请：没看房不能申请；看房 7 天后过期；通过就签约，被拒当天不能再申请这套', () => {
	const s = make({ cash: 2000, clock: at(9) });
	assert.match(applyForHome(s, WA, 'room').msg, /先看房/);
	const seen = inspectHome(s, WA, 'room').state;
	assert.match(applyForHome({ ...seen, clock: at(9, RENTAL.viewDays) }, WA, 'room').msg, /先看房/, '看房记录过期');
	assert.match(applyForHome(seen, WA, 'flat').msg, /先看房/, '看的是别的房');
	// 换种子，两种结果都要出现
	let pass: PlayerState | undefined, fail: PlayerState | undefined;
	for (let seed = 1; seed < 200 && !(pass && fail); seed++) {
		const r = applyForHome({ ...seen, seed }, WA, 'room', 'fixed');
		assert.ok(r.ok, r.msg);
		if (r.state.home) pass ??= r.state;
		else fail ??= r.state;
	}
	assert.ok(pass && fail, '有通过也有被拒');
	assert.equal(pass!.rental.lease!.end, pass!.rental.lease!.start + RENTAL.fixedDays, '选了固定期限');
	assert.equal(pass!.rental.viewed, null, '签约后看房记录清掉');
	assert.deepEqual(fail!.rental.rejected, { loc: 'perth', day: 0, homes: ['room'] });
	assert.match(homesAt(fail!, WA).find((o) => o.home.id === 'room')!.blocked!, /被拒/);
	assert.ok(!homesAt(fail!, WA).find((o) => o.home.id === 'flat')!.blocked, '别的房还能申请');
	assert.ok(!homesAt({ ...fail!, clock: at(9, 1) }, WA).find((o) => o.home.id === 'room')!.blocked, '第二天可以再试');
	const camp = WA.locations.find((l) => homesAt(make({ loc: l.id }), WA).some((o) => o.home.id === 'campground'))!.id;
	assert.equal(applyForHome(make({ cash: 2000, clock: at(9), vehicle: 'campervan', loc: camp }), WA, 'campground').ok, true, '营地直接租');
});

test('申请：通过的比例跟成功率一致（种子决定，不是固定结果）', () => {
	const rate = (over: Partial<PlayerState>) => {
		const seen = inspectHome(make({ cash: 2000, clock: at(9), ...over }), WA, 'room').state;
		let n = 0;
		for (let seed = 1; seed <= 400; seed++) if (applyForHome({ ...seen, seed }, WA, 'room').state.home) n++;
		return n / 400;
	};
	const jobless = rate({});
	const worker = rate({ job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } as PlayerState['job'] });
	assert.ok(jobless < worker, `没工作 ${jobless} < 有工作 ${worker}`);
	const n = applicantsFor(41, 'wa', 'perth', 'room', 0);
	const expect = applyOdds({ rent: 120, income: 0, cash: 2000 - 0, refs: 0, marks: 0, applicants: n });
	assert.ok(Math.abs(jobless - expect) < 0.08, `没工作的通过率 ${jobless} 接近 ${expect}`);
});

// ---------- 租约 ----------
test('签约：周期租约没有到期日；房租按租约扣（涨租后不等于挂牌价）', () => {
	const s = housed();
	const l = s.rental.lease!;
	assert.equal(l.end, 0);
	assert.equal(l.rent, 120);
	assert.equal(l.report, 0);
	assert.ok(l.prior >= 0 && l.prior <= RENTAL.priorMax);
	const raised = structuredClone(s);
	raised.rental.lease!.rent = 200;
	const after = applyAction({ ...raised, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.ok(after.journal.some((j) => j.text.includes('房租 $200')), '按租约房租扣');
	assert.equal(housed({ vehicle: 'campervan' }, 'room').rental.lease !== null, true);
	const camp = WA.locations.find((l) => homesAt(make({ loc: l.id }), WA).some((o) => o.home.id === 'campground'))!.id;
	const camped = rentHome(make({ cash: 2000, clock: at(9), vehicle: 'campervan', loc: camp }), WA, 'campground');
	assert.ok(camped.ok, camped.msg);
	assert.equal(camped.state.rental.lease, null, '营地没有租约');
});

test('原有损坏按种子定，范围 0–30', () => {
	const seen = new Set<number>();
	for (let seed = 0; seed < 300; seed++) {
		const p = startLease(seed, home('room'), 'perth', 0, 'periodic').prior;
		assert.ok(Number.isInteger(p) && p >= 0 && p <= RENTAL.priorMax);
		seen.add(p);
	}
	assert.ok(seen.has(0) && seen.has(RENTAL.priorMax));
});

/** 从第 0 天起逐日推进租约，返回每天的日志 */
function runLease(l: Lease, days: number, seed: number) {
	const s = make({ seed });
	s.rental.lease = l;
	const events: { day: number; text: string }[] = [];
	for (let d = l.start; d < l.start + days; d++) {
		for (const t of rentalTick(s, d)) events.push({ day: d, text: t });
		if ((d - l.start) % 7 === 6) for (const t of rentalWeek(s, d)) events.push({ day: d, text: t });
	}
	return { s, events };
}

test('涨租：一年最多一次、通知不短于 18 天；固定期内不涨', () => {
	let rises = 0;
	for (let seed = 0; seed < 60; seed++) {
		for (const term of ['periodic', 'fixed'] as const) {
			const l = startLease(seed, home('flat'), 'perth', 0, term);
			const { events } = runLease(l, 400, seed);
			const notices = events.filter((e) => e.text.startsWith('收到涨租通知'));
			const effective = events.filter((e) => e.text.startsWith('新房租生效'));
			rises += effective.length;
			for (let i = 0; i < effective.length; i++) {
				const prev = i === 0 ? 0 : effective[i - 1].day;
				assert.ok(effective[i].day - prev >= RENTAL.riseEveryDays, `seed ${seed} ${term}：两次涨租隔 ${effective[i].day - prev} 天`);
				assert.ok(effective[i].day - notices[i].day >= RENTAL.noticeDays, `通知只提前 ${effective[i].day - notices[i].day} 天`);
				if (term === 'fixed') assert.ok(notices[i].day >= RENTAL.fixedDays - RENTAL.noticeDays && effective[i].day >= RENTAL.fixedDays, '固定期内不涨');
			}
		}
	}
	assert.ok(rises > 30, `400 天里确实会涨租（${rises} 次）`);
	const l = startLease(1, home('flat'), 'perth', 0, 'periodic');
	assert.equal(riseNoticeFrom(l), RENTAL.riseEveryDays - RENTAL.noticeDays);
	assert.equal(riseNoticeFrom({ ...l, end: 200 }), 200 - RENTAL.noticeDays);
});

test('涨幅 5%，生效后房租和上次涨租日更新', () => {
	const l: Lease = { ...startLease(1, home('flat'), 'perth', 0, 'periodic'), report: 1, rise: { at: 120, to: 336 } };
	const s = make();
	s.rental.lease = l;
	assert.deepEqual(rentalTick(s, 119), []);
	assert.match(rentalTick(s, 120)[0], /\$320 → \$336/);
	assert.equal(s.rental.lease!.rent, 336);
	assert.equal(s.rental.lease!.lastRise, 120);
	assert.equal(s.rental.lease!.rise, null);
	for (let seed = 0; seed < 200; seed++) {
		const t = make({ seed });
		t.rental.lease = startLease(seed, home('flat'), 'perth', 0, 'periodic');
		rentalWeek(t, 100);
		if (t.rental.lease.rise) {
			assert.equal(t.rental.lease.rise.to, Math.round(320 * (1 + RENTAL.risePct)));
			return;
		}
	}
	assert.fail('200 个种子里没有一次涨租通知');
});

test('固定期到期自动转周期；续约只能在最后 14 天或周期租约时', () => {
	const s = housed({}, 'room', 'fixed');
	assert.match(leaseBlocked(s, 'renew')!, /最后 14 天/);
	const late = { ...s, clock: at(9, RENTAL.fixedDays - RENTAL.renewWindow) };
	assert.equal(leaseBlocked(late, 'renew'), undefined);
	const r = leaseAction(late, WA, 'renew');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rental.lease!.end, RENTAL.fixedDays * 2);
	assert.equal(r.state.rental.lease!.rent, 120, '续约不涨租');
	const t = make();
	t.rental.lease = startLease(1, home('room'), 'perth', 0, 'fixed');
	assert.match(rentalTick(t, RENTAL.fixedDays).join(''), /转为周期/);
	assert.equal(t.rental.lease.end, 0);
	assert.equal(leaseBlocked(housed(), 'renew'), undefined, '周期租约随时可以续成固定期');
	// 续约时距上次涨租满一年：新合同从新期第一天加租；不满一年不加
	const year = make();
	year.rental.lease = { ...startLease(1, home('room'), 'perth', 0, 'fixed'), end: 120 };
	const l2 = year.rental.lease;
	assert.equal(renew(l2, 110), Math.round(120 * (1 + RENTAL.risePct)));
	assert.deepEqual(l2.rise, { at: 120, to: 126 });
	assert.equal(l2.end, 120 + RENTAL.fixedDays);
	assert.match(rentalTick(year, 120).join(''), /\$120 → \$126/);
	const early = { ...startLease(1, home('room'), 'perth', 0, 'fixed'), end: 100 };
	assert.equal(renew(early, 90), 120);
	assert.equal(early.rise, null);
});

// ---------- 入住检查报告、维修 ----------
test('入住检查报告：7 天内在住处交；过期作废', () => {
	const s = housed();
	assert.match(leaseBlocked({ ...s, loc: 'fremantle' }, 'report')!, /住处/);
	const r = leaseAction(s, WA, 'report');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rental.lease!.report, 1);
	assert.equal(r.state.clock, s.clock + RENTAL.reportMin);
	assert.match(leaseBlocked(r.state, 'report')!, /交过/);
	const t = make();
	t.rental.lease = startLease(1, home('room'), 'perth', 3, 'periodic');
	assert.deepEqual(rentalTick(t, 3 + RENTAL.reportDays - 1), []);
	assert.match(rentalTick(t, 3 + RENTAL.reportDays)[0], /过了交回期限/);
	assert.equal(t.rental.lease.report, -1);
});

test('维修：会坏东西；不报修损坏涨得快；报修后紧急 1 天、一般 7 天修好；紧急故障扣舒适度', () => {
	let urgent = 0, minor = 0;
	for (let seed = 0; seed < 400; seed++) {
		const t = make({ seed });
		t.rental.lease = startLease(seed, home('room'), 'perth', 0, 'periodic');
		rentalWeek(t, 6);
		if (t.rental.lease.fault) t.rental.lease.fault.urgent ? urgent++ : minor++;
	}
	assert.ok(urgent > 0 && minor > urgent, `紧急 ${urgent}、一般 ${minor}`);
	assert.ok(Math.abs((urgent + minor) / 400 - RENTAL.faultChance) < 0.05);

	const s = housed();
	const l = s.rental.lease!;
	l.fault = { urgent: true, name: '热水器坏了', since: 0, asked: -1 };
	assert.equal(homeComfort(s), homeComfort({ ...s, rental: { ...s.rental, lease: { ...l, fault: null } } }) - RENTAL.urgentComfort);
	const w0 = l.wear;
	rentalWeek(s, 6);
	assert.equal(s.rental.lease!.wear, w0 + RENTAL.wearWeek + RENTAL.wearUnreported, '不报修多加损坏');
	const r = leaseAction(s, WA, 'repair');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rental.lease!.fault!.asked, 0);
	assert.match(leaseBlocked(r.state, 'repair')!, /等房东/);
	const fixed = structuredClone(r.state);
	assert.deepEqual(rentalTick(fixed, RENTAL.urgentFixDays - 1).filter((x) => x.includes('修好')), []);
	assert.match(rentalTick(fixed, RENTAL.urgentFixDays).join(''), /修好了：热水器坏了/);
	assert.equal(fixed.rental.lease!.fault, null);
	const m = make();
	m.rental.lease = { ...startLease(1, home('room'), 'perth', 0, 'periodic'), fault: { urgent: false, name: '门锁松了', since: 0, asked: 2 } };
	assert.deepEqual(rentalTick(m, 2 + RENTAL.minorFixDays - 1).filter((x) => x.includes('修好')), []);
	assert.match(rentalTick(m, 2 + RENTAL.minorFixDays).join(''), /修好/);
	assert.match(leaseBlocked(housed(), 'repair')!, /没有要修的/);
});

// ---------- 退房与押金 ----------
test('房东扣押金：押金 × (租住损坏 + 原有损坏) / 100，不超过剩下的押金', () => {
	const l = startLease(1, home('room'), 'perth', 0, 'periodic');
	assert.deepEqual(damageClaim({ ...l, wear: 10, prior: 20 }, 320), { amount: 96, prior: 64 });
	assert.deepEqual(damageClaim({ ...l, wear: 90, prior: 30 }, 320), { amount: 320, prior: 96 });
	assert.deepEqual(damageClaim({ ...l, wear: 0, prior: 0 }, 320), { amount: 0, prior: 0 });
	assert.deepEqual(damageClaim(null, 320), { amount: 0, prior: 0 });
	assert.deepEqual(damageClaim(l, 0), { amount: 0, prior: 0 });
});

test('退房：没争议的押金马上退，扣款留在托管机构；交过报告申诉要回原有损坏那部分', () => {
	const s = housed({}, 'room', 'periodic', 20);
	s.rental.lease!.wear = 10;
	const reported = leaseAction(s, WA, 'report').state;
	const left = leaveHome(reported);
	assert.ok(left.ok);
	assert.equal(left.state.cash, reported.cash + 240 - 72);
	assert.deepEqual(left.state.rental.claim, { amount: 72, prior: 48, day: 0 });
	assert.equal(left.state.rental.lease, null);
	assert.match(left.msg, /押金退回 \$168.*扣 \$72/);
	const won = settleBondClaim(left.state, WA, true);
	assert.ok(won.ok, won.msg);
	assert.equal(won.state.cash, left.state.cash + 48);
	assert.equal(won.state.rental.claim, null);
	assert.equal(won.state.clock, left.state.clock + RENTAL.disputeMin);
	assert.match(won.msg, /退回 \$48.*\$24 归房东/);
	const ok = settleBondClaim(left.state, WA, false);
	assert.equal(ok.state.cash, left.state.cash, '接受：扣款归房东');
	assert.equal(ok.state.clock, left.state.clock, '接受不花时间');
	// 没交报告：申诉维持原判
	const noReport = leaveHome(s);
	assert.equal(noReport.state.rental.claim!.prior, 0);
	const lost = settleBondClaim(noReport.state, WA, true);
	assert.equal(lost.state.cash, noReport.state.cash);
	assert.match(lost.msg, /没有入住检查报告/);
	assert.equal(settleBondClaim(make(), WA, true).ok, false);
});

test('再次搬走时，旧的扣款按接受处理；扣款不算进可用来换房的钱', () => {
	const s = housed({}, 'room', 'periodic', 20);
	const first = leaveHome(s).state;
	const again = structuredClone(rentHome(first, WA, 'room').state);
	again.rental.lease!.prior = 10;
	const r = leaveHome(again);
	assert.match(r.msg, /上一笔 \$48 押金扣款没处理，按接受算/);
	assert.equal(r.state.rental.claim!.amount, 24);
	// 换房时房东要扣的部分不能当首付用
	const h = housed({}, 'room', 'periodic', 50);
	assert.equal(moveInCost(h, home('flat')), Math.round((320 * 7) / 7) + 640 - (240 - 120));
});

test('退租记录：住满 14 天干净退房记一条推荐人；被收房记一条坏记录', () => {
	const s = housed();
	assert.equal(leaveHome(s).state.rental.refs, 0, '住不满 14 天不算');
	const long = { ...s, clock: at(9, RENTAL.cleanDays), nextWeek: RENTAL.cleanDays + 7 };
	assert.equal(leaveHome(long).state.rental.refs, 1);
	const broke = applyAction({ ...s, cash: 10, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(broke.home, null);
	assert.equal(broke.rental.marks, 1);
	assert.equal(broke.rental.refs, 0);
	// 固定期内被收房：只扣欠租，不另收违约金
	const fixed = housed({}, 'flat', 'fixed');
	const evicted = applyAction({ ...fixed, cash: 10, clock: at(20, 6) }, WA, { t: 'activity', id: 'sleep-camp' }).state;
	assert.equal(evicted.home, null);
	assert.equal(evicted.cash, 10 + 640 - 320 - 25, '押金抵一周房租后退回 $320；留学生的二手车照扣保险 $25');
	const capped = { ...long, rental: { ...long.rental, refs: RENTAL.recordMax } };
	assert.equal(leaveHome(capped).state.rental.refs, RENTAL.recordMax);
});

test('固定期内提前走：违约金 2 周房租先从押金扣，不够从现金扣；到期后不收', () => {
	const s = housed({}, 'flat', 'fixed'); // 押金 640，违约金 640
	const r = leaveHome(s);
	assert.equal(r.state.cash, s.cash, '押金正好抵违约金');
	assert.match(r.msg, /违约金 \$640/);
	const big = structuredClone(s);
	big.home!.bond = 200;
	assert.equal(leaveHome(big).state.cash, s.cash - 440, '押金不够的从现金扣');
	const poor = { ...big, cash: 100 };
	assert.equal(leaveHome(poor).state.cash, 0, '现金不会扣成负数');
	const after = { ...s, clock: at(9, RENTAL.fixedDays + 1), nextWeek: RENTAL.fixedDays + 7 };
	after.rental = structuredClone(s.rental);
	rentalTick(after, RENTAL.fixedDays + 1);
	assert.equal(leaveHome(after).state.cash, after.cash + 640, '到期转周期后退租不收违约金');
	assert.equal(moveInCost(s, home('room')), 120 + 240 - 0 + 0, '换房时违约金吃掉旧押金');
	const owned = moveIntoProperty(buyProperty({ ...s, cash: 200000 }, WA, 'perth-apartment', false).state, 'perth-apartment');
	assert.match(owned.msg, /违约金 \$640/, '搬进自有房也算提前解约');
});

// ---------- 骗租 ----------
test('骗租广告：只在城镇类地点、按日期出现，标价六成；转钱就没了，核实能识破，处理过当天不再出现', () => {
	const perth = WA.locations.find((l) => l.id === 'perth')!;
	let days = 0;
	for (let d = 0; d < 400; d++) if (scamAd(perth, d, HOMES)) days++;
	assert.ok(Math.abs(days / 400 - RENTAL.scamChance) < 0.06, `${days}/400 天有骗租广告`);
	assert.equal(scamAd({ id: 'x', kind: 'outback' }, 1, HOMES), undefined, '内陆没有');
	const kalgoorlie = WORLD.locations.find((l) => l.id === 'kalgoorlie')!;
	assert.equal(scamAd(kalgoorlie, 1, HOMES), undefined, '卡尔古利新公寓不进入骗租广告');
	assert.equal(scamAd(perth, 1, HOMES.filter((h) => h.vehicleSleep)), undefined, '只有营地的地方没有');
	let d = 0;
	while (!scamAd(perth, d, HOMES)) d++;
	const ad = scamAd(perth, d, HOMES)!;
	assert.equal(ad.rent, Math.round(ad.home.rentWeek * RENTAL.scamRentShare));
	const s = make({ cash: 3000, clock: at(9, d), nextWeek: d + 7 });
	assert.ok(scamHere(s, WA));
	const paid = handleScam(s, WA, true);
	assert.equal(paid.state.cash, 3000 - ad.ask);
	assert.ok(paid.state.moodlets.some((m) => m.id === 'scammed'));
	assert.match(paid.msg, /不能看房就不要付钱/);
	assert.equal(scamHere(paid.state, WA), undefined, '处理过当天不再出现');
	assert.equal(handleScam(paid.state, WA, true).ok, false);
	assert.equal(handleScam({ ...s, cash: 50 }, WA, true).state.cash, 0, '最多转光现金');
	const checked = handleScam(s, WA, false);
	assert.equal(checked.state.cash, 3000);
	assert.equal(checked.state.clock, s.clock + RENTAL.checkMin);
	assert.match(checked.msg, /识破/);
});

// ---------- 协议与存档 ----------
test('动作协议：看房、租约操作、申请可带租约类型', () => {
	assert.deepEqual(parseAction({ t: 'rental', op: 'inspect', home: 'room' }), { t: 'rental', op: 'inspect', home: 'room' });
	assert.equal(parseAction({ t: 'rental', op: 'inspect' }), null);
	for (const op of ['report', 'repair', 'renew', 'accept', 'dispute', 'scam-pay', 'scam-check']) assert.deepEqual(parseAction({ t: 'rental', op, home: 'x' }), { t: 'rental', op });
	assert.equal(parseAction({ t: 'rental', op: 'evict' }), null);
	assert.deepEqual(parseAction({ t: 'home', op: 'rent', home: 'room', term: 'fixed' }), { t: 'home', op: 'rent', home: 'room', term: 'fixed' });
	assert.deepEqual(parseAction({ t: 'home', op: 'rent', home: 'room' }), { t: 'home', op: 'rent', home: 'room' });
	assert.equal(parseAction({ t: 'home', op: 'rent', home: 'room', term: 'forever' }), null);
	const s = make({ cash: 2000, clock: at(9) });
	const before = structuredClone(s);
	for (const a of [{ t: 'rental', op: 'inspect', home: 'room' }, { t: 'rental', op: 'report' }, { t: 'rental', op: 'scam-check' }] as const) applyAction(s, WA, a);
	assert.deepEqual(s, before, '动作不改入参');
});

test('存档清洗：旧存档没有 rental 给默认；在租房的补周期租约；坏值钳住；幂等', () => {
	const fresh = make();
	assert.deepEqual(sanitizeState({ ...fresh, rental: undefined }, locs)!.rental, emptyRental());
	const s = housed();
	const legacy = sanitizeState({ ...s, rental: undefined, clock: at(9, 30) }, locs)!;
	// 合并 main 后：补的租约按当天的租金指数定价（世界事件）
	assert.deepEqual(legacy.rental.lease, { home: 'room', loc: 'perth', start: 30, end: 0, rent: rentOn(120, 30), lastRise: 30, rise: null, report: 1, prior: 0, wear: 0, fault: null });
	assert.deepEqual(sanitizeState(legacy, locs), legacy, '幂等');
	const evil = {
		lease: { home: 'room', loc: 'perth', start: -5, end: 1e9, rent: 1e9, lastRise: 'x', rise: { at: 1e9, to: 1 }, report: 7, prior: 500, wear: -1, fault: { urgent: 'yes', name: '<script>', since: 0, asked: 0 } },
		refs: 99, marks: -3, viewed: { loc: 'atlantis', home: 'room', day: 0, n: 99 }, rejected: { loc: 'perth', home: 'room', day: -1 }, claim: { amount: 1e12, prior: 1e12, day: 1e9 }, scam: 1e9,
	};
	const c = sanitizeState({ ...s, rental: evil }, locs)!;
	assert.deepEqual(c.rental.lease, { home: 'room', loc: 'perth', start: 0, end: RENTAL.fixedDays + RENTAL.renewWindow, rent: 360, lastRise: 0, rise: null, report: 1, prior: 100, wear: 0, fault: null }, '到期日钳到续约能达到的最远；涨租不涨的通知作废');
	assert.equal(c.rental.refs, RENTAL.recordMax);
	assert.equal(c.rental.marks, 0);
	assert.equal(c.rental.viewed, null, '不认识的地点');
	assert.equal(c.rental.rejected, null, '不是今天的被拒记录没用');
	assert.deepEqual(c.rental.claim, { amount: 100000, prior: 100000, day: 0 });
	assert.equal(c.rental.scam, 0);
	assert.deepEqual(sanitizeState(c, locs), c, '幂等');
	// 租约对不上住处：住处没了就没有租约；住自有房没有租约
	assert.equal(sanitizeState({ ...s, home: null }, locs)!.rental.lease, null);
	const other = sanitizeState({ ...s, rental: { ...s.rental, lease: { ...s.rental.lease, home: 'flat' } } }, locs)!;
	assert.equal(other.rental.lease!.home, 'room', '对不上就按旧存档补一个');
	for (const junk of [null, 5, 'x', [], { lease: [] }, { __proto__: { refs: 3 } }]) {
		const r = cleanRental(junk, null, 10);
		assert.equal(r.lease, null);
		assert.equal(r.refs, 0, `垃圾输入 ${JSON.stringify(junk)}`);
	}
	assert.equal(cleanRental({}, { type: 'campground', loc: 'perth' }, 10).lease, null, '营地没有租约');
	assert.equal(cleanRental({}, { type: 'room', loc: 'perth', owned: 'x' }, 10).lease, null, '自有房没有租约');
});

test('一路走完：看房 → 申请 → 交报告 → 坏东西报修 → 涨租 → 退租结算（经 applyAction）', () => {
	let s = make({ cash: 20000, clock: at(9), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } as PlayerState['job'] });
	let tries = 0;
	while (!s.home && tries++ < 20) {
		s = applyAction(s, WA, { t: 'rental', op: 'inspect', home: 'room' }).state;
		s = applyAction(s, WA, { t: 'home', op: 'rent', home: 'room', term: 'periodic' }).state;
		if (!s.home) s = { ...s, clock: at(9, dayOf(s.clock) + 1) };
	}
	assert.ok(s.home, '20 天内租到了');
	s = applyAction(s, WA, { t: 'rental', op: 'report' }).state;
	assert.equal(s.rental.lease!.report, 1);
	// 住约 200 天：反复露营过夜（每次 8 小时）（营地睡袋不花钱、只推进时间），坏了就报修
	const start = dayOf(s.clock);
	let notices = 0;
	for (let d = 0; d < 600 && s.home; d++) {
		s = { ...s, cash: 20000, needs: { ...s.needs, hunger: 100, energy: 100, hygiene: 100, fun: 100, social: 100 }, health: 100 };
		const camp = applyAction(s, WA, { t: 'activity', id: 'sleep-camp' });
		// 合并 main 后：热浪等灾害预警会关掉露营（core/disasters.ts），那天改回家睡，时间照样往前走
		s = camp.ok ? camp.state : applyAction(s, WA, { t: 'home', op: 'sleep' }).state;
		if (s.pending) s = applyAction(s, WA, { t: 'event', choice: 0 }).state;
		if (s.rental.lease?.fault && s.rental.lease.fault.asked < 0) s = applyAction(s, WA, { t: 'rental', op: 'repair' }).state;
		if (s.rental.lease?.rise) notices++;
	}
	assert.ok(s.home, '没被收房');
	assert.ok(dayOf(s.clock) - start >= 150);
	assert.ok(notices > 0 && s.rental.lease!.rent > 120, '周期租约住过一年会涨租');
	assert.ok(s.journal.length > 0);
	const left = applyAction(s, WA, { t: 'home', op: 'leave' }).state;
	assert.equal(left.rental.refs, 1);
	assert.equal(left.rental.lease, null);
});

// ---------- 合并 main 后：租金指数、每周开销、记账、统计、句号 ----------
test('租约房租按签约那天的租金指数定价，之后只按租约规则变；没有租约的按当天指数（合并 main 后）', () => {
	// 找一个租金指数明显不是 1 的日子
	let day = 0;
	while (day < 2000 && rentOn(160, day) === 160) day++;
	assert.ok(day < 2000, '前提：指数会变');
	const s = housed({ clock: at(9, day) }, 'room', 'fixed');
	assert.equal(s.rental.lease!.rent, rentOn(home('room').rentWeek, day), '签约时的行情价');
	const later = { ...s, clock: at(9, day + 30) };
	assert.equal(rentDue(later, home('room')), s.rental.lease!.rent, '固定期内不随指数变');
	assert.equal(weeklyCosts(later).rent, s.rental.lease!.rent, '每周开销（心事里的房租压力也用它）按租约房租');
	const bare = { ...later, rental: { ...later.rental, lease: null } };
	assert.equal(rentDue(bare, home('room'), day + 30), rentOn(home('room').rentWeek, day + 30), '没有租约按指数');
});

test('生涯统计和统计：租房市场的钱记「住房」；看房、报修等动作按子操作统计（合并 main 后）', () => {
	assert.deepEqual(actionCats({ t: 'rental', op: 'scam-pay' }), ['housing', 'housing']);
	for (const op of ['inspect', 'report', 'repair', 'renew', 'accept', 'dispute', 'scam-pay', 'scam-check'] as const) {
		const a = op === 'inspect' ? { t: 'rental' as const, op, home: 'room' } : { t: 'rental' as const, op };
		assert.equal(featureOf(a), `rental.${op}`);
	}
});

test('被收房、退租时押金扣款的说明不会出现「。。」（合并 main 后复核）', () => {
	const s = housed({}, 'room', 'periodic', 30);
	const r = leaveHome({ ...s, clock: s.clock + 20 * 1440 });
	assert.ok(r.ok, r.msg);
	assert.match(r.msg, /等你接受或申诉/);
	assert.doesNotMatch(r.msg, /。。/);
});

test('复核修正：同一天被拒的每套都记下；旧形状读档转换；过期看房读档不复活；预告的涨租进每周开销；成功率按行情价（合并 main 后）', () => {
	// 被拒记录的旧形状 { loc, home, day } 转成 homes
	const s = make({ clock: at(9, 3) });
	const old = sanitizeState({ ...s, rental: { ...s.rental, rejected: { loc: 'perth', home: 'room', day: 3 } } } as never, locs)!;
	assert.deepEqual(old.rental.rejected, { loc: 'perth', day: 3, homes: ['room'] });
	assert.deepEqual(sanitizeState(old, locs)!.rental.rejected, old.rental.rejected, '幂等');
	// 两套都被拒过：两套都挡
	const two = { ...s, rental: { ...s.rental, rejected: { loc: 'perth', day: 3, homes: ['room', 'flat'] } } };
	for (const id of ['room', 'flat']) if (homesAt(two, WA).some((o) => o.home.id === id)) assert.match(homesAt(two, WA).find((o) => o.home.id === id)!.blocked ?? '', /被拒/, id);
	// 过期的看房读档后丢掉
	const stale = sanitizeState({ ...s, clock: at(9, 40), rental: { ...s.rental, viewed: { loc: 'perth', home: 'room', day: 40 - RENTAL.viewDays - 5, n: 3 } } }, locs)!;
	assert.equal(stale.rental.viewed, null);
	// 预告的涨租在结算日前生效：每周开销按新房租
	const h = housed({}, 'room', 'periodic');
	const l = h.rental.lease!;
	const rising = { ...h, rental: { ...h.rental, lease: { ...l, rise: { at: h.nextWeek - 1, to: l.rent + 30 } } } };
	assert.equal(weeklyCosts(rising).rent, l.rent + 30);
	assert.equal(rentDue(rising, home('room'), dayOf(rising.clock)), dayOf(rising.clock) >= h.nextWeek - 1 ? l.rent + 30 : l.rent, '还没到生效日按原房租');
});

test('第十五轮：签完剩的钱不够两周房租、事件选完剩的钱少于应急线时提醒（只提醒不拦）', () => {
	const room = home('room');
	const cost = moveInCost(make({ cash: 100000 }), room);
	const tight = make({ cash: cost + room.rentWeek });
	assert.match(moveInWarn(tight, room) ?? '', /签完只剩 \$\d+，不够两周房租/);
	assert.equal(moveInWarn(make({ cash: cost + room.rentWeek * 2 }), room), undefined, '留够两周不提醒');
	assert.equal(moveInWarn(make({ cash: cost - 1 }), room), undefined, '签不起时由 blocked 说明，不重复提醒');
	assert.equal(spendWarn(make({ cash: 398 }), 200), '选完只剩 $198');
	assert.equal(spendWarn(make({ cash: 200 + CASH_CUSHION }), 200), undefined);
	assert.equal(spendWarn(make({ cash: 100 }), 200), undefined, '付不起时界面另有「钱不够」');
	assert.equal(spendWarn(make({ cash: 1000 }), 0), undefined, '免费选项不提醒');
});
