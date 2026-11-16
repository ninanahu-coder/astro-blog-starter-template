// 共同事件的规则（纯函数）：数据自洽、团队检定、每人结算不改入参
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCoop } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { COOP_TEAM_BONUS, coopAvailableAt, coopBlocked, coopCost, coopsAt, resolveCoop } from '../../src/game/core/coop.ts';
import { SKILL_KEYS } from '../../src/game/core/types.ts';
import { COOP_EVENTS, getCoop } from '../../src/game/data/coop.ts';
import { WEATHERS } from '../../src/game/data/weather.ts';
import { weatherAt } from '../../src/game/core/weather.ts';
import { WA } from '../../src/game/data/wa.ts';

const mk = (id: string, seed = 1) => createCharacter({ id, name: id, avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed });

test('共同事件数据自洽：id 唯一、人数合理、分工的能力存在、天气合法、每件事都有能做的地点', () => {
	const ids = new Set<string>();
	const weathers = new Set(WEATHERS.map((w) => w.id));
	for (const d of COOP_EVENTS) {
		assert.ok(!ids.has(d.id), `重复 id ${d.id}`);
		ids.add(d.id);
		assert.ok(d.min >= 2 && d.max >= d.min && d.max <= 4, `${d.id} 人数`);
		assert.ok(d.roles.length >= 2, `${d.id} 至少两种分工`);
		for (const r of d.roles) assert.ok((SKILL_KEYS as readonly string[]).includes(r.skill), `${d.id} 的能力 ${r.skill}`);
		for (const w of d.weather ?? []) assert.ok(weathers.has(w), `${d.id} 的天气 ${w}`);
		assert.ok(WA.locations.some((l) => coopAvailableAt(d, l)), `${d.id} 没有能做的地点`);
		assert.ok(d.dc > 0 && d.dc < 120, `${d.id} 难度`);
	}
});

test('能不能参加：有待处理事件、地点不对、时间不对都不行', () => {
	const a = mk('coop-a');
	const beach = getCoop('beach-cleanup')!;
	assert.equal(coopBlocked(a, WA, beach), undefined, '珀斯有海滩');
	assert.ok(coopsAt(a, WA).some((x) => x.def.id === 'beach-cleanup'));
	assert.match(coopBlocked({ ...a, pending: { eventId: 'rainbow' } } as never, WA, beach)!, /事件/);
	assert.match(coopBlocked({ ...a, loc: 'kalgoorlie' }, WA, beach)!, /做不了/);
	const band = getCoop('busk-band')!;
	assert.match(coopBlocked({ ...a, clock: 1440 + 7 * 60 }, WA, band)!, /时间/, '街头合奏 9 点才开始');
	assert.equal(coopBlocked({ ...a, clock: 1440 + 12 * 60 }, WA, band), undefined);
});

test('团队检定：不改入参、结果可复现；每多一人团队分 +6；所有人拿同一个结果并写进日志', () => {
	const def = getCoop('beach-cleanup')!;
	const a = mk('coop-a', 7), b = mk('coop-b', 7), c = mk('coop-c', 7);
	const snapshot = JSON.stringify([a, b, c]);
	const two = resolveCoop(def, WA, [{ state: a, role: 0, name: '阿甲' }, { state: b, role: 0, name: '阿乙' }]);
	const three = resolveCoop(def, WA, [{ state: a, role: 0, name: '阿甲' }, { state: b, role: 0, name: '阿乙' }, { state: c, role: 0, name: '阿丙' }]);
	assert.equal(JSON.stringify([a, b, c]), snapshot, '入参没被改');
	assert.deepEqual(resolveCoop(def, WA, [{ state: a, role: 0, name: '阿甲' }, { state: b, role: 0, name: '阿乙' }]).score, two.score, '同样的输入同样的结果');
	assert.equal(three.score - two.score, COOP_TEAM_BONUS, '种子和能力一样时，多一个人正好多 6 分');
	for (const r of three.results) {
		assert.ok(r.ok);
		const last = r.state.journal.at(-1)!.text;
		assert.match(last, /海滩清洁/);
		assert.ok(r.state.seed !== a.seed, '用掉了自己的随机数');
	}
	assert.match(three.results[0].state.journal.at(-1)!.text, /和阿乙、阿丙一起/);
	const out = three.success ? def.ok : def.fail;
	assert.equal(three.results[0].state.clock, a.clock + out.fx.minutes!, '花的时间按结果算');
});

