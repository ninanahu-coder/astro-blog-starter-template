// 排行榜与赛季（第一版，docs/earth-game/leaderboard.md）：core 纯函数、页面卡片转义、服务端聚合/同意/复核/结算。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	addTitles, badgeOf, cleanLbEntry, cleanPref, contestPoints, dexPermille, lbAnomaly, lbAwards, lbEntry, lbHeld, lbSeasonRec, lbSort, lbStats, lbView, parseQuery, patchPref,
	seasonDaysLeft, seasonLabel, seasonOfDay, seasonStartDay, titleText, type LbItem, type LbSeason, type LbStats,
} from '../../src/game/core/leaderboard.ts';
import { LB_ANOMALY, LB_CONTEST, LB_CONTEST_DAY_CAP, LB_FIRST_SEASON, LB_HOLD_DAYS } from '../../src/game/data/leaderboard.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { weekOf } from '../../src/game/core/weekly.ts';
import { ANIMALS } from '../../src/game/data/wildlife.ts';
import { FISH } from '../../src/game/data/fish.ts';
import { WA } from '../../src/game/data/wa.ts';
import { EarthWorld } from '../../src/game/server/world.ts';
import { lbAskHtml, lbAskPref, lbCardHtml, lbScoreText, parseLbPref, type LbData } from '../../src/game/ui/board.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-20T04:00:00Z');
const base = () => createCharacter({ id: 'lb-core-player', name: '榜', avatar: '🧑', origin: 'student', traits: [], region: 'wa', spawn: WA.spawn, seed: 7 });
const stats = (o: Partial<LbStats> = {}): LbStats => ({ worth: 1000, places: 0, dex: 0, respect: 0, ...o });

// ---------- core：数值 ----------

test('排行榜 core：图鉴完成度只认图鉴里有的动物和钓到过（条数 > 0）的鱼种，打卡去重', () => {
	const s = base();
	assert.equal(dexPermille(s), 0);
	const total = ANIMALS.length + FISH.length;
	const one = { ...s, dex: [ANIMALS[0].id, ANIMALS[0].id, 'not-an-animal'], fish: { [FISH[0].id]: 2, [FISH[1].id]: 0, nope: 5 } };
	assert.equal(dexPermille(one), Math.round((2 * 1000) / total));
	const all = { ...s, dex: ANIMALS.map((a) => a.id), fish: Object.fromEntries(FISH.map((f) => [f.id, 1])) };
	assert.equal(dexPermille(all), 1000);
	const st = lbStats({ ...s, checkins: ['a', 'a', 'b'], respect: 12.6 });
	assert.equal(st.places, 2);
	assert.equal(st.respect, 13);
	assert.equal(st.worth, Math.round(st.worth));
});

test('排行榜 core：每一项没变时沿用先达到的时间；旧版净资产榜记录也能读', () => {
	const s = { ...base(), rev: 3 };
	const e1 = lbEntry(s, 1000);
	const e2 = lbEntry({ ...s, rev: 4 }, 5000, e1);
	assert.equal(e2.at, 1000, '净资产没变沿用');
	assert.equal(e2.ats.places, 1000);
	const e3 = lbEntry({ ...s, rev: 5, checkins: ['x'] }, 9000, e2);
	assert.equal(e3.ats.places, 9000, '打卡变了就更新时间');
	assert.equal(e3.ats.worth, 1000);
	// 旧格式（core/board.ts）：只有 name/avatar/worth/day/at
	const old = cleanLbEntry({ name: '旧', avatar: '🧑', worth: 500, day: 2, at: 77 });
	assert.ok(old);
	assert.equal(old!.rev, -1, '不知道版本号');
	assert.equal(old!.stats.places, 0);
	assert.equal(old!.ats.worth, 77);
	for (const bad of [null, 7, 'x', [], { name: 1 }, { name: 'a', avatar: 'b', worth: Infinity, day: 1, at: 1 }]) assert.equal(cleanLbEntry(bad), null);
	assert.equal(cleanLbEntry({ name: 'x'.repeat(99), avatar: 'y'.repeat(99), worth: 1, day: 1, at: 1 })!.name.length, 24, '名字限长');
});

test('排行榜 core：异常值——一个动作涨太多就挂起，按动作数放宽；只看涨不看跌；旧记录只做绝对值检查', () => {
	const prev = cleanLbEntry({ name: 'a', avatar: 'b', worth: 1000, day: 0, at: 0, rev: 10, stats: stats(), win: { at: 0, worth: 1000 } })!;
	const now = 10 * 3_600_000;
	assert.equal(lbAnomaly(prev, stats({ worth: 1000 + LB_ANOMALY.worthPerRev }), 11, now), null, '正好到线不算');
	assert.match(lbAnomaly(prev, stats({ worth: 1001 + LB_ANOMALY.worthPerRev }), 11, now)!, /净资产/);
	assert.equal(lbAnomaly(prev, stats({ worth: 1001 + LB_ANOMALY.worthPerRev }), 12, now), null, '两个动作，线翻倍');
	assert.match(lbAnomaly(prev, stats({ places: LB_ANOMALY.placesPerRev + 1 }), 11, now)!, /打卡/);
	assert.match(lbAnomaly(prev, stats({ dex: LB_ANOMALY.dexPerRev + 1 }), 11, now)!, /图鉴/);
	assert.match(lbAnomaly(prev, stats({ respect: LB_ANOMALY.respectPerRev + 1 }), 11, now)!, /声望/);
	assert.equal(lbAnomaly(prev, stats({ worth: -50_000 }), 11, now), null, '跌不算');
	// 一小时窗口：每个动作都不超线，但一小时里累计超了
	const inHour = { ...prev, win: { at: now - 1000, worth: 1000 } };
	assert.match(lbAnomaly(inHour, stats({ worth: 1001 + LB_ANOMALY.worthPerHour }), 100, now)!, /一小时/);
	assert.equal(lbAnomaly({ ...inHour, win: { at: now - 3_700_000, worth: 1000 }, stats: stats({ worth: LB_ANOMALY.worthPerHour }) }, stats({ worth: 1001 + LB_ANOMALY.worthPerHour }), 100, now), null, '窗口过期就从上一条记录起算');
	// 旧记录不知道版本号：不做按动作的检查
	const legacy = cleanLbEntry({ name: 'a', avatar: 'b', worth: 1000, day: 0, at: now - 2 * 3_600_000 })!;
	assert.equal(lbAnomaly(legacy, stats({ worth: 50_000 }), 11, now), null);
	assert.match(lbAnomaly(null, stats({ places: 9 }), 1, now, LB_ANOMALY, { places: 8 })!, /超过地点总数/);
});

