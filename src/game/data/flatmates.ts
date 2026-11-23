// 室友与合租：NPC 室友的人设、合租规则数值、室友事件。
// 规则在 core/flatmates.ts（纯函数）和 core/flat-actions.ts（动作）。设计见 docs/earth-game/flatmates.md。
// 本文件所有数值都是第一版初值，标「待平衡」，由 Codex 跑模拟分析后再定。
// 人设和文案都是原创的，不对应任何真人或现有作品里的角色。

/** 性格四个维度，各 0–2。tidy 越高越爱干净；noise 越高越吵；borrow 越高越爱借东西、越拖着不还；warm 越高越爱分享照顾人 */
export interface FlatmateDef {
	id: string;
	name: string;
	avatar: string;
	bio: string;
	tidy: 0 | 1 | 2;
	noise: 0 | 1 | 2;
	borrow: 0 | 1 | 2;
	warm: 0 | 1 | 2;
}

export const FLATMATES: FlatmateDef[] = [
	{ id: 'fm-xiaoyu', name: '小雨', avatar: '👩', bio: '会计硕士在读，作息规律，冰箱里的东西都贴着名字。', tidy: 2, noise: 0, borrow: 0, warm: 1 },
	{ id: 'fm-ajie', name: '阿杰', avatar: '🧑', bio: '打工度假第二年，白天在农场，晚上喜欢叫朋友来家里喝两杯。', tidy: 0, noise: 2, borrow: 1, warm: 2 },
	{ id: 'fm-mia', name: 'Mia', avatar: '👱', bio: '本地护士，轮夜班，白天睡觉，最怕吵。', tidy: 2, noise: 0, borrow: 0, warm: 1 },
	{ id: 'fm-laozhou', name: '老周', avatar: '🧔', bio: '做装修的，工具多，人热心，就是碗总留到第二天洗。', tidy: 0, noise: 1, borrow: 0, warm: 2 },
	{ id: 'fm-kenji', name: 'Kenji', avatar: '😎', bio: '设计专业学生，深夜赶图时音乐开得有点大。', tidy: 1, noise: 2, borrow: 1, warm: 1 },
	{ id: 'fm-lingling', name: '玲玲', avatar: '👩‍🦰', bio: '刚来读语言班，什么都缺，经常问你借点东西。', tidy: 1, noise: 1, borrow: 2, warm: 1 },
	{ id: 'fm-dan', name: 'Dan', avatar: '🤠', bio: '矿上做两周休一周，休假那周在家煮一大锅饭分给大家。', tidy: 1, noise: 1, borrow: 0, warm: 2 },
	{ id: 'fm-haoran', name: '浩然', avatar: '🧑‍🦱', bio: '在读 IT，打游戏到半夜，房租偶尔拖两天。', tidy: 0, noise: 1, borrow: 2, warm: 0 },
];

/** 合租规则数值（全部待平衡） */
export const FLAT_RULES = {
	/** 各房型最多住几个人（含玩家）。不在表里的房型不能合租（营地、地下屋）。待平衡 */
	beds: { room: 3, flat: 2, seaview: 2, beach: 3 } as Record<string, number>,
	/** 合租房间自带的室友数：租下就有，房租不变，室友搬走后下个结算日补上新人。待平衡 */
	autoMates: { room: 2 } as Record<string, number>,
	/** 每周水电网。只在你当二房东、有室友分摊时计入（一个人住时视为含在房租里，和现状一致）。待平衡 */
	billsWeek: { flat: 45, seaview: 55, beach: 70 } as Record<string, number>,
	/** 转租：你人不在、把房间短租出去时，按你那份房租的这个比例收回。待平衡 */
	subletRate: 0.9,
	/** 卫生（0–100）：新住处起点；每周每人弄脏多少（按 tidy 0/1/2，玩家固定 10）；轮到 NPC 值日时打扫回来多少；玩家做一次家务加多少。待平衡 */
	cleanStart: 70,
	cleanDecay: [18, 10, 4] as const,
	cleanDecayMe: 10,
	dutyClean: [12, 25, 40] as const,
	choreClean: 30,
	choreMinutes: 45,
	choreEnergy: -6,
	/** 卫生低于这个值：回家睡觉少恢复清洁、住处心情 −3、爱干净的室友每周关系 −2。待平衡 */
	messyBelow: 35,
	messyHygiene: -15,
	messyComfort: -3,
	messyTidyVibe: -2,
	/** 当二房东时每多一个室友，住处心情 −1（少了点隐私）。合租房间本来就是合住，不扣。待平衡 */
	privacyPerMate: -1,
	/** 和室友的关系（−100–100）：起点；平均关系到这个值以上，回家睡觉有「室友相处融洽」；低于 leaveBelow 时室友提出下周搬走。待平衡 */
	vibeStart: 10,
	harmonyAbove: 40,
	leaveBelow: -40,
	/** 值日：轮到你那周做过家务，每位室友关系 +3；没做 −8。待平衡 */
	dutyDoneVibe: 3,
	dutySkipVibe: -8,
	/** 回家睡觉时每位室友带来的社交恢复（最多算 2 位）。待平衡 */
	socialPerMate: 6,
	/** 每次回家睡觉抽一次室友事件的几率；没处理的事件过几天作废，那位室友关系 −4。待平衡 */
	eventChance: 0.3,
	eventExpireDays: 3,
	eventExpireVibe: -4,
	/** 借钱的室友每个结算日还钱的几率（按 borrow 0/1/2）。待平衡 */
	repayChance: [0.95, 0.7, 0.35] as const,
	/** 请室友搬走：提前一周通知，关系 −10。找室友（见面、看房）花 60 分钟，社交 +10。待平衡 */
	askOutVibe: -10,
	inviteMinutes: 60,
	inviteSocial: 10,
	/** 每次给你看几位找房的人 */
	candidates: 3,
	/** 室友最多几位（存档清洗用的硬上限，比最大床位多一点余量） */
	maxMates: 4,
};

