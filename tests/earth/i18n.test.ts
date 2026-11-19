// 多语言（第 38 批）：字符串表键名一致、漏翻、占位符一致、回退规则、界面引用的键都存在、HTML 插值经过 esc、格式化
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { COMPLETE_LOCALES, DEFAULT_LOCALE, fill, isLocale, LOCALE_ORDER, LOCALES, lookup, placeholders, t, TABLES, type Locale, type StrKey } from '../../src/game/i18n/index.ts';
import { fmtGameClock, fmtMoney, fmtNumber, fmtRealDateTime } from '../../src/game/i18n/format.ts';
import { formatClock } from '../../src/game/core/character.ts';
import { DEFAULT_PREFS, parsePrefs } from '../../src/game/ui/prefs.ts';

const BASE = TABLES[DEFAULT_LOCALE] as Record<StrKey, string>;
const BASE_KEYS = Object.keys(BASE) as StrKey[];
const ALL = Object.keys(TABLES) as Locale[];
const CJK = /[㐀-鿿豈-﫿]/;
// 繁体表里不该出现的常见简体字（简繁不同形的高频字）。命中就是漏转或复制粘贴了简体
const SIMPLIFIED_ONLY = '这个们说时设发区开关对会动图页显备级声长资况务录际级实图块载里没还译暂随认铺读写钱买卖车门问题让认边过达远运进选适';

const srcFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? srcFiles(p) : /\.(ts|astro)$/.test(f) ? [p] : [];
	});
const PAGE = readFileSync('src/pages/earth.astro', 'utf8');

test('语言清单：每门语言都有表、有自称、有回退链，回退链不指向自己且最后能落到简体中文', () => {
	assert.deepEqual([...LOCALE_ORDER].sort(), [...ALL].sort(), '设置页列出的语言和字符串表一致');
	for (const l of ALL) {
		assert.ok(isLocale(l));
		assert.ok(LOCALES[l].label.trim(), `${l} 没有名字`);
		assert.ok(!LOCALES[l].fallback.includes(l), `${l} 回退到自己`);
		if (l !== DEFAULT_LOCALE) assert.equal(LOCALES[l].fallback.at(-1), DEFAULT_LOCALE, `${l} 回退链最后不是简体中文`);
	}
	for (const bad of ['', 'zh', 'EN', 'fr', '__proto__', 'toString', null, 1]) assert.equal(isLocale(bad), false, String(bad));
});

test('键名一致：其他语言不能有基准表里没有的键（拼错的键、删掉没清的键）', () => {
	for (const l of ALL) {
		const extra = Object.keys(TABLES[l]).filter((k) => !Object.hasOwn(BASE, k));
		assert.deepEqual(extra, [], `${l} 多出的键`);
	}
	for (const k of BASE_KEYS) assert.match(k, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `键名格式 ${k}`);
});

test('漏翻：标记为完整的语言每个键都有、不为空；英文里不能有汉字；繁体里不能有简体字', () => {
	for (const l of COMPLETE_LOCALES) {
		const tb = TABLES[l];
		const missing = BASE_KEYS.filter((k) => typeof tb[k] !== 'string' || !tb[k]!.trim());
		assert.deepEqual(missing, [], `${l} 漏翻的键`);
	}
	for (const [k, v] of Object.entries(TABLES.en)) assert.ok(!CJK.test(v!), `en 的 ${k} 还是中文：${v}`);
	for (const [k, v] of Object.entries(TABLES['zh-Hant'])) {
		const hit = [...v!].filter((c) => SIMPLIFIED_ONLY.includes(c));
		assert.deepEqual(hit, [], `zh-Hant 的 ${k} 有简体字：${v}`);
	}
});

test('占位符一致：每门语言同一个键的 {占位符} 和简体中文完全一样', () => {
	for (const l of ALL) {
		for (const [k, v] of Object.entries(TABLES[l])) {
			assert.deepEqual(placeholders(v!), placeholders(BASE[k as StrKey]), `${l} 的 ${k}`);
		}
	}
});

test('回退：缺键时按回退链找到简体中文；占位符漏传时保留原样；参数不会被当成占位符再展开', () => {
	const en = TABLES.en as Record<string, string>;
	const saved = en['tab.me'];
	delete en['tab.me'];
	try {
		assert.equal(lookup('en', 'tab.me'), BASE['tab.me']);
		assert.equal(t('en', 'tab.me'), '我');
	} finally {
		en['tab.me'] = saved;
	}
	assert.equal(t('en', 'tab.me'), 'Me');
	assert.equal(t('en', 'nope.key' as StrKey), 'nope.key', '运行时拼错的键显示键名，不是空白');
	assert.equal(t('en', 'tab.social.online', { n: 3 }), 'Players online here: 3');
	assert.equal(t('zh-Hans', 'tab.social.online'), '这里有 {n} 位玩家在线', '漏传参数看得出来');
	assert.equal(fill('{a}{b}', { a: '{b}', b: 'x' }), '{b}x', '参数值里的花括号不再展开');
	assert.equal(fill('{constructor}', {}), '{constructor}', '原型链上的名字不算参数');
});

