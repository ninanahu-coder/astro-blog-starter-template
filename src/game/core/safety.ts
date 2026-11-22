// 屏蔽与举报（第 24 批，纯函数）：服务端在结算前后调用，界面用同一套文案。
// 玩家一律用在线状态里的 id 哈希前缀（12 位十六进制）标识，存档里不存别人的真实 id。
import type { PlayerState } from './types.ts';

export const HASH_RE = /^[a-f0-9]{12}$/;
/** 每人最多屏蔽多少人 */
export const BLOCK_MAX = 50;
/** 每人每个现实日最多举报几次 */
export const REPORTS_PER_DAY = 5;
/** 每个被举报的人最多留多少条举报记录 */
export const REPORT_KEEP = 50;
/** 最近 REPORT_WINDOW_DAYS 个现实日里有 REPORT_HIDE_BY 个不同的人举报，这个人的留言先自动隐藏，等人工处理（待平衡） */
export const REPORT_HIDE_BY = 3; // 待平衡
export const REPORT_WINDOW_DAYS = 7; // 待平衡
export const REPORT_QUOTE_MAX = 120;

export const REPORT_REASONS = {
	spam: '刷屏或打广告',
	harass: '骚扰、辱骂',
	contact: '发联系方式或要联系方式',
	offline: '约线下见面、打听住址',
	other: '其他',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export const isReportReason = (v: unknown): v is ReportReason => typeof v === 'string' && Object.hasOwn(REPORT_REASONS, v);

export interface BlockedPerson {
	name: string;
	avatar: string;
	/** 屏蔽时的现实日 */
	day: number;
}

export const isBlocked = (state: PlayerState, hash: string): boolean => Object.hasOwn(state.blocked ?? {}, hash);

/** 屏蔽一个人。返回新存档（不改入参），或不能屏蔽的原因 */
export function blockPlayer(state: PlayerState, p: { hash: string; name: string; avatar: string }, day: number, selfHash?: string): PlayerState | string {
	if (!HASH_RE.test(p.hash)) return '找不到这位玩家。';
	if (p.hash === selfHash) return '不能屏蔽自己。';
	const cur = state.blocked ?? {};
	if (Object.hasOwn(cur, p.hash)) return state;
	if (Object.keys(cur).length >= BLOCK_MAX) return `最多屏蔽 ${BLOCK_MAX} 人，先解除几个。`;
	return { ...state, blocked: { ...cur, [p.hash]: { name: p.name, avatar: p.avatar, day } } };
}

/** 解除屏蔽。返回新存档（不改入参） */
export function unblockPlayer(state: PlayerState, hash: string): PlayerState {
	if (!isBlocked(state, hash)) return state;
	const next = { ...state.blocked };
	delete next[hash];
	return { ...state, blocked: next };
}

export interface ReportRec {
	/** 举报人的 id 哈希前缀 */
	by: string;
	reason: ReportReason;
	/** 举报的是什么：在线频道的一句话、留言板的一条留言、或这个人本身（名字、送礼等） */
	ctx: 'chat' | 'note' | 'player';
	/** 现实日 */
	day: number;
	/** 被举报的原话（留言由服务端从留言板取；聊天不落盘，由举报人提交，只作参考） */
	quote: string;
}

/** 记一条举报：同一个人同一天对同一人只算一次。返回新列表（不改入参），或不能举报的原因 */
export function addReport(list: ReportRec[], rec: ReportRec): ReportRec[] | string {
	if (list.some((r) => r.by === rec.by && r.day === rec.day)) return '今天已经举报过这位玩家了，我们会处理。';
	const quote = String(rec.quote ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, REPORT_QUOTE_MAX);
	return [...list, { ...rec, quote }].slice(-REPORT_KEEP);
}

/** 最近有没有足够多的不同的人举报，需要先隐藏这个人的留言 */
export function reportHidden(list: ReportRec[] | undefined, today: number): boolean {
	if (!list?.length) return false;
	const by = new Set(list.filter((r) => r.day > today - REPORT_WINDOW_DAYS && r.day <= today).map((r) => r.by));
	return by.size >= REPORT_HIDE_BY;
}

/** 存档校验用：清洗屏蔽名单 */
export function cleanBlocked(raw: unknown, cleanName: (v: unknown) => string): Record<string, BlockedPerson> {
	const out: Record<string, BlockedPerson> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [k, v] of Object.entries(raw as Record<string, any>)) {
		if (Object.keys(out).length >= BLOCK_MAX) break;
		if (!HASH_RE.test(k) || !v || typeof v !== 'object') continue;
		const d = Number(v.day);
		out[k] = {
			name: cleanName(v.name) || '旅人',
			avatar: String(v.avatar ?? '🧑').replace(/[<>&"']/g, '').slice(0, 8) || '🧑',
			day: Number.isFinite(d) ? Math.min(1e7, Math.max(0, Math.floor(d))) : 0,
		};
	}
	return out;
}
