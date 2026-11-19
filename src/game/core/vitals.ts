// 时间流逝对身体的影响：需求衰减、饿 / 累到见底掉健康、吃饱睡足慢慢回健康、麻烦值慢慢冷却，
// 以及「隐藏属性」怎么牵动看得见的精力和健康（第 23 批）。纯函数。
//
// 借鉴模拟人生类游戏的动机模型（只借机制）：看得见的需求背后有几项不显示的内部量互相牵动——
// 睡着时饿得慢、精力不降；压力大时饿得快；体质好的人精力上限高、干活省力、睡觉回得多。
// 参考：github.com/alexcu/motive-simulator（Don Hopkins《The Soul of The Sims》的动机代码移植，无许可证，只看机制不拷代码）。
//
// 设定和公式说明见 docs/earth-game/activity-attributes.md。
// 标「待平衡」的数值是第 23 批新加的初始值，等 Codex 跑完平衡分析再定。
import { activeMoodlets, decayMult } from './attributes.ts';
import { derivedStats } from './formulas.ts';
import { NEED_KEYS } from './types.ts';
import type { Effect, NeedKey, PlayerState } from './types.ts';

/** 每游戏分钟的需求衰减（现状，未改）。每小时 = × 60：饱食 4.2、精力 3、清洁 2.1、娱乐 2.4、社交 1.8 */
export const DECAY: Record<NeedKey, number> = { hunger: 0.07, energy: 0.05, hygiene: 0.035, fun: 0.04, social: 0.03 };

export const VITALS = {
	/** 饱食或精力见底时每小时掉的健康（现状 0.02/分钟，未改） */
	starvePerHour: 1.2,
	/** 饱食和精力都不低于 minNeed 时每小时自然回的健康（新，待平衡） */
	regenPerHour: 0.25,
	regenMinNeed: 50,
	/** 麻烦值每小时自然冷却（新，待平衡）；「低调几天」仍是主要的降法 */
	heatCoolPerHour: 0.25,
};

/** 隐藏属性的系数（新，全部待平衡） */
export const HIDDEN = {
	/** 精力上限 = min(100, base + 体质 × perFitness)：练体能、力量、游泳会永久提高 */
	energyCap: { base: 80, perFitness: 0.2 },
	/** 睡着时各需求的衰减倍率：精力不降（醒来时再加睡眠恢复），饱食、娱乐、社交减半，清洁照常 */
	sleepDecay: { hunger: 0.5, energy: 0, hygiene: 1, fun: 0.5, social: 0.5 } as Record<NeedKey, number>,
	/** 压力 0–1 = (stressAt − min(娱乐, 社交)) / stressAt；压力让饱食衰减 × (1 + hungerPerStress × 压力)，睡着时不算 */
	stressAt: 40,
	hungerPerStress: 0.25,
};

/** 压力（隐藏，0–1）：娱乐或社交跌到 40 以下开始有，跌到 0 为 1 */
export function stress(state: PlayerState): number {
	const low = Math.min(state.needs.fun, state.needs.social);
	return Math.max(0, Math.min(1, (HIDDEN.stressAt - low) / HIDDEN.stressAt));
}

/** 精力上限（隐藏，80–100）：体质越好越高 */
export function energyCap(state: PlayerState): number {
	return Math.min(100, HIDDEN.energyCap.base + derivedStats(state).fitness * HIDDEN.energyCap.perFitness);
}

/** 当前每分钟的衰减速度：基础 × 特质 ×（睡着时）睡眠倍率 ×（醒着时饱食）压力倍率 */
export function needRate(state: PlayerState, k: NeedKey, asleep = false): number {
	const base = DECAY[k] * decayMult(state, k);
	if (asleep) return base * HIDDEN.sleepDecay[k];
	return k === 'hunger' ? base * (1 + HIDDEN.hungerPerStress * stress(state)) : base;
}

