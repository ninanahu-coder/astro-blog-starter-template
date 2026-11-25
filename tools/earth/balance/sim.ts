#!/usr/bin/env node
// 数值平衡模拟：几类机器人玩家按固定策略自动玩 N 个游戏日，统计经济与生存指标。
// 走的是服务端同一个入口 applyAction()，结果与真实玩家一致。
//
//   npm run earth:sim                 默认 60 天 × 每种策略 40 个种子
//   npm run earth:sim -- --days=120 --runs=100
//   npm run earth:sim -- --game-days-per-real-day=5   一个现实日玩 5 个游戏日（看现实日上限的影响）
//   npm run earth:sim -- --out=docs/earth-game/balance-report.md
//   npm run earth:sim -- --origins     出身对照：每个出身跑同样三种策略（零工 / 咖啡店 / 不干活），都不带特质
//
// 平衡调试工具（docs/earth-game/balance-tools.md）。不加下面这些参数时，输出和加之前逐字一致：
//   --eco                   报告末尾加「经济流水：投放与回收」表
//   --off=events,coop       关掉这些系统再跑（只改机器人行为，见 systems.ts；--list-systems 列出全部）
//   --ab=events             同样的种子跑两遍：全开 vs 关掉，输出对比（ab.ts）
//   --format=json|csv       导出结构化结果（默认 md）；配合 --out 写文件
//   --only=barista,idle     只跑这些策略（NPC 诊断路线 lifeguard-jack-perk 等只能这样点名跑，见 DIAG_PLANS）
//   --seed-offset=100       种子从 101 起（默认 0，即 1…runs），用来换一批种子复核
//   npm run earth:sim -- --swap        二手市场对照：咖啡店策略 × 买家具不走 / 走换手墙看货 / 走换手墙先转账
import { writeFileSync } from 'node:fs';
import { averageEco, blankEco, parseSystems, recordEco, SYSTEMS, systemOf, type EcoStats } from './systems.ts';
import { ecoMarkdown, toCsv, toJson, type PlanResult, type SimResult } from './report.ts';
import { applyAction, applyCoop, type GameAction } from '../../../src/game/core/actions.ts';
import { coopBlocked, coopsAt } from '../../../src/game/core/coop.ts';
import { decayMult, mood } from '../../../src/game/core/attributes.ts';
import { createCharacter, ORIGINS } from '../../../src/game/core/character.ts';
import {
	activitiesAt, careAt, careersAt, coursesAt, dealerAt, DECAY, fishingAt, netWorth, propertiesAt, furnitureAt, getHome, homeActionBlocked, experiencesAt, getCareer, getPendingEvent, homesAt, leaseBlocked, moveInCost, npcsAt, shiftBlocked, shopAt, travelOptions,
} from '../../../src/game/core/engine.ts';
import { dayOf, hourOf } from '../../../src/game/core/time.ts';
import { assess, taxStatus, tfnState } from '../../../src/game/core/tax.ts';
import { cookBlocked, groceriesAt, hostBlocked, kitchenLevel, pantryTotal, recipeKnown } from '../../../src/game/core/cooking.ts';
import { RECIPES } from '../../../src/game/data/cooking.ts';
import { viewedOk } from '../../../src/game/core/rental.ts';
import { weatherAt } from '../../../src/game/core/weather.ts';
import { choreDone, dutyFor, flatChoiceBlocked, getFlatEvent } from '../../../src/game/core/flatmates.ts';
import { choreBlocked } from '../../../src/game/core/flat-actions.ts';
import { currentIllness } from '../../../src/game/core/health.ts';
import { SKILL_KEYS } from '../../../src/game/core/types.ts';
import { careerSummary, earnedOf, spentOf } from '../../../src/game/core/tally.ts';
import type { PlayerState, Region } from '../../../src/game/core/types.ts';
import { WA, WORLD } from '../../../src/game/data/wa.ts';
import { paperChecklist } from '../../../src/game/core/paperwork.ts';
import { volunteerAt } from '../../../src/game/core/volunteer.ts';
import { volShifts, volTier } from '../../../src/game/core/respect.ts';
import { level } from '../../../src/game/core/attributes.ts';
import { gigsAt, licenseValid, shopActions, shopOffersAt } from '../../../src/game/core/business.ts';
import { getShopSite, getShopType, openCost, shopDailyCost } from '../../../src/game/core/business.ts';
import { FURNITURE } from '../../../src/game/data/furniture.ts';
import { buyBlocked, newPrice, swapBoard } from '../../../src/game/core/secondhand.ts';
import { clubSessionBlocked, formOf, getClub, racesSoon } from '../../../src/game/core/sports.ts';
import { lbEntry, type LbEntry, type LbStatKey } from '../../../src/game/core/leaderboard.ts';
import { LB_ANOMALY } from '../../../src/game/data/leaderboard.ts';
import { canWork, ieltsAt, visaKindNow, visaOptions } from '../../../src/game/core/immigration.ts';
import { VISA_ROUTES, VISA_RULES } from '../../../src/game/data/visas.ts';
import { birdingAt, gardenStatus, songsKnown, timesToday } from '../../../src/game/core/hobbies.ts';
import { BIRDS, CRAFTS, INSTRUMENT, PHOTO_WORK, PLANTS, SONGS } from '../../../src/game/data/hobbies.ts';
import { FISH } from '../../../src/game/data/fish.ts';
import { ITEMS } from '../../../src/game/data/items.ts';
import { NPCS } from '../../../src/game/data/npcs.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const DAYS = Number(arg('days', '60'));
const RUNS = Number(arg('runs', '40'));
const SEED_OFFSET = Number(arg('seed-offset', '0'));
const OUT = arg('out', '');
const BY_ORIGIN = process.argv.includes('--origins');
/** 一个现实日里玩几个游戏日（只影响按现实日算的规则，目前是志愿的现实日上限）。默认 1：每个游戏日都是新的现实日 */
const GAME_PER_REAL = Math.max(1, Number(arg('game-days-per-real-day', '1')));
/** 模拟用的现实时间：从固定的珀斯 0 点起，每 GAME_PER_REAL 个游戏日过一个现实日 */
const REAL0 = Date.UTC(2026, 0, 1) - 8 * 3_600_000;
const simNow = (clock: number) => REAL0 + Math.floor(dayOf(clock) / GAME_PER_REAL) * 86_400_000;
const BY_SWAP = process.argv.includes('--swap');
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
	/** 爱好机器人（第十二轮）：轻度玩家当天做过没有；全收集玩家跨州时的目的地、到达那天、路线进度、是否已退租出发 */
	hobbyDay?: number;
	hobbyTarget?: string;
	hobbyTargetDay?: number;
	hobbyRouteIndex?: number;
	hobbyTraveling?: boolean;
	/** 理财机器人最近一次买入的游戏日 */
	investDay?: number;
	/** 第十四轮：保守漫游最近一次出发日 */
	safeRoamDay?: number;
	stats: {
		collapses: number;
		/** 收房或断供合计 = evict.first + evict.later + evict.forced */
		evictions: number;
		/**
		 * 第十一轮：按状态转移拆原因，不再搜日志里的「收回 / 强制卖出」（卖家具给二手店的「收回 $X」会被误计）。
		 * first：租约还没过第一个结算日就被收房；later：之后的周被收房（包括营地这类没有租约的住处）；forced：房贷断供被强制卖房
		 */
		evict: { first: number; later: number; forced: number };
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
		/** 税务分支：第一次报税的结果（应纳税、已预扣、退补、第几天报的） */
		taxReturn?: { tax: number; withheld: number; due: number; day: number };
		/** 副业与小生意（docs/earth-game/side-business.md）：副业次数、开店那天、倒闭次数、店铺结算净额 */
		biz: { gigs: Record<string, number>; openDay?: number; bankrupt: number; shopNet: number };
		/** 二手市场对照：在换手墙成功下单的次数 */
		swapBuys: number;
		/** 第 43 批：签证过期（不能工作）的天数、拿到 PR 的游戏日、考雅思次数 */
		visaExpiredDays: number;
		prDay?: number;
		ielts: number;
		/** 爱好收集册（第十二轮）：册子发的声望合计、合计到 25（店长门槛）那天、每个里程碑（如 crafts:half）第几天拿到 */
		hobby: { respect: number; thresholdDay?: number; milestones: Record<string, number> };
		/** NPC 送礼和专属互动（第十三轮）：目标 NPC 到 30 / 60 / 90 好感的天数、送礼件数和零售价、perk 次数和分钟、perk 写的需求（配置）和实际净增 */
		npc: {
			milestones: Partial<Record<'30' | '60' | '90', number>>;
			gifts: number;
			giftSpend: number;
			perks: number;
			perkMinutes: number;
			perkNeeds: Record<string, number>;
			perkActual: Record<string, number>;
		};
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
	const e = lbEntry(b.s, b.lb.now, prev, { places: regionOf(b).pois.length });
	for (const k of LB_KEYS) b.lb.max[k] = Math.max(b.lb.max[k], e.stats[k] - prev.stats[k]);
	if (e.hold && e.hold.at === b.lb.now) {
		b.lb.holds++;
		if (b.lb.why.length < 3) b.lb.why.push(e.hold.why);
	}
	b.lb.e = e;
}

