// 世界事件（第 43 批）：全服共享宏观指标、游戏内新闻、对路费 / 工资 / 招工 / 房租 / 房贷的影响。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { settleDay, weeklyCosts } from '../../src/game/core/attributes.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { bondFor, careerPay, careersAt, firstRent, rentHome, travelOptions } from '../../src/game/core/engine.ts';
import { loanPayment, weeklyInterest, weeklyPrincipal } from '../../src/game/core/finance.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import {
	careerPayMult, fmtIndicator, fuelMult, getIndicator, hiringFrozen, indicatorOn, loanRateMult, miningHiring, newsOn, rentMult, rentOn, worldNews, worldOn,
} from '../../src/game/core/world.ts';
import { getCareer } from '../../src/game/core/engine.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { weeklyBudget } from '../../src/game/core/economy.ts';
import { FINANCE } from '../../src/game/core/finance.ts';
import { WA } from '../../src/game/data/wa.ts';
import { INDICATORS, NEWS_LOOKBACK_DAYS, NEWS_MAX, NEWS_TEXT, WORLD_DAYS_MAX, WORLD_FX } from '../../src/game/data/world.ts';
import { worldCard } from '../../src/game/ui/world.ts';

const DAY = 1440;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'world-player', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const DAYS = range(1200);
/** 第一个满足条件的游戏日 */
const firstDay = (f: (d: number) => boolean) => {
	const d = DAYS.find(f);
	assert.ok(d !== undefined, '应该能找到这样的一天');
	return d!;
};

test('开局第 0 天全部指标在中心值，所有影响系数为 1（不改变旧存档开局的数值）', () => {
	const w = worldOn(0);
	for (const def of INDICATORS) assert.equal(w[def.id], def.center, def.id);
	for (const k of Object.keys(WORLD_FX.fuelShare) as (keyof typeof WORLD_FX.fuelShare)[]) assert.equal(fuelMult(0, k), 1);
	assert.equal(loanRateMult(0), 1);
	assert.equal(rentMult(0), 1);
	assert.equal(careerPayMult('miner', 0), 1);
});

test('同一天所有人看到同一个世界：只依赖游戏日，可复现', () => {
	for (const d of [1, 13, 99, 500, 1111]) assert.deepEqual(worldOn(d), worldOn(d));
	// 期内不变：同一期里每天的值一样
	for (const def of INDICATORS) for (const d of range(200)) assert.equal(indicatorOn(def, d), indicatorOn(def, Math.floor(d / def.step) * def.step), `${def.id} 第 ${d} 天`);
	// 真的会变（不是常数）
	for (const def of INDICATORS) assert.ok(new Set(DAYS.map((d) => indicatorOn(def, d))).size > 3, `${def.id} 应该有起落`);
});

test('指标不越界：在 中心 ± (振幅 + 扰动) 之内；坏输入当第 0 天或封顶', () => {
	for (const def of INDICATORS) {
		const lim = def.amp + def.noise + 0.125 + 1e-9;
		for (const d of DAYS) assert.ok(Math.abs(indicatorOn(def, d) - def.center) <= lim, `${def.id} 第 ${d} 天 ${indicatorOn(def, d)}`);
		assert.equal(indicatorOn(def, -50), def.center);
		assert.equal(indicatorOn(def, Number.NaN), def.center);
		assert.equal(indicatorOn(def, 1e12), indicatorOn(def, WORLD_DAYS_MAX));
	}
});

test('利率只在议息日变动，每次最多一档 0.25，永远是 0.25 的倍数', () => {
	const rate = getIndicator('rate');
	let moves = 0;
	for (const d of range(1500).slice(1)) {
		const now = indicatorOn(rate, d);
		const prev = indicatorOn(rate, d - 1);
		assert.equal(Math.round(now * 4), now * 4, `第 ${d} 天 ${now}`);
		if (now !== prev) {
			moves++;
			assert.equal(d % rate.step, 0, `第 ${d} 天不是议息日却变了`);
			assert.equal(Math.abs(now - prev), 0.25, `第 ${d} 天一次变了 ${now - prev}`);
		}
	}
	assert.ok(moves >= 10, `1500 天里应该有加息降息，实际 ${moves} 次`);
});

