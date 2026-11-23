// 副业与小生意（docs/earth-game/side-business.md）：数据自洽、证照、副业、GST、店铺经营与倒闭、存档清洗、服务端校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, publicState, type GameAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { cleanBiz, emptyBiz } from '../../src/game/core/business-save.ts';
import {
	closeShop, doGig, getLicense, gigsAt, hireStaff, licenseOffers, licenseValid, openCost, openShop, recordBiz, restockShop, settleBiz, settleShopDay, shopActions, shopDailyCost, shopOffersAt, stateOf, tendShop,
} from '../../src/game/core/business.ts';
import { GIGS, GST, LICENSES, SHOP_EVENTS, SHOP_RULES, SHOP_SITES, SHOP_TYPES } from '../../src/game/data/business.ts';
import { areaOf } from '../../src/game/data/areas-base.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import { EarthWorld } from '../../src/game/server/world.ts';
import type { PlayerState, ShopState } from '../../src/game/core/types.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { fortnightOf, visaCapped, workedMinutes } from '../../src/game/core/visa.ts';
import { PROGRAMS, VISA } from '../../src/game/data/education.ts';
import { dayOf } from '../../src/game/core/time.ts';

const R = WORLD;
const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const full = { hunger: 95, energy: 95, hygiene: 95, fun: 95, social: 95 };
const make = (over: Partial<PlayerState> = {}, seed = 7): PlayerState => {
	const c = createCharacter({ id: 'biz-player', name: '店', avatar: '🧑', origin: 'student', region: 'wa', spawn: 'perth', seed });
	// 合并税务后：办 ABN 要先有税号（TFN），测试角色默认已经有
	return { ...c, tax: { ...c.tax, tfn: 0 }, needs: { ...full },
	cash: 50_000,
	...over,
	};
};
const withLic = (s: PlayerState, ids: string[], day = 0): PlayerState => ({ ...s, biz: { ...s.biz, lic: { ...s.biz.lic, ...Object.fromEntries(ids.map((i) => [i, day])) } } });
const shopOf = (s: PlayerState): ShopState => s.biz.shop!;

// ---------- 数据 ----------
test('副业数据：id 唯一；证照依赖、副业要的证照、开店要的食品登记都能在两个州找到', () => {
	for (const list of [LICENSES, GIGS, SHOP_TYPES, SHOP_SITES, SHOP_EVENTS]) assert.equal(new Set(list.map((x) => x.id)).size, list.length);
	const lic = new Set(LICENSES.map((l) => l.id));
	for (const l of LICENSES) {
		for (const n of l.needs ?? []) assert.ok(lic.has(n), `${l.id} 依赖 ${n}`);
		assert.ok(l.fee >= 0 && l.minutes > 0 && l.days >= 0, l.id);
	}
	for (const g of GIGS) {
		for (const id of g.licenses ?? []) for (const st of ['wa', 'sa']) assert.ok(lic.has(id) || lic.has(`${id}-${st}`), `${g.id} 要的 ${id} 在 ${st} 能办`);
		assert.ok(g.minutes > 0 && g.base > 0 && g.cost >= 0 && (g.loss ?? 0) < 1, g.id);
		assert.ok(R.locations.some((l) => g.where.kinds?.includes(l.kind) || g.where.tags?.some((t) => l.tags.includes(t))), `${g.id} 有地方做`);
	}
	for (const st of ['wa', 'sa']) assert.ok(lic.has(`food-${st}`), `food-${st}`);
	for (const t of SHOP_TYPES) assert.ok(t.price > t.unitCost && t.unitCost > 0 && t.customers > 0 && t.perHand > 0 && t.maxStock > 0 && t.fitout > 0, t.id);
	assert.ok(SHOP_EVENTS.every((e) => e.weight > 0));
});

test('选址：每个街区挂在一个真实存在的游戏地点下，州和地点所在区域一致；两个州都有', () => {
	for (const s of SHOP_SITES) {
		assert.ok(R.locations.some((l) => l.id === s.loc), `${s.id} 的地点 ${s.loc} 存在`);
		assert.equal(areaOf(s.loc)?.id, s.state, s.id);
		assert.equal(stateOf(s.loc), s.state);
		assert.ok(s.rent > 0 && s.traffic > 0, s.id);
	}
	assert.ok(SHOP_SITES.some((s) => s.state === 'wa') && SHOP_SITES.some((s) => s.state === 'sa'));
});

