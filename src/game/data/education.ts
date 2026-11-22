// 学历课程与留学生签证工时（第 33 批，设计见 docs/earth-game/education-career.md）。
// 学历课程要分多次上完，每个游戏日每门最多上一次；上完拿到学历 id（记进 PlayerState.certs），用来解锁职业等级。
// 课程名称和资格代码是真实的（出处见设计文档第 2 节）；学费、次数、时长、成长量、声望都是游戏值，**待平衡**，不是现实价格的换算。
import type { ProgramDef } from '../core/types.ts';
import { CERTS } from './certs.ts';

export const PROGRAMS: ProgramDef[] = [
	{
		id: 'english-class', name: '英语强化班', kind: 'language', sessions: 10, minutes: 120, fee: 25,
		skills: { charisma: 1.5 }, award: 'english', respect: 3,
		where: { kinds: ['city'] }, hours: [9, 17],
		desc: '口语、听力和职场英语。',
	},
	{
		id: 'cert3-support', name: 'TAFE 三级证书·个人护理（CHC33021）', kind: 'tafe', sessions: 12, minutes: 240, fee: 40,
		needs: ['first-aid'], skills: { charisma: 1, stamina: 0.5 }, award: 'cert3-support', respect: 5,
		where: { kinds: ['city', 'town'] }, hours: [8, 16],
		desc: '养老和残障护理的入行资格。',
	},
	{
		id: 'cert4-it', name: 'TAFE 四级证书·信息技术（ICT40120）', kind: 'tafe', sessions: 15, minutes: 240, fee: 45,
		needs: ['english'], skills: { street: 0.6, charisma: 0.4 }, award: 'cert4-it', respect: 5,
		where: { kinds: ['city'] }, hours: [8, 16],
		desc: '网络、系统支持和故障排查。',
	},
	{
		id: 'bachelor', name: '大学学士课程（游戏缩短版）', kind: 'uni', sessions: 30, minutes: 240, fee: 80,
		needs: ['english'], skills: { charisma: 0.8, street: 0.4 }, award: 'bachelor', respect: 15,
		where: { kinds: ['city'] }, hours: [9, 17],
		desc: '现实要读三年，这里压成三十次课。',
	},
];

/**
 * 留学生签证工时（待平衡的只有游戏里的简化方式，48 小时 / 两周是现实规定，出处见设计文档第 3 节）：
 * 现实：学生签证（500 类）条件 8105，课程开课后、学期内每两周最多工作 48 小时，假期不限。
 * 游戏：出身是留学生、且正在读某门学历课程（上过但没上完，最近 inSessionDays 天内上过课）时算「学期内」，
 * 每 periodDays 个游戏日最多上班 capHours 小时（职业班次 + 零工）；没在读或已经读完算假期，不限。
 */
export const VISA = {
	origin: 'student',
	capHours: 48,
	periodDays: 14,
	inSessionDays: 14,
};

/** 算雇佣工时的零工（街头表演、捡瓶子不是雇佣，不算）。合并 claude/earth-economy 后可改用 GIG_CAREER 的键 */
export const VISA_GIGS = ['work-cafe', 'work-mine', 'work-farm'];

/** 证书或学历 id 的显示名；查不到返回 id 本身 */
export function credentialName(id: string): string {
	return CERTS.find((c) => c.id === id)?.name ?? PROGRAMS.find((p) => p.award === id)?.name ?? id;
}

/** 所有合法的学历 id */
export const AWARDS = PROGRAMS.map((p) => p.award);