test('房价与利率反向：利率高位时房价指数低于中心', () => {
	const rate = getIndicator('rate');
	const house = getIndicator('house');
	const highs = DAYS.filter((d) => indicatorOn(rate, d) >= rate.center + 1);
	assert.ok(highs.length > 0);
	for (const d of highs) assert.ok(indicatorOn(house, d) < house.center, `第 ${d} 天`);
});

test('影响系数随指标同向变化', () => {
	const hi = firstDay((d) => indicatorOn(getIndicator('oil'), d) >= 215);
	const lo = firstDay((d) => indicatorOn(getIndicator('oil'), d) <= 165);
	assert.ok(fuelMult(hi, 'road') > fuelMult(hi, 'bus') && fuelMult(hi, 'bus') > 1, '油价高：自驾涨得比巴士多');
	assert.ok(fuelMult(lo, 'road') < 1);
	const rHi = firstDay((d) => indicatorOn(getIndicator('rate'), d) > 4);
	const rLo = firstDay((d) => indicatorOn(getIndicator('rate'), d) < 4);
	assert.ok(loanRateMult(rHi) > 1 && loanRateMult(rLo) < 1);
	const rentHi = firstDay((d) => indicatorOn(getIndicator('rent'), d) > 102);
	assert.ok(rentOn(400, rentHi) > 400);
	assert.equal(careerPayMult('barista', rHi), 1, '矿业以外的职业不受影响');
});

test('引擎：路费随油价变，房租首期和每周开销随租金行情变', () => {
	const hi = firstDay((d) => indicatorOn(getIndicator('oil'), d) >= 215);
	const base = make({ clock: 8 * 60 });
	const later = make({ clock: hi * DAY + 8 * 60 });
	const c0 = travelOptions(base, WA);
	const c1 = travelOptions(later, WA);
	assert.ok(c0.length > 0);
	for (const o of c0) {
		const o1 = c1.find((x) => x.to === o.to && x.mode === o.mode)!;
		// 按真实票价的线路（公交、火车、部分渡轮，world-events.md §8：真实票价不随油价变）不乘燃油系数；按公里估价的线路随油价涨
		if (o.note && /票价/.test(o.note)) assert.equal(o1.cost, o.cost, `${o.label} → ${o.to}：真实票价不变`);
		else if (o.cost >= 20) assert.ok(o1.cost > o.cost, `${o.label} → ${o.to}：${o.cost} → ${o1.cost}`);
	}
	// 背包客没车：公路坐巴士，按巴士的燃油份额涨（比自驾少）
	const bus = c0.filter((o) => o.mode === 'road' && o.cost >= 60);
	assert.ok(bus.length > 0 && bus.every((o) => o.label.includes('巴士')));
	for (const o of bus) {
		const ratio = c1.find((x) => x.to === o.to && x.mode === o.mode)!.cost / o.cost;
		assert.ok(Math.abs(ratio - fuelMult(hi, 'bus')) < 0.02, `巴士涨幅 ${ratio.toFixed(3)} 应接近 ${fuelMult(hi, 'bus').toFixed(3)}`);
	}
	const home = HOMES.find((h) => h.rentWeek >= 200)!;
	const rentHi = firstDay((d) => indicatorOn(getIndicator('rent'), d) > 103);
	const s = make({ clock: rentHi * DAY + 8 * 60, nextWeek: rentHi + 7 });
	assert.equal(firstRent(s, home), rentOn(home.rentWeek, rentHi));
	assert.ok(firstRent(s, home) > home.rentWeek);
	const living = make({ clock: rentHi * DAY + 8 * 60, home: { type: home.id, loc: WA.spawn, furniture: {} } });
	assert.equal(weeklyCosts(living).rent, rentOn(home.rentWeek, rentHi));
});

test('引擎：周结算按结算日的租金行情扣房租', () => {
	const home = HOMES.find((h) => h.rentWeek >= 200 && !h.vehicleSleep)!;
	// 挑一个结算日：这天和下一周的租金行情不同（季度换档前一周），才能区分「按结算日」和「按下一个结算日」
	const day = firstDay((d) => d % 7 === 0 && rentMult(d) > 1.03 && rentOn(home.rentWeek, d) !== rentOn(home.rentWeek, d + 7));
	const s = make({ clock: (day - 1) * DAY + 20 * 60, nextWeek: day, cash: 5000, home: { type: home.id, loc: WA.spawn, furniture: {} } });
	const r = applyAction(s, WA, { t: 'activity', id: 'sleep-camp' });
	assert.ok(r.ok, r.msg);
	const want = rentOn(home.rentWeek, day);
	assert.notEqual(want, home.rentWeek);
	assert.ok(r.state.journal.some((l) => l.text.includes(`房租 $${want}。`)), r.state.journal.map((l) => l.text).slice(-5).join(' / '));
});

