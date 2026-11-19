// 新手引导（v36）：渐进出现、第一次进页的提示、回流卡片；进度存在存档里，由服务端动作记下
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { travelOptions } from '../../src/game/core/engine.ts';
import { createCharacter, sanitizeState, START_CLOCK } from '../../src/game/core/character.ts';
import { claimDaily, realDayOf } from '../../src/game/core/daily.ts';
import { guideView } from '../../src/game/core/guide.ts';
import {
	applyOnboard, cleanOnboard, featureShown, freshOnboard, lockedFeatures, newFeature, noteReturn, realDate, returnView, settleOnboard, tipFor, unlocked, veteranOnboard,
} from '../../src/game/core/onboard.ts';
import { CHANGELOG } from '../../src/game/data/changelog.ts';
import { FEATURES, MARKS, RETURN_DAYS, RETURN_SHOW_DAYS, TIPS } from '../../src/game/data/onboard.ts';
import { STORY } from '../../src/game/data/story.ts';
import { WA } from '../../src/game/data/wa.ts';
import { EarthWorld } from '../../src/game/server/world.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'onboard-player', name: '新', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 3 }),
	...over,
});
const LOCS = new Set(WA.locations.map((l) => l.id));
const PAGES = ['place', 'go', 'near', 'grow', 'social', 'me', 'sync'];
const ob = (over: Partial<PlayerState['onboard']> = {}): PlayerState['onboard'] => ({ ...freshOnboard(), ...over });

test('引导数据：id 唯一，提示页面都存在，每页最多一条提示，里程碑不和提示重名', () => {
	assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length);
	assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
	for (const t of TIPS) {
		assert.ok(PAGES.includes(t.page), t.id);
		if (t.go) assert.ok(PAGES.includes(t.go.page), t.id);
	}
	assert.equal(new Set(TIPS.map((t) => t.page)).size, TIPS.length, '一页一条');
	for (const m of MARKS) assert.ok(!TIPS.some((t) => t.id === m));
	assert.ok(RETURN_DAYS >= 2 && RETURN_SHOW_DAYS >= 1);
});

test('新角色：什么都没解开，各页提示都在；开局第 1 天、没车、只到过一个地方时卡片先藏着', () => {
	const s = make();
	assert.deepEqual(s.onboard, freshOnboard());
	assert.equal(unlocked(s).size, 0);
	assert.deepEqual(lockedFeatures(s).map((f) => f.id), FEATURES.map((f) => f.id));
	for (const f of FEATURES) assert.equal(featureShown(s, f.id), false, f.id);
	assert.equal(tipFor(s, 'go')?.id, 'go');
	assert.equal(tipFor(s, 'sync')?.id, 'sync');
	assert.equal(tipFor(s, 'place'), null, '今天页由新手指南负责，不加页面提示');
	assert.equal(newFeature(s), null);
	// 留学生开局就有车：车行和修车厂直接出现
	const student = createCharacter({ id: 'onboard-student', name: '学', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 1 });
	assert.ok(featureShown(student, 'garage'));
});

test('老存档（没有 onboard 字段）：全部功能直接显示，所有提示当作看过；新存档校验后原样保留', () => {
	const legacy = structuredClone(make()) as unknown as Record<string, unknown>;
	delete legacy.onboard;
	const s = sanitizeState(legacy, LOCS)!;
	assert.deepEqual(s.onboard, veteranOnboard());
	assert.equal(lockedFeatures(s).length, 0);
	for (const p of PAGES) assert.equal(tipFor(s, p as never), null, p);
	assert.equal(newFeature(s), null);
	assert.deepEqual(sanitizeState(make(), LOCS)!.onboard, freshOnboard());
});

