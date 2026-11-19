// 时间流逝对身体的影响：需求衰减、饿 / 累到见底掉健康、吃饱睡足慢慢回健康、麻烦值慢慢冷却。纯函数。
// 设定和公式说明见 docs/earth-game/activity-attributes.md。
// 标「待平衡」的数值是第 23 批新加的初始值，等 Codex 跑完平衡分析再定。
import { decayMult } from './attributes.ts';
import { NEED_KEYS } from './types.ts';
import type { NeedKey, PlayerState } from './types.ts';

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

/** 当前每分钟的衰减速度（已乘特质） */
export const needRate = (state: PlayerState, k: NeedKey): number => DECAY[k] * decayMult(state, k);

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
 * 只算不改：这段时间里健康和麻烦值怎么变。按时间段精确计算（第 23 批起），
 * 例如饱食还剩 7、每分钟掉 0.07，那么前 100 分钟不掉血，之后才按 starvePerHour 掉。
 */
export function vitalsTick(state: PlayerState, minutes: number): VitalsTick {
	if (minutes <= 0) return { starveMin: 0, regenMin: 0, health: 0, heat: 0 };
	const h = needRate(state, 'hunger');
	const e = needRate(state, 'energy');
	const fine = Math.min(minutesTo(state.needs.hunger, h, 0), minutesTo(state.needs.energy, e, 0));
	const starveMin = Math.max(0, minutes - fine);
	const regenMin = Math.min(minutes, minutesTo(state.needs.hunger, h, VITALS.regenMinNeed), minutesTo(state.needs.energy, e, VITALS.regenMinNeed));
	const health = ((regenMin * VITALS.regenPerHour) - (starveMin * VITALS.starvePerHour)) / 60;
	const heat = -(minutes * VITALS.heatCoolPerHour) / 60;
	return { starveMin, regenMin, health, heat };
}

/** 时间流逝：先算健康和麻烦值（用流逝前的需求），再衰减需求。原地修改 state */
export function passTime(state: PlayerState, minutes: number) {
	const t = vitalsTick(state, minutes);
	for (const k of NEED_KEYS) state.needs[k] = clamp100(state.needs[k] - needRate(state, k) * minutes);
	state.health = clamp100(state.health + t.health);
	state.heat = clamp100(state.heat + t.heat);
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
