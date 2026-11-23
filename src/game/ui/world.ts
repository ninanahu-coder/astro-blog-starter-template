// 「我 · 资产」里的「世界经济」卡（第 43 批）：今天的六个宏观指标 + 最近的游戏内新闻。
// 所有插进 HTML 的文字都经过 esc()（新闻文案来自数据表，也照样转义）。
import { INDICATORS, WORLD_DISCLAIMER } from '../data/world.ts';
import { fmtIndicator, indicatorOn, worldNews } from '../core/world.ts';
import { dateLabel } from '../core/time.ts';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 世界经济卡。day：玩家当前的游戏日（dayOf(state.clock)） */
export function worldCard(day: number): string {
	const rows = INDICATORS.map((def) => {
		const now = indicatorOn(def, day);
		const prev = indicatorOn(def, day - def.step);
		const arrow = day < def.step || now === prev ? '' : now > prev ? ' ↑' : ' ↓';
		return `<div class="mood-row"><span>${esc(def.icon)} ${esc(def.name)}</span><b>${esc(fmtIndicator(def, now))}${arrow}</b></div>`;
	}).join('');
	const news = worldNews(day);
	const list = news.length
		? `<ul>${news.map((n) => `<li><b>${esc(n.title)}</b> <span class="muted">${esc(dateLabel(n.day * 1440))}</span><br>${esc(n.body)}</li>`).join('')}</ul>`
		: '<p class="muted">最近四周没有大新闻。</p>';
	return `<div class="card news world"><h3>世界经济</h3>${rows}<h3 style="margin-top:10px">新闻</h3>${list}<p class="muted" style="margin-top:6px">${esc(WORLD_DISCLAIMER)}</p></div>`;
}