const GIG_IDS = ['work-mine', 'work-farm', 'work-cafe', 'busk'] as const;
/** 第十五轮实跑的偏远安全规则（三批种子 × 六条路线：0 晕倒、0 收房） */
const REMOTE_SAFETY = { cashReserve: 200, moveInRentWeeks: 2, spendRentWeeks: 2, minHunger: 50, minEnergy: 25, strandedGig: true } as const;
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
	/** 第十四轮：保守零工攒够钱后，按下限低频旅行 */
	safeRoam?: { everyDays: number; cashFloor: number; minEnergy: number; minHunger: number; maxCost: number; stops: string[] };
	/**
	 * 第十五轮：偏远路线的安全规则（只挂罗特尼斯、玛格丽特河、埃克斯茅斯三对救生员诊断路线）。
	 * 事件做完留 cashReserve；签租约后留 cashReserve + moveInRentWeeks 周租；酒吧 / 市集后留 cashReserve + spendRentWeeks 周租；
	 * 饱食 / 精力低于线就先恢复、不娱乐；被送到外地回不去时做当地零工（strandedGig）或回收。
	 */
	remoteSafety?: { cashReserve: number; moveInRentWeeks: number; spendRentWeeks: number; minHunger: number; minEnergy: number; strandedGig: boolean };
	/**
	 * 第 46 轮：保命、上班之后，所在地点能做共同事件就拉一个搭档一起做（第 10 批审查后改成三种搭档假设做对照）。
	 * mateNeeds：搭档的各项需求（100 = 全满）；mateChance：每次想做时有搭档在场的概率
	 */
	coop?: { mateNeeds: number; mateChance: number };
	/** 志愿者批：保命、上班之后，精力和饱食够就去做这里能做的志愿（每天最多 VOL_RULES.dailyMax 次，引擎限制） */
	volunteer?: boolean;
	/** 副业：要办的证照、依次尝试的副业（精力、饱食都不低于 45 时才做） */
	side?: { licenses: string[]; gigs: string[] };
	/**
	 * 开店：现金到 openAt 时在 site 开 type，雇 staff 个人，库存低于 restockBelow 就补到 restockBelow × 2（不超过库存上限），补货后留 SHOP_RESERVE 现金。
	 * 不雇人（staff 0）的店开张后自己店优先，不再去上正式班（第十一轮：原来先上咖啡店班、空当才看店，策略名和实际行为不符）；第十四轮起店里没货时回去上正式班。
	 * 第十四轮：空店先辞退店员，库存到 restockBelow 且留得出一周人手开销才（重新）雇人。有 safety 时开张线按 safeOpenAt() 算，开店前也做首次体验、做完至少留 respectReserve
	 */
	shop?: {
		type: string; site: string; openAt: number; staff: number; restockBelow: number;
		/** 第十四轮：开张现金 = 开店成本 + 初货 + N 周店铺固定成本 + M 周住房 + 已知签证 + 补货储备 */
		safety?: { operatingWeeks: number; homeWeeks: number; visaReserve: number; respectReserve: number };
	};
	/** 二手市场对照：买家具先看换手墙。pickup＝上门看货 + 砍价；prepay＝一律先转账送货、不砍价（不看红旗） */
	swap?: 'pickup' | 'prepay';
	/** 第 43 批：练哪项运动、加入哪个俱乐部；保命、上班之后报名参赛、上训练课、自己练（见 trySport） */
	sport?: { sport: 'run'; club: string };
	/**
	 * 第 25 批（经济设计）：理财。现金超过 keep 时把多出来的买成 asset（每个游戏日最多一次），不买房；
	 * 现金低于 $300 时卖出 $500 应急。
	 */
	invest?: { asset: string; keep: number };
	/** 现金超过多少才签租约（默认 $400）。第十一轮：农场工 $700，先领第一笔工资再锁首期和押金 */
	rentAt?: number;
	/** 走完整世界（WORLD，含南澳等跨州地点）而不是西澳单区；不写的策略仍走 WA，原有结果不变（第十二轮，全收集要跨州） */
	world?: boolean;
	/** 爱好收集（第十二轮）。light：每三天在家做一次手工或乐器；all：先上班、种完跨季菜园，第 75 天起退租跨州收六本 */
	hobby?: { mode: 'light' | 'all' };
	/**
	 * NPC（第十三轮）：只统计目标 NPC 的关系进度。none：不改行为（只观测聊天）；perk：不送礼，解锁后冷却到就用专属互动；
	 * love：只送 TA 的最爱；cheap：送当地买得到、TA 不讨厌的最便宜物品。送礼到 90 好感停手，专属互动冷却到就用
	 */
	npc?: { id: string; gift: 'none' | 'perk' | 'love' | 'cheap' };}

function regionOf(b: Bot): Region {
	return b.plan.world ? WORLD : WA;
}

