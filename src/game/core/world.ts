// 世界事件：全服共享的宏观指标（利率、油价、矿业景气、房价、租金、汇率），只由游戏日决定。
// 和天气（core/weather.ts）一样不用存档里的私密种子：同一个游戏日的所有玩家看到同一个世界，结果可复现。
// 纯函数：不读时钟、不用 Math.random。设计见 docs/earth-game/world-events.md。
import { INDICATORS, MINING_CAREERS, NEWS_LOOKBACK_DAYS, NEWS_MAX, NEWS_TEXT, WORLD_DAYS_MAX, WORLD_FX, type IndicatorDef, type IndicatorId, type NewsDir } from '../data/world.ts';
import { unit } from './weather.ts';

export type FareKind = keyof typeof WORLD_FX.fuelShare;

const clampDay = (day: number) => Math.max(0, Math.min(WORLD_DAYS_MAX, Number.isFinite(day) ? Math.floor(day) : 0));
const roundTo = (x: number, decimals: number) => Number(x.toFixed(decimals));

export const getIndicator = (id: IndicatorId): IndicatorDef => INDICATORS.find((d) => d.id === id)!;

/** 第 k 期的扰动（第 0 期为 0，保证开局落在中心值上） */
const jitter = (def: IndicatorDef, k: number) => (k === 0 || !def.noise ? 0 : def.noise * (2 * unit(`world|${def.id}|${k}`) - 1));

/**
 * 某指标在某个游戏日的值。期内不变：取本期第一天（step 的整数倍）算。
 * 值 = 中心 + 振幅 × sin(2π × (期初日 / 周期 + 相位)) + 扰动；利率取整到 0.25，其余按展示小数位取整。
 */
export function indicatorOn(def: IndicatorDef, day: number): number {
	const k = Math.floor(clampDay(day) / def.step);
	const start = k * def.step;
	const raw = def.center + def.amp * Math.sin(2 * Math.PI * (start / def.period + def.phase)) + jitter(def, k);
	if (def.id === 'rate') return Math.round(raw * 4) / 4;
	return roundTo(raw, def.decimals);
}

export type WorldState = Record<IndicatorId, number>;

/** 某个游戏日全部指标的值 */
export function worldOn(day: number): WorldState {
	return Object.fromEntries(INDICATORS.map((d) => [d.id, indicatorOn(d, day)])) as WorldState;
}

/** 指标相对中心值的偏离比例（0.1 = 高 10%） */
const dev = (id: IndicatorId, day: number) => {
	const def = getIndicator(id);
	return indicatorOn(def, day) / def.center - 1;
};

/** 路费的油价系数：1 + 燃油份额 × 油价偏离 */
export const fuelMult = (day: number, kind: FareKind) => 1 + WORLD_FX.fuelShare[kind] * dev('oil', day);

/** 矿业公司工资系数 */
export const miningPayMult = (day: number) => 1 + WORLD_FX.miningPayShare * dev('mining', day);

/** 矿业公司这天招不招新人 */
export const miningHiring = (day: number) => indicatorOn(getIndicator('mining'), day) >= WORLD_FX.miningHireFloor;

/** 某职业的工资系数（不受宏观影响的职业为 1） */
export const careerPayMult = (careerId: string, day: number) => (MINING_CAREERS.includes(careerId) ? miningPayMult(day) : 1);

/** 某职业这天暂停招人的原因；照常招人返回 undefined */
export const hiringFrozen = (careerId: string, day: number): string | undefined =>
	MINING_CAREERS.includes(careerId) && !miningHiring(day) ? '矿业降温，矿上暂停招新人（在职的照常上班）' : undefined;

/** 房贷利息系数：(现金利率 + 利差) / (中心 + 利差) */
export function loanRateMult(day: number): number {
	const def = getIndicator('rate');
	return (indicatorOn(def, day) + WORLD_FX.mortgageSpread) / (def.center + WORLD_FX.mortgageSpread);
}

/** 房租和出租收入的系数 */
export const rentMult = (day: number) => 1 + WORLD_FX.rentShare * dev('rent', day);

/** 按租金指数调整后的周租（房租、出租收入都用它），取整 */
export const rentOn = (base: number, day: number) => Math.round(base * rentMult(day));

// ---------- 新闻 ----------

export interface WorldNews {
	day: number;
	id: IndicatorId;
	dir: NewsDir;
	title: string;
	body: string;
	/** 从多少到多少（已按单位格式化） */
	from: string;
	to: string;
}

/** 按单位格式化指标值 */
export function fmtIndicator(def: IndicatorDef, v: number): string {
	const n = v.toFixed(def.decimals);
	if (def.id === 'rate') return `${n}%`;
	return `${n} ${def.unit}`;
}

const pick = <T>(arr: T[], key: string): T => arr[Math.floor(unit(key) * arr.length) % arr.length];

/** 这一天某个指标有没有新闻；没有返回 null */
export function newsOn(def: IndicatorDef, day: number): WorldNews | null {
	const d = clampDay(day);
	if (d < def.step || d % def.step !== 0) return null;
	const now = indicatorOn(def, d);
	const prev = indicatorOn(def, d - def.step);
	const delta = now - prev;
	// 矿业跨过招工线时，就算这周变化不大也要报（玩家要知道为什么应聘不了 / 又能应聘了）
	const crossed = def.id === 'mining' && prev >= WORLD_FX.miningHireFloor !== now >= WORLD_FX.miningHireFloor;
	let dir: NewsDir;
	if (def.id === 'rate') dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'hold';
	else if (crossed || Math.abs(delta) >= def.newsMin - 1e-9) dir = delta > 0 ? 'up' : 'down';
	else return null;
	const text = NEWS_TEXT[def.id][dir];
	if (!text) return null;
	const reason = pick(text.reasons, `news|${def.id}|${d}`);
	const from = fmtIndicator(def, prev);
	const to = fmtIndicator(def, now);
	const move = dir === 'hold' ? `${def.name}维持 ${to}` : `${def.name}从 ${from} ${dir === 'up' ? '升到' : '降到'} ${to}`;
	let body = `${reason}。${move}。${text.effect}`;
	if (def.id === 'mining') {
		const was = prev >= WORLD_FX.miningHireFloor;
		const is = now >= WORLD_FX.miningHireFloor;
		if (was && !is) body += '矿业公司暂停招新人。';
		else if (!was && is) body += '矿业公司恢复招人。';
	}
	return { day: d, id: def.id, dir, title: text.title, body, from, to };
}

/** 最近 NEWS_LOOKBACK_DAYS 天（含今天）的新闻，新的在前，最多 NEWS_MAX 条 */
export function worldNews(day: number, max = NEWS_MAX): WorldNews[] {
	const today = clampDay(day);
	const out: WorldNews[] = [];
	for (let d = today; d > today - NEWS_LOOKBACK_DAYS && d >= 0 && out.length < max; d--) {
		for (const def of INDICATORS) {
			const n = newsOn(def, d);
			if (n && out.length < max) out.push(n);
		}
	}
	return out;
}
