// 住处卡片里的「室友」一块：只拼 HTML，不改状态。所有插值经过页面传进来的 esc()。
import { activeMates, avgVibe, choreDone, dutyFor, flatAuto, flatBeds, flatCandidates, flatChoiceBlocked, flatText, getFlatEvent, getFlatmate, rentShare, subletIncome } from '../core/flatmates.ts';
import { choreBlocked, subletBlocked } from '../core/flat-actions.ts';
import { FLAT_RULES } from '../data/flatmates.ts';
import { dayOf } from '../core/time.ts';
import type { PlayerState } from '../core/types.ts';

type Esc = (v: unknown) => string;

/** 关系分数的一句话 */
export function vibeLabel(v: number): string {
	return v >= 60 ? '处得很好' : v >= 20 ? '相处不错' : v > -20 ? '还算客气' : v > FLAT_RULES.leaveBelow ? '有点僵' : '快住不下去了';
}

/** 卫生的一句话 */
export const cleanLabel = (c: number) => (c >= 70 ? '干净' : c >= FLAT_RULES.messyBelow ? '还行' : '乱糟糟');

/**
 * 住处卡片里的室友区块。人在住处时显示值日、室友、事件和找室友；不在住处或转租中时只显示转租 / 收回。
 * 没有租的住处、或住处不支持合租且人在家时返回空串。
 */
export function flatHtml(s: PlayerState, esc: Esc): string {
	if (!s.home || s.home.owned) return '';
	const f = s.flatshare;
	if (s.home.loc !== s.loc || f.sublet) return subletRow(s, esc);
	if (flatBeds(s) <= 1) return '';
	const mates = activeMates(s);
	const parts: string[] = [];
	const share = rentShare(s);
	parts.push(`<p style="margin-top:8px" class="muted">${flatAuto(s) ? '合租房间：室友由房东安排，房租固定' : `可住 ${flatBeds(s)} 人，有室友时房租和水电网（$${FLAT_RULES.billsWeek[s.home.type] ?? 0}/周）按人头分`} · 你这周那份 $${share}${f.sublet ? `，转租收回 $${subletIncome(s)}` : ''}</p>`);
	if (mates.length) {
		const duty = dutyFor(s);
		const dutyName = duty === 'me' ? '你' : getFlatmate(duty)?.name ?? '室友';
		const choreWhy = choreBlocked(s);
		parts.push(`<div class="row" style="margin-top:8px"><span class="body">🧹 家里${esc(cleanLabel(f.clean))}（${f.clean}）<small>这周轮到${esc(dutyName)}值日${duty === 'me' ? (choreDone(s) ? '，已经做过了' : `，${Math.max(0, s.nextWeek - dayOf(s.clock))} 天内做一次`) : ''} · 平均关系 ${Math.round(avgVibe(s))}</small></span><button data-flat="chore" ${choreWhy ? 'disabled' : ''}>做家务</button></div>`);
		if (choreWhy && choreWhy !== '家里已经很干净了') parts.push(`<p style="margin-top:4px">${esc(choreWhy)}</p>`);
		for (const m of mates) {
			const def = getFlatmate(m.id);
			if (!def) continue;
			const note = [vibeLabel(m.vibe), m.owes ? `欠你 $${m.owes}` : '', m.out !== undefined ? `第 ${m.out + 1} 天搬走` : ''].filter(Boolean).join(' · ');
			const askOut = !flatAuto(s) && m.out === undefined ? `<button data-flat="askout" data-flat-mate="${esc(m.id)}">请 TA 搬走</button>` : '';
			parts.push(`<div class="row" style="margin-top:8px"><span class="body">${esc(def.avatar)} ${esc(def.name)}<small>${esc(def.bio)} ${esc(note)}</small></span>${askOut}</div>`);
		}
	}
	const ev = f.ev && getFlatEvent(f.ev.id);
	if (f.ev && ev) {
		const mate = f.ev.mate;
		parts.push(`<div style="margin-top:10px"><p><b>${esc(ev.icon)} ${esc(ev.title)}</b> ${esc(flatText(ev.text, mate))}</p><div class="inline" style="margin-top:6px">${ev.choices.map((c, i) => {
			const why = flatChoiceBlocked(s, c);
			return `<button data-flat="resolve" data-flat-choice="${i}" ${why ? 'disabled' : ''}>${esc(flatText(c.label, mate))}${why ? `（${esc(why)}）` : ''}</button>`;
		}).join('')}</div><p class="muted" style="margin-top:4px">不处理的话 ${FLAT_RULES.eventExpireDays} 天后作废，TA 会有点不高兴。</p></div>`);
	}
	const cands = flatCandidates(s);
	if (cands.length) {
		parts.push(`<details style="margin-top:8px"><summary class="muted">找室友（这周有 ${cands.length} 个人来看房）</summary>${cands.map(({ def, blocked }) => `<div class="row" style="margin-top:8px"><span class="body">${esc(def.avatar)} ${esc(def.name)}<small>${esc(blocked ?? def.bio)}</small></span><button data-flat="invite" data-flat-mate="${esc(def.id)}" ${blocked ? 'disabled' : ''}>请 TA 住进来</button></div>`).join('')}</details>`);
	}
	return parts.join('');
}

/** 不在住处时：转租 / 收回 */
function subletRow(s: PlayerState, esc: Esc): string {
	const on = s.flatshare.sublet;
	const why = subletBlocked(s, !on);
	if (why) return '';
	return `<div class="row" style="margin-top:8px"><span class="body">${on ? '🔁 房间转租中' : '出远门？'}<small>${on ? `每周收回 $${subletIncome(s)}，转租期间不能回去住` : `短期转租出去，每周收回你那份房租的 ${Math.round(FLAT_RULES.subletRate * 100)}%`}</small></span><button data-flat="${on ? 'unsublet' : 'sublet'}">${on ? '收回房间' : '转租'}</button></div>`;
}
