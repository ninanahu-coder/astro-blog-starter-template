// 运动和比赛的规则（纯函数）：训练准备度、比赛报名和检定、俱乐部。数据在 data/sports.ts，设计见 docs/earth-game/sports.md。
// 动作函数不改入参；随机数只用 roll(state)；所有数值待平衡。
import { addMoodlet, applyEffect, clone, collapsedResult, fail, getLocation, log, roll } from './engine.ts';
import { checkScore } from './attributes.ts';
import { weatherAt } from './weather.ts';
import { clamp100, SKILL_META } from './character.ts';
import { dateOf, dayOf, hourOf, hoursLabel, inSpan, isOpen, weekdayOf } from './time.ts';
import { SKILL_KEYS } from './types.ts';
import type { ActionResult, PlayerState, Region, SkillKey, SportResult } from './types.ts';
import { CLUBS, MEDALS, RACES, SPORT_RULES as R, SPORTS, type ClubDef, type Medal, type RaceDef, type SportId } from '../data/sports.ts';

export const getSport = (id: string) => SPORTS.find((s) => s.id === id);
export const getRace = (id: string) => RACES.find((r) => r.id === id);
export const getClub = (id: string) => CLUBS.find((c) => c.id === id);

const today = (s: PlayerState) => dayOf(s.clock);

// ---------- 训练准备度 ----------
/** 某项运动现在的准备度：最近一次训练后歇满 graceDays 天开始每天掉 decayPerDay */
export function formOf(state: PlayerState, sport: SportId, day = today(state)): number {
	const f = state.sport.form[sport];
	if (!f) return 0;
	const idle = Math.max(0, day - f.d - R.graceDays);
	return Math.max(0, Math.round((f.v - R.decayPerDay * idle) * 10) / 10);
}

/** 比赛用的准备度：本项 + 健身的一部分（交叉训练），封顶 formMax */
export function raceForm(state: PlayerState, sport: SportId): number {
	const own = formOf(state, sport);
	return Math.min(R.formMax, sport === 'gym' ? own : own + R.crossGym * formOf(state, 'gym'));
}

/**
 * 记一次训练（原地修改，调用方传入的是引擎新建的对象）：准备度上涨（同一项当天第 2 次减半、第 3 次起不涨），
 * 累计次数 +1，每个游戏日第一次运动健康 +healthPerDay。返回涨了多少准备度。
 */
export function train(state: PlayerState, sport: SportId, mult = 1): number {
	const d = today(state);
	const cur = formOf(state, sport, d);
	const prev = state.sport.form[sport];
	const n = prev && prev.d === d ? prev.n + 1 : 1;
	const gain = n === 1 ? R.formGain * mult : n === 2 ? (R.formGain * mult) / 2 : 0;
	const v = Math.min(R.formMax, Math.round((cur + gain) * 10) / 10);
	state.sport.form[sport] = { v, d, n: Math.min(n, 99) };
	state.sport.total[sport] = Math.min(1e6, (state.sport.total[sport] ?? 0) + 1);
	if (state.sport.hday !== d) {
		state.sport.hday = d;
		state.health = clamp100(state.health + R.healthPerDay);
	}
	return Math.round((v - cur) * 10) / 10;
}

/** 这个动作算哪项运动的训练（没有返回 undefined）。只看动作本身，成功与否由调用方判断 */
export function sportOfAction(a: { t: string; id?: string; op?: string }): SportId | undefined {
	if (a.t === 'activity' && a.id) return SPORTS.find((s) => s.acts.includes(a.id!))?.id;
	if (a.t === 'venue' && a.op) return SPORTS.find((s) => s.ops.includes(a.op!))?.id;
	return undefined;
}

/** applyAction 成功（没晕倒）后调用：日常运动记一次训练 */
export function noteTraining(next: PlayerState, a: { t: string; id?: string; op?: string }) {
	const sport = sportOfAction(a);
	if (sport) train(next, sport);
}

// ---------- 赛程 ----------
export interface RaceSlot {
	race: RaceDef;
	/** 几天后开赛，今天是比赛日为 0 */
	startsIn: number;
	/** 这一届的标识：每年一次的 `id:y年`，每周赛 `id:d游戏日` */
	key: string;
}

/** 下一届（今天是比赛日就算今天这一届，不管几点） */
export function nextSlot(race: RaceDef, clock: number): RaceSlot {
	const d = dayOf(clock);
	let startsIn: number;
	if (race.weekday !== undefined) startsIn = (race.weekday - weekdayOf(clock) + 7) % 7;
	else startsIn = inSpan(clock, race.season!, race.day!, 1).startsIn;
	const day = d + startsIn;
	const key = race.weekday !== undefined ? `${race.id}:d${day}` : `${race.id}:y${dateOf(day * 1440).year}`;
	return { race, startsIn, key };
}

