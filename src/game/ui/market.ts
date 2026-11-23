// 交易所（寄卖、拍卖）和面交换物的界面：只拼 HTML 字符串，所有插值经过页面传进来的 esc()。
// 规则检查用 core/exchange.ts 的同一套函数（只用来显示按钮状态，最终以服务端为准）。设计见 docs/earth-game/player-trade.md
import { getItem } from '../core/attributes.ts';
import { EXCHANGE, feeOf, listBlocked, priceBand, refPrice, roomFor, sideValue, swapCashBand, type LotView, type SwapSide } from '../core/exchange.ts';
import { ITEMS } from '../data/items.ts';
import type { PlayerState } from '../core/types.ts';

type Esc = (s: unknown) => string;

/** 服务端 market list 的返回 */
export interface MarketData {
	lots: LotView[];
	mine: LotView[];
	mail: { id: string; cash: number; item: string | null; n: number; text: string; at: number }[];
	quota: { deals: number; volume: number; maxDeals: number; maxVolume: number };
	newbie: string | null;
}

/** 选「挂什么」时的界面状态 */
export interface SellPick {
	item?: string;
	kind?: 'fixed' | 'auction';
}

/** 面交换物正在选的内容 */
export interface SwapPick {
	to: string;
	name: string;
	give?: string;
	want?: string | '';
}

/** 防诈骗和禁止真钱交易的提示（交易所和面交都显示） */
export const SAFETY_TIP = '只用游戏币交易。禁止用真钱买卖游戏币、物品或角色（发现会清空交易所里的东西并停用交易）。不要相信「场外先转账」「代充」「加微信便宜卖」；任何人（包括自称客服的）都不会找你要同步码。';

