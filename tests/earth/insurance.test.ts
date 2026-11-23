// 保险（第一版）：保单生效期、保费加价、理赔核算、出险事件、买保险动作、存档清洗。看病的保障跟签证走（core/health.ts），不在这里。设计见 docs/earth-game/insurance.md
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyEffect, atOwnHome, getLocation, getPendingEvent, resaleValue, travelOptions } from '../../src/game/core/engine.ts';
import { assessClaim, cleanCover, coverActive, extendCover, insureBlocked, premiumFor, recentClaims, settleLoss } from '../../src/game/core/insurance.ts';
import { CLAIM_LOADING, CLAIM_WINDOW, CLAIMS_MAX, COVER_AHEAD_MAX, getPolicy, LOSS_LABEL, POLICIES } from '../../src/game/data/insurance.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { validateEvents } from '../../src/game/core/event-rules.ts';
import { WA } from '../../src/game/data/wa.ts';
import { insuranceCard } from '../../src/game/ui/insurance.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { readFileSync } from 'node:fs';
import type { Cover, LossKind, PlayerState } from '../../src/game/core/types.ts';

const D = 10; // 测试用的「今天」（游戏日）
const at = (day: number, hour = 10) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, origin = 'student'): PlayerState => ({
	...createCharacter({ id: 'ins-player', name: '保', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(D),
	cash: 5000,
	...over,
});
const cov = (from: number, until: number, claims: number[] = []): Cover => ({ from, until, claims });
const comp = getPolicy('car-comp')!;
const tpp = getPolicy('car-tpp')!;

test('数据：id 唯一；能买的保单保费、天数为正，赔的损失种类都有中文名；每条都写了来源；强制险不能买、不赔游戏里的损失', () => {
	assert.equal(new Set(POLICIES.map((p) => p.id)).size, POLICIES.length);
	for (const p of POLICIES) {
		assert.ok(p.source.length > 0, `${p.id} 没写来源`);
		assert.ok(p.excess >= 0 && p.wait >= 0, p.id);
		for (const k of p.covers) assert.ok(LOSS_LABEL[k], `${p.id} 的 ${k} 没有中文名`);
		if (p.compulsory) assert.deepEqual([p.premium, p.days, p.covers.length], [0, 0, 0], p.id);
		else assert.ok(p.premium > 0 && p.days > 0, p.id);
	}
});

test('出险事件：每种损失都有保单能赔，也都有事件会触发；金额为正；住处、开车的出险事件不进抛锚池', () => {
	const kinds = Object.keys(LOSS_LABEL) as LossKind[];
	for (const k of kinds) assert.ok(POLICIES.some((p) => p.covers.includes(k)), `${k} 没有保单赔`);
	const used = new Set<LossKind>();
	for (const e of EVENTS) for (const c of e.choices) for (const o of [c.ok, c.fail]) for (const l of o?.fx.loss ?? []) {
		assert.ok(l.amount > 0, `${e.id} 损失金额要为正`);
		used.add(l.kind);
	}
	for (const k of kinds) assert.ok(used.has(k), `没有事件会造成 ${k}`);
	for (const e of EVENTS.filter((x) => x.id.startsWith('ins-'))) assert.ok(e.weight > 0 && !e.breakdown && !e.venueTypes, e.id);
	// 车的损失只出现在自己开车才有的事件里（合并 main 后改用法律分支的 driving），坐巴士不会被扣修车钱
	for (const e of EVENTS) if (e.choices.some((c) => [c.ok, c.fail].some((o) => o?.fx.loss?.some((l) => ['collision', 'tpp', 'car-theft', 'car-storm'].includes(l.kind))))) assert.ok(e.driving, `${e.id} 要写 driving: true`);
	for (const e of EVENTS) if (e.choices.some((c) => [c.ok, c.fail].some((o) => o?.fx.loss?.some((l) => l.kind.startsWith('contents'))))) assert.equal(e.exposure, 'home', e.id);
});

test('生效期：from 当天起生效（含），until 当天起失效（不含）；没有保单不生效', () => {
	const c = { contents: cov(5, 8) };
	assert.equal(coverActive(c, 'contents', 4), false);
	assert.equal(coverActive(c, 'contents', 5), true);
	assert.equal(coverActive(c, 'contents', 7), true);
	assert.equal(coverActive(c, 'contents', 8), false);
	assert.equal(coverActive(c, 'travel', 6), false);
	assert.equal(coverActive({}, 'toString', 6), false, '原型链上的键不算保单');
});

test('保费：没出过险按基础价；近一年每出险一次加价，有上限；一年前的不算', () => {
	assert.equal(premiumFor({}, 'car-comp', D), comp.premium);
	assert.equal(premiumFor({ 'car-comp': cov(0, 30, [D - 1]) }, 'car-comp', D), Math.round(comp.premium * (1 + CLAIM_LOADING.perClaim)));
	const many = Array.from({ length: 8 }, (_, i) => D - i);
	assert.equal(premiumFor({ 'car-comp': cov(0, 30, many) }, 'car-comp', D), Math.round(comp.premium * (1 + CLAIM_LOADING.max)));
	const day = 500;
	assert.equal(recentClaims(cov(0, 1, [day - CLAIM_WINDOW, day - CLAIM_WINDOW + 1]), day), 1, '正好一年前那次不算');
	assert.equal(recentClaims(cov(0, 1, [day + 3]), day), 0, '未来的理赔不算');
	assert.equal(premiumFor({}, 'nope', D), 0);
});

test('买 / 续一期：新买从今天 + 等待期起；没到期续保从原到期日往后接、不重新等；过期了重新等，理赔记录保留', () => {
	assert.deepEqual(extendCover(undefined, comp, D), cov(D + comp.wait, D + comp.wait + comp.days));
	assert.deepEqual(extendCover(cov(3, D + 5, [4]), comp, D), cov(3, D + 5 + comp.days, [4]));
	assert.deepEqual(extendCover(cov(D + 2, D + 30), comp, D), cov(D + 2, D + 30 + comp.days), '还在等待期也算没到期');
	assert.deepEqual(extendCover(cov(0, D, [2]), comp, D), cov(D + comp.wait, D + comp.wait + comp.days, [2]), '到期当天已经失效');
});

test('理赔核算：没保险全额自付；有保险付免赔额；损失小于免赔额自己付、保险不赔；车损按车值封顶；挑免赔额最低的有效保单；等待期内不赔', () => {
	const loss = (kind: LossKind, amount: number) => ({ kind, amount });
	assert.deepEqual(assessClaim({}, D, loss('collision', 2000), 4000), { policy: null, youPay: 2000, insurerPays: 0 });
	const c = { 'car-comp': cov(0, 30) };
	assert.deepEqual(assessClaim(c, D, loss('collision', 2000), 4000), { policy: comp, youPay: comp.excess, insurerPays: 2000 - comp.excess });
	assert.deepEqual(assessClaim(c, D, loss('collision', comp.excess - 1), 4000), { policy: comp, youPay: comp.excess - 1, insurerPays: 0 });
	assert.deepEqual(assessClaim(c, D, loss('collision', 3000), 2000), { policy: comp, youPay: 3000 - (2000 - comp.excess), insurerPays: 2000 - comp.excess }, '最多赔到车值');
	assert.deepEqual(assessClaim(c, D, loss('collision', 3000), 0), { policy: comp, youPay: 3000, insurerPays: 0 }, '没车值就赔不了车损');
	assert.equal(assessClaim(c, D, loss('tpp', 3000), 0).insurerPays, 3000 - comp.excess, '第三方财产不受车值封顶');
	assert.equal(assessClaim(c, D, loss('luggage', 300), 4000).policy, null, '全险不管行李');
	assert.equal(assessClaim({ 'car-comp': cov(D + 1, 40) }, D, loss('collision', 2000), 4000).insurerPays, 0, '还在等待期');
	// 两张都赔 tpp：挑免赔额低的（免赔额一样时取先列出的那张）
	const both = { 'car-comp': cov(0, 30), 'car-tpp': cov(0, 30) };
	const pick = assessClaim(both, D, loss('tpp', 3000), 4000).policy!;
	assert.equal(pick.excess, Math.min(comp.excess, tpp.excess));
	assert.deepEqual(assessClaim(c, D, loss('collision', 0), 4000), { policy: null, youPay: 0, insurerPays: 0 });
	// 现在两张车险免赔额一样，换一张数据表验证「挑免赔额最低」，不论列出顺序
	const hi = { ...comp, id: 'hi', excess: 900 };
	const lo = { ...tpp, id: 'lo', excess: 300 };
	const two = { hi: cov(0, 30), lo: cov(0, 30) };
	for (const order of [[hi, lo], [lo, hi]]) assert.equal(assessClaim(two, D, loss('tpp', 3000), 4000, order).policy!.id, 'lo');
});

test('结算损失：自付部分扣现金、扣到 0 为止；保险赔了钱才记理赔，记录有上限', () => {
	const s = make({ cash: 1000, cover: { 'car-comp': cov(0, 30) } });
	const r = settleLoss(s, { kind: 'collision', amount: 2000 }, D, 4000);
	assert.equal(s.cash, 1000 - comp.excess);
	assert.deepEqual(s.cover['car-comp'].claims, [D]);
	assert.match(r.text, /理赔/);
	const poor = make({ cash: 100, cover: {} });
	settleLoss(poor, { kind: 'collision', amount: 2000 }, D, 4000);
	assert.equal(poor.cash, 0);
	const small = make({ cash: 1000, cover: { 'car-comp': cov(0, 30) } });
	settleLoss(small, { kind: 'collision', amount: 100 }, D, 4000);
	assert.deepEqual([small.cash, small.cover['car-comp'].claims], [900, []], '没超免赔额不记理赔');
	const full = make({ cover: { 'car-comp': cov(0, 30, Array.from({ length: CLAIMS_MAX }, (_, i) => i)) } });
	settleLoss(full, { kind: 'collision', amount: 2000 }, D, 4000);
	assert.equal(full.cover['car-comp'].claims.length, CLAIMS_MAX);
	assert.equal(full.cover['car-comp'].claims.at(-1), D);
});

test('事件里的损失走保险：applyEffect 的 fx.loss 有全险只扣免赔额，没保险全额', () => {
	const fx = { loss: [{ kind: 'collision' as const, amount: 1800 }, { kind: 'tpp' as const, amount: 2500 }] };
	const bare = make({ cover: {} });
	applyEffect(bare, fx, WA);
	assert.equal(bare.cash, 5000 - 4300);
	const insured = make({ cover: { 'car-comp': cov(0, 30) } });
	assert.ok(resaleValue(insured.vehicle, insured.car.km) >= 1800, '留学生的车值够赔这次车损');
	applyEffect(insured, fx, WA);
	assert.equal(insured.cash, 5000 - comp.excess * 2);
	assert.equal(insured.journal.filter((j) => j.text.includes('理赔')).length, 2);
});

test('自己车的损失最多赔到按里程折旧后的车值，和卖车、净资产用的是同一个数（合并 main 后复核）', () => {
	const km = 200_000;
	const worn = make({ cover: { 'car-comp': cov(0, 30) }, car: { km, since: 0 } });
	const value = resaleValue(worn.vehicle, km);
	assert.ok(value < resaleValue(worn.vehicle), '跑了 20 万公里的车值钱少');
	const loss = value + 1000; // 损失超过折旧后的车值，封顶才起作用
	applyEffect(worn, { loss: [{ kind: 'collision', amount: loss }] }, WA);
	assert.equal(worn.cash, 5000 - (loss - (value - comp.excess)), '保险只赔到折旧后的车值减免赔额');
});

test('事件校验：exposure 只能写 home，不能和 venueTypes 一起写', () => {
	const base = EVENTS.find((e) => e.exposure === 'home')!;
	assert.deepEqual(validateEvents([base]), []);
	assert.ok(validateEvents([{ ...base, exposure: 'car' as never }]).some((m) => m.includes('exposure 只能写 home')));
	assert.ok(validateEvents([{ ...base, venueTypes: ['gym'] }]).some((m) => m.includes('exposure 事件')));
});

test('晕倒住院的医药费不归保险管：有保单也照旧自付，不记理赔（合并 main 后：看病跟签证的保障走）', () => {
	// 结算日放远：住院 12 小时不碰上周结算
	const all = Object.fromEntries(POLICIES.filter((p) => !p.compulsory).map((p) => [p.id, cov(0, 30)]));
	const sick = make({ health: 1, nextWeek: 999, cover: all });
	assert.ok(applyEffect(sick, { health: -50 }, WA));
	assert.equal(sick.cash, 5000 - 500, '$100 + 现金 10%，最多 $500');
	assert.ok(Object.values(sick.cover).every((c) => c.claims.length === 0));
	assert.ok(!POLICIES.some((p) => p.id === 'health'), '健康险不在这里卖');
});

test('住处出险事件只在回到自己住处时出现；其他事件不受限', () => {
	const homeEv = EVENTS.find((e) => e.exposure === 'home')!;
	const loc = getLocation(WA, WA.spawn)!;
	assert.equal(atOwnHome(homeEv, make({ home: null }), loc), false, '没有住处');
	const home = { type: 'room', loc: loc.id, furniture: {} };
	assert.equal(atOwnHome(homeEv, make({ home } as never), loc), true);
	assert.equal(atOwnHome(homeEv, make({ home: { ...home, loc: 'somewhere-else' } } as never), loc), false);
	assert.equal(atOwnHome(EVENTS.find((e) => !e.exposure)!, make({ home: null }), loc), true);
});

test('抵达抽事件：没车坐巴士永远抽不到车险事件；自己开车能抽到', () => {
	const from = getLocation(WA, WA.spawn)!;
	const dests = travelOptions(make(), WA).filter((o) => o.mode === 'road' && ['city', 'town'].includes(getLocation(WA, o.to)!.kind));
	assert.ok(dests.length > 0, `${from.id} 开车能到城镇`);
	let carHits = 0;
	for (let seed = 1; seed <= 400; seed++) {
		const to = dests[seed % dests.length].to;
		const bus = applyAction(make({ vehicle: 'none', car: { km: 0, since: 0 }, seed, nextWeek: 999 }, 'backpacker'), WA, { t: 'travel', to, mode: 'road' });
		assert.ok(bus.ok, bus.msg);
		const ev = getPendingEvent(bus.state);
		assert.ok(!ev?.driving, `坐巴士抽到了 ${ev?.id}`);
		const drive = applyAction(make({ seed, nextWeek: 999 }), WA, { t: 'travel', to, mode: 'road' });
		if (getPendingEvent(drive.state)?.id.startsWith('ins-')) carHits++;
	}
	assert.ok(carHits > 0, '自己开车 400 趟一次车险事件都没抽到');
});

test('抵达抽事件：住处出险事件只在回到自己住处时抽到（合并 main 后复核）', () => {
	// 屋顶漏水只在风暴天，家里被撬不限天气：回到自己住处所在地点能抽到，去别处或没住处时抽不到
	const there = WA.locations.find((l) => l.id !== WA.spawn && travelOptions(make(), WA).some((o) => o.to === l.id && o.available))!;
	let homeHits = 0;
	for (let seed = 1; seed <= 400; seed++) {
		const mine = applyAction(make({ seed, nextWeek: 999, vehicle: 'none', home: { type: 'room', loc: there.id, furniture: {} } } as never), WA, { t: 'travel', to: there.id, mode: travelOptions(make({ vehicle: 'none' }), WA).find((o) => o.to === there.id && o.available)!.mode });
		if (getPendingEvent(mine.state)?.exposure === 'home') homeHits++;
		const away = applyAction(make({ seed, nextWeek: 999, vehicle: 'none', home: { type: 'room', loc: WA.spawn, furniture: {} } } as never), WA, { t: 'travel', to: there.id, mode: travelOptions(make({ vehicle: 'none' }), WA).find((o) => o.to === there.id && o.available)!.mode });
		assert.notEqual(getPendingEvent(away.state)?.exposure, 'home', `住处在别处却抽到了 ${getPendingEvent(away.state)?.id}`);
	}
	assert.ok(homeHits > 0, '回到自己住处 400 趟一次住处事件都没抽到');
});

test('买保险：扣保费、写保单、记日志、不改入参；有事件、钱不够、条件不满足、续得太远都不行', () => {
	assert.deepEqual(parseAction({ t: 'insure', id: 'car-comp' }), { t: 'insure', id: 'car-comp' });
	assert.equal(parseAction({ t: 'insure', id: '<x>' }), null);
	assert.equal(parseAction({ t: 'insure' }), null);
	const s = make({ cover: {} });
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'insure', id: 'car-comp' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不改入参');
	assert.equal(r.state.cash, 5000 - comp.premium);
	assert.deepEqual(r.state.cover['car-comp'], cov(D + comp.wait, D + comp.wait + comp.days));
	assert.equal(r.state.clock, s.clock, '网上办，不花时间');
	assert.match(r.state.journal.at(-1)!.text, /买了车辆全险/);
	const again = applyAction(r.state, WA, { t: 'insure', id: 'car-comp' });
	assert.ok(again.ok);
	assert.equal(again.state.cover['car-comp'].until, D + comp.wait + comp.days * 2);
	assert.match(again.msg, /续了/);

	assert.equal(applyAction(make({ pending: { eventId: EVENTS[0].id } }), WA, { t: 'insure', id: 'travel' }).ok, false);
	assert.equal(applyAction(make(), WA, { t: 'insure', id: 'health' }).ok, false, '健康险不在这里卖');
	assert.equal(applyAction(make({ cash: comp.premium - 1 }), WA, { t: 'insure', id: 'car-comp' }).ok, false);
	assert.equal(applyAction(make({ vehicle: 'none' }), WA, { t: 'insure', id: 'car-tpp' }).ok, false);
	assert.equal(applyAction(make(), WA, { t: 'insure', id: 'contents' }).ok, false, '没有住处');
	assert.equal(applyAction(make({ home: { type: 'room', loc: WA.spawn, furniture: {} } }), WA, { t: 'insure', id: 'contents' }).ok, true);
	assert.equal(applyAction(make(), WA, { t: 'insure', id: 'ctp' }).ok, false, '强制险不单独买');
	assert.equal(applyAction(make(), WA, { t: 'insure', id: 'nope' }).ok, false);
	// 续保最多续到今天之后 COVER_AHEAD_MAX 天
	const far = make({ cover: { travel: cov(0, D + COVER_AHEAD_MAX - getPolicy('travel')!.days + 1) } });
	assert.match(insureBlocked(far, 'travel', D)!, /很久以后/);
	const edge = make({ cover: { travel: cov(0, D + COVER_AHEAD_MAX - getPolicy('travel')!.days) } });
	assert.equal(insureBlocked(edge, 'travel', D), undefined);
});

test('开局保单：哪个出身都没有（留学生的 OSHC 跟学生签证走，见 core/health.ts）', () => {
	for (const origin of ['student', 'backpacker', 'fifo', 'surfer']) assert.deepEqual(createCharacter({ id: 'x', name: 'x', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 1 }).cover, {}, origin);
});

test('存档清洗：旧存档缺字段给 {}；坏值、未知保单、强制险丢掉；日期钳到合法范围；理赔排序截断；幂等', () => {
	const base = make();
	const { cover: _drop, ...old } = base;
	assert.deepEqual(sanitizeState(old)!.cover, {}, '旧存档没有 cover');
	for (const bad of [null, 1, 'x', [], [1, 2], NaN]) assert.deepEqual(cleanCover(bad, D), {});
	const raw = {
		contents: { from: 3.7, until: 1e12, claims: [...Array.from({ length: 20 }, () => 4), 9, 'x', 2, -5, 1e9, NaN] },
		travel: { from: 50, until: 20, claims: 'nope' },
		ctp: { from: 0, until: 99, claims: [] },
		'car-comp': { from: 'a', until: 5 },
		bogus: { from: 0, until: 9, claims: [] },
		health: { from: 0, until: 9, claims: [] },
		toString: { from: 0, until: 9, claims: [] },
	};
	const c = cleanCover(raw, D);
	assert.deepEqual(Object.keys(c).sort(), ['contents', 'travel'], '健康险（合并 main 后去掉）的旧保单也丢掉');
	assert.equal(c.contents.from, 3);
	assert.equal(c.contents.until, D + COVER_AHEAD_MAX);
	assert.equal(c.contents.claims.length, CLAIMS_MAX);
	assert.ok(c.contents.claims.every((d, i, a) => d >= 0 && d <= D && (i === 0 || a[i - 1] <= d)));
	assert.deepEqual(c.travel, cov(20, 20, []), 'from 不晚于 until');
	assert.deepEqual(cleanCover(c, D), c, '幂等');
	const once = sanitizeState({ ...base, cover: raw })!;
	assert.deepEqual(once.cover, c, 'sanitizeState 用 cleanCover 清洗');
	assert.deepEqual(sanitizeState(once), once);
});

test('保险卡：插进 HTML 的文字都经过 esc；能买的有按钮，买不了的按钮禁用并写原因；没车不显示 CTP', () => {
	const marks: string[] = [];
	const esc = (v: unknown) => { marks.push(String(v)); return String(v).replace(/[&<>"']/g, ''); };
	const html = insuranceCard(make({ vehicle: 'none', cover: {} }), false, esc);
	assert.ok(!html.includes('CTP'));
	assert.match(html, /data-insure="travel"/);
	assert.ok(!html.includes('data-insure="health"'));
	assert.match(html, /data-insure="car-comp" disabled title="你没有车。"/);
	for (const p of POLICIES.filter((x) => !x.compulsory)) assert.ok(marks.includes(p.desc), `${p.id} 的说明没过 esc`);
	const withCar = insuranceCard(make({ cover: { 'car-comp': cov(0, 30) } }), true, (v) => String(v));
	assert.match(withCar, /CTP/);
	assert.match(withCar, /保障中，到第 \d+ 天/);
});

test('生涯统计和页面：保费按险种记到车 / 住房 / 出行；保险卡在「我 · 资产」里（合并 main 后复核）', () => {
	assert.deepEqual(actionCats({ t: 'insure', id: 'car-comp' }), ['vehicle', 'vehicle']);
	assert.deepEqual(actionCats({ t: 'insure', id: 'car-tpp' }), ['vehicle', 'vehicle']);
	assert.deepEqual(actionCats({ t: 'insure', id: 'contents' }), ['housing', 'housing']);
	assert.deepEqual(actionCats({ t: 'insure', id: 'travel' }), ['transport', 'transport']);
	const r = applyAction(make({ cover: {} }), WA, { t: 'insure', id: 'car-comp' });
	assert.equal(r.state.tally.out.vehicle, comp.premium, '买车险的钱记在「车」');
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	const assets = page.match(/assets: \[([^\]]*)\]/)?.[1] ?? '';
	assert.match(assets, /'ins'/, '「我 · 资产」分页里有保险卡');
	assert.match(page, /ins: insuranceCard\(s, /);
});
