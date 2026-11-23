#!/usr/bin/env node
// 数值平衡模拟：几类机器人玩家按固定策略自动玩 N 个游戏日，统计经济与生存指标。
// 走的是服务端同一个入口 applyAction()，结果与真实玩家一致。
//
//   npm run earth:sim                 默认 60 天 × 每种策略 40 个种子
//   npm run earth:sim -- --days=120 --runs=100
//   npm run earth:sim -- --out=docs/earth-game/balance-report.md
//   npm run earth:sim -- --origins     出身对照：每个出身跑同样三种策略（零工 / 咖啡店 / 不干活），都不带特质
//
// 平衡调试工具（docs/earth-game/balance-tools.md）。不加下面这些参数时，输出和加之前逐字一致：
//   --eco                   报告末尾加「经济流水：投放与回收」表
//   --off=events,coop       关掉这些系统再跑（只改机器人行为，见 systems.ts；--list-systems 列出全部）
//   --ab=events             同样的种子跑两遍：全开 vs 关掉，输出对比（ab.ts）
//   --format=json|csv       导出结构化结果（默认 md）；配合 --out 写文件
//   --only=barista,idle     只跑这些策略
import { writeFileSync } from 'node:fs';
import { averageEco, blankEco, parseSystems, recordEco, SYSTEMS, systemOf, type EcoStats } from './systems.ts';
import { ecoMarkdown, toCsv, toJson, type PlanResult, type SimResult } from './report.ts';
import { applyAction, applyCoop, type GameAction } from '../../../src/game/core/actions.ts';
import { coopBlocked, coopsAt } from '../../../src/game/core/coop.ts';
import { decayMult, mood } from '../../../src/game/core/attributes.ts';
import { createCharacter, ORIGINS } from '../../../src/game/core/character.ts';
import {
	activitiesAt, careAt, careersAt, coursesAt, dealerAt, DECAY, netWorth, propertiesAt, furnitureAt, homeActionBlocked, experiencesAt, getCareer, getPendingEvent, homesAt, npcsAt, shiftBlocked, shopAt, travelOptions,
} from '../../../src/game/core/engine.ts';
import { dayOf, hourOf } from '../../../src/game/core/time.ts';
import { cookBlocked, groceriesAt, hostBlocked, kitchenLevel, pantryTotal, recipeKnown } from '../../../src/game/core/cooking.ts';
import { RECIPES } from '../../../src/game/data/cooking.ts';
import { weatherAt } from '../../../src/game/core/weather.ts';
import { currentIllness } from '../../../src/game/core/health.ts';
import { SKILL_KEYS } from '../../../src/game/core/types.ts';
import { careerSummary, earnedOf, spentOf } from '../../../src/game/core/tally.ts';
import type { PlayerState } from '../../../src/game/core/types.ts';
import { WA } from '../../../src/game/data/wa.ts';
import { clubSessionBlocked, formOf, getClub, racesSoon } from '../../../src/game/core/sports.ts';
import { lbEntry, type LbEntry, type LbStatKey } from '../../../src/game/core/leaderboard.ts';
import { LB_ANOMALY } from '../../../src/game/data/leaderboard.ts';
import { canWork, ieltsAt, visaKindNow, visaOptions } from '../../../src/game/core/immigration.ts';
import { VISA_RULES } from '../../../src/game/data/visas.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const DAYS = Number(arg('days', '60'));
const RUNS = Number(arg('runs', '40'));
const OUT = arg('out', '');
const BY_ORIGIN = process.argv.includes('--origins');
// 平衡调试工具的参数（见文件头）
const FORMAT = arg('format', 'md');
const ONLY = arg('only', '').split(',').filter(Boolean);
if (process.argv.includes('--list-systems')) {
	for (const x of SYSTEMS) console.log(`${x.id.padEnd(11)} ${x.name}：${x.how}`);
	process.exit(0);
}
if (process.argv.some((a) => a.startsWith('--ab='))) {
	// A/B 要两次独立的模拟：交给 ab.ts 起两个子进程，本进程不跑
	await import('./ab.ts');
	process.exit(0);
}
let OFF: Set<string>;
try {
	OFF = new Set(parseSystems(arg('off', '')));
} catch (e) {
	console.error((e as Error).message);
	process.exit(2);
}
if (!Number.isInteger(DAYS) || DAYS < 1 || !Number.isInteger(RUNS) || RUNS < 1 || !['md', 'json', 'csv'].includes(FORMAT)) {
	console.error('--days、--runs 要是正整数，--format 只能是 md、json、csv');
	process.exit(2);
}
/** 每个机器人的现金流水和被拦下的次数（不放进 Bot.stats：少改别的分支也在改的地方） */
const ECO = new WeakMap<object, EcoStats>();
const ecoOf = (b: object) => ECO.get(b) ?? (ECO.set(b, blankEco()), ECO.get(b)!);

