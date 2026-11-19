// 犯罪、罚款和法律后果的数据表（第 43 批，设计见 docs/earth-game/law.md）。
// 罚款额和扣分参照西澳（wa）、南澳（sa）的真实规定，每条注明来源和核对日期；
// 标了 game: true 的是游戏数值（没有对应的真实金额，或官方页面没取到），全部「待平衡」。
// 内容原则：只写后果和代价，不写作案方法和暴力细节；违法的选项不给净收益。

export type LawRegion = 'wa' | 'sa';

export interface Penalty {
	/** 罚款（澳元），含必须同时交的附加费 */
	fine: number;
	/** 扣分 */
	pts: number;
	/** 立即停驾的游戏天数（0 = 不停驾） */
	banDays?: number;
	/** 出处；game 为 true 时是游戏数值 */
	src: string;
	game?: boolean;
	/** 来源有冲突或只有二手来源，等人工核对 */
	unverified?: boolean;
}

export interface OffenceDef {
	id: string;
	name: string;
	/** 是否交通违章（只在有车、自己开车时出现） */
	traffic: boolean;
	/** 记录在案时麻烦值上涨（× 特质 heat 系数），待平衡 */
	heat: number;
	wa: Penalty;
	sa: Penalty;
	/** 走法庭（不能当场交罚款了事）：罚款、社区服务、留下定罪记录 */
	court?: boolean;
	/** 法庭判的社区服务小时，待平衡 */
	csHours?: number;
}

// 来源
const WA_SPEED = 'WA Road Safety Commission「Speeding」处罚表（wa.gov.au，页面 2026-11-11 更新，2026-11-20 核对）';
const WA_DRINK = 'WA Road Safety Commission「Drink and drug driving」罚单表（wa.gov.au，页面 2026-11-11 更新，2026-11-20 核对）';
const SA_LEVY = 'SA Victims of Crime Levy 成人 $108（SAPOL PD320A 与 MyLicence，2026-07-01 起；官网直连 403，经搜索摘要核对）';
const SA_PTS = 'sa.gov.au「Check your demerit point total」（页面 2026-11-03 更新，2026-11-20 核对）';

/** SA 的罚款 = 违章罚金 + 被害人赔偿附加费（成人），附加费见 SA_LEVY */
export const SA_VICTIMS_LEVY = 108;