test('存档校验：只留认识的 id、去重；回流记录不合法或在未来就丢掉；结构不对按新角色处理', () => {
	const c = cleanOnboard({ feats: ['hobby', 'hobby', 'nope', 7], tips: ['go', 'go', '__proto__', 'feat:study', 'sync-kept', 'feat:nope'], back: { day: 100, gap: 5, seen: 'yes' }, off: 1 });
	assert.deepEqual(c, { feats: ['hobby'], tips: ['go', 'feat:study', 'sync-kept'], back: { day: 100, gap: 5, seen: false }, off: false });
	assert.equal(cleanOnboard({ back: { day: 100, gap: RETURN_DAYS - 1 } }).back, null, '离开不够久不算回流');
	assert.equal(cleanOnboard({ back: { day: 100, gap: 5 } }, 99).back, null, '记在未来的回流');
	assert.ok(cleanOnboard({ back: { day: 100, gap: 5 } }, 100).back);
	assert.equal(cleanOnboard({ back: { day: Infinity, gap: 5 } }).back, null);
	assert.deepEqual(cleanOnboard(null), freshOnboard());
	assert.deepEqual(cleanOnboard([]), freshOnboard());
	assert.deepEqual(cleanOnboard('x'), freshOnboard());
	// 服务端时间传给 sanitizeState 时也用来查回流
	const raw = { ...make(), onboard: { ...freshOnboard(), back: { day: 30_000, gap: 4, seen: false } } };
	assert.equal(sanitizeState(raw, LOCS, { now: 29_999 * 86_400_000 })!.onboard.back, null);
});

test('渐进出现：去过第二个地方后，钓鱼和车行出现并记进存档；以后条件不满足了也不再藏起来', () => {
	const s = make();
	const way = travelOptions(s, WA).find((o) => o.available)!;
	const r = applyAction(s, WA, { t: 'travel', to: way.to, mode: way.mode });
	assert.ok(r.ok, r.msg);
	assert.ok(r.state.onboard.feats.includes('hobby'));
	assert.ok(r.state.onboard.feats.includes('garage'));
	assert.match(r.msg, /新出现/);
	assert.deepEqual(s.onboard.feats, [], '不改入参');
	// 存档里记下的，条件不满足（只剩一个到访地点）也照样显示
	const back = { ...r.state, visited: { [r.state.loc]: 1 } };
	assert.ok(featureShown(back, 'hobby'));
	assert.equal(newFeature(back)?.id, 'hobby', '新出现的功能逐条提示');
});

test('settleOnboard：到第 2 天解开 3 项、第 3 天解开房产；只追加不重复', () => {
	const d2 = make({ clock: START_CLOCK + 1440 });
	assert.deepEqual(settleOnboard(d2).map((f) => f.id), ['hobby', 'study', 'garage']);
	assert.deepEqual(settleOnboard(d2), [], '第二次没有新的');
	assert.deepEqual(d2.onboard.feats, ['hobby', 'study', 'garage']);
	const d3 = { ...d2, clock: START_CLOCK + 2 * 1440 };
	assert.deepEqual(settleOnboard(d3).map((f) => f.id), ['estate']);
	assert.equal(new Set(d3.onboard.feats).size, d3.onboard.feats.length);
	// 租到住处也会提前解开房产
	assert.ok(unlocked(make({ home: { type: 'room', loc: 'perth', furniture: {} } as never })).has('estate'));
});

test('关掉提示：不花时间、版本号加一；再关一次不变；有待处理事件时也能关', () => {
	const s = make();
	const r = applyAction(s, WA, { t: 'onboard', op: 'tip', id: 'go' });
	assert.ok(r.ok);
	assert.equal(r.state.clock, s.clock);
	assert.equal(r.state.rev, s.rev + 1);
	assert.equal(tipFor(r.state, 'go'), null);
	assert.deepEqual(s.onboard.tips, [], '不改入参');
	const again = applyAction(r.state, WA, { t: 'onboard', op: 'tip', id: 'go' });
	assert.equal(again.state, r.state, '没变化就不加版本号');
	const busy = make({ pending: { eventId: 'x' } });
	assert.ok(applyAction(busy, WA, { t: 'onboard', op: 'tip', id: 'near' }).state.onboard.tips.includes('near'));
	// 提示动作不算心愿和主线
	const wishy = make({ wishes: ['chat'] });
	assert.deepEqual(applyAction(wishy, WA, { t: 'onboard', op: 'tip', id: 'grow' }).state.wishes, wishy.wishes);
});

