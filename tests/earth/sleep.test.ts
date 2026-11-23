// 第 43 批：时间、作息和睡眠（设计见 docs/earth-game/time-sleep.md）
import { derivedStats } from '../../src/game/core/formulas.ts';
import { featureOf } from '../../src/game/server/stats.ts';
import { energyCap } from '../../src/game/core/vitals.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, ORIGINS, sanitizeState, START_CLOCK } from '../../src/game/core/character.ts';
import { homeSpot, napHome, performActivity, rentHome, sleepHome, sleepInVehicle } from '../../src/game/core/engine.ts';
import { agenda, shiftStatus, timeConflict } from '../../src/game/core/schedule.ts';
import { awakeMinutes, debtNow, jetlagHours, minutesToLate, settleSleep, sleepFx, sleepQuality } from '../../src/game/core/sleep.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';
import { BED, NOISE, ORIGIN_TZ, SLEEP } from '../../src/game/data/sleep.ts';
import { WA } from '../../src/game/data/wa.ts';
import { queueable } from '../../src/game/ui/queue.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, origin = 'student'): PlayerState => ({
	...createCharacter({ id: 'sleep-player', name: '测', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const housed = (over: Partial<PlayerState> = {}) => rentHome(make({ cash: 5000, clock: at(9), ...over }), WA, 'room').state;
const moods = (s: PlayerState) => s.moodlets.map((m) => m.id);

test('数据表自洽：出身都有时区、睡觉活动标了床、心情存在、数值在合理范围', () => {
	for (const o of ORIGINS) assert.ok(Object.hasOwn(ORIGIN_TZ, o.id), `${o.id} 要写明时区（本地人写 null）`);
	const beds = ACTIVITIES.filter((a) => a.bed);
	assert.deepEqual(beds.map((a) => a.id).sort(), ['sleep-camp', 'sleep-motel']);
	for (const a of beds) assert.ok(Object.hasOwn(BED, a.bed!));
	for (const id of ['sleep-debt', 'rough-night', SLEEP.goodMoodlet]) assert.ok(MOODLETS.some((m) => m.id === id), id);
	assert.ok(SLEEP.qualityMin > 0 && SLEEP.qualityMin < SLEEP.poorAt && SLEEP.poorAt < 1 && SLEEP.qualityMax >= 1);
	assert.ok(SLEEP.napMinutes < SLEEP.fullMinutes && SLEEP.awakeOkMinutes < 1440);
	for (const v of Object.values(NOISE)) assert.ok(v! >= 0 && v! < 0.3);
});

test('睡眠质量：床、噪音、几点睡', () => {
	const s = make({ clock: at(22) });
	const motel = sleepQuality(s, WA, { bed: 'motel' });
	assert.equal(motel.q, Math.round((BED.motel - NOISE.city!) * 100) / 100, '珀斯是城市，扣噪音');
	assert.equal(motel.offHours, false);
	const day = sleepQuality({ ...s, clock: at(10) }, WA, { bed: 'motel' });
	assert.ok(day.offHours && day.q < motel.q, '白天睡打折');
	assert.ok(day.notes.some((n) => n.includes('不是夜里')));
	const quiet = sleepQuality({ ...s, loc: 'pinnacles' }, WA, { bed: 'motel' });
	assert.equal(quiet.noise, 0);
	assert.ok(quiet.q > motel.q, '野外安静');
	const plain = sleepQuality(s, WA, { bed: 'home', comfort: 0 });
	const fancy = sleepQuality(s, WA, { bed: 'home', comfort: 10, bedFurniture: true });
	assert.ok(fancy.q > plain.q);
	// 床位家具单独起作用（舒适度相同）
	assert.equal(Math.round((sleepQuality(s, WA, { bed: 'home', comfort: 2, bedFurniture: true }).q - sleepQuality(s, WA, { bed: 'home', comfort: 2 }).q) * 100) / 100, BED.home.bedFurniture);
	assert.ok(fancy.q <= SLEEP.qualityMax && plain.q >= SLEEP.qualityMin);
	assert.ok(sleepQuality(s, WA, { bed: 'home', comfort: 1e6, bedFurniture: true }).q <= SLEEP.qualityMax, '钳上限');
	// 凌晨 2 点还算按时，3 点不算
	assert.equal(sleepQuality({ ...s, clock: at(2, 1) }, WA, { bed: 'motel' }).offHours, false);
	assert.equal(sleepQuality({ ...s, clock: at(3, 1) }, WA, { bed: 'motel' }).offHours, true);
});

test('时差：从 UTC+8 来的人在西澳没有、在南澳有，按天倒回；本地人没有', () => {
	const adl = SA_BASE.locations.find((l) => l.id === 'adelaide')!;
	assert.equal(jetlagHours('student', 115.86, at(22)), 0, '西澳也是 UTC+8');
	assert.equal(jetlagHours('student', adl.lon, at(22)), 1.5, '游戏开局对应 9 月，南澳 UTC+9:30');
	assert.equal(jetlagHours('student', adl.lon, at(22, 1)), 0.5);
	assert.equal(jetlagHours('student', adl.lon, at(22, 5)), 0);
	assert.equal(jetlagHours('fifo', adl.lon, at(22)), 0);
	assert.equal(jetlagHours('unknown-origin', adl.lon, at(22)), 0);
	const s = { ...make({ clock: at(22) }), loc: 'adelaide' };
	const sq = sleepQuality(s, SA_BASE, { bed: 'motel' });
	assert.equal(sq.jetlag, 1.5);
	assert.equal(sq.q, Math.round((BED.motel - NOISE.city! - 1.5 * SLEEP.jetlag.perHour) * 100) / 100);
});

test('sleepFx：只缩放恢复，不改入参；没睡好不发「睡了个好觉」', () => {
	const fx = { minutes: 480, health: 10, moodlet: SLEEP.goodMoodlet, needs: { energy: 100, hygiene: -15 } };
	const copy = structuredClone(fx);
	const out = sleepFx(fx, 0.8);
	assert.deepEqual(fx, copy);
	assert.equal(out.needs!.energy, 80);
	assert.equal(out.needs!.hygiene, -15);
	assert.equal(out.health, 8);
	assert.equal(out.moodlet, SLEEP.goodMoodlet);
	assert.equal(sleepFx(fx, SLEEP.poorAt - 0.01).moodlet, undefined);
	assert.equal(sleepFx({ health: -5, needs: { energy: -10 } }, 0.5).health, -5, '扣的不缩放');
	assert.equal(sleepFx({ health: -5, needs: { energy: -10 } }, 0.5).needs!.energy, -10);
});

test('settleSleep：16 小时内不欠债；熬夜记债、睡觉还一半；补觉只往回拨', () => {
	const ok = settleSleep({ wake: 0, debt: 0 }, 15 * 60, 15 * 60 + 480, 1, false);
	assert.deepEqual(ok.rest, { wake: 15 * 60 + 480, debt: 0 });
	assert.deepEqual(ok.moodlets, []);
	// 醒了 24 小时：欠 8 小时，睡 8 小时 × 质量 1 × 0.5 还 4 小时
	const late = settleSleep({ wake: 0, debt: 0 }, 24 * 60, 32 * 60, 1, false);
	assert.equal(late.rest.debt, 4);
	assert.equal(late.repaid, 4);
	assert.ok(late.moodlets.includes('sleep-debt'));
	// 质量低时还得少
	assert.equal(settleSleep({ wake: 0, debt: 0 }, 24 * 60, 32 * 60, 0.5, false).rest.debt, 6);
	// 债有上限
	assert.equal(settleSleep({ wake: 0, debt: 0 }, 100 * 60, 100 * 60, 1, false).rest.debt, SLEEP.debtMax);
	// 补觉 2 小时：醒了 12 小时 → 拨回 6 小时
	const nap = settleSleep({ wake: 0, debt: 0 }, 12 * 60, 14 * 60, 1, true);
	assert.equal(14 * 60 - nap.rest.wake, 6 * 60);
	// 醒了 30 小时再补觉：超出 16 小时的部分已经记了债，拨回后不超过 16 小时，不重复记
	const nap2 = settleSleep({ wake: 0, debt: 0 }, 30 * 60, 32 * 60, 1, true);
	assert.equal(32 * 60 - nap2.rest.wake, SLEEP.awakeOkMinutes);
	assert.equal(nap2.rest.debt, 14 - 1);
	// 质量差挂「没睡好」
	assert.ok(settleSleep({ wake: 0, debt: 0 }, 60, 540, SLEEP.poorAt - 0.05, false).moodlets.includes('rough-night'));
	// 醒来时间在入睡之后（坏数据）按没醒过算
	assert.equal(settleSleep({ wake: 9999, debt: 0 }, 60, 540, 1, false).rest.debt, 0);
});

test('经引擎：回家睡觉记作息、日志写质量；熬夜后睡挂心情', () => {
	const s = housed();
	assert.equal(s.rest.wake, START_CLOCK - 60);
	const night = { ...s, clock: at(22) };
	const r = sleepHome(night, WA);
	assert.ok(r.ok);
	assert.equal(r.state.rest.wake, r.state.clock);
	assert.equal(r.state.rest.debt, 0);
	assert.ok(r.msg.includes('睡眠质量'));
	assert.ok(r.state.journal.at(-1)!.text.includes('睡眠质量'));
	// 第 1 天 7 点醒，熬到第 2 天 7 点（醒 24 小时）再睡
	const late = sleepHome({ ...s, clock: at(7, 1) }, WA);
	assert.ok(late.state.rest.debt > 0);
	assert.ok(moods(late.state).includes('sleep-debt'));
	assert.ok(!moods(late.state).includes('great-sleep'));
	assert.deepEqual(s.rest, { wake: START_CLOCK - 60, debt: 0 }, '不改入参');
});

test('经引擎：有好床但睡得差（白天、城里、时差），不发「睡了个好觉」，挂「没睡好」', () => {
	const s = make({ loc: 'adelaide', clock: at(10), home: { type: 'room', loc: 'adelaide', furniture: { bed: 'mattress' } } });
	const q = sleepQuality(s, SA_BASE, { bed: 'home', comfort: 0, bedFurniture: true }).q;
	assert.ok(q < SLEEP.poorAt, `质量 ${q}`);
	const r = sleepHome(s, SA_BASE);
	assert.ok(r.ok, r.msg);
	assert.ok(!moods(r.state).includes('great-sleep'));
	assert.ok(moods(r.state).includes('rough-night'));
	// 同一张床夜里睡就是好觉
	const night = sleepHome({ ...s, clock: at(22, 3) }, SA_BASE);
	assert.ok(moods(night.state).includes('great-sleep'));
});

test('睡眠债存量：没熬夜也算着之前欠的，按时睡慢慢还', () => {
	const s = { ...housed(), clock: at(22), rest: { wake: at(7), debt: 6 } };
	assert.equal(debtNow(s), 6);
	const q = sleepQuality(s, WA, homeSpot(s)).q;
	const r = sleepHome(s, WA);
	assert.equal(r.state.rest.debt, Math.round((6 - 8 * q * SLEEP.repayPerHour) * 10) / 10, '一夜还 8 × 质量 × 0.5 小时');
});

test('经引擎：补觉', () => {
	const s = { ...housed(), clock: at(15), needs: { hunger: 80, energy: 20, hygiene: 80, fun: 80, social: 80 } };
	const r = applyAction(s, WA, { t: 'home', op: 'nap' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.clock, s.clock + SLEEP.napMinutes);
	assert.ok(r.state.needs.energy > s.needs.energy);
	assert.ok(r.state.needs.energy < 60, '补觉回得比整觉少');
	assert.ok(awakeMinutes(r.state) < awakeMinutes(s), '醒着的时间往回拨了');
	assert.equal(napHome({ ...s, loc: 'fremantle' }, WA).ok, false, '不在住处');
	assert.equal(napHome({ ...s, home: null }, WA).ok, false, '没住处');
	assert.equal(napHome({ ...s, pending: { eventId: 'x' } }, WA).ok, false);
	assert.deepEqual(parseAction({ t: 'home', op: 'nap' }), { t: 'home', op: 'nap' });
	assert.equal(queueable({ t: 'home', op: 'nap' }), true);
});

test('经引擎：住旅馆、露营、睡车都走睡眠规则', () => {
	const s = make({ cash: 5000, clock: at(22), health: 40, needs: { hunger: 90, energy: 5, hygiene: 50, fun: 50, social: 50 } });
	const motel = performActivity(s, WA, 'sleep-motel');
	assert.ok(motel.ok);
	assert.ok(motel.msg.includes('睡眠质量'));
	assert.equal(motel.state.rest.wake, motel.state.clock);
	const dayMotel = performActivity({ ...s, clock: at(10) }, WA, 'sleep-motel');
	assert.ok(dayMotel.state.health < motel.state.health, '白天住旅馆回的健康少（合并 main 后：精力有上限（约 81–84），住旅馆、回家睡夜里和白天都能睡到上限，睡眠质量的差别体现在健康恢复、心情和睡眠债上）');
	assert.ok(dayMotel.state.needs.energy <= energyCap(dayMotel.state));
	// 露营的床差：恢复的精力乘质量后低于上限，看得出睡眠质量
	const camp = performActivity(s, WA, 'sleep-camp');
	assert.ok(camp.state.needs.energy < energyCap(camp.state));
	// 不是睡觉的活动不碰作息
	const ate = performActivity({ ...s, needs: { ...s.needs, hunger: 20 } }, WA, 'eat');
	assert.deepEqual(ate.state.rest, s.rest);
	const van = sleepInVehicle({ ...s, vehicle: 'campervan' }, WA);
	assert.ok(van.ok, van.msg);
	assert.ok(van.msg.includes('睡眠质量'));
	assert.equal(van.state.rest.wake, van.state.clock);
});

test('晕倒住院：醒着的时间从出院算起，欠的觉不免', () => {
	const s = make({ clock: at(30), health: 1, rest: { wake: 0, debt: 3 }, needs: { hunger: 0, energy: 0, hygiene: 50, fun: 50, social: 50 } });
	const r = performActivity(s, WA, 'lay-low');
	assert.ok(r.collapsed);
	assert.equal(r.state.rest.wake, r.state.clock);
	// 合并 main 时复核：入院前熬夜新欠的觉也记上（原来只留存着的 3 小时）。入院那刻醒了 (出院时刻 − 12 小时) 分钟，超过 16 小时的部分记债
	const awakeH = (r.state.clock - 12 * 60) / 60;
	assert.equal(r.state.rest.debt, Math.min(SLEEP.debtMax, Math.round((3 + Math.max(0, awakeH - SLEEP.awakeOkMinutes / 60) * SLEEP.debtPerHour) * 10) / 10));
	assert.ok(r.state.rest.debt > 3);
});

test('存档清洗：旧存档缺字段、坏值、未来时间、幂等', () => {
	const base = make({ clock: at(10, 3) });
	const { rest: _drop, ...old } = base;
	const a = sanitizeState(old)!;
	assert.deepEqual(a.rest, { wake: base.clock, debt: 0 }, '旧存档按刚醒、不欠债');
	assert.deepEqual(sanitizeState(a)!.rest, a.rest, '幂等');
	for (const bad of [null, [], 'x', 42, { wake: NaN, debt: Infinity }, { wake: -5, debt: -1 }, { wake: 1e12, debt: 1e9 }, Object.create({ wake: 1, debt: 5 })]) {
		const r = sanitizeState({ ...base, rest: bad })!;
		assert.ok(r, `不判损坏：${JSON.stringify(bad)}`);
		assert.ok(r.rest.wake >= 0 && r.rest.wake <= r.clock, `wake 在 [0, clock]：${JSON.stringify(bad)}`);
		assert.ok(r.rest.debt >= 0 && r.rest.debt <= SLEEP.debtMax);
		assert.deepEqual(sanitizeState(r)!.rest, r.rest, '幂等');
	}
	assert.equal(sanitizeState({ ...base, rest: { wake: base.clock + 999, debt: 2.345 } })!.rest.wake, base.clock, '醒来时间不能晚于现在');
	assert.equal(sanitizeState({ ...base, rest: { wake: 100, debt: 2.345 } })!.rest.debt, 2.3);
	assert.equal(sanitizeState({ ...base, rest: { wake: 100, debt: 2 } })!.rest.wake, 100);
});

test('日程：上班状态和睡觉提示', () => {
	const hired = make({ clock: at(5), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	assert.equal(shiftStatus(make()), null);
	assert.equal(shiftStatus(hired), 'later');
	assert.equal(shiftStatus({ ...hired, clock: at(7) }), 'now');
	assert.equal(shiftStatus({ ...hired, clock: at(12) }), 'missed');
	assert.equal(shiftStatus({ ...hired, clock: at(7), job: { ...hired.job!, lastDay: 0 } }), 'done');
	const items = agenda({ ...hired, clock: at(7) }, WA);
	assert.deepEqual(items.map((i) => i.kind), ['work', 'sleep']);
	assert.equal(items[0].note, undefined, '人在工作地点不写在哪');
	assert.equal(agenda({ ...hired, loc: 'fremantle' }, WA)[0].note, '在珀斯', '人不在工作地点时写工作在哪');
	assert.deepEqual(agenda(make(), WA).map((i) => i.kind), ['sleep']);
	const owl = make({ clock: at(23, 1) });
	assert.ok(minutesToLate(owl) === 0 && debtNow(owl) > 0);
	assert.ok(agenda(owl, WA)[0].note!.includes('在熬夜'));
});

test('冲突提醒：做完会错过开工窗口、开始熬夜；不拦动作', () => {
	const hired = make({ clock: at(9), job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	// 咖啡店 6–11 点开工：9 点做 2 小时的事刚好到 11 点
	assert.match(timeConflict(hired, 120)!, /赶不上今天咖啡店的班/);
	assert.equal(timeConflict(hired, 119), undefined);
	assert.equal(timeConflict({ ...hired, job: { ...hired.job!, lastDay: 0 } }, 600), undefined, '上过班了');
	assert.equal(timeConflict({ ...hired, clock: at(12) }, 60), undefined, '窗口已经过了');
	assert.equal(timeConflict(hired, 0), undefined);
	assert.equal(timeConflict(hired, NaN), undefined);
	// 7 点醒，22:30 做一小时的事 → 23:30，醒了 16.5 小时
	const evening = make({ clock: at(22.5) });
	assert.match(timeConflict(evening, 60)!, /熬夜/);
	assert.equal(timeConflict(evening, 29), undefined);
	assert.match(timeConflict(evening, 30)!, /熬夜/, '刚好到 16 小时也提醒');
	assert.equal(timeConflict(make({ clock: at(23.5) }), 10), undefined, '已经在熬了就不再提醒');
});

// ---------- 合并 main 时复核修正 ----------
test('复核：开工窗口开着但上不了班（太累、生病、停工）时，日程写原因、不说「现在」', () => {
	const job = { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 };
	const ok = make({ loc: 'perth', clock: at(7), job, needs: { hunger: 80, energy: 80, hygiene: 80, fun: 80, social: 80 } });
	assert.equal(agenda(ok, WA)[0].status, 'now');
	const tired = make({ loc: 'perth', clock: at(7), job, needs: { hunger: 80, energy: 5, hygiene: 80, fun: 80, social: 80 } });
	const w = agenda(tired, WA)[0];
	assert.equal(w.status, 'blocked');
	assert.match(w.note ?? '', /太累/);
});

test('复核：睡觉的提醒只说会不会赶不上班，不说「开始熬夜」', () => {
	const s = make({ clock: at(22), rest: { wake: at(7), debt: 0 } });
	assert.match(timeConflict(s, 480) ?? '', /熬夜/);
	assert.equal(timeConflict(s, 480, true), undefined);
});

test('复核：存档里醒来时间早于日志里最近一次睡醒，按那次算（跨分支部署时别的代码睡过觉）', () => {
	const base = make({ clock: at(10, 5) });
	const raw = JSON.parse(JSON.stringify(base));
	raw.rest = { wake: 0, debt: 0 };
	raw.journal = [...raw.journal, { t: at(8, 5), text: '在合租房间睡了一觉。' }];
	const a = sanitizeState(raw)!;
	assert.equal(a.rest.wake, at(8, 5));
	assert.deepEqual(sanitizeState(a)!.rest, a.rest, '幂等');
	raw.journal.push({ t: at(9, 5), text: '买了一瓶水。' });
	assert.equal(sanitizeState(raw)!.rest.wake, at(8, 5), '别的日志不算');
	assert.equal(featureOf({ t: 'home', op: 'nap' }), 'home.nap');
});

test('合并 main：一觉的恢复先乘睡眠质量，再乘体质的恢复系数；睡着时精力不往下掉', () => {
	// 露营的床差，恢复到不了精力上限，看得出两层叠加
	const s = make({ clock: at(22), needs: { hunger: 90, energy: 5, hygiene: 50, fun: 50, social: 50 } }, 'backpacker');
	const q = sleepQuality(s, WA, { bed: 'camp' }).q;
	const rec = derivedStats(s).recovery;
	assert.ok(rec > 1, '背包客体质好，恢复系数大于 1');
	const r = performActivity(s, WA, 'sleep-camp');
	// 活动效果还会按特质、能力缩放（scaledFx），这里不逐位核对，只看两层都在：睡着时精力不往下掉（否则 8 小时要掉二十多点），恢复按质量打了折
	const floor = 5 + 70 * q * 0.9;
	assert.ok(r.state.needs.energy > floor, `醒来精力 ${r.state.needs.energy}，至少 ${floor.toFixed(1)}（睡着时没掉精力）`);
	assert.ok(r.state.needs.energy < 5 + 70 * rec + 0.1, '恢复按睡眠质量打了折');
	assert.ok(r.state.needs.energy < energyCap(r.state));
});

test('合并 main：补觉也算睡着——精力不往下掉，恢复按质量和体质', () => {
	const s = make({ clock: at(14), loc: 'perth', home: { type: 'room', loc: 'perth', furniture: {} }, needs: { hunger: 90, energy: 20, hygiene: 60, fun: 60, social: 60 } }, 'backpacker');
	const q = sleepQuality(s, WA, homeSpot(s)).q;
	const r = napHome(s, WA);
	assert.ok(r.ok, r.msg);
	const floor = 20 + SLEEP.napEnergy * q; // 体质恢复系数大于 1，所以至少这么多；要是醒着过这 2 小时，精力还会再掉
	assert.ok(r.state.needs.energy >= floor, `补觉后精力 ${r.state.needs.energy}，至少 ${floor.toFixed(1)}`);
});

test('合并 main：房间转租出去时不能回去补觉', () => {
	const s = make({ clock: at(14), loc: 'perth', home: { type: 'room', loc: 'perth', furniture: {} } });
	assert.ok(napHome(s, WA).ok);
	const sub = structuredClone(s);
	sub.flatshare.sublet = true;
	assert.match(napHome(sub, WA).msg, /转租/);
});

