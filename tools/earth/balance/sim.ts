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
//   --long                  第十八轮长线哨兵：十部门代表路线，默认 365 天 × 100 种子
//   --risk                  第二十轮风险尾部：同十部门、默认 365 天 × 100 种子；输出逐种子风险指标
//   --switch                第十九轮转行哨兵：咖啡→IT、矿工跨城换岗，默认仍不增加路线
//   --edu                   第二十一轮进修回报：正式项目与技能活动同种子配对，默认 365 天 × 100 种子
//   --visa                  第二十二轮签证哨兵：十部门留学生，默认 365 天 × 100 种子；输出逐种子路线、费用和失去工作权天数
//   --housing               第二十三轮住房哨兵：十部门 + 库伯佩迪地点哨兵 × 租住 / 自住 / 出租 / 第二套房，默认 365 天 × 100 种子
//   npm run earth:sim -- --swap        二手市场对照：咖啡店策略 × 买家具不走 / 走换手墙看货 / 走换手墙先转账
import { writeFileSync } from 'node:fs';
import { averageEco, blankEco, parseSystems, recordEco, SYSTEMS, systemOf, type EcoStats } from './systems.ts';
import { ecoMarkdown, toCsv, toJson, type PlanResult, type SimResult } from './report.ts';
import { applyAction, applyCoop, type GameAction } from '../../../src/game/core/actions.ts';
import { coopBlocked, coopsAt } from '../../../src/game/core/coop.ts';
import { decayMult, mood } from '../../../src/game/core/attributes.ts';
import { createCharacter, ORIGINS } from '../../../src/game/core/character.ts';
import {
	activitiesAt, careAt, careerPay, careersAt, certsAt, coursesAt, coursePrice, dealerAt, DECAY, fishingAt, netWorth, propertiesAt, furnitureAt, getHome, getLocation, getProperty, homeActionBlocked, experiencesAt, getCareer, getPendingEvent, homesAt, leaseBlocked, moveInCost, npcsAt, shiftBlocked, shopAt, travelOptions,
} from '../../../src/game/core/engine.ts';
import { homeLoanOffer } from '../../../src/game/core/bank.ts';
import { downPayment } from '../../../src/game/core/finance.ts';
import { getProgram, programsAt } from '../../../src/game/core/education.ts';
import { dayOf, hourOf } from '../../../src/game/core/time.ts';
import { assess, taxStatus, tfnState } from '../../../src/game/core/tax.ts';
import { cookBlocked, groceriesAt, hostBlocked, kitchenLevel, pantryTotal, recipeKnown } from '../../../src/game/core/cooking.ts';
import { RECIPES } from '../../../src/game/data/cooking.ts';
import { viewedOk } from '../../../src/game/core/rental.ts';
import { weatherAt } from '../../../src/game/core/weather.ts';
import { choreDone, dutyFor, flatChoiceBlocked, getFlatEvent } from '../../../src/game/core/flatmates.ts';
import { choreBlocked } from '../../../src/game/core/flat-actions.ts';
import { currentIllness, illnessBlock, loadOfEffect } from '../../../src/game/core/health.ts';
import { debtNow } from '../../../src/game/core/sleep.ts';
import { workStopped } from '../../../src/game/core/disasters.ts';
import { GOOD_BONUS } from '../../../src/game/data/careers.ts';
import { SKILL_KEYS } from '../../../src/game/core/types.ts';
import { careerSummary, earnedOf, spentOf } from '../../../src/game/core/tally.ts';
import type { PlayerState, Region, SkillKey } from '../../../src/game/core/types.ts';
import { WA, WORLD } from '../../../src/game/data/wa.ts';
import { paperChecklist, paperDone } from '../../../src/game/core/paperwork.ts';
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
import { ACTIVITIES } from '../../../src/game/data/activities.ts';
import { CERTS } from '../../../src/game/data/certs.ts';
import { COURSES } from '../../../src/game/data/courses.ts';
import { PROGRAMS } from '../../../src/game/data/education.ts';
import { PROPERTIES } from '../../../src/game/data/properties.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const RISK = process.argv.includes('--risk');
/** 第二十一轮：同种子进修做 / 不做配对。 */
const BY_EDU = process.argv.includes('--edu');
/** 第二十二轮：十部门留学生签证路径。 */
const BY_VISA = process.argv.includes('--visa');
/** 第二十三轮：同部门、同种子的住房路径配对。 */
const BY_HOUSING = process.argv.includes('--housing');
const HOUSING_STRATEGY = arg('housing-strategy', '');
const VISA_STRATEGY = arg('visa-strategy', 'focus');
const VISA_FOCUS = BY_VISA && VISA_STRATEGY === 'focus';
const LONG = process.argv.includes('--long') || RISK || BY_EDU || BY_VISA || BY_HOUSING;
const DAYS = Number(arg('days', LONG ? '365' : '60'));
const RUNS = Number(arg('runs', LONG ? '100' : '40'));
const SEED_OFFSET = Number(arg('seed-offset', '0'));
const OUT = arg('out', '');
const BY_ORIGIN = process.argv.includes('--origins');
const BY_MATRIX = process.argv.includes('--matrix');
const BY_SWITCH = process.argv.includes('--switch');
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
if (BY_VISA && !['focus', 'legacy'].includes(VISA_STRATEGY)) {
	console.error('--visa-strategy 只能是 focus 或 legacy');
	process.exit(2);
}
const HOUSING_VARIANTS = ['room', 'upgrade', 'cash-home', 'loan-home', 'rental', 'second', 'savings'] as const;
type HousingVariant = typeof HOUSING_VARIANTS[number];
if (BY_HOUSING && HOUSING_STRATEGY && !HOUSING_VARIANTS.includes(HOUSING_STRATEGY as HousingVariant)) {
	console.error(`--housing-strategy 只能是 ${HOUSING_VARIANTS.join('、')}`);
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
	/** 第二十三轮：为买异地第二套房而进行的往返。 */
	housingTrip?: { property: string; returnLoc: string };
	/** 第十四轮：保守漫游最近一次出发日 */
	safeRoamDay?: number;
	/** 第十九轮：每个机器人的转行 / 换岗状态。 */
	transition?: {
		activated: boolean; sourceLevel: number; sourceTop: boolean;
		hireDay?: number; firstPromoDay?: number; topDay?: number;
		relocationCost: number; relocationComplete: boolean;
	};
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
		/** 第十六轮：首次入职的绝对游戏日 */
		jobDay?: number;
		events: number;
		moodSum: number;
		moodN: number;
		/** 第十八轮：每个游戏日跨日后的长线快照；索引 0 是创角时。 */
		moodByDay: number[];
		moodLateSum: number;
		moodLateN: number;
		moodLateBins: { sum: number; n: number }[];
		worthByDay: number[];
		collapsesByDay: number[];
		evictionsByDay: number[];
		visaExpiredByDay: number[];
		/** 第 181 天起成功动作的次数与游戏分钟，用来识别“到顶后没事可做”。 */
		lateActions: Record<string, number>;
		lateActionMinutes: Record<string, number>;
		visaTransitions: { day: number; from: string; to: string }[];
		visaApplications: { day: number; route: string; from: string; to: string; fee: number }[];
		shifts: number;
		daysBroke: number;
		cashByDay: number[];
		flow: Record<string, number>;
		promoDays: number[];
		homeDay?: number;
		homeUpgradeDay?: number;
		/** 第二十三轮：购房动作的逐套审计记录。 */
		propertyBuys: { day: number; id: string; use: 'self' | 'rental'; cashBefore: number; worthBefore: number }[];
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
		/** 第二十轮：职业风险尾部。只在 --risk 输出，但始终采集，保证开关不改变行为。 */
		risk: RiskStats;
		/** 第二十一轮进修回报：每项进修的次数、直接费用、时间和首末日。 */
		edu: Record<string, { actions: number; spend: number; minutes: number; firstDay: number; lastDay: number }>;
	};
	/** 排行榜（排行榜第一版）：每个成功动作后按服务端同一个函数算榜单记录，看异常值复核线会不会误伤正常玩法 */
	lb: { e: LbEntry; now: number; max: Record<LbStatKey, number>; holds: number; why: string[] };
}

interface RiskDay {
	day: number;
	scheduled: boolean;
	career?: string;
	pay: number;
	worked: boolean;
	stop: boolean;
	sick: boolean;
	collapse: boolean;
}

interface RiskStats {
	day: RiskDay | null;
	workStopDays: number;
	sickLeaveDays: number;
	collapseDays: number;
	lastCollapseDay: number;
	scheduledDays: number;
	missedRiskGross: number;
	workStopLostGross: number;
	sickLostGross: number;
	collapseLostGross: number;
	goodShifts: number;
	badShifts: number;
	jobGross: number;
	bonusGross: number;
	bonusForegone: number;
	careCashLoss: number;
	jobLosses: number;
	demotions: number;
	minMood: number;
	minHealth: number;
	maxSleepDebt: number;
	sleepDebtDays: number;
	poorSleeps: number;
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
/** 第二十一轮：只影响 sim 机器人；游戏规则仍允许玩家自行选择。 */
const AUTO_ENTRY_CERT_BY_PLAN: Record<string, { id: string; reserve: number }> = {
	barista: { id: 'barista-cert', reserve: 200 },
	miner: { id: 'mine-induction', reserve: 200 },
	bartender: { id: 'rsa', reserve: 200 },
};
/** 只校正默认代表机器人；错配出身矩阵保持原策略。入门准备也不受此表影响。 */
const SKIP_PROMOTION_COURSES_BY_PLAN: Record<string, readonly string[]> = {
	barista: ['networking'],
	lifeguard: ['surf-school'],
	carer: ['networking'],
};
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
	/**
	 * 第十六轮：入职前补能力 / 证书 / 学历；入职后补下一档要求的学历。
	 * 现金低于 cashReserve 时先做 preferredGigs，避免未入职的长期课程把现金耗尽。
	 */
	careerPrep?: {
		entrySkills?: Partial<Record<SkillKey, number>>;
		/** 第十七轮：需要先租房办地址时，也可先在出生地补完这些能力。 */
		preHomeSkills?: boolean;
		entryPapers?: string[];
		entryCerts?: string[];
		entryPrograms?: string[];
		promotionPrograms?: string[];
		cashReserve?: number;
		preferredGigs?: readonly (typeof GIG_IDS)[number][];
		minHunger?: number;
		minEnergy?: number;
		/** 证件需要地址时，先去工作地租房，再回来继续入门准备。 */
		allowHomeBeforeEntry?: boolean;
	};
	/** 想租的房型（在工作地点或出生点） */
	home?: string;
	/** 长线机器人：到顶且至少运行 112 天后，无房产时升级租住。 */
	postTopHome?: string;
	/** 第二十三轮 --housing 专项；不挂配置时，默认机器人行为逐字不变。 */
	housing?: {
		pair: string;
		variant: HousingVariant;
		property: string;
		second?: string;
	};
	/** 第十九轮：到指定日辞去原职，再按目标配置应聘。只由 --switch 使用。 */
	transition?: {
		kind: 'career' | 'transfer';
		day: number;
		to: {
			job: { loc: string; career: string };
			careerPrep?: Plan['careerPrep']; home?: string; postTopHome?: string;
			rentAt?: number; remoteSafety?: Plan['remoteSafety']; spend?: boolean;
		};
	};
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
	npc?: { id: string; gift: 'none' | 'perk' | 'love' | 'cheap' };
	/** 第二十一轮进修回报元数据与行为开关。 */
	education?: EducationExperiment;
}

