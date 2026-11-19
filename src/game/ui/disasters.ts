// 灾害预警在页面上的样子（第 43 批）：今天页「今天的天」卡里的预警行、顶栏标签。
// 只拼 HTML，不碰 DOM；所有插值都过调用方传进来的 esc()（和页面同一个）。
import { evacuationTarget, warnTitle, type Warning } from '../core/disasters.ts';
import { HAZARDS, WARN_AGENCY, WARN_LEVELS, type HazardId } from '../data/disasters.ts';
import type { GameLocation, Region } from '../core/types.ts';

type Esc = (s: unknown) => string;

export function warnAgency(areaId: string, hazard: HazardId): { name: string; url: string } {
	const a = Object.hasOwn(WARN_AGENCY, areaId) ? WARN_AGENCY[areaId] : WARN_AGENCY.wa;
	return (hazard === 'bushfire' && a.bushfire) || a.default;
}

/** 卡片里的预警行；没有预警时返回空数组 */
export function warningRows(ws: Warning[], region: Region, loc: GameLocation, day: number, areaId: string, esc: Esc): string[] {
	return ws.map((w) => {
		const h = HAZARDS[w.hazard];
		const lv = WARN_LEVELS[w.level];
		const ag = warnAgency(areaId, w.hazard);
		const go = w.level === 3 && w.hazard !== 'heatwave' && w.hazard !== 'outage' ? evacuationTarget(region, loc, day) : null;
		const evac = go ? `可以撤到 ${esc(go.name)}。` : '';
		return `<div class="row warn warn-${esc(lv.color)}"><span class="ico" aria-hidden="true">${esc(h.icon)}</span><span class="body">${esc(h.name)} · ${esc(lv.name)}（${esc(lv.en)}）<small>${esc(h.advice[w.level])}${evac}这是游戏里的模拟，不是真实预警；真实情况看 <a href="${esc(ag.url)}" target="_blank" rel="noopener">${esc(ag.name)}</a></small></span></div>`;
	});
}

/** 顶栏标签：只在「注意并行动」及以上时出现，显示最高的一条 */
export function warningChip(ws: Warning[], esc: Esc): string {
	const top = ws[0];
	if (!top || top.level < 2) return '';
	return `<span class="chip fire-chip" title="${esc(`${WARN_LEVELS[top.level].en}（游戏模拟，不是真实预警）`)}">${esc(warnTitle(top))}</span>`;
}