// ---------- 动作协议 ----------
test('parseAction：biz 动作只认合法形状', () => {
	assert.deepEqual(parseAction({ t: 'biz', op: 'gig', id: 'tutor' }), { t: 'biz', op: 'gig', id: 'tutor' });
	assert.deepEqual(parseAction({ t: 'biz', op: 'license', id: 'abn', extra: 1 }), { t: 'biz', op: 'license', id: 'abn' });
	assert.deepEqual(parseAction({ t: 'biz', op: 'open', shop: 'milk-tea', site: 'northbridge' }), { t: 'biz', op: 'open', shop: 'milk-tea', site: 'northbridge' });
	assert.deepEqual(parseAction({ t: 'biz', op: 'restock', qty: 100 }), { t: 'biz', op: 'restock', qty: 100 });
	for (const op of ['hire', 'fire', 'tend', 'close']) assert.deepEqual(parseAction({ t: 'biz', op }), { t: 'biz', op });
	for (const bad of [
		{ t: 'biz' }, { t: 'biz', op: 'gig' }, { t: 'biz', op: 'gig', id: 'A B' }, { t: 'biz', op: 'gig', id: 5 },
		{ t: 'biz', op: 'open', shop: 'milk-tea' }, { t: 'biz', op: 'open', site: 'northbridge' },
		{ t: 'biz', op: 'restock', qty: 0 }, { t: 'biz', op: 'restock', qty: 1001 }, { t: 'biz', op: 'restock', qty: 1.5 }, { t: 'biz', op: 'restock', qty: '10' }, { t: 'biz', op: 'restock', qty: NaN },
		{ t: 'biz', op: 'steal' }, { t: 'biz', op: '__proto__' }, { t: 'biz', op: 'license', id: '__proto__x'.repeat(5) },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
});

// ---------- 证照 ----------
test('证照：ABN 免费；商号要先有 ABN；办证收费、花时间、不改入参；钱不够不让办', () => {
	const s = make({ clock: at(10) });
	const frozen = structuredClone(s);
	assert.match(licenseOffers(s).find((o) => o.lic.id === 'bizname')!.blocked!, /ABN/);
	const r = getLicense(s, R, 'abn');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, frozen, '不改入参');
	assert.equal(r.state.cash, s.cash, 'ABN 不收费');
	assert.ok(licenseValid(r.state, 'abn'));
	assert.ok(r.state.clock > s.clock);
	const b = getLicense(r.state, R, 'bizname');
	assert.ok(b.ok, b.msg);
	assert.equal(b.state.cash, r.state.cash - 47);
	assert.equal(getLicense(b.state, R, 'bizname').ok, false, '有效期内不能重复办');
	const poor = getLicense({ ...make({ clock: at(10), cash: 50 }) }, R, 'wwc-sa');
	assert.equal(poor.ok, false);
	assert.equal(getLicense(s, R, 'no-such').ok, false);
});

test('证照有效期：商号一个游戏年后过期，可以续办；ABN 不过期', () => {
	const s = withLic(make({ clock: at(10, 200) }), ['abn', 'bizname'], 50);
	assert.ok(licenseValid(s, 'abn'));
	assert.equal(licenseValid(s, 'bizname'), false, '第 50 天办的商号第 200 天已过期（有效 112 天）');
	assert.ok(licenseValid(s, 'bizname', 161) && !licenseValid(s, 'bizname', 162));
	assert.ok(getLicense(s, R, 'bizname').ok, '过期可以续办');
});

// ---------- 副业 ----------
test('家教要所在州的 WWC：西澳的卡在阿德莱德不管用', () => {
	const perth = make({ clock: at(16) });
	assert.match(gigsAt(perth, R).find((g) => g.gig.id === 'tutor')!.blocked!, /西澳 WWC/);
	const wa = withLic(perth, ['wwc-wa']);
	assert.equal(gigsAt(wa, R).find((g) => g.gig.id === 'tutor')!.blocked, undefined);
	const adl = { ...wa, loc: 'adelaide' };
	assert.match(gigsAt(adl, R).find((g) => g.gig.id === 'tutor')!.blocked!, /南澳 WWC/);
	const r = doGig(wa, R, 'tutor');
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.cash > wa.cash);
	assert.equal(doGig(r.state, R, 'tutor').ok, false, '每天一次');
	assert.equal(r.state.biz.book.gross, r.state.cash - wa.cash, '营业额记进账本');
});