export const OFFENCES: OffenceDef[] = [
	{
		id: 'speed-low', name: '超速 1–9 km/h', traffic: true, heat: 2,
		wa: { fine: 100, pts: 0, src: WA_SPEED },
		sa: { fine: 215 + SA_VICTIMS_LEVY, pts: 2, src: `罚金 $215：SAPOL 罚则表 A001（经搜索摘要核对）；扣分：${SA_PTS}；${SA_LEVY}`, unverified: true },
	},
	{
		id: 'speed-mid', name: '超速 10–19 km/h', traffic: true, heat: 5,
		wa: { fine: 200, pts: 2, src: WA_SPEED },
		sa: { fine: 484 + SA_VICTIMS_LEVY, pts: 3, src: `罚金 $484：InDaily 2026-05-14 报道 2026-07-01 起调整（二手来源）；扣分：${SA_PTS}；${SA_LEVY}`, unverified: true },
	},
	{
		id: 'speed-high', name: '超速 20–29 km/h', traffic: true, heat: 10,
		wa: { fine: 400, pts: 3, src: WA_SPEED },
		// 二手来源 $987 与 $998 不一致，取较高的 $998，等 SAPOL 现行表核对
		sa: { fine: 998 + SA_VICTIMS_LEVY, pts: 5, src: `罚金 $998（另一来源为 $987，冲突待核对）：InDaily 2026-05-14；扣分：${SA_PTS}；${SA_LEVY}`, unverified: true },
	},
	{
		// WA 按 0.05–0.059 第一档；SA 0.05–0.079 首次可交罚款了事、不停驾
		id: 'drink-low', name: '酒驾（血液酒精 0.05 以上、0.08 以下，首次）', traffic: true, heat: 15,
		wa: { fine: 1000, pts: 3, src: `${WA_DRINK}：0.05–0.06 档首次罚单 $1,000、3 分（0.06–0.07 档 4 分，0.07–0.08 档 5 分）` },
		sa: { fine: 904 + SA_VICTIMS_LEVY, pts: 4, src: `罚金 $904、4 分、交罚款不停驾：Legal Services Commission SA《Law Handbook》醉驾一节（2025-07-09 修订，引 2026-07-01 规例）；${SA_LEVY}` },
	},
	{
		// 再犯不能交罚款了事。WA 0.05–0.07 再犯法庭最高 $1,250、停驾由法官定；SA 再犯 $1,100、停驾不少于 6 个月。
		// 游戏里统一走法庭，停驾天数是游戏数值
		id: 'drink-repeat', name: '酒驾再犯', traffic: true, heat: 25, court: true, csHours: 0,
		wa: { fine: 1250, pts: 3, banDays: 90, src: `${WA_DRINK}：再犯不能开罚单，走法庭，0.05–0.07 档最高 $1,250；停驾天数为游戏数值（待平衡）`, unverified: true },
		sa: { fine: 1100, pts: 4, banDays: 180, src: 'Legal Services Commission SA《Law Handbook》：0.05–0.079 再犯 $1,100、停驾不少于 6 个月（游戏按 180 天）' },
	},
	{
		// 停车罚款由各市政府按地方法规定。City of Perth 官网 403、City of Adelaide 页面只说金额见收费表 PDF，都没取到具体数，先用游戏数值
		id: 'parking', name: '停车超时', traffic: true, heat: 0,
		wa: { fine: 80, pts: 0, src: '游戏数值（City of Perth 官网 403，未取到真实金额，待核对）', game: true },
		sa: { fine: 80, pts: 0, src: '游戏数值（City of Adelaide 页面称金额见收费表 PDF，未取到，待核对）', game: true },
	},
	{
		// 拒绝呼气测试：两州都是严重违法，只能走法庭。具体罚则未核对，全部游戏数值
		id: 'refuse-test', name: '拒绝呼气测试', traffic: true, heat: 30, court: true, csHours: 0,
		wa: { fine: 1500, pts: 0, banDays: 180, src: '游戏数值（两州都按严重违法走法庭；真实罚则未核对）', game: true },
		sa: { fine: 1500, pts: 0, banDays: 180, src: '游戏数值（两州都按严重违法走法庭；真实罚则未核对）', game: true },
	},
	{
		// 被警察拦下后逃跑被抓：游戏只写「走法庭、罚款加社区服务」，不写细节
		id: 'evade', name: '拒不配合警察', traffic: false, heat: 20, court: true, csHours: 20,
		wa: { fine: 800, pts: 0, src: '游戏数值（没有对应的单一真实罚则）', game: true },
		sa: { fine: 800, pts: 0, src: '游戏数值（没有对应的单一真实罚则）', game: true },
	},
];

export const getOffence = (id: string) => OFFENCES.find((o) => o.id === id);

/**
 * 扣分上限：3 年内累计到上限就停驾。
 * 来源：WA Department of Transport「Demerit points」（全驾照 12 分 / 3 年，新手 4 或 8 分；停驾长度写在通知书里，页面未给固定值）；
 * sa.gov.au「Check your demerit point total」（12 分 / 3 年；P 牌 4 分停驾 6 或 12 个月）。
 * 游戏只有全驾照；停驾天数是游戏数值（待平衡）。
 */
export const DEMERITS = {
	limit: 12,
	windowDays: 3 * 365,
	banDays: 90, // 待平衡
};

/** 麻烦值的冷却和阈值（待平衡）。0.25/h 与分支 activity-attrs 的 heatCoolPerHour 相同，合并时只留一处 */
export const HEAT_RULES = {
	coolPerHour: 0.25,
};

/** 喝过酒之后多久内开车、遇到呼气测试会超标（游戏简化：不算体重、杯数，待平衡） */
export const DRINK = {
	/** 喝酒的活动 id（地点互动） */
	activities: ['pub', 'wine'],
	windowMin: 4 * 60,
};

/** 社区服务：在哪做、一次几小时、多少天内做完；逾期麻烦值上涨（待平衡） */
export const COMMUNITY_SERVICE = {
	activity: 'community-service',
	dueDays: 28,
	overdueHeat: 15,
};

/** 欠的罚款：周结算时从现金里扣，扣不完麻烦值上涨（待平衡） */
export const FINE_DEBT = {
	overdueHeat: 5,
};

/** 定罪记录对签证的影响只做提示（持签证的出身）。来源：Migration Act 1958 (Cth) s 501 品格要求；Home Affairs 页面 403 未能直连核对 */
export const VISA_ORIGINS = ['student', 'backpacker'];
export const VISA_NOTE = '法庭定罪通常要在签证申请里如实申报，可能影响品格审查。这里只是简化提示，不是法律意见；现实中请咨询注册移民代理。';
