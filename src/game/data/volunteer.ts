// 志愿者与社区声望（设计见 docs/earth-game/volunteer.md）。
// 规则在 core/volunteer.ts（结算）和 core/respect.ts（社区信誉、推荐信），这里只放数据。
// 所有数值都是「待平衡」：第一版的手感值，等模拟和玩家数据再调，Claude 不下平衡结论。
//
// 真实组织只写查得到公开资料的，source 是核实时用的页面（2026-11-20 查）。
// 游戏里只把它们当「现实里做这件事的组织」列出来作参考，不冒充它们发通知、不代表它们的立场；
// 招募时间、地点、门槛以对方官网为准，游戏里的时段和要求是简化的。
import type { Effect, Hours, LocationKind } from '../core/types.ts';

export type AreaId = 'wa' | 'sa';

export interface VolunteerOrg {
	id: string;
	name: string; // 中文叫法
	en: string; // 官方英文名
	area: AreaId;
	what: string; // 现实里在做什么（一句话，来自 source）
	source: string; // 公开资料网址
}

export const VOLUNTEER_ORGS: VolunteerOrg[] = [
	{ id: 'foodbank-wa', name: '西澳食物银行', en: 'Foodbank WA', area: 'wa', what: '仓库志愿者分拣、打包食物，经分店、慈善伙伴和流动食物站发出去；18 岁以上、提供培训。', source: 'https://www.foodbank.org.au/wa/want-to-help/volunteer-with-us/individual-volunteering/' },
	{ id: 'foodbank-sa', name: '南澳食物银行', en: 'Foodbank SA', area: 'sa', what: '仓库在阿德莱德 Edwardstown，招拣货打包、货车司机等志愿者。', source: 'https://foodbank.org.au/support-us/volunteer-with-us/?state=sa' },
	{ id: 'tangaroa-blue', name: '唐加罗阿蓝基金会', en: 'Tangaroa Blue Foundation', area: 'wa', what: '每年 10 月和 Keep Australia Beautiful WA 合办西澳海滩清洁日，捡到的垃圾分类记进海洋垃圾数据库。', source: 'https://tangaroablue.org/volunteer' },
	{ id: 'native-arc', name: '本土动物救助会', en: 'Native Animal Rescue', area: 'wa', what: '1982 年成立，在珀斯 Malaga 救治、放归受伤和失去父母的本土动物。', source: 'https://www.volunteer.com.au/volunteering-organisations/9590/native-animal-rescue' },
	{ id: 'fauna-rescue-sa', name: '南澳动物救助会', en: 'Fauna Rescue of South Australia', area: 'sa', what: '志愿者在自己家里照顾受伤、生病和失去父母的野生动物；收养野生动物须持救助许可。', source: 'https://www.volunteer.com.au/volunteering-organisations/15162/fauna-rescue-of-south-australia-inc' },
	{ id: 'chung-wah', name: '中华会馆', en: 'Chung Wah Association', area: 'wa', what: '西澳最老的族裔社团，办中文学校、舞龙、龙舟和珀斯春节游园会；社区与养老部招志愿者陪伴老人。', source: 'https://www.volunteer.com.au/volunteering-organisations/1811' },
	{ id: 'cws-sa', name: '南澳华人福利会', en: 'Chinese Welfare Services of SA', area: 'sa', what: '1991 年成立，服务南澳讲中文的社区，在阿德莱德提供居家养老支持。', source: 'https://www.myagedcare.gov.au/find-a-provider/search/kwmjz12y-chinese-welfare-services-of-south-australia' },
];

export type GigId = 'beach-cleanup' | 'food-bank' | 'sausage-sizzle' | 'festival-helper' | 'wildlife-rescue' | 'elder-visit' | 'cn-assoc';

export interface VolunteerGig {
	id: GigId;
	name: string;
	icon: string;
	desc: string;
	/** 在哪能做：kind 或 tag 命中，或在 locs 里；都不写不行（志愿活动一定有地方） */
	kinds?: LocationKind[];
	tags?: string[];
	locs?: string[];
	/** 节日志愿者：只有这个地点正在办节日时才有 */
	festival?: true;
	hours: Hours;
	minutes: number;
	fx: Effect; // 只写 needs、skills，不写 cash（志愿没有报酬）、不写 respect（声望单独算，见 respect）
	respect: number; // 每次的声望（待平衡）
	/** 社区信誉等级要求（core/respect.ts 的 volTier().lv，0 起） */
	minTier?: number;
	/** 现实里做这件事的组织，按区域 */
	orgs: Partial<Record<AreaId, string>>;
	/** 可能在场的 NPC：TA 此刻在这个地点时，一起做完关系 +VOL_RULES.npcGain */
	npcs?: string[];
}