/** 事件选项：cost 是要先付的钱；vibe 是和这位室友的关系变化；lend 是借给室友的钱（记账，结算日按几率还） */
export interface FlatChoice {
	label: string;
	cost?: number;
	lend?: number;
	vibe: number;
	clean?: number;
	minutes?: number;
	needs?: Partial<Record<'hunger' | 'energy' | 'hygiene' | 'fun' | 'social', number>>;
	moodlet?: string;
}

/** 室友事件：当这位室友某个性格维度 ≥ min 时才可能抽到（dirty 为卫生低于 messyBelow 时才可能抽到）。文案里 {name} 换成室友名字 */
export interface FlatEventDef {
	id: string;
	icon: string;
	title: string;
	text: string;
	needs: { noise?: number; borrow?: number; warm?: number; untidy?: number; dirty?: boolean };
	weight: number;
	choices: FlatChoice[];
}

export const FLAT_EVENTS: FlatEventDef[] = [
	{
		id: 'fe-party', icon: '🎶', title: '半夜的客厅', text: '快一点了，{name}和朋友还在客厅聊天放歌，你明天还要早起。', needs: { noise: 2 }, weight: 3,
		choices: [
			{ label: '敲门请他们小声点', vibe: -3, needs: { energy: -4 } },
			{ label: '戴上耳塞忍一忍', vibe: 0, needs: { energy: -12 }, moodlet: 'flat-noisy' },
			{ label: '出去一起聊会儿', vibe: 6, minutes: 60, needs: { energy: -15, fun: 15, social: 20 } },
		],
	},
	{
		id: 'fe-music', icon: '🎧', title: '隔墙的音乐', text: '{name}在赶作业，音箱的低音震得你墙上的挂钩都在响。', needs: { noise: 1 }, weight: 2,
		choices: [
			{ label: '发消息请 TA 戴耳机', vibe: -1 },
			{ label: '算了，自己也听会儿歌', vibe: 1, needs: { fun: 4, energy: -6 }, moodlet: 'flat-noisy' },
		],
	},
	{
		id: 'fe-dishes', icon: '🍽️', title: '堆满的水槽', text: '水槽里又堆满了{name}的碗，锅里的油已经凝住了。', needs: { untidy: 2 }, weight: 3,
		choices: [
			{ label: '顺手帮 TA 洗了', vibe: 3, clean: 12, minutes: 30, needs: { energy: -4 } },
			{ label: '在群里提一句值日表', vibe: -3, clean: 6 },
			{ label: '眼不见为净', vibe: 0, clean: -5 },
		],
	},
	{
		id: 'fe-bathroom', icon: '🚿', title: '浴室的头发', text: '浴室下水口又被堵住了，看样子不是你的头发。', needs: { dirty: true }, weight: 2,
		choices: [
			{ label: '戴上手套通一下', vibe: 0, clean: 10, minutes: 20, needs: { hygiene: -5 } },
			{ label: '拍张照发给{name}', vibe: -4, clean: 4 },
		],
	},
	{
		id: 'fe-borrow-cash', icon: '💸', title: '借点钱', text: '{name}说这周工资晚发，想先借 $40 交手机费，发了马上还。', needs: { borrow: 1 }, weight: 2,
		choices: [
			{ label: '借给 TA $40', lend: 40, vibe: 5 },
			{ label: '委婉地说自己也紧', vibe: -2 },
		],
	},
	{
		id: 'fe-borrow-stuff', icon: '🧴', title: '少了的洗发水', text: '你的洗发水一下子少了半瓶，{name}昨天说过自己的用完了。', needs: { borrow: 2 }, weight: 2,
		choices: [
			{ label: '直接问 TA', vibe: -3 },
			{ label: '再买一瓶，顺便贴上名字', cost: 8, vibe: 0 },
			{ label: '算了，不就一点洗发水', vibe: 1, moodlet: 'flat-annoyed' },
		],
	},
	{
		id: 'fe-shared-meal', icon: '🍲', title: '一大锅饭', text: '{name}煮了一大锅饭，喊你一起吃。', needs: { warm: 2 }, weight: 3,
		choices: [
			{ label: '坐下一起吃', vibe: 5, minutes: 45, needs: { hunger: 40, social: 15 }, moodlet: 'warm-moment' },
			{ label: '谢谢，我刚吃过', vibe: 0 },
		],
	},
	{
		id: 'fe-chat', icon: '☕', title: '厨房里聊两句', text: '早上在厨房碰到{name}，TA 问你最近过得怎么样。', needs: { warm: 1 }, weight: 2,
		choices: [
			{ label: '多聊一会儿', vibe: 3, minutes: 20, needs: { social: 10 } },
			{ label: '笑笑说还行，赶时间', vibe: 0 },
		],
	},
];