const PLANS: Plan[] = [
	{ id: 'barista', name: '咖啡店上班族（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', npc: { id: 'mia', gift: 'none' } },
	{ id: 'lifeguard', name: '救生员（珀斯，公寓）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'perth', career: 'lifeguard' }, home: 'flat' },
	{ id: 'miner', name: '矿工（卡尔古利，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room' },
	{ id: 'drifter', name: '打零工的背包客（无房）', origin: 'backpacker', traits: ['loner', 'frugal'], roam: true },
	{
		id: 'drifter-safe', name: '保守背包客（无房，少漫游）', origin: 'backpacker', traits: ['loner', 'frugal'], spend: false,
		gig: { cashTarget: 700, cashReserve: 200, minEnergy: 55, minHunger: 50, preferred: ['work-cafe', 'work-farm', 'busk', 'work-mine'] },
	},
	{
		id: 'drifter-roam-safe', name: '保守漫游背包客（无房，低频旅行）', origin: 'backpacker', traits: ['loner', 'frugal'], spend: false, roam: true,
		gig: { cashTarget: 1600, cashReserve: 500, minEnergy: 65, minHunger: 60, preferred: ['work-cafe', 'work-farm', 'busk', 'work-mine'] },
		safeRoam: { everyDays: 21, cashFloor: 1200, minEnergy: 80, minHunger: 80, maxCost: 80, stops: ['perth', 'fremantle', 'bunbury', 'margaret-river'] },
	},
	{ id: 'barista-vol', name: '咖啡店 + 有空做志愿（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', volunteer: true },
	{ id: 'drifter-vol', name: '背包客 + 有空做志愿（无房）', origin: 'backpacker', traits: ['loner', 'frugal'], roam: true, volunteer: true },
	{ id: 'idle', name: '什么都不干（对照组）', origin: 'backpacker', traits: [] },
	// 第 46 轮新增（只出报告，不改数值）：第 11 轮的两种新职业、第 1 轮起的共同事件。排在原有策略后面，原有各行结果不变
	{ id: 'bartender', name: '酒保（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'bartender' }, home: 'room' },
	{ id: 'farmhand', name: '农场工（玛格丽特河，合租）', origin: 'backpacker', traits: ['athletic', 'tough'], job: { loc: 'margaret-river', career: 'farmhand' }, home: 'room', rentAt: 700 },
	// 共同事件三种搭档假设（第 10 批审查问题 1）：理想（需求全满、随叫随到）是上限，不是保守估计；另外两种看搭档状态和在场率的影响
	{ id: 'barista-coop', name: '咖啡店 + 共同事件：理想搭档（需求全满、随时在场）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 100, mateChance: 1 } },
	{ id: 'barista-coop-tired', name: '咖啡店 + 共同事件：疲惫搭档（需求 40、随时在场）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 40, mateChance: 1 } },
	// 第 43 批（运动和比赛）：咖啡店上班族 + 跑团 + 周六公园 5 公里和城市长跑。只多一行，不改上面的策略
	{ id: 'barista-runner', name: '咖啡店 + 跑团 + 比赛（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', sport: { sport: 'run', club: 'swan-river-runners' } },
	{ id: 'barista-savings', name: '咖啡店 + 理财：高息储蓄（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'savings', keep: 3000 } },
	{ id: 'barista-index', name: '咖啡店 + 理财：澳股指数基金（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'asx-index', keep: 3000 } },
	{ id: 'barista-coin', name: '咖啡店 + 理财：鸸鹋币（不买房）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', invest: { asset: 'emu-coin', keep: 3000 } },
	{ id: 'barista-coop-sparse', name: '咖啡店 + 共同事件：疲惫搭档，一半时候没人（需求 40、在场 50%）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', coop: { mateNeeds: 40, mateChance: 0.5 } },
	// 副业与小生意（side-business.md）新增：排在最后，原有各行结果不变
	{ id: 'side-gig', name: '副业留学生：家教 + 送外卖（珀斯，合租，无正式工作）', origin: 'student', traits: ['charming', 'neat'], home: 'room', spend: false, side: { licenses: ['abn', 'wwc-wa'], gigs: ['tutor', 'delivery', 'daigou'] } },
	{ id: 'barista-side', name: '咖啡店 + 下班家教（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, side: { licenses: ['wwc-wa'], gigs: ['tutor'] } },
	{ id: 'shop-milktea', name: '咖啡店攒钱开奶茶店（北桥，雇 1 人）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, shop: { type: 'milk-tea', site: 'northbridge', openAt: 11_000, staff: 1, restockBelow: 150, safety: { operatingWeeks: 1, homeWeeks: 2, visaReserve: 850, respectReserve: 1500 } } },
	{ id: 'shop-repair', name: '咖啡店攒钱开手机维修铺（维多利亚公园，不雇人、自己看店）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', spend: false, shop: { type: 'phone-repair', site: 'victoria-park', openAt: 9_000, staff: 0, restockBelow: 20, safety: { operatingWeeks: 1, homeWeeks: 2, visaReserve: 850, respectReserve: 1500 } } },
	// 第十二轮：爱好收集册声望的回归策略（balance.md 第十二轮第 1 节）。全收集要跨州，走完整世界
	{ id: 'hobby-light', name: '爱好轻度玩家（咖啡店；每三天一次手工/乐器）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', hobby: { mode: 'light' } },
	{ id: 'hobby-all', name: '爱好全收集玩家（咖啡店；第 75 天起跨州）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', world: true, hobby: { mode: 'all' } },
	// 第十三轮：NPC 送礼与专属互动（balance.md 第十三轮第 1 节）。珀斯不送礼的对照就是上面的 barista
	{ id: 'barista-gift-love', name: '咖啡店 + 米娅：只送最爱礼物、冷却到就用早餐', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', npc: { id: 'mia', gift: 'love' } },
	{ id: 'barista-gift-cheap', name: '咖啡店 + 米娅：送当地最便宜非讨厌礼物、冷却到就用早餐', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', npc: { id: 'mia', gift: 'cheap' } },
	{ id: 'barista-perk-only', name: '咖啡店 + 米娅：不送礼、自然解锁后冷却到就用早餐', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room', npc: { id: 'mia', gift: 'perk' } },
	{ id: 'barista-esperance', name: '咖啡店上班族（埃斯佩兰斯，合租；不送礼）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'esperance', career: 'barista' }, home: 'room', npc: { id: 'nan', gift: 'none' } },
	{ id: 'barista-nan-gift-love', name: '咖啡店 + 南希：只送最爱礼物、冷却到就吃晚饭', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'esperance', career: 'barista' }, home: 'room', npc: { id: 'nan', gift: 'love' } },
	{ id: 'barista-nan-gift-cheap', name: '咖啡店 + 南希：送当地最便宜非讨厌礼物、冷却到就吃晚饭', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'esperance', career: 'barista' }, home: 'room', npc: { id: 'nan', gift: 'cheap' } },
	{ id: 'barista-nan-perk-only', name: '咖啡店 + 南希：不送礼、自然解锁后冷却到就吃晚饭', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'esperance', career: 'barista' }, home: 'room', npc: { id: 'nan', gift: 'perk' } },
	// 第十三轮：库伯佩迪普通生涯（正常交房租、做可选声望互动），让地下屋进长期回归
	{ id: 'miner-coober-dugout', name: '库伯佩迪矿工（地下屋）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'coober-pedy', career: 'miner' }, home: 'dugout', world: true },
];

/**
 * NPC 诊断路线（第十四轮）：同地点、同职业的「不用 perk」和「自然解锁后用 perk」成对比较其他 NPC 的专属互动。
 * 不进默认报告（外地住房机器人有约 1% 的收房尾部，会让「有工作收房 0」亮红灯，和 perk 无关），只在 --only 点名时跑。
 */
const DIAG_PLANS: Plan[] = [
	{ id: 'lifeguard-freo-none', name: '救生员（弗里曼特尔；老杰克对照）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'fremantle', career: 'lifeguard' }, home: 'room', npc: { id: 'jack', gift: 'none' } },
	{ id: 'lifeguard-jack-perk', name: '救生员 + 老杰克：自然解锁后出海', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'fremantle', career: 'lifeguard' }, home: 'room', npc: { id: 'jack', gift: 'perk' } },
	{ id: 'lifeguard-rottnest-none', name: '救生员（罗特尼斯；琳达对照）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'rottnest', career: 'lifeguard' }, home: 'beach', npc: { id: 'linda', gift: 'none' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'lifeguard-linda-perk', name: '救生员 + 琳达：自然解锁后走小路', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'rottnest', career: 'lifeguard' }, home: 'beach', npc: { id: 'linda', gift: 'perk' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'lifeguard-margaret-none', name: '救生员（玛格丽特河；里奥对照）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'margaret-river', career: 'lifeguard' }, home: 'room', npc: { id: 'leo', gift: 'none' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'lifeguard-leo-perk', name: '救生员 + 里奥：自然解锁后冲浪课', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'margaret-river', career: 'lifeguard' }, home: 'room', npc: { id: 'leo', gift: 'perk' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'lifeguard-exmouth-none', name: '救生员（埃克斯茅斯；萨姆对照）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'exmouth', career: 'lifeguard' }, home: 'room', npc: { id: 'sam', gift: 'none' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'lifeguard-sam-perk', name: '救生员 + 萨姆：自然解锁后浮潜', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'exmouth', career: 'lifeguard' }, home: 'room', npc: { id: 'sam', gift: 'perk' }, remoteSafety: REMOTE_SAFETY },
	{ id: 'miner-bill-none', name: '矿工（卡尔古利；比尔对照）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room', npc: { id: 'bill', gift: 'none' } },
	{ id: 'miner-bill-perk', name: '矿工 + 比尔：自然解锁后请客', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room', npc: { id: 'bill', gift: 'perk' } },
];

// 出身对照（初始属性设计，见 docs/earth-game/initial-stats.md）：同一策略、不带特质，只换出身，看起始现金、车和能力的差别。只出报告，不改数值
/** 对照组：不工作、不消费、不玩。出身对照里的 idle-<出身> 同样处理 */
const SWAP_PLANS: Plan[] = [
	{ ...PLANS[0], id: 'swap-none', name: '咖啡店（家具只买新的）' },
	{ ...PLANS[0], id: 'swap-pickup', name: '咖啡店 + 换手墙：上门看货、砍价', swap: 'pickup' },
	{ ...PLANS[0], id: 'swap-prepay', name: '咖啡店 + 换手墙：一律先转账', swap: 'prepay' },
];
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
		: a.t === 'job' || a.t === 'home' || a.t === 'furniture' || a.t === 'property' || a.t === 'asset' || a.t === 'rental' || a.t === 'flat' ? `${a.t}-${a.op}`
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
	const r = applyAction(b.s, regionOf(b), a, simNow(b.s.clock));
	if (!r.ok) {
		b.s = r.state;
		return false;
	}
	b.s = r.state;
	trackLb(b);
	const key = actionKey(a);
	const newMilestones = b.s.hobby.got.filter((id) => !before.hobby.got.includes(id));
	if (newMilestones.length) {
		const gained = Math.max(0, b.s.respect - before.respect);
		b.stats.hobby.respect += gained;
		for (const id of newMilestones) b.stats.hobby.milestones[id] ??= dayOf(b.s.clock) + 1;
		if (b.stats.hobby.thresholdDay === undefined && b.stats.hobby.respect >= 25) b.stats.hobby.thresholdDay = dayOf(b.s.clock) + 1;
	}
	if (b.plan.npc) {
		const score = b.s.relations[b.plan.npc.id]?.score ?? 0;
		for (const t of ['30', '60', '90'] as const) if (score >= Number(t)) b.stats.npc.milestones[t] ??= dayOf(b.s.clock) + 1;
	}
	// 店铺结算挂在任意动作之后：把这次结算出的净额单独记成 shop-days，不算进触发它的动作
	const shopNow = b.s.biz.shop;
	const settledNet = shopNow ? shopNow.hist.filter((h) => h.d > (before.biz.shop?.last ?? Infinity)).reduce((n, h) => n + h.net, 0) : 0;
	if (settledNet) b.stats.flow['shop-days'] = (b.stats.flow['shop-days'] ?? 0) + settledNet;
	if (before.biz.shop && !b.s.biz.shop && !(a.t === 'biz' && a.op === 'close')) b.stats.biz.bankrupt++;
	if (!before.biz.shop && b.s.biz.shop) b.stats.biz.openDay ??= dayOf(b.s.clock);
	if (a.t === 'biz' && a.op === 'gig') b.stats.biz.gigs[a.id] = (b.stats.biz.gigs[a.id] ?? 0) + 1;
	b.stats.biz.shopNet += settledNet;
	b.stats.flow[key] = (b.stats.flow[key] ?? 0) + (b.s.cash - before.cash) - settledNet;
	// 店铺结算的钱单独记（和上面的 flow 一致），不算到触发它的动作头上（合并 main 后复核）
	recordEco(ecoOf(b), a.t, key, b.s.cash - before.cash - settledNet);
	if (settledNet) recordEco(ecoOf(b), 'biz', 'shop-days', settledNet);
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
	}
	if (!(a.t === 'home' && a.op === 'leave')) countLoss(b, before, a.t === 'property' && a.op === 'sell'); // 主动退租（全收集出发前）不算收房
	if (b.s.job && before.job && b.s.job.career === before.job.career && b.s.job.level > before.job.level) {
		b.stats.promotions++;
		b.stats.promoDays.push(dayOf(b.s.clock) + 1);
	}
	if (a.t === 'job' && a.op === 'work') b.stats.shifts++;
	if (a.t === 'tax' && a.op === 'lodge' && before.tax.ret && !b.stats.taxReturn) {
		const ret = before.tax.ret;
		b.stats.taxReturn = { tax: assess(ret, taxStatus(before.origin)).tax, withheld: ret.withheld, due: b.s.tax.last?.due ?? 0, day: dayOf(b.s.clock) + 1 };
	}
	return true;
}

/** 税务杂事（税务分支）：开局网上申请 TFN；有待申报的税表、TFN 也到了就报税。都不花游戏时间 */
function taxChore(b: Bot): boolean {
	const t = b.s.tax;
	if (t.tfn < 0) return tryAct(b, { t: 'tax', op: 'tfn' });
	if (t.ret && tfnState(t, dayOf(b.s.clock)) === 'ok') return tryAct(b, { t: 'tax', op: 'lodge' });
	return false;
}

/**
 * 健康系统第 1 版：有病就在所在地点就医（不为看病专门出行）。
 * 重症先急诊；开了处方就去药房取药；其余先 GP 再药房。付不起或这里没有就跳过。
 */
function careStep(b: Bot): boolean {
	const cur = currentIllness(b.s);
	if (!cur) return false;
	const here = careAt(b.s, regionOf(b)).filter((x) => !x.blocked);
	const has = (k: string) => here.some((x) => x.care.id === k);
	const order = cur.def.severity >= 3 ? ['ed', 'gp', 'pharmacy'] : cur.ill.rx ? ['pharmacy', 'gp'] : ['gp', 'pharmacy'];
	for (const k of order) if (has(k) && !cur.ill.care.includes(k) && tryAct(b, { t: 'care', kind: k as 'gp' | 'pharmacy' | 'ed' })) return true;
	return cur.ill.rx && !cur.ill.care.includes('rx') && has('pharmacy') && tryAct(b, { t: 'care', kind: 'pharmacy' });
}

const can = (b: Bot, id: string) => activitiesAt(b.s, regionOf(b)).some((x) => x.act.id === id && !x.blocked);
const act = (b: Bot, id: string) => can(b, id) && tryAct(b, { t: 'activity', id });

/** 从 from 到 dest 按路线跳数最少的下一站（广度优先；没有路返回 undefined） */
function nextHop(region: Region, from: string, dest: string): string | undefined {
	const prev = new Map<string, string>([[from, from]]);
	const queue = [from];
	while (queue.length) {
		const at = queue.shift()!;
		if (at === dest) break;
		for (const r of region.routes) {
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
	const region = regionOf(b);
	const opts = travelOptions(b.s, region).filter((o) => o.available);
	const direct = opts.filter((o) => o.to === dest).sort((x, y) => x.cost - y.cost)[0];
	if (direct) return tryAct(b, { t: 'travel', to: direct.to, mode: direct.mode });
	const hop = nextHop(region, b.s.loc, dest);
	const step = hop ? opts.filter((o) => o.to === hop).sort((x, y) => x.cost - y.cost)[0] : undefined;
	return !!step && tryAct(b, { t: 'travel', to: step.to, mode: step.mode });
}

function recordGigMiss(b: Bot, reason: GigMiss) {
	b.stats.diag.gigMisses[reason]++;
}

/** 已经想开工却没有一种零工能做：记下当前最直接的阻塞原因。 */
function recordBlockedGigs(b: Bot) {
	const gigsHere = activitiesAt(b.s, regionOf(b)).filter((x) => (GIG_IDS as readonly string[]).includes(x.act.id));
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
		const npc = npcsAt(s, regionOf(b)).find((n) => !n.blocked.chat);
		if (npc && tryAct(b, { t: 'npc', npc: npc.npc.id, act: 'chat' })) return;
	}
	if (s.needs.fun < 40 && s.needs.energy >= 35 && act(b, 'swim')) return;

	// 补一根便宜的应急能量棒，但不动 $200 应急金。
	if (!s.inventory.snack && s.cash > gig.cashReserve) {
		const e = shopAt(s, regionOf(b)).find((x) => x.item.id === 'snack' && !x.blocked);
		if (e && tryAct(b, { t: 'buy', item: 'snack' })) return;
	}
	const roam = b.plan.safeRoam;
	const day = dayOf(s.clock);
	if (roam && s.cash >= gig.cashTarget && s.needs.energy >= roam.minEnergy && s.needs.hunger >= roam.minHunger && day - (b.safeRoamDay ?? -roam.everyDays) >= roam.everyDays) {
		const opts = travelOptions(s, regionOf(b)).filter((o) => o.available && o.mode !== 'air' && roam.stops.includes(o.to) && o.cost <= roam.maxCost && s.cash - o.cost >= roam.cashFloor);
		if (opts.length) {
			const o = opts[Math.floor(b.rng() * opts.length)];
			if (tryAct(b, { t: 'travel', to: o.to, mode: o.mode })) {
				b.safeRoamDay = day;
				return;
			}
		}
	}
	act(b, 'rest');
}

/**
 * 共同事件（第 46 轮）：所在地点有现在能做的就做一件。搭档是每次现场新建的同出身角色（开局能力），需求和在场率按策略的假设；
 * 和服务端一样，开始前对每个成员都检查 coopBlocked，有人不能参加就不做。只统计机器人自己的收益。
 * 搭档是假设出来的，结果只说明「在这个假设下」会怎样，不代表真实玩家的分布（第 10 批审查问题 1）。
 */
/**
 * 收房 / 断供（第十一轮）：看状态变化，不搜日志文案。租着的住处没了 = 被收房（机器人不会主动退租不搬）；
 * 房产少了又不是自己卖的（sold）= 断供强制卖房。tryAct 和 tryCoop 都要调（两条路都会推进时间、跨周结算）
 */
function countLoss(b: Bot, before: PlayerState, sold: boolean): void {
	if (before.home && !before.home.owned && !b.s.home) {
		const lease = before.rental.lease;
		// 租约还没过结算日（签约在上一个结算日当天或之后）：这是首个结算期被收房
		(lease && lease.start >= before.nextWeek - 7 ? b.stats.evict.first++ : b.stats.evict.later++);
		b.stats.evictions++;
	}
	const lost = before.properties.filter((p) => !b.s.properties.some((q) => q.id === p.id)).length;
	if (lost && !sold) {
		b.stats.evict.forced += lost;
		b.stats.evictions += lost;
	}
}

function tryCoop(b: Bot): boolean {
	const s = b.s;
	const cfg = b.plan.coop!;
	if (OFF.has('coop')) return false;
	const region = regionOf(b);
	const open = coopsAt(s, region).find((x) => !x.blocked);
	if (!open) return false;
	if (cfg.mateChance < 1 && b.rng() >= cfg.mateChance) return false;
	const base = createCharacter({ id: `sim-mate-${b.stats.coops}`, name: 'mate', avatar: '🧑', origin: b.plan.origin, traits: [], region: region.id, spawn: s.loc, seed: Math.floor(b.rng() * 1e9) });
	const n = cfg.mateNeeds;
	const mate = { ...base, loc: s.loc, clock: s.clock, needs: { ...base.needs, hunger: n, energy: n, hygiene: n, fun: n, social: n } };
	if (coopBlocked(s, region, open.def) || coopBlocked(mate, region, open.def)) return false;
	const r = applyCoop(open.def, region, [{ state: s, role: 0, name: b.plan.id }, { state: mate, role: 1, name: 'mate' }]);
	const me = r.results[0];
	if (!me.ok) return false;
	b.stats.flow.coop = (b.stats.flow.coop ?? 0) + (me.state.cash - s.cash);
	recordEco(ecoOf(b), 'coop', 'coop', me.state.cash - s.cash);
	b.stats.coops++;
	if (r.success) b.stats.coopOk++;
	b.stats.coopKinds[open.def.id] = (b.stats.coopKinds[open.def.id] ?? 0) + 1;
	b.s = me.state;
	countLoss(b, s, false); // 共同事件也会推进时间、跨周结算
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
	const offers = groceriesAt(s, regionOf(b));
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
	const opts = visaOptions(s, regionOf(b));
	for (const id of VISA_ORDER) {
		if (id === 'student' && now !== 'expired') continue;
		if (id === 'graduate2' && (s.visa.until - dayOf(s.clock)) > 20) continue; // 第一次 485 快到期才续
		const o = opts.find((x) => x.route.id === id && !x.blocked);
		if (o && tryAct(b, { t: 'visa', op: 'apply', route: id })) return true;
	}
	const grad = opts.find((x) => x.route.id === 'graduate');
	const wantIelts = s.visa.ielts < VISA_RULES.graduate.minIelts && (grad?.blocked?.includes('雅思') || (s.visa.course && s.visa.course.end - dayOf(s.clock) < 30));
	const t = wantIelts ? ieltsAt(s, regionOf(b)) : null;
	if (t && !t.blocked && s.cash > t.fee + (VISA_ROUTES.find((r) => r.id === 'graduate')?.fee ?? 0) + 300 && s.needs.energy > 40 && tryAct(b, { t: 'visa', op: 'ielts' })) {
		b.stats.ielts++;
		return true;
	}
	return false;
}

// ---------- 爱好机器人（第十二轮） ----------
/** 发声望的六本收集册（data/hobbies.ts 的 COLLECTION_REWARD）：id → 报告里的名字 */
const REWARD_BOOKS = { fish: '钓鱼', birds: '观鸟', works: '摄影地点', plants: '菜园', crafts: '手工', songs: '曲目' } as const;

function buyHobbyItem(b: Bot, id: string): boolean {
	if (b.s.inventory[id]) return false;
	const offer = shopAt(b.s, regionOf(b)).find((x) => x.item.id === id && !x.blocked);
	return !!offer && b.s.cash - offer.price >= 400 && tryAct(b, { t: 'buy', item: id });
}

function stepLightHobby(b: Bot): boolean {
	const s = b.s;
	const day = dayOf(s.clock);
	if (buyHobbyItem(b, INSTRUMENT)) return true;
	if (!s.home || s.loc !== s.home.loc || day % 3 !== 0 || b.hobbyDay === day) return false;
	const craft = s.hobby.made.length / CRAFTS.length;
	const music = songsKnown(s.hobby.xp.music ?? 0).length / SONGS.length;
	const order = craft <= music ? ['craft', 'music'] as const : ['music', 'craft'] as const;
	for (const id of order) {
		if (id === 'craft' && s.hobby.made.length >= CRAFTS.length) continue;
		if (id === 'music' && songsKnown(s.hobby.xp.music ?? 0).length >= SONGS.length) continue;
		if (tryAct(b, { t: 'hobby', id })) {
			b.hobbyDay = day;
			return true;
		}
	}
	return false;
}

function matchesWhere(loc: Region['locations'][number], where: { locs?: string[]; kinds?: string[]; tags?: string[] }): boolean {
	return !!(where.locs?.includes(loc.id) || where.kinds?.includes(loc.kind) || where.tags?.some((t) => loc.tags.includes(t)));
}

/** 这里还可能贡献几个未收项目；忽略季节/时段，只用于排旅行路线，不直接发奖。 */
function staticCollectionNeed(b: Bot, locId: string): number {
	const s = b.s;
	const loc = regionOf(b).locations.find((x) => x.id === locId);
	if (!loc) return 0;
	let n = (s.hobby.works[loc.id] ?? 0) >= PHOTO_WORK.good ? 0 : 1;
	n += FISH.filter((f) => !s.fish[f.id] && matchesWhere(loc, f.where)).length;
	n += BIRDS.filter((bird) => !s.hobby.birds.includes(bird.id) && matchesWhere(loc, bird.where)).length;
	return n;
}

function chooseHobbyTarget(b: Bot): string | undefined {
	const locs = regionOf(b).locations;
	let from = b.hobbyRouteIndex ?? 0;
	for (let pass = 0; pass < 2; pass++) {
		for (let i = from; i < locs.length; i++) {
			if (locs[i].id !== b.s.loc && staticCollectionNeed(b, locs[i].id) > 0) {
				b.hobbyRouteIndex = i + 1;
				return locs[i].id;
			}
		}
		from = 0;
		b.hobbyRouteIndex = 0;
	}
	return undefined;
}

/**
 * 全收集：先买鱼竿/琴；在家按成熟时收种、每天最多各做一次手工和乐器；
 * 每地每天最多摄影 2、钓鱼 3、观鸟 3 次，只在当前池里还有新种时做。
 * travel=false 是上班期的本地休闲；travel=true 从第 75 天起按完整世界地点轮游，每地最多停 2 天后继续。
 */
function stepAllHobby(b: Bot, travel: boolean): boolean {
	const s = b.s;
	const region = regionOf(b);
	const day = dayOf(s.clock);
	if (buyHobbyItem(b, INSTRUMENT) || buyHobbyItem(b, 'rod')) return true;
	const atHome = !!s.home && s.loc === s.home.loc;
	if (atHome) {
		const g = gardenStatus(s);
		if (g.op !== 'none' && g.op !== 'water' && !g.blocked && tryAct(b, { t: 'hobby', id: 'garden' })) return true;
		if (s.hobby.made.length < CRAFTS.length && timesToday(s.hobby, 'craft', day) < 1 && tryAct(b, { t: 'hobby', id: 'craft' })) return true;
	}
	if (songsKnown(s.hobby.xp.music ?? 0).length < SONGS.length && timesToday(s.hobby, 'music', day) < 1 && tryAct(b, { t: 'hobby', id: 'music' })) return true;
	if ((s.hobby.works[s.loc] ?? 0) < PHOTO_WORK.good && timesToday(s.hobby, 'photo', day) < 2 && tryAct(b, { t: 'hobby', id: 'photo' })) return true;
	const fish = fishingAt(s, region);
	if (fish && !fish.blocked && fish.fish.some((f) => !s.fish[f.id]) && timesToday(s.hobby, 'fishing', day) < 3 && tryAct(b, { t: 'fish' })) return true;
	const birds = birdingAt(s, region);
	if (birds && !birds.blocked && birds.birds.some((x) => !s.hobby.birds.includes(x.id)) && timesToday(s.hobby, 'birding', day) < 3 && tryAct(b, { t: 'hobby', id: 'birding' })) return true;
	if (!travel) return false;

	if (b.hobbyTarget && b.hobbyTarget !== s.loc) {
		if (headTo(b, b.hobbyTarget)) return true;
		b.hobbyTarget = undefined;
	}
	if (b.hobbyTarget === s.loc) {
		b.hobbyTargetDay ??= day;
		if (staticCollectionNeed(b, s.loc) > 0 && day - b.hobbyTargetDay < 2) return act(b, 'rest');
		b.hobbyTarget = undefined;
		b.hobbyTargetDay = undefined;
	}
	const next = chooseHobbyTarget(b);
	if (next) {
		b.hobbyTarget = next;
		b.hobbyTargetDay = undefined;
		return headTo(b, next);
	}
	return act(b, 'rest');
}

/** NPC 策略（第十三轮）：目标在场时先用到期的专属互动，再送礼到 90；礼物在当地商店买，买完至少留 $300 */
function stepNpc(b: Bot): boolean {
	const cfg = b.plan.npc;
	if (!cfg || cfg.gift === 'none') return false;
	const here = npcsAt(b.s, regionOf(b)).find((x) => x.npc.id === cfg.id);
	if (!here) return false;
	const perk = here.npc.perk;
	if (perk && 'perk' in here.blocked && !here.blocked.perk) {
		const before = b.s;
		if (tryAct(b, { t: 'npc', npc: cfg.id, act: 'perk' })) {
			const n = b.stats.npc;
			n.perks++;
			n.perkMinutes += perk.fx.minutes ?? 0;
			for (const [k, v] of Object.entries(perk.fx.needs ?? {})) n.perkNeeds[k] = (n.perkNeeds[k] ?? 0) + v;
			for (const k of Object.keys(before.needs) as (keyof PlayerState['needs'])[]) n.perkActual[k] = (n.perkActual[k] ?? 0) + b.s.needs[k] - before.needs[k];
			return true;
		}
	}
	if (cfg.gift === 'perk' || here.rel.score >= 90 || here.blocked.gift) return false;
	const gift = ITEMS.filter((it) => !it.passive && !here.npc.gifts.dislike.includes(it.id) && (cfg.gift === 'cheap' || here.npc.gifts.love.includes(it.id)))
		.sort((a, z) => a.price - z.price || a.id.localeCompare(z.id))[0];
	if (!gift) return false;
	if ((b.s.inventory[gift.id] ?? 0) > 0 && tryAct(b, { t: 'npc', npc: cfg.id, act: 'gift', item: gift.id })) {
		b.stats.npc.gifts++;
		b.stats.npc.giftSpend += gift.price;
		return true;
	}
	const offer = shopAt(b.s, regionOf(b)).find((x) => x.item.id === gift.id && !x.blocked);
	return !!offer && b.s.cash - offer.price >= 300 && tryAct(b, { t: 'buy', item: offer.item.id });
}

function step(b: Bot) {
	const s = b.s;
	const plan = b.plan;
	const ev = getPendingEvent(s);
	if (ev) {
		b.stats.events++;
		// 选第一个现在能选的选项：付得起、风暴天不下海（和引擎的限制一致）
		const stormy = !!weatherAt(s).closesSea;
		const ok = (c: (typeof ev.choices)[number]) => (!c.cost || c.cost <= s.cash) && !(c.exposed === 'sea' && stormy);
		// 第十五轮：偏远路线先选做完还留储备的选项（埃克斯茅斯开局 $200 鲸鲨同游把现金打空）
		const safe = plan.remoteSafety ? ev.choices.findIndex((c) => ok(c) && s.cash - (c.cost ?? 0) >= plan.remoteSafety!.cashReserve) : -1;
		const pick = safe >= 0 ? safe : ev.choices.findIndex(ok);
		if (pick < 0 || !tryAct(b, { t: 'event', choice: pick })) throw new Error(`机器人卡在事件 ${ev.id}（${plan.id}，第 ${dayOf(s.clock)} 天）`);
		return;
	}
	if (careStep(b)) return;
	if (!isIdle(plan) && taxChore(b)) return;
	if (plan.gig) {
		stepSafeDrifter(b);
		return;
	}
	const h = hourOf(s.clock);
	const atHome = s.home && s.home.loc === s.loc;
	const rs = plan.remoteSafety;
	const minHunger = rs?.minHunger ?? 35;
	const minEnergy = rs?.minEnergy ?? 25;
	/** 偏远路线可选消费后至少留的钱：储备 + 若干周现行租金 */
	const remoteFloor = rs ? rs.cashReserve + (s.rental.lease?.rent ?? 0) * rs.spendRentWeeks : 0;

	// 1. 生存（没钱时赶上免费餐就去吃）
	if (s.cash < 60 && s.needs.hunger < 80 && (act(b, 'charity-meal') || act(b, 'charity-dinner'))) return;
	if (s.health < 35 && (act(b, 'clinic') || (s.inventory.firstaid && tryAct(b, { t: 'use', item: 'firstaid' })))) return;
	if (s.needs.hunger < minHunger) {
		if (cookFromPantry(b)) return;
		if (!homeActionBlocked(s, 'cook', regionOf(b)) && tryAct(b, { t: 'home', op: 'cook' })) return;
		if (act(b, 'eat')) return;
		if (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' })) return;
		if (s.inventory.water && tryAct(b, { t: 'use', item: 'water' })) return;
		if (act(b, 'forage')) return;
	}
	// 夜里精力不满才睡（刚睡醒的半夜不会再睡一觉，否则会睡过上班时间）
	const night = (h >= 22 || h < 5) && s.needs.energy < 70;
	if (s.needs.energy < minEnergy || night) {
		if (atHome && tryAct(b, { t: 'home', op: 'sleep' })) return;
		if (s.cash > 600 && act(b, 'sleep-motel')) return;
		if (act(b, 'sleep-camp')) return;
	}
	if (s.needs.hygiene < 25 && act(b, 'shower')) return;
	// 室友（docs/earth-game/flatmates.md）：有室友事件就选第一个付得起的选项；轮到自己值日、人在家、精力够就做一次家务
	if (s.flatshare.ev) {
		const fe = getFlatEvent(s.flatshare.ev.id);
		const pick = fe ? fe.choices.findIndex((c) => !flatChoiceBlocked(s, c)) : -1;
		if (pick >= 0 && tryAct(b, { t: 'flat', op: 'resolve', choice: pick })) return;
	}
	if (atHome && dutyFor(s) === 'me' && !choreDone(s) && s.needs.energy > 40 && !choreBlocked(s) && tryAct(b, { t: 'flat', op: 'chore' })) return;

	// 1.5 签证（第 43 批）：只有留学生出身走签证路线
	if (!isIdle(plan) && stepVisa(b)) return;
	// 1.5 运动策略（第 43 批）：比赛日先比赛再上班（周六公园 5 公里在早上 7–9 点，和早班撞）
	if (plan.sport && s.needs.hunger >= 35) {
		const today = racesSoon(s, regionOf(b), 0).find((o) => o.race.sport === plan.sport!.sport && !o.raceBlocked);
		if (today && tryAct(b, { t: 'sport', op: 'race', id: today.race.id })) return;
	}
	// 全收集玩家先按真实上班路线攒钱、跨季节种完菜园；第 75 天后（最迟第 95 天）才请长假跨州。
	const collectorTravel = plan.hobby?.mode === 'all' && dayOf(s.clock) >= 75 && s.hobby.plants.length >= PLANTS.length;
	if (collectorTravel) {
		// 105 天以上的跨州长旅先退租，不让一个明知长期离家的机器人继续背着周租。
		if (!b.hobbyTraveling) {
			if (s.home && tryAct(b, { t: 'home', op: 'leave' })) {
				b.hobbyTraveling = true;
				return;
			}
			b.hobbyTraveling = true;
		}
		// 资金不足就回珀斯上原来的班，攒到 $5,000 再续行；不靠破产或免费生存动作硬刷全收集。
		if (s.cash < 2500 && s.loc !== 'perth' && headTo(b, 'perth')) return;
		if (!(s.loc === 'perth' && s.cash < 5000)) {
			stepAllHobby(b, true);
			return;
		}
	}

	// 2. 找工作、租房、去上班
	// 自己看店的策略只有在店里有货时才停正式班；空店时回去上班，避免租金把补货本金越吃越少。
	const selfShopTrading = !!(plan.shop?.staff === 0 && s.biz.shop && s.biz.shop.stock > 0);
	if (plan.job && !selfShopTrading) {
		if (!s.job) {
			if (s.loc !== plan.job.loc) {
				if (headTo(b, plan.job.loc)) return;
			} else if (careersAt(s, regionOf(b)).some((o) => o.career.id === plan.job!.career && !o.blocked)) {
				if (tryAct(b, { t: 'job', op: 'apply', career: plan.job.career })) return;
			}
		} else if (s.loc !== s.job.loc) {
			if (headTo(b, s.job.loc)) return; // 被送去外地医院等情况：先回工作地点
			// 第十五轮：回不去（付不起车票）时，需求够就做当地零工攒路费，否则先回收
			if (rs?.strandedGig) {
				if (s.needs.hunger >= minHunger && s.needs.energy >= minEnergy && tryGigs(b, GIG_IDS)) return;
				if (act(b, 'recycle')) return;
			}
		} else if (dayOf(s.clock) % 7 !== 6 && !shiftBlocked(s, regionOf(b)) && tryAct(b, { t: 'job', op: 'work' })) return; // 每周休一天
	}
	const wantHome = plan.home ? getHome(plan.home) : undefined;
	const canSign = rs && wantHome
		? s.cash - moveInCost(s, wantHome) >= rs.cashReserve + wantHome.rentWeek * rs.moveInRentWeeks // 第十五轮：签完还留储备 + 两周租金
		: s.cash > (plan.rentAt ?? 400);
	if (plan.home && !s.home && !b.hobbyTraveling && canSign) {
		const want = plan.job?.loc ?? regionOf(b).spawn;
		// 租房市场（rental 批次）：先看房再递申请（固定期限）；被拒当天这套房不可申请，第二天再来
		if (s.loc === want && homesAt(s, regionOf(b)).some((o) => o.home.id === plan.home && !o.blocked)) {
			if (!viewedOk(s.rental, s.loc, plan.home, dayOf(s.clock)) && tryAct(b, { t: 'rental', op: 'inspect', home: plan.home })) return;
			if (tryAct(b, { t: 'home', op: 'rent', home: plan.home, term: 'fixed' })) return;
		}
	}
	// 租约：交入住检查报告、坏了就报修、固定期快到就续约、押金扣款有报告就申诉
	if (s.home && !s.home.owned) {
		if (!leaseBlocked(s, 'report') && tryAct(b, { t: 'rental', op: 'report' })) return;
		if (!leaseBlocked(s, 'repair') && tryAct(b, { t: 'rental', op: 'repair' })) return;
		if (s.rental.lease?.end && !leaseBlocked(s, 'renew') && tryAct(b, { t: 'rental', op: 'renew' })) return;
	}
	if (s.rental.claim && tryAct(b, { t: 'rental', op: s.rental.claim.prior ? 'dispute' : 'accept' })) return;
	// 第十五轮：偏远路线健康 / 饱食 / 精力不安全时先恢复，不去 NPC 互动、徒步、游泳、酒吧、市集
	if (rs && (s.health < 40 || s.needs.hunger < minHunger || s.needs.energy < minEnergy)) {
		if (s.needs.hunger < minHunger && s.needs.energy >= minEnergy && act(b, 'recycle')) return;
		if (act(b, 'rest')) return;
	}
	if (plan.npc && stepNpc(b)) return;
	if (plan.hobby?.mode === 'light' && stepLightHobby(b)) return;
	if (plan.hobby?.mode === 'all' && stepAllHobby(b, false)) return;

	// 第十四轮：开店前仍做当地首次体验，但每次做完至少留下独立储备；不打开买房、家具、车辆。
	if (plan.shop?.safety && !s.biz.shop) {
		const exp = experiencesAt(s, regionOf(b)).find((o) => o.first && !o.blocked && s.cash - o.exp.price >= plan.shop!.safety!.respectReserve);
		if (exp && tryAct(b, { t: 'experience', id: exp.exp.id })) return;
	}

	// 2.5 副业与小生意（只有带 side / shop 的策略）
	if ((plan.side || plan.shop) && stepBiz(b)) return;

	// 2.5 手续（第 43 批）：有收入打算的机器人顺路把落地清单上当场能办的办掉（不专门跑路、不换驾照）；
	// 合并 main 后：开户、申请 TFN 走 main 的银行和税务；关掉「房产」系统时不经清单开户（和直接开户一样归房产）
	if (plan.spend !== false && !isIdle(plan) && s.needs.energy >= 40) {
		const row = paperChecklist(s, regionOf(b)).find((x) => !x.blocked && !x.paper.id.startsWith('licence'));
		if (row && tryAct(b, { t: 'paper', id: row.paper.id })) return;
	}

	// 3. 花钱（阶段 A）：升职卡在能力上就上课；钱多就体验、买车
	if (plan.spend !== false && !isIdle(plan)) {
		if (s.job && s.cash > 600) {
			const next = getCareer(s.job.career)!.levels[s.job.level + 1];
			const lacking = SKILL_KEYS.filter((k) => (next?.req?.skills?.[k] ?? 0) > s.skills[k]);
			const course = coursesAt(s, regionOf(b)).find((o) => lacking.includes(o.course.skill) && !o.blocked);
			if (course && tryAct(b, { t: 'course', id: course.course.id })) return;
		}
		if (atHome && s.cash > 1500 && plan.swap) {
			// 二手市场对照：同样只买新品价 ≤ $500、空着的槽位，先看换手墙
			const how = plan.swap;
			const l = swapBoard(s, regionOf(b))?.listings.find((x) => x.good.kind === 'furniture' && newPrice(x.good) <= 500 && !s.home!.furniture[FURNITURE.find((f) => f.id === x.good.ref)!.slot] && !buyBlocked(s, x, how));
			if (l && tryAct(b, { t: 'swap', op: 'buy', id: l.id, ref: l.good.ref, how, haggle: how === 'pickup' })) {
				b.stats.swapBuys++;
				return;
			}
		}
		if (atHome && s.cash > 1500) {
			const f = furnitureAt(s).find((o) => !o.blocked && !s.home!.furniture[o.item.slot] && o.item.price <= 500);
			if (f && tryAct(b, { t: 'furniture', op: 'buy', id: f.item.id })) return;
		}
		if (s.cash > 2500) {
			const exp = experiencesAt(s, regionOf(b)).find((o) => o.first && !o.blocked);
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
		// 买房：首付之外还留 $3,000 周转；买了就搬进去。按揭要先开银行账户（banking.md），开户不花钱不花时间
		const house = propertiesAt(s, regionOf(b)).find((o) => !o.owned && s.cash >= o.down + 3000);
		if (house && !plan.invest && !s.bank.open && s.properties.length === 0) tryAct(b, { t: 'bank', op: 'open' });
		if (house && !plan.invest && s.properties.length === 0 && tryAct(b, { t: 'property', op: 'buy', id: house.property.id, loan: s.cash < house.property.price + 3000 })) {
			tryAct(b, { t: 'property', op: 'movein', id: house.property.id });
			b.stats.homeDay = dayOf(b.s.clock) + 1;
			return;
		}
		if (s.vehicle === 'none' && s.cash > 7000 && s.properties.length > 0) {
			const car = dealerAt(s, regionOf(b)).find((o) => o.vehicle.id === 'car' && !o.blocked);
			if (car && tryAct(b, { t: 'vehicle', op: 'buy', id: 'car' })) return;
		}
	}

	// 3.5 共同事件（第 46 轮的策略）：保命、上班、租房之后，娱乐之前
	if (plan.coop && s.needs.energy >= 35 && s.needs.hunger >= 35 && tryCoop(b)) return;
	// 3.6 运动（第 43 批）：同样排在保命、上班、租房之后
	if (plan.sport && s.needs.hunger >= 35 && trySport(b)) return;

	// 3.6 志愿者批：精力、饱食够才去，免得做完志愿饿晕
	if (plan.volunteer && s.needs.energy >= 45 && s.needs.hunger >= 40) {
		const v = volunteerAt(s, regionOf(b), simNow(s.clock)).find((o) => !o.blocked);
		if (v && tryAct(b, { t: 'volunteer', id: v.gig.id })) return;
	}

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
		const npc = npcsAt(s, regionOf(b)).find((n) => !n.blocked.chat);
		if (npc && tryAct(b, { t: 'npc', npc: npc.npc.id, act: 'chat' })) return;
		if (s.cash > 150 && (!rs || s.cash - 30 >= remoteFloor) && act(b, 'pub')) return;
	}
	if (s.needs.fun < 40) {
		if (!homeActionBlocked(s, 'relax') && tryAct(b, { t: 'home', op: 'relax' })) return;
		for (const f of ['swim', 'hike', 'market']) if ((f !== 'market' || !rs || s.cash - 15 >= remoteFloor) && act(b, f)) return;
		if (s.cash > 150 && (!rs || s.cash - 30 >= remoteFloor) && act(b, 'pub')) return;
	}
	// 背包里放点吃的
	if (!s.inventory.snack && s.cash > 100) {
		const e = shopAt(s, regionOf(b)).find((x) => x.item.id === 'snack' && !x.blocked);
		if (e && tryAct(b, { t: 'buy', item: 'snack' })) return;
	}

	// 6. 闲着：到处走或者打发时间
	if (plan.roam && b.rng() < 0.35) {
		const opts = travelOptions(s, regionOf(b)).filter((o) => o.available && o.mode !== 'air' && o.cost < s.cash * 0.3);
		if (opts.length) {
			const o = opts[Math.floor(b.rng() * opts.length)];
			if (tryAct(b, { t: 'travel', to: o.to, mode: o.mode })) return;
		}
	}
	if (s.job && s.loc === s.job.loc && act(b, 'rest')) return; // 有工作就在附近等开工
	for (const f of ['hike', 'swim', 'busk']) if (!isIdle(plan) && act(b, f)) return;
	act(b, 'rest'); // 兜底：一定能做，保证时间往前走
}

/** 补货后至少留下的现金（第十一轮 300 → 1000：维修铺原来把周租现金全压进库存，结算付不起房租被收房） */
const SHOP_RESERVE = 1000;

/** 第十四轮：开张后仍可支付初货、近期固定成本、住房、已知签证费，并保留补货储备。 */
function safeOpenAt(b: Bot): number {
	const p = b.plan.shop!;
	if (!p.safety) return p.openAt;
	const type = getShopType(p.type)!;
	const site = getShopSite(p.site)!;
	const stock = Math.min(type.maxStock, p.restockBelow * 2) * type.unitCost;
	const dummy = { type: p.type, site: p.site, day: 0, last: -1, stock: 0, staff: p.staff, tend: -1, rep: 50, debt: 0, bond: 0, hist: [] } as NonNullable<PlayerState['biz']['shop']>;
	const operating = shopDailyCost(dummy).total * 7 * p.safety.operatingWeeks;
	const home = (b.plan.home ? getHome(b.plan.home)?.rentWeek ?? 0 : 0) * p.safety.homeWeeks;
	return Math.max(p.openAt, openCost(type, site) + stock + operating + home + p.safety.visaReserve + SHOP_RESERVE);
}

/** 副业与小生意的一步：办证 → 开店、补货、雇人 → 副业。做了一件事返回 true */
function stepBiz(b: Bot): boolean {
	const s = b.s;
	const plan = b.plan;
	const shopPlan = plan.shop;
	const want = [...(plan.side?.licenses ?? []), ...(shopPlan ? ['abn', 'bizname', ...(getShopType(shopPlan.type)!.food ? [`food-${getShopSite(shopPlan.site)!.state}`] : [])] : [])];
	const readyForShop = !shopPlan || s.biz.shop || s.cash >= safeOpenAt(b);
	for (const id of want) if (readyForShop && !licenseValid(s, id) && s.cash > 400 && tryAct(b, { t: 'biz', op: 'license', id })) return true;
	if (shopPlan) {
		const site = getShopSite(shopPlan.site)!;
		if (!s.biz.shop && s.cash >= safeOpenAt(b)) {
			if (s.loc !== site.loc) return headTo(b, site.loc);
			if (shopOffersAt(s).some((o) => o.site.id === site.id && o.type.id === shopPlan.type && !o.blocked)) return tryAct(b, { t: 'biz', op: 'open', shop: shopPlan.type, site: shopPlan.site });
		}
		const shop = s.biz.shop;
		if (shop && s.loc === site.loc) {
			const can = shopActions(s, regionOf(b));
			const type = getShopType(shop.type)!;
			const target = Math.min(type.maxStock, shopPlan.restockBelow * 2);
			// 空店先停薪：保留铺租，用正式班把现金攒回“完整补货 + 一周固定成本”，再恢复雇员。
			if (shop.stock === 0 && shop.staff > 0 && !can.fire && tryAct(b, { t: 'biz', op: 'fire' })) return true;
			if (shop.stock < shopPlan.restockBelow && !can.restock && s.cash > SHOP_RESERVE) {
				const qty = Math.min(target - shop.stock, Math.floor((s.cash - SHOP_RESERVE) / type.unitCost), 1000);
				if (qty >= 1 && tryAct(b, { t: 'biz', op: 'restock', qty })) return true;
			}
			const staffed = { ...shop, staff: shopPlan.staff };
			const hireFloor = SHOP_RESERVE + shopDailyCost(staffed).total * 7;
			if (shop.staff < shopPlan.staff && shop.stock >= shopPlan.restockBelow && s.cash >= hireFloor && !can.hire && tryAct(b, { t: 'biz', op: 'hire' })) return true;
			// 不雇人的店：开张后自己店优先（第十一轮起不再上正式班），精力、饱食够就看店
			if (shopPlan.staff === 0 && !can.tend && s.needs.energy >= 45 && s.needs.hunger >= 40 && tryAct(b, { t: 'biz', op: 'tend' })) return true;
		}
	}
	if (plan.side && s.needs.energy >= 45 && s.needs.hunger >= 45) {
		for (const id of plan.side.gigs) {
			const g = gigsAt(s, regionOf(b)).find((o) => o.gig.id === id);
			if (g && !g.blocked && tryAct(b, { t: 'biz', op: 'gig', id })) return true;
		}
	}
	return false;
}

/**
 * 运动（第 43 批）：今天有能跑的比赛就跑；能报名的报名（报完手上还剩 $300）；在俱乐部所在地、会员到期就续费（同样留 $300）；
 * 能上训练课就上；准备度不到 60、今天还没练过就自己跑一次。都不做返回 false。
 */
function trySport(b: Bot): boolean {
	const s = b.s;
	const sp = b.plan.sport!;
	for (const o of racesSoon(s, regionOf(b))) {
		if (o.race.sport !== sp.sport) continue;
		if (o.startsIn === 0 && !o.raceBlocked && tryAct(b, { t: 'sport', op: 'race', id: o.race.id })) return true;
		if (o.race.fee > 0 && !o.enterBlocked && s.cash - o.fee >= 300 && tryAct(b, { t: 'sport', op: 'enter', id: o.race.id })) return true;
	}
	const club = getClub(sp.club)!;
	const c = s.sport.club;
	if (s.loc === club.loc && (!c || c.id !== club.id || c.until <= dayOf(s.clock)) && s.cash - club.fee >= 300 && tryAct(b, { t: 'sport', op: 'join', id: club.id })) return true;
	if (!clubSessionBlocked(s, regionOf(b)) && tryAct(b, { t: 'sport', op: 'club' })) return true;
	const f = s.sport.form[sp.sport];
	if (formOf(s, sp.sport) < 60 && f?.d !== dayOf(s.clock) && s.needs.energy >= 45 && act(b, 'jog')) return true;
	return false;
}

function runBot(plan: Plan, seed: number): Bot {
	const region = plan.world ? WORLD : WA;
	const s = createCharacter({ id: `sim-${plan.id}-${seed}`, name: plan.id, avatar: '🧑', origin: plan.origin, traits: plan.traits, region: region.id, spawn: region.spawn, seed });
	const b: Bot = {
		s, plan, rng: mulberry(seed * 7919),
		stats: { biz: { gigs: {}, bankrupt: 0, shopNet: 0 }, swapBuys: 0, collapses: 0, evictions: 0, evict: { first: 0, later: 0, forced: 0 }, promotions: 0, events: 0, moodSum: 0, moodN: 0, shifts: 0, daysBroke: 0, cashByDay: [s.cash], flow: {}, promoDays: [], diag: blankDiagnostics(), ill: 0, sickMin: 0, coops: 0, coopOk: 0, coopKinds: {}, visaExpiredDays: 0, ielts: 0, hobby: { respect: 0, milestones: {} }, npc: { milestones: {}, gifts: 0, giftSpend: 0, perks: 0, perkMinutes: 0, perkNeeds: {}, perkActual: {} } },
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
if (ONLY.length) {
	PLANS.push(...DIAG_PLANS); // 诊断路线只在 --only 点名时跑
	for (const list of [PLANS, ORIGIN_PLANS]) list.splice(0, list.length, ...list.filter((p) => ONLY.includes(p.id)));
}
const results: PlanResult[] = [];
const getNpcPerk = (id: string) => NPCS.find((x) => x.id === id)?.perk;
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
/** 第十一轮：收房或断供的原因拆分（只列有的策略） */
const evictRows: string[] = [];
const coopRows: string[] = [];
const volRows: string[] = [];
const taxRows: string[] = [];
const bizRows: string[] = [];
const sportRows: string[] = [];
const careerRows: string[] = [];
const healthRows: string[] = [];
const lbRows: string[] = [];
const visaRows: string[] = [];
const summary: Record<string, { netPerDay: number; collapses: number; evictions: number; promotions: number; brokeShare: number; mood: number; end: number }> = {};
const swapRows: string[] = [];
const hobbyRows: string[] = [];
const tailRows: string[] = [];
const npcRows: string[] = [];
for (const plan of BY_SWAP ? SWAP_PLANS : BY_ORIGIN ? ORIGIN_PLANS : PLANS) {
	const bots = Array.from({ length: RUNS }, (_, i) => runBot(plan, SEED_OFFSET + i + 1));
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
	{
		const resp = bots.map((b) => b.s.respect);
		const shifts = bots.map((b) => volShifts(b.s.volunteer));
		volRows.push(`| ${plan.name} | ${pct(resp, 0.5).toFixed(1)}（${pct(resp, 0.1).toFixed(1)}–${pct(resp, 0.9).toFixed(1)}） | ${level(pct(resp, 0.5)).title} | ${avg(shifts).toFixed(1)} | ${avg(bots.map((b) => b.s.volunteer.refs.length)).toFixed(1)} | ${volTier({ volunteer: { day: -1, today: [], n: { 'food-bank': pct(shifts, 0.5) }, refs: [], real: { day: -1, n: 0 } } }).name} |`);
	}
	skillRows.push([plan.name, (['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const).map((k) => Math.round(pct(bots.map((b) => b.s.skills[k]), 0.5)))]);
	const flow: Record<string, number> = {};
	for (const b of bots) for (const [k, v] of Object.entries(b.stats.flow)) flow[k] = (flow[k] ?? 0) + v / RUNS / DAYS;
	const top = Object.entries(flow).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => y[1] - x[1]);
	flows.push(`| ${plan.name} | ${top.filter(([, v]) => v > 0).map(([k, v]) => `${k} +${Math.round(v)}`).join('，') || '—'} | ${top.filter(([, v]) => v < 0).reverse().map(([k, v]) => `${k} ${Math.round(v)}`).join('，') || '—'} |`);
	{
		const withheld = bots.map((b) => (b.stats.taxReturn?.withheld ?? 0) + (b.s.tax.ret?.withheld ?? 0) + b.s.tax.book.withheld);
		const rets = bots.map((b) => b.stats.taxReturn).filter((x) => x !== undefined);
		const med = (f: (r: NonNullable<Bot['stats']['taxReturn']>) => number) => (rets.length ? money(pct(rets.map(f), 0.5)) : '—');
		taxRows.push(`| ${plan.name} | ${money(avg(withheld))} | ${rets.length}/${bots.length} | ${med((r) => r.withheld)} | ${med((r) => r.tax)} | ${med((r) => r.due)} | ${rets.length ? `第 ${pct(rets.map((r) => r.day), 0.5)} 天` : '—'} | ${money(avg(bots.map((b) => b.s.tax.debt)))} |`);
	}
	if (plan.side || plan.shop) {
		const gigText = Object.entries(bots.reduce((acc, b) => { for (const [k, v] of Object.entries(b.stats.biz.gigs)) acc[k] = (acc[k] ?? 0) + v / RUNS; return acc; }, {} as Record<string, number>)).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('，') || '—';
		const opened = bots.map((b) => b.stats.biz.openDay).filter((d): d is number => d !== undefined);
		const stillOpen = bots.filter((b) => b.s.biz.shop).length;
		bizRows.push(`| ${plan.name} | ${gigText} | ${plan.shop ? `${opened.length}/${RUNS}${opened.length ? `，第 ${pct(opened, 0.5)} 天` : ''}` : '—'} | ${plan.shop ? `${stillOpen}/${RUNS}` : '—'} | ${plan.shop ? avg(bots.map((b) => b.stats.biz.bankrupt)).toFixed(2) : '—'} | ${plan.shop ? money(avg(bots.map((b) => b.stats.biz.shopNet / DAYS))) : '—'} | ${bots.filter((b) => b.s.biz.gst).length}/${RUNS} | ${money(pct(bots.map((b) => b.s.biz.book.gross), 0.5))} |`);
	}
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
	if (BY_SWAP) {
		const furn = pct(bots.map((b) => Object.keys(b.s.home?.furniture ?? {}).length), 0.5);
		const swapFlow = bots.reduce((n, b) => n + (b.stats.flow.swap ?? 0), 0) / RUNS;
		swapRows.push(`| ${plan.name} | ${avg(bots.map((b) => b.stats.swapBuys)).toFixed(2)} | ${money(Math.abs(swapFlow))} | ${avg(bots.map((b) => b.s.swap.dodged)).toFixed(2)} | ${avg(bots.map((b) => b.s.swap.lost)).toFixed(2)} | ${money(Math.abs(bots.reduce((n, b) => n + (b.stats.flow['furniture-buy'] ?? 0), 0) / RUNS))} | ${furn} |`);
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
	if (ev > 0) {
		const e = (k: 'first' | 'later' | 'forced') => avg(bots.map((b) => b.stats.evict[k])).toFixed(2);
		evictRows.push(`| ${plan.name} | ${e('first')} | ${e('later')} | ${e('forced')} | ${ev.toFixed(2)} |`);
	}
	if (plan.job) {
		// 第十三轮：Task 2 门槛只看中位，这里补尾部。没达到的种子算在线外
		const tri = (xs: number[]) => (xs.length ? `${pct(xs, 0.1)} / ${pct(xs, 0.5)} / ${pct(xs, 0.9)}` : '—');
		const share = (n: number) => `${Math.round((n / RUNS) * 100)}%`;
		const p1 = nth(0), p2 = nth(1);
		const homes = bots.map((b) => b.stats.homeDay).filter((x): x is number => x !== undefined);
		tailRows.push(`| ${plan.name} | ${tri(p1)} | ${share(RUNS - p1.filter((d) => d <= 15).length)} | ${tri(p2)} | ${share(p2.filter((d) => d < 30).length)} / ${share(RUNS - p2.filter((d) => d <= 60).length)} | ${homes.length ? `${homes.length}，${tri(homes)}` : '—'} | ${homes.length ? share(RUNS - homes.filter((d) => d <= 98).length) : '—'} |`);
	}
	if (plan.npc) {
		const n = (f: (x: Bot['stats']['npc']) => number) => avg(bots.map((b) => f(b.stats.npc)));
		const ms = (k: '30' | '60' | '90') => { const d = bots.map((b) => b.stats.npc.milestones[k]).filter((x): x is number => x !== undefined); return d.length ? `${d.length}，${pct(d, 0.1)} / ${pct(d, 0.5)} / ${pct(d, 0.9)}` : '0，—'; };
		// 实际净增只列 perk 写了的那几项（别的需求在互动耗时里照常衰减，不算 perk 的账）
		const NEED_NAMES: Record<string, string> = { hunger: '饱食', energy: '精力', social: '社交', fun: '娱乐', hygiene: '卫生' };
		const perkKeys = Object.keys(getNpcPerk(plan.npc.id)?.fx.needs ?? {});
		const needs = (key: 'perkNeeds' | 'perkActual') => perkKeys.map((k) => [k, avg(bots.map((b) => b.stats.npc[key][k] ?? 0))] as const).filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `${NEED_NAMES[k] ?? k} ${Math.round(v)}`).join('，') || '—';
		const gift = { none: '不送礼', perk: '只用 perk', love: '最爱', cheap: '便宜礼物' }[plan.npc.gift];
		npcRows.push(`| ${plan.name} | ${NPCS.find((x) => x.id === plan.npc!.id)?.name ?? plan.npc.id} · ${gift} | ${ms('30')} | ${ms('60')} | ${ms('90')} | ${n((x) => x.gifts).toFixed(1)} / ${money(n((x) => x.giftSpend))} | ${n((x) => x.perks).toFixed(1)} / ${(n((x) => x.perkMinutes) / 60).toFixed(1)} 小时 | ${needs('perkNeeds')} | ${needs('perkActual')} |`);
	}
	if (plan.hobby) {
		const days = (xs: (number | undefined)[]) => { const d = xs.filter((x): x is number => x !== undefined); return d.length ? `${d.length}，${pct(d, 0.1)} / ${pct(d, 0.5)} / ${pct(d, 0.9)}` : '0，—'; };
		const resp = bots.map((b) => b.stats.hobby.respect);
		const books = Object.entries(REWARD_BOOKS).map(([id, name]) => `${name} ${days(bots.map((b) => b.stats.hobby.milestones[`${id}:half`]))} · ${days(bots.map((b) => b.stats.hobby.milestones[`${id}:full`]))}`).join('；');
		hobbyRows.push(`| ${plan.name} | ${pct(resp, 0.1)} / ${pct(resp, 0.5)} / ${pct(resp, 0.9)} | ${days(bots.map((b) => b.stats.hobby.thresholdDay))} | ${books} |`);
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
			collapses: coll, evictions: ev, evictFirst: avg(bots.map((b) => b.stats.evict.first)), evictLater: avg(bots.map((b) => b.stats.evict.later)), forcedSales: avg(bots.map((b) => b.stats.evict.forced)), promotions: pr, promo1Day: nth(0).length ? pct(nth(0), 0.5) : null, promo2Day: nth(1).length ? pct(nth(1), 0.5) : null,
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
out('## 收房或断供的原因');
out();
out('按状态变化计（第十一轮起）：租着的住处没了算收房，房产少了又不是自己卖的算断供强制卖房。首个结算期 = 租约还没过第一个结算日。');
out();
if (evictRows.length) {
	out('| 策略 | 首个结算期被收房/人 | 之后被收房/人 | 断供强制卖房/人 | 合计/人 |');
	out('| --- | --- | --- | --- | --- |');
	for (const row of evictRows) out(row);
} else out('所有策略都没有被收房或断供。');
out();
if (hobbyRows.length) {
	out('## 爱好收集册声望（第十二轮）');
	out();
	out('六本收集册各发一次：收到一半 +2、收齐 +5，最多 42，店长要 25。天数写「人数，P10 / 中位 / P90」，人数是期内拿到的种子数，分位数只在拿到的人里算。每本写「收到一半 · 收齐」。');
	out();
	out('| 策略 | 爱好声望 P10 / 中位 / P90 | 爱好声望到 25 | 各册 |');
	out('| --- | --- | --- | --- |');
	for (const row of hobbyRows) out(row);
	out();
}
if (npcRows.length) {
	out('## NPC 送礼与专属互动（第十三轮）');
	out();
	out('目标 NPC 在场时先用到期的专属互动（perk），再送礼到 90 好感。好感天数写「人数，P10 / 中位 / P90」，只在达到的种子里算。perk 需求：配置是次数 × 数据里的值，实际是扣掉耗时衰减和 100 上限后的净增。净资产、心情、升职看主表同名行。');
	out();
	out('| 策略 | NPC · 送法 | 到 30 | 到 60 | 到 90 | 礼物件数 / 零售价（每人） | perk 次数 / 时间（每人） | perk 需求（配置） | perk 需求（实际） |');
	out('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const row of npcRows) out(row);
	out();
}
if (tailRows.length) {
	out('## 升职与买房的尾部（第十三轮）');
	out();
	out('Task 2 门槛按中位判；这里看有多少种子落在线外。分位数写 P10 / 中位 / P90；没升职或没买房的种子算在线外。买房一栏写「买了的人数，P10 / 中位 / P90」。');
	out();
	out('| 策略 | 第 1 次升职 | 晚于第 15 天 | 第 2 次升职 | 早于第 30 / 晚于第 60 天 | 买房 | 晚于第 98 天 |');
	out('| --- | --- | --- | --- | --- | --- | --- |');
	for (const row of tailRows) out(row);
	out();
}
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
out('## 志愿与声望');
out();
out('期末声望中位数（10%–90%）、对应的声望等级称号、人均志愿次数和推荐信封数、志愿次数中位数对应的社区信誉档（见 docs/earth-game/volunteer.md）。');
out();
out('| 策略 | 期末声望 | 声望等级 | 志愿次数/人 | 推荐信/人 | 社区信誉（中位） |');
out('| --- | --- | --- | --- | --- | --- |');
for (const row of volRows) out(row);
out();
out('## 税务（税务分支）');
out();
out('机器人（对照组除外）开局网上申请 TFN，有待申报的税表就报。第 1 财年 = 第 1–112 天，报税期第 113–140 天。退补列负数为退税。规则见 docs/earth-game/tax.md。');
out();
out('| 策略 | 期末累计预扣/人 | 报过税的人 | 第 1 财年已预扣（中位） | 应纳税（中位） | 退(−)/补(+)（中位） | 报税日（中位） | 期末欠税/人 |');
out('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of taxRows) out(row);
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
if (BY_SWAP) {
	out('## 二手市场对照（--swap）');
	out();
	out('三组都是咖啡店策略，只差买家具时先不先看换手墙（同样只买新品价 ≤ $500 的空槽位）。「下单」含被骗和识破；花费是每人整段时间的合计。');
	out();
	out('| 策略 | 换手墙下单/人 | 换手墙花费/人 | 识破骗局/人 | 被骗/人 | 新家具花费/人 | 期末家具件数（中位） |');
	out('| --- | --- | --- | --- | --- | --- | --- |');
	for (const row of swapRows) out(row);
	out();
}
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