/** 报名费：比赛当天现场报名加价 */
export const entryFee = (race: RaceDef, startsIn: number) => (startsIn === 0 ? Math.round(race.fee * R.lateFee) : race.fee);

const hasRun = (state: PlayerState, key: string) => state.sport.results.some((x) => x.key === key);
const unmetReq = (state: PlayerState, race: RaceDef): string | undefined => {
	for (const k of SKILL_KEYS) {
		const need = race.requires?.[k];
		if (need && state.skills[k] < need) return `参赛门槛：${skillName(k)}要达到 ${need}`;
	}
	return undefined;
};
const skillName = (k: SkillKey) => SKILL_META[k].name;

export interface RaceOffer extends RaceSlot {
	/** 已报名 */
	entered: boolean;
	/** 这一届已经比过 */
	done: boolean;
	fee: number;
	/** 不能报名的原因（免费赛、已报名、已比过时也有说明） */
	enterBlocked?: string;
	/** 不能开赛的原因 */
	raceBlocked?: string;
}

/** 本区域 within 天内的比赛（按开赛先后），带报名和开赛的状态 */
export function racesSoon(state: PlayerState, region: Region, within = R.entryDays): RaceOffer[] {
	const inRegion = (r: RaceDef) => r.locs.some((l) => getLocation(region, l));
	return RACES.filter(inRegion)
		.map((race) => nextSlot(race, state.clock))
		.filter((x) => x.startsIn <= within)
		.sort((a, b) => a.startsIn - b.startsIn || a.race.id.localeCompare(b.race.id))
		.map((slot) => {
			const entered = state.sport.entries.includes(slot.key);
			const done = hasRun(state, slot.key);
			const fee = entryFee(slot.race, slot.startsIn);
			return { ...slot, entered, done, fee, enterBlocked: enterProblem(state, slot, fee), raceBlocked: raceProblem(state, slot) };
		});
}

function enterProblem(state: PlayerState, slot: RaceSlot, fee: number): string | undefined {
	const { race } = slot;
	if (race.fee <= 0) return '免费，不用报名，当天到场就能跑';
	if (hasRun(state, slot.key)) return '这一届已经比过了';
	if (state.sport.entries.includes(slot.key)) return '已报名';
	if (slot.startsIn > R.entryDays) return `开赛前 ${R.entryDays} 天开放报名`;
	if (slot.startsIn === 0 && hourOf(state.clock) >= race.start[1]) return '今天已经发令，报名截止了';
	const req = unmetReq(state, race);
	if (req) return req;
	if (state.sport.entries.length >= R.entriesMax) return `最多同时报 ${R.entriesMax} 场`;
	if (state.cash < fee) return `报名费 $${fee}，钱不够`;
	return undefined;
}

function raceProblem(state: PlayerState, slot: RaceSlot): string | undefined {
	const { race } = slot;
	if (slot.startsIn > 0) return `${slot.startsIn} 天后开赛`;
	if (hasRun(state, slot.key)) return '这一届已经比过了';
	if (!race.locs.includes(state.loc)) return `要在${race.locs.length > 1 ? '举办地之一' : '举办地'}才能参赛`;
	if (race.fee > 0 && !state.sport.entries.includes(slot.key)) return '还没报名';
	if (!isOpen(race.start, state.clock)) return `发令时间 ${hoursLabel(race.start)}`;
	const req = unmetReq(state, race);
	if (req) return req;
	if (state.needs.energy < race.energy) return `精力不足（要 ${race.energy}）`;
	return undefined;
}

// ---------- 比赛检定 ----------
export interface RaceScore {
	skill: number;
	form: number;
	club: number;
	fatigue: number;
	/** 不含随机部分 */
	total: number;
}

/** 有没有队友加成：同项目的俱乐部、会员有效、最近 clubBonusDays 天上过训练课 */
export function clubBonusFor(state: PlayerState, sport: SportId): number {
	const c = state.sport.club;
	const def = c && getClub(c.id);
	if (!c || !def || def.sport !== sport || c.until <= today(state) || c.last < 0 || today(state) - c.last > R.clubBonusDays) return 0;
	return R.clubBonus;
}

/** 检定分（不含随机）= 各能力检定分按权重加权 + 准备度 × formWeight + 队友加成 − 疲劳 */
export function raceScore(state: PlayerState, race: RaceDef): RaceScore {
	const sport = getSport(race.sport)!;
	let skill = 0;
	for (const [k, w] of Object.entries(sport.weights)) skill += checkScore(state, k as SkillKey).total * (w ?? 0);
	skill = Math.round(skill * 10) / 10;
	const form = Math.round(raceForm(state, race.sport) * R.formWeight * 10) / 10;
	const club = clubBonusFor(state, race.sport);
	const fatigue = Math.round(Math.max(0, R.fatigueBelow - state.needs.energy) * R.fatigueK * 10) / 10;
	return { skill, form, club, fatigue, total: Math.round((skill + form + club - fatigue) * 10) / 10 };
}

