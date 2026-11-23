// 第 43 批：自然灾害（core/disasters.ts、data/disasters.ts、ui/disasters.ts）
import { VOLUNTEER_GIGS } from '../../src/game/data/volunteer.ts';
import { HOBBY_IDS } from '../../src/game/data/hobbies.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import {
	bushfireLevel, CLAIMABLE, cycloneLevel, evacuationTarget, floodLevel, heatwaveLevel, hotRun, incidentsFor, monthOfDay, routeClosed, warningsOn, workStopped, type Warning,
} from '../../src/game/core/disasters.ts';
import { activitiesAt, buyFurniture, homeActionBlocked, performActivity, rentHome, shiftBlocked, travel, travelOptions, workShift } from '../../src/game/core/engine.ts';
import { cookAtHome, cookBlocked, hostBlocked } from '../../src/game/core/cooking.ts';
import { fireDanger, isCoastal } from '../../src/game/core/sky.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import type { GameLocation, PlayerState, Region } from '../../src/game/core/types.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { DISASTER_RULES, HAZARDS, KIT_ITEM, WARN_LEVELS } from '../../src/game/data/disasters.ts';
import { ITEMS } from '../../src/game/data/items.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';
import { WA } from '../../src/game/data/wa.ts';
import { venueAction, venuesNear } from '../../src/game/core/venues.ts';
import { VENUE_TYPES } from '../../src/game/data/venues.ts';
import { warningChip, warningRows } from '../../src/game/ui/disasters.ts';

const DAYS = 112 * 6;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'disaster-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const loc = (id: string) => WA.locations.find((l) => l.id === id)!;
const neighbors = (region: Region, id: string) => region.routes.filter((r) => r.a === id || r.b === id).map((r) => ({ to: region.locations.find((l) => l.id === (r.a === id ? r.b : r.a))!, mode: r.mode }));

/** 扫一遍 WA，找第一个满足条件的（地点, 天） */
function find(pred: (l: GameLocation, day: number, ws: Warning[]) => boolean, region: Region = WA): { l: GameLocation; day: number } {
	for (let day = 0; day < DAYS; day++) for (const l of region.locations) if (pred(l, day, warningsOn(l, day))) return { l, day };
	throw new Error('扫描范围内没找到');
}
const has = (ws: Warning[], hazard: string, level?: number) => ws.some((w) => w.hazard === hazard && (level === undefined || w.level === level));

test('数据：户外活动、应急包都存在；「野外找吃的」不在任何关闭名单里', () => {
	// 合并爱好分支后：观鸟（爱好 id）也在清单里
	const acts = new Set([...ACTIVITIES.map((a) => a.id), ...HOBBY_IDS, ...VOLUNTEER_GIGS.map((g) => g.id)]); // 志愿者合并后：户外志愿也在清单里
	for (const h of Object.values(HAZARDS)) {
		for (const id of h.outdoor ?? []) assert.ok(acts.has(id), `${h.id} 的 ${id}`);
		assert.ok(!(h.outdoor ?? []).includes('forage'), `${h.id} 不能封 forage`);
		assert.ok(!(h.outdoor ?? []).includes('eat'), `${h.id} 不能封吃饭`);
		for (const lv of [1, 2, 3] as const) assert.ok(h.advice[lv].length > 0);
	}
	assert.ok(ITEMS.some((i) => i.id === KIT_ITEM));
	for (const id of DISASTER_RULES.cyclone.locs) assert.ok(loc(id), id);
	assert.deepEqual(Object.values(WARN_LEVELS).map((x) => x.en), ['Advice', 'Watch and Act', 'Emergency Warning']);
});

test('可复现：同一地点同一天结果固定，和先算哪天无关', () => {
	const l = loc('broome');
	const forward = Array.from({ length: 200 }, (_, d) => JSON.stringify(warningsOn(l, d)));
	const backward = Array.from({ length: 200 }, (_, i) => 199 - i).map((d) => JSON.stringify(warningsOn(l, d))).reverse();
	assert.deepEqual(forward, backward);
});

test('预警：级别 1–3，高的在前，同一种灾害只出现一次', () => {
	for (const l of [...WA.locations, ...SA_BASE.locations]) for (let d = 0; d < 400; d++) {
		const ws = warningsOn(l, d);
		assert.equal(new Set(ws.map((w) => w.hazard)).size, ws.length);
		for (let i = 0; i < ws.length; i++) {
			assert.ok(ws[i].level >= 1 && ws[i].level <= 3);
			if (i) assert.ok(ws[i - 1].level >= ws[i].level);
		}
	}
});

