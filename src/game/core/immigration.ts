// 签证路线（第 43 批）：学生签 500 → 毕业生签 485 → 技术移民 / 雇主担保 → PR。
// 纯函数：查询函数只读；动作函数不改入参，返回新存档；settleVisa 原地修改 applyAction 新建的存档。
// 单向依赖 engine.ts（engine 不引用本文件）。设计和现实出处见 docs/earth-game/visa.md。以官方为准、游戏简化。
import { CATEGORY2_POSTCODES, OCCUPATIONS, POINTS, VISA_GIGS, VISA_KINDS, VISA_ROUTES, VISA_RULES, type OccupationDef, type VisaKind, type VisaRoute, type VisaRouteDef } from '../data/visas.ts';
import { applyEffect, clone, collapsedResult, fail, getCareer, getLocation, log, roll } from './engine.ts';
import { dayOf } from './time.ts';
import { canWork, daysLeft, isTemporary, VISA_EXPIRED_MSG, visaKindNow } from './visa.ts';
// 签证状态的判断在 core/visa.ts（engine 也要用），这里转出，保持原来的导入路径
export { canWork, daysLeft, isTemporary, visaKindNow };
import type { ActionResult, PlayerState, Region } from './types.ts';

const R = VISA_RULES;
export const getVisaKind = (id: VisaKind) => VISA_KINDS.find((k) => k.id === id)!;
export const getRoute = (id: string) => VISA_ROUTES.find((r) => r.id === id);

/** 临时签证（会到期） */
/** 打分和资格用的学历：签证课程毕业的，和 main 学历课程考到的（certs 里的 'bachelor'），取较高的 */
export function degreeOf(s: PlayerState): 'none' | 'bachelor' | 'master' {
	if (s.visa.degree === 'master') return 'master';
	return s.visa.degree === 'bachelor' || s.certs.includes('bachelor') ? 'bachelor' : 'none';
}

/** 现在的年龄：开局年龄 + 过了几个签证年 */
export const visaAge = (s: PlayerState) => s.visa.age0 + Math.floor(dayOf(s.clock) / R.daysPerYear);

/** 签证年（经验、在签时间）：游戏日 ÷ daysPerYear，保留一位小数 */
export const years = (days: number) => Math.floor((days / R.daysPerYear) * 10) / 10;

/** 当前位置的地区类别（现实按邮编分类；游戏按地点查表，见 data/visas.ts 的 CATEGORY2_POSTCODES）。region 留给以后别的州 */
export function regionalCategory(s: PlayerState, _region?: Region): 2 | 3 {
	return Object.hasOwn(CATEGORY2_POSTCODES, s.loc) ? 2 : 3;
}

/** 某份工作在某个等级算不算「清单职业」经验；不算返回 undefined */
export function occupationFor(career: string, level: number): OccupationDef | undefined {
	const o = OCCUPATIONS.find((x) => x.career === career);
	return o && level >= o.minLevel ? o : undefined;
}

export interface PointsLine { label: string; pts: number }

/** 技术移民打分（189 / 190 / 491 共用一张表，nomination 是州提名加分）。返回明细和总分 */
export function visaPoints(s: PlayerState, nomination?: 'state' | 'regional'): { total: number; lines: PointsLine[] } {
	const v = s.visa;
	const age = visaAge(s);
	const yrs = v.exp / R.daysPerYear;
	const lines: PointsLine[] = [
		{ label: `年龄 ${age} 岁`, pts: POINTS.age.find(([lo, hi]) => age >= lo && age <= hi)?.[2] ?? 0 },
		{ label: `英语 雅思 ${v.ielts || '未考'}`, pts: POINTS.english.find(([min]) => v.ielts >= min)?.[1] ?? 0 },
		{ label: `澳洲本行经验 ${years(v.exp)} 年`, pts: POINTS.ausExp.find(([min]) => yrs >= min)?.[1] ?? 0 },
		{ label: `学历：${{ none: '无', bachelor: '本科', master: '硕士' }[degreeOf(s)]}`, pts: POINTS.degree[degreeOf(s)] ?? 0 },
		{ label: '在澳洲读满两年', pts: degreeOf(s) !== 'none' ? POINTS.ausStudy : 0 },
		{ label: '在偏远地区读书（西澳、南澳）', pts: degreeOf(s) !== 'none' ? POINTS.regionalStudy : 0 },
		{ label: '单身申请', pts: POINTS.single },
	];
	if (nomination) lines.push({ label: nomination === 'state' ? '州政府提名（190）' : '偏远地区提名（491）', pts: POINTS.nomination[nomination] });
	return { total: lines.reduce((a, l) => a + l.pts, 0), lines };
}

