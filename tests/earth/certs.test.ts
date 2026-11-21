// 职业证书：数据自洽、在哪考、考完加薪（游戏内上班和真实打卡都算）、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyEffect, applyJob, careerPay, certsAt, takeCert, workShift } from '../../src/game/core/engine.ts';
import { workTerms } from '../../src/game/core/venues.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { CERTS } from '../../src/game/data/certs.ts';
import { AWARDS } from '../../src/game/data/education.ts';
import { VENUE_TYPES } from '../../src/game/data/venues.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'cert-player', name: '证', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 7 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 90, social: 90 },
	...over,
});

test('证书数据：id 唯一、对应真实职业、至少一个地点能考、价格和加薪为正', () => {
	assert.equal(new Set(CERTS.map((c) => c.id)).size, CERTS.length);
	for (const c of CERTS) {
		assert.ok(CAREERS.some((k) => k.id === c.career), c.id);
		assert.ok(c.price > 0 && c.minutes > 0 && c.payBonus > 0 && c.payBonus < 1, c.id);
		assert.ok(WA.locations.some((l) => c.where.kinds?.includes(l.kind) || c.where.tags?.some((t) => l.tags.includes(t))), `${c.id} 有地方考`);
	}
	// 每份职业要么有加薪证书，要么入行要学历（第 33 批的 IT 公司靠学历课程入行，没有单独的加薪证）
	for (const k of CAREERS) assert.ok(CERTS.some((c) => c.career === k.id) || k.levels[0].req?.certs?.some((id) => AWARDS.includes(id)), `${k.id} 有对应证书或学历门槛`);
});

test('考证：时段、钱、只考一次、有待处理事件不行；考完扣钱、花时间、记下证书', () => {
	const s = make({ loc: 'fremantle', clock: at(10), cash: 500 });
	assert.ok(certsAt(s, WA).some((o) => o.cert.id === 'rsa' && !o.blocked));
	assert.match(certsAt({ ...s, clock: at(20) }, WA).find((o) => o.cert.id === 'rsa')!.blocked!, /上课时间/);
	assert.match(certsAt({ ...s, cash: 50 }, WA).find((o) => o.cert.id === 'rsa')!.blocked!, /需要 \$120/);
	assert.equal(takeCert({ ...s, pending: { eventId: 'quokka-selfie' } }, WA, 'rsa').ok, false);
	assert.equal(takeCert(s, WA, 'hr-licence').ok, false, '弗里曼特尔考不了重型卡车驾照');
	const r = takeCert(s, WA, 'rsa');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s.certs, [], '不改入参');
	assert.deepEqual(r.state.certs, ['rsa']);
	assert.equal(r.state.cash, 500 - 120);
	assert.equal(r.state.clock, s.clock + 240);
	assert.match(certsAt({ ...r.state, clock: at(10, 1) }, WA).find((o) => o.cert.id === 'rsa')!.blocked!, /已经有/);
});

test('持证上班：游戏内每班和真实打卡的时薪都按证书加薪', () => {
	const base = applyJob(make({ loc: 'fremantle', clock: at(10) }), WA, 'bartender').state;
	const withCert = { ...base, certs: ['rsa'] };
	// 起薪从数据里读（平衡分析第九轮改过数值，测试只管加薪规则）
	const pay0 = CAREERS.find((c) => c.id === 'bartender')!.levels[0].pay;
	assert.equal(careerPay(base, 'bartender', 0), pay0);
	assert.equal(careerPay(withCert, 'bartender', 0), Math.round(pay0 * 1.15));
	assert.equal(careerPay(withCert, 'barista', 0), 120, '别的职业不加');
	const a = workShift({ ...base, clock: at(18) }, WA);
	const b = workShift({ ...withCert, clock: at(18) }, WA);
	assert.ok(a.ok && b.ok);
	assert.ok(b.state.cash - withCert.cash > a.state.cash - base.cash, '持证这班赚得多');
	const pub = VENUE_TYPES.find((t) => t.id === 'pub')!;
	const venue = { id: 'v-test', name: '测试酒吧', type: 'pub', lat: -32.05, lon: 115.75, loc: 'fremantle' } as never;
	assert.ok(workTerms(withCert, pub, venue)!.hourly > workTerms(base, pub, venue)!.hourly);
});