test('排行榜 core：挂起持续 LB_HOLD_DAYS 天，期间再触发从那次重算，到期自动解除', () => {
	const s = { ...base(), rev: 1 };
	const e1 = lbEntry(s, 0);
	const rich = { ...s, rev: 2, cash: s.cash + LB_ANOMALY.worthPerRev + 1 };
	const e2 = lbEntry(rich, 1000, e1);
	assert.ok(e2.hold);
	assert.equal(e2.hold!.until, 1000 + LB_HOLD_DAYS * DAY);
	const e3 = lbEntry({ ...rich, rev: 3 }, 2 * DAY, e2);
	assert.deepEqual(e3.hold, e2.hold, '正常动作不解除也不延长');
	const e4 = lbEntry({ ...rich, rev: 4 }, LB_HOLD_DAYS * DAY + 2000, e3);
	assert.ok(!lbHeld(e4, LB_HOLD_DAYS * DAY + 2000), '到期解除：不再藏起来');
	assert.deepEqual(e4.hold, e2.hold, '最近一次挂起留作记录，赛季结算靠它判断这一季被挂起过（合并 main 后复核）');
	const e5 = lbEntry({ ...rich, rev: 5, cash: rich.cash + LB_ANOMALY.worthPerRev + 1 }, LB_HOLD_DAYS * DAY + 4 * 3_600_000, e4);
	assert.ok(lbHeld(e5, LB_HOLD_DAYS * DAY + 4 * 3_600_000) && e5.hold!.at > e2.hold!.at, '到期后再触发：重新挂起');
});

test('排行榜 core：挂起在赛季中途到期，结算时照样算「这一季被挂起过」，不发奖（合并 main 后复核）', () => {
	const s = { ...base(), rev: 1 };
	const start = 72 * DAY, end = 100 * DAY;
	const e1 = lbEntry(s, start + DAY);
	const rich = { ...s, rev: 2, cash: s.cash + LB_ANOMALY.worthPerRev + 1 };
	const e2 = lbEntry(rich, start + 2 * DAY, e1);
	const e3 = lbEntry({ ...rich, rev: 3 }, start + 20 * DAY, e2); // 挂起早就到期
	assert.ok(!lbHeld(e3, start + 20 * DAY));
	const sea = { base: stats({ worth: 0 }), last: stats({ worth: 999_999 }) };
	const items = [item('cheat', { sea }), item('p01', { sea: { base: stats({ worth: 0 }), last: stats({ worth: 100 }) } })];
	items[0].entry!.hold = e3.hold;
	const { awards, withheld } = lbAwards(items, 742, end, start);
	assert.equal(awards.get('cheat')?.find((t) => t.dim === 'worth'), undefined, '挂起过的不发');
	assert.equal(awards.get('p01')?.find((t) => t.dim === 'worth')?.tier, 'champion', '下一名补上冠军');
	assert.deepEqual(withheld.filter((x) => x.dim === 'worth').map((x) => x.h), ['cheat']);
});

// ---------- core：同意、赛季 ----------

test('排行榜 core：上榜默认不同意；修改只认四个布尔开关', () => {
	assert.equal(cleanPref(undefined).on, false);
	assert.equal(cleanPref({ on: 'yes' }).on, false);
	const p = patchPref(undefined, { on: true, anon: true, evil: 1 }, 5)!;
	assert.deepEqual(p, { on: true, anon: true, region: true, friends: true, at: 5 });
	assert.equal(patchPref(p, { on: 1 }, 6), null, '不是布尔值整个拒绝');
	assert.equal(patchPref(p, {}, 6), null, '什么都没改');
	assert.equal(patchPref(p, null, 6), null);
	assert.equal(patchPref(p, { region: false }, 7)!.anon, true, '没提到的开关保持原样');
});

test('排行榜 core：赛季和周目标的周对齐，第 1 赛季从 2026-11-19 开始', () => {
	const d = realDayOf(T0);
	assert.equal(seasonOfDay(d), LB_FIRST_SEASON);
	assert.equal(seasonLabel(LB_FIRST_SEASON), 'S1');
	assert.equal(seasonLabel(LB_FIRST_SEASON + 1), 'S2');
	const start = seasonStartDay(LB_FIRST_SEASON);
	assert.equal(new Date(start * DAY).toISOString().slice(0, 10), '2026-11-19');
	assert.equal(weekOf(start) * 7, start, '赛季第一天就是一周的第一天');
	assert.equal(seasonOfDay(start - 1), LB_FIRST_SEASON - 1);
	assert.equal(seasonOfDay(start + 27), LB_FIRST_SEASON);
	assert.equal(seasonOfDay(start + 28), LB_FIRST_SEASON + 1);
	assert.equal(seasonDaysLeft(start), 28);
	assert.equal(seasonDaysLeft(start + 27), 1);
});

