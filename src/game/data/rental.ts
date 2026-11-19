// 租房市场（rental 批次）：看房、申请、租约、涨租、维修、退房押金结算、骗租。
// 规则来源和换算见 docs/earth-game/rental.md。除注明「真实规则」的以外，数值全部待平衡。

/** 游戏时间换算：游戏一年 112 天（time.ts YEAR_DAYS）。以月、年计的真实期限按 112/365 折算，两周以内的照真实天数 */
export const RENTAL = {
	/** 真实规则：12 个月最多涨一次租（西澳 WA2、南澳 SA3）→ 一个游戏年 */
	riseEveryDays: 112,
	/** 真实规则：涨租至少提前 60 天通知（西澳 WA2、南澳 SA3）→ 60 × 112 / 365 ≈ 18 天 */
	noticeDays: 18,
	/** 固定期限租约：6 个月 → 56 天（期限长短是游戏设定，6 个月是常见选项） */
	fixedDays: 56,
	/** 固定期最后几天可以续约（待平衡） */
	renewWindow: 14,
	/** 看房记录有效天数（待平衡） */
	viewDays: 7,
	/** 动作耗时（分钟，待平衡） */
	inspectMin: 30,
	applyMin: 30,
	reportMin: 20,
	repairMin: 5,
	disputeMin: 60,
	checkMin: 10,
	/** 真实规则（西澳 WA3）：租客收到检查报告 7 天内交回；南澳期限未查到，沿用 */
	reportDays: 7,
	/** 固定期内提前解约的违约金：几周房租（游戏设定，不是法规数字，待平衡） */
	breakWeeks: 2,
	/** 每周结算收到涨租通知的机会、涨幅（待平衡；南澳涨幅无上限 SA3，西澳未查到上限） */
	riseChance: 0.35,
	risePct: 0.05,
	/** 每周结算坏东西的机会、其中紧急的比例（待平衡） */
	faultChance: 0.12,
	urgentShare: 0.25,
	/** 报修后几天修好：紧急 1 天（西澳 24–48 小时 WA6）；一般维修两地都只写「合理时间」，7 天是游戏设定 */
	urgentFixDays: 1,
	minorFixDays: 7,
	/** 紧急故障没修好时住处舒适度减多少（待平衡） */
	urgentComfort: 3,
	/** 损坏增长：正常居住每周、故障不报修每周（待平衡） */
	wearWeek: 1,
	wearUnreported: 3,
	/** 入住时原有损坏的上限（0–100 刻度，待平衡） */
	priorMax: 30,
	/** 骗租广告出现的机会（按地点、日期定）、标价是挂牌价的几成、要你先转几周房租（待平衡） */
	scamChance: 0.25,
	scamRentShare: 0.6,
	scamWeeks: 2,
	/** 住满几天退房才算一条好的退租记录；记录条数上限（待平衡） */
	cleanDays: 14,
	recordMax: 9,
} as const;

/** 申请成功率的权重（全部待平衡，见 rental.md §3.2） */
export const ODDS = {
	base: 0.6,
	/** 房租 / 周收入的分档：≤ low 加 lowBonus，≤ high 加 midBonus，再高加 highPenalty */
	low: 0.3,
	high: 0.5,
	lowBonus: 0.2,
	midBonus: 0.05,
	highPenalty: -0.15,
	noJob: -0.25,
	/** 存款够几周房租加分 */
	savingsWeeks: 4,
	savingsBonus: 0.05,
	refEach: 0.05,
	refMax: 0.15,
	markEach: -0.2,
	/** 看房人数超过 crowdFree 组后，每多一组减 crowdEach */
	crowdFree: 3,
	crowdEach: -0.04,
	min: 0.05,
	max: 0.95,
	/** 估算周收入：每班工资 × 几班 */
	shiftsPerWeek: 5,
} as const;

/** 各区域租房市场：看房时来几组人（含你自己以外的竞争者，待平衡） */
export const MARKET: Record<string, { applicants: [number, number] }> = {
	wa: { applicants: [2, 8] },
	sa: { applicants: [2, 8] },
};

/**
 * 真实规则：押金上限（周数）。
 * 西澳：4 周，周租超过 $1,200 不设上限（WA1）。南澳：周租 ≤ $800 为 4 周，> $800 为 6 周（SA1）。
 */
export const BOND_LAW: Record<string, { weeks: number; above: number; weeksAbove: number }> = {
	wa: { weeks: 4, above: 1200, weeksAbove: Infinity },
	sa: { weeks: 4, above: 800, weeksAbove: 6 },
};

/** 真实机构名：谁托管押金、押金争议找谁（WA1、WA4、SA1、SA2） */
export const RENTAL_BODIES: Record<string, { bond: string; dispute: string }> = {
	wa: { bond: '西澳 Bonds Administration', dispute: 'Bond Administrator（Commissioner 裁定）' },
	sa: { bond: '南澳 CBS', dispute: 'CBS（谈不拢交 SACAT）' },
};

/** 故障名称。紧急的取自西澳「基本服务」清单（WA6：水、燃气、热水、排污、电） */
export const FAULTS = {
	urgent: ['热水器坏了', '停电了', '水管爆了'],
	minor: ['水龙头一直滴水', '门锁松了', '纱窗破了', '烤箱一个灶不着'],
} as const;

/** 骗租广告出现的地点类型 */
export const SCAM_KINDS = ['city', 'port', 'town', 'coast'] as const;

/** Scamwatch 租房骗局的提醒（SC1），界面和日志用 */
export const SCAM_TIP = '不能看房就不要付钱；押金交给政府的押金托管机构，不交给个人。（Scamwatch）';