test('市集摆摊只在周末、有市集的地方；先付摊位费', () => {
	const sat = make({ loc: 'fremantle', clock: at(9, 5) });
	const mon = { ...sat, clock: at(9, 7) };
	assert.equal(gigsAt(make({ clock: at(9, 5) }), R).some((g) => g.gig.id === 'stall'), false, '珀斯没有市集标签');
	assert.match(gigsAt(mon, R).find((g) => g.gig.id === 'stall')!.blocked!, /周末/);
	const r = doGig(sat, R, 'stall');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.biz.gigs.stall, 5);
	const poor = { ...sat, cash: 10 };
	assert.match(gigsAt(poor, R).find((g) => g.gig.id === 'stall')!.blocked!, /垫/);
});

test('送外卖要 ABN；没车收入打折；摄影要作品集', () => {
	const s = make({ clock: at(12) });
	assert.match(gigsAt(s, R).find((g) => g.gig.id === 'delivery')!.blocked!, /ABN/);
	const ok = withLic(s, ['abn']);
	const car = gigsAt(ok, R).find((g) => g.gig.id === 'delivery')!;
	const walk = gigsAt({ ...ok, vehicle: 'none' }, R).find((g) => g.gig.id === 'delivery')!;
	assert.equal(car.blocked, undefined);
	assert.ok(walk.range[1] < car.range[1]);
	assert.match(gigsAt(ok, R).find((g) => g.gig.id === 'photo')!.blocked!, /作品集/);
	assert.equal(gigsAt({ ...ok, photoQuest: 3 }, R).find((g) => g.gig.id === 'photo')!.blocked, undefined);
});

test('代购：先垫货款；同一种子结果相同；有一定几率货出意外收不回', () => {
	const base = make({ clock: at(10) });
	const a = doGig(base, R, 'daigou');
	const b = doGig(base, R, 'daigou');
	assert.deepEqual(a.state, b.state, '确定性');
	let lost = 0;
	let won = 0;
	for (let seed = 1; seed <= 300; seed++) {
		const s = make({ clock: at(10) }, seed);
		const r = doGig(s, R, 'daigou');
		assert.ok(r.ok, r.msg);
		if (r.state.biz.book.gross === 0) lost++;
		else won++;
	}
	assert.ok(lost > 0 && lost < 60, `货出意外 ${lost}/300`);
	assert.ok(won > 200);
});

test('副业途中晕倒：成本照付，收入拿不到，不记账', () => {
	const s = withLic(make({ clock: at(16), health: 1, needs: { ...full, hunger: 0 } }), ['wwc-wa']);
	const r = doGig(s, R, 'tutor');
	assert.ok(r.collapsed);
	assert.equal(r.state.biz.book.gross, 0);
});

// ---------- GST ----------
test('GST：营业额跨过门槛自动登记，之后按毛利 1/11 交；新的一年账本清零', () => {
	const s = make({ clock: at(16) });
	s.biz.book = { y: 1, gross: GST.threshold - 50, net: 0 };
	const msg = recordBiz(s, 0, 100, 100);
	assert.match(msg, /GST/);
	assert.ok(s.biz.gst && licenseValid(s, 'abn'));
	const t = withLic(s, ['wwc-wa']);
	const r = doGig(t, R, 'tutor');
	const gross = r.state.biz.book.gross - t.biz.book.gross;
	assert.equal(r.state.cash - t.cash, gross - Math.round(gross / 11));
	const y2 = structuredClone(r.state);
	recordBiz(y2, 112, 10, 10);
	assert.deepEqual(y2.biz.book, { y: 2, gross: 10, net: 10 });
	assert.ok(y2.biz.gst, '登记过就一直是登记状态');
});

