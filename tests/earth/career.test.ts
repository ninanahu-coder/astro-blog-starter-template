// 生涯统计（docs/earth-game/career-stats.md）：收支按类别累计、公里、里程碑、周年小结、存档清洗、分享卡不带位置
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, applyTrade, applyWeeklyClaim, type GameAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState, START_CLOCK } from '../../src/game/core/character.ts';
import { claimDaily } from '../../src/game/core/daily.ts';
import { activitiesAt, careersAt, getPendingEvent, homesAt, shiftBlocked, shopAt, travelOptions } from '../../src/game/core/engine.ts';
import { dayOf } from '../../src/game/core/time.ts';
import {
	actionCats, arrivalDays, careerSummary, cleanTally, earnedOf, finishTally, peopleOf, placesOf, rollPeriods, spentOf, START_DAY, TALLY_CATS, weekIdx, yearIdx,
} from '../../src/game/core/tally.ts';
import { goalOfWeek } from '../../src/game/core/weekly.ts';
import { claimMail } from '../../src/game/core/exchange.ts';
import { cardData, cardSvg, careerHtml, int } from '../../src/game/ui/career.ts';
import { MILESTONES } from '../../src/game/data/milestones.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { WA } from '../../src/game/data/wa.ts';
import { WORLD_BASE } from '../../src/game/data/areas-base.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => {
	const s = { ...createCharacter({ id: 'career-player', name: '阿生', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 7 }), ...over };
	// 测试直接给了现金：记账锚点跟着设成这个数（等于「已经有这么多钱、之前都记过账」），不然第一步会把差额补记成「其他」
	return over.cash !== undefined && !over.tally ? { ...s, tally: { ...s.tally, cash: Math.round(over.cash) } } : s;
};
const locs = new Set(WA.locations.map((l) => l.id));
const sane = (raw: unknown) => sanitizeState(raw, locs, { fallbackLoc: WA.spawn })!;

function mulberry(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 挑一个大概率能成功的动作：活动、出行、买东西、找工作、上班、租房 */
function pickAction(s: PlayerState, r: () => number): GameAction | null {
	const ev = getPendingEvent(s);
	if (ev) return { t: 'event', choice: Math.floor(r() * ev.choices.length) };
	const c: GameAction[] = [];
	for (const x of activitiesAt(s, WA)) if (!x.blocked) c.push({ t: 'activity', id: x.act.id });
	for (const o of travelOptions(s, WA)) if (o.available) c.push({ t: 'travel', to: o.to, mode: o.mode });
	for (const x of shopAt(s, WA)) if (!x.blocked) c.push({ t: 'buy', item: x.item.id });
	for (const x of careersAt(s, WA)) if (!x.blocked) c.push({ t: 'job', op: 'apply', career: x.career.id });
	if (s.job && !shiftBlocked(s)) c.push({ t: 'job', op: 'work' }, { t: 'job', op: 'work' });
	if (!s.home) for (const x of homesAt(s, WA)) if (!x.blocked) c.push({ t: 'home', op: 'rent', home: x.home.id });
	if (s.home && s.home.loc === s.loc) c.push({ t: 'home', op: 'sleep' });
	return c.length ? c[Math.floor(r() * c.length)] : null;
}

test('开局：统计从第 0 天开始，快照是开局的地点数和人数；开局那天和 START_CLOCK 一致', () => {
	assert.equal(START_DAY, dayOf(START_CLOCK));
	const s = make();
	assert.equal(s.tally.from, 0);
	assert.equal(s.tally.pre, false, '新角色不需要补记「统计前」的里程碑');
	assert.deepEqual(s.tally.in, {});
	assert.deepEqual(s.tally.out, {});
	assert.equal(s.tally.km, 0);
	assert.deepEqual(s.tally.wk, { i: 0, earned: 0, out: {}, km: 0, places: 1, people: 0 });
	assert.equal(arrivalDays(s), 1);
	assert.deepEqual(sane(s).tally, s.tally, '清洗不改新角色的统计');
});

test('买东西记「吃喝购物」支出；收入、支出之差等于现金变化；不改入参', () => {
	const s = make({ cash: 500 });
	const item = shopAt(s, WA).find((x) => !x.blocked);
	assert.ok(item, '出生点能买东西');
	const before = JSON.stringify(s);
	const r = applyAction(s, WA, { t: 'buy', item: item!.item.id });
	assert.ok(r.ok, r.msg);
	assert.equal(JSON.stringify(s), before, '入参没被改');
	assert.equal(r.state.tally.out.shop, Math.round(s.cash) - Math.round(r.state.cash));
	assert.equal(earnedOf(r.state.tally) - spentOf(r.state.tally), Math.round(r.state.cash) - Math.round(s.cash));
});

test('出行：路费记「出行」，公里数等于路线里程；没到目的地不算公里', () => {
	const s = make({ cash: 2000 });
	const o = travelOptions(s, WA).find((x) => x.available && x.km > 0)!;
	assert.ok(o);
	const r = applyAction(s, WA, { t: 'travel', to: o.to, mode: o.mode });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.loc, o.to);
	assert.equal(r.state.tally.km, o.km);
	assert.ok((r.state.tally.out.transport ?? 0) > 0, '路费算出行');
	// 半路晕倒（没到目的地、在医院醒来）：路费照记，公里不算
	const weak = make({ cash: 5000, health: 3 });
	weak.needs = Object.fromEntries(Object.keys(weak.needs).map((k) => [k, 0])) as PlayerState['needs'];
	const far = travelOptions(weak, WA).filter((x) => x.available).sort((x, y) => y.minutes - x.minutes)[0];
	const c = applyAction(weak, WA, { t: 'travel', to: far.to, mode: far.mode });
	assert.ok(c.ok && c.collapsed, '这趟会晕倒');
	assert.notEqual(c.state.loc, far.to);
	assert.equal(c.state.tally.km, 0);
	assert.ok((c.state.tally.out.transport ?? 0) > 0);
	// 失败的出行不记账
	const bad = applyAction(s, WA, { t: 'travel', to: 'no-such-place', mode: 'road' });
	assert.equal(bad.ok, false);
	assert.equal(bad.state.tally.km, 0);
});

