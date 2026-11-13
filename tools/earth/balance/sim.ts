#!/usr/bin/env node
// 数值平衡模拟：几类机器人玩家按固定策略自动玩 N 个游戏日，统计经济与生存指标。
// 走的是服务端同一个入口 applyAction()，结果与真实玩家一致。
//
//   npm run earth:sim                 默认 60 天 × 每种策略 40 个种子
//   npm run earth:sim -- --days=120 --runs=100
//   npm run earth:sim -- --out=docs/earth-game/balance-report.md
import { writeFileSync } from 'node:fs';
import { applyAction, type GameAction } from '../../../src/game/core/actions.ts';
import { mood } from '../../../src/game/core/attributes.ts';
import { createCharacter } from '../../../src/game/core/character.ts';
import {
	activitiesAt, careersAt, coursesAt, dealerAt, netWorth, propertiesAt, furnitureAt, furnitureValue, homeActionBlocked, experiencesAt, getCareer, getPendingEvent, homesAt, npcsAt, resaleValue, shiftBlocked, shopAt, travelOptions,
} from '../../../src/game/core/engine.ts';
import { dayOf, hourOf } from '../../../src/game/core/time.ts';
import { SKILL_KEYS } from '../../../src/game/core/types.ts';
import type { PlayerState } from '../../../src/game/core/types.ts';
import { WA } from '../../../src/game/data/wa.ts';

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const DAYS = Number(arg('days', '60'));
const RUNS = Number(arg('runs', '40'));
const OUT = arg('out', '');

// ---------- 机器人 ----------
interface Bot {
	s: PlayerState;
	rng: () => number;
	plan: Plan;
	stats: { collapses: number; evictions: number; promotions: number; events: number; moodSum: number; moodN: number; shifts: number; daysBroke: number; cashByDay: number[]; flow: Record<string, number>; promoDays: number[]; homeDay?: number };
}

interface Plan {
	id: string;
	name: string;
	origin: string;
	traits: string[];
	/** 想去的工作地点与职业；没有表示不找正式工作 */
	job?: { loc: string; career: string };
	/** 想租的房型（在工作地点或出生点） */
	home?: string;
	/** 有空就四处旅行 */
	roam?: boolean;
	/** false：不上课、不体验、不买车（用来和旧版本对比） */
	spend?: boolean;
}

const PLANS: Plan[] = [
	{ id: 'barista', name: '咖啡店上班族（珀斯，合租）', origin: 'student', traits: ['charming', 'neat'], job: { loc: 'perth', career: 'barista' }, home: 'room' },
	{ id: 'lifeguard', name: '救生员（珀斯，公寓）', origin: 'surfer', traits: ['waterborn', 'athletic'], job: { loc: 'perth', career: 'lifeguard' }, home: 'flat' },
	{ id: 'miner', name: '矿工（卡尔古利，合租）', origin: 'fifo', traits: ['athletic', 'tough'], job: { loc: 'kalgoorlie', career: 'miner' }, home: 'room' },
	{ id: 'drifter', name: '打零工的背包客（无房）', origin: 'backpacker', traits: ['loner', 'frugal'], roam: true },
	{ id: 'idle', name: '什么都不干（对照组）', origin: 'backpacker', traits: [] },
];