interface EducationExperiment {
	pair: string;
	variant: 'base' | 'do' | 'without' | 'activity' | 'free' | 'free-price' | 'self-funded' | 'no-cap';
	item?: string;
	/** 在应聘前、当前地点能上课时先拿证。 */
	forceCert?: string;
	/** 创角时注入证书 / 学历，量“门槛与费用全部拿掉”的上限。 */
	freeAwards?: string[];
	/** 禁止机器人使用这门技能课；afterHire 仍允许入职准备使用。 */
	blockCourse?: string;
	blockCourseAfterHire?: string;
	/** 禁用 course 后，在升职缺对应能力时主动做这个活动。 */
	replaceCourseWithActivity?: { course: string; activity: string };
	/** 留学生签证自动毕业仍保留签证学历，但不把 bachelor 送进职业证书。 */
	suppressVisaBachelor?: boolean;
	/** 上课后退还这门项目的学费；课程、能力、声望和耗时完全保留。 */
	refundProgram?: string;
	/** 只在反事实中让正式工作不受显式学业的 48 小时 / 两周上限；学习进度照常保留。 */
	noStudentWorkCap?: boolean;
}

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
	{ id: 'farmhand', name: '农场工（玛格丽特河，合租）', origin: 'backpacker', traits: ['athletic', 'tough'], job: { loc: 'margaret-river', career: 'farmhand' }, home: 'room', postTopHome: 'flat', rentAt: 700 },
	{ id: 'farmhand-fifo', name: 'FIFO 农场工（玛格丽特河，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'margaret-river', career: 'farmhand' }, home: 'room', postTopHome: 'flat', rentAt: 700 },
	// 第十六轮：补齐此前没有 sim 路线的五个职业。careerPrep 的实现规格见本轮 balance.md。
	{ id: 'guide', name: '导游（玛格丽特河，合租）', origin: 'backpacker', traits: ['loner', 'frugal'], job: { loc: 'margaret-river', career: 'guide' }, home: 'room', postTopHome: 'flat', rentAt: 700 },
	{
		id: 'trucker', name: '卡车司机（卡尔古利，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'trucker' }, home: 'room',
		careerPrep: { entrySkills: { driving: 20 }, entryPapers: ['address', 'licence-theory', 'licence'], entryCerts: ['hr-licence'], cashReserve: 1000, preferredGigs: ['work-mine', 'work-cafe'], minHunger: 70, minEnergy: 75, allowHomeBeforeEntry: true },
	},
	{
		id: 'builder', name: '建筑工（卡尔古利，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'builder' }, home: 'room',
		careerPrep: { entryCerts: ['white-card'] },
	},
	{
		id: 'carer', name: '护理员（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'carer' }, home: 'room',
		careerPrep: { entryCerts: ['first-aid'], promotionPrograms: ['cert3-support'], cashReserve: 500, preferredGigs: ['work-cafe'] }, rentAt: 700,
	},
	{
		id: 'it-support', name: 'IT 支持（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'it-support' }, home: 'room',
		careerPrep: { entryPrograms: ['english-class', 'cert4-it'], cashReserve: 500, preferredGigs: ['work-cafe'] },
	},
	{
		id: 'it-support-backpacker', name: '非留学生 IT 支持（珀斯，自己读本科）', origin: 'backpacker', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'it-support' }, home: 'room',
		careerPrep: { entrySkills: { street: 18 }, entryPrograms: ['english-class', 'cert4-it'], promotionPrograms: ['bachelor'], cashReserve: 500, preferredGigs: ['work-cafe'] }, rentAt: 700, remoteSafety: REMOTE_SAFETY,
	},
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

/** 第十七轮：部门 × 出身矩阵（--matrix，不进默认报告）。十个部门固定代表路线，只替换出身；非留学生 IT 自读学士。 */
const MATRIX_IDS = ['barista', 'lifeguard', 'guide', 'miner', 'trucker', 'bartender', 'farmhand', 'builder', 'carer', 'it-support'];
const MATRIX_PLANS: Plan[] = MATRIX_IDS.flatMap((id) => {
	const base = PLANS.find((p) => p.id === id)!;
	return ORIGINS.map((origin) => {
		const entrySkills: Partial<Record<SkillKey, number>> | undefined = id === 'lifeguard' ? { swimming: 25 }
			: id === 'miner' ? { strength: 20 }
			: id === 'trucker' && origin.id !== 'fifo' ? { strength: 20, driving: 20 }
			: id === 'builder' && origin.id !== 'fifo' ? { strength: 35, stamina: 20 }
			: id === 'carer' && origin.id !== 'student' ? { charisma: 30 }
			: id === 'farmhand' && origin.id === 'student' ? { stamina: 15 }
			: id === 'it-support' && origin.id !== 'student' ? { street: 18 }
			: base.careerPrep?.entrySkills;
		const needsPrep = !!base.careerPrep || !!entrySkills || (id === 'it-support' && origin.id !== 'student');
		const careerPrep = needsPrep ? {
			...(base.careerPrep ?? {}),
			...(entrySkills ? { entrySkills } : {}),
			...((id === 'lifeguard' || id === 'miner' || id === 'builder' || id === 'farmhand') ? { cashReserve: 200, preferredGigs: ['work-cafe'] as const, minHunger: 70, minEnergy: 75 } : {}),
			...(id === 'trucker' && origin.id !== 'fifo' ? { preHomeSkills: true } : {}),
			...(id === 'carer' && origin.id !== 'student' ? { minEnergy: 75 } : {}),
			...(id === 'carer' && origin.id === 'backpacker' ? { cashReserve: 400 } : {}),
			...(id === 'it-support' && origin.id !== 'student' ? { promotionPrograms: ['bachelor'] } : {}),
		} : undefined;
		return {
			...base,
			id: `mx-${id}-${origin.id}`,
			name: `${base.job!.career} × ${origin.name}`,
			origin: origin.id,
			careerPrep,
			...(base.home === 'room' && (origin.id === 'backpacker' || origin.id === 'surfer') && (base.rentAt ?? 400) < 700 ? { rentAt: 700 } : {}),
			...(((origin.id === 'backpacker' || origin.id === 'surfer') || (id === 'lifeguard' && origin.id === 'fifo')) && base.home ? { remoteSafety: REMOTE_SAFETY } : {}),
		};
	});
});

/**
 * 第二十三轮 --housing 住房路线。所有路线固定先租合租房间，只替换住房决策；`savings` 是 3% 高息储蓄的机会成本对照。
 * 第二套房必须亲自到异地成交，再挂牌出租并回工作地；地图上每个代表工作地只有一套可买房，不能在原地重复买。
 */
const HOUSING_BASES: { pair: string; base: Plan }[] = [
	...MATRIX_IDS.map((id) => ({ pair: id, base: PLANS.find((p) => p.id === id)! })),
	{ pair: 'miner-coober', base: PLANS.find((p) => p.id === 'miner-coober-dugout')! },
];
const SECOND_PROPERTY_BY_LOC: Record<string, string> = {
	perth: 'kal-cottage',
	kalgoorlie: 'perth-apartment',
	'margaret-river': 'kal-cottage',
	'coober-pedy': 'kal-cottage',
};
const UPGRADE_HOME_BY_LOC: Record<string, string> = {
	perth: 'flat',
	'margaret-river': 'flat',
	'coober-pedy': 'dugout',
};
const HOUSING_LABEL: Record<HousingVariant, string> = {
	room: '一直合租', upgrade: '到顶后升级租房', 'cash-home': '全款自住', 'loan-home': '按揭自住',
	rental: '按揭买房出租', second: '按揭自住 + 异地第二套出租', savings: '一直合租 + 高息储蓄',
};
const HOUSING_PAIR_LABEL: Record<string, string> = {
	barista: '咖啡', lifeguard: '救生', guide: '导游', miner: '矿工', trucker: '卡车', bartender: '酒吧',
	farmhand: '农场', builder: '建筑', carer: '护理', 'it-support': 'IT', 'miner-coober': '库伯佩迪矿工',
};
const HOUSING_PLANS: Plan[] = HOUSING_BASES.flatMap(({ pair, base }) => {
	const property = PROPERTIES.find((p) => p.loc === base.job?.loc);
	if (!property) throw new Error(`住房哨兵 ${pair} 的工作地 ${base.job?.loc} 没有可买房产`);
	return HOUSING_VARIANTS.map((variant) => {
		const clone = structuredClone(base);
		return {
			...clone,
			id: `housing-${pair}-${variant}`,
			name: `${HOUSING_PAIR_LABEL[pair] ?? pair} · ${HOUSING_LABEL[variant]}`,
			home: 'room',
			postTopHome: variant === 'upgrade' ? UPGRADE_HOME_BY_LOC[property.loc] : undefined,
			invest: variant === 'savings' ? { asset: 'savings', keep: 3000 } : undefined,
			housing: { pair, variant, property: property.id, second: variant === 'second' ? SECOND_PROPERTY_BY_LOC[property.loc] : undefined },
		};
	});
});

