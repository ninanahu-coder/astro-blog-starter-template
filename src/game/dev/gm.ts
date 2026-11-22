// GM 控制台的核心（平衡调试工具，仅开发用，设计见 docs/earth-game/balance-tools.md §4）。
//
// 只给两个入口用：命令行 tools/earth/gm/gm.ts、只在 `astro dev` 注入的沙盒页 /earth/gm（tools/earth/gm/integration.mjs）。
// 线上的页面、Worker、Durable Object 一律不得 import 本目录：tests/earth/gm.test.ts 会真的跑一次生产构建，
// 确认产物里没有 GM_MARKER，也没有 /earth/gm 路由。
//
// 这些函数和 core 一样是纯函数：不改入参，返回新存档。它们**绕过规则**直接改存档，所以只作用于本地沙盒存档，
// 不接服务端：服务端是权威结算（AGENTS.md 审查第 4 条），GM 改出来的存档不能、也不会被同步上云。
import { applyAction } from '../core/actions.ts';
import { sanitizeState } from '../core/character.ts';
import { getPendingEvent } from '../core/engine.ts';
import { dateLabel, hourOf } from '../core/time.ts';
import type { PlayerState, Region } from '../core/types.ts';
import { EVENTS } from '../data/events.ts';

/** 构建产物里搜这个字符串：出现就说明 GM 代码被打进了生产包 */
export const GM_MARKER = '__earth_gm_console__';

export interface GmResult {
	ok: boolean;
	state: PlayerState;
	msg: string;
}

const MAX_CASH = 1e9;

