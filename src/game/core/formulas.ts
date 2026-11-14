// 公式模块：派生属性（二级属性）与真实地点动作的结算公式。纯函数，只读 PlayerState。
//
// 借鉴的经典设计（只借机制，不借名字和内容）：
//   - 二级属性由一级能力加权得出：经典 RPG 的「主属性 → 派生属性」
//   - 状态好坏影响一切产出：模拟人生类游戏里情绪影响技能成长和工作表现
//   - 训练收益 = 基础值 × 场地质量 × 状态 × 递减：文字类 MMO 健身房公式（体力换属性、心情放大收益、属性越高越难涨）
//   - 吃东西：饱腹换算体力，体力的一部分再换成恢复（农场经营类游戏的「食物 → 体力 → 生命」比例）
//   - 连练会酸痛、隔开练才有效：超量恢复
//   - 两次定位推算速度过快就拒绝：真实地点类手游的防“瞬移”冷却
import { activeMoodlets, costMult, mood } from './attributes.ts';
import type { Effect, PlayerState, SkillKey, VenueTypeDef } from './types.ts';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------- 派生属性 ----------
export interface DerivedStats {
	fitness: number; // 体质 0–100 = 体能 50% + 力量 30% + 游泳 20%
	appeal: number; // 吸引力 0–100 = 魅力 + 体质 15% + 心情修正 − 邋遢扣分
	exertion: number; // 体力消耗系数：体质越好越省力，0.6–1
	recovery: number; // 恢复系数：健康和体质越好，吃饭睡觉回得越多，0.75–1.25
	efficiency: Efficiency;
}

export interface Efficiency {
	mood: number; // 0.7–1.3
	health: number; // 0.6–1
	fatigue: number; // 体力低于 40 开始打折，0.5–1
	total: number; // 连乘，钳制在 0.3–1.5
}

/** 状态系数：心情、健康、疲劳连乘。所有产出（训练收益、工作表现）都乘它 */
export function efficiency(state: PlayerState): Efficiency {
	const m = 0.7 + (0.6 * mood(state)) / 100;
	const h = 0.6 + (0.4 * state.health) / 100;
	const e = state.needs.energy;
	const f = e >= 40 ? 1 : 0.5 + (0.5 * e) / 40;
	return { mood: r1(m * 100) / 100, health: r1(h * 100) / 100, fatigue: r1(f * 100) / 100, total: clamp(Math.round(m * h * f * 100) / 100, 0.3, 1.5) };
}

export function derivedStats(state: PlayerState): DerivedStats {
	const s = state.skills;
	const fitness = Math.round(s.stamina * 0.5 + s.strength * 0.3 + s.swimming * 0.2);
	const groom = state.needs.hygiene < 30 ? -10 : 0;
	const appeal = Math.round(clamp(s.charisma + fitness * 0.15 + (mood(state) - 50) / 10 + groom, 0, 100));
	const exertion = r1((1 - fitness / 250) * 100) / 100;
	const recovery = r1((0.75 + state.health / 400 + fitness / 400) * 100) / 100;
	return { fitness, appeal, exertion, recovery, efficiency: efficiency(state) };
}

/** 生效中的心情状态对能力成长的倍率（如「专注」×1.25），连乘 */
export function moodletGainMult(state: PlayerState): number {
	return activeMoodlets(state).reduce((acc, m) => acc * (m.def.gain ?? 1), 1);
}

// ---------- 动作结算 ----------
/** 一次动作的结果：要扣的钱、效果、给界面看的公式说明；blocked 有值表示做不了 */
export interface OpOutcome {
	cost: number;
	fx: Effect;
	notes: string[];
	blocked?: string;
}

/**
 * 吃饭。档次 t（1–4）：
 *   价格 = 8 × t^1.6 × 特质花费倍率（t1 $8 · t2 $24 · t3 $46 · t4 $74）
 *   饱食 = (20 + 15t) × 胃口；胃口 = max(0.2, 1 − 当前饱食 / 140)，吃撑了收益递减
 *   体力 = 饱食回复 × 0.4 × 恢复系数；咖啡馆额外 +12 体力（咖啡因）
 *   t ≥ 3 给「吃了顿大餐」，否则「吃得很满足」
 */