test('排行榜 core：赛季记录以上一条记录为起点，比赛积分按现实日封顶，地区整季不变', () => {
	const before = stats({ worth: 100 });
	const r1 = lbSeasonRec(undefined, { stats: stats({ worth: 300 }), before, region: 'wa', now: 1, realDay: 10, contest: 3 });
	assert.deepEqual(r1.base, before, '赛季第一个动作也算进本赛季');
	assert.equal(r1.contest, 3);
	const r2 = lbSeasonRec(r1, { stats: stats({ worth: 400 }), before: stats(), region: 'sa', now: 2, realDay: 10, contest: 5 });
	assert.equal(r2.contest, LB_CONTEST_DAY_CAP, '当天封顶');
	assert.equal(r2.region, 'wa', '地区按赛季第一次落盘时算');
	assert.deepEqual(r2.base, before, '起点不变');
	assert.equal(r2.last.worth, 400);
	const r3 = lbSeasonRec(r2, { stats: stats(), before: null, region: 'wa', now: 3, realDay: 11, contest: 3 });
	assert.equal(r3.contest, LB_CONTEST_DAY_CAP + 3, '第二天重新计');
	assert.equal(lbSeasonRec(undefined, { stats: stats(), before: null, region: 'wa', now: 1, realDay: 1, contest: -9 }).contest, 0);
	assert.equal(contestPoints('fishing-comp', true), 3);
	assert.equal(contestPoints('fishing-comp', false), 1);
	assert.equal(contestPoints('beach-cleanup', true), 0, '不是比赛');
	assert.equal(contestPoints('__proto__', true), 0);
	assert.equal(contestPoints('constructor', true), 0);
});

test('排行榜 core：查询参数不对回到默认（全服身家总榜）；比赛只有赛季榜', () => {
	assert.deepEqual(parseQuery(undefined), { dim: 'worth', scope: 'all', board: 'global' });
	assert.deepEqual(parseQuery({ dim: 'cash', scope: 'forever', board: 'mars' }), { dim: 'worth', scope: 'all', board: 'global' });
	assert.deepEqual(parseQuery({ dim: 'contest', scope: 'all', board: 'friends' }), { dim: 'contest', scope: 'season', board: 'friends' });
	assert.deepEqual(parseQuery({ dim: 'dex', scope: 'season', board: 'region' }), { dim: 'dex', scope: 'season', board: 'region' });
});

// ---------- core：排名 ----------

function item(h: string, o: { worth?: number; at?: number; on?: boolean; anon?: boolean; region?: string; prefRegion?: boolean; friends?: boolean; hold?: boolean; sea?: Partial<LbSeason> | null; titles?: LbItem['titles'] } = {}): LbItem {
	const w = o.worth ?? 1000;
	const entry = cleanLbEntry({ name: '玩家-' + h.slice(0, 1), avatar: '🧑', worth: w, day: 3, at: o.at ?? 1, stats: stats({ worth: w }), rev: 1, hold: o.hold ? { at: 0, until: 1e15, why: 'x' } : null })!;
	const season = o.sea === null ? null : { base: stats({ worth: 0 }), last: stats({ worth: w }), contest: 0, cday: 0, cn: 0, region: o.region ?? 'wa', at: 1, ...(o.sea ?? {}) };
	return { h, entry, pref: { on: o.on ?? true, anon: o.anon ?? false, region: o.prefRegion ?? true, friends: o.friends ?? true, at: 0 }, season, titles: o.titles ?? [] };
}

test('排行榜 core：只排同意上榜、不在复核的人；同分先达到的在前', () => {
	const items = [item('a', { worth: 500 }), item('b', { worth: 900, at: 5 }), item('c', { worth: 900, at: 2 }), item('d', { worth: 9999, on: false }), item('e', { worth: 8888, hold: true })];
	const r = lbSort(items, { dim: 'worth', scope: 'all' }, 10);
	assert.deepEqual(r.map((x) => x.h), ['c', 'b', 'a']);
	const v = lbView(r, (h) => items.find((x) => x.h === h), 'a', { dim: 'worth', scope: 'all', board: 'global' }, 10, 2);
	assert.equal(v.top.length, 2);
	assert.equal(v.me!.rank, 3, '前几名之外也有自己的名次');
	assert.equal(v.mine.status, 'on');
	const off = lbView(r, (h) => items.find((x) => x.h === h), 'd', { dim: 'worth', scope: 'all', board: 'global' }, 10);
	assert.equal(off.me, null);
	assert.deepEqual(off.mine, { status: 'off', score: 9999 }, '没同意上榜也能看到自己的成绩');
	assert.equal(lbView(r, (h) => items.find((x) => x.h === h), 'e', { dim: 'worth', scope: 'all', board: 'global' }, 10).mine.status, 'hold');
});

test('排行榜 core：赛季榜按本赛季增长排，只排有成绩的；地区、好友各自过滤', () => {
	const items = [
		item('a', { sea: { base: stats({ worth: 0 }), last: stats({ worth: 100 }) } }),
		item('b', { sea: { base: stats({ worth: 50_000 }), last: stats({ worth: 50_200 }) }, region: 'sa' }),
		item('c', { sea: null }),
		item('d', { sea: { base: stats({ worth: 900 }), last: stats({ worth: 800 }) } }),
		item('e', { sea: { base: stats({ worth: 0 }), last: stats({ worth: 500 }) }, prefRegion: false, friends: false }),
	];
	assert.deepEqual(lbSort(items, { dim: 'worth', scope: 'season' }, 1).map((x) => [x.h, x.score]), [['e', 500], ['b', 200], ['a', 100]], '没上过这一季、负增长的不上赛季榜');
	assert.equal(lbSort(items, { dim: 'worth', scope: 'all' }, 1).length, 5, '总榜不看赛季记录');
	assert.deepEqual(lbSort(items, { dim: 'worth', scope: 'season', region: 'wa' }, 1).map((x) => x.h), ['a'], '地区按赛季登记的地区；关掉地区榜的不出现');
	assert.deepEqual(lbSort(items, { dim: 'worth', scope: 'season', only: new Set(['a', 'b', 'e']) }, 1).map((x) => x.h), ['b', 'a'], '好友榜：只在名单里，且没关掉好友榜');
	const contest = [item('x', { sea: { contest: 4 } }), item('y', { sea: { contest: 0 } })];
	assert.deepEqual(lbSort(contest, { dim: 'contest', scope: 'all' }, 1).map((x) => x.h), ['x']);
});

