// 社区信誉、推荐信、志愿存档清洗：只依赖数据表的纯函数（engine.ts 和 character.ts 都要用，放在这里避免循环引用）。
// 设计见 docs/earth-game/volunteer.md。
import { VOL_RULES, VOL_TIERS, VOLUNTEER_GIGS } from '../data/volunteer.ts';
import type { PlayerState, VolunteerState } from './types.ts';

const GIG_IDS = new Set<string>(VOLUNTEER_GIGS.map((g) => g.id));

export const emptyVolunteer = (): VolunteerState => ({ day: -1, today: [], n: {}, refs: [], real: { day: -1, n: 0 } });

/** 志愿总次数 */
export function volShifts(v: Pick<VolunteerState, 'n'>): number {
	let sum = 0;
	for (const k of Object.keys(v.n)) sum += v.n[k];
	return sum;
}

/** 社区信誉等级（0 起）、称号、总次数、下一档要几次（满档为 null） */
export function volTier(state: Pick<PlayerState, 'volunteer'>): { lv: number; name: string; shifts: number; next: number | null } {
	const shifts = volShifts(state.volunteer);
	let lv = 0;
	while (lv + 1 < VOL_TIERS.length && shifts >= VOL_TIERS[lv + 1].at) lv++;
	return { lv, name: VOL_TIERS[lv].name, shifts, next: VOL_TIERS[lv + 1]?.at ?? null };
}

/** 推荐信在职业声望门槛上能抵多少（封数封顶 refMax） */
export const refRespect = (state: Pick<PlayerState, 'volunteer'>): number =>
	Math.min(state.volunteer.refs.length, VOL_RULES.refMax) * VOL_RULES.refRespect;

/**
 * 清洗存档里的志愿记录（save-sync.md §5.1）：旧存档没有 → 空记录；任何坏值不抛异常；只留已知志愿 id；幂等。
 * clock 是已清洗的游戏时钟：day 不能晚于今天；today 只在 day 是今天时有意义，最多 dailyMax 个。
 * realToday 是服务端的现实日（不知道时不传）：记录的现实日在未来 → 当作今天、次数照留，不然要等到那天才能再做。
 */
export function cleanVolunteer(raw: unknown, clock: number, realToday?: number): VolunteerState {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const today = Math.floor(clock / 1440);
	const d = typeof r.day === 'number' && Number.isFinite(r.day) ? Math.floor(r.day) : -1;
	const day = d >= 0 && d <= today ? d : -1;
	const ids = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && GIG_IDS.has(x)))].slice(0, max) : []);
	const n: Record<string, number> = {};
	const rn = r.n && typeof r.n === 'object' && !Array.isArray(r.n) ? (r.n as Record<string, unknown>) : {};
	for (const id of GIG_IDS) {
		const c = Object.hasOwn(rn, id) ? rn[id] : undefined;
		if (typeof c === 'number' && Number.isFinite(c) && c >= 1) n[id] = Math.min(1e6, Math.floor(c));
	}
	const rr = r.real && typeof r.real === 'object' && !Array.isArray(r.real) ? (r.real as Record<string, unknown>) : {};
	const rd = typeof rr.day === 'number' && Number.isFinite(rr.day) && rr.day >= 0 ? Math.min(1e7, Math.floor(rr.day)) : -1;
	const realN = typeof rr.n === 'number' && Number.isFinite(rr.n) ? Math.max(0, Math.min(VOL_RULES.realDayMax, Math.floor(rr.n))) : 0;
	const real = rd === -1 ? { day: -1, n: 0 } : { day: realToday !== undefined && rd > realToday ? realToday : rd, n: realN };
	return { day, today: day === -1 ? [] : ids(r.today, VOL_RULES.dailyMax), n, refs: ids(r.refs, GIG_IDS.size), real };
}
