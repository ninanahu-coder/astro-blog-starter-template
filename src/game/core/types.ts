// 「地球人生 / Terra Life」核心类型 —— 前端、Durable Object、测试、数据管线共用。
// 这里只放纯数据结构，不依赖 DOM / Workers API。

export const NEED_KEYS = ['hunger', 'energy', 'hygiene', 'fun', 'social'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>; // 0–100，随时间衰减（生活模拟）

export const SKILL_KEYS = ['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export type Skills = Record<SkillKey, number>; // 0–100，用得越多涨得越多（开放世界式成长）

export type Vehicle = 'none' | 'car' | '4wd';
export type TravelMode = 'road' | 'track' | 'ferry' | 'air';

export interface Effect {
	cash?: number;
	health?: number;
	respect?: number;
	heat?: number;
	minutes?: number;
	needs?: Partial<Needs>;
	skills?: Partial<Skills>;
	vehicle?: Vehicle;
	/** 物品增减：itemId -> 数量（负数为消耗） */
	items?: Record<string, number>;
}

// ---------- 性格特质 ----------
/** 修正系数：gain/decay/cost/heat/hurt 为乘数（1 = 不变），check/mood 为加值 */
export interface TraitMods {
	gain?: Partial<Skills>;
	decay?: Partial<Needs>;
	check?: Partial<Skills>;
	cost?: number;
	heat?: number;
	hurt?: number;
	mood?: number;
}

export interface TraitDef {
	id: string;
	name: string;
	desc: string;
	mods: TraitMods;
	conflicts?: string[];
}

// ---------- 物品 ----------
export interface ItemDef {
	id: string;
	name: string;
	icon: string;
	price: number;
	max: number; // 最多携带数量
	shop: { kinds?: LocationKind[]; tags?: string[] };
	use?: Effect; // 可消耗：使用后数量 −1
	passive?: Partial<Skills>; // 随身装备：持有即获得检定加值
	desc: string;
}

export type LocationKind = 'city' | 'port' | 'island' | 'coast' | 'outback' | 'mining' | 'park' | 'town';

export interface GameLocation {
	id: string;
	name: string; // 中文名
	en: string;
	lat: number;
	lon: number;
	kind: LocationKind;
	tags: string[]; // beach / pub / airport / hospital / dealer / reef / wine ...
	radiusKm: number; // 真实 GPS 打卡半径
	blurb: string;
}

export interface Route {
	a: string;
	b: string;
	mode: TravelMode;
}

export interface Poi {
	id: string;
	loc: string; // 所属 GameLocation.id
	name: string;
	lat: number;
	lon: number;
	category: string;
	source: string; // seed / osm / wikidata ...
	license?: string;
}

export interface Region {
	id: string;
	name: string;
	bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
	outline: [number, number][]; // [lon, lat]
	spawn: string;
	hospital: string;
	locations: GameLocation[];
	routes: Route[];
	pois: Poi[];
}

export interface Activity {
	id: string;
	name: string;
	icon: string;
	/** 地点需满足：kind 命中 或 任一 tag 命中；都不写表示处处可用 */
	kinds?: LocationKind[];
	tags?: string[];
	minutes: number;
	fx: Effect;
	requires?: { cash?: number; skill?: Partial<Skills>; vehicle?: Vehicle[] };
	desc: string;
}

export interface Outcome {
	text: string;
	fx: Effect;
}

export interface EventChoice {
	label: string;
	check?: { skill: SkillKey; dc: number };
	ok: Outcome;
	fail?: Outcome;
}

export interface GameEvent {
	id: string;
	title: string;
	icon: string;
	text: string;
	/** 触发范围：指定地点 / tag / kind，任一命中即可；都不写为全局事件 */
	locs?: string[];
	tags?: string[];
	kinds?: LocationKind[];
	arrivedBy?: TravelMode[];
	once?: boolean; // 每个角色只触发一次（地标签名事件）
	weight: number;
	choices: EventChoice[];
}

export interface JournalEntry {
	t: number; // 游戏时钟（分钟）
	text: string;
}

export interface PlayerState {
	v: 1;
	id: string;
	name: string;
	avatar: string;
	origin: string;
	region: string;
	clock: number; // 游戏内分钟数，从第 1 天 08:00 起算
	loc: string;
	cash: number;
	health: number; // 0–100
	respect: number; // 声望，≥0
	heat: number; // 麻烦值 0–100，过高会被盘查
	needs: Needs;
	skills: Skills;
	vehicle: Vehicle;
	visited: Record<string, number>; // locId -> 到访次数
	checkins: string[]; // 已 GPS 打卡的 POI id
	seen: string[]; // 已触发的 once 事件
	traits: string[]; // 性格特质 id，创建时选定
	inventory: Record<string, number>; // itemId -> 数量
	pending: { eventId: string } | null;
	journal: JournalEntry[];
	seed: number;
	rev: number; // 存档版本号，云同步用
}

export interface ActionResult {
	ok: boolean;
	state: PlayerState;
	msg: string;
}
