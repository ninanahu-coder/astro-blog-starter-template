// 健康、疾病和看病的规则（第 1 版）：纯函数，不读时钟、不用 Math.random（随机数由调用方从 state.seed 传进来）。
// 设计说明见 docs/earth-game/health.md；数值和真实规定在 data/health.ts。
//
// 引擎只在三处调用这里：
//   1. advance()：时间流逝后 illnessTick()——病程里的精力、健康消耗，到期痊愈，每过一个午夜掷一次发病；
//   2. applyEffect()：受伤后 injure()——一次掉健康太多记为扭伤；
//   3. 活动 / 上班 / 真实地点训练的可行性检查：illnessBlock()。
// 就医动作 seekCare() 在 engine.ts，结算前用这里的 careOutcome() 算钱和效果。
import type { CoverId } from '../data/health.ts';
import { visaKindNow } from './visa.ts';
import { CARE, CONDITIONS, COVER_BY_ORIGIN, COVERS, ED_WAIT, HEALTH, REAL_FEES, RX_PRICE, type CareDef, type CareKind, type ConditionDef, type CoverDef, type Load } from '../data/health.ts';
import { MOODLETS } from '../data/moodlets.ts';
import { dateOf } from './time.ts';
import { weatherOn } from './weather.ts';
import type { Activity, Effect, GameLocation, PlayerState } from './types.ts';

export type Illness = NonNullable<PlayerState['illness']>;

export const getCondition = (id: string): ConditionDef | undefined => CONDITIONS.find((c) => c.id === id);
export const getCare = (id: string): CareDef | undefined => CARE.find((c) => c.id === id);

/**
 * 玩家的医疗保障。有签证记录（留学生出身）时按签证现在的状态：学生签证 → OSHC，永居 → Medicare，
 * 485、482、491 和过期 → 自费（这些签证真实要求自己买的海外访客保险 OVHC 还没做，见 health.md §3.2，待核实）。
 * 没有签证记录的出身（本地人、背包客等）按 COVER_BY_ORIGIN。合并 main 的签证路线后复核
 */
export function coverOf(state: PlayerState): CoverDef {
	const vk = state.visa && state.visa.kind !== 'none' ? visaKindNow(state) : null;
	const id: CoverId = vk === 'pr' ? 'medicare' : vk === 'student' ? 'oshc' : vk ? 'none' : (COVER_BY_ORIGIN[state.origin] ?? 'none');
	return COVERS.find((c) => c.id === id)!;
}

/** 当前生效的病（已经到期的不算） */
export function currentIllness(state: PlayerState): { ill: Illness; def: ConditionDef } | null {
	const ill = state.illness;
	if (!ill || ill.until <= state.clock) return null;
	const def = getCondition(ill.id);
	return def ? { ill, def } : null;
}

// ---------- 活动限制 ----------
const HEAVY_SKILLS = ['stamina', 'strength', 'swimming'] as const;

/** 一份效果的负荷：精力消耗 ≥ 30 或练体能 / 力量 / 游泳算剧烈（阈值待平衡）；带收入的算上班 */
export function loadOfEffect(fx: Effect, exposed?: 'sea'): Load[] {
	const out: Load[] = [];
	if ((fx.needs?.energy ?? 0) <= -30 || HEAVY_SKILLS.some((k) => (fx.skills?.[k] ?? 0) > 0)) out.push('heavy');
	if (exposed === 'sea') out.push('sea');
	if ((fx.cash ?? 0) > 0) out.push('work');
	return out;
}

export const loadOfActivity = (act: Activity): Load[] => loadOfEffect(act.fx, act.exposed);

const LOAD_TEXT: Record<Load, string> = { heavy: '剧烈运动', sea: '下海', work: '上班' };

/** 生病时这些负荷的事做不了：返回原因；做得了返回 undefined */
export function illnessBlock(state: PlayerState, loads: Load[]): string | undefined {
	const cur = currentIllness(state);
	if (!cur) return undefined;
	const hit = loads.find((l) => cur.def.blocks.includes(l));
	return hit ? `${cur.def.icon} ${cur.def.name}中，不能${LOAD_TEXT[hit]}（还要 ${hoursLeft(state)} 小时）` : undefined;
}

export const hoursLeft = (state: PlayerState) => (state.illness ? Math.max(0, Math.ceil((state.illness.until - state.clock) / 60)) : 0);

// ---------- 发病 ----------
/** 某个游戏日每种病的发病概率（用那一刻的状态和当天所在地的天气） */
export function illnessRisk(state: PlayerState, day: number): Record<string, number> {
	const wx = weatherOn(state.loc, day).id;
	const winter = dateOf(day * 1440).season === 'winter';
	let mult = 1;
	if (state.needs.energy < HEALTH.fatigueAt) mult *= HEALTH.fatigueMult;
	if (state.needs.hunger < HEALTH.hungryAt) mult *= HEALTH.hungryMult;
	if (state.health < HEALTH.weakAt) mult *= HEALTH.weakMult;
	const out: Record<string, number> = {};
	for (const c of CONDITIONS) {
		let p = (HEALTH.base[c.id] ?? 0) + (HEALTH.weather[wx]?.[c.id] ?? 0);
		if (c.id === 'flu' && winter) p += HEALTH.winterFlu;
		if (c.id === 'gastro' && state.needs.hygiene < HEALTH.dirtyAt) p += HEALTH.dirtyGastro;
		if (c.id === 'heat' && ((state.inventory.water ?? 0) > 0 || (state.inventory.electrolyte ?? 0) > 0)) p *= HEALTH.hydrated;
		if (p > 0) out[c.id] = Math.min(0.5, p * mult);
	}
	return out;
}

