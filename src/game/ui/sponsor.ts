// 「附近」页赞助店铺的展示片段：标题旁固定的「赞助」标签，卡片里一行优惠和条件。
// 所有插值都经过 esc()（文字来自数据文件，仍按不可信处理）。
import { SPONSOR_LABEL, type SponsorDeal } from '../data/sponsors.ts';

export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 标题旁的标签 */
export const sponsorTagHtml = () => `<span class="sponsor-tag" aria-label="赞助内容">${esc(SPONSOR_LABEL)}</span>`;

/** 卡片里的优惠说明：写明这是店铺付费推广，不影响游戏数值 */
export const sponsorOfferHtml = (d: SponsorDeal) =>
	`<p class="sponsor-offer"><b>${esc(SPONSOR_LABEL)} · ${esc(d.offer)}</b><small>${esc(d.terms)} · ${esc(d.start)} 至 ${esc(d.end)}。这是店铺付费推广，在店里出示本页即可，不影响游戏里的任何数值。</small></p>`;
