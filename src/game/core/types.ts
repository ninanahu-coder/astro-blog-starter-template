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
	/** 获得一个带时限的心情状态（见 data/moodlets.ts） */
	moodlet?: string;
}

export interface MoodletDef {
	id: string;
	name: string;
	icon: string;
	value: number; // 心情加减
	hours: number; // 持续的游戏小时
	gain?: number; // 生效期间所有能力成长的倍率（如「专注」1.25）
}

export interface Moodlet {
	id: string;
	until: number; // 到这个游戏分钟数失效
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
export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';

/** 日程里的一条：今天满足条件时，NPC 在 loc 的 hours 时段出现。按顺序取第一条满足的，都不满足时用常驻地点和作息 */
export interface NpcSlot {
	loc: string;
	hours: Hours;
	weekdays?: number[]; // 0 = 周一 … 6 = 周日
	seasons?: SeasonKey[];
	festival?: string; // 节日进行中
	note?: string; // 界面上的说明，如“周日去集市摆摊”
}

/** 送礼反应：最爱 / 喜欢 / 一般 / 讨厌。没列出的物品算一般 */
export type GiftReaction = 'love' | 'like' | 'neutral' | 'dislike';

/** 好感度第一次达到 at 时触发的一段小剧情，各触发一次 */
export interface NpcStory {
	at: number;
	title: string;
	text: string;
	fx?: Effect;
}

/** 专属互动：好感度达到 at 后解锁，每 every 个游戏日一次 */
export interface NpcPerk {
	at: number;
	name: string;
	desc: string;
	every: number;
	fx: Effect;
}

export interface NpcDef {
	id: string;
	name: string;
	role: string;
	loc: string; // 常驻地点
	hours: Hours; // 常驻作息
	schedule?: NpcSlot[];
	gifts: { love: string[]; like: string[]; dislike: string[] }; // 物品 id
	bio: string;
	stories: NpcStory[]; // 按 at 从小到大
	perk?: NpcPerk;
}

export type NpcAction = 'chat' | 'gift' | 'help' | 'perk';

export interface Relation {
	score: number; // −100..100
	last: Partial<Record<NpcAction, number>>; // 每种互动最近一次的游戏日
	seen: number[]; // 已触发过的剧情门槛
	known: string[]; // 已经知道 TA 反应的物品 id（送过一次就知道）
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
	venues?: string[]; // 可以在这些类型的真实地点打卡上班（VenueTypeDef.id）
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
	furniture: Record<string, string>; // 槽位 -> 家具 id
	owned?: string; // 自有房产 id；有值表示住在自己的房子里，不交房租
}

export interface PropertyDef {
	id: string;
	name: string;
	loc: string;
	homeType: string; // 自住时的房型（决定舒适度），见 data/housing.ts
	price: number;
	weekly: number; // 每周物业费与地税
	rentIncome: number; // 出租的周租金
	desc: string;
}

export interface OwnedProperty {
	id: string;
	loan: number; // 剩余贷款
	rented: boolean; // 是否出租中
	missed: number; // 连续欠款周数
}

export interface FurnitureDef {
	id: string;
	slot: string;
	name: string;
	price: number;
	comfort?: number; // 住处心情加成
	sleep?: Effect; // 回家睡觉的额外恢复
	unlock?: 'cook' | 'relax';
	desc: string;
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
	weekly: number; // 每周保险与保养
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
	festival?: string; // 只在这个节日期间开放
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
	venues: Venue[];
}

// ---------- 真实地点（店铺、健身房、公园……） ----------
/** 真实地点上能做的事。公式见 core/formulas.ts */
export type VenueOp = 'meal' | 'train' | 'work' | 'run' | 'swim' | 'relax' | 'study' | 'drink' | 'groceries' | 'heal';

export interface VenueTypeDef {
	id: string;
	name: string;
	icon: string;
	osm: string; // 对应的 OSM 标签，给采集任务看
	radiusM: number; // 判定“人在这里”的半径（米）
	tier: number; // 档次 1–4，影响饭价和饱腹
	quality?: number; // 训练质量（健身房 1.0）
	gigRate?: number; // 没有对应职业时，真实打工的时薪
	ops: VenueOp[];
}

/** 一个真实地点，由 OpenClaw 从 OSM 采集（wa.venues.json） */
export interface Venue {
	id: string;
	loc: string; // 所属 GameLocation.id
	name: string;
	lat: number;
	lon: number;
	type: string; // VenueTypeDef.id
	tier?: number; // 覆盖类型的默认档次
	source: string;
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

export interface FestivalDef {
	id: string;
	name: string;
	loc: string;
	season: SeasonKey;
	day: number; // 季内第几天开始
	days: number; // 持续天数
	desc: string;
}

/** 哪种动作算完成一个心愿 */
export type WishDone =
	| { t: 'activity'; ids: string[] }
	| { t: 'npc'; acts: NpcAction[] }
	| { t: 'home'; ops: string[] }
	| { t: 'job' | 'course' | 'experience' | 'buy' | 'travel' | 'newplace' };

export interface WishDef {
	id: string;
	text: string;
	needs?: 'job' | 'home'; // 有工作 / 有住处才会出现
	done: WishDone;
}

export interface GameEvent {
	seasons?: string[]; // 只在这些季节出现
	id: string;
	title: string;
	icon: string;
	text: string;
	/** 触发范围：指定地点 / tag / kind，任一命中即可；都不写为全局事件 */
	locs?: string[];
	tags?: string[];
	kinds?: LocationKind[];
	arrivedBy?: TravelMode[];
	/** 真实地点事件：只在这些类型的真实地点（餐馆、健身房……）做完动作后触发，到达城镇时不会抽到 */
	venueTypes?: string[];
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
	properties: OwnedProperty[];
	nextWeek: number; // 下一次周结算的游戏日（房租、车辆保险等）
	moodlets: Moodlet[]; // 带时限的心情状态
	wishes: string[]; // 今天还没完成的心愿 id
	wishDay: number; // 这批心愿是哪个游戏日生成的，−1 表示还没生成
	daily: { day: number; streak: number }; // 每日奖励：最近领取的现实日序号、连续天数
	collected: string[]; // 已完成的收费体验 id
	courseDays: Record<string, number>; // 课程 id -> 最近一次上课的游戏日
	pending: { eventId: string } | null;
	fix: { lat: number; lon: number; at: number } | null; // 最近一次真实定位（坐标保留 3 位小数，约 100 米；at 为服务端时间）
	venueCd: Partial<Record<VenueOp, number>>; // 每种真实地点动作最近一次的服务端时间（毫秒）
	venueEvAt: number; // 最近一次真实地点事件的服务端时间（毫秒），0 为从未
	clockIn: { venue: string; at: number } | null; // 真实打卡上班：哪个地点、几点打的卡
	realWork: { day: number; min: number }; // 当天（现实日，珀斯时间）已计薪的真实上班分钟
	journal: JournalEntry[];
	seed: number;
	rev: number; // 存档版本号，云同步用
}

export interface ActionResult {
	ok: boolean;
	state: PlayerState;
	msg: string;
}