export function mealOutcome(state: PlayerState, type: VenueTypeDef, tier: number): OpOutcome {
	const t = clamp(Math.round(tier), 1, 4);
	const cost = Math.round(8 * t ** 1.6 * costMult(state));
	const appetite = Math.max(0.2, 1 - state.needs.hunger / 140);
	const caffeine = type.id === 'cafe';
	const hunger = Math.round((20 + 15 * t) * appetite * (caffeine ? 0.6 : 1));
	const energy = Math.round(hunger * 0.4 * derivedStats(state).recovery) + (caffeine ? 12 : 0);
	const notes = [`档次 ${t}：$${cost}`, `胃口 ×${r1(appetite)}`, `饱食 +${hunger}`, `体力 +${energy}`];
	if (state.cash < cost) return { cost, fx: {}, notes, blocked: `需要 $${cost}` };
	return { cost, notes, fx: { cash: -cost, needs: { hunger, energy, fun: 3 * t }, moodlet: t >= 3 ? 'fine-dining' : 'well-fed' } };
}

/**
 * 训练。场地质量 q（健身房 1、体育中心 0.8）：
 *   体力消耗 = 25 × 体力消耗系数
 *   成长 = 基础值 × q × 状态系数 × 恢复；基础值：力量 3、体能 1.5、魅力 0.8
 *   恢复：身上有「肌肉酸痛」（上次练完 12 小时内）只有一半效果
 *   成长再经过统一的递减（growSkill：越接近满分涨得越慢）
 *   门票 $10 × 特质花费倍率
 */
export function trainOutcome(state: PlayerState, type: VenueTypeDef): OpOutcome {
	const d = derivedStats(state);
	const q = type.quality ?? 1;
	const sore = state.moodlets.some((m) => m.id === 'sore' && m.until > state.clock);
	const rec = sore ? 0.5 : 1;
	const k = q * d.efficiency.total * rec;
	const energyCost = Math.round(25 * d.exertion);
	const cost = Math.round(10 * costMult(state));
	const gains: Partial<Record<SkillKey, number>> = { strength: r1(3 * k), stamina: r1(1.5 * k), charisma: r1(0.8 * k) };
	const notes = [`体力 −${energyCost}`, `状态 ×${d.efficiency.total}`, `场地 ×${q}`, ...(sore ? ['酸痛 ×0.5'] : []), `力量 +${gains.strength}、体能 +${gains.stamina}、魅力 +${gains.charisma}（递减前）`];
	if (state.needs.energy < energyCost + 5) return { cost, fx: {}, notes, blocked: `体力不够（需要 ${energyCost + 5}）` };
	if (state.cash < cost) return { cost, fx: {}, notes, blocked: `需要 $${cost}` };
	return { cost, notes, fx: { cash: -cost, needs: { energy: -energyCost, hygiene: -20, hunger: -12, fun: 5 }, skills: gains, moodlet: sore ? 'sore' : 'pumped' } };
}

/** 跑步 / 游泳：体力换体能（游泳另涨游泳、补清洁） */
export function exerciseOutcome(state: PlayerState, kind: 'run' | 'swim'): OpOutcome {
	const d = derivedStats(state);
	const energyCost = Math.round((kind === 'run' ? 18 : 20) * d.exertion);
	const k = d.efficiency.total;
	const skills: Partial<Record<SkillKey, number>> = kind === 'run' ? { stamina: r1(2 * k) } : { swimming: r1(2 * k), stamina: r1(1 * k) };
	const notes = [`体力 −${energyCost}`, `状态 ×${k}`];
	if (state.needs.energy < energyCost + 5) return { cost: 0, fx: {}, notes, blocked: `体力不够（需要 ${energyCost + 5}）` };
	const needs = kind === 'run' ? { energy: -energyCost, hygiene: -15, fun: 15 } : { energy: -energyCost, hygiene: 15, fun: 15 };
	return { cost: 0, notes, fx: { needs, skills } };
}