test('周结算的房租记「住房」、车险记「车辆」，不算到触发它的出行头上', () => {
	const home = HOMES.find((h) => h.id === 'room')!;
	const car = VEHICLES.find((v) => v.id === 'car')!;
	const s = make({ cash: 5000, home: { type: home.id, loc: WA.spawn, furniture: {} }, nextWeek: 0, vehicle: car.id });
	const o = travelOptions(s, WA).find((x) => x.available)!;
	const r = applyAction(s, WA, { t: 'travel', to: o.to, mode: o.mode });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tally.out.housing, home.rentWeek, '房租进住房');
	assert.equal(r.state.tally.out.vehicle, car.weekly, '车险进车辆');
	const fare = Math.round(s.cash) - Math.round(r.state.cash) - home.rentWeek - car.weekly!;
	assert.equal(r.state.tally.out.transport ?? 0, fare, '剩下的才是路费');
});

test('随机玩 400 步：每一步「收入 − 支出」都等于现金变化，类别只用已知的', () => {
	for (const seed of [1, 2, 3]) {
		const rng = mulberry(seed);
		let s = make({ cash: 800 });
		const start = s.cash;
		for (let i = 0; i < 400; i++) {
			const a = pickAction(s, rng);
			if (!a) break;
			const prev = s;
			const r = applyAction(s, WA, a);
			if (!r.ok) continue;
			s = sane(r.state); // 和服务端一样每步落盘前清洗（现金取整）
			const dIn = earnedOf(s.tally) - earnedOf(prev.tally);
			const dOut = spentOf(s.tally) - spentOf(prev.tally);
			assert.equal(dIn - dOut, s.cash - prev.cash, `第 ${i} 步 ${JSON.stringify(a)}`);
			assert.ok(dIn >= 0 && dOut >= 0, '累计数只增不减');
		}
		assert.equal(earnedOf(s.tally) - spentOf(s.tally), s.cash - start);
		for (const k of [...Object.keys(s.tally.in), ...Object.keys(s.tally.out)]) assert.ok((TALLY_CATS as readonly string[]).includes(k), k);
		assert.equal(s.tally.in.daily, undefined, '活动赚的钱算零工（工作），不算日常');
		assert.ok((s.tally.in.work ?? 0) > 0, '打过工');
		assert.ok(s.tally.km > 0, '走过路');
	}
});