test('排行榜 core：发给客户端的行只有展示字段，匿名的换成「匿名旅人」', () => {
	const items = [item('aaaaaaaaaaaa', { anon: true, worth: 777 }), item('bbbbbbbbbbbb', { titles: [{ s: 742, dim: 'worth', tier: 'top10', rank: 7 }] })];
	const r = lbSort(items, { dim: 'worth', scope: 'all' }, 1);
	const v = lbView(r, (h) => items.find((x) => x.h === h), 'aaaaaaaaaaaa', { dim: 'worth', scope: 'all', board: 'global' }, 1);
	const anon = v.top.find((x) => x.me)!;
	assert.equal(anon.name, '匿名旅人');
	assert.equal(anon.avatar, '👤');
	assert.equal(anon.worth, 777, '身家榜兼容旧页面带 worth');
	assert.equal(v.top.find((x) => !x.me)!.badge, '🏅');
	const text = JSON.stringify(v);
	assert.ok(!text.includes('玩家-a'), '匿名的人真名不外发');
	assert.ok(!text.includes('aaaaaaaaaaaa') && !text.includes('bbbbbbbbbbbb'), '不发哈希');
	assert.ok(!/region|loc|fix|hold|why/.test(text), '不发地区、位置、复核原因');
	const dex = lbView(lbSort(items, { dim: 'dex', scope: 'all' }, 1), (h) => items.find((x) => x.h === h), 'x', { dim: 'dex', scope: 'all', board: 'global' }, 1);
	assert.ok(dex.top.every((x) => x.worth === undefined), '其他维度不带 worth');
});

test('排行榜 core：赛季结算按全服赛季榜发称号；这一季被挂起过的不发、记进复核名单', () => {
	const sea = (w: number) => ({ base: stats({ worth: 0 }), last: stats({ worth: w }) });
	const end = 100 * DAY;
	const start = 72 * DAY;
	const items = Array.from({ length: 12 }, (_, i) => item('p' + String(i).padStart(2, '0'), { sea: sea(1000 - i) }));
	items.push(item('cheat', { sea: sea(5000) }));
	items[items.length - 1].entry!.hold = { at: end - DAY, until: end + 6 * DAY, why: 'x' };
	items.push(item('off', { sea: sea(9000), on: false }));
	items.push(item('oldhold', { sea: sea(985) }));
	items[items.length - 1].entry!.hold = { at: 0, until: start - 1, why: 'x' }; // 上一季的挂起，和这一季无关
	const { awards, withheld } = lbAwards(items, 742, end, start);
	const worthTier = (h: string) => awards.get(h)?.find((t) => t.dim === 'worth')?.tier;
	assert.equal(worthTier('p00'), 'champion');
	assert.equal(worthTier('p01'), 'podium');
	assert.equal(worthTier('p02'), 'podium');
	assert.equal(worthTier('p03'), 'top10');
	assert.equal(worthTier('cheat'), undefined);
	assert.equal(worthTier('off'), undefined, '没同意上榜不发');
	assert.equal(worthTier('oldhold'), 'top100', '别的赛季的挂起不影响（第 13 名）');
	assert.deepEqual(withheld.filter((x) => x.dim === 'worth'), [{ h: 'cheat', dim: 'worth', rank: 1 }]);
	assert.equal(awards.get('p00')!.filter((t) => t.dim === 'places').length, 0, '这一季没打卡的不发打卡榜称号');
	// 只发称号，不碰任何数值
	for (const list of awards.values()) for (const t of list) assert.deepEqual(Object.keys(t).sort(), ['dim', 'rank', 's', 'tier']);
	const t = addTitles(addTitles([], awards.get('p00')!), awards.get('p00')!);
	assert.equal(t.length, awards.get('p00')!.length, '重跑不重复发');
	assert.equal(titleText(t[0]), 'S1 身家榜冠军');
	assert.equal(badgeOf([{ s: 1, dim: 'worth', tier: 'champion', rank: 1 }, { s: 2, dim: 'dex', tier: 'top100', rank: 50 }]), '🎖️', '徽章看最近一季');
});

// ---------- 页面 ----------

test('排行榜卡片：服务端来的名字、头像、徽章、称号、地区名全部转义', () => {
	const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
	const evil = '<img src=x onerror=alert(1)>';
	const d: LbData = {
		q: { dim: 'worth', scope: 'season', board: 'region' },
		top: [{ rank: 1, name: evil, avatar: evil, score: 5, day: 1, me: false, badge: evil }],
		me: { rank: 30, name: evil, avatar: '🧑', score: 1, day: 1, me: true },
		total: 30,
		mine: { status: 'off', score: 1 },
		season: { label: evil, daysLeft: 3 },
		pref: { on: true, anon: false, region: true, friends: true },
		titles: [{ text: evil }],
		region: { name: evil },
	};
	const html = lbCardHtml(d, { loading: false, error: '', dim: 'worth', scope: 'season', board: 'region' }, esc);
	assert.ok(!html.includes('<img'), html);
	assert.ok(html.includes('&lt;img'));
	assert.ok(html.includes('用昵称上榜') && html.includes('匿名上榜'), '没上榜时给出同意按钮');
	assert.ok(html.includes('不会显示位置'));
	const err = lbCardHtml(null, { loading: false, error: evil, dim: 'contest', scope: 'all', board: 'global' }, esc);
	assert.ok(!err.includes('<img'));
	assert.ok(!err.includes('data-lbq="scope:'), '比赛没有总榜，不显示范围切换');
	assert.equal(lbScoreText('worth', 1234, true), '+$1,234');
	assert.equal(lbScoreText('worth', -50, false), '-$50');
	assert.equal(lbScoreText('dex', 125, false), '12.5%');
	assert.equal(lbScoreText('places', 'x', false), '0 个地点');
	assert.deepEqual(parseLbPref('on:1,anon:0'), { on: true, anon: false });
	assert.equal(parseLbPref('on:2'), null);
	assert.equal(parseLbPref('cash:1'), null);
});

// ---------- 服务端 ----------