test('applyCoop：每个人的版本号加一，数值钳制在合法范围', () => {
	const def = getCoop('busk-band')!;
	const a = { ...mk('coop-a', 3), clock: 1440 + 12 * 60, rev: 5 };
	const b = { ...mk('coop-b', 4), clock: 1440 + 12 * 60, rev: 9 };
	const r = applyCoop(def, WA, [{ state: a, role: 0, name: 'A' }, { state: b, role: 1, name: 'B' }]);
	assert.deepEqual(r.results.map((x) => x.state.rev), [6, 10]);
	for (const x of r.results) for (const v of Object.values(x.state.needs)) assert.ok(v >= 0 && v <= 100);
});

test('冷却：同一种共同事件每个游戏日一次，第二天又能做；成败都算做过', () => {
	const def = getCoop('beach-cleanup')!;
	const a = mk('coop-a', 11), b = mk('coop-b', 12);
	const r = applyCoop(def, WA, [{ state: a, role: 0, name: 'A' }, { state: b, role: 1, name: 'B' }]);
	for (const x of r.results) {
		assert.match(coopBlocked(x.state, WA, def)!, /今天已经做过/);
		assert.equal(coopBlocked({ ...x.state, clock: x.state.clock + 1440 }, WA, def), undefined, '第二天可以');
	}
	assert.equal(coopBlocked(r.results[0].state, WA, getCoop('busk-band')!)?.includes('今天已经做过') ?? false, false, '别的共同事件不受影响');
});

test('applyCoop：做到跨过午夜时换成新一天的心愿', () => {
	const def = getCoop('beach-cleanup')!;
	const late = (s: ReturnType<typeof mk>) => ({ ...s, clock: 1440 - 30, wishes: ['old'], wishDay: 0 });
	const r = applyCoop(def, WA, [{ state: late(mk('coop-a', 5)), role: 0, name: 'A' }, { state: late(mk('coop-b', 6)), role: 0, name: 'B' }]);
	for (const x of r.results) {
		assert.ok(x.state.clock >= 1440, '确实跨日了');
		assert.equal(x.state.wishDay, 1);
		assert.ok(!x.state.wishes.includes('old'));
	}
});

test('存档校验：coopDays 只留存在的共同事件，旧存档补空', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const a = { ...mk('coop-a'), coopDays: { 'beach-cleanup': 2.7, nope: 1, 'push-car': -1 } };
	assert.deepEqual(sanitizeState(a, locs, { fallbackLoc: 'perth', now: Date.now() })!.coopDays, { 'beach-cleanup': 2 });
	const old: Record<string, unknown> = { ...mk('coop-a') };
	delete old.coopDays;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.coopDays, {});
});

test('要凑钱的共同事件：钱不够不能参加，够了结算时扣掉', () => {
	const bbq = getCoop('community-bbq')!;
	assert.equal(coopCost(bbq), 8);
	assert.equal(coopCost(getCoop('beach-cleanup')!), 0);
	// 找一个邦伯里天气合适的中午
	let c = 1440 + 12 * 60;
	const fine = (x: number) => ['sunny', 'cloudy', 'hot'].includes(weatherAt({ ...mk('w'), loc: 'bunbury', clock: x }).id);
	while (!fine(c)) c += 1440;
	const a = { ...mk('coop-a', 21), loc: 'bunbury', clock: c, cash: 5 };
	assert.match(coopBlocked(a, WA, bbq)!, /需要 \$8/);
	const b = { ...a, cash: 50 };
	assert.equal(coopBlocked(b, WA, bbq), undefined);
	const r = applyCoop(bbq, WA, [{ state: b, role: 0, name: 'A' }, { state: { ...b, id: 'coop-b', seed: 22 }, role: 1, name: 'B' }]);
	for (const x of r.results) assert.equal(x.state.cash, 42);
});
