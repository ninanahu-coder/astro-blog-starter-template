// 本地商户赞助：校验规则、按珀斯日期生效、HTML 转义、不碰游戏数值；核销（定位、去重、每日上限）和对账单（固定月费 + 每次核销）。
// 店铺和赞助条目都是虚构的，不代表任何真实商户。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activeSponsors, dealDay, monthOfDay, redeemCode, redeemProblem, statementFor, validateSponsors } from '../../src/game/core/sponsor.ts';
import { SPONSORS, SPONSOR_LABEL, type SponsorDeal } from '../../src/game/data/sponsors.ts';
import { parseRedeemView, pinInputId, redeemCardHtml, sponsorOfferHtml, sponsorTagHtml } from '../../src/game/ui/sponsor.ts';
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
	assert.equal(v.confirmed, false);
	assert.match(html, /type="password"/);
	assert.match(html, /data-redeem-confirm="a"/);
	const done = redeemCardHtml({ ...v, confirmed: true });
	assert.match(done, /已核销/);
	assert.ok(!done.includes('<input'), '确认过不再给输入框');
	assert.equal(parseRedeemView({ deal: 'a', venue: 'b', offer: 'c', terms: '', code: '1234', day: 1, confirmed: 'yes' })!.confirmed, false, '只认布尔 true');
	assert.equal(pinInputId('sp-x"><img'), 'redeem-pin-sp-ximg');
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
	const makePin = async (deal: string, token?: string, method = 'POST') => {
		const res = await world.fetch(new Request('https://example.test/api/earth/sponsor-pin', { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(method === 'POST' ? { body: JSON.stringify({ deal }) } : {}) }));
		return { status: res.status, data: (await res.json()) as any };
	};
	return { data, call, report, makePin };
}

const SHOP: Venue = { id: 't-sponsor-cafe', loc: 'perth', name: '测试咖啡（虚构）', lat: -31.9505, lon: 115.8605, type: 'cafe', source: 'osm' };
const TOKEN = 't'.repeat(40);
const profile = { name: '测', avatar: '🧑', origin: 'student', traits: [] };

/** 把虚构的店和赞助临时放进世界数据（只在这个测试进程里），跑完拿掉 */
async function withDeal(over: Partial<SponsorDeal>, fn: (d: SponsorDeal) => Promise<void>) {
	const today = realDayOf(Date.now());
	const ymd = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
	const d = deal({ id: 'sp-t-sponsor-cafe', venueId: SHOP.id, start: ymd(today - 1), end: ymd(today + 1), ...over });
	WORLD.venues.push(SHOP);
	SPONSORS.push(d);
	try {
		await fn(d);
	} finally {
		SPONSORS.splice(SPONSORS.indexOf(d), 1);
		WORLD.venues.splice(WORLD.venues.indexOf(SHOP), 1);
	}
}
const here = (d: SponsorDeal) => ({ deal: d.id, lat: SHOP.lat, lon: SHOP.lon, acc: 10 });

test('店员 PIN 接口：要令牌，只返回一次，服务端只存加盐哈希，重置后旧的失效', async () => {
	await withDeal({}, async (d) => {
		const w = makeWorld({ EARTH_SPONSOR_TOKEN: TOKEN });
		assert.equal((await w.makePin(d.id)).status, 401);
		assert.equal((await w.makePin(d.id, 'wrong')).status, 401);
		assert.equal((await w.makePin(d.id, TOKEN, 'GET')).status, 405);
		assert.equal((await w.makePin('nope', TOKEN)).status, 404);
		const a = await w.makePin(d.id, TOKEN);
		assert.equal(a.status, 200);
		assert.match(a.data.pin, /^\d{6}$/);
		const rec = w.data.get(`pin:${d.id}`);
		assert.ok(!JSON.stringify(rec).includes(a.data.pin), '不存明文 PIN');
		const b = await w.makePin(d.id, TOKEN);
		assert.notDeepEqual(w.data.get(`pin:${d.id}`), rec, '重置后换了盐和哈希');
		assert.equal((await makeWorld().makePin(d.id, TOKEN)).status, 404, '没配置令牌就不开放');
		void b;
	});
});

