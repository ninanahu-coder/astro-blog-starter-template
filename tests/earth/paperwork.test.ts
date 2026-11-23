// 证件和办事（第 43 批）：数据自洽、办事流程、等待和考试、地址过期、对其他动作的门槛、存档校验；合并 main 后银行户、TFN、医保看 main 的系统
import { STAT_EVENTS } from '../../src/game/ui/telemetry.ts';
import { systemOf } from '../../tools/earth/balance/systems.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { cleanPapers } from '../../src/game/core/paper-clean.ts';
import { doPaper, paperBlocked, paperChecklist, paperGate, paperProgress, papersFor, paperStatus, getPaper } from '../../src/game/core/paperwork.ts';
import { PAPER_GATES, PAPER_ORDER, PAPER_RULES, PAPERS } from '../../src/game/data/paperwork.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PaperRec, PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}, origin = 'student', region = 'wa'): PlayerState => ({
	...createCharacter({ id: 'paper-player', name: '办', avatar: '🧑', origin, region, spawn: region === 'sa' ? SA_BASE.spawn : WA.spawn, seed: 11 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	clock: at(10),
	cash: 2000,
	...over,
});
const done = (...ids: string[]): Record<string, PaperRec> => Object.fromEntries(ids.map((id) => [id, { at: 0, ready: 0 }]));
const flat = PROPERTIES.find((p) => p.loc === WA.spawn)!;

