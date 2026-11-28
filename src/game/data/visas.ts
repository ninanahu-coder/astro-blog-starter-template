// 签证路线（第 43 批提议，设计见 docs/earth-game/visa.md）。
// 真实政策出处：澳大利亚内政部 Home Affairs（immi.homeaffairs.gov.au）。本表是游戏简化版：
// 以官方为准、游戏简化，不构成移民建议。数值凡是游戏自定的（时间换算、费用、几率）一律「待平衡」。
// 各条现实依据和核对状态（哪些读到原文、哪些只有转述）见 visa.md 第 2 节。

/** 持有的签证状态。'none'：不在签证系统里（非留学生出身，按本地人或其他签证处理，本批不管） */
export type VisaKind = 'none' | 'student' | 'graduate' | 'graduate2' | 'sponsored' | 'regional' | 'pr' | 'expired';

/** 申请的路线。几条 PR 路线结果相同，条件不同 */
export type VisaRoute = 'student' | 'graduate' | 'graduate2' | 'sponsored' | 'ens' | 'skilled' | 'state' | 'regional' | 'regionalPr';

export interface VisaKindDef {
	id: VisaKind;
	/** 现实签证类别号；none / expired 没有 */
	sub: string;
	name: string;
	icon: string;
	/** 一句话说明，界面上显示 */
	desc: string;
	/** 有效期，单位：签证年（× VISA_RULES.daysPerYear 换成游戏日）。0 = 不按年算（学生签跟课程走、PR 永久） */
	years: number;
}

export const VISA_KINDS: VisaKindDef[] = [
	{ id: 'none', sub: '', name: '不需要签证', icon: '🪪', desc: '这个出身不走签证路线。', years: 0 },
	{ id: 'student', sub: '500', name: '学生签证', icon: '🎓', desc: '读书期间可以兼职；课程结束后签证再留一小段时间。', years: 0 },
	{ id: 'graduate', sub: '485', name: '毕业生工作签证', icon: '📜', desc: '毕业后全职工作的过渡签证，攒经验、考英语、找担保。', years: 2 },
	{ id: 'graduate2', sub: '485', name: '第二次毕业生签证（偏远地区）', icon: '🏞️', desc: '在偏远地区读书、生活过的毕业生多留一段时间，要继续住在偏远地区。', years: 0 },
	{ id: 'sponsored', sub: '482', name: '雇主担保工作签证（Skills in Demand）', icon: '🧑‍💼', desc: '跟着担保雇主做本行；做满两年可以转雇主担保永居。', years: 4 },
	{ id: 'regional', sub: '491', name: '偏远地区技术移民临时签证', icon: '🌾', desc: '西澳或南澳州政府提名，在偏远地区住满三年、有工作收入可以转永居。', years: 5 },
	{ id: 'pr', sub: 'PR', name: '永久居民', icon: '🏡', desc: '不再有签证到期和打工限制。', years: 0 },
	{ id: 'expired', sub: '', name: '签证已过期', icon: '⛔', desc: '不能工作。游戏里可以重新申请学生签证接着留下（现实中逾期滞留会被遣返，并可能被禁止入境）。', years: 0 },
];

export interface VisaRouteDef {
	id: VisaRoute;
	sub: string;
	name: string;
	/** 批下来以后变成哪种状态 */
	to: VisaKind;
	/** 从哪些状态可以申请 */
	from: VisaKind[];
	/** 游戏价（含学费押金等），待平衡；现实收费见 Home Affairs 的签证收费页 */
	fee: number;
	desc: string;
}

export const VISA_ROUTES: VisaRouteDef[] = [
	{ id: 'student', sub: '500', name: '续读：再申请学生签证', to: 'student', from: ['student', 'graduate', 'graduate2', 'expired'], fee: 1200, desc: '报一个两年的硕士课程（本科毕业后才能报），签证跟着新课程走。费用含首期学费押金。' },
	{ id: 'graduate', sub: '485', name: '毕业生工作签证', to: 'graduate', from: ['student'], fee: 650, desc: '毕业后申请，不限工时。' },
	{ id: 'graduate2', sub: '485', name: '第二次毕业生签证', to: 'graduate2', from: ['graduate'], fee: 650, desc: '在偏远地区读书生活过才有；在珀斯、阿德莱德多 1 年，其他偏远地区多 2 年。' },
	{ id: 'sponsored', sub: '482', name: '雇主担保工作签证', to: 'sponsored', from: ['student', 'graduate', 'graduate2', 'sponsored'], fee: 750, desc: '现在的雇主为你担保。持 482 换到新的清单职业时，可以由新雇主重新担保。' },
	{ id: 'ens', sub: '186', name: '雇主担保永居（过渡类）', to: 'pr', from: ['sponsored'], fee: 1300, desc: '为担保雇主做满两年后，雇主提名你转永居。' },
	{ id: 'skilled', sub: '189', name: '独立技术移民', to: 'pr', from: ['student', 'graduate', 'graduate2', 'sponsored'], fee: 1300, desc: '按打分，不需要提名。' },
	{ id: 'state', sub: '190', name: '州担保技术移民', to: 'pr', from: ['student', 'graduate', 'graduate2', 'sponsored'], fee: 1300, desc: '西澳或南澳州政府提名，加 5 分。' },
	{ id: 'regional', sub: '491', name: '偏远地区技术移民临时签证', to: 'regional', from: ['student', 'graduate', 'graduate2', 'sponsored'], fee: 1100, desc: '州政府提名到偏远地区，加 15 分；先拿 5 年临时签证。' },
	{ id: 'regionalPr', sub: '191', name: '偏远地区永居', to: 'pr', from: ['regional'], fee: 1300, desc: '持 491 在偏远地区住满 3 年、期间有足够的工作收入。' },
];