test('动作类别：上班进工作、活动的收入算零工、真实地点按动作分', () => {
	assert.deepEqual(actionCats({ t: 'job', op: 'work' }), ['work', 'work']);
	assert.deepEqual(actionCats({ t: 'activity', id: 'x' }), ['work', 'daily']);
	assert.deepEqual(actionCats({ t: 'venue', venue: 'v', op: 'work', lat: 0, lon: 0, acc: 1 }), ['work', 'work']);
	assert.deepEqual(actionCats({ t: 'venue', venue: 'v', op: 'meal', lat: 0, lon: 0, acc: 1 }), ['shop', 'shop']);
	assert.deepEqual(actionCats({ t: 'property', op: 'sell', id: 'x' }), ['housing', 'housing']);
});

test('每日奖励、全服周目标、玩家交易都记账；新存档改了，旧存档的统计对象没被连带改掉', () => {
	const s = make();
	const before = JSON.stringify(s.tally);
	const d = claimDaily(s, 20_000)!;
	assert.equal(d.state.tally.in.reward, d.cash);
	assert.equal(JSON.stringify(s.tally), before, 'claimDaily 浅拷贝存档，统计对象要另拷一份');
	const week = 3000;
	const goal = goalOfWeek(week);
	const w = applyWeeklyClaim({ ...s, weekly: { week, n: 1, claimed: false } }, week, goal.target);
	assert.ok(w.ok, w.msg);
	assert.equal(w.state.tally.in.reward, goal.reward.cash);
	const a = make({ inventory: { firstaid: 1 } });
	const b = { ...make(), id: 'career-buyer', cash: 100 };
	const t = applyTrade(a, b, 'firstaid', 30, 20_000, { from: 'A', to: 'B' });
	assert.equal(typeof t, 'object');
	if (typeof t === 'string') return;
	assert.equal(t.from.tally.in.social, 30);
	assert.equal(t.to.tally.out.social, 30);
});

test('里程碑：第一次达成记下当天，之后不再改、辞职也不收回', () => {
	let s = make({ cash: 3000 });
	const job = careersAt(s, WA).find((x) => !x.blocked);
	assert.ok(job, '出生点能找到工作');
	const day = dayOf(s.clock);
	const r = applyAction(s, WA, { t: 'job', op: 'apply', career: job!.career.id });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tally.ms['ms-job'], day);
	s = { ...r.state, clock: r.state.clock + 3 * 1440 };
	const later = applyAction(s, WA, { t: 'activity', id: activitiesAt(s, WA).find((x) => !x.blocked)!.act.id });
	assert.ok(later.ok, later.msg);
	assert.ok(later.state.job, '还在职');
	assert.equal(later.state.tally.ms['ms-job'], day, '几天后还满足，也还是第一次那天');
	const again = applyAction(later.state, WA, { t: 'job', op: 'quit' });
	assert.ok(again.ok, again.msg);
	assert.equal(again.state.tally.ms['ms-job'], day, '辞职后也不收回');
	const tl = careerSummary(again.state).timeline;
	assert.ok(tl.some((m) => m.id === 'ms-job' && m.day === day));
});

test('旧存档（没有 tally）：从现在开始统计；之前就满足的里程碑记成「统计前」(−1)，不记成迁移那天', () => {
	const old: Record<string, unknown> = { ...make({ clock: 40 * 1440 + 600, job: null }), visited: Object.fromEntries(WA.locations.slice(0, 12).map((l) => [l.id, 2])) };
	delete old.tally;
	const s = sane(old);
	assert.equal(s.tally.from, 40);
	assert.equal(s.tally.pre, true);
	assert.deepEqual(s.tally.ms, {});
	assert.equal(s.tally.wk.places, 12, '本周快照从现在的地点数算起，迁移那周不会把 12 个地方都算成新去的');
	// 界面上还没结算过也按「统计前」显示
	const shown = careerSummary(s).timeline;
	assert.ok(shown.some((m) => m.id === 'ms-places-10' && m.day === -1));
	assert.ok(shown.some((m) => m.id === 'ms-days-30' && m.day === -1));
	// 第一次结算：之前满足的记 −1，这一步新达成的记今天
	const a = activitiesAt(s, WA).find((x) => !x.blocked)!;
	const r = applyAction(s, WA, { t: 'activity', id: a.act.id });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tally.pre, false);
	assert.equal(r.state.tally.ms['ms-places-10'], -1);
	assert.equal(r.state.tally.ms['ms-days-30'], -1);
	assert.equal(r.state.tally.ms['ms-days-100'], undefined);
});

