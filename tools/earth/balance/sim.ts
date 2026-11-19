#!/usr/bin/env node
// 数值平衡模拟：几类机器人玩家按固定策略自动玩 N 个游戏日，统计经济与生存指标。
// 走的是服务端同一个入口 applyAction()，结果与真实玩家一致。
//
//   npm run earth:sim                 默认 60 天 × 每种策略 40 个种子
//   npm run earth:sim -- --days=120 --runs=100
//   npm run earth:sim -- --out=docs/earth-game/balance-report.md
//   npm run earth:sim -- --origins     出身对照：每个出身跑同样三种策略（零工 / 咖啡店 / 不干活），都不带特质
import { writeFileSync } from 'node:fs';
import { applyAction, applyCoop, type GameAction } from '../../../src/game/core/actions.ts';
import { coopBlocked, coopsAt } from '../../../src/game/core/coop.ts';
import { decayMult, mood } from '../../../src/game/core/attributes.ts';
import { createCharacter, ORIGINS } from '../../../src/game/core/character.ts';
import {
	activitiesAt, careersAt, coursesAt, dealerAt, DECAY, netWorth, propertiesAt, furnitureAt, homeActionBlocked, experiencesAt, getCareer, getPendingEvent, homesAt, npcsAt, shiftBlocked, shopAt, travelOptions,
} from '../../../src/game/core/engine.ts';
import { dayOf, hourOf } from '../../../src/game/core/time.ts';
import { weatherAt } from '../../../src/game/core/weather.ts';
import { SKILL_KEYS } from '../../../src/game/core/types.ts';
import type { PlayerState } from '../../../src/game/core/types.ts';
import { WA } from '../../../src/game/data/wa.ts';
import { gigsAt, licenseValid, shopActions, shopOffersAt } from '../../../src/game/core/business.ts';
import { getShopSite, getShopType } from '../../../src/game/core/business.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const DAYS = Number(arg('days', '60'));
const RUNS = Number(arg('runs', '40'));
const OUT = arg('out', '');
const BY_ORIGIN = process.argv.includes('--origins');

// ---------- 机器人 ----------
interface Bot {
	s: PlayerState;
	rng: () => number;
	plan: Plan;
	stats: {
		collapses: number;
		evictions: number;
		promotions: number;
		events: number;
		moodSum: number;
		moodN: number;
		shifts: number;
		daysBroke: number;
		cashByDay: number[];
		flow: Record<string, number>;
		promoDays: number[];
		homeDay?: number;
		diag: BackpackerDiagnostics;
		/** 第 46 轮：参加共同事件的次数、成功次数、按种类计数 */
		coops: number;
		coopOk: number;
		coopKinds: Record<string, number>;
		/** 副业与小生意（docs/earth-game/side-business.md）：副业次数、开店那天、倒闭次数、店铺结算净额 */
		biz: { gigs: Record<string, number>; openDay?: number; bankrupt: number; shopNet: number };
	};
}

const GIG_IDS = ['work-mine', 'work-farm', 'work-cafe', 'busk'] as const;
type GigMiss = 'location' | 'hours' | 'energy' | 'needs' | 'weather' | 'requirements';
type CollapseCause = 'hunger' | 'energy' | 'both' | 'other';

interface BackpackerDiagnostics {
	gigStarted: number;
	gigCompleted: number;
	gigIncome: number;
	gigCollapsed: number;
	gigMisses: Record<GigMiss, number>;
	collapseCauses: Record<CollapseCause, number>;
	collapseTravel: number;
	collapseActions: Record<string, number>;
	collapseBefore: { health: number; hunger: number; energy: number }[];
}

interface GigPlan {
	/** 现金低于这个值时找零工，避免等到快没钱才开工 */
	cashTarget: number;
	/** 低于这条线时不做可选消费；救命的饭仍会买 */
	cashReserve: number;
	/** 开工前的最低精力和饱食 */
	minEnergy: number;
	minHunger: number;
	/** 依次尝试，先选时薪稳定、耗时较短的工作 */
	preferred: readonly (typeof GIG_IDS)[number][];
}

interface Plan {
	id: string;
	name: string;
	origin: string;
	traits: string[];
	/** 想去的工作地点与职业；没有表示不找正式工作 */
	job?: { loc: string; career: string };
	/** 想租的房型（在工作地点或出生点） */
	home?: string;
	/** 有空就四处旅行 */
	roam?: boolean;
	/** false：不上课、不体验、不买车（用来和旧版本对比） */
	spend?: boolean;
	/** 有配置时使用保守零工策略 */
	gig?: GigPlan;
	/**
	 * 第 46 轮：保命、上班之后，所在地点能做共同事件就拉一个搭档一起做（第 10 批审查后改成三种搭档假设做对照）。
	 * mateNeeds：搭档的各项需求（100 = 全满）；mateChance：每次想做时有搭档在场的概率
	 */
	coop?: { mateNeeds: number; mateChance: number };
	/** 副业：要办的证照、依次尝试的副业（精力、饱食都不低于 45 时才做） */
	side?: { licenses: string[]; gigs: string[] };
	/** 开店：现金到 openAt 时在 site 开 type，雇 staff 个人，库存低于 restockBelow 就补货 */
	shop?: { type: string; site: string; openAt: number; staff: number; restockBelow: number };
}

