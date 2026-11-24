// 副业与小生意（第 1 版）：证照、副业、店铺类型、真实街区选址、经营事件。规则在 core/business.ts。
// 设计说明与现实出处见 docs/earth-game/side-business.md。本文件所有数值都是第 1 版初始值，「待平衡」，等 Codex 跑完模拟再定。
// 现实规定只做游戏简化：费用取出处里的数（或出处给出区间里的一个设计值），有效期按「现实 1 年 = 游戏 1 年（112 天）」换算。
import type { Hours, SkillKey, Where } from '../core/types.ts';

/** 州：证照有的全国通用（national），有的按州办，在哪个州做就要那个州的 */
export type StateCode = 'wa' | 'sa';

export interface LicenseDef {
	id: string;
	name: string;
	icon: string;
	/** 办理费（待平衡） */
	fee: number;
	/** 办理耗时（分钟）：都是网上办，在哪都能办 */
	minutes: number;
	/** 有效游戏天数，0 = 不过期 */
	days: number;
	/** 只在这个州有效；不写为全国通用 */
	state?: StateCode;
	/** 先要有的证照 */
	needs?: string[];
	desc: string;
}

/** 游戏 1 年的天数（和 core/time.ts 的 YEAR_DAYS 一致，这里写死避免 data 依赖 core） */
const GAME_YEAR = 112;

export const LICENSES: LicenseDef[] = [
	{ id: 'abn', name: 'ABN 澳洲商业号码', icon: '🪪', fee: 0, minutes: 30, days: 0, desc: '在 Australian Business Register 免费申请。接平台单、给公司开票都要它。' },
	{ id: 'bizname', name: '商号注册（ASIC）', icon: '🏷️', fee: 47, minutes: 30, days: GAME_YEAR, needs: ['abn'], desc: '用自己名字以外的店名营业要登记商号，按年续费。' },
	{ id: 'wwc-wa', name: '西澳 WWC 儿童工作检查卡', icon: '🧒', fee: 87, minutes: 60, days: 3 * GAME_YEAR, state: 'wa', desc: '在西澳做有偿的儿童相关工作（含家教）必须持卡，有效 3 年。' },
	{ id: 'wwc-sa', name: '南澳 WWC 儿童工作检查', icon: '🧒', fee: 145, minutes: 60, days: 3 * GAME_YEAR, state: 'sa', desc: '南澳的检查由人类服务部（DHS）办，和西澳的卡不互认。' },
	{ id: 'food-wa', name: '西澳食品营业登记', icon: '🍽️', fee: 120, minutes: 60, days: GAME_YEAR, state: 'wa', needs: ['abn'], desc: '向店铺所在的地方政府登记食品生意，各市镇收费不同，按年交管理费。' },
	{ id: 'food-sa', name: '南澳食品营业通知', icon: '🍽️', fee: 60, minutes: 45, days: 0, state: 'sa', needs: ['abn'], desc: '开业前通知店铺所在的地方议会（Food Act 2001 第 86 条）。' },
];

export interface GigDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	minutes: number;
	where: Where;
	hours: Hours;
	/** 只在星期几能做（0 = 周一 … 6 = 周日）；不写为每天 */
	days?: number[];
	/** 要先有的证照。`wwc` 这类按州办的写前缀，按所在地的州补成 wwc-wa / wwc-sa */
	licenses?: string[];
	/** 要先拍完几个摄影任务（作品集） */
	portfolio?: number;
	/** 先付的成本（摊位费、货款） */
	cost: number;
	/** 收入期望：base ×（1 + 能力 / 200）× 随机 0.75–1.25 */
	base: number;
	skill: SkillKey;
	/** 没有车时收入乘这个数（只有送外卖用：骑共享单车接的单少） */
	noVehicle?: number;
	/** 雨天收入乘这个数（只有送外卖用：雨天单多） */
	rain?: number;
	/** 货出意外（包裹丢失、清关被扣）的概率：成本收不回，没有收入 */
	loss?: number;
	/** 出色（随机上半段）时的声望 */
	respect: number;
	needs: { energy: number; fun?: number; social?: number };
	growth: number;
}

