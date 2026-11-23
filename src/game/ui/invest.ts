// 「我 · 资产」页的理财卡片（第 25 批）。纯函数：只读存档（客户端存档里的 quotes 是服务端算好的行情），返回 HTML。
// 所有插进 HTML 的文字都过 esc；数字由本函数自己格式化。按钮用 data-asset="buy|sell" + data-asset-id，由页面脚本问金额后发动作。
import { ASSET_MIN_TRADE, QUOTE_DAYS } from '../data/assets.ts';
import { marketQuotes, type AssetQuote } from '../core/invest.ts';
import { priceHistory } from '../core/market.ts';
import type { PlayerState } from '../core/types.ts';

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

/** 单价显示：$1 以上保留两位小数，更便宜的保留 4 位有效数字（虚拟币可能跌到几分钱） */
export function fmtPrice(p: number): string {
	if (!(p > 0) || !Number.isFinite(p)) return '—';
	return p >= 1 ? `$${p.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${Number(p.toPrecision(4))}`;
}

/** 涨跌幅文字，带正负号，一位小数 */
export function fmtChange(from: number, to: number): string {
	if (!(from > 0)) return '—';
	const pct = ((to - from) / from) * 100;
	const r = Math.round(pct * 10) / 10;
	return `${r > 0 ? '+' : ''}${r === 0 ? '0' : r}%`;
}

/** 走势折线的 points（viewBox 0 0 w h），一个点时画水平线 */
export function sparkPoints(prices: number[], w = 96, h = 28): string {
	if (!prices.length) return '';
	const lo = Math.min(...prices);
	const hi = Math.max(...prices);
	const span = hi - lo || 1;
	const pts = prices.length === 1 ? [prices[0], prices[0]] : prices;
	return pts.map((p, i) => `${Math.round((i / (pts.length - 1)) * w * 10) / 10},${Math.round((h - 2 - ((p - lo) / span) * (h - 4)) * 10) / 10}`).join(' ');
}

function row(q: AssetQuote, hist: number[]): string {
	const a = q.asset;
	const first = hist[0] ?? q.price;
	const change = fmtChange(first, q.price);
	const days = Math.max(1, hist.length);
	const trend = q.price > first ? 'up' : q.price < first ? 'down' : 'flat';
	const spark = a.vol > 0 && hist.length > 1
		? `<svg class="spark ${trend}" viewBox="0 0 96 28" width="96" height="28" role="img" aria-label="${esc(a.name)}近 ${days} 天走势，${change}"><polyline points="${sparkPoints(hist)}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
		: '';
	const pnl = q.units > 0 ? q.value - q.cost : 0;
	const held = q.units > 0
		? `<small>持有，现在卖出到手 ${money(q.value)} · 成本 ${money(q.cost)} · <b class="${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '赚' : '亏'} ${money(Math.abs(pnl))}</b></small>`
		: '';
	const fee = a.fee ? `买卖各收 ${Math.round(a.fee * 1000) / 10}% 手续费` : '没有手续费';
	return `<div style="margin-top:10px"><div class="row"><span class="ico" aria-hidden="true">${a.icon}</span><span class="body">${esc(a.name)} <span class="muted">${fmtPrice(q.price)}${a.vol > 0 ? ` · 近 ${days} 天 <b class="${trend === 'down' ? 'down' : 'up'}">${change}</b>` : ` · 年化 ${Math.round(a.drift * 1000) / 10}%`}</span>${held}<small>${esc(a.desc)}（${fee}）</small></span>${spark ? `<span class="meta">${spark}</span>` : ''}</div>
	<div class="inline" style="margin-top:6px;flex-wrap:wrap"><button data-asset="buy" data-asset-id="${a.id}"${q.buyBlocked ? ' disabled' : ''}>${a.kind === 'cash' ? '存入' : '买入'}</button><button data-asset="sell" data-asset-id="${a.id}"${q.sellBlocked ? ' disabled' : ''}>${a.kind === 'cash' ? '取出' : '卖出'}</button></div></div>`;
}

/** 理财卡片 */
export function investCard(s: PlayerState): string {
	const quotes = marketQuotes(s);
	const total = quotes.reduce((sum, q) => sum + q.value, 0);
	const rows = quotes.map((q) => row(q, priceHistory(s, q.asset, QUOTE_DAYS))).join('');
	return `<div class="card invest"><h3>理财${total ? ` · 持仓 ${money(total)}` : ''}</h3><p>随时随地下单，每次花 10 分钟，至少 ${money(ASSET_MIN_TRADE)}。价格每天变一次；除了储蓄，都可能亏钱。鸸鹋币是游戏里虚构的，不能兑换真钱。</p>${rows}</div>`;
}

/** 下单前问金额时的默认值：买入默认现金的一半（取整到 10），卖出默认全部 */
export function defaultAmount(s: PlayerState, id: string, op: 'buy' | 'sell'): number {
	const q = marketQuotes(s).find((x) => x.asset.id === id);
	if (!q) return 0;
	if (op === 'sell') return Math.ceil(q.units * q.price);
	return Math.max(ASSET_MIN_TRADE, Math.floor(s.cash / 2 / 10) * 10);
}