export interface RouteOffer {
	route: VisaRouteDef;
	/** 不满足的第一条原因；满足为 undefined */
	blocked?: string;
	/** 打分类路线的分数 */
	points?: number;
}

/** 一条路线不满足的原因（第一条）；满足返回 undefined。不查钱和事件 */
export function routeUnmet(s: PlayerState, region: Region, id: VisaRoute): string | undefined {
	const v = s.visa;
	const route = getRoute(id)!;
	const now = visaKindNow(s);
	const today = dayOf(s.clock);
	const age = visaAge(s);
	if (!route.from.includes(now)) return `现在的签证（${getVisaKind(now).name}）不能申请这一类`;
	const ielts = (min: number) => (v.ielts < min ? `雅思要 ${min} 分（现在 ${v.ielts || '未考'}）` : undefined);
	const exp = (y: number) => (v.exp < y * R.daysPerYear ? `清单职业经验要 ${y} 年（现在 ${years(v.exp)} 年）` : undefined);
	switch (id) {
		case 'student':
			return v.course && v.course.end > today ? '现在的课程还没读完' : degreeOf(s) === 'none' ? '本科毕业后才能报硕士' : undefined;
		case 'graduate':
			return v.course ? `${v.course.end - today} 天后毕业才能申请` : degreeOf(s) === 'none' ? '要先毕业' : age > R.graduate.maxAge ? `年龄要在 ${R.graduate.maxAge} 岁以下` : v.had.includes('graduate') ? '毕业生签证只能拿一次' : ielts(R.graduate.minIelts);
		case 'graduate2':
			return v.had.includes('graduate2') ? '第二次毕业生签证只能拿一次' : age > R.graduate.maxAge ? `年龄要在 ${R.graduate.maxAge} 岁以下` : undefined;
		case 'sponsored': {
			const o = s.job ? occupationFor(s.job.career, s.job.level) : undefined;
			if (!s.job) return '要先有一份工作，由雇主担保';
			if (!o?.sponsor) return `现在这份工作（${getCareer(s.job.career)?.levels[s.job.level]?.title ?? ''}）不在担保职业里`;
			return exp(R.sponsored.minExpYears) ?? ielts(R.sponsored.minIelts);
		}
		case 'ens':
			return (v.sponsor?.days ?? 0) < R.ens.sponsorYears * R.daysPerYear ? `要在担保下工作满 ${R.ens.sponsorYears} 年（现在 ${years(v.sponsor?.days ?? 0)} 年）`
				: age >= R.ens.maxAge ? `年龄要在 ${R.ens.maxAge} 岁以下` : ielts(R.ens.minIelts);
		case 'skilled':
		case 'state':
		case 'regional': {
			const o = v.occ ? OCCUPATIONS.find((x) => x.career === v.occ) : undefined;
			const ok = o && (o.skilled || (id === 'regional' && o.sponsor));
			if (!ok) return id === 'regional' ? '要有清单职业的工作经验' : '要有技术移民清单职业的工作经验';
			if (age >= R.points.maxAge) return `年龄要在 ${R.points.maxAge} 岁以下`;
			const why = exp(R.points.minExpYears) ?? ielts(R.points.minIelts);
			if (why) return why;
			const pts = visaPoints(s, id === 'skilled' ? undefined : id).total;
			return pts < R.points.pass ? `打分 ${pts}，要 ${R.points.pass} 分` : undefined;
		}
		case 'regionalPr': {
			const need = R.regionalPr.years * R.daysPerYear;
			if (today - v.since < need) return `持 491 要满 ${R.regionalPr.years} 年（还差 ${need - (today - v.since)} 天）`;
			const worked = v.exp - v.expAt;
			const want = Math.ceil(need * R.regionalPr.workShare);
			return worked < want ? `持 491 期间上班的日子要有 ${want} 天（现在 ${worked} 天）` : undefined;
		}
	}
}