/** 在公园坐一会儿：体力 +8 × 恢复系数，娱乐 +20 */
export function relaxOutcome(state: PlayerState): OpOutcome {
	const energy = Math.round(8 * derivedStats(state).recovery);
	return { cost: 0, notes: [`体力 +${energy}`, '娱乐 +20'], fx: { needs: { energy, fun: 20, social: 5 } } };
}

/** 自习：进入「专注」（之后 6 小时能力成长 ×1.25），代价是娱乐和体力 */
export function studyOutcome(state: PlayerState): OpOutcome {
	const notes = ['获得「专注」：6 小时内能力成长 ×1.25', '娱乐 −10、体力 −8'];
	if (state.needs.energy < 15) return { cost: 0, fx: {}, notes, blocked: '太累了，学不进去' };
	return { cost: 0, notes, fx: { needs: { fun: -10, energy: -8 }, moodlet: 'focused' } };
}

/** 喝一杯：价格 12 × 档次，社交 +40、娱乐 +20、魅力 +1.5 × 状态 */
export function drinkOutcome(state: PlayerState, tier: number): OpOutcome {
	const cost = Math.round(12 * clamp(tier, 1, 4) * costMult(state));
	const k = efficiency(state).total;
	const notes = [`$${cost}`, '社交 +40、娱乐 +20', `魅力 +${r1(1.5 * k)}`];
	if (state.cash < cost) return { cost, fx: {}, notes, blocked: `需要 $${cost}` };
	return { cost, notes, fx: { cash: -cost, needs: { social: 40, fun: 20, energy: -6 }, skills: { charisma: r1(1.5 * k) }, moodlet: 'good-time' } };
}

/** 采购：$14 买 3 根能量棒 + 3 瓶水（便利店要 $27） */
export function groceriesOutcome(state: PlayerState): OpOutcome {
	const cost = Math.round(14 * costMult(state));
	const notes = [`$${cost}`, '能量棒 ×3、饮用水 ×3'];
	if (state.cash < cost) return { cost, fx: {}, notes, blocked: `需要 $${cost}` };
	return { cost, notes, fx: { cash: -cost, items: { snack: 3, water: 3 } } };
}

/** 看病：健康 +35 × 恢复系数，$45 */
export function healOutcome(state: PlayerState): OpOutcome {
	const cost = Math.round(45 * costMult(state));
	const health = Math.round(35 * derivedStats(state).recovery);
	const notes = [`$${cost}`, `健康 +${health}`];
	if (state.health >= 100) return { cost, fx: {}, notes, blocked: '很健康，不用看' };
	if (state.cash < cost) return { cost, fx: {}, notes, blocked: `需要 $${cost}` };
	return { cost, notes, fx: { cash: -cost, health } };
}

/**
 * 真实上班的工资：
 *   时薪 = 有对应职业时用当前等级工资 ÷ 班长小时数 × 1.15（到岗加成），否则用地点类型的零工时薪
 *   表现系数 = 0.7 + 0.3 × 状态系数（0.79–1.15）
 *   能力加成 = 1 + 相关能力 / 300
 *   工资 = 时薪 × 小时数 × 表现系数 × 能力加成
 *   体力额外消耗 = 每小时 4 × 体力消耗系数（时间流逝本身的衰减另算）
 */
export function workPay(state: PlayerState, hourly: number, minutes: number, skill: SkillKey): { pay: number; perf: number; energy: number; notes: string[] } {
	const d = derivedStats(state);
	const perf = Math.round((0.7 + 0.3 * d.efficiency.total) * 100) / 100;
	const skillBonus = 1 + state.skills[skill] / 300;
	const hours = minutes / 60;
	const pay = Math.round(hourly * hours * perf * skillBonus);
	const energy = Math.round(4 * hours * d.exertion);
	return { pay, perf, energy, notes: [`时薪 $${r1(hourly)}`, `${r1(hours)} 小时`, `表现 ×${perf}`, `能力 ×${r1(skillBonus * 100) / 100}`] };
}
