// 二手市场「邻里换手墙」卡片：只拼 HTML 字符串，所有来自数据和存档的文字都过 esc()。
// 点击由 earth.astro 的 [data-wall] 处理（不用 data-swap：那是 main 面交换物的选择器在用），发 { t: 'swap', ... } 给服务端结算。
import { buyBlocked, buyCost, goodName, haggleChance, sellOffers, swapBoard, swapOwned, type SwapListing } from '../core/secondhand.ts';
import type { PlayerState, Region } from '../core/types.ts';
import { BUYER_FLAGS, LISTING_FLAGS, SWAP, SWAP_NAME } from '../data/secondhand.ts';

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `$${n.toLocaleString()}`;

const flagLine = (flags: string[], table: typeof LISTING_FLAGS) =>
	flags.length ? `<br>${flags.map((id) => `🚩 ${esc(table.find((f) => f.id === id)?.text ?? id)}`).join('<br>')}` : '';

function listingRow(s: PlayerState, l: SwapListing): string {
	const pick = buyBlocked(s, l, 'pickup');
	const pre = buyBlocked(s, l, 'prepay');
	const fee = buyCost(s, l, 'prepay').fee;
	const carry = buyCost(s, l, 'pickup').fee;
	const where = l.remote ? `${esc(l.locName)}（外地）` : esc(l.locName);
	const km = l.good.kind === 'vehicle' ? ` · ${l.km.toLocaleString()} 公里` : '';
	const why = l.done ? '今天已经处理过' : pick && pre ? pre : pick ?? '';
	return `<div class="row" style="margin-top:8px"><span class="ico">${esc(l.icon)}</span><span class="body">${esc(l.name)} · ${money(l.ask)}<small>${esc(l.good.cat)} · ${where}${km}${carry ? ` · 没车自提要加搬运 $${carry}` : ''}${flagLine(l.flags, LISTING_FLAGS)}${why ? `<br>${esc(why)}` : ''}</small></span></div>
		${l.done ? '' : `<div class="inline" style="margin-top:4px"><button data-wall="buy" data-wall-id="${esc(l.id)}" data-wall-ref="${esc(l.good.ref)}" data-wall-how="pickup" ${pick ? 'disabled' : ''}>上门看货自提</button><button data-wall="buy" data-wall-id="${esc(l.id)}" data-wall-ref="${esc(l.good.ref)}" data-wall-how="prepay" ${pre ? 'disabled' : ''}>先转账送货（运费 $${fee}）</button></div>`}`;
}

/** 当前地点的换手墙卡片；这里没有换手墙返回空字符串 */
export function swapCard(s: PlayerState, region: Region): string {
	const board = swapBoard(s, region);
	if (!board) return '';
	const season = board.season.id === 'normal' ? '' : `<p style="margin-top:4px">📦 ${esc(board.season.name)}：${esc(board.season.desc)}</p>`;
	const stats = s.swap.dodged || s.swap.lost ? `<p class="muted" style="margin-top:4px">识破骗局 ${s.swap.dodged} 次 · 被骗 ${s.swap.lost} 次</p>` : '';
	const haggle = `<label class="muted" style="display:block;margin-top:6px"><input type="checkbox" id="swap-haggle"> 先砍价（成功率约 ${Math.round(haggleChance(s, board.season) * 100)}%，魅力越高越容易）</label>`;
	const buys = board.listings.map((l) => listingRow(s, l)).join('');
	const sells = swapOwned(s).map((g) => {
		const so = sellOffers(s, region, g.kind, g.ref);
		if (!so) return '';
		const { name, icon } = goodName(g);
		const rows = so.offers.map((o, i) => `<div class="row" style="margin-top:6px"><span class="body">买家 ${i + 1} 出 ${money(o.amount)}<small>${o.done ? '已经谈过了' : o.flags.length ? '' : '约好当面付款'}${flagLine(o.flags, BUYER_FLAGS)}</small></span></div>
			${o.done || so.blocked ? '' : `<div class="inline" style="margin-top:4px"><button data-wall="sell" data-wall-kind="${g.kind}" data-wall-ref="${esc(g.ref)}" data-wall-buyer="${i}" data-wall-verify="1">等钱到账再交货</button><button data-wall="sell" data-wall-kind="${g.kind}" data-wall-ref="${esc(g.ref)}" data-wall-buyer="${i}" data-wall-verify="0">直接交货</button></div>`}`).join('');
		return `<div style="margin-top:10px"><b>${esc(icon)} 卖${esc(name)}</b>${so.blocked ? `<p class="muted">${esc(so.blocked)}</p>` : ''}${rows}</div>`;
	}).join('');
	return `<details class="card"><summary><b>🪧 ${esc(SWAP_NAME)} · ${board.listings.filter((l) => !l.done).length} 条二手</b></summary>
		<p style="margin-top:6px">附近的人挂出来的二手家具、电器、车和户外用品。上门看货最稳；先转账省事，但遇到骗子钱就没了。每天最多卖 ${SWAP.sellDaily} 次。</p>${season}${stats}${haggle}${buys}
		${sells ? `<p class="section-title" style="margin-top:12px">卖掉手上的东西</p>${sells}` : ''}</details>`;
}
