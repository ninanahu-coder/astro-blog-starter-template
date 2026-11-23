// 心理状态（第 43 批，设计见 docs/earth-game/mood.md）：孤独、思乡、压力三种「心事」的触发条件，
// 以及低谷期的判定、恢复建议和现实求助渠道。引擎只读这张表，不为某个出身、地点写特例。
// 本文件所有数值都是【待平衡】，未经 Codex 平衡分析。

/** 三种心事。每种对应 moodlets.ts 里一个负面心情状态 */
export const MIND_KEYS = ['lonely', 'homesick', 'stressed'] as const;
export type MindKey = (typeof MIND_KEYS)[number];

export interface MindSignalDef {
	key: MindKey;
	/** 触发时获得的心情状态 id */
	moodlet: string;
	/** 分数 ≥ trigger 时触发（每个游戏日结算一次） */
	trigger: number;
	/** 触发时写进日志的话 */
	log: string;
}

export const MIND_SIGNALS: MindSignalDef[] = [
	{ key: 'lonely', moodlet: 'lonely', trigger: 0.25, log: '好几天没怎么跟人说话了，有点孤单。' },
	{ key: 'homesick', moodlet: 'homesick', trigger: 0.5, log: '有点想家了。' },
	{ key: 'stressed', moodlet: 'stressed', trigger: 0.4, log: '最近事情压在心上，有点喘不过气。' },
];

export const MIND = {
	/** 孤独：分数 = (lonelySocial − 社交) / lonelySocial，钳 0–1；默认社交 < 30 触发 */
	lonelySocial: 40,
	/** 每位「朋友」以上（好感 ≥ friendScore）的 NPC 减少孤独和思乡分数，最多算 friendCap 位 */
	friendScore: 30,
	friendRelief: 0.15,
	friendCap: 2,
	/** 思乡：出身的权重 × 到达后天数的曲线 */
	homesickOrigin: { student: 0.8, backpacker: 0.5, fifo: 0.4, surfer: 0.3 } as Record<string, number>,
	homesickDefault: 0.5,
	/** 从第 from 天起乘 k。参考「文化适应」常见描述：头一周新鲜，之后几周最容易想家，慢慢适应 */
	homesickCurve: [
		{ from: 0, k: 0.3 },
		{ from: 7, k: 1 },
		{ from: 42, k: 0.75 },
		{ from: 90, k: 0.4 },
	],
	/** 心情低于这个值的日子算「低落的一天」；连续 helpAfter 天显示低谷期提示 */
	low: 25,
	helpAfter: 2,
	lowCap: 30,
} as const;

/** 压力来源：每条满足就加 weight。cond 的含义由 core/mind.ts 解释 */
export interface PressureDef {
	id: 'rent' | 'broke' | 'unwell' | 'heat' | 'exhausted';
	label: string;
	weight: number;
}
export const PRESSURES: PressureDef[] = [
	{ id: 'rent', label: '现金不够下一次每周开销', weight: 0.4 },
	{ id: 'broke', label: '身上快没钱了', weight: 0.3 },
	{ id: 'unwell', label: '身体不太好', weight: 0.3 },
	{ id: 'heat', label: '惹上的麻烦还没过去', weight: 0.3 },
	{ id: 'exhausted', label: '累坏了', weight: 0.2 },
];
export const PRESSURE_AT = { broke: 50, unwell: 40, heat: 60, exhausted: 20 } as const;

/** 主动调节心情的两个动作（任何地方都能做，不花钱）。moodlet 见 moodlets.ts */
export const MIND_ACTS = {
	call: { name: '给家里打个视频', icon: '📱', minutes: 40, moodlet: 'called-home', msg: '和家里视频聊了一会儿，听到熟悉的声音，心里踏实多了。' },
	talk: { name: '找人聊聊', icon: '💬', minutes: 30, moodlet: 'talked-it-out', msg: '把心事说给信得过的人听，说出来好多了。' },
} as const;
export type MindOp = keyof typeof MIND_ACTS;

/** 每种心事在游戏里怎么缓解：界面直接显示 */
export const MIND_TIPS: Record<MindKey, string> = {
	lonely: '和熟人聊天、参加聚会和共同活动、交新朋友，或者找人聊聊。',
	homesick: '给家里打个视频、过个节、找人聊聊；多交几个朋友，慢慢就习惯了。',
	stressed: '运动一下、睡个好觉、出去玩一趟，或者找人聊聊；钱的压力可以先找份工作、换便宜的住处。',
};

/**
 * 现实中的求助渠道。只在心情页的说明里列出，不弹窗、不打扰。
 * 号码在 2026-11-20 用官网搜索结果核对过（没有打开每个页面逐字看），改动前先看 url。
 */
export interface HelpLine {
	name: string;
	contact: string;
	desc: string;
	url: string;
}
export const HELP_LINES: HelpLine[] = [
	{ name: 'Lifeline', contact: '电话 13 11 14 · 短信 0477 13 11 14', desc: '24 小时危机支持，也可以在官网文字聊天。', url: 'https://www.lifeline.org.au/get-help/national-services/lifeline-crisis-support' },
	{ name: 'Beyond Blue', contact: '电话 1300 22 4636', desc: '焦虑、抑郁的倾诉和建议，24 小时，免费、保密。', url: 'https://www.beyondblue.org.au/about/contact-us' },
	{ name: 'TIS 口译服务', contact: '电话 131 450', desc: '需要中文口译时先打这个号，再请对方转接上面的服务。', url: 'https://www.tisnational.gov.au/contact-us' },
	{ name: '紧急情况', contact: '000', desc: '有生命危险时直接拨打。', url: 'https://www.triplezero.gov.au/triple-zero/How-to-Call-000' },
];