export const GIGS: GigDef[] = [
	{
		id: 'stall', name: '周末市集摆摊', icon: '🧺', desc: '交摊位费，卖自己做的手工和小玩意。', minutes: 300,
		where: { tags: ['market'] }, hours: [8, 13], days: [5, 6], cost: 60, base: 200, skill: 'charisma', respect: 1,
		needs: { energy: -18, social: 15, fun: 5 }, growth: 0.6,
	},
	{
		id: 'daigou', name: '代购', icon: '📦', desc: '替国内的朋友买保健品、护肤品，打包寄回去。先垫货款。', minutes: 180,
		where: { kinds: ['city'] }, hours: [9, 20], cost: 200, base: 270, skill: 'street', loss: 0.06, respect: 0,
		needs: { energy: -12, social: 5 }, growth: 0.4,
	},
	{
		id: 'tutor', name: '家教', icon: '📚', desc: '放学后给中小学生补课。', minutes: 120,
		where: { kinds: ['city', 'town'] }, hours: [15, 20], licenses: ['wwc'], cost: 0, base: 70, skill: 'charisma', respect: 1,
		needs: { energy: -10, social: 8 }, growth: 0.5,
	},
	{
		id: 'delivery', name: '送外卖', icon: '🛵', desc: '在外卖平台上接单。平台要求有 ABN；没有车只能骑共享单车。', minutes: 180,
		where: { kinds: ['city', 'town', 'port'] }, hours: [11, 22], licenses: ['abn'], cost: 0, base: 95, skill: 'driving', noVehicle: 0.7, rain: 1.3, respect: 0,
		needs: { energy: -16 }, growth: 0.5,
	},
	{
		id: 'photo', name: '摄影接单', icon: '📷', desc: '拍婚纱、毕业照和小店的菜单图。要有作品集，客户开票要 ABN。', minutes: 240,
		where: { kinds: ['city', 'coast', 'town', 'port'] }, hours: [7, 18], licenses: ['abn'], portfolio: 3, cost: 0, base: 230, skill: 'charisma', respect: 1,
		needs: { energy: -14, fun: 6 }, growth: 0.5,
	},
];

export interface ShopTypeDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	/** 装修和设备（开店一次性，倒闭或关店不退） */
	fitout: number;
	/** 每单售价、每单进货成本 */
	price: number;
	unitCost: number;
	/** 每天的基础客流（单） */
	customers: number;
	/** 一个人（店员或你自己看店）一天能接待几单 */
	perHand: number;
	/** 库存上限（单） */
	maxStock: number;
	/** 要食品营业登记 / 通知 */
	food: boolean;
}

export const SHOP_TYPES: ShopTypeDef[] = [
	// 奶茶店平衡第十一轮：装修 9000 → 6000、单价 7 → 8、每人每天 60 → 80 杯；原来满负荷一天的毛利 $300 还低于每天固定开销约 $311，越开越亏（balance.md 第十一轮）
	{ id: 'milk-tea', name: '奶茶店', icon: '🧋', desc: '珍珠奶茶和水果茶，周末排长队。', fitout: 6000, price: 8, unitCost: 2, customers: 70, perHand: 80, maxStock: 600, food: true },
	{ id: 'grocery', name: '亚洲杂货店', icon: '🛒', desc: '方便面、调料、零食和冷冻饺子。', fitout: 6000, price: 25, unitCost: 17, customers: 32, perHand: 40, maxStock: 300, food: true },
	{ id: 'phone-repair', name: '手机维修铺', icon: '📱', desc: '换屏、换电池、贴膜。', fitout: 4000, price: 85, unitCost: 35, customers: 7, perHand: 8, maxStock: 60, food: false },
];

export interface ShopSiteDef {
	id: string;
	/** 真实街区名 */
	name: string;
	en: string;
	/** 属于哪个游戏地点（要人到这里才能开店、看店、进货） */
	loc: string;
	state: StateCode;
	/** 每周租金（待平衡；游戏设计值，不是现实租金） */
	rent: number;
	/** 客流系数（待平衡；游戏设计值，按商业街类型粗分，不是实测人流） */
	traffic: number;
	desc: string;
}

/**
 * 选址：街区名、所属城市都是真实的（出处：维基百科对应条目，见设计文档 §5.2）；租金和客流是游戏设计值，没有现实数据支撑。
 * 只挂在已有的游戏地点下，不新增地图点，也不放坐标。
 */
export const SHOP_SITES: ShopSiteDef[] = [
	{ id: 'northbridge', name: '北桥', en: 'Northbridge', loc: 'perth', state: 'wa', rent: 900, traffic: 1.3, desc: '珀斯城北的餐饮夜生活区，有中国城。' },
	{ id: 'cannington', name: '坎宁顿', en: 'Cannington', loc: 'perth', state: 'wa', rent: 650, traffic: 1.1, desc: '东南郊的大型购物中心一带。' },
	{ id: 'victoria-park', name: '维多利亚公园', en: 'Victoria Park', loc: 'perth', state: 'wa', rent: 600, traffic: 1.0, desc: 'Albany Highway 两边一长串小餐馆和小店。' },
	{ id: 'subiaco', name: '苏比亚科', en: 'Subiaco', loc: 'perth', state: 'wa', rent: 700, traffic: 0.9, desc: '城西的老城区，咖啡馆和精品店。' },
	{ id: 'fremantle-cappuccino', name: '卡布奇诺街', en: 'South Terrace, Fremantle', loc: 'fremantle', state: 'wa', rent: 850, traffic: 1.2, desc: '弗里曼特尔南台街，游客最多的一段。' },
	{ id: 'mandurah-centre', name: '曼杜拉市中心', en: 'Mandurah city centre', loc: 'mandurah', state: 'wa', rent: 450, traffic: 0.8, desc: '运河边的老城区。' },
	{ id: 'adelaide-chinatown', name: '阿德莱德中国城', en: 'Chinatown, Adelaide', loc: 'adelaide', state: 'sa', rent: 850, traffic: 1.3, desc: 'Gouger Street 和 Moonta Street，挨着中央市场。' },
	{ id: 'rundle-mall', name: '兰德尔购物街', en: 'Rundle Mall', loc: 'adelaide', state: 'sa', rent: 1100, traffic: 1.4, desc: '阿德莱德市中心的步行购物街。' },
	{ id: 'prospect-road', name: '普罗斯佩克特路', en: 'Prospect Road, Prospect', loc: 'adelaide', state: 'sa', rent: 550, traffic: 0.9, desc: '城北郊区的一条餐饮小街。' },
	{ id: 'jetty-road', name: '杰蒂路', en: 'Jetty Road, Glenelg', loc: 'glenelg', state: 'sa', rent: 750, traffic: 1.1, desc: '格莱内尔格通往码头的主街。' },
	{ id: 'mount-gambier-centre', name: '甘比尔山市中心', en: 'Mount Gambier CBD', loc: 'mount-gambier', state: 'sa', rent: 380, traffic: 0.7, desc: '南澳第二大城的中心街区。' },
];

