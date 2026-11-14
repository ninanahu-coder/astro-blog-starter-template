import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { claimDaily, DAILY, realDayOf } from '../../src/game/core/daily.ts';
import { experiencesAt, festivalActive, festivalCalendar, festivalsNow, travel } from '../../src/game/core/engine.ts';
import { dateLabel, dateOf, inSpan, YEAR_DAYS } from '../../src/game/core/time.ts';
import { refreshWishes, wishMatches } from '../../src/game/core/wishes.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { EXPERIENCES } from '../../src/game/data/experiences.ts';
import { FESTIVALS } from '../../src/game/data/festivals.ts';
import { WISH_REWARD, WISHES, WISHES_PER_DAY } from '../../src/game/data/wishes.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'cal-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 31 }),
	...over,
});

// ---------- 日历 ----------
test('日历：四季各 28 天，一年 112 天', () => {
	assert.equal(YEAR_DAYS, 112);
	assert.deepEqual(dateOf(at(8)), { year: 1, season: 'spring', seasonName: '春', day: 1, dayOfYear: 0 });
	assert.equal(dateLabel(at(8, 27)), '春季第 28 天');
	assert.equal(dateLabel(at(8, 28)), '夏季第 1 天');
	assert.equal(dateOf(at(0, 111)).season, 'winter');
	assert.deepEqual(dateOf(at(0, 112)), { year: 2, season: 'spring', seasonName: '春', day: 1, dayOfYear: 0 });
});

test('时间段：进行中、倒计时、跨年', () => {
	assert.deepEqual(inSpan(at(8, 9), 'spring', 10, 3), { active: true, startsIn: 0 });
	assert.deepEqual(inSpan(at(8, 11), 'spring', 10, 3), { active: true, startsIn: 0 });
	assert.deepEqual(inSpan(at(8, 12), 'spring', 10, 3), { active: false, startsIn: 109 });
	assert.deepEqual(inSpan(at(8, 0), 'spring', 10, 3), { active: false, startsIn: 9 });
	assert.equal(inSpan(at(8, 111), 'spring', 1, 2).startsIn, 1, '冬季最后一天，离春季第 1 天还有 1 天');
});

test('节日数据自洽', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	for (const f of FESTIVALS) {
		assert.ok(locs.has(f.loc), f.id);
		assert.ok(f.day >= 1 && f.day + f.days - 1 <= 28, `${f.id} 不跨季`);
		const exp = EXPERIENCES.filter((e) => e.festival === f.id);
		assert.ok(exp.length >= 1, `${f.id} 至少有一个专属体验`);
		for (const e of exp) assert.equal(e.loc, f.loc, `${e.id} 在节日举办地`);
	}
	for (const e of EXPERIENCES) if (e.festival) assert.ok(FESTIVALS.some((f) => f.id === e.festival), e.id);
	for (const ev of EVENTS) for (const s of ev.seasons ?? []) assert.ok(['spring', 'summer', 'autumn', 'winter'].includes(s), ev.id);
});

test('节日：只在当天开放专属体验；到场有提示', () => {
	const fireworksDay = 28 + 13; // 夏季第 14 天
	assert.ok(festivalActive('skyshow', at(19, fireworksDay)));
	assert.ok(!festivalActive('skyshow', at(19, fireworksDay + 2)));
	assert.deepEqual(festivalsNow(at(19, fireworksDay)).map((f) => f.id), ['skyshow']);
	const cal = festivalCalendar(at(8, 0));
	assert.equal(cal[0].festival.id, 'wildflower');
	assert.equal(cal[0].startsIn, 9);

	const s = make({ clock: at(19, fireworksDay), cash: 500 });
	assert.ok(experiencesAt(s, WA).some((o) => o.exp.id === 'fest-skyshow'));
	assert.ok(!experiencesAt({ ...s, clock: at(19, 0) }, WA).some((o) => o.exp.id === 'fest-skyshow'));
	const r = applyAction(s, WA, { t: 'experience', id: 'fest-skyshow' });
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.collected.includes('fest-skyshow'));
	assert.equal(applyAction({ ...s, clock: at(19, 0) }, WA, { t: 'experience', id: 'fest-skyshow' }).ok, false, '平时去不了');

	const arrive = travel(make({ loc: 'fremantle', clock: at(15, fireworksDay), cash: 500 }), WA, 'perth', 'road');
	assert.ok(arrive.state.journal.some((j) => j.text.includes('天鹅河烟火夜')));
	// 节日气氛还在时再进城不重复加娱乐
	const from = make({ loc: 'fremantle', clock: at(15, fireworksDay), cash: 500, needs: { hunger: 80, energy: 80, hygiene: 80, fun: 40, social: 80 } });
	const first = travel(from, WA, 'perth', 'road').state;
	const again = travel({ ...from, moodlets: [{ id: 'festival', until: from.clock + 600 }] }, WA, 'perth', 'road').state;
	assert.equal(Math.round(first.needs.fun - again.needs.fun), 10);
	assert.ok(again.moodlets.some((m) => m.id === 'festival' && m.until > from.clock + 600), '状态时长照常刷新');
});

test('季节事件只在对应季节出现', () => {
	const seen = (day: number) => {
		const ids = new Set<string>();
		for (let seed = 1; seed <= 300; seed++) {
			const s = { ...make({ loc: 'geraldton', clock: at(9, day), cash: 5000, visited: { perth: 1, geraldton: 1, kalbarri: 3 } }), seed };
			const r = travel(s, WA, 'kalbarri', 'road');
			if (r.state.pending) ids.add(r.state.pending.eventId);
		}
		return ids;
	};
	assert.ok(seen(3).has('wildflowers'), '春天有野花季');
	assert.ok(!seen(40).has('wildflowers'), '夏天没有');
	assert.ok(seen(40).has('heatwave'), '夏天有热浪');
	assert.ok(!seen(3).has('heatwave'));
});

