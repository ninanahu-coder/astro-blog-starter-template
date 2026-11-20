// 称号（第 28 批）：从片区收藏、成就、支线拿到，可以挑一个戴在名字旁边。只是外观，不影响任何检定和数值。
// 只看存档里已经记下的来源（areas、achClaimed、side.done），不现算条件：拿到了就不收回。
// 只引用数据表，不引用引擎，存档清洗（core/character.ts）也能用。
import { ACHIEVEMENTS } from '../data/achievements.ts';
import { AREAS } from '../data/experiences.ts';
import { SIDE_QUESTS } from '../data/quests.ts';
import type { PlayerState } from './types.ts';

export interface TitleDef {
	/** area.<片区 id> / ach.<成就 id> / side.<支线 id> */
	id: string;
	name: string;
	/** 怎么拿到的（界面显示） */
	from: string;
}

/** 游戏里所有可能拿到的称号 */
export function allTitles(): TitleDef[] {
	return [
		...Object.entries(AREAS).map(([id, a]) => ({ id: `area.${id}`, name: a.title, from: `集齐「${a.name}」的体验` })),
		...ACHIEVEMENTS.filter((d) => d.reward?.title).map((d) => ({ id: `ach.${d.id}`, name: d.name, from: `成就：${d.desc}` })),
		...SIDE_QUESTS.filter((q) => q.reward.title).map((q) => ({ id: `side.${q.id}`, name: q.reward.title!, from: `支线「${q.title}」` })),
	];
}

/** 这份存档已经拿到的称号 */
export function earnedTitles(state: Pick<PlayerState, 'areas' | 'achClaimed' | 'side'>): TitleDef[] {
	const got = new Set([
		...(state.areas ?? []).map((id) => `area.${id}`),
		...(state.achClaimed ?? []).map((id) => `ach.${id}`),
		...(state.side?.done ?? []).map((id) => `side.${id}`),
	]);
	return allTitles().filter((t) => got.has(t.id));
}

/** 佩戴的称号名；没戴或已不存在返回 '' */
export function wornTitle(state: Pick<PlayerState, 'areas' | 'achClaimed' | 'side' | 'title'>): string {
	if (!state.title) return '';
	return earnedTitles(state).find((t) => t.id === state.title)?.name ?? '';
}

export const TITLE_RE = /^(area|ach|side)\.[a-z0-9-]{1,40}$/;