/** 店铺经营的规则常量（待平衡） */
export const SHOP_RULES = {
	/** 开店押金 = 几周租金（关店时没欠款就退） */
	bondWeeks: 4,
	/** 每个店员每天工资（8 小时 × 游戏最低时薪 $20） */
	staffWage: 160,
	/** 雇主养老金（现实：超级年金保证 12%，2025-07-01 起） */
	superRate: 0.12,
	/** 工伤保险保费占工资的比例（现实：西澳、南澳雇主都必须买；费率按行业，这里是设计值） */
	compRate: 0.02,
	maxStaff: 2,
	/** 店员人数之外，你自己看店的那天多一份人手；看店多久 */
	tendMinutes: 360,
	tendHours: [8, 14] as Hours,
	/** 周六、周日客流倍数 */
	weekend: 1.3,
	/** 客流随机范围 0.8–1.2 */
	swing: 0.4,
	/** 口碑 0–100：客流乘 (0.6 + 口碑 / 100 × 0.8)；新店 50 */
	repStart: 50,
	/** 断货（来客比库存多）口碑 −2，供应充足 +0.5 */
	repStockout: -2,
	repServed: 0.5,
	/** 每天发生一件经营事件的概率 */
	eventChance: 0.08,
	/** 欠款达到几周租金就倒闭 */
	closeWeeks: 3,
	/** 一次最多补算多少天（存档损坏或很久没动时的保险） */
	maxSettleDays: 112,
	/** 店铺账本保留最近几天 */
	histDays: 14,
	/** 开店、关店、倒闭的声望 */
	openRespect: 3,
	closeRespect: -10,
	/** 进货一次耗时（分钟）、雇人解雇耗时 */
	restockMinutes: 60,
	hireMinutes: 60,
	openMinutes: 120,
};

/** 经营事件：每天按 SHOP_RULES.eventChance 抽一件，自动结算（第 1 版没有选项） */
export interface ShopEventDef {
	id: string;
	text: string;
	/** 只发生在要食品登记的店 */
	food?: boolean;
	/** 只在有店员时发生 */
	staffed?: boolean;
	cash?: number;
	rep?: number;
	/** 丢掉库存的比例 */
	stockLoss?: number;
	/** 食品卫生检查：证照不全时改按 fine 罚款，当天停业 */
	inspection?: { fine: number; rep: number };
	weight: number;
}

export const SHOP_EVENTS: ShopEventDef[] = [
	{ id: 'inspection', text: '地方政府的环境卫生官员来做食品检查', food: true, inspection: { fine: 1000, rep: -10 }, rep: 3, weight: 2 },
	{ id: 'review', text: '有人在小红书上发了探店笔记，来了一波新客人', rep: 8, weight: 3 },
	{ id: 'bad-review', text: '一条差评挂在了地图评论区最上面', rep: -6, weight: 2 },
	{ id: 'fridge', text: '冰柜坏了，修理加上报废的货', cash: -350, stockLoss: 0.2, weight: 2 },
	{ id: 'shoplift', text: '货架上少了一批货，监控只拍到一个背影', stockLoss: 0.1, weight: 2 },
	{ id: 'staff-sick', text: '店员病了，你找人临时顶班多付了工钱', staffed: true, cash: -120, weight: 2 },
	{ id: 'regular', text: '附近写字楼的人成了回头客，订了一批团购', cash: 180, rep: 2, weight: 2 },
];

/** GST：年营业额达到门槛必须登记（现实 $75,000/年）。游戏按「游戏 1 年 112 天、收入约现实八折」换算成 $17,500/游戏年（待平衡） */
export const GST = { threshold: 17_500, rate: 1 / 11 };
