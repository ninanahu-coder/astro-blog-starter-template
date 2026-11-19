// 本地商户赞助：校验规则、按珀斯日期生效、HTML 转义、不碰游戏数值；核销（定位、去重、每日上限）和对账单（固定月费 + 每次核销）。
// 店铺和赞助条目都是虚构的，不代表任何真实商户。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activeSponsors, dealDay, monthOfDay, redeemCode, redeemProblem, statementFor, validateSponsors } from '../../src/game/core/sponsor.ts';
import { SPONSORS, SPONSOR_LABEL, type SponsorDeal } from '../../src/game/data/sponsors.ts';
import { parseRedeemView, redeemCardHtml, sponsorOfferHtml, sponsorTagHtml } from '../../src/game/ui/sponsor.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { realDayOf } from '../../src/game/core/daily.ts';
import { EarthWorld } from '../../src/game/server/world.ts';
import { WORLD } from '../../src/game/data/wa.ts';
import type { Venue } from '../../src/game/core/types.ts';

const V = (id: string, type: string, source = 'osm'): Venue => ({ id, loc: 'perth', name: id, lat: -31.95, lon: 115.86, type, source });
const VENUES: Venue[] = [V('t-cafe', 'cafe'), V('t-gym', 'gym'), V('t-pub', 'pub'), V('t-clinic', 'clinic'), V('t-seed', 'cafe', 'seed')];
const deal = (over: Partial<SponsorDeal> = {}): SponsorDeal => ({
	id: 'sp-t-cafe-202612', venueId: 't-cafe', offer: '出示本页咖啡减 1 澳元', terms: '每人每天一次', start: '2026-12-01', end: '2026-12-31', agreement: 'TEST-001', fee: { monthly: 30000, perRedeem: 150 }, ...over,
});
/** 珀斯（UTC+8）某日某时的现实时间 */
const perth = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h - 8, min);