test('引擎：周结算的出租收入和房贷还款按结算日的租金行情和利率', () => {
	const pr = PROPERTIES[0];
	const day = firstDay((d) => d % 7 === 0 && rentMult(d) > 1.03 && loanRateMult(d) !== 1 && rentOn(pr.rentIncome, d) !== pr.rentIncome);
	const loan = 40000;
	let sawIncome = false;
	for (const seed of range(30)) {
		const s = make({ seed, clock: (day - 1) * DAY + 20 * 60, nextWeek: day, cash: 50000, properties: [{ id: pr.id, loan, rented: true, missed: 0 }] });
		const r = applyAction(s, WA, { t: 'activity', id: 'sleep-camp' });
		assert.ok(r.ok, r.msg);
		const text = r.state.journal.map((l) => l.text).join('\n');
		const pay = weeklyInterest(loan, loanRateMult(day)) + weeklyPrincipal(pr, loan);
		assert.ok(text.includes(`还款 $${pay}（`), `还款应为 $${pay}：${text.split('\n').slice(-4).join(' / ')}`);
		if (text.includes('租金收入')) {
			sawIncome = true;
			assert.ok(text.includes(`租金收入 $${rentOn(pr.rentIncome, day)}。`), text.split('\n').slice(-4).join(' / '));
		}
	}
	assert.ok(sawIncome, '30 个种子里应该至少有一次不空置');
});

test('引擎：房贷利息按利率系数；未传系数时与原公式一致', () => {
	assert.equal(weeklyInterest(72000), 72);
	const pr = PROPERTIES[0];
	const rHi = firstDay((d) => indicatorOn(getIndicator('rate'), d) >= 5);
	assert.ok(weeklyInterest(72000, loanRateMult(rHi)) > 72);
	const owner = make({ clock: rHi * DAY + 8 * 60, properties: [{ id: pr.id, loan: 50000, rented: false, missed: 0 }] });
	assert.equal(weeklyCosts(owner).property, pr.weekly + loanPayment(pr, 50000, loanRateMult(rHi)));
	assert.ok(weeklyCosts(owner).property > pr.weekly + loanPayment(pr, 50000));
});

test('引擎：矿业景气影响矿工工资，降温时暂停招新人', () => {
	const miner = getCareer('miner')!;
	const boom = firstDay((d) => miningPayMultOk(d) > 1.05);
	const s0 = make();
	const s1 = make({ clock: boom * DAY + 8 * 60 });
	assert.equal(careerPay(s0, 'miner', 0), miner.levels[0].pay);
	assert.ok(careerPay(s1, 'miner', 0) > miner.levels[0].pay);
	const bust = firstDay((d) => !miningHiring(d));
	assert.ok(hiringFrozen('miner', bust));
	assert.equal(hiringFrozen('barista', bust), undefined);
	const mine = WA.locations.find((l) => l.kind === 'mining')!;
	const strong = { ...make().skills, strength: 60 };
	const open = careersAt(make({ loc: mine.id, skills: strong }), WA).find((o) => o.career.id === 'miner')!;
	const frozen = careersAt(make({ loc: mine.id, skills: strong, clock: bust * DAY + 8 * 60 }), WA).find((o) => o.career.id === 'miner')!;
	assert.equal(open.blocked, undefined);
	assert.match(frozen.blocked ?? '', /暂停招/);
	// 在职的照常上班：careersAt 对已在这里工作的人仍提示「已经在这里工作」
	const working = careersAt(make({ loc: mine.id, skills: strong, clock: bust * DAY + 8 * 60, job: { career: 'miner', loc: mine.id, level: 0, shifts: 0, good: 0, lastDay: -1 } }), WA).find((o) => o.career.id === 'miner')!;
	assert.equal(working.blocked, '你已经在这里工作');
});
const miningPayMultOk = (d: number) => careerPayMult('miner', d);

