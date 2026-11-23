// 运动和比赛（docs/earth-game/sports.md）：准备度、赛程、报名、比赛检定、俱乐部、存档清洗、页面卡片。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { cleanSport, createCharacter, emptySport, sanitizeState } from '../../src/game/core/character.ts';
import {
	clubBonusFor, clubSession, enterRace, entryFee, formOf, joinClub, medalOf, nextSlot, quitClub, raceForm, raceOdds, racePlace, raceScore, raceSecs, racesSoon, runRace, sportOfAction, train,
} from '../../src/game/core/sports.ts';
import { SEASONS, SEASON_DAYS, YEAR_DAYS, dayOf, weekdayOf } from '../../src/game/core/time.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import type { PlayerState } from '../../src/game/core/types.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { CLUBS, RACES, SPORT_RULES as R, SPORTS, type RaceDef } from '../../src/game/data/sports.ts';
import { VENUE_OPS } from '../../src/game/data/venues.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import { sportsCard } from '../../src/game/ui/sports-card.ts';
import { cancelReason, clubSessionBlocked, liveEntries, raceCancelled } from '../../src/game/core/sports.ts';
import { petTravelBlocked } from '../../src/game/core/pets.ts';
import { activityClosed } from '../../src/game/core/disasters.ts';
import { HAZARDS } from '../../src/game/data/disasters.ts';
import { actionCats } from '../../src/game/core/tally.ts';
import { featureOf } from '../../src/game/server/stats.ts';

const fresh = (origin = 'backpacker', seed = 42, loc = 'perth') =>
	createCharacter({ id: 'test-player', name: '测试', avatar: '🧑', origin, region: 'wa', spawn: loc, seed });
const race = (id: string) => RACES.find((r) => r.id === id)!;
/** 某年某场比赛那天的游戏日（年份从 1 起） */
const raceDay = (r: RaceDef, year = 1) => (year - 1) * YEAR_DAYS + SEASONS.findIndex((x) => x.id === r.season) * SEASON_DAYS + r.day! - 1;
const at = (s: PlayerState, day: number, hour: number, loc = s.loc): PlayerState => ({ ...structuredClone(s), clock: day * 1440 + hour * 60, loc });
const strong = (s: PlayerState) => {
	const x = structuredClone(s);
	for (const k of Object.keys(x.skills) as (keyof PlayerState['skills'])[]) x.skills[k] = 100;
	return x;
};
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