// ---------- 店铺 ----------
const shopReady = (over: Partial<PlayerState> = {}, seed = 7) => withLic(make({ clock: at(10), ...over }, seed), ['abn', 'bizname', 'food-wa', 'food-sa']);

test('开店：要人在街区所在地点、证照齐、钱够；扣装修和押金；每人一家', () => {
	const s = shopReady();
	const offers = shopOffersAt(s);
	assert.ok(offers.length >= SHOP_TYPES.length * 4, '珀斯有 4 个街区');
	assert.equal(shopOffersAt({ ...s, loc: 'kalgoorlie' }).length, 0);
	assert.match(shopOffersAt(withLic(make({ clock: at(10) }), ['abn', 'bizname'])).find((o) => o.type.id === 'milk-tea')!.blocked!, /食品/);
	assert.equal(shopOffersAt(withLic(make({ clock: at(10) }), ['abn', 'bizname'])).find((o) => o.type.id === 'phone-repair')!.blocked, undefined, '手机维修不要食品登记');
	assert.match(shopOffersAt({ ...s, cash: 100 })[0].blocked!, /需要/);
	const frozen = structuredClone(s);
	const r = openShop(s, R, 'milk-tea', 'northbridge');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, frozen);
	const site = SHOP_SITES.find((x) => x.id === 'northbridge')!;
	const type = SHOP_TYPES.find((x) => x.id === 'milk-tea')!;
	assert.equal(r.state.cash, s.cash - openCost(type, site));
	assert.equal(shopOf(r.state).bond, site.rent * SHOP_RULES.bondWeeks);
	assert.equal(r.state.respect, s.respect + SHOP_RULES.openRespect);
	assert.equal(openShop(r.state, R, 'grocery', 'cannington').ok, false, '每人一家');
	assert.equal(openShop(s, R, 'milk-tea', 'jetty-road').ok, false, '不在格莱内尔格');
});

test('没人看店的日子不开门：房租照交、口碑下降、不消耗库存', () => {
	const r = openShop(shopReady(), R, 'milk-tea', 'northbridge');
	const s = restockShop(r.state, R, 200).state;
	const before = structuredClone(s);
	const day = settleShopDay(s, shopOf(s).last + 1);
	assert.equal(day.open, false);
	assert.equal(day.sold, 0);
	assert.equal(shopOf(s).stock, 200);
	if (!day.event) {
		assert.equal(s.cash, before.cash - shopDailyCost(shopOf(before)).total);
		assert.equal(shopOf(s).rep, before.biz.shop!.rep - 1);
	}
	for (const a of ['hire', 'fire'] as const) assert.equal(hireStaff(make(), R, a).ok, false, '没有店不能雇人');
	assert.equal(restockShop(make(), R, 10).ok, false);
	assert.equal(tendShop(make(), R).ok, false);
});

test('雇人开门：按客流卖货，扣工资养老金工伤保险，账记进 hist；断货口碑下降', () => {
	let s = openShop(shopReady(), R, 'milk-tea', 'northbridge').state;
	s = hireStaff(s, R, 'hire').state;
	assert.equal(shopOf(s).staff, 1);
	const cost = shopDailyCost(shopOf(s));
	assert.equal(cost.wages, SHOP_RULES.staffWage);
	assert.equal(cost.superPay, Math.round(SHOP_RULES.staffWage * SHOP_RULES.superRate));
	// 没货：来客全断货，口碑 −2（挑一个当天没有经营事件的种子）
	let checked = 0;
	for (let seed = 1; seed < 50 && checked < 3; seed++) {
		const empty = structuredClone(s);
		empty.seed = seed;
		const d0 = settleShopDay(empty, shopOf(empty).last + 1);
		if (d0.event) continue;
		checked++;
		assert.equal(d0.sold, 0);
		assert.ok(d0.customers > 0);
		assert.equal(shopOf(empty).rep, shopOf(s).rep + SHOP_RULES.repStockout);
	}
	assert.equal(checked, 3);
	s = restockShop(s, R, 300).state;
	const d1 = settleShopDay(s, shopOf(s).last + 1);
	assert.ok(d1.sold > 0 && d1.sold <= 60 * shopOf(s).staff, `一个店员一天最多接待 60 单，卖了 ${d1.sold}`);
	assert.ok(d1.customers > d1.sold || !!d1.event, '北桥奶茶店客流超过一个人手');
	assert.equal(d1.revenue, d1.sold * 7);
	assert.equal(shopOf(s).hist.at(-1)!.sold, d1.sold);
	assert.equal(hireStaff(hireStaff(s, R, 'hire').state, R, 'hire').ok, false, `最多 ${SHOP_RULES.maxStaff} 人`);
});

