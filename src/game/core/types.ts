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
	/** 'sea'：要出海或下海，风暴天做不了 */
	exposed?: 'sea';
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
	vehicleSleep?: boolean; // 人睡在自己车里（房车营地）：要有能睡人的车才能租、才能回去睡
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
	fresh?: boolean; // 这个结算期内才挂牌出租：到下个结算日不计租
	lived?: boolean; // 自己搬进去住过：「搬了新家」每套房只给一次
}

export interface FurnitureDef {
	id: string;
	slot: string;
	name: string;
	price: number;
	comfort?: number; // 住处心情加成
	sleep?: Effect; // 回家睡觉的额外恢复
	unlock?: 'cook' | 'relax';
	kitchen?: number; // 厨房设备等级：1 炉灶、2 烤箱（做饭分支，见 data/cooking.ts）
	desc: string;
}

// ---------- 做饭（见 data/cooking.ts、core/cooking.ts） ----------
export interface IngredientDef {
	id: string;
	name: string;
	icon: string;
	price: number; // 一份的价钱
	days: number; // 保质期（游戏日）
	store: 'super' | 'asian'; // 超市 / 亚洲超市
	desc: string;
}

export interface RecipeDef {
	id: string;
	name: string;
	icon: string;
	cuisine: 'basic' | 'zh' | 'au';
	ingredients: Record<string, number>; // 食材 id -> 份数（一锅）
	cash?: number; // 不用食材、直接花钱
	minutes: number;
	kitchen: number; // 要求的厨房设备等级
	serves: number; // 一锅够几个人
	hunger: number;
	fun: number;
	health: number;
	xp: number; // 烹饪技能的基础成长
	unlock?: { skill: number } | { npc: string; at: number }; // 不写：一开始就会
	desc: string;
}

/** 一批食材：同一天买的同一种合在一起，exp 是过期的游戏分钟 */
export interface PantryRow {
	id: string;
	n: number;
	exp: number;
}

export interface Cooking {
	xp: number; // 烹饪技能 0–100
	made: Record<string, number>; // 食谱 id -> 做过几次
	pantry: PantryRow[];
	hostDay: number; // 最近一次请客的游戏日，−1 表示没请过
}

