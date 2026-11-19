// 犯罪、罚款和法律后果（第 43 批，设计见 docs/earth-game/law.md）。
// 只读的函数是纯函数；名字以 apply/pay/serve/law 开头的函数原地修改传入的 state（调用方传的是 clone），和 engine.ts 的约定一致。
import { COMMUNITY_SERVICE, DEMERITS, DRINK, FINE_DEBT, getOffence, HEAT_RULES, OFFENCES, VISA_NOTE, VISA_ORIGINS, type LawRegion, type Penalty } from '../data/law.ts';
import { heatMult } from './attributes.ts';
import { dayOf } from './time.ts';
import type { LawRecord, PlayerState } from './types.ts';

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
/** 违章记录最多留几条（够算 3 年内的扣分，又不让存档变大） */
export const LAW_HIST_MAX = 30;
const OWED_MAX = 1e6;
const CS_MAX = 500;

export const emptyLaw = (): LawRecord => ({ hist: [], ban: 0, owed: 0, cs: 0, csDue: -1, record: 0, drank: -1 });

const finite = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/**
 * 清洗存档里的 law（规范见 save-sync.md §5.1）：旧存档没有就给空记录；不抛异常；幂等。
 * clock 是存档的游戏时钟：违章时间不能晚于现在，停驾到期不能超过现在 + 最长停驾。
 */
export function cleanLaw(r: unknown, clock: number): LawRecord {
	// 只认自有属性：原型链上的键（Object.create({ ban: … })）不算
	const src = r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
	const raw: Record<string, unknown> = {};
	for (const k of ['hist', 'ban', 'owed', 'cs', 'csDue', 'record', 'drank']) if (Object.hasOwn(src, k)) raw[k] = src[k];
	const hist: LawRecord['hist'] = [];
	if (Array.isArray(raw.hist)) {
		for (const h of raw.hist.slice(-LAW_HIST_MAX)) {
			if (!h || typeof h !== 'object') continue;
			const { t, id, n } = h as Record<string, unknown>;
			if (typeof id !== 'string' || !getOffence(id) || typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > clock) continue;
			hist.push({ t: Math.floor(t), id, n: Math.floor(finite(n, 0, 20, 0)) });
		}
	}
	const maxBan = clock + Math.max(DEMERITS.banDays, ...OFFENCES.flatMap((o) => [o.wa.banDays ?? 0, o.sa.banDays ?? 0])) * 1440;
	const ban = Math.floor(finite(raw.ban, 0, maxBan, 0));
	const cs = Math.round(finite(raw.cs, 0, CS_MAX, 0) * 10) / 10;
	return {
		hist,
		ban: ban > clock ? ban : 0,
		owed: Math.round(finite(raw.owed, 0, OWED_MAX, 0)),
		cs,
		csDue: cs > 0 ? Math.floor(finite(raw.csDue, 0, dayOf(clock) + COMMUNITY_SERVICE.dueDays, dayOf(clock) + COMMUNITY_SERVICE.dueDays)) : -1,
		record: Math.floor(finite(raw.record, 0, 1000, 0)),
		drank: (() => {
			const d = typeof raw.drank === 'number' && Number.isFinite(raw.drank) ? Math.floor(raw.drank) : -1;
			return d >= 0 && d <= clock && clock - d < DRINK.windowMin ? d : -1; // 未来的不认；过了窗口就没用了，清掉保持规范形式
		})(),
	};
}

// ---------- 只读 ----------
export const lawRegion = (state: PlayerState): LawRegion => (state.region === 'sa' ? 'sa' : 'wa');
export const penaltyFor = (state: PlayerState, id: string): Penalty | undefined => getOffence(id)?.[lawRegion(state)];

/** 3 年内的扣分合计 */
export function demeritTotal(state: PlayerState): number {
	const from = state.clock - DEMERITS.windowDays * 1440;
	return state.law.hist.reduce((s, h) => s + (h.t > from ? h.n : 0), 0);
}

export const licenceBanned = (state: PlayerState) => state.law.ban > state.clock;
/** 停驾还剩几天（向上取整），没停驾为 0 */
export const banDaysLeft = (state: PlayerState) => (licenceBanned(state) ? Math.ceil((state.law.ban - state.clock) / 1440) : 0);

/** 刚喝过酒（窗口内开车遇到呼气测试会超标） */
export const drankRecently = (state: PlayerState) => state.law.drank >= 0 && state.clock - state.law.drank < DRINK.windowMin;

/** 3 年内有没有酒驾记录（再犯走法庭） */
const drinkBefore = (state: PlayerState) => {
	const from = state.clock - DEMERITS.windowDays * 1440;
	return state.law.hist.some((h) => h.t > from && (h.id === 'drink-low' || h.id === 'drink-repeat'));
};

/** 持签证的出身、有法庭定罪记录时的签证提示；没有返回 null */
export const visaNote = (state: PlayerState): string | null => (VISA_ORIGINS.includes(state.origin) && state.law.record > 0 ? VISA_NOTE : null);

/** 界面用的汇总 */
export function lawSummary(state: PlayerState) {
	return {
		pts: demeritTotal(state),
		limit: DEMERITS.limit,
		banDays: banDaysLeft(state),
		owed: state.law.owed,
		cs: state.law.cs,
		csDue: state.law.csDue,
		record: state.law.record,
		drank: drankRecently(state),
		visa: visaNote(state),
	};
}