test('applyAction 之后自动结算到昨天；没有店时不消耗随机数', () => {
	const plain = make({ clock: at(10) });
	const p2 = structuredClone(plain);
	assert.equal(settleBiz(p2, R), '');
	assert.deepEqual(p2, plain);
	let s = openShop(shopReady(), R, 'milk-tea', 'northbridge').state;
	s = hireStaff(s, R, 'hire').state;
	s = restockShop(s, R, 500).state;
	const opened = shopOf(s).day;
	// 睡到第二天以后
	let r = applyAction(s, R, { t: 'activity', id: 'rest' });
	for (let i = 0; i < 40 && Math.floor(r.state.clock / 1440) < opened + 3; i++) r = applyAction(r.state, R, { t: 'activity', id: 'rest' });
	assert.equal(shopOf(r.state).last, Math.floor(r.state.clock / 1440) - 1);
	assert.ok(shopOf(r.state).hist.length >= 2);
	assert.ok(shopOf(r.state).stock < 500);
});

test('周末客流更多：同一种子，周六比周二多', () => {
	let s = openShop(shopReady(), R, 'milk-tea', 'northbridge').state;
	s = hireStaff(hireStaff(s, R, 'hire').state, R, 'hire').state;
	const tue = settleShopDay(structuredClone(s), 1);
	const sat = settleShopDay(structuredClone(s), 5);
	assert.ok(sat.customers > tue.customers * 1.2, `${sat.customers} vs ${tue.customers}`);
});

test('自己看店：每天一次，在营业时间，当天多一份人手', () => {
	let s = openShop(shopReady(), R, 'milk-tea', 'northbridge').state;
	s = restockShop(s, R, 300).state;
	const t = tendShop(s, R);
	assert.ok(t.ok, t.msg);
	assert.equal(shopOf(t.state).tend, Math.floor(s.clock / 1440));
	assert.match(shopActions({ ...t.state, clock: at(9) }).tend!, /已经看过/, '同一天营业时间内也不能再看');
	assert.match(tendShop({ ...s, clock: at(18) }, R).msg, /开门/);
	const d = settleShopDay(t.state, Math.floor(s.clock / 1440));
	assert.ok(d.open && d.sold > 0);
	assert.equal(tendShop({ ...s, loc: 'fremantle' }, R).ok, false, '要在店里');
});

test('倒闭：欠款到 3 周租金时关门，押金抵债、声望下降；之后能再开', () => {
	let s = openShop(shopReady({ cash: 13_000 }), R, 'phone-repair', 'northbridge').state;
	s = hireStaff(hireStaff(s, R, 'hire').state, R, 'hire').state;
	s.cash = 0;
	s.respect = 20;
	let msg = '';
	for (let d = 1; d < 80 && s.biz.shop; d++) {
		s.clock = at(10, shopOf(s).day + d);
		msg = settleBiz(s, R);
	}
	assert.equal(s.biz.shop, null);
	assert.match(msg, /倒闭/);
	assert.equal(s.respect, 20 + SHOP_RULES.closeRespect);
	assert.equal(s.cash, 0);
	assert.ok(shopOffersAt(withLic({ ...s, cash: 50_000 }, ['abn', 'bizname'])).some((o) => !o.blocked));
});

test('关店：先结算，押金扣欠款后退回，库存半价清货', () => {
	let s = openShop(shopReady(), R, 'grocery', 'cannington').state;
	s = restockShop(s, R, 100).state;
	const shop = shopOf(s);
	const r = closeShop(s, R);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.biz.shop, null);
	assert.equal(r.state.cash, s.cash + shop.bond + Math.round(100 * 17 * 0.5));
	assert.equal(closeShop(r.state, R).ok, false);
});