function mulberry(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 尝试一个动作；成功则更新状态并统计 */
function tryAct(b: Bot, a: GameAction): boolean {
	const before = b.s;
	const r = applyAction(b.s, WA, a);
	if (!r.ok) {
		b.s = r.state;
		return false;
	}
	b.s = r.state;
	const key = a.t === 'activity' ? a.id : a.t === 'job' || a.t === 'home' || a.t === 'furniture' || a.t === 'property' ? `${a.t}-${a.op}` : a.t === 'npc' ? 'npc' : a.t === 'buy' ? `buy-${a.item}` : a.t;
	b.stats.flow[key] = (b.stats.flow[key] ?? 0) + (b.s.cash - before.cash);
	// 这次动作中写下的日志：时间晚于动作开始时刻（每个成功动作都会让时间前进）
	for (const j of b.s.journal) {
		if (j.t <= before.clock) continue;
		if (j.text.includes('晕倒')) b.stats.collapses++;
		if (j.text.includes('收回') || j.text.includes('强制卖出')) b.stats.evictions++;
	}
	if (b.s.job && before.job && b.s.job.career === before.job.career && b.s.job.level > before.job.level) {
		b.stats.promotions++;
		b.stats.promoDays.push(dayOf(b.s.clock) + 1);
	}
	if (a.t === 'job' && a.op === 'work') b.stats.shifts++;
	return true;
}

const can = (b: Bot, id: string) => activitiesAt(b.s, WA).some((x) => x.act.id === id && !x.blocked);
const act = (b: Bot, id: string) => can(b, id) && tryAct(b, { t: 'activity', id });

/** 去某地：有直达就走最便宜的可用方式，否则走离目标最近的一站 */
function headTo(b: Bot, dest: string): boolean {
	const opts = travelOptions(b.s, WA).filter((o) => o.available);
	const direct = opts.filter((o) => o.to === dest).sort((x, y) => x.cost - y.cost)[0];
	if (direct) return tryAct(b, { t: 'travel', to: direct.to, mode: direct.mode });
	return false;
}

/** 一步决策：先保命，再上班，再满足需求，最后按策略消磨时间 */
function step(b: Bot) {
	const s = b.s;
	const plan = b.plan;
	if (getPendingEvent(s)) {
		b.stats.events++;
		tryAct(b, { t: 'event', choice: 0 });
		return;
	}
	const h = hourOf(s.clock);
	const atHome = s.home && s.home.loc === s.loc;

	// 1. 生存（没钱时赶上免费餐就去吃）
	if (s.cash < 60 && s.needs.hunger < 80 && (act(b, 'charity-meal') || act(b, 'charity-dinner'))) return;
	if (s.health < 35 && (act(b, 'clinic') || (s.inventory.firstaid && tryAct(b, { t: 'use', item: 'firstaid' })))) return;
	if (s.needs.hunger < 35) {
		if (!homeActionBlocked(s, 'cook') && tryAct(b, { t: 'home', op: 'cook' })) return;
		if (act(b, 'eat')) return;
		if (s.inventory.snack && tryAct(b, { t: 'use', item: 'snack' })) return;
		if (s.inventory.water && tryAct(b, { t: 'use', item: 'water' })) return;
		if (act(b, 'forage')) return;
	}
	// 夜里精力不满才睡（刚睡醒的半夜不会再睡一觉，否则会睡过上班时间）
	const night = (h >= 22 || h < 5) && s.needs.energy < 70;
	if (s.needs.energy < 25 || night) {
		if (atHome && tryAct(b, { t: 'home', op: 'sleep' })) return;
		if (s.cash > 600 && act(b, 'sleep-motel')) return;
		if (act(b, 'sleep-camp')) return;
	}
	if (s.needs.hygiene < 25 && act(b, 'shower')) return;

	// 2. 找工作、租房、去上班
	if (plan.job) {
		if (!s.job) {
			if (s.loc !== plan.job.loc) {
				if (headTo(b, plan.job.loc)) return;
			} else if (careersAt(s, WA).some((o) => o.career.id === plan.job!.career && !o.blocked)) {
				if (tryAct(b, { t: 'job', op: 'apply', career: plan.job.career })) return;
			}
		} else if (s.loc !== s.job.loc) {
			if (headTo(b, s.job.loc)) return; // 被送去外地医院等情况：先回工作地点
		} else if (dayOf(s.clock) % 7 !== 6 && !shiftBlocked(s) && tryAct(b, { t: 'job', op: 'work' })) return; // 每周休一天
	}
	if (plan.home && !s.home && s.cash > 400) {
		const want = plan.job?.loc ?? WA.spawn;
		if (s.loc === want && homesAt(s, WA).some((o) => o.home.id === plan.home && !o.blocked) && tryAct(b, { t: 'home', op: 'rent', home: plan.home })) return;
	}

	// 3. 花钱（阶段 A）：升职卡在能力上就上课；钱多就体验、买车
	if (plan.spend !== false && plan.id !== 'idle') {
		if (s.job && s.cash > 600) {
			const next = getCareer(s.job.career)!.levels[s.job.level + 1];
			const lacking = SKILL_KEYS.filter((k) => (next?.req?.skills?.[k] ?? 0) > s.skills[k]);
			const course = coursesAt(s, WA).find((o) => lacking.includes(o.course.skill) && !o.blocked);
			if (course && tryAct(b, { t: 'course', id: course.course.id })) return;
		}
		if (atHome && s.cash > 1500) {
			const f = furnitureAt(s).find((o) => !o.blocked && !s.home!.furniture[o.item.slot] && o.item.price <= 500);
			if (f && tryAct(b, { t: 'furniture', op: 'buy', id: f.item.id })) return;
		}
		if (s.cash > 2500) {
			const exp = experiencesAt(s, WA).find((o) => o.first && !o.blocked);
			if (exp && tryAct(b, { t: 'experience', id: exp.exp.id })) return;
		}
		// 买房：首付之外还留 $3,000 周转；买了就搬进去
		const house = propertiesAt(s, WA).find((o) => !o.owned && s.cash >= o.down + 3000);
		if (house && s.properties.length === 0 && tryAct(b, { t: 'property', op: 'buy', id: house.property.id, loan: s.cash < house.property.price + 3000 })) {
			tryAct(b, { t: 'property', op: 'movein', id: house.property.id });
			b.stats.homeDay = dayOf(b.s.clock) + 1;
			return;
		}
		if (s.vehicle === 'none' && s.cash > 7000 && s.properties.length > 0) {
			const car = dealerAt(s, WA).find((o) => o.vehicle.id === 'car' && !o.blocked);
			if (car && tryAct(b, { t: 'vehicle', op: 'buy', id: 'car' })) return;
		}
	}

	// 4. 没有正式工作的人靠零工
	if (!s.job && plan.id !== 'idle' && s.cash < 400) {
		for (const gig of ['work-mine', 'work-farm', 'work-cafe', 'busk']) if (act(b, gig)) return;
	}

	// 5. 娱乐和社交
	if (s.needs.social < 40) {
		const npc = npcsAt(s, WA).find((n) => !n.blocked.chat);
		if (npc && tryAct(b, { t: 'npc', npc: npc.npc.id, act: 'chat' })) return;
		if (s.cash > 150 && act(b, 'pub')) return;
	}
	if (s.needs.fun < 40) {
		if (!homeActionBlocked(s, 'relax') && tryAct(b, { t: 'home', op: 'relax' })) return;
		for (const f of ['swim', 'hike', 'market']) if (act(b, f)) return;
		if (s.cash > 150 && act(b, 'pub')) return;
	}
	// 背包里放点吃的
	if (!s.inventory.snack && s.cash > 100) {
		const e = shopAt(s, WA).find((x) => x.item.id === 'snack' && !x.blocked);
		if (e && tryAct(b, { t: 'buy', item: 'snack' })) return;
	}

	// 6. 闲着：到处走或者打发时间
	if (plan.roam && b.rng() < 0.35) {
		const opts = travelOptions(s, WA).filter((o) => o.available && o.mode !== 'air' && o.cost < s.cash * 0.3);
		if (opts.length) {
			const o = opts[Math.floor(b.rng() * opts.length)];
			if (tryAct(b, { t: 'travel', to: o.to, mode: o.mode })) return;
		}
	}
	if (s.job && s.loc === s.job.loc && act(b, 'rest')) return; // 有工作就在附近等开工
	for (const f of ['hike', 'swim', 'busk']) if (plan.id !== 'idle' && act(b, f)) return;
	act(b, 'rest'); // 兜底：一定能做，保证时间往前走
}

function runBot(plan: Plan, seed: number): Bot {
	const s = createCharacter({ id: `sim-${plan.id}-${seed}`, name: plan.id, avatar: '🧑', origin: plan.origin, traits: plan.traits, region: WA.id, spawn: WA.spawn, seed });
	const b: Bot = {
		s, plan, rng: mulberry(seed * 7919),
		stats: { collapses: 0, evictions: 0, promotions: 0, events: 0, moodSum: 0, moodN: 0, shifts: 0, daysBroke: 0, cashByDay: [s.cash], flow: {}, promoDays: [] },
	};
	const end = s.clock + DAYS * 1440;
	let lastDay = dayOf(s.clock);
	for (let i = 0; i < 50000 && b.s.clock < end; i++) {
		const before = b.s.clock;
		step(b);
		if (b.s.clock === before && !getPendingEvent(b.s)) act(b, 'rest'); // 防止原地打转
		b.stats.moodSum += mood(b.s);
		b.stats.moodN++;
		const d = dayOf(b.s.clock);
		while (lastDay < d) {
			lastDay++;
			b.stats.cashByDay.push(b.s.cash);
			if (b.s.cash < 20) b.stats.daysBroke++;
		}
	}
	return b;
}

// ---------- 汇总 ----------
const pct = (xs: number[], p: number) => {
	const v = [...xs].sort((a, b) => a - b);
	return v[Math.min(v.length - 1, Math.floor(p * v.length))];
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const lines: string[] = [];
const out = (l = '') => lines.push(l);
out(`# 数值平衡模拟报告`);
out();
out(`${DAYS} 个游戏日 × 每种策略 ${RUNS} 个随机种子。由 \`npm run earth:sim\` 生成。`);
out();
out('| 策略 | 第 7 天现金（中位） | 第 30 天 | 第 60 天 | 第 60 天 10%–90% | 日均净收入 | 期末净资产 | 买房（中位天数） | 平均心情 | 晕倒/人 | 被收房或断供/人 | 升职/人 | 第 1 / 2 次升职（中位天数） | 破产天数占比 |');
out('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const flows: string[] = [];
const skillRows: [string, number[]][] = [];
const summary: Record<string, { netPerDay: number; collapses: number; evictions: number; promotions: number; brokeShare: number; mood: number; end: number }> = {};
for (const plan of PLANS) {
	const bots = Array.from({ length: RUNS }, (_, i) => runBot(plan, i + 1));
	const at = (d: number) => bots.map((b) => b.stats.cashByDay[Math.min(d, b.stats.cashByDay.length - 1)]);
	const endD = Math.min(DAYS, 60);
	const net = avg(bots.map((b) => (b.stats.cashByDay[b.stats.cashByDay.length - 1] - b.stats.cashByDay[0]) / DAYS));
	const m = avg(bots.map((b) => b.stats.moodSum / b.stats.moodN));
	const coll = avg(bots.map((b) => b.stats.collapses));
	const ev = avg(bots.map((b) => b.stats.evictions));
	const pr = avg(bots.map((b) => b.stats.promotions));
	const broke = avg(bots.map((b) => b.stats.daysBroke / DAYS));
	const nth = (k: number) => bots.map((b) => b.stats.promoDays[k]).filter((d) => d !== undefined);
	const promoCol = [0, 1].map((k) => (nth(k).length ? `第 ${pct(nth(k), 0.5)} 天` : '—')).join(' / ');
	summary[plan.id] = { netPerDay: net, collapses: coll, evictions: ev, promotions: pr, brokeShare: broke, mood: m, end: pct(at(endD), 0.5) };
	skillRows.push([plan.name, (['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const).map((k) => Math.round(pct(bots.map((b) => b.s.skills[k]), 0.5)))]);
	const flow: Record<string, number> = {};
	for (const b of bots) for (const [k, v] of Object.entries(b.stats.flow)) flow[k] = (flow[k] ?? 0) + v / RUNS / DAYS;
	const top = Object.entries(flow).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => y[1] - x[1]);
	flows.push(`| ${plan.name} | ${top.filter(([, v]) => v > 0).map(([k, v]) => `${k} +${Math.round(v)}`).join('，') || '—'} | ${top.filter(([, v]) => v < 0).reverse().map(([k, v]) => `${k} ${Math.round(v)}`).join('，') || '—'} |`);
	out(`| ${plan.name} | ${money(pct(at(7), 0.5))} | ${money(pct(at(30), 0.5))} | ${money(pct(at(endD), 0.5))} | ${money(pct(at(endD), 0.1))}–${money(pct(at(endD), 0.9))} | ${money(net)} | ${money(pct(bots.map((b) => netWorth(b.s)), 0.5))} | ${(() => { const d = bots.map((b) => b.stats.homeDay).filter((x): x is number => x !== undefined); return d.length > bots.length / 2 ? `第 ${pct(d, 0.5)} 天` : '—'; })()} | ${m.toFixed(0)} | ${coll.toFixed(2)} | ${ev.toFixed(2)} | ${pr.toFixed(2)} | ${promoCol} | ${(broke * 100).toFixed(0)}% |`);
}
out();
out('## 第 ' + DAYS + ' 天的能力值（中位）');
out();
out('| 策略 | ' + ['体能', '力量', '驾驶', '游泳', '魅力', '生存', '街头'].join(' | ') + ' |');
out('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, sk] of skillRows) out(`| ${name} | ${sk.join(' | ')} |`);
out();
out('## 每天的钱从哪来、花到哪去（每人每天平均，美元）');
out();
out('| 策略 | 收入 | 支出（从大到小） |');
out('| --- | --- | --- |');
for (const f of flows) out(f);
out();
out('说明：日均净收入 = (期末现金 − 开局现金) / 天数；破产天数 = 当天结束时现金低于 $20 的天数。');

const text = lines.join('\n') + '\n';
process.stdout.write(text);
if (OUT) {
	writeFileSync(OUT, text);
	console.error(`已写入 ${OUT}`);
}
export { summary };
