// 寄存这版代码不认识的 id（v106）。纯函数，不改入参。
//
// 为什么要有：正式环境的代码会在几个分支之间来回切换（见 save.ts 开头）。carryUnknown 只保住了「不认识的顶层字段」，
// 认识的字段里面的 id 清单仍按这版的数据表过滤：分支 A 加了成就 X，玩家领了奖；切到没有 X 的分支 B，玩家只要打开一次页面，
// achClaimed 里的 X 就被清掉并落盘；再切回 A，X 又能领一次。新物品、新职业的工作同理，而且找不回来。
//
// 做法：清洗时被数据表筛掉的 id 不丢，放进 state.held；下次清洗前先放回原处，让那时的数据表重新认一遍。
// 认识了就回到原来的清单，还不认识就继续寄存。引擎和界面从不读 held，所以不认识的 id 不会进到规则里。
//
// 注意：这只对 v106 及以后的代码有效。切到更早的代码时，那版代码不会往 held 里放东西（但会把 held 当未知顶层字段原样带着）。
import type { HeldIds } from './types.ts';

/** 参与寄存的清单字段：都是「领过奖 / 拥有 / 解锁过」的记录，丢了就能重领或找不回 */
export const HELD_LISTS = ['checkins', 'seen', 'photos', 'collected', 'certs', 'dex', 'dexSets', 'duos', 'achClaimed'] as const;
/** 每个清单、背包最多寄存这么多个：被删掉的旧内容也会留在这里，要有上限 */
export const HELD_MAX = 60;
const HELD_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
const JOB_NUMS = ['level', 'shifts', 'good', 'lastDay'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const okId = (v: unknown): v is string => typeof v === 'string' && HELD_ID.test(v);

function heldJob(raw: unknown): Record<string, string | number> | null {
	if (!isObj(raw) || !okId(raw.career) || !okId(raw.loc)) return null;
	const out: Record<string, string | number> = { career: raw.career, loc: raw.loc };
	for (const k of JOB_NUMS) {
		const n = raw[k];
		out[k] = typeof n === 'number' && Number.isFinite(n) ? Math.max(-1, Math.min(1e7, Math.floor(n))) : k === 'lastDay' ? -1 : 0;
	}
	return out;
}

/**
 * 清洗之前调用：把寄存的 id 接回原存档对应的位置，返回新对象（没有寄存内容时返回原对象）。
 * 清单接在末尾（原有的排在前面，不会被长度上限挤掉）；背包以原存档的数量为准；工作只在现在没有工作时接回。
 */
export function unstash<T extends Record<string, any>>(r: T): T {
	const h = r.held;
	if (!isObj(h)) return r;
	const out: Record<string, any> = { ...r };
	if (isObj(h.lists)) {
		for (const k of HELD_LISTS) {
			const extra = Object.hasOwn(h.lists, k) ? h.lists[k] : undefined;
			if (Array.isArray(extra)) out[k] = [...(Array.isArray(r[k]) ? r[k] : []), ...extra.filter(okId).slice(0, HELD_MAX)];
		}
	}
	if (isObj(h.inv)) {
		const inv: Record<string, unknown> = {};
		for (const [id, n] of Object.entries(h.inv).slice(0, HELD_MAX)) if (okId(id)) inv[id] = n;
		out.inventory = { ...inv, ...(isObj(r.inventory) ? r.inventory : {}) };
	}
	if (!isObj(r.job)) {
		const j = heldJob(h.job);
		if (j) out.job = j;
	}
	return out as T;
}

/**
 * 清洗之后调用：r 是 unstash 之后的原存档，clean 是清洗结果。r 里有、clean 里没有的 id 寄存起来。
 * knownCareer：这版代码认不认识这个职业（工作被清掉还可能是因为地点不存在，那种不寄存）。
 */
export function stash(r: Record<string, any>, clean: Record<string, any>, knownCareer: (id: string) => boolean): HeldIds {
	const out: HeldIds = {};
	const lists: Record<string, string[]> = {};
	for (const k of HELD_LISTS) {
		if (!Array.isArray(r[k])) continue;
		const have = new Set<unknown>(Array.isArray(clean[k]) ? clean[k] : []);
		const rest = [...new Set((r[k] as unknown[]).filter(okId))].filter((id) => !have.has(id)).slice(0, HELD_MAX);
		if (rest.length) lists[k] = rest;
	}
	if (Object.keys(lists).length) out.lists = lists;
	if (isObj(r.inventory)) {
		const inv: Record<string, number> = {};
		let n = 0;
		for (const [id, v] of Object.entries(r.inventory)) {
			if (n >= HELD_MAX) break;
			if (!okId(id) || (isObj(clean.inventory) && Object.hasOwn(clean.inventory, id))) continue;
			if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue;
			inv[id] = Math.min(9999, Math.floor(v));
			n++;
		}
		if (n) out.inv = inv;
	}
	if (!clean.job) {
		const j = heldJob(r.job);
		if (j && !knownCareer(j.career as string)) out.job = j;
	}
	return out;
}