/** 「春季第 3 天 14:05」：日期加时刻 */
export const gmWhen = (clock: number) => `${dateLabel(clock)} ${String(hourOf(clock)).padStart(2, '0')}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
/** 一次「快进」最多 60 个游戏日：再长的模拟用 npm run earth:sim */
export const MAX_PASS_MINUTES = 60 * 1440;

function done(prev: PlayerState, next: PlayerState, region: Region, msg: string): GmResult {
	// 改完再过一遍存档校验：GM 也不能造出校验不认的存档
	const clean = sanitizeState({ ...next, journal: [...next.journal, { t: next.clock, text: `[GM] ${msg}` }].slice(-200) }, new Set(region.locations.map((l) => l.id)));
	if (!clean) return { ok: false, state: prev, msg: `改完的存档不合法，已放弃：${msg}` };
	return { ok: true, state: clean, msg };
}

/** 把现金改成指定值（钳在 0 到 10 亿之间，取整） */
export function gmSetCash(s: PlayerState, region: Region, cash: number): GmResult {
	if (!Number.isFinite(cash)) return { ok: false, state: s, msg: '现金要是数字' };
	const v = Math.round(Math.min(MAX_CASH, Math.max(0, cash)));
	return done(s, { ...s, cash: v }, region, `现金 $${s.cash} → $${v}`);
}

export function gmAddCash(s: PlayerState, region: Region, delta: number): GmResult {
	if (!Number.isFinite(delta)) return { ok: false, state: s, msg: '现金变化要是数字' };
	return gmSetCash(s, region, s.cash + delta);
}

/**
 * 跳时间：直接改时钟，**不结算**这段时间（不扣需求、不收房租、不发工资）。用来看某个时段 / 季节 / 节日的画面和开放规则。
 * 要按规则过这段时间用 gmPass。往回拨可能让冷却之类的记录「在未来」，校验会按存档规则处理。
 */
export function gmSkip(s: PlayerState, region: Region, minutes: number): GmResult {
	if (!Number.isFinite(minutes) || minutes === 0) return { ok: false, state: s, msg: '要跳的时间不能是 0' };
	const clock = Math.max(0, Math.round(s.clock + minutes));
	return done(s, { ...s, clock }, region, `跳时间 ${gmWhen(s.clock)} → ${gmWhen(clock)}（不结算）`);
}

export function gmSetClock(s: PlayerState, region: Region, clock: number): GmResult {
	if (!Number.isFinite(clock) || clock < 0) return { ok: false, state: s, msg: '时钟要是非负数（游戏分钟）' };
	const c = Math.round(clock);
	return done(s, { ...s, clock: c }, region, `时钟 ${gmWhen(s.clock)} → ${gmWhen(c)}（不结算）`);
}

/**
 * 快进：反复做「歇一会儿」，按规则把时间过掉（需求衰减、周租、工资结算都照常）。
 * 中途碰到事件就停下（事件要人选）；歇不了（例如晕倒住院后的状态）也停下。
 */
export function gmPass(s: PlayerState, region: Region, minutes: number): GmResult {
	if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, state: s, msg: '快进的时间要大于 0' };
	if (minutes > MAX_PASS_MINUTES) return { ok: false, state: s, msg: `一次最多快进 ${MAX_PASS_MINUTES / 1440} 天` };
	const end = s.clock + minutes;
	let cur = s;
	let n = 0;
	let stop = '';
	while (cur.clock < end) {
		if (getPendingEvent(cur)) { stop = '，碰到事件停下'; break; }
		const r = applyAction(cur, region, { t: 'activity', id: 'rest' });
		if (!r.ok || r.state.clock <= cur.clock) { stop = `，停下：${r.msg}`; break; }
		cur = r.state;
		n++;
	}
	return done(s, cur, region, `快进 ${gmWhen(s.clock)} → ${gmWhen(cur.clock)}（歇了 ${n} 次${stop}）`);
}

/** 可以触发的事件（引擎能结算的那些） */
export function gmEvents(): { id: string; title: string }[] {
	return EVENTS.map((e) => ({ id: e.id, title: e.title }));
}

/** 让一个事件立刻出现（挂到 pending 上，和到达时抽中一样，由玩家选选项结算） */
export function gmTriggerEvent(s: PlayerState, region: Region, eventId: string): GmResult {
	const ev = EVENTS.find((e) => e.id === eventId);
	if (!ev) return { ok: false, state: s, msg: `没有事件 ${eventId}` };
	if (s.pending) return { ok: false, state: s, msg: `已经有待处理的事件 ${s.pending.eventId}，先选掉它` };
	return done(s, { ...s, pending: { eventId: ev.id } }, region, `触发事件 ${ev.id}（${ev.title}）`);
}

/** 「2d」「3h」「90m」「1d6h」或纯数字（分钟） → 分钟；格式不对返回 NaN */
export function parseDuration(text: string): number {
	const t = text.trim();
	if (/^-?\d+$/.test(t)) return Number(t);
	const m = /^(-)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(t);
	if (!m || !(m[2] || m[3] || m[4])) return NaN;
	const v = Number(m[2] ?? 0) * 1440 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
	return m[1] ? -v : v;
}

/**
 * 执行一条命令（命令行和沙盒页共用）：
 * cash=5000 · cash+=300 · cash-=300 · skip=2d · clock=2000 · pass=1d · event=<id> · choose=<选项序号> · act=<动作 JSON>
 */
export function gmCommand(s: PlayerState, region: Region, cmd: string): GmResult {
	const m = /^([a-z]+)(\+=|-=|=)(.*)$/.exec(cmd.trim());
	if (!m) return { ok: false, state: s, msg: `看不懂的命令：${cmd}` };
	const [, op, eq, arg] = m;
	switch (op) {
		case 'cash':
			return eq === '=' ? gmSetCash(s, region, Number(arg)) : gmAddCash(s, region, (eq === '+=' ? 1 : -1) * Number(arg));
		case 'skip': return gmSkip(s, region, parseDuration(arg));
		case 'clock': return gmSetClock(s, region, Number(arg));
		case 'pass': return gmPass(s, region, parseDuration(arg));
		case 'event': return gmTriggerEvent(s, region, arg.trim());
		case 'choose': {
			const r = applyAction(s, region, { t: 'event', choice: Number(arg) });
			return { ok: r.ok, state: r.ok ? r.state : s, msg: r.msg };
		}
		case 'act': {
			// 按规则做一个普通动作（走 applyAction，和服务端一样）
			let a: unknown;
			try { a = JSON.parse(arg); } catch { return { ok: false, state: s, msg: 'act= 后面要是动作 JSON' }; }
			try {
				const r = applyAction(s, region, a as Parameters<typeof applyAction>[2]);
				return { ok: r.ok, state: r.ok ? r.state : s, msg: r.msg };
			} catch (e) {
				return { ok: false, state: s, msg: `动作出错：${(e as Error).message}` };
			}
		}
		default:
			return { ok: false, state: s, msg: `没有命令 ${op}` };
	}
}
