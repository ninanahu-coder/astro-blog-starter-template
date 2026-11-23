// 税务数据表：真实规则取自 ATO（澳大利亚税务局）公开页面，游戏内换算参数单独列出、标「待平衡」。
// 设计说明见 docs/earth-game/tax.md。规则引擎在 src/game/core/tax.ts。

/** 一档税率：应税收入不超过 upTo 的部分按 rate 计（upTo 为 null 表示以上全部） */
export interface TaxBand {
	upTo: number | null;
	rate: number;
}

/** 游戏里用到的三种税务身份 */
export type Residency = 'resident' | 'whm' | 'foreign';

/**
 * 2026–27 年度个人所得税率（现实金额，澳元/年）。
 * - resident：澳洲税务居民。0–$18,200 免税；$18,201–$45,000 15%（2026-07-01 起由 16% 降到 15%）；30% / 37% / 45%。
 *   来源：ATO「Tax rates – Australian resident」https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
 *   以及「Personal income tax – new tax cuts」https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer
 * - whm：打工度假（417/462 签证）。第一块钱起 15%，到 $45,000；以上按外国居民税率。
 *   来源：ATO「Tax rates – working holiday makers」https://www.ato.gov.au/tax-rates-and-codes/tax-rates-working-holiday-makers
 *   与 Schedule 15 https://www.ato.gov.au/tax-rates-and-codes/schedule-15-tax-table-for-working-holiday-makers
 * - foreign：外国税务居民。没有免税额，30% 到 $135,000，之后 37% / 45%。游戏里现在没有出身用到它，留给短期课程学生等以后的身份。
 *   来源：ATO「Tax rates – foreign residents」https://www.ato.gov.au/tax-rates-and-codes/tax-rates-foreign-residents
 */
export const TAX_BANDS: Record<Residency, TaxBand[]> = {
	resident: [
		{ upTo: 18200, rate: 0 },
		{ upTo: 45000, rate: 0.15 },
		{ upTo: 135000, rate: 0.3 },
		{ upTo: 190000, rate: 0.37 },
		{ upTo: null, rate: 0.45 },
	],
	whm: [
		{ upTo: 45000, rate: 0.15 },
		{ upTo: 135000, rate: 0.3 },
		{ upTo: 190000, rate: 0.37 },
		{ upTo: null, rate: 0.45 },
	],
	foreign: [
		{ upTo: 135000, rate: 0.3 },
		{ upTo: 190000, rate: 0.37 },
		{ upTo: null, rate: 0.45 },
	],
};

/**
 * 低收入抵税额 LITO（只有税务居民有）：收入 ≤ $37,500 抵 $700；$37,501–$45,000 每多 $1 少 5 分；
 * $45,001–$66,667 从 $325 起每多 $1 少 1.5 分；超过 $66,667 没有。抵税额最多把税抵到 0，不退钱。
 * 来源：ATO「Low income tax offset」https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset
 */
export const LITO = { max: 700, full: 37500, step1: 0.05, mid: 45000, midAmount: 325, step2: 0.015 };

/**
 * Medicare 税（Medicare levy）：应税收入的 2%。单身低收入减免：≤ 下限不交；下限到上限之间交「超出下限部分的 10%」（不超过 2%）。
 * 下限 $28,011、上限 $35,013 是 2025–26 年度数字（2026–27 年度 ATO 还没公布，届时更新）。
 * 来源：ATO「Medicare levy reduction for low-income earners」
 * https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners
 * 不享受 Medicare 的临时居民（多数留学生）凭 Medicare Entitlement Statement 全额免除：
 * https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-exemption/not-entitled-to-medicare-benefits
 */
export const MEDICARE = { rate: 0.02, lower: 28011, upper: 35013, phaseIn: 0.1 };

/**
 * 没提供 TFN 时雇主按最高税率预扣：居民 47%，外国居民 45%（打工度假按外国居民）。
 * 已经申请、还没拿到号码的，雇主有 28 天宽限，先按正常税率扣。
 * 来源：ATO「Tax file number (TFN) declarations」/ Schedule 1 员工申报说明
 * https://www.ato.gov.au/tax-rates-and-codes/schedule-1-tax-table-01-july-2024-to-30-june-2026/employee-declarations
 */
export const NO_TFN_RATE: Record<Residency, number> = { resident: 0.47, whm: 0.45, foreign: 0.45 };