test('数据自洽：地点、互动、真实地点动作、权重、来源', () => {
	const locs = new Set(WORLD.locations.map((l) => l.id));
	const acts = new Set(ACTIVITIES.map((a) => a.id));
	const ops = new Set<string>(VENUE_OPS.map((o) => o.id));
	assert.equal(new Set(SPORTS.map((s) => s.id)).size, SPORTS.length);
	for (const s of SPORTS) {
		for (const a of s.acts) assert.ok(acts.has(a), `${s.id} 的互动 ${a}`);
		for (const o of s.ops) assert.ok(ops.has(o), `${s.id} 的动作 ${o}`);
		const sum = Object.values(s.weights).reduce((a, b) => a + (b ?? 0), 0);
		assert.ok(Math.abs(sum - 1) < 1e-9, `${s.id} 权重合计 1`);
	}
	// 一个互动、一个真实地点动作只算一项运动
	const all = SPORTS.flatMap((s) => [...s.acts.map((a) => `a:${a}`), ...s.ops.map((o) => `o:${o}`)]);
	assert.equal(new Set(all).size, all.length);
	assert.equal(new Set(RACES.map((r) => r.id)).size, RACES.length);
	for (const r of RACES) {
		assert.match(r.id, /^[a-z0-9-]{1,30}$/);
		for (const l of r.locs) assert.ok(locs.has(l), `${r.id} 的地点 ${l}`);
		if (r.finish) assert.ok(locs.has(r.finish), `${r.id} 的终点`);
		assert.ok((r.weekday === undefined) !== (r.season === undefined), `${r.id} 要么每周要么每年`);
		if (r.season) assert.ok(r.day! >= 1 && r.day! <= SEASON_DAYS);
		if (r.weekday !== undefined) assert.ok(r.weekday >= 0 && r.weekday <= 6);
		assert.ok(r.respect[0] >= r.respect[1] && r.respect[1] >= r.respect[2] && r.respect[2] >= r.respect[3], `${r.id} 声望金 ≥ 银 ≥ 铜 ≥ 完赛`);
		assert.ok(r.start[0] < r.start[1] && r.par > 0 && r.field >= 4 && r.fee >= 0 && r.energy > 0 && r.energy <= 100);
		assert.ok(SPORTS.some((s) => s.id === r.sport));
		if (r.ref) {
			assert.match(r.ref.source, /^https:\/\//);
			assert.match(r.ref.checked, /^\d{4}-\d{2}-\d{2}$/);
			assert.ok(r.ref.status === '已核实' || r.ref.status === '待核实');
		}
	}
	assert.equal(new Set(CLUBS.map((c) => c.id)).size, CLUBS.length);
	for (const c of CLUBS) {
		assert.ok(locs.has(c.loc), `${c.id} 的地点`);
		assert.ok(c.mates.length > 0 && c.mates.every((m) => m.lines.length > 0));
		assert.ok(c.fee > 0);
	}
});

test('准备度：训练涨、同一天递减、歇够几天后每天掉、不为负；健康每天只加一次', () => {
	const s = fresh();
	s.health = 50;
	const d = dayOf(s.clock);
	assert.equal(formOf(s, 'run'), 0);
	assert.equal(train(s, 'run'), R.formGain);
	assert.equal(train(s, 'run'), R.formGain / 2);
	assert.equal(train(s, 'run'), 0);
	assert.equal(formOf(s, 'run'), R.formGain * 1.5);
	assert.equal(s.health, 50 + R.healthPerDay, '同一天练三次只加一次健康');
	assert.equal(s.sport.total.run, 3);
	assert.equal(formOf(s, 'run', d + R.graceDays), R.formGain * 1.5, '歇够之前不掉');
	assert.equal(formOf(s, 'run', d + R.graceDays + 1), R.formGain * 1.5 - R.decayPerDay);
	assert.equal(formOf(s, 'run', d + 1000), 0);
	// 第二天再练：先按衰减后的值算，再加；健康再加一次
	const t = at(s, d + R.graceDays + 2, 9);
	train(t, 'run');
	assert.equal(formOf(t, 'run'), R.formGain * 1.5 - 2 * R.decayPerDay + R.formGain);
	assert.equal(t.health, 50 + 2 * R.healthPerDay);
	// 上限
	const u = fresh();
	for (let i = 0; i < 30; i++) {
		u.clock += 1440;
		train(u, 'swim');
	}
	assert.equal(formOf(u, 'swim'), R.formMax);
	// 健身按比例算进其他项目
	train(u, 'gym');
	assert.equal(raceForm(u, 'run'), R.crossGym * R.formGain);
});

test('日常运动通过 applyAction 记训练：成功的才算，失败不算', () => {
	assert.equal(sportOfAction({ t: 'activity', id: 'jog' }), 'run');
	assert.equal(sportOfAction({ t: 'activity', id: 'gym' }), 'gym');
	assert.equal(sportOfAction({ t: 'venue', op: 'swim' }), 'swim');
	assert.equal(sportOfAction({ t: 'venue', op: 'train' }), 'gym');
	assert.equal(sportOfAction({ t: 'venue', op: 'meal' }), undefined);
	assert.equal(sportOfAction({ t: 'activity', id: 'eat' }), undefined);
	const s = at(fresh(), 3, 9);
	const r = applyAction(s, WORLD, { t: 'activity', id: 'jog' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.sport.form.run?.v, R.formGain);
	assert.equal(s.sport.form.run, undefined, '不改入参');
	// 营业时间外：失败，不记
	const night = at(fresh(), 3, 23);
	const f = applyAction(night, WORLD, { t: 'activity', id: 'jog' });
	assert.equal(f.ok, false);
	assert.equal(f.state.sport.form.run, undefined);
	// 钱不够骑车：失败，不记
	const poor = at(fresh(), 3, 9);
	poor.cash = 0;
	assert.equal(applyAction(poor, WORLD, { t: 'activity', id: 'cycle' }).ok, false);
	// 健身房
	const g = applyAction(at(fresh(), 3, 9), WORLD, { t: 'activity', id: 'gym' });
	assert.ok(g.ok, g.msg);
	assert.equal(g.state.sport.form.gym?.v, R.formGain);
});

test('赛程：每年一次按游戏日历、每周赛按星期；届的标识按年或按日', () => {
	const r = race('city-coast-12k');
	const d = raceDay(r, 2);
	const on = nextSlot(r, d * 1440 + 8 * 60);
	assert.equal(on.startsIn, 0);
	assert.equal(on.key, 'city-coast-12k:y2');
	const before = nextSlot(r, (d - 3) * 1440);
	assert.equal(before.startsIn, 3);
	assert.equal(before.key, 'city-coast-12k:y2');
	// 比完第二天，下一届是明年
	const after = nextSlot(r, (d + 1) * 1440);
	assert.equal(after.startsIn, YEAR_DAYS - 1);
	assert.equal(after.key, 'city-coast-12k:y3');
	const p = race('park-5k');
	for (let day = 0; day < 14; day++) {
		const slot = nextSlot(p, day * 1440);
		assert.equal(weekdayOf((day + slot.startsIn) * 1440), p.weekday);
		assert.ok(slot.startsIn < 7);
		assert.equal(slot.key, `park-5k:d${day + slot.startsIn}`);
	}
	// 只列本区域、28 天内
	const s = at(fresh(), d - 5, 8);
	const soon = racesSoon(s, WORLD);
	assert.ok(soon.some((o) => o.race.id === 'city-coast-12k' && o.startsIn === 5));
	assert.ok(soon.every((o) => o.startsIn <= R.entryDays));
	assert.ok(soon.every((o, i) => i === 0 || soon[i - 1].startsIn <= o.startsIn), '按开赛先后排');
});

test('报名：扣费、不能重复、太早不开放、免费赛不用报、门槛、现场报名加价、发令后截止', () => {
	const r = race('city-coast-12k');
	const d = raceDay(r);
	const s = at(fresh(), d - 10, 12);
	const e = enterRace(s, WORLD, r.id);
	assert.ok(e.ok, e.msg);
	assert.equal(e.state.cash, s.cash - r.fee);
	assert.deepEqual(e.state.sport.entries, ['city-coast-12k:y1']);
	assert.deepEqual(s.sport.entries, [], '不改入参');
	assert.equal(enterRace(e.state, WORLD, r.id).ok, false);
	assert.equal(enterRace(at(fresh(), d - R.entryDays - 1, 12), WORLD, r.id).ok, false, '提前太多');
	assert.equal(enterRace(at(fresh(), d - 10, 12), WORLD, 'park-5k').ok, false, '免费赛不用报名');
	assert.equal(enterRace(at(fresh(), d - 10, 12), WORLD, 'nope').ok, false);
	const poor = at(fresh(), d - 10, 12);
	poor.cash = r.fee - 1;
	assert.equal(enterRace(poor, WORLD, r.id).ok, false);
	// 现场报名加价，发令时段结束后截止
	const late = enterRace(at(fresh(), d, 7), WORLD, r.id);
	assert.ok(late.ok, late.msg);
	assert.equal(late.state.cash, fresh().cash - entryFee(r, 0));
	assert.equal(entryFee(r, 0), Math.round(r.fee * R.lateFee));
	assert.equal(enterRace(at(fresh(), d, r.start[1]), WORLD, r.id).ok, false);
	// 海峡横渡要游泳 40
	const ch = race('channel-swim');
	const cd = raceDay(ch);
	const weak = at(fresh(), cd - 5, 12);
	weak.cash = 5000;
	assert.match(enterRace(weak, WORLD, ch.id).msg, /游泳/);
	const fish = at(fresh('surfer'), cd - 5, 12);
	fish.cash = 5000;
	assert.ok(enterRace(fish, WORLD, ch.id).ok);
});

/** 找一个某场海上比赛那天举办地不是风暴（或是风暴）的年份 */
const yearWhere = (r: RaceDef, storm: boolean) => {
	for (let y = 1; y < 400; y++) if (!!weatherOn(r.locs[0], raceDay(r, y)).closesSea === storm) return y;
	return 0;
};

test('参赛：地点、日子、时段、报名、精力都要对；记成绩、去报名、加声望；一届只能比一次', () => {
	const r = race('city-coast-12k');
	const d = raceDay(r);
	const base = enterRace(at(fresh(), d - 3, 12), WORLD, r.id).state;
	const ready = at(base, d, 7);
	assert.match(runRace(at(base, d - 1, 7), WORLD, r.id).msg, /天后开赛/);
	assert.match(runRace(at(base, d, 11), WORLD, r.id).msg, /发令时间/);
	assert.match(runRace(at(base, d, 7, 'fremantle'), WORLD, r.id).msg, /举办地/);
	assert.match(runRace(at(fresh(), d, 7), WORLD, r.id).msg, /还没报名/);
	const tired = at(base, d, 7);
	tired.needs.energy = r.energy - 1;
	assert.match(runRace(tired, WORLD, r.id).msg, /精力/);
	const res = runRace(ready, WORLD, r.id);
	assert.ok(res.ok, res.msg);
	const x = res.state.sport.results[0];
	assert.equal(x.key, 'city-coast-12k:y1');
	assert.deepEqual(res.state.sport.entries, []);
	assert.ok(res.state.clock > ready.clock);
	const tier = { gold: 0, silver: 1, bronze: 2, finish: 3, dnf: -1 }[x.medal];
	assert.equal(res.state.respect, ready.respect + (tier >= 0 ? r.respect[tier] : 0));
	assert.equal(ready.sport.results.length, 0, '不改入参');
	assert.match(runRace(at(res.state, d, 9, 'perth'), WORLD, r.id).msg, /比过/);
	// 同一存档、同一种子结果相同
	assert.deepEqual(runRace(ready, WORLD, r.id).state.sport.results, res.state.sport.results);
	// 免费赛不用报名，周六早上在任一举办地都能跑
	const p = race('park-5k');
	let sat = 0;
	while (weekdayOf(sat * 1440) !== p.weekday) sat++;
	const pr = runRace(at(fresh(), sat, 8, 'fremantle'), WORLD, p.id);
	assert.ok(pr.ok, pr.msg);
	assert.equal(pr.state.sport.results[0].key, `park-5k:d${sat}`);
});

test('比赛检定：能力和准备度越高越好；满能力满准备度稳拿金牌，零能力零准备度未完赛', () => {
	const r = race('city-coast-12k');
	const d = raceDay(r);
	let s = at(enterRace(at(fresh(), d - 3, 12), WORLD, r.id).state, d, 7);
	const weak = structuredClone(s);
	for (const k of Object.keys(weak.skills) as (keyof PlayerState['skills'])[]) weak.skills[k] = 0;
	const w = runRace(weak, WORLD, r.id);
	assert.equal(w.state.sport.results[0].medal, 'dnf');
	assert.equal(w.state.sport.results[0].place, 0);
	assert.equal(w.state.respect, weak.respect);
	s = strong(s);
	s.sport.form.run = { v: 100, d, n: 1 };
	for (let seed = 1; seed < 20; seed++) {
		const g = runRace({ ...s, seed }, WORLD, r.id);
		assert.equal(g.state.sport.results[0].medal, 'gold', `seed ${seed}`);
		assert.equal(g.state.sport.results[0].place, 1);
		assert.equal(g.state.respect, s.respect + r.respect[0]);
		assert.equal(g.state.sport.pb[r.id], g.state.sport.results[0].secs, '第一次完赛就是个人最好');
	}
	// 准备度、俱乐部、疲劳都进检定分
	const a = raceScore(s, r);
	const noForm = structuredClone(s);
	noForm.sport.form = {};
	assert.ok(raceScore(noForm, r).total < a.total);
	assert.equal(a.form, R.formMax * R.formWeight);
	const tired = structuredClone(s);
	tired.needs.energy = R.fatigueBelow - 10;
	assert.equal(raceScore(tired, r).fatigue, 10 * R.fatigueK);
	assert.ok(Math.abs(raceScore(tired, r).total - (a.total - 10 * R.fatigueK)) < 1e-9, '疲劳从总分里扣');
	assert.ok(raceOdds(noForm, r).finish <= raceOdds(s, r).finish);
});

test('名次档、用时和名次：分档边界、越快名次越前', () => {
	const r = race('city-coast-12k');
	assert.equal(medalOf(r.dc + R.gold, r.dc), 'gold');
	assert.equal(medalOf(r.dc + R.gold - 0.01, r.dc), 'silver');
	assert.equal(medalOf(r.dc + R.silver, r.dc), 'silver');
	assert.equal(medalOf(r.dc + R.bronze, r.dc), 'bronze');
	assert.equal(medalOf(r.dc + R.bronze - 0.01, r.dc), 'finish');
	assert.equal(medalOf(r.dc, r.dc), 'finish');
	assert.equal(medalOf(r.dc - 0.01, r.dc), 'dnf');
	assert.ok(raceSecs(r, r.dc + 60) <= raceSecs(r, r.dc + 10));
	assert.ok(raceSecs(r, r.dc + 1000) >= r.par * 60);
	assert.ok(raceSecs(r, -1000) <= Math.round(r.par * 60 * 1.6));
	assert.equal(racePlace(r, 'gold', 999), 1);
	assert.equal(racePlace(r, 'dnf', 0), 0);
	const near = racePlace(r, 'finish', r.dc + R.bronze - 1);
	const far = racePlace(r, 'finish', r.dc);
	assert.ok(near >= 4 && near < far && far <= r.field);
});

test('终点在别的地点：比完人在终点；未完赛留在起点', () => {
	const r = race('city-bay-12k');
	const d = raceDay(r);
	const s = strong(at(enterRace(at(fresh('backpacker', 1, 'adelaide'), d - 3, 12), WORLD, r.id).state, d, 7));
	const res = runRace(s, WORLD, r.id);
	assert.ok(res.ok, res.msg);
	assert.notEqual(res.state.sport.results[0].medal, 'dnf');
	assert.equal(res.state.loc, 'glenelg');
	assert.ok(res.state.visited.glenelg >= 1);
	const weak = structuredClone(s);
	for (const k of Object.keys(weak.skills) as (keyof PlayerState['skills'])[]) weak.skills[k] = 0;
	const dnf = runRace(weak, WORLD, r.id);
	assert.equal(dnf.state.sport.results[0].medal, 'dnf');
	assert.equal(dnf.state.loc, 'adelaide');
});

test('海上比赛遇风暴取消：退原价报名费、去掉报名、不能再比；不是风暴照常', () => {
	const r = race('jetty-swim');
	const stormY = yearWhere(r, true);
	assert.ok(stormY > 0, '能找到风暴的那一年');
	const d = raceDay(r, stormY);
	const s = enterRace(at(fresh('surfer', 7, 'glenelg'), d - 3, 12), WORLD, r.id).state;
	const c = runRace(at(s, d, 8), WORLD, r.id);
	assert.ok(c.ok, c.msg);
	assert.match(c.msg, /取消/);
	assert.equal(c.state.cash, s.cash + r.fee);
	assert.deepEqual(c.state.sport.entries, []);
	assert.equal(c.state.sport.results.length, 0);
	assert.equal(runRace(c.state, WORLD, r.id).ok, false, '取消后不能再退一次钱');
	const okY = yearWhere(r, false);
	const d2 = raceDay(r, okY);
	const s2 = enterRace(at(fresh('surfer', 7, 'glenelg'), d2 - 3, 12), WORLD, r.id).state;
	assert.equal(runRace(at(s2, d2, 8), WORLD, r.id).state.sport.results.length, 1);
});

test('俱乐部：入会、续费、训练课（时段、一天一次、准备度加倍）、到期、退出、队友加成', () => {
	const club = CLUBS.find((c) => c.id === 'swan-river-runners')!;
	const s = at(fresh(), 5, 12);
	assert.equal(joinClub(at(s, 5, 12, 'fremantle'), club.id).ok, false, '要在俱乐部所在地入会');
	const j = joinClub(s, club.id);
	assert.ok(j.ok, j.msg);
	assert.equal(j.state.cash, s.cash - club.fee);
	assert.deepEqual(j.state.sport.club, { id: club.id, until: 5 + R.clubDays, last: -1 });
	const renew = joinClub(j.state, club.id);
	assert.equal(renew.state.sport.club!.until, 5 + 2 * R.clubDays);
	// 训练课只在时段内
	assert.match(clubSession(j.state, WORLD).msg, /训练课时间/);
	const morning = at(j.state, 6, club.meet[0]);
	const cs = clubSession(morning, WORLD);
	assert.ok(cs.ok, cs.msg);
	assert.equal(cs.state.sport.form.run!.v, R.formGain * R.clubFormMult);
	assert.ok(cs.state.needs.social > morning.needs.social);
	assert.equal(cs.state.sport.club!.last, 6);
	assert.ok(club.mates.some((m) => cs.msg.includes(m.name)));
	assert.match(clubSession(at(cs.state, 6, club.meet[0]), WORLD).msg, /今天已经练过/);
	// 队友加成：同项目、最近 clubBonusDays 天练过、会员有效
	const r = race('city-coast-12k');
	assert.equal(clubBonusFor(at(cs.state, 6 + R.clubBonusDays, 9), 'run'), R.clubBonus);
	assert.equal(clubBonusFor(at(cs.state, 6 + R.clubBonusDays + 1, 9), 'run'), 0);
	assert.equal(clubBonusFor(at(cs.state, 7, 9), 'swim'), 0);
	assert.equal(raceScore(at(cs.state, 7, 9), r).club, R.clubBonus);
	// 到期后不能上课
	assert.match(clubSession(at(cs.state, 5 + R.clubDays, club.meet[0]), WORLD).msg, /到期/);
	assert.equal(clubBonusFor(at(cs.state, 5 + R.clubDays, 9), 'run'), 0);
	// 换俱乐部：旧的直接换掉
	const swim = joinClub(cs.state, 'cottesloe-dawn-swim');
	assert.equal(swim.state.sport.club!.id, 'cottesloe-dawn-swim');
	assert.equal(swim.state.sport.club!.last, -1);
	const q = quitClub(swim.state);
	assert.equal(q.state.sport.club, null);
	assert.equal(quitClub(q.state).ok, false);
});

test('动作协议：sport 动作的形状校验和分发', () => {
	assert.deepEqual(parseAction({ t: 'sport', op: 'enter', id: 'park-5k' }), { t: 'sport', op: 'enter', id: 'park-5k' });
	assert.deepEqual(parseAction({ t: 'sport', op: 'club' }), { t: 'sport', op: 'club' });
	assert.deepEqual(parseAction({ t: 'sport', op: 'quit', id: 'x' }), { t: 'sport', op: 'quit' });
	assert.equal(parseAction({ t: 'sport', op: 'race' }), null);
	assert.equal(parseAction({ t: 'sport', op: 'race', id: '<x>' }), null);
	assert.equal(parseAction({ t: 'sport', op: 'win', id: 'park-5k' }), null);
	const s = at(fresh(), 5, 12);
	const r = applyAction(s, WORLD, { t: 'sport', op: 'join', id: 'swan-river-runners' });
	assert.ok(r.ok);
	assert.equal(r.state.rev, s.rev + 1);
	// 有待处理事件时不能报名、参赛、上课
	const p = { ...structuredClone(s), pending: { eventId: 'x' } };
	assert.equal(applyAction(p, WORLD, { t: 'sport', op: 'join', id: 'swan-river-runners' }).ok, false);
	assert.equal(applyAction(p, WORLD, { t: 'sport', op: 'enter', id: 'city-coast-12k' }).ok, false);
	assert.equal(applyAction(p, WORLD, { t: 'sport', op: 'club' }).ok, false);
});

test('存档清洗：旧存档补空值、坏值、未知 id、未来日子、上限、幂等', () => {
	const s = fresh();
	const today = dayOf(s.clock);
	assert.deepEqual(s.sport, emptySport());
	const { sport: _drop, ...old } = s;
	assert.deepEqual(sanitizeState(old)!.sport, emptySport(), '旧存档没有这个字段');
	for (const bad of [null, 1, 'x', [], { form: [], total: null, entries: 'a', results: {}, pb: [] }]) assert.deepEqual(cleanSport(bad, s.clock), emptySport());
	const dirty = {
		form: { run: { v: 500, d: today, n: 3 }, swim: { v: 10, d: today + 5, n: 1 }, yoga: { v: 10, d: 0, n: 1 }, gym: { v: NaN, d: 0 } },
		total: { run: 7.9, swim: -1, yoga: 3, __proto__: { gym: 5 } },
		hday: today + 3,
		club: { id: 'swan-river-runners', until: 1e12, last: today + 1 },
		entries: ['city-coast-12k:y1', 'city-coast-12k:y1', 'park-5k:y1', 'nope:y1', 'city-coast-12k:d3', 'city-bay-12k:y1', 7],
		results: [
			{ race: 'city-bay-12k', key: 'city-bay-12k:y1', medal: 'gold', place: 1, secs: 2100, day: 0 },
			{ race: 'city-bay-12k', key: 'city-bay-12k:y1', medal: 'gold', place: 1, secs: 2100, day: 0 },
			{ race: 'park-5k', key: 'city-bay-12k:y1', medal: 'gold', place: 1, secs: 2100, day: 0 },
			{ race: 'park-5k', key: 'park-5k:d0', medal: 'dnf', place: 9, secs: 99, day: 0 },
			{ race: 'park-5k', key: 'park-5k:d1', medal: 'platinum', place: 1, secs: 1, day: 0 },
			{ race: 'park-5k', key: 'park-5k:d2', medal: 'finish', place: 3, secs: 900, day: today + 9 },
		],
		pb: { 'city-bay-12k': 2100.7, nope: 5, 'park-5k': -3 },
	};
	const c = cleanSport(dirty, s.clock);
	assert.deepEqual(c.form, { run: { v: R.formMax, d: today, n: 3 }, gym: { v: 0, d: 0, n: 1 } });
	assert.deepEqual(c.total, { run: 7 });
	assert.equal(c.hday, -1);
	assert.equal(c.club!.until <= today + R.clubDays * 13, true);
	assert.equal(c.club!.last, -1);
	assert.deepEqual(c.entries, ['city-coast-12k:y1'], '去重、类型对不上的、已比过的都去掉');
	assert.deepEqual(c.results, [
		{ race: 'city-bay-12k', key: 'city-bay-12k:y1', medal: 'gold', place: 1, secs: 2100, day: 0 },
		{ race: 'park-5k', key: 'park-5k:d0', medal: 'dnf', place: 0, secs: 0, day: 0 },
	]);
	assert.deepEqual(c.pb, { 'city-bay-12k': 2100 });
	assert.deepEqual(cleanSport(c, s.clock), c, '幂等');
	assert.equal(cleanSport({ club: { id: 'nope', until: 3, last: 1 } }, s.clock).club, null);
	const many = { results: Array.from({ length: 50 }, (_, i) => ({ race: 'park-5k', key: `park-5k:d${i}`, medal: 'finish', place: 5, secs: 1000, day: 0 })), entries: Array.from({ length: 50 }, (_, i) => `park-5k:d${i + 100}`) };
	const m = cleanSport(many, 200 * 1440);
	assert.equal(m.results.length, R.resultsMax);
	assert.equal(m.entries.length, R.entriesMax);
	// 整份存档：比过一场后过 sanitizeState 两遍不变
	const r = race('city-coast-12k');
	const d = raceDay(r);
	const done = runRace(at(enterRace(at(fresh(), d - 3, 12), WORLD, r.id).state, d, 7), WORLD, r.id).state;
	const once = sanitizeState(done)!;
	assert.deepEqual(once.sport, done.sport);
	assert.deepEqual(sanitizeState(once), once);
});

test('页面卡片：有比赛时出现、按钮带 data-sport、文字经过 esc', () => {
	const r = race('city-coast-12k');
	const d = raceDay(r);
	const s = at(fresh(), d, 7);
	s.name = '<b>';
	const html = sportsCard(s, WORLD, esc);
	assert.match(html, /data-sport="enter" data-sport-id="city-coast-12k"/);
	assert.match(html, /data-sport="race" data-sport-id="city-coast-12k"/);
	assert.match(html, /data-sport="join" data-sport-id="swan-river-runners"/);
	assert.match(html, /<details class="card" open>/, '比赛当天展开');
	// esc 被调用：把 esc 换成加标记的版本，所有比赛名都带标记
	const marked = sportsCard(s, WORLD, (v) => `«${esc(v)}»`);
	for (const o of racesSoon(s, WORLD)) assert.ok(marked.includes(`«${o.race.name}» · `), o.race.id);
	// 偏远地方、没比赛、没练过：不显示
	const far = at(fresh('backpacker', 1, 'kununurra'), 2, 9, 'kununurra');
	const farSoon = racesSoon(far, { ...WORLD, locations: WORLD.locations.filter((l) => l.id === 'kununurra') });
	assert.equal(farSoon.length, 0);
	assert.equal(sportsCard(far, { ...WORLD, locations: WORLD.locations.filter((l) => l.id === 'kununurra') }, esc), '');
});

// ---------- 合并 main 后：和健康、自然灾害、生涯统计、统计的接法 ----------
const sick = (s: PlayerState, id = 'flu'): PlayerState => ({ ...s, illness: { id, since: s.clock, until: s.clock + 3 * 1440 } } as PlayerState);

test('生病时不能比赛、不能上俱乐部训练课（合并 main 后）', () => {
	const p5 = race('park-5k');
	let day = 0;
	while (weekdayOf(day * 1440) !== p5.weekday) day++;
	const base = { ...at(strong(fresh()), day, 7, 'perth'), needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 } };
	assert.ok(runRace(base, WORLD, p5.id).ok, '没病能跑');
	const r = runRace(sick(base), WORLD, p5.id);
	assert.equal(r.ok, false);
	assert.match(r.msg, /流感中/);
	const club = CLUBS.find((c) => c.sport === 'run')!;
	const member = { ...at(base, day, club.meet[0], club.loc), sport: { ...emptySport(), club: { id: club.id, until: day + 30, last: -1 } } };
	assert.equal(clubSessionBlocked(member, WORLD), undefined);
	assert.match(clubSessionBlocked(sick(member), WORLD)!, /流感中/);
	assert.equal(clubSession(sick(member), WORLD).ok, false);
});

test('自然灾害让户外活动暂停时：跑步、骑车关；比赛取消（报过名的退费）；训练课停（合并 main 后）', () => {
	// 收费的年度赛在比赛日都没碰上灾害（40 年内），用每周六的公园 5 公里：找一个举办地当天跑步被灾害关掉的周六
	const p5 = race('park-5k');
	let hit: { loc: string; day: number } | null = null;
	for (let d = 0; d < 3650 && !hit; d++) {
		if (weekdayOf(d * 1440) !== p5.weekday) continue;
		for (const l of p5.locs.filter((x) => CLUBS.some((c) => c.sport === 'run' && c.loc === x))) {
			const loc = WORLD.locations.find((x) => x.id === l)!;
			if (activityClosed(loc, d, 'jog')) { hit = { loc: l, day: d }; break; }
		}
	}
	assert.ok(hit, '十年里有跑团的举办地总有碰上灾害的周六');
	const { loc, day } = hit!;
	const where = WORLD.locations.find((x) => x.id === loc)!;
	assert.ok(activityClosed(where, day, 'cycle') && activityClosed(where, day, 'hike'), '跑步、骑车和徒步同进退');
	assert.match(raceCancelled(p5, WORLD, loc, day)!, /户外活动暂停/);
	const s = { ...at(strong(fresh()), day, p5.start[0], loc), needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 } };
	const out = runRace(s, WORLD, p5.id);
	assert.equal(out.ok, false, '免费赛没报名：只提示取消');
	assert.match(out.msg, /取消了/);
	const club = CLUBS.find((c) => c.sport === 'run' && c.loc === loc)!;
	assert.ok(club);
	assert.match(clubSessionBlocked({ ...at(s, day, club.meet[0], loc), sport: { ...emptySport(), club: { id: club.id, until: day + 30, last: -1 } } }, WORLD)!, /户外活动暂停/);
	// 不是比赛举办地的灾害不影响
	const elsewhere = p5.locs.find((l) => !activityClosed(WORLD.locations.find((x) => x.id === l)!, day, 'jog'));
	if (elsewhere) assert.equal(raceCancelled(p5, WORLD, elsewhere, day), undefined);
});