test('跨周：上一周写成小结（收入、支出、大头、公里、新地点），本周换成新快照；跨好几周合成一张', () => {
	const s = make({ cash: 1000 });
	s.tally.in = { work: 500 };
	s.tally.out = { shop: 120, transport: 300 };
	s.tally.km = 250;
	s.visited = { ...s.visited, [WA.locations[1].id]: 1, [WA.locations[2].id]: 1 };
	s.clock = 7 * 1440 + 60; // 第 7 天 = 第 2 周（i=1）
	rollPeriods(s);
	assert.deepEqual(s.tally.lastWk, { i: 0, n: 1, earned: 500, spent: 420, top: 'transport', topAmt: 300, km: 250, places: placesOf(s) - 1, people: 0 });
	assert.equal(s.tally.wk.i, 1);
	assert.equal(s.tally.wk.earned, 500);
	assert.deepEqual(careerSummary(s).week, { i: 1, n: 1, earned: 0, spent: 0, top: null, topAmt: 0, km: 0, places: 0, people: 0 });
	s.tally.out.housing = 1000;
	s.clock = 30 * 1440; // 第 30 天 = 第 5 周（i=4），从第 2 周起跨了 3 周
	rollPeriods(s);
	assert.equal(s.tally.lastWk!.i, 1);
	assert.equal(s.tally.lastWk!.n, 3);
	assert.equal(s.tally.lastWk!.top, 'housing');
	assert.equal(s.tally.lastYr, null, '还没满一年');
	s.clock = 366 * 1440;
	rollPeriods(s);
	assert.equal(s.tally.lastYr!.i, 0);
	assert.equal(s.tally.lastYr!.spent, 1420);
	assert.equal(s.tally.yr.i, 1);
	assert.equal(weekIdx(6), 0);
	assert.equal(weekIdx(7), 1);
	assert.equal(yearIdx(364), 0);
	assert.equal(yearIdx(365), 1);
});

test('跨周的那一步：这一步的钱算在旧的一周里（和昨天回顾一样）', () => {
	const s = make({ cash: 2000, clock: 6 * 1440 + 23 * 60 + 50 });
	s.tally.wk = { ...s.tally.wk, i: 0 };
	const o = travelOptions(s, WA).find((x) => x.available && x.minutes > 30)!;
	const r = applyAction(s, WA, { t: 'travel', to: o.to, mode: o.mode });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tally.wk.i, 1);
	assert.equal(r.state.tally.lastWk!.spent, spentOf(r.state.tally));
	assert.equal(r.state.tally.lastWk!.km, o.km);
});

test('存档清洗：坏值不抛异常、钳到范围、只认已知的类别和里程碑、快照不超过累计数、周期序号不超过现在；幂等', () => {
	const ctx = { clock: 20 * 1440, places: 5, people: 3 };
	const bads: unknown[] = [null, undefined, 1, 'x', [], [1, 2], { in: [], out: 'x', km: NaN, ms: null, wk: 5, yr: [], lastWk: 'x' }, Object.create({ km: 99 })];
	for (const b of bads) {
		const t = cleanTally(b, ctx);
		assert.equal(t.km, 0);
		assert.deepEqual(cleanTally(t, ctx), t, `幂等：${JSON.stringify(b)}`);
	}
	const t = cleanTally({
		from: 999, km: 1e20, pre: 'yes',
		in: { work: 100.7, hacked: 5, __proto__: { shop: 9 }, transport: -5, fun: Infinity },
		out: { shop: 50, housing: 'x' },
		ms: { 'ms-job': 3, 'ms-fake': 2, 'ms-home': 99, 'ms-cert': -5, 'ms-vehicle': -1 },
		wk: { i: 99, earned: 1e9, out: { shop: 80, other: 7 }, km: -3, places: 50, people: 2 },
		yr: { i: 0, earned: 10, out: {}, km: 0, places: 1, people: 0 },
		lastWk: { i: 2, n: 50, earned: 1, spent: 10, top: 'hacked', topAmt: 5, km: 0, places: 0, people: 0 },
		lastYr: { i: 0, n: 1, earned: 1, spent: 1, top: 'shop', topAmt: 1, km: 0, places: 0, people: 0 },
	}, ctx);
	assert.equal(t.from, 20, '统计开始日不晚于今天');
	assert.equal(t.km, 1e12);
	assert.equal(t.pre, false);
	assert.deepEqual(t.in, { work: 100 }, '未知类别、原型链上的键、负数、无穷都不要');
	assert.deepEqual(t.out, { shop: 50 });
	assert.deepEqual(t.ms, { 'ms-job': 3, 'ms-vehicle': -1 }, '未知 id、未来的日子、小于 −1 的都不要');
	assert.deepEqual(t.wk, { i: 2, earned: 100, out: { shop: 50 }, km: 0, places: 5, people: 2 }, '周序号钳到现在（第 20 天是 i=2），快照不超过累计数');
	assert.equal(t.lastWk!.i, 1, '上一周必须早于本周');
	assert.equal(t.lastWk!.n, 1);
	assert.equal(t.lastWk!.top, null);
	assert.equal(t.lastWk!.topAmt, 0);
	assert.equal(t.lastYr, null, '第 0 年还没结束，不会有上一年');
	assert.deepEqual(cleanTally(t, ctx), t, '幂等');
});

