// 经济系统的公共口径：职业成长曲线、零工（临时工）工资、每周收支估算。纯函数，只读数据和 PlayerState。
// 设计说明见 docs/earth-game/economy-design.md。标「待平衡」的数值是第 25 批的初始值，等 Codex 跑完平衡分析再定。
import { CAREERS } from '../data/careers.ts';
import { PROPERTIES } from '../data/properties.ts';
import { weeklyCosts } from './attributes.ts';
import { careerPay } from './engine.ts';
import { FINANCE } from './finance.ts';
import type { CareerDef, PlayerState } from './types.ts';

export const ECON = {
	/**
	 * 游戏最低时薪（待平衡）：所有职业的每个等级、按班长折算的时薪都不能低于它。
	 * 现实参照：Fair Work 国家最低工资 2026-07-01 起 $26.44/小时（2025-26 年度 $24.95）；
	 * 游戏工资整体约为现实的 0.75–0.8 倍，见设计文档第 2 节。
	 */
	minHourly: 20,
	/**
	 * 临时工加给（casual loading）：零工没有升职、没有表现奖金，按对口职业入门时薪上浮这个比例。
	 * 比例照搬现实规则：Fair Work 规定临时工一般在最低时薪上加 25%。
	 */
	casualLoading: 0.25,
	/** 每周收支估算按一周上几个班算（估算口径，不影响结算） */
	shiftsPerWeek: 6,
};

/**
 * 零工 → 对口职业。零工的工资 = 对口职业入门时薪 × (1 + 临时工加给) × 小时数（待平衡）。
 * 街头表演、捡瓶子不是雇佣关系，不在表里。
 */
export const GIG_CAREER: Record<string, string> = {
	'work-cafe': 'barista',
	'work-mine': 'miner',
	'work-farm': 'farmhand',
};

/** 某职业某等级按班长折算的时薪（不含证书、奖金） */
export function levelHourly(c: CareerDef, level: number): number {
	const lv = c.levels[level];
	return lv ? lv.pay / (c.minutes / 60) : 0;
}

export interface CurveStep {
	title: string;
	pay: number; // 每班工资
	hourly: number; // 时薪，保留一位小数
	vsEntry: number; // 相对入门级的倍数，保留两位小数
}

/** 一份职业的成长曲线：每个等级的每班工资、时薪、相对入门级的倍数 */
export function careerCurve(c: CareerDef): CurveStep[] {
	const entry = levelHourly(c, 0);
	return c.levels.map((lv, i) => ({
		title: lv.title,
		pay: lv.pay,
		hourly: Math.round(levelHourly(c, i) * 10) / 10,
		vsEntry: Math.round((levelHourly(c, i) / entry) * 100) / 100,
	}));
}

/** 零工的应得工资：对口职业入门时薪 × (1 + 临时工加给) × 小时数，取整。没有对口职业返回 null */
export function casualPay(careerId: string, minutes: number): number | null {
	const c = CAREERS.find((x) => x.id === careerId);
	return c ? Math.round(levelHourly(c, 0) * (1 + ECON.casualLoading) * (minutes / 60)) : null;
}

export interface WeeklyBudget {
	wages: number; // 工资：当前职业每班工资（含证书加薪，不含表现奖金）× 每周班数
	rentIncome: number; // 出租收入的期望值：各出租房产周租金 × (1 − 空置率)
	income: number;
	costs: number; // 每周固定开销：房租 + 车辆 + 物业费与还款（同 weeklyCosts）
	net: number; // income − costs；不含吃饭、出行等日常花销
}

/** 每周收支估算：让玩家知道自己「养得起」什么。只算固定项，日常花销另计 */
export function weeklyBudget(state: PlayerState): WeeklyBudget {
	const wages = state.job ? careerPay(state, state.job.career, state.job.level) * ECON.shiftsPerWeek : 0;
	const rentIncome = Math.round(
		state.properties.filter((p) => p.rented).reduce((sum, p) => sum + (PROPERTIES.find((d) => d.id === p.id)?.rentIncome ?? 0) * (1 - FINANCE.vacancy), 0),
	);
	const income = wages + rentIncome;
	const costs = weeklyCosts(state).total;
	return { wages, rentIncome, income, costs, net: income - costs };
}