/**
 * 出身 → 税务身份（游戏简化：出身决定，开局后不变）。
 * - 留学生：ATO 规定在澳读超过 6 个月课程的海外学生一般是税务居民；多数留学生不享受 Medicare，可申请免 Medicare 税。
 *   来源：ATO「Studying in Australia」https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/coming-to-australia/studying-in-australia
 *   与「Work out your residency status for tax purposes」https://www.ato.gov.au/calculators-and-tools/tax-return-work-out-your-tax-residency
 * - 背包客：按打工度假签证算（WHM 税率，不交 Medicare 税）。
 * - 矿区轮班工、冲浪手：澳洲本地税务居民。
 * 没列出的出身按税务居民处理。
 */
export const ORIGIN_TAX: Record<string, { residency: Residency; medicareExempt: boolean }> = {
	student: { residency: 'resident', medicareExempt: true },
	backpacker: { residency: 'whm', medicareExempt: true },
	fifo: { residency: 'resident', medicareExempt: false },
	surfer: { residency: 'resident', medicareExempt: false },
};

/** 收入的税务性质：wage 受雇工资（雇主预扣）；hobby 爱好收入（不计税，有 ABN 后算生意）；none 不是收入（如退瓶押金） */
export type IncomeKind = 'wage' | 'hobby' | 'none';

/**
 * 地点活动里能挣钱的那几项是什么性质。职业上班、真实地点打卡上班一律是 wage，不用列。
 * - 咖啡店打工、矿场轮班、农场采摘：临时工（casual），雇主预扣。
 * - 街头表演：没有 ABN 是爱好（ATO：爱好收入一般不计税）；有 ABN 后算个体户生意收入。
 *   来源：business.gov.au「Difference between a business and a hobby」https://business.gov.au/planning/new-businesses/difference-between-a-business-and-a-hobby
 * - 捡空瓶换押金：退的是押金，不是收入。
 */
export const ACTIVITY_INCOME: Record<string, IncomeKind> = {
	'work-cafe': 'wage',
	'work-mine': 'wage',
	'work-farm': 'wage',
	busk: 'hobby',
	recycle: 'none',
};

/**
 * 游戏换算与玩法参数。除特别注明外都是「待平衡」的初始值，等 Codex 跑完平衡分析再定。
 */
export const TAX_GAME = {
	/**
	 * 现实税档金额 × scale = 游戏里的税档金额（待平衡）。
	 * 推导：游戏一年 112 天 = 16 周，现实一年 52 周；游戏时薪约为现实的 0.75 倍（见 economy 分支设计文档）。16 / 52 × 0.75 ≈ 0.23。
	 * 免税额、LITO、Medicare 门槛都乘它；税率不变。
	 */
	scale: 0.23,
	/**
	 * 工资预扣把每一笔工资当作一天的工资，× 一年的工作日数折成年收入再算（待平衡）。
	 * 现实 PAYG 也是按发薪周期折年（周薪 × 52）；游戏里一班或一次打工就是一个发薪周期。
	 * 每周 6 个班（同 economy 分支的 shiftsPerWeek）× 16 周 = 96。打得少的人会多扣，报税时退回。
	 */
	payDaysPerYear: 6 * 16,
	/** 申请 TFN 到拿到号码要几个游戏日（待平衡；现实 ATO 处理最长约 28 天，游戏按一年 112 天压缩） */
	tfnWaitDays: 3,
	/** 报税期：新财年开头这么多个游戏日（= 一整季，待平衡）。现实是 7 月 1 日到 10 月 31 日 */
	lodgeDays: 28,
	/**
	 * 逾期罚款：每逾期 lateEveryDays 天（不足也算）罚一个单位，最多 lateMaxUnits 个；只对要补税的申报罚（待平衡）。
	 * 结构照搬 ATO 的 FTL 罚款（每 28 天一个罚款单位，最多 5 个）；现实罚款单位的金额以 https://www.ato.gov.au/penalty 为准，这里不引用。
	 * 来源：ATO「Failure to lodge on time penalty」https://www.ato.gov.au/individuals-and-families/paying-the-ato/interest-and-penalties/penalties/failure-to-lodge-on-time-penalty
	 */
	lateUnit: 60,
	lateEveryDays: 7,
	lateMaxUnits: 5,
	/** 补税付不起时进分期：每周结算扣「欠款 × planShare」，至少 planMin（都不超过现金和欠款；待平衡） */
	planShare: 0.25,
	planMin: 20,
	/** 有 ABN 后街头表演能接商演、市集档期，收入上浮这个比例（待平衡） */
	abnBonus: 0.4,
	/** 欠税上限（存档校验用，正常玩不到） */
	debtMax: 1e7,
};
