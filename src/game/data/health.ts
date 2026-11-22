// 健康、疾病和看病（第 1 版）。设计和出处见 docs/earth-game/health.md。
//
// 两类数字分开写：
//   - 「真实规定」：Medicare 报销比例、MBS 收费标准、PBS 自付上限等，每条带 source（出处 + 核对日期），不改；
//   - 「游戏数值」：病程天数、发病概率、诊所标价……都是第 1 版初始值，全部「待平衡」，等 Codex 跑完平衡分析再定。
// 文案只是游戏里的简化，不是医疗建议；界面上也这样提示。
import type { Hours, LocationKind } from '../core/types.ts';

/** 动作的「负荷」：生病时按这个拦活动 */
export type Load = 'heavy' | 'sea' | 'work';

/** 一种病或伤 */
export interface ConditionDef {
	id: string;
	name: string;
	icon: string;
	/** 不看病的病程（游戏天）——待平衡 */
	days: number;
	/** 期间做不了的事 */
	blocks: Load[];
	/** 期间每小时额外掉的精力（在需求衰减之外）——待平衡 */
	energyPerHour: number;
	/** 期间每天掉的健康（不会因此掉到 HEALTH.illFloor 以下，生病本身不致晕）——待平衡 */
	healthPerDay: number;
	/** 发病时对应的心情状态（data/moodlets.ts） */
	moodlet: string;
	/** 各种就医把剩余病程乘以多少（不写表示这种就医对它没用）——待平衡 */
	care: Partial<Record<CareKind, number>>;
	/** 看 GP 时会开处方（之后去药房按处方取药，才有 rx 的效果） */
	script?: boolean;
	/** 按处方取药后剩余病程再乘以多少——待平衡 */
	rx?: number;
	/** 这种病的严重程度，急诊排队和提示用：1 轻、2 中、3 重 */
	severity: 1 | 2 | 3;
	desc: string;
}

export const CONDITIONS: ConditionDef[] = [
	{ id: 'cold', name: '感冒', icon: '🤧', days: 3, blocks: ['sea'], energyPerHour: 0.3, healthPerDay: 1, moodlet: 'sick-mild', care: { pharmacy: 0.75, gp: 0.8 }, severity: 1, desc: '流鼻涕、嗓子疼。多休息，药房买点缓解症状的药就行。' },
	{ id: 'flu', name: '流感', icon: '🤒', days: 5, blocks: ['heavy', 'sea', 'work'], energyPerHour: 0.8, healthPerDay: 4, moodlet: 'sick-bad', care: { gp: 0.8, pharmacy: 0.9, ed: 0.8 }, script: true, rx: 0.7, severity: 2, desc: '发烧、浑身疼，只能请病假躺着。' },
	{ id: 'gastro', name: '肠胃炎', icon: '🤢', days: 2, blocks: ['work', 'sea'], energyPerHour: 0.5, healthPerDay: 5, moodlet: 'sick-bad', care: { pharmacy: 0.7, gp: 0.7, ed: 0.7 }, severity: 2, desc: '上吐下泻，补水最要紧，好之前别去上班。' },
	{ id: 'heat', name: '热衰竭', icon: '🥵', days: 1, blocks: ['heavy', 'sea', 'work'], energyPerHour: 0.8, healthPerDay: 6, moodlet: 'sick-bad', care: { ed: 0.3, gp: 0.6, pharmacy: 0.85 }, severity: 3, desc: '在大太阳底下待太久。找阴凉、补水，严重要去急诊。' },
	{ id: 'sprain', name: '扭伤', icon: '🦶', days: 4, blocks: ['heavy', 'sea'], energyPerHour: 0, healthPerDay: 0, moodlet: 'sick-mild', care: { gp: 0.75, ed: 0.6, pharmacy: 0.9 }, severity: 2, desc: '磕了碰了。别做剧烈运动，看医生会好得快一些。' },
];

/** 生病规则——全部待平衡 */
export const HEALTH = {
	/** 生病本身每天掉健康，但不会把健康压到这个值以下（饿、累、受伤照常能致晕） */
	illFloor: 20,
	/** 一次受伤（效果里健康 ≤ −injuryAt，乘过特质之后）就记为扭伤 */
	injuryAt: 10,
	/** 每过一个午夜掷一次发病。各病的基础日概率 */
	base: { cold: 0.006, flu: 0.002, gastro: 0.003, heat: 0, sprain: 0 } as Record<string, number>,
	/** 天气：当天所在地天气的加成（加在日概率上） */
	weather: {
		rain: { cold: 0.01 },
		storm: { cold: 0.02, flu: 0.004 },
		hot: { heat: 0.03 },
	} as Record<string, Record<string, number>>,
	/** 冬季（6–8 月）流感加成：澳洲流感季在冬季 */
	winterFlu: 0.008,
	/** 热天身上有水或电解质冲剂：热衰竭概率乘这个 */
	hydrated: 0.5,
	/** 疲劳：精力低于 fatigueAt 时全部概率乘 fatigueMult */
	fatigueAt: 25,
	fatigueMult: 1.6,
	/** 饮食：饱食低于 hungryAt 时全部概率乘 hungryMult */
	hungryAt: 25,
	hungryMult: 1.4,
	/** 清洁低于 dirtyAt 时肠胃炎额外加 dirtyGastro */
	dirtyAt: 25,
	dirtyGastro: 0.01,
	/** 健康低于 weakAt 时全部概率乘 weakMult */
	weakAt: 50,
	weakMult: 1.3,
};

