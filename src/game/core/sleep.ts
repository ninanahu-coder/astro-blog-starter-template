// 睡眠与作息（第 43 批）：睡眠质量（床、噪音、时差、几点睡）、熬夜记睡眠债、补觉还债。纯函数，不改入参。
// 数值在 data/sleep.ts（新数值都待平衡），设计见 docs/earth-game/time-sleep.md。
// 不 import engine.ts：engine 调这里，这里只算数、返回要挂的心情 id，由 engine 去挂。
import { BED, NOISE, ORIGIN_TZ, SLEEP, type BedKind } from '../data/sleep.ts';
import { realDayOfYear, tzMinutes } from './sky.ts';
import { dayOf, isOpen } from './time.ts';
import type { Effect, LocationKind, PlayerState, Region } from './types.ts';

/** 睡在哪：住处要给舒适度和有没有床位家具 */
export interface SleepSpot {
	bed: BedKind;
	comfort?: number;
	bedFurniture?: boolean;
}

export interface SleepQuality {
	/** 最终质量（qualityMin–qualityMax，两位小数）：恢复的精力和健康乘它 */
	q: number;
	bed: number;
	noise: number;
	jetlag: number; // 还剩几小时时差
	offHours: boolean; // 不在夜里入睡
	notes: string[]; // 给界面看的原因
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const KIND_NOISE_NOTE: Partial<Record<LocationKind, string>> = { city: '城里夜里吵', port: '港口夜里有动静', mining: '矿区夜里也在作业', town: '镇上偶尔有车' };

/** 作息字段：旧对象（测试里手搓的）没有时按「刚醒、不欠债」算 */
export const restOf = (state: PlayerState) => state.rest ?? { wake: state.clock, debt: 0 };

/**
 * 还剩几小时时差。出身来自外地的人，按身体还停在老家时区算，每过一个游戏日倒回 recoverPerDay 小时。
 * 第一版不记「身体时钟」字段：跨州飞行后的新时差见设计文档 §4 提议。
 */
export function jetlagHours(origin: string, lon: number, clock: number): number {
	const home = ORIGIN_TZ[origin];
	if (home === null || home === undefined) return 0;
	const diff = Math.abs(tzMinutes(lon, realDayOfYear(clock)) - home) / 60;
	return round(Math.max(0, diff - dayOf(clock) * SLEEP.jetlag.recoverPerDay), 1);
}

/** 现在这个钟点入睡算不算按时睡（夜里） */
export const nightStart = (clock: number) => isOpen(SLEEP.nightHours, clock);

/** 在这里、这个时刻睡一觉的质量 */
export function sleepQuality(state: PlayerState, region: Region, spot: SleepSpot, clock = state.clock): SleepQuality {
	const loc = region.locations.find((l) => l.id === state.loc);
	const notes: string[] = [];
	const bed = spot.bed === 'home'
		? BED.home.base + (spot.comfort ?? 0) * BED.home.perComfort + (spot.bedFurniture ? BED.home.bedFurniture : 0)
		: BED[spot.bed];
	if (spot.bedFurniture) notes.push('床好');
	const noise = loc ? NOISE[loc.kind] ?? 0 : 0;
	if (noise > 0 && loc) notes.push(KIND_NOISE_NOTE[loc.kind] ?? '有点吵');
	const jetlag = loc ? jetlagHours(state.origin, loc.lon, clock) : 0;
	if (jetlag > 0) notes.push(`时差还有 ${jetlag} 小时`);
	const offHours = !nightStart(clock);
	if (offHours) notes.push('不是夜里，睡不踏实');
	const raw = (bed - noise - jetlag * SLEEP.jetlag.perHour) * (offHours ? SLEEP.offHoursMult : 1);
	return { q: round(clamp(raw, SLEEP.qualityMin, SLEEP.qualityMax), 2), bed: round(bed, 2), noise, jetlag, offHours, notes };
}

/** 一觉的效果乘质量：只缩放「恢复」（精力、健康的增加），扣的、别的需求不动。不改入参 */
export function sleepFx(fx: Effect, q: number): Effect {
	const en = fx.needs?.energy;
	const out: Effect = { ...fx };
	if (en && en > 0) out.needs = { ...fx.needs, energy: round(en * q, 1) };
	if (fx.health && fx.health > 0) out.health = round(fx.health * q, 1);
	if (q < SLEEP.poorAt && out.moodlet === SLEEP.goodMoodlet) delete out.moodlet; // 没睡好就不算「睡了个好觉」
	return out;
}

/** 已经醒了多少分钟 */
export const awakeMinutes = (state: PlayerState) => Math.max(0, state.clock - restOf(state).wake);

/** 熬夜多出来的债（小时）：醒着超过 awakeOkMinutes 的部分 */
const overDebt = (awake: number) => (Math.max(0, awake - SLEEP.awakeOkMinutes) / 60) * SLEEP.debtPerHour;

/** 如果现在去睡，睡前一共欠多少小时（存着的债 + 这次熬夜新欠的），一位小数 */
export function debtNow(state: PlayerState): number {
	return round(Math.min(SLEEP.debtMax, restOf(state).debt + overDebt(awakeMinutes(state))), 1);
}

/** 再醒多少分钟就开始算熬夜（已经在熬为 0） */
export const minutesToLate = (state: PlayerState) => Math.max(0, SLEEP.awakeOkMinutes - awakeMinutes(state));

export interface SleepSettle {
	rest: PlayerState['rest'];
	/** 要挂的心情（由调用方 addMoodlet） */
	moodlets: string[];
	/** 这一觉还掉的债（小时） */
	repaid: number;
}

/**
 * 睡完一觉后的作息：先把熬夜的部分记成债，再按「睡了几小时 × 质量 × repayPerHour」还债。
 * 整觉醒来清零「醒了多久」；补觉只把它往回拨（napResetMult 倍睡眠时长），并且不超过 awakeOkMinutes——超出的部分已经记过债，不重复记。
 */
export function settleSleep(rest: PlayerState['rest'], start: number, end: number, q: number, nap: boolean): SleepSettle {
	const awake = Math.max(0, start - rest.wake);
	const owed = Math.min(SLEEP.debtMax, rest.debt + overDebt(awake));
	const slept = Math.max(0, end - start);
	const repaid = round(Math.min(owed, (slept / 60) * q * SLEEP.repayPerHour), 1);
	const debt = round(Math.max(0, owed - repaid), 1);
	const left = nap ? Math.min(SLEEP.awakeOkMinutes, Math.max(0, awake - slept * SLEEP.napResetMult)) : 0;
	const moodlets: string[] = [];
	if (q < SLEEP.poorAt) moodlets.push('rough-night');
	if (debt >= SLEEP.debtMoodletAt) moodlets.push('sleep-debt');
	return { rest: { wake: end - left, debt }, moodlets, repaid };
}

/** 一句话说明这一觉（日志和提示用） */
export function sleepNote(sq: SleepQuality): string {
	return `睡眠质量 ${Math.round(sq.q * 100)}%${sq.notes.length ? `（${sq.notes.join('，')}）` : ''}`;
}
