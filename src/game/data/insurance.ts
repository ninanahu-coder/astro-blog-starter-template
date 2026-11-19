// 保险（第一版，数值全部「待平衡」）。设计和来源见 docs/earth-game/insurance.md。
// 保费按真实年保费 ÷ 365 × 保期天数取整；真实数字的出处写在每一项的 source 里，没查到的写「未查」。
import type { LossKind } from '../core/types.ts';

export interface PolicyDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	/** 一次买多少个游戏日；到期前续保从原到期日往后接，不重新等待 */
	days: number;
	/** 一期保费（元，待平衡）。0 表示不能单独买（CTP 随车辆费用交） */
	premium: number;
	/** 每次理赔自付的免赔额（元，待平衡） */
	excess: number;
	/** 赔哪些损失 */
	covers: LossKind[];
	/** 新买的保单过几个游戏日才生效（防止看到风暴预报再买）；续保不等 */
	wait: number;
	/** 要有车 / 有住处才能买 */
	needs?: 'vehicle' | 'home';
	/** 强制险：不能单独买，已含在车辆的每周费用里（只用于界面说明） */
	compulsory?: boolean;
	/** 这些损失最多赔到车的当前价值（自己的车）；赔别人的（tpp）不受这个限制 */
	capByCar?: LossKind[];
	source: string;
}

export const POLICIES: PolicyDef[] = [
	{
		id: 'ctp', name: '强制第三者人身险（CTP）', icon: '🪪', compulsory: true, days: 0, premium: 0, excess: 0, covers: [], wait: 0, needs: 'vehicle',
		desc: '随车辆注册（rego）强制交，只赔车祸里别人的人身伤害，不赔任何车和东西。游戏里已含在车辆每周费用中。',
		source: '西澳 MII 2026/27 轿车 $520.50（不含 GST，含税约 $629.81）；南澳 2025/26 都市私家车最低 $262.07',
	},
	{
		id: 'car-tpp', name: '第三方财产险', icon: '🚘', days: 28, premium: 40, excess: 800, covers: ['tpp'], wait: 0, needs: 'vehicle',
		desc: '撞了别人的车或东西由保险赔；自己的车不赔。',
		source: 'Finder 调研的第三方财产险平均年保费 $522；免赔额未查，暂按全险的数',
	},
	{
		id: 'car-comp', name: '车辆全险', icon: '🛡️', days: 28, premium: 156, excess: 800, covers: ['tpp', 'collision', 'car-theft', 'car-storm'], wait: 2, needs: 'vehicle', capByCar: ['collision', 'car-theft', 'car-storm'],
		desc: '自己的车撞坏、被撬、被冰雹砸也赔（最多赔到车值多少钱），也包含第三方财产。机械故障和抛锚不赔。',
		source: 'Canstar 2025 西澳全险平均年保费 $2,032；Canstar 报价用的免赔额 $800–$1,000',
	},
	{
		id: 'contents', name: '租客财产险', icon: '🏠', days: 28, premium: 21, excess: 500, covers: ['contents-theft', 'contents-storm'], wait: 2, needs: 'home',
		desc: '住处的东西被偷、被风暴泡坏由保险赔。',
		source: 'CHOICE：西澳家财险最便宜的平均年保费 $273；免赔额未查',
	},
	{
		id: 'health', name: '健康险（OSHC/OVHC）', icon: '🩺', days: 28, premium: 50, excess: 0, covers: ['medical'], wait: 0,
		desc: '住院和看急诊的账单由保险付。留学生签证规定在澳期间必须一直有 OSHC。',
		source: '学生签证条件 8501（Home Affairs）；OSHC 单人年保费约 $600–$800（比价网站，互相有出入）',
	},
	{
		id: 'travel', name: '国内旅行险', icon: '🧳', days: 7, premium: 90, excess: 250, covers: ['luggage'], wait: 0,
		desc: '一周有效：路上行李被偷、托运丢失由保险赔。不管看病（看病归健康险）。',
		source: 'CHOICE：国内旅行险单人 7 天平均 $90（2025-10-31 更新）；免赔额未查',
	},
];

export const getPolicy = (id: string): PolicyDef | undefined => POLICIES.find((p) => p.id === id);

/** 损失种类的中文名（日志、界面用） */
export const LOSS_LABEL: Record<LossKind, string> = {
	collision: '自己的车撞坏',
	tpp: '赔别人的车和财物',
	'car-theft': '车被撬被偷',
	'car-storm': '车被风暴砸坏',
	'contents-theft': '住处被盗',
	'contents-storm': '住处被风暴泡坏',
	medical: '医药费',
	luggage: '行李丢失',
};

/**
 * 理赔记录影响下一期保费（待平衡）：最近 CLAIM_WINDOW 天内每出险一次，续保保费 +perClaim，最多 +max。
 * 真实保险公司出险后会调高保费（无赔款优待取消），具体幅度各家不同、未查。
 */
export const CLAIM_LOADING = { perClaim: 0.2, max: 0.6 };
export const CLAIM_WINDOW = 365;
/** 每张保单最多记几条理赔日期（存档上限） */
export const CLAIMS_MAX = 10;
/** 保单到期日最多能续到今天之后多少天（存档上限，也防止一次刷满几年） */
export const COVER_AHEAD_MAX = 400;

/** 开局自带的保单（出身 id -> 保单和天数）。留学生入境前就要买好覆盖整个签证期的 OSHC，这里先给一年（待平衡） */
export const START_COVER: Record<string, { id: string; days: number }[]> = {
	student: [{ id: 'health', days: 365 }],
};
