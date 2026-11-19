// 「社交」页的排行榜卡片（第一版，见 docs/earth-game/leaderboard.md）：只负责把服务端返回的榜单拼成 HTML。
// 服务端返回的所有字符串（名字、头像、徽章、称号、地区名）都过 esc()；数字先转成数字再插。

export type LbDimId = 'worth' | 'places' | 'dex' | 'respect' | 'contest';
export interface LbRowView { rank: number; name: string; avatar: string; score: number; day: number; me: boolean; badge?: string }
export interface LbData {
	q: { dim: LbDimId; scope: 'all' | 'season'; board: 'global' | 'region' | 'friends' };
	top: LbRowView[];
	me: LbRowView | null;
	total: number;
	mine: { status: 'on' | 'off' | 'hold' | 'none'; score: number | null };
	season: { label: string; daysLeft: number };
	pref: { on: boolean; anon: boolean; region: boolean; friends: boolean };
	titles: { text: string }[];
	region: { name: string } | null;
}

/** 维度按钮（和服务端 data/leaderboard.ts 的 LB_DIMS 一致；比赛只有赛季榜） */
export const LB_DIM_TABS: [LbDimId, string, boolean][] = [
	['worth', '💰 身家', true],
	['places', '📍 打卡', true],
	['dex', '📖 图鉴', true],
	['respect', '⭐ 声望', true],
	['contest', '🏆 比赛', false],
];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 分数怎么写：身家带 $，图鉴是千分比转成百分比，赛季榜带「+」 */
export function lbScoreText(dim: LbDimId, score: unknown, season: boolean): string {
	const n = num(score);
	const sign = season && n > 0 ? '+' : '';
	if (dim === 'worth') return `${sign}${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
	if (dim === 'dex') return `${sign}${(n / 10).toFixed(1)}%`;
	if (dim === 'places') return `${sign}${Math.round(n)} 个地点`;
	if (dim === 'contest') return `${Math.round(n)} 分`;
	return `${sign}${Math.round(n)}`;
}

export function lbCardHtml(d: LbData | null, ui: { loading: boolean; error: string; dim: LbDimId; scope: 'all' | 'season'; board: 'global' | 'region' | 'friends' }, esc: (s: unknown) => string): string {
	const seg = (items: [string, string][], attr: string, cur: string) =>
		`<div class="seg" role="group">${items.map(([v, label]) => `<button data-lbq="${attr}:${v}" class="${cur === v ? 'on' : ''}" aria-pressed="${cur === v}">${label}</button>`).join('')}</div>`;
	const dimTab = LB_DIM_TABS.find((x) => x[0] === ui.dim)!;
	const head = `${seg(LB_DIM_TABS.map(([id, label]) => [id, label]), 'dim', ui.dim)}
		${dimTab[2] ? seg([['season', '本赛季'], ['all', '总榜']], 'scope', ui.scope) : ''}
		${seg([['global', '全服'], ['region', '地区'], ['friends', '好友']], 'board', ui.board)}`;
	if (!d) return `<div class="card"><h3>🏆 排行榜</h3>${head}<p class="muted">${ui.loading ? '正在加载…' : esc(ui.error || '正在加载…')}</p></div>`;
	const season = d.q.scope === 'season';
	const row = (r: LbRowView) =>
		`<div class="row"><span class="ico">${num(r.rank)}</span><span class="body">${esc(r.avatar)} ${r.me ? `<b>${esc(r.name)}（你）</b>` : esc(r.name)}${r.badge ? ` ${esc(r.badge)}` : ''}<small>${esc(lbScoreText(d.q.dim, r.score, season))}</small></span></div>`;
	const where = d.q.board === 'region' ? `${esc(d.region?.name ?? '')}榜` : d.q.board === 'friends' ? '好友榜（常遇见的人）' : '全服';
	const list = `${d.top.map(row).join('') || '<p class="muted">还没有人上榜。</p>'}${d.me && !d.top.some((r) => r.me) ? `<p class="muted" style="margin:6px 0">……</p>${row(d.me)}` : ''}`;
	const myScore = d.mine.score === null ? '' : `你的成绩：${esc(lbScoreText(d.q.dim, d.mine.score, season))}。`;
	const status = d.mine.status === 'off'
		? `<p>${myScore}你还没有上榜。上榜后别人能看到你的名字（或「匿名旅人」）和成绩，<b>不会显示位置</b>。</p>
			<div class="inline"><button class="primary" data-lbpref="on:1,anon:0">用昵称上榜</button><button data-lbpref="on:1,anon:1">匿名上榜</button></div>`
		: d.mine.status === 'hold'
			? `<p class="muted">${myScore}你的成绩涨得异常，正在复核，暂时不在公开榜上。复核期间不发赛季奖励。</p>`
			: d.mine.status === 'none'
				? `<p class="muted">${myScore}${season ? '本赛季还没有成绩。' : '这个榜上还没有你的成绩。'}</p>`
				: '';
	const prefs = d.pref.on
		? `<details style="margin-top:8px"><summary>上榜设置</summary><div class="inline" style="margin-top:6px;flex-wrap:wrap">
			<button data-lbpref="anon:${d.pref.anon ? 0 : 1}">${d.pref.anon ? '改用昵称' : '改为匿名'}</button>
			<button data-lbpref="region:${d.pref.region ? 0 : 1}">${d.pref.region ? '不参加地区榜' : '参加地区榜'}</button>
			<button data-lbpref="friends:${d.pref.friends ? 0 : 1}">${d.pref.friends ? '不在好友榜显示' : '在好友榜显示'}</button>
			<button data-lbpref="on:0">退出排行榜</button></div></details>`
		: '';
	const titles = d.titles.length ? `<p style="margin-top:8px">我的赛季称号：${d.titles.map((t) => esc(t.text)).join('、')}</p>` : '';
	return `<div class="card"><h3>🏆 排行榜 · ${esc(d.season.label)} 赛季</h3>${head}
		<p>${where} · 共 ${num(d.total)} 人上榜 · 本赛季还剩 ${num(d.season.daysLeft)} 天。成绩由服务端计算；赛季奖励只有称号和徽章。</p>
		<div class="list" style="margin-top:8px">${list}</div>
		${status}${titles}${prefs}
		<div class="inline" style="margin-top:8px"><button data-board ${ui.loading ? 'disabled' : ''}>刷新</button></div></div>`;
}

/** 按钮上的 data-lbpref="on:1,anon:0" → { on: true, anon: false }；只认四个开关 */
export function parseLbPref(v: string): Record<string, boolean> | null {
	const out: Record<string, boolean> = {};
	for (const part of v.split(',')) {
		const [k, x] = part.split(':');
		if (!['on', 'anon', 'region', 'friends'].includes(k) || (x !== '0' && x !== '1')) return null;
		out[k] = x === '1';
	}
	return Object.keys(out).length ? out : null;
}
