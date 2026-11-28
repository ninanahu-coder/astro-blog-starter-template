// 随机事件引擎的规则层：条件、冷却、每日上限、防厌倦、事件链、内容校验。
// 纯函数，不读写全局状态，不自己生成随机数——要随机的地方由调用方传进 [0,1) 的数（来自 state.seed）。
// 设计见 docs/earth-game/event-engine.md。
import { WEATHERS } from '../data/weather.ts';
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type { EventMemory, EventStat, GameEvent, Outcome, PlayerState } from './types.ts';

/**
 * 全局防厌倦规则。【待平衡】默认值等于第一版之前的行为（全部关闭），所以现有事件的抽取结果不变；
 * 建议值写在文档 §4.3，等 Codex 跑过平衡模拟再定。
 */
export const EVENT_POLICY: EventPolicy = {
	dailyMax: 0, // 每个游戏日最多几个随机抽中的事件（到达 + 真实地点）；0 = 不限
	repeatGap: 0, // 同一个事件出现后，至少隔几个别的事件才能再出现；0 = 不限
	fatigue: 1, // 最近 fatigueN 个里出现过的事件，权重乘这个数（0..1）；1 = 不衰减
	fatigueN: 8,
};

export interface EventPolicy {
	dailyMax: number;
	repeatGap: number;
	fatigue: number;
	fatigueN: number;
}

/** recent 最多记几个（repeatGap、fatigueN 不能超过它） */
export const RECENT_MAX = 16;
/** 事件是怎么出现的：随机抽中才计入每日总上限 */
export type EventSource = 'random' | 'signature' | 'chain' | 'forced';

const MIN_PER_DAY = 1440;
const dayOfClock = (clock: number) => Math.floor(clock / MIN_PER_DAY);

export function emptyMemory(): EventMemory {
	return { day: -1, rand: 0, today: {}, last: {}, n: {}, recent: [], open: {} };
}

/** 换日：rand、today 只算当天 */
export function memoryOn(mem: EventMemory, clock: number): EventMemory {
	const day = dayOfClock(clock);
	return mem.day === day ? mem : { ...mem, day, rand: 0, today: {} };
}

// ---------- 条件 ----------
const STAT_KEYS: readonly string[] = ['cash', 'health', 'respect', 'heat', ...NEED_KEYS, ...SKILL_KEYS];

export function statValue(state: PlayerState, key: EventStat): number {
	switch (key) {
		case 'cash': case 'health': case 'respect': case 'heat': return state[key];
		default: return (NEED_KEYS as readonly string[]).includes(key) ? state.needs[key as keyof PlayerState['needs']] : state.skills[key as keyof PlayerState['skills']];
	}
}

/** 属性、关系、物品条件（need）是否满足；没写 need 永远满足 */
export function needMet(ev: GameEvent, state: PlayerState): boolean {
	const need = ev.need;
	if (!need) return true;
	for (const [k, v] of Object.entries(need.min ?? {})) if (statValue(state, k as EventStat) < v!) return false;
	for (const [k, v] of Object.entries(need.max ?? {})) if (statValue(state, k as EventStat) > v!) return false;
	for (const r of need.rel ?? []) {
		const score = state.relations[r.npc]?.score ?? 0;
		if (r.min !== undefined && score < r.min) return false;
		if (r.max !== undefined && score > r.max) return false;
	}
	for (const id of need.items ?? []) if (!((state.inventory[id] ?? 0) >= 1)) return false;
	return true;
}

/** 冷却、每日次数、总次数、链式解锁、不重复：这个事件此刻能不能进池（mem 要先 memoryOn 换过日） */
export function eventReady(ev: GameEvent, mem: EventMemory, clock: number, policy: EventPolicy = EVENT_POLICY): boolean {
	if (ev.locked) {
		const at = mem.open[ev.id];
		if (at === undefined) return false;
		if (ev.unlockDays !== undefined && clock - at > ev.unlockDays * MIN_PER_DAY) return false;
	}
	if (ev.cooldown !== undefined && mem.last[ev.id] !== undefined && clock - mem.last[ev.id] < ev.cooldown * 60) return false;
	if (ev.daily !== undefined && (mem.today[ev.id] ?? 0) >= ev.daily) return false;
	if (ev.max !== undefined && (mem.n[ev.id] ?? 0) >= ev.max) return false;
	if (policy.repeatGap > 0 && mem.recent.slice(-policy.repeatGap).includes(ev.id)) return false;
	return true;
}