/** 现在能看到的路线（只列从当前签证出发的），带不满足的原因 */
export function visaOptions(s: PlayerState, region: Region): RouteOffer[] {
	const now = visaKindNow(s);
	if (now === 'none' || now === 'pr') return [];
	return VISA_ROUTES.filter((r) => r.from.includes(now)).map((route) => {
		const blocked = routeUnmet(s, region, route.id) ?? (s.cash < route.fee ? `需要 $${route.fee}` : undefined);
		const points = route.id === 'skilled' ? visaPoints(s).total : route.id === 'state' || route.id === 'regional' ? visaPoints(s, route.id).total : undefined;
		return { route, blocked, points };
	});
}

/** 批下来的新签证有效期（游戏日）。学生签跟课程走 */
function grantedUntil(s: PlayerState, region: Region, id: VisaRoute, today: number): number {
	const d = R.daysPerYear;
	switch (id) {
		case 'student': return today + R.masterCourseDays + R.courseTailDays;
		case 'graduate2': return Math.max(today, s.visa.until) + (regionalCategory(s, region) === 2 ? R.graduate2.cat2Years : R.graduate2.cat3Years) * d;
		default: {
			const years = getVisaKind(getRoute(id)!.to).years;
			return years ? today + years * d : -1;
		}
	}
}

/** 申请签证：条件满足就当场批（游戏简化：现实要排队审理、可能拒签）。交申请费 */
export function applyVisa(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const route = getRoute(id);
	if (!route) return fail(prev, '没有这种签证。');
	const why = routeUnmet(prev, region, route.id) ?? (prev.cash < route.fee ? `需要 $${route.fee}` : undefined);
	if (why) return fail(prev, why);
	const s = clone(prev);
	const today = dayOf(s.clock);
	const v = s.visa;
	s.cash -= route.fee;
	v.until = grantedUntil(prev, region, route.id, today);
	v.kind = route.to;
	v.since = today;
	v.expAt = v.exp;
	v.warned = false;
	if (!v.had.includes(route.to)) v.had.push(route.to);
	v.course = route.id === 'student' ? { end: today + R.masterCourseDays, award: 'master' } : null;
	v.sponsor = route.id === 'sponsored' && s.job ? { career: s.job.career, days: 0 } : null;
	const kind = getVisaKind(route.to);
	const msg = route.to === 'pr'
		? `🎉 ${route.name}（${route.sub}）批下来了，你成为澳大利亚永久居民！`
		: `${route.name}（${route.sub}）批下来了，有效到第 ${v.until + 1} 天。${kind.desc}`;
	log(s, msg);
	if (route.to === 'pr') s.respect += 10; // 待平衡
	return { ok: true, state: s, msg };
}

export interface IeltsOffer { fee: number; chance: number; blocked?: string }

/** 这里能不能考雅思（城市里才有考点）、涨分几率 */
export function ieltsAt(s: PlayerState, region: Region): IeltsOffer | null {
	const loc = getLocation(region, s.loc);
	if (!loc || s.visa.kind === 'none' || !R.ielts.kinds.includes(loc.kind)) return null;
	const chance = Math.min(R.ielts.max, R.ielts.base + s.skills.charisma / R.ielts.charismaDiv);
	const blocked = s.visa.ielts >= 9 ? '已经满分' : s.cash < R.ielts.fee ? `需要 $${R.ielts.fee}` : s.needs.energy < 20 ? '太累了' : undefined;
	return { fee: R.ielts.fee, chance, blocked };
}

