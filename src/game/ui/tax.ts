// 「我 · 资产」里的税务卡片：身份、TFN / ABN、本财年账目和估算、待申报的上一财年、欠税。
// 纯函数，只拼 HTML；按钮带 data-tax，点击由 earth.astro 发 { t: 'tax', op }。所有插值都经过调用方传入的 esc()。
import { TAX_GAME } from '../data/tax.ts';
import { assess, fyOf, RESIDENCY_LABEL, returnPreview, taxStatus, tfnState } from '../core/tax.ts';
import { dayOf, YEAR_DAYS } from '../core/time.ts';
import type { PlayerState } from '../core/types.ts';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** 退或补一句话：正数补税，负数退税 */
const dueText = (due: number) => (due < 0 ? `退税 ${money(-due)}` : due > 0 ? `补税 ${money(due)}` : '不补不退');

export function taxCard(s: PlayerState, esc: (v: unknown) => string): string {
	const t = s.tax;
	const day = dayOf(s.clock);
	const st = taxStatus(s.origin);
	const tfn = tfnState(t, day);
	const rows: string[] = [];
	rows.push(`<p>身份：${esc(RESIDENCY_LABEL[st.residency])}${st.medicareExempt ? '（不交 Medicare 税）' : ''}</p>`);

	if (tfn === 'none') rows.push(`<p>⚠️ 还没有税号（TFN）：雇主会按最高税率预扣工资（${st.residency === 'resident' ? '47%' : '45%'}），也没法报税退回。</p><div class="inline"><button data-tax="tfn">申请 TFN（网上办，免费）</button></div>`);
	else if (tfn === 'waiting') rows.push(`<p>TFN 办理中，还要 ${esc(t.tfn - day)} 天。等号码期间按正常税率预扣。</p>`);
	else rows.push(`<p>TFN ✓${t.abn ? ' · ABN ✓（个体户）' : ''}</p>`);
	if (tfn === 'ok' && !t.abn) rows.push(`<div class="inline"><button data-tax="abn">注册 ABN</button></div><p style="margin-top:4px"><small>有 ABN 后街头表演算生意收入：多挣 ${esc(Math.round(TAX_GAME.abnBonus * 100))}%，报税时交税。</small></p>`);

	// 本财年
	const b = t.book;
	const left = t.fy * YEAR_DAYS - day;
	const est = assess(b, st);
	const parts = [`工资 ${money(b.wages)}（已预扣 ${money(b.withheld)}）`];
	if (b.biz) parts.push(`个体户 ${money(b.biz)}`);
	if (b.rent || b.rentCost) parts.push(`出租 ${money(b.rent)} − 费用 ${money(b.rentCost)}`);
	rows.push(`<p style="margin-top:6px"><b>第 ${esc(t.fy)} 财年</b>（还剩 ${esc(Math.max(0, left))} 天）：${parts.map(esc).join('，')}</p>`);
	if (b.wages || b.biz || b.rent) rows.push(`<p><small>按现在的账目估算：应纳税 ${esc(money(est.tax))}，${esc(dueText(est.tax - b.withheld))}。</small></p>`);

	// 待申报
	const p = returnPreview(s);
	if (p) {
		const when = p.late ? `已过报税期${p.penalty ? `，现在申报要加逾期罚款 ${money(p.penalty)}` : ''}` : `报税期还剩 ${p.daysLeft} 天`;
		const why = tfn === 'ok' ? '' : '（先办好 TFN）';
		rows.push(`<p style="margin-top:6px"><b>第 ${esc(p.fy)} 财年待申报</b>：应纳税 ${esc(money(p.assess.tax))}，已预扣 ${esc(money(p.withheld))} → ${esc(dueText(p.due))}。${esc(when)}。</p>
			<div class="inline"><button data-tax="lodge" ${tfn === 'ok' ? '' : 'disabled'}>报税${esc(why)}</button></div>`);
	}
	if (t.debt) rows.push(`<p>欠税 ${esc(money(t.debt))}，每周结算时分期扣。</p>`);
	if (t.last) rows.push(`<p><small>上次申报（第 ${esc(t.last.fy)} 财年）：${esc(dueText(t.last.due))}${t.last.penalty ? `，罚款 ${esc(money(t.last.penalty))}` : ''}。</small></p>`);
	rows.push(`<p><small>规则参照 ATO 2026–27 年度税率，游戏里一年一结、金额按比例缩小。报税期是每年开头 ${esc(TAX_GAME.lodgeDays)} 天（现实是 7 月 1 日到 10 月 31 日）。</small></p>`);
	return `<div class="card"><h3>🧾 税务 · 第 ${esc(fyOf(day))} 财年</h3>${rows.join('')}</div>`;
}
