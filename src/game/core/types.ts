// 「地球人生 / Terra Life」核心类型 —— 前端、Durable Object、测试、数据管线共用。
// 这里只放纯数据结构，不依赖 DOM / Workers API。

export const NEED_KEYS = ['hunger', 'energy', 'hygiene', 'fun', 'social'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>; // 0–100，随时间衰减（生活模拟）

export const SKILL_KEYS = ['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export type Skills = Record<SkillKey, number>; // 0–100，用得越多涨得越多（开放世界式成长）

/** 车型 id（见 data/vehicles.ts），'none' 表示没有车 */
export type Vehicle = string;
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

// ---------- NPC 与关系 ----------
export interface NpcDef {
	id: string;
	name: string;
	role: string;
	loc: string;
	hours: Hours;
	likes: string[]; // 喜欢的物品 id
	bio: string;
	bond: { text: string; fx: Effect }; // 第一次成为「好友」时的回报
}

export type NpcAction = 'chat' | 'gift' | 'help';

export interface Relation {
	score: number; // −100..100
	last: Partial<Record<NpcAction, number>>; // 每种互动最近一次的游戏日，同一天不能重复
	bonded: boolean; // 已领取好友回报
}

// ---------- 职业与住房 ----------
/** 适用地点：kind 或 tag 任一命中 */
export interface Where {
	kinds?: LocationKind[];
	tags?: string[];
}

export interface CareerLevel {
	title: string;
	pay: number; // 每班工资
	req?: { skills?: Partial<Skills>; respect?: number };
}

export interface CareerDef {
	id: string;
	name: string; // 雇主名，如「咖啡店」
	where: Where;
	start: Hours; // 可以开始上班的时段
	minutes: number; // 一个班的时长
	skill: SkillKey; // 表现检定用的能力
	shift: Effect; // 每个班的固定消耗与成长（不含工资）
	levels: CareerLevel[];
}

export interface Job {
	career: string;
	loc: string; // 工作地点
	level: number; // 0 起
	shifts: number; // 当前等级已上班次
	good: number; // 当前等级表现好的班次
	lastDay: number; // 最近一次上班的游戏日，−1 表示还没上过
}

export interface HomeDef {
	id: string;
	name: string;
	rentWeek: number;
	comfort: number; // 心情加成，也加到回家睡觉的恢复量上
	where: Where;
	desc: string;
}

export interface Home {
	type: string;
	loc: string;
	paidUntil: number; // 租金付到第几个游戏日（不含）
}

// ---------- 交通工具、课程、体验 ----------
export interface VehicleDef {
	id: string;
	name: string;
	icon: string;
	price: number;
	resale: number; // 卖出回收比例
	speed: number; // 公路基础时速
	trackSpeed: number; // 土路基础时速，0 表示不能走土路
	costPerKm: number;
	ride?: Partial<Needs>; // 每分钟额外的需求变化（摩托车更累）
	sleep?: Effect; // 能在车里睡觉时的恢复效果（不含时间）
	desc: string;
}

export interface CourseDef {
	id: string;
	name: string;
	skill: SkillKey;
	base: number; // 基础学费
	minutes: number;
	gain: number; // 传给 growSkill 的原始增量
	where: Where;
	hours: Hours;
	desc: string;
}

export interface ExperienceDef {
	id: string;
	name: string;
	loc: string;
	area: string; // 收藏片区
	price: number;
	minutes: number;
	respect: number; // 第一次体验的声望
	hours?: Hours;
	fx: Effect;
	desc: string;
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

/** 营业/作息时间 [开, 关) 小时，关 ≤ 开 表示跨午夜 */
export type Hours = [number, number];

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
	hours?: Hours; // 不写表示全天可做
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
	relations: Record<string, Relation>; // npcId -> 关系
	job: Job | null;
	home: Home | null;
	collected: string[]; // 已完成的收费体验 id
	courseDays: Record<string, number>; // 课程 id -> 最近一次上课的游戏日
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