/** 用一个 [0,1) 随机数从风险表里挑一种病；都没中返回 null */
export function pickIllness(risk: Record<string, number>, r: number): string | null {
	let acc = 0;
	for (const c of CONDITIONS) {
		acc += risk[c.id] ?? 0;
		if (r < acc) return c.id;
	}
	return null;
}

/** 开始生病（原地修改）：记下病、挂上心情状态、写日志由调用方做 */
export function startIllness(state: PlayerState, id: string, at = state.clock) {
	const def = getCondition(id);
	if (!def) return;
	state.illness = { id, since: at, until: at + def.days * 1440, care: [], rx: false };
	setSickMoodlet(state);
}

/** 病的心情状态和病程同时结束 */
function setSickMoodlet(state: PlayerState) {
	const cur = currentIllness(state);
	const ids = new Set(CONDITIONS.map((c) => c.moodlet));
	state.moodlets = state.moodlets.filter((m) => !ids.has(m.id));
	if (!cur) return;
	const def = MOODLETS.find((m) => m.id === cur.def.moodlet);
	if (!def) return;
	state.moodlets.push({ id: def.id, until: Math.min(cur.ill.until, state.clock + def.hours * 60) });
}

/**
 * 时间流逝（原地修改）：从 t0 到 state.clock。返回要写的日志。
 *   1. 生病期间：额外掉精力，健康按天掉（不低于 illFloor）；到期痊愈；
 *   2. 每过一个午夜、当时没病：按那天的风险掷一次（rand 每次调用给一个新的 [0,1) 随机数）。
 * 精力和健康的消耗只算 t0 之后、病程之内的那段时间。
 */
export function illnessTick(state: PlayerState, t0: number, rand: () => number): string[] {
	const logs: string[] = [];
	const t1 = state.clock;
	if (t1 <= t0) return logs;
	// 按午夜切段（合并 main 后复核）：半夜新得的病，从那个午夜起就开始掉精力和健康；
	// 午夜时还没好的病挡住当晚的发病判定，好了之后才清掉，不会和新病重叠
	const drainAndExpire = (from: number, to: number) => {
		const ill = state.illness;
		if (!ill) return;
		const def = getCondition(ill.id);
		if (!def) {
			state.illness = null; // 未知的病 id（数据删了）：直接清掉
			return;
		}
		const span = Math.max(0, Math.min(to, ill.until) - Math.max(from, ill.since));
		if (span > 0) {
			state.needs.energy = clamp100(state.needs.energy - (def.energyPerHour * span) / 60);
			if (state.health > HEALTH.illFloor) state.health = Math.max(HEALTH.illFloor, state.health - (def.healthPerDay * span) / 1440);
		}
		if (ill.until <= to) {
			logs.push(`${def.icon} ${def.name}好了。`);
			state.illness = null;
			setSickMoodlet(state);
		}
	};
	let cursor = t0;
	// 跨过的午夜：第一个 > t0 的午夜到 t1
	for (let mid = (Math.floor(t0 / 1440) + 1) * 1440; mid <= t1; mid += 1440) {
		const activeAtMid = !!state.illness && state.illness.until > mid;
		drainAndExpire(cursor, mid);
		cursor = mid;
		if (activeAtMid && state.illness) continue;
		const id = pickIllness(illnessRisk(state, mid / 1440), rand());
		if (!id) continue;
		startIllness(state, id, mid);
		const def = getCondition(id)!;
		logs.push(`${def.icon} 你${id === 'heat' ? '中了暑气，得了' : '病了：'}${def.name}。${def.desc}`);
	}
	drainAndExpire(cursor, t1);
	return logs;
}

/** 受伤（原地修改）：这一下掉的健康够多就记为扭伤；正在生别的病时不覆盖（一次只记一种）。返回是否新记了伤 */
export function injure(state: PlayerState, healthLoss: number): boolean {
	if (healthLoss < HEALTH.injuryAt) return false;
	const cur = currentIllness(state);
	const sprain = getCondition('sprain')!;
	if (cur && cur.def.id !== 'sprain') return false;
	if (cur) {
		state.illness = { ...cur.ill, until: Math.max(cur.ill.until, state.clock + sprain.days * 1440) };
		setSickMoodlet(state);
		return false;
	}
	startIllness(state, 'sprain');
	return true;
}

// ---------- 就医 ----------
/** 这个地点能不能做这种就医 */
export const careAvailableAt = (c: CareDef, loc: GameLocation) => (!c.kinds && !c.tags) || !!c.kinds?.includes(loc.kind) || !!c.tags?.some((t) => loc.tags.includes(t));