test('食品检查：登记过期时罚款', () => {
	let s = openShop(shopReady(), R, 'milk-tea', 'northbridge').state;
	s = hireStaff(s, R, 'hire').state;
	delete s.biz.lic['food-wa']; // 没有有效的食品登记
	let fined = false;
	for (let seed = 1; seed < 4000 && !fined; seed++) {
		const t = structuredClone(s);
		t.seed = seed;
		const d = settleShopDay(t, shopOf(t).last + 1);
		if (d.event?.includes('罚款')) fined = true;
	}
	assert.ok(fined, '登记过期时检查会罚款');
});

// ---------- 存档 ----------
test('存档：新角色有空 biz；旧存档缺字段补默认；坏值清掉；幂等', () => {
	const s = make();
	assert.deepEqual(s.biz, emptyBiz());
	const old = structuredClone(s) as unknown as Record<string, unknown>;
	delete old.biz;
	assert.deepEqual(sanitizeState(old)!.biz, emptyBiz());
	for (const bad of [null, 1, 'x', [], { lic: [], gigs: 'x', gst: 'yes', book: null, shop: [] }, { lic: { abn: NaN, __proto__: 1, zzz: 3 }, shop: { type: 'milk-tea' } }])
		assert.deepEqual(cleanBiz(bad, at(10, 5)), { ...emptyBiz(), lic: {} }, JSON.stringify(bad));
	const day = 30;
	const messy = {
		lic: { abn: 3, 'wwc-wa': day + 5, bizname: -1, fake: 2 },
		gigs: { tutor: 29.7, stall: 1e12, nope: 1 },
		gst: true,
		book: { y: 1, gross: -5, net: 1e15 },
		shop: { type: 'milk-tea', site: 'northbridge', day: 10, last: 99, stock: 1e9, staff: 9, tend: 5, rep: 300, debt: -10, bond: 3600, hist: [{ d: 12, sold: 3, net: 10 }, { d: 50, sold: 1, net: 1 }, 'x'] },
	};
	const c = cleanBiz(messy, at(10, day));
	assert.deepEqual(c.lic, { abn: 3 });
	assert.deepEqual(c.gigs, { tutor: 29 });
	assert.deepEqual(c.book, { y: 1, gross: 0, net: 1e9 });
	assert.equal(c.shop!.last, day - 1);
	assert.equal(c.shop!.stock, SHOP_TYPES[0].maxStock);
	assert.equal(c.shop!.staff, SHOP_RULES.maxStaff);
	assert.equal(c.shop!.tend, -1);
	assert.equal(c.shop!.rep, 100);
	assert.equal(c.shop!.debt, 0);
	assert.equal(c.shop!.hist.length, 1);
	assert.deepEqual(cleanBiz(c, at(10, day)), c, '幂等');
	assert.deepEqual(cleanBiz({ shop: { type: 'nope', site: 'northbridge' } }, 0).shop, null);
	assert.deepEqual(cleanBiz({ shop: { type: 'milk-tea', site: 'mars' } }, 0).shop, null);
	const full2 = sanitizeState({ ...s, clock: at(10, day), biz: messy })!;
	assert.deepEqual(sanitizeState(full2), full2, 'sanitizeState 幂等');
	assert.deepEqual(publicState(full2).biz, full2.biz);
});