/** 生效中心情状态对健康自然恢复的倍率（如「吃了维生素」×2），连乘 */
export function moodletRegenMult(state: PlayerState): number {
	return activeMoodlets(state).reduce((acc, m) => acc * (m.def.regen ?? 1), 1);
}

/** 按 rate 匀速下降，从 value 降到 floor 要多少分钟；已经不高于 floor 为 0，不下降为 Infinity */
export function minutesTo(value: number, rate: number, floor: number): number {
	if (value <= floor) return 0;
	return rate > 0 ? (value - floor) / rate : Infinity;
}

export interface VitalsTick {
	starveMin: number; // 这段时间里饱食或精力已见底的分钟数
	regenMin: number; // 这段时间里饱食和精力都 ≥ regenMinNeed 的分钟数
	health: number; // 健康变化（未钳制）
	heat: number; // 麻烦值变化（未钳制）
}

/**
 * 只算不改：这段时间里健康和麻烦值怎么变。按时间段精确计算，
 * 例如饱食还剩 7、每分钟掉 0.07，那么前 100 分钟不掉血，之后才按 starvePerHour 掉。
 */
export function vitalsTick(state: PlayerState, minutes: number, asleep = false): VitalsTick {
	if (minutes <= 0) return { starveMin: 0, regenMin: 0, health: 0, heat: 0 };
	const h = needRate(state, 'hunger', asleep);
	const e = needRate(state, 'energy', asleep);
	// 睡着时精力在恢复，见底只看饱食；醒着时饱食或精力任一见底都掉血
	const fine = asleep ? minutesTo(state.needs.hunger, h, 0) : Math.min(minutesTo(state.needs.hunger, h, 0), minutesTo(state.needs.energy, e, 0));
	const starveMin = Math.max(0, minutes - fine);
	const regenMin = Math.min(minutes, minutesTo(state.needs.hunger, h, VITALS.regenMinNeed), minutesTo(state.needs.energy, e, VITALS.regenMinNeed));
	const health = ((regenMin * VITALS.regenPerHour * moodletRegenMult(state)) - (starveMin * VITALS.starvePerHour)) / 60;
	const heat = -(minutes * VITALS.heatCoolPerHour) / 60;
	return { starveMin, regenMin, health, heat };
}

/** 时间流逝：先算健康和麻烦值（用流逝前的需求），再衰减需求。原地修改 state */
export function passTime(state: PlayerState, minutes: number, asleep = false) {
	const t = vitalsTick(state, minutes, asleep);
	const rates = NEED_KEYS.map((k) => needRate(state, k, asleep)); // 先把速度都算好：压力看的是流逝前的娱乐和社交
	NEED_KEYS.forEach((k, i) => (state.needs[k] = clamp100(state.needs[k] - rates[i] * minutes)));
	state.health = clamp100(state.health + t.health);
	state.heat = clamp100(state.heat + t.heat);
}

/** 加减一项需求。精力的增加不超过精力上限；本来就高于上限（老存档、上限下降）时，增加不会把它拉低 */
export function gainNeed(state: PlayerState, k: NeedKey, d: number) {
	const cur = state.needs[k];
	if (k === 'energy' && d > 0) state.needs[k] = Math.max(cur, Math.min(energyCap(state), cur + d));
	else state.needs[k] = clamp100(cur + d);
}

/**
 * 体质对一份效果的影响（只用于活动、上班这类数据里写死数值的效果；真实地点的公式自己已经算过）：
 *   消耗的精力 × 体力消耗系数（0.6–1，体质越好越省力）
 *   睡觉恢复的精力 × 恢复系数（0.75–1.25，健康和体质越好回得越多）
 */
export function bodyScaled(state: PlayerState, fx: Effect): Effect {
	const en = fx.needs?.energy;
	if (!en) return fx;
	const d = derivedStats(state);
	const k = en < 0 ? d.exertion : fx.asleep ? d.recovery : 1;
	return k === 1 ? fx : { ...fx, needs: { ...fx.needs, energy: Math.round(en * k * 10) / 10 } };
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
