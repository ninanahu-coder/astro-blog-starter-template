// 本地商户赞助：校验赞助条目、按现实日期找出店铺当前生效的赞助。
// 纯函数：现实时间由调用方传入。赞助只影响展示（「赞助」标签和优惠文字），不改任何游戏数值，也不参与结算。
import { realDayOf } from './daily.ts';
import { SPONSOR_EXCLUDED_TYPES, SPONSOR_RULES, type SponsorDeal } from '../data/sponsors.ts';
import type { Venue } from './types.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const URLISH = /(https?:|www\.|\.com|\.au\b|@)/i;

/** YYYY-MM-DD → 现实日序号（和 realDayOf 同一套：珀斯日期）；格式或日期不合法返回 null */
export function dealDay(s: string): number | null {
	const m = DATE_RE.exec(s);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = Date.UTC(y, mo - 1, d);
	const back = new Date(t);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
	return t / 86_400_000;
}

/** 校验全部赞助条目，返回问题列表（空 = 通过） */
export function validateSponsors(deals: SponsorDeal[], venues: Venue[]): string[] {
	const errs: string[] = [];
	const byId = new Map(venues.map((v) => [v.id, v]));
	const ids = new Set<string>();
	const spans = new Map<string, [number, number, string][]>();
	for (const d of deals) {
		const at = `赞助 ${d.id || '(无编号)'}`;
		if (!/^[a-z0-9-]{3,80}$/.test(d.id)) errs.push(`${at}：编号只能用小写字母、数字和连字符`);
		if (ids.has(d.id)) errs.push(`${at}：编号重复`);
		ids.add(d.id);
		const v = byId.get(d.venueId);
		if (!v) errs.push(`${at}：找不到店铺 ${d.venueId}`);
		else {
			if (v.source !== 'osm') errs.push(`${at}：只接受 OSM 来源的真实店铺`);
			if (SPONSOR_EXCLUDED_TYPES.includes(v.type)) errs.push(`${at}：${v.type} 类店铺不接受赞助`);
		}
		const offer = d.offer?.trim() ?? '';
		const terms = d.terms?.trim() ?? '';
		if (!offer) errs.push(`${at}：缺优惠文字`);
		if (offer.length > SPONSOR_RULES.offerMax) errs.push(`${at}：优惠文字超过 ${SPONSOR_RULES.offerMax} 字`);
		if (!terms) errs.push(`${at}：缺使用条件`);
		if (terms.length > SPONSOR_RULES.termsMax) errs.push(`${at}：使用条件超过 ${SPONSOR_RULES.termsMax} 字`);
		if (URLISH.test(offer) || URLISH.test(terms)) errs.push(`${at}：文字里不得有网址或联系方式`);
		if (!d.agreement?.trim()) errs.push(`${at}：缺协议编号`);
		const s = dealDay(d.start);
		const e = dealDay(d.end);
		if (s === null || e === null) errs.push(`${at}：日期格式应为 YYYY-MM-DD`);
		else if (e < s) errs.push(`${at}：结束日期早于开始日期`);
		else if (e - s + 1 > SPONSOR_RULES.maxDays) errs.push(`${at}：一期最长 ${SPONSOR_RULES.maxDays} 天`);
		else {
			const list = spans.get(d.venueId) ?? [];
			for (const [os, oe, oid] of list) if (s <= oe && os <= e) errs.push(`${at}：和 ${oid} 时间重叠（同一家店同一时间只能有一条）`);
			list.push([s, e, d.id]);
			spans.set(d.venueId, list);
		}
	}
	return errs;
}

/** 店铺 id → 现在生效的赞助（按珀斯日期，起止日都算在内） */
export function activeSponsors(deals: SponsorDeal[], nowMs: number): Map<string, SponsorDeal> {
	const today = realDayOf(nowMs);
	const out = new Map<string, SponsorDeal>();
	for (const d of deals) {
		const s = dealDay(d.start);
		const e = dealDay(d.end);
		if (s === null || e === null || today < s || today > e) continue;
		if (!out.has(d.venueId)) out.set(d.venueId, d);
	}
	return out;
}
