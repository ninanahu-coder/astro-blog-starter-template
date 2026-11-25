// 职业：在符合条件的地点应聘，固定时段上班，按表现升职。
// 与 activities.ts 里的零工不同：职业有等级、工资随等级上涨、每天只能上一个班。
import type { CareerDef } from '../core/types.ts';

export const CAREERS: CareerDef[] = [
	{
		id: 'barista', name: '咖啡店', where: { kinds: ['city', 'port', 'town', 'coast'] }, venues: ['cafe', 'restaurant', 'fast-food'], start: [6, 11], minutes: 360, skill: 'charisma',
		shift: { needs: { energy: -25, social: 15, fun: -8 }, skills: { charisma: 1.5 } },
		levels: [
			{ title: '学徒', pay: 120 },
			{ title: '咖啡师', pay: 165, req: { skills: { charisma: 25 } } },
			{ title: '店长', pay: 240, req: { skills: { charisma: 45 }, respect: 25 } },
		],
	},
	{
		id: 'lifeguard', name: '海滩救生队', where: { tags: ['beach'] }, venues: ['pool'], start: [6, 10], minutes: 480, skill: 'swimming',
		shift: { needs: { energy: -30, hygiene: -10, fun: 5 }, skills: { swimming: 2, stamina: 1 } },
		levels: [
			{ title: '见习救生员', pay: 160, req: { skills: { swimming: 25 } } },
			{ title: '救生员', pay: 235, req: { skills: { swimming: 40, stamina: 30 } } },
			{ title: '救生队长', pay: 320, req: { skills: { swimming: 60 }, respect: 30 } },
		],
	},
	{
		id: 'guide', name: '旅游公司', where: { kinds: ['park', 'island', 'coast'] }, start: [7, 10], minutes: 480, skill: 'survival',
		shift: { needs: { energy: -30, social: 20, hygiene: -15 }, skills: { survival: 1.5, charisma: 1 } },
		levels: [
			{ title: '导游助理', pay: 160 }, // 第 25 批 150 → 160：按 8 小时折算正好 $20/小时，等于游戏最低时薪（core/economy.ts）
			{ title: '导游', pay: 225, req: { skills: { survival: 25, charisma: 17 } } }, // 平衡第十六轮：魅力 25 → 17（首次升职中位 45 → 12 天）
			{ title: '探险领队', pay: 330, req: { skills: { survival: 45, charisma: 28 }, respect: 25 } }, // 第十六轮：魅力 40 → 28、声望 40 → 25
		],
	},
	{
		id: 'miner', name: '矿业公司', where: { kinds: ['mining'] }, start: [5, 8], minutes: 600, skill: 'strength',
		shift: { needs: { energy: -50, hygiene: -35, fun: -20 }, skills: { strength: 2, stamina: 1 } },
		levels: [
			{ title: '普工', pay: 300, req: { skills: { strength: 20 } } },
			{ title: '设备操作员', pay: 380, req: { skills: { strength: 35, driving: 15 } } },
			{ title: '班组长', pay: 470, req: { skills: { strength: 50 }, respect: 30 } },
		],
	},
	{
		id: 'trucker', name: '货运公司', where: { kinds: ['mining', 'city'], tags: ['airport'] }, start: [18, 23], minutes: 600, skill: 'driving',
		shift: { needs: { energy: -45, social: -10, fun: -10 }, skills: { driving: 2.5 } },
		levels: [
			{ title: '副驾', pay: 260, req: { skills: { driving: 20 }, certs: ['hr-licence'] } }, // 第十六轮：300/460/620 → 260/360/460，入门要 HR 证（持证 +15%）；原来几乎无门槛、净资产贴矿工 3 倍线
			{ title: '长途司机', pay: 360, req: { skills: { driving: 40 } } },
			{ title: '车队长', pay: 460, req: { skills: { driving: 60 }, respect: 40 } },
		],
	},
	// 第 11 轮新增；平衡分析第九轮调过：酒保工资 140/200/280 → 130/180/250、班次娱乐 +5 → −5（收入和心情原来都高于咖啡店）；
	// 农场工起薪 180 → 200（和农场零工同为 $25/小时）、第一次升职去掉力量 20（开局力量 5，每班只涨约 0.4，首次升职窗口内够不到）
	{
		id: 'bartender', name: '酒吧', where: { tags: ['pub'] }, venues: ['pub'], start: [17, 20], minutes: 360, skill: 'charisma',
		shift: { needs: { energy: -30, social: 20, hygiene: -10, fun: -5 }, skills: { charisma: 1.5, street: 0.5 } },
		levels: [
			{ title: '吧台帮手', pay: 130 },
			{ title: '调酒师', pay: 180, req: { skills: { charisma: 30 } } },
			{ title: '酒吧经理', pay: 250, req: { skills: { charisma: 50, street: 25 }, respect: 30 } },
		],
	},
	{
		// 上班窗口平衡第十一轮 [5, 7] → [5, 10]：首周能赶上的班次太少，首次升职第 23 天、首周被收房（balance.md 第十一轮）
		id: 'farmhand', name: '农场', where: { kinds: ['outback'], tags: ['wine'] }, start: [5, 10], minutes: 480, skill: 'stamina',
		shift: { needs: { energy: -40, hygiene: -30, fun: -10 }, skills: { stamina: 1.5, strength: 1, survival: 0.5 } },
		levels: [
			{ title: '摘果工', pay: 200 },
			{ title: '农场工', pay: 240, req: { skills: { stamina: 25 } } },
			{ title: '农场主管', pay: 320, req: { skills: { stamina: 45, survival: 10 }, respect: 25 } }, // 平衡第十七轮：生存 25 → 10（非背包客出身二升从第 160 天提前到 43–58 天）
		],
	},
	// 第 33 批新增（教育与职业发展，docs/earth-game/education-career.md）：入行或升职要持证书或学历（req.certs）。
	// 工资、班长、门槛都是初始值，待平衡；每个等级的时薪都不低于 $20（和 claude/earth-economy 的 ECON.minHourly 一致）
	{
		id: 'builder', name: '建筑工地', where: { kinds: ['city', 'town', 'mining'] }, start: [6, 8], minutes: 480, skill: 'strength',
		shift: { needs: { energy: -45, hygiene: -30, fun: -10 }, skills: { strength: 1.5, stamina: 1 } },
		levels: [
			{ title: '工地普工', pay: 200, req: { certs: ['white-card'] } },
			{ title: '熟练工', pay: 280, req: { skills: { strength: 35, stamina: 20 } } }, // 第十六轮：体能 30 → 20
			{ title: '工长', pay: 380, req: { skills: { strength: 50 }, respect: 30 } },
		],
	},
	{
		id: 'carer', name: '养老院', where: { kinds: ['city', 'town'] }, start: [6, 14], minutes: 480, skill: 'charisma',
		shift: { needs: { energy: -35, social: 10, hygiene: -15, fun: -5 }, skills: { charisma: 1, stamina: 0.5 } },
		levels: [
			{ title: '护理助理', pay: 176, req: { certs: ['first-aid'] } },
			{ title: '护理员', pay: 240, req: { skills: { charisma: 30 } } }, // 第十六轮：护理三级证书移到组长
			{ title: '护理组长', pay: 330, req: { skills: { charisma: 45 }, respect: 30, certs: ['cert3-support'] } },
		],
	},
	{
		id: 'it-support', name: 'IT 公司', where: { kinds: ['city'] }, start: [8, 10], minutes: 480, skill: 'street',
		shift: { needs: { energy: -25, social: 5, fun: -5 }, skills: { street: 0.8, charisma: 0.5 } },
		levels: [
			{ title: '服务台专员', pay: 200, req: { certs: ['cert4-it'] } },
			{ title: '系统管理员', pay: 320, req: { skills: { street: 18 } } }, // 第十六轮：街头 25 → 18，学士移到主管
			{ title: 'IT 主管', pay: 440, req: { skills: { charisma: 40 }, respect: 40, certs: ['bachelor'] } },
		],
	},
];

/** 每个等级至少上多少个班、其中多少个表现好，才有资格升到下一级 */
export const PROMOTE_SHIFTS = 8;
export const PROMOTE_GOOD = 5;
/** 表现检定的难度，按当前等级 */
export const SHIFT_DC = [55, 70, 85];
/** 表现好时的奖金比例 */
export const GOOD_BONUS = 0.2;
