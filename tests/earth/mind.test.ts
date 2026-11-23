// 心事与低谷期（第 43 批）：core/mind.ts、data/mind.ts、moodlets 的 relieves、mind 动作和存档清洗
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { activeMoodlets } from '../../src/game/core/attributes.ts';
import { cleanMind, createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { addMoodlet } from '../../src/game/core/engine.ts';
import { homesickCurve, lowSpell, mindScores, mindSignals, pressureSources, settleMind } from '../../src/game/core/mind.ts';
import { HELP_LINES, MIND, MIND_ACTS, MIND_KEYS, MIND_SIGNALS } from '../../src/game/data/mind.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { TRAITS } from '../../src/game/data/traits.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (origin = 'student', over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'mind-player', name: '测', avatar: '🧑', origin, region: 'wa', spawn: WA.spawn, seed: 7 }),
	...over,
});
const ids = (s: PlayerState) => activeMoodlets(s).map((m) => m.def.id).sort();
const friend = (score: number) => ({ score, last: {}, seen: [], known: [] });
/** 一个不会触发任何心事的普通人：冲浪手、到达头几天、需求都满、钱够 */
const calm = (over: Partial<PlayerState> = {}) => make('surfer', { clock: at(10, 2), mind: { day: 2, low: 0 }, ...over });