test('数据：id 唯一、都在清单顺序里、前置存在且无环、来源是 https、数值不为负', () => {
	const ids = PAPERS.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual([...PAPER_ORDER].sort(), [...ids].sort(), '清单顺序和数据表一一对应');
	for (const p of PAPERS) {
		for (const n of p.needs) {
			assert.ok(getPaper(n), `${p.id} 的前置 ${n} 存在`);
			assert.ok(PAPER_ORDER.indexOf(n) < PAPER_ORDER.indexOf(p.id), `${p.id} 的前置 ${n} 排在它前面（无环）`);
		}
		assert.ok(p.fee >= 0 && p.minutes > 0 && p.waitDays >= 0, p.id);
		assert.ok(p.docs.length && p.real.who && p.real.steps && p.real.wait, `${p.id} 写了现实的前置、材料、流程、等待`);
		assert.ok(p.unlocks.now.length + p.unlocks.later.length > 0, `${p.id} 写了解锁什么`);
		assert.ok(p.real.sources.length > 0 && p.real.sources.every((s) => /^https:\/\/[^\s"'<>]+$/.test(s.url)), `${p.id} 有来源`);
		assert.ok(p.place, p.id);
		if (p.where !== 'online') {
			const w = p.where;
			for (const id of w.locs ?? []) assert.ok([...WA.locations, ...SA_BASE.locations].some((l) => l.id === id), `${p.id} 的地点 ${id} 存在`);
			for (const r of [WA, SA_BASE]) {
				if (p.regions && !p.regions.includes(r.id as 'wa' | 'sa')) continue;
				assert.ok(r.locations.some((l) => w.kinds?.includes(l.kind) || w.locs?.includes(l.id)), `${p.id} 在 ${r.id} 有地方办`);
			}
		}
	}
	for (const ids of Object.values(PAPER_GATES.certs)) for (const id of ids) assert.ok(getPaper(id), id);
	for (const id of Object.keys(PAPER_GATES.certs)) assert.ok(CERTS.some((c) => c.id === id), id);
	assert.ok(PAPER_RULES.max >= PAPERS.length);
});

test('清单按区域和出身筛：西澳留学生是 SmartRider + OSHC，南澳矿工是 metroCARD + Medicare（医保那一行看签证，合并 main 后）', () => {
	const st = papersFor(make()).map((p) => p.id);
	assert.ok(st.includes('transit-wa') && st.includes('oshc'));
	assert.ok(!st.includes('transit-sa') && !st.includes('medicare'));
	const fifo = papersFor(make({}, 'fifo', 'sa')).map((p) => p.id);
	assert.ok(fifo.includes('transit-sa') && fifo.includes('medicare'));
	assert.ok(!fifo.includes('transit-wa') && !fifo.includes('oshc'));
	assert.deepEqual(st, PAPER_ORDER.filter((id) => st.includes(id)), '按清单顺序');
	assert.match(paperBlocked(make(), WA, getPaper('medicare')!)!, /不用办/);
	// 留学生签证自带 OSHC：一开始就算办好；不算进要办的总数里的只有「没有医保」那种
	assert.equal(paperStatus(make(), 'oshc'), 'done');
	assert.deepEqual(paperProgress(make()), { done: 1, total: st.length });
});

test('办手机卡：当场办好、收费、花时间；不改入参；同一项不能再办', () => {
	const s = make();
	const before = structuredClone(s);
	const r = applyAction(s, WA, { t: 'paper', id: 'phone' });
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不改入参');
	assert.equal(r.state.cash, s.cash - getPaper('phone')!.fee);
	assert.equal(r.state.clock, s.clock + getPaper('phone')!.minutes);
	assert.equal(paperStatus(r.state, 'phone'), 'done');
	assert.equal(r.state.rev, s.rev + 1);
	assert.equal(applyAction(r.state, WA, { t: 'paper', id: 'phone' }).ok, false);
});

test('前置、地点、办公时间、钱、精力、待处理事件都会挡住', () => {
	assert.match(paperBlocked(make(), WA, getPaper('licence-theory')!)!, /登记/);
	assert.match(paperBlocked(make({ loc: 'bunbury' }), WA, getPaper('transit-wa')!)!, /Transperth 服务范围/);
	assert.equal(paperBlocked(make({ loc: 'fremantle' }), WA, getPaper('transit-wa')!), undefined);
	assert.match(paperBlocked(make({ clock: at(23) }), WA, getPaper('transit-wa')!)!, /办公时间/);
	assert.match(paperBlocked(make({ cash: 0 }), WA, getPaper('phone')!)!, /\$10/);
	assert.match(paperBlocked(make({ needs: { hunger: 90, energy: 5, hygiene: 90, fun: 90, social: 90 } }), WA, getPaper('phone')!)!, /太累/);
	assert.equal(doPaper(make({ pending: { eventId: 'x' } }), WA, 'phone').ok, false);
	assert.equal(doPaper(make(), WA, 'no-such').ok, false);
});

test('合并 main：银行户、TFN 看 main 的银行和税务——按钮直接在那边办，不另外记录', () => {
	// 开户：在哪都能办（手机核验），不要手机卡；办完是 main 银行的账户
	assert.equal(paperStatus(make(), 'bank'), 'todo');
	assert.equal(paperBlocked(make({ loc: 'rottnest', clock: at(23) }), WA, getPaper('bank')!), undefined);
	const b = applyAction(make(), WA, { t: 'paper', id: 'bank' });
	assert.ok(b.ok, b.msg);
	assert.equal(b.state.bank.open, true);
	assert.equal(b.state.papers.bank, undefined, '清单不另外记');
	assert.equal(paperStatus(b.state, 'bank'), 'done');
	assert.match(paperBlocked(b.state, WA, getPaper('bank')!)!, /已经办好/);
	const opened = make();
	opened.bank.open = true;
	assert.equal(paperStatus(opened, 'bank'), 'done', '在银行卡片开的户，清单上也算');
	// TFN：走 main 税务的申请，等的天数也按税务
	const s = make({ loc: 'rottnest', clock: at(23), tax: { ...make().tax, tfn: -1 } });
	assert.equal(paperStatus(s, 'tfn'), 'todo');
	const r = doPaper(s, WA, 'tfn');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.papers.tfn, undefined);
	assert.equal(paperStatus(r.state, 'tfn'), 'waiting');
	assert.match(paperBlocked(r.state, WA, getPaper('tfn')!)!, /TFN 在寄来的路上/);
	assert.equal(paperStatus({ ...r.state, clock: r.state.tax.tfn * 1440 }, 'tfn'), 'done');
});

test('合并 main：医保那一行看签证带的医保；没有的写明全额自付，不算进要办的项', () => {
	const bp = make({}, 'backpacker');
	const ids = papersFor(bp).map((p) => p.id);
	assert.ok(ids.includes('medicare'));
	assert.equal(paperStatus(bp, 'medicare'), 'na');
	assert.match(paperBlocked(bp, WA, getPaper('medicare')!)!, /全额自付/);
	assert.equal(doPaper(bp, WA, 'medicare').ok, false);
	assert.equal(paperProgress(bp).total, ids.length - 1, '「没有医保」不算要办的项');
});


test('地址：要先有住处；搬家后变成过期，更新后恢复；过期时换驾照办不了', () => {
	assert.match(paperBlocked(make(), WA, getPaper('address')!)!, /住处/);
	const home = { type: 'share', loc: WA.spawn, furniture: {} };
	const r = doPaper(make({ home }), WA, 'address');
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.papers.address.loc, WA.spawn);
	assert.equal(paperStatus(r.state, 'address'), 'done');
	const moved = { ...r.state, home: { ...home, loc: 'fremantle' } };
	assert.equal(paperStatus(moved, 'address'), 'stale');
	assert.match(paperBlocked(moved, WA, getPaper('licence-theory')!)!, /更新地址/);
	const again = doPaper(moved, WA, 'address');
	assert.ok(again.ok, again.msg);
	assert.equal(paperStatus(again.state, 'address'), 'done');
	// 退租没有住处时，登记过的地址仍算办好
	assert.equal(paperStatus({ ...r.state, home: null }, 'address'), 'done');
});

test('换驾照：理论要等几天才能路考；路考按驾驶检定，没过照收费、隔几天再考；过了涨驾驶', () => {
	const home = { type: 'share', loc: WA.spawn, furniture: {} };
	let s = make({ home, papers: { address: { at: 0, ready: 0, loc: WA.spawn } } });
	const th = doPaper(s, WA, 'licence-theory');
	assert.ok(th.ok, th.msg);
	assert.match(paperBlocked(th.state, WA, getPaper('licence')!)!, /要等/);
	const day = th.state.papers['licence-theory'].ready;
	s = { ...th.state, clock: at(10, day) };
	const road = getPaper('licence')!;
	// 驾驶 0：0 + 随机 0–60 达不到 60（只有随机正好取到 1 才行，不会发生）
	const bad = doPaper({ ...s, skills: { ...s.skills, driving: 0 } }, WA, 'licence');
	assert.ok(bad.ok, bad.msg);
	assert.equal(paperStatus(bad.state, 'licence'), 'retry');
	assert.equal(bad.state.cash, s.cash - road.fee, '没过也收考试费');
	assert.match(paperBlocked(bad.state, WA, road)!, /才能再考/);
	const retryDay = bad.state.papers.licence.ready;
	assert.equal(retryDay, day + road.test!.retryDays);
	assert.equal(paperBlocked({ ...bad.state, clock: at(10, retryDay) }, WA, road), undefined, '到日子可以再考');
	// 驾驶 60：一定能过
	const good = doPaper({ ...s, skills: { ...s.skills, driving: 60 } }, WA, 'licence');
	assert.ok(good.ok, good.msg);
	assert.equal(paperStatus(good.state, 'licence'), 'done');
	assert.ok(good.state.skills.driving > 60, '路考练车涨驾驶');
	assert.equal(good.state.papers.licence.fail, undefined);
});

test('途中晕倒：当没去，不收费、不记办事', () => {
	const s = make({ health: 0.5, needs: { hunger: 0, energy: 90, hygiene: 90, fun: 90, social: 90 } });
	const r = doPaper(s, WA, 'phone');
	assert.equal(r.collapsed, true);
	assert.equal(r.state.papers.phone, undefined);
	assert.ok(r.state.journal.some((j) => j.text.includes('不收费')));
});

test('门槛：重型卡车驾照要本地驾照；按揭买房不再由清单拦（main 的银行审批管）', () => {
	const rich = make({ cash: 200_000, clock: at(10) });
	assert.equal(paperGate(rich, { t: 'property', op: 'buy', id: flat.id, loan: true } as never), undefined);
	assert.ok(applyAction(rich, WA, { t: 'property', op: 'buy', id: flat.id, loan: false }).ok, '全款不用手续');
	assert.match(paperGate(rich, { t: 'cert', id: 'hr-licence' })!, /驾照/);
	assert.equal(paperGate({ ...rich, papers: done('licence') }, { t: 'cert', id: 'hr-licence' }), undefined);
	assert.equal(paperGate(rich, { t: 'cert', id: 'rsa' }), undefined, '其他证书不受影响');
	assert.equal(paperGate(rich, { t: 'property', op: 'sell', id: flat.id }), undefined);
	const r = applyAction(make({ clock: at(8) }), WA, { t: 'cert', id: 'hr-licence' });
	assert.equal(r.ok, false);
	assert.match(r.msg, /驾照/);
});


test('协议：paper 动作只认合法 id', () => {
	assert.deepEqual(parseAction({ t: 'paper', id: 'tfn' }), { t: 'paper', id: 'tfn' });
	assert.equal(parseAction({ t: 'paper', id: '<x>' }), null);
	assert.equal(parseAction({ t: 'paper' }), null);
});

test('存档校验：旧存档补 {}；去掉未知 id、坏数字、ready 早于 at、不认识的地点；幂等；新角色为空', () => {
	assert.deepEqual(createCharacter({ id: 'paper-new', name: 'a', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 1 }).papers, {});
	const old = make() as Partial<PlayerState>;
	delete old.papers;
	assert.deepEqual(sanitizeState(old)!.papers, {});
	const locs = new Set(WA.locations.map((l) => l.id));
	const dirty = {
		phone: { at: 1.7, ready: 2.2 },
		bank: { at: 5, ready: 3 },
		tfn: { at: 'x', ready: 1 },
		address: { at: 0, ready: 0, loc: 'atlantis' },
		licence: { at: 1, ready: 4, fail: true, extra: 1 },
		hack: { at: 0, ready: 0 },
		medicare: null,
		oshc: { at: -1, ready: 0 },
	};
	const clean = cleanPapers(dirty, locs);
	assert.deepEqual(clean, { phone: { at: 1, ready: 2 }, address: { at: 0, ready: 0 }, licence: { at: 1, ready: 4, fail: true } });
	assert.deepEqual(cleanPapers({ bank: { at: 0, ready: 0 }, tfn: { at: 0, ready: 3 }, oshc: { at: 0, ready: 0 } }, locs), {}, '合并 main 后银行户、TFN、医保不再由清单记录，旧存档里的丢掉');
	assert.deepEqual(cleanPapers(clean, locs), clean, '幂等');
	assert.deepEqual(cleanPapers([1, 2]), {});
	assert.deepEqual(cleanPapers('x'), {});
	assert.deepEqual(cleanPapers({ address: { at: 0, ready: 0, loc: WA.spawn } }, locs), { address: { at: 0, ready: 0, loc: WA.spawn } });
	const s = sanitizeState({ ...make(), papers: dirty }, locs)!;
	assert.deepEqual(s.papers, clean);
	assert.deepEqual(sanitizeState(s, locs)!.papers, clean);
});

test('新手清单：按顺序一路办下来（同一天能办的当天办完，TFN 按税务等几天）', () => {
	const home = { type: 'share', loc: WA.spawn, furniture: {} };
	let s = make({ home, cash: 5000, skills: { ...make().skills, driving: 80 } });
	for (let guard = 0; guard < 40; guard++) {
		const row = paperChecklist(s, WA).find((x) => !x.blocked);
		if (!row) {
			if (paperChecklist(s, WA).every((x) => x.status === 'done' || x.status === 'na')) break;
			s = { ...s, clock: at(10, Math.floor(s.clock / 1440) + 1), needs: { ...s.needs, energy: 90 } }; // 下一天
			continue;
		}
		const r = applyAction(s, WA, { t: 'paper', id: row.paper.id });
		assert.ok(r.ok, `${row.paper.id}: ${r.msg}`);
		s = { ...r.state, needs: { ...r.state.needs, energy: 90, hunger: 90 } };
	}
	const p = paperProgress(s);
	assert.equal(p.done, p.total, JSON.stringify(paperChecklist(s, WA).map((x) => [x.paper.id, x.status, x.blocked])));
});

test('复核：驾照暂停期间不能换驾照；清单抽屉记进使用统计；模拟器里清单开户归「房产」开关', () => {
	const s = make({ clock: at(10), papers: done('address') });
	assert.equal(paperBlocked(s, WA, getPaper('licence-theory')!), undefined);
	const banned = { ...s, law: { ...s.law, ban: s.clock + 5 * 1440 } };
	assert.match(paperBlocked(banned, WA, getPaper('licence-theory')!)!, /驾照暂停中/);
	assert.match(paperBlocked({ ...banned, papers: done('address', 'licence-theory') }, WA, getPaper('licence')!)!, /驾照暂停中/);
	assert.ok(STAT_EVENTS.drawer!.includes('papers'));
	assert.equal(systemOf({ t: 'paper', id: 'bank' }), 'property');
	assert.equal(systemOf({ t: 'paper', id: 'phone' }), undefined);
});

test('复核：链接到 main 的行，文案不再说开户要手机卡、贷款要 TFN', () => {
	assert.equal(getPaper('phone')!.unlocks.now.join(''), '');
	assert.ok(!getPaper('bank')!.docs.some((d) => d.includes('手机')));
	assert.ok(!getPaper('tfn')!.unlocks.now.join('').includes('贷款'));
	for (const p of PAPERS.filter((x) => x.linked)) assert.equal(p.needs.length, 0, p.id);
});

