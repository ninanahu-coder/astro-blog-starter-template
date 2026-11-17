// 离线排队（第 33 轮）：断网时点的动作先记在本机，联网后按顺序交给服务器结算。服务器仍然是唯一裁判：
// 补交时每个动作照常用最新存档版本提交，哪个没通过（钱不够、出了事件要先处理、时间不对……）就停下，后面的全部取消并告诉玩家。
// 只排「自己一个人、不看真实位置和真实时间、不是大笔买卖」的动作；看真实位置的、跟别的玩家有关的、买房买车这类大决定不排。

import { parseAction, type GameAction } from '../core/actions.ts';

export const QUEUE_KEY = 'earth.queue.v1';
/** 最多排几个：断网时连点一串，补交时前面一个失败后面全取消，排太多没意义 */
export const QUEUE_MAX = 5;
/** 排队超过这么久（现实时间）就不再补交：一天前点的事，现在的情况多半已经变了 */
export const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
/** 现实时间戳允许比现在超前这么多（手机时钟不准） */
const FUTURE_SLACK_MS = 60_000;
const LABEL_MAX = 40;

/** 动作编号：发出前生成，排队时一起存下，重交沿用同一个（服务器按它去重，见 world.ts 的 act） */
export interface Queued { act: GameAction; at: number; label: string; op: string }
/** 动作编号的格式（和服务器一致） */
export const isOpId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);
/** 生成动作编号：16 位十六进制。bytes 由页面用 crypto.getRandomValues 给 */
export const opId = (bytes: Uint8Array) => [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 能不能排队 */
export function queueable(a: GameAction): boolean {
	switch (a.t) {
		case 'activity':
		case 'use':
		case 'travel':
		case 'fish':
		case 'photo':
			return true;
		case 'home':
			return a.op === 'sleep' || a.op === 'cook' || a.op === 'relax';
		case 'job':
			return a.op === 'work';
		case 'npc':
			return a.act === 'chat' || a.act === 'help';
		default:
			return false; // gps / venue 看真实位置；event 要先看服务器出了什么事件；买卖、租房、课程等大决定要在线确认
	}
}

/** 名字查表（页面传进来：活动、地点、物品、NPC 的显示名） */
export interface Names { activity(id: string): string | undefined; loc(id: string): string | undefined; item(id: string): string | undefined; npc(id: string): string | undefined }

/** 排队列表里显示的一句话 */
export function actLabel(a: GameAction, n: Names): string {
	switch (a.t) {
		case 'activity': return n.activity(a.id) ?? '做一件事';
		case 'use': return `用${n.item(a.item) ?? '物品'}`;
		case 'travel': return `去${n.loc(a.to) ?? '别处'}`;
		case 'fish': return '钓鱼';
		case 'photo': return '拍照';
		case 'home': return ({ sleep: '在家睡觉', cook: '在家做饭', relax: '在家休息' } as Record<string, string>)[a.op] ?? '在家';
		case 'job': return '上班';
		case 'npc': return `${a.act === 'help' ? '帮' : '找'}${n.npc(a.npc) ?? '熟人'}${a.act === 'help' ? '个忙' : '聊天'}`;
		default: return '动作';
	}
}

/** 加一个；排满或这个动作不能排时返回 null（原列表不变） */
export function enqueue(q: Queued[], a: GameAction, label: string, now: number, op: string): Queued[] | null {
	if (!queueable(a) || q.length >= QUEUE_MAX || !isOpId(op)) return null;
	return [...q, { act: a, at: now, label: label.slice(0, LABEL_MAX), op }];
}

/**
 * 从本机存储读出排队列表（不可信）：必须是这个角色的；每个动作重新过一遍网络输入校验和排队白名单；
 * 时间戳在未来或已经过期的丢掉。expired 是因为过期丢掉的个数（要告诉玩家）。
 */
export function parseQueue(raw: string | null, id: string, now: number): { items: Queued[]; expired: number } {
	let o: unknown = null;
	try { o = raw ? JSON.parse(raw) : null; } catch {}
	if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.hasOwn(o, 'id') || (o as { id: unknown }).id !== id) return { items: [], expired: 0 };
	const list = Object.hasOwn(o, 'items') ? (o as { items: unknown }).items : null;
	if (!Array.isArray(list)) return { items: [], expired: 0 };
	const items: Queued[] = [];
	let expired = 0;
	// 最多看前 50 条（坏数据再长也不多花时间），留下前 5 个合法的
	for (const it of list.slice(0, 50)) {
		if (items.length >= QUEUE_MAX) break;
		if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
		const own = (k: string) => (Object.hasOwn(it, k) ? (it as Record<string, unknown>)[k] : undefined);
		const act = parseAction(own('act'));
		const at = own('at');
		const label = own('label');
		const op = own('op');
		if (!act || !queueable(act) || !isOpId(op) || typeof at !== 'number' || !Number.isFinite(at) || at > now + FUTURE_SLACK_MS) continue;
		if (now - at > QUEUE_TTL_MS) { expired++; continue; }
		items.push({ act, at, label: typeof label === 'string' && label ? label.slice(0, LABEL_MAX) : '动作', op });
	}
	return { items, expired };
}

export const queueJson = (id: string, items: Queued[]) => JSON.stringify({ id, items });

/** 补交结束后的一句话：交了几个；哪个没通过、为什么；后面取消了几个 */
export function flushSummary(r: { done: number; failed?: { label: string; msg: string }; cancelled: number; expired: number }): string {
	const parts: string[] = [];
	if (r.done) parts.push(`补交了 ${r.done} 个排队的动作`);
	if (r.failed) parts.push(`「${r.failed.label}」没成功：${r.failed.msg || '服务器没通过'}`);
	if (r.cancelled) parts.push(`后面 ${r.cancelled} 个已取消`);
	if (r.expired) parts.push(`${r.expired} 个排队超过一天，已取消`);
	return parts.join('；');
}
