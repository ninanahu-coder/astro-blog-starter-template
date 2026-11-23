// 「地球人生 / Terra Life」核心类型 —— 前端、Durable Object、测试、数据管线共用。
// 这里只放纯数据结构，不依赖 DOM / Workers API。
import type { VisaKind } from '../data/visas.ts';

export const NEED_KEYS = ['hunger', 'energy', 'hygiene', 'fun', 'social'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>; // 0–100，随时间衰减（生活模拟）

export const SKILL_KEYS = ['stamina', 'strength', 'driving', 'swimming', 'charisma', 'survival', 'street'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export type Skills = Record<SkillKey, number>; // 0–100，用得越多涨得越多（开放世界式成长）

/** 车型 id（见 data/vehicles.ts），'none' 表示没有车 */
export type Vehicle = string;
/** road 自驾或长途巴士、track 越野土路、ferry 渡轮、air 航班；第 32 批加 transit 市内公交/火车/电车、rail 区域火车、walk 步行 */
export type TravelMode = 'road' | 'track' | 'ferry' | 'air' | 'transit' | 'rail' | 'walk';

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
	/** 直接得一种病或伤（data/health.ts 的 id，如中暑 'heat'）；已经在生病时不覆盖。不写时健康大掉按扭伤算 */
	illness?: string;
	/** 这段时间在睡觉：饱食、娱乐、社交掉得慢，精力不降，恢复的精力乘恢复系数（见 core/vitals.ts） */
	asleep?: boolean;
	/** 可以走保险的损失（车祸、失窃、风暴……）：有对口保单时只付免赔额，没有就全额自付（见 core/insurance.ts） */
	loss?: Loss[];
}

/** 保险能赔的损失种类 */
export type LossKind = 'collision' | 'tpp' | 'car-theft' | 'car-storm' | 'contents-theft' | 'contents-storm' | 'luggage';
export interface Loss {
	kind: LossKind;
	amount: number; // 损失金额（元）
}

export interface MoodletDef {
	id: string;
	name: string;
	icon: string;
	value: number; // 心情加减
	hours: number; // 持续的游戏小时
	gain?: number; // 生效期间所有能力成长的倍率（如「专注」1.25）
	/** 缓解的心事状态 id：获得时清掉这些状态，生效期间每日结算也不会再触发它们（见 core/mind.ts） */
	relieves?: string[];
	regen?: number; // 生效期间健康自然恢复的倍率（如「吃了维生素」2）
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
	/** 心事分数倍率（孤独 / 思乡 / 压力），见 data/mind.ts */
	mind?: Partial<Record<'lonely' | 'homesick' | 'stressed', number>>;
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
	/** 天气 id 之一（第 43 批）：看 weatherAt 地点当天的天气，不写就看 NPC 的常驻地点 */
	weather?: string[];
	weatherAt?: string;
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

/** favor：帮个小忙；bond / unbond：结为知己、解除知己（第 29 批） */
export type NpcAction = 'chat' | 'gift' | 'help' | 'perk' | 'favor' | 'bond' | 'unbond';

export interface Relation {
	score: number; // −100..100
	last: Partial<Record<NpcAction | 'host' | 'hobby', number>>; // 每种互动最近一次的游戏日；host = 来家里吃饭（做饭），hobby = 一起做爱好（爱好与收集），都不是互动动作
	seen: number[]; // 已触发过的剧情门槛
	known: string[]; // 已经知道 TA 反应的物品 id（送过一次就知道）
	bond?: number; // 结为知己的游戏日（第 29 批）；没结或已解除时没有这个键
	told?: number; // 最近一次听 TA 讲近况的游戏日（第 29 批，只有知己会讲）
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
	req?: { skills?: Partial<Skills>; respect?: number; certs?: string[] }; // certs：要持有的证书或学历 id（CertDef.id 或 ProgramDef.award）
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
	bondWeeks?: number; // 押金是几周房租；不写用 data/housing.ts 的 BOND_WEEKS
}

export interface Home {
	type: string;
	loc: string;
	furniture: Record<string, string>; // 槽位 -> 家具 id
	owned?: string; // 自有房产 id；有值表示住在自己的房子里，不交房租
	bond?: number; // 租房押金（第 26 批），搬走时退；自有房没有
}

/** 租约（rental 批次，见 docs/earth-game/rental.md §4–6）。日期都是游戏日 */
export interface Lease {
	home: string; // 房型 id，必须和 state.home.type 一致
	loc: string; // 地点 id，必须和 state.home.loc 一致
	start: number; // 起租日
	end: number; // 固定期限到期日；0 = 周期租约
	rent: number; // 现行周租（涨租后不等于挂牌价 HomeDef.rentWeek）
	lastRise: number; // 上次涨租（或起租）的日子
	rise: { at: number; to: number } | null; // 已收到通知的涨租：从 at 日起按 to
	report: -1 | 0 | 1; // 入住检查报告：0 待交、1 已交、-1 过期没交
	prior: number; // 入住时原有损坏 0–100
	wear: number; // 租住期间造成的损坏 0–100
	fault: { urgent: boolean; name: string; since: number; asked: number } | null; // 没修好的故障；asked 是报修日，−1 没报
}

/** 租房市场的个人记录（跟人走） */
export interface RentalState {
	lease: Lease | null;
	refs: number; // 好的退租记录（推荐人）0–9
	marks: number; // 被收房记录 0–9
	viewed: { loc: string; home: string; day: number; n: number } | null; // 最近一次看房；n 是来看房的组数
	rejected: { loc: string; day: number; homes: string[] } | null; // 今天在这个地点被拒的房型（合并 main 后复核：原来只记一套，换一套就能当天重抽）
	claim: { amount: number; prior: number; day: number } | null; // 退房时房东申请扣、还在托管机构的押金；prior 是申诉能要回的部分（交过入住检查报告时 = 原有损坏那部分，没交为 0）
	scam: number; // 最近一次处理骗租广告（转了钱或识破）的游戏日，−1 为从未；当天不再显示那条广告
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

/** 金融资产（第 25 批）：储蓄、指数基金、金条、虚拟币。价格按玩家私有的行情种子逐日生成，见 core/market.ts */
export interface AssetDef {
	id: string;
	name: string;
	icon: string;
	kind: 'cash' | 'stock' | 'metal' | 'crypto';
	start: number; // 第 0 天的单价
	drift: number; // 年化期望收益（对数漂移），待平衡
	vol: number; // 年化波动率，待平衡
	fee: number; // 买入和卖出各收的手续费比例（含买卖价差）
	desc: string;
}

/** 持有的一种资产：份数和累计成本（卖出时按比例扣减成本，界面算盈亏用） */
export interface Holding {
	units: number;
	cost: number;
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

/** 学历课程：要分多次上完的长课（语言班、TAFE、大学），上完拿到一个学历 id，记进 PlayerState.certs */
export interface ProgramDef {
	id: string;
	name: string;
	kind: 'language' | 'tafe' | 'uni';
	sessions: number; // 一共要上几次课
	minutes: number; // 每次课多久
	fee: number; // 每次课的学费
	needs?: string[]; // 报名前要持有的证书或学历 id
	skills: Partial<Skills>; // 每次课的能力成长（传给 growSkill 的原始增量）
	award: string; // 上完拿到的学历 id
	respect: number; // 毕业时的声望
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
	/** 分类（第 34 批）；不写时按 use → 消耗品、passive → 装备推断，见 core/shop.ts 的 itemCat() */
	cat?: ItemCat;
	/** 现实里哪类店卖它（第 34 批，见 data/shops.ts 的 STORE_TYPES）；只用于标注和真实店铺对应，不决定游戏里在哪能买（那是 shop） */
	stores?: StoreType[];
	/** 易腐（第 34 批）：超市晚上贴打折贴，见 data/shops.ts 的 SHOP_RULES.markdown */
	perish?: boolean;
	desc: string;
}

/** 物品分类：消耗品、装备、礼物、收藏。家具不是背包物品，单独在 data/furniture.ts */
export type ItemCat = 'consumable' | 'gear' | 'gift' | 'collectible';

/** 现实里的店铺类别（第 34 批） */
export type StoreType = 'convenience' | 'supermarket' | 'asian-grocer' | 'pharmacy' | 'hardware' | 'outdoor' | 'surf' | 'tackle' | 'music' | 'florist' | 'cafe';

export interface StoreTypeDef {
	id: StoreType;
	name: string;
	icon: string;
	/** OpenStreetMap 标签（采集用；写「待核」的要 OpenClaw 先查 OSM wiki 再采） */
	osm: string;
	/** 已经采集进 wa/sa.venues.json 的真实地点类型 id；还没采集的不写 */
	venue?: string;
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
	/** 法律后果（见 core/law.ts）：违章 id，或 'breath'（呼气测试，喝过酒才算违章） */
	law?: string;
	/** 事件链：结算到这个结果后解锁这些后续事件（必须是 locked 的事件），之后条件满足时优先出现。见 docs/earth-game/event-engine.md */
	unlocks?: string[];
	/** 事件链：结算完立刻接着弹出这个事件（同一场景的下一幕，不掷骰、不受冷却和上限限制） */
	then?: string;
}

/** 事件条件里能比较的数值：现金、健康、声望、麻烦值、五项需求、七项能力 */
export type EventStat = 'cash' | 'health' | 'respect' | 'heat' | NeedKey | SkillKey;

/** 事件的属性、关系、物品条件；全部满足才进抽取池 */
export interface EventNeed {
	/** 下限（含）：如 { cash: 500, charisma: 30 } */
	min?: Partial<Record<EventStat, number>>;
	/** 上限（含）：如 { energy: 30 } 只在很累时出现 */
	max?: Partial<Record<EventStat, number>>;
	/** 和某个 NPC 的关系分（−100..100）在范围内；没认识过算 0 */
	rel?: { npc: string; min?: number; max?: number }[];
	/** 身上各至少有 1 个这些物品 */
	items?: string[];
}

/** 事件引擎的存档记录（见 core/event-rules.ts）。只记写了对应规则的事件，体积和事件总数无关 */
export interface EventMemory {
	day: number; // rand、today 记的是哪个游戏日
	rand: number; // 这一天随机抽中的事件数（每日总上限只数这一类）
	today: Record<string, number>; // 写了 daily 的事件：今天出了几次
	last: Record<string, number>; // 写了 cooldown 的事件：最近一次出现的游戏分钟
	n: Record<string, number>; // 写了 max 的事件：一共出了几次
	recent: string[]; // 最近出现的事件 id，新的在后，最多 RECENT_MAX 个
	open: Record<string, number>; // 已解锁、还没出现的链式事件 -> 解锁时的游戏分钟
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
	/** 不靠能力、按几率出 fail 结果（0–1）：违法的选项是否被查到看运气，不让能力高的人「更会违法」 */
	risk?: number;
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
	| { t: 'npc'; acts: NpcAction[]; npc?: string } // npc：只算和这位 NPC 的互动
	| { t: 'home'; ops: string[] }
	| { t: 'job' | 'course' | 'experience' | 'buy' | 'travel' | 'newplace' | 'photo' | 'fish' }; // fish：钓到了鱼（空军不算）

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
	/** 只在回到自己的住处时出现（保险的住处出险事件） */
	exposure?: 'home';
	driving?: boolean; // 只在自己开车（有车且驾照没暂停）抵达时出现：路检、测速、停车
	breakdown?: boolean; // 抛锚事件：不进普通抽取（weight 写 0），只在该保养的车自驾抵达时按几率抽
	weight: number;
	// ---- 事件引擎第一版（docs/earth-game/event-engine.md）：都可不写，不写和以前完全一样 ----
	/** 属性、关系、物品条件 */
	need?: EventNeed;
	/** 冷却：出现后这么多游戏小时内不再出现 */
	cooldown?: number;
	/** 每个游戏日最多出现几次 */
	daily?: number;
	/** 每个角色一共最多出现几次（once 是 1 次且首次到访优先，max 只限次数） */
	max?: number;
	/** 链式事件：只有前面某个结果的 unlocks 解锁后才会出现，出现一次后要再解锁才会再出现；解锁后条件满足就优先出（不看 weight、不掷到达几率） */
	locked?: boolean;
	/** 链式事件解锁后这么多游戏日内没出现就作废；不写不过期 */
	unlockDays?: number;
	choices: EventChoice[];
}

/** 一张保单：从 from 日起生效，到 until 日（不含）止；claims 是最近的理赔日（游戏日，最多 CLAIMS_MAX 条） */
export interface Cover {
	from: number;
	until: number;
	claims: number[];
}

export interface JournalEntry {
	t: number; // 游戏时钟（分钟）
	text: string;
}

/** 爱好与收集（docs/earth-game/hobbies.md）。熟练度、作品集、观鸟记录、菜园、手工都记在这一个字段里 */
export interface HobbyState {
	xp: Record<string, number>; // 爱好 id -> 熟练度 0–999
	day: number; // today、bag 记的是哪个游戏日，−1 表示还没有
	today: Record<string, number>; // 这一天各爱好做了几次（同一天反复做乐趣递减）
	bag: Record<string, number>; // 这一天带走的鱼：鱼种 id -> 条数（数量限制按它算）
	best: Record<string, number>; // 鱼种 id -> 钓到过的最大体长（cm，一位小数）
	birds: string[]; // 观鸟记录：见过的鸟 id
	works: Record<string, number>; // 作品集：地点 id -> 最好一张的分数 0–100
	plants: string[]; // 种成过的植物 id
	bed: { plant: string; day: number } | null; // 菜园里正在长的：哪种、哪个游戏日播的
	made: string[]; // 做过的手工 id
	got: string[]; // 已发过奖的收集里程碑，如 'birds:half'（发过不收回、不重发）
}

/** 生涯统计的钱款类别（docs/earth-game/career-stats.md）：收入按来源、支出按去向各记一份 */
export type TallyCat = 'work' | 'transport' | 'shop' | 'housing' | 'vehicle' | 'study' | 'fun' | 'social' | 'event' | 'daily' | 'reward' | 'other';
/** 一个周期（周、年）开始时的累计数快照；周期结束时和当时的累计数相减得到小结 */
export interface TallySnap { i: number; earned: number; out: Partial<Record<TallyCat, number>>; km: number; places: number; people: number }
/** 一个已经结束的周期的小结：第 i 周（年）起 n 个周期里的增量；top 是花钱最多的去向 */
export interface TallyCard { i: number; n: number; earned: number; spent: number; top: TallyCat | null; topAmt: number; km: number; places: number; people: number }
/** 生涯统计：只累积计数，不存逐条明细 */
export interface Tally {
	from: number; // 从哪个游戏日开始统计（新角色 0；统计上线前的旧存档是迁移那天）
	km: number; // 累计出行公里（整数）
	in: Partial<Record<TallyCat, number>>; // 累计收入，按来源，整元
	out: Partial<Record<TallyCat, number>>; // 累计支出，按去向，整元
	ms: Record<string, number>; // 里程碑 id -> 达成的游戏日；−1 表示统计上线前就已达成
	pre: boolean; // 旧存档刚迁移：下一次结算时把已经满足的里程碑记成 −1
	wk: TallySnap; // 本周开始时的快照（来澳第 i 周，从 0 起）
	yr: TallySnap; // 本年开始时的快照
	lastWk: TallyCard | null; // 上一个结束的周
	lastYr: TallyCard | null; // 上一个结束的年
	cash?: number; // 上次记账时的现金（取整）。两次记账之间在别处变了的现金（服务端交易所、别的部署）下次补记到「其他」，收入 − 支出始终等于现金变化（合并 main 后加）
}

/** 法律记录（第 43 批，见 core/law.ts） */
export interface LawRecord {
	hist: { t: number; id: string; n: number }[]; // 违章记录：游戏时钟、违章 id、扣了几分（扣满停驾后清零），最多 30 条
	ban: number; // 驾照暂停到这个游戏时钟，0 为没有
	owed: number; // 没交上的罚款（澳元）
	cs: number; // 还欠的社区服务小时
	csDue: number; // 社区服务期限（游戏日），没有为 −1
	record: number; // 法庭定罪次数
	drank: number; // 最近一次喝酒的游戏时钟，−1 为没有或已过窗口
}

// ---------- 宠物（v31，见 data/pets.ts、core/pets.ts） ----------
export interface Pet {
	kind: string; // PetKindDef.id
	name: string;
	from: 'shelter' | 'breeder';
	since: number; // 领回家的游戏日
	bond: number; // 好感度 0–100（只会涨涨跌跌，宠物不会因为没照顾而离开、受伤或死亡）
	fedDay: number; // 最近一次喂的游戏日
	playDay: number; // 最近一次陪玩的游戏日，−1 为还没有
	walkDay: number; // 最近一次遛的游戏日（只有狗），−1 为还没有
	vetDay: number; // 最近一次体检的游戏日（领养时算一次）
	board: { loc: string; until: number } | null; // 寄养在哪、付到第几个游戏日
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
	law: LawRecord; // 违章、罚款、停驾、社区服务、定罪记录
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
	rental: RentalState; // 租房市场（rental 批次）：租约、看房、退租记录、待处理的押金扣款
	properties: OwnedProperty[];
	holdings: Record<string, Holding>; // 资产 id -> 持仓（第 25 批）
	quotes?: Record<string, number[]>; // 只在发给客户端的副本里有（publicState 填）：每种资产最近几天的价格，客户端没有行情种子，靠它显示行情
	marketSeed: number; // 行情种子：创建时由服务端随机种子派生，不发给客户端（publicState 清零），否则能推算未来价格
	nextWeek: number; // 下一次周结算的游戏日（房租、车辆保险等）
	cover: Record<string, Cover>; // 保单：保单 id（data/insurance.ts）-> 生效期和理赔记录
	moodlets: Moodlet[]; // 带时限的心情状态
	mind: { day: number; low: number }; // 心事结算：最近结算到哪个游戏日；连续几天心情低落（0–30）。见 core/mind.ts
	wishes: string[]; // 今天还没完成的心愿 id
	wishDay: number; // 这批心愿是哪个游戏日生成的，−1 表示还没生成
	daily: { day: number; streak: number }; // 每日奖励：最近领取的现实日序号、连续天数
	collected: string[]; // 已完成的收费体验 id
	areas: string[]; // 已获得称号的体验片区 id：集齐时记下，之后加了新体验也不收回、不重复发奖
	courseDays: Record<string, number>; // 课程 id -> 最近一次上课的游戏日
	certs: string[]; // 已考到的职业证书 id 和学历 id（跟人走，换工作不丢）
	study: Record<string, { n: number; day: number }>; // 学历课程 id -> 已上几次、最近一次上课的游戏日
	workLog: { f: number; min: number }; // 签证工时：第几个两周（游戏日 / 14）、这两周已上班的分钟（职业班次 + 零工）
	coopDays: Record<string, number>; // 共同事件 id -> 最近一次参加的游戏日（每种每 COOP_COOLDOWN_DAYS 天一次）
	trades: { day: number; out: number; in: number }; // 玩家之间交易：这个现实日已送出 / 收下的次数
	swap: { day: number; done: string[]; sold: number; dodged: number; lost: number }; // 二手市场（换手墙）：哪个游戏日、当天处理过的挂单 id、当天卖出次数；累计识破 / 被骗次数
	weekly: { week: number; n: number; claimed: boolean }; // 全服周目标：哪一周、我出了几份力、领没领
	achClaimed: string[]; // 已领过奖励的成就 id（领过就记下，之后成就条件丢了也不收回、不重复发）
	side: { done: string[]; cur: Record<string, Record<string, number>> }; // 支线：已完成的支线 id；进行中的支线各目标进度
	title: string; // 佩戴的称号 id（见 core/titles.ts），'' 为不戴
	live: string[]; // 领过到场纪念的现实活动 id（第 24 批，见 core/live.ts）
	blocked: Record<string, { name: string; avatar: string; day: number }>; // 屏蔽的玩家：id 哈希前缀 -> 名字、头像、屏蔽时的现实日（第 24 批，见 core/safety.ts）
	met: Record<string, { name: string; avatar: string; n: number; last: number }>; // 常遇见的人：玩家 id 哈希前缀 -> 名字、头像、一起做事的次数、最近一次的现实日
	pet: Pet | null; // 宠物（第一版最多一只）
	pending: { eventId: string } | null;
	evMem: EventMemory; // 事件引擎记录：冷却、每日上限、最近出过的事件、已解锁的链式事件（见 core/event-rules.ts）
	trails: Record<string, { at: number; leg: boolean; t: number }>; // 主要路线（实地路线）进度：路线 id -> 到了几站、这一段沿途事件出没出、到上一站的服务端时间（毫秒，0 为还没出发）。不存坐标
	fix: { lat: number; lon: number; at: number } | null; // 最近一次真实定位（坐标保留 3 位小数，约 100 米；at 为服务端时间）
	venueCd: Partial<Record<VenueOp, number>>; // 每种真实地点动作最近一次的服务端时间（毫秒）
	venueEvAt: number; // 最近一次真实地点事件的服务端时间（毫秒），0 为从未
	clockIn: { venue: string; at: number; career?: string } | null; // 真实打卡上班：哪个地点、几点打的卡；career 是按哪份职业打的卡，没有就是零工
	realWork: { day: number; min: number }; // 当天（现实日，珀斯时间）已计薪的真实上班分钟
	workDay: number; // 最近一次算过班次的游戏日，−1 表示还没上过；跟人走，不随换工作重置
	hobby: HobbyState; // 爱好与收集
	tally: Tally; // 生涯统计（「我 · 生涯」）：累计收支、公里、里程碑和周期小结，见 career-stats.md
	illness: { id: string; since: number; until: number; care: string[]; rx: boolean } | null; // 正在生的病或伤（data/health.ts 的 id）：游戏时钟的起止分钟、这次已做过的就医（gp/pharmacy/ed/rx）、GP 是否开了处方；见 docs/earth-game/health.md
	visa: VisaState; // 签证路线（第 43 批，docs/earth-game/visa.md）；非留学生出身 kind 为 'none'
	journal: JournalEntry[];
	biz: Business; // 副业与小生意：证照、副业冷却、营业额账本、店铺（见 core/business.ts）
	sport: SportState; // 运动和比赛（docs/earth-game/sports.md）
	cooking: Cooking; // 做饭：烹饪技能、做过的菜、食材柜、请客冷却（做饭分支）
	/** 新手引导（v36）：已解开的功能、已关掉的提示和里程碑、最近一次回流（现实日、离开天数、看过没有）、是否关掉全部引导。见 core/onboard.ts */
	onboard: { feats: string[]; tips: string[]; back: { day: number; gap: number; seen: boolean } | null; off: boolean };
	seed: number;
	rev: number; // 存档版本号，云同步用
}

/** 自己开的店（第 1 版每人最多一家）。日期都是游戏日 */
export interface ShopState {
	type: string; // data/business.ts 的 SHOP_TYPES
	site: string; // SHOP_SITES
	day: number; // 开业那天
	last: number; // 已经结算到哪一天（含）
	stock: number; // 库存（单）
	staff: number; // 店员人数 0–SHOP_RULES.maxStaff
	tend: number; // 你自己看店的那天，−1 为没有
	rep: number; // 口碑 0–100
	debt: number; // 欠款（付不起的租金、工资），≥0
	bond: number; // 押金
	hist: { d: number; sold: number; net: number }[]; // 最近几天的账
}

export interface Business {
	lic: Record<string, number>; // 证照 id -> 办下来的游戏日
	gigs: Record<string, number>; // 副业 id -> 最近一次做的游戏日（每种每天一次）
	gst: boolean; // 已登记 GST
	book: { y: number; gross: number; net: number }; // 本游戏年的生意账：第几年、营业额、净收入（给税务系统用）
	shop: ShopState | null;
}

/** 一场比赛的成绩 */
export interface SportResult {
	race: string; // RACES 的 id
	key: string; // 哪一届：每年一次 `id:y年`，每周赛 `id:d游戏日`
	medal: 'gold' | 'silver' | 'bronze' | 'finish' | 'dnf';
	place: number; // 名次，未完赛为 0
	secs: number; // 用时（秒），未完赛为 0
	day: number; // 比赛的游戏日
}

/** 运动和比赛的存档（字段名 sport，规范见 save-sync.md §5） */
export interface SportState {
	/** 各项运动的准备度：v 0–100（最近一次训练后的值，读取时按天数衰减）、d 最近一次训练的游戏日、n 那天练了几次 */
	form: Partial<Record<string, { v: number; d: number; n: number }>>;
	/** 各项运动累计训练次数 */
	total: Record<string, number>;
	/** 最近一次拿到「运动后健康 +1」的游戏日，−1 为从未 */
	hday: number;
	/** 俱乐部：会员有效到哪个游戏日（不含）、最近一次上训练课的游戏日（−1 为没上过） */
	club: { id: string; until: number; last: number } | null;
	/** 已报名、还没比的场次（届的标识，同 SportResult.key），最多 10 条 */
	entries: string[];
	/** 最近的比赛成绩，新的在前，最多 20 条 */
	results: SportResult[];
	/** 各比赛的个人最好成绩（秒） */
	pb: Record<string, number>;
}

/** 签证路线的存档（第 43 批）。日子都是游戏日（dayOf），−1 表示没有 */
export interface VisaState {
	kind: VisaKind;
	until: number; // 签证到期日（含这一天）；none / pr / expired 为 −1
	since: number; // 当前签证批下来的那天
	age0: number; // 第 0 天的年龄；每 VISA_RULES.daysPerYear 天长一岁。none 为 0
	ielts: number; // 雅思总分 0–9，半分一档；0 表示没考过
	degree: 'none' | 'bachelor' | 'master'; // 在澳洲拿到的最高学历
	course: { end: number; award: 'bachelor' | 'master' } | null; // 正在读的课程：哪天结束、毕业拿什么
	exp: number; // 在清单职业里攒的工作日数（每个游戏日最多 1）
	occ: string | null; // 最近一次算进经验的职业 id
	sponsor: { career: string; days: number } | null; // 482：担保的职业、在担保下上了几天班
	expAt: number; // 当前签证批下来时的 exp（191 看持 491 期间上了几天班）
	had: VisaKind[]; // 拿过的签证（第二次 485 之类只能一次）
	warned: boolean; // 这张签证到期前提醒过没有
}

export interface ActionResult {
	ok: boolean;
	state: PlayerState;
	msg: string;
	/** 动作途中晕倒被送医：原动作的后续结算（班次、升职、心愿、额外状态、到店事件）都不再发生 */
	collapsed?: boolean;
}