function makeWorld() {
	const data = new Map<string, any>();
	let puts = 0;
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			puts++;
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		delete: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) data.delete(x); },
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])),
	};
	const world = new EarthWorld({ storage } as never, {}) as any;
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, world, puts: () => puts };
}
const profile = { name: '测试', avatar: '🧑', origin: 'student', traits: [] };
const hashOf = async (id: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
async function join(w: ReturnType<typeof makeWorld>, id: string, name: string, o: { cash?: number; loc?: string; consent?: boolean; anon?: boolean } = {}) {
	const c = { id, key: (id.replace(/[^a-z]/g, '') + 'k'.repeat(24)).slice(0, 24) };
	assert.ok((await w.call({ action: 'create', ...c, profile: { ...profile, name } })).data.ok);
	const rec = w.data.get('save:' + id);
	// 在落盘前改好现金和地点（模拟「已经玩了一阵」），再做一个动作让服务端写榜单
	w.data.set('save:' + id, { ...rec, state: { ...rec.state, cash: o.cash ?? rec.state.cash, loc: o.loc ?? rec.state.loc } });
	if (o.loc || o.cash !== undefined) {
		// 起点也改：不然从开局现金跳到 o.cash 会被当成异常
		const h = await hashOf(id);
		for (const k of [...w.data.keys()].filter((k) => k === 'rank:' + h || (k.startsWith('lbs:') && k.endsWith(':' + h)))) w.data.delete(k);
	}
	const r = await w.call({ action: 'act', ...c, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.ok(r.data.ok, r.data.msg);
	if (o.consent !== false) assert.ok((await w.call({ action: 'boardpref', ...c, pref: { on: true, anon: !!o.anon } })).data.ok);
	return c;
}

test('服务端排行榜：不同意不上榜；同意后可以匿名；开关只认布尔值；看榜不写入', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const a = await join(w, 'lb-srv-alpha', '阿甲', { cash: 3000 });
	const b = await join(w, 'lb-srv-bravo', '阿乙', { cash: 5000, consent: false });
	const c = await join(w, 'lb-srv-charl', '阿丙', { cash: 4000, anon: true });
	const before = w.puts();
	const r = await w.call({ action: 'board', ...b });
	assert.equal(r.status, 200, r.data.msg);
	assert.equal(w.puts(), before, '看榜不写入');
	assert.deepEqual(r.data.top.map((x: any) => x.name), ['匿名旅人', '阿甲'], '阿乙没同意，不在榜上');
	assert.equal(r.data.me, null);
	assert.equal(r.data.mine.status, 'off');
	assert.ok(r.data.mine.score >= 5000, '没上榜也看得到自己的成绩');
	assert.deepEqual(r.data.pref, { on: false, anon: false, region: true, friends: true });
	const text = JSON.stringify(r.data);
	assert.ok(!text.includes('阿丙'), '匿名的人名字不外发');
	for (const p of [a, b, c]) {
		assert.ok(!text.includes(p.id) && !text.includes(p.key));
		assert.ok(!text.includes(await hashOf(p.id)), '不发 id 哈希');
	}
	assert.ok(!/"loc"|"fix"|"lat"|"lon"|why/.test(text), '不发位置和复核原因');
	assert.equal((await w.call({ action: 'boardpref', ...b, pref: { on: 'yes' } })).status, 400);
	assert.equal((await w.call({ action: 'boardpref', ...b, pref: {} })).status, 400);
	assert.equal((await w.call({ action: 'boardpref', id: b.id, key: 'z'.repeat(24), pref: { on: true } })).status, 403, '要同步码');
	assert.equal((await w.call({ action: 'boardpref', id: 'lb-nobody-00', key: 'z'.repeat(24), pref: { on: true } })).status, 404);
	assert.ok((await w.call({ action: 'boardpref', ...b, pref: { on: true } })).data.ok);
	const r2 = await w.call({ action: 'board', ...b });
	assert.deepEqual(r2.data.top.map((x: any) => x.name), ['阿乙', '匿名旅人', '阿甲']);
	assert.equal(r2.data.me.rank, 1);
	assert.ok((await w.call({ action: 'boardpref', ...b, pref: { on: false } })).data.ok);
	assert.equal((await w.call({ action: 'board', ...b })).data.total, 2, '退出后马上下榜');
});

test('服务端排行榜：地区榜按赛季登记的州，好友榜按「常遇见的人」，都不暴露位置', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const a = await join(w, 'lb-reg-perth1', '珀斯一', { cash: 2000 });
	const b = await join(w, 'lb-reg-perth2', '珀斯二', { cash: 3000 });
	const c = await join(w, 'lb-reg-adel01', '阿德一', { cash: 9000, loc: 'adelaide' });
	const reg = await w.call({ action: 'board', ...a, board: 'region' });
	assert.equal(reg.data.region.id, 'wa');
	assert.deepEqual(reg.data.top.map((x: any) => x.name), ['珀斯二', '珀斯一']);
	const regSa = await w.call({ action: 'board', ...c, board: 'region' });
	assert.equal(regSa.data.region.id, 'sa');
	assert.deepEqual(regSa.data.top.map((x: any) => x.name), ['阿德一']);
	// 阿德一后来去了珀斯：本赛季仍在南澳榜（登记地区整季不变），榜上不跟着位置变
	const rec = w.data.get('save:' + c.id);
	w.data.set('save:' + c.id, { ...rec, state: { ...rec.state, loc: 'perth' } });
	assert.ok((await w.call({ action: 'act', ...c, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } })).data.ok);
	assert.deepEqual((await w.call({ action: 'board', ...a, board: 'region' })).data.top.map((x: any) => x.name), ['珀斯二', '珀斯一']);
	// 关掉地区榜
	assert.ok((await w.call({ action: 'boardpref', ...b, pref: { region: false } })).data.ok);
	assert.deepEqual((await w.call({ action: 'board', ...a, board: 'region' })).data.top.map((x: any) => x.name), ['珀斯一']);
	// 好友榜：甲的「常遇见的人」里有丙
	const ra = w.data.get('save:' + a.id);
	w.data.set('save:' + a.id, { ...ra, state: { ...ra.state, met: { [await hashOf(c.id)]: { name: '阿德一', avatar: '🧑', n: 1, last: 1 } } } });
	const fr = await w.call({ action: 'board', ...a, board: 'friends' });
	assert.deepEqual(fr.data.top.map((x: any) => x.name), ['阿德一', '珀斯一'], '好友 + 自己，不含陌生人珀斯二');
	assert.ok((await w.call({ action: 'boardpref', ...c, pref: { friends: false } })).data.ok);
	assert.deepEqual((await w.call({ action: 'board', ...a, board: 'friends' })).data.top.map((x: any) => x.name), ['珀斯一']);
	for (const r of [reg, regSa, fr]) assert.ok(!/adelaide|perth|"loc"/.test(JSON.stringify(r.data.top)), '行里没有地点');
});

