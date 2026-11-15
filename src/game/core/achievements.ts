// 成就：由当前存档现算的里程碑，不进存档、不发奖励，所以不影响数值平衡。
// 纯函数：不读时钟、不用随机数。
import { level } from './attributes.ts';
import { getCareer, netWorth } from './engine.ts';
import type { PlayerState, Region } from './types.ts';
import { EXPERIENCES } from '../data/experiences.ts';
import { ACHIEVEMENTS } from '../data/achievements.ts';

export type AchievementMetric = 'places' | 'checkins' | 'collected' | 'friends' | 'besties' | 'home' | 'properties' | 'topJob' | 'worth' | 'level' | 'photos' | 'stormPhotos';

export interface AchievementDef {
	id: string;
	icon: string;
	name: string;
	desc: string;
	metric: AchievementMetric;
	/** 目标值；'all-places' / 'all-experiences' 表示「全部」，按区域和数据现算 */
	goal: number | 'all-places' | 'all-experiences';
}

export interface AchievementStatus {
	def: AchievementDef;
	cur: number; // 当前值（不超过目标）
	goal: number;
	done: boolean;
}

export const FRIEND_SCORE = 30; // 关系档「朋友」
export const BESTIE_SCORE = 90; // 关系档「挚友」

export function achievementMetric(state: PlayerState, region: Region, m: AchievementMetric): number {
	switch (m) {
		case 'places': return region.locations.filter((l) => state.visited[l.id]).length;
		case 'checkins': return state.checkins.length;
		case 'collected': return state.collected.filter((id) => EXPERIENCES.some((e) => e.id === id)).length;
		case 'friends': return Object.values(state.relations).filter((r) => r.score >= FRIEND_SCORE).length;
		case 'besties': return Object.values(state.relations).filter((r) => r.score >= BESTIE_SCORE).length;
		case 'home': return state.home ? 1 : 0;
		case 'properties': return state.properties.length;
		case 'topJob': {
			const c = state.job ? getCareer(state.job.career) : undefined;
			return c && state.job!.level >= c.levels.length - 1 ? 1 : 0;
		}
		case 'worth': return Math.max(0, Math.floor(netWorth(state)));
		case 'level': return level(state.respect).lv;
		case 'photos': return state.photos.length;
		case 'stormPhotos': return state.photos.filter((p) => p.endsWith('|storm')).length;
	}
}

function goalOf(def: AchievementDef, region: Region): number {
	if (def.goal === 'all-places') return region.locations.length;
	if (def.goal === 'all-experiences') return EXPERIENCES.length;
	return def.goal;
}

export function achievements(state: PlayerState, region: Region, defs: AchievementDef[] = ACHIEVEMENTS): AchievementStatus[] {
	return defs.map((def) => {
		const goal = Math.max(1, goalOf(def, region));
		const cur = Math.min(goal, achievementMetric(state, region, def.metric));
		return { def, cur, goal, done: cur >= goal };
	});
}

/** 两份存档之间新达成的成就（界面用来提示） */
export function newAchievements(before: PlayerState, after: PlayerState, region: Region): AchievementDef[] {
	const was = new Set(achievements(before, region).filter((a) => a.done).map((a) => a.def.id));
	return achievements(after, region).filter((a) => a.done && !was.has(a.def.id)).map((a) => a.def);
}
