import { SKILL_META } from '../core/character.ts';
import { coursePrice, matches } from '../core/engine.ts';
import { haversineKm } from '../core/geo.ts';
import type { GameLocation, PlayerState, Region, Where } from '../core/types.ts';
import { CAREERS } from '../data/careers.ts';
import { CERTS } from '../data/certs.ts';
import { COURSES } from '../data/courses.ts';
import { PROGRAMS } from '../data/education.ts';

export interface CareerGuideRow {
	id: string;
	name: string;
	apply: GameLocation;
	distanceKm: number;
	missing: string[];
}

const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} 小时`;

function nearest(state: PlayerState, region: Region, where: Where): { loc: GameLocation; km: number } | undefined {
	const here = region.locations.find((loc) => loc.id === state.loc);
	const candidates = region.locations.filter((loc) => matches(where, loc));
	if (!candidates.length) return undefined;
	const ranked = candidates.map((loc) => ({ loc, km: here ? haversineKm(here.lat, here.lon, loc.lat, loc.lon) : 0 }));
	ranked.sort((a, b) => a.km - b.km || a.loc.id.localeCompare(b.loc.id));
	return ranked[0];
}

function trainingPlace(state: PlayerState, region: Region, where: Where): string {
	const found = nearest(state, region, where);
	return found ? found.loc.name : '当前地图没有地点';
}

function programSteps(state: PlayerState, region: Region, award: string, seen = new Set<string>()): string[] {
	if (state.certs.includes(award) || seen.has(award)) return [];
	seen.add(award);
	const p = PROGRAMS.find((x) => x.award === award);
	if (!p) return [];
	return [
		...(p.needs ?? []).flatMap((need) => programSteps(state, region, need, seen)),
		`${p.name}：${p.sessions} 次 × $${p.fee}，每次 ${hours(p.minutes)}；去${trainingPlace(state, region, p.where)}`,
	];
}

/**
 * 十个部门的入门路线。只读现有职业、课程、证照、地点数据；“最近”指直线距离。
 * 返回结构化文本，页面和测试共用，不执行动作、不修改存档。
 */
export function careerGuide(state: PlayerState, region: Region): CareerGuideRow[] {
	return CAREERS.flatMap((career) => {
		const apply = nearest(state, region, career.where);
		if (!apply) return [];
		const req = career.levels[0].req;
		const missing: string[] = [];
		for (const id of req?.certs ?? []) {
			if (state.certs.includes(id)) continue;
			const cert = CERTS.find((x) => x.id === id);
			if (cert) missing.push(`${cert.name}：$${cert.price}，${hours(cert.minutes)}；去${trainingPlace(state, region, cert.where)}`);
			else missing.push(...programSteps(state, region, id));
		}
		for (const [skill, need] of Object.entries(req?.skills ?? {})) {
			const key = skill as keyof PlayerState['skills'];
			if (!need || state.skills[key] >= need) continue;
			const course = COURSES.find((x) => x.skill === key);
			const label = `${SKILL_META[key].name} ${Math.floor(state.skills[key])}/${need}`;
			missing.push(course
				? `${label}：${course.name} $${coursePrice(state, course)}/次，${hours(course.minutes)}；去${trainingPlace(state, region, course.where)}`
				: label);
		}
		return [{ id: career.id, name: career.name, apply: apply.loc, distanceKm: apply.km, missing }];
	});
}

export function careerGuideHtml(state: PlayerState, region: Region, esc: (s: string) => string): string {
	const rows = careerGuide(state, region).map((row) => {
		const apply = row.apply.id === state.loc ? `就在这里应聘` : `去${row.apply.name}应聘（直线最近，约 ${Math.round(row.distanceKm)} km）`;
		const prep = row.missing.length ? `缺 ${row.missing.join('；')}` : '入门条件已满足';
		return `<div class="row" style="margin-top:8px"><span class="body"><b>${esc(row.name)}</b><small>${esc(`${prep} → ${apply}`)}</small></span></div>`;
	}).join('');
	return `<div class="card"><details><summary><b>职业路线 · 去哪里练</b></summary><p class="muted" style="margin-top:6px">费用、时长和地点来自当前游戏数据；“最近”按直线距离，只作方向提示。</p>${rows}</details></div>`;
}