test('整份存档：旧存档、坏 tally 都能读，sanitizeState 两次结果一样；发给客户端的存档里有统计', () => {
	for (const tally of [undefined, null, 'x', { in: { work: 1e15 } }, make().tally]) {
		const raw = { ...make(), tally };
		const once = sane(raw);
		assert.ok(once, '不判整份存档损坏');
		assert.deepEqual(sane(JSON.parse(JSON.stringify(once))), once);
	}
});

test('认识的人 = 有过互动的本地人 + 一起做过事的玩家', () => {
	const s = make({
		relations: { a: { score: 1, last: {}, seen: [], known: [] }, b: { score: 1, last: {}, seen: [], known: [] } },
		met: { aaaaaaaaaaaa: { name: 'x', avatar: '🧑', n: 1, last: 0 } },
	});
	assert.equal(peopleOf(s), 3);
	assert.deepEqual(careerSummary(s).people, { npc: 2, players: 1 });
});

test('最常去的地方按次数排，同次数按 id 排，结果稳定', () => {
	const s = make({ visited: { b: 3, a: 3, c: 9, d: 1 } });
	assert.deepEqual(careerSummary(s).topPlaces, [{ id: 'c', n: 9 }, { id: 'a', n: 3 }, { id: 'b', n: 3 }]);
});

// ---------- 页面和分享卡 ----------

/** 一个玩了很久、到处去过的存档 */
function veteran(): PlayerState {
	const s = make({ name: '<b>阿生</b>&"', clock: 400 * 1440 + 600, cash: 9000, job: null });
	s.visited = Object.fromEntries(WORLD_BASE.locations.map((l, i) => [l.id, (i % 7) + 1]));
	s.tally.in = { work: 42000, reward: 300 };
	s.tally.out = { housing: 9000, transport: 4000, shop: 2500 };
	s.tally.km = 6400;
	for (const m of MILESTONES) s.tally.ms[m.id] = 3;
	rollPeriods(s);
	return s;
}

test('分享卡：确定性（同样的存档画出一模一样的 SVG），不带任何地点名、区域名和坐标', () => {
	const s = veteran();
	for (const kind of ['week', 'year', 'lastyear'] as const) {
		const a = cardSvg(s, kind);
		assert.equal(a, cardSvg(structuredClone(s), kind), '确定性');
		assert.ok(a.startsWith('<svg') && a.endsWith('</svg>'));
		const text = a.replace(/<[^>]*>/g, ' ');
		for (const l of WORLD_BASE.locations) {
			assert.ok(!a.includes(l.name), `${kind} 卡上出现了地点「${l.name}」`);
			assert.ok(!new RegExp(`(^|[^a-z-])${l.id}([^a-z-]|$)`).test(text), `${kind} 卡上出现了地点 id「${l.id}」`);
		}
		for (const name of ['西澳', '南澳', 'Western Australia', 'South Australia', 'Perth', 'Adelaide']) assert.ok(!a.includes(name), `${kind} 卡上出现了区域「${name}」`);
		for (const l of WORLD_BASE.locations.slice(0, 30)) assert.ok(!a.includes(String(l.lat)), '没有坐标');
	}
	assert.equal(cardData(s, 'lastyear').done, true);
	assert.match(cardSvg(s, 'lastyear'), /第 1 年/);
});