test('服务端核销：在店里领码不计费；店员输对 PIN 才计费；每日上限；输错锁定；对账单只按确认数收费', async () => {
	await withDeal({ dailyCap: 2 }, async (d) => {
		const w = makeWorld({ EARTH_SPONSOR_TOKEN: TOKEN });
		const [p1, p2, p3, p4] = ['sponsor-p1', 'sponsor-p2', 'sponsor-p3', 'sponsor-p4'].map((id) => ({ id, key: 'k'.repeat(24) }));
		for (const p of [p1, p2, p3, p4]) assert.ok((await w.call({ action: 'create', ...p, profile })).data.ok);
		const { pin } = (await w.makePin(d.id, TOKEN)).data;
		const wrong = pin === '000000' ? '111111' : '000000';
		const claim = (p: typeof p1, extra = {}) => w.call({ action: 'redeem', op: 'claim', ...p, ...here(d), ...extra });
		const confirm = (p: typeof p1, pinText: string) => w.call({ action: 'redeem', op: 'confirm', ...p, deal: d.id, pin: pinText });
		const today = realDayOf(Date.now());
		const month = monthOfDay(today);

		const far = await claim(p1, { lat: SHOP.lat + 0.01 });
		assert.equal(far.data.ok, false);
		assert.match(far.data.msg, /人在店里/);
		assert.equal((await claim({ ...p1, key: 'x'.repeat(24) })).status, 403, '同步码不对不能领');
		assert.match((await confirm(p2, pin)).data.msg, /先在店里/, '没领码不能确认');

		const first = await claim(p1);
		assert.ok(first.data.ok, first.data.msg);
		assert.match(first.data.redeem.code, /^\d{4}$/);
		assert.equal(first.data.redeem.confirmed, false);
		assert.ok(!JSON.stringify(first.data).includes(p1.id), '返回里不带玩家 id');
		assert.equal(w.data.get(`rdm:${d.id}:${month}`), undefined, '领码不计费');
		const again = await claim(p1);
		assert.ok(again.data.dup);
		assert.equal(again.data.redeem.code, first.data.redeem.code, '同一天再点是同一个码');

		const bad = await confirm(p1, wrong);
		assert.equal(bad.data.ok, false);
		assert.match(bad.data.msg, /还能试 4 次/);
		assert.equal((await confirm(p1, '12ab')).data.ok, false, '格式不对也算输错');
		const ok = await confirm(p1, pin);
		assert.ok(ok.data.ok, ok.data.msg);
		assert.equal(ok.data.redeem.confirmed, true);
		assert.equal(w.data.get(`rdm:${d.id}:${month}`), 1);
		assert.ok((await confirm(p1, pin)).data.dup, '确认过再确认不重复计费');
		assert.equal(w.data.get(`rdm:${d.id}:${month}`), 1);
		assert.equal((await claim(p1)).data.redeem.confirmed, true, '再打开显示已核销');

		// 每日上限 2：p2、p3 都领到码；p2 确认后到上限，p3 确认不了，p4 领不到
		assert.ok((await claim(p2)).data.ok);
		assert.ok((await claim(p3)).data.ok);
		assert.ok((await confirm(p2, pin)).data.ok);
		assert.match((await confirm(p3, pin)).data.msg, /发完了/);
		assert.match((await claim(p4)).data.msg, /发完了/);
		assert.equal(w.data.get(`rdd:${d.id}:${today}`), 2);

		// 每人每天最多输错 5 次
		for (let i = 0; i < 5; i++) assert.equal((await confirm(p3, wrong)).data.ok, false);
		assert.match((await confirm(p3, pin)).data.msg, /已锁定/);

		// 核销不改存档
		assert.equal(w.data.get('save:' + p1.id).state.fix, null);

		const rep = await w.report(month, TOKEN);
		assert.equal(rep.status, 200);
		const row = rep.data.rows.find((r: any) => r.deal === d.id);
		assert.equal(row.redeems, 2, '只按店员确认过的计费');
		assert.equal(row.claims, 3);
		assert.equal(row.pin, true);
		assert.equal(row.redeemPart, 300);
		assert.equal(row.total, row.monthlyPart + 300);
		assert.ok(!JSON.stringify(rep.data).includes('sponsor-p'), '对账单不含玩家信息');
		assert.ok(!JSON.stringify(rep.data).includes(pin), '对账单不含 PIN');
		assert.equal((await w.report(month)).status, 401);
		assert.equal((await w.report('2026-1', TOKEN)).status, 400);
		assert.equal((await makeWorld({ EARTH_SPONSOR_TOKEN: 'short' }).report(month, 'short')).status, 404, '令牌太短等于没配置');
	});
});

test('服务端核销：没开通 PIN 不能确认；整条赞助当天输错太多就锁定', async () => {
	await withDeal({}, async (d) => {
		const w = makeWorld({ EARTH_SPONSOR_TOKEN: TOKEN });
		const p = { id: 'sponsor-q1', key: 'k'.repeat(24) };
		assert.ok((await w.call({ action: 'create', ...p, profile })).data.ok);
		assert.ok((await w.call({ action: 'redeem', op: 'claim', ...p, ...here(d) })).data.ok);
		assert.match((await w.call({ action: 'redeem', op: 'confirm', ...p, deal: d.id, pin: '123456' })).data.msg, /还没开通/);
		const { pin } = (await w.makePin(d.id, TOKEN)).data;
		w.data.set(`rdf:${d.id}:${realDayOf(Date.now())}`, 100);
		assert.match((await w.call({ action: 'redeem', op: 'confirm', ...p, deal: d.id, pin })).data.msg, /已锁定/);
	});
});