const left = (endsAt: number, now: number) => {
	const m = Math.max(0, Math.round((endsAt - now) / 60_000));
	return m >= 60 ? `还剩 ${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `还剩 ${m} 分钟`;
};

/** 一件东西挂单时给的三个价：最低、商店价、最高 */
export function pricePresets(itemId: string): number[] {
	const b = priceBand(itemId);
	const ref = refPrice(itemId);
	if (!b || ref === null) return [];
	return [...new Set([b.min, Math.min(b.max, Math.max(b.min, ref)), b.max])];
}

/** 交易所卡片 */
export function marketCard(esc: Esc, s: PlayerState, d: MarketData | null, pick: SellPick | null, now: number): string {
	const head = `<h3>🏛️ 交易所</h3><p class="muted">寄卖 ${EXCHANGE.fixedHours} 小时、拍卖 ${EXCHANGE.auctionHours.join(' 或 ')} 小时；挂单费 ${Math.round(EXCHANGE.listFeeRate * 100)}%，成交佣金 ${Math.round(EXCHANGE.commission * 100)}%（从卖家到手里扣）。东西挂出就由交易所保管，出价的钱也先扣下，被超过会退回邮箱。</p><p class="muted">⚠️ ${esc(SAFETY_TIP)}</p>`;
	if (!d) return `<div class="card market">${head}<p class="muted">正在读取…</p></div>`;
	const parts: string[] = [];
	if (d.newbie) parts.push(`<p class="muted">🔒 ${esc(d.newbie)}</p>`);
	parts.push(`<p class="muted">今天已交易 ${d.quota.deals}/${d.quota.maxDeals} 笔，已付出 $${d.quota.volume}/$${d.quota.maxVolume}。</p>`);
	if (d.mail.length) {
		const rows = d.mail.map((m) => `<div class="row"><span class="ico">📬</span><span class="body">${esc(m.text)}${m.cash ? `<small>$${m.cash}</small>` : ''}</span></div>`).join('');
		parts.push(`<div class="list" style="margin-top:8px">${rows}</div><div class="inline" style="margin-top:8px"><button class="primary" data-mkt="claim">领取邮箱</button></div>`);
	}
	if (d.mine.length) {
		const rows = d.mine.map((l) => {
			const it = getItem(l.item);
			if (!it) return '';
			const what = l.kind === 'fixed' ? `寄卖 $${l.price}` : l.bid ? `拍卖 · 最高 $${l.bid}` : `拍卖 · 起拍 $${l.price}，还没人出价`;
			const canCancel = l.kind === 'fixed' || !l.bid;
			return `<div class="row"><span class="ico">${it.icon}</span><span class="body">${esc(it.name)}<small>${what} · ${left(l.endsAt, now)}</small></span><span class="meta">${canCancel ? `<button data-mkt="cancel" data-lot="${esc(l.id)}">撤回</button>` : ''}</span></div>`;
		}).join('');
		parts.push(`<b>我挂的</b><div class="list" style="margin-top:8px">${rows}</div>`);
	}
	const shown = d.lots.slice(0, 20);
	if (shown.length) {
		const rows = shown.map((l) => {
			const it = getItem(l.item);
			if (!it) return '';
			const room = roomFor(s, l.item) >= 1;
			const ref = `商店价 $${it.price}`;
			if (l.kind === 'fixed') {
				const why = d.newbie ? '新角色' : !room ? '带满了' : s.cash < l.price ? `需要 $${l.price}` : '';
				return `<div class="row"><span class="ico">${esc(l.avatar)}</span><span class="body">${it.icon} ${esc(it.name)} · ${esc(l.name)}<small>${why ? esc(why) : ref} · ${left(l.endsAt, now)}</small></span><span class="meta"><button class="primary" data-mkt="buy" data-lot="${esc(l.id)}" ${why ? 'disabled' : ''}>$${l.price} 买</button></span></div>`;
			}
			const next = l.next;
			const why = l.leading ? '你是最高价' : d.newbie ? '新角色' : s.cash < next ? `需要 $${next}` : '';
			return `<div class="row"><span class="ico">${esc(l.avatar)}</span><span class="body">${it.icon} ${esc(it.name)} · ${esc(l.name)} 拍卖<small>${l.bid ? `最高 $${l.bid}` : `起拍 $${l.price}`} · ${ref} · ${left(l.endsAt, now)}</small></span><span class="meta"><button class="primary" data-mkt="bid" data-lot="${esc(l.id)}" data-amount="${next}" ${why ? 'disabled' : ''}>${why ? esc(why) : `出 $${next}`}</button></span></div>`;
		}).join('');
		parts.push(`<b>在卖的</b><div class="list" style="margin-top:8px">${rows}</div>`);
	} else parts.push('<p class="muted">现在没有别人挂的东西。</p>');
	if (pick) parts.push(sellPicker(esc, s, d, pick));
	else if (!d.newbie && Object.keys(s.inventory).some((id) => priceBand(id))) parts.push('<div class="inline" style="margin-top:8px"><button data-mkt="sellpick">挂一件东西</button></div>');
	return `<div class="card market">${head}${parts.join('')}</div>`;
}

function sellPicker(esc: Esc, s: PlayerState, d: MarketData, pick: SellPick): string {
	const open = d.mine.length;
	const cancel = '<div class="inline" style="margin-top:8px"><button data-mkt="pickcancel">不挂了</button></div>';
	if (!pick.item) {
		const rows = Object.keys(s.inventory).map((id) => getItem(id)).filter((x): x is NonNullable<typeof x> => !!x && !!priceBand(x.id))
			.map((it) => `<button class="row" data-mkt="pickitem" data-item="${esc(it.id)}"><span class="ico">${it.icon}</span><span class="body">${esc(it.name)} ×${s.inventory[it.id]}<small>商店价 $${it.price}</small></span></button>`).join('');
		return `<div class="trade-pick"><b>挂哪一件？</b><div class="list" style="margin-top:8px">${rows || '<p class="muted">背包里没有能挂的东西。</p>'}</div>${cancel}</div>`;
	}
	const it = getItem(pick.item);
	if (!it) return '';
	if (!pick.kind) {
		return `<div class="trade-pick"><b>${it.icon} ${esc(it.name)}：怎么卖？</b><div class="inline" style="margin-top:8px"><button data-mkt="pickkind" data-kind="fixed">一口价寄卖</button> <button data-mkt="pickkind" data-kind="auction">拍卖</button></div>${cancel}</div>`;
	}
	const hours = pick.kind === 'fixed' ? [EXCHANGE.fixedHours] : [...EXCHANGE.auctionHours];
	const btns = hours.map((h) => pricePresets(it.id).map((pr) => {
		const why = listBlocked(s, { kind: pick.kind!, item: it.id, price: pr, hours: h }, open);
		const fee = feeOf(pr, EXCHANGE.listFeeRate);
		return `<button data-mkt="sell" data-item="${esc(it.id)}" data-kind="${pick.kind}" data-price="${pr}" data-hours="${h}" ${why ? `disabled title="${esc(why)}"` : ''}>$${pr}${pick.kind === 'auction' ? ` · ${h} 小时` : ''}<small> 挂单费 $${fee}</small></button>`;
	}).join(' ')).join('<br>');
	return `<div class="trade-pick"><b>${it.icon} ${esc(it.name)}：${pick.kind === 'fixed' ? '一口价' : '起拍价'}多少？</b><p class="muted">价格在商店价 $${it.price} 的 ${EXCHANGE.priceMin}–${EXCHANGE.priceMax} 倍之间。</p><div class="inline" style="margin-top:8px;flex-wrap:wrap">${btns}</div>${cancel}</div>`;
}

const side = (item: string | undefined, cash = 0): SwapSide => ({ items: item ? [{ item, n: 1 }] : [], cash });

/** 面交的加钱选项：不加钱；按商店价差价由少的一方补（差价不在允许区间时不给这个选项） */
export function swapCashOptions(give: string | undefined, want: string | undefined): { label: string; give: number; want: number }[] {
	const out = [] as { label: string; give: number; want: number }[];
	if (give && want) out.push({ label: '直接换', give: 0, want: 0 });
	const g = sideValue(side(give));
	const w = sideValue(side(want));
	if (w > g && want) {
		const band = swapCashBand(side(want), side(give));
		const d = w - g;
		if (band && d >= band.min && d <= band.max) out.push({ label: `我补 $${d}`, give: d, want: 0 });
	}
	if (g > w && give) {
		const band = swapCashBand(side(give), side(want));
		const d = g - w;
		if (band && d >= band.min && d <= band.max) out.push({ label: `对方付我 $${d}`, give: 0, want: d });
	}
	return out;
}

/** 面交换物的选择器：先选给什么、再选要什么、最后选加不加钱 */
export function swapPicker(esc: Esc, s: PlayerState, pick: SwapPick): string {
	const cancel = '<div class="inline" style="margin-top:8px"><button data-swap="cancel">不换了</button></div>';
	const tip = `<p class="muted">⚠️ ${esc(SAFETY_TIP)}</p>`;
	if (pick.give === undefined) {
		const rows = Object.keys(s.inventory).map((id) => getItem(id)).filter((x): x is NonNullable<typeof x> => !!x && !!priceBand(x.id))
			.map((it) => `<button class="row" data-swap="give" data-item="${esc(it.id)}"><span class="ico">${it.icon}</span><span class="body">${esc(it.name)} ×${s.inventory[it.id]}<small>商店价 $${it.price}</small></span></button>`).join('');
		return `<div class="trade-pick"><b>和${esc(pick.name)}面交：你拿出什么？</b><div class="list" style="margin-top:8px"><button class="row" data-swap="give" data-item=""><span class="body">什么也不拿（只买对方的东西）</span></button>${rows}</div>${tip}${cancel}</div>`;
	}
	if (pick.want === undefined) {
		const rows = ITEMS.filter((it) => it.price > 0 && it.id !== pick.give).map((it) => `<button class="row" data-swap="want" data-item="${esc(it.id)}"><span class="ico">${it.icon}</span><span class="body">${esc(it.name)}<small>商店价 $${it.price}</small></span></button>`).join('');
		return `<div class="trade-pick"><b>想从${esc(pick.name)}那里换来什么？</b><div class="list" style="margin-top:8px">${pick.give ? '<button class="row" data-swap="want" data-item=""><span class="body">什么也不要（卖给对方）</span></button>' : ''}${rows}</div>${cancel}</div>`;
	}
	const opts = swapCashOptions(pick.give || undefined, pick.want || undefined);
	const btns = opts.map((o) => `<button class="primary" data-swap="send" data-give-cash="${o.give}" data-want-cash="${o.want}" ${o.give > s.cash ? 'disabled' : ''}>${esc(o.label)}</button>`).join(' ');
	const g = pick.give ? getItem(pick.give) : undefined;
	const w = pick.want ? getItem(pick.want) : undefined;
	return `<div class="trade-pick"><b>${g ? `${g.icon} ${esc(g.name)}` : '钱'} ⇄ ${w ? `${w.icon} ${esc(w.name)}` : '钱'}</b>${btns ? `<div class="inline" style="margin-top:8px">${btns}</div>` : '<p class="muted">这样换不了：带钱的交易按商店价算，差价要在允许范围内。</p>'}<p class="muted">带钱的面交：收钱的一方付 ${Math.round(EXCHANGE.swapFee * 100)}% 手续费；新角色不能带钱交易。</p>${tip}${cancel}</div>`;
}

/** 收到的面交请求的一行说明 */
export function swapDesc(esc: Esc, give?: SwapSide, want?: SwapSide): string {
	const d = (x?: SwapSide) => {
		if (!x) return '';
		const items = x.items.map((y) => { const it = getItem(y.item); return it ? `${it.icon}${esc(it.name)}${y.n > 1 ? `×${y.n}` : ''}` : ''; });
		return [...items, ...(x.cash ? [`$${x.cash}`] : [])].join('、') || '什么也没有';
	};
	return `拿出 ${d(give)}，想换你的 ${d(want)}`;
}

