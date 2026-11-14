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
			{ title: '导游助理', pay: 150 },
			{ title: '导游', pay: 225, req: { skills: { survival: 25, charisma: 25 } } },
			{ title: '探险领队', pay: 330, req: { skills: { survival: 45, charisma: 40 }, respect: 40 } },
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
			{ title: '副驾', pay: 300, req: { skills: { driving: 20 } } },
			{ title: '长途司机', pay: 460, req: { skills: { driving: 40 } } },
			{ title: '车队长', pay: 620, req: { skills: { driving: 60 }, respect: 40 } },
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