// ---------- 随机序列 ----------
test('随机动作序列：现金、库存、店员、欠款始终合法，不改入参，存档清洗后不变', () => {
	const ops: GameAction[] = [
		{ t: 'biz', op: 'license', id: 'abn' }, { t: 'biz', op: 'license', id: 'bizname' }, { t: 'biz', op: 'license', id: 'food-wa' }, { t: 'biz', op: 'license', id: 'wwc-wa' },
		{ t: 'biz', op: 'gig', id: 'tutor' }, { t: 'biz', op: 'gig', id: 'delivery' }, { t: 'biz', op: 'gig', id: 'daigou' },
		{ t: 'biz', op: 'open', shop: 'milk-tea', site: 'northbridge' }, { t: 'biz', op: 'open', shop: 'phone-repair', site: 'subiaco' },
		{ t: 'biz', op: 'restock', qty: 120 }, { t: 'biz', op: 'restock', qty: 1000 }, { t: 'biz', op: 'hire' }, { t: 'biz', op: 'fire' }, { t: 'biz', op: 'tend' }, { t: 'biz', op: 'close' },
		{ t: 'activity', id: 'rest' }, { t: 'activity', id: 'eat' }, { t: 'activity', id: 'sleep-motel' },
	];
	for (let seed = 1; seed <= 12; seed++) {
		let s = make({ cash: 15_000 }, seed);
		let x = seed * 2654435761 >>> 0;
		for (let i = 0; i < 250; i++) {
			x = (x * 1103515245 + 12345) >>> 0;
			const a = ops[x % ops.length];
			const frozen = structuredClone(s);
			const r = applyAction(s, R, a);
			assert.deepEqual(s, frozen, '不改入参');
			s = r.state;
			if (s.pending) s = applyAction(s, R, { t: 'event', choice: 0 }).state;
			assert.ok(Number.isInteger(s.cash) && s.cash >= 0, `现金 ${s.cash}`);
			const sh = s.biz.shop;
			if (sh) {
				const t = SHOP_TYPES.find((y) => y.id === sh.type)!;
				assert.ok(sh.stock >= 0 && sh.stock <= t.maxStock && sh.staff >= 0 && sh.staff <= SHOP_RULES.maxStaff && sh.debt >= 0 && sh.rep >= 0 && sh.rep <= 100);
				assert.ok(sh.last < Math.floor(s.clock / 1440));
			}
			const clean = sanitizeState(s)!;
			assert.deepEqual(clean.biz, s.biz, `第 ${i} 步存档清洗后不变`);
		}
	}
});

// ---------- 服务端 ----------
test('服务端：biz 动作走 parseAction + 引擎结算，格式不对返回 400，结果落盘', async () => {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async () => new Map(),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	const cred = { id: 'biz-server-player', key: 'k'.repeat(24) };
	const created = await call({ action: 'create', ...cred, profile: { name: '店', avatar: '🧑', origin: 'student', traits: [] } });
	const bad = await call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'biz', op: 'restock', qty: -5 } });
	assert.equal(bad.status, 400);
	const forged = await call({ action: 'act', ...cred, rev: created.data.state.rev, act: { t: 'biz', op: 'open', shop: 'milk-tea', site: 'northbridge' } });
	assert.equal(forged.data.ok, false, '没证照、没钱开不了店');
	// 合并税务后：新角色还没有税号，办 ABN 被拦；不需要 TFN 的证照（西澳 WWC）照常能办、落盘
	const noTfn = await call({ action: 'act', ...cred, rev: forged.data.state.rev, act: { t: 'biz', op: 'license', id: 'abn' } });
	assert.equal(noTfn.data.ok, false);
	assert.match(noTfn.data.msg, /TFN/);
	const wwc = await call({ action: 'act', ...cred, rev: noTfn.data.state.rev, act: { t: 'biz', op: 'license', id: 'wwc-wa' } });
	assert.ok(wwc.data.ok, wwc.data.msg);
	assert.equal(typeof wwc.data.state.biz.lic['wwc-wa'], 'number');
	assert.equal(data.get('save:' + cred.id).state.biz.lic['wwc-wa'], wwc.data.state.biz.lic['wwc-wa'], '落盘');
});

