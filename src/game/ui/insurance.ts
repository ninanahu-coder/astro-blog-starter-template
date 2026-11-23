// 「我 · 资产」里的保险卡：每种保险的状态、保费、免赔额和买 / 续保按钮。所有插进 HTML 的文字都过 esc（由页面传入）。
import { LOSS_LABEL, POLICIES } from '../data/insurance.ts';
import { coverActive, insureBlocked, premiumFor, recentClaims } from '../core/insurance.ts';
import { dayOf } from '../core/time.ts';
import type { PlayerState } from '../core/types.ts';

export function insuranceCard(s: PlayerState, hasVehicle: boolean, esc: (v: unknown) => string): string {
	const day = dayOf(s.clock);
	const rows = POLICIES.map((p) => {
		if (p.compulsory) {
			if (!hasVehicle) return '';
			return `<div class="row" style="margin-top:8px"><span class="ico">${esc(p.icon)}</span><span class="body">${esc(p.name)}<small>${esc(p.desc)}</small></span><span class="muted">已含</span></div>`;
		}
		const c = Object.hasOwn(s.cover, p.id) ? s.cover[p.id] : undefined;
		const status = c && coverActive(s.cover, p.id, day) ? `保障中，到第 ${c.until} 天`
			: c && c.until > day ? `第 ${c.from + 1} 天起生效`
			: '未投保';
		const n = recentClaims(c, day);
		const price = premiumFor(s.cover, p.id, day);
		const blocked = insureBlocked(s, p.id, day);
		const terms = `${p.days} 天 $${price}${n ? `（近一年出险 ${n} 次，已加价）` : ''} · 免赔额 $${p.excess}${p.wait ? ` · 新买 ${p.wait} 天后生效` : ''}`;
		const covers = p.covers.map((k) => LOSS_LABEL[k]).join('、');
		const btn = `<button data-insure="${esc(p.id)}"${blocked ? ` disabled title="${esc(blocked)}"` : ''}>${c && c.until > day ? '续保' : '投保'}</button>`;
		return `<div class="row" style="margin-top:8px"><span class="ico">${esc(p.icon)}</span><span class="body">${esc(p.name)} · ${esc(status)}<small>${esc(p.desc)}</small><small>${esc(terms)}；赔：${esc(covers)}${blocked ? `；${esc(blocked)}` : ''}</small></span>${btn}</div>`;
	}).join('');
	return `<div class="card"><h3>保险</h3><p>出了事有对口的保险只付免赔额，没有就全额自付。保费、免赔额都是参照真实价格的待平衡数值。</p>${rows}</div>`;
}
