// 模拟结果的导出与对比（平衡调试工具）：经济流水表、A/B 对比表、CSV / JSON、回归基线快照。
// 只做格式化和比较，不跑模拟；说明见 docs/earth-game/balance-tools.md。
import type { SystemId } from './systems.ts';

/** 一种策略的汇总（sim.ts 生成）。现金、净资产是中位数；collapses 等是每人平均；flow / eco 是每人每天平均（美元） */
export interface PlanResult {
	id: string;
	name: string;
	metrics: {
		cashDay7: number; cashDay30: number; cashEnd: number; cashEndP10: number; cashEndP90: number;
		netPerDay: number; netWorth: number; homeDay: number | null; mood: number;
		collapses: number; evictions: number; promotions: number; promo1Day: number | null; promo2Day: number | null;
		brokeShare: number; events: number; coops: number;
		/** 每人每天的现金投放 / 回收合计 */
		ecoIn: number; ecoOut: number;
	};
	skills: Record<string, number>;
	/** 按动作键的净现金（和报告里「钱从哪来」同一份数据） */
	flow: Record<string, number>;
	/** in / out：按动作类型（和线上统计 eco.in.<类型> 同口径）；inDetail / outDetail：按动作键 */
	eco: { in: Record<string, number>; out: Record<string, number>; inDetail: Record<string, number>; outDetail: Record<string, number> };
	/** 系统关掉后每人被拦下的次数 */
	blocked: Record<string, number>;
}

/** 一次模拟（sim.ts --format=json 的输出，多了 variant 字段） */
export interface SimResult {
	days: number;
	runs: number;
	origins: boolean;
	off: SystemId[];
	plans: PlanResult[];
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number, digits = 0) => {
	const r = Number(n.toFixed(digits));
	return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)}`;
};

/** 变体的名字：base（系统全开）或 off:events+coop */
export const variantName = (r: Pick<SimResult, 'off'>) => (r.off.length ? `off:${r.off.join('+')}` : 'base');

// ---------- 经济流水 ----------

/** 「钱从哪来、到哪去」的投放 / 回收表（每人每天，美元）。键是动作类型，和线上统计 eco.in.<类型> / eco.out.<类型> 同口径 */
export function ecoMarkdown(r: SimResult): string {
	const rows = [
		'## 经济流水：投放与回收（每人每天平均，美元）',
		'',
		'投放 = 动作让现金变多的部分（工资、零工、事件奖励、卖东西），回收 = 变少的部分（吃住行、房租、学费、买东西）。按动作类型汇总，和线上统计的 `eco.in.<类型>` / `eco.out.<类型>` 同口径；周租、物业费等在某个动作途中扣的钱算在那个动作上（和「钱从哪来」表一样）。',
		'',
		'| 策略 | 投放合计 | 回收合计 | 净 | 回收/投放 | 投放（从大到小） | 回收（从大到小） |',
		'| --- | --- | --- | --- | --- | --- | --- |',
	];
	const top = (rec: Record<string, number>) => Object.entries(rec).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join('，') || '—';
	for (const p of r.plans) {
		const { ecoIn, ecoOut } = p.metrics;
		rows.push(`| ${p.name} | ${money(ecoIn)} | ${money(ecoOut)} | ${money(ecoIn - ecoOut)} | ${ecoIn > 0 ? (ecoOut / ecoIn).toFixed(2) : '—'} | ${top(p.eco.in)} | ${top(p.eco.out)} |`);
	}
	return rows.join('\n') + '\n';
}

// ---------- A/B ----------

/** A/B 对比里列出的指标：键、标签、小数位 */
export const AB_METRICS: [keyof PlanResult['metrics'], string, number][] = [
	['netPerDay', '日均净收入', 0],
	['cashEnd', '期末现金（中位）', 0],
	['netWorth', '期末净资产（中位）', 0],
	['mood', '平均心情', 1],
	['collapses', '晕倒/人', 2],
	['evictions', '收房或断供/人', 2],
	['promotions', '升职/人', 2],
	['brokeShare', '破产天数占比', 3],
	['ecoIn', '投放/人日', 0],
	['ecoOut', '回收/人日', 0],
];

export interface AbRow { plan: string; name: string; metric: string; label: string; base: number | null; variant: number | null; delta: number | null }

export function abRows(base: SimResult, variant: SimResult): AbRow[] {
	const rows: AbRow[] = [];
	for (const p of base.plans) {
		const q = variant.plans.find((x) => x.id === p.id);
		for (const [k, label] of AB_METRICS) {
			const a = p.metrics[k];
			const b = q ? q.metrics[k] : null;
			rows.push({ plan: p.id, name: p.name, metric: k, label, base: a, variant: b, delta: a !== null && b !== null ? b - a : null });
		}
	}
	return rows;
}

export function abMarkdown(base: SimResult, variant: SimResult): string {
	const name = variantName(variant);
	const out = [
		`# A/B 对比：base（系统全开） vs ${name}`,
		'',
		`${base.days} 个游戏日 × 每种策略 ${base.runs} 个种子，两边种子相同。关掉系统只改机器人行为（不发起这类动作 / 事件出现就丢掉），不改引擎。每格是「base → 变体（差）」。`,
		'',
		`| 策略 | ${AB_METRICS.map(([, l]) => l).join(' | ')} |`,
		`| --- | ${AB_METRICS.map(() => '---').join(' | ')} |`,
	];
	const rows = abRows(base, variant);
	for (const p of base.plans) {
		const cells = AB_METRICS.map(([k, , d]) => {
			const r = rows.find((x) => x.plan === p.id && x.metric === k)!;
			const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(d));
			return `${fmt(r.base)} → ${fmt(r.variant)}（${r.delta === null ? '—' : signed(r.delta, d)}）`;
		});
		out.push(`| ${p.name} | ${cells.join(' | ')} |`);
	}
	out.push('', '被拦下的动作 / 丢掉的事件（每人）：');
	out.push('');
	for (const p of variant.plans) {
		const t = Object.entries(p.blocked).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('，');
		out.push(`- ${p.name}：${t || '无（这个策略本来就不碰这些系统）'}`);
	}
	return out.join('\n') + '\n';
}

