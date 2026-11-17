// 职业证书：数据自洽、在哪考、考完加薪（游戏内上班和真实打卡都算）、存档校验
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyJob, careerPay, certsAt, takeCert, workShift } from '../../src/game/core/engine.ts';
import { workTerms } from '../../src/game/core/venues.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { CERTS } from '../../src/game/data/certs.ts';
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
	for (const k of CAREERS) assert.ok(CERTS.some((c) => c.career === k.id), `${k.id} 有对应证书`);
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
	assert.equal(careerPay(base, 'bartender', 0), 140);
	assert.equal(careerPay(withCert, 'bartender', 0), Math.round(140 * 1.15));
	assert.equal(careerPay(withCert, 'barista', 0), 120, '别的职业不加');
	const a = workShift({ ...base, clock: at(18) }, WA);
	const b = workShift({ ...withCert, clock: at(18) }, WA);
	assert.ok(a.ok && b.ok);
	assert.ok(b.state.cash - withCert.cash > a.state.cash - base.cash, '持证这班赚得多');
	const pub = VENUE_TYPES.find((t) => t.id === 'pub')!;
	const venue = { id: 'v-test', name: '测试酒吧', type: 'pub', lat: -32.05, lon: 115.75, loc: 'fremantle' } as never;
	assert.ok(workTerms(withCert, pub, venue)!.hourly > workTerms(base, pub, venue)!.hourly);
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
