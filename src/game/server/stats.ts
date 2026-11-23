// 数据统计（第一版，设计见 docs/earth-game/analytics.md）：服务端只存按现实日汇总的计数，不存原始事件。
// 计数里没有玩家 id、名字、同步码、坐标：键只来自白名单（动作类型、标签页、错误类别、耗时分档），值只有次数和金额合计。
// 留存和新手漏斗要知道玩家是哪天建的角色：另存 'born:<id 哈希前缀>' = 现实日序号，30 天后删除（见 world.ts）。
import type { GameAction } from '../core/actions.ts';
import type { PlayerState } from '../core/types.ts';
import { STAT_EVENTS } from '../ui/telemetry.ts';

export type Counts = Record<string, number>;

/** 汇总保留多少个现实日（约 13 个月，能对比去年同期；只有计数，没有个人信息） */
export const STATS_KEEP_DAYS = 400;
/** 注册日记录保留多少天：只用来算 1–30 日留存和新手漏斗 */
export const BORN_KEEP_DAYS = 30;
/** 每个现实日最多记多少个不同的计数键（键都来自白名单，正常远到不了；防止代码出错时无限长） */
export const STATS_MAX_KEYS = 2000;
export const STATS_PREFIX = 'stats:';
export const BORN_PREFIX = 'born:';

/** 新手漏斗的步骤（创建角色另算 'new'）：第一次出行、第一次打工（算过一个班次）、第一次真实打卡（到场定位成功的 POI 打卡或真实地点动作） */
export type FunnelStep = 'travel' | 'work' | 'real';

const OPS = new Set(['apply', 'work', 'quit', 'rent', 'sleep', 'nap', 'leave', 'cook', 'host', 'delivery', 'relax', 'buy', 'sell', 'movein', 'rentout', 'repay', 'service', 'enter', 'race', 'join', 'club', 'inspect', 'report', 'repair', 'renew', 'accept', 'dispute', 'scam-pay', 'scam-check', 'chore', 'sublet', 'unsublet', 'invite', 'askout', 'resolve', 'open', 'card', 'draw', 'loan', 'carloan', 'bnpl']);
const VENUE_OPS = /^[a-z]{2,16}$/;

/** 动作的功能名：类型加子操作（只认白名单里的子操作，不带任何 id、坐标、金额） */
export function featureOf(a: GameAction): string {
	if (a.t === 'venue') return VENUE_OPS.test(a.op) ? `venue.${a.op}` : 'venue';
	if (a.t === 'npc') return `npc.${a.act}`;
	const op = (a as { op?: unknown }).op;
	return typeof op === 'string' && OPS.has(op) ? `${a.t}.${op}` : a.t;
}

const distinct = (r: Record<string, number>) => Object.keys(r).length;
const isEmpty = (o: object) => Object.keys(o).length === 0;

/** 这个动作让玩家第一次走到了漏斗的哪一步（只看结算前后的权威存档，不信客户端） */
export function funnelSteps(before: PlayerState, after: PlayerState): FunnelStep[] {
	const out: FunnelStep[] = [];
	if (distinct(before.visited) <= 1 && distinct(after.visited) > distinct(before.visited)) out.push('travel');
	if (before.workDay === -1 && after.workDay !== -1) out.push('work');
	const realBefore = before.checkins.length > 0 || !isEmpty(before.venueCd);
	const realAfter = after.checkins.length > 0 || !isEmpty(after.venueCd);
	if (!realBefore && realAfter) out.push('real');
	return out;
}

/**
 * 一次动作结算产生的计数：
 * - use.<功能>：使用次数；fail.<类型>：被规则拒绝的次数
 * - eco.in.<类型> / eco.out.<类型>：这次动作让现金多了 / 少了多少（货币投放和回收，给平衡用）
 */
export function actionCounts(a: GameAction, before: PlayerState, after: PlayerState, ok: boolean): Counts {
	const c: Counts = {};
	if (!ok) {
		c['fail.' + a.t] = 1;
		return c;
	}
	c['use.' + featureOf(a)] = 1;
	const d = Math.round(after.cash - before.cash);
	if (Number.isFinite(d) && d > 0) c['eco.in.' + a.t] = d;
	else if (Number.isFinite(d) && d < 0) c['eco.out.' + a.t] = -d;
	return c;
}

// ---------- 客户端上报（只用于界面使用率、报错、性能；留存、漏斗、经济都按服务端结算算，不信客户端） ----------

/** 客户端事件白名单和客户端共用一份 */
export const CLIENT_EVENTS = STAT_EVENTS;
export const BATCH_MAX = 30;
export const STATS_BODY_MAX = 4096;

/** 耗时分档：不存精确毫秒 */
export function perfBucket(ms: number): string {
	if (ms < 1000) return 'lt1s';
	if (ms < 2000) return 'lt2s';
	if (ms < 4000) return 'lt4s';
	if (ms < 8000) return 'lt8s';
	return 'ge8s';
}

/**
 * 校验客户端的一批事件，换成计数。格式 { v: 1, ev: [[名字, 参数?, 毫秒?], ...] }。
 * 不认识的名字、参数一律丢掉（不会把任意字符串写进统计）；整批格式不对返回 null。
 */
