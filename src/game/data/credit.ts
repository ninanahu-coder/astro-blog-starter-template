// 银行、信用分和借贷的数值表（设计见 docs/earth-game/banking.md）。
// 标「来源」的是现实规则（按游戏物价约为真实的 1/5、一周结算一次换算过）；其余全部是游戏值，标「待平衡」。
// 这里只做游戏机制，不构成任何理财建议。

export const BANK = {
	// ---------- 信用分（游戏自己的 0–1000 分制） ----------
	// 来源：Moneysmart「Credit scores and credit reports」——分数在 0 到 1,000 或 1,200 之间，看借了多少、申请了几次、有没有按时还
	scoreMax: 1000,
	base: 500, // 有记录后的起点（待平衡）；没有记录的人银行也按这个分审批
	perWeek: 2, // 记录每存在一周 +2（待平衡）
	weekCap: 150, // 记录时长最多加这么多（待平衡）
	perOk: 5, // 每个「按时还款的结算周」+5（待平衡）
	okCap: 52, // 按时还款周数最多记 52 周（待平衡）
	okLost: 10, // 记一次逾期，按时周数扣掉这么多（待平衡）
	enqPenalty: 10, // 每次信用申请扣分（待平衡）
	enqDays: 182, // 申请记录影响分数的天数（待平衡；现实保留年限本批没核实到原文）
	latePenalty: 80, // 每条逾期记录扣分（待平衡）
	lateDays: 728, // 来源：Moneysmart——还款记录覆盖最近两年
	defPenalty: 250, // 每条违约记录扣分（待平衡）
	defDays: 1825, // 来源：Moneysmart——违约记录保留五年
	utilHigh: 0.5, // 信用卡欠款超过额度这个比例时扣分（待平衡）
	utilPenalty: 40,
	// 分档名来源：Moneysmart 的 low / fair / good / very good / excellent；各档分界是游戏值（待平衡）
	bands: [
		{ min: 800, name: '优秀' },
		{ min: 700, name: '很好' },
		{ min: 625, name: '良好' },
		{ min: 550, name: '一般' },
		{ min: 0, name: '低' },
	],

	// ---------- 逾期、违约、催收 ----------
	lateMissed: 2, // 来源：Moneysmart——到期 14 天后还没还才算逾期记录。游戏一周一结算，连续欠 2 次 = 14 天
	defaultMissed: 9, // 来源：Moneysmart——逾期 60 天以上、$150 以上才能报违约。9 周 ≈ 63 天
	defaultMin: 30, // $150 ÷ 5
	repossessMissed: 5, // 来源：Moneysmart「Repossessed car or goods」——违约通知给 30 天补缴，期满才能收车。第 1 次欠款发通知，再过 4 周（28 天，取整到下一个结算日）收车
	repossessShare: 0.85, // 收车后拍卖到手的比例（待平衡）；不足的部分照样要还
	lateFee: 5, // 贷款和信用卡每次欠款的罚金（待平衡）
	collectorCallsPerWeek: 3, // 来源：Moneysmart「Dealing with debt collectors」——电话每周不超过 3 次。游戏里每周结算只记一条催收

	// ---------- 还款能力（负责任放贷） ----------
	shiftsPerWeek: 5, // 按每周上 5 班估收入（待平衡）
	rentShade: 0.8, // 租金收入只算八成（待平衡）
	dsr: 0.75, // 新的每周还款（含缓冲）不超过「收入 − 已有固定开销」的这个比例（待平衡）
	cardCommit: 0.03, // 已有信用卡按额度的 3% 算每周负担（待平衡）

	// ---------- 房贷 ----------
	homeBuffer: 0.03, // 来源：APRA——审批时按产品利率 +3 个百分点测试还款能力（年化）
	lmiBelow: 0.2, // 来源：Moneysmart「Buying a house」——首付 20% 能避开贷款保险
	lmiRate: 0.02, // 贷款保险费 = 贷款额 × 该比例，并进贷款（待平衡；现实费率因人因机构而异）
	homeMinScore: 450, // 待平衡；比起点分低一档：没有记录、申请过一两次的人也能申请，有逾期记录的不行

	// ---------- 信用卡 ----------
	cardYears: 3, // 来源：Moneysmart / ASIC——额度按「三年内还清整个额度」评估（2019-01-01 起）
	cardWeeklyRate: 0.004, // 约年化 21%（待平衡，未取来源）
	cashFee: 0.03, // 取现手续费（待平衡）；来源只到「取现有手续费、没有免息期」（Moneysmart 信用卡页）
	cashFeeMin: 2,
	cardMinPay: 0.03, // 每周最低还款 = 欠款 × 3%（待平衡；Moneysmart 没给公式）
	cardMinFloor: 10,
	cardTiers: [
		{ limit: 500, minScore: 450 },
		{ limit: 1500, minScore: 625 },
		{ limit: 3000, minScore: 700 },
	],

	// ---------- 个人贷款（无抵押）和车贷（以车抵押） ----------
	// 来源：Moneysmart 个人贷款、车贷页——无抵押贷款利率通常比有抵押高；利率看信用分。具体利率是游戏值（待平衡）
	personal: { min: 300, max: 5000, weeks: 52, minScore: 600 },
	car: { weeks: 104, minDown: 0.1, minScore: 450 },
	// 按信用分取每周利率：从高分档往下找第一档
	personalRates: [
		{ min: 800, rate: 0.0017 }, // 约年化 9%
		{ min: 700, rate: 0.0023 }, // 约 12%
		{ min: 0, rate: 0.0033 }, // 约 17%
	],
	carRates: [
		{ min: 800, rate: 0.0013 }, // 约 7%
		{ min: 700, rate: 0.0016 }, // 约 8%
		{ min: 0, rate: 0.0021 }, // 约 11%
	],

	// ---------- 先买后付 ----------
	// 来源：Moneysmart「Buy now pay later」——分期付、通常不收利息但收费；每次申请都会查信用；逾期会上信用报告、拉低信用分
	bnplParts: 4, // 分 4 期：下单付第一期，之后每周一期（游戏简化，待平衡）
	bnplMax: 4, // 同时最多 4 笔（待平衡）
	bnplLateFee: 2, // 每期逾期费（待平衡）
	bnplFeeCap: 0.25, // 一笔订单的逾期费合计不超过订单额的这个比例（待平衡；Moneysmart 只说部分提供方必须设费用上限）
} as const;

/** 先买后付的风险提示：界面在确认框里原样显示；服务端要求请求里带 ack:true 才受理 */
export const BNPL_WARNING = [
	'先买后付也是借钱：每次申请都会查一次信用，记在信用记录上。',
	'哪一期没按时付，会收逾期费；拖到 14 天以上会记逾期，信用分下降。',
	'同时开好几笔，每周要付的钱会叠在一起。',
];

/** 信用产品的种类（还款、界面都用） */
export const DEBT_KINDS = ['card', 'personal', 'car'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];
