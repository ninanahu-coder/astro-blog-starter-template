// 现实活动（第 24 批）：跟真实日历走的节日和公众假期，和游戏日历里的节日（festivals.ts）是两套。
// 到点自动上线、过点自动下线，全部由服务端时钟判断（见 core/live.ts）。
//
// 数据规则（AGENTS.md）：每条都必须写 source（官方页面网址）和 checked（核对日期）；只收官方公布了确切日期的，
// 没公布的年份不预填、不按往年推算。日期和钟点都是当地时间（珀斯 / 阿德莱德），end 不含（到这一刻下线）。
// 核对方法：2026-11-20 用 curl 直接取官方页面全文比对，不用搜索摘要。
import type { LiveEventDef, LiveSpan } from '../core/live.ts';

const WA_HOLIDAYS = 'https://www.wa.gov.au/service/employment/workplace-agreements/public-holidays-western-australia';
const SA_HOLIDAYS = 'https://www.safework.sa.gov.au/resources/public-holidays';
const CHECKED = '2026-11-20';

/** 当地一整天：d 当天 00:00 到次日 00:00 */
const day = (d: string): LiveSpan => ({ start: `${d}T00:00`, end: `${nextDate(d)}T00:00` });
/** 当地连续几天：a 当天 00:00 到 b 次日 00:00（含 b） */
const days = (a: string, b: string): LiveSpan => ({ start: `${a}T00:00`, end: `${nextDate(b)}T00:00` });

function nextDate(d: string): string {
	const [y, m, dd] = d.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, dd + 1));
	return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 公众假期：只做全州范围的「放假气氛」，不绑地点 */
const waHoliday = (id: string, name: string, spans: LiveSpan[]): LiveEventDef => ({
	id: `wa-${id}`, kind: 'holiday', area: 'wa', name, spans, desc: '西澳公众假期。', source: WA_HOLIDAYS, checked: CHECKED,
});
const saHoliday = (id: string, name: string, spans: LiveSpan[], desc = '南澳公众假期。'): LiveEventDef => ({
	id: `sa-${id}`, kind: 'holiday', area: 'sa', name, spans, desc, source: SA_HOLIDAYS, checked: CHECKED,
});

export const LIVE_EVENTS: LiveEventDef[] = [
	// ---------- 艺术节（官方网站公布的日期） ----------
	{
		id: 'perth-festival-2027', kind: 'festival', area: 'wa', loc: 'perth', name: '珀斯艺术节 2027', en: 'Perth Festival',
		spans: [days('2027-02-05', '2027-02-28')],
		desc: '珀斯每年夏天的大型艺术节，剧场、音乐会和户外演出铺满市中心和河边。',
		source: 'https://www.perthfestival.com.au/frequently-asked-questions/', checked: CHECKED,
	},
	{
		id: 'adelaide-fringe-2027', kind: 'festival', area: 'sa', loc: 'adelaide', name: '阿德莱德边缘艺术节 2027', en: 'Adelaide Fringe',
		spans: [days('2027-02-19', '2027-03-21')],
		desc: '31 天的开放报名艺术节，喜剧、马戏、音乐在城里各处的小场地同时开演。',
		source: 'https://avr.adelaidefringe.com.au/blog/events/key-dates', checked: CHECKED,
	},
	{
		id: 'adelaide-festival-2027', kind: 'festival', area: 'sa', loc: 'adelaide', name: '阿德莱德艺术节 2027', en: 'Adelaide Festival',
		spans: [days('2027-02-26', '2027-03-14')],
		desc: '阿德莱德的国际艺术节，有戏剧、舞蹈、音乐和作家周。',
		source: 'https://www.adelaidefestival.com.au/', checked: CHECKED,
	},
	{
		id: 'womadelaide-2027', kind: 'festival', area: 'sa', loc: 'adelaide', name: 'WOMADelaide 2027', en: 'WOMADelaide',
		spans: [days('2027-03-05', '2027-03-08')],
		desc: '在植物园公园办的世界音乐节，连着三月的长周末。',
		source: 'https://www.womadelaide.com.au/info/faqs/', checked: CHECKED,
	},

	// ---------- 西澳公众假期（WA 政府页面 2026、2027 两年；含周末顺延的补假日） ----------
	waHoliday('christmas-2026', '圣诞节', [day('2026-12-25')]),
	waHoliday('boxing-2026', '节礼日', [day('2026-12-26'), day('2026-12-28')]),
	waHoliday('new-year-2027', '新年', [day('2027-01-01')]),
	waHoliday('australia-day-2027', '澳大利亚日', [day('2027-01-26')]),
	waHoliday('labour-day-2027', '劳动节', [day('2027-03-01')]),
	waHoliday('easter-2027', '复活节', [day('2027-03-26'), days('2027-03-28', '2027-03-29')]),
	waHoliday('anzac-2027', '澳新军团日', [days('2027-04-25', '2027-04-26')]),
	waHoliday('wa-day-2027', '西澳日', [day('2027-06-07')]),
	waHoliday('kings-birthday-2027', '国王生日', [day('2027-09-27')]),
	waHoliday('christmas-2027', '圣诞节', [day('2027-12-25'), day('2027-12-27')]),
	waHoliday('boxing-2027', '节礼日', [day('2027-12-26'), day('2027-12-28')]),

	// ---------- 南澳公众假期（SafeWork SA 页面；平安夜、跨年夜只有晚上 7 点到午夜） ----------
	saHoliday('christmas-eve-2026', '平安夜', [{ start: '2026-12-24T19:00', end: '2026-12-25T00:00' }], '南澳公众假期（晚上 7 点到午夜）。'),
	saHoliday('christmas-2026', '圣诞节', [day('2026-12-25')]),
	saHoliday('proclamation-2026', '建州日', [day('2026-12-26'), day('2026-12-28')]),
	saHoliday('nye-2026', '跨年夜', [{ start: '2026-12-31T19:00', end: '2027-01-01T00:00' }], '南澳公众假期（晚上 7 点到午夜）。'),
	saHoliday('new-year-2027', '新年', [day('2027-01-01')]),
	saHoliday('australia-day-2027', '澳大利亚日', [day('2027-01-26')]),
	saHoliday('adelaide-cup-2027', '阿德莱德杯赛马日', [day('2027-03-08')]),
	saHoliday('easter-2027', '复活节', [days('2027-03-26', '2027-03-29')]),
	saHoliday('anzac-2027', '澳新军团日', [day('2027-04-25')]),
	saHoliday('kings-birthday-2027', '国王生日', [day('2027-06-14')]),
	saHoliday('labour-day-2027', '劳动节', [day('2027-10-04')]),
	saHoliday('christmas-eve-2027', '平安夜', [{ start: '2027-12-24T19:00', end: '2027-12-25T00:00' }], '南澳公众假期（晚上 7 点到午夜）。'),
	saHoliday('christmas-2027', '圣诞节', [day('2027-12-25'), day('2027-12-27')]),
	saHoliday('proclamation-2027', '建州日', [day('2027-12-26'), day('2027-12-28')]),
	saHoliday('nye-2027', '跨年夜', [{ start: '2027-12-31T19:00', end: '2028-01-01T00:00' }], '南澳公众假期（晚上 7 点到午夜）。'),
];