// ---------- 心愿 ----------
test('心愿数据：每条都能被某个动作满足', () => {
	assert.equal(new Set(WISHES.map((w) => w.id)).size, WISHES.length);
	const s = make();
	const visitedMore = { ...s, loc: 'fremantle', visited: { ...s.visited, fremantle: 1 } };
	const probes = [
		{ t: 'activity', id: 'eat' }, { t: 'activity', id: 'swim' }, { t: 'activity', id: 'pub' }, { t: 'activity', id: 'hike' },
		{ t: 'npc', npc: 'mia', act: 'chat' }, { t: 'npc', npc: 'mia', act: 'gift' }, { t: 'npc', npc: 'mia', act: 'help' },
		{ t: 'job', op: 'work' }, { t: 'course', id: 'x' }, { t: 'experience', id: 'x' }, { t: 'home', op: 'cook' }, { t: 'home', op: 'relax' },
		{ t: 'buy', item: 'water' }, { t: 'travel', to: 'fremantle', mode: 'road' },
	] as const;
	for (const w of WISHES) assert.ok(probes.some((a) => wishMatches(w, a, s, visitedMore)), `${w.id} 没有动作能完成`);
});

test('心愿：每天换一批、不重复、按条件筛选', () => {
	const s = structuredClone(make());
	assert.equal(s.wishDay, -1);
	assert.ok(refreshWishes(s));
	assert.equal(s.wishes.length, WISHES_PER_DAY);
	assert.equal(new Set(s.wishes).size, WISHES_PER_DAY);
	assert.ok(!refreshWishes(s), '同一天不重新生成');
	for (let seed = 0; seed < 200; seed++) {
		const t = structuredClone({ ...make(), seed });
		refreshWishes(t);
		assert.ok(!t.wishes.includes('work') && !t.wishes.includes('cook'), '没工作没住处时不会想上班和做饭');
	}
});

test('心愿：做到了加心情和声望，过了当天换新', () => {
	const s = make({ clock: at(12), wishes: ['eat-out', 'chat'], wishDay: 0, needs: { hunger: 30, energy: 80, hygiene: 80, fun: 40, social: 40 } });
	const plain = applyAction({ ...s, wishes: [] }, WA, { t: 'activity', id: 'eat' });
	const r = applyAction(s, WA, { t: 'activity', id: 'eat' });
	assert.ok(r.ok);
	assert.match(r.msg, /心愿达成：想在外面吃顿好的/);
	assert.deepEqual(r.state.wishes, ['chat']);
	assert.equal(r.state.respect, plain.state.respect + WISH_REWARD.respect);
	assert.ok(r.state.needs.fun > plain.state.needs.fun);
	const failed = applyAction(s, WA, { t: 'activity', id: 'work-mine' });
	assert.equal(failed.state, s, '失败的动作不结算心愿');
	const next = applyAction({ ...r.state, clock: at(22) }, WA, { t: 'activity', id: 'sleep-camp' });
	assert.equal(next.state.wishDay, 1);
	assert.equal(next.state.wishes.length, WISHES_PER_DAY, '第二天换了一批');
});

// ---------- 每日奖励 ----------
test('每日奖励：一天一次，连续递增，第 7 天大礼，断了重来', () => {
	assert.equal(realDayOf(Date.UTC(2026, 0, 1, 15, 59)), realDayOf(Date.UTC(2026, 0, 1, 0, 0)), '珀斯时间同一天');
	assert.equal(realDayOf(Date.UTC(2026, 0, 1, 16, 0)), realDayOf(Date.UTC(2026, 0, 1, 15, 59)) + 1, 'UTC 16 点是珀斯的 0 点');
	let s = make();
	const d1 = claimDaily(s, 1000)!;
	assert.equal(d1.cash, 30);
	assert.equal(d1.state.cash, s.cash + 30);
	assert.equal(d1.state.rev, s.rev + 1);
	assert.equal(claimDaily(d1.state, 1000), null, '同一天不能再领');
	assert.equal(claimDaily(d1.state, 999), null, '日期倒退不发');
	s = d1.state;
	const cashes = [30];
	for (let day = 1001; day <= 1007; day++) {
		const c = claimDaily(s, day)!;
		cashes.push(c.cash);
		s = c.state;
	}
	assert.deepEqual(cashes, [30, 40, 50, 60, 70, 80, 90 + DAILY.bonus, 90]);
	assert.equal(s.daily.streak, 8);
	const broken = claimDaily(s, 1010)!;
	assert.equal(broken.streak, 1);
	assert.equal(broken.cash, 30);
	assert.equal(claimDaily(make(), 1.5), null);
});

test('存档校验：心愿与每日奖励', () => {
	const c = sanitizeState(make({ wishes: ['eat-out', 'eat-out', 'win-lottery'], wishDay: 3.7, daily: { day: -5, streak: 1e12 } }))!;
	assert.deepEqual(c.wishes, ['eat-out']);
	assert.equal(c.wishDay, 3);
	assert.deepEqual(c.daily, { day: 0, streak: 1e6 });
	const old = { ...make() } as Record<string, unknown>;
	for (const k of ['wishes', 'wishDay', 'daily']) Reflect.deleteProperty(old, k);
	const m = sanitizeState(old)!;
	assert.deepEqual([m.wishes, m.wishDay, m.daily], [[], -1, { day: 0, streak: 0 }]);
});
