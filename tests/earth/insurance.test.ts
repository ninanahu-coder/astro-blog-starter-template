// 保险（第一版）：保单生效期、保费加价、理赔核算、出险事件、买保险动作、开局 OSHC、存档清洗。设计见 docs/earth-game/insurance.md
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyEffect, exposedTo, getLocation, getPendingEvent, resaleValue, travelOptions } from '../../src/game/core/engine.ts';
import { assessClaim, cleanCover, coverActive, extendCover, insureBlocked, premiumFor, recentClaims, settleLoss, startCover } from '../../src/game/core/insurance.ts';
import { CLAIM_LOADING, CLAIM_WINDOW, CLAIMS_MAX, COVER_AHEAD_MAX, getPolicy, LOSS_LABEL, POLICIES, START_COVER } from '../../src/game/data/insurance.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { WA } from '../../src/game/data/wa.ts';
import { insuranceCard } from '../../src/game/ui/insurance.ts';
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
	for (const [origin, list] of Object.entries(START_COVER)) for (const s of list) assert.ok(getPolicy(s.id) && !getPolicy(s.id)!.compulsory && s.days > 0, `${origin} ${s.id}`);
});

test('出险事件：每种损失都有保单能赔，也都有事件会触发；金额为正；exposure 的事件不进抛锚池', () => {
	const kinds = Object.keys(LOSS_LABEL) as LossKind[];
	for (const k of kinds) assert.ok(POLICIES.some((p) => p.covers.includes(k)), `${k} 没有保单赔`);
	const used = new Set<LossKind>();
	for (const e of EVENTS) for (const c of e.choices) for (const o of [c.ok, c.fail]) for (const l of o?.fx.loss ?? []) {
		assert.ok(l.amount > 0, `${e.id} 损失金额要为正`);
		used.add(l.kind);
	}
	for (const k of kinds) if (k !== 'medical') assert.ok(used.has(k), `没有事件会造成 ${k}`);
	for (const e of EVENTS.filter((x) => x.exposure)) assert.ok(e.weight > 0 && !e.breakdown && !e.venueTypes, e.id);
});

