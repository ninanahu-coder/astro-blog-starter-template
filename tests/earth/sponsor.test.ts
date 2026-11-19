// 本地商户赞助（第一版只做数据和展示）：校验规则、按珀斯日期生效、HTML 转义、不碰游戏数值。
// 店铺和赞助条目都是虚构的，不代表任何真实商户。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activeSponsors, dealDay, validateSponsors } from '../../src/game/core/sponsor.ts';
import { SPONSORS, SPONSOR_LABEL, type SponsorDeal } from '../../src/game/data/sponsors.ts';
import { sponsorOfferHtml, sponsorTagHtml } from '../../src/game/ui/sponsor.ts';
import { WA } from '../../src/game/data/wa.ts';
import type { Venue } from '../../src/game/core/types.ts';

const V = (id: string, type: string, source = 'osm'): Venue => ({ id, loc: 'perth', name: id, lat: -31.95, lon: 115.86, type, source });
const VENUES: Venue[] = [V('t-cafe', 'cafe'), V('t-gym', 'gym'), V('t-pub', 'pub'), V('t-clinic', 'clinic'), V('t-seed', 'cafe', 'seed')];
const deal = (over: Partial<SponsorDeal> = {}): SponsorDeal => ({
	id: 'sp-t-cafe-202612', venueId: 't-cafe', offer: '出示本页咖啡减 1 澳元', terms: '每人每天一次', start: '2026-12-01', end: '2026-12-31', agreement: 'TEST-001', ...over,
});
/** 珀斯（UTC+8）某日某时的现实时间 */
const perth = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h - 8, min);

test('正式数据：目前没有签约的赞助，列表为空且能通过校验', () => {
	assert.equal(SPONSORS.length, 0);
	assert.deepEqual(validateSponsors(SPONSORS, WA.venues), []);
});

test('合格的条目通过校验', () => {
	assert.deepEqual(validateSponsors([deal()], VENUES), []);
});

test('校验能拦下各种问题', () => {
	const cases: [Partial<SponsorDeal>, RegExp][] = [
		[{ venueId: 'nope' }, /找不到店铺/],
		[{ venueId: 't-seed' }, /OSM/],
		[{ venueId: 't-pub' }, /不接受赞助/],
		[{ venueId: 't-clinic' }, /不接受赞助/],
		[{ offer: '' }, /缺优惠/],
		[{ offer: '好'.repeat(41) }, /超过 40 字/],
		[{ terms: '' }, /缺使用条件/],
		[{ offer: '详情见 www.example.com' }, /网址/],
		[{ terms: '联系 shop@example' }, /网址/],
		[{ agreement: ' ' }, /协议编号/],
		[{ start: '2026-02-30' }, /日期格式/],
		[{ end: '2026/12/31' }, /日期格式/],
		[{ start: '2026-12-31', end: '2026-12-01' }, /早于/],
		[{ start: '2026-01-01', end: '2026-04-03' }, /最长 92 天/],
		[{ id: 'Bad ID' }, /编号只能/],
	];
	for (const [over, re] of cases) {
		const errs = validateSponsors([deal(over)], VENUES);
		assert.ok(errs.some((e) => re.test(e)), `${JSON.stringify(over)} → ${errs.join('；')}`);
	}
	// 92 天整还可以
	assert.deepEqual(validateSponsors([deal({ start: '2026-01-01', end: '2026-04-02' })], VENUES), []);
});

test('同一家店时间重叠、编号重复都会报错；不重叠的两期可以并存', () => {
	const a = deal();
	assert.ok(validateSponsors([a, deal({ id: 'sp-b', start: '2026-12-31', end: '2027-01-10' })], VENUES).some((e) => /重叠/.test(e)));
	assert.ok(validateSponsors([a, deal({ start: '2027-01-01', end: '2027-01-10' })], VENUES).some((e) => /编号重复/.test(e)));
	assert.deepEqual(validateSponsors([a, deal({ id: 'sp-b', start: '2027-01-01', end: '2027-01-10' })], VENUES), []);
	assert.deepEqual(validateSponsors([a, deal({ id: 'sp-gym', venueId: 't-gym' })], VENUES), []);
});

test('按珀斯日期生效，起止两天都算', () => {
	const d = deal();
	assert.equal(activeSponsors([d], perth(2026, 11, 30, 23, 59)).size, 0);
	assert.equal(activeSponsors([d], perth(2026, 12, 1, 0, 0)).get('t-cafe'), d);
	assert.equal(activeSponsors([d], perth(2026, 12, 31, 23, 59)).get('t-cafe'), d);
	assert.equal(activeSponsors([d], perth(2027, 1, 1, 0, 0)).size, 0);
	// 坏日期的条目直接忽略，不会报错
	assert.equal(activeSponsors([deal({ start: 'x' })], perth(2026, 12, 5, 12)).size, 0);
	assert.equal(dealDay('2026-12-01'), Date.UTC(2026, 11, 1) / 86_400_000);
});

test('展示片段：固定「赞助」字样，所有文字都转义', () => {
	assert.equal(SPONSOR_LABEL, '赞助');
	assert.match(sponsorTagHtml(), />赞助</);
	const html = sponsorOfferHtml(deal({ offer: '<img src=x onerror=alert(1)>', terms: '"\'&' }));
	assert.ok(!html.includes('<img'));
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.match(html, /&quot;&#39;&amp;/);
	assert.match(html, /付费推广/);
	assert.match(html, /不影响游戏里的任何数值/);
});

test('赞助不进规则引擎：核心结算代码不引用赞助数据；页面只用转义过的片段', () => {
	for (const f of ['actions.ts', 'engine.ts', 'venues.ts', 'formulas.ts', 'character.ts']) {
		const src = readFileSync(new URL(`../../src/game/core/${f}`, import.meta.url), 'utf8');
		assert.ok(!/sponsor/i.test(src), `${f} 不应引用赞助`);
	}
	const page = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(page, /sponsorTagHtml\(\)/);
	assert.match(page, /sponsorOfferHtml\(/);
	assert.ok(!/\$\{[^}]*\.(offer|terms)\b[^}]*\}/.test(page), '页面不得直接插值 offer/terms');
});