test('分享卡和生涯页：玩家名、地点名都经过转义', () => {
	const s = veteran();
	const svg = cardSvg(s, 'year');
	assert.ok(!svg.includes('<b>阿生'), '名字里的标签被转义');
	assert.ok(svg.includes('&lt;b&gt;阿生&lt;/b&gt;&amp;&quot;'));
	const html = careerHtml(s, () => '<img src=x onerror=alert(1)>');
	assert.ok(!html.includes('<img'), '地点名被转义');
	assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
	assert.ok(html.includes('生涯档案'));
	assert.ok(html.includes('data-career="year"'));
	assert.ok(html.includes('data-career="lastyear"'), '有上一年时可以分享上一年');
});

test('生涯页：旧存档写明从第几天开始统计；钱数千分位与浏览器语言无关', () => {
	const old: Record<string, unknown> = { ...make({ clock: 40 * 1440 + 600 }) };
	delete old.tally;
	const html = careerHtml(sane(old), (id) => id);
	assert.ok(html.includes('从第 41 天开始统计'));
	assert.equal(int(1234567), '1,234,567');
	assert.equal(int(-1234.4), '-1,234');
	assert.equal(int(999), '999');
});

test('里程碑数据：id 唯一、门槛是正整数、标题不带地点名（分享卡会用到）', () => {
	const ids = new Set(MILESTONES.map((m) => m.id));
	assert.equal(ids.size, MILESTONES.length);
	for (const m of MILESTONES) {
		assert.match(m.id, /^ms-[a-z0-9-]+$/);
		assert.ok(Number.isInteger(m.n) && m.n >= 1);
		for (const l of WORLD_BASE.locations) assert.ok(!m.title.includes(l.name), `${m.id} 带了地点名`);
	}
});

test('finishTally 只改新存档：旧存档和它共用的统计对象不被改', () => {
	const prev = make();
	const next = { ...prev, cash: prev.cash + 50 };
	const before = JSON.stringify(prev);
	finishTally(prev, next, ['work', 'work']);
	assert.equal(JSON.stringify(prev), before);
	assert.equal(next.tally.in.work, 50);
});

// ---------- 合并 main 后复核补的 ----------
const balanced = (x: PlayerState, cash0: number) => earnedOf(x.tally) - spentOf(x.tally) === Math.round(x.cash) - cash0;

test('交易所领邮箱的钱记「人情往来」；收入 − 支出仍等于现金变化（合并 main 后复核）', () => {
	const s = make();
	const cash0 = s.cash;
	const r = claimMail(s, [{ id: 'm1', cash: 500, item: null, n: 0, text: '卖出', at: 1 }]);
	assert.equal(typeof r, 'object');
	if (typeof r === 'string') return;
	assert.equal(r.state.tally.in.social, 500);
	assert.ok(balanced(r.state, cash0));
	assert.equal(r.state.tally.cash, Math.round(r.state.cash), '记账后锚点跟上现金');
	assert.equal(s.tally.in.social, undefined, '不改入参');
});

test('两次记账之间别处改了现金（服务端、别的部署）：下一步补记到「其他」，对账不断（合并 main 后复核）', () => {
	const s = make();
	const cash0 = s.cash;
	const moved = { ...s, cash: s.cash + 777 }; // 没经过记账的现金变化
	const r = applyAction(moved, WA, { t: 'activity', id: activitiesAt(moved, WA).find((x) => !x.blocked)!.act.id });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.tally.in.other, 777);
	assert.ok(balanced(r.state, cash0));
	// 读档清洗：锚点保留，幂等
	const a = sane(JSON.parse(JSON.stringify(r.state)));
	assert.equal(a.tally.cash, r.state.tally.cash);
	assert.deepEqual(sane(JSON.parse(JSON.stringify(a))).tally, a.tally);
	// 没有锚点的统计（迁移前写的）：从现在的现金开始，不补以前的差额
	const { cash: _c, ...noAnchor } = r.state.tally;
	assert.equal(sane({ ...JSON.parse(JSON.stringify(r.state)), tally: noAnchor }).tally.cash, Math.round(r.state.cash));
});