test('数据自洽：心事、调节动作、relieves、特质、求助渠道', () => {
	const byId = new Map(MOODLETS.map((m) => [m.id, m]));
	const mindIds = new Set(MIND_SIGNALS.map((d) => d.moodlet));
	assert.deepEqual(MIND_SIGNALS.map((d) => d.key), [...MIND_KEYS]);
	for (const d of MIND_SIGNALS) assert.ok((byId.get(d.moodlet)?.value ?? 0) < 0, `${d.key} 对应负面状态`);
	for (const a of Object.values(MIND_ACTS)) assert.ok((byId.get(a.moodlet)?.value ?? 0) > 0, `${a.moodlet} 是正面状态`);
	for (const m of MOODLETS) for (const r of m.relieves ?? []) {
		assert.ok(mindIds.has(r), `${m.id} 缓解的 ${r} 必须是心事`);
		assert.ok(m.value > 0, `${m.id} 能缓解心事，应该是正面状态`);
	}
	for (const t of TRAITS) for (const k of Object.keys(t.mods.mind ?? {})) assert.ok((MIND_KEYS as readonly string[]).includes(k), `${t.id}.mind.${k}`);
	for (const h of HELP_LINES) {
		assert.match(h.url, /^https:\/\/(www\.)?(lifeline\.org\.au|beyondblue\.org\.au|tisnational\.gov\.au|triplezero\.gov\.au)\//, `${h.name} 有官方来源`);
		assert.ok(h.contact && h.desc, h.name);
	}
	assert.ok(HELP_LINES.some((h) => h.contact.includes('13 11 14')) && HELP_LINES.some((h) => h.contact.includes('1300 22 4636')));
});

test('孤独：社交越低分数越高；独行侠减半；朋友减分', () => {
	assert.equal(mindScores(calm({ needs: { ...calm().needs, social: 20 } })).lonely, 0.5);
	assert.equal(mindScores(calm({ needs: { ...calm().needs, social: 35 } })).lonely, 0.13);
	assert.equal(mindScores(calm({ needs: { ...calm().needs, social: 80 } })).lonely, 0);
	assert.equal(mindScores(calm({ traits: ['loner'], needs: { ...calm().needs, social: 20 } })).lonely, 0.25);
	assert.equal(mindScores(calm({ needs: { ...calm().needs, social: 20 }, relations: { a: friend(30), b: friend(80), c: friend(95), d: friend(29) } })).lonely, 0.2, '朋友最多算 2 位，29 分不算');
});

test('思乡：出身权重 × 到达天数曲线', () => {
	assert.deepEqual([0, 6, 7, 41, 42, 89, 90, 400].map(homesickCurve), [0.3, 0.3, 1, 1, 0.75, 0.75, 0.4, 0.4]);
	assert.equal(mindScores(make('student', { clock: at(10, 3) })).homesick, 0.24);
	assert.equal(mindScores(make('student', { clock: at(10, 10) })).homesick, 0.8);
	assert.equal(mindScores(make('student', { clock: at(10, 50) })).homesick, 0.6);
	assert.equal(mindScores(make('surfer', { clock: at(10, 10) })).homesick, 0.3);
	assert.equal(mindScores(make('student', { clock: at(10, 10), traits: ['easygoing'] })).homesick, 0.64);
	assert.equal(mindScores(make('student', { clock: at(10, 10), relations: { a: friend(40) } })).homesick, 0.65);
});

test('压力：每条来源各自计分；没心没肺打六折', () => {
	assert.deepEqual(pressureSources(calm()).map((p) => p.id), []);
	assert.equal(mindScores(calm()).stressed, 0);
	const rent = calm({ cash: 100, home: { type: 'room', loc: WA.spawn, furniture: {} } as PlayerState['home'] });
	assert.deepEqual(pressureSources(rent).map((p) => p.id), ['rent'], '现金不够每周开销');
	assert.deepEqual(pressureSources(calm({ cash: 49 })).map((p) => p.id), ['broke']);
	assert.deepEqual(pressureSources(calm({ health: 39 })).map((p) => p.id), ['unwell']);
	assert.deepEqual(pressureSources(calm({ heat: 60 })).map((p) => p.id), ['heat']);
	assert.deepEqual(pressureSources(calm({ needs: { ...calm().needs, energy: 19 } })).map((p) => p.id), ['exhausted']);
	assert.deepEqual(pressureSources(calm({ cash: 50, health: 40, heat: 59, needs: { ...calm().needs, energy: 20 } })).map((p) => p.id), [], '门槛本身不算');
	assert.equal(mindScores(calm({ cash: 10, health: 10 })).stressed, 0.6);
	assert.equal(mindScores(calm({ cash: 10, health: 10, traits: ['easygoing'] })).stressed, 0.36);
});

test('每日结算：跨日才结算、同一天只一次；到门槛给心事并记日志', () => {
	const s = structuredClone(make('student', { clock: at(10, 10), mind: { day: 10, low: 0 } }));
	assert.deepEqual(settleMind(s), [], '同一天不结算');
	s.clock = at(0, 11) + 5;
	s.needs.social = 10;
	assert.deepEqual(settleMind(s), ['lonely', 'homesick']);
	assert.deepEqual(ids(s), ['homesick', 'lonely']);
	assert.equal(s.mind.day, 11);
	assert.equal(s.journal.at(-1)!.text, MIND_SIGNALS.find((d) => d.key === 'homesick')!.log);
	const n = s.journal.length;
	assert.deepEqual(settleMind(s), [], '第二次不再结算');
	assert.equal(s.journal.length, n);
	assert.equal(s.moodlets.find((m) => m.id === 'lonely')!.until, s.clock + 24 * 60);
});

test('缓解：获得能缓解的状态清掉心事；生效期间不再触发', () => {
	const s = structuredClone(make('student', { clock: at(20, 10), mind: { day: 10, low: 0 } }));
	addMoodlet(s, 'homesick');
	addMoodlet(s, 'lonely');
	addMoodlet(s, 'stressed');
	addMoodlet(s, 'called-home');
	assert.deepEqual(ids(s), ['called-home', 'lonely', 'stressed'], '视频只化解想家');
	addMoodlet(s, 'pumped');
	assert.deepEqual(ids(s), ['called-home', 'lonely', 'pumped']);
	addMoodlet(s, 'good-time');
	assert.deepEqual(ids(s), ['called-home', 'good-time', 'pumped']);
	s.clock = at(1, 11);
	s.needs.social = 10;
	assert.deepEqual(settleMind(s), [], '视频和玩得开心都还在：想家、孤单都不触发');
	assert.deepEqual(mindSignals(s).map((x) => [x.key, x.relievedBy ?? null]), [['lonely', 'good-time'], ['homesick', 'called-home'], ['stressed', 'good-time']], '取影响最大的那个');
});

test('低谷期：心情低于门槛的日子连续累计，好一天就清零；跨多天按天数算', () => {
	const s = structuredClone(make('surfer', { clock: at(10, 2), mind: { day: 2, low: 0 } }));
	for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 5;
	s.clock = at(1, 3);
	settleMind(s);
	assert.equal(s.mind.low, 1);
	assert.equal(lowSpell(s), false);
	s.clock = at(1, 4);
	settleMind(s);
	assert.equal(s.mind.low, MIND.helpAfter);
	assert.equal(lowSpell(s), true);
	s.clock = at(1, 7); // 一次跨了 3 天
	settleMind(s);
	assert.equal(s.mind.low, 5);
	s.clock = at(1, 7 + 100);
	settleMind(s);
	assert.equal(s.mind.low, MIND.lowCap, '有上限');
	for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 90;
	s.moodlets = [];
	s.clock = at(1, 200);
	settleMind(s);
	assert.equal(s.mind.low, 0);
	// 门槛两侧：心情 24 算低落，25 不算
	const edge = (needs: number) => {
		const e = structuredClone(make('surfer', { clock: at(10, 2), mind: { day: 2, low: 3 } }));
		for (const k of Object.keys(e.needs) as (keyof typeof e.needs)[]) e.needs[k] = needs;
		e.clock = at(1, 3);
		settleMind(e);
		return e.mind.low;
	};
	assert.equal(edge(MIND.low - 1), 4);
	assert.equal(edge(MIND.low), 0);
});

test('动作：打视频、找人聊聊花时间不花钱；校验网络输入；有待处理事件时不行；不改入参', () => {
	const s = make('student', { clock: at(10, 10), mind: { day: 10, low: 0 }, nextWeek: 99 }); // 不碰周结算
	s.moodlets = [{ id: 'homesick', until: at(20, 10) }, { id: 'lonely', until: at(20, 10) }];
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'mind', op: 'call' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不改入参');
	assert.equal(r.state.clock, s.clock + MIND_ACTS.call.minutes);
	assert.equal(r.state.cash, s.cash);
	assert.deepEqual(ids(r.state), ['called-home', 'lonely']);
	const t = applyAction(r.state, WA, { t: 'mind', op: 'talk' });
	assert.equal(t.state.clock, r.state.clock + MIND_ACTS.talk.minutes);
	assert.deepEqual(ids(t.state), ['called-home', 'talked-it-out']);
	assert.equal(applyAction({ ...s, pending: { eventId: 'x' } }, WA, { t: 'mind', op: 'talk' }).ok, false);
	assert.deepEqual(parseAction({ t: 'mind', op: 'talk' }), { t: 'mind', op: 'talk' });
	for (const op of ['x', 'toString', '__proto__', 'constructor', 1, null, undefined]) assert.equal(parseAction({ t: 'mind', op }), null, String(op));
});

test('经 applyAction 跨过午夜时结算心事', () => {
	const s = make('student', { clock: at(23, 10) + 50, mind: { day: 10, low: 0 } });
	s.needs.social = 10;
	const r = applyAction(s, WA, { t: 'mind', op: 'call' }); // 23:50 打 40 分钟，跨到第 11 天
	assert.ok(r.ok);
	assert.equal(r.state.mind.day, 11);
	assert.deepEqual(ids(r.state), ['called-home', 'lonely'], '想家被视频挡住，孤单照常触发');
});

test('存档：新角色有初始值；旧存档缺字段从今天起算；坏值钳住；幂等', () => {
	const fresh = make();
	assert.deepEqual(fresh.mind, { day: 0, low: 0 });
	const old = structuredClone(make('student', { clock: at(9, 30) })) as Partial<PlayerState>;
	delete old.mind;
	const a = sanitizeState(old)!;
	assert.deepEqual(a.mind, { day: 30, low: 0 }, '不补算以前的日子');
	assert.deepEqual(sanitizeState(a), a, '幂等');
	for (const bad of [null, [], 'x', 5, { day: NaN, low: Infinity }, { day: -3, low: -1 }, { day: 1e12, low: 1e9 }, Object.create({ day: 3 })]) {
		const m = cleanMind(bad, at(9, 30));
		assert.ok(Number.isInteger(m.day) && m.day >= 0 && m.day <= 30, JSON.stringify(bad));
		assert.ok(Number.isInteger(m.low) && m.low >= 0 && m.low <= MIND.lowCap, JSON.stringify(bad));
		assert.deepEqual(cleanMind(m, at(9, 30)), m);
	}
	assert.deepEqual(cleanMind({ day: 12.7, low: 3.9 }, at(9, 30)), { day: 12, low: 3 });
});

// ---------- 合并 main 后：main 新加的好心情也能化解心事 ----------
test('main 新加的好心情按 mood.md 的建议化解心事：知己、说心里话、家乡的味道、请客、宠物、运动、爱好（合并 main 后）', () => {
	const want: Record<string, string[]> = {
		confidant: ['lonely', 'homesick'], 'heart-to-heart': ['lonely', 'homesick'], 'taste-of-home': ['homesick'], hosted: ['lonely'],
		'pet-cuddle': ['lonely', 'stressed'], 'dog-walk': ['stressed'], 'new-pet': ['lonely'], 'race-podium': ['stressed'], 'race-finish': ['stressed'], 'hobby-flow': ['stressed'],
	};
	for (const [id, rel] of Object.entries(want)) assert.deepEqual(MOODLETS.find((m) => m.id === id)?.relieves, rel, id);
	// 拿到「家乡的味道」时顺带清掉想家
	const s = calm();
	addMoodlet(s, 'homesick');
	assert.ok(ids(s).includes('homesick'));
	addMoodlet(s, 'taste-of-home');
	assert.ok(!ids(s).includes('homesick'), '家乡的味道化解想家');
	for (const m of MOODLETS) for (const r of m.relieves ?? []) assert.ok(MIND_SIGNALS.some((d) => d.moodlet === r), `${m.id} 缓解的 ${r} 不是心事`);
});

test('页面：派生属性里身体的「紧绷」和心事的「压力」分开叫（合并 main 后）', async () => {
	const { readFileSync } = await import('node:fs');
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(page, /<p>身心紧绷 \$\{Math\.round\(stress\(s\) \* 100\)\}%/);
	assert.doesNotMatch(page, /<p>压力 \$\{Math\.round\(stress/);
	assert.match(page, /\[data-hobby\],\[data-mind\],/, '点击名单有 data-mind');
});

test('存档在没有心事的部署上走过一段再回来：低落天数只算这次跨过的日子（合并 main 后复核）', () => {
	// mind.day 停在第 2 天，回来时已经第 12 天；这次动作从第 12 天走到第 13 天
	const s = calm({ clock: at(1, 13), mind: { day: 2, low: 1 }, needs: { hunger: 0, energy: 0, hygiene: 0, fun: 0, social: 0 } });
	settleMind(s, 12);
	assert.equal(s.mind.day, 13);
	assert.equal(s.mind.low, 2, '只加这次跨过的 1 天，不是 11 天');
	// 不传 fromDay 时照旧按存档记号算（单元测试和旧调用）
	const t = calm({ clock: at(1, 13), mind: { day: 2, low: 1 }, needs: { hunger: 0, energy: 0, hygiene: 0, fun: 0, social: 0 } });
	settleMind(t);
	assert.equal(t.mind.low, 12);
});

test('经 applyAction：存档的心事记号落后很多天时，低落天数只加这次跨过的一天（合并 main 后复核）', () => {
	const s = calm({ clock: at(23, 12) + 50, mind: { day: 2, low: 1 }, needs: { hunger: 0, energy: 0, hygiene: 0, fun: 0, social: 0 } });
	const r = applyAction(s, WA, { t: 'mind', op: 'call' });
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.mind.day, 13, '跨过了午夜');
	assert.equal(r.state.mind.low, 2);
});
