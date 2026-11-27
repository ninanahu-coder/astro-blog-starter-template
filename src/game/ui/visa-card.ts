// 「我」页的签证卡片（第 43 批）：纯函数，返回 HTML 字符串，所有插值都过 esc()。页面和测试共用。
import { daysLeft, ieltsAt, getVisaKind, visaAge, visaExperienceDays, visaKindNow, visaOptions, visaPoints, years } from '../core/immigration.ts';
import { getCareer } from '../core/engine.ts';
import { OCCUPATIONS, VISA_DISCLAIMER, VISA_RULES, VISA_SOURCE } from '../data/visas.ts';
import type { PlayerState, Region } from '../core/types.ts';

export const escHtml = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 不走签证路线（非留学生出身）返回空串 */
export function visaCardHtml(s: PlayerState, region: Region, esc: (s: unknown) => string = escHtml): string {
	const kind = visaKindNow(s);
	if (kind === 'none') return '';
	const v = s.visa;
	const def = getVisaKind(kind);
	const left = daysLeft(s);
	const status = kind === 'pr' ? '永久，不会到期' : kind === 'expired' ? '已过期：不能工作' : left === 0 ? '今天到期' : `${left} 天后到期`;
	const occ = v.occ ? OCCUPATIONS.find((o) => o.career === v.occ) : undefined;
	const expRows = OCCUPATIONS.map((o) => ({ title: o.title, days: visaExperienceDays(s, o.career) })).filter((x) => x.days > 0).sort((a, b) => b.days - a.days);
	const shown = expRows.slice(0, 3).map((x) => `${x.title} ${years(x.days)} 年`);
	if (expRows.length > 3) shown.push(`其他 ${expRows.length - 3} 个职业`);
	const course = v.course ? `在读${v.course.award === 'master' ? '硕士' : '本科'}，${Math.max(0, v.course.end - Math.floor(s.clock / 1440))} 天后毕业` : `学历：${{ none: '无', bachelor: '本科', master: '硕士' }[v.degree]}`;
	const facts = [
		`${visaAge(s)} 岁`,
		`雅思 ${v.ielts || '未考'}`,
		course,
		shown.length ? `清单职业经验：${shown.join(' · ')}` : `清单职业经验 ${years(v.exp)} 年${occ ? `（${occ.title}）` : ''}`,
		...(v.sponsor ? [`担保：${getCareer(v.sponsor.career)?.name ?? ''} ${years(v.sponsor.days)} 年`] : []),
	];
	const skilledDays = OCCUPATIONS.filter((o) => o.skilled).reduce((best, o) => Math.max(best, visaExperienceDays(s, o.career)), 0);
	const pts = visaPoints(s, undefined, skilledDays);
	const ptsHtml = kind === 'pr' ? '' : `<details style="margin-top:6px"><summary>技术移民打分：${pts.total} 分（及格 ${VISA_RULES.points.pass}）</summary>${pts.lines.map((l) => `<p class="muted">${esc(l.label)}：+${l.pts}</p>`).join('')}<p class="muted">州政府提名另加：190 +5，491 +15。</p></details>`;
	const routes = visaOptions(s, region).map(({ route, blocked, points }) =>
		`<div class="row" style="margin-top:8px"><span class="body">${esc(route.name)}（${esc(route.sub)}）· $${route.fee}<small>${esc(blocked ?? route.desc)}${points !== undefined ? ` · ${points} 分` : ''}</small></span><button data-visa="${esc(route.id)}" ${blocked ? 'disabled' : ''}>申请</button></div>`).join('');
	const t = ieltsAt(s, region);
	const ieltsHtml = t ? `<div class="row" style="margin-top:8px"><span class="body">考雅思 · $${t.fee}<small>${esc(t.blocked ?? `${Math.round(VISA_RULES.ielts.minutes / 60)} 小时，约 ${Math.round(t.chance * 100)}% 的几率涨半分（魅力越高越容易）`)}</small></span><button data-visa-ielts ${t.blocked ? 'disabled' : ''}>报名</button></div>` : '';
	return `<div class="card"><h3>${def.icon} 签证：${esc(def.name)}${def.sub ? `（${esc(def.sub)}）` : ''}</h3>
		<p>${esc(status)} · ${facts.map(esc).join(' · ')}</p><p class="muted">${esc(def.desc)}</p>${ptsHtml}${routes}${ieltsHtml}
		<p class="muted" style="margin-top:8px">${esc(VISA_DISCLAIMER)}真实规定见 <a href="${esc(VISA_SOURCE.url)}" target="_blank" rel="noopener">${esc(VISA_SOURCE.name)}</a>。</p></div>`;
}
