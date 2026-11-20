// 现实活动（第 24 批）：时区、夏令时、上下线边界、数据来源、到场纪念、服务端结算
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adelaideDst, claimLive, firstSundayUtc, getLiveEvent, liveBlocked, liveCalendar, liveDateLabel, liveStatus, localParts, localToUtc, tzOffsetMin, type LiveArea } from '../../src/game/core/live.ts';
import { LIVE_EVENTS } from '../../src/game/data/live-events.ts';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { areaOf } from '../../src/game/data/areas-base.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import { EarthWorld } from '../../src/game/server/world.ts';

const Z = (iso: string) => Date.parse(iso);
const MIN = 60_000;

function player(loc = 'perth') {
	const s = createCharacter({ id: 'live-tester', name: '赶场的', avatar: '🧑', origin: 'student', traits: [], region: areaOf(loc)!.id, spawn: loc, seed: 7 });
	return { ...s, loc };
}

test('时区：珀斯全年 UTC+8；阿德莱德夏令时按 10 月、4 月第一个星期日的 UTC 16:30 切换（前一毫秒和这一刻）', () => {
	for (const iso of ['2026-01-15T00:00Z', '2026-07-15T00:00Z', '2026-10-03T16:30Z', '2027-04-03T16:30Z']) assert.equal(tzOffsetMin('wa', Z(iso)), 480, iso);
	// 2026-10-04（星期日）2:00 ACST 开始
	assert.equal(new Date(firstSundayUtc(2026, 9)).toISOString(), '2026-10-04T00:00:00.000Z');
	assert.equal(tzOffsetMin('sa', Z('2026-10-03T16:30Z') - 1), 570);
	assert.equal(tzOffsetMin('sa', Z('2026-10-03T16:30Z')), 630);
	// 2027-04-04（星期日）3:00 ACDT 结束
	assert.equal(new Date(firstSundayUtc(2027, 3)).toISOString(), '2027-04-04T00:00:00.000Z');
	assert.equal(tzOffsetMin('sa', Z('2027-04-03T16:30Z') - 1), 630);
	assert.equal(tzOffsetMin('sa', Z('2027-04-03T16:30Z')), 570);
	// 2027-10-03 星期日开始；跨年（UTC 12 月 31 日、1 月 1 日）都在夏令时里
	assert.equal(adelaideDst(Z('2027-10-02T16:30Z') - 1), false);
	assert.equal(adelaideDst(Z('2027-10-02T16:30Z')), true);
	assert.equal(adelaideDst(Z('2026-12-31T23:59Z')), true);
	assert.equal(adelaideDst(Z('2027-01-01T00:00Z')), true);
	assert.equal(adelaideDst(Z('2026-07-01T00:00Z')), false);
});