export interface FurnitureSetDef {
	id: string;
	name: string;
	items: string[]; // 家具 id，每件在不同槽位
	comfort: number; // 凑齐时额外的住处心情
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
	service: number; // 到修车厂做一次保养的价格
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

export interface CertDef {
	id: string;
	name: string;
	career: string; // 对哪份职业有用（CareerDef.id）
	price: number;
	minutes: number;
	payBonus: number; // 持证时这份职业每班工资上涨的比例
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
	weather?: string[]; // 写了的话，随身装备只在这些天气生效（天气 id，见 data/weather.ts）
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
	/** 'sea'：海上的活动，风暴天取消（见 data/weather.ts） */
	exposed?: 'sea';
	/** 只在这些天气出现（当天天气不符时列表里不显示、也不能做） */
	weather?: string[];
	desc: string;
}

export interface Outcome {
	text: string;
	fx: Effect;
}

/** 共同事件：同一地点两名以上玩家一起做；每人选一个分工（用自己那项能力），合起来做一次团队检定，所有人拿同一个结果 */
export interface CoopDef {
	id: string;
	title: string;
	icon: string;
	text: string;
	/** 在哪能做：地点 / tag / kind 任一命中；都不写为到处都能做 */
	locs?: string[];
	tags?: string[];
	kinds?: LocationKind[];
	weather?: string[];
	hours?: Hours;
	min: number;
	max: number;
	/** 团队分 = 每人（检定分 + 随机 0–60）的平均值 + 每多一人 +6，达到 dc 就成功 */
	dc: number;
	roles: { label: string; skill: SkillKey }[];
	ok: Outcome;
	fail: Outcome;
}

export interface EventChoice {
	label: string;
	/** 选这一项要先付的钱（买东西、门票）。钱不够不能选；和结果里的罚款不同，罚款不够时扣到 0 为止 */
	cost?: number;
	check?: { skill: SkillKey; dc: number };
	/** 'sea'：要下海或出海，风暴天不能选（事件里必须还有别的选项） */
	exposed?: 'sea';
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
	| { t: 'job' | 'course' | 'experience' | 'buy' | 'travel' | 'newplace' | 'photo' };

export interface WishDef {
	id: string;
	text: string;
	needs?: 'job' | 'home'; // 有工作 / 有住处才会出现
	done: WishDone;
	venue?: VenueOp[]; // 在真实地点做这些事也算完成；work 要实际算了一个班次才算
}

export interface GameEvent {
	seasons?: string[]; // 只在这些季节出现
	weather?: string[]; // 只在抵达地点当天是这些天气时出现
	periods?: ('dawn' | 'day' | 'dusk' | 'night')[]; // 只在抵达时是这些时段出现（清晨 5–8，白天 8–17，傍晚 17–20，夜晚 20–5）
	hours?: Hours; // 比时段更精确：只在抵达时是 [开, 关) 这几个整点之间出现（真实世界有固定时间的事，如午后海风、早上喂海豚）
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
	animal?: string; // 事件里见到的动物：抽到这个事件就记进野生动物图鉴
	breakdown?: boolean; // 抛锚事件：不进普通抽取（weight 写 0），只在该保养的车自驾抵达时按几率抽
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
	car: { km: number; since: number }; // 现在这辆车开了多少公里、离上次保养多少公里（换车、卖车时清零）
	visited: Record<string, number>; // locId -> 到访次数
	checkins: string[]; // 已 GPS 打卡的 POI id
	dex: string[]; // 野生动物图鉴：见过的动物 id
	duos: string[]; // 已触发的 NPC 联动剧情 id
	dayMark: { day: number; at: number; cash: number; respect: number; places: number }; // 每日摘要：今天开始时（at 那一分钟）的现金、声望、到过几个地方
	yday: { day: number; days: number; from: number; to: number; cash: number; respect: number; places: number } | null; // 上一段日子（从 day 起 days 天，日志范围 from 之后到 to）的变化，跨日时算出
	story: { ch: number; done: Record<string, number> }; // 主线剧情：第几章（等于章数表示全部写完）、本章各目标的进度
	photoQuest: number; // 摄影任务链做到第几个（等于任务总数表示全部拍完）
	fish: Record<string, number>; // 钓到过的鱼：鱼种 id -> 条数
	dexSets: string[]; // 已发过奖的图鉴分组（集齐时记下，以后加了新动物也不收回、不重复发）
	photos: string[]; // 天气相册：'地点id|天气id'，抵达时按当天天气收集（只是收藏，不发奖励）
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
	areas: string[]; // 已获得称号的体验片区 id：集齐时记下，之后加了新体验也不收回、不重复发奖
	courseDays: Record<string, number>; // 课程 id -> 最近一次上课的游戏日
	certs: string[]; // 已考到的职业证书 id（跟人走，换工作不丢）
	coopDays: Record<string, number>; // 共同事件 id -> 最近一次参加的游戏日（每种每 COOP_COOLDOWN_DAYS 天一次）
	trades: { day: number; out: number; in: number }; // 玩家之间交易：这个现实日已送出 / 收下的次数
	weekly: { week: number; n: number; claimed: boolean }; // 全服周目标：哪一周、我出了几份力、领没领
	met: Record<string, { name: string; avatar: string; n: number; last: number }>; // 常遇见的人：玩家 id 哈希前缀 -> 名字、头像、一起做事的次数、最近一次的现实日
	pending: { eventId: string } | null;
	fix: { lat: number; lon: number; at: number } | null; // 最近一次真实定位（坐标保留 3 位小数，约 100 米；at 为服务端时间）
	venueCd: Partial<Record<VenueOp, number>>; // 每种真实地点动作最近一次的服务端时间（毫秒）
	venueEvAt: number; // 最近一次真实地点事件的服务端时间（毫秒），0 为从未
	clockIn: { venue: string; at: number; career?: string } | null; // 真实打卡上班：哪个地点、几点打的卡；career 是按哪份职业打的卡，没有就是零工
	realWork: { day: number; min: number }; // 当天（现实日，珀斯时间）已计薪的真实上班分钟
	workDay: number; // 最近一次算过班次的游戏日，−1 表示还没上过；跟人走，不随换工作重置
	journal: JournalEntry[];
	cooking: Cooking; // 做饭：烹饪技能、做过的菜、食材柜、请客冷却（做饭分支）
	seed: number;
	rev: number; // 存档版本号，云同步用
}

export interface ActionResult {
	ok: boolean;
	state: PlayerState;
	msg: string;
	/** 动作途中晕倒被送医：原动作的后续结算（班次、升职、心愿、额外状态、到店事件）都不再发生 */
	collapsed?: boolean;
}