// ---------- 结算（原地修改） ----------
/** 交罚款：现金不够的部分记成欠款。返回当场交了多少 */
export function payFine(state: PlayerState, amount: number): number {
	const paid = Math.min(state.cash, amount);
	state.cash = Math.round(state.cash - paid);
	state.law.owed = Math.min(OWED_MAX, Math.round(state.law.owed + amount - paid));
	return paid;
}

/** 麻烦值上涨统一走这里：× 特质系数（守规矩 0.5、胆大包天 1.5） */
export function addHeat(state: PlayerState, d: number) {
	if (d > 0) state.heat = clamp100(state.heat + d * heatMult(state));
}

/**
 * 记一次违法：罚款（不够的记欠款）、扣分、麻烦值、停驾；走法庭的另加定罪记录和社区服务。
 * 3 年内第二次酒驾自动升级为「酒驾再犯」。扣分到上限另外停驾，扣分清零（分数已经「用掉」）。
 * 返回给玩家看的一句话。
 */
export function applyOffence(state: PlayerState, offenceId: string): string {
	let id = offenceId;
	if (id === 'drink-low' && drinkBefore(state)) id = 'drink-repeat';
	const o = getOffence(id);
	if (!o) return '';
	const p = o[lawRegion(state)];
	const parts: string[] = [];
	const paid = payFine(state, p.fine);
	parts.push(o.court ? `${o.name}：上了地方法院，判罚 $${p.fine.toLocaleString()}` : `${o.name}：罚款 $${p.fine.toLocaleString()}`);
	if (paid < p.fine) parts.push(`现金不够，欠 $${(p.fine - paid).toLocaleString()} 每周结算时补交`);
	if (p.pts) parts.push(`扣 ${p.pts} 分`);
	state.law.hist.push({ t: state.clock, id, n: p.pts });
	if (state.law.hist.length > LAW_HIST_MAX) state.law.hist.splice(0, state.law.hist.length - LAW_HIST_MAX);
	addHeat(state, o.heat);
	if (o.court) {
		state.law.record += 1;
		if (o.csHours) {
			state.law.cs = Math.min(CS_MAX, state.law.cs + o.csHours);
			state.law.csDue = dayOf(state.clock) + COMMUNITY_SERVICE.dueDays;
			parts.push(`另判 ${o.csHours} 小时社区服务，${COMMUNITY_SERVICE.dueDays} 天内做完`);
		}
	}
	if (p.banDays) {
		state.law.ban = Math.max(state.law.ban, state.clock + p.banDays * 1440);
		parts.push(`停驾 ${p.banDays} 天`);
	}
	if (demeritTotal(state) >= DEMERITS.limit) {
		state.law.ban = Math.max(state.law.ban, state.clock + DEMERITS.banDays * 1440);
		for (const h of state.law.hist) h.n = 0;
		parts.push(`3 年内扣满 ${DEMERITS.limit} 分，驾照暂停 ${DEMERITS.banDays} 天`);
	}
	const visa = o.court ? visaNote(state) : null;
	return `${parts.join('，')}。${visa ? `（${visa}）` : ''}`;
}

/** 随机呼气测试：窗口内喝过酒就按酒驾处理，否则通过。返回结果文字 */
export function breathTest(state: PlayerState): string {
	if (!drankRecently(state)) return '读数为零。';
	return `读数超标。${applyOffence(state, 'drink-low')}`;
}

/** 事件结果里的法律后果：违章 id，或 'breath'（呼气测试） */
export function applyLawOutcome(state: PlayerState, lawId: string): string {
	return lawId === 'breath' ? breathTest(state) : applyOffence(state, lawId);
}

/** 时间流逝时的麻烦值冷却（不乘特质系数，冷却对谁都一样） */
export function heatCooldown(state: PlayerState, minutes: number) {
	if (minutes > 0 && state.heat > 0) state.heat = clamp100(state.heat - (minutes * HEAT_RULES.coolPerHour) / 60);
}

/** 做了喝酒的活动 */
export function noteDrink(state: PlayerState, activityId: string) {
	if (DRINK.activities.includes(activityId)) state.law.drank = state.clock;
}

/** 做社区服务：抵掉 hours 小时；做完清掉期限。返回剩余小时 */
export function serveCommunity(state: PlayerState, hours: number): number {
	state.law.cs = Math.max(0, Math.round((state.law.cs - hours) * 10) / 10);
	if (state.law.cs === 0) state.law.csDue = -1;
	return state.law.cs;
}

/** 周结算：补交欠款；还欠着、或社区服务逾期，麻烦值上涨（逾期后期限顺延）。返回日志 */
export function lawWeekly(state: PlayerState): string[] {
	const out: string[] = [];
	if (state.law.owed > 0) {
		const paid = Math.min(state.cash, state.law.owed);
		state.cash = Math.round(state.cash - paid);
		state.law.owed -= paid;
		if (paid) out.push(`周结算：补交罚款 $${paid.toLocaleString()}。`);
		if (state.law.owed > 0) {
			addHeat(state, FINE_DEBT.overdueHeat);
			out.push(`还欠 $${state.law.owed.toLocaleString()} 罚款没交，麻烦值上涨。`);
		}
	}
	if (state.law.cs > 0 && state.law.csDue >= 0 && dayOf(state.clock) > state.law.csDue) {
		addHeat(state, COMMUNITY_SERVICE.overdueHeat);
		state.law.csDue = dayOf(state.clock) + COMMUNITY_SERVICE.dueDays;
		out.push(`社区服务逾期，还差 ${state.law.cs} 小时，期限顺延，麻烦值上涨。`);
	}
	return out;
}