test('山火：只在非城市、非海岛地点；紧急警告必须是灾难性火险，注意并行动必须是极端火险，提示是前一天起过火', () => {
	let seen = { 1: 0, 2: 0, 3: 0 };
	for (const region of [WA, SA_BASE]) for (const l of region.locations) for (let d = 0; d < DAYS; d++) {
		const lv = bushfireLevel(l, d);
		if (!lv) continue;
		seen[lv]++;
		assert.ok(DISASTER_RULES.bushfire.kinds.includes(l.kind) && l.id !== 'glenelg', l.id);
		const f = fireDanger(l, d * 1440, weatherOn(l.id, d).id).id;
		if (lv === 3) assert.equal(f, 'catastrophic');
		if (lv === 2) assert.equal(f, 'extreme');
		if (lv === 1) assert.ok(bushfireLevel(l, d - 1) >= 2, `${l.id}@${d} 前一天有火`);
	}
	assert.ok(seen[1] && seen[2] && seen[3], JSON.stringify(seen));
});

test('洪水：只在南纬 23° 以北、12–3 月；紧急警告 = 今天风暴且近 3 天至少两天风暴', () => {
	let emergencies = 0;
	for (const l of WA.locations) for (let d = 0; d < DAYS; d++) {
		const lv = floodLevel(l, d);
		if (!lv) continue;
		assert.ok(l.lat > -23, l.id);
		assert.ok([11, 0, 1, 2].includes(monthOfDay(d)), `${l.id}@${d}`);
		const storms = [d - 2, d - 1, d].filter((x) => weatherOn(l.id, x).id === 'storm').length;
		const today = weatherOn(l.id, d).id === 'storm';
		assert.equal(lv, today && storms >= 2 ? 3 : today ? 2 : 1);
		if (lv === 3) emergencies++;
	}
	assert.ok(emergencies > 0);
});

test('气旋：只在西北海岸 11–4 月；过境日紧急警告，前一天至少注意并行动，前两天至少提示', () => {
	const { l, day } = find((l, d) => cycloneLevel(l, d) === 3 && cycloneLevel(l, d - 1) !== 3 && cycloneLevel(l, d - 2) !== 3);
	assert.ok(DISASTER_RULES.cyclone.locs.includes(l.id as never));
	assert.equal(weatherOn(l.id, day).id, 'storm');
	assert.ok(cycloneLevel(l, day - 1) >= 2);
	assert.ok(cycloneLevel(l, day - 2) >= 1);
	assert.ok(cycloneLevel(l, day + 1) >= 1, '过后一天还有提示');
	for (const x of WA.locations) for (let d = 0; d < DAYS; d++) {
		if (!cycloneLevel(x, d)) continue;
		assert.ok(DISASTER_RULES.cyclone.locs.includes(x.id as never), x.id);
	}
	assert.ok(has(warningsOn(l, day), 'outage', 2), '气旋过境必停电');
});

test('热浪：连续炎热的天数决定级别，内陆更重', () => {
	let n = 0;
	for (const region of [WA, SA_BASE]) for (const l of region.locations) for (let d = 0; d < DAYS * 2; d++) {
		const run = hotRun(l, d);
		const lv = heatwaveLevel(l, d);
		const inland = !isCoastal(l);
		const want = run >= 5 && inland ? 3 : run >= 4 || (run >= 3 && inland) ? 2 : run >= 3 ? 1 : 0;
		assert.equal(lv, want, `${l.id}@${d}`);
		if (lv) n++;
	}
	assert.ok(n > 0, '扫描范围内至少出现过一次热浪');
});

