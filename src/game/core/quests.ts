// 任务和成就（第 28 批）：支线结算、成就领奖、佩戴称号、任务总览。纯函数：不读时钟、不用随机数。
// 所有会改存档的入口（settleSide、claimAchievement、wearTitle）只由服务端经 applyAction 调用，
// 领没领过记在存档里，和存档同一次写入，所以换设备、重交同一个动作都不会重复发奖。
import { SIDE_QUESTS, type SideQuest } from '../data/quests.ts';
import { STORY } from '../data/story.ts';
import { PHOTO_QUESTS } from '../data/photo-quests.ts';
import { EXPERIENCES, AREAS } from '../data/experiences.ts';
import { FISH } from '../data/fish.ts';
import { ANIMALS } from '../data/wildlife.ts';
import { WISHES_PER_DAY } from '../data/wishes.ts';
import type { GameAction } from './actions.ts';
import { achievements, achReward } from './achievements.ts';
import { addLog, addMoodlet, clone, dexProgress } from './engine.ts';
import { advanceSteps, checkMet, stepNeed, stepsDone } from './steps.ts';
import { storyProgress } from './story.ts';
import { earnedTitles } from './titles.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

export const getSide = (id: string): SideQuest | undefined => SIDE_QUESTS.find((q) => q.id === id);

const unlocked = (state: PlayerState, q: SideQuest) => q.unlock.every((c) => checkMet(state, c));

function rewardText(r: { cash?: number; respect?: number; title?: string; rel?: { npc: string; n: number } }, npcName?: string): string {
	const parts: string[] = [];
	if (r.cash) parts.push(`$${r.cash}`);
	if (r.respect) parts.push(`声望 +${r.respect}`);
	if (r.rel) parts.push(`${npcName ?? '对方'}好感 +${r.rel.n}`);
	if (r.title) parts.push(`称号「${r.title}」`);
	return parts.join('，');
}

/**
 * 成功的动作之后调用（途中晕倒不算）：推进已解锁的支线，做完的发奖励。原地修改 after，返回提示文字。
 * 动作只算进动作之前就已解锁的支线：这次动作刚让支线解锁，就不把它再算成支线的第一步。
 */
export function settleSide(before: PlayerState, after: PlayerState, a: GameAction, quests: SideQuest[] = SIDE_QUESTS): string[] {
	const notes: string[] = [];
	for (const q of quests) {
		if (after.side.done.includes(q.id) || !unlocked(after, q)) continue;
		const wasOpen = unlocked(before, q) && !before.side.done.includes(q.id);
		const prev = after.side.cur[q.id] ?? {};
		const cur = advanceSteps(q.steps, prev, before, after, a, wasOpen);
		if (!stepsDone(q.steps, cur)) {
			if (!after.side.cur[q.id] || JSON.stringify(cur) !== JSON.stringify(prev)) after.side = { ...after.side, cur: { ...after.side.cur, [q.id]: cur } };
			continue;
		}
		// 做完：记下完成、清掉进度、发奖励（同一份存档里，不会重复发）
		const { [q.id]: _, ...rest } = after.side.cur;
		after.side = { done: [...after.side.done, q.id], cur: rest };
		const r = q.reward;
		if (r.cash) after.cash = Math.round(after.cash + r.cash);
		if (r.respect) after.respect += r.respect;
		if (r.moodlet) addMoodlet(after, r.moodlet);
		const rel = r.rel ? after.relations[r.rel.npc] : undefined;
		if (r.rel && rel) after.relations = { ...after.relations, [r.rel.npc]: { ...rel, score: Math.max(-100, Math.min(100, rel.score + r.rel.n)) } };
		const got = rewardText({ ...r, rel: rel ? r.rel : undefined });
		addLog(after, `🧩 支线「${q.title}」完成：${q.outro}${got ? `（${got}）` : ''}`);
		notes.push(`支线「${q.title}」完成`);
	}
	return notes;
}

/** 领成就奖励：达成了、没领过才发（调用方负责版本号加一和钳制，见 actions.ts） */
export function claimAchievement(prev: PlayerState, region: Region, id: string): ActionResult {
	const st = achievements(prev, region).find((x) => x.def.id === id);
	if (!st) return { ok: false, state: prev, msg: '没有这个成就。' };
	if (st.claimed) return { ok: false, state: prev, msg: '这个成就的奖励已经领过了。' };
	if (!st.done) return { ok: false, state: prev, msg: `还没达成：${st.cur.toLocaleString()}/${st.goal.toLocaleString()}。` };
	const r = achReward(st.def);
	const state = clone(prev);
	state.achClaimed = [...state.achClaimed, id];
	if (r.cash) state.cash = Math.round(state.cash + r.cash);
	if (r.respect) state.respect += r.respect;
	const got = rewardText({ cash: r.cash, respect: r.respect, title: r.title ? st.def.name : undefined });
	const msg = `${st.def.icon} 成就「${st.def.name}」领奖${got ? `：${got}` : ''}。`;
	addLog(state, msg);
	return { ok: true, state, msg };
}