/** 考一次雅思：有几率涨半分，不会掉分（游戏简化：现实每次重考分数可能高也可能低） */
export function takeIelts(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = ieltsAt(prev, region);
	if (!offer) return fail(prev, '这里没有雅思考点。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const s = clone(prev);
	s.cash -= offer.fee; // 先交钱：途中晕倒不退
	if (applyEffect(s, { minutes: R.ielts.minutes, needs: { energy: -20, fun: -10 } }, region)) return collapsedResult(s);
	const up = roll(s) < offer.chance && s.visa.ielts < 9;
	const base = s.visa.ielts || R.startIelts;
	s.visa.ielts = up ? Math.min(9, base + 0.5) : base;
	const msg = up ? `雅思考了 ${s.visa.ielts} 分，比上次高！` : `雅思这次 ${s.visa.ielts} 分，没涨。`;
	log(s, msg);
	return { ok: true, state: s, msg };
}

/** 签证过期时不能做的动作；返回原因 */
export function visaWorkBlocked(s: PlayerState, a: { t: string; op?: string; id?: string; venue?: string }): string | undefined {
	if (canWork(s)) return undefined;
	// 真实地点：打上班卡要合法工作；已经打了卡（签证有效时打的）照样能打下班卡，不然卡会一直挂着（合并 main 后复核）
	const clockOut = a.t === 'venue' && a.op === 'work' && !!s.clockIn && s.clockIn.venue === a.venue;
	const work = (a.t === 'job' && (a.op === 'apply' || a.op === 'work')) || (a.t === 'activity' && !!a.id && VISA_GIGS.includes(a.id)) || (a.t === 'venue' && a.op === 'work' && !clockOut);
	return work ? VISA_EXPIRED_MSG : undefined;
}

/**
 * 动作结算后的签证收尾（原地修改 after，after 是 applyAction 新建的存档）：
 * 上了一天清单职业的班就记一天经验（担保签证另记担保天数）；课程到期毕业；快到期提醒一次；过期改状态。
 * 返回要追加到提示里的话（没有为空串）。
 */
export function settleVisa(before: PlayerState, after: PlayerState): string {
	const v = after.visa;
	if (v.kind === 'none' || v.kind === 'pr') return '';
	const notes: string[] = [];
	if (after.job && after.workDay > before.workDay) {
		const o = occupationFor(after.job.career, after.job.level);
		if (o) {
			v.exp += 1;
			v.occ = o.career;
		}
		if (v.kind === 'sponsored' && v.sponsor && v.sponsor.career === after.job.career) v.sponsor.days += 1;
	}
	const today = dayOf(after.clock);
	if (v.course && today >= v.course.end) {
		v.degree = v.course.award;
		// main 的学历课程（PROGRAMS）和职业要求看 certs 里的 'bachelor'：签证课程毕业也记进去，两边不用重读（合并 main 后复核）
		if (v.course.award === 'bachelor' && !after.certs.includes('bachelor')) after.certs = [...after.certs, 'bachelor'];
		const name = v.course.award === 'master' ? '硕士' : '本科';
		v.course = null;
		notes.push(`🎓 ${name}毕业了！`);
		log(after, `${name}毕业了，可以申请下一步签证。`);
	}
	if (isTemporary(v.kind)) {
		const left = v.until - today;
		if (left < 0) {
			v.kind = 'expired';
			v.until = -1;
			notes.push('⛔ 签证过期了，不能再工作');
			log(after, '签证过期了：不能工作，去「我」页重新申请签证。');
		} else if (left <= R.warnDays && !v.warned) {
			v.warned = true;
			notes.push(`⏳ 签证还有 ${left} 天到期`);
			log(after, `${getVisaKind(v.kind).name}还有 ${left} 天到期，记得申请下一步。`);
		}
	}
	return notes.join('；');
}