test('封路：山火只封进来的路（撤离的路通），洪水两个方向都封，气旋紧急警告停飞', () => {
	const fire = find((l, d, ws) => has(ws, 'bushfire', 3) && neighbors(WA, l.id).some((n) => n.mode === 'road' && !warningsOn(n.to, d).length));
	const out = neighbors(WA, fire.l.id).find((n) => n.mode === 'road' && !warningsOn(n.to, fire.day).length)!;
	assert.match(routeClosed(out.to, fire.l, 'road', fire.day)!, /山火紧急警告，公路封闭/);
	assert.equal(routeClosed(fire.l, out.to, 'road', fire.day), undefined, '往外撤的路不封');

	const flood = find((l, d, ws) => has(ws, 'flood', 3) && !has(ws, 'bushfire') && !has(ws, 'cyclone') && neighbors(WA, l.id).some((n) => n.mode === 'road' && !warningsOn(n.to, d).length));
	const fn = neighbors(WA, flood.l.id).find((n) => n.mode === 'road' && !warningsOn(n.to, flood.day).length)!;
	assert.match(routeClosed(flood.l, fn.to, 'road', flood.day)!, /洪水封路紧急警告/);
	assert.match(routeClosed(fn.to, flood.l, 'road', flood.day)!, /洪水封路紧急警告/);
	assert.equal(routeClosed(flood.l, fn.to, 'air', flood.day), undefined, '洪水不停飞');

	const cyc = find((l, d, ws) => has(ws, 'cyclone', 3) && l.tags.includes('airport'));
	assert.match(routeClosed(loc('perth'), cyc.l, 'air', cyc.day)!, /航班停飞/);
	assert.equal(routeClosed(loc('perth'), cyc.l, 'ferry', cyc.day), undefined, '渡轮交给风暴规则');
});

test('引擎：封了的线路列出来但走不了；户外活动关闭；野外找吃的照常', () => {
	const fire = find((l, d, ws) => has(ws, 'bushfire', 3) && ['park', 'outback', 'coast'].includes(l.kind) && neighbors(WA, l.id).some((n) => n.mode === 'road' && !warningsOn(n.to, d).length));
	const from = neighbors(WA, fire.l.id).find((n) => n.mode === 'road' && !warningsOn(n.to, fire.day).length)!.to;
	const s = make({ loc: from.id, clock: fire.day * 1440 + 10 * 60, cash: 5000, vehicle: 'none' });
	const opt = travelOptions(s, WA).find((o) => o.to === fire.l.id && o.mode === 'road')!;
	assert.equal(opt.available, false);
	assert.match(opt.reason!, /公路封闭/);
	const r = travel(s, WA, fire.l.id, 'road');
	assert.equal(r.ok, false);
	assert.match(r.msg, /公路封闭/);
	// 前一天没封
	const before = travelOptions({ ...s, clock: (fire.day - 7) * 1440 + 600 }, WA).find((o) => o.to === fire.l.id && o.mode === 'road')!;
	if (!routeClosed(from, fire.l, 'road', fire.day - 7)) assert.equal(before.available, true);

	const here = make({ loc: fire.l.id, clock: fire.day * 1440 + 10 * 60, cash: 5000 });
	const acts = activitiesAt(here, WA);
	const hike = acts.find((x) => x.act.id === 'hike')!;
	assert.match(hike.blocked!, /户外活动暂停/);
	assert.match(performActivity(here, WA, 'hike').msg, /户外活动暂停/);
	if (fire.l.kind !== 'coast') assert.ok(!/户外/.test(acts.find((x) => x.act.id === 'forage')!.blocked ?? ''), '野外找吃的不因灾害关闭');
	assert.ok(acts.some((x) => x.act.id === 'eat' && !x.blocked), '吃饭照常');
});

test('停工：工作地点紧急警告时上不了班；不传 region 时行为不变', () => {
	const { l, day } = find((_, __, ws) => ws.some((w) => w.level === 3 && HAZARDS[w.hazard].stopWork === 3));
	const s = make({ loc: l.id, clock: day * 1440 + 7 * 60, job: { career: 'barista', loc: l.id, level: 0, shifts: 0, good: 0, lastDay: -1 } });
	assert.match(shiftBlocked(s, WA)!, /今天停工/);
	assert.equal(shiftBlocked(s), undefined);
	const r = workShift(s, WA);
	assert.equal(r.ok, false);
	assert.equal(r.state, s, '失败不改存档');
	// 平常日子能上班
	const calm = find((x, d, ws) => x.id === l.id && !ws.length);
	assert.equal(shiftBlocked({ ...s, clock: calm.day * 1440 + 7 * 60 }, WA), undefined);
});