/** 检定分（含随机）→ 名次档 */
export function medalOf(score: number, dc: number): Medal {
	if (score >= dc + R.gold) return 'gold';
	if (score >= dc + R.silver) return 'silver';
	if (score >= dc + R.bronze) return 'bronze';
	if (score >= dc) return 'finish';
	return 'dnf';
}

/** 完赛、上领奖台的把握（0–100，按随机部分均匀分布算） */
export function raceOdds(state: PlayerState, race: RaceDef): { finish: number; podium: number } {
	const base = raceScore(state, race).total;
	const p = (need: number) => Math.round(Math.max(0, Math.min(1, (base + R.raceRoll - need) / R.raceRoll)) * 100);
	return { finish: p(race.dc), podium: p(race.dc + R.bronze) };
}

/** 成绩（秒）：检定分越高越接近冠军用时 par，最慢是 par 的 1.6 倍 */
export function raceSecs(race: RaceDef, score: number): number {
	const slow = Math.max(0, Math.min(1, (race.dc + R.gold + 10 - score) / 100));
	return Math.round(race.par * 60 * (1 + 0.6 * slow));
}

/** 名次：金银铜是 1–3 名；完赛的按离铜牌线的距离排在 4 名到 field 名之间 */
export function racePlace(race: RaceDef, medal: Medal, score: number): number {
	if (medal === 'gold') return 1;
	if (medal === 'silver') return 2;
	if (medal === 'bronze') return 3;
	if (medal === 'dnf') return 0;
	const frac = Math.max(0, Math.min(1, (race.dc + R.bronze - score) / R.bronze));
	return 4 + Math.floor(Math.max(0, race.field - 4) * frac);
}