/** 佩戴称号；id 为 '' 时摘下 */
export function wearTitle(prev: PlayerState, id: string): ActionResult {
	if (id === prev.title) return { ok: false, state: prev, msg: id ? '已经戴着这个称号了。' : '现在没戴称号。' };
	const t = id ? earnedTitles(prev).find((x) => x.id === id) : undefined;
	if (id && !t) return { ok: false, state: prev, msg: '还没拿到这个称号。' };
	const state = clone(prev);
	state.title = id;
	return { ok: true, state, msg: t ? `戴上了称号「${t.name}」。` : '摘下了称号。' };
}

// ---------- 任务总览（界面用，只读） ----------
export type QuestKind = 'main' | 'side' | 'daily' | 'collect' | 'ach';

export interface QuestItem {
	kind: QuestKind;
	id: string;
	icon: string;
	title: string;
	/** 一句说明：下一步做什么、怎么解锁 */
	sub: string;
	got: number;
	need: number;
	/** 可以点「领取」（只有成就需要手动领，其他做完自动发） */
	claimable?: boolean;
	/** 还没解锁 */
	locked?: boolean;
	reward?: string;
}

/** 当前要做的事，按 主线 → 支线 → 今天 → 收集 → 成就 排好。全服周目标要服务端的全服计数，不在这里 */
export function questBoard(state: PlayerState, region: Region, npcName: (id: string) => string = (id) => id): QuestItem[] {
	const items: QuestItem[] = [];
	const sp = storyProgress(state);
	if (sp) {
		const left = sp.steps.find((x) => x.got < x.need);
		items.push({
			kind: 'main', id: sp.chapter.id, icon: '📖', title: sp.chapter.title,
			sub: left ? `下一步：${left.step.text}${left.need > 1 ? `（${left.got}/${left.need}）` : ''}` : '马上完成',
			got: sp.steps.filter((x) => x.got >= x.need).length, need: sp.steps.length,
			reward: rewardText(sp.chapter.reward),
		});
	} else items.push({ kind: 'main', id: 'story-end', icon: '📖', title: '主线已全部写完', sub: `共 ${STORY.length} 章，新章节还在写`, got: 1, need: 1 });
	for (const q of SIDE_QUESTS) {
		if (state.side.done.includes(q.id)) continue;
		const who = q.npc ? npcName(q.npc) : undefined;
		const reward = rewardText(q.reward, who);
		if (!unlocked(state, q)) {
			items.push({ kind: 'side', id: q.id, icon: q.icon, title: q.title, sub: `解锁：${q.hint}`, got: 0, need: q.steps.length, locked: true, reward });
			continue;
		}
		const cur = state.side.cur[q.id] ?? {};
		const steps = q.steps.map((s) => ({ s, got: Math.min(stepNeed(s), s.state && checkMet(state, s.state) ? stepNeed(s) : cur[s.id] ?? 0) }));
		const left = steps.find((x) => x.got < stepNeed(x.s));
		items.push({
			kind: 'side', id: q.id, icon: q.icon, title: q.title,
			sub: left ? `下一步：${left.s.text}${stepNeed(left.s) > 1 ? `（${left.got}/${stepNeed(left.s)}）` : ''}` : '马上完成',
			got: steps.filter((x) => x.got >= stepNeed(x.s)).length, need: q.steps.length, reward,
		});
	}
	items.push({ kind: 'daily', id: 'wishes', icon: '✨', title: '今天的心愿', sub: state.wishes.length ? `还有 ${state.wishes.length} 个没完成，过了今天换新` : '今天的都完成了，明天换新', got: WISHES_PER_DAY - Math.min(WISHES_PER_DAY, state.wishes.length), need: WISHES_PER_DAY });
	const pq = PHOTO_QUESTS[state.photoQuest];
	items.push({ kind: 'collect', id: 'photo-quest', icon: '📷', title: '摄影任务', sub: pq ? `下一张：${pq.title}——${pq.hint}` : '全部拍完了', got: state.photoQuest, need: PHOTO_QUESTS.length });
	const dex = dexProgress(state);
	items.push({ kind: 'collect', id: 'dex', icon: '🔭', title: '野生动物图鉴', sub: dex.map((g) => `${g.name} ${g.got}/${g.total}${g.done ? '✅' : ''}`).join(' · '), got: state.dex.length, need: ANIMALS.length });
	items.push({ kind: 'collect', id: 'fish', icon: '🎣', title: '鱼获', sub: '带鱼竿去海边、码头、河边', got: Object.keys(state.fish).length, need: FISH.length });
	const areaLeft = Object.entries(AREAS).filter(([id]) => !state.areas.includes(id)).length;
	items.push({ kind: 'collect', id: 'album', icon: '🎟️', title: '收藏册', sub: areaLeft ? `还有 ${areaLeft} 个片区的称号没拿到` : '每个片区的称号都拿到了', got: state.collected.length, need: EXPERIENCES.length });
	const ach = achievements(state, region);
	const ready = ach.filter((x) => x.done && !x.claimed);
	items.push({ kind: 'ach', id: 'achievements', icon: '🏆', title: '成就', sub: ready.length ? `有 ${ready.length} 个成就可以领奖` : '达成后来这里领奖', got: ach.filter((x) => x.done).length, need: ach.length, claimable: ready.length > 0 });
	return items;
}