test('正式数据：目前没有签约的赞助，列表为空且能通过校验', () => {
	assert.equal(SPONSORS.length, 0);
	assert.deepEqual(validateSponsors(SPONSORS, WORLD.venues), []);
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
		[{ fee: { monthly: 300.5, perRedeem: 150 } }, /澳分整数/],
		[{ fee: { monthly: 30000, perRedeem: -1 } }, /澳分整数/],
		[{ fee: { monthly: 3_000_000, perRedeem: 150 } }, /澳分整数/],
		[{ fee: undefined as never }, /澳分整数/],
		[{ dailyCap: 0 }, /每日上限/],
		[{ dailyCap: 2.5 }, /每日上限/],
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

test('对账单：月费按生效天数折算，加核销次数 × 单次费用', () => {
	const d = deal({ start: '2026-12-11', end: '2027-01-20' }); // 12 月 21 天，1 月 20 天
	assert.deepEqual(statementFor(d, '2026-12', 40), { deal: d.id, month: '2026-12', activeDays: 21, daysInMonth: 31, redeems: 40, monthlyPart: Math.round(30000 * 21 / 31), redeemPart: 6000, total: Math.round(30000 * 21 / 31) + 6000 });
	assert.equal(statementFor(d, '2027-01', 0)!.monthlyPart, Math.round(30000 * 20 / 31));
	assert.equal(statementFor(deal(), '2026-12', 0)!.monthlyPart, 30000, '整月生效收整月');
	assert.equal(statementFor(d, '2027-02', 5), null, '没生效的月份不出账单');
	assert.equal(statementFor(d, '2026-13', 5), null);
	assert.equal(statementFor(d, 'x', 5), null);
	assert.equal(statementFor(deal({ start: '2028-02-01', end: '2028-02-29' }), '2028-02', 0)!.daysInMonth, 29);
	assert.equal(monthOfDay(dealDay('2026-12-31')!), '2026-12');
});

test('核销前检查：过期、定位不准、太远、瞬移都拒绝；在店里通过', () => {
	const venue = VENUES[0];
	const now = perth(2026, 12, 5, 12);
	const st = createCharacter({ id: 'sp-player', name: '测', avatar: '🧑', origin: 'student', region: 'wa', spawn: 'perth', seed: 1 });
	const at = { deal: deal().id, lat: venue.lat, lon: venue.lon, acc: 10 };
	assert.equal(redeemProblem(st, VENUES, [deal()], at, now), undefined);
	assert.match(redeemProblem(st, VENUES, [deal()], at, perth(2027, 1, 1, 12))!, /过期/);
	assert.match(redeemProblem(st, VENUES, [deal()], { ...at, deal: 'nope' }, now)!, /过期/);
	assert.match(redeemProblem(st, VENUES, [deal()], { ...at, acc: 500 }, now)!, /精度/);
	assert.match(redeemProblem(st, VENUES, [deal()], { ...at, lat: venue.lat + 0.01 }, now)!, /人在店里/);
	assert.match(redeemProblem(st, VENUES, [deal()], { ...at, lat: NaN }, now)!, /定位无效/);
	// 一分钟前还在 300 公里外
	const far = { ...st, fix: { lat: venue.lat + 3, lon: venue.lon, at: now - 60_000 } };
	assert.match(redeemProblem(far, VENUES, [deal()], at, now)!, /跳得太快/);
	assert.match(redeemCode('00000000ffff'), /^\d{4}$/);
	assert.equal(redeemCode('000004d2aa'), '1234');
});

test('核销卡：服务端返回值要校验，所有文字都转义', () => {
	assert.equal(parseRedeemView(null), null);
	assert.equal(parseRedeemView({ deal: 'a', venue: 'b', offer: 'c', terms: '', code: '12a4', day: 1 }), null);
	assert.equal(parseRedeemView({ deal: 'a', venue: 'b', offer: 'c', terms: '', code: '1234', day: 1.5 }), null);
	const v = parseRedeemView({ deal: 'a', venue: '<b>店</b>', offer: '"减"', terms: "'x'", code: '0042', day: dealDay('2026-12-05') });
	assert.ok(v);
	const html = redeemCardHtml(v);
	assert.ok(!html.includes('<b>店'));
	assert.match(html, /&lt;b&gt;店&lt;\/b&gt;/);
	assert.match(html, /0042/);
	assert.match(html, /2026-12-05 当天有效/);
	assert.match(html, />赞助</);
});

// 服务端：把一家虚构的店和一条虚构的赞助临时放进世界数据（只在这个测试进程里）
function makeWorld(env: Record<string, unknown> = {}) {
	const data = new Map<string, any>();
	const storage = {
		get: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv));
		},
		list: async ({ prefix = '' }: { prefix?: string } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix))),
	};
	const world = new EarthWorld({ storage } as never, env);
	const call = async (body: Record<string, unknown>) => {
		const res = await world.fetch(new Request('https://example.test/api/earth/save', { method: 'POST', body: JSON.stringify(body) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	const report = async (month: string, token?: string) => {
		const res = await world.fetch(new Request(`https://example.test/api/earth/sponsor-report?month=${month}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, report };
}

test('服务端核销：在店里才发码；同一人同一天只记一次；每日上限；当月计数进对账单', async () => {
	const shop: Venue = { id: 't-sponsor-cafe', loc: 'perth', name: '测试咖啡（虚构）', lat: -31.9505, lon: 115.8605, type: 'cafe', source: 'osm' };
	WORLD.venues.push(shop);
	const today = realDayOf(Date.now());
	const ymd = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
	const d = deal({ id: 'sp-t-sponsor-cafe', venueId: shop.id, start: ymd(today - 1), end: ymd(today + 1), dailyCap: 2 });
	SPONSORS.push(d);
	try {
		const token = 't'.repeat(40);
		const w = makeWorld({ EARTH_SPONSOR_TOKEN: token });
		const players = ['sponsor-p1', 'sponsor-p2', 'sponsor-p3'].map((id) => ({ id, key: 'k'.repeat(24) }));
		for (const p of players) assert.ok((await w.call({ action: 'create', ...p, profile: { name: '测', avatar: '🧑', origin: 'student', traits: [] } })).data.ok);
		const here = { deal: d.id, lat: shop.lat, lon: shop.lon, acc: 10 };
		const [p1, p2, p3] = players;

		const far = await w.call({ action: 'redeem', ...p1, ...here, lat: shop.lat + 0.01 });
		assert.equal(far.data.ok, false);
		assert.match(far.data.msg, /人在店里/);
		assert.equal((await w.call({ action: 'redeem', ...p1, key: 'x'.repeat(24), ...here })).status, 403, '同步码不对不能领');

		const first = await w.call({ action: 'redeem', ...p1, ...here });
		assert.ok(first.data.ok, first.data.msg);
		assert.match(first.data.redeem.code, /^\d{4}$/);
		assert.equal(first.data.redeem.venue, shop.name);
		assert.ok(!JSON.stringify(first.data).includes(p1.id), '返回里不带玩家 id');
		const again = await w.call({ action: 'redeem', ...p1, ...here });
		assert.ok(again.data.dup);
		assert.equal(again.data.redeem.code, first.data.redeem.code, '同一天再点是同一个码');

		assert.ok((await w.call({ action: 'redeem', ...p2, ...here })).data.ok);
		const capped = await w.call({ action: 'redeem', ...p3, ...here });
		assert.equal(capped.data.ok, false);
		assert.match(capped.data.msg, /发完了/);

		const month = monthOfDay(today);
		assert.equal(w.data.get(`rdd:${d.id}:${today}`), 2);
		assert.equal(w.data.get(`rdm:${d.id}:${month}`), 2);
		// 核销不改存档
		assert.equal(w.data.get('save:' + p1.id).state.fix, null);

		assert.equal((await w.report(month)).status, 401);
		assert.equal((await w.report(month, 'wrong')).status, 401);
		assert.equal((await w.report('2026-1', token)).status, 400);
		const rep = await w.report(month, token);
		assert.equal(rep.status, 200);
		const row = rep.data.rows.find((r: any) => r.deal === d.id);
		assert.equal(row.redeems, 2);
		assert.equal(row.redeemPart, 300);
		assert.equal(row.total, row.monthlyPart + 300);
		assert.ok(!JSON.stringify(rep.data).includes('sponsor-p'), '对账单不含玩家信息');

		// 没配置令牌（或太短）就不开放
		assert.equal((await makeWorld().report(month, token)).status, 404);
		assert.equal((await makeWorld({ EARTH_SPONSOR_TOKEN: 'short' }).report(month, 'short')).status, 404);
	} finally {
		SPONSORS.splice(SPONSORS.indexOf(d), 1);
		WORLD.venues.splice(WORLD.venues.indexOf(shop), 1);
	}
});
