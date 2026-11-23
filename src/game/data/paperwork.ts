// 证件和办事（第 43 批）：落地后要办的事。设计见 docs/earth-game/paperwork.md。
// 游戏里的花费、耗时、等待天数、路考难度都是新数值，**待平衡**（交 Codex 跑数据后再定）。
// real 字段是现实流程的摘要，只给玩家参考，**以官方为准**；每条都附来源链接（2026-11-20 查）。
import type { Hours, LocationKind } from '../core/types.ts';

export type PaperRegion = 'wa' | 'sa';

export interface PaperSource {
	title: string;
	url: string;
}

export interface PaperDef {
	id: string;
	name: string;
	icon: string;
	/** 只在这些区域出现；不写为两边都有 */
	regions?: PaperRegion[];
	/** 只对这些出身出现 / 对这些出身不出现（OSHC 只给留学生，Medicare 给其他人） */
	origins?: string[];
	notOrigins?: string[];
	/** 前置：这些办事项要先办成（等待中的不算） */
	needs: string[];
	/** 要先有住处（地址登记） */
	needsHome?: boolean;
	/** 'online' 在哪都能办；否则到这些类型（kinds）或这些地点（locs）、办公时间内去办 */
	where: 'online' | { kinds?: LocationKind[]; locs?: string[] };
	/** 去哪办，给玩家看（被挡住时提示「要到…」） */
	place: string;
	hours?: Hours;
	minutes: number;
	fee: number;
	/** 递交后几个游戏日才办成；0 为当场办成 */
	waitDays: number;
	/** 考试：用 skill 检定（能力 + 随机 0–60 ≥ dc），没过要等 retryDays 天再考，费用照收 */
	test?: { skill: 'driving'; dc: number; retryDays: number };
	/** 办成时的一次性奖励（路考练车涨驾驶） */
	grow?: { skill: 'driving'; gain: number };
	/** 递交时要带的材料（游戏里只展示，不扣物品） */
	docs: string[];
	/** 办成后解锁什么：v1 已生效的写在 now，还没接上的写在 later（见设计文档） */
	unlocks: { now: string[]; later: string[] };
	/**
	 * 合并 main 后（用户 2026-11-23 定）：银行户、TFN、医保这几项 main 已经有自己的系统，清单只显示它们的状态、按钮跳到那边办，
	 * 不再自己记录：bank 看银行开户（core/bank.ts），tfn 看税务的 TFN（core/tax.ts），cover 看签证带的医保（core/health.ts coverOf）
	 */
	linked?: 'bank' | 'tfn' | 'cover';
	/** 现实流程摘要，以官方为准 */
	real: { who: string; steps: string; wait: string; sources: PaperSource[] };
	desc: string;
}

/** 调参常量，待平衡 */
export const PAPER_RULES = {
	/** 存档里最多记多少条办事记录（数据表的条目数远小于它） */
	max: 32,
};

/** 新手清单的顺序 */
export const PAPER_ORDER = ['phone', 'bank', 'tfn', 'transit-wa', 'transit-sa', 'address', 'oshc', 'medicare', 'licence-theory', 'licence'];

/** 城镇都有的手机店、银行网点（小景点、国家公园、内陆荒野没有） */
const OFFICE = { kinds: ['city', 'town', 'port', 'mining', 'coast'] as LocationKind[] };
/** 驾照、Medicare 这类政府服务中心：城市和较大的镇 */
const AGENCY = { kinds: ['city', 'town', 'port', 'mining'] as LocationKind[] };