test('网络输入：只认识的提示 id 和操作才能通过', () => {
	assert.deepEqual(parseAction({ t: 'onboard', op: 'tip', id: 'sync-kept' }), { t: 'onboard', op: 'tip', id: 'sync-kept' });
	assert.deepEqual(parseAction({ t: 'onboard', op: 'all', extra: 1 }), { t: 'onboard', op: 'all' });
	for (const bad of [{ t: 'onboard', op: 'tip', id: 'nope' }, { t: 'onboard', op: 'tip', id: '__proto__' }, { t: 'onboard', op: 'tip' }, { t: 'onboard', op: 'hack' }, { t: 'onboard' }]) {
		assert.equal(parseAction(bad), null, JSON.stringify(bad));
	}
});

test('关掉全部引导：提示都不出、所有卡片显示；重新打开：页面提示再出一次，里程碑和「新出现」不重放', () => {
	let s = make({ onboard: ob({ tips: ['go', 'sync-kept', 'feat:hobby'] }) });
	s = applyOnboard(s, { op: 'off' }).state;
	assert.ok(s.onboard.off);
	for (const p of PAGES) assert.equal(tipFor(s, p as never), null);
	for (const f of FEATURES) assert.ok(featureShown(s, f.id));
	assert.equal(lockedFeatures(s).length, 0);
	assert.equal(applyOnboard(s, { op: 'off' }).state, s, '已经关了');
	s = applyOnboard(s, { op: 'on' }).state;
	assert.equal(s.onboard.off, false);
	assert.deepEqual(s.onboard.tips, ['sync-kept', 'feat:hobby']);
	assert.equal(tipFor(s, 'go')?.id, 'go');
	const fresh = make();
	assert.equal(applyOnboard(fresh, { op: 'on' }).state, fresh, '本来就开着、也没关过提示');
});

test('现在全部显示：所有功能解开，不再逐条提示新出现', () => {
	const s = applyOnboard(make({ onboard: ob({ feats: ['hobby'] }) }), { op: 'all' }).state;
	assert.deepEqual(s.onboard.feats, ['hobby', ...FEATURES.map((f) => f.id).filter((x) => x !== 'hobby')]);
	assert.equal(newFeature(s), null);
	assert.equal(lockedFeatures(s).length, 0);
	assert.equal(applyOnboard(s, { op: 'all' }).state, s);
});

test('回流：离开 3 天以上才记，在发每日奖励之前；没领过奖励的不算；不改入参', () => {
	const s = make({ daily: { day: 20_000, streak: 4 } });
	assert.equal(noteReturn(s, 20_000 + RETURN_DAYS - 1), s);
	const zero = make();
	assert.equal(noteReturn(zero, 20_100), zero, '从没领过每日奖励（day 0）不算');
	const back = noteReturn(s, 20_000 + RETURN_DAYS);
	assert.deepEqual(back.onboard.back, { day: 20_000 + RETURN_DAYS, gap: RETURN_DAYS, seen: false });
	assert.equal(s.onboard.back, null);
	const claimed = claimDaily(back, 20_000 + RETURN_DAYS)!;
	assert.equal(claimed.streak, 1);
	assert.deepEqual(claimed.state.onboard.back, back.onboard.back, '领奖保留回流记录');
	assert.equal(noteReturn(s, 1.5), s);
});