test('主线章节的奖励记「奖励」，路费照样记「出行」（合并 main 后复核）', () => {
	// 第一章只差「去弗里曼特尔」：坐车过去，章节完成发 $50
	const other = WA.locations.find((l) => l.id !== WA.spawn && l.id !== 'fremantle')!.id;
	const s = make({ cash: 1000, story: { ch: 0, done: { meal: 1, chat: 2, buy: 1 } }, visited: { [WA.spawn]: 1, [other]: 1 } } as never);
	const opt = travelOptions(s, WA).find((o) => o.to === 'fremantle' && o.available)!;
	assert.ok(opt, '从出生点能去弗里曼特尔');
	const r = applyAction(s, WA, { t: 'travel', to: 'fremantle', mode: opt.mode });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.story.ch, 1, '第一章完成');
	assert.equal(r.state.tally.in.reward, 50, '章节奖励记「奖励」');
	assert.ok((r.state.tally.out.transport ?? 0) >= opt.cost, '路费照样记「出行」，没被奖励抵掉');
	assert.ok(balanced(r.state, 1000));
});

test('晕倒的医药费记「日常」，不算到这次出行头上（合并 main 后复核）', () => {
	const s = make({ cash: 2000, health: 1, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } as never });
	const opt = travelOptions(s, WA).find((o) => o.available && o.minutes >= 120)!;
	const r = applyAction(s, WA, { t: 'travel', to: opt.to, mode: opt.mode });
	assert.ok(r.collapsed, '路上晕倒');
	assert.ok((r.state.tally.out.daily ?? 0) >= 100, '医药费在「日常」');
	assert.ok((r.state.tally.out.transport ?? 0) <= opt.cost, '出行里只有路费');
	assert.ok(balanced(r.state, 2000));
});

test('周结算自动扣的罚款记「其他」，不算到触发它的动作头上（合并 main 后复核）', () => {
	const s = make({ cash: 1000, law: { hist: [], ban: 0, owed: 120, cs: 0, csDue: -1, record: 0, drank: -1 } } as never);
	const t = { ...s, clock: s.nextWeek * 1440 - 30 };
	const opt = activitiesAt(t, WA).find((x) => !x.blocked && x.act.minutes >= 60)!;
	const r = applyAction(t, WA, { t: 'activity', id: opt.act.id });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.law.owed, 0, '周结算扣了罚款');
	assert.equal(r.state.tally.out.other, 120);
	assert.ok(balanced(r.state, 1000));
});

test('main 新加的动作都有类别（合并 main 后复核）', () => {
	const want: [GameAction, string][] = [
		[{ t: 'sell', item: 'x' } as never, 'shop'], [{ t: 'study' } as never, 'study'], [{ t: 'care', kind: 'gp' } as never, 'daily'], [{ t: 'pet', op: 'feed' } as never, 'daily'],
		[{ t: 'trail' } as never, 'fun'], [{ t: 'claim', id: 'x' } as never, 'reward'], [{ t: 'live', id: 'x' } as never, 'reward'], [{ t: 'onboard' } as never, 'reward'],
		[{ t: 'asset', op: 'buy', id: 'x', amount: 1 } as never, 'other'], [{ t: 'visa', op: 'ielts' } as never, 'other'],
	];
	for (const [a, cat] of want) assert.deepEqual(actionCats(a), [cat, cat], a.t);
});

test('读档清洗：还没补记的差额（锚点和现金不一样）保留下来，下次照样补记（合并 main 后复核）', () => {
	const s = make({ cash: 900 });
	const raw = JSON.parse(JSON.stringify({ ...s, tally: { ...s.tally, cash: 800 } }));
	assert.equal(sane(raw).tally.cash, 800);
});

test('页面和统计：「生涯」标签进统计白名单；系统分享被拒时退回下载（合并 main 后复核）', async () => {
	const { STAT_EVENTS } = await import('../../src/game/ui/telemetry.ts');
	assert.ok(STAT_EVENTS.metab!.includes('career'));
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /try \{ await nav\.share\(\{ files: \[file\], title: '地球人生' \}\); return; \} catch \(e\) \{ if \(\(e as Error\)\?\.name === 'AbortError'\) return; \} \}/);
});