// ---------- CSV / JSON ----------

const csvCell = (v: string | number | null) => {
	if (v === null) return '';
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 长表 CSV：variant,plan,section,key,value。一个结果或几个变体都用这一种格式，方便透视。
 * section：metric（指标）、skill（期末能力中位）、flow（按动作键的净现金/人日）、eco_in / eco_out（按动作类型/人日）、
 * eco_in_detail / eco_out_detail（按动作键/人日）、blocked（被拦下次数/人）。
 */
export function toCsv(results: SimResult[]): string {
	const lines = ['variant,plan,section,key,value'];
	for (const r of results) {
		const v = variantName(r);
		for (const p of r.plans) {
			const push = (section: string, rec: Record<string, number | null>) => {
				for (const [k, val] of Object.entries(rec)) lines.push([v, p.id, section, k, val].map(csvCell).join(','));
			};
			push('metric', p.metrics);
			push('skill', p.skills);
			push('flow', p.flow);
			push('eco_in', p.eco.in);
			push('eco_out', p.eco.out);
			push('eco_in_detail', p.eco.inDetail);
			push('eco_out_detail', p.eco.outDetail);
			push('blocked', p.blocked);
		}
	}
	return lines.join('\n') + '\n';
}

/** JSON：单个结果是对象，几个变体是数组；每个都带 variant */
export function toJson(results: SimResult[]): string {
	const strip = (r: SimResult) => ({ variant: variantName(r), days: r.days, runs: r.runs, origins: r.origins, off: r.off, plans: r.plans });
	return JSON.stringify(results.length === 1 ? strip(results[0]) : results.map(strip), null, '\t') + '\n';
}

// ---------- 回归基线 ----------

/** 基线快照：只留每种策略的核心指标和投放 / 回收（按类型），四舍五入到 4 位小数，避免浮点尾数在不同 Node 版本上抖动 */
export interface Baseline {
	days: number;
	runs: number;
	plans: Record<string, Record<string, number | null>>;
}

const round4 = (n: number | null) => (n === null ? null : Math.round(n * 1e4) / 1e4);

export function toBaseline(r: SimResult): Baseline {
	const plans: Baseline['plans'] = {};
	for (const p of r.plans) {
		const row: Record<string, number | null> = {};
		for (const [k, v] of Object.entries(p.metrics)) row[k] = round4(v);
		for (const [k, v] of Object.entries(p.eco.in).sort()) row[`eco.in.${k}`] = round4(v);
		for (const [k, v] of Object.entries(p.eco.out).sort()) row[`eco.out.${k}`] = round4(v);
		plans[p.id] = row;
	}
	return { days: r.days, runs: r.runs, plans };
}

export interface BaselineDiff { plan: string; key: string; before: number | null | undefined; after: number | null | undefined }

/**
 * 两份基线的差异。tol 是相对容差（默认 0：任何变化都算）；一边有、一边没有的策略或指标也算差异。
 * 天数或种子数不同时直接报错：不同口径比出来的差没有意义。
 */
export function diffBaseline(before: Baseline, after: Baseline, tol = 0): BaselineDiff[] {
	if (before.days !== after.days || before.runs !== after.runs) {
		throw new Error(`口径不同，不能比：基线 ${before.days} 天 × ${before.runs} 种子，这次 ${after.days} 天 × ${after.runs} 种子`);
	}
	const out: BaselineDiff[] = [];
	const plans = [...new Set([...Object.keys(before.plans), ...Object.keys(after.plans)])];
	for (const plan of plans) {
		const a = before.plans[plan] ?? {};
		const b = after.plans[plan] ?? {};
		for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
			const x = a[key];
			const y = b[key];
			if (x === y) continue;
			if (typeof x === 'number' && typeof y === 'number' && Math.abs(y - x) <= tol * Math.max(Math.abs(x), Math.abs(y))) continue;
			out.push({ plan, key, before: x, after: y });
		}
	}
	return out;
}

export function diffMarkdown(diffs: BaselineDiff[], title: string): string {
	if (!diffs.length) return `### ${title}\n\n没有变化。\n`;
	const fmt = (v: number | null | undefined) => (v === undefined ? '（无）' : v === null ? '—' : String(v));
	const rows = [`### ${title}`, '', `${diffs.length} 处变化。`, '', '| 策略 | 指标 | 之前 | 之后 | 差 |', '| --- | --- | --- | --- | --- |'];
	for (const d of diffs) {
		const delta = typeof d.before === 'number' && typeof d.after === 'number' ? signed(d.after - d.before, 4) : '';
		rows.push(`| ${d.plan} | ${d.key} | ${fmt(d.before)} | ${fmt(d.after)} | ${delta} |`);
	}
	return rows.join('\n') + '\n';
}