// ---------- 医疗保障 ----------
export type CoverId = 'medicare' | 'oshc' | 'none';

export interface CoverDef {
	id: CoverId;
	name: string;
	/** GP 门诊按 MBS 收费标准报销的比例（0 表示自费） */
	gpRebate: number;
	/** 处方药：true 表示按 PBS 自付上限付 */
	pbs: boolean;
	/** 公立医院急诊免费 */
	publicEd: boolean;
	note: string;
	/** 依据，见 health.md §3；「待核实」的不当真实规定用 */
	source: string;
}

export const COVERS: CoverDef[] = [
	{
		id: 'medicare', name: 'Medicare', gpRebate: 1, pbs: true, publicEd: true,
		note: '看 GP 按 MBS 收费标准报销 100%；处方药按 PBS 自付上限；公立医院急诊免费。',
		source: 'Services Australia「Medicare」；MBS 非转诊 GP 门诊按收费标准 100% 报销（MBS Online 说明）；PBS 自付上限见 PBS.gov.au（2026-11-20 核对）',
	},
	{
		id: 'oshc', name: '留学生保险 OSHC', gpRebate: 1, pbs: false, publicEd: true,
		note: '学生签证必须持有（签证条件 8501）。GP 按 MBS 收费标准报销；处方药和急诊的具体赔付看保险公司条款（待核实）。',
		source: 'Home Affairs「Adequate health insurance」说明（条件 8501）；卫生部 OSHC Deed（2025-07-01 起）。GP 报销比例、药品、急诊条款未取到 Deed 原文：待核实',
	},
	{
		id: 'none', name: '自费', gpRebate: 0, pbs: false, publicEd: false,
		note: '没有 Medicare，也没买保险：看病按诊所和医院标价付。',
		source: '澳洲只与 11 个国家有对等医疗协议（Services Australia「Reciprocal Health Care Agreements」）；游戏设定背包客不在其中',
	},
];

/**
 * 出身 → 医疗保障（游戏设定，不是签证法规的完整映射）：
 * 留学生持学生签证，必须有 OSHC；背包客按打工度假、来自没有对等医疗协议的国家处理；矿区轮班工、冲浪手设定为本地居民（有 Medicare）。
 */
export const COVER_BY_ORIGIN: Record<string, CoverId> = { student: 'oshc', backpacker: 'none', fifo: 'medicare', surfer: 'medicare' };

/** 真实收费标准（带出处，不改） */
export const REAL_FEES = {
	/** MBS 23 号项目（GP 标准门诊 B 级）收费标准，2025-07-01 起（指数化 2.4%） */
	mbsGp: 43.9,
	mbsGpSource: 'MBS item 23，2025-07-01 起 $43.90（Medical Republic、RACGP newsGP 对 2025-07 指数化的报道；以 MBS Online 为准）',
	/** PBS 普通患者每张处方自付上限，2026-01-01 起 */
	pbsGeneral: 25,
	pbsSource: 'PBS.gov.au「What are the current patient fees and charges?」：2026-01-01 起普通患者 $25（原 $31.60）',
};

export type CareKind = 'gp' | 'pharmacy' | 'ed';

export interface CareDef {
	id: CareKind;
	name: string;
	icon: string;
	/** 地点需满足：kind 命中 或 任一 tag 命中 */
	kinds?: LocationKind[];
	tags?: string[];
	hours?: Hours;
	/** 花的时间（含排队）——待平衡；急诊按严重程度另加等候 */
	minutes: number;
	/** 标价（自费要付的）——待平衡 */
	fee: number;
	/** 回的健康——待平衡 */
	health: number;
	desc: string;
}

const TOWNS: LocationKind[] = ['city', 'port', 'town', 'coast', 'mining', 'island'];

export const CARE: CareDef[] = [
	{ id: 'gp', name: '看全科医生（GP）', icon: '🩺', kinds: TOWNS, tags: ['hospital'], hours: [8, 18], minutes: 90, fee: 85, health: 10, desc: '小病先看 GP。会开处方的病，之后去药房取药好得更快。' },
	{ id: 'pharmacy', name: '去药房', icon: '💊', kinds: TOWNS, tags: ['hospital'], hours: [8, 21], minutes: 20, fee: 15, health: 4, desc: '有处方按处方取药；没有处方就买些缓解症状的非处方药。' },
	{ id: 'ed', name: '公立医院急诊', icon: '🚑', tags: ['hospital'], minutes: 180, fee: 650, health: 25, desc: '急症、重伤去急诊。按轻重排队，小病要等很久。' },
];

/** 按处方取药：药品标价——待平衡；有 PBS 的按 REAL_FEES.pbsGeneral 封顶 */
export const RX_PRICE = 40;
/** 急诊候诊：严重程度 1/2/3 额外等的分钟——待平衡（分诊：越轻等越久） */
export const ED_WAIT = { 1: 240, 2: 120, 3: 30 } as Record<number, number>;