export function cleanBatch(raw: unknown): Counts | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const b = raw as { v?: unknown; ev?: unknown };
	if (b.v !== 1 || !Array.isArray(b.ev) || b.ev.length > BATCH_MAX) return null;
	const c: Counts = {};
	for (const e of b.ev) {
		if (!Array.isArray(e) || e.length > 3) continue;
		const [name, arg, ms] = e;
		if (typeof name !== 'string' || !Object.hasOwn(CLIENT_EVENTS, name)) continue;
		const allowed = CLIENT_EVENTS[name];
		let key = 'c.' + name;
		if (allowed) {
			if (typeof arg !== 'string' || !allowed.includes(arg)) continue;
			key += '.' + arg;
		} else if (arg !== undefined && arg !== null) continue;
		if (name === 'perf') {
			if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 600_000) continue;
			key += '.' + perfBucket(ms);
		} else if (ms !== undefined) continue;
		c[key] = (c[key] ?? 0) + 1;
	}
	return c;
}

export function addCounts(into: Counts, add: Counts, maxKeys = STATS_MAX_KEYS): Counts {
	for (const [k, v] of Object.entries(add)) {
		if (!Number.isFinite(v) || v === 0) continue;
		if (!Object.hasOwn(into, k) && Object.keys(into).length >= maxKeys) continue;
		into[k] = (Object.hasOwn(into, k) && Number.isFinite(into[k]) ? into[k] : 0) + v;
	}
	return into;
}

// ---------- 内存缓冲，定时合并落盘 ----------

export interface StatsStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(entries: Record<string, unknown>): Promise<void>;
	list?(opts: { prefix: string }): Promise<Map<string, unknown>>;
	delete?(keys: string[]): Promise<unknown>;
}

/**
 * 计数先攒在内存里，攒够 maxPending 次或距第一笔超过 flushMs（默认 60 秒）才合并写一次（每个现实日一个键）：
 * 不给每个动作多一次存储写入。实例被回收时最多丢最近 flushMs 内的计数（统计可以接受，不影响游戏）。
 * 落盘失败时把这批计数放回去，下次再写。
 */
export class StatsBuffer {
	private pending = new Map<number, Counts>();
	private n = 0;
	private firstAt = 0;
	private chain: Promise<unknown> = Promise.resolve();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private purgedDay = -1;
	private maxDay = -1;

	private storage: StatsStorage;
	private opts: { flushMs?: number; maxPending?: number; now?: () => number };

	constructor(storage: StatsStorage, opts: { flushMs?: number; maxPending?: number; now?: () => number } = {}) {
		this.storage = storage;
		this.opts = opts;
	}

	add(day: number, counts: Counts) {
		if (!Number.isInteger(day) || day < 0 || !counts || Object.keys(counts).length === 0) return;
		if (day > this.maxDay) this.maxDay = day;
		const into = this.pending.get(day) ?? {};
		addCounts(into, counts);
		this.pending.set(day, into);
		const now = (this.opts.now ?? Date.now)();
		if (this.n === 0) this.firstAt = now;
		this.n++;
		if (this.n >= (this.opts.maxPending ?? 200) || now - this.firstAt >= (this.opts.flushMs ?? 60_000)) void this.flush();
		else this.arm();
	}

	private arm() {
		if (this.timer) return;
		this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.flushMs ?? 60_000);
		(this.timer as { unref?: () => void }).unref?.();
	}

	/** 现在缓冲里有没有没落盘的计数（测试用） */
	get size() {
		return this.n;
	}

	/** 合并落盘；顺带清理超过保留期的旧汇总（按见过的最新现实日算，每天最多清一次） */
	flush(): Promise<void> {
		const run = this.chain.then(async () => {
			if (this.timer) { clearTimeout(this.timer); this.timer = null; }
			const batch = this.pending;
			if (batch.size === 0) return;
			this.pending = new Map();
			this.n = 0;
			try {
				const entries: Record<string, unknown> = {};
				for (const [day, add] of batch) {
					const prev = await this.storage.get<Counts>(STATS_PREFIX + day);
					const base: Counts = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : {};
					entries[STATS_PREFIX + day] = addCounts(base, add);
				}
				await this.storage.put(entries);
			} catch {
				// 写失败：放回缓冲，等定时器下次再写（不立即重试，存储一直坏时不会空转）
				for (const [day, add] of batch) {
					this.pending.set(day, addCounts(this.pending.get(day) ?? {}, add));
					this.n++;
				}
				this.arm();
				return;
			}
			if (this.maxDay > this.purgedDay) {
				this.purgedDay = this.maxDay;
				await this.purge(this.maxDay).catch(() => undefined);
			}
		});
		this.chain = run.catch(() => undefined);
		return run;
	}

	/** 删掉超过保留期的汇总 */
	private async purge(today: number) {
		if (!this.storage.list || !this.storage.delete) return;
		const keys = [...(await this.storage.list({ prefix: STATS_PREFIX })).keys()];
		const old = keys.filter((k) => Number(k.slice(STATS_PREFIX.length)) < today - STATS_KEEP_DAYS);
		if (old.length) await this.storage.delete(old);
	}

	/** 读出一段日子的汇总（先把缓冲落盘） */
	async read(from: number, to: number): Promise<Record<string, Counts>> {
		await this.flush();
		const out: Record<string, Counts> = {};
		for (let d = from; d <= to; d++) {
			const v = await this.storage.get<Counts>(STATS_PREFIX + d);
			if (v && typeof v === 'object') out[d] = v;
		}
		return out;
	}
}

/** 合并多个实例读出来的汇总（@SAVES 记服务端结算的，@STATS 记客户端上报的） */
export function mergeDays(...parts: Record<string, Counts>[]): Record<string, Counts> {
	const out: Record<string, Counts> = {};
	for (const p of parts) for (const [d, c] of Object.entries(p ?? {})) out[d] = addCounts(out[d] ?? {}, c, Infinity);
	return out;
}

/** 查询区间最多跨多少天 */
export const READ_MAX_DAYS = 120;