test('停电：在家做不了饭，带应急包就能做', () => {
	const { l, day } = find((_, __, ws) => has(ws, 'outage'));
	let s = rentHome(make({ cash: 5000, clock: 9 * 60 }), WA, 'room').state;
	s = buyFurniture(s, WA, 'cookset').state;
	s = { ...s, loc: l.id, home: { ...s.home!, loc: l.id }, clock: day * 1440 + 12 * 60 };
	assert.match(homeActionBlocked(s, 'cook', WA)!, /停电/);
	assert.equal(homeActionBlocked(s, 'cook'), undefined, '不传 region 不看停电');
	assert.equal(cookAtHome(s, WA).ok, false);
	assert.match(cookBlocked(s, 'tomato-egg', WA)!, /停电/, '照食谱做菜也看停电（合并 main 后复核）');
	assert.match(hostBlocked({ ...s, clock: day * 1440 + 18 * 60 }, 'tomato-egg', WA) ?? '', /停电/, '请客也看停电');
	assert.doesNotMatch(cookBlocked(s, 'tomato-egg') ?? '', /停电/, '不传 region 不看停电');
	const kit = { ...s, inventory: { ...s.inventory, [KIT_ITEM]: 1 } };
	assert.equal(homeActionBlocked(kit, 'cook', WA), undefined);
	assert.equal(cookAtHome(kit, WA).ok, true);
});

test('撤离去处：路通、没有注意并行动以上的预警；没有就返回 null', () => {
	let found = 0;
	for (let d = 0; d < DAYS; d++) for (const l of WA.locations) {
		if (!warningsOn(l, d).some((w) => w.level === 3)) continue;
		const to = evacuationTarget(WA, l, d);
		if (!to) continue;
		found++;
		assert.ok(neighbors(WA, l.id).some((n) => n.to.id === to.id && !routeClosed(l, to, n.mode, d)));
		assert.ok(!warningsOn(to, d).some((w) => w.level >= 2), to.id);
		assert.equal(evacuationTarget(WA, l, d)?.id, to.id, '结果固定');
	}
	assert.ok(found > 0);
});

test('保险接口：只报气旋、山火、洪水的紧急警告，按天排序，不改存档', () => {
	const { l, day } = find((_, __, ws) => ws.some((w) => w.level === 3 && ['cyclone', 'bushfire', 'flood'].includes(w.hazard)));
	let s = rentHome(make({ cash: 5000, clock: 9 * 60 }), WA, 'room').state;
	s = { ...s, loc: l.id, home: { ...s.home!, loc: l.id }, vehicle: 'car' };
	const before = JSON.stringify(s);
	const xs = incidentsFor(s, WA, day - 10, day + 10);
	assert.equal(JSON.stringify(s), before);
	assert.ok(xs.some((x) => x.day === day && x.loc === l.id));
	for (const x of xs) {
		assert.equal(x.level, 3);
		assert.ok(['cyclone', 'bushfire', 'flood'].includes(x.hazard));
		assert.deepEqual(x.assets, ['home', 'vehicle']);
	}
	for (let i = 1; i < xs.length; i++) assert.ok(xs[i - 1].day <= xs[i].day);
	assert.deepEqual(incidentsFor({ ...s, home: null, vehicle: 'none' }, WA, day - 10, day + 10), [], '没房没车没东西可报');
	assert.equal(incidentsFor(s, WA, 0, 100_000).every((x) => x.day <= 366), true, '一次最多查一年');
});

test('页面：预警行和顶栏标签的插值都转义；提示级不上顶栏', () => {
	const evil: GameLocation = { ...loc('perth'), id: 'evil', name: '<img src=x onerror=alert(1)>' };
	// 洪水紧急警告、但航班照飞的一天：撤离去处就是那个名字带标签的地点
	const { l: base, day } = find((l, d, ws) => has(ws, 'flood', 3) && !has(ws, 'cyclone', 3) && !warningsOn(evil, d).some((w) => w.level >= 2));
	const region: Region = { ...WA, locations: [base, evil], routes: [{ a: base.id, b: 'evil', mode: 'air' }] };
	const ws = warningsOn(base, day);
	const html = warningRows(ws, region, base, day, 'wa', esc).join('');
	assert.ok(!html.includes('<img'), html);
	assert.match(html, /可以撤到 &lt;img/);
	assert.match(html, /不是真实预警/);
	assert.match(html, /emergency\.wa\.gov\.au/);
	assert.equal(warningChip([{ hazard: 'heatwave', level: 1 }], esc), '');
	assert.match(warningChip([{ hazard: 'bushfire', level: 2 }], esc), /山火 · 注意并行动/);
	assert.match(warningRows([{ hazard: 'bushfire', level: 1 }], WA, loc('kalbarri'), 0, 'sa', esc).join(''), /cfs\.sa\.gov\.au/);
});