test('新闻：只在每期第一天出；利率每次议息都有新闻；文案齐全且说明原因', () => {
	for (const def of INDICATORS) {
		for (const dir of ['up', 'down'] as const) assert.ok(NEWS_TEXT[def.id][dir]?.reasons.length, `${def.id} ${dir} 有原因文案`);
		for (const d of range(400)) {
			const n = newsOn(def, d);
			if (!n) continue;
			assert.equal(d % def.step, 0);
			assert.ok(d >= def.step);
			assert.ok(n.body.length > 10 && !/undefined|NaN/.test(n.body + n.title), n.body);
			assert.ok(n.body.includes(n.to));
		}
	}
	const rate = getIndicator('rate');
	for (let d = rate.step; d < 400; d += rate.step) assert.ok(newsOn(rate, d), `第 ${d} 天议息应有新闻`);
	// 方向与数值一致
	for (const d of range(400)) {
		const n = newsOn(getIndicator('oil'), d);
		if (n) assert.equal(n.dir === 'up', indicatorOn(getIndicator('oil'), d) > indicatorOn(getIndicator('oil'), d - 7));
	}
});

test('新闻：矿业跌破招工线时报道暂停招工，回升时报道恢复', () => {
	const m = getIndicator('mining');
	const cross = range(1200).filter((d) => d >= 7 && d % 7 === 0 && miningHiring(d) !== miningHiring(d - 7));
	assert.ok(cross.length >= 2);
	for (const d of cross) {
		const n = newsOn(m, d);
		assert.ok(n, `第 ${d} 天跨过招工线应有新闻`);
		assert.match(n!.body, miningHiring(d) ? /恢复招人/ : /暂停招新人/);
	}
});

test('新闻列表：新的在前、不超过上限、不超出回看窗口', () => {
	for (const day of [0, 5, 14, 60, 333, 900]) {
		const list = worldNews(day);
		assert.ok(list.length <= NEWS_MAX);
		for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].day >= list[i].day);
		for (const n of list) assert.ok(n.day <= day && n.day > day - NEWS_LOOKBACK_DAYS);
	}
	assert.equal(worldNews(0).length, 0, '第 0 天没有「变化」可报');
	assert.ok(worldNews(60).length > 0);
});

test('格式化：利率带 %，其余带单位', () => {
	assert.equal(fmtIndicator(getIndicator('rate'), 4.25), '4.25%');
	assert.equal(fmtIndicator(getIndicator('oil'), 199), '199 ¢/升');
	assert.equal(fmtIndicator(getIndicator('fx'), 4.8), '4.80 元');
});

test('界面卡片：六个指标、新闻和免责声明都在；数据里的特殊字符会被转义', () => {
	const html = worldCard(60);
	for (const def of INDICATORS) assert.ok(html.includes(def.name), def.name);
	assert.match(html, /不是真实行情/);
	assert.match(html, /<li>/);
	const t = NEWS_TEXT.oil.up!;
	const t2 = NEWS_TEXT.oil.down!;
	const keep = [t.title, t2.title];
	try {
		t.title = t2.title = '<img src=x onerror=alert(1)>';
		const day = range(400).find((d) => newsOn(getIndicator('oil'), d) && d > 20)!;
		const out = worldCard(day);
		assert.ok(!out.includes('<img'), '标题必须转义');
		assert.ok(out.includes('&lt;img'));
	} finally {
		[t.title, t2.title] = keep;
	}
});