/** 当天随机事件是不是已经到全局上限 */
export function dailyFull(mem: EventMemory, policy: EventPolicy = EVENT_POLICY): boolean {
	return policy.dailyMax > 0 && mem.rand >= policy.dailyMax;
}

/** 抽取权重：最近出现过的打折（防厌倦）；policy.fatigue 为 1 时就是 ev.weight 本身 */
export function weightOf(ev: GameEvent, mem: EventMemory, policy: EventPolicy = EVENT_POLICY): number {
	if (policy.fatigue >= 1 || !mem.recent.slice(-policy.fatigueN).includes(ev.id)) return ev.weight;
	return ev.weight * Math.max(0, policy.fatigue);
}

/**
 * 按权重抽一个。r 是调用方给的 [0,1) 随机数。
 * 累减的写法和第一版之前逐字一致（浮点误差也一样），保证同一个种子抽到同一个事件。
 */
export function weightedPick<T>(pool: T[], weights: number[], r: number): T {
	let left = r * weights.reduce((s, w) => s + w, 0);
	for (let i = 0; i < pool.length; i++) if ((left -= weights[i]) <= 0) return pool[i];
	return pool[pool.length - 1];
}

/** 解锁了的链式事件里先出哪一个：最早解锁的；同时解锁的按数据顺序。不用随机数 */
export function pickChain(pool: GameEvent[], mem: EventMemory): GameEvent | null {
	let best: GameEvent | null = null;
	for (const ev of pool) if (ev.locked && (!best || mem.open[ev.id] < mem.open[best.id])) best = ev;
	return best;
}

// ---------- 记录 ----------
/** 事件出现（挂成 pending）时记一笔。返回新的记录，不改入参 */
export function noteTriggered(mem0: EventMemory, ev: GameEvent, clock: number, source: EventSource): EventMemory {
	const mem = memoryOn(mem0, clock);
	const out: EventMemory = { ...mem, recent: [...mem.recent, ev.id].slice(-RECENT_MAX) };
	if (source === 'random') out.rand = mem.rand + 1;
	if (ev.daily !== undefined) out.today = { ...mem.today, [ev.id]: (mem.today[ev.id] ?? 0) + 1 };
	if (ev.cooldown !== undefined) out.last = { ...mem.last, [ev.id]: clock };
	if (ev.max !== undefined) out.n = { ...mem.n, [ev.id]: (mem.n[ev.id] ?? 0) + 1 };
	if (ev.locked && ev.id in mem.open) {
		const { [ev.id]: _used, ...rest } = mem.open;
		out.open = rest;
	}
	return out;
}

/** 结算到某个结果时记一笔：解锁后续事件（已经解锁的不刷新时间，免得反复选同一项把它一直续着） */
export function noteResolved(mem: EventMemory, outcome: Outcome, clock: number): EventMemory {
	if (!outcome.unlocks?.length) return mem;
	const open = { ...mem.open };
	for (const id of outcome.unlocks) if (!(id in open)) open[id] = clock;
	return { ...mem, open };
}

// ---------- 存档清洗（save-sync.md §5） ----------
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const nat = (x: unknown, max: number): number | undefined =>
	typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), max) : undefined;

function cleanCounts(raw: unknown, ok: (id: string) => boolean, max: number): Record<string, number> {
	const out: Record<string, number> = {};
	if (!isObj(raw)) return out;
	for (const [k, v] of Object.entries(raw)) {
		const n = nat(v, max);
		if (n !== undefined && ok(k)) out[k] = n;
	}
	return out;
}

/**
 * 清洗存档里的 evMem：旧存档没有就给空记录；只留现在还有、而且写了对应规则的事件；
 * 游戏分钟不能晚于存档的 clock；对任何输入都不抛异常，幂等。
 */