export const fmtSecs = (secs: number) => {
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// ---------- 动作 ----------
/** 报名（在哪都能报，不花游戏时间） */
export function enterRace(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const race = getRace(id);
	if (!race || !race.locs.some((l) => getLocation(region, l))) return fail(prev, '本区域没有这场比赛。');
	const slot = nextSlot(race, prev.clock);
	const fee = entryFee(race, slot.startsIn);
	const why = enterProblem(prev, slot, fee);
	if (why) return fail(prev, why);
	const state = clone(prev);
	state.cash -= fee;
	state.sport.entries = [...state.sport.entries, slot.key];
	const msg = `报名了${race.name}（${slot.startsIn ? `${slot.startsIn} 天后` : '今天'}），报名费 $${fee}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 参赛：在举办地、比赛日的发令时段，已报名（免费赛不用）。海上项目遇风暴取消并退费 */
export function runRace(prev: PlayerState, region: Region, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const race = getRace(id);
	if (!race) return fail(prev, '没有这场比赛。');
	const slot = nextSlot(race, prev.clock);
	if (race.sea && slot.startsIn === 0 && race.locs.includes(prev.loc) && weatherAt(prev).closesSea && !hasRun(prev, slot.key)) {
		// 风暴天取消：报过名的退报名费（按原价，不管当初是不是现场报名）并去掉报名；没报名（或已经退过）的只提示，不改存档
		if (!prev.sport.entries.includes(slot.key)) return fail(prev, `${race.name}因为风浪太大取消了。`);
		const state = clone(prev);
		const refund = race.fee;
		state.cash += refund;
		state.sport.entries = state.sport.entries.filter((k) => k !== slot.key);
		const msg = `${race.name}因为风浪太大取消了，退回报名费 $${refund}。`;
		log(state, msg);
		return { ok: true, state, msg };
	}
	const why = raceProblem(prev, slot);
	if (why) return fail(prev, why);
	const state = clone(prev);
	const score = raceScore(prev, race).total + roll(state) * R.raceRoll;
	const medal = medalOf(score, race.dc);
	const secs = medal === 'dnf' ? 0 : raceSecs(race, score);
	const place = racePlace(race, medal, score);
	const sport = getSport(race.sport)!;
	state.sport.entries = state.sport.entries.filter((k) => k !== slot.key);
	const skills: Partial<Record<SkillKey, number>> = {};
	for (const [k, w] of Object.entries(sport.weights)) skills[k as SkillKey] = Math.round((w ?? 0) * 3 * 100) / 100;
	// 比赛花的时间：用时 + 检录和领物 1 小时；未完赛按冠军用时算（中途退赛也耗了不少时间）
	const minutes = Math.round((secs || race.par * 60) / 60) + 60;
	const fx = { minutes, skills, needs: { energy: -race.energy, hunger: -20, hygiene: -30, fun: medal === 'dnf' ? -5 : 20, social: 10 } };
	if (applyEffect(state, fx, region)) return collapsedResult(state);
	train(state, race.sport);
	const tier = { gold: 0, silver: 1, bronze: 2, finish: 3, dnf: -1 }[medal];
	const respect = tier >= 0 ? race.respect[tier] : 0;
	state.respect += respect;
	addMoodlet(state, tier < 0 ? 'sore' : tier < 3 ? 'race-podium' : 'race-finish');
	const result: SportResult = { race: race.id, key: slot.key, medal, place, secs, day: today(state) };
	state.sport.results = [result, ...state.sport.results].slice(0, R.resultsMax);
	const pb = state.sport.pb[race.id];
	const newPb = secs > 0 && (!pb || secs < pb);
	if (newPb) state.sport.pb = { ...state.sport.pb, [race.id]: secs };
	if (medal !== 'dnf' && race.finish && getLocation(region, race.finish)) {
		state.loc = race.finish;
		state.visited[race.finish] = (state.visited[race.finish] ?? 0) + 1;
	}
	const m = MEDALS[medal];
	const msg = medal === 'dnf'
		? `${race.name}没能跑完，中途上了收容车。${m.icon}`
		: `${m.icon} ${race.name}${m.name}！用时 ${fmtSecs(secs)}，第 ${place.toLocaleString()} 名${newPb ? '，个人最好成绩' : ''}${respect ? `，声望 +${respect}` : ''}。${race.finish ? `终点在${getLocation(region, race.finish)?.name ?? ''}。` : ''}`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 当前地点的俱乐部 */
export function clubsAt(state: PlayerState): ClubDef[] {
	return CLUBS.filter((c) => c.loc === state.loc);
}

/** 入会或续费：每次付一期会费，有效期 clubDays 天；同时只能加入一个俱乐部，换俱乐部旧的会费不退 */
export function joinClub(prev: PlayerState, id: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const def = getClub(id);
	if (!def || def.loc !== prev.loc) return fail(prev, '这里没有这个俱乐部。');
	if (prev.cash < def.fee) return fail(prev, `会费 $${def.fee}，钱不够`);
	const state = clone(prev);
	const d = today(state);
	const c = state.sport.club;
	state.cash -= def.fee;
	const renew = c?.id === id;
	state.sport.club = renew ? { id, until: Math.max(c!.until, d) + R.clubDays, last: c!.last } : { id, until: d + R.clubDays, last: -1 };
	const msg = renew ? `${def.name}续了一期会费 $${def.fee}，有效到 ${state.sport.club.until - d} 天后。` : `加入了${def.name}，会费 $${def.fee}，${R.clubDays} 天一期。`;
	log(state, msg);
	return { ok: true, state, msg };
}

export function quitClub(prev: PlayerState): ActionResult {
	const c = prev.sport.club;
	if (!c) return fail(prev, '你没有加入俱乐部。');
	const state = clone(prev);
	state.sport.club = null;
	const msg = `退出了${getClub(c.id)?.name ?? '俱乐部'}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 训练课能不能上；能上返回 undefined */
export function clubSessionBlocked(state: PlayerState): string | undefined {
	const c = state.sport.club;
	const def = c && getClub(c.id);
	if (!c || !def) return '还没加入俱乐部';
	if (c.until <= today(state)) return '会费到期了，续费后才能上课';
	if (state.loc !== def.loc) return '训练课在俱乐部所在的城市';
	if (!isOpen(def.meet, state.clock)) return `训练课时间 ${hoursLabel(def.meet)}`;
	if (c.last === today(state)) return '今天已经练过了';
	if (state.needs.energy < 25) return '精力不足（要 25）';
	return undefined;
}

/** 俱乐部训练课：90 分钟，准备度按 clubFormMult 倍涨，社交 +25，队友说一句话 */
export function clubSession(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = clubSessionBlocked(prev);
	if (why) return fail(prev, why);
	const def = getClub(prev.sport.club!.id)!;
	const sport = getSport(def.sport)!;
	const state = clone(prev);
	const mate = def.mates[Math.floor(roll(state) * def.mates.length)];
	const line = mate.lines[Math.floor(roll(state) * mate.lines.length)];
	if (applyEffect(state, { minutes: 90, skills: sport.clubSkills, needs: { energy: -20, hygiene: -10, social: 25, fun: 10 } }, region)) return collapsedResult(state);
	const gain = train(state, def.sport, R.clubFormMult);
	state.sport.club = { ...state.sport.club!, last: dayOf(prev.clock) };
	const msg = `${def.icon} 和${def.name}一起练了${sport.name}，准备度 +${gain}。${mate.icon} ${mate.name}：「${line}」`;
	log(state, msg);
	return { ok: true, state, msg };
}