test('时区：2026–2028 每半小时和系统时区库（IANA）逐点比对', () => {
	const tz: Record<LiveArea, string> = { wa: 'Australia/Perth', sa: 'Australia/Adelaide' };
	const fmt = (area: LiveArea) => new Intl.DateTimeFormat('en-CA', { timeZone: tz[area], year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	for (const area of ['wa', 'sa'] as const) {
		const f = fmt(area);
		for (let t = Z('2026-01-01T00:00Z'); t < Z('2029-01-01T00:00Z'); t += 30 * MIN) {
			const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
			const mine = localParts(area, t);
			assert.equal(mine.date, `${p.year}-${p.month}-${p.day}`, `${area} ${new Date(t).toISOString()}`);
			assert.equal(mine.hour * 60 + mine.minute, Number(p.hour) * 60 + Number(p.minute), `${area} ${new Date(t).toISOString()}`);
		}
	}
});

test('当地时间换 UTC：珀斯、阿德莱德夏令时、阿德莱德标准时间；不存在的日期返回 NaN', () => {
	assert.equal(localToUtc('wa', '2027-02-05T00:00'), Z('2027-02-04T16:00Z'));
	assert.equal(localToUtc('sa', '2027-02-19T00:00'), Z('2027-02-18T13:30Z'), '二月是夏令时 UTC+10:30');
	assert.equal(localToUtc('sa', '2027-06-14T00:00'), Z('2027-06-13T14:30Z'), '六月是标准时间 UTC+9:30');
	assert.equal(localToUtc('sa', '2026-12-24T19:00'), Z('2026-12-24T08:30Z'));
	for (const bad of ['2027-02-30T00:00', '2027-13-01T00:00', '2027-01-01T24:00', '2027-01-01', 'x']) assert.ok(Number.isNaN(localToUtc('wa', bad)), bad);
});

test('上下线边界：开始前一毫秒没开始，开始那一刻上线；结束前一毫秒还在，结束那一刻下线', () => {
	const cases: [string, string, string][] = [
		['perth-festival-2027', '2027-02-04T16:00Z', '2027-02-28T16:00Z'], // 珀斯 5 日 0 点到 3 月 1 日 0 点
		['adelaide-fringe-2027', '2027-02-18T13:30Z', '2027-03-21T13:30Z'], // 阿德莱德夏令时
		['adelaide-festival-2027', '2027-02-25T13:30Z', '2027-03-14T13:30Z'],
		['womadelaide-2027', '2027-03-04T13:30Z', '2027-03-08T13:30Z'],
		['sa-kings-birthday-2027', '2027-06-13T14:30Z', '2027-06-14T14:30Z'], // 阿德莱德标准时间
		['sa-christmas-eve-2026', '2026-12-24T08:30Z', '2026-12-24T13:30Z'], // 晚上 7 点到午夜
	];
	for (const [id, start, end] of cases) {
		const ev = getLiveEvent(id)!;
		assert.ok(ev, id);
		const a = Z(start), b = Z(end);
		assert.equal(liveStatus(ev, a - 1).active, false, `${id} 开始前`);
		assert.equal(liveStatus(ev, a - 1).startsInMs, 1, `${id} 还差 1 毫秒`);
		assert.equal(liveStatus(ev, a).active, true, `${id} 开始`);
		assert.equal(liveStatus(ev, b - 1).active, true, `${id} 结束前`);
		assert.equal(liveStatus(ev, b - 1).endsInMs, 1);
		const after = liveStatus(ev, b);
		assert.equal(after.active, false, `${id} 结束`);
		assert.equal(after.ended, true, `${id} 结束后标记为已过去`);
	}
});

test('同一时刻两个州的日子不一样：UTC 12 月 25 日 15:30 珀斯还是圣诞节，阿德莱德已经是建州日', () => {
	const t = Z('2026-12-25T15:30Z'); // 珀斯 23:30，阿德莱德 26 日 02:00（夏令时）
	const ids = liveCalendar(t, 0).filter((c) => c.active).map((c) => c.event.id).sort();
	assert.deepEqual(ids, ['sa-proclamation-2026', 'wa-christmas-2026']);
});

test('补假：分开的几天各自上线，中间那天不算；周末顺延到星期一或二', () => {
	const box = getLiveEvent('wa-boxing-2026')!; // 26 日（周六）和 28 日（周一）
	assert.equal(liveStatus(box, Z('2026-12-26T12:00Z')).active, true);
	const sunday = liveStatus(box, Z('2026-12-27T04:00Z')); // 珀斯 27 日 12:00
	assert.equal(sunday.active, false);
	assert.equal(sunday.ended, false);
	assert.equal(sunday.startsInMs, Z('2026-12-27T16:00Z') - Z('2026-12-27T04:00Z'), '28 日 0 点再上线');
	assert.equal(liveStatus(box, Z('2026-12-28T04:00Z')).active, true);
	// 只有固定日期的节日会落在周末；按星期规则定的假期和补假日一定是星期一（星期二只有节礼日的补假）
	const weekday = (d: string) => new Date(`${d}T00:00Z`).getUTCDay();
	for (const id of ['wa-labour-day-2027', 'wa-wa-day-2027', 'wa-kings-birthday-2027', 'sa-adelaide-cup-2027', 'sa-kings-birthday-2027', 'sa-labour-day-2027']) {
		assert.equal(weekday(getLiveEvent(id)!.spans[0].start.slice(0, 10)), 1, id);
	}
	assert.equal(weekday('2027-03-01'), 1, '西澳劳动节：三月第一个星期一');
	assert.ok(new Date('2027-03-08T00:00Z').getUTCDate() > 7, '阿德莱德杯：三月第二个星期一');
});

test('数据：每条都有官方来源和核对日期，日期格式合法，地点存在且在所写的州', () => {
	const OFFICIAL = ['www.wa.gov.au', 'www.safework.sa.gov.au', 'www.perthfestival.com.au', 'avr.adelaidefringe.com.au', 'www.adelaidefestival.com.au', 'www.womadelaide.com.au'];
	const ids = new Set<string>();
	for (const ev of LIVE_EVENTS) {
		assert.ok(!ids.has(ev.id), `重复 ${ev.id}`);
		ids.add(ev.id);
		assert.match(ev.id, /^[a-z0-9-]{1,48}$/);
		const u = new URL(ev.source);
		assert.equal(u.protocol, 'https:', ev.id);
		assert.ok(OFFICIAL.includes(u.host), `${ev.id} 来源 ${u.host} 不在官方名单里`);
		assert.match(ev.checked, /^\d{4}-\d{2}-\d{2}$/);
		assert.ok(ev.spans.length > 0);
		for (const sp of ev.spans) {
			const a = localToUtc(ev.area, sp.start), b = localToUtc(ev.area, sp.end);
			assert.ok(Number.isFinite(a) && Number.isFinite(b) && a < b, `${ev.id} ${sp.start}–${sp.end}`);
		}
		if (ev.loc) assert.equal(areaOf(ev.loc)?.id, ev.area, `${ev.id} 地点 ${ev.loc}`);
		else assert.equal(ev.kind, 'holiday', '不绑地点的只能是全州假期');
		if (ev.kind === 'holiday') assert.ok(ev.source.includes(ev.area === 'wa' ? 'wa.gov.au' : 'safework.sa.gov.au'), `${ev.id} 假期要用本州政府页面`);
	}
	// 官方公布的几个关键日期（2026-11-20 核对）
	const first = (id: string) => getLiveEvent(id)!.spans[0];
	assert.deepEqual(first('perth-festival-2027'), { start: '2027-02-05T00:00', end: '2027-03-01T00:00' });
	assert.deepEqual(first('adelaide-fringe-2027'), { start: '2027-02-19T00:00', end: '2027-03-22T00:00' });
	assert.deepEqual(first('adelaide-festival-2027'), { start: '2027-02-26T00:00', end: '2027-03-15T00:00' });
	assert.deepEqual(first('womadelaide-2027'), { start: '2027-03-05T00:00', end: '2027-03-09T00:00' });
});

test('日期标签和日历：按当地日期写，进行中的排前面，超出范围的不列', () => {
	assert.equal(liveDateLabel(getLiveEvent('perth-festival-2027')!), '2月5日–2月28日（珀斯时间）');
	assert.equal(liveDateLabel(getLiveEvent('wa-boxing-2026')!), '12月26日、12月28日（珀斯时间）');
	assert.equal(liveDateLabel(getLiveEvent('sa-christmas-eve-2026')!), '12月24日 19:00–24:00（阿德莱德时间）');
	const t = Z('2027-02-20T02:00Z'); // 珀斯艺术节、阿德莱德边缘艺术节都在进行
	const cal = liveCalendar(t, 10);
	assert.deepEqual(cal.filter((c) => c.active).map((c) => c.event.id).sort(), ['adelaide-fringe-2027', 'perth-festival-2027']);
	assert.ok(cal.some((c) => c.event.id === 'adelaide-festival-2027' && !c.active), '6 天后开始的在 10 天范围内');
	assert.ok(!cal.some((c) => c.event.id === 'womadelaide-2027'), '13 天后的不在 10 天范围内');
	const firstIdle = cal.findIndex((c) => !c.active);
	assert.ok(cal.slice(firstIdle).every((c) => !c.active), '进行中的排在前面');
});

test('到场纪念：要在活动地点、活动期间，每个活动领一次；不改入参；版本号加一', () => {
	const t = Z('2027-02-10T04:00Z');
	const s = player('perth');
	const r = applyAction(s, WORLD, parseAction({ t: 'live', id: 'perth-festival-2027' })!, t);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.rev, s.rev + 1);
	assert.deepEqual(r.state.live, ['perth-festival-2027']);
	assert.ok(r.state.respect > s.respect);
	assert.deepEqual(s.live, [], '入参没被改');
	assert.match(applyAction(r.state, WORLD, { t: 'live', id: 'perth-festival-2027' }, t).msg, /领过/);
	assert.match(liveBlocked(player('fremantle'), WORLD, getLiveEvent('perth-festival-2027'), t)!, /珀斯/);
	assert.match(liveBlocked(s, WORLD, getLiveEvent('perth-festival-2027'), Z('2027-02-04T16:00Z') - 1)!, /还没开始/);
	assert.match(liveBlocked(s, WORLD, getLiveEvent('perth-festival-2027'), Z('2027-02-28T16:00Z'))!, /结束/);
	assert.match(liveBlocked({ ...s, pending: { eventId: 'x' } }, WORLD, getLiveEvent('perth-festival-2027'), t)!, /眼前/);
	assert.equal(claimLive(s, WORLD, 'no-such', t).ok, false);
	// 全州假期：同一个州任何地点都行，别的州不行
	const h = Z('2027-03-08T02:00Z'); // 阿德莱德杯赛马日（阿德莱德 12:30）
	assert.equal(liveBlocked(player('glenelg'), WORLD, getLiveEvent('sa-adelaide-cup-2027'), h), undefined);
	assert.match(liveBlocked(player('perth'), WORLD, getLiveEvent('sa-adelaide-cup-2027'), h)!, /南澳/);
	assert.equal(parseAction({ t: 'live', id: 'BAD ID' }), null);
	assert.equal(parseAction({ t: 'live' }), null);
});

test('存档校验：领过的纪念去重、过滤坏数据、有上限', () => {
	const s = player('perth');
	const raw = { ...s, live: ['perth-festival-2027', 'perth-festival-2027', '<x>', 42, ...Array.from({ length: 300 }, (_, i) => `e-${i}`)] };
	const clean = sanitizeState(raw, new Set(WORLD.locations.map((l) => l.id)))!;
	assert.ok(clean.live.length <= 200);
	assert.ok(!clean.live.includes('<x>'));
	assert.equal(new Set(clean.live).size, clean.live.length);
	assert.deepEqual(sanitizeState({ ...s, live: 'x' }, new Set(WORLD.locations.map((l) => l.id)))!.live, []);
});

test('服务端：用服务器时钟判断活动有没有上线，客户端改不了时间', async () => {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv)); },
		list: async () => new Map(),
	};
	const w = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await w.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return (await res.json()) as any;
	};
	const realNow = Date.now;
	try {
		const A = { id: 'live-server-1', key: 'a'.repeat(24) };
		Date.now = () => Z('2027-01-20T04:00Z'); // 珀斯艺术节还没开始
		const c = await call({ action: 'create', ...A, profile: { name: '赶场', avatar: '🧑', origin: 'student', traits: [] } });
		assert.equal(c.state.loc, 'perth');
		const early = await call({ action: 'act', ...A, rev: c.state.rev, act: { t: 'live', id: 'perth-festival-2027', now: Z('2027-02-10T04:00Z') } });
		assert.equal(early.ok, false, '客户端带的时间不算');
		assert.match(early.msg, /还没开始/);
		Date.now = () => Z('2027-02-10T04:00Z');
		const s1 = (await call({ action: 'get', ...A })).state;
		const ok = await call({ action: 'act', ...A, rev: s1.rev, act: { t: 'live', id: 'perth-festival-2027' } });
		assert.ok(ok.ok, ok.msg);
		assert.deepEqual(ok.state.live, ['perth-festival-2027']);
		const again = await call({ action: 'act', ...A, rev: ok.state.rev, act: { t: 'live', id: 'perth-festival-2027' } });
		assert.equal(again.ok, false);
	} finally {
		Date.now = realNow;
	}
});

test('今天页（页面模板）：现实活动卡挂在故事卡后面，领纪念、屏蔽、举报的点击都接上了（合并宠物、天气分支时两边都改过这两处）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /\$\{storyCard\}\$\{liveCard\(s\)\}\$\{festHtml\}/, '今天页现实活动卡');
	assert.match(src, /\$\{petHtml\}/, '宠物卡');
	const click = src.match(/closest<HTMLElement>\('\[data-tab\][^']*'\)/)?.[0] ?? '';
	for (const a of ['live', 'safety', 'report-pick', 'report', 'pet']) assert.ok(click.includes(`[data-${a}]`), `点击委托缺 data-${a}`);
});
