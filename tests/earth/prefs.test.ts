// 本机显示设置（第 28 轮）：读入当不可信数据清洗；旧版大字模式迁移；动画跟随系统
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calmMotion, DEFAULT_PREFS, parsePrefs } from '../../src/game/ui/prefs.ts';

test('没有设置时用默认值（音效默认关）；旧版大字模式开着的迁移成字号「大」', () => {
	assert.equal(DEFAULT_PREFS.sound, false, '音效默认关');
	assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
	assert.equal(parsePrefs(null, { big: '1' }).font, 'l');
	assert.equal(parsePrefs(null, { big: '0' }).font, 'm');
	assert.equal(parsePrefs(JSON.stringify({ font: 'm' }), { big: '1' }).font, 'm', '已经有新设置时不再看旧键');
});

test('合法设置原样读回', () => {
	const p = { motion: 'reduce', font: 'xl', guide: false, recap: false, achToast: false, sound: true, basemap: false } as const;
	assert.deepEqual(parsePrefs(JSON.stringify(p)), p);
});

test('坏数据退回默认：不是 JSON、数组、未知取值、类型不对、原型链上的字段', () => {
	for (const raw of ['{', '[]', '"x"', '42', 'null', JSON.stringify({ motion: 'fast', font: 'huge', guide: 'yes', recap: 1, achToast: null })]) {
		assert.deepEqual(parsePrefs(raw), DEFAULT_PREFS, raw);
	}
	const proto = parsePrefs('{"__proto__":{"font":"xl","guide":false}}');
	assert.deepEqual(proto, DEFAULT_PREFS, '原型链');
	assert.equal(Object.getPrototypeOf(proto), Object.prototype);
});

test('减少动画：选「减少」总是减少，选「正常」总是不减少，「跟随系统」看系统设置', () => {
	const p = (motion: 'auto' | 'reduce' | 'full') => ({ ...DEFAULT_PREFS, motion });
	assert.equal(calmMotion(p('reduce'), false), true);
	assert.equal(calmMotion(p('full'), true), false);
	assert.equal(calmMotion(p('auto'), true), true);
	assert.equal(calmMotion(p('auto'), false), false);
});