// ---------- 合并 main 后：副业和看店是工作（签证、生病、灾害、记账） ----------
test('副业是工作：签证过期不能做；生病不能做；做了算进签证工时；钱记「工作与零工」（合并 main 后）', () => {
	const base = withLic(make({ clock: at(12, 1) }), ['abn']);
	const ok = gigsAt(base, R).find((o) => o.gig.id === 'delivery')!;
	assert.ok(ok && !ok.blocked, ok?.blocked);
	// 签证过期
	const expired = { ...base, visa: { ...base.visa, kind: 'expired' as const } } as PlayerState;
	assert.match(gigsAt(expired, R).find((o) => o.gig.id === 'delivery')!.blocked!, /签证/);
	// 生病（不能上班的病）
	const sick = { ...base, illness: { id: 'flu', since: base.clock, until: base.clock + 3 * 1440, care: [], rx: false } } as PlayerState;
	assert.match(gigsAt(sick, R).find((o) => o.gig.id === 'delivery')!.blocked!, /流感/);
	// 做完记签证工时
	const r = applyAction(base, R, { t: 'biz', op: 'gig', id: 'delivery' });
	assert.ok(r.ok, r.msg);
	assert.equal(workedMinutes(r.state) - workedMinutes(base), GIGS.find((g) => g.id === 'delivery')!.minutes);
	assert.deepEqual(actionCats({ t: 'biz', op: 'gig', id: 'delivery' }), ['work', 'work']);
	// 工时用完：学期中的学生签证每两周 48 小时
	const prog = PROGRAMS.find((p) => p.sessions > 1)!;
	const capped = { ...base, study: { ...base.study, [prog.id]: { n: 1, day: dayOf(base.clock) } }, workLog: { f: fortnightOf(base.clock), min: VISA.capHours * 60 } } as PlayerState;
	assert.ok(visaCapped(capped), '前提：学期中的学生签证');
	assert.match(gigsAt(capped, R).find((o) => o.gig.id === 'delivery')!.blocked!, /48 小时/);
});

test('店铺每天结算的钱记「工作与零工」，不算到触发结算的动作头上（合并 main 后）', () => {
	const site = SHOP_SITES.find((x) => x.loc === 'perth')!;
	const type = SHOP_TYPES.find((t) => !t.food)!;
	let s = withLic(make({ clock: at(10, 1) }), ['abn', 'bizname']);
	s = applyAction(s, R, { t: 'biz', op: 'open', shop: type.id, site: site.id }).state;
	assert.ok(s.biz.shop, '开了店');
	s = applyAction(s, R, { t: 'biz', op: 'restock', qty: 20 }).state;
	s = applyAction(s, R, { t: 'biz', op: 'tend' }).state;
	const before = s;
	// 第二天随便做点别的（出行），店的账结算到昨天
	const next = { ...s, clock: at(9, dayOf(s.clock) + 1) };
	const r = applyAction(next, R, { t: 'mind', op: 'call' });
	assert.ok(r.ok, r.msg);
	const workIn = (r.state.tally.in.work ?? 0) - (before.tally.in.work ?? 0);
	const workOut = (r.state.tally.out.work ?? 0) - (before.tally.out.work ?? 0);
	assert.equal(workIn - workOut, r.state.cash - next.cash, '这一步现金的变化全是店的账，记在「工作与零工」');
});

test('店里操作先结算时，结算的钱单独记「工作与零工」，和进货的钱分开（合并 main 后复核）', () => {
	const site = SHOP_SITES.find((x) => x.loc === 'perth')!;
	const type = SHOP_TYPES.find((t) => !t.food)!;
	let s = withLic(make({ clock: at(10, 1) }), ['abn', 'bizname']);
	s = applyAction(s, R, { t: 'biz', op: 'open', shop: type.id, site: site.id }).state;
	s = applyAction(s, R, { t: 'biz', op: 'restock', qty: 30 }).state;
	s = applyAction(s, R, { t: 'biz', op: 'tend' }).state;
	const next = { ...s, clock: at(10, dayOf(s.clock) + 3) };
	// 同一段结算，分别由进货和一个无关动作触发：「工作与零工」的收入一样
	const viaRestock = applyAction(next, R, { t: 'biz', op: 'restock', qty: 5 });
	const viaOther = applyAction(next, R, { t: 'mind', op: 'call' });
	assert.ok(viaRestock.ok && viaOther.ok);
	const inOf = (x: PlayerState) => (x.tally.in.work ?? 0) - (next.tally.in.work ?? 0);
	assert.equal(inOf(viaRestock.state), inOf(viaOther.state), '结算收入不被进货的花费抵掉');
});

test('页面：生意卡在「工作」抽屉里，摘要算上副业和自己的店（合并 main 后）', async () => {
	const { readFileSync } = await import('node:fs');
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(page, /'工作', workHtml \+ bizCard\(s, region, esc\),/);
	assert.match(page, /gigsAt\(s, region\)\.length \? `\$\{gigsAt\(s, region\)\.length\} 份副业`/);
});