export function cleanEvMem(raw: unknown, events: readonly GameEvent[], clock: number): EventMemory {
	if (!isObj(raw)) return emptyMemory();
	const by = new Map(events.map((e) => [e.id, e]));
	const has = (rule: 'daily' | 'cooldown' | 'max') => (id: string) => by.get(id)?.[rule] !== undefined;
	const today = dayOfClock(clock);
	const day = nat(raw.day, Infinity);
	const sameDay = day === today;
	return {
		day: day !== undefined && day <= today ? day : -1,
		rand: sameDay ? (nat(raw.rand, 1000) ?? 0) : 0,
		today: sameDay ? cleanCounts(raw.today, has('daily'), 1000) : {},
		last: cleanCounts(raw.last, has('cooldown'), clock),
		n: cleanCounts(raw.n, has('max'), 1e6),
		recent: Array.isArray(raw.recent) ? raw.recent.filter((x): x is string => typeof x === 'string' && by.has(x)).slice(-RECENT_MAX) : [],
		open: cleanCounts(raw.open, (id) => !!by.get(id)?.locked, clock),
	};
}

// ---------- 内容校验 ----------
const EVENT_KEYS = new Set([
	'id', 'title', 'icon', 'text', 'weight', 'choices', 'locs', 'tags', 'kinds', 'arrivedBy', 'venueTypes', 'seasons', 'weather', 'periods', 'hours',
	'once', 'animal', 'breakdown', 'need', 'cooldown', 'daily', 'max', 'locked', 'unlockDays',
	'driving', // 法律（第 43 批）：只在自己开车抵达时出现
	'exposure', // 保险（第 43 批）：'home' 只在回到自己住处时出现
]);
// risk（选项按几率出 fail）、law（结果带法律后果）来自法律（第 43 批，core/law.ts）
const CHOICE_KEYS = new Set(['label', 'cost', 'check', 'risk', 'exposed', 'ok', 'fail']);
const OUTCOME_KEYS = new Set(['text', 'fx', 'unlocks', 'then', 'law']);
const NEED_FIELDS = new Set(['min', 'max', 'rel', 'items']);
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const PERIODS = ['dawn', 'day', 'dusk', 'night'];

const nonEmpty = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
const strList = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every(nonEmpty);
const posNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const posInt = (x: unknown) => posNum(x) && Number.isInteger(x);

/**
 * 内容作者用的校验：返回所有问题（每条带事件 id），空数组为通过。
 * 只查事件数据本身能判断的东西；地点、NPC、物品、心情等外部 id 由测试按世界数据另查（见 tests/earth/event-engine.test.ts），
 * 免得首屏为了校验引入地图数据。
 */