test('生涯统计和统计：报名费、会费记「玩乐」；动作名按白名单带子操作（合并 main 后）', () => {
	assert.deepEqual(actionCats({ t: 'sport', op: 'enter', id: 'x' }), ['fun', 'fun']);
	assert.deepEqual(actionCats({ t: 'sport', op: 'club' }), ['fun', 'fun']);
	for (const op of ['enter', 'race', 'join'] as const) assert.equal(featureOf({ t: 'sport', op, id: 'x' }), `sport.${op}`);
	assert.equal(featureOf({ t: 'sport', op: 'club' }), 'sport.club');
	assert.equal(featureOf({ t: 'sport', op: 'quit' }), 'sport.quit');
});

test('已经取消的这一届不能再报名（不再交现场加价的报名费）；参赛时退报名费（合并 main 后复核）', () => {
	const r = race('jetty-swim');
	// 找一年比赛日正好风暴的
	let day = -1;
	for (let y = 1; y <= 60 && day < 0; y++) if (weatherOn('glenelg', raceDay(r, y)).closesSea) day = raceDay(r, y);
	assert.ok(day >= 0, '60 年里栈桥赛总有一次碰上风暴');
	assert.equal(cancelReason(r, WORLD, 'glenelg', day), '风浪太大');
	const s = { ...at(strong(fresh()), day, r.start[0], 'glenelg'), cash: 500 };
	const e = enterRace(s, WORLD, r.id);
	assert.equal(e.ok, false, '取消了的这一届不能报名');
	assert.match(e.msg, /取消了/);
	const soon = racesSoon(s, WORLD).find((o) => o.race.id === r.id)!;
	assert.match(soon.enterBlocked!, /取消了/);
	assert.match(soon.raceBlocked!, /取消了/);
	// 前几天报过名的：当天点参赛退原价
	const key = nextSlot(r, day * 1440).key;
	const out = runRace({ ...s, sport: { ...emptySport(), entries: [key] } }, WORLD, r.id);
	assert.ok(out.ok, out.msg);
	assert.equal(out.state.cash, 500 + r.fee);
	assert.deepEqual(out.state.sport.entries, []);
});

