// 志愿活动：列出这里能做的志愿、做一次志愿（纯函数，不改入参）。数据见 data/volunteer.ts，设计见 docs/earth-game/volunteer.md。
import { VOL_RULES, VOL_TIERS, VOLUNTEER_GIGS, VOLUNTEER_ORGS, type AreaId, type VolunteerGig, type VolunteerOrg } from '../data/volunteer.ts';
import { areaOf } from '../data/areas-base.ts';
import { NPCS } from '../data/npcs.ts';
import { addMoodlet, applyEffect, clone, collapsedResult, fail, festivalsNow, getLocation, getRelation, log, npcPresent, unlockStories } from './engine.ts';
import { volTier } from './respect.ts';
import { dayOf, hoursLabel, isOpen } from './time.ts';
import type { ActionResult, GameLocation, PlayerState, Region } from './types.ts';

export interface VolunteerOffer {
	gig: VolunteerGig;
	org?: VolunteerOrg; // 现实里做这件事的组织（这个区域有才给）
	count: number; // 做过几次
	letter: boolean; // 已拿到这项的推荐信
	blocked?: string;
}

/** 志愿活动在不在这个地点（节日志愿另看今天这里有没有节日） */
export function gigAt(gig: VolunteerGig, loc: GameLocation, clock: number): boolean {
	if (gig.festival) return festivalsNow(clock).some((f) => f.loc === loc.id);
	return !!(gig.locs?.includes(loc.id) || gig.kinds?.includes(loc.kind) || gig.tags?.some((t) => loc.tags.includes(t)));
}

const orgOf = (gig: VolunteerGig, locId: string): VolunteerOrg | undefined => {
	const area = areaOf(locId)?.id as AreaId | undefined;
	const id = area ? gig.orgs[area] : undefined;
	return id ? VOLUNTEER_ORGS.find((o) => o.id === id) : undefined;
};

/** 今天做过的志愿（跨日就是空的） */
const doneToday = (state: PlayerState): string[] => (state.volunteer.day === dayOf(state.clock) ? state.volunteer.today : []);

function blockedReason(state: PlayerState, gig: VolunteerGig): string | undefined {
	const today = doneToday(state);
	if (today.includes(gig.id)) return '今天已经做过这项了';
	if (today.length >= VOL_RULES.dailyMax) return `每天最多做 ${VOL_RULES.dailyMax} 次志愿，明天再来`;
	if (!isOpen(gig.hours, state.clock)) return `${hoursLabel(gig.hours)} 才有人组织`;
	const tier = volTier(state);
	if (gig.minTier && tier.lv < gig.minTier) return `社区信誉要到第 ${gig.minTier + 1} 档（再做 ${Math.max(0, (VOL_TIERS[gig.minTier]?.at ?? 0) - tier.shifts)} 次别的志愿）`;
	if (state.needs.energy < VOL_RULES.minEnergy) return '太累了，先歇一歇';
	return undefined;
}

/** 这个地点现在列出的志愿活动（不能做的带原因） */
export function volunteerAt(state: PlayerState, region: Region): VolunteerOffer[] {
	const loc = getLocation(region, state.loc);
	if (!loc) return [];
	return VOLUNTEER_GIGS.filter((g) => gigAt(g, loc, state.clock)).map((gig) => ({
		gig,
		org: orgOf(gig, loc.id),
		count: state.volunteer.n[gig.id] ?? 0,
		letter: state.volunteer.refs.includes(gig.id),
		blocked: blockedReason(state, gig),
	}));
}

/**
 * 做一次志愿：花时间和精力，涨需求、能力和声望；计入今天的次数（防刷：每天 dailyMax 次、每种一次）。
 * 同一种做满 refShifts 次拿到推荐信；一起做的 NPC 在场时关系加一点，可能触发 TA 的剧情。
 */
export function doVolunteer(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const loc = getLocation(region, prev.loc);
	const gig = VOLUNTEER_GIGS.find((g) => g.id === id);
	if (!loc || !gig || !gigAt(gig, loc, prev.clock)) return fail(prev, '这里现在没有这项志愿活动。');
	const blocked = blockedReason(prev, gig);
	if (blocked) return fail(prev, blocked);
	const state = clone(prev);
	const day = dayOf(state.clock);
	// 先记次数再结算效果：途中晕倒也算去过（防止「晕倒不记次数」反复刷），但晕倒不发声望
	const v = state.volunteer;
	if (v.day !== day) {
		v.day = day;
		v.today = [];
	}
	v.today.push(gig.id);
	v.n[gig.id] = (v.n[gig.id] ?? 0) + 1;
	const npcsHere = (gig.npcs ?? []).map((nid) => NPCS.find((n) => n.id === nid)).filter((n) => n && npcPresent(n, loc.id, prev.clock));
	if (applyEffect(state, { ...gig.fx, minutes: gig.minutes, respect: gig.respect }, region)) return collapsedResult(state);
	addMoodlet(state, 'good-time');
	const org = orgOf(gig, loc.id);
	let msg = `${gig.icon} 在${loc.name}做了${gig.name}志愿，声望 +${gig.respect}。`;
	for (const npc of npcsHere) {
		const rel = structuredClone(getRelation(state, npc!.id));
		rel.score = Math.min(100, rel.score + VOL_RULES.npcGain);
		state.relations[npc!.id] = rel;
		msg += ` ${npc!.name}也在，和你一起忙完（关系 +${VOL_RULES.npcGain}）。`;
		const stories = unlockStories(state, region, npc!, rel);
		if (stories.length) msg += ' ' + stories.join(' ');
	}
	if (v.n[gig.id] >= VOL_RULES.refShifts && !v.refs.includes(gig.id)) {
		v.refs.push(gig.id);
		msg += ` 做满 ${VOL_RULES.refShifts} 次，负责人给你写了一封推荐信${org ? `（参照${org.name}的做法）` : ''}，以后应聘、升职看声望时能抵一部分。`;
	}
	const before = volTier(prev);
	const after = volTier(state);
	if (after.lv > before.lv) msg += ` 社区信誉升到「${after.name}」。`;
	log(state, msg);
	return { ok: true, state, msg };
}