test('生效期：from 当天起生效（含），until 当天起失效（不含）；没有保单不生效', () => {
	const c = { health: cov(5, 8) };
	assert.equal(coverActive(c, 'health', 4), false);
	assert.equal(coverActive(c, 'health', 5), true);
	assert.equal(coverActive(c, 'health', 7), true);
	assert.equal(coverActive(c, 'health', 8), false);
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
	assert.equal(assessClaim(c, D, loss('medical', 300), 4000).policy, null, '全险不管看病');
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

test('事件里的损失走保险：applyEffect 的 fx.loss 有全险只扣免赔额，没保险全额；看病的损失走健康险', () => {
	const fx = { loss: [{ kind: 'collision' as const, amount: 1800 }, { kind: 'tpp' as const, amount: 2500 }] };
	const bare = make({ cover: {} });
	applyEffect(bare, fx, WA);
	assert.equal(bare.cash, 5000 - 4300);
	const insured = make({ cover: { 'car-comp': cov(0, 30) } });
	assert.ok(resaleValue(insured.vehicle) >= 1800 - comp.excess, '留学生的车值够赔这次车损');
	applyEffect(insured, fx, WA);
	assert.equal(insured.cash, 5000 - comp.excess * 2);
	assert.equal(insured.journal.filter((j) => j.text.includes('理赔')).length, 2);
	const sick = make();
	applyEffect(sick, { loss: [{ kind: 'medical', amount: 450 }] }, WA);
	assert.equal(sick.cash, 5000, '留学生开局有 OSHC，急诊不花钱');
});

test('晕倒住院：有健康险医药费由保险付，没有照旧自付', () => {
	// 结算日放远：住院 12 小时不碰上周结算
	const sick = make({ health: 1, nextWeek: 999 });
	assert.ok(applyEffect(sick, { health: -50 }, WA));
	assert.equal(sick.cash, 5000);
	assert.ok(sick.journal.some((j) => /医药费 \$\d+，健康险.*付了/.test(j.text)));
	const bare = make({ health: 1, cover: {}, nextWeek: 999 });
	assert.ok(applyEffect(bare, { health: -50 }, WA));
	assert.equal(bare.cash, 5000 - 500, '$100 + 现金 10%，最多 $500');
});

test('出险事件的范围：car 只在有车自驾时出现，home 只在回到自己住处时出现', () => {
	const carEv = EVENTS.find((e) => e.exposure === 'car')!;
	const homeEv = EVENTS.find((e) => e.exposure === 'home')!;
	const loc = getLocation(WA, WA.spawn)!;
	const s = make();
	assert.equal(exposedTo(carEv, s, loc, 'road'), true);
	assert.equal(exposedTo(carEv, s, loc, 'track'), true);
	assert.equal(exposedTo(carEv, s, loc, 'air'), false);
	assert.equal(exposedTo(carEv, s, loc, null), false);
	assert.equal(exposedTo(carEv, make({ vehicle: 'none' }), loc, 'road'), false, '坐巴士不算');
	assert.equal(exposedTo(homeEv, s, loc, 'road'), false, '没有住处');
	const home = { type: 'room', loc: loc.id, furniture: {} };
	assert.equal(exposedTo(homeEv, make({ home }), loc, 'road'), true);
	assert.equal(exposedTo(homeEv, make({ home: { ...home, loc: 'somewhere-else' } }), loc, 'road'), false);
	assert.equal(exposedTo(EVENTS.find((e) => !e.exposure)!, make({ vehicle: 'none' }), loc, null), true);
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
		assert.ok(!ev?.exposure, `坐巴士抽到了 ${ev?.id}`);
		const drive = applyAction(make({ seed, nextWeek: 999 }), WA, { t: 'travel', to, mode: 'road' });
		if (getPendingEvent(drive.state)?.exposure === 'car') carHits++;
	}
	assert.ok(carHits > 0, '自己开车 400 趟一次车险事件都没抽到');
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

	assert.equal(applyAction(make({ pending: { eventId: EVENTS[0].id } }), WA, { t: 'insure', id: 'health' }).ok, false);
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

test('开局保单：留学生自带一年 OSHC，其他出身没有', () => {
	const st = make({}, 'student');
	const day0 = Math.floor(createCharacter({ id: 'x', name: 'x', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 1 }).clock / 1440);
	assert.deepEqual(createCharacter({ id: 'x', name: 'x', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 1 }).cover, { health: cov(day0, day0 + 365) });
	assert.ok(coverActive(st.cover, 'health', D));
	assert.deepEqual(createCharacter({ id: 'x', name: 'x', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 1 }).cover, {});
	assert.deepEqual(startCover('nobody', 0), {});
});

test('存档清洗：旧存档缺字段给 {}；坏值、未知保单、强制险丢掉；日期钳到合法范围；理赔排序截断；幂等', () => {
	const base = make();
	const { cover: _drop, ...old } = base;
	assert.deepEqual(sanitizeState(old)!.cover, {}, '旧存档没有 cover');
	for (const bad of [null, 1, 'x', [], [1, 2], NaN]) assert.deepEqual(cleanCover(bad, D), {});
	const raw = {
		health: { from: 3.7, until: 1e12, claims: [...Array.from({ length: 20 }, () => 4), 9, 'x', 2, -5, 1e9, NaN] },
		travel: { from: 50, until: 20, claims: 'nope' },
		ctp: { from: 0, until: 99, claims: [] },
		'car-comp': { from: 'a', until: 5 },
		bogus: { from: 0, until: 9, claims: [] },
		toString: { from: 0, until: 9, claims: [] },
	};
	const c = cleanCover(raw, D);
	assert.deepEqual(Object.keys(c).sort(), ['health', 'travel']);
	assert.equal(c.health.from, 3);
	assert.equal(c.health.until, D + COVER_AHEAD_MAX);
	assert.equal(c.health.claims.length, CLAIMS_MAX);
	assert.ok(c.health.claims.every((d, i, a) => d >= 0 && d <= D && (i === 0 || a[i - 1] <= d)));
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
	assert.match(html, /data-insure="health"/);
	assert.match(html, /data-insure="car-comp" disabled title="你没有车。"/);
	for (const p of POLICIES.filter((x) => !x.compulsory)) assert.ok(marks.includes(p.desc), `${p.id} 的说明没过 esc`);
	const withCar = insuranceCard(make(), true, (v) => String(v));
	assert.match(withCar, /CTP/);
	assert.match(withCar, /保障中，到第 \d+ 天/);
});
