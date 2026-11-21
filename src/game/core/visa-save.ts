// 签证存档字段（第 43 批）：新建角色的初始值和不可信存档的清洗。
// 只依赖数据表，不依赖 engine.ts（character.ts 要用它，避免循环引用）。规范见 docs/earth-game/save-sync.md §5。
import { VISA_KINDS, VISA_RULES, type VisaKind } from '../data/visas.ts';
import type { VisaState } from './types.ts';

const KINDS = new Set<VisaKind>(VISA_KINDS.map((k) => k.id));
const DEGREES = ['none', 'bachelor', 'master'] as const;

/** 出身对应的开局签证：只有留学生走签证路线 */
export function newVisa(origin: string, day: number): VisaState {
	if (origin !== 'student') return noneVisa();
	const end = day + VISA_RULES.startCourseDays;
	return {
		kind: 'student', until: end + VISA_RULES.courseTailDays, since: day,
		// 年龄按「拿到这份签证那天 22 岁」倒推第 0 天的年龄：老存档在第几百天补签证也不会一读档就超龄（合并 main 后复核）
		// age0 可以小于 16 甚至为负：它只是倒推出来的「第 0 天」年龄，真正显示和判断用的是 visaAge
		age0: VISA_RULES.startAge - Math.floor(day / VISA_RULES.daysPerYear),
		ielts: VISA_RULES.startIelts, degree: 'none', course: { end, award: 'bachelor' },
		exp: 0, occ: null, sponsor: null, expAt: 0, had: ['student'], warned: false,
	};
}

const noneVisa = (): VisaState => ({ kind: 'none', until: -1, since: 0, age0: 0, ielts: 0, degree: 'none', course: null, exp: 0, occ: null, sponsor: null, expAt: 0, had: [], warned: false });

const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.max(lo, Math.min(hi, v))) : d);
const careerId = (v: unknown, careers: ReadonlySet<string>) => (typeof v === 'string' && careers.has(v) ? v : null);

/**
 * 清洗存档里的 visa（不可信）。旧存档没有这个字段：按出身补一份「从今天起」的开局签证，
 * 留学生老玩家不会一读档就过期。任何输入都不抛异常；幂等。
 * day：存档的游戏日（dayOf(clock)），careers：已知职业 id。
 */
export function cleanVisa(raw: unknown, origin: string, day: number, careers: ReadonlySet<string>): VisaState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return newVisa(origin, day);
	const r = raw as Record<string, unknown>;
	const kind = typeof r.kind === 'string' && KINDS.has(r.kind as VisaKind) ? (r.kind as VisaKind) : null;
	if (!kind) return newVisa(origin, day);
	if (kind === 'none') return noneVisa();
	const max = 1e7;
	const temp = kind !== 'pr' && kind !== 'expired';
	const c = r.course as Record<string, unknown> | null | undefined;
	const course = kind === 'student' && c && typeof c === 'object' && (c.award === 'bachelor' || c.award === 'master') && typeof c.end === 'number' && Number.isFinite(c.end)
		? { end: int(c.end, 0, max, 0), award: c.award as 'bachelor' | 'master' } : null;
	const sp = r.sponsor as Record<string, unknown> | null | undefined;
	const spCareer = kind === 'sponsored' && sp && typeof sp === 'object' ? careerId(sp.career, careers) : null;
	const exp = int(r.exp, 0, max, 0);
	const ielts = typeof r.ielts === 'number' && Number.isFinite(r.ielts) ? Math.round(Math.max(0, Math.min(9, r.ielts)) * 2) / 2 : 0;
	return {
		kind,
		until: temp ? int(r.until, 0, max, day) : -1,
		since: int(r.since, 0, max, 0),
		age0: int(r.age0, -100_000, 80, VISA_RULES.startAge),
		ielts,
		degree: DEGREES.includes(r.degree as never) ? (r.degree as VisaState['degree']) : 'none',
		course,
		exp,
		occ: careerId(r.occ, careers),
		sponsor: spCareer ? { career: spCareer, days: int((sp as Record<string, unknown>).days, 0, max, 0) } : null,
		expAt: Math.min(exp, int(r.expAt, 0, max, 0)),
		had: Array.isArray(r.had) ? [...new Set(r.had.filter((k): k is VisaKind => typeof k === 'string' && KINDS.has(k as VisaKind)))].slice(0, 16) : [],
		warned: r.warned === true,
	};
}