test('撤离去处：更近但有注意并行动预警的地点不选', () => {
	const km = (a: GameLocation, b: GameLocation) => Math.hypot(a.lat - b.lat, a.lon - b.lon);
	for (let d = 0; d < DAYS; d++) {
		const ws = WA.locations.map((l) => ({ l, ws: warningsOn(l, d) }));
		const base = ws.find((x) => x.ws.some((w) => w.level === 3) && !has(x.ws, 'cyclone', 3));
		const near = ws.find((x) => x.l !== base?.l && x.ws.length && x.ws[0].level === 2 && !has(x.ws, 'cyclone'));
		if (!base || !near) continue;
		const far = ws.find((x) => !x.ws.length && km(base.l, x.l) > km(base.l, near.l));
		if (!far) continue;
		const region: Region = { ...WA, locations: [base.l, near.l, far.l], routes: [{ a: base.l.id, b: near.l.id, mode: 'air' }, { a: base.l.id, b: far.l.id, mode: 'air' }] };
		assert.equal(evacuationTarget(region, base.l, d)?.id, far.l.id);
		assert.equal(evacuationTarget({ ...region, routes: [region.routes[0]] }, base.l, d), null, '只剩有预警的去处时不给建议');
		return;
	}
	assert.fail('扫描范围内没找到');
});

// ---------- 合并 main 后复核补的 ----------
test('真实地点打卡：工作地点紧急警告停工当天打不了上班卡，附近列表也显示停工；已经打的卡能打下班卡（合并 main 后复核）', () => {
	const { l, day } = find((l, d) => !!workStopped(l, d) && WA.venues.some((v) => v.loc === l.id && VENUE_TYPES.find((t) => t.id === v.type && t.gigRate)));
	const venue = WA.venues.find((v) => v.loc === l.id && VENUE_TYPES.find((t) => t.id === v.type && t.gigRate))!;
	const now = Date.UTC(2026, 10, 22, 2);
	const s = make({ loc: l.id, clock: day * 1440 + 10 * 60, needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 } as never });
	const req = { venue: venue.id, op: 'work' as const, lat: venue.lat, lon: venue.lon, acc: 10 };
	const r = venueAction(s, WA, req, now);
	assert.equal(r.ok, false);
	assert.equal(r.msg, workStopped(l, day), '和游戏内上班同一个停工原因');
	const op = venuesNear(s, WA, venue.lat, venue.lon, 10, now).find((v) => v.venue.id === venue.id)?.ops.find((o) => o.op.id === 'work');
	assert.equal(op?.blocked, workStopped(l, day), '附近列表提前显示');
	// 前一天打的卡（停工前）：停工当天照样能打下班卡
	const clocked = { ...s, clockIn: { venue: venue.id, at: now - 3 * 3_600_000, career: '' } as never };
	const out = venueAction(clocked, WA, req, now);
	assert.notEqual(out.msg, workStopped(l, day), '打下班卡不受停工影响');
	const gigCard = { ...s, clockIn: { venue: venue.id, at: now - 3 * 3_600_000 } as never };
	const outOp = venuesNear(gigCard, WA, venue.lat, venue.lon, 10, now).find((v) => v.venue.id === venue.id)?.ops.find((o) => o.op.id === 'work');
	assert.notEqual(outOp?.blocked, workStopped(l, day), '附近列表里的下班卡按钮不因停工变灰');
});

