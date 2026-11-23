// 证件和办事（第 43 批）：纯函数。数据在 data/paperwork.ts，设计见 docs/earth-game/paperwork.md。
// 只依赖 engine 导出的通用工具，engine 不反过来依赖这里；动作的接入点只在 actions.ts。
import { PAPER_GATES, PAPER_ORDER, PAPERS, type PaperDef } from '../data/paperwork.ts';
import { checkScore } from './attributes.ts';
import { applyEffect, clone, collapsedResult, fail, getLocation, growSkill, log, roll } from './engine.ts';
import { dayOf, hoursLabel, isOpen } from './time.ts';
import type { ActionResult, PaperRec, PlayerState, Region } from './types.ts';
import { openAccount } from './bank.ts';
import { applyTfn } from './tax-actions.ts';
import { tfnState } from './tax.ts';
import { coverOf } from './health.ts';

export type { PaperRec };
export type { Papers } from './paper-clean.ts';

export type PaperStatus = 'todo' | 'waiting' | 'done' | 'stale' | 'retry' | 'na';

export const getPaper = (id: string): PaperDef | undefined => PAPERS.find((p) => p.id === id);

/** 这个角色适用的办事项（按区域和出身筛），按新手清单的顺序 */
export function papersFor(state: PlayerState): PaperDef[] {
	return PAPER_ORDER.map(getPaper).filter((p): p is PaperDef => !!p && applies(state, p));
}

/** 医保那一行显示哪一个：签证带 OSHC 的显示 OSHC，其余显示 Medicare（没有的写明全额自付） */
const coverRow = (state: PlayerState) => (coverOf(state).id === 'oshc' ? 'oshc' : 'medicare');

function applies(state: PlayerState, p: PaperDef): boolean {
	if (p.linked === 'cover' && p.id !== coverRow(state)) return false;
	if (p.regions && !p.regions.includes(state.region as 'wa' | 'sa')) return false;
	if (p.origins && !p.origins.includes(state.origin)) return false;
	if (p.notOrigins?.includes(state.origin)) return false;
	return true;
}

/**
 * 办事项的状态：
 * - todo 还没办；waiting 递交了在等；done 办成；
 * - retry 考试没过，ready 那天之后才能再考；
 * - stale 地址登记过但已经搬家（住处不在登记的地方）。
 */
export function paperStatus(state: PlayerState, id: string): PaperStatus {
	// 合并 main 后：银行户、TFN、医保看 main 各自的系统，不看清单自己的记录
	const linked = getPaper(id)?.linked;
	if (linked === 'bank') return state.bank?.open ? 'done' : 'todo';
	if (linked === 'tfn') {
		const t = state.tax ? tfnState(state.tax, dayOf(state.clock)) : 'none';
		return t === 'ok' ? 'done' : t === 'waiting' ? 'waiting' : 'todo';
	}
	if (linked === 'cover') return coverOf(state).id === id ? 'done' : 'na';
	const rec = state.papers[id];
	if (!rec) return 'todo';
	const today = dayOf(state.clock);
	if (rec.fail) return 'retry';
	if (rec.ready > today) return 'waiting';
	if (id === 'address' && state.home && rec.loc !== state.home.loc) return 'stale';
	return 'done';
}

/** 办成了（地址过期也不算） */
export const paperDone = (state: PlayerState, id: string) => paperStatus(state, id) === 'done';

/** 前置没满足时返回原因 */
function needsUnmet(state: PlayerState, p: PaperDef): string | undefined {
	for (const id of p.needs) {
		if (paperDone(state, id)) continue;
		const n = getPaper(id);
		const st = paperStatus(state, id);
		return st === 'waiting' ? `要等「${n?.name ?? id}」办好` : st === 'stale' ? '搬家了，先更新地址' : `要先「${n?.name ?? id}」`;
	}
	if (p.needsHome && !state.home) return '要先有住处';
	return undefined;
}

/** 现在能不能办这件事；能办返回 undefined。区域、出身不适用的返回「不适用」 */
export function paperBlocked(state: PlayerState, region: Region, p: PaperDef): string | undefined {
	if (!applies(state, p)) return '你不用办这一项';
	const st = paperStatus(state, p.id);
	if (st === 'done') return '已经办好了';
	if (st === 'na') return '你的签证不带 Medicare，看病全额自付（私人医保还没做）';
	if (p.linked === 'tfn' && st === 'waiting') return `TFN 在寄来的路上，第 ${state.tax.tfn + 1} 天到`;
	if (p.linked) return undefined; // 开户、申请 TFN 不花钱不花时间，在哪都能办（规则在 main 的银行、税务）
	if (st === 'waiting') return `在办理中，第 ${state.papers[p.id].ready + 1} 天办好`;
	if (st === 'retry' && state.papers[p.id].ready > dayOf(state.clock)) return `第 ${state.papers[p.id].ready + 1} 天才能再考`;
	const why = needsUnmet(state, p);
	if (why) return why;
	if (p.where !== 'online') {
		const loc = getLocation(region, state.loc);
		if (!loc || !(p.where.kinds?.includes(loc.kind) || p.where.locs?.includes(loc.id))) return `要到${p.place}`;
		if (p.hours && !isOpen(p.hours, state.clock)) return `办公时间 ${hoursLabel(p.hours)}`;
	}
	if (state.cash < p.fee) return `需要 $${p.fee}`;
	if (state.needs.energy < 15) return '太累了';
	return undefined;
}