/** 第二十一轮 /tmp 实验路线：十部门基线 + 20 项正式进修的代表性同种子反事实。 */
const eduClone = (baseId: string, suffix: string, cfg: EducationExperiment, amend: Partial<Plan> = {}): Plan => {
	const base = structuredClone(PLANS.find((p) => p.id === baseId)!);
	return { ...base, ...amend, id: `edu-${baseId}-${suffix}`, name: `${base.job?.career ?? baseId} · ${suffix}`, education: cfg };
};
const EDU_PLANS: Plan[] = [
	...MATRIX_IDS.map((id) => eduClone(id, 'base', { pair: id, variant: 'base' })),
	// 六张纯加薪证：在应聘前拿证，比较“先投资”与原策略从不拿证。
	eduClone('barista', 'cert-barista', { pair: 'barista', variant: 'do', item: 'cert:barista-cert', forceCert: 'barista-cert' }),
	eduClone('lifeguard', 'cert-bronze', { pair: 'lifeguard', variant: 'do', item: 'cert:bronze-medallion', forceCert: 'bronze-medallion' }),
	eduClone('guide', 'cert-wilderness', { pair: 'guide', variant: 'do', item: 'cert:wilderness-first-aid', forceCert: 'wilderness-first-aid' }),
	eduClone('miner', 'cert-mine', { pair: 'miner', variant: 'do', item: 'cert:mine-induction', forceCert: 'mine-induction' }),
	eduClone('bartender', 'cert-rsa', { pair: 'bartender', variant: 'do', item: 'cert:rsa', forceCert: 'rsa' }),
	eduClone('farmhand', 'cert-tractor', { pair: 'farmhand', variant: 'do', item: 'cert:tractor-ticket', forceCert: 'tractor-ticket' }),
	// 三张入行证：免费注入，量原价与 7.5–8 小时课对入职的最大拖慢。
	eduClone('trucker', 'free-hr', { pair: 'trucker', variant: 'free', item: 'cert:hr-licence', freeAwards: ['hr-licence'] }),
	eduClone('builder', 'free-white-card', { pair: 'builder', variant: 'free', item: 'cert:white-card', freeAwards: ['white-card'] }),
	eduClone('carer', 'free-first-aid', { pair: 'carer', variant: 'free', item: 'cert:first-aid', freeAwards: ['first-aid'] }),
	// 四个长项目：免费注入单个 award；其余前置与项目保留。
	eduClone('it-support', 'free-english', { pair: 'it-support', variant: 'free', item: 'program:english-class', freeAwards: ['english'] }),
	eduClone('it-support', 'free-cert4', { pair: 'it-support', variant: 'free', item: 'program:cert4-it', freeAwards: ['cert4-it'] }),
	eduClone('carer', 'free-cert3', { pair: 'carer', variant: 'free', item: 'program:cert3-support', freeAwards: ['cert3-support'] }),
	eduClone('it-support', 'free-bachelor', { pair: 'it-support', variant: 'free', item: 'program:bachelor', freeAwards: ['bachelor'] }),
	// 七门技能课：禁用该课，保留活动与其他课，量机器人真实会不会用、用了是否有净收益。
	eduClone('trucker', 'without-driving', { pair: 'trucker', variant: 'without', item: 'course:driving-school', blockCourseAfterHire: 'driving-school' }),
	eduClone('lifeguard', 'without-surf', { pair: 'lifeguard', variant: 'without', item: 'course:surf-school', blockCourse: 'surf-school' }),
	eduClone('miner', 'without-trainer', { pair: 'miner', variant: 'without', item: 'course:personal-trainer', blockCourse: 'personal-trainer' }),
	eduClone('farmhand', 'without-run-club', { pair: 'farmhand', variant: 'without', item: 'course:run-club', blockCourse: 'run-club' }),
	eduClone('barista', 'without-networking', { pair: 'barista', variant: 'without', item: 'course:networking', blockCourse: 'networking' }),
	eduClone('guide', 'without-bushcraft', { pair: 'guide', variant: 'without', item: 'course:bushcraft', blockCourse: 'bushcraft' }),
	eduClone('bartender', 'without-negotiation', { pair: 'bartender', variant: 'without', item: 'course:negotiation', blockCourse: 'negotiation' }),
	eduClone('lifeguard', 'without-run-club', { pair: 'lifeguard', variant: 'without', item: 'course:run-club', blockCourse: 'run-club' }),
	eduClone('bartender', 'without-networking', { pair: 'bartender', variant: 'without', item: 'course:networking', blockCourse: 'networking' }),
	eduClone('carer', 'without-networking', { pair: 'carer', variant: 'without', item: 'course:networking', blockCourse: 'networking' }),
	// 非留学生本科与留学生“签证不送职业本科”的公平性反事实。
	eduClone('it-support-backpacker', 'base', { pair: 'it-support-backpacker', variant: 'base' }),
	eduClone('it-support-backpacker', 'free-bachelor', { pair: 'it-support-backpacker', variant: 'free', item: 'program:bachelor', freeAwards: ['bachelor'] }),
	eduClone('it-support', 'self-funded-bachelor', { pair: 'it-support', variant: 'self-funded', item: 'program:bachelor', suppressVisaBachelor: true }, {
		careerPrep: { ...structuredClone(PLANS.find((p) => p.id === 'it-support')!.careerPrep!), promotionPrograms: ['bachelor'] },
	}),
	// 只把项目学费归零，保留全部课时、能力和声望，隔离价格负担。
	eduClone('it-support', 'free-price-english', { pair: 'it-support', variant: 'free-price', item: 'program:english-class', refundProgram: 'english-class' }),
	eduClone('it-support', 'free-price-cert4', { pair: 'it-support', variant: 'free-price', item: 'program:cert4-it', refundProgram: 'cert4-it' }),
	eduClone('carer', 'free-price-cert3', { pair: 'carer', variant: 'free-price', item: 'program:cert3-support', refundProgram: 'cert3-support' }),
	eduClone('it-support-backpacker', 'free-price-bachelor', { pair: 'it-support-backpacker', variant: 'free-price', item: 'program:bachelor', refundProgram: 'bachelor' }),
	// 学生限工的单因素反事实：项目照读，只让正式班不受 48 小时 / 两周限制。
	eduClone('carer', 'no-student-cap', { pair: 'carer', variant: 'no-cap', noStudentWorkCap: true }),
	eduClone('it-support', 'no-student-cap', { pair: 'it-support', variant: 'no-cap', noStudentWorkCap: true }),
	// 代表地点碰不到的两门课：加地点 / 出身匹配的小样路线，避免把“机器人没遇到”误判成“规则无用途”。
	eduClone('builder', 'perth-student-base', { pair: 'builder-perth-student', variant: 'base' }, {
		origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'builder' }, home: 'room', careerPrep: { entryCerts: ['white-card'] },
	}),
	eduClone('builder', 'perth-student-without-trainer', { pair: 'builder-perth-student', variant: 'without', item: 'course:personal-trainer', blockCourse: 'personal-trainer' }, {
		origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'builder' }, home: 'room', careerPrep: { entryCerts: ['white-card'] },
	}),
	eduClone('builder', 'perth-student-without-run-club', { pair: 'builder-perth-student', variant: 'without', item: 'course:run-club', blockCourse: 'run-club' }, {
		origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'builder' }, home: 'room', careerPrep: { entryCerts: ['white-card'] },
	}),
	eduClone('guide', 'kalbarri-base', { pair: 'guide-kalbarri', variant: 'base' }, { job: { loc: 'kalbarri', career: 'guide' }, home: undefined, postTopHome: undefined }),
	eduClone('guide', 'kalbarri-without-bushcraft', { pair: 'guide-kalbarri', variant: 'without', item: 'course:bushcraft', blockCourse: 'bushcraft' }, { job: { loc: 'kalbarri', career: 'guide' }, home: undefined, postTopHome: undefined }),
	// 技能课与同能力活动的机会成本对照；仍保留其他课程。
	eduClone('lifeguard', 'surf-to-swim', { pair: 'lifeguard', variant: 'activity', item: 'course:surf-school', blockCourse: 'surf-school', replaceCourseWithActivity: { course: 'surf-school', activity: 'swim' } }),
	eduClone('lifeguard', 'run-to-jog', { pair: 'lifeguard', variant: 'activity', item: 'course:run-club', blockCourse: 'run-club', replaceCourseWithActivity: { course: 'run-club', activity: 'jog' } }),
	eduClone('barista', 'networking-to-busk', { pair: 'barista', variant: 'activity', item: 'course:networking', blockCourse: 'networking', replaceCourseWithActivity: { course: 'networking', activity: 'busk' } }),
	eduClone('builder', 'perth-student-trainer-to-gym', { pair: 'builder-perth-student', variant: 'activity', item: 'course:personal-trainer', blockCourse: 'personal-trainer', replaceCourseWithActivity: { course: 'personal-trainer', activity: 'gym' } }, {
		origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'builder' }, home: 'room', careerPrep: { entryCerts: ['white-card'] },
	}),
	eduClone('guide', 'kalbarri-bushcraft-to-forage', { pair: 'guide-kalbarri', variant: 'activity', item: 'course:bushcraft', blockCourse: 'bushcraft', replaceCourseWithActivity: { course: 'bushcraft', activity: 'forage' } }, { job: { loc: 'kalbarri', career: 'guide' }, home: undefined, postTopHome: undefined }),
	// 谈判课的街头活动只在有市集的地点；用弗里曼特尔酒保保持职业与课程都可用。
	eduClone('bartender', 'fremantle-base', { pair: 'bartender-fremantle', variant: 'base' }, { job: { loc: 'fremantle', career: 'bartender' } }),
	eduClone('bartender', 'fremantle-without-negotiation', { pair: 'bartender-fremantle', variant: 'without', item: 'course:negotiation', blockCourse: 'negotiation' }, { job: { loc: 'fremantle', career: 'bartender' } }),
	eduClone('bartender', 'fremantle-negotiation-to-market', { pair: 'bartender-fremantle', variant: 'activity', item: 'course:negotiation', blockCourse: 'negotiation', replaceCourseWithActivity: { course: 'negotiation', activity: 'market' } }, { job: { loc: 'fremantle', career: 'bartender' } }),
	// 长项目“读到顶 vs 停在二级”：直接量项目本身何时回本。
	eduClone('carer', 'without-cert3', { pair: 'carer', variant: 'without', item: 'program:cert3-support' }, {
		careerPrep: { ...structuredClone(PLANS.find((p) => p.id === 'carer')!.careerPrep!), promotionPrograms: [] },
	}),
	eduClone('it-support-backpacker', 'without-bachelor', { pair: 'it-support-backpacker', variant: 'without', item: 'program:bachelor' }, {
		careerPrep: { ...structuredClone(PLANS.find((p) => p.id === 'it-support-backpacker')!.careerPrep!), promotionPrograms: [] },
	}),
	eduClone('it-support', 'without-visa-bachelor', { pair: 'it-support', variant: 'without', item: 'program:bachelor', suppressVisaBachelor: true }),
];

/** 第十九轮：不进默认 39 条，只用 --switch 跑的跨部门与同部门跨城哨兵。 */
const SWITCH_PLANS: Plan[] = [
	{
		id: 'switch-barista-it-d60', name: '转行哨兵：咖啡→IT（第 60 天）', origin: 'student', traits: ['charming', 'neat'],
		job: { loc: 'perth', career: 'barista' }, home: 'room',
		transition: {
			kind: 'career', day: 60,
			to: {
				job: { loc: 'perth', career: 'it-support' }, home: 'room',
				careerPrep: { entryPrograms: ['english-class', 'cert4-it'], cashReserve: 500, preferredGigs: ['work-cafe'] },
			},
		},
	},
	{
		id: 'switch-miner-port-hedland-d120', name: '换岗哨兵：矿工卡尔古利→黑德兰港（第 120 天）', origin: 'fifo', traits: ['athletic', 'tough'],
		job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room', spend: false, remoteSafety: { ...REMOTE_SAFETY },
		transition: {
			kind: 'transfer', day: 120,
			to: { job: { loc: 'port-hedland', career: 'miner' }, home: 'room', spend: false, remoteSafety: { ...REMOTE_SAFETY } },
		},
	},
];

/**
 * NPC 诊断路线（第十四轮）：同地点、同职业的「不用 perk」和「自然解锁后用 perk」成对比较其他 NPC 的专属互动。
 * 不进默认报告（外地住房机器人有约 1% 的收房尾部，会让「有工作收房 0」亮红灯，和 perk 无关），只在 --only 点名时跑。
 */