test('界面引用的键都存在，基准表里的键都有人用', () => {
	const files = srcFiles('src').filter((f) => !f.includes(join('i18n', 'strings')));
	const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
	const keyLike = new RegExp(`'((?:${[...new Set(BASE_KEYS.map((k) => k.split('.')[0]))].join('|')})\\.[a-z0-9.-]+)'`, 'g');
	const used = new Set([...code.matchAll(keyLike)].map((m) => m[1]));
	const unknown = [...used].filter((k) => !Object.hasOwn(BASE, k));
	assert.deepEqual(unknown, [], '代码里引用了不存在的键');
	const unused = BASE_KEYS.filter((k) => !used.has(k));
	assert.deepEqual(unused, [], '字符串表里没人用的键');
	for (const m of PAGE.matchAll(/\btx\(\s*([^'\s)][^,)]*)/g)) {
		// 用变量传键时，变量必须来自带 StrKey 类型的表（TABS / ME_TABS / *_OPTIONS），类型由 tsc 保证；新的变量名要在这里登记
		assert.match(m[1], /^(label|name|tabKey|v \?)/, `tx() 的参数来源不明：${m[1]}`);
	}
});

test('HTML 插值：earth.astro 只通过 tx()（带 esc）取文案，不直接拼 t() 的结果', () => {
	assert.match(PAGE, /const tx = \(key: StrKey, params\?: Params\) => esc\(t\(prefs\.lang, key, params\)\);/, 'tx 必须包 esc');
	const raw = [...PAGE.matchAll(/(?<![.\w])t\(\s*prefs\.lang/g)].length;
	assert.equal(raw, 1, '除了 tx 的定义，不能在别处直接调 t(prefs.lang, …)');
	assert.ok(!/\$\{\s*t\(/.test(PAGE), '模板里不能直接 ${t(…)}');
	assert.ok(!/\$\{\s*LOCALES\[[^\]]+\]\.label\s*\}/.test(PAGE), '语言名也要经过 esc');
});

test('设置里的语言：存在本机设置里，坏值退回简体中文，原型链上的值不认', () => {
	assert.equal(DEFAULT_PREFS.lang, 'zh-Hans');
	assert.equal(parsePrefs(null).lang, 'zh-Hans');
	for (const l of ALL) assert.equal(parsePrefs(JSON.stringify({ lang: l })).lang, l);
	for (const bad of ['fr', 'zh', '', 1, null, ['en'], { en: 1 }, 'toString']) assert.equal(parsePrefs(JSON.stringify({ lang: bad })).lang, 'zh-Hans', JSON.stringify(bad));
	assert.equal(parsePrefs('{"__proto__":{"lang":"en"}}').lang, 'zh-Hans');
});

test('金额和数字：各语言都写 $，千位分隔，负数用减号', () => {
	for (const l of ALL) {
		assert.equal(fmtMoney(1234, l), '$1,234', l);
		assert.equal(fmtMoney(-12.4, l), '−$12', l);
		assert.equal(fmtMoney(-0.2, l), '$0', `${l} 四舍五入成 0 不带负号`);
		assert.equal(fmtMoney(1e6, l), '$1,000,000', l);
	}
	assert.equal(fmtNumber(1234.56, 'en', 1), '1,234.6');
	assert.equal(fmtNumber(0.5, 'zh-Hans', 1), '0.5');
});

test('游戏内时间：简体中文和 core 的 formatClock 一字不差；英文是 Day N HH:MM', () => {
	for (const c of [0, 59, 61, 1439, 1440, 1440 * 6 + 600, 1440 * 99 + 1439]) {
		assert.equal(fmtGameClock(c, 'zh-Hans'), formatClock(c), String(c));
	}
	assert.equal(fmtGameClock(1440 + 8 * 60 + 5, 'en'), 'Day 2 08:05');
	assert.equal(fmtGameClock(0, 'zh-Hant'), '第1天 00:00');
});

test('现实时间按区域时区：珀斯全年 +8；阿德莱德夏令时 +10:30、冬天 +9:30', () => {
	const jan = Date.UTC(2026, 0, 15, 0, 0);
	const jul = Date.UTC(2026, 6, 15, 0, 0);
	assert.match(fmtRealDateTime(jan, 'en', 'wa'), /08:00/);
	assert.match(fmtRealDateTime(jul, 'en', 'wa'), /08:00/);
	assert.match(fmtRealDateTime(jan, 'en', 'sa'), /10:30/);
	assert.match(fmtRealDateTime(jul, 'en', 'sa'), /09:30/);
	assert.match(fmtRealDateTime(jan, 'en', 'nowhere'), /08:00/, '不认识的区域按珀斯');
	assert.match(fmtRealDateTime(jan, 'en', '__proto__'), /08:00/);
	assert.match(fmtRealDateTime(jan, 'zh-Hans', 'wa'), /2026/);
});