export function validateEvents(list: readonly GameEvent[]): string[] {
	const errs: string[] = [];
	const ids = new Map<string, GameEvent>();
	for (const ev of list) {
		if (!ev || typeof ev !== 'object') { errs.push('有一条事件不是对象'); continue; }
		if (ids.has(ev.id)) errs.push(`${ev.id}：id 重复`);
		ids.set(ev.id, ev);
	}
	const weatherIds = new Set(WEATHERS.map((w) => w.id));
	const unlockedBy = new Set<string>();
	const thenOf = new Map<string, string[]>();
	for (const ev of list) {
		if (!ev || typeof ev !== 'object') continue;
		const e = (msg: string) => errs.push(`${ev.id ?? '(没有 id)'}：${msg}`);
		if (typeof ev.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(ev.id)) e('id 只能用小写字母、数字和连字符，最长 64');
		for (const k of Object.keys(ev)) if (!EVENT_KEYS.has(k)) e(`不认识的字段「${k}」（拼错了？）`);
		for (const k of ['title', 'icon', 'text'] as const) if (!nonEmpty(ev[k])) e(`缺少 ${k}`);
		if (typeof ev.weight !== 'number' || !Number.isFinite(ev.weight) || ev.weight < 0) e('weight 必须是 ≥ 0 的数');
		for (const k of ['locs', 'tags', 'kinds', 'arrivedBy', 'venueTypes'] as const) if (ev[k] !== undefined && !strList(ev[k])) e(`${k} 必须是非空字符串数组`);
		if (ev.seasons !== undefined && !(strList(ev.seasons) && ev.seasons.every((s) => SEASONS.includes(s)))) e(`seasons 只能是 ${SEASONS.join('/')}`);
		if (ev.periods !== undefined && !(strList(ev.periods) && ev.periods.every((p) => PERIODS.includes(p)))) e(`periods 只能是 ${PERIODS.join('/')}`);
		if (ev.weather !== undefined && !(strList(ev.weather) && ev.weather.every((w) => weatherIds.has(w)))) e(`weather 只能是 ${[...weatherIds].join('/')}`);
		if (ev.hours !== undefined && !(Array.isArray(ev.hours) && ev.hours.length === 2 && ev.hours.every((h) => Number.isInteger(h) && h >= 0 && h <= 24))) e('hours 必须是 [开, 关] 两个 0–24 的整点');
		if (ev.venueTypes && (ev.locs || ev.tags || ev.kinds || ev.arrivedBy)) e('真实地点事件（venueTypes）不按城镇匹配，不能同时写 locs/tags/kinds/arrivedBy');
		if (ev.breakdown && ev.weight !== 0) e('抛锚事件 weight 必须写 0（只在抛锚时抽）');
		if (ev.driving !== undefined && ev.driving !== true) e('driving 只能写 true');
		if (ev.driving && ev.venueTypes) e('driving 事件是开车抵达城镇时的事，不能写 venueTypes');
		if (ev.exposure !== undefined && ev.exposure !== 'home') e('exposure 只能写 home');
		if (ev.exposure && ev.venueTypes) e('exposure 事件是回到自己住处时的事，不能写 venueTypes');
		if (ev.once && ev.locked) e('once 和 locked 不能同时写：签名事件首次到访必出，链式事件要解锁才出');
		if (ev.unlockDays !== undefined && !ev.locked) e('unlockDays 只对 locked 事件有意义');
		if (ev.cooldown !== undefined && !posNum(ev.cooldown)) e('cooldown（游戏小时）必须 > 0');
		if (ev.unlockDays !== undefined && !posNum(ev.unlockDays)) e('unlockDays 必须 > 0');
		if (ev.daily !== undefined && !posInt(ev.daily)) e('daily 必须是正整数');
		if (ev.max !== undefined && !posInt(ev.max)) e('max 必须是正整数');
		if (ev.need !== undefined) {
			const n = ev.need;
			if (!isObj(n as unknown)) e('need 必须是对象');
			else {
				for (const k of Object.keys(n)) if (!NEED_FIELDS.has(k)) e(`need 里不认识的字段「${k}」`);
				for (const side of ['min', 'max'] as const) {
					if (n[side] === undefined) continue;
					if (!isObj(n[side] as unknown)) { e(`need.${side} 必须是对象`); continue; }
					for (const [k, v] of Object.entries(n[side]!)) {
						if (!STAT_KEYS.includes(k)) e(`need.${side} 里「${k}」不是可比较的数值（${STAT_KEYS.join('/')}）`);
						if (typeof v !== 'number' || !Number.isFinite(v)) e(`need.${side}.${k} 必须是数`);
					}
				}
				for (const [k, lo] of Object.entries(n.min ?? {})) {
					const hi = n.max?.[k as EventStat];
					if (hi !== undefined && lo! > hi) e(`need.min.${k} 大于 need.max.${k}，永远不会出现`);
				}
				if (n.rel !== undefined) {
					if (!Array.isArray(n.rel) || !n.rel.length) e('need.rel 必须是非空数组');
					else for (const r of n.rel) {
						if (!isObj(r as unknown) || !nonEmpty(r.npc)) { e('need.rel 每项要写 npc'); continue; }
						if (r.min === undefined && r.max === undefined) e(`need.rel ${r.npc} 至少写 min 或 max`);
						if (r.min !== undefined && r.max !== undefined && r.min > r.max) e(`need.rel ${r.npc} 的 min 大于 max`);
					}
				}
				if (n.items !== undefined && !strList(n.items)) e('need.items 必须是非空字符串数组');
			}
		}
		if (!Array.isArray(ev.choices) || ev.choices.length === 0) { e('至少要有一个选项'); continue; }
		ev.choices.forEach((c, i) => {
			const ce = (msg: string) => e(`选项 ${i + 1}：${msg}`);
			if (!isObj(c)) { ce('不是对象'); return; }
			for (const k of Object.keys(c)) if (!CHOICE_KEYS.has(k)) ce(`不认识的字段「${k}」`);
			if (!nonEmpty(c.label)) ce('缺少 label');
			if (c.cost !== undefined && !posNum(c.cost)) ce('cost 必须 > 0');
			if (c.check !== undefined && !((SKILL_KEYS as readonly string[]).includes(c.check?.skill) && Number.isFinite(c.check?.dc))) ce(`check 要写 skill（${SKILL_KEYS.join('/')}）和 dc`);
			if (c.risk !== undefined && !(typeof c.risk === 'number' && c.risk > 0 && c.risk < 1)) ce('risk 必须是 0 到 1 之间（不含两端）的几率');
			if (c.risk !== undefined && c.fail === undefined) ce('写了 risk 却没有 fail，被查到时没有结果');
			if (c.fail !== undefined && !c.check && c.risk === undefined) ce('有 fail 却没有 check 或 risk，fail 永远用不上');
			if (c.exposed !== undefined && c.exposed !== 'sea') ce('exposed 只能是 sea');
			for (const [name, o] of [['ok', c.ok], ['fail', c.fail]] as const) {
				if (o === undefined) { if (name === 'ok') ce('缺少 ok'); continue; }
				if (!isObj(o)) { ce(`${name} 不是对象`); continue; }
				for (const k of Object.keys(o)) if (!OUTCOME_KEYS.has(k)) ce(`${name} 里不认识的字段「${k}」`);
				if (!nonEmpty(o.text)) ce(`${name} 缺少 text`);
				if (!isObj(o.fx)) ce(`${name} 缺少 fx（没有效果写 {}）`);
				// law 的取值（违章 id 或 breath）由测试按 data/law.ts 另查，和地点、NPC 一样
				if (o.law !== undefined && !nonEmpty(o.law)) ce(`${name}.law 必须是违章 id 或 breath`);
				if (o.unlocks !== undefined) {
					if (!strList(o.unlocks)) ce(`${name}.unlocks 必须是非空字符串数组`);
					else for (const id of o.unlocks) {
						const t = ids.get(id);
						if (!t) ce(`${name}.unlocks 指向不存在的事件 ${id}`);
						else if (!t.locked) ce(`${name}.unlocks 指向的 ${id} 不是 locked 事件（不用解锁本来就会出现）`);
						unlockedBy.add(id);
					}
				}
				if (o.then !== undefined) {
					if (!nonEmpty(o.then) || !ids.has(o.then)) ce(`${name}.then 指向不存在的事件 ${String(o.then)}`);
					else thenOf.set(ev.id, [...(thenOf.get(ev.id) ?? []), o.then]);
				}
			}
		});
		if (ev.choices.every((c) => isObj(c) && c.exposed === 'sea')) e('所有选项都要下海：风暴天会卡住，至少留一个不下海的');
		// 事件弹出后别的动作都被挡住，钱不够又选不了收费选项：没钱的玩家会卡死（v106，酒庄品酒出过这个问题）
		if (ev.choices.every((c) => isObj(c) && c.cost !== undefined)) e('所有选项都要花钱：现金不够的玩家会卡住，至少留一个不花钱的');
	}
	for (const ev of list) if (ev?.locked && !unlockedBy.has(ev.id)) errs.push(`${ev.id}：locked 事件没有任何结果解锁它，永远不会出现`);
	// then 不能绕成圈：玩家会被一串弹窗困住
	const state = new Map<string, 1 | 2>();
	const visit = (id: string, path: string[]): void => {
		if (state.get(id) === 2) return;
		if (state.get(id) === 1) { errs.push(`${id}：then 绕成了圈（${[...path, id].join(' → ')}）`); return; }
		state.set(id, 1);
		for (const next of thenOf.get(id) ?? []) visit(next, [...path, id]);
		state.set(id, 2);
	};
	for (const id of thenOf.keys()) visit(id, []);
	return errs;
}

/** 加载时调用：数据有问题直接报错，列出全部问题（npm test 会在合并前跑到） */
export function assertEvents(list: readonly GameEvent[]): void {
	const errs = validateEvents(list);
	if (errs.length) throw new Error(`事件数据有 ${errs.length} 处问题：\n- ${errs.join('\n- ')}`);
}