test('错过的报名过了比赛日就不再占名额；报下一场时顺手清掉（合并 main 后复核）', () => {
	const r = race('city-coast-12k');
	const stale = Array.from({ length: R.entriesMax }, (_, i) => `${r.id}:y${i + 1}`);
	const day = raceDay(r, R.entriesMax + 1) - 2; // 第 entriesMax + 1 年比赛前两天
	const s = { ...at(strong(fresh()), day, 10, r.locs[0]), cash: 1000, sport: { ...emptySport(), entries: stale } };
	assert.deepEqual(liveEntries(s), [], '往年的报名都过期了');
	const e = enterRace(s, WORLD, r.id);
	assert.ok(e.ok, e.msg);
	assert.deepEqual(e.state.sport.entries, [nextSlot(r, s.clock).key], '过期的清掉，只留这一届');
});

test('终点在宠物不能去的岛上：带着没寄养的宠物不能参赛（合并 main 后复核）', () => {
	const r = race('channel-swim');
	assert.equal(r.finish, 'rottnest');
	const day = raceDay(r, 1);
	const base = { ...at(strong(fresh()), day, r.start[0], r.locs[0]), needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 }, sport: { ...emptySport(), entries: [nextSlot(r, day * 1440).key] } };
	const withPet = { ...base, pet: { kind: 'dog', name: '豆豆', from: 'shelter', since: 0, bond: 50, fedDay: day, playDay: -1, walkDay: day, vetDay: 0, board: null } } as PlayerState;
	assert.ok(petTravelBlocked(withPet, 'rottnest', 'ferry'), '前提：宠物不能上岛');
	const soon = racesSoon(withPet, WORLD).find((o) => o.race.id === r.id)!;
	assert.match(soon.raceBlocked!, /罗特尼斯岛/);
	const out = runRace(withPet, WORLD, r.id);
	if (!weatherOn(r.locs[0], day).closesSea) {
		assert.equal(out.ok, false);
		assert.equal(out.state.loc, r.locs[0]);
	}
	assert.equal(racesSoon(base, WORLD).find((o) => o.race.id === r.id)!.raceBlocked?.includes('罗特尼斯岛') ?? false, false, '没宠物照常');
});

