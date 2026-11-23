// 「附近」页赞助店铺的展示片段：标题旁固定的「赞助」标签，卡片里一行优惠和条件。
// 所有插值都经过 esc()（文字来自数据文件，仍按不可信处理）。
import { SPONSOR_LABEL, type SponsorDeal } from '../data/sponsors.ts';

export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 标题旁的标签 */
export const sponsorTagHtml = () => `<span class="sponsor-tag" aria-label="赞助内容">${esc(SPONSOR_LABEL)}</span>`;

/** 卡片里的优惠说明：写明这是店铺付费推广，不影响游戏数值 */
export const sponsorOfferHtml = (d: SponsorDeal) =>
	`<p class="sponsor-offer"><b>${esc(SPONSOR_LABEL)} · ${esc(d.offer)}</b><small>${esc(d.terms)} · ${esc(d.start)} 至 ${esc(d.end)}。这是店铺付费推广，在店里出示本页即可，不影响游戏里的任何数值。</small></p>`;

/** 服务端核销接口返回的展示内容 */
export interface RedeemView {
	deal: string;
	venue: string;
	offer: string;
	terms: string;
	code: string;
	day: number; // 珀斯现实日序号
	confirmed: boolean; // 店员已输入 PIN 确认
}

/** 返回值不可信：字段类型不对就丢掉 */
export function parseRedeemView(v: unknown): RedeemView | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
	const [deal, venue, offer, terms, code] = ['deal', 'venue', 'offer', 'terms', 'code'].map(str);
	if (!deal || !venue || !offer || terms === null || !code || !/^\d{4}$/.test(code) || !Number.isInteger(o.day)) return null;
	return { deal, venue, offer, terms, code, day: o.day as number, confirmed: o.confirmed === true };
}

/** 珀斯日期 YYYY-MM-DD */
const dayLabel = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** PIN 输入框的元素 id（赞助编号只含小写字母、数字和连字符） */
export const pinInputId = (dealId: string) => `redeem-pin-${dealId.replace(/[^a-z0-9-]/g, '')}`;

/**
 * 给店员看的核销卡：店名、优惠、今天的日期、4 位核销码；圆点一直在动，静态截图看得出来。
 * 没确认时下面是店员输入 PIN 的框；确认过显示「已核销」，不再给输入框。
 */
export const redeemCardHtml = (r: RedeemView) =>
	`<div class="redeem-card${r.confirmed ? ' done' : ''}" role="group" aria-label="优惠核销码"><span class="sponsor-tag">${esc(SPONSOR_LABEL)}</span><span class="redeem-live" aria-hidden="true"></span>
		<b class="redeem-shop">${esc(r.venue)}</b><p>${esc(r.offer)}</p>
		<b class="redeem-code" aria-label="核销码 ${esc(r.code)}">${esc(r.code)}</b>
		<small>${esc(dayLabel(r.day))} 当天有效 · ${esc(r.terms)}</small>
		${r.confirmed
		? '<b class="redeem-ok">✅ 已核销</b>'
		: `<label class="redeem-pin" for="${esc(pinInputId(r.deal))}">店员输入店铺 PIN 确认<input id="${esc(pinInputId(r.deal))}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>
		<button class="primary wide" data-redeem-confirm="${esc(r.deal)}">确认核销</button>
		<small>店员：核对店名、日期和核销码，右上角圆点在动说明不是截图；给了优惠再输入 PIN。</small>`}</div>`;