test('回流卡片：回来当天和第二天显示，点过或过了两天就不显示；列出主线这一步和离开期间的更新', () => {
	const today = 20_400;
	const s = make({ onboard: ob({ back: { day: today, gap: 10, seen: false } }), needs: { ...make().needs, hunger: 10 } });
	const v = returnView(s, today)!;
	assert.equal(v.gap, 10);
	assert.equal(v.story?.title, STORY[0].title);
	assert.equal(v.story?.step, STORY[0].steps[0].text);
	assert.ok(v.low);
	const left = realDate(today - 10);
	assert.deepEqual(v.news, CHANGELOG.filter((e) => e.date > left).slice(0, 3));
	// 离开那天发的更新算看过：只列日期晚于离开那天的
	const e = CHANGELOG[0];
	const leftDay = Math.round(Date.parse(e.date + 'T00:00:00Z') / 86_400_000);
	assert.equal(realDate(leftDay), e.date);
	const edge = returnView(make({ onboard: ob({ back: { day: leftDay + 5, gap: 5, seen: false } }) }), leftDay + 5)!;
	assert.ok(!edge.news.some((n) => n.date === e.date), '离开当天的不算');
	assert.ok(returnView(s, today + RETURN_SHOW_DAYS - 1));
	assert.equal(returnView(s, today + RETURN_SHOW_DAYS), null);
	assert.equal(returnView(s, today - 1), null);
	const seen = applyOnboard(s, { op: 'back' }).state;
	assert.equal(returnView(seen, today), null);
	assert.equal(applyOnboard(seen, { op: 'back' }).state, seen);
	// 关了全部引导也照样显示（不是教学）
	assert.ok(returnView({ ...s, onboard: { ...s.onboard, off: true } }, today));
	// 主线全部写完：不写主线这一行
	assert.equal(returnView({ ...s, story: { ch: STORY.length, done: {} } }, today)!.story, null);
	assert.equal(realDate(realDayOf(Date.UTC(2026, 10, 20, 2))), '2026-11-20', '珀斯 11 月 20 日上午');
});

test('新手指南第 3 天多了「记下同步码」：复制或显示二维码后打勾', () => {
	const d3 = make({ clock: START_CLOCK + 2 * 1440 });
	const step = (s: PlayerState) => guideView(s)!.steps.find((x) => x.id === 'sync')!;
	assert.equal(step(d3).done, false);
	const kept = applyAction(d3, WA, { t: 'onboard', op: 'tip', id: 'sync-kept' }).state;
	assert.equal(step(kept).done, true);
});

test('服务端：离开 5 天后第一次读取记下回流，点过后保存；不认识的引导动作被拒；老存档读出来全部解开', async (t) => {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async () => new Map(),
	};
	const world = new EarthWorld({ storage } as never, {});
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	const cred = { id: 'onboard-server-1', key: 'k'.repeat(24) };
	const created = await call({ action: 'create', ...cred, profile: { name: '回', avatar: '🧑', origin: 'backpacker', traits: [] } });
	assert.deepEqual(created.data.state.onboard, freshOnboard());
	const today = realDayOf(Date.now());
	const rec = data.get('save:' + cred.id);
	data.set('save:' + cred.id, { ...rec, state: { ...rec.state, daily: { day: today - 5, streak: 3 } } });
	const got = await call({ action: 'get', ...cred });
	assert.deepEqual(got.data.state.onboard.back, { day: today, gap: 5, seen: false });
	assert.match(got.data.daily, /连续 1 天/);
	assert.deepEqual(data.get('save:' + cred.id).state.onboard.back, { day: today, gap: 5, seen: false }, '落盘');
	const seen = await call({ action: 'act', ...cred, rev: got.data.state.rev, act: { t: 'onboard', op: 'back' } });
	assert.ok(seen.data.ok);
	assert.equal(data.get('save:' + cred.id).state.onboard.back.seen, true);
	assert.equal((await call({ action: 'get', ...cred })).data.state.onboard.back.seen, true, '同一天再读不重记');
	const bad = await call({ action: 'act', ...cred, rev: seen.data.state.rev, act: { t: 'onboard', op: 'tip', id: 'zzz' } });
	assert.equal(bad.status, 400);
	// 老存档：去掉 onboard 字段再读
	const rec2 = data.get('save:' + cred.id);
	const { onboard: _drop, ...old } = rec2.state;
	data.set('save:' + cred.id, { ...rec2, state: old });
	const vet = await call({ action: 'get', ...cred });
	assert.deepEqual(vet.data.state.onboard, veteranOnboard());
	t.diagnostic('ok');
});
