// 「地点」页的「副业与生意」卡片：这里能做的副业、我的店、能租的铺面、证照、本年账本。
// 只拼 HTML 字符串：所有来自数据或存档的文字都经过调用方传入的 esc()；按钮用 data-biz 属性，由页面统一派发成 { t: 'biz', … } 动作。
import { gigsAt, licenseOffers, shopActions, shopOffersAt, shopSummary } from '../core/business.ts';
import { dayOf } from '../core/time.ts';
import { GST, SHOP_RULES } from '../data/business.ts';
import type { PlayerState, Region } from '../core/types.ts';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const dis = (why: string | undefined, esc: (s: unknown) => string) => (why ? `disabled title="${esc(why)}"` : '');

/** 进货按钮一次进多少：补到上限，最多一批 100 单 */
export const restockLot = (stock: number, max: number) => Math.max(1, Math.min(100, max - stock));

export function bizCard(s: PlayerState, region: Region, esc: (s: unknown) => string): string {
	const gigs = gigsAt(s, region);
	const sum = shopSummary(s);
	const offers = sum ? [] : shopOffersAt(s);
	if (!gigs.length && !sum && !offers.length) return '';
	const today = dayOf(s.clock);
	const gigHtml = gigs.map(({ gig, range, blocked }) => `
		<div class="row" style="margin-top:8px"><span class="ico">${gig.icon}</span><span class="body">${esc(gig.name)} · ${money(range[0])}–${money(range[1])}<small>${esc(blocked ?? `${gig.desc} ${Math.round(gig.minutes / 60 * 10) / 10} 小时${gig.cost ? `，先垫 ${money(gig.cost)}` : ''}`)}</small></span>
		<button data-biz="gig" data-biz-id="${esc(gig.id)}" ${dis(blocked, esc)}>去做</button></div>`).join('');
	let shopHtml = '';
	if (sum) {
		const { shop, type, site, daily, recentNet, recentSold, closeAt } = sum;
		const can = shopActions(s);
		const lot = restockLot(shop.stock, type.maxStock);
		shopHtml = `<div style="margin-top:10px"><p><b>${type.icon} 我的${esc(type.name)} · ${esc(site.name)}</b></p>
			<p class="muted" style="margin-top:4px">库存 ${shop.stock}/${type.maxStock} · 店员 ${shop.staff} 人 · 口碑 ${Math.round(shop.rep)}/100 · 每天固定开销 ${money(daily.total)}（租金 ${money(daily.rent)}${daily.wages ? `、工资养老金保险 ${money(daily.wages + daily.superPay + daily.comp)}` : ''}）</p>
			<p style="margin-top:4px">最近 7 天卖出 ${recentSold} 单，净${recentNet >= 0 ? '赚' : '亏'} ${money(Math.abs(recentNet))}${shop.debt ? `；欠款 ${money(shop.debt)}，到 ${money(closeAt)} 就倒闭` : ''}${shop.staff === 0 && shop.tend !== today ? '；今天没人看店，不开门' : ''}</p>
			<div class="inline" style="margin-top:6px">
				<button data-biz="restock" data-biz-qty="${lot}" ${dis(can.restock, esc)}>进货 ${lot} 单 ${money(lot * type.unitCost)}</button>
				<button data-biz="tend" ${dis(can.tend, esc)}>看店 ${SHOP_RULES.tendMinutes / 60} 小时</button>
				<button data-biz="hire" ${dis(can.hire, esc)}>雇人</button>
				<button data-biz="fire" ${dis(can.fire, esc)}>辞退</button>
				<button data-biz="close">关店</button>
			</div>
			${[can.restock, can.tend].some((w) => w && w.startsWith('要到')) ? `<p style="margin-top:4px" class="muted">${esc(can.restock)}。</p>` : ''}</div>`;
	} else if (offers.length) {
		shopHtml = `<details style="margin-top:10px"><summary class="muted">在这里开店（${new Set(offers.map((o) => o.site.id)).size} 个街区）</summary>
			${offers.map(({ type, site, cost, blocked }) => `<div class="row" style="margin-top:8px"><span class="ico">${type.icon}</span><span class="body">${esc(site.name)} · ${esc(type.name)} · ${money(cost)}<small>${esc(blocked ?? `${site.desc} 每周租金 ${money(site.rent)}。${type.desc}`)}</small></span>
			<button data-biz="open" data-biz-shop="${esc(type.id)}" data-biz-site="${esc(site.id)}" ${dis(blocked, esc)}>开店</button></div>`).join('')}</details>`;
	}
	const lic = licenseOffers(s);
	const licHtml = `<details style="margin-top:10px"><summary class="muted">证照（已有 ${lic.filter((o) => o.valid).length}/${lic.length}）· 网上办，在哪都能办</summary>
		${lic.map(({ lic: l, valid, expires, blocked }) => `<div class="row" style="margin-top:8px"><span class="ico">${valid ? '✅' : l.icon}</span><span class="body">${esc(l.name)} · ${l.fee ? money(l.fee) : '免费'}<small>${esc(valid ? (expires !== null ? `还有 ${expires - today} 天到期` : '长期有效') : l.desc)}</small></span>
		<button data-biz="license" data-biz-id="${esc(l.id)}" ${dis(blocked, esc)}>${valid ? '已办' : s.biz.lic[l.id] !== undefined ? '续办' : '办理'}</button></div>`).join('')}</details>`;
	const book = s.biz.book;
	const bookHtml = `<p class="muted" style="margin-top:8px">今年生意营业额 ${money(book.gross)}，净 ${book.net >= 0 ? '' : '−'}${money(Math.abs(book.net))}。${s.biz.gst ? '已登记 GST。' : `营业额到 ${money(GST.threshold)} 要登记 GST。`}</p>`;
	return `<div class="card"><h3>💼 副业与生意</h3>${gigHtml}${shopHtml}${licHtml}${bookHtml}</div>`;
}