test('撤离建议只给玩家现在走得了的去处；都走不了时提示就地避险（合并 main 后复核）', () => {
	const { l, day } = find((l, d) => warningsOn(l, d).some((w) => w.level === 3 && w.hazard !== 'heatwave' && w.hazard !== 'outage') && !!evacuationTarget(WA, l, d));
	const ws = warningsOn(l, day);
	const any = evacuationTarget(WA, l, day)!;
	assert.equal(evacuationTarget(WA, l, day, new Set([any.id]))?.id, any.id);
	assert.equal(evacuationTarget(WA, l, day, new Set()), null, '一个都走不了：不给去处');
	const rows = warningRows(ws, WA, l, day, 'wa', esc, new Set()).join('');
	assert.match(rows, /现在走不了：留在坚固的建筑里/);
	assert.ok(!rows.includes('可以撤到'));
	// 页面传的是 travelOptions 里可用的去处：没车的人不会被指向只能走土路的地方
	const s = make({ loc: l.id, clock: day * 1440 + 9 * 60, vehicle: 'none', cash: 5000 });
	const ok = new Set(travelOptions(s, WA).filter((o) => o.available).map((o) => o.to));
	const go = evacuationTarget(WA, l, day, ok);
	if (go) assert.ok(ok.has(go.id));
	// 有预警的地方也不会出现在建议里
	if (go) assert.ok(!warningsOn(go, day).some((w) => w.level >= 2));
});

test('公交、火车、步行也按陆路封闭，提示写对交通方式（合并 main 后复核）', () => {
	for (const [mode, what] of [['transit', '公交停运'], ['rail', '火车停运'], ['walk', '道路封闭'], ['road', '公路封闭']] as const) {
		const { l, day } = find((l, d) => warningsOn(l, d).some((w) => HAZARDS[w.hazard].closeRoad && w.level >= (HAZARDS[w.hazard].closeRoad as number) && !HAZARDS[w.hazard].inboundOnly));
		const other = WA.locations.find((x) => x.id !== l.id && !warningsOn(x, day).length)!;
		const why = routeClosed(other, l, mode, day);
		assert.ok(why && why.endsWith(what), `${mode}：${why}`);
	}
});

test('理赔查询：区间反了（同一天重复结算）返回空，不会把明天算进来（合并 main 后复核）', () => {
	const { day } = find((l, d) => warningsOn(l, d).some((w) => w.level === 3 && CLAIMABLE.includes(w.hazard)));
	const { l } = find((l, d) => d === day && warningsOn(l, d).some((w) => w.level === 3 && CLAIMABLE.includes(w.hazard)));
	const s = make({ loc: l.id, home: { type: 'room', loc: l.id, furniture: {} } });
	assert.ok(incidentsFor(s, WA, day, day).length > 0);
	assert.deepEqual(incidentsFor(s, WA, day, day - 1), []);
});

test('引擎：卡尔古利山火封路当天，从珀斯坐 Transwa 火车过去也停运（合并 main 后复核）', () => {
	const kal = loc('kalgoorlie');
	const day = [...Array(DAYS).keys()].find((d) => !!routeClosed(loc('perth'), kal, 'rail', d));
	assert.ok(day !== undefined, '扫描范围内卡尔古利有封路的日子');
	const s = make({ loc: 'perth', clock: day! * 1440 + 9 * 60, cash: 5000 });
	const rail = travelOptions(s, WA).find((o) => o.to === 'kalgoorlie' && o.mode === 'rail');
	assert.ok(rail, '有火车选项');
	assert.equal(rail!.available, false);
	assert.match(rail!.reason ?? '', /火车停运/);
});

test('页面：预警行的撤离建议只在玩家能走的去处里挑（合并 main 后复核）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /warningRows\(warningsAt\(s, region\), region, loc, dayOf\(s\.clock\), curArea\(\)\.id, esc, new Set\(travelOptions\(s, region\)\.filter\(\(o\) => o\.available\)\.map\(\(o\) => o\.to\)\)\)/);
});

test('真实地点打卡：本来就不能在这里干活的，停工那天也照实说缺职业，不说成停工（合并 main 后二次核查）', () => {
	const types = new Set(VENUE_TYPES.filter((t) => !t.gigRate && t.ops.includes('work')).map((t) => t.id));
	const { l, day } = find((l, d) => !!workStopped(l, d) && WA.venues.some((v) => v.loc === l.id && types.has(v.type)));
	const venue = WA.venues.find((v) => v.loc === l.id && types.has(v.type))!;
	const now = Date.UTC(2026, 10, 22, 2);
	const s = make({ loc: l.id, clock: day * 1440 + 10 * 60, job: null });
	const r = venueAction(s, WA, { venue: venue.id, op: 'work', lat: venue.lat, lon: venue.lon, acc: 10 }, now);
	assert.equal(r.ok, false);
	assert.match(r.msg, /对应的职业/);
});