test('服务端排行榜：一个动作净资产暴涨就挂起复核，不上公开榜，本人看得到「复核中」', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const a = await join(w, 'lb-cheat-0001', '老实人', { cash: 2000 });
	const b = await join(w, 'lb-cheat-0002', '暴富', { cash: 2000 });
	const rec = w.data.get('save:' + b.id);
	w.data.set('save:' + b.id, { ...rec, state: { ...rec.state, cash: rec.state.cash + LB_ANOMALY.worthPerRev + 5000 } });
	assert.ok((await w.call({ action: 'act', ...b, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } })).data.ok, '游戏本身照常');
	const h = await hashOf(b.id);
	assert.ok(w.data.get('rank:' + h).hold, '记录被挂起');
	const pub = await w.call({ action: 'board', ...a });
	assert.deepEqual(pub.data.top.map((x: any) => x.name), ['老实人']);
	const mine = await w.call({ action: 'board', ...b });
	assert.equal(mine.data.mine.status, 'hold');
	assert.equal(mine.data.me, null);
	assert.ok(!JSON.stringify(mine.data).includes(w.data.get('rank:' + h).hold.why), '复核原因不发给客户端');
});

test('服务端排行榜：排名缓存——缓存期内别人的落盘不触发重排，改上榜设置立即生效', async () => {
	const w = makeWorld();
	const a = await join(w, 'lb-cache-0001', '甲', { cash: 2000 });
	const b = await join(w, 'lb-cache-0002', '乙', { cash: 3000 });
	const first = await w.call({ action: 'board', ...a });
	assert.deepEqual(first.data.top.map((x: any) => x.name), ['乙', '甲']);
	const rec = w.data.get('save:' + a.id);
	w.data.set('save:' + a.id, { ...rec, state: { ...rec.state, cash: 30_000 } });
	assert.ok((await w.call({ action: 'act', ...a, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } })).data.ok);
	const cached = await w.call({ action: 'board', ...b });
	assert.deepEqual(cached.data.top.map((x: any) => x.name), ['乙', '甲'], '缓存期内还是旧排名');
	assert.ok(cached.data.mine.score > 0);
	w.world.lbTtl = 0;
	assert.deepEqual((await w.call({ action: 'board', ...b })).data.top.map((x: any) => x.name), ['甲', '乙'], '过期后重排');
	w.world.lbTtl = 60_000;
	const c = await join(w, 'lb-cache-0003', '丙', { cash: 2500, consent: false });
	await w.call({ action: 'board', ...b });
	assert.ok((await w.call({ action: 'boardpref', ...c, pref: { on: true } })).data.ok);
	assert.deepEqual((await w.call({ action: 'board', ...b })).data.top.map((x: any) => x.name), ['甲', '乙', '丙'], '新同意上榜的人马上出现（改设置清缓存）');
	assert.ok((await w.call({ action: 'boardpref', ...a, pref: { anon: true } })).data.ok);
	assert.deepEqual((await w.call({ action: 'board', ...b })).data.top.map((x: any) => x.name), ['匿名旅人', '乙', '丙']);
	// 缓存还在时被挂起：看榜时再滤一次，不等缓存过期
	const ha = await hashOf(a.id);
	w.world.lb.items.get(ha).entry.hold = { at: 0, until: Date.now() + DAY, why: 'test' };
	assert.deepEqual((await w.call({ action: 'board', ...b })).data.top.map((x: any) => x.name), ['乙', '丙']);
});

test('服务端排行榜：比赛积分随共同事件落盘记进赛季记录，有比赛榜、没有比赛总榜', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const a = await join(w, 'lb-contest-01', '钓手', { cash: 2000 });
	const st = w.data.get('save:' + a.id);
	await w.world.persistMany([{ id: a.id, keyHash: st.keyHash, state: st.state, at: Date.now(), contest: 3 }]);
	await w.world.persistMany([{ id: a.id, keyHash: st.keyHash, state: st.state, at: Date.now(), contest: 5 }]);
	const r = await w.call({ action: 'board', ...a, dim: 'contest', scope: 'all' });
	assert.deepEqual(r.data.q, { dim: 'contest', scope: 'season', board: 'global' });
	assert.equal(r.data.top[0].score, LB_CONTEST_DAY_CAP, '当天封顶');
	assert.equal(r.data.season.label, seasonLabel(seasonOfDay(realDayOf(Date.now()))));
});