export const VOLUNTEER_GIGS: VolunteerGig[] = [
	{
		id: 'beach-cleanup', name: '海滩清洁', icon: '🧹', tags: ['beach'], hours: [7, 11], minutes: 120,
		fx: { needs: { energy: -14, social: 10, fun: 8 }, skills: { stamina: 0.5, survival: 0.3 } },
		respect: 0.5, orgs: { wa: 'tangaroa-blue' }, npcs: ['linda', 'sam'],
		desc: '早上沿着沙滩捡塑料瓶盖和渔线，分类记数。',
	},
	{
		id: 'food-bank', name: '食物银行分拣', icon: '📦', kinds: ['city'], hours: [9, 15], minutes: 180,
		fx: { needs: { energy: -20, social: 15 }, skills: { strength: 0.6 } },
		respect: 0.5, orgs: { wa: 'foodbank-wa', sa: 'foodbank-sa' },
		desc: '在仓库里把捐来的食物分拣、装箱，送给慈善机构。',
	},
	{
		id: 'sausage-sizzle', name: '社区香肠摊', icon: '🌭', tags: ['market'], kinds: ['town'], hours: [9, 14], minutes: 120,
		fx: { needs: { hunger: 15, social: 20, energy: -10 }, skills: { charisma: 0.5 } },
		respect: 0.5, orgs: {},
		desc: '给本地球队或学校的募捐香肠摊站一班，翻香肠、收零钱。',
	},
	{
		id: 'festival-helper', name: '节日志愿者', icon: '🎪', festival: true, hours: [10, 22], minutes: 180,
		fx: { needs: { social: 20, fun: 15, energy: -18 }, skills: { charisma: 0.5 } },
		respect: 0.5, orgs: {},
		desc: '节日期间帮忙指路、搬桌椅、维持排队。',
	},
	{
		id: 'wildlife-rescue', name: '动物救助', icon: '🦘', locs: ['perth', 'adelaide', 'bunbury', 'kangaroo-island'], tags: ['dolphin'], hours: [8, 16], minutes: 180, minTier: 1,
		fx: { needs: { energy: -18, social: 8, fun: 15 }, skills: { survival: 0.6 } },
		respect: 0.5, orgs: { wa: 'native-arc', sa: 'fauna-rescue-sa' }, npcs: ['rosa', 'ayla'],
		desc: '在救助站给受伤的袋鼠、鸟喂食、清理笼舍。要先有社区信誉，站里才放心让你上手。',
	},
	{
		id: 'elder-visit', name: '陪伴老人', icon: '🫖', kinds: ['city', 'town'], hours: [10, 17], minutes: 120, minTier: 1,
		fx: { needs: { social: 25, fun: 5, energy: -8 }, skills: { charisma: 0.6 } },
		respect: 0.5, orgs: { wa: 'chung-wah', sa: 'cws-sa' },
		desc: '去探访独居或住养老院的老人，陪着聊天、读报、打麻将。现实中通常要先办无犯罪记录证明。',
	},
	{
		id: 'cn-assoc', name: '华人社团活动帮忙', icon: '🏮', locs: ['perth', 'adelaide'], hours: [10, 20], minutes: 150,
		fx: { needs: { social: 25, fun: 10, energy: -12 }, skills: { charisma: 0.4 } },
		respect: 0.5, orgs: { wa: 'chung-wah' },
		desc: '社团办中文学校开放日、舞龙排练或游园会，缺人摆摊、接待新来的同学。',
	},
];

/** 规则数值（全部待平衡） */
export const VOL_RULES = {
	dailyMax: 2, // 每个游戏日最多做几次志愿（每种一天一次）
	realDayMax: 6, // 每个现实日（珀斯时间）最多做几次志愿，挡「一直睡觉刷新游戏日」（待平衡）
	minEnergy: 20, // 精力低于这个不让去
	npcGain: 3, // 一起做志愿的 NPC 关系 +3
	refShifts: 6, // 同一种志愿做满几次可以拿到推荐信
	refRespect: 2, // 每封推荐信在应聘、升职的声望门槛上抵几点
	refMax: 2, // 最多算几封
} as const;

/** 社区信誉：按志愿总次数分档（待平衡）。只是志愿这条线的进度，和全局声望等级 level() 并存 */
export const VOL_TIERS = [
	{ at: 0, name: '新面孔' },
	{ at: 5, name: '热心人' },
	{ at: 15, name: '社区骨干' },
	{ at: 40, name: '社区之星' },
] as const;

/** 签证提示（只做提示，不改任何数值）。内容来自内政部打分表，有变化以官网为准 */
export const VISA_HINT = {
	text: '技术移民打分表里没有「志愿服务」这一项，做志愿不直接加分。和社区沾边、能加分的是「社区语言」认证（NAATI CCL），5 分。志愿经历和推荐信可以写进简历、工作申请。一切以内政部官网为准，这里不是移民建议。',
	source: 'https://immi.homeaffairs.gov.au/help-support/tools/points-calculator',
} as const;