// ---------- 机器人 ----------
interface Bot {
	s: PlayerState;
	rng: () => number;
	plan: Plan;
	/** 理财机器人最近一次买入的游戏日 */
	investDay?: number;
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
		/** 健康系统第 1 版：生病次数、生病的天数、就医花的钱 */
		ill: number;
		sickMin: number;
		/** 第 46 轮：参加共同事件的次数、成功次数、按种类计数 */
		coops: number;
		coopOk: number;
		coopKinds: Record<string, number>;
		/** 第 43 批：签证过期（不能工作）的天数、拿到 PR 的游戏日、考雅思次数 */
		visaExpiredDays: number;
		prDay?: number;
		ielts: number;
	};
	/** 排行榜（排行榜第一版）：每个成功动作后按服务端同一个函数算榜单记录，看异常值复核线会不会误伤正常玩法 */
	lb: { e: LbEntry; now: number; max: Record<LbStatKey, number>; holds: number; why: string[] };
}

/** 模拟里的现实时间：每个成功动作算 10 秒（一小时 360 个动作，比真人快），只用于净资产一小时涨幅检查 */
const LB_SIM_STEP_MS = 10_000;
const LB_KEYS: LbStatKey[] = ['worth', 'respect', 'dex', 'places'];
function trackLb(b: Bot) {
	const prev = b.lb.e;
	b.lb.now += LB_SIM_STEP_MS;
	const e = lbEntry(b.s, b.lb.now, prev, { places: WA.pois.length });
	for (const k of LB_KEYS) b.lb.max[k] = Math.max(b.lb.max[k], e.stats[k] - prev.stats[k]);
	if (e.hold && e.hold.at === b.lb.now) {
		b.lb.holds++;
		if (b.lb.why.length < 3) b.lb.why.push(e.hold.why);
	}
	b.lb.e = e;
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
	/** 第 43 批：练哪项运动、加入哪个俱乐部；保命、上班之后报名参赛、上训练课、自己练（见 trySport） */
	sport?: { sport: 'run'; club: string };
	/**
	 * 第 25 批（经济设计）：理财。现金超过 keep 时把多出来的买成 asset（每个游戏日最多一次），不买房；
	 * 现金低于 $300 时卖出 $500 应急。
	 */
	invest?: { asset: string; keep: number };
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
	// 第 43 批（运动和比赛）：咖啡店上班族 + 跑团 + 周六公园 5 公里和城市长跑。只多一行，不改上面的策略
	{ id: 'barista-runner', name: '咖啡店 + 跑团 + 比赛（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', sport: { sport: 'run', club: 'swan-river-runners' } },
	{ id: 'barista-savings', name: '咖啡店 + 理财：高息储蓄（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'savings', keep: 3000 } },
	{ id: 'barista-index', name: '咖啡店 + 理财：澳股指数基金（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'asx-index', keep: 3000 } },
	{ id: 'barista-coin', name: '咖啡店 + 理财：鸸鹋币（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'emu-coin', keep: 3000 } },
	{ id: 'barista-coop-sparse', name: '咖啡店 + 共同事件：疲惫搭档，一半时候没人（需求 40、在场 50%）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 40, mateChance: 0.5 } },
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
	return a.t === 'activity' ? a.id
		: a.t === 'job' || a.t === 'home' || a.t === 'furniture' || a.t === 'property' || a.t === 'asset' ? `${a.t}-${a.op}`
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
	const sys = OFF.size ? systemOf(a) : undefined;
	if (sys && OFF.has(sys)) return (ecoOf(b).blocked[sys] = (ecoOf(b).blocked[sys] ?? 0) + 1), false;
	const before = b.s;
	const r = applyAction(b.s, WA, a);
	if (!r.ok) {
		b.s = r.state;
		return false;
	}
	b.s = r.state;
	trackLb(b);
	const key = actionKey(a);
	b.stats.flow[key] = (b.stats.flow[key] ?? 0) + (b.s.cash - before.cash);
	recordEco(ecoOf(b), a.t, key, b.s.cash - before.cash);
	if (OFF.has('events') && b.s.pending) {
		// 事件系统关掉：这次动作抽中的事件直接丢掉，不结算选项
		b.s = { ...b.s, pending: null };
		ecoOf(b).blocked.events = (ecoOf(b).blocked.events ?? 0) + 1;
	}
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
		if (/你病了|中了暑气|扭伤了/.test(j.text)) b.stats.ill++;
		if (j.text.includes('收回') || j.text.includes('强制卖出')) b.stats.evictions++;
	}
	if (b.s.job && before.job && b.s.job.career === before.job.career && b.s.job.level > before.job.level) {
		b.stats.promotions++;
		b.stats.promoDays.push(dayOf(b.s.clock) + 1);
	}
	if (a.t === 'job' && a.op === 'work') b.stats.shifts++;
	return true;
}

/**
 * 健康系统第 1 版：有病就在所在地点就医（不为看病专门出行）。
 * 重症先急诊；开了处方就去药房取药；其余先 GP 再药房。付不起或这里没有就跳过。
 */
function careStep(b: Bot): boolean {
	const cur = currentIllness(b.s);
	if (!cur) return false;
	const here = careAt(b.s, WA).filter((x) => !x.blocked);
	const has = (k: string) => here.some((x) => x.care.id === k);
	const order = cur.def.severity >= 3 ? ['ed', 'gp', 'pharmacy'] : cur.ill.rx ? ['pharmacy', 'gp'] : ['gp', 'pharmacy'];
	for (const k of order) if (has(k) && !cur.ill.care.includes(k) && tryAct(b, { t: 'care', kind: k as 'gp' | 'pharmacy' | 'ed' })) return true;
	return cur.ill.rx && !cur.ill.care.includes('rx') && has('pharmacy') && tryAct(b, { t: 'care', kind: 'pharmacy' });
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
	if (OFF.has('coop')) return false;
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
	recordEco(ecoOf(b), 'coop', 'coop', me.state.cash - s.cash);
	b.stats.coops++;
	if (r.success) b.stats.coopOk++;
	b.stats.coopKinds[open.def.id] = (b.stats.coopKinds[open.def.id] ?? 0) + 1;
	b.s = me.state;
	trackLb(b);
	return true;
}

/** 做饭分支：食材柜里够做哪道菜就做，饱食最高的优先 */
function cookFromPantry(b: Bot): boolean {
	const dish = RECIPES.filter((r) => r.cuisine !== 'basic' && !cookBlocked(b.s, r.id)).sort((x, y) => y.hunger - x.hunger)[0];
	return !!dish && tryAct(b, { t: 'home', op: 'cook', recipe: dish.id });
}

/** 做饭分支：在住处所在地、有厨房、食材快用完、手头宽裕时，挑一道这里买得齐的、做得最少的菜，买两顿的量 */
function shopForDish(b: Bot): boolean {
	const s = b.s;
	if (!s.home || s.loc !== s.home.loc || kitchenLevel(s) < 1 || pantryTotal(s) >= 4 || s.cash < 300) return false;
	const offers = groceriesAt(s, WA);
	const ok = (id: string) => offers.some((o) => o.item.id === id && !o.blocked);
	const dish = RECIPES.filter((r) => r.cuisine !== 'basic' && recipeKnown(s, r) && r.kitchen <= kitchenLevel(s) && Object.keys(r.ingredients).every(ok))
		.sort((x, y) => (s.cooking.made[x.id] ?? 0) - (s.cooking.made[y.id] ?? 0))[0];
	if (!dish) return false;
	let bought = false;
	for (const [id, n] of Object.entries(dish.ingredients)) bought = tryAct(b, { t: 'grocery', id, n: n * 2 }) || bought;
	return bought;
}

/** 一步决策：先保命，再上班，再满足需求，最后按策略消磨时间 */
/**
 * 第 43 批的签证策略（简单、贪心）：能批的路线按 PR > 491 > 482 > 第二次 485 > 485 的顺序申请（过期了才续读学生签）；
 * 毕业生签证只差雅思时在城市里考雅思，钱留够申请费 + $300。
 */
const VISA_ORDER = ['ens', 'skilled', 'state', 'regionalPr', 'regional', 'sponsored', 'graduate2', 'graduate', 'student'];
function stepVisa(b: Bot): boolean {
	const s = b.s;
	const now = visaKindNow(s);
	if (now === 'none' || now === 'pr') return false;
	const opts = visaOptions(s, WA);
	for (const id of VISA_ORDER) {
		if (id === 'student' && now !== 'expired') continue;
		if (id === 'graduate2' && (s.visa.until - dayOf(s.clock)) > 20) continue; // 第一次 485 快到期才续
		const o = opts.find((x) => x.route.id === id && !x.blocked);
		if (o && tryAct(b, { t: 'visa', op: 'apply', route: id })) return true;
	}
	const grad = opts.find((x) => x.route.id === 'graduate');
	const wantIelts = s.visa.ielts < VISA_RULES.graduate.minIelts && (grad?.blocked?.includes('雅思') || (s.visa.course && s.visa.course.end - dayOf(s.clock) < 30));
	const t = wantIelts ? ieltsAt(s, WA) : null;
	if (t && !t.blocked && s.cash > t.fee + 1300 + 300 && s.needs.energy > 40 && tryAct(b, { t: 'visa', op: 'ielts' })) {
		b.stats.ielts++;
		return true;
	}
	return false;
}

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
	if (careStep(b)) return;
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
		if (cookFromPantry(b)) return;
		if (!homeActionBlocked(s, 'cook', WA) && tryAct(b, { t: 'home', op: 'cook' })) return;
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

	// 1.5 签证（第 43 批）：只有留学生出身走签证路线
	if (!isIdle(plan) && stepVisa(b)) return;
	// 1.5 运动策略（第 43 批）：比赛日先比赛再上班（周六公园 5 公里在早上 7–9 点，和早班撞）
	if (plan.sport && s.needs.hunger >= 35) {
		const today = racesSoon(s, WA, 0).find((o) => o.race.sport === plan.sport!.sport && !o.raceBlocked);
		if (today && tryAct(b, { t: 'sport', op: 'race', id: today.race.id })) return;
	}

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
		} else if (dayOf(s.clock) % 7 !== 6 && !shiftBlocked(s, WA) && tryAct(b, { t: 'job', op: 'work' })) return; // 每周休一天
	}
	if (plan.home && !s.home && s.cash > 400) {
		const want = plan.job?.loc ?? WA.spawn;
		if (s.loc === want && homesAt(s, WA).some((o) => o.home.id === plan.home && !o.blocked) && tryAct(b, { t: 'home', op: 'rent', home: plan.home })) return;
	}

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
		// 理财（第 25 批）：现金多出 keep 的部分每天最多买一次；缺钱时卖出应急。理财机器人不买房
		if (plan.invest) {
			const day = dayOf(s.clock);
			if (s.cash < 300 && (s.holdings[plan.invest.asset]?.units ?? 0) > 0 && tryAct(b, { t: 'asset', op: 'sell', id: plan.invest.asset, amount: 500 })) return;
			if (s.cash > plan.invest.keep + 500 && b.investDay !== day && tryAct(b, { t: 'asset', op: 'buy', id: plan.invest.asset, amount: s.cash - plan.invest.keep })) {
				b.investDay = day;
				return;
			}
		}
		// 买房：首付之外还留 $3,000 周转；买了就搬进去
		const house = propertiesAt(s, WA).find((o) => !o.owned && s.cash >= o.down + 3000);
		if (house && !plan.invest && s.properties.length === 0 && tryAct(b, { t: 'property', op: 'buy', id: house.property.id, loan: s.cash < house.property.price + 3000 })) {
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
	// 3.6 运动（第 43 批）：同样排在保命、上班、租房之后
	if (plan.sport && s.needs.hunger >= 35 && trySport(b)) return;

	// 4. 没有正式工作的人靠零工
	if (!s.job && !isIdle(plan) && s.cash < 400) {
		if (tryGigs(b, GIG_IDS)) return;
	}

	// 4.5 做饭分支：住处所在地补食材
	if (plan.spend !== false && !isIdle(plan) && shopForDish(b)) return;

	// 5. 娱乐和社交
	if (s.needs.social < 40) {
		// 做饭分支：在家、食材够一桌，就请客
		const feast = RECIPES.find((r) => r.cuisine !== 'basic' && !hostBlocked(s, r.id));
		if (feast && tryAct(b, { t: 'home', op: 'host', recipe: feast.id })) return;
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

/**
 * 运动（第 43 批）：今天有能跑的比赛就跑；能报名的报名（报完手上还剩 $300）；在俱乐部所在地、会员到期就续费（同样留 $300）；
 * 能上训练课就上；准备度不到 60、今天还没练过就自己跑一次。都不做返回 false。
 */
function trySport(b: Bot): boolean {
	const s = b.s;
	const sp = b.plan.sport!;
	for (const o of racesSoon(s, WA)) {
		if (o.race.sport !== sp.sport) continue;
		if (o.startsIn === 0 && !o.raceBlocked && tryAct(b, { t: 'sport', op: 'race', id: o.race.id })) return true;
		if (o.race.fee > 0 && !o.enterBlocked && s.cash - o.fee >= 300 && tryAct(b, { t: 'sport', op: 'enter', id: o.race.id })) return true;
	}
	const club = getClub(sp.club)!;
	const c = s.sport.club;
	if (s.loc === club.loc && (!c || c.id !== club.id || c.until <= dayOf(s.clock)) && s.cash - club.fee >= 300 && tryAct(b, { t: 'sport', op: 'join', id: club.id })) return true;
	if (!clubSessionBlocked(s, WA) && tryAct(b, { t: 'sport', op: 'club' })) return true;
	const f = s.sport.form[sp.sport];
	if (formOf(s, sp.sport) < 60 && f?.d !== dayOf(s.clock) && s.needs.energy >= 45 && act(b, 'jog')) return true;
	return false;
}

function runBot(plan: Plan, seed: number): Bot {
	const s = createCharacter({ id: `sim-${plan.id}-${seed}`, name: plan.id, avatar: '🧑', origin: plan.origin, traits: plan.traits, region: WA.id, spawn: WA.spawn, seed });
	const b: Bot = {
		s, plan, rng: mulberry(seed * 7919),
		stats: { collapses: 0, evictions: 0, promotions: 0, events: 0, moodSum: 0, moodN: 0, shifts: 0, daysBroke: 0, cashByDay: [s.cash], flow: {}, promoDays: [], diag: blankDiagnostics(), ill: 0, sickMin: 0, coops: 0, coopOk: 0, coopKinds: {}, visaExpiredDays: 0, ielts: 0 },
		lb: { e: lbEntry(s, 0), now: 0, max: { worth: 0, respect: 0, dex: 0, places: 0 }, holds: 0, why: [] },
	};
	const end = s.clock + DAYS * 1440;
	let lastDay = dayOf(s.clock);
	let i = 0;
	for (; i < 50000 && b.s.clock < end; i++) {
		const before = b.s.clock;
		const sickAt = currentIllness(b.s) ? b.s.illness!.until : 0;
		step(b);
		if (sickAt) b.stats.sickMin += Math.max(0, Math.min(b.s.clock, sickAt) - before);
		if (b.s.clock === before && !getPendingEvent(b.s)) act(b, 'rest'); // 防止原地打转
		b.stats.moodSum += mood(b.s);
		b.stats.moodN++;
		const d = dayOf(b.s.clock);
		while (lastDay < d) {
			lastDay++;
			b.stats.cashByDay.push(b.s.cash);
			if (b.s.cash < 20) b.stats.daysBroke++;
			if (!canWork(b.s)) b.stats.visaExpiredDays++;
			if (b.stats.prDay === undefined && b.s.visa.kind === 'pr') b.stats.prDay = lastDay;
		}
	}
	// 每个机器人都必须跑满目标天数：卡住的运行会让汇总失真（缺的天按最后一个样本补、分母却按满天数算）
	if (b.s.clock < end) throw new Error(`机器人没跑满 ${DAYS} 天：${plan.id} 种子 ${seed} 停在第 ${dayOf(b.s.clock)} 天（${i} 步）`);
	return b;
}

// ---------- 汇总 ----------
if (ONLY.length) for (const list of [PLANS, ORIGIN_PLANS]) list.splice(0, list.length, ...list.filter((p) => ONLY.includes(p.id)));
const results: PlanResult[] = [];
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
const sportRows: string[] = [];
const careerRows: string[] = [];
const healthRows: string[] = [];
const lbRows: string[] = [];
const visaRows: string[] = [];
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
	// 生涯统计（career-stats.md）：玩家在「我 · 生涯」看到的累计数；对账 = 收入 − 支出 与现金变化的最大差额，应为 0
	{
		const cs = bots.map((b) => careerSummary(b.s));
		const outs: Record<string, number> = {};
		for (const c of cs) for (const o of c.outs) outs[o.label] = (outs[o.label] ?? 0) + o.amt / RUNS;
		const topOut = Object.entries(outs).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${money(v)}`).join('，') || '—';
		const gap = Math.max(...bots.map((b) => Math.abs(earnedOf(b.s.tally) - spentOf(b.s.tally) - (Math.round(b.s.cash) - Math.round(b.stats.cashByDay[0])))));
		careerRows.push(`| ${plan.name} | ${Math.round(avg(cs.map((c) => c.km)))} | ${avg(cs.map((c) => c.places)).toFixed(1)} | ${money(avg(cs.map((c) => c.earned)))} | ${money(avg(cs.map((c) => c.spent)))} | ${topOut} | ${avg(cs.map((c) => c.timeline.length)).toFixed(1)} | ${money(gap)} |`);
	}
	healthRows.push(`| ${plan.name} | ${avg(bots.map((b) => b.stats.ill)).toFixed(2)} | ${avg(bots.map((b) => b.stats.sickMin / 1440)).toFixed(1)} | ${money(-(flow.care ?? 0) * DAYS)} |`);
	if (plan.coop) {
		const n = avg(bots.map((b) => b.stats.coops));
		const ok = bots.reduce((x, b) => x + b.stats.coopOk, 0) / Math.max(1, bots.reduce((x, b) => x + b.stats.coops, 0));
		const kinds: Record<string, number> = {};
		for (const b of bots) for (const [k, v] of Object.entries(b.stats.coopKinds)) kinds[k] = (kinds[k] ?? 0) + v / RUNS;
		const kindText = Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('，') || '—';
		coopRows.push(`| ${plan.name} | ${n.toFixed(1)} | ${(ok * 100).toFixed(0)}% | ${money(flow.coop ?? 0)} | ${kindText} |`);
	}
	if (plan.sport) {
		// 第 43 批：比赛次数、各档名次、期末准备度、训练课次数
		const res = bots.flatMap((b) => b.s.sport.results);
		const per = (m: string) => (res.filter((x) => x.medal === m).length / RUNS).toFixed(2);
		const form = pct(bots.map((b) => formOf(b.s, plan.sport!.sport)), 0.5);
		const total = avg(bots.map((b) => b.s.sport.total[plan.sport!.sport] ?? 0));
		const bigRace = res.filter((x) => x.race !== 'park-5k').length / RUNS;
		sportRows.push(`| ${plan.name} | ${(res.length / RUNS).toFixed(1)} | ${bigRace.toFixed(2)} | ${per('gold')} / ${per('silver')} / ${per('bronze')} / ${per('finish')} / ${per('dnf')} | ${total.toFixed(0)} | ${Math.round(form)} |`);
	}

	if (plan.origin === 'student') {
		const kinds: Record<string, number> = {};
		for (const b of bots) kinds[b.s.visa.kind] = (kinds[b.s.visa.kind] ?? 0) + 1;
		const prs = bots.map((b) => b.stats.prDay).filter((d): d is number => d !== undefined);
		visaRows.push(`| ${plan.name} | ${Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join('，')} | ${prs.length} / ${prs.length ? `第 ${pct(prs, 0.5)} 天` : '—'} | ${avg(bots.map((b) => b.stats.visaExpiredDays)).toFixed(1)} | ${avg(bots.map((b) => b.stats.ielts)).toFixed(1)} |`);
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
	{
		const mx = (k: LbStatKey) => bots.map((b) => b.lb.max[k]);
		const flagged = bots.filter((b) => b.lb.holds > 0);
		const why = flagged.flatMap((b) => b.lb.why).slice(0, 2).join('；') || '—';
		const endMed = (k: LbStatKey) => pct(bots.map((b) => b.lb.e.stats[k]), 0.5);
		lbRows.push(`| ${plan.name} | ${money(pct(mx('worth'), 0.99))} / ${money(Math.max(...mx('worth')))} | ${pct(mx('respect'), 0.99)} / ${Math.max(...mx('respect'))} | ${pct(mx('dex'), 0.99)} / ${Math.max(...mx('dex'))} | ${(flagged.length / bots.length * 100).toFixed(0)}% | ${why} | ${money(endMed('worth'))} / ${endMed('respect')} / ${endMed('dex')}‰ |`);
	}
	out(`| ${plan.name} | ${money(pct(at(7), 0.5))} | ${money(pct(at(30), 0.5))} | ${money(pct(at(endD), 0.5))} | ${money(pct(at(endD), 0.1))}–${money(pct(at(endD), 0.9))} | ${money(net)} | ${money(pct(bots.map((b) => netWorth(b.s)), 0.5))} | ${(() => { const d = bots.map((b) => b.stats.homeDay).filter((x): x is number => x !== undefined); return d.length > bots.length / 2 ? `第 ${pct(d, 0.5)} 天` : '—'; })()} | ${m.toFixed(0)} | ${coll.toFixed(2)} | ${ev.toFixed(2)} | ${pr.toFixed(2)} | ${promoCol} | ${(broke * 100).toFixed(0)}% |`);
	// 结构化结果（--format=json / csv、基线、A/B 用）：和上面这一行同一批机器人、同一套口径
	const eco = averageEco(bots.map((b) => ecoOf(b)), DAYS);
	const homeDays = bots.map((b) => b.stats.homeDay).filter((x): x is number => x !== undefined);
	results.push({
		id: plan.id, name: plan.name,
		metrics: {
			cashDay7: pct(at(7), 0.5), cashDay30: pct(at(30), 0.5), cashEnd: pct(at(endD), 0.5), cashEndP10: pct(at(endD), 0.1), cashEndP90: pct(at(endD), 0.9),
			netPerDay: net, netWorth: pct(bots.map((b) => netWorth(b.s)), 0.5), homeDay: homeDays.length > bots.length / 2 ? pct(homeDays, 0.5) : null, mood: m,
			collapses: coll, evictions: ev, promotions: pr, promo1Day: nth(0).length ? pct(nth(0), 0.5) : null, promo2Day: nth(1).length ? pct(nth(1), 0.5) : null,
			brokeShare: broke, events: avg(bots.map((b) => b.stats.events)), coops: avg(bots.map((b) => b.stats.coops)),
			ecoIn: Object.values(eco.in).reduce((x, y) => x + y, 0), ecoOut: Object.values(eco.out).reduce((x, y) => x + y, 0),
		},
		skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, pct(bots.map((b) => b.s.skills[k]), 0.5)])),
		flow, eco: { in: eco.in, out: eco.out, inDetail: eco.inDetail, outDetail: eco.outDetail }, blocked: eco.blocked,
	});
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
out(`## 生涯统计（「我 · 生涯」，每人 ${DAYS} 天累计的平均）`);
out();
out('只记账，不影响数值和随机数。对账一栏是「收入 − 支出」和现金变化的最大差额，应为 $0。');
out();
out('| 策略 | 公里 | 地点 | 收入 | 支出 | 支出大头 | 里程碑 | 对账 |');
out('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of careerRows) out(r);
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
out('## 健康与看病（健康系统第 1 版）');
out();
out('机器人有病就在所在地点就医（重症先急诊；有处方先取药；其余先 GP 再药房），不为看病专门出行。生病次数含受伤记的扭伤。数值全部待平衡，见 docs/earth-game/health.md。');
out();
out('| 策略 | 生病次数/人 | 生病天数/人 | 就医自付/人（全程） |');
out('| --- | --- | --- | --- |');
for (const row of healthRows) out(row);
out();
out('## 共同事件（第 46 轮）');
out();
out('机器人保命、上班之后，需求不太低时，所在地点有能做的共同事件就做一件。搭档是每次新建的同出身角色（开局能力），需求和在场率按各行的假设；开始前对双方都检查能不能参加。只统计机器人自己。理想搭档那一行是上限，不是保守估计。');
out();
out('| 策略 | 参加次数/人 | 成功率 | 每人每天净现金 | 各种类次数/人 |');
out('| --- | --- | --- | --- | --- |');
for (const row of coopRows) out(row);
out();
out('## 运动和比赛（第 43 批）');
out();
out('只有带运动策略的行：保命、上班之后，今天有能跑的比赛就跑，能报名的就报（报完留 $300），到期续俱乐部会费，能上训练课就上，准备度不到 60 且今天没练过就自己跑一次。数值待平衡。');
out();
out('| 策略 | 比赛场次/人 | 其中收费赛/人 | 金 / 银 / 铜 / 完赛 / 未完赛（次/人） | 跑步训练次数/人 | 期末跑步准备度（中位） |');
out('| --- | --- | --- | --- | --- | --- |');
for (const row of sportRows) out(row);
out();
out('## 排行榜（排行榜第一版）');
out();
out(`每个成功动作后用服务端同一个函数（core/leaderboard.ts 的 lbEntry）算榜单记录。看的是：正常玩法下单个动作最多能涨多少、会不会碰到异常值复核线（data/leaderboard.ts 的 LB_ANOMALY：净资产 ${money(LB_ANOMALY.worthPerRev)}/动作、${money(LB_ANOMALY.worthPerHour)}/小时，声望 ${LB_ANOMALY.respectPerRev}/动作，图鉴 ${LB_ANOMALY.dexPerRev}‰/动作，打卡 ${LB_ANOMALY.placesPerRev}/动作，均待平衡）。现实时间按每个动作 ${LB_SIM_STEP_MS / 1000} 秒算。机器人不用真实定位，打卡一列恒为 0，没有列出；比赛积分只在服务端记，这里不模拟。`);
out();
out('| 策略 | 单个动作最大涨幅：净资产（p99 / 最大） | 声望（p99 / 最大） | 图鉴‰（p99 / 最大） | 触发复核的机器人 | 触发原因（举例） | 期末净资产 / 声望 / 图鉴（中位） |');
out('| --- | --- | --- | --- | --- | --- | --- |');
for (const row of lbRows) out(row);
out();
out('## 签证路线（第 43 批，只有留学生出身）');
out();
out('机器人按 stepVisa 的贪心顺序申请（见上面的注释）。过期天数 = 当天结束时签证已过期、不能工作的天数。数值全部待平衡。');
out();
out('| 策略 | 期末签证（人数） | 拿到 PR（人 / 中位天数） | 过期天数/人 | 雅思次数/人 |');
out('| --- | --- | --- | --- | --- |');
for (const row of visaRows) out(row);
out();
out('诊断口径：零工“完成”不含途中晕倒且拿不到工资的动作；未开工只统计现金已低于各策略触发线、但因生存门槛或当前地点/时段无法开工的决策。晕倒原因按动作开始状态和该动作耗时回算；“其他”包括事件受伤。当前四种零工都不受天气关闭，因此天气项应为 0。');
out();
out('说明：日均净收入 = (期末现金 − 开局现金) / 天数；破产天数 = 当天结束时现金低于 $20 的天数。');

if (OFF.size) out(`\n**本次关掉的系统：${[...OFF].join('，')}**（只改机器人行为，见 docs/earth-game/balance-tools.md）`);
const result: SimResult = { days: DAYS, runs: RUNS, origins: BY_ORIGIN, off: [...OFF] as SimResult['off'], plans: results };
const text = FORMAT === 'json' ? toJson([result]) : FORMAT === 'csv' ? toCsv([result]) : lines.join('\n') + '\n' + (process.argv.includes('--eco') ? '\n' + ecoMarkdown(result) : '');
process.stdout.write(text);
if (OUT) {
	writeFileSync(OUT, text);
	console.error(`已写入 ${OUT}`);
}
export { summary };
