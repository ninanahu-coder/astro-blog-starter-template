// 净资产排行榜（经济方案 D 期）：每份存档落盘时由服务端写一条榜单记录，查询时排名。
// 纯函数：不读时钟，时间由调用方传入。
import { netWorth } from './engine.ts';
import { dayOf } from './time.ts';
import type { PlayerState } from './types.ts';

/** 榜单显示前多少名 */
export const BOARD_TOP = 20;

/** 存在服务端的一条榜单记录。只放展示用的公开信息：不含存档 id、同步码、种子 */
export interface BoardEntry {
	name: string;
	avatar: string;
	worth: number; // 净资产（取整）
	day: number; // 游戏第几天
	at: number; // 写入时间（毫秒，服务端时间）；净资产相同时先达到的排前面
}

export interface BoardRow {
	rank: number;
	name: string;
	avatar: string;
	worth: number;
	day: number;
	me: boolean;
}

export interface Board {
	top: BoardRow[];
	me: BoardRow | null; // 自己的名次；没有榜单记录时为 null
	total: number; // 上榜人数
}

/** prev 是这名玩家上一条榜单记录：净资产（取整后）没变就沿用它的时间，「同分先达到的在前」才不会被普通动作打乱 */
export function boardEntry(state: PlayerState, now: number, prev?: unknown): BoardEntry {
	const worth = Math.round(netWorth(state));
	const old = cleanEntry(prev);
	const at = old && old.worth === worth && old.at <= now ? old.at : now;
	return { name: state.name, avatar: state.avatar, worth, day: dayOf(state.clock), at };
}

/** 存储里读出来的记录不可全信（旧版本、损坏）：字段不合法的整条丢掉 */
function cleanEntry(v: unknown): BoardEntry | null {
	if (!v || typeof v !== 'object') return null;
	const e = v as Record<string, unknown>;
	const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
	if (typeof e.name !== 'string' || typeof e.avatar !== 'string' || !finite(e.worth) || !finite(e.day) || !finite(e.at)) return null;
	return { name: e.name.slice(0, 24), avatar: e.avatar.slice(0, 8), worth: Math.round(e.worth as number), day: Math.max(0, Math.floor(e.day as number)), at: e.at as number };
}

/**
 * 排名：净资产高的在前；相同时先达到的在前；再相同按记录键排，保证结果稳定。
 * entries 是 [记录键, 记录] 列表，meKey 是请求者自己的记录键。
 */
export function rankBoard(entries: Iterable<[string, unknown]>, meKey: string, top = BOARD_TOP): Board {
	const list: [string, BoardEntry][] = [];
	for (const [k, v] of entries) {
		const e = cleanEntry(v);
		if (e) list.push([k, e]);
	}
	list.sort(([ka, a], [kb, b]) => b.worth - a.worth || a.at - b.at || (ka < kb ? -1 : ka > kb ? 1 : 0));
	const row = ([k, e]: [string, BoardEntry], i: number): BoardRow => ({ rank: i + 1, name: e.name, avatar: e.avatar, worth: e.worth, day: e.day, me: k === meKey });
	const mine = list.findIndex(([k]) => k === meKey);
	return { top: list.slice(0, top).map(row), me: mine >= 0 ? row(list[mine], mine) : null, total: list.length };
}
