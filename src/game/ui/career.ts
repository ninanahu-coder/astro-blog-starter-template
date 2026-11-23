// 「我 · 生涯」页和分享卡（docs/earth-game/career-stats.md）。第一次打开这一页时才加载，不进首屏。
// careerHtml / cardSvg 是纯函数（同样的存档永远画出同样的字符串），所有插值都经过 esc()。
// 分享卡是确定性渲染的 SVG（再转成 PNG），不用 AI 生成图表；卡上不带地点名、区域和坐标。
import { careerSummary, CAT_LABEL, type CareerSummary } from '../core/tally.ts';
import type { PlayerState, TallyCard } from '../core/types.ts';

export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 千分位整数，不依赖浏览器语言设置 */
export const int = (n: number) => {
	const v = Math.round(n);
	return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const money = (n: number) => `$${int(n)}`;
const dayLabel = (d: number) => (d < 0 ? '统计前' : `第 ${d + 1} 天`);
const span = (c: TallyCard, unit: '周' | '年') => (c.n > 1 ? `第 ${c.i + 1}–${c.i + c.n} ${unit}` : `第 ${c.i + 1} ${unit}`);

/** 字段标签：中文粗体 + 英文衬线小字（入境卡的栏位样式） */
const label = (zh: string, en: string, note = '') => `<div class="cs-label">${zh}<span lang="en">${en}</span>${note ? `<em>${note}</em>` : ''}</div>`;

function periodRows(c: TallyCard) {
	return `<dl class="cs-kv">
		<dt>收入</dt><dd>${money(c.earned)}</dd>
		<dt>支出</dt><dd>${money(c.spent)}${c.top ? `<small>大头是${esc(CAT_LABEL[c.top])} ${money(c.topAmt)}</small>` : ''}</dd>
		<dt>出行</dt><dd>${int(c.km)} 公里</dd>
		<dt>新去的地方</dt><dd>${int(c.places)} 个</dd>
		<dt>新认识</dt><dd>${int(c.people)} 人</dd>
	</dl>`;
}

/**
 * 「我 · 生涯」页的 HTML。placeName 由页面传入（按地点 id 查名字）；名字只出现在页面上，不进分享卡。
 */
export function careerHtml(s: PlayerState, placeName: (id: string) => string): string {
	const c = careerSummary(s);
	const since = c.from > 0 ? `收支、公里从第 ${c.from + 1} 天开始统计（这之前的没有记录）` : '从落地那天开始统计';
	const outs = c.outs.slice(0, 6).map((o) => `<li><span>${esc(o.label)}</span><b>${money(o.amt)}</b><i class="cs-bar" role="img" aria-label="${esc(o.label)}占支出 ${Math.round(o.share * 100)}%"><i style="width:${Math.max(2, Math.round(o.share * 100))}%"></i></i></li>`).join('');
	const ins = c.ins.slice(0, 3).map((o) => `${esc(o.label)} ${money(o.amt)}`).join(' · ');
	const places = c.topPlaces.map((p) => `<li><span>${esc(placeName(p.id))}</span><b>${int(p.n)} 次</b></li>`).join('');
	const timeline = c.timeline.length
		? `<ol class="cs-time">${[...c.timeline].reverse().map((m, i) => `<li${i === 0 ? ' class="new"' : ''}><span>${dayLabel(m.day)}</span>${esc(m.title)}</li>`).join('')}</ol>`
		: '<p class="cs-empty">还没有里程碑。找份工作、租个住处，或者出门走走。</p>';
	return `<div class="card cs">
		<div class="cs-head"><h3>生涯档案<span lang="en">CAREER RECORD</span></h3><p>${since}</p></div>
		<div class="cs-grid">
			<div class="cs-cell">${label('来澳', 'DAYS')}<b>${int(c.days)}</b><small>天</small></div>
			<div class="cs-cell">${label('走过', 'TRAVELLED')}<b>${int(c.places)}</b><small>个地方 · ${int(c.km)} 公里</small></div>
			<div class="cs-cell">${label('赚到', 'EARNED')}<b>${money(c.earned)}</b><small>${ins || '还没有收入'}</small></div>
			<div class="cs-cell">${label('认识', 'PEOPLE')}<b>${int(c.people.npc + c.people.players)}</b><small>${int(c.people.npc)} 位本地人 · ${int(c.people.players)} 位玩家</small></div>
		</div>
		<div class="cs-field">${label('钱去哪了', 'SPENT', money(c.spent))}${outs ? `<ul class="cs-list">${outs}</ul>` : '<p class="cs-empty">还没花过钱。</p>'}</div>
		<div class="cs-field">${label('最常去', 'FAVOURITE PLACES')}<ul class="cs-list">${places}</ul></div>
		<div class="cs-field">${label('里程碑', 'MILESTONES', `${c.timeline.length} 个`)}${timeline}</div>
	</div>
	<div class="card cs">
		<div class="cs-head"><h3>本周小结<span lang="en">THIS WEEK</span></h3><p>来澳${span(c.week, '周')}，至今</p></div>
		${periodRows(c.week)}
		${c.lastWk ? `<div class="cs-field">${label('上周', 'LAST WEEK', span(c.lastWk, '周'))}${periodRows(c.lastWk)}</div>` : ''}
		<div class="inline cs-actions"><button data-career="week">生成本周小结卡</button></div>
	</div>
	<div class="card cs">
		<div class="cs-head"><h3>年度回顾<span lang="en">YEAR IN REVIEW</span></h3><p>来澳${span(c.year, '年')}，至今（一年按 365 个游戏日）</p></div>
		${periodRows(c.year)}
		${c.lastYr ? `<div class="cs-field">${label('上一年', 'LAST YEAR', span(c.lastYr, '年'))}${periodRows(c.lastYr)}</div>` : ''}
		<div class="inline cs-actions"><button class="primary" data-career="year">生成年度回顾图</button>${c.lastYr ? '<button data-career="lastyear">上一年的回顾图</button>' : ''}</div>
		<p class="muted cs-note">分享图只有数字和里程碑，不带地点名和位置。</p>
	</div>`;
}

export type CardKind = 'week' | 'year' | 'lastyear';

/** 分享卡要的数据（全部来自 careerSummary，不含地点） */
export function cardData(s: PlayerState, kind: CardKind) {
	const c: CareerSummary = careerSummary(s);
	const period = kind === 'week' ? c.week : kind === 'lastyear' ? c.lastYr ?? c.year : c.year;
	const unit = kind === 'week' ? '周' : '年';
	const done = kind === 'lastyear' && !!c.lastYr;
	return {
		name: s.name, avatar: s.avatar, days: c.days, unit, done, which: `${done ? '那' : '这'}${unit}`,
		title: unit === '周' ? '本周小结' : '年度回顾',
		span: `来澳${span(period, unit)}${done ? '' : ' · 至今'}`,
		period,
		total: { places: c.places, km: c.km, earned: c.earned, people: c.people.npc + c.people.players },
		outs: c.outs.slice(0, 3),
		milestones: c.timeline.filter((m) => m.day >= 0).slice(-4),
	};
}

/** 分享卡尺寸（竖版，手机相册友好） */
export const CARD_W = 1080;
export const CARD_H = 1350;

const SANS = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
const SERIF = "'Songti SC', 'STSong', 'Noto Serif SC', serif";

/**
 * 分享卡 SVG：入境卡的纸色、打孔虚线、圆珠笔蓝的数字、洋红双圈章。纯函数、确定性。
 * 只放数字、类别、里程碑标题和玩家自己起的名字；不放地点名、区域、坐标。
 */
export function cardSvg(s: PlayerState, kind: CardKind): string {
	const d = cardData(s, kind);
	const p = d.period;
	const t = (x: number, y: number, size: number, fill: string, text: string, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
	const rule = (y: number) => `<line x1="72" y1="${y}" x2="${CARD_W - 72}" y2="${y}" stroke="#9db8b0" stroke-width="3" stroke-dasharray="12 9"/><circle cx="40" cy="${y}" r="18" fill="#0d1a35"/><circle cx="${CARD_W - 40}" cy="${y}" r="18" fill="#0d1a35"/>`;
	const cell = (x: number, y: number, zh: string, en: string, value: string, unit: string) =>
		t(x, y, 30, '#18263f', zh, ' font-weight="800"') + t(x + 30 * zh.length + 12, y, 18, '#4a586c', en, ` font-family="${SERIF}" letter-spacing="2.5"`) +
		t(x, y + 76, 64, '#1d3fbf', value, ' font-weight="800"') + t(x, y + 118, 26, '#4a586c', unit);
	const statY = 420;
	const stats = [
		cell(96, statY, '收入', 'EARNED', money(p.earned), d.which),
		cell(576, statY, '支出', 'SPENT', money(p.spent), p.top ? `大头是${CAT_LABEL[p.top]}` : d.which),
		cell(96, statY + 190, '出行', 'TRAVELLED', int(p.km), '公里'),
		cell(576, statY + 190, '新去的地方', 'PLACES', int(p.places), '个'),
	].join('');
	const outs = d.outs.map((o, i) => {
		const y = 900 + i * 62;
		const w = Math.max(6, Math.round(o.share * 520));
		return t(96, y, 28, '#18263f', o.label) + `<rect x="380" y="${y - 24}" width="520" height="26" rx="13" fill="#e6eeeb"/><rect x="380" y="${y - 24}" width="${w}" height="26" rx="13" fill="#1d3fbf"/>` + t(920, y, 26, '#4a586c', `${Math.round(o.share * 100)}%`);
	}).join('');
	const ms = d.milestones.map((m, i) => t(96, 1150 + i * 44, 26, '#18263f', `${dayLabel(m.day)} · ${m.title}`)).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${SANS}">
<rect width="${CARD_W}" height="${CARD_H}" fill="#0d1a35"/>
<rect x="40" y="40" width="${CARD_W - 80}" height="${CARD_H - 80}" rx="36" fill="#f3f7f5"/>
<path d="M40 76a36 36 0 0 1 36-36h${CARD_W - 152}a36 36 0 0 1 36 36v172H40z" fill="#15284d"/>
${t(96, 136, 56, '#dcbc6c', '地球人生', ` font-family="${SERIF}" font-weight="900" letter-spacing="8"`)}
${t(96, 196, 34, '#bdc8dc', `${d.title} · ${d.span}`)}
<g transform="translate(${CARD_W - 190} 148) rotate(-8)"><circle r="86" fill="none" stroke="#b3155c" stroke-width="6"/><circle r="72" fill="none" stroke="#b3155c" stroke-width="3"/>${t(0, -8, 30, '#b3155c', `第 ${int(d.days)} 天`, ` text-anchor="middle" font-weight="900" font-family="${SERIF}"`)}${t(0, 30, 18, '#b3155c', 'IN AUSTRALIA', ' text-anchor="middle" letter-spacing="2"')}</g>
${t(96, 320, 40, '#18263f', `${d.avatar} ${d.name}`, ' font-weight="800"')}
${t(96, 362, 26, '#4a586c', `生涯累计：${int(d.total.places)} 个地方 · ${int(d.total.km)} 公里 · 认识 ${int(d.total.people)} 人 · 收入 ${money(d.total.earned)}`)}
${rule(384)}
${stats}
${rule(800)}
${t(96, 850, 30, '#18263f', '钱去哪了', ' font-weight="800"')}${t(240, 850, 18, '#4a586c', 'WHERE IT WENT', ` font-family="${SERIF}" letter-spacing="2.5"`)}
${outs || t(96, 900, 28, '#4a586c', '还没花过钱')}
${rule(1094)}
${ms ? `${ms}` : t(96, 1150, 26, '#4a586c', '里程碑还在路上')}
${t(CARD_W / 2, CARD_H - 70, 22, '#4a586c', '地球人生 · 生涯回顾', ' text-anchor="middle" letter-spacing="4"')}
</svg>`;
}

/** 把分享卡 SVG 画成 PNG（浏览器里用；SVG 当图片加载不会请求外部资源） */
export async function cardPng(svg: string): Promise<Blob> {
	const img = new Image();
	img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
	await img.decode();
	const canvas = document.createElement('canvas');
	canvas.width = CARD_W;
	canvas.height = CARD_H;
	canvas.getContext('2d')!.drawImage(img, 0, 0);
	return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('toBlob'))), 'image/png'));
}