export const PAPERS: PaperDef[] = [
	{
		id: 'phone', name: '办手机卡', icon: '📱', needs: [], where: OFFICE, place: '有手机店或超市的城镇', hours: [8, 21], minutes: 30, fee: 10, waitDays: 0,
		docs: ['护照'],
		unlocks: { now: ['开银行户的前置（银行要澳洲手机号收验证码）'], later: ['应聘正式工作时要留联系电话'] },
		real: {
			who: '任何人；预付卡激活前运营商必须核实身份。',
			steps: '到运营商门店或超市买预付 SIM 卡，用护照等证件核实身份后激活。',
			wait: '核实通过后通常当场能用。',
			sources: [{ title: 'ACMA：ID checks for prepaid mobiles', url: 'https://www.acma.gov.au/id-checks-prepaid-mobiles' }],
		},
		desc: '先有个本地号码，后面办什么都要填。',
	},
	{
		id: 'bank', name: '开银行户', icon: '🏦', linked: 'bank', needs: [], where: OFFICE, place: '有银行网点的城镇', hours: [9, 16], minutes: 45, fee: 0, waitDays: 0,
		docs: ['护照', '签证（电子签证即可）', '澳洲手机号'],
		unlocks: { now: ['在「我 · 资产」的银行卡片开户；按揭买房、信用卡、贷款、先买后付都要先开户'], later: [] },
		real: {
			who: '任何人；银行按反洗钱法规做客户身份识别（KYC）。',
			steps: '可以先在网上开户，再带护照到分行核实身份；具体能提前多少天开户、要哪些证件，各银行不同。',
			wait: '身份核实后账户就能用，实体卡一般邮寄。',
			sources: [{ title: 'AUSTRAC：Why you might be asked for ID', url: 'https://www.austrac.gov.au/individuals/why-you-might-be-asked-id' }],
		},
		desc: '工资、房租、押金都走银行转账。',
	},
	{
		id: 'tfn', linked: 'tfn', name: '申请 TFN（税号）', icon: '🧾', needs: [], where: 'online', place: '网上', minutes: 20, fee: 0, waitDays: 7,
		docs: ['护照', '有工作权限的签证', '澳洲收信地址'],
		unlocks: { now: ['贷款买房要有 TFN'], later: ['没有 TFN 时雇主按最高税率预扣工资'] },
		real: {
			who: '持有工作权限签证、人在澳洲的人可以网上申请（签证有 8101、8103、8116 等禁止工作条件的不行）。',
			steps: '在 ATO 网站用护照网上申请（Individual Auto Registration），免费，不用寄证件。',
			wait: 'TFN 邮寄到你填的地址，ATO 写的是收到申请后 28 天内；期间不要重复申请。',
			sources: [{ title: 'ATO：Apply for a TFN', url: 'https://www.ato.gov.au/individuals-and-families/tax-file-number/apply-for-a-tfn' }],
		},
		desc: '网上填表，等税号寄到。',
	},
	{
		id: 'transit-wa', name: '买 SmartRider 交通卡', icon: '🚆', regions: ['wa'], needs: [], where: { locs: ['perth', 'fremantle', 'mandurah'] }, place: 'Transperth 服务范围内（珀斯、弗里曼特尔、曼杜拉）', hours: [7, 19], minutes: 15, fee: 10, waitDays: 0,
		docs: ['（买普通卡不用证件）', '全日制学生办学生优惠卡要学校登记'],
		unlocks: { now: [], later: ['坐 Transperth 公交火车按卡价扣费（交通分支合并后接上）', '全日制留学生办 Tertiary SmartRider 享优惠票价'] },
		real: {
			who: '任何人。全日制在读的大学、TAFE 学生可以办 Tertiary SmartRider 优惠卡，学生证本身不能当优惠凭证。',
			steps: '在 Transperth InfoCentre 或 SmartRider 代售点买卡，不能网上买。',
			wait: '当场拿卡。卡价：Standard SmartRider 页面写 $10 卡费 + 至少 $10 余额，2026 年 1 月版乘车指南写 $20（含 $10 余额）。',
			sources: [
				{ title: 'Transperth：Standard SmartRider', url: 'https://www.transperth.wa.gov.au/smartrider/types-of-smartrider/standard-smartrider' },
				{ title: 'Transperth：Tertiary SmartRider', url: 'https://www.transperth.wa.gov.au/smartrider/types-of-smartrider/tertiary-smartrider' },
			],
		},
		desc: '珀斯公交、火车、渡轮通用的储值卡。',
	},
	{
		id: 'transit-sa', name: '买 metroCARD 交通卡', icon: '🚋', regions: ['sa'], needs: [], where: { locs: ['adelaide', 'glenelg'] }, place: 'Adelaide Metro 服务范围内（阿德莱德、格莱内尔格）', hours: [7, 19], minutes: 15, fee: 5, waitDays: 0,
		docs: ['（买普通卡不用证件）', '优惠卡乘车时要带学生证等证明'],
		unlocks: { now: [], later: ['坐 Adelaide Metro 按卡价扣费（交通分支合并后接上）', '全日制在校上课的大学生可享优惠票价'] },
		real: {
			who: '任何人。认可院校的全日制、在校上课的大专学生可以用优惠票价；学生版 metroCARD 只给中小学生。',
			steps: '在代售点买卡后充值。',
			wait: '当场拿卡。普通卡卡价本批没有查到官方页面（优惠卡 $3.50）。',
			sources: [{ title: 'Adelaide Metro：Concession metroCARD', url: 'https://adelaidemetro.com.au/tickets-and-fares/metrocard/concession' }],
		},
		desc: '阿德莱德公交、火车、电车通用的储值卡。',
	},
	{
		id: 'oshc', linked: 'cover', name: '领 OSHC 学生医保卡', icon: '🩺', needs: [], where: 'online', place: '网上', minutes: 10, fee: 0, waitDays: 0,
		docs: ['保单号（办学生签证前已买）', '护照'],
		unlocks: { now: ['看病按 OSHC 收费（GP、药房、急诊，见「我」页的健康）'], later: [] },
		real: {
			who: '学生签证持有人；签证条件 8501 要求在澳期间一直持有足够的医疗保险（OSHC）。',
			steps: '办签证前已经向保险公司买好 OSHC，到澳后在保险公司的网站或 App 激活会员、下载电子卡。',
			wait: '激活后通常马上能用电子卡，实体卡另寄。',
			sources: [{ title: 'Home Affairs：Student visa conditions（存档页）', url: 'https://archive.homeaffairs.gov.au/trav/stud/more/visa-conditions/visa-conditions-students' }],
		},
		desc: '留学生的医疗保险，看病拿它报销。',
	},
	{
		id: 'medicare', linked: 'cover', name: '登记 Medicare', icon: '💳', needs: [], where: AGENCY, place: 'Services Australia 服务中心（城市和较大的镇）', hours: [9, 16], minutes: 40, fee: 0, waitDays: 0,
		docs: ['护照', '签证', '居住地址'],
		unlocks: { now: ['看病按 Medicare 收费（GP 多数免费，见「我」页的健康）'], later: [] },
		real: {
			who: '澳洲公民、永久居民和部分永居申请人；和澳洲有互惠医疗协议国家的访客视国家而定（中国大陆不在协议里，没资格的人要买海外访客医保）。',
			steps: '到 Services Australia 服务中心或网上提交 Medicare 登记，带护照和签证。',
			wait: '登记后先拿到 Medicare 号码，卡邮寄。',
			sources: [{ title: 'Services Australia：Reciprocal Health Care Agreements', url: 'https://www.servicesaustralia.gov.au/reciprocal-health-care-agreements-visiting-from-united-kingdom' }],
		},
		desc: '公立医保。没资格的人这一项改买私人医保（提议）。',
	},
	{
		id: 'address', name: '登记 / 变更地址', icon: '🏠', needs: [], needsHome: true, where: 'online', place: '网上', minutes: 15, fee: 0, waitDays: 0,
		docs: ['租约或水电账单（地址证明）'],
		unlocks: { now: ['换本地驾照的前置（要地址证明）', '搬家后清单提醒更新'], later: ['逾期没更新的后果（罚款或提醒信）'] },
		real: {
			who: '所有人。留学生：签证条件 8533 要求到澳 7 天内、搬家后 7 天内把住址告诉学校。驾照持有人：WA 要在搬家后 21 天内通知交通部。',
			steps: '学校在学生系统里改；驾照在 DoT 网上改；银行、ATO、Medicare 各自在网上改。',
			wait: '提交即生效。',
			sources: [
				{ title: 'Home Affairs：Student visa conditions（存档页，8533）', url: 'https://archive.homeaffairs.gov.au/trav/stud/more/visa-conditions/visa-conditions-students' },
				{ title: 'WA DoT：Change of address', url: 'https://www.wa.gov.au/service/transport/road-transport/change-your-address-the-department-of-transport' },
			],
		},
		desc: '租到房子后登记住址；搬家了要改。',
	},
	{
		id: 'licence-theory', name: '换驾照：递材料和理论考试', icon: '📝', needs: ['address'], where: AGENCY, place: '驾照办理中心（城市和较大的镇）', hours: [9, 16], minutes: 90, fee: 60, waitDays: 5,
		docs: ['海外驾照原件', '非英文驾照的英文翻译（NAATI）', '护照', '地址证明'],
		unlocks: { now: ['可以约路考'], later: [] },
		real: {
			who: '永久居民要在拿到永居（或带永居入境）后 3 个月内换本地驾照，之后不能再开海外驾照；临时签证持有人可以开海外驾照，也可以随时换。',
			steps: '来自认可国家、地区的驾照：交材料、视力检查即可换，不用考试（WA 从 2026-10-31 起新增韩国、台湾等 14 个）。其他国家（包括中国大陆）：要通过理论考试和路考；是否还要危险感知测试以官方为准。',
			wait: '路考要另外预约，排期以官方为准。',
			sources: [
				{ title: 'WA DoT：Moving from overseas', url: 'https://www.transport.wa.gov.au/licensing/drivers-licence/visit-move-wa/moving-from-overseas' },
				{ title: 'SA.GOV.AU：Transfer your overseas driver\'s licence', url: 'https://www.sa.gov.au/topics/driving-and-transport/licences/interstate-and-overseas/overseas-licence-transfer' },
			],
		},
		desc: '游戏按「非认可国家」的流程：先交材料、考理论，再约路考。',
	},
	{
		id: 'licence', name: '换驾照：路考', icon: '🚗', needs: ['licence-theory'], where: AGENCY, place: '驾照办理中心（城市和较大的镇）', hours: [8, 15], minutes: 60, fee: 80, waitDays: 0,
		test: { skill: 'driving', dc: 60, retryDays: 3 },
		grow: { skill: 'driving', gain: 6 },
		docs: ['理论考试通过记录', '一辆合格的车（可借）'],
		unlocks: { now: ['考重型卡车驾照要先有本地驾照', '路考练车，驾驶能力上涨'], later: ['本地驾照当身份证件用，之后办事少带材料'] },
		real: {
			who: '过了理论考试的人。',
			steps: 'WA 叫 Practical Driving Assessment（PDA），SA 叫路考（practical driving test），考官跟车评估。',
			wait: '通过后当场发临时驾照，正式卡邮寄。',
			sources: [
				{ title: 'WA DoT：Moving from overseas', url: 'https://www.transport.wa.gov.au/licensing/drivers-licence/visit-move-wa/moving-from-overseas' },
				{ title: 'My Licence（SA）：Overseas licence transfer', url: 'https://www.mylicence.sa.gov.au/my-car-licence/the-hazard-perception-test/next-steps/overseas-licence-transfer' },
			],
		},
		desc: '驾驶能力 + 随机 0–60 达到 60 算过；没过 3 天后再考，考试费照收。',
	},
];

/** 这些动作要先办好对应的事（v1 只接了这几处，其他见设计文档的「提议」） */
export const PAPER_GATES = {
	/** 考这些证书要先有本地驾照 */
	certs: { 'hr-licence': ['licence'] } as Record<string, string[]>,
};