test('服务端排行榜：换季时结算上一季，只发称号；重跑不重复；挂起的人不发并记进复核名单', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const sid = seasonOfDay(realDayOf(Date.now()));
	const prev = sid - 1;
	const a = await join(w, 'lb-season-001', '冠军', { cash: 2000 });
	const b = await join(w, 'lb-season-002', '亚军', { cash: 2000 });
	const c = await join(w, 'lb-season-003', '被查', { cash: 2000 });
	const [ha, hb, hc] = await Promise.all([a, b, c].map((x) => hashOf(x.id)));
	const sea = (w0: number) => ({ base: stats({ worth: 0 }), last: stats({ worth: w0 }), contest: 0, cday: 0, cn: 0, region: 'wa', at: 1 });
	w.data.set(`lbs:${prev}:${ha}`, sea(900));
	w.data.set(`lbs:${prev}:${hb}`, sea(800));
	w.data.set(`lbs:${prev}:${hc}`, sea(5000));
	w.data.set(`lbs:${prev - 1}:${ha}`, sea(1)); // 再上一季的，结算完删掉
	w.data.set('lbsettled', prev - 1);
	const rc = w.data.get('rank:' + hc);
	const prevEnd = seasonStartDay(sid) * DAY - 8 * 3_600_000;
	w.data.set('rank:' + hc, { ...rc, hold: { at: prevEnd - DAY, until: prevEnd + DAY, why: 'test' } });
	const cash = { a: w.data.get('save:' + a.id).state.cash };
	w.world.lb = null;
	w.world.lbSettled = -1;
	const r = await w.call({ action: 'board', ...a });
	assert.equal(r.status, 200, r.data.msg);
	assert.equal(w.data.get('lbsettled'), prev);
	assert.deepEqual(w.data.get('lbt:' + ha).map((t: any) => [t.s, t.dim, t.tier]), [[prev, 'worth', 'champion']]);
	assert.deepEqual(w.data.get('lbt:' + hb).map((t: any) => t.tier), ['podium']);
	assert.equal(w.data.get('lbt:' + hc), undefined, '挂起的人不发');
	assert.deepEqual(w.data.get('lbrev:' + prev), [{ h: hc, dim: 'worth', rank: 1 }]);
	assert.ok(!w.data.has(`lbs:${prev - 1}:${ha}`), '再上一季的记录删掉');
	assert.ok(w.data.has(`lbs:${prev}:${ha}`), '上一季的留着');
	assert.equal(w.data.get('save:' + a.id).state.cash, cash.a, '奖励不碰存档数值');
	assert.equal(r.data.titles[0].text, `${seasonLabel(prev)} 身家榜冠军`);
	assert.equal(r.data.top.find((x: any) => x.me).badge, '🥇');
	// 重跑结算（比如上次中途失败）：不重复发
	w.data.set('lbsettled', prev - 1);
	w.world.lbSettled = -1;
	await w.call({ action: 'board', ...b });
	assert.equal(w.data.get('lbt:' + ha).length, 1);
	// 导出带上榜单数据；删号一起删
	const ex = await w.call({ action: 'export', ...a });
	assert.equal(ex.data.export.leaderboard.titles.length, 1);
	assert.equal(ex.data.export.leaderboard.pref.on, true);
	assert.ok((await w.call({ action: 'delete', ...a, confirm: 'delete' })).data.ok);
	for (const k of ['rank:' + ha, 'lbp:' + ha, 'lbt:' + ha, `lbs:${prev}:${ha}`, `lbs:${sid}:${ha}`]) assert.ok(!w.data.has(k), k + ' 已删');
	assert.ok(!(await w.call({ action: 'board', ...b })).data.top.some((x: any) => x.name === '冠军'), '内存索引里也删了');
});