test('真实打卡：每种职业、每类能打卡的地点、每个等级，持证时薪都正好 +对应比例（复审问题 1）', () => {
	for (const c of CAREERS) for (const vt of c.venues ?? []) for (let level = 0; level < c.levels.length; level++) {
		const type = VENUE_TYPES.find((t) => t.id === vt)!;
		const loc = WA.locations.find((l) => c.where.kinds?.includes(l.kind) || c.where.tags?.some((t) => l.tags.includes(t)))!.id;
		const s = make({ loc, job: { career: c.id, loc, level, shifts: 0, good: 0, lastDay: -1 } });
		const cert = CERTS.find((x) => x.career === c.id)!;
		const venue = { id: 'v-test', name: '测试', type: vt, lat: 0, lon: 0, loc } as never;
		const plain = workTerms(s, type, venue)!.hourly;
		const certified = workTerms({ ...s, certs: [cert.id] }, type, venue)!.hourly;
		assert.ok(Math.abs(certified / plain - (1 + cert.payBonus)) < 0.01, `${c.id}@${vt} 等级 ${level}：${plain} -> ${certified}`);
	}
});

test('考证途中晕倒：按没报名结算——不发证、不收学费，住院费和周结算都按原有的钱算（复审问题 3、二次复审问题 2）', () => {
	const weak = make({ loc: 'fremantle', clock: at(10), cash: 500, health: 1, needs: { hunger: 0, energy: 30, hygiene: 50, fun: 50, social: 50 } });
	const r = takeCert(weak, WA, 'rsa');
	assert.ok(r.collapsed);
	assert.deepEqual(r.state.certs, []);
	assert.ok(r.state.journal.some((j) => /不收学费/.test(j.text)));
	const control = structuredClone(weak);
	assert.ok(applyEffect(control, { minutes: 240, needs: { energy: -24, fun: -5 } }, WA));
	assert.equal(r.state.cash, control.cash, '和没报名、同样晕倒的结果一样');
	// 二次复审的复现：现金少、有车、途中跨周结算——不能拿学费当「保险箱」少付住院费、躲过保险
	const broke = make({ loc: 'fremantle', clock: at(10, 6), nextWeek: 6, cash: 200, health: 1, needs: { hunger: 0, energy: 30, hygiene: 50, fun: 50, social: 50 } });
	const r2 = takeCert(broke, WA, 'rsa');
	assert.ok(r2.collapsed);
	const c2 = structuredClone(broke);
	assert.ok(applyEffect(c2, { minutes: 240, needs: { energy: -24, fun: -5 } }, WA));
	assert.equal(r2.state.cash, c2.cash);
	assert.equal(r2.state.heat, c2.heat, '保险照常结算');
	assert.equal(r2.state.nextWeek, c2.nextWeek);
});

test('考证途中跨周结算、交完房租钱不够交学费：按先交学费再上课重算，付不起的房租照常收房', () => {
	// 合租 $160/周，手上 $250：先交房租剩 $90，不够 $120 学费
	const s = make({ loc: 'fremantle', clock: at(14, 6), nextWeek: 6, cash: 250, vehicle: 'none', home: { type: 'room', loc: 'fremantle', furniture: {} } });
	const r = takeCert(s, WA, 'rsa');
	assert.ok(r.ok && !r.collapsed, r.msg);
	assert.deepEqual(r.state.certs, ['rsa']);
	assert.equal(r.state.home, null, '先交了学费，剩 $130 付不起房租');
	assert.equal(r.state.cash, 130);
});

test('证书走动作协议，存档校验去掉不认识的证书', () => {
	assert.deepEqual(parseAction({ t: 'cert', id: 'rsa' }), { t: 'cert', id: 'rsa' });
	assert.equal(parseAction({ t: 'cert', id: 'RSA!' }), null);
	const r = applyAction(make({ loc: 'fremantle', clock: at(10), cash: 500 }), WA, { t: 'cert', id: 'rsa' });
	assert.ok(r.ok && r.state.rev === 1);
	const locs = new Set(WA.locations.map((l) => l.id));
	const s = sanitizeState({ ...make(), certs: ['rsa', 'rsa', 'fake', 3] }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.deepEqual(s.certs, ['rsa']);
	const old: Record<string, unknown> = { ...make() };
	delete old.certs;
	assert.deepEqual(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.certs, []);
});
