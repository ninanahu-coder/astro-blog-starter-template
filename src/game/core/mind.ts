// 心事与低谷期（第 43 批，设计见 docs/earth-game/mood.md）：纯函数，数值全在 data/mind.ts。
// 每个游戏日结算一次（动作结束时发现跨过了午夜）：
//   孤独、思乡、压力三种心事各算一个 0–1 左右的分数，到了门槛就给对应的负面心情状态（24 小时）；
//   生效中有能缓解它的状态（relieves）就不触发。再记下连续几天心情低落，用于界面提示。
import { HELP_LINES, MIND, MIND_ACTS, MIND_KEYS, MIND_SIGNALS, PRESSURE_AT, PRESSURES, type MindKey, type MindOp, type PressureDef } from '../data/mind.ts';
import { MOODLETS } from '../data/moodlets.ts';
import { TRAITS } from '../data/traits.ts';
import { activeMoodlets, mood, weeklyCosts } from './attributes.ts';
import { addLog, addMoodlet, applyEffect, clone, collapsedResult, fail } from './engine.ts';
import { dayOf } from './time.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 特质对某种心事的倍率，连乘 */
export function mindMult(state: PlayerState, k: MindKey): number {
	return state.traits.reduce((acc, id) => acc * (TRAITS.find((t) => t.id === id)?.mods.mind?.[k] ?? 1), 1);
}

/** 「朋友」以上的 NPC 数，最多算 friendCap 位 */
export function friendCount(state: PlayerState): number {
	return Math.min(MIND.friendCap, Object.values(state.relations).filter((r) => r.score >= MIND.friendScore).length);
}

/** 到达第 day 天的思乡曲线系数 */
export function homesickCurve(day: number): number {
	let k: number = MIND.homesickCurve[0].k;
	for (const c of MIND.homesickCurve) if (day >= c.from) k = c.k;
	return k;
}

/** 现在满足的压力来源 */
export function pressureSources(state: PlayerState): PressureDef[] {
	const due = weeklyCosts(state).total;
	const hit: Record<PressureDef['id'], boolean> = {
		rent: state.cash < due, // 没有每周开销时 due = 0，现金不会是负数
		broke: state.cash < PRESSURE_AT.broke,
		unwell: state.health < PRESSURE_AT.unwell,
		heat: state.heat >= PRESSURE_AT.heat,
		exhausted: state.needs.energy < PRESSURE_AT.exhausted,
	};
	return PRESSURES.filter((p) => hit[p.id]);
}

/** 三种心事的分数（未钳到门槛，界面和测试用） */
export function mindScores(state: PlayerState): Record<MindKey, number> {
	const friends = friendCount(state) * MIND.friendRelief;
	const lonely = clamp((MIND.lonelySocial - state.needs.social) / MIND.lonelySocial, 0, 1) * mindMult(state, 'lonely') - friends;
	const weight = MIND.homesickOrigin[state.origin] ?? MIND.homesickDefault;
	const homesick = weight * homesickCurve(dayOf(state.clock)) * mindMult(state, 'homesick') - friends;
	const stressed = pressureSources(state).reduce((a, p) => a + p.weight, 0) * mindMult(state, 'stressed');
	return { lonely: r2(Math.max(0, lonely)), homesick: r2(Math.max(0, homesick)), stressed: r2(stressed) };
}

/** 生效中、能缓解这种心事的心情状态（有就不触发） */
export function relieverOf(state: PlayerState, moodletId: string): string | undefined {
	return activeMoodlets(state).find((m) => m.def.relieves?.includes(moodletId))?.def.id;
}

export interface MindSignal {
	key: MindKey;
	score: number;
	trigger: number;
	/** 现在就有的心事状态 */
	active: boolean;
	/** 被哪个状态缓解着 */
	relievedBy?: string;
}

/** 心情页用：每种心事现在的分数、是否生效、被什么缓解 */
export function mindSignals(state: PlayerState): MindSignal[] {
	const scores = mindScores(state);
	const on = new Set(activeMoodlets(state).map((m) => m.def.id));
	return MIND_SIGNALS.map((d) => ({ key: d.key, score: scores[d.key], trigger: d.trigger, active: on.has(d.moodlet), relievedBy: relieverOf(state, d.moodlet) }));
}

/**
 * 每日结算（原地修改）：动作结束时调用，同一个游戏日只结算一次。
 * 一个动作跨好几天（住院、长途）时只结算一次，低落天数按跨过的天数累计。返回这次触发的心事。
 */
export function settleMind(state: PlayerState, fromDay?: number): MindKey[] {
	const today = dayOf(state.clock);
	if (today <= state.mind.day) return [];
	// 低落天数只算这次动作真正跨过的日子（fromDay = 动作开始那天）：存档在没有心事的部署上走过一段再回来，
	// 那段日子没人判过，不能一下子记成「连续 N 天低落」（合并 main 后复核，和 settleDecay 同一个口径）
	const days = today - Math.max(state.mind.day, fromDay ?? state.mind.day);
	const m = mood(state);
	const low = m < MIND.low ? Math.min(MIND.lowCap, state.mind.low + days) : 0;
	state.mind = { day: today, low };
	const scores = mindScores(state);
	const fired: MindKey[] = [];
	for (const d of MIND_SIGNALS) {
		if (scores[d.key] < d.trigger || relieverOf(state, d.moodlet)) continue;
		addMoodlet(state, d.moodlet);
		addLog(state, d.log);
		fired.push(d.key);
	}
	return fired;
}

/** 是否处在低谷期（连续几天心情低落）：界面据此展开恢复建议和求助渠道 */
export const lowSpell = (state: PlayerState) => state.mind.low >= MIND.helpAfter;

/** 主动调节心情：给家里打视频 / 找人聊聊。任何地方都能做，不花钱，只花时间 */
export function mindAction(prev: PlayerState, region: Region, op: MindOp): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const a = MIND_ACTS[op];
	if (!a) return fail(prev, '做不了这件事。');
	const state = clone(prev);
	if (applyEffect(state, { minutes: a.minutes, moodlet: a.moodlet }, region)) return collapsedResult(state);
	addLog(state, a.msg);
	return { ok: true, state, msg: `${a.icon} ${a.msg}` };
}

// 界面要用的数据一并转出，页面不必直接引用 data/mind.ts
export { HELP_LINES, MIND, MIND_ACTS, MIND_KEYS, MIND_SIGNALS };
export const mindMoodlet = (k: MindKey) => MOODLETS.find((m) => m.id === MIND_SIGNALS.find((d) => d.key === k)!.moodlet)!;
export const moodletName = (id: string) => MOODLETS.find((m) => m.id === id)?.name ?? id;
