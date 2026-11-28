import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lowCashConfirm } from '../../src/game/ui/cash-confirm.ts';

test('只有付款后低于 $200 才确认，并写明扣款、余额和下周房租', () => {
	assert.equal(lowCashConfirm({ label: '签租约', cash: 560, cost: 360, rent: 120 }), undefined, '刚好 $200 不弹');
	assert.equal(lowCashConfirm({ label: '签租约', cash: 540, cost: 360, rent: 120 }), '签租约要扣 $360；操作后现金剩 $180，低于应急线 $200。下周房租 $120。仍要继续吗？');
	assert.equal(lowCashConfirm({ label: '申请签证', cash: 1000, cost: 1100, rent: 0 }), undefined, '花不起的动作由原规则拒绝，不弹负余额文案');
	assert.equal(lowCashConfirm({ label: '买食材', cash: 190, cost: 10, rent: 0 }), '买食材要扣 $10；操作后现金剩 $180，低于应急线 $200。下周房租 $0。仍要继续吗？');
});

test('免费、退款、坏数值不确认；输入不被修改', () => {
	const x = { label: '测试', cash: 100, cost: 0, rent: -2 };
	const before = JSON.stringify(x);
	assert.equal(lowCashConfirm(x), undefined);
	assert.equal(lowCashConfirm({ ...x, cost: -10 }), undefined);
	assert.equal(lowCashConfirm({ ...x, cost: Number.NaN }), undefined);
	assert.equal(lowCashConfirm({ ...x, cash: Number.NaN, cost: 10 }), undefined);
	assert.equal(JSON.stringify(x), before);
});
