// 派生属性：全部由 PlayerState 现算，不落盘，避免存档里出现互相矛盾的冗余字段。
// 引擎所有涉及特质 / 物品 / 心情的数值都走这里，调参只改这一个文件和 data/。
import { ITEMS } from '../data/items.ts';
import { TRAITS } from '../data/traits.ts';
import { HOMES } from '../data/housing.ts';
import { FURNITURE } from '../data/furniture.ts';
import { VEHICLES } from '../data/vehicles.ts';
import { PROPERTIES } from '../data/properties.ts';
import { propertyDue } from './finance.ts';
import type { ItemDef, NeedKey, PlayerState, SkillKey, TraitDef, TraitMods } from './types.ts';

const traitById = new Map(TRAITS.map((t) => [t.id, t]));
const itemById = new Map(ITEMS.map((i) => [i.id, i]));

export const getTrait = (id: string): TraitDef | undefined => traitById.get(id);
export const getItem = (id: string): ItemDef | undefined => itemById.get(id);

function mods(state: PlayerState): TraitMods[] {
	return state.traits.map((id) => traitById.get(id)?.mods).filter((m): m is TraitMods => !!m);
}

/** 连乘所有特质的某个乘数 */
function product(state: PlayerState, pick: (m: TraitMods) => number | undefined): number {
	return mods(state).reduce((acc, m) => acc * (pick(m) ?? 1), 1);
}

export const decayMult = (s: PlayerState, k: NeedKey) => product(s, (m) => m.decay?.[k]);
export const gainMult = (s: PlayerState, k: SkillKey) => product(s, (m) => m.gain?.[k]);
export const costMult = (s: PlayerState) => product(s, (m) => m.cost);
export const heatMult = (s: PlayerState) => product(s, (m) => m.heat);
export const hurtMult = (s: PlayerState) => product(s, (m) => m.hurt);

// ---------- 住处与每周开销 ----------
/** 住处的心情加成 = 房型舒适度 + 家具舒适度 */
export function homeComfort(state: PlayerState): number {
	if (!state.home) return 0;
	const base = HOMES.find((h) => h.id === state.home!.type)?.comfort ?? 0;
	const extra = Object.values(state.home.furniture).reduce((a, id) => a + (FURNITURE.find((f) => f.id === id)?.comfort ?? 0), 0);
	return base + extra;
}

export interface WeeklyCosts {
	rent: number;
	vehicle: number;
	property: number; // 物业费 + 还款
	total: number;
}

/** 每周固定开销：房租（住自有房时为 0）+ 车辆保险保养 + 房产的物业费与还款。不含租金收入 */
export function weeklyCosts(state: PlayerState): WeeklyCosts {
	const rent = state.home && !state.home.owned ? (HOMES.find((h) => h.id === state.home!.type)?.rentWeek ?? 0) : 0;
	const vehicle = VEHICLES.find((v) => v.id === state.vehicle)?.weekly ?? 0;
	const property = state.properties.reduce((sum, p) => {
		const def = PROPERTIES.find((d) => d.id === p.id);
		return sum + (def ? propertyDue(def, p) : 0);
	}, 0);
	return { rent, vehicle, property, total: rent + vehicle + property };
}

// ---------- 心情 ----------
/** 心情 0–100：五项需求的平均值，再被最低的那一项往下拉（短板效应） */
export function mood(state: PlayerState): number {
	const v = Object.values(state.needs);
	const avg = v.reduce((a, b) => a + b, 0) / v.length;
	const low = Math.min(...v);
	const bonus = mods(state).reduce((a, m) => a + (m.mood ?? 0), 0);
	const home = homeComfort(state);
	return Math.max(0, Math.min(100, Math.round(avg * 0.6 + low * 0.4 + bonus + home)));
}

export interface MoodTier {
	name: string;
	check: number; // 对所有检定的加值
}
export function moodTier(m: number): MoodTier {
	if (m < 25) return { name: '低落', check: -10 };
	if (m < 50) return { name: '一般', check: 0 };
	if (m < 85) return { name: '愉快', check: 5 };
	return { name: '亢奋', check: 10 };
}

// ---------- 检定 ----------
export interface CheckBreakdown {
	skill: number;
	trait: number;
	item: number;
	mood: number;
	total: number;
}

/** 检定分 = 能力值 + 特质加值 + 装备加值（取最高一件）+ 心情加值。随机数在引擎里加 */
export function checkScore(state: PlayerState, k: SkillKey): CheckBreakdown {
	const skill = Math.floor(state.skills[k]);
	const trait = mods(state).reduce((a, m) => a + (m.check?.[k] ?? 0), 0);
	let item = 0;
	for (const [id, n] of Object.entries(state.inventory)) {
		const bonus = n > 0 ? (itemById.get(id)?.passive?.[k] ?? 0) : 0;
		item = Math.max(item, bonus);
	}
	const moodBonus = moodTier(mood(state)).check;
	return { skill, trait, item, mood: moodBonus, total: skill + trait + item + moodBonus };
}

// ---------- 通缉星级与等级 ----------
/** 麻烦值 0–100 → 0–5 星；3 星（≥60）起到达新地点会被盘查 */
export const wantedStars = (heat: number) => Math.min(5, Math.floor(heat / 20));

const LEVELS = [0, 10, 25, 50, 90, 150, 240, 360, 520, 720];
const TITLES = ['新来的', '过客', '常客', '熟面孔', '本地通', '老西澳', '传说中的人', '西澳名人', '活地图', '西澳之子'];

/** 声望 → 等级与称号 */
export function level(respect: number): { lv: number; title: string; next: number | null } {
	let lv = 0;
	while (lv + 1 < LEVELS.length && respect >= LEVELS[lv + 1]) lv++;
	return { lv: lv + 1, title: TITLES[lv], next: LEVELS[lv + 1] ?? null };
}

/** 特质组合是否合法：数量、去重、存在、互斥 */
export function validTraits(ids: string[], max: number): boolean {
	if (ids.length > max || new Set(ids).size !== ids.length) return false;
	for (const id of ids) {
		const t = traitById.get(id);
		if (!t || t.conflicts?.some((c) => ids.includes(c))) return false;
	}
	return true;
}