export interface PaperRow {
	paper: PaperDef;
	status: PaperStatus;
	blocked?: string;
}

/** 新手清单：适用的每一项、状态、现在能不能办 */
export function paperChecklist(state: PlayerState, region: Region): PaperRow[] {
	return papersFor(state).map((paper) => ({ paper, status: paperStatus(state, paper.id), blocked: paperBlocked(state, region, paper) }));
}

/** 清单进度：办成几项 / 共几项 */
export function paperProgress(state: PlayerState): { done: number; total: number } {
	const list = papersFor(state).filter((p) => paperStatus(state, p.id) !== 'na'); // 签证不带医保那一行只是说明，不算要办的项
	return { done: list.filter((p) => paperDone(state, p.id)).length, total: list.length };
}

/** 办一件事：花时间和钱，当场办成或进入等待；有考试的按能力检定 */
export function doPaper(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const p = getPaper(id);
	if (!p) return fail(prev, '没有这项手续。');
	const why = paperBlocked(prev, region, p);
	if (why) return fail(prev, why);
	// 合并 main 后：开户、申请 TFN 直接走 main 的动作（同一份记录、同样的规则）
	if (p.linked === 'bank') return openAccount(prev);
	if (p.linked === 'tfn') return applyTfn(prev);
	if (p.linked) return fail(prev, '这一项不用在这里办。');
	// 和 engine 的 paidTask 同一个思路：先按没交钱把这段时间过完，途中晕倒就当没去、不收费（住院费按原有的钱算）；
	// 顺利办完才收费，途中的周结算把钱花掉了的话改按「先交钱再办」重算
	const run = (s: PlayerState) => applyEffect(s, { minutes: p.minutes, needs: { energy: -Math.round(p.minutes / 15), fun: -3 } }, region);
	let state = clone(prev);
	if (run(state)) {
		log(state, `${p.name}没办完，不收费。`);
		return collapsedResult(state);
	}
	if (state.cash >= p.fee) state.cash -= p.fee;
	else {
		state = clone(prev);
		state.cash -= p.fee;
		if (run(state)) {
			state.cash += p.fee;
			log(state, `${p.name}没办完，不收费。`);
			return collapsedResult(state);
		}
	}
	const today = dayOf(state.clock);
	let msg: string;
	if (p.test) {
		const pass = checkScore(state, p.test.skill).total + roll(state) * 60 >= p.test.dc;
		if (!pass) {
			state.papers[p.id] = { at: today, ready: today + p.test.retryDays, fail: true };
			msg = `${p.name}没过，${p.test.retryDays} 天后可以再约。`;
			log(state, msg);
			return { ok: true, state, msg };
		}
	}
	if (p.grow) growSkill(state, p.grow.skill, p.grow.gain);
	state.papers[p.id] = { at: today, ready: today + p.waitDays, ...(p.id === 'address' && state.home ? { loc: state.home.loc } : {}) };
	msg = p.waitDays > 0 ? `${p.name}：已递交，第 ${today + p.waitDays + 1} 天办好。` : `${p.name}：办好了。`;
	if (!p.waitDays && p.unlocks.now.length) msg += `解锁：${p.unlocks.now.join('；')}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

// ---------- 接入其他动作（只在 actions.ts 调用） ----------

/** 动作形状的最小子集，避免和 actions.ts 循环引用 */
type GateAction = { t: string; op?: string; id?: string; loan?: boolean };

/** 某个动作因为手续没办而不能做时返回原因；合并 main 后只拦考重型卡车驾照（按揭要开户由 main 的银行审批管） */
export function paperGate(state: PlayerState, a: GateAction): string | undefined {
	const need = a.t === 'cert' && a.id ? PAPER_GATES.certs[a.id] : undefined;
	const miss = need?.find((id) => !paperDone(state, id));
	if (!miss) return undefined;
	const p = getPaper(miss);
	return `要先办好「${p?.name ?? miss}」（今天页 · 落地清单）。`;
}

// 存档校验 cleanPapers 在 paper-clean.ts（character.ts 要用，放这里会和 engine 循环引用）
export { cleanPapers } from './paper-clean.ts';
