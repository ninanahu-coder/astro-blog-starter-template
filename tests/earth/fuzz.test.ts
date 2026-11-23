// 随机动作序列的回归测试：多种出身、特质和随机动作（大部分合法，少量故意不合法）连续执行，
// 检查引擎不抛异常、不改入参、数值始终有限且在范围内，服务端的规范化（sanitizeState）对结果是稳定的。
// 随机数用固定种子，失败时能按 seed 复现。
import { ieltsAt, visaOptions } from '../../src/game/core/immigration.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction, type GameAction } from '../../src/game/core/actions.ts';
import { CAPS, createCharacter, ORIGINS, sanitizeState } from '../../src/game/core/character.ts';
import { activitiesAt, careersAt, certsAt, fishingAt, photoQuestNow, coursesAt, garageAt, dealerAt, experiencesAt, furnitureAt, getPendingEvent, homeActionBlocked, homesAt, leaseBlocked, scamHere, npcsAt, propertiesAt, shiftBlocked, shopAt, travelOptions } from '../../src/game/core/engine.ts';
import { NEED_KEYS, SKILL_KEYS, type PlayerState } from '../../src/game/core/types.ts';
import { needsLease, viewedOk } from '../../src/game/core/rental.ts';
import { dayOf } from '../../src/game/core/time.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { COURSES } from '../../src/game/data/courses.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';
import { FURNITURE, FURNITURE_SLOTS } from '../../src/game/data/furniture.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { sellItemBlocked } from '../../src/game/core/shop.ts';
import { getLocation } from '../../src/game/core/engine.ts';
import { NPCS } from '../../src/game/data/npcs.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { TRAITS } from '../../src/game/data/traits.ts';
import { CAR_KM_MAX, DEALER_HOURS, VEHICLES } from '../../src/game/data/vehicles.ts';
import { ANIMALS } from '../../src/game/data/wildlife.ts';
import { FISH } from '../../src/game/data/fish.ts';
import { STORY } from '../../src/game/data/story.ts';
import { NPC_DUOS } from '../../src/game/data/npc-duos.ts';
import { PHOTO_QUESTS } from '../../src/game/data/photo-quests.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { PROGRAMS } from '../../src/game/data/education.ts';
import { isOpen } from '../../src/game/core/time.ts';
import { VENUE_OPS, VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import { bankCapacity, homeLoanOffer } from '../../src/game/core/bank.ts';
import { bnplBlocked, cardOffer, creditScore, personalOffer } from '../../src/game/core/credit.ts';
import { DEBT_KINDS } from '../../src/game/data/credit.ts';
import { buyBlocked, sellOffers, swapBoard, swapOwned } from '../../src/game/core/secondhand.ts';
import { SWAP_GOODS } from '../../src/game/data/secondhand.ts';

const LOCS = new Set(WA.locations.map((l) => l.id));

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomAction(s: PlayerState, r: () => number, now: number): GameAction {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const pending = getPendingEvent(s);
	if (pending && r() < 0.85) return { t: 'event', choice: Math.floor(r() * (pending.choices.length + 1)) };
	const roll = r();
	if (roll < 0.22) {
		const opts = travelOptions(s, WA);
		if (opts.length) { const o = pick(opts); return { t: 'travel', to: o.to, mode: o.mode }; }
	}
	if (roll < 0.45) return { t: 'activity', id: pick(ACTIVITIES).id };
	if (roll < 0.5) {
		const act = pick(['chat', 'help', 'perk', 'gift'] as const);
		// 只有送礼可以带物品（协议如此）；送礼不带物品时自动挑
		return act === 'gift' && r() < 0.6 ? { t: 'npc', npc: pick(NPCS).id, act, item: pick(ITEMS).id } : { t: 'npc', npc: pick(NPCS).id, act };
	}
	if (roll < 0.55) return { t: 'buy', item: pick(ITEMS).id };
	if (roll < 0.58) return r() < 0.7 ? { t: 'use', item: pick(ITEMS).id } : { t: 'sell', item: pick(ITEMS).id };
	if (roll < 0.63) return r() < 0.5 ? { t: 'job', op: 'apply', career: pick(CAREERS).id } : { t: 'job', op: pick(['work', 'work', 'quit'] as const) };
	if (roll < 0.69) {
		const x = r();
		if (x < 0.15) return { t: 'home', op: 'rent', home: pick(HOMES).id, ...(r() < 0.5 ? { term: pick(['fixed', 'periodic'] as const) } : {}) };
		if (x < 0.3) return r() < 0.5 ? { t: 'rental', op: 'inspect', home: pick(HOMES).id } : { t: 'rental', op: pick(['report', 'repair', 'renew', 'accept', 'dispute', 'scam-pay', 'scam-check'] as const) };
		return { t: 'home', op: pick(['sleep', 'sleep', 'cook', 'relax', 'leave'] as const) };
	}
	if (roll < 0.72) return r() < 0.7 ? { t: 'furniture', op: 'buy', id: pick(FURNITURE).id } : { t: 'furniture', op: 'sell', slot: pick(Object.keys(FURNITURE_SLOTS)) };
	if (roll < 0.75) return r() < 0.6 ? { t: 'vehicle', op: 'buy', id: pick(VEHICLES).id } : { t: 'vehicle', op: pick(['sell', 'sleep'] as const) };
	if (roll < 0.8) {
		const id = pick(PROPERTIES).id;
		const op = pick(['buy', 'buy', 'sell', 'movein', 'rentout', 'repay'] as const);
		if (op === 'buy') return { t: 'property', op, id, loan: r() < 0.6 };
		if (op === 'repay') return { t: 'property', op, id, amount: Math.floor(r() * 50000) + 1 };
		return { t: 'property', op, id };
	}
	if (roll < 0.805) {
		// 二手市场：大多是随手编的挂单号（会被拒），偶尔对上真的挂单
		const l = swapBoard(s, WA)?.listings;
		if (l?.length && r() < 0.5) { const x = pick(l); return { t: 'swap', op: 'buy', id: x.id, ref: x.good.ref, how: r() < 0.5 ? 'pickup' : 'prepay', haggle: r() < 0.5 }; }
		const g = pick(SWAP_GOODS);
		return r() < 0.5 ? { t: 'swap', op: 'buy', id: `${s.loc}-${Math.floor(r() * 9)}`, ref: g.ref, how: 'pickup', haggle: false } : { t: 'swap', op: 'sell', kind: g.kind, ref: g.ref, buyer: Math.floor(r() * 4), verify: r() < 0.5 };
	}
	if (roll < 0.81) {
		// 银行：大部分合法格式，金额随机（含超过额度的）
		const op = pick(['open', 'card', 'draw', 'loan', 'carloan', 'bnpl', 'repay'] as const);
		if (op === 'open' || op === 'card') return { t: 'bank', op };
		if (op === 'draw' || op === 'loan') return { t: 'bank', op, amount: Math.floor(r() * 8000) + 1 };
		if (op === 'carloan') return { t: 'bank', op, id: pick(VEHICLES).id };
		if (op === 'bnpl') return { t: 'bank', op, id: pick(FURNITURE).id, ack: true };
		return { t: 'bank', op, kind: pick(DEBT_KINDS), amount: Math.floor(r() * 8000) + 1 };
	}
	if (roll < 0.815) return { t: 'course', id: pick(COURSES).id };
	if (roll < 0.83) return r() < 0.5 ? { t: 'cert', id: pick(CERTS).id } : { t: 'vehicle', op: 'service' };
	if (roll < 0.86) return r() < 0.7 ? { t: 'experience', id: pick(EXPERIENCES).id } : r() < 0.5 ? { t: 'fish' } : { t: 'photo' };
	if (roll < 0.95 && WA.venues.length) {
		// 真实地点：大多站在店门口，偶尔离得很远或精度很差
		const v = pick(WA.venues);
		const far = r() < 0.2;
		return { t: 'venue', venue: v.id, op: pick(VENUE_OPS).id, lat: v.lat + (far ? 0.05 : 0), lon: v.lon, acc: r() < 0.1 ? 500 : 10 };
	}
	if (roll < 0.98) {
		const l = pick(WA.locations);
		return { t: 'gps', lat: l.lat, lon: l.lon, acc: 10 };
	}
	return { t: 'activity', id: 'no-such-activity' };
}

/** 看当前状态挑一个大概率能成功的动作（覆盖各类动作的成功路径）；没有可做的就退回纯随机 */
function smartAction(s: PlayerState, r: () => number, now: number): GameAction {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const pending = getPendingEvent(s);
	if (pending) return { t: 'event', choice: Math.floor(r() * pending.choices.length) };
	const c: GameAction[] = [];
	for (const x of activitiesAt(s, WA)) if (!x.blocked) c.push({ t: 'activity', id: x.act.id });
	for (const o of travelOptions(s, WA)) if (o.available) c.push({ t: 'travel', to: o.to, mode: o.mode });
	for (const n of npcsAt(s, WA)) for (const act of ['chat', 'help', 'gift', 'perk'] as const) if (act in n.blocked && !n.blocked[act]) c.push({ t: 'npc', npc: n.npc.id, act });
	for (const x of shopAt(s, WA)) if (!x.blocked) c.push({ t: 'buy', item: x.item.id });
	for (const id of Object.keys(s.inventory)) if (s.inventory[id] > 0 && ITEMS.find((i) => i.id === id)?.use) c.push({ t: 'use', item: id });
	for (const id of Object.keys(s.inventory)) if (!sellItemBlocked(s, getLocation(WA, s.loc), ITEMS.find((i) => i.id === id))) c.push({ t: 'sell', item: id });
	for (const x of careersAt(s, WA)) if (!x.blocked) c.push({ t: 'job', op: 'apply', career: x.career.id });
	if (s.job && !shiftBlocked(s, WA)) c.push({ t: 'job', op: 'work' }, { t: 'job', op: 'work' }, { t: 'job', op: 'work' });
	if (s.job && s.loc !== s.job.loc) for (const o of travelOptions(s, WA)) if (o.available && o.to === s.job.loc) c.push({ t: 'travel', to: o.to, mode: o.mode });
	// 租房市场：要签租约的房先看房再申请；租约操作、押金扣款、骗租广告能做就放进候选
	for (const x of homesAt(s, WA)) {
		if (x.blocked) continue;
		// 找房要看房、申请两步（还可能被拒），多放几次，免得住处相关的动作（做饭、家具）很少走到
		const a: GameAction = needsLease(x.home) && !viewedOk(s.rental, s.loc, x.home.id, dayOf(s.clock)) ? { t: 'rental', op: 'inspect', home: x.home.id } : { t: 'home', op: 'rent', home: x.home.id, term: r() < 0.5 ? 'fixed' : 'periodic' };
		if (!s.home) c.push(a, a);
		c.push(a);
	}
	for (const op of ['report', 'repair', 'renew'] as const) if (!leaseBlocked(s, op)) c.push({ t: 'rental', op });
	if (s.rental.claim) c.push({ t: 'rental', op: r() < 0.5 ? 'accept' : 'dispute' });
	if (scamHere(s, WA)) c.push({ t: 'rental', op: r() < 0.2 ? 'scam-pay' : 'scam-check' });
	if (s.home && s.home.loc === s.loc) {
		c.push({ t: 'home', op: 'sleep' });
		// 在家有炊具、娱乐设备的时间往往很短（随机动作会很快卖掉家具），多放几次让它们常被选中
		for (const op of ['cook', 'relax'] as const) if (!homeActionBlocked(s, op, WA)) c.push({ t: 'home', op }, { t: 'home', op }, { t: 'home', op });
	}
	if (s.home) for (const x of furnitureAt(s)) {
		if (x.owned) c.push({ t: 'furniture', op: 'sell', slot: x.item.slot });
		else if (!x.blocked) c.push({ t: 'furniture', op: 'buy', id: x.item.id });
	}
	const dealer = dealerAt(s, WA);
	// 合并租房市场后：找房的候选多了（看房、申请各放几次），买车被稀释得很少走到，卖车就更走不到；没车时买车多放一次
	for (const x of dealer) if (!x.blocked) c.push(...(s.vehicle === 'none' ? [{ t: 'vehicle', op: 'buy', id: x.vehicle.id } as GameAction, { t: 'vehicle', op: 'buy', id: x.vehicle.id } as GameAction] : [{ t: 'vehicle', op: 'buy', id: x.vehicle.id } as GameAction]));
	// 车行开着门（有可买的车不是因为营业时间被拦）才去卖车
	if (s.vehicle !== 'none' && dealer.length && isOpen(DEALER_HOURS, s.clock)) c.push({ t: 'vehicle', op: 'sell' }, { t: 'vehicle', op: 'sell' });
	if (VEHICLES.find((v) => v.id === s.vehicle)?.sleep) c.push({ t: 'vehicle', op: 'sleep' });
	for (const x of propertiesAt(s, WA)) {
		if (!x.owned && !x.blockedCash) c.push({ t: 'property', op: 'buy', id: x.property.id, loan: false });
		if (!x.owned && !x.blockedLoan && !('blocked' in homeLoanOffer(s, x.property.id))) c.push({ t: 'property', op: 'buy', id: x.property.id, loan: true }, { t: 'property', op: 'buy', id: x.property.id, loan: true });
	}
	// 银行：开户、办卡、取现、贷款、车贷、先买后付、还款
	const day = Math.floor(s.clock / 1440);
	if (!s.bank.open) c.push({ t: 'bank', op: 'open' });
	else {
		if (!('blocked' in cardOffer(s.bank, day, bankCapacity(s)))) c.push({ t: 'bank', op: 'card' }, { t: 'bank', op: 'card' });
		if (s.bank.card && s.bank.card.limit - s.bank.card.bal > 20) c.push({ t: 'bank', op: 'draw', amount: Math.floor(r() * (s.bank.card.limit - s.bank.card.bal)) + 1 });
		const amt = Math.floor(300 + r() * 2000);
		if (!('blocked' in personalOffer(s.bank, day, bankCapacity(s), amt))) c.push({ t: 'bank', op: 'loan', amount: amt });
		for (const x of dealer) c.push({ t: 'bank', op: 'carloan', id: x.vehicle.id });
		if (s.home && !bnplBlocked(s.bank, day)) for (const x of furnitureAt(s)) if (!x.owned) c.push({ t: 'bank', op: 'bnpl', id: x.item.id, ack: true });
		for (const kind of DEBT_KINDS) c.push({ t: 'bank', op: 'repay', kind, amount: Math.floor(r() * 3000) + 1 });
	}
	for (const o of s.properties) {
		c.push({ t: 'property', op: 'rentout', id: o.id }, { t: 'property', op: 'movein', id: o.id });
		if (o.loan > 0 && s.cash > 0) c.push({ t: 'property', op: 'repay', id: o.id, amount: Math.max(1, Math.floor(Math.min(s.cash, o.loan) * r())) });
		if (r() < 0.35) c.push({ t: 'property', op: 'sell', id: o.id }); // 合并租房市场后候选变多，0.2 时卖房一次都走不到
	}
	for (const x of coursesAt(s, WA)) if (!x.blocked) c.push({ t: 'course', id: x.course.id });
	for (const x of certsAt(s, WA)) if (!x.blocked) c.push({ t: 'cert', id: x.cert.id });
	// 有车又在修车厂的时候很少（随机动作常把车卖掉），多放几次；物品表一变随机序列就变，只放一次时覆盖率靠运气
	if (garageAt(s, WA) && !garageAt(s, WA)!.blocked) c.push({ t: 'vehicle', op: 'service' }, { t: 'vehicle', op: 'service' }, { t: 'vehicle', op: 'service' });
	if (photoQuestNow(s, WA) && !photoQuestNow(s, WA)!.blocked) c.push({ t: 'photo' });
	if (s.needs.fun < 50 && fishingAt(s, WA) && !fishingAt(s, WA)!.blocked) c.push({ t: 'fish' });
	for (const x of experiencesAt(s, WA)) if (!x.blocked) c.push({ t: 'experience', id: x.exp.id });
	// 换手墙：挂单和买家很多，各只放一个候选，别挤掉其他动作（车卖多了保养就很少轮到）
	const swapBuys = (swapBoard(s, WA)?.listings ?? []).flatMap((x) => (['pickup', 'prepay'] as const).filter((how) => !buyBlocked(s, x, how)).map((how) => ({ x, how })));
	if (swapBuys.length) { const { x, how } = pick(swapBuys); c.push({ t: 'swap', op: 'buy', id: x.id, ref: x.good.ref, how, haggle: r() < 0.5 }); }
	const swapSells = swapOwned(s).filter((g) => g.kind !== 'vehicle' || r() < 0.2).flatMap((g) => {
		const so = sellOffers(s, WA, g.kind, g.ref);
		return so && !so.blocked ? so.offers.flatMap((o, i) => (o.done ? [] : [{ g, i }])) : [];
	});
	if (swapSells.length) { const { g, i } = pick(swapSells); c.push({ t: 'swap', op: 'sell', kind: g.kind, ref: g.ref, buyer: i, verify: r() < 0.6 }); }
	for (const x of visaOptions(s, WA)) if (!x.blocked) c.push({ t: 'visa', op: 'apply', route: x.route.id }); // 第 43 批
	if (ieltsAt(s, WA) && !ieltsAt(s, WA)!.blocked) c.push({ t: 'visa', op: 'ielts' });
	const here = WA.venues.filter((v) => v.loc === s.loc);
	if (here.length) {
		// 只挑这类地点有的动作，站在门口、精度 10 米
		const v = pick(here);
		const ops = VENUE_TYPES.find((t) => t.id === v.type)?.ops ?? [];
		for (let i = 0; i < 3 && ops.length; i++) c.push({ t: 'venue', venue: v.id, op: pick(ops), lat: v.lat, lon: v.lon, acc: 10 });
	}
	return c.length ? pick(c) : randomAction(s, r, now);
}

/** 动作的统计键：类型 + 子操作 */
const keyOf = (a: GameAction) => a.t + ('op' in a ? ':' + a.op : '');

function checkInvariants(s: PlayerState, where: string) {
	const inRange = (v: number, lo: number, hi: number, name: string) => {
		assert.ok(Number.isFinite(v), `${where}: ${name} 不是有限数 (${v})`);
		assert.ok(v >= lo && v <= hi, `${where}: ${name}=${v} 超出 [${lo}, ${hi}]`);
	};
	for (const k of NEED_KEYS) inRange(s.needs[k], 0, 100, 'needs.' + k);
	for (const k of SKILL_KEYS) inRange(s.skills[k], 0, 100, 'skills.' + k);
	inRange(s.health, 0, 100, 'health');
	inRange(s.heat, 0, 100, 'heat');
	inRange(s.cash, 0, CAPS.cash, 'cash');
	inRange(s.respect, 0, CAPS.respect, 'respect');
	inRange(s.clock, 0, CAPS.clock, 'clock');
	inRange(s.rev, 0, CAPS.rev - 1, 'rev');
	assert.ok(LOCS.has(s.loc), `${where}: 所在地 ${s.loc} 不存在`);
	for (const p of s.properties) inRange(p.loan, 0, CAPS.cash, `properties.${p.id}.loan`);
	// 银行：欠款非负、信用卡不超过额度太多（罚金、利息可以略超）、信用分在范围内、没开户就没有信用产品
	const b = s.bank;
	if (!b.open) assert.ok(!b.card && !b.loans.length && !b.bnpl.length, `${where}: 没开户却有信用产品`);
	if (b.card) inRange(b.card.bal, 0, b.card.limit * 3, 'bank.card.bal');
	for (const l of b.loans) inRange(l.bal, 1, 1e6, `bank.loans.${l.kind}.bal`);
	assert.ok(b.loans.filter((l) => l.kind === 'car').length <= 1 && b.loans.filter((l) => l.kind === 'personal').length <= 1, `${where}: 同种贷款不止一笔`);
	for (const p of b.bnpl) inRange(p.left, 1, 3, 'bank.bnpl.left');
	const score = creditScore(b, Math.floor(s.clock / 1440));
	if (score !== null) inRange(score, 0, 1000, 'creditScore');
	inRange(s.car.km, 0, CAR_KM_MAX, 'car.km');
	inRange(s.car.since, 0, s.car.km, 'car.since');
	if (s.vehicle === 'none') assert.deepEqual(s.car, { km: 0, since: 0 }, `${where}: 没车却有里程`);
	assert.equal(new Set(s.dex).size, s.dex.length, `${where}: 图鉴有重复`);
	inRange(s.photoQuest, 0, PHOTO_QUESTS.length, 'photoQuest');
	inRange(s.story.ch, 0, STORY.length, 'story.ch');
	// 每日摘要：记号就是今天（引擎每次动作后都会换日），yday 在记号那天之前结束
	assert.equal(s.dayMark.day, Math.floor(s.clock / 1440), `${where}: dayMark 不是今天`);
	inRange(s.dayMark.cash, 0, 1e9, 'dayMark.cash');
	assert.ok(s.dayMark.at <= s.clock && Math.floor((s.dayMark.at + 1) / 1440) >= s.dayMark.day, `${where}: dayMark.at 越界`);
	if (s.yday) assert.ok(Number.isInteger(s.yday.days) && s.yday.days >= 1 && s.yday.day + s.yday.days <= s.dayMark.day && s.yday.from < s.yday.to && s.yday.to <= s.dayMark.at, `${where}: yday 越界`);
	assert.equal(new Set(s.duos).size, s.duos.length, 'duos 不重复');
	assert.equal(new Set(s.certs).size, s.certs.length, `${where}: 证书或学历重复`);
	for (const [id, st] of Object.entries(s.study)) {
		const p = PROGRAMS.find((x) => x.id === id);
		assert.ok(p && Number.isInteger(st.n) && st.n >= 0 && st.n <= p.sessions, `${where}: study.${id}=${JSON.stringify(st)}`);
		assert.equal(st.n >= p.sessions, s.certs.includes(p.award), `${where}: ${id} 上满次数和学历对不上`);
	}
	assert.ok(Number.isInteger(s.workLog.min) && s.workLog.min >= 0, `${where}: workLog=${JSON.stringify(s.workLog)}`);
	for (const id of s.duos) assert.ok(NPC_DUOS.some((d) => d.id === id), `duos 里有不认识的 ${id}`);
	for (const [id, n] of Object.entries(s.story.done)) {
		const st = STORY[s.story.ch]?.steps.find((x) => x.id === id);
		assert.ok(st && Number.isInteger(n) && n >= 1 && n <= (st.n ?? 1), `story.done.${id}=${n}`);
	}
	for (const [id, n] of Object.entries(s.fish)) assert.ok(FISH.some((f) => f.id === id) && Number.isInteger(n) && n >= 1, `${where}: 鱼获 ${id}=${n}`);
	for (const g of s.dexSets) assert.ok(ANIMALS.filter((a) => a.group === g).every((a) => s.dex.includes(a.id)), `${where}: ${g} 组没集齐却发了奖`);
}

test('随机动作序列：不抛异常、不改入参、数值在范围内、服务端规范化稳定', () => {
	// 合并二手市场后改成 90：每合一个系统，随机候选就多一些，60 轮时冷门动作（放松、还贷、卖车……）时有时无，覆盖断言跟着随机序列翻
	const RUNS = 90;
	const STEPS = 120;
	let ok = 0;
	const stats: Record<string, { tried: number; ok: number }> = {};
	for (let run = 0; run < RUNS; run++) {
		const r = rng(1000 + run);
		const origin = ORIGINS[run % ORIGINS.length].id;
		const traits = run % 3 === 0 ? [] : [TRAITS[run % TRAITS.length].id, TRAITS[(run * 7 + 3) % TRAITS.length].id];
		let s = createCharacter({ id: 'fuzz-' + run, name: '随机' + run, avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 + run, traits: [...new Set(traits)] });
		// 三分之一的角色开局很有钱，让买车、买房、贷款这些路径也能走到
		// 其中一半换成「付得起首付、买不起全款、有正式工作和银行账户」：银行按收入审批按揭、车贷（banking.md）
		if (run % 3 === 2) s = run % 2 ? { ...s, cash: 30_000, job: { career: 'barista', loc: WA.spawn, level: 2, shifts: 0, good: 0, lastDay: -1 }, bank: { ...s.bank, open: true } } : { ...s, cash: 300_000 };
		s = sanitizeState(s, LOCS, { fallbackLoc: WA.spawn }) ?? s;
		let now = 1_800_000_000_000 + run * 3_600_000;
		for (let step = 0; step < STEPS; step++) {
			const where = `seed ${1000 + run} 第 ${step} 步`;
			now += Math.floor(r() * 3 * 3_600_000); // 现实时间往前走 0–3 小时，让冷却和上班卡有机会到期
			const a = r() < 0.75 ? smartAction(s, r, now) : randomAction(s, r, now);
			// 动作要能通过网络协议的校验（和服务端一样先 parseAction）
			const parsed = parseAction(JSON.parse(JSON.stringify(a)));
			assert.ok(parsed, `${where}: parseAction 拒绝了合法格式 ${JSON.stringify(a)}`);
			const before = structuredClone(s);
			const res = applyAction(s, WA, parsed!, now);
			assert.deepEqual(s, before, `${where}: ${a.t} 改了入参`);
			const k = keyOf(a);
			const st = (stats[k] ??= { tried: 0, ok: 0 });
			st.tried++;
			// 引擎直接输出的状态也要在范围内（不能指望服务端的清洗兜底）
			checkInvariants(res.state, where + ` ${k} 引擎直接输出`);
			if (res.ok) {
				ok++;
				st.ok++;
				assert.equal(res.state.rev, (before.rev + 1) % CAPS.rev, `${where}: 成功的动作版本号没 +1`);
			}
			// 服务端落盘前会再清洗一次（canon）；清洗结果必须可用，且再清洗一次不变
			const canon = sanitizeState(res.state, LOCS, { fallbackLoc: WA.spawn, now });
			assert.ok(canon, `${where}: ${a.t} 之后的存档清洗失败`);
			assert.deepEqual(sanitizeState(canon, LOCS, { fallbackLoc: WA.spawn, now }), canon, `${where}: 清洗不稳定`);
			checkInvariants(canon!, where);
			s = canon!;
		}
	}
	// 主要动作的成功路径都要真的走到过，不然这个测试只在测「失败路径」
	const MUST = ['travel', 'activity', 'event', 'gps', 'buy', 'use', 'sell', 'npc', 'job:apply', 'job:work', 'job:quit', 'home:rent', 'home:sleep', 'home:cook', 'home:relax',
		'furniture:buy', 'furniture:sell', 'vehicle:buy', 'vehicle:sell', 'property:buy', 'property:rentout', 'property:movein', 'property:repay', 'property:sell', 'course', 'cert', 'vehicle:service', 'fish', 'experience', 'venue:meal', 'venue:work', 'swap:buy', 'swap:sell', 'bank:open', 'bank:card', 'bank:draw', 'bank:repay', 'bank:bnpl'];
	const missing = MUST.filter((k) => !stats[k]?.ok);
	assert.deepEqual(missing, [], `这些动作一次都没成功过：${missing.join('、')}；统计 ${JSON.stringify(stats)}`);
	assert.ok(ok > RUNS * 120 * 0.3, `成功的动作太少：${ok}`);
});