const DIAG_PLANS: Plan[] = [
	{ id: 'guide-surfer', name: '导游（玛格丽特河，冲浪手对照）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'margaret-river', career: 'guide' }, home: 'room', rentAt: 700 },
	{
		id: 'trucker-licensed', name: '卡车司机（卡尔古利，先考 HR 驾照）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'trucker' }, home: 'room',
		careerPrep: { entrySkills: { driving: 20 }, entryPapers: ['address', 'licence-theory', 'licence'], entryCerts: ['hr-licence'], cashReserve: 1000, preferredGigs: ['work-mine', 'work-cafe'], minHunger: 70, minEnergy: 75, allowHomeBeforeEntry: true },
	},
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

function blankRisk(s: PlayerState): RiskStats {
	return {
		day: null,
		workStopDays: 0, sickLeaveDays: 0, collapseDays: 0, lastCollapseDay: -1,
		scheduledDays: 0,
		missedRiskGross: 0, workStopLostGross: 0, sickLostGross: 0, collapseLostGross: 0,
		goodShifts: 0, badShifts: 0, jobGross: 0, bonusGross: 0, bonusForegone: 0,
		careCashLoss: 0, jobLosses: 0, demotions: 0,
		minMood: mood(s), minHealth: s.health, maxSleepDebt: debtNow(s), sleepDebtDays: 0, poorSleeps: 0,
	};
}

function finalizeRiskDay(b: Bot) {
	const d = b.stats.risk.day;
	if (!d?.scheduled || d.worked) return;
	const hit = d.stop || d.sick || d.collapse;
	if (d.stop) {
		b.stats.risk.workStopDays++;
		b.stats.risk.workStopLostGross += d.pay;
	}
	if (d.sick) {
		b.stats.risk.sickLeaveDays++;
		b.stats.risk.sickLostGross += d.pay;
	}
	if (d.collapse) b.stats.risk.collapseLostGross += d.pay;
	// 同一天同时命中几种风险，只算一次未赚到的基础薪。
	if (hit) b.stats.risk.missedRiskGross += d.pay;
}

function scheduleRiskDay(b: Bot, day: number) {
	const job = b.s.job;
	const scheduled = !!job && day % 7 !== 6; // 和 step() 的每周休一天一致
	b.stats.risk.day = {
		day, scheduled, career: job?.career,
		pay: job ? careerPay(b.s, job.career, job.level) : 0,
		worked: !!job && job.lastDay === day,
		stop: false, sick: false, collapse: false,
	};
	if (scheduled) b.stats.risk.scheduledDays++;
}

/** 记录这个工作日是否真的因病、灾害或晕倒错过；治疗后仍赶上班的不算病假。 */
function observeRiskDay(b: Bot) {
	const today = dayOf(b.s.clock);
	if (!b.stats.risk.day || b.stats.risk.day.day !== today) {
		finalizeRiskDay(b);
		scheduleRiskDay(b, today);
	}
	const d = b.stats.risk.day!;
	// 当天中途入职：从此刻起也进入观测，但没遇到风险就不会算损失。
	if (!d.scheduled && b.s.job && today % 7 !== 6) {
		d.scheduled = true;
		d.career = b.s.job.career;
		d.pay = careerPay(b.s, b.s.job.career, b.s.job.level);
		d.worked = b.s.job.lastDay === today;
		b.stats.risk.scheduledDays++;
	}
	const job = b.s.job;
	if (!d.scheduled || !job || job.career !== d.career) return;
	const c = getCareer(job.career);
	const loc = getLocation(regionOf(b), job.loc);
	if (loc && workStopped(loc, today)) d.stop = true;
	if (c && currentIllness(b.s) && illnessBlock(b.s, ['work', ...loadOfEffect(c.shift)])) d.sick = true;
}

function recordEducationAction(b: Bot, before: PlayerState, after: PlayerState, a: GameAction) {
	let key: string | undefined;
	let spend = 0;
	let minutes = 0;
	if (a.t === 'cert') {
		const x = CERTS.find((c) => c.id === a.id);
		if (x) { key = `cert:${x.id}`; spend = x.price; minutes = x.minutes; }
	} else if (a.t === 'course') {
		const x = COURSES.find((c) => c.id === a.id);
		if (x) { key = `course:${x.id}`; spend = coursePrice(before, x); minutes = x.minutes; }
	} else if (a.t === 'study') {
		const x = PROGRAMS.find((p) => p.id === a.id);
		if (x) { key = `program:${x.id}`; spend = x.fee; minutes = x.minutes; }
	} else if (a.t === 'activity' && a.id === b.plan.education?.replaceCourseWithActivity?.activity) {
		const x = ACTIVITIES.find((v) => v.id === a.id);
		if (x) { key = `activity:${x.id}`; spend = -(x.fx.cash ?? 0); minutes = x.minutes; }
	}
	if (!key) return;
	const day = dayOf(after.clock) + 1;
	const row = b.stats.edu[key] ?? { actions: 0, spend: 0, minutes: 0, firstDay: day, lastDay: day };
	row.actions++;
	row.spend += spend;
	row.minutes += minutes;
	row.firstDay = Math.min(row.firstDay, day);
	row.lastDay = Math.max(row.lastDay, day);
	b.stats.edu[key] = row;
}

/** 尝试一个动作；成功则更新状态并统计 */
function tryAct(b: Bot, a: GameAction): boolean {
	const sys = OFF.size ? systemOf(a) : undefined;
	if (sys && OFF.has(sys)) return (ecoOf(b).blocked[sys] = (ecoOf(b).blocked[sys] ?? 0) + 1), false;
	const before = b.s;
	const bypassCap = !!b.plan.education?.noStudentWorkCap && a.t === 'job' && a.op === 'work';
	const actionState = bypassCap ? {
		...b.s,
		study: Object.fromEntries(Object.entries(b.s.study).map(([id, st]) => [id, { ...st, day: -999_999 }])),
	} : b.s;
	const r = applyAction(actionState, regionOf(b), a, simNow(b.s.clock));
	if (!r.ok) {
		b.s = r.state;
		return false;
	}
	b.s = bypassCap ? { ...r.state, study: before.study } : r.state;
	recordEducationAction(b, before, b.s, a);
	if (a.t === 'study' && a.id === b.plan.education?.refundProgram) {
		const p = PROGRAMS.find((x) => x.id === a.id);
		if (p) b.s = { ...b.s, cash: b.s.cash + p.fee };
	}
	// 签证毕业结算仍保留 visa.degree，只有职业证书里的“免费本科”被拿掉，逼机器人自己读 bachelor。
	if (b.plan.education?.suppressVisaBachelor && before.visa.course?.award === 'bachelor' && !b.s.visa.course && !before.certs.includes('bachelor') && b.s.certs.includes('bachelor')) {
		b.s = { ...b.s, certs: b.s.certs.filter((id) => id !== 'bachelor') };
	}
	const risk = b.stats.risk;
	if (a.t === 'job' && a.op === 'work' && before.job) {
		const base = careerPay(before, before.job.career, before.job.level);
		const bonus = Math.round(base * (1 + GOOD_BONUS)) - base;
		if (!r.collapsed) {
			const good = r.msg.includes('表现出色');
			risk.jobGross += base + (good ? bonus : 0);
			if (good) { risk.goodShifts++; risk.bonusGross += bonus; }
			else { risk.badShifts++; risk.bonusForegone += bonus; }
			if (risk.day?.day === dayOf(before.clock)) risk.day.worked = true;
		}
	}
	if (a.t === 'care' && b.s.cash < before.cash) risk.careCashLoss += before.cash - b.s.cash;
	if (before.job && !b.s.job && !(a.t === 'job' && a.op === 'quit')) risk.jobLosses++;
	if (before.job && b.s.job && before.job.career === b.s.job.career && b.s.job.level < before.job.level) risk.demotions++;
	if (r.collapsed) {
		const cd = dayOf(before.clock);
		if (risk.lastCollapseDay !== cd) { risk.lastCollapseDay = cd; risk.collapseDays++; }
		if (risk.day?.day === cd) risk.day.collapse = true;
	}
	const roughBefore = before.moodlets.find((x) => x.id === 'rough-night')?.until ?? 0;
	const roughAfter = b.s.moodlets.find((x) => x.id === 'rough-night')?.until ?? 0;
	if (roughAfter > roughBefore) risk.poorSleeps++;
	risk.minMood = Math.min(risk.minMood, mood(b.s));
	risk.minHealth = Math.min(risk.minHealth, b.s.health);
	risk.maxSleepDebt = Math.max(risk.maxSleepDebt, debtNow(b.s));
	if (b.transition?.activated && b.plan.transition && !b.transition.relocationComplete) {
		const relocation = a.t === 'travel' || a.t === 'rental' || (a.t === 'home' && (a.op === 'leave' || a.op === 'rent'));
		if (relocation && b.s.cash < before.cash) b.transition.relocationCost += before.cash - b.s.cash;
		if (!b.plan.transition.to.home || (b.s.home?.loc === b.plan.transition.to.job.loc && b.s.home?.type === b.plan.transition.to.home)) b.transition.relocationComplete = true;
	}
	trackLb(b);
	const key = actionKey(a);
	if (dayOf(before.clock) >= 180) {
		b.stats.lateActions[key] = (b.stats.lateActions[key] ?? 0) + 1;
		b.stats.lateActionMinutes[key] = (b.stats.lateActionMinutes[key] ?? 0) + Math.max(0, b.s.clock - before.clock);
	}
	if (before.visa.kind !== b.s.visa.kind) b.stats.visaTransitions.push({ day: dayOf(b.s.clock) + 1, from: before.visa.kind, to: b.s.visa.kind });
	if (a.t === 'visa' && a.op === 'apply') {
		const route = VISA_ROUTES.find((x) => x.id === a.route);
		if (route) b.stats.visaApplications.push({ day: dayOf(b.s.clock) + 1, route: route.id, from: before.visa.kind, to: route.to, fee: route.fee });
	}
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
		if (b.transition?.activated && b.plan.transition && b.s.job.career === b.plan.transition.to.job.career) {
			b.transition.firstPromoDay ??= dayOf(b.s.clock) + 1;
			if (b.s.job.level === getCareer(b.s.job.career)!.levels.length - 1) b.transition.topDay ??= dayOf(b.s.clock) + 1;
		}
	}
	if (!before.job && b.s.job) {
		b.stats.jobDay ??= dayOf(b.s.clock) + 1;
		if (b.transition?.activated && b.plan.transition && b.s.job.career === b.plan.transition.to.job.career) {
			b.transition.hireDay ??= dayOf(b.s.clock) + 1;
			if (b.s.job.level === getCareer(b.s.job.career)!.levels.length - 1) b.transition.topDay ??= b.transition.hireDay;
		}
	}
	if (a.t === 'job' && a.op === 'work') b.stats.shifts++;
	if (a.t === 'tax' && a.op === 'lodge' && before.tax.ret && !b.stats.taxReturn) {
		const ret = before.tax.ret;
		b.stats.taxReturn = { tax: assess(ret, taxStatus(before.origin)).tax, withheld: ret.withheld, due: b.s.tax.last?.due ?? 0, day: dayOf(b.s.clock) + 1 };
	}
	return true;
}

function shiftBlockedForBot(b: Bot): string | undefined {
	if (!b.plan.education?.noStudentWorkCap) return shiftBlocked(b.s, regionOf(b));
	const uncapped = {
		...b.s,
		study: Object.fromEntries(Object.entries(b.s.study).map(([id, st]) => [id, { ...st, day: -999_999 }])),
	};
	return shiftBlocked(uncapped, regionOf(b));
}

/** 第十九轮：到点辞职；异地路线先主动退租，再走真实出行、看房和应聘。 */
function stepTransition(b: Bot): boolean {
	const spec = b.plan.transition;
	if (!spec || dayOf(b.s.clock) < spec.day) return false;
	if (!b.transition) {
		const old = b.s.job;
		const c = old ? getCareer(old.career) : undefined;
		b.transition = {
			activated: false,
			sourceLevel: old?.level ?? -1,
			sourceTop: !!old && !!c && old.level === c.levels.length - 1,
			relocationCost: 0,
			relocationComplete: !spec.to.home || b.s.home?.loc === spec.to.job.loc,
		};
	}
	if (!b.transition.activated) {
		b.transition.activated = true;
		if (b.s.job && tryAct(b, { t: 'job', op: 'quit' })) {
			const to = spec.to;
			b.plan.job = { ...to.job };
			b.plan.careerPrep = to.careerPrep ? structuredClone(to.careerPrep) : undefined;
			b.plan.home = to.home;
			b.plan.postTopHome = to.postTopHome;
			b.plan.rentAt = to.rentAt;
			b.plan.remoteSafety = to.remoteSafety ? { ...to.remoteSafety } : undefined;
			b.plan.spend = to.spend;
			return true;
		}
	}
	if (b.s.home && b.s.home.loc !== spec.to.job.loc && !b.s.home.owned && tryAct(b, { t: 'home', op: 'leave' })) return true;
	return false;
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

/** 第二十三轮：按指定用途买一套房；购房前保留 reserve 现金。 */
function buyHousingProperty(b: Bot, id: string, use: 'self' | 'rental', loan: boolean, reserve = 3000): boolean {
	const def = getProperty(id);
	if (!def || b.s.loc !== def.loc) return false;
	const mine = b.s.properties.find((p) => p.id === id);
	if (mine) {
		if (use === 'rental' && !mine.rented) return tryAct(b, { t: 'property', op: 'rentout', id });
		if (use === 'self' && b.s.home?.owned !== id) return tryAct(b, { t: 'property', op: 'movein', id });
		return false;
	}
	// 断供后不反复买同一套房；每个策略只检验一次进入路径。
	if (b.stats.propertyBuys.some((x) => x.id === id)) return false;
	const need = (loan ? downPayment(def) : def.price) + reserve;
	if (b.s.cash < need) return false;
	if (loan && !b.s.bank.open) return tryAct(b, { t: 'bank', op: 'open' });
	if (loan && 'blocked' in homeLoanOffer(b.s, id)) return false;
	const cashBefore = b.s.cash;
	const worthBefore = netWorth(b.s);
	if (!tryAct(b, { t: 'property', op: 'buy', id, loan })) return false;
	const day = dayOf(b.s.clock) + 1;
	b.stats.propertyBuys.push({ day, id, use, cashBefore, worthBefore });
	if (use === 'self') {
		tryAct(b, { t: 'property', op: 'movein', id });
		b.stats.homeDay ??= day;
	} else {
		tryAct(b, { t: 'property', op: 'rentout', id });
	}
	return true;
}

/** 第二十三轮：处理第二套房的异地成交、挂牌和返程；只在休息日从工作地出发。 */
function stepHousingTrip(b: Bot): boolean {
	const h = b.plan.housing;
	if (!h || h.variant !== 'second' || !h.second) return false;
	const first = b.s.properties.find((p) => p.id === h.property);
	const secondDef = getProperty(h.second);
	if (!first || !secondDef || b.stats.propertyBuys.some((x) => x.id === h.second) && !b.s.properties.some((p) => p.id === h.second)) return false;
	if (!b.housingTrip) {
		if (b.s.properties.some((p) => p.id === h.second)) return false;
		if (dayOf(b.s.clock) % 7 !== 6 || b.s.loc !== b.plan.job?.loc) return false;
		if (b.s.cash < downPayment(secondDef) + 3000 || 'blocked' in homeLoanOffer(b.s, h.second)) return false;
		b.housingTrip = { property: h.second, returnLoc: b.plan.job.loc };
	}
	const trip = b.housingTrip;
	const mine = b.s.properties.find((p) => p.id === trip.property);
	if (!mine) {
		if (b.s.loc !== secondDef.loc) return headTo(b, secondDef.loc);
		// 出发时已经留了 $3,000；交通费从这笔周转金里出，抵达后只要求首付仍够。
		return buyHousingProperty(b, trip.property, 'rental', true, 0);
	}
	if (!mine.rented) return tryAct(b, { t: 'property', op: 'rentout', id: trip.property });
	if (b.s.loc !== trip.returnLoc) return headTo(b, trip.returnLoc);
	b.housingTrip = undefined;
	return false;
}

/** 第二十三轮：工作地的首次购房动作。 */
function stepHousingPurchase(b: Bot): boolean {
	const h = b.plan.housing;
	if (!h) return false;
	if (h.variant === 'cash-home') return buyHousingProperty(b, h.property, 'self', false);
	if (h.variant === 'loan-home' || h.variant === 'second') return buyHousingProperty(b, h.property, 'self', true);
	if (h.variant === 'rental') return buyHousingProperty(b, h.property, 'rental', true);
	return false;
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
/** --visa 使用最快拿 PR 的顺序：直接 PR 优先；同样满足 1 年经验时，482→186 比 491→191 少 60 个担保工作日且少 $350。 */
const VISA_FOCUS_ORDER = ['ens', 'skilled', 'state', 'regionalPr', 'sponsored', 'regional', 'graduate2', 'graduate', 'student'];
function stepVisa(b: Bot): boolean {
	const s = b.s;
	const now = visaKindNow(s);
	if (now === 'none' || now === 'pr') return false;
	const opts = visaOptions(s, regionOf(b));
	for (const id of VISA_FOCUS ? VISA_FOCUS_ORDER : VISA_ORDER) {
		// 默认机器人沿用旧口径；专项机器人在到期前 1 天仍无别路时续读，给随机事件留出余量，避免人为制造失去工作权。
		if (id === 'student' && now !== 'expired' && !(VISA_FOCUS && now === 'student' && !s.visa.course && s.visa.until - dayOf(s.clock) <= 1)) continue;
		// 已拿到 482 就留在担保路线等 186；否则下一次决策会立刻改申 491，反而更慢、更贵。
		if (VISA_FOCUS && now === 'sponsored' && id === 'regional') continue;
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

/** 第十六轮：职业入门 / 升职所需的能力、证书和学历。 */
function careerPrepPending(b: Bot, phase: 'entry' | 'promotion'): boolean {
	const cfg = b.plan.careerPrep;
	if (!cfg) return false;
	if (phase === 'entry') {
		if (Object.entries(cfg.entrySkills ?? {}).some(([k, v]) => b.s.skills[k as SkillKey] < v!)) return true;
		if ((cfg.entryPapers ?? []).some((id) => !paperDone(b.s, id))) return true;
		if ((cfg.entryCerts ?? []).some((id) => !b.s.certs.includes(id))) return true;
	}
	const nextCerts = b.s.job ? getCareer(b.s.job.career)?.levels[b.s.job.level + 1]?.req?.certs ?? [] : [];
	const ids = phase === 'entry' ? cfg.entryPrograms ?? [] : (cfg.promotionPrograms ?? []).filter((id) => { const p = getProgram(id); return !!p && nextCerts.includes(p.award); });
	return ids.some((id) => { const p = getProgram(id); return !!p && !b.s.certs.includes(p.award); });
}

const careerSkillPrepPending = (b: Bot) => Object.entries(b.plan.careerPrep?.entrySkills ?? {}).some(([k, v]) => b.s.skills[k as SkillKey] < v!);

function tryCareerSkillPrep(b: Bot): boolean {
	const cfg = b.plan.careerPrep;
	if (!cfg) return false;
	const fund = (cost: number) => {
		if (b.s.cash - cost >= (cfg.cashReserve ?? 0)) return false;
		if (cfg.preferredGigs) tryGigs(b, cfg.preferredGigs);
		return true;
	};
	for (const [skill, target] of Object.entries(cfg.entrySkills ?? {})) {
		if (b.s.skills[skill as SkillKey] >= target!) continue;
		const offer = coursesAt(b.s, regionOf(b)).find((o) => o.course.skill === skill && o.course.id !== b.plan.education?.blockCourse);
		if (offer && fund(offer.price)) return true;
		return !!offer && !offer.blocked && tryAct(b, { t: 'course', id: offer.course.id });
	}
	return false;
}

function tryCareerPrep(b: Bot, phase: 'entry' | 'promotion'): boolean {
	const cfg = b.plan.careerPrep;
	if (!cfg) return false;
	const fund = (cost: number) => {
		if (b.s.cash - cost >= (cfg.cashReserve ?? 0)) return false;
		if (cfg.preferredGigs) tryGigs(b, cfg.preferredGigs);
		return true; // 做不了零工也要等待，不能穿透储备继续付费。
	};
	if (phase === 'entry') {
		if (careerSkillPrepPending(b)) return tryCareerSkillPrep(b);
		for (const id of cfg.entryPapers ?? []) {
			if (paperDone(b.s, id)) continue;
			const row = paperChecklist(b.s, regionOf(b)).find((o) => o.paper.id === id);
			if (row && fund(row.paper.fee)) return true;
			return !!row && !row.blocked && tryAct(b, { t: 'paper', id });
		}
		for (const id of cfg.entryCerts ?? []) {
			if (b.s.certs.includes(id)) continue;
			const offer = certsAt(b.s, regionOf(b)).find((o) => o.cert.id === id);
			if (offer && fund(offer.cert.price)) return true;
			return !!offer && !offer.blocked && tryAct(b, { t: 'cert', id });
		}
	}
	const nextCerts = b.s.job ? getCareer(b.s.job.career)?.levels[b.s.job.level + 1]?.req?.certs ?? [] : [];
	const ids = phase === 'entry' ? cfg.entryPrograms ?? [] : (cfg.promotionPrograms ?? []).filter((id) => { const p = getProgram(id); return !!p && nextCerts.includes(p.award); });
	for (const id of ids) {
		const p = getProgram(id);
		if (!p || b.s.certs.includes(p.award)) continue;
		const offer = programsAt(b.s, regionOf(b)).find((o) => o.program.id === id);
		if (offer && fund(offer.program.fee)) return true;
		return !!offer && !offer.blocked && tryAct(b, { t: 'study', id });
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
		const ok = (c: (typeof ev.choices)[number]) => (!c.cost || c.cost <= s.cash) && !(c.exposed === 'sea' && stormy);
		// 第十五轮：偏远路线先选做完还留储备的选项（埃克斯茅斯开局 $200 鲸鲨同游把现金打空）
		const safe = plan.remoteSafety ? ev.choices.findIndex((c) => ok(c) && s.cash - (c.cost ?? 0) >= plan.remoteSafety!.cashReserve) : -1;
		const pick = safe >= 0 ? safe : ev.choices.findIndex(ok);
		if (pick < 0 || !tryAct(b, { t: 'event', choice: pick })) throw new Error(`机器人卡在事件 ${ev.id}（${plan.id}，第 ${dayOf(s.clock)} 天）`);
		return;
	}
	if (stepTransition(b)) return;
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
	const behaviorId = plan.housing?.pair ?? plan.id;
	const autoCert = !plan.education ? AUTO_ENTRY_CERT_BY_PLAN[behaviorId] : undefined;
	if (!s.job && autoCert && !s.certs.includes(autoCert.id)) {
		const offer = certsAt(s, regionOf(b)).find((o) => o.cert.id === autoCert.id);
		if (offer && s.cash - offer.cert.price >= autoCert.reserve) {
			if (!offer.blocked && tryAct(b, { t: 'cert', id: autoCert.id })) return;
			if (act(b, 'rest')) return;
		}
	}
	const forcedCert = plan.education?.forceCert;
	if (!s.job && forcedCert && !s.certs.includes(forcedCert)) {
		const offer = certsAt(s, regionOf(b)).find((o) => o.cert.id === forcedCert);
		if (offer) {
			if (!offer.blocked && tryAct(b, { t: 'cert', id: forcedCert })) return;
			if (act(b, 'rest')) return;
		}
		// 出生地没有课时先照常去工作地；工作地也没有才原地等，暴露错误配置。
		if (s.loc === plan.job?.loc && act(b, 'rest')) return;
	}
	const preHomeSkillOnly = !s.job && !s.home && !!plan.careerPrep?.allowHomeBeforeEntry && !!plan.careerPrep.preHomeSkills && careerSkillPrepPending(b);
	if (preHomeSkillOnly || (!s.job && careerPrepPending(b, 'entry') && (!plan.careerPrep?.allowHomeBeforeEntry || !!s.home))) {
		const prep = plan.careerPrep!;
		if (s.needs.hunger < (prep.minHunger ?? 35)) {
			if (cookFromPantry(b)) return;
			if (act(b, 'eat') || (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' }))) return;
		}
		if (s.needs.energy < (prep.minEnergy ?? 25)) {
			if (atHome && tryAct(b, { t: 'home', op: 'sleep' })) return;
			// 长课前直接睡满；按小时休息会连续错过 7–11 点的证照开课窗。
			if (act(b, 'sleep-camp')) return;
			if (act(b, 'rest')) return;
		}
		if (preHomeSkillOnly ? tryCareerSkillPrep(b) : tryCareerPrep(b, 'entry')) return;
		// 入门课没开时留在出生城市等下一时段，不先跑去工作地点或签租约。
		if (act(b, 'rest')) return;
	}
	// 需要地址证明的路线：能力补完后先在出生地攒够安全签约线，再搬去工作地租房。
	if (!s.job && !s.home && plan.careerPrep?.allowHomeBeforeEntry && !careerSkillPrepPending(b)) {
		const h = plan.home ? getHome(plan.home) : undefined;
		const target = h && rs ? moveInCost(s, h) + rs.cashReserve + h.rentWeek * rs.moveInRentWeeks : (plan.rentAt ?? 400);
		if (s.cash <= target) {
			if (s.needs.hunger < (plan.careerPrep.minHunger ?? 35) && (act(b, 'eat') || (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' })))) return;
			if (s.needs.energy < (plan.careerPrep.minEnergy ?? 25) && (act(b, 'sleep-camp') || act(b, 'rest'))) return;
			if (plan.careerPrep.preferredGigs && tryGigs(b, plan.careerPrep.preferredGigs)) return;
			if (act(b, 'recycle')) return;
		}
	}
	// 异地第二套房必须先完成成交、挂牌和返程；放在上班判断前，避免机器人抵达异地后立刻掉头。
	if (stepHousingTrip(b)) return;
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
		} else if (dayOf(s.clock) % 7 !== 6 && !shiftBlockedForBot(b) && tryAct(b, { t: 'job', op: 'work' })) return; // 每周休一天
	}
	const postTopHome = plan.postTopHome ? getHome(plan.postTopHome) : undefined;
	const atCareerTop = !!s.job && s.job.level === getCareer(s.job.career)!.levels.length - 1;
	const postTopReady = !!postTopHome && atCareerTop && dayOf(s.clock) >= 112 && s.properties.length === 0
		&& s.loc === (plan.job?.loc ?? regionOf(b).spawn) && s.home?.type !== postTopHome.id
		&& s.cash - moveInCost(s, postTopHome) >= Math.max(3000, postTopHome.rentWeek * 8);
	// 已准备升级住房时不再续新的固定期；等当前合同自然转周期后再搬，避免违约金。
	if (postTopReady && s.home && !s.home.owned && !s.rental.lease?.end && tryAct(b, { t: 'home', op: 'leave' })) return;
	// 租约维护优先于升职课程，避免连续课程挤掉续签窗口。
	if (s.home && !s.home.owned) {
		if (!leaseBlocked(s, 'report') && tryAct(b, { t: 'rental', op: 'report' })) return;
		if (!leaseBlocked(s, 'repair') && tryAct(b, { t: 'rental', op: 'repair' })) return;
		if (!postTopReady && s.rental.lease?.end && !leaseBlocked(s, 'renew') && tryAct(b, { t: 'rental', op: 'renew' })) return;
	}
	// 当天班已经上完或今天休班后，再补下一档要求的长期课程。
	if (s.job && careerPrepPending(b, 'promotion') && tryCareerPrep(b, 'promotion')) return;
	const wantHomeId = postTopReady ? plan.postTopHome : plan.home;
	const wantHome = wantHomeId ? getHome(wantHomeId) : undefined;
	const canSign = rs && wantHome
		? s.cash - moveInCost(s, wantHome) >= rs.cashReserve + wantHome.rentWeek * rs.moveInRentWeeks // 第十五轮：签完还留储备 + 两周租金
		: postTopReady && wantHome ? s.cash - moveInCost(s, wantHome) >= Math.max(3000, wantHome.rentWeek * 8) : s.cash > (plan.rentAt ?? 400);
	if (wantHomeId && !s.home && !b.hobbyTraveling && canSign) {
		const want = plan.job?.loc ?? regionOf(b).spawn;
		// 租房市场（rental 批次）：先看房再递申请（固定期限）；被拒当天这套房不可申请，第二天再来
		if (s.loc === want && homesAt(s, regionOf(b)).some((o) => o.home.id === wantHomeId && !o.blocked)) {
			if (!viewedOk(s.rental, s.loc, wantHomeId, dayOf(s.clock)) && tryAct(b, { t: 'rental', op: 'inspect', home: wantHomeId })) return;
			if (tryAct(b, { t: 'home', op: 'rent', home: wantHomeId, term: 'fixed' })) {
				if (wantHomeId === plan.postTopHome) b.stats.homeUpgradeDay ??= dayOf(b.s.clock) + 1;
				return;
			}
		}
	}
	// 押金扣款有报告就申诉。
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
			const replacement = plan.education?.replaceCourseWithActivity;
			const replacedCourse = replacement ? COURSES.find((c) => c.id === replacement.course) : undefined;
			if (replacement && replacedCourse && lacking.includes(replacedCourse.skill) && act(b, replacement.activity)) return;
			const skipped = plan.education ? [] : (SKIP_PROMOTION_COURSES_BY_PLAN[behaviorId] ?? []);
			const course = coursesAt(s, regionOf(b)).find((o) => lacking.includes(o.course.skill) && !o.blocked
				&& !skipped.includes(o.course.id) && o.course.id !== plan.education?.blockCourse && o.course.id !== plan.education?.blockCourseAfterHire);
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
		if (plan.housing && stepHousingPurchase(b)) return;
		// 买房：首付之外还留 $3,000 周转；买了就搬进去。按揭要先开银行账户（banking.md），开户不花钱不花时间
		const house = propertiesAt(s, regionOf(b)).find((o) => !o.owned && s.cash >= o.down + 3000);
		if (house && !plan.invest && !plan.housing && !s.bank.open && s.properties.length === 0) tryAct(b, { t: 'bank', op: 'open' });
		if (house && !plan.invest && !plan.housing && s.properties.length === 0 && tryAct(b, { t: 'property', op: 'buy', id: house.property.id, loan: s.cash < house.property.price + 3000 })) {
			tryAct(b, { t: 'property', op: 'movein', id: house.property.id });
			b.stats.homeDay = dayOf(b.s.clock) + 1;
			return;
		}
		if (!plan.housing && s.vehicle === 'none' && s.cash > 7000 && s.properties.length > 0) {
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
	for (const award of plan.education?.freeAwards ?? []) if (!s.certs.includes(award)) s.certs = [...s.certs, award];
	// transition 会在运行中切换目标；每个种子必须持有独立计划。
	const livePlan = structuredClone(plan);
	const b: Bot = {
		s, plan: livePlan, rng: mulberry(seed * 7919),
		stats: { biz: { gigs: {}, bankrupt: 0, shopNet: 0 }, swapBuys: 0, collapses: 0, evictions: 0, evict: { first: 0, later: 0, forced: 0 }, promotions: 0, events: 0, moodSum: 0, moodN: 0, moodByDay: [mood(s)], moodLateSum: 0, moodLateN: 0, moodLateBins: [{ sum: 0, n: 0 }, { sum: 0, n: 0 }, { sum: 0, n: 0 }], worthByDay: [netWorth(s)], collapsesByDay: [0], evictionsByDay: [0], visaExpiredByDay: [0], lateActions: {}, lateActionMinutes: {}, visaTransitions: [], visaApplications: [], shifts: 0, daysBroke: 0, cashByDay: [s.cash], flow: {}, promoDays: [], propertyBuys: [], diag: blankDiagnostics(), ill: 0, sickMin: 0, coops: 0, coopOk: 0, coopKinds: {}, visaExpiredDays: 0, ielts: 0, hobby: { respect: 0, milestones: {} }, npc: { milestones: {}, gifts: 0, giftSpend: 0, perks: 0, perkMinutes: 0, perkNeeds: {}, perkActual: {} }, risk: blankRisk(s), edu: {} },
		lb: { e: lbEntry(s, 0), now: 0, max: { worth: 0, respect: 0, dex: 0, places: 0 }, holds: 0, why: [] },
	};
	const end = s.clock + DAYS * 1440;
	let lastDay = dayOf(s.clock);
	let i = 0;
	observeRiskDay(b);
	for (; i < 50000 && b.s.clock < end; i++) {
		const before = b.s.clock;
		const sickAt = currentIllness(b.s) ? b.s.illness!.until : 0;
		step(b);
		if (sickAt) b.stats.sickMin += Math.max(0, Math.min(b.s.clock, sickAt) - before);
		if (b.s.clock === before && !getPendingEvent(b.s)) act(b, 'rest'); // 防止原地打转
		observeRiskDay(b);
		const moodNow = mood(b.s);
		b.stats.moodSum += moodNow;
		b.stats.moodN++;
		const d = dayOf(b.s.clock);
		if (d >= 180) {
			b.stats.moodLateSum += moodNow;
			b.stats.moodLateN++;
			const bin = d < 240 ? 0 : d < 300 ? 1 : 2;
			b.stats.moodLateBins[bin].sum += moodNow;
			b.stats.moodLateBins[bin].n++;
		}
		while (lastDay < d) {
			lastDay++;
			const debt = debtNow(b.s);
			b.stats.risk.maxSleepDebt = Math.max(b.stats.risk.maxSleepDebt, debt);
			if (debt >= 4) b.stats.risk.sleepDebtDays++;
			b.stats.risk.minMood = Math.min(b.stats.risk.minMood, mood(b.s));
			b.stats.risk.minHealth = Math.min(b.stats.risk.minHealth, b.s.health);
			b.stats.cashByDay.push(b.s.cash);
			b.stats.moodByDay.push(mood(b.s));
			b.stats.worthByDay.push(netWorth(b.s));
			b.stats.collapsesByDay.push(b.stats.collapses);
			b.stats.evictionsByDay.push(b.stats.evictions);
			if (b.s.cash < 20) b.stats.daysBroke++;
			if (!canWork(b.s)) b.stats.visaExpiredDays++;
			b.stats.visaExpiredByDay.push(b.stats.visaExpiredDays);
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
	for (const list of [PLANS, ORIGIN_PLANS, MATRIX_PLANS, SWITCH_PLANS, EDU_PLANS, HOUSING_PLANS]) list.splice(0, list.length, ...list.filter((p) => ONLY.includes(p.id)));
}
const results: PlanResult[] = [];
const getNpcPerk = (id: string) => NPCS.find((x) => x.id === id)?.perk;
const pct = (xs: number[], p: number) => {
	const v = [...xs].sort((a, b) => a - b);
	return v[Math.min(v.length - 1, Math.floor(p * v.length))];
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const dist = (xs: number[]) => ({ mean: avg(xs), p90: pct(xs, 0.9), max: Math.max(...xs) });
const maxBelowRun = (xs: number[], floor: number) => {
	let best = 0, run = 0;
	for (const x of xs) { run = x < floor ? run + 1 : 0; best = Math.max(best, run); }
	return best;
};
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
const riskRows: string[] = [];
const selectedPlans = BY_HOUSING
	? HOUSING_PLANS.filter((p) => !HOUSING_STRATEGY || p.housing?.variant === HOUSING_STRATEGY)
	: BY_VISA ? MATRIX_PLANS.filter((p) => p.origin === 'student') : BY_EDU ? EDU_PLANS : BY_SWITCH ? SWITCH_PLANS : BY_MATRIX ? MATRIX_PLANS : BY_SWAP ? SWAP_PLANS : BY_ORIGIN ? ORIGIN_PLANS : LONG && !ONLY.length ? PLANS.filter((p) => MATRIX_IDS.includes(p.id)) : PLANS;
for (const plan of selectedPlans) {
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
	const p1Days = nth(0), p2Days = nth(1);
	const jobDays = bots.map((b) => b.stats.jobDay).filter((d): d is number => d !== undefined);
	const afterHire = (k: number) => bots.map((b) => b.stats.jobDay !== undefined && b.stats.promoDays[k] !== undefined ? b.stats.promoDays[k] - b.stats.jobDay : undefined).filter((d): d is number => d !== undefined);
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
	const transition = plan.transition ? (() => {
		const tri = (xs: number[]) => ({ p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9) });
		const snap = (b: Bot, d: number) => b.stats.cashByDay[Math.min(d, b.stats.cashByDay.length - 1)];
		const live = bots.map((b) => b.transition).filter((x): x is NonNullable<Bot['transition']> => !!x);
		const hired = live.filter((x): x is typeof x & { hireDay: number } => x.hireDay !== undefined);
		const p1 = live.filter((x): x is typeof x & { firstPromoDay: number } => x.firstPromoDay !== undefined);
		const top = live.filter((x): x is typeof x & { topDay: number } => x.topDay !== undefined);
		const post = bots.flatMap((b) => {
			const h = b.transition?.hireDay;
			return h === undefined || h + 30 > DAYS ? [] : [(snap(b, h + 30) - snap(b, h)) / 30];
		});
		return {
			kind: plan.transition.kind,
			requestedDay: plan.transition.day,
			sourceLevel: tri(live.map((x) => x.sourceLevel)),
			sourceTopShare: live.filter((x) => x.sourceTop).length / RUNS,
			hireShare: hired.length / RUNS,
			hireDay: hired.length ? tri(hired.map((x) => x.hireDay)) : null,
			daysToHire: hired.length ? tri(hired.map((x) => x.hireDay - plan.transition!.day)) : null,
			firstPromoDay: p1.length ? tri(p1.map((x) => x.firstPromoDay)) : null,
			topDay: top.length ? tri(top.map((x) => x.topDay)) : null,
			daysHireToFirstPromo: p1.length ? tri(p1.map((x) => x.firstPromoDay - x.hireDay!)) : null,
			daysHireToTop: top.length ? tri(top.map((x) => x.topDay - x.hireDay!)) : null,
			preNet30: avg(bots.map((b) => (snap(b, plan.transition!.day) - snap(b, Math.max(0, plan.transition!.day - 30))) / Math.min(30, plan.transition!.day))),
			postNet30: post.length ? avg(post) : null,
			relocationCost: avg(live.map((x) => x.relocationCost)),
		};
	})() : undefined;
	const long = DAYS >= 365 ? (() => {
		const snap = (b: Bot, xs: number[], day: number) => xs[Math.min(day, xs.length - 1)];
		const tri = (xs: number[]) => ({ p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9) });
		const lateDays = DAYS - 180;
		const lateActions: Record<string, number> = {};
		const lateActionMinutes: Record<string, number> = {};
		for (const b of bots) {
			for (const [k, v] of Object.entries(b.stats.lateActions)) lateActions[k] = (lateActions[k] ?? 0) + v / RUNS / lateDays;
			for (const [k, v] of Object.entries(b.stats.lateActionMinutes)) lateActionMinutes[k] = (lateActionMinutes[k] ?? 0) + v / RUNS;
		}
		const totalLateMinutes = Object.values(lateActionMinutes).reduce((x, y) => x + y, 0);
		const transitionDays: Record<string, number[]> = {};
		const homeUpgradeDays = bots.map((b) => b.stats.homeUpgradeDay).filter((d): d is number => d !== undefined);
		for (const b of bots) for (const t of b.stats.visaTransitions) (transitionDays[`${t.from}->${t.to}`] ??= []).push(t.day);
		return {
			netWorthDay0: tri(bots.map((b) => snap(b, b.stats.worthByDay, 0))),
			netWorthDay180: tri(bots.map((b) => snap(b, b.stats.worthByDay, 180))),
			netWorthDay365: tri(bots.map((b) => snap(b, b.stats.worthByDay, 365))),
			cashDay180: tri(bots.map((b) => snap(b, b.stats.cashByDay, 180))),
			cashDay365: tri(bots.map((b) => snap(b, b.stats.cashByDay, 365))),
			cashNetPerDay181_365: avg(bots.map((b) => (snap(b, b.stats.cashByDay, 365) - snap(b, b.stats.cashByDay, 180)) / lateDays)),
			worthGrowthPerDay1_180: avg(bots.map((b) => (snap(b, b.stats.worthByDay, 180) - snap(b, b.stats.worthByDay, 0)) / 180)),
			worthGrowthPerDay181_365: avg(bots.map((b) => (snap(b, b.stats.worthByDay, 365) - snap(b, b.stats.worthByDay, 180)) / lateDays)),
			cashNetPerDayLateBins: [[180, 240], [240, 300], [300, 365]].map(([a, z]) => avg(bots.map((b) => (snap(b, b.stats.cashByDay, z) - snap(b, b.stats.cashByDay, a)) / (z - a)))),
			worthGrowthPerDayLateBins: [[180, 240], [240, 300], [300, 365]].map(([a, z]) => avg(bots.map((b) => (snap(b, b.stats.worthByDay, z) - snap(b, b.stats.worthByDay, a)) / (z - a)))),
			moodDay90: pct(bots.map((b) => snap(b, b.stats.moodByDay, 90)), 0.5),
			moodDay180: pct(bots.map((b) => snap(b, b.stats.moodByDay, 180)), 0.5),
			moodDay365: pct(bots.map((b) => snap(b, b.stats.moodByDay, 365)), 0.5),
			moodMean181_365: avg(bots.map((b) => avg(b.stats.moodByDay.slice(181, 366)))),
			moodMeanLateBins: [[180, 240], [240, 300], [300, 365]].map(([a, z]) => avg(bots.map((b) => avg(b.stats.moodByDay.slice(a + 1, z + 1))))),
			moodActionMean181_365: avg(bots.map((b) => b.stats.moodLateSum / Math.max(1, b.stats.moodLateN))),
			moodActionMeanLateBins: [0, 1, 2].map((i) => avg(bots.map((b) => b.stats.moodLateBins[i].sum / Math.max(1, b.stats.moodLateBins[i].n)))),
			collapses181_365: avg(bots.map((b) => b.stats.collapses - snap(b, b.stats.collapsesByDay, 180))),
			evictions181_365: avg(bots.map((b) => b.stats.evictions - snap(b, b.stats.evictionsByDay, 180))),
			lowCashDays181_365: avg(bots.map((b) => b.stats.cashByDay.slice(181, 366).filter((x) => x < 20).length)),
			homeShare: homeDays.length / RUNS,
			homeDay: homeDays.length ? tri(homeDays) : null,
			homeUpgradeShare: homeUpgradeDays.length / RUNS,
			homeUpgradeDay: homeUpgradeDays.length ? tri(homeUpgradeDays) : null,
			visaExpiredDaysTotal: avg(bots.map((b) => b.stats.visaExpiredDays)),
			visaExpiredDays181_365: avg(bots.map((b) => b.stats.visaExpiredDays - snap(b, b.stats.visaExpiredByDay, 180))),
			visaTransitions: Object.fromEntries(Object.entries(transitionDays).map(([k, xs]) => [k, { count: xs.length, share: xs.length / RUNS, day: tri(xs) }])),
			lateActionsPerDay: lateActions,
			lateActionMinuteShare: Object.fromEntries(Object.entries(lateActionMinutes).map(([k, v]) => [k, totalLateMinutes ? v / totalLateMinutes : 0])),
		};
	})() : undefined;
	const risk = RISK ? (() => {
		const tri = (xs: number[]) => ({ p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9) });
		const finalWorth = (b: Bot) => b.stats.worthByDay[Math.min(DAYS, b.stats.worthByDay.length - 1)];
		const finalCash = (b: Bot) => b.stats.cashByDay[Math.min(DAYS, b.stats.cashByDay.length - 1)];
		const seeds = bots.map((b, i) => ({
			seed: SEED_OFFSET + i + 1,
			netWorth: finalWorth(b), cash: finalCash(b),
			workStopDays: b.stats.risk.workStopDays,
			sickLeaveDays: b.stats.risk.sickLeaveDays,
			sickDays: b.stats.sickMin / 1440,
			collapseDays: b.stats.risk.collapseDays,
			collapses: b.stats.collapses,
			badShifts: b.stats.risk.badShifts,
			goodShifts: b.stats.risk.goodShifts,
			jobGross: b.stats.risk.jobGross,
			bonusGross: b.stats.risk.bonusGross,
			bonusForegone: b.stats.risk.bonusForegone,
			missedRiskGross: b.stats.risk.missedRiskGross,
			workStopLostGross: b.stats.risk.workStopLostGross,
			sickLostGross: b.stats.risk.sickLostGross,
			collapseLostGross: b.stats.risk.collapseLostGross,
			careCashLoss: b.stats.risk.careCashLoss,
			jobLosses: b.stats.risk.jobLosses,
			demotions: b.stats.risk.demotions,
			evictions: b.stats.evictions,
			lowCashDays: b.stats.daysBroke,
			lowCashStreak: maxBelowRun(b.stats.cashByDay.slice(1, DAYS + 1), 20),
			minMood: b.stats.risk.minMood,
			minHealth: b.stats.risk.minHealth,
			maxSleepDebt: b.stats.risk.maxSleepDebt,
			sleepDebtDays: b.stats.risk.sleepDebtDays,
			poorSleeps: b.stats.risk.poorSleeps,
		}));
		const worth = seeds.map((x) => x.netWorth);
		return {
			netWorth: tri(worth), p10P50: pct(worth, 0.1) / Math.max(1, pct(worth, 0.5)),
			workStopDays: dist(seeds.map((x) => x.workStopDays)),
			sickLeaveDays: dist(seeds.map((x) => x.sickLeaveDays)),
			sickDays: dist(seeds.map((x) => x.sickDays)),
			collapseDays: dist(seeds.map((x) => x.collapseDays)),
			badShifts: dist(seeds.map((x) => x.badShifts)),
			jobGross: dist(seeds.map((x) => x.jobGross)),
			bonusForegone: dist(seeds.map((x) => x.bonusForegone)),
			missedRiskGross: dist(seeds.map((x) => x.missedRiskGross)),
			workStopLostGross: dist(seeds.map((x) => x.workStopLostGross)),
			sickLostGross: dist(seeds.map((x) => x.sickLostGross)),
			careCashLoss: dist(seeds.map((x) => x.careCashLoss)),
			jobLosses: dist(seeds.map((x) => x.jobLosses)),
			demotions: dist(seeds.map((x) => x.demotions)),
			evictions: dist(seeds.map((x) => x.evictions)),
			lowCashDays: dist(seeds.map((x) => x.lowCashDays)),
			lowCashStreak: dist(seeds.map((x) => x.lowCashStreak)),
			minMood: tri(seeds.map((x) => x.minMood)),
			minHealth: tri(seeds.map((x) => x.minHealth)),
			maxSleepDebt: dist(seeds.map((x) => x.maxSleepDebt)),
			sleepDebtDays: dist(seeds.map((x) => x.sleepDebtDays)),
			poorSleeps: dist(seeds.map((x) => x.poorSleeps)),
			seeds,
		};
	})() : undefined;
	if (risk) {
		const d = (x: { mean: number; p90: number; max: number }, digits = 1) => `${x.mean.toFixed(digits)} / ${x.p90.toFixed(digits)} / ${x.max.toFixed(digits)}`;
		const lossShare = risk.missedRiskGross.mean / Math.max(1, risk.jobGross.mean + risk.missedRiskGross.mean);
		const bonusShare = risk.bonusForegone.mean / Math.max(1, risk.jobGross.mean + risk.bonusForegone.mean);
		riskRows.push(`| ${plan.name} | ${money(risk.netWorth.p10)} / ${money(risk.netWorth.median)} / ${money(risk.netWorth.p90)} | ${(risk.p10P50 * 100).toFixed(1)}% | ${d(risk.workStopDays)} | ${d(risk.sickLeaveDays)} | ${d(risk.collapseDays)} | ${money(risk.missedRiskGross.mean)} / ${(lossShare * 100).toFixed(1)}% | ${d(risk.badShifts)} / ${(bonusShare * 100).toFixed(1)}% | ${d(risk.jobLosses)} / ${d(risk.demotions)} | ${d(risk.evictions)} | ${d(risk.lowCashDays)} / ${d(risk.lowCashStreak)} | ${risk.minMood.p10.toFixed(0)} / ${risk.minMood.median.toFixed(0)} / ${risk.minMood.p90.toFixed(0)} |`);
	}
	const education = plan.education ? {
		pair: plan.education.pair, variant: plan.education.variant, ...(plan.education.item ? { item: plan.education.item } : {}),
		seeds: bots.map((b, i) => {
			const atDay = (xs: number[], day: number) => xs[Math.min(day, xs.length - 1)];
			return {
				seed: SEED_OFFSET + i + 1,
				jobDay: b.stats.jobDay ?? null, topDay: b.stats.promoDays[1] ?? null,
				netWorthDay180: atDay(b.stats.worthByDay, 180), netWorthDay365: atDay(b.stats.worthByDay, 365),
				cashDay180: atDay(b.stats.cashByDay, 180), cashDay365: atDay(b.stats.cashByDay, 365),
				mood: b.stats.moodSum / Math.max(1, b.stats.moodN), promotions: b.stats.promotions, shifts: b.stats.shifts,
				collapses: b.stats.collapses, evictions: b.stats.evictions, actions: b.stats.edu,
				netWorthByDay: b.stats.worthByDay.slice(0, DAYS + 1), cashByDay: b.stats.cashByDay.slice(0, DAYS + 1), moodByDay: b.stats.moodByDay.slice(0, DAYS + 1),
			};
		}),
	} : undefined;
	const housing = plan.housing ? {
		pair: plan.housing.pair,
		variant: plan.housing.variant,
		property: plan.housing.property,
		...(plan.housing.second ? { second: plan.housing.second } : {}),
		seeds: bots.map((b, i) => {
			const atDay = (xs: number[], day: number) => xs[Math.min(day, xs.length - 1)];
			const first = b.stats.propertyBuys.find((x) => x.id === plan.housing!.property);
			const second = plan.housing!.second ? b.stats.propertyBuys.find((x) => x.id === plan.housing!.second) : undefined;
			return {
				seed: SEED_OFFSET + i + 1,
				firstBuyDay: first?.day ?? null,
				secondBuyDay: second?.day ?? null,
				netWorthDay180: atDay(b.stats.worthByDay, 180),
				netWorthDay365: atDay(b.stats.worthByDay, 365),
				cashDay180: atDay(b.stats.cashByDay, 180),
				cashDay365: atDay(b.stats.cashByDay, 365),
				mood: b.stats.moodSum / Math.max(1, b.stats.moodN),
				collapses: b.stats.collapses,
				evictions: b.stats.evictions,
				forcedSales: b.stats.evict.forced,
				properties: b.s.properties.length,
				rented: b.s.properties.filter((x) => x.rented).length,
				buys: b.stats.propertyBuys,
				netWorthByDay: b.stats.worthByDay.slice(0, DAYS + 1),
				cashByDay: b.stats.cashByDay.slice(0, DAYS + 1),
			};
		}),
	} : undefined;
	const visa = BY_VISA && plan.origin === 'student' ? (() => {
		const tri = (xs: number[]) => ({ p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9) });
		const prs = bots.map((b) => b.stats.prDay).filter((d): d is number => d !== undefined);
		const kinds: Record<string, number> = {};
		const routes: Record<string, { count: number; days: number[] }> = {};
		for (const b of bots) {
			kinds[b.s.visa.kind] = (kinds[b.s.visa.kind] ?? 0) + 1;
			for (const a of b.stats.visaApplications) {
				const row = routes[a.route] ??= { count: 0, days: [] };
				row.count++;
				row.days.push(a.day);
			}
		}
		const seeds = bots.map((b, i) => ({
			seed: SEED_OFFSET + i + 1,
			finalKind: b.s.visa.kind,
			prDay: b.stats.prDay ?? null,
			expiredDays: b.stats.visaExpiredDays,
			visaFees: b.stats.visaApplications.reduce((n, a) => n + a.fee, 0) + b.stats.ielts * VISA_RULES.ielts.fee,
			ieltsAttempts: b.stats.ielts,
			finalIelts: b.s.visa.ielts,
			applications: b.stats.visaApplications,
		}));
		return {
			strategy: VISA_STRATEGY,
			finalKinds: kinds,
			prShare: prs.length / RUNS,
			prDay: prs.length ? tri(prs) : null,
			expiredDays: { mean: avg(seeds.map((x) => x.expiredDays)), max: Math.max(...seeds.map((x) => x.expiredDays)) },
			visaFees: tri(seeds.map((x) => x.visaFees)),
			ieltsAttempts: { mean: avg(seeds.map((x) => x.ieltsAttempts)), max: Math.max(...seeds.map((x) => x.ieltsAttempts)) },
			routes: Object.fromEntries(Object.entries(routes).map(([id, x]) => [id, { count: x.count, share: x.count / RUNS, day: tri(x.days) }])),
			seeds,
		};
	})() : undefined;
	results.push({
		id: plan.id, name: plan.name,
		metrics: {
			cashDay7: pct(at(7), 0.5), cashDay30: pct(at(30), 0.5), cashEnd: pct(at(endD), 0.5), cashEndP10: pct(at(endD), 0.1), cashEndP90: pct(at(endD), 0.9),
			netPerDay: net, netWorth: pct(bots.map((b) => netWorth(b.s)), 0.5), homeDay: homeDays.length > bots.length / 2 ? pct(homeDays, 0.5) : null, mood: m,
			collapses: coll, evictions: ev, evictFirst: avg(bots.map((b) => b.stats.evict.first)), evictLater: avg(bots.map((b) => b.stats.evict.later)), forcedSales: avg(bots.map((b) => b.stats.evict.forced)),
			promotions: pr, promo1Day: nth(0).length ? pct(nth(0), 0.5) : null, promo2Day: nth(1).length ? pct(nth(1), 0.5) : null,
			jobDay: jobDays.length ? pct(jobDays, 0.5) : null, jobDayP10: jobDays.length ? pct(jobDays, 0.1) : null, jobDayP90: jobDays.length ? pct(jobDays, 0.9) : null,
			promo1DayP10: p1Days.length ? pct(p1Days, 0.1) : null, promo1DayP90: p1Days.length ? pct(p1Days, 0.9) : null, promo2DayP10: p2Days.length ? pct(p2Days, 0.1) : null, promo2DayP90: p2Days.length ? pct(p2Days, 0.9) : null,
			jobShare: jobDays.length / RUNS, topShare: p2Days.length / RUNS, promo1AfterHire: afterHire(0).length ? pct(afterHire(0), 0.5) : null, promo2AfterHire: afterHire(1).length ? pct(afterHire(1), 0.5) : null,
			brokeShare: broke, lowCashDays: broke * DAYS, events: avg(bots.map((b) => b.stats.events)), coops: avg(bots.map((b) => b.stats.coops)),
			ecoIn: Object.values(eco.in).reduce((x, y) => x + y, 0), ecoOut: Object.values(eco.out).reduce((x, y) => x + y, 0),
		},
		skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, pct(bots.map((b) => b.s.skills[k]), 0.5)])),
		flow, eco: { in: eco.in, out: eco.out, inDetail: eco.inDetail, outDetail: eco.outDetail }, blocked: eco.blocked,
		...(transition ? { transition } : {}),
		...(long ? { long } : {}),
		...(risk ? { risk } : {}),
		...(education ? { education } : {}),
		...(housing ? { housing } : {}),
		...(visa ? { visa } : {}),
	});
}
if (BY_HOUSING) {
	out();
	out('## 住房路径专项（--housing）');
	out();
	out('同一部门、同一 seed 配对。持续回本日 = 从该日起直到期末，净资产都不再低于对照；“第二套增量”只把 second 与 loan-home 比，并从第二套成交日起算。房产按 95% 正常卖出净值计入净资产。');
	out();
	out('| 部门 · 策略 | 第 180 天净资产（p10 / 中位 / p90） | 第 365 天净资产 | 第 180 / 365 天现金 P10 | 首套（人数@中位日） | 第二套 | 强售 / 收房 / 晕倒（人均） | 平均心情 | 持续回本：合租 / 储蓄 / 第二套增量 |');
	out('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	const hPlans = results.filter((p) => p.housing);
	const q = (xs: number[]) => `${money(pct(xs, 0.1))} / ${money(pct(xs, 0.5))} / ${money(pct(xs, 0.9))}`;
	const bought = (xs: (number | null)[]) => {
		const days = xs.filter((x): x is number => x !== null);
		return days.length ? `${days.length}@${pct(days, 0.5)}` : '0@—';
	};
	const payback = (p: PlanResult, base: PlanResult | undefined, secondOnly = false) => {
		if (!p.housing || !base?.housing) return '—';
		const bySeed = new Map(base.housing.seeds.map((x) => [x.seed, x]));
		const days: number[] = [];
		for (const s of p.housing.seeds) {
			const b = bySeed.get(s.seed);
			const start = secondOnly ? s.secondBuyDay : s.firstBuyDay;
			if (!b || start === null) continue;
			let lastNegative = start - 1;
			for (let d = start; d <= DAYS; d++) if ((s.netWorthByDay[d] ?? s.netWorthByDay.at(-1)!) < (b.netWorthByDay[d] ?? b.netWorthByDay.at(-1)!)) lastNegative = d;
			if (lastNegative < DAYS) days.push(Math.max(start, lastNegative + 1));
		}
		return days.length ? `${days.length}@${pct(days, 0.5)}` : '0@—';
	};
	for (const p of hPlans) {
		const h = p.housing!;
		const ss = h.seeds;
		const room = hPlans.find((x) => x.housing?.pair === h.pair && x.housing.variant === 'room');
		const savings = hPlans.find((x) => x.housing?.pair === h.pair && x.housing.variant === 'savings');
		const loan = hPlans.find((x) => x.housing?.pair === h.pair && x.housing.variant === 'loan-home');
		out(`| ${p.name} | ${q(ss.map((x) => x.netWorthDay180))} | ${q(ss.map((x) => x.netWorthDay365))} | ${money(pct(ss.map((x) => x.cashDay180), 0.1))} / ${money(pct(ss.map((x) => x.cashDay365), 0.1))} | ${bought(ss.map((x) => x.firstBuyDay))} | ${bought(ss.map((x) => x.secondBuyDay))} | ${avg(ss.map((x) => x.forcedSales)).toFixed(2)} / ${avg(ss.map((x) => x.evictions)).toFixed(2)} / ${avg(ss.map((x) => x.collapses)).toFixed(2)} | ${avg(ss.map((x) => x.mood)).toFixed(1)} | ${payback(p, room)} / ${payback(p, savings)} / ${h.variant === 'second' ? payback(p, loan, true) : '—'} |`);
	}
}
if (BY_VISA) {
	out();
	out('## 签证专项（--visa）');
	out();
	out(VISA_FOCUS ? '十部门均固定留学生出身；专项机器人直接永居优先，同日可选时 482 优先于 491，拿到 482 后留在担保路线，到期前 1 天仍无别路才续读。消费和考试地点不作弊。费用含签证申请费和雅思费，不含交通。' : '十部门均固定留学生出身；legacy 完全沿用默认机器人的签证顺序、消费和考试行为，只增加诊断输出。费用含签证申请费和雅思费，不含交通。');
	out();
	out('| 部门 | 第 365 天签证 | PR 率 / 中位日 | 失去工作权天数（均值 / 最大） | 签证费（p10 / 中位 / p90） | 路线（人数@中位日） |');
	out('| --- | --- | --- | --- | --- | --- |');
	for (const p of results) {
		const v = p.visa!;
		const kinds = Object.entries(v.finalKinds).map(([k, n]) => `${k} ${n}`).join('，');
		const fees = [v.visaFees.p10, v.visaFees.median, v.visaFees.p90].map(money).join(' / ');
		const routes = Object.entries(v.routes).map(([id, x]) => `${id} ${x.count}@${x.day.median}`).join('，');
		out(`| ${p.name} | ${kinds} | ${(v.prShare * 100).toFixed(0)}% / ${v.prDay ? `第 ${v.prDay.median} 天` : '—'} | ${v.expiredDays.mean.toFixed(1)} / ${v.expiredDays.max} | ${fees} | ${routes || '—'} |`);
	}
}
if (BY_EDU) {
	out();
	out('## 进修回报配对（--edu）');
	out();
	out('同一 pair 使用同一批种子。`do` 是主动拿证减基线；`without` 显示“原课程策略减禁用课程”；`activity` 显示“主动活动减课程”；其余变体显示“变体减基线”。正资产差表示左述方案更富。逐种子日快照和动作学费 / 分钟见 JSON 的 `education.seeds`。');
	out();
	out('| pair | 变体 | 项目 | 入职日差 | 到顶日差 | 第 180 天净资产差 | 第 365 天净资产差 | 平均心情差 |');
	out('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
	const eduPlans = results.filter((p) => p.education);
	const bases = new Map(eduPlans.filter((p) => p.education!.variant === 'base').map((p) => [p.education!.pair, p]));
	for (const p of eduPlans.filter((x) => x.education!.variant !== 'base')) {
		const base = bases.get(p.education!.pair);
		if (!base?.education) continue;
		const bySeed = new Map(base.education.seeds.map((s) => [s.seed, s]));
		const pairs = p.education!.seeds.map((s) => [s, bySeed.get(s.seed)] as const).filter((x): x is readonly [typeof x[0], NonNullable<typeof x[1]>] => !!x[1]);
		const sign = p.education!.variant === 'without' ? -1 : 1;
		const delta = (key: 'jobDay' | 'topDay' | 'netWorthDay180' | 'netWorthDay365' | 'mood') => pairs
			.map(([a, b]) => a[key] === null || b[key] === null ? undefined : sign * (a[key] - b[key]))
			.filter((x): x is number => x !== undefined);
		const med = (key: 'jobDay' | 'topDay' | 'netWorthDay180' | 'netWorthDay365' | 'mood') => delta(key).length ? pct(delta(key), 0.5) : null;
		const signed = (v: number | null, digits = 0) => v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
		out(`| ${p.education!.pair} | ${p.education!.variant} | ${p.education!.item ?? '—'} | ${signed(med('jobDay'))} | ${signed(med('topDay'))} | ${signed(med('netWorthDay180'))} | ${signed(med('netWorthDay365'))} | ${signed(avg(delta('mood')), 2)} |`);
	}
}
out();
if (RISK) {
	out('## 职业风险尾部（--risk）');
	out();
	out('天数列均为「均值 / P90 / 最大」。病假只算原本排班、因当前病伤确实不能上班且当天最终没上成的天；治疗后仍赶上班不算。风险少赚按当天当前等级基础薪估，重叠风险只算一次，不含表现奖金。低现金为日末现金 < $20；连续低现金取每个种子的最长连续天数。最低心情按每个成功动作后的瞬时值取 P10 / 中位 / P90。');
	out();
	out('| 策略 | 第 365 天净资产 P10 / P50 / P90 | P10/P50 | 停工天 | 病假天 | 晕倒天 | 风险少赚均值 / 占可得毛收入 | 无奖金班次 / 奖金损失占比 | 失业 / 降档 | 收房 | 低现金日 / 最长连续日 | 最低心情 P10 / P50 / P90 |');
	out('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const row of riskRows) out(row);
	out();
}
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
