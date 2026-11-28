import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { applyJob, homesAt, quitJob, rentHome, sleepHome, workShift } from '../../src/game/core/engine.ts';
import { takeTrip } from '../../src/game/core/trips.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const at = (hour: number, day = 0) => day * 1440 + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'camp-test', name: '测', avatar: '🧑', origin: 'fifo', region: 'wa', spawn: 'kalgoorlie', seed: 17 }),
	clock: at(6),
	loc: 'kalgoorlie',
	...over,
});

test('公司营地只给本地在职矿工，免费且没有租约', () => {
	const ready = make({ skills: { ...make().skills, strength: 25 } });
	assert.match(homesAt(ready, WA).find((x) => x.home.id === 'mine-camp')!.blocked ?? '', /在这里上班的矿业公司员工/);
	const hired = applyJob(ready, WA, 'miner');
	assert.ok(hired.ok, hired.msg);
	const offer = homesAt(hired.state, WA).find((x) => x.home.id === 'mine-camp')!;
	assert.equal(offer.blocked, undefined);
	const cash = hired.state.cash;
	const camped = rentHome(hired.state, WA, 'mine-camp');
	assert.ok(camped.ok, camped.msg);
	assert.equal(camped.state.cash, cash);
	assert.equal(camped.state.rental.lease, null);
	assert.equal(sanitizeState(camped.state)!.home?.type, 'mine-camp', '沿用现有 home 形状，不需要新存档字段');
});

test('矿工上完班才得到公司餐，辞职立即退回床位', () => {
	let s = make({ skills: { ...make().skills, strength: 25 } });
	s = applyJob(s, WA, 'miner').state;
	s = rentHome(s, WA, 'mine-camp').state;
	s = { ...s, needs: { hunger: 20, energy: 100, hygiene: 100, fun: 100, social: 100 } };
	const worked = workShift(s, WA);
	assert.ok(worked.ok, worked.msg);
	assert.ok(worked.state.needs.hunger > s.needs.hunger, '实际完成班次后才补公司餐');
	assert.ok(worked.state.needs.hygiene >= 60, '矿区洗浴减少清洁损耗');
	const left = quitJob(worked.state);
	assert.ok(left.ok, left.msg);
	assert.equal(left.state.home, null);
	assert.match(left.msg, /公司床位已退回/);
});

test('坏存档里的无资格营地不能睡', () => {
	const forged = make({ home: { type: 'mine-camp', loc: 'kalgoorlie', furniture: {} } });
	const slept = sleepHome(forged, WA);
	assert.equal(slept.ok, false);
	assert.match(slept.msg, /本地上班的矿业公司员工/);
});

test('长假丢工作时也立即退回公司床位', () => {
	let s = make({ skills: { ...make().skills, strength: 25 } });
	s = applyJob(s, WA, 'miner').state;
	s = rentHome(s, WA, 'mine-camp').state;
	s = { ...s, loc: 'perth', cash: 100_000 };
	const r = takeTrip(s, WA, 'home-cn', 14);
	assert.ok(r.ok, r.msg);
	assert.equal(r.state.job, null);
	assert.equal(r.state.home, null);
	assert.match(r.msg, /公司床位已退回/);
});