/** 游戏规则数值。标「现实」的来自 Home Affairs（简化）；其余是游戏自定，全部待平衡 */
export const VISA_RULES = {
	/** 一个「签证年」= 多少游戏日。待平衡：现实年太长，按真实比例玩家一辈子拿不到 PR */
	daysPerYear: 60,
	/** 留学生开局年龄（待平衡）；之后每过一个签证年长一岁 */
	startAge: 22,
	/** 开局的雅思总分（待平衡；现实学生签证本身也有英语要求，分数随课程而定） */
	startIelts: 6,
	/** 开局时本科还剩多少游戏日（待平衡，约 1.5 签证年） */
	startCourseDays: 90,
	/** 续读的硕士课程多少游戏日（待平衡；现实授课型硕士多为 1.5–2 年） */
	masterCourseDays: 120,
	/** 课程结束后学生签证还剩多少游戏日（待平衡；现实一般比课程结束晚几个月） */
	courseTailDays: 15,
	/** 到期前几天提醒一次（待平衡） */
	warnDays: 7,
	/** 485：现实年龄上限 35 岁（不含研究型硕士、博士）；雅思 6.5 为第三方转述、未读到官方原文 */
	graduate: { maxAge: 35, minIelts: 6.5 },
	/** 第二次 485：现实里第二类地区（珀斯、阿德莱德）多 1 年，第三类多 2 年 */
	graduate2: { cat2Years: 1, cat3Years: 2 },
	/** 482 核心技能类：现实要求至少 1 年相关工作经验；雅思 5.0 为游戏取值，未核对官方原文 */
	sponsored: { minIelts: 5, minExpYears: 1 },
	/** 186 过渡类：现实为担保下工作满 2 年、45 岁以下、英语达 competent（雅思 6） */
	ens: { maxAge: 45, minIelts: 6, sponsorYears: 2 },
	/** 打分类（189/190/491）：现实及格线 65 分、受邀时 45 岁以下、英语 competent；游戏里要求本行经验至少 1 年代替职业评估（待平衡） */
	points: { pass: 65, maxAge: 45, minIelts: 6, minExpYears: 1 },
	/** 191：现实为持 491 满 3 年；收入门槛官方说法本批未核实，游戏用「至少一半的日子在上班」代替（待平衡） */
	regionalPr: { years: 3, workShare: 0.5 },
	/** 考雅思（游戏价和几率，待平衡）：每次有 chance 的几率涨半分，chance = base + 魅力 / charismaDiv，最多 max */
	ielts: { fee: 200, minutes: 180, base: 0.35, charismaDiv: 200, max: 0.8, kinds: ['city'] as string[] },
};

/** 打分表（现实，按 Home Affairs 189 打分表；第三方逐项核对，官方页面本批 403 未读到原文） */
export const POINTS = {
	/** [最小年龄, 最大年龄, 分] */
	age: [[18, 24, 25], [25, 32, 30], [33, 39, 25], [40, 44, 15]] as [number, number, number][],
	/** [雅思至少, 分]：superior 8、proficient 7、competent 6 */
	english: [[8, 20], [7, 10], [6, 0]] as [number, number][],
	/** [澳洲本行工作至少几年, 分] */
	ausExp: [[8, 20], [5, 15], [3, 10], [1, 5]] as [number, number][],
	/** 学历：本科、硕士都是 15（博士 20，游戏里没有） */
	degree: { none: 0, bachelor: 15, master: 15 } as Record<string, number>,
	/** 在澳洲读满两年 */
	ausStudy: 5,
	/** 在偏远地区读书生活（西澳、南澳全境都是 designated regional area） */
	regionalStudy: 5,
	/** 单身申请（游戏里没有伴侣系统，按单身算） */
	single: 10,
	/** 州政府提名：190 加 5，491 加 15 */
	nomination: { state: 5, regional: 15 } as Record<string, number>,
};

