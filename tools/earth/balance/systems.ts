// 模拟器的系统开关和经济流水（平衡调试工具，docs/earth-game/balance-tools.md §2）。
// 单独成文件、sim.ts 里只插几行调用：很多分支都在改 sim.ts，改动越少越好合并。
import type { GameAction } from '../../../src/game/core/actions.ts';

/** 和 sim.ts 的 GIG_IDS 相同（tests/earth/balance-tools.test.ts 核对） */
export const GIGS = ['work-mine', 'work-farm', 'work-cafe', 'busk'] as const;

// 只改机器人「做不做」，不改引擎：关掉某个系统 = 机器人永远不发起这类动作；events 是事件一出现就丢掉、不结算选项。
// 引擎内部的系统（天气、需求衰减、周结算）要在引擎里加开关才能关，第一版不做，见文档 §2.3。
export const SYSTEMS = [
	{ id: 'events', name: '随机事件', how: '抵达 / 到店事件出现就丢掉，不结算任何选项' },
	{ id: 'coop', name: '共同事件', how: '带 coop 假设的策略不再做共同事件' },
	{ id: 'courses', name: '课程', how: '不上课（course）' },
	{ id: 'furniture', name: '家具', how: '不买家具（furniture）' },
	{ id: 'experience', name: '体验', how: '不做付费体验（experience）' },
	{ id: 'property', name: '房产', how: '不买房、不搬进自有房（property）' },
	{ id: 'vehicle', name: '车辆', how: '不买卖车（vehicle）' },
	{ id: 'rent', name: '租房', how: '不租房（home rent）' },
	{ id: 'social', name: 'NPC 社交', how: '不和 NPC 互动（npc）' },
	{ id: 'shop', name: '商店', how: '不买东西（buy）' },
	{ id: 'gigs', name: '零工', how: '不做零工（work-mine / work-farm / work-cafe / busk）' },
	{ id: 'charity', name: '免费餐', how: '不吃慈善餐（charity-meal / charity-dinner）' },
	{ id: 'visa', name: '签证', how: '不申请签证、不考雅思（visa，第 43 批；签证过期后不能工作照常生效）' },
] as const;
export type SystemId = (typeof SYSTEMS)[number]['id'];
export const SYSTEM_IDS: readonly SystemId[] = SYSTEMS.map((x) => x.id);

/** 这个动作归哪个可关的系统（没有返回 undefined）。events / coop 不经过这里 */
export function systemOf(a: GameAction): SystemId | undefined {
	switch (a.t) {
		case 'course': return 'courses';
		case 'furniture': return 'furniture';
		case 'experience': return 'experience';
		case 'property': return 'property';
		case 'vehicle': return 'vehicle';
		case 'npc': return 'social';
		case 'buy': return 'shop';
		case 'home': return a.op === 'rent' ? 'rent' : undefined;
		case 'visa': return 'visa';
		case 'activity':
			if ((GIGS as readonly string[]).includes(a.id)) return 'gigs';
			if (a.id === 'charity-meal' || a.id === 'charity-dinner') return 'charity';
			return undefined;
		default: return undefined;
	}
}

/** 「events,coop」→ 系统 id 列表；有不认识的就抛错（带可选值） */
export function parseSystems(text: string): SystemId[] {
	const ids = text.split(',').map((x) => x.trim()).filter(Boolean);
	const bad = ids.filter((x) => !(SYSTEM_IDS as readonly string[]).includes(x));
	if (bad.length) throw new Error(`没有这些系统：${bad.join('，')}（可选：${SYSTEM_IDS.join('，')}）`);
	return [...new Set(ids)] as SystemId[];
}

/** 一个机器人的现金流水和被拦下的次数 */
export interface EcoStats {
	/** 投放（动作让现金变多）/ 回收（变少），按动作类型 a.t，和线上统计的 eco.in.<类型> / eco.out.<类型> 同口径 */
	in: Record<string, number>;
	out: Record<string, number>;
	/** 同上，按 sim.ts 的动作键（activity 按活动 id） */
	inDetail: Record<string, number>;
	outDetail: Record<string, number>;
	/** 系统关掉后被拦下的动作 / 丢掉的事件，按系统 id */
	blocked: Record<string, number>;
}

export const blankEco = (): EcoStats => ({ in: {}, out: {}, inDetail: {}, outDetail: {}, blocked: {} });

export function addTo(r: Record<string, number>, k: string, v: number) {
	r[k] = (r[k] ?? 0) + v;
}

/** 记一笔现金变化：多了算投放，少了算回收，0 不记 */
export function recordEco(e: EcoStats, type: string, detail: string, delta: number) {
	if (!Number.isFinite(delta) || delta === 0) return;
	if (delta > 0) {
		addTo(e.in, type, delta);
		addTo(e.inDetail, detail, delta);
	} else {
		addTo(e.out, type, -delta);
		addTo(e.outDetail, detail, -delta);
	}
}

/** 一组机器人的记录 → 每人每天平均（blocked 是每人合计） */
export function averageEco(list: EcoStats[], days: number) {
	const avg = (pick: (e: EcoStats) => Record<string, number>, perDay = true) => {
		const r: Record<string, number> = {};
		for (const e of list) for (const [k, v] of Object.entries(pick(e))) addTo(r, k, v / list.length / (perDay ? days : 1));
		return r;
	};
	return { in: avg((e) => e.in), out: avg((e) => e.out), inDetail: avg((e) => e.inDetail), outDetail: avg((e) => e.outDetail), blocked: avg((e) => e.blocked, false) };
}