// ---------- 合并 main 后复核补的 ----------
test('结算前的开销估算按下一个结算日的行情：换期那周提示和实际扣款一致（合并 main 后复核）', () => {
	// 租金指数换期：前一天和换期当天周租不同（结算按结算日扣，见上一个测试）
	const home = HOMES.find((h) => h.rentWeek >= 150 && h.rentWeek <= 400)!;
	const rentStep = firstDay((d) => d >= 7 && d % 7 === 0 && rentOn(home.rentWeek, d) !== rentOn(home.rentWeek, d - 1));
	const s = make({ clock: (rentStep - 1) * DAY + 8 * 60, nextWeek: rentStep, home: { type: home.id, loc: WA.spawn, furniture: {} } });
	assert.equal(settleDay(s), rentStep);
	assert.equal(weeklyCosts(s).rent, rentOn(home.rentWeek, rentStep), '按结算日，不按今天');
	assert.notEqual(weeklyCosts(s).rent, rentOn(home.rentWeek, rentStep - 1));
	// 利率换期：房贷还款也按结算日
	const rateStep = firstDay((d) => d >= 7 && d % 7 === 0 && loanRateMult(d) !== loanRateMult(d - 1));
	const pr = PROPERTIES[0];
	const loan = Math.round(pr.price * 0.8);
	const owner = make({ clock: (rateStep - 1) * DAY + 8 * 60, nextWeek: rateStep, properties: [{ id: pr.id, loan, rented: false, missed: 0 }] as never });
	assert.equal(weeklyCosts(owner).property, pr.weekly + loanPayment(pr, loan, loanRateMult(rateStep)));
	assert.notEqual(weeklyCosts(owner).property, pr.weekly + loanPayment(pr, loan, loanRateMult(rateStep - 1)));
	// 结算日已过还没结算（离线很久）：取今天
	assert.equal(settleDay(make({ clock: 40 * DAY, nextWeek: 35 })), 40);
});

test('页面：自己住处的周租、已有房产的租金收入和还款按下一个结算日显示（合并 main 后复核）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /每周 \$\$\{rentOn\(homeHere\.rentWeek, settleDay\(s\)\)\}/, '住处卡');
	assert.match(src, /出租中 \+\$\$\{rentOn\(pr\.rentIncome, settleDay\(s\)\)\}/, '已有房产的租金');
	assert.match(src, /每周还 \$\$\{loanPayment\(pr, op\.loan, loanRateMult\(settleDay\(s\)\)\)\}/, '已有房产的还款');
});

test('押金按标价（合并 main 后定）：租金指数高的时候签约，押金也不超过存档清洗的上限', () => {
	const hi = firstDay((d) => rentMult(d) > 1.03);
	const home = HOMES.find((h) => h.id === 'room')!;
	const s = make({ cash: 5000, clock: hi * DAY + 9 * 60, nextWeek: hi + 7 });
	const r = rentHome(s, WA, 'room');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.home!.bond, bondFor(home));
	assert.equal(bondFor(home), Math.round(home.rentWeek * 2));
	assert.ok(firstRent(s, home) > 0);
});

test('每周收支估算的出租收入按结算日的租金行情（合并 main 后复核）', () => {
	const hi = firstDay((d) => d % 7 === 0 && rentMult(d) > 1.03);
	const pr = PROPERTIES[0];
	const s = make({ clock: (hi - 1) * DAY + 8 * 60, nextWeek: hi, properties: [{ id: pr.id, loan: 0, rented: true, missed: 0 }] as never });
	assert.equal(weeklyBudget(s).rentIncome, Math.round(rentOn(pr.rentIncome, hi) * (1 - FINANCE.vacancy)));
	assert.ok(weeklyBudget(s).rentIncome > Math.round(pr.rentIncome * (1 - FINANCE.vacancy)));
});

test('按真实票价的线路（公交、火车、渡轮）在油价高低的日子都不变（合并 main 后定，world-events.md §8）', () => {
	const days = [0, ...DAYS.filter((d) => indicatorOn(getIndicator('oil'), d) >= 215 || indicatorOn(getIndicator('oil'), d) <= 165).filter((_, i) => i % 9 === 0)];
	assert.ok(days.some((d) => d > 300), '要包括后面几轮油价周期');
	for (const loc of ['perth', 'fremantle', 'kalgoorlie']) {
		const base = travelOptions(make({ loc, cash: 50000, clock: 8 * 60 }), WA).filter((o) => o.note && /票价/.test(o.note));
		assert.ok(loc !== 'perth' || base.length > 0, '珀斯有真实票价线路');
		for (const d of days) {
			const now = travelOptions(make({ loc, cash: 50000, clock: d * DAY + 8 * 60 }), WA);
			for (const o of base) {
				const o1 = now.find((x) => x.to === o.to && x.mode === o.mode && x.label === o.label);
				// 周日 Transperth 免费（note 变成「刷卡免费」）不算
				if (o1 && o1.note && /票价/.test(o1.note)) assert.equal(o1.cost, o.cost, `${loc} ${o.label} → ${o.to} 第 ${d} 天`);
			}
		}
	}
});