const PLANS: Plan[] = [
	{ id: 'barista', name: '咖啡店上班族（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room' },
	{ id: 'lifeguard', name: '救生员（珀斯，公寓）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'perth', career: 'lifeguard' }, home: 'flat' },
	{ id: 'miner', name: '矿工（卡尔古利，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room' },
	{ id: 'drifter', name: '打零工的背包客（无房）', origin: 'backpacker', traits: ['loner', 'frugal'], roam: true },
	{
		id: 'drifter-safe', name: '保守背包客（无房，少漫游）', origin: 'backpacker', traits: ['loner', 'frugal'], spend: false,
		gig: { cashTarget: 700, cashReserve: 200, minEnergy: 55, minHunger: 50, preferred: ['work-cafe', 'work-farm', 'busk', 'work-mine'] },
	},
	{ id: 'idle', name: '什么都不干（对照组）', origin: 'backpacker', traits: [] },
	// 第 46 轮新增（只出报告，不改数值）：第 11 轮的两种新职业、第 1 轮起的共同事件。排在原有策略后面，原有各行结果不变
	{ id: 'bartender', name: '酒保（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'bartender' }, home: 'room' },
	{ id: 'farmhand', name: '农场工（玛格丽特河，合租）', origin: 'backpacker', traits: ['athletic', 'tough'], job: { loc: 'margaret-river', career: 'farmhand' }, home: 'room' },
	// 共同事件三种搭档假设（第 10 批审查问题 1）：理想（需求全满、随叫随到）是上限，不是保守估计；另外两种看搭档状态和在场率的影响
	{ id: 'barista-coop', name: '咖啡店 + 共同事件：理想搭档（需求全满、随时在场）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 100, mateChance: 1 } },
	{ id: 'barista-coop-tired', name: '咖啡店 + 共同事件：疲惫搭档（需求 40、随时在场）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 40, mateChance: 1 } },
	{ id: 'barista-coop-sparse', name: '咖啡店 + 共同事件：疲惫搭档，一半时候没人（需求 40、在场 50%）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 40, mateChance: 0.5 } },
	// 副业与小生意（side-business.md）新增：排在最后，原有各行结果不变
	{ id: 'side-gig', name: '副业留学生：家教 + 送外卖（珀斯，合租，无正式工作）', origin: 'student', traits: ['charming', 'neat'], home: 'room', spend: false, side: { licenses: ['abn', 'wwc-wa'], gigs: ['tutor', 'delivery', 'daigou'] } },
	{ id: 'barista-side', name: '咖啡店 + 下班家教（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, side: { licenses: ['wwc-wa'], gigs: ['tutor'] } },
	{ id: 'shop-milktea', name: '咖啡店攒钱开奶茶店（北桥，雇 1 人）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, shop: { type: 'milk-tea', site: 'northbridge', openAt: 14_000, staff: 1, restockBelow: 150 } },
	{ id: 'shop-repair', name: '咖啡店攒钱开手机维修铺（维多利亚公园，不雇人、自己看店）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, shop: { type: 'phone-repair', site: 'victoria-park', openAt: 7_000, staff: 0, restockBelow: 20 } },
];

// 出身对照（初始属性设计，见 docs/earth-game/initial-stats.md）：同一策略、不带特质，只换出身，看起始现金、车和能力的差别。只出报告，不改数值
/** 对照组：不工作、不消费、不玩。出身对照里的 idle-<出身> 同样处理 */
const isIdle = (plan: Plan) => plan.id === 'idle' || plan.id.startsWith('idle-');

const ORIGIN_PLANS: Plan[] = ORIGINS.flatMap((o) => [
	{
		id: `gig-${o.id}`, name: `${o.name}：保守零工（珀斯，无房）`, origin: o.id, traits: [], spend: false,
		gig: { cashTarget: 700, cashReserve: 200, minEnergy: 55, minHunger: 50, preferred: ['work-cafe', 'work-farm', 'busk', 'work-mine'] },
	},
	{ id: `barista-${o.id}`, name: `${o.name}：咖啡店（珀斯，合租）`, origin: o.id, traits: [], job: { loc: 'perth', career: 'barista' }, home: 'room' },
	{ id: `idle-${o.id}`, name: `${o.name}：不干活（对照组）`, origin: o.id, traits: [] },
]);

function mulberry(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function blankDiagnostics(): BackpackerDiagnostics {
	return {
		gigStarted: 0,
		gigCompleted: 0,
		gigIncome: 0,
		gigCollapsed: 0,
		gigMisses: { location: 0, hours: 0, energy: 0, needs: 0, weather: 0, requirements: 0 },
		collapseCauses: { hunger: 0, energy: 0, both: 0, other: 0 },
		collapseTravel: 0,
		collapseActions: {},
		collapseBefore: [],
	};
}

function actionKey(a: GameAction): string {
	if (a.t === 'biz') return a.op === 'gig' ? `biz-${a.id}` : `biz-${a.op}`;
	return a.t === 'activity' ? a.id
		: a.t === 'job' || a.t === 'home' || a.t === 'furniture' || a.t === 'property' ? `${a.t}-${a.op}`
			: a.t === 'npc' ? 'npc'
				: a.t === 'buy' ? `buy-${a.item}`
					: a.t;
}

/** 用动作开始状态和实际耗时回算：是哪项需求见底并把健康扣到 0。 */
function recordCollapse(b: Bot, before: PlayerState, after: PlayerState, a: GameAction, key: string) {
	const d = b.stats.diag;
	// collapse() 固定追加 12 小时住院；扣掉它才是触发晕倒的动作耗时。
	const actionMinutes = Math.max(0, after.clock - before.clock - 12 * 60);
	const hungerBottom = before.needs.hunger <= DECAY.hunger * decayMult(before, 'hunger') * actionMinutes;
	const energyBottom = before.needs.energy <= DECAY.energy * decayMult(before, 'energy') * actionMinutes;
	const starvationDamage = hungerBottom || energyBottom ? 0.02 * actionMinutes : 0;
	let cause: CollapseCause = 'other';
	if (before.health <= starvationDamage) cause = hungerBottom && energyBottom ? 'both' : hungerBottom ? 'hunger' : 'energy';
	d.collapseCauses[cause]++;
	if (a.t === 'travel') d.collapseTravel++;
	d.collapseActions[key] = (d.collapseActions[key] ?? 0) + 1;
	d.collapseBefore.push({ health: before.health, hunger: before.needs.hunger, energy: before.needs.energy });
}

/** 尝试一个动作；成功则更新状态并统计 */
function tryAct(b: Bot, a: GameAction): boolean {
	const before = b.s;
	const r = applyAction(b.s, WA, a);
	if (!r.ok) {
		b.s = r.state;
		return false;
	}
	b.s = r.state;
	const key = actionKey(a);
	// 店铺结算挂在任意动作之后：把这次结算出的净额单独记成 shop-days，不算进触发它的动作
	const shopNow = b.s.biz.shop;
	const settledNet = shopNow ? shopNow.hist.filter((h) => h.d > (before.biz.shop?.last ?? Infinity)).reduce((n, h) => n + h.net, 0) : 0;
	if (settledNet) b.stats.flow['shop-days'] = (b.stats.flow['shop-days'] ?? 0) + settledNet;
	if (before.biz.shop && !b.s.biz.shop && !(a.t === 'biz' && a.op === 'close')) b.stats.biz.bankrupt++;
	if (!before.biz.shop && b.s.biz.shop) b.stats.biz.openDay ??= dayOf(b.s.clock);
	if (a.t === 'biz' && a.op === 'gig') b.stats.biz.gigs[a.id] = (b.stats.biz.gigs[a.id] ?? 0) + 1;
	b.stats.biz.shopNet += settledNet;
	b.stats.flow[key] = (b.stats.flow[key] ?? 0) + (b.s.cash - before.cash) - settledNet;
	if (a.t === 'activity' && (GIG_IDS as readonly string[]).includes(a.id)) {
		b.stats.diag.gigStarted++;
		if (r.collapsed) b.stats.diag.gigCollapsed++;
		else {
			b.stats.diag.gigCompleted++;
			b.stats.diag.gigIncome += Math.max(0, b.s.cash - before.cash);
		}
	}
	if (r.collapsed) recordCollapse(b, before, b.s, a, key);
	// 这次动作中写下的日志：时间晚于动作开始时刻（每个成功动作都会让时间前进）
	for (const j of b.s.journal) {
		if (j.t <= before.clock) continue;
		if (j.text.includes('晕倒')) b.stats.collapses++;
		if (j.text.includes('收回') || j.text.includes('强制卖出')) b.stats.evictions++;
	}
	if (b.s.job && before.job && b.s.job.career === before.job.career && b.s.job.level > before.job.level) {
		b.stats.promotions++;
		b.stats.promoDays.push(dayOf(b.s.clock) + 1);
	}
	if (a.t === 'job' && a.op === 'work') b.stats.shifts++;
	return true;
}

const can = (b: Bot, id: string) => activitiesAt(b.s, WA).some((x) => x.act.id === id && !x.blocked);
const act = (b: Bot, id: string) => can(b, id) && tryAct(b, { t: 'activity', id });

/** 从 from 到 dest 按路线跳数最少的下一站（广度优先；没有路返回 undefined） */
function nextHop(from: string, dest: string): string | undefined {
	const prev = new Map<string, string>([[from, from]]);
	const queue = [from];
	while (queue.length) {
		const at = queue.shift()!;
		if (at === dest) break;
		for (const r of WA.routes) {
			const nb = r.a === at ? r.b : r.b === at ? r.a : null;
			if (nb && !prev.has(nb)) { prev.set(nb, at); queue.push(nb); }
		}
	}
	if (!prev.has(dest)) return undefined;
	let hop = dest;
	while (prev.get(hop) !== from) hop = prev.get(hop)!;
	return hop;
}

/** 去某地：有直达就走最便宜的可用方式，否则沿跳数最少的路线先去下一站（第 46 轮补上：农场工要去的玛格丽特河从珀斯没有直达） */
function headTo(b: Bot, dest: string): boolean {
	const opts = travelOptions(b.s, WA).filter((o) => o.available);
	const direct = opts.filter((o) => o.to === dest).sort((x, y) => x.cost - y.cost)[0];
	if (direct) return tryAct(b, { t: 'travel', to: direct.to, mode: direct.mode });
	const hop = nextHop(b.s.loc, dest);
	const step = hop ? opts.filter((o) => o.to === hop).sort((x, y) => x.cost - y.cost)[0] : undefined;
	return !!step && tryAct(b, { t: 'travel', to: step.to, mode: step.mode });
}

function recordGigMiss(b: Bot, reason: GigMiss) {
	b.stats.diag.gigMisses[reason]++;
}

/** 已经想开工却没有一种零工能做：记下当前最直接的阻塞原因。 */
function recordBlockedGigs(b: Bot) {
	const gigsHere = activitiesAt(b.s, WA).filter((x) => (GIG_IDS as readonly string[]).includes(x.act.id));
	if (!gigsHere.length) {
		recordGigMiss(b, 'location');
		return;
	}
	const reasons = gigsHere.map((x) => x.blocked).filter((x): x is string => !!x);
	if (reasons.some((x) => /风暴|天气/.test(x))) recordGigMiss(b, 'weather');
	else if (reasons.some((x) => /体力|太累/.test(x))) recordGigMiss(b, 'energy');
	else if (reasons.some((x) => /营业时间/.test(x))) recordGigMiss(b, 'hours');
	else recordGigMiss(b, 'requirements');
}

function tryGigs(b: Bot, order: readonly (typeof GIG_IDS)[number][]): boolean {
	for (const gig of order) if (act(b, gig)) return true;
	recordBlockedGigs(b);
	return false;
}

/**
 * 保守背包客只在出生地珀斯生活：不漫游、不买大件，低需求先恢复；
 * 现金低于目标时优先做稳定的咖啡店零工，并为食物和应急保留现金。
 */
function stepSafeDrifter(b: Bot) {
	const s = b.s;
	const gig = b.plan.gig!;
	const wantsGig = s.cash < gig.cashTarget;
	const h = hourOf(s.clock);
	const night = h >= 22 || h < 5;

	if (s.health < 40) {
		if (wantsGig) recordGigMiss(b, 'needs');
		if (act(b, 'clinic') || (s.inventory.firstaid && tryAct(b, { t: 'use', item: 'firstaid' }))) return;
		if (act(b, 'sleep-camp')) return;
	}

	// 碰上开放时间就先吃免费餐；不为了等饭而空耗一整天。
	if (s.needs.hunger < 70 && (act(b, 'charity-meal') || act(b, 'charity-dinner'))) {
		if (wantsGig) recordGigMiss(b, 'needs');
		return;
	}
	if (s.needs.hunger < gig.minHunger) {
		if (wantsGig) recordGigMiss(b, 'needs');
		if (act(b, 'forage')) return;
		if (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' })) return;
		// 饭是现金底线的例外：活下来比守住账面储备重要。
		if (act(b, 'eat')) return;
		if (s.inventory.water && tryAct(b, { t: 'use', item: 'water' })) return;
		if (act(b, 'recycle')) return;
	}

	if (s.needs.energy < gig.minEnergy || (night && s.needs.energy < 75)) {
		if (wantsGig) recordGigMiss(b, 'energy');
		if (act(b, 'sleep-camp')) return;
	}
	if (s.needs.hygiene < 20 && s.cash > gig.cashReserve && act(b, 'shower')) {
		if (wantsGig) recordGigMiss(b, 'needs');
		return;
	}

	if (wantsGig && tryGigs(b, gig.preferred)) return;

	// 只用免费社交和娱乐；不去酒吧，也不为探索离开稳定零工地点。
	if (s.needs.social < 40) {
		const npc = npcsAt(s, WA).find((n) => !n.blocked.chat);
		if (npc && tryAct(b, { t: 'npc', npc: npc.npc.id, act: 'chat' })) return;
	}
	if (s.needs.fun < 40 && s.needs.energy >= 35 && act(b, 'swim')) return;

	// 补一根便宜的应急能量棒，但不动 $200 应急金。
	if (!s.inventory.snack && s.cash > gig.cashReserve) {
		const e = shopAt(s, WA).find((x) => x.item.id === 'snack' && !x.blocked);
		if (e && tryAct(b, { t: 'buy', item: 'snack' })) return;
	}
	act(b, 'rest');
}

/**
 * 共同事件（第 46 轮）：所在地点有现在能做的就做一件。搭档是每次现场新建的同出身角色（开局能力），需求和在场率按策略的假设；
 * 和服务端一样，开始前对每个成员都检查 coopBlocked，有人不能参加就不做。只统计机器人自己的收益。
 * 搭档是假设出来的，结果只说明「在这个假设下」会怎样，不代表真实玩家的分布（第 10 批审查问题 1）。
 */
function tryCoop(b: Bot): boolean {
	const s = b.s;
	const cfg = b.plan.coop!;
	const open = coopsAt(s, WA).find((x) => !x.blocked);
	if (!open) return false;
	if (cfg.mateChance < 1 && b.rng() >= cfg.mateChance) return false;
	const base = createCharacter({ id: `sim-mate-${b.stats.coops}`, name: 'mate', avatar: '🧑', origin: b.plan.origin, traits: [], region: WA.id, spawn: s.loc, seed: Math.floor(b.rng() * 1e9) });
	const n = cfg.mateNeeds;
	const mate = { ...base, loc: s.loc, clock: s.clock, needs: { ...base.needs, hunger: n, energy: n, hygiene: n, fun: n, social: n } };
	if (coopBlocked(s, WA, open.def) || coopBlocked(mate, WA, open.def)) return false;
	const r = applyCoop(open.def, WA, [{ state: s, role: 0, name: b.plan.id }, { state: mate, role: 1, name: 'mate' }]);
	const me = r.results[0];
	if (!me.ok) return false;
	b.stats.flow.coop = (b.stats.flow.coop ?? 0) + (me.state.cash - s.cash);
	b.stats.coops++;
	if (r.success) b.stats.coopOk++;
	b.stats.coopKinds[open.def.id] = (b.stats.coopKinds[open.def.id] ?? 0) + 1;
	b.s = me.state;
	return true;
}

/** 一步决策：先保命，再上班，再满足需求，最后按策略消磨时间 */
function step(b: Bot) {
	const s = b.s;
	const plan = b.plan;
	const ev = getPendingEvent(s);
	if (ev) {
		b.stats.events++;
		// 选第一个现在能选的选项：付得起、风暴天不下海（和引擎的限制一致）
		const stormy = !!weatherAt(s).closesSea;
		const pick = ev.choices.findIndex((c) => (!c.cost || c.cost <= s.cash) && !(c.exposed === 'sea' && stormy));
		if (pick < 0 || !tryAct(b, { t: 'event', choice: pick })) throw new Error(`机器人卡在事件 ${ev.id}（${plan.id}，第 ${dayOf(s.clock)} 天）`);
		return;
	}
	if (plan.gig) {
		stepSafeDrifter(b);
		return;
	}
	const h = hourOf(s.clock);
	const atHome = s.home && s.home.loc === s.loc;

	// 1. 生存（没钱时赶上免费餐就去吃）
	if (s.cash < 60 && s.needs.hunger < 80 && (act(b, 'charity-meal') || act(b, 'charity-dinner'))) return;
	if (s.health < 35 && (act(b, 'clinic') || (s.inventory.firstaid && tryAct(b, { t: 'use', item: 'firstaid' })))) return;
	if (s.needs.hunger < 35) {
		if (!homeActionBlocked(s, 'cook') && tryAct(b, { t: 'home', op: 'cook' })) return;
		if (act(b, 'eat')) return;
		if (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' })) return;
		if (s.inventory.water && tryAct(b, { t: 'use', item: 'water' })) return;
		if (act(b, 'forage')) return;
	}
	// 夜里精力不满才睡（刚睡醒的半夜不会再睡一觉，否则会睡过上班时间）
	const night = (h >= 22 || h < 5) && s.needs.energy < 70;
	if (s.needs.energy < 25 || night) {
		if (atHome && tryAct(b, { t: 'home', op: 'sleep' })) return;
		if (s.cash > 600 && act(b, 'sleep-motel')) return;
		if (act(b, 'sleep-camp')) return;
	}
	if (s.needs.hygiene < 25 && act(b, 'shower')) return;

	// 2. 找工作、租房、去上班
	if (plan.job) {
		if (!s.job) {
			if (s.loc !== plan.job.loc) {
				if (headTo(b, plan.job.loc)) return;
			} else if (careersAt(s, WA).some((o) => o.career.id === plan.job!.career && !o.blocked)) {
				if (tryAct(b, { t: 'job', op: 'apply', career: plan.job.career })) return;
			}
		} else if (s.loc !== s.job.loc) {
			if (headTo(b, s.job.loc)) return; // 被送去外地医院等情况：先回工作地点
		} else if (dayOf(s.clock) % 7 !== 6 && !shiftBlocked(s) && tryAct(b, { t: 'job', op: 'work' })) return; // 每周休一天
	}
	if (plan.home && !s.home && s.cash > 400) {
		const want = plan.job?.loc ?? WA.spawn;
		if (s.loc === want && homesAt(s, WA).some((o) => o.home.id === plan.home && !o.blocked) && tryAct(b, { t: 'home', op: 'rent', home: plan.home })) return;
	}

	// 2.5 副业与小生意（只有带 side / shop 的策略）
	if ((plan.side || plan.shop) && stepBiz(b)) return;

	// 3. 花钱（阶段 A）：升职卡在能力上就上课；钱多就体验、买车
	if (plan.spend !== false && !isIdle(plan)) {
		if (s.job && s.cash > 600) {
			const next = getCareer(s.job.career)!.levels[s.job.level + 1];
			const lacking = SKILL_KEYS.filter((k) => (next?.req?.skills?.[k] ?? 0) > s.skills[k]);
			const course = coursesAt(s, WA).find((o) => lacking.includes(o.course.skill) && !o.blocked);
			if (course && tryAct(b, { t: 'course', id: course.course.id })) return;
		}
		if (atHome && s.cash > 1500) {
			const f = furnitureAt(s).find((o) => !o.blocked && !s.home!.furniture[o.item.slot] && o.item.price <= 500);
			if (f && tryAct(b, { t: 'furniture', op: 'buy', id: f.item.id })) return;
		}
		if (s.cash > 2500) {
			const exp = experiencesAt(s, WA).find((o) => o.first && !o.blocked);
			if (exp && tryAct(b, { t: 'experience', id: exp.exp.id })) return;
		}
		// 买房：首付之外还留 $3,000 周转；买了就搬进去
		const house = propertiesAt(s, WA).find((o) => !o.owned && s.cash >= o.down + 3000);
		if (house && s.properties.length === 0 && tryAct(b, { t: 'property', op: 'buy', id: house.property.id, loan: s.cash < house.property.price + 3000 })) {
			tryAct(b, { t: 'property', op: 'movein', id: house.property.id });
			b.stats.homeDay = dayOf(b.s.clock) + 1;
			return;
		}
		if (s.vehicle === 'none' && s.cash > 7000 && s.properties.length > 0) {
			const car = dealerAt(s, WA).find((o) => o.vehicle.id === 'car' && !o.blocked);
			if (car && tryAct(b, { t: 'vehicle', op: 'buy', id: 'car' })) return;
		}
	}

	// 3.5 共同事件（第 46 轮的策略）：保命、上班、租房之后，娱乐之前
	if (plan.coop && s.needs.energy >= 35 && s.needs.hunger >= 35 && tryCoop(b)) return;

	// 4. 没有正式工作的人靠零工
	if (!s.job && !isIdle(plan) && s.cash < 400) {
		if (tryGigs(b, GIG_IDS)) return;
	}

	// 5. 娱乐和社交
	if (s.needs.social < 40) {
		const npc = npcsAt(s, WA).find((n) => !n.blocked.chat);
		if (npc && tryAct(b, { t: 'npc', npc: npc.npc.id, act: 'chat' })) return;
		if (s.cash > 150 && act(b, 'pub')) return;
	}
	if (s.needs.fun < 40) {
		if (!homeActionBlocked(s, 'relax') && tryAct(b, { t: 'home', op: 'relax' })) return;
		for (const f of ['swim', 'hike', 'market']) if (act(b, f)) return;
		if (s.cash > 150 && act(b, 'pub')) return;
	}
	// 背包里放点吃的
	if (!s.inventory.snack && s.cash > 100) {
		const e = shopAt(s, WA).find((x) => x.item.id === 'snack' && !x.blocked);
		if (e && tryAct(b, { t: 'buy', item: 'snack' })) return;
	}

	// 6. 闲着：到处走或者打发时间
	if (plan.roam && b.rng() < 0.35) {
		const opts = travelOptions(s, WA).filter((o) => o.available && o.mode !== 'air' && o.cost < s.cash * 0.3);
		if (opts.length) {
			const o = opts[Math.floor(b.rng() * opts.length)];
			if (tryAct(b, { t: 'travel', to: o.to, mode: o.mode })) return;
		}
	}
	if (s.job && s.loc === s.job.loc && act(b, 'rest')) return; // 有工作就在附近等开工
	for (const f of ['hike', 'swim', 'busk']) if (!isIdle(plan) && act(b, f)) return;
	act(b, 'rest'); // 兜底：一定能做，保证时间往前走
}

/** 副业与小生意的一步：办证 → 开店、补货、雇人 → 副业。做了一件事返回 true */
function stepBiz(b: Bot): boolean {
	const s = b.s;
	const plan = b.plan;
	const shopPlan = plan.shop;
	const want = [...(plan.side?.licenses ?? []), ...(shopPlan ? ['abn', 'bizname', ...(getShopType(shopPlan.type)!.food ? [`food-${getShopSite(shopPlan.site)!.state}`] : [])] : [])];
	const readyForShop = !shopPlan || s.biz.shop || s.cash >= shopPlan.openAt;
	for (const id of want) if (readyForShop && !licenseValid(s, id) && s.cash > 400 && tryAct(b, { t: 'biz', op: 'license', id })) return true;
	if (shopPlan) {
		const site = getShopSite(shopPlan.site)!;
		if (!s.biz.shop && s.cash >= shopPlan.openAt) {
			if (s.loc !== site.loc) return headTo(b, site.loc);
			if (shopOffersAt(s).some((o) => o.site.id === site.id && o.type.id === shopPlan.type && !o.blocked)) return tryAct(b, { t: 'biz', op: 'open', shop: shopPlan.type, site: shopPlan.site });
		}
		const shop = s.biz.shop;
		if (shop && s.loc === site.loc) {
			const can = shopActions(s);
			const type = getShopType(shop.type)!;
			if (shop.stock < shopPlan.restockBelow && !can.restock && s.cash > 300) {
				const qty = Math.min(type.maxStock - shop.stock, Math.floor((s.cash - 300) / type.unitCost), 1000);
				if (qty >= 1 && tryAct(b, { t: 'biz', op: 'restock', qty })) return true;
			}
			if (shop.staff < shopPlan.staff && !can.hire && tryAct(b, { t: 'biz', op: 'hire' })) return true;
			// 不雇人的店：上班之外的空当自己看店（精力够、没有正式班要上时）
			if (shopPlan.staff === 0 && !can.tend && s.needs.energy >= 45 && s.needs.hunger >= 40 && tryAct(b, { t: 'biz', op: 'tend' })) return true;
		}
	}
	if (plan.side && s.needs.energy >= 45 && s.needs.hunger >= 45) {
		for (const id of plan.side.gigs) {
			const g = gigsAt(s, WA).find((o) => o.gig.id === id);
			if (g && !g.blocked && tryAct(b, { t: 'biz', op: 'gig', id })) return true;
		}
	}
	return false;
}

function runBot(plan: Plan, seed: number): Bot {
	const s = createCharacter({ id: `sim-${plan.id}-${seed}`, name: plan.id, avatar: '🧑', origin: plan.origin, traits: plan.traits, region: WA.id, spawn: WA.spawn, seed });
	const b: Bot = {
		s, plan, rng: mulberry(seed * 7919),
		stats: { collapses: 0, evictions: 0, promotions: 0, events: 0, moodSum: 0, moodN: 0, shifts: 0, daysBroke: 0, cashByDay: [s.cash], flow: {}, promoDays: [], diag: blankDiagnostics(), coops: 0, coopOk: 0, coopKinds: {}, biz: { gigs: {}, bankrupt: 0, shopNet: 0 } },
	};
	const end = s.clock + DAYS * 1440;
	let lastDay = dayOf(s.clock);
	let i = 0;
	for (; i < 50000 && b.s.clock < end; i++) {
		const before = b.s.clock;
		step(b);
		if (b.s.clock === before && !getPendingEvent(b.s)) act(b, 'rest'); // 防止原地打转
		b.stats.moodSum += mood(b.s);
		b.stats.moodN++;
		const d = dayOf(b.s.clock);
		while (lastDay < d) {
			lastDay++;
			b.stats.cashByDay.push(b.s.cash);
			if (b.s.cash < 20) b.stats.daysBroke++;
		}
	}
	// 每个机器人都必须跑满目标天数：卡住的运行会让汇总失真（缺的天按最后一个样本补、分母却按满天数算）
	if (b.s.clock < end) throw new Error(`机器人没跑满 ${DAYS} 天：${plan.id} 种子 ${seed} 停在第 ${dayOf(b.s.clock)} 天（${i} 步）`);
	return b;
}

// ---------- 汇总 ----------
const pct = (xs: number[], p: number) => {
	const v = [...xs].sort((a, b) => a - b);
	return v[Math.min(v.length - 1, Math.floor(p * v.length))];
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const lines: string[] = [];
const out = (l = '') => lines.push(l);
out(`# 数值平衡模拟报告`);
out();
out(`${DAYS} 个游戏日 × 每种策略 ${RUNS} 个随机种子。由 \`npm run earth:sim\` 生成。`);
out();
out('| 策略 | 第 7 天现金（中位） | 第 30 天 | 第 60 天 | 第 60 天 10%–90% | 日均净收入 | 期末净资产 | 买房（中位天数） | 平均心情 | 晕倒/人 | 被收房或断供/人 | 升职/人 | 第 1 / 2 次升职（中位天数） | 破产天数占比 |');
out('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const flows: string[] = [];
const skillRows: [string, number[]][] = [];
const gigDiagRows: string[] = [];
const collapseDiagRows: string[] = [];
const coopRows: string[] = [];
const bizRows: string[] = [];
const summary: Record<string, { netPerDay: number; collapses: number; evictions: number; promotions: number; brokeShare: number; mood: number; end: number }> = {};
for (const plan of BY_ORIGIN ? ORIGIN_PLANS : PLANS) {
	const bots = Array.from({ length: RUNS }, (_, i) => runBot(plan, i + 1));
	const at = (d: number) => bots.map((b) => b.stats.cashByDay[Math.min(d, b.stats.cashByDay.length - 1)]);
	const endD = Math.min(DAYS, 60);
	const net = avg(bots.map((b) => (b.stats.cashByDay[b.stats.cashByDay.length - 1] - b.stats.cashByDay[0]) / DAYS));
	const m = avg(bots.map((b) => b.stats.moodSum / b.stats.moodN));
	const coll = avg(bots.map((b) => b.stats.collapses));
	const ev = avg(bots.map((b) => b.stats.evictions));
	const pr = avg(bots.map((b) => b.stats.promotions));
	const broke = avg(bots.map((b) => b.stats.daysBroke / DAYS));
	const nth = (k: number) => bots.map((b) => b.stats.promoDays[k]).filter((d) => d !== undefined);
	const promoCol = [0, 1].map((k) => (nth(k).length ? `第 ${pct(nth(k), 0.5)} 天` : '—')).join(' / ');
	summary[plan.id] = { netPerDay: net, collapses: coll, evictions: ev, promotions: pr, brokeShare: broke, mood: m, end: pct(at(endD), 0.5) };
	skillRows.push([plan.name, (['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const).map((k) => Math.round(pct(bots.map((b) => b.s.skills[k]), 0.5)))]);
	const flow: Record<string, number> = {};
	for (const b of bots) for (const [k, v] of Object.entries(b.stats.flow)) flow[k] = (flow[k] ?? 0) + v / RUNS / DAYS;
	const top = Object.entries(flow).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => y[1] - x[1]);
	flows.push(`| ${plan.name} | ${top.filter(([, v]) => v > 0).map(([k, v]) => `${k} +${Math.round(v)}`).join('，') || '—'} | ${top.filter(([, v]) => v < 0).reverse().map(([k, v]) => `${k} ${Math.round(v)}`).join('，') || '—'} |`);
	if (plan.side || plan.shop) {
		const gigText = Object.entries(bots.reduce((acc, b) => { for (const [k, v] of Object.entries(b.stats.biz.gigs)) acc[k] = (acc[k] ?? 0) + v / RUNS; return acc; }, {} as Record<string, number>)).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('，') || '—';
		const opened = bots.map((b) => b.stats.biz.openDay).filter((d): d is number => d !== undefined);
		const stillOpen = bots.filter((b) => b.s.biz.shop).length;
		bizRows.push(`| ${plan.name} | ${gigText} | ${plan.shop ? `${opened.length}/${RUNS}${opened.length ? `，第 ${pct(opened, 0.5)} 天` : ''}` : '—'} | ${plan.shop ? `${stillOpen}/${RUNS}` : '—'} | ${plan.shop ? avg(bots.map((b) => b.stats.biz.bankrupt)).toFixed(2) : '—'} | ${plan.shop ? money(avg(bots.map((b) => b.stats.biz.shopNet / DAYS))) : '—'} | ${bots.filter((b) => b.s.biz.gst).length}/${RUNS} | ${money(pct(bots.map((b) => b.s.biz.book.gross), 0.5))} |`);
	}
	if (plan.coop) {
		const n = avg(bots.map((b) => b.stats.coops));
		const ok = bots.reduce((x, b) => x + b.stats.coopOk, 0) / Math.max(1, bots.reduce((x, b) => x + b.stats.coops, 0));
		const kinds: Record<string, number> = {};
		for (const b of bots) for (const [k, v] of Object.entries(b.stats.coopKinds)) kinds[k] = (kinds[k] ?? 0) + v / RUNS;
		const kindText = Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('，') || '—';
		coopRows.push(`| ${plan.name} | ${n.toFixed(1)} | ${(ok * 100).toFixed(0)}% | ${money(flow.coop ?? 0)} | ${kindText} |`);
	}
	if (plan.id === 'drifter' || plan.gig) {
		const perDay = RUNS * DAYS;
		const started = bots.reduce((n, b) => n + b.stats.diag.gigStarted, 0);
		const completed = bots.reduce((n, b) => n + b.stats.diag.gigCompleted, 0);
		const income = bots.reduce((n, b) => n + b.stats.diag.gigIncome, 0);
		const gigCollapsed = bots.reduce((n, b) => n + b.stats.diag.gigCollapsed, 0);
		const missLabels: Record<GigMiss, string> = { location: '地点', hours: '时段', energy: '精力', needs: '生存优先', weather: '天气', requirements: '门槛' };
		const miss = (Object.keys(missLabels) as GigMiss[]).map((k) => {
			const n = bots.reduce((sum, b) => sum + b.stats.diag.gigMisses[k], 0) / perDay;
			return `${missLabels[k]} ${n.toFixed(2)}`;
		}).join('，');
		gigDiagRows.push(`| ${plan.name} | ${(started / perDay).toFixed(2)} | ${(completed / perDay).toFixed(2)} | ${started ? money(income / started) : '—'} | ${(gigCollapsed / RUNS).toFixed(2)} | ${miss} |`);

		const causes = (Object.keys(bots[0].stats.diag.collapseCauses) as CollapseCause[]).map((k) => bots.reduce((sum, b) => sum + b.stats.diag.collapseCauses[k], 0) / RUNS);
		const before = bots.flatMap((b) => b.stats.diag.collapseBefore);
		const beforeText = before.length ? [
			pct(before.map((x) => x.health), 0.5),
			pct(before.map((x) => x.hunger), 0.5),
			pct(before.map((x) => x.energy), 0.5),
		].map((x) => Math.round(x)).join(' / ') : '—';
		const actions: Record<string, number> = {};
		for (const b of bots) for (const [k, v] of Object.entries(b.stats.diag.collapseActions)) actions[k] = (actions[k] ?? 0) + v;
		const common = Object.entries(actions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(v / RUNS).toFixed(2)}`).join('，') || '—';
		const travel = bots.reduce((n, b) => n + b.stats.diag.collapseTravel, 0) / RUNS;
		collapseDiagRows.push(`| ${plan.name} | ${beforeText} | 饱食 ${causes[0].toFixed(2)}，精力 ${causes[1].toFixed(2)}，同时 ${causes[2].toFixed(2)}，其他 ${causes[3].toFixed(2)} | ${travel.toFixed(2)} | ${common} |`);
	}
	out(`| ${plan.name} | ${money(pct(at(7), 0.5))} | ${money(pct(at(30), 0.5))} | ${money(pct(at(endD), 0.5))} | ${money(pct(at(endD), 0.1))}–${money(pct(at(endD), 0.9))} | ${money(net)} | ${money(pct(bots.map((b) => netWorth(b.s)), 0.5))} | ${(() => { const d = bots.map((b) => b.stats.homeDay).filter((x): x is number => x !== undefined); return d.length > bots.length / 2 ? `第 ${pct(d, 0.5)} 天` : '—'; })()} | ${m.toFixed(0)} | ${coll.toFixed(2)} | ${ev.toFixed(2)} | ${pr.toFixed(2)} | ${promoCol} | ${(broke * 100).toFixed(0)}% |`);
}
out();
out('## 第 ' + DAYS + ' 天的能力值（中位）');
out();
out('| 策略 | ' + ['体能', '力量', '驾驶', '游泳', '魅力', '生存', '街头'].join(' | ') + ' |');
out('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, sk] of skillRows) out(`| ${name} | ${sk.join(' | ')} |`);
out();
out('## 每天的钱从哪来、花到哪去（每人每天平均，美元）');
out();
out('| 策略 | 收入 | 支出（从大到小） |');
out('| --- | --- | --- |');
for (const f of flows) out(f);
out();
out('## 背包客生存诊断');
out();
out('保守策略留在珀斯，现金低于 $700 才找零工；饱食低于 50 或精力低于 55 时先恢复，$200 以下不做可选消费。');
out();
out('| 策略 | 零工开工/人日 | 完成/人日 | 实收/次开工 | 零工途中晕倒/人 | 未开工原因（次/人日） |');
out('| --- | --- | --- | --- | --- | --- |');
for (const row of gigDiagRows) out(row);
out();
out('| 策略 | 晕倒前健康 / 饱食 / 精力（中位） | 回算的见底原因（次/人） | 出行途中晕倒/人 | 常见触发动作（次/人） |');
out('| --- | --- | --- | --- | --- |');
for (const row of collapseDiagRows) out(row);
out();
out('## 共同事件（第 46 轮）');
out();
out('机器人保命、上班之后，需求不太低时，所在地点有能做的共同事件就做一件。搭档是每次新建的同出身角色（开局能力），需求和在场率按各行的假设；开始前对双方都检查能不能参加。只统计机器人自己。理想搭档那一行是上限，不是保守估计。');
out();
out('| 策略 | 参加次数/人 | 成功率 | 每人每天净现金 | 各种类次数/人 |');
out('| --- | --- | --- | --- | --- |');
for (const row of coopRows) out(row);
out();
if (bizRows.length) {
	out('## 副业与小生意');
	out();
	out('副业策略在精力、饱食都不低于 45 时按顺序做第一份能做的副业；开店策略攒到开店线后办齐证照、开店、补货、雇人（或自己看店）。店铺结算净额（租金、工资、销售、事件）单独记在「每天的钱」表的 shop-days 里，不算进触发结算的动作。');
	out();
	out('| 策略 | 副业次数/人 | 开店人数，开店日（中位） | 期末还开着 | 倒闭/人 | 店铺日均净额 | 登记 GST | 期末本年营业额（中位） |');
	out('| --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const row of bizRows) out(row);
	out();
}
out('诊断口径：零工“完成”不含途中晕倒且拿不到工资的动作；未开工只统计现金已低于各策略触发线、但因生存门槛或当前地点/时段无法开工的决策。晕倒原因按动作开始状态和该动作耗时回算；“其他”包括事件受伤。当前四种零工都不受天气关闭，因此天气项应为 0。');
out();
out('说明：日均净收入 = (期末现金 − 开局现金) / 天数；破产天数 = 当天结束时现金低于 $20 的天数。');

const text = lines.join('\n') + '\n';
process.stdout.write(text);
if (OUT) {
	writeFileSync(OUT, text);
	console.error(`已写入 ${OUT}`);
}
export { summary };
