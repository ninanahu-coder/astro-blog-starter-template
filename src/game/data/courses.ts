// 技能课程：花钱换能力。成长量仍走 growSkill（特质倍率 + 递减曲线），
// 价格随当前能力上涨：价格 = base × (1 + 当前值 / 25)，低级便宜、高级很贵。
// 每门课每个游戏日只能上一次。
import type { CourseDef } from '../core/types.ts';

export const COURSES: CourseDef[] = [
	{ id: 'driving-school', name: '驾校课程', skill: 'driving', base: 40, minutes: 120, gain: 6, where: { kinds: ['city', 'town', 'mining'] }, hours: [8, 18], desc: '跟教练练两小时，比自己瞎开进步快。' },
	{ id: 'surf-school', name: '冲浪学校', skill: 'swimming', base: 35, minutes: 120, gain: 6, where: { tags: ['surf', 'beach'] }, hours: [7, 17], desc: '教练纠正你的划水和起乘。' },
	{ id: 'personal-trainer', name: '健身私教', skill: 'strength', base: 40, minutes: 90, gain: 6, where: { tags: ['gym'] }, hours: [6, 21], desc: '一对一力量训练。' },
	{ id: 'run-club', name: '跑团训练', skill: 'stamina', base: 15, minutes: 60, gain: 4, where: { kinds: ['city', 'town', 'coast'] }, hours: [5, 8], desc: '清晨集合，配速、间歇、拉伸。' },
	{ id: 'networking', name: '社交沟通课', skill: 'charisma', base: 30, minutes: 120, gain: 5, where: { kinds: ['city'] }, hours: [18, 22], desc: '晚间工作坊：表达、聆听、破冰。' },
	{ id: 'bushcraft', name: '野外生存课', skill: 'survival', base: 45, minutes: 240, gain: 7, where: { kinds: ['park', 'outback'] }, hours: [7, 13], desc: '跟原住民向导学找水、辨方向、识别植物。' },
	{ id: 'negotiation', name: '谈判技巧课', skill: 'street', base: 35, minutes: 120, gain: 5, where: { kinds: ['city', 'port'] }, hours: [9, 17], desc: '砍价、识破套路、拿捏分寸。' },
];

/** 价格随能力上涨的分母 */
export const COURSE_PRICE_STEP = 25;