/**
 * 职业对应的「移民职业」（游戏简化，**不代表真实职业清单**）。
 * 现实里是 Home Affairs 的技术移民职业清单（MLTSSL 等）和担保用的 Core Skills Occupation List，需要职业评估；
 * 这里只按游戏里的职业和等级粗略对应，用来演示「要在清单职业里攒经验」这条规则。待平衡。
 * skilled：能走 189/190；regional：能被西澳 / 南澳州担保走 491；sponsor：能被雇主担保（482/186）。minLevel：到这一级才算本行经验。
 * regional 是两州合并后的游戏简化标记：WA / SA 现实清单不同，不代表任一州的官方完整清单。
 */
export interface OccupationDef {
	career: string;
	title: string;
	minLevel: number;
	skilled: boolean;
	regional: boolean;
	sponsor: boolean;
}

export const OCCUPATIONS: OccupationDef[] = [
	{ career: 'barista', title: '咖啡馆经理', minLevel: 2, skilled: false, regional: true, sponsor: true }, // 141111：SA 491 已核实；WA 当轮 Schedule 2 获邀，但逐签证清单无法从现有材料核实
	{ career: 'bartender', title: '酒吧经理', minLevel: 2, skilled: false, regional: false, sponsor: true }, // ANZSCO 无独立“酒吧经理”；最接近的 141211 在 SA 不在列；141311 酒店经理虽在 SA 491、WA 当轮获邀，但不对应本职业
	{ career: 'lifeguard', title: '水上安全主管', minLevel: 2, skilled: false, regional: false, sponsor: true },
	{ career: 'guide', title: '旅游团领队', minLevel: 2, skilled: true, regional: true, sponsor: true },
	{ career: 'miner', title: '矿山设备操作员', minLevel: 1, skilled: true, regional: true, sponsor: true },
	{ career: 'trucker', title: '重型卡车司机', minLevel: 1, skilled: false, regional: false, sponsor: true }, // WA / SA 游戏中改走雇主担保；SA 现实可见 DAMA 路径
	{ career: 'farmhand', title: '农场主管', minLevel: 2, skilled: true, regional: true, sponsor: true },
	// 合并 main 时补上 main 的三个持证职业（visa.md §9 原本就列为合并时要做）。等级和能走哪条路是游戏取值，待平衡
	{ career: 'builder', title: '建筑工长', minLevel: 1, skilled: true, regional: true, sponsor: true },
	{ career: 'carer', title: '养老护理员', minLevel: 1, skilled: false, regional: false, sponsor: true }, // 423111：SA 不在列；WA 逐项状态无法从现有官方材料核实，保留 482→186 路
	{ career: 'it-support', title: 'ICT 支持工程师', minLevel: 0, skilled: true, regional: true, sponsor: true },
];

/**
 * 地区类别（现实：Home Affairs「Designated regional area postcodes」按邮编分三类；西澳、南澳没有第一类）。
 * 第二类（Cities and Major Regional Centres）：珀斯 6000–6038、6050–6083、6090–6182、6208–6211、6214、6556–6558；
 * 阿德莱德 5000–5171、5173–5174、5231–5235、5240–5252、5351、5950–5960。其余西澳、南澳邮编都是第三类。
 * 下表是游戏地点里落在第二类邮编范围的那些（地点 → 邮编；邮编按地点所在镇区填写，待逐个核对），没列的都按第三类。
 */
export const CATEGORY2_POSTCODES: Record<string, number> = {
	perth: 6000, fremantle: 6160, rottnest: 6161, mandurah: 6210,
	adelaide: 5000, glenelg: 5045, 'mclaren-vale': 5171, hahndorf: 5245,
};

/** 第二类邮编范围（同上，用来自检上表） */
export const CATEGORY2_RANGES: [number, number][] = [
	[6000, 6038], [6050, 6083], [6090, 6182], [6208, 6211], [6214, 6214], [6556, 6558],
	[5000, 5171], [5173, 5174], [5231, 5235], [5240, 5252], [5351, 5351], [5950, 5960],
];

/** 签证过期时不能做的零工（雇佣性质；街头表演不算）。和学生签证工时用同一份清单（data/education.ts），合并时去掉了重复的定义 */
export { VISA_GIGS } from './education.ts';

/** 页面上显示的出处和免责声明 */
export const VISA_SOURCE = { name: 'Home Affairs', url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing' };
export const VISA_DISCLAIMER = '以官方为准、游戏简化，不是移民建议。';
