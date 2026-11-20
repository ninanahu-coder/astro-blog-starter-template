// 第 25 批：经济设计（职业成长曲线、零工 = 临时工、每周收支估算）。设计见 docs/earth-game/economy-design.md
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import { careerCurve, casualPay, ECON, GIG_CAREER, levelHourly, weeklyBudget } from '../../src/game/core/economy.ts';
import { ACTIVITIES } from '../../src/game/data/activities.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { PROPERTIES } from '../../src/game/data/properties.ts';
import { VEHICLES } from '../../src/game/data/vehicles.ts';
import { FINANCE, loanPayment } from '../../src/game/core/finance.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { PlayerState } from '../../src/game/core/types.ts';

const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'econ-curve', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 25 }),
	...over,
});

test('每个职业的每个等级，时薪都不低于游戏最低时薪', () => {
	for (const c of CAREERS) {
		c.levels.forEach((lv, i) => {
			assert.ok(levelHourly(c, i) >= ECON.minHourly, `${c.id} ${lv.title}：$${lv.pay} / ${c.minutes / 60} 小时 = $${levelHourly(c, i).toFixed(2)}，低于 $${ECON.minHourly}`);
		});
	}
});

test('职业成长曲线：工资逐级上涨，最高级是入门的 1.5–2.5 倍', () => {
	for (const c of CAREERS) {
		const curve = careerCurve(c);
		assert.equal(curve[0].vsEntry, 1);
		for (let i = 1; i < curve.length; i++) assert.ok(curve[i].pay > curve[i - 1].pay, `${c.id} 第 ${i + 1} 级工资要高于上一级`);
		const top = curve[curve.length - 1].vsEntry;
		assert.ok(top >= 1.5 && top <= 2.5, `${c.id} 最高级是入门的 ${top} 倍`);
	}
});

test('careerCurve 的数字按班长折算', () => {
	const barista = CAREERS.find((c) => c.id === 'barista')!;
	const curve = careerCurve(barista);
	assert.deepEqual(curve.map((x) => x.hourly), barista.levels.map((lv) => Math.round((lv.pay / 6) * 10) / 10));
	assert.equal(curve[2].vsEntry, Math.round((barista.levels[2].pay / barista.levels[0].pay) * 100) / 100);
});

test('零工按对口职业入门时薪 × 临时工加给定价', () => {
	assert.equal(casualPay('nope', 60), null);
	for (const [gigId, careerId] of Object.entries(GIG_CAREER)) {
		const gig = ACTIVITIES.find((a) => a.id === gigId);
		assert.ok(gig, `${gigId} 存在`);
		const c = CAREERS.find((x) => x.id === careerId)!;
		const expect = Math.round((c.levels[0].pay / (c.minutes / 60)) * (1 + ECON.casualLoading) * (gig.minutes / 60));
		assert.equal(casualPay(careerId, gig.minutes), expect);
		assert.equal(gig.fx.cash, expect, `${gigId} 的工资应为 $${expect}`);
	}
});

test('零工时薪高于对口职业入门、低于对口职业最高级：升职才有奔头', () => {
	for (const [gigId, careerId] of Object.entries(GIG_CAREER)) {
		const gig = ACTIVITIES.find((a) => a.id === gigId)!;
		const c = CAREERS.find((x) => x.id === careerId)!;
		const hourly = gig.fx.cash! / (gig.minutes / 60);
		assert.ok(hourly > levelHourly(c, 0), `${gigId} 时薪 $${hourly} 应高于 ${c.id} 入门`);
		assert.ok(hourly < levelHourly(c, c.levels.length - 1), `${gigId} 时薪 $${hourly} 应低于 ${c.id} 最高级 $${levelHourly(c, c.levels.length - 1)}`);
	}
});

test('每周收支估算：没工作没房没车为 0', () => {
	assert.deepEqual(weeklyBudget(make()), { wages: 0, rentIncome: 0, income: 0, costs: 0, net: 0 });
});

test('每周收支估算：工资 × 每周班数，减去房租、车、房贷', () => {
	const barista = CAREERS.find((c) => c.id === 'barista')!;
	const room = HOMES.find((h) => h.id === 'room')!;
	const car = VEHICLES.find((v) => v.id === 'car')!;
	const flat = PROPERTIES.find((p) => p.id === 'kal-cottage')!;
	const loan = 40000;
	const s = make({
		job: { career: 'barista', loc: 'perth', level: 1, shifts: 0, good: 0, lastDay: -1 },
		home: { type: 'room', loc: 'perth', furniture: {} },
		vehicle: 'car',
		properties: [{ id: flat.id, loan, rented: true, missed: 0 }],
	});
	const b = weeklyBudget(s);
	assert.equal(b.wages, barista.levels[1].pay * ECON.shiftsPerWeek);
	assert.equal(b.rentIncome, Math.round(flat.rentIncome * (1 - FINANCE.vacancy)));
	assert.equal(b.costs, room.rentWeek + car.weekly + flat.weekly + loanPayment(flat, loan));
	assert.equal(b.net, b.wages + b.rentIncome - b.costs);
});

test('每周收支估算：证书加薪算进工资；没出租的房不算租金', () => {
	const bar = CAREERS.find((c) => c.id === 'bartender')!;
	const flat = PROPERTIES.find((p) => p.id === 'kal-cottage')!;
	const s = make({ job: { career: 'bartender', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 }, certs: ['rsa'], properties: [{ id: flat.id, loan: 0, rented: false, missed: 0 }] });
	const b = weeklyBudget(s);
	assert.equal(b.wages, Math.round(bar.levels[0].pay * 1.15) * ECON.shiftsPerWeek);
	assert.equal(b.rentIncome, 0);
	assert.equal(b.costs, flat.weekly);
});

test('weeklyBudget 不修改入参', () => {
	const s = make({ job: { career: 'barista', loc: 'perth', level: 0, shifts: 0, good: 0, lastDay: -1 } });
	const before = JSON.stringify(s);
	weeklyBudget(s);
	assert.equal(JSON.stringify(s), before);
});
