// 新手引导进度（v36）：纯函数。进度存在存档的 onboard 字段里，跟着存档走、换设备也一样。
// 判定条件和文案在 data/onboard.ts；这里只算「现在该显示什么」和「动作之后记下什么」。
import type { ChangelogEntry } from '../data/changelog.ts';
import { FEATURES, MARKS, RETURN_DAYS, RETURN_SHOW_DAYS, TIPS, type FeatureDef, type OnboardPage, type TipDef } from '../data/onboard.ts';
import { STORY } from '../data/story.ts';
import type { ActionResult, PlayerState } from './types.ts';

export type Onboard = PlayerState['onboard'];

const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
const TIP_IDS = new Set<string>([...TIPS.map((t) => t.id), ...FEATURES.map((f) => 'feat:' + f.id), ...MARKS]);

/** 新角色的引导进度：什么都没解开、什么提示都没关 */
export const freshOnboard = (): Onboard => ({ feats: [], tips: [], back: null, off: false });

/**
 * 迁移约定（假设，等存档同步分支的 PlayerState 迁移规范出来后对齐）：
 * 存档里没有 onboard 字段 = 这个功能上线前建的老角色：全部功能直接解开、所有提示当作看过，不给老玩家补新手引导。
 * 新角色由 createCharacter 写入 freshOnboard()。
 */
export const veteranOnboard = (): Onboard => ({
	feats: FEATURES.map((f) => f.id),
	tips: [...TIPS.map((t) => t.id), ...FEATURES.map((f) => 'feat:' + f.id)],
	back: null,
	off: false,
});

const idList = (v: unknown, known: Set<string>): string[] =>
	Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))] : [];
const int = (v: unknown, lo: number, hi: number): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null;

/**
 * 校验不可信的 onboard 字段（来自网络或 localStorage）。只留已知的 id、去重；回流记录不合法就丢掉。
 * today 是可信的现实日（服务端传）：记在未来的回流当坏数据。
 */
export function cleanOnboard(raw: unknown, today?: number): Onboard {
	if (raw === undefined) return veteranOnboard();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return freshOnboard();
	const r = raw as Record<string, unknown>;
	const b = r.back as Record<string, unknown> | null | undefined;
	const day = b && typeof b === 'object' ? int(b.day, 0, 1e7) : null;
	const gap = b && typeof b === 'object' ? int(b.gap, RETURN_DAYS, 1e7) : null;
	const back = day !== null && gap !== null && (today === undefined || day <= today) ? { day, gap, seen: (b as Record<string, unknown>).seen === true } : null;
	return { feats: idList(r.feats, FEATURE_IDS), tips: idList(r.tips, TIP_IDS), back, off: r.off === true };
}

/** 现在已经解开的功能：存档里记下的，加上条件已经满足、还没来得及记的 */
export function unlocked(s: PlayerState): Set<string> {
	const out = new Set(s.onboard.feats);
	for (const f of FEATURES) if (f.when(s)) out.add(f.id);
	return out;
}

/** 这张卡现在显示不显示：关了全部引导（老手）就不再藏任何东西 */
export const featureShown = (s: PlayerState, id: string): boolean => s.onboard.off || unlocked(s).has(id);

/** 还没解开的功能（今天页底部的「之后会出现」清单）；关了全部引导时为空 */
export const lockedFeatures = (s: PlayerState): FeatureDef[] => {
	if (s.onboard.off) return [];
	const u = unlocked(s);
	return FEATURES.filter((f) => !u.has(f.id));
};

/**
 * 成功的动作之后调用：把条件已满足的功能记进存档（只增不减）。原地修改 after，返回这次新解开的功能。
 * 和主线、心愿一样由服务端在 applyAction 里结算，客户端不能直接写。
 */
export function settleOnboard(after: PlayerState): FeatureDef[] {
	const have = new Set(after.onboard.feats);
	const got = FEATURES.filter((f) => !have.has(f.id) && f.when(after));
	if (got.length) after.onboard = { ...after.onboard, feats: [...after.onboard.feats, ...got.map((f) => f.id)] };
	return got;
}

/** 某一页现在该显示的提示：每页最多一条；关掉过、或玩家关了全部引导就不显示 */
export function tipFor(s: PlayerState, page: OnboardPage): TipDef | null {
	if (s.onboard.off) return null;
	return TIPS.find((t) => t.page === page && !s.onboard.tips.includes(t.id)) ?? null;
}