test('服务端排行榜：读索引期间别的存档写完，读完后补上，不丢这次写入', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	const a = await join(w, 'lb-race-00001', '甲', { cash: 2000 });
	const b = await join(w, 'lb-race-00002', '乙', { cash: 2000 });
	w.world.lb = null;
	// 让第一次 list 等乙写完：list 读到的是旧的乙，乙的更新只能靠补账
	const list0 = w.world.ctx.storage.list;
	let once = true;
	w.world.ctx.storage.list = async (o: any) => {
		const out = await list0(o);
		if (once && o.prefix === 'rank:') {
			once = false;
			const rec = w.data.get('save:' + b.id);
			w.data.set('save:' + b.id, { ...rec, state: { ...rec.state, cash: 30_000 } });
			const r = await w.call({ action: 'act', ...b, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
			assert.ok(r.data.ok);
		}
		return out;
	};
	const r = await w.call({ action: 'board', ...a });
	assert.equal(r.status, 200, r.data.msg);
	assert.equal(r.data.top[0].name, '乙');
	assert.ok(r.data.top[0].score >= 30_000, '读到旧列表后补上了读期间的写入');
});

test('服务端排行榜：比赛类共同事件结算时给每个成员记比赛积分', async () => {
	const w = makeWorld();
	w.world.lbTtl = 0;
	// 借海滩清洁当一回「比赛」（珀斯开局就能做），测的是共同事件结算到赛季记录这条线
	LB_CONTEST['beach-cleanup'] = { ok: 2, fail: 2 };
	try {
		const A = { id: 'lb-coop-host1', key: 'a'.repeat(24) };
		const B = { id: 'lb-coop-mate1', key: 'b'.repeat(24) };
		const a0 = (await w.call({ action: 'create', ...A, profile })).data.state;
		await w.call({ action: 'create', ...B, profile });
		const lobby = (await w.call({ action: 'coop', op: 'open', ...A, coop: 'beach-cleanup', role: 0 })).data.lobbies[0].id;
		assert.ok((await w.call({ action: 'coop', op: 'join', ...B, lobby, role: 1 })).data.ok);
		const started = await w.call({ action: 'coop', op: 'start', ...A, lobby, rev: a0.rev });
		assert.ok(started.data.ok, started.data.msg);
		const sid = seasonOfDay(realDayOf(Date.now()));
		for (const c of [A, B]) assert.equal(w.data.get(`lbs:${sid}:${await hashOf(c.id)}`).contest, 2);
		assert.equal(w.data.get('save:' + A.id).state.contest, undefined, '比赛积分不进存档');
	} finally {
		delete LB_CONTEST['beach-cleanup'];
	}
});

test('旧玩家上榜提示：新角色建好就有「不上榜」设置、不弹；没有设置的旧角色读档时带 lbAsk，回答后不再带', async () => {
	const w = makeWorld();
	const fresh = { id: 'lb-ask-fresh1', key: 'f'.repeat(24) };
	assert.ok((await w.call({ action: 'create', ...fresh, profile })).data.ok);
	const hf = await hashOf(fresh.id);
	assert.equal(w.data.get('lbp:' + hf).on, false, '新角色默认不上榜');
	assert.equal((await w.call({ action: 'get', ...fresh })).data.lbAsk, undefined);
	assert.equal((await w.call({ action: 'board', ...fresh })).data.pref.on, false);
	// 旧角色：排行榜改版前建的，没有 lbp:
	const old = { id: 'lb-ask-old001', key: 'o'.repeat(24) };
	assert.ok((await w.call({ action: 'create', ...old, profile })).data.ok);
	const ho = await hashOf(old.id);
	w.data.delete('lbp:' + ho);
	w.world.lb = null;
	const got = await w.call({ action: 'get', ...old });
	assert.equal(got.data.lbAsk, true);
	const act = await w.call({ action: 'act', ...old, rev: got.data.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.equal(act.data.lbAsk, undefined, '只在读档时带');
	assert.equal(w.data.has('lbp:' + ho), false, '问之前不替玩家做决定');
	// 「暂不上榜」也算回答过
	assert.ok((await w.call({ action: 'boardpref', ...old, pref: lbAskPref('no') })).data.ok);
	assert.equal((await w.call({ action: 'get', ...old })).data.lbAsk, undefined);
	assert.equal(w.data.get('lbp:' + ho).on, false);
});

test('旧玩家上榜提示：弹窗三个按钮对应的设置', () => {
	assert.deepEqual(lbAskPref('nick'), { on: true, anon: false });
	assert.deepEqual(lbAskPref('anon'), { on: true, anon: true });
	assert.deepEqual(lbAskPref('no'), { on: false });
	assert.equal(lbAskPref('x'), null);
	assert.equal(lbAskPref(undefined), null);
	const h = lbAskHtml();
	assert.deepEqual([...h.matchAll(/data-lbask="([a-z]+)"/g)].map((m) => m[1]), ['nick', 'anon', 'no']);
	for (const m of h.matchAll(/data-lbask="([a-z]+)"/g)) assert.ok(lbAskPref(m[1]), m[1]);
	assert.match(h, /aria-labelledby="lbask-title"/);
});

test('服务端排行榜：旧格式的榜单记录（没有 stats）开新赛季时，打卡、图鉴、声望的赛季分从 0 起，不把终身成绩算进来（合并 main 后复核）', async () => {
	const w = makeWorld();
	const id = 'lb-srv-legacy', c = { id, key: 'lbsrvlegacy' + 'k'.repeat(13) };
	assert.ok((await w.call({ action: 'create', ...c, profile: { ...profile, name: '老玩家' } })).data.ok);
	const h = await hashOf(id);
	const rec = w.data.get('save:' + id);
	// 玩了很久：声望 300；榜单记录是排行榜之前的旧格式（core/board.ts 写的，只有 name/avatar/worth/day/at），没有赛季记录
	w.data.set('save:' + id, { ...rec, state: { ...rec.state, respect: 300 } });
	for (const k of [...w.data.keys()].filter((k) => k === 'rank:' + h || k.startsWith('lbs:'))) w.data.delete(k);
	w.data.set('rank:' + h, { name: '老玩家', avatar: '🧑', worth: rec.state.cash, day: 0, at: Date.now() - 3_600_000 });
	const r = await w.call({ action: 'act', ...c, rev: rec.state.rev, act: { t: 'activity', id: 'rest' } });
	assert.ok(r.data.ok, r.data.msg);
	const sea = [...w.data.entries()].find(([k]) => k.startsWith('lbs:') && k.endsWith(':' + h))![1];
	assert.ok(sea.base.respect >= 300, `赛季起点的声望按现在的值：${sea.base.respect}`);
	assert.ok(sea.last.respect - sea.base.respect <= 10, '这一季的声望分只算这一季涨的');
});

test('页面：切榜时旧请求的结果作废并重拉；上榜提示盖着抽屉时 Esc、点遮罩不关抽屉；提示弹窗换扁平 emoji（合并 main 后复核）', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	const fn = src.slice(src.indexOf('async function loadBoard('), src.indexOf('async function setBoardPref('));
	assert.match(fn, /if \(boardLoading\) \{ if \(force\) boardAgain = true; return; \}/, '请求在路上时的强制刷新不丢');
	assert.match(fn, /q\.dim !== lbUi\.dim \|\| q\.scope !== lbUi\.scope \|\| q\.board !== lbUi\.board\) boardAgain = true/, '回来时条件变了：结果作废');
	assert.match(fn, /if \(boardAgain\) \{ boardAgain = false; return loadBoard\(true\); \}/, '作废后重拉');
	const guards = [...src.matchAll(/if \(drawer && ([^)]*?)!eventResult/g)].map((m) => m[1]);
	assert.ok(guards.length >= 2, '找得到 Esc 和点遮罩两处关抽屉的判断');
	for (const g of guards) assert.match(g, /!lbAsk/, '上榜提示盖着时不关抽屉');
	assert.match(src, /paint\(modal, lbAskHtml\(\)\)/);
	assert.ok(!/setHtml\(modal, lbAskHtml\(\)\)/.test(src));
});

// 第十轮平衡定口径：身家榜 = netWorth（持仓按卖出到手价，扣全部欠银行的钱），不拆现金榜、不给持仓再打折
test('身家榜口径：等于净资产，含理财到手价，扣信用卡和贷款', async () => {
	const { netWorth } = await import('../../src/game/core/engine.ts');
	const { holdingsValue } = await import('../../src/game/core/market.ts');
	const { buyAsset } = await import('../../src/game/core/invest.ts');
	const b0 = base();
	const s = buyAsset({ ...b0, cash: 3000 }, WA, 'emu-coin', 1000).state;
	assert.ok(holdingsValue(s) > 0);
	assert.equal(lbStats(s).worth, Math.round(netWorth(s)));
	assert.ok(Math.abs(lbStats(s).worth - lbStats({ ...s, holdings: {} }).worth - holdingsValue(s)) <= 1, '持仓按卖出到手价计入');
	const owed = structuredClone(s);
	owed.bank.card = { limit: 500, bal: 120, missed: 0 };
	owed.bank.loans.push({ kind: 'personal', bal: 300, pay: 10, rate: 0.003, missed: 0 });
	assert.equal(lbStats(s).worth - lbStats(owed).worth, 420, '扣欠银行的钱');
});
