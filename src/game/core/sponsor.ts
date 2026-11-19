// 本地商户赞助：校验赞助条目、按现实日期找出店铺当前生效的赞助。
// 纯函数：现实时间由调用方传入。赞助只影响展示（「赞助」标签和优惠文字），不改任何游戏数值，也不参与结算。
import { realDayOf } from './daily.ts';
import { haversineKm } from './geo.ts';
import { fixProblem, getVenueType } from './venues.ts';
import { FIX_RULES } from '../data/venues.ts';
import { SPONSOR_EXCLUDED_TYPES, SPONSOR_RULES, type SponsorDeal } from '../data/sponsors.ts';
import type { PlayerState, Venue } from './types.ts';

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
		const intIn = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
		if (!d.fee || !intIn(d.fee.monthly, SPONSOR_RULES.monthlyMax) || !intIn(d.fee.perRedeem, SPONSOR_RULES.perRedeemMax)) errs.push(`${at}：收费要写成澳分整数（月费 ≤ ${SPONSOR_RULES.monthlyMax}，单次 ≤ ${SPONSOR_RULES.perRedeemMax}）`);
		if (d.dailyCap !== undefined && (!intIn(d.dailyCap, SPONSOR_RULES.dailyCapMax) || d.dailyCap < 1)) errs.push(`${at}：每日上限要是 1–${SPONSOR_RULES.dailyCapMax} 的整数`);
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

/** 生效中的赞助条目（按编号找） */
export function liveDeal(deals: SponsorDeal[], dealId: string, nowMs: number): SponsorDeal | undefined {
	const d = deals.find((x) => x.id === dealId);
	return d && activeSponsors([d], nowMs).get(d.venueId) === d ? d : undefined;
}

export interface RedeemRequest {
	deal: string;
	lat: number;
	lon: number;
	acc: number;
}

/**
 * 核销前的检查：赞助今天生效 → 店铺存在 → 定位可信（精度、和上次定位比的移动速度，和真实地点用的同一套）→ 人在店铺判定半径内。
 * 通过返回 undefined。去重和每日上限要看服务端记录，在服务端查。只读存档，不改存档。
 */
export function redeemProblem(state: PlayerState, venues: Venue[], deals: SponsorDeal[], req: RedeemRequest, nowMs: number): string | undefined {
	if (!Number.isFinite(nowMs) || nowMs <= 0) return '优惠需要联网才能用。';
	const deal = liveDeal(deals, req.deal, nowMs);
	if (!deal) return '这个优惠不存在或已经过期。';
	const venue = venues.find((v) => v.id === deal.venueId);
	const type = venue ? getVenueType(venue.type) : undefined;
	if (!venue || !type) return '找不到这家店。';
	const bad = fixProblem(state, req.lat, req.lon, req.acc, nowMs);
	if (bad) return bad;
	const distM = haversineKm(req.lat, req.lon, venue.lat, venue.lon) * 1000;
	const slack = Math.min(req.acc, FIX_RULES.accuracySlackM);
	if (distM > type.radiusM + slack) return `要人在店里才能用（现在离店约 ${Math.round(distM)} 米）。`;
	return undefined;
}

/** 核销码：同一条赞助、同一天、同一个玩家（id 哈希）永远是同一个 4 位数，重复打开不会变 */
export function redeemCode(hashHex: string): string {
	return String(parseInt(hashHex.slice(0, 8), 16) % 10000).padStart(4, '0');
}

/** 现实日序号 → YYYY-MM（珀斯日期） */
export const monthOfDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 7);

export interface Statement {
	deal: string;
	month: string;
	activeDays: number;
	daysInMonth: number;
	redeems: number;
	monthlyPart: number; // 澳分
	redeemPart: number; // 澳分
	total: number; // 澳分
}

/**
 * 某条赞助某个月的对账单：月费按这个月里生效的天数折算（四舍五入到分），加上核销次数 × 单次费用。
 * 月份不对、或这个月一天都没生效时返回 null。
 */
export function statementFor(deal: SponsorDeal, month: string, redeems: number): Statement | null {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m) return null;
	const first = dealDay(`${month}-01`);
	if (first === null) return null;
	const daysInMonth = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
	const last = first + daysInMonth - 1;
	const s = dealDay(deal.start);
	const e = dealDay(deal.end);
	if (s === null || e === null) return null;
	const activeDays = Math.max(0, Math.min(e, last) - Math.max(s, first) + 1);
	if (!activeDays) return null;
	const n = Math.max(0, Math.floor(redeems));
	const monthlyPart = Math.round(deal.fee.monthly * activeDays / daysInMonth);
	const redeemPart = n * deal.fee.perRedeem;
	return { deal: deal.id, month, activeDays, daysInMonth, redeems: n, monthlyPart, redeemPart, total: monthlyPart + redeemPart };
}