/** 今天页上「新解开」的提示：已解开但还没被关掉的功能，一次只给一条 */
export function newFeature(s: PlayerState): FeatureDef | null {
	if (s.onboard.off) return null;
	const u = unlocked(s);
	return FEATURES.find((f) => u.has(f.id) && !s.onboard.tips.includes('feat:' + f.id)) ?? null;
}

/**
 * 回流：服务端在这一天第一次读取存档、发每日奖励之前调用（prev.daily.day 还是上次来的日子）。
 * 离开 RETURN_DAYS 天以上就记下这次回来；没离开那么久返回原对象。从没领过每日奖励（day 0）不算。
 */
export function noteReturn(prev: PlayerState, realDay: number): PlayerState {
	const last = prev.daily.day;
	if (!Number.isInteger(realDay) || last <= 0 || realDay - last < RETURN_DAYS) return prev;
	return { ...prev, onboard: { ...prev.onboard, back: { day: realDay, gap: realDay - last, seen: false } } };
}

/** 现实日序号 → 'YYYY-MM-DD'（和 realDayOf 同一个时区，跟更新日志的日期比较用） */
export const realDate = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

export interface ReturnView {
	gap: number; // 离开了几天
	story: { title: string; step: string } | null; // 主线停在哪一步
	news: ChangelogEntry[]; // 离开期间的更新（最多 3 条，新的在前）
	low: boolean; // 有需求低于 30：先补一补
}

/**
 * 回流卡片：回来的那天和第二天显示（today 是现实日，取存档里的 daily.day 即可），点「知道了」后不再显示。
 * 玩家关了全部引导也照样显示：这不是教学，是「离开期间发生了什么」。
 * changelog 由调用方传入：更新日志按需加载、不进首屏（第 41 批），没加载到时传空数组，卡片照常显示、只是不列更新。
 */
export function returnView(s: PlayerState, today: number, changelog: readonly ChangelogEntry[] = []): ReturnView | null {
	const b = s.onboard.back;
	if (!b || b.seen || today - b.day >= RETURN_SHOW_DAYS || today < b.day) return null;
	const left = realDate(b.day - b.gap);
	const ch = STORY[s.story.ch];
	const step = ch?.steps.find((x) => (s.story.done[x.id] ?? 0) < (x.n ?? 1));
	return {
		gap: b.gap,
		story: ch && step ? { title: ch.title, step: step.text } : null,
		news: changelog.filter((e) => e.date > left).slice(0, 3),
		low: Object.values(s.needs).some((v) => v < 30),
	};
}

/** 引导动作：关掉一条提示 / 记下一个里程碑、关掉或重新打开全部引导、看过回流卡片、跳过渐进解开（全部显示） */
export type OnboardOp = { op: 'tip'; id: string } | { op: 'off' | 'on' | 'back' | 'all' };

export function parseOnboardOp(a: Record<string, unknown>): OnboardOp | null {
	if (a.op === 'tip') return typeof a.id === 'string' && TIP_IDS.has(a.id) ? { op: 'tip', id: a.id } : null;
	return a.op === 'off' || a.op === 'on' || a.op === 'back' || a.op === 'all' ? { op: a.op } : null;
}

/**
 * 执行引导动作：不花游戏时间、不受待处理事件限制，不算心愿和主线。没有变化时 ok 但返回原对象（不加版本号）。
 * 不修改入参。
 */
export function applyOnboard(s: PlayerState, a: OnboardOp): ActionResult {
	const ob = s.onboard;
	let next: Onboard = ob;
	if (a.op === 'tip' && !ob.tips.includes(a.id)) next = { ...ob, tips: [...ob.tips, a.id] };
	else if (a.op === 'off' && !ob.off) next = { ...ob, off: true };
	else if (a.op === 'on' && (ob.off || ob.tips.some((t) => TIPS.some((x) => x.id === t)))) next = { ...ob, off: false, tips: ob.tips.filter((t) => !TIPS.some((x) => x.id === t)) }; // 重新打开：页面提示再看一遍，里程碑和「新解开」不重放
	else if (a.op === 'back' && ob.back && !ob.back.seen) next = { ...ob, back: { ...ob.back, seen: true } };
	else if (a.op === 'all') {
		const feats = [...ob.feats, ...FEATURES.map((f) => f.id).filter((id) => !ob.feats.includes(id))];
		const tips = [...ob.tips, ...FEATURES.map((f) => 'feat:' + f.id).filter((id) => !ob.tips.includes(id))];
		if (feats.length !== ob.feats.length || tips.length !== ob.tips.length) next = { ...ob, feats, tips };
	}
	if (next === ob) return { ok: true, state: s, msg: '' };
	return { ok: true, state: { ...s, onboard: next }, msg: '' };
}
