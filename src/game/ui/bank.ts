// 「我 · 资产」里的银行卡片和买房、买车、买家具时的借贷按钮。只读存档、拼 HTML；所有插值经过调用方传入的 esc()。
// 规则见 core/credit.ts、core/bank.ts；设计见 docs/earth-game/banking.md。
import { bankCapacity, homeLoanOffer } from '../core/bank.ts';
import { bankDebt, bankWeekly, bnplBlocked, bnplSplit, cardMinPay, cardOffer, carOffer, creditScore, personalOffer, scoreBand, scoreParts } from '../core/credit.ts';
import { dayOf } from '../core/time.ts';
import type { PlayerState } from '../core/types.ts';
import { BANK, BNPL_WARNING } from '../data/credit.ts';
import { FURNITURE } from '../data/furniture.ts';

type Esc = (s: unknown) => string;

const KIND_NAME = { card: '信用卡', personal: '个人贷款', car: '车贷' } as const;

/** 信用分那一行的说明 */
function scoreLine(s: PlayerState, esc: Esc): string {
	const day = dayOf(s.clock);
	const score = creditScore(s.bank, day);
	if (score === null) return `<p>信用分：<b>无记录</b>（第一次申请信用卡、贷款或先买后付后开始记录；银行按 ${BANK.base} 分审批）</p>`;
	const p = scoreParts(s.bank, day);
	const parts = [
		`记录 ${p.weeks} 周`,
		`按时还款 ${p.ok} 周`,
		p.enq ? `近半年申请 ${p.enq} 次` : '',
		p.late ? `两年内逾期 ${p.late} 次` : '',
		p.def ? `五年内违约 ${p.def} 次` : '',
		p.highUse ? '信用卡用了一半以上额度' : '',
	].filter(Boolean);
	return `<p>信用分：<b>${score}</b>（${esc(scoreBand(score))}）<small style="display:block">${esc(parts.join(' · '))}</small></p>`;
}

/** 「我 · 资产」页的银行卡片 */
export function bankCardHtml(s: PlayerState, esc: Esc): string {
	const b = s.bank;
	const foot = '<p style="margin-top:8px"><small>游戏机制参照澳洲公开的规则简化，不是理财建议。</small></p>';
	if (!b.open) {
		return `<div class="card"><h3>🏦 银行</h3><p>还没有银行账户。开户免费，用护照在手机上验证身份，送一张借记卡。有了账户才能申请信用卡、贷款（包括房贷、车贷）和先买后付。</p><div class="inline" style="margin-top:6px"><button data-bank="open">开户</button></div>${foot}</div>`;
	}
	const day = dayOf(s.clock);
	const cap = bankCapacity(s);
	const rows: string[] = [];
	const warn = (x: { missed: number; def?: true }) => (x.def ? ' · ⚠️ 违约，催收中' : x.missed ? ` · ⚠️ 已欠款 ${x.missed} 次` : '');
	if (b.card) {
		const c = b.card;
		rows.push(`<div class="row" style="margin-top:8px"><span class="body">💳 信用卡 · 额度 $${c.limit}<small>欠款 $${c.bal}${c.bal ? `，每周最低还 $${cardMinPay(c.bal)}` : ''}${warn(c)} · 取现手续费 ${BANK.cashFee * 100}%、当天起计息</small></span></div>
			<div class="inline" style="margin-top:6px"><button data-bank="draw" ${c.def || c.missed || c.limit - c.bal < 10 ? 'disabled' : ''}>取现</button>${c.bal ? '<button data-bank="repay" data-bank-kind="card">还款</button>' : ''}</div>`);
	} else {
		const o = cardOffer(b, day, cap);
		rows.push(`<div class="row" style="margin-top:8px"><span class="body">💳 信用卡<small>${esc('blocked' in o ? o.blocked : `可以批 $${o.limit} 额度（按三年内还清整个额度评估）`)}</small></span><button data-bank="card" ${'blocked' in o ? 'disabled' : ''}>申请</button></div>`);
	}
	for (const l of b.loans) {
		rows.push(`<div class="row" style="margin-top:8px"><span class="body">${l.kind === 'car' ? '🚗' : '💵'} ${KIND_NAME[l.kind]} · 欠 $${l.bal.toLocaleString()}<small>每周还 $${l.pay}${l.kind === 'car' ? (l.vehicle ? ' · 车是抵押物' : ' · 车已被收走') : ''}${warn(l)}</small></span><button data-bank="repay" data-bank-kind="${l.kind}">还款</button></div>`);
	}
	if (!b.loans.some((l) => l.kind === 'personal')) {
		const o = personalOffer(b, day, cap, BANK.personal.min);
		rows.push(`<div class="row" style="margin-top:8px"><span class="body">💵 个人贷款（无抵押）<small>${esc('blocked' in o ? o.blocked : `$${BANK.personal.min}–$${BANK.personal.max}，${BANK.personal.weeks} 周还清；每周还款能力 $${cap}`)}</small></span><button data-bank="loan" ${'blocked' in o ? 'disabled' : ''}>申请</button></div>`);
	}
	for (const p of b.bnpl) {
		const name = FURNITURE.find((f) => f.id === p.item)?.name ?? '家具';
		rows.push(`<div class="row" style="margin-top:8px"><span class="body">🧾 先买后付 · ${esc(name)}<small>还剩 ${p.left} 期，每期 $${p.amt}${p.owe ? `，另欠逾期费 $${p.owe}` : ''}${warn(p)}</small></span></div>`);
	}
	const debt = bankDebt(b);
	return `<div class="card"><h3>🏦 银行</h3>${scoreLine(s, esc)}<p>借记卡 ✅ · 欠银行合计 $${debt.toLocaleString()}${debt ? ` · 每周约还 $${bankWeekly(b)}（周结算自动扣，现金不够就算欠款）` : ''}</p>${rows.join('')}
		<p style="margin-top:8px"><small>拖欠满 14 天记逾期（两年内扣分）；拖欠 60 天以上、$${BANK.defaultMin} 以上记违约（五年内扣分、银行不批新信用、转催收）；车贷违约通知 30 天后会收车。</small></p>${foot}</div>`;
}