export interface CareOutcome {
	cost: number; // 自付
	listPrice: number; // 标价
	rebate: number; // 报销 / 补贴掉的部分
	minutes: number;
	health: number;
	/** 剩余病程乘以多少（1 表示不缩短） */
	factor: number;
	/** 看 GP 开了处方 */
	script: boolean;
	/** 这次是按处方取药 */
	fillRx: boolean;
	notes: string[];
	blocked?: string;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/**
 * 一次就医要花多少、有什么用（不检查地点和营业时间，那是调用方的事）：
 *   GP：自付 = 标价 − MBS 收费标准 × 保障报销比例；会开处方的病开处方
 *   药房：有没取的处方 → 按处方取药（有 PBS 的付 min(药价, PBS 自付上限)）；否则买非处方药（标价）
 *   急诊：有 Medicare 的公立医院免费；时长按严重程度加候诊
 * 没病只是健康不满也能看（只回健康，不缩短病程）。
 */
export function careOutcome(state: PlayerState, kind: CareKind): CareOutcome {
	const care = getCare(kind)!;
	const cover = coverOf(state);
	const cur = currentIllness(state);
	const done = cur?.ill.care.includes(kind) ?? false;
	let listPrice = care.fee;
	let rebate = 0;
	let minutes = care.minutes;
	let factor = cur && !done ? cur.def.care[kind] ?? 1 : 1;
	let script = false;
	let fillRx = false;
	const notes: string[] = [];
	if (kind === 'gp') {
		rebate = Math.min(listPrice, Math.round(REAL_FEES.mbsGp * cover.gpRebate * 100) / 100);
		if (rebate) notes.push(`${cover.name} 按 MBS 收费标准报销 ${money(rebate)}`);
		script = !!cur && !done && !!cur.def.script && !cur.ill.rx;
		if (script) notes.push('开了处方，去药房取药');
	} else if (kind === 'pharmacy') {
		fillRx = !!cur && cur.ill.rx && !cur.ill.care.includes('rx');
		if (fillRx) {
			listPrice = RX_PRICE;
			if (cover.pbs) rebate = Math.max(0, listPrice - REAL_FEES.pbsGeneral);
			factor = cur!.def.rx ?? 1;
			notes.push(cover.pbs ? `按处方取药，PBS 自付最多 ${money(REAL_FEES.pbsGeneral)}` : '按处方取药（没有 PBS，按药价付）');
		} else notes.push('买了非处方药');
	} else {
		if (cover.publicEd) rebate = listPrice;
		notes.push(cover.publicEd ? `${cover.name}：公立医院急诊不收费` : '自费：急诊按医院标价收费');
		minutes += ED_WAIT[cur?.def.severity ?? 1] ?? 0;
	}
	const cost = Math.max(0, Math.round(listPrice - rebate));
	const health = care.health;
	if (factor < 1) notes.push(`剩余病程 ×${factor}`);
	notes.unshift(`自付 $${cost}${rebate ? `（标价 $${listPrice}）` : ''}`);
	const base: CareOutcome = { cost, listPrice, rebate, minutes, health, factor, script, fillRx, notes };
	if (!cur && state.health >= 100) return { ...base, blocked: '没病没伤，不用看' };
	if (cur && done && !fillRx && state.health >= 100) return { ...base, blocked: `这次${cur.def.name}已经${care.name}过了` };
	if (state.cash < cost) return { ...base, blocked: `需要 $${cost}` };
	return base;
}

/** 结算就医对病程的影响（原地修改，时间已经流逝过） */
export function applyCare(state: PlayerState, kind: CareKind, out: CareOutcome) {
	const cur = currentIllness(state);
	if (!cur) return;
	const ill = { ...cur.ill, care: [...cur.ill.care] };
	if (!ill.care.includes(kind)) ill.care.push(kind);
	if (out.fillRx) ill.care.push('rx');
	if (out.script) ill.rx = true;
	if (out.factor < 1) ill.until = Math.max(state.clock + 60, state.clock + Math.round((ill.until - state.clock) * out.factor));
	state.illness = ill;
	setSickMoodlet(state);
}

// ---------- 存档清洗 ----------
const CARE_TAGS = new Set<string>([...CARE.map((c) => c.id), 'rx']);

/** 存档里的 illness：未知病、已过期、时间不合理的都清成 null；幂等 */
export function cleanIllness(raw: unknown, clock: number): PlayerState['illness'] {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const def = typeof r.id === 'string' ? getCondition(r.id) : undefined;
	if (!def) return null;
	const until = typeof r.until === 'number' && Number.isFinite(r.until) ? Math.floor(r.until) : NaN;
	if (!(until > clock)) return null;
	const cappedUntil = Math.min(until, clock + def.days * 1440);
	const since = typeof r.since === 'number' && Number.isFinite(r.since) ? Math.floor(Math.max(0, Math.min(r.since, clock))) : clock;
	const care = Array.isArray(r.care) ? [...new Set(r.care.filter((x): x is string => typeof x === 'string' && CARE_TAGS.has(x)))] : [];
	return { id: def.id, since, until: cappedUntil, care, rx: r.rx === true };
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
