// 匿名统计的客户端（设计见 docs/earth-game/analytics.md）：
// 只上报白名单里的事件（打开过哪个页面、报错类别、加载耗时），不带玩家 id、名字、同步码、坐标、任何自由文本。
// 攒一批再发、断网时排在本机，发送失败不影响游戏；设置里关掉后立刻清空排队、不再发送，服务端也不再按这名玩家的动作记统计。
// 不引用 DOM：存储、发送、时间、随机数都由调用方传进来，方便测试。

/** 开关：'1' 开、'0' 关；没设过时按浏览器的「全局隐私控制 / 请勿跟踪」决定默认值 */
export const STATS_PREF_KEY = 'earth.stats.v1';
/** 本机排队（离线时攒着的事件） */
export const STATS_QUEUE_KEY = 'earth.statsq.v1';
export const QUEUE_CAP = 100;
export const SEND_BATCH = 30;
/** 性能事件按会话抽样：每 4 个会话里 1 个上报加载耗时（分析时乘回 4） */
export const PERF_SAMPLE = 0.25;
/** 同一种报错每个会话最多报几次 */
export const ERR_PER_SESSION = 3;
/** 每种耗时每个会话最多报几次（接口耗时每次请求都会测，只取前几次） */
export const PERF_PER_SESSION = 5;

const TABS = ['place', 'near', 'go', 'grow', 'me', 'social'];
const METABS = ['overview', 'assets', 'people', 'log', 'news', 'sync'];
const ERRORS = ['js', 'promise', 'net', 'api4xx', 'api5xx', 'ws'];
const PERF = ['load', 'api'];
/** 客户端事件白名单：名字 -> 允许的参数（null 表示不带参数）。服务端用同一份表校验（stats.ts） */
export const STAT_EVENTS: Record<string, readonly string[] | null> = { session: null, tab: TABS, metab: METABS, err: ERRORS, perf: PERF };

export type StatEvent = [string] | [string, string] | [string, string, number];

export interface NavPrivacy {
	globalPrivacyControl?: unknown;
	doNotTrack?: unknown;
}

/** 浏览器开了「全局隐私控制」或「请勿跟踪」时默认关闭，否则默认开启 */
export function statsDefault(nav: NavPrivacy | undefined): boolean {
	if (!nav) return true;
	return !(nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes');
}

export function parseStatsPref(raw: string | null, nav: NavPrivacy | undefined): boolean {
	if (raw === '1') return true;
	if (raw === '0') return false;
	return statsDefault(nav);
}

/** 本机排队读回来当不可信数据：只留格式对、在白名单里的事件 */
export function validEvent(e: unknown): e is StatEvent {
	if (!Array.isArray(e) || e.length < 1 || e.length > 3 || typeof e[0] !== 'string' || !Object.hasOwn(STAT_EVENTS, e[0])) return false;
	const allowed = STAT_EVENTS[e[0]];
	if (!allowed) return e.length === 1;
	if (typeof e[1] !== 'string' || !allowed.includes(e[1])) return false;
	if (e[0] === 'perf') return e.length === 3 && typeof e[2] === 'number' && Number.isFinite(e[2]) && e[2] >= 0 && e[2] <= 600_000;
	return e.length === 2;
}

export function parseStatsQueue(raw: string | null): StatEvent[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter(validEvent).slice(-QUEUE_CAP) : [];
	} catch {
		return [];
	}
}

export interface TelemetryDeps {
	enabled: () => boolean;
	/** 发出一批（JSON 字符串）；成功返回 true。抛错、返回 false 都当失败，留着下次再发 */
	send: (body: string) => Promise<boolean>;
	store: { get(k: string): string | null; set(k: string, v: string): void };
	random?: () => number;
}

export class Telemetry {
	private queue: StatEvent[];
	private sending = false;
	private seen = new Set<string>(); // 本会话已经记过的页面（使用率按会话算，一个会话每页只记一次）
	private errs = new Map<string, number>(); // 本会话每种报错、耗时已经记了几次
	readonly perfOn: boolean;

	private d: TelemetryDeps;

	constructor(d: TelemetryDeps) {
		this.d = d;
		this.queue = d.enabled() ? parseStatsQueue(d.store.get(STATS_QUEUE_KEY)) : [];
		if (!d.enabled()) this.d.store.set(STATS_QUEUE_KEY, '[]');
		this.perfOn = (d.random ?? Math.random)() < PERF_SAMPLE;
	}

	get pending(): readonly StatEvent[] {
		return this.queue;
	}

	/** 记一个事件：关着时什么都不做；不在白名单里的直接丢掉。任何异常都吞掉 */
	track(name: string, arg?: string, ms?: number) {
		try {
			if (!this.d.enabled()) return;
			const e = (arg === undefined ? [name] : ms === undefined ? [name, arg] : [name, arg, Math.round(ms)]) as StatEvent;
			if (!validEvent(e)) return;
			if (name === 'tab' || name === 'metab' || name === 'session') {
				const k = name + ':' + (arg ?? '');
				if (this.seen.has(k)) return;
				this.seen.add(k);
			}
			if (name === 'perf' && !this.perfOn) return;
			if (name === 'err' || name === 'perf') {
				const k = name + ':' + arg;
				const n = this.errs.get(k) ?? 0;
				if (n >= (name === 'err' ? ERR_PER_SESSION : PERF_PER_SESSION)) return;
				this.errs.set(k, n + 1);
			}
			this.queue = [...this.queue, e].slice(-QUEUE_CAP);
			this.save();
		} catch {}
	}

	/** 发一批：关着时清空排队、不发；失败的留在本机。永不抛错 */
	async flush(): Promise<void> {
		if (!this.d.enabled()) {
			this.clear();
			return;
		}
		if (this.sending || this.queue.length === 0) return;
		this.sending = true;
		const batch = this.queue.slice(0, SEND_BATCH);
		try {
			const ok = await this.d.send(JSON.stringify({ v: 1, ev: batch }));
			// 发送途中被关掉：不管成功与否都已经清空了
			if (ok && this.d.enabled()) {
				this.queue = this.queue.slice(batch.length);
				this.save();
			}
		} catch {
		} finally {
			this.sending = false;
		}
	}

	/** 关掉统计时调用：清空本机排队 */
	clear() {
		this.queue = [];
		this.save();
	}

	private save() {
		try {
			this.d.store.set(STATS_QUEUE_KEY, JSON.stringify(this.queue));
		} catch {}
	}
}