/** 房产卡片上「贷款买」的审批说明；能批返回说明文字，批不了返回原因（都是纯文本，调用方 esc） */
export function homeLoanNote(s: PlayerState, id: string): { ok: boolean; text: string } {
	if (!s.bank.open) return { ok: false, text: '按揭要先在「我 · 资产」开银行账户。' };
	const o = homeLoanOffer(s, id);
	if ('blocked' in o) return { ok: false, text: `房贷不批：${o.blocked}` };
	return { ok: true, text: `房贷可批 $${o.loan.toLocaleString()}${o.lmi ? `（含首付不足 20% 的贷款保险 $${o.lmi}）` : ''}；按利率上浮 3 个百分点测算每周 $${o.test}。` };
}

/** 车行每辆车的「车贷」按钮（没开户、批不了就不显示或禁用） */
export function carLoanButton(s: PlayerState, id: string, net: number, esc: Esc): string {
	if (!s.bank.open || net <= 0) return '';
	const o = carOffer(s.bank, dayOf(s.clock), bankCapacity(s), net);
	const why = 'blocked' in o ? o.blocked : s.cash < o.down ? `首付需要 $${o.down}` : '';
	return `<button data-bank="carloan" data-bank-id="${esc(id)}" ${why ? `disabled title="${esc(why)}"` : ''}>${'blocked' in o ? '车贷' : `车贷（首付 $${o.down}，每周 $${o.pay}）`}</button>`;
}

/** 家具的「先买后付」按钮 */
export function bnplButton(s: PlayerState, id: string, net: number, esc: Esc): string {
	if (!s.bank.open) return '';
	const { first, amt } = bnplSplit(net);
	if (amt <= 0) return '';
	const why = bnplBlocked(s.bank, dayOf(s.clock)) ?? (s.cash < first ? `第一期需要 $${first}` : '');
	return `<button data-bank="bnpl" data-bank-id="${esc(id)}" data-bank-first="${first}" data-bank-amt="${amt}" ${why ? `disabled title="${esc(why)}"` : ''}>分 ${BANK.bnplParts} 期</button>`;
}

/** 先买后付确认框的文字 */
export const bnplConfirmText = (name: string, first: number, amt: number) =>
	`先买后付「${name}」：今天付 $${first}，之后每周 $${amt}，共 ${BANK.bnplParts - 1} 期。\n\n风险提示：\n${BNPL_WARNING.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n\n确定吗？`;
