// 学历课程：报名、上课、毕业。纯函数（动作函数不改入参，返回新存档）。
// 单向依赖 engine.ts（engine 不引用本文件，避免循环引用）。设计见 docs/earth-game/education-career.md。
import { PROGRAMS, credentialName } from '../data/education.ts';
import { applyEffect, clone, collapsedResult, fail, getLocation, growSkill, log, matches } from './engine.ts';
import { dayOf, hoursLabel, isOpen } from './time.ts';
import type { ActionResult, PlayerState, ProgramDef, Region, SkillKey } from './types.ts';

export const getProgram = (id: string) => PROGRAMS.find((p) => p.id === id);

export interface ProgramOffer {
	program: ProgramDef;
	done: number; // 已上几次
	blocked?: string;
}

/** 报名条件：缺哪张证或哪个学历；满足返回 undefined */
export function programUnmet(state: PlayerState, p: ProgramDef): string | undefined {
	const miss = (p.needs ?? []).find((id) => !state.certs.includes(id));
	return miss ? `需要先拿到${credentialName(miss)}` : undefined;
}

/** 当前地点能上的学历课程 */
export function programsAt(state: PlayerState, region: Region): ProgramOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	const today = dayOf(state.clock);
	return PROGRAMS.filter((p) => matches(p.where, loc)).map((program) => {
		const st = state.study[program.id];
		const done = st?.n ?? 0;
		const blocked = state.certs.includes(program.award) ? '已经毕业'
			: done === 0 ? programUnmet(state, program) : undefined;
		return {
			program,
			done,
			blocked: blocked
				?? (!isOpen(program.hours, state.clock) ? `上课时间 ${hoursLabel(program.hours)}`
					: st?.day === today ? '今天已经上过这门课'
					: state.cash < program.fee ? `需要 $${program.fee}`
					: state.needs.energy < 20 ? '太累了' : undefined),
		};
	});
}

/** 上一次学历课：先交这次的学费；上满次数时毕业，拿到学历和声望 */
export function studyProgram(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const offer = programsAt(prev, region).find((o) => o.program.id === id);
	if (!offer) return fail(prev, '这里没有这门课。');
	if (offer.blocked) return fail(prev, offer.blocked);
	const p = offer.program;
	const state = clone(prev);
	state.cash -= p.fee; // 和技能课程一样先交钱：途中晕倒这次课不算、学费不退（不能拿学费躲住院费）
	if (applyEffect(state, { minutes: p.minutes, needs: { energy: -Math.round(p.minutes / 10), fun: -4, social: 4 } }, region)) return collapsedResult(state);
	for (const [k, v] of Object.entries(p.skills)) growSkill(state, k as SkillKey, v!);
	const n = offer.done + 1;
	state.study[p.id] = { n, day: dayOf(prev.clock) };
	let msg = `上了${p.name}（${n}/${p.sessions}）。`;
	if (n >= p.sessions) {
		state.certs.push(p.award);
		state.respect += p.respect;
		msg = `${p.name}毕业了！拿到学历，声望 +${p.respect}。`;
	}
	log(state, msg);
	return { ok: true, state, msg };
}