test('灾害的户外关闭清单：有徒步的地方都有跑步、骑车（合并 main 后）', () => {
	for (const h of Object.values(HAZARDS)) {
		const out = (h as { outdoor?: string[] }).outdoor;
		if (out?.includes('hike')) for (const a of ['jog', 'cycle']) assert.ok(out.includes(a), `${h.id} 关徒步却不关 ${a}`);
	}
});

test('运动卡摘要只数还没比的（和地点抽屉的摘要一致）', () => {
	const p5 = race('park-5k');
	let day = 0;
	while (weekdayOf(day * 1440) !== p5.weekday) day++;
	const s0 = at(strong(fresh()), day, 10, 'perth');
	const key = nextSlot(p5, s0.clock).key;
	const s = { ...s0, sport: { ...emptySport(), results: [{ race: p5.id, key, medal: 'gold' as const, place: 1, secs: 1200, day }] } };
	const n = racesSoon(s, WORLD).filter((o) => !o.done).length;
	const html = sportsCard(s, WORLD, esc);
	if (n) assert.match(html, new RegExp(`>${n} 场比赛快到了<`));
	else assert.doesNotMatch(html, /场比赛快到了/);
	assert.ok(racesSoon(s, WORLD).some((o) => o.done), '前提：今天这一届已经比过');
});
