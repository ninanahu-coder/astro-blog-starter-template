// 角色创建与存档校验。初始属性参考开放世界动作游戏的“能力条”思路：
// 体能/力量/驾驶/游泳/魅力/生存/街头，全部通过实际行为成长。
import { cleanCooking, newCooking } from './cooking-save.ts';
import { migrateSave } from './save.ts';
import { cleanTally, newTally } from './tally.ts';
import { cleanVisa, newVisa } from './visa-save.ts';
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type { HobbyState, Home, Job, OwnedProperty, Needs, Pet, PlayerState, Relation, Skills, Vehicle } from './types.ts';
import { getPetKind, PET } from '../data/pets.ts';
import { dayOf } from './time.ts';
import { ITEMS } from '../data/items.ts';
import { MAX_TRAITS } from '../data/traits.ts';
import { NPCS } from '../data/npcs.ts';
import { CAREERS } from '../data/careers.ts';
import { BOND_WEEKS, HOMES } from '../data/housing.ts';
import { CAR_KM_MAX, VEHICLES } from '../data/vehicles.ts';
import { FURNITURE } from '../data/furniture.ts';
import { PROPERTIES } from '../data/properties.ts';
import { ASSETS, QUOTE_DAYS } from '../data/assets.ts';
import { deriveMarketSeed } from './market.ts';
import { WISHES } from '../data/wishes.ts';
import { MOODLET_MAX, MOODLETS } from '../data/moodlets.ts';
import { MIND } from '../data/mind.ts';
import { VENUE_OPS } from '../data/venues.ts';
import { FINANCE } from './finance.ts';
import { realDayOf } from './daily.ts';
import { cleanIllness } from './health.ts';
import { cleanOnboard, freshOnboard } from './onboard.ts';
// 只用到地点和打卡点，不需要真实地点数据：用首屏版区域，页面不必为此加载 wa.venues.json
import { cleanLaw, emptyLaw } from './law.ts';
import { AREAS as REGION_AREAS, areaOf, WORLD_BASE } from '../data/areas-base.ts';
import { COURSES } from '../data/courses.ts';
import { CERTS } from '../data/certs.ts';
import { AWARDS, PROGRAMS } from '../data/education.ts';
import { ANIMALS, DEX_GROUPS } from '../data/wildlife.ts';
import { FISH } from '../data/fish.ts';
import { PHOTO_QUESTS } from '../data/photo-quests.ts';
import { STORY } from '../data/story.ts';
import { ACHIEVEMENTS } from '../data/achievements.ts';
import { SIDE_QUESTS } from '../data/quests.ts';
import { earnedTitles } from './titles.ts';
import { TRAILS } from '../data/trails.ts';
import { NPC_DUOS } from '../data/npc-duos.ts';
import { CONFIDANT } from '../data/relations.ts';
import { AREA_HISTORY, AREAS, EXPERIENCES } from '../data/experiences.ts';
import { COOP_EVENTS } from '../data/coop.ts';
import { EVENTS } from '../data/events.ts';
import { cleanEvMem, emptyMemory } from './event-rules.ts';
import { validTraits } from './attributes.ts';
import { cleanRental, emptyRental } from './rental.ts';
import { WEATHERS } from '../data/weather.ts';
import { SWAP } from '../data/secondhand.ts';
import { BIRDS, CRAFTS, HOBBY, HOBBY_IDS, PLANTS } from '../data/hobbies.ts';
import { CLUBS, RACES, SPORT_IDS, SPORT_RULES } from '../data/sports.ts';
import { cleanCover } from './insurance.ts';
import { cleanBlocked } from './safety.ts';

/** 现实活动的到场纪念（第 24 批，见 core/live.ts）：存档最多记多少个、id 的格式 */
export const LIVE_MAX = 200;
export const LIVE_ID_RE = /^[a-z0-9-]{1,48}$/;

/** 天气相册里所有合法的照片 id：地点 × 天气 */
export const photoIds = (locIds: string[]) => new Set(locIds.flatMap((l) => WEATHERS.map((w) => `${l}|${w.id}`)));

export const NEED_META: Record<string, { name: string; icon: string }> = {
	hunger: { name: '饱食', icon: '🍔' },
	energy: { name: '精力', icon: '⚡' },
	hygiene: { name: '清洁', icon: '🚿' },
	fun: { name: '娱乐', icon: '🎉' },
	social: { name: '社交', icon: '💬' },
};

export const SKILL_META: Record<string, { name: string; icon: string; hint: string }> = {
	stamina: { name: '体能', icon: '🏃', hint: '徒步、冲浪、长途旅行' },
	strength: { name: '力量', icon: '💪', hint: '健身、矿场和码头的体力活' },
	driving: { name: '驾驶', icon: '🚗', hint: '自驾里程越多越熟练，行车更快' },
	swimming: { name: '游泳', icon: '🏊', hint: '下海、浮潜' },
	charisma: { name: '魅力', icon: '😎', hint: '社交、街头表演、谈判' },
	survival: { name: '生存', icon: '🧭', hint: '内陆探索、露营' },
	street: { name: '街头', icon: '🎲', hint: '应付麻烦、捡漏、讨价还价' },
};

export interface Origin {
	id: string;
	name: string;
	icon: string;
	desc: string;
	cash: number;
	vehicle: Vehicle;
	/** 只写高于起步值的能力；没写的从 BASE_SKILL 开始，完整 7 项用 originSkills() 取 */
	skills: Partial<Skills>;
	/** 一句话定位（入境卡上的标签），见 docs/earth-game/initial-stats.md */
	role: string;
	/** 这个出身开局就对口的职业（CAREERS 的 id），界面用来提示「适合做什么」 */
	careers: string[];
	/** 推荐的特质组合（合法的 MAX_TRAITS 个），只是提示，不限制选择 */
	suggestTraits: string[];
}

/** 出身没写的能力从这个值开始 */
export const BASE_SKILL = 5;
/** 五项需求的起步值 */
export const START_NEED = 80;

// 数值（cash、skills）沿用现状，未经 Codex 平衡分析前不改；新出身和调整建议见 docs/earth-game/initial-stats.md（待平衡）
export const ORIGINS: Origin[] = [
	{ id: 'backpacker', name: '背包客', icon: '🎒', desc: '钱不多，但能走能扛，适应力强。', cash: 600, vehicle: 'none', skills: { stamina: 30, survival: 25, charisma: 15 }, role: '穷游 · 野外', careers: ['farmhand', 'guide'], suggestTraits: ['loner', 'frugal'] },
	{ id: 'fifo', name: '矿区轮班工', icon: '⛏️', desc: '飞进飞出的矿工，力气大、存款厚。', cash: 2500, vehicle: 'none', skills: { strength: 35, stamina: 20, driving: 15 }, role: '体力 · 高薪', careers: ['miner', 'farmhand'], suggestTraits: ['athletic', 'tough'] },
	{ id: 'student', name: '留学生', icon: '🎓', desc: '人缘好脑子快，开着一辆二手小车。', cash: 1200, vehicle: 'car', skills: { charisma: 30, street: 15, driving: 10 }, role: '城市 · 社交', careers: ['barista', 'bartender'], suggestTraits: ['charming', 'neat'] },
	{ id: 'surfer', name: '冲浪手', icon: '🏄', desc: '为浪而生，海里比岸上自在。', cash: 800, vehicle: 'none', skills: { swimming: 40, stamina: 25, charisma: 10 }, role: '海岸 · 水上', careers: ['lifeguard', 'guide'], suggestTraits: ['waterborn', 'athletic'] },
];

/** 按 id 找出身，找不到回落到第一个（与 createCharacter 一致） */
export const getOrigin = (id: string): Origin => ORIGINS.find((o) => o.id === id) ?? ORIGINS[0];

/** 出身的完整 7 项起步能力（没写的取 BASE_SKILL）。创建角色和入境卡预览共用 */
export const originSkills = (o: Origin): Skills => Object.fromEntries(SKILL_KEYS.map((k) => [k, o.skills[k] ?? BASE_SKILL])) as Skills;

export const AVATARS = ['🧑', '👩', '👨', '🧔', '👱', '🧑‍🦱', '👩‍🦰', '🧕', '🤠', '😎'];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const clamp100 = (n: number) => clamp(n, 0, 100);

export const START_CLOCK = 8 * 60; // 第 1 天 08:00

export function createCharacter(opts: {
	id: string;
	name: string;
	avatar: string;
	origin: string;
	region: string;
	spawn: string;
	seed: number; // 随机种子由服务端生成后传入，引擎内不自己生成随机数
	traits?: string[];
}): PlayerState {
	const origin = getOrigin(opts.origin);
	const skills = originSkills(origin);
	const needs = Object.fromEntries(NEED_KEYS.map((k) => [k, START_NEED])) as Needs;
	return {
		v: 1,
		id: opts.id,
		name: cleanName(opts.name) || '旅人',
		avatar: AVATARS.includes(opts.avatar) ? opts.avatar : AVATARS[0],
		origin: origin.id,
		region: opts.region,
		clock: START_CLOCK,
		loc: opts.spawn,
		cash: origin.cash,
		health: 100,
		respect: 0,
		heat: 0,
		law: emptyLaw(),
		needs,
		skills,
		vehicle: origin.vehicle,
		visited: { [opts.spawn]: 1 },
		checkins: [],
		photos: [],
		dex: [],
		fish: {},
		photoQuest: 0,
		story: { ch: 0, done: {} },
		duos: [],
		dayMark: { day: Math.floor(START_CLOCK / 1440), at: START_CLOCK - 1, cash: origin.cash, respect: 0, places: 1 }, // at 早一分钟：开局那条日志算在第 1 天
		yday: null,
		dexSets: [],
		seen: [],
		traits: validTraits(opts.traits ?? [], MAX_TRAITS) ? [...(opts.traits ?? [])] : [],
		car: { km: 0, since: 0 },
		inventory: { water: 2, snack: 1 },
		relations: {},
		job: null,
		home: null,
		rental: emptyRental(),
		properties: [],
		holdings: {},
		marketSeed: deriveMarketSeed(opts.seed >>> 0),
		nextWeek: 7,
		cover: {}, // 保单（第 43 批）：开局没有；看病的保障跟签证走（core/health.ts coverOf）
		moodlets: [],
		mind: { day: Math.floor(START_CLOCK / 1440), low: 0 },
		wishes: [],
		wishDay: -1,
		daily: { day: 0, streak: 0 },
		collected: [],
		areas: [],
		courseDays: {},
		certs: [],
		study: {},
		workLog: { f: 0, min: 0 },
		coopDays: {},
		trades: { day: 0, out: 0, in: 0 },
		swap: { day: 0, done: [], sold: 0, dodged: 0, lost: 0 },
		met: {},
		live: [],
		blocked: {},
		weekly: { week: 0, n: 0, claimed: false },
		achClaimed: [],
		side: { done: [], cur: {} },
		title: '',
		pet: null,
		pending: null,
		evMem: emptyMemory(),
		trails: {},
		fix: null,
		venueCd: {},
		venueEvAt: 0,
		clockIn: null,
		realWork: { day: 0, min: 0 },
		workDay: -1,
		hobby: emptyHobby(),
		tally: newTally({ clock: START_CLOCK, visited: { [opts.spawn]: 1 }, relations: {}, met: {}, cash: origin.cash }),
		illness: null,
		visa: newVisa(origin.id, Math.floor(START_CLOCK / 1440)),
		journal: [{ t: START_CLOCK, text: `以「${origin.name}」的身份开始了新生活。` }],
		sport: emptySport(),
		cooking: newCooking(),
		onboard: freshOnboard(),
		seed: opts.seed >>> 0,
		rev: 0,
	};
}

export function cleanName(s: unknown): string {
	return String(s ?? '')
		.replace(/[<>&"'\s\u0000-\u001f]/g, '')
		.slice(0, 12);
}

const num = (v: unknown, lo: number, hi: number, dflt: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt;
const strList = (v: unknown, max: number) =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, max) : [];

/** 只留在 known 里的字符串，去重，保持原有顺序。长度天然不超过 known 的大小 */
const knownList = (v: unknown, known: Set<string>) =>
	Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))] : [];

/**
 * 校验并规范化一份不可信的存档（来自 localStorage 或网络）。
 * 结构不对返回 null；数值全部钳制到合法范围。服务端落盘前必须调用。
 */
/** 存档里几个只增不减的数的上限。sanitizeState() 和动作结算（capState）共用：动作的结果不能越过校验允许的范围 */
export const CAPS = { clock: 1e9, cash: 1e9, respect: 1e6, rev: 1e9 };

/** 下一个版本号：到上限就回到 0，永远落在校验允许的范围内 */
export const nextRev = (rev: number) => (rev + 1 >= CAPS.rev ? 0 : rev + 1);

/** 把动作结算后的状态钳回上限（原地修改，调用方传入的是引擎新建的对象）。正常游玩到不了这些上限，只有损坏的存档会碰到 */
export function capState(state: PlayerState): PlayerState {
	state.clock = Math.min(state.clock, CAPS.clock);
	state.cash = Math.min(state.cash, CAPS.cash);
	state.respect = Math.min(state.respect, CAPS.respect);
	return state;
}

export interface SanitizeOpts {
	/** 当前所在地已经不存在（地点被删或改名）时把人挪到这里，而不是判整份存档损坏 */
	fallbackLoc?: string;
	/** 可信的当前现实时间（毫秒，服务端传）：晚于它的定位、冷却、上班卡时间和每日奖励日期都是坏数据，清掉 */
	now?: number;
}

export function sanitizeState(raw: unknown, knownLocs?: Set<string>, opts: SanitizeOpts = {}): PlayerState | null {
	// 先认格式版本：旧版本按迁移表升上来，比这版代码新的尽量读（规范见 save.ts、docs/earth-game/save-sync.md §5）
	const r0 = migrateSave(raw) as Record<string, any> | null;
	if (!r0 || typeof r0.id !== 'string' || typeof r0.loc !== 'string') return null;
	if (!/^[a-zA-Z0-9_-]{6,40}$/.test(r0.id)) return null;
	let r = r0;
	if (knownLocs && !knownLocs.has(r.loc)) {
		if (!opts.fallbackLoc || !knownLocs.has(opts.fallbackLoc)) return null;
		// 不修改入参：换一个浅拷贝，把人挪到安全落点并记为到访过
		r = { ...r0, loc: opts.fallbackLoc, visited: { ...(r0.visited && typeof r0.visited === 'object' ? r0.visited : {}), [opts.fallbackLoc]: 1 } };
	}
	const needs = {} as Needs;
	for (const k of NEED_KEYS) needs[k] = num(r.needs?.[k], 0, 100, 50);
	const skills = {} as Skills;
	for (const k of SKILL_KEYS) skills[k] = num(r.skills?.[k], 0, 100, 0);
	const visited: Record<string, number> = {};
	if (r.visited && typeof r.visited === 'object') {
		for (const [k, v] of Object.entries(r.visited).slice(0, 500)) {
			if (k.length <= 64 && (!knownLocs || knownLocs.has(k))) visited[k] = Math.max(1, Math.floor(num(v, 0, 1e6, 1))); // 到访次数是正整数
		}
	}
	const journal = Array.isArray(r.journal)
		? r.journal
				.slice(-JOURNAL_MAX)
				.filter((j: any) => j && typeof j.text === 'string')
				.map((j: any) => ({ t: num(j.t, 0, 1e9, 0), text: String(j.text).slice(0, 200) }))
		: [];
	const out: PlayerState = {
		v: 1,
		id: r.id,
		name: cleanName(r.name) || '旅人',
		avatar: AVATARS.includes(r.avatar) ? r.avatar : AVATARS[0],
		origin: ORIGINS.some((o) => o.id === r.origin) ? r.origin : ORIGINS[0].id,
		// 区域由所在地点决定（第 41 轮）：存档里写的区域只是缓存，跨区域出行后跟着地点走
		region: areaOf(r.loc)?.id ?? REGION_AREAS[0].id,
		clock: num(r.clock, 0, CAPS.clock, START_CLOCK),
		loc: r.loc,
		cash: Math.round(num(r.cash, 0, CAPS.cash, 0)),
		health: num(r.health, 0, 100, 100),
		respect: num(r.respect, 0, CAPS.respect, 0),
		heat: num(r.heat, 0, 100, 0),
		law: cleanLaw(r.law, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		needs,
		skills,
		vehicle: VEHICLES.some((v) => v.id === r.vehicle) ? r.vehicle : 'none',
		visited,
		// 一次性奖励的记录只留现在还存在的 id、去重。不能只按长度截：列表被垃圾 id 塞满的话，
		// 引擎新追加在末尾的真实 id 下次校验会被截掉，那份奖励就能再领一次
		checkins: knownList(r.checkins, new Set(WORLD_BASE.pois.map((p) => p.id))),
		seen: knownList(r.seen, new Set(EVENTS.map((e) => e.id))),
		photos: knownList(r.photos, photoIds(WORLD_BASE.locations.map((l) => l.id))),
		traits: (() => {
			const t = strList(r.traits, MAX_TRAITS);
			return validTraits(t, MAX_TRAITS) ? t : [];
		})(),
		inventory: cleanInventory(r.inventory),
		relations: cleanRelations(r.relations),
		job: cleanJob(r.job, knownLocs),
		// 旧存档没有这个字段：用当前工作的 lastDay 补上
		workDay: Math.floor(Math.max(num(r.workDay, -1, 1e7, -1), num(r.job?.lastDay, -1, 1e7, -1))),
		illness: cleanIllness(r.illness, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		visa: cleanVisa(r.visa, ORIGINS.some((o) => o.id === r.origin) ? r.origin : ORIGINS[0].id, Math.floor(num(r.clock, 0, CAPS.clock, START_CLOCK) / 1440), new Set(CAREERS.map((c) => c.id))),
		...cleanEstate(r, knownLocs),
		rental: cleanRental(r.rental, cleanEstate(r, knownLocs).home, Math.floor(num(r.clock, 0, CAPS.clock, START_CLOCK) / 1440), knownLocs),
		cover: cleanCover(r.cover, Math.floor(num(r.clock, 0, CAPS.clock, START_CLOCK) / 1440)),
		holdings: (() => {
			const out: Record<string, { units: number; cost: number }> = {};
			for (const def of ASSETS) {
				const h = r.holdings?.[def.id];
				const units = num(h?.units, 0, 1e15, 0); // 份数上限放宽：虚拟币长期可能跌到几分钱，同样的钱能买很多份
				if (units > 0) out[def.id] = { units, cost: num(h?.cost, 0, 1e9, 0) };
			}
			return out;
		})(),
		// 客户端收到的行情（publicState 填，服务端的存档里没有）：只留已知资产、1–QUOTE_DAYS 个正数的；有一项不对就整个不要
		...(() => {
			const q = r.quotes;
			if (!q || typeof q !== 'object') return {};
			const out: Record<string, number[]> = {};
			for (const def of ASSETS) {
				const arr = q[def.id];
				if (!Array.isArray(arr) || arr.length < 1 || arr.length > QUOTE_DAYS || !arr.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0 && p < 1e12)) return {};
				out[def.id] = [...arr];
			}
			return { quotes: out };
		})(),
		// 旧存档没有行情种子：用服务端的随机种子派生（同样不发给客户端）
		marketSeed: typeof r.marketSeed === 'number' && Number.isInteger(r.marketSeed) && r.marketSeed >= 0 && r.marketSeed < 2 ** 32 ? r.marketSeed : deriveMarketSeed(num(r.seed, 0, 2 ** 32 - 1, 1) >>> 0),
		nextWeek: (() => {
			// 旧存档没有 nextWeek：沿用旧的房租到期日，否则从今天起算一周
			const today = Math.floor(num(r.clock, 0, 1e9, START_CLOCK) / 1440);
			const raw = typeof r.nextWeek === 'number' ? r.nextWeek : typeof r.home?.paidUntil === 'number' ? r.home.paidUntil : today + 7;
			return Math.floor(num(raw, today - 7, today + 7, today + 7));
		})(),
		moodlets: (() => {
			// 只保留已知状态；失效时间不能早于现在、也不能超过该状态的最长时长
			const clock = num(r.clock, 0, 1e9, START_CLOCK);
			const out: { id: string; until: number }[] = [];
			for (const m of Array.isArray(r.moodlets) ? r.moodlets.slice(0, 50) : []) {
				const def = MOODLETS.find((d) => d.id === m?.id);
				if (!def || out.some((o) => o.id === def.id) || typeof m.until !== 'number' || !Number.isFinite(m.until)) continue;
				if (m.until <= clock) continue;
				out.push({ id: def.id, until: Math.floor(Math.min(m.until, clock + def.hours * 60)) });
			}
			return out.slice(-MOODLET_MAX);
		})(),
		mind: cleanMind(r.mind, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		wishes: [...new Set(strList(r.wishes, 10))].filter((id) => WISHES.some((w) => w.id === id)),
		wishDay: Math.floor(num(r.wishDay, -1, 1e7, -1)),
		daily: cleanDaily(r, opts.now),
		collected: [...new Set(strList(r.collected, 200))].filter((id) => EXPERIENCES.some((e) => e.id === id)),
		areas: (() => {
			if (Array.isArray(r.areas)) return [...new Set(strList(r.areas, 20))].filter((id) => id in AREAS);
			// 旧存档：按现在的清单或以前的清单集齐过的片区都算已获得
			const got = new Set(strList(r.collected, 200));
			const lists = (id: string) => [EXPERIENCES.filter((e) => e.area === id).map((e) => e.id), ...(AREA_HISTORY[id] ?? [])];
			return Object.keys(AREAS).filter((id) => lists(id).some((l) => l.length > 0 && l.every((x) => got.has(x))));
		})(),
		courseDays: (() => {
			const out: Record<string, number> = {};
			for (const c of COURSES) {
				const d = r.courseDays?.[c.id];
				if (typeof d === 'number' && Number.isFinite(d) && d >= 0) out[c.id] = Math.floor(d);
			}
			return out;
		})(),
		certs: [...new Set(strList(r.certs, 50))].filter((id) => CERTS.some((c) => c.id === id) || AWARDS.includes(id)),
		study: (() => {
			const out: Record<string, { n: number; day: number }> = {};
			for (const p of PROGRAMS) {
				const st = r.study?.[p.id];
				if (st && typeof st === 'object') out[p.id] = { n: Math.floor(num(st.n, 0, p.sessions, 0)), day: Math.floor(num(st.day, -1, 1e7, -1)) };
			}
			return out;
		})(),
		workLog: { f: Math.floor(num(r.workLog?.f, 0, 1e6, 0)), min: Math.floor(num(r.workLog?.min, 0, 1e6, 0)) },
		photoQuest: Math.floor(num(r.photoQuest, 0, PHOTO_QUESTS.length, 0)),
		story: (() => {
			const ch = Math.floor(num(r.story?.ch, 0, STORY.length, 0));
			const done: Record<string, number> = {};
			for (const step of STORY[ch]?.steps ?? []) {
				const n = r.story?.done?.[step.id];
				if (typeof n === 'number' && Number.isFinite(n) && n >= 1) done[step.id] = Math.min(step.n ?? 1, Math.floor(n));
			}
			return { ch, done };
		})(),
		fish: (() => {
			const out: Record<string, number> = {};
			for (const f of FISH) {
				const n = r.fish?.[f.id];
				if (typeof n === 'number' && Number.isFinite(n) && n >= 1) out[f.id] = Math.min(1e6, Math.floor(n));
			}
			return out;
		})(),
		dex: [...new Set(strList(r.dex, 200))].filter((id) => ANIMALS.some((a) => a.id === id)),
		dexSets: [...new Set(strList(r.dexSets, 20))].filter((id) => Object.hasOwn(DEX_GROUPS, id)),
		duos: [...new Set(strList(r.duos, 100))].filter((id) => NPC_DUOS.some((d) => d.id === id)),
		dayMark: { day: 0, at: 0, cash: 0, respect: 0, places: 0 }, // 下面按清洗后的时钟、现金重新算
		yday: null,
		car: (() => {
			// 没车就没有里程；离上次保养的里程不超过总里程
			if (!VEHICLES.some((v) => v.id === r.vehicle)) return { km: 0, since: 0 };
			const km = Math.floor(num(r.car?.km, 0, CAR_KM_MAX, 0));
			return { km, since: Math.min(km, Math.floor(num(r.car?.since, 0, CAR_KM_MAX, 0))) };
		})(),
		swap: cleanSwap(r.swap, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		trades: {
			day: Math.floor(num(r.trades?.day, 0, 1e7, 0)),
			out: Math.floor(num(r.trades?.out, 0, 1000, 0)),
			in: Math.floor(num(r.trades?.in, 0, 1000, 0)),
		},
		weekly: {
			week: Math.floor(num(r.weekly?.week, 0, 1e7, 0)),
			n: Math.floor(num(r.weekly?.n, 0, 1e6, 0)),
			claimed: r.weekly?.claimed === true,
		},
		achClaimed: [...new Set(strList(r.achClaimed, 200))].filter((id) => ACHIEVEMENTS.some((d) => d.id === id)),
		side: cleanSide(r.side),
		title: '', // 下面按清洗后的来源核对
		live: Array.isArray(r.live) ? [...new Set((r.live as unknown[]).filter((x): x is string => typeof x === 'string' && LIVE_ID_RE.test(x)))].slice(-LIVE_MAX) : [],
		blocked: cleanBlocked(r.blocked, cleanName),
		met: (() => {
			const out: PlayerState['met'] = {};
			if (r.met && typeof r.met === 'object') {
				for (const [k, v] of Object.entries(r.met as Record<string, any>).slice(0, 60)) {
					if (!/^[a-f0-9]{12}$/.test(k) || !v || typeof v !== 'object') continue;
					out[k] = {
						name: cleanName(v.name) || '旅人',
						avatar: String(v.avatar ?? '🧑').replace(/[<>&"']/g, '').slice(0, 8) || '🧑',
						n: Math.floor(num(v.n, 1, 1e6, 1)),
						last: Math.floor(num(v.last, 0, 1e7, 0)),
					};
				}
			}
			// 超过上限时留最近见过的
			const keys = Object.keys(out).sort((a, b) => out[b].last - out[a].last || out[b].n - out[a].n);
			for (const k of keys.slice(30)) delete out[k];
			return out;
		})(),
		coopDays: (() => {
			const out: Record<string, number> = {};
			for (const c of COOP_EVENTS) {
				const d = r.coopDays?.[c.id];
				if (typeof d === 'number' && Number.isFinite(d) && d >= 0) out[c.id] = Math.floor(d);
			}
			return out;
		})(),
		pet: cleanPet(r.pet, num(r.clock, 0, CAPS.clock, START_CLOCK), knownLocs),
		// 只留还存在的事件：事件被删掉或改名后，界面弹不出来，但其他动作都会被「先处理眼前的事件」挡住
		pending: r.pending && EVENTS.some((e) => e.id === r.pending.eventId) ? { eventId: r.pending.eventId as string } : null,
		evMem: cleanEvMem(r.evMem, EVENTS, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		...cleanReal(r, opts.now),
		hobby: cleanHobby(r.hobby, knownLocs),
		cooking: cleanCooking(r.cooking, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		tally: cleanTally(r.tally, tallyCtx(r, visited)),
		trails: cleanTrails(r.trails, opts.now),
		journal,
		sport: cleanSport(r.sport, num(r.clock, 0, CAPS.clock, START_CLOCK)),
		onboard: cleanOnboard(r.onboard, opts.now === undefined ? undefined : realDayOf(opts.now)),
		seed: num(r.seed, 0, 2 ** 32 - 1, 1) >>> 0,
		// 版本号超出范围说明存档坏了：归零而不是钳到上限。钳到上限的话，下一次动作加一又超出，再读又被钳回去，客户端每次都版本冲突
		rev: typeof r.rev === 'number' && Number.isFinite(r.rev) && r.rev >= 0 && r.rev < CAPS.rev ? Math.floor(r.rev) : 0,
	};
	// 称号必须是这份存档确实拿到的
	if (typeof r.title === 'string' && earnedTitles(out).some((t) => t.id === r.title)) out.title = r.title;
	// 按职业打的上班卡必须对得上一份现有的工作，否则作废：不然重新应聘同一职业就能接着用旧卡
	if (out.clockIn?.career && out.job?.career !== out.clockIn.career) out.clockIn = null;
	// 每日摘要：记号不能晚于现在这一天，坏了或旧存档没有就从现在算起；yday 必须在记号那天之前结束，否则丢掉
	const today = Math.floor(out.clock / 1440);
	const places = Object.keys(out.visited).length;
	// 只认对象自己的字段（原型链上继承来的不算）；必需字段缺了或不是有限数就当坏数据
	const ownObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
	const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
	const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN);
	const m = ownObj(r.dayMark);
	const md = m ? int(own(m, 'day')) : NaN;
	const ma = m ? int(own(m, 'at')) : NaN;
	// 记号那一分钟必须落在记号那天里（开局早一分钟），也不能晚于现在
	out.dayMark = m && md >= 0 && md <= today && ma >= md * 1440 - 1 && ma < (md + 1) * 1440 && ma <= out.clock
		? { day: md, at: ma, cash: Math.round(num(own(m, 'cash'), 0, CAPS.cash, out.cash)), respect: num(own(m, 'respect'), 0, CAPS.respect, out.respect), places: Math.floor(num(own(m, 'places'), 0, places, places)) }
		: { day: today, at: out.clock, cash: out.cash, respect: out.respect, places };
	const y = ownObj(r.yday);
	if (y) {
		const day = int(own(y, 'day'));
		const days = int(own(y, 'days'));
		const from = int(own(y, 'from'));
		const to = int(own(y, 'to'));
		// 这段日子在记号之前结束；日志范围从那天开始、到跨日动作结束（落在第 day+days 天）为止，正好接上记号
		if (day >= 0 && days >= 1 && day + days <= out.dayMark.day && from >= day * 1440 - 1 && from < to && Math.floor(to / 1440) === day + days && to <= out.dayMark.at)
			out.yday = {
				day, days, from, to,
				cash: Math.round(num(own(y, 'cash'), -CAPS.cash, CAPS.cash, 0)),
				respect: num(own(y, 'respect'), -CAPS.respect, CAPS.respect, 0),
				// 新去的地方不会比现在到过的地方还多
				places: Math.floor(num(own(y, 'places'), 0, places, 0)),
			};
	}
	return out;
}

export const JOURNAL_MAX = 40;

/** 运动存档的初始值 */
export const emptySport = (): PlayerState['sport'] => ({ form: {}, total: {}, hday: -1, club: null, entries: [], results: [], pb: {} });

const RACE_KEY = /^([a-z0-9-]{1,40}):(y|d)(\d{1,7})$/;
const MEDAL_IDS = ['gold', 'silver', 'bronze', 'finish', 'dnf'];

/**
 * 运动存档的清洗（规范见 save-sync.md §5）：旧存档没有给空值；只留已知运动、比赛、俱乐部；
 * 游戏日不能晚于存档时钟所在的那天；数量有上限；幂等。届的标识要和比赛的类型对得上（每周赛用 d、每年一次用 y）。
 */
export function cleanSport(raw: unknown, clock: number): PlayerState['sport'] {
	const out = emptySport();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const r = raw as Record<string, any>;
	const today = Math.floor(clock / 1440);
	const day = (v: unknown, lo: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= today ? Math.floor(v) : null);
	const own = (o: unknown, k: string) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);
	for (const k of SPORT_IDS) {
		const f = own(r.form, k) as Record<string, unknown> | undefined;
		const d = day(f?.d, 0);
		if (f && d !== null) out.form[k] = { v: Math.round(num(f.v, 0, SPORT_RULES.formMax, 0) * 10) / 10, d, n: Math.floor(num(f.n, 1, 99, 1)) };
		const n = own(r.total, k);
		if (typeof n === 'number' && Number.isFinite(n) && n >= 1) out.total[k] = Math.min(1e6, Math.floor(n));
	}
	out.hday = day(r.hday, 0) ?? -1;
	const c = r.club;
	if (c && typeof c === 'object' && CLUBS.some((x) => x.id === c.id)) {
		const until = typeof c.until === 'number' && Number.isFinite(c.until) ? Math.floor(Math.max(0, Math.min(c.until, today + SPORT_RULES.clubDays * 13))) : 0;
		out.club = { id: c.id, until, last: day(c.last, 0) ?? -1 };
	}
	const keyOk = (k: unknown): k is string => {
		if (typeof k !== 'string') return false;
		const m = RACE_KEY.exec(k);
		const race = m && RACES.find((x) => x.id === m[1]);
		return !!race && (race.weekday !== undefined) === (m![2] === 'd');
	};
	out.entries = [...new Set(Array.isArray(r.entries) ? r.entries.filter(keyOk) : [])].slice(0, SPORT_RULES.entriesMax);
	if (Array.isArray(r.results)) {
		for (const x of r.results.slice(0, SPORT_RULES.resultsMax)) {
			if (!x || typeof x !== 'object' || !keyOk(x.key) || !x.key.startsWith(`${x.race}:`) || !MEDAL_IDS.includes(x.medal)) continue;
			const d = day(x.day, 0);
			if (d === null || out.results.some((y) => y.key === x.key)) continue;
			const dnf = x.medal === 'dnf';
			out.results.push({ race: x.race, key: x.key, medal: x.medal, place: dnf ? 0 : Math.floor(num(x.place, 1, 1e6, 1)), secs: dnf ? 0 : Math.floor(num(x.secs, 1, 1e6, 1)), day: d });
		}
	}
	// 已经比过的届不能还挂在报名单上
	out.entries = out.entries.filter((k) => !out.results.some((x) => x.key === k));
	for (const race of RACES) {
		const v = own(r.pb, race.id);
		if (typeof v === 'number' && Number.isFinite(v) && v >= 1) out.pb[race.id] = Math.min(1e6, Math.floor(v));
	}
	return out;
}

/** 生涯统计清洗要的现状：时钟、到过几个地方、认识几个人（和清洗后的 relations、met 条数一致） */
function tallyCtx(r: any, visited: Record<string, number>) {
	const met = r.met && typeof r.met === 'object' ? Object.entries(r.met as Record<string, unknown>).slice(0, 60).filter(([k, v]) => /^[a-f0-9]{12}$/.test(k) && v && typeof v === 'object').length : 0;
	return { clock: num(r.clock, 0, CAPS.clock, START_CLOCK), places: Object.keys(visited).length, people: Object.keys(cleanRelations(r.relations)).length + Math.min(30, met), cash: Math.round(num(r.cash, 0, CAPS.cash, 0)) };
}

const VENUE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const finiteIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 现实时间戳允许比服务端时间超前这么多（毫秒），再多就当坏数据 */
const FUTURE_SLACK_MS = 60_000;

/** 每日奖励：领取日在未来的话按「今天已领、连续天数归零」处理，不然要等到那一天才能再领 */
/** 心事结算记号（第 43 批）：旧存档没有时从今天起算，不补算以前的日子；day 不晚于今天，low 钳到 0–lowCap */
export function cleanMind(raw: unknown, clock: number): PlayerState['mind'] {
	const today = Math.floor(clock / 1440);
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return { day: Math.floor(num(r.day, 0, today, today)), low: Math.floor(num(r.low, 0, MIND.lowCap, 0)) };
}

/** 支线进度（第 28 批，规范见 save-sync.md §5）：只留还存在的支线，进度钳到目标次数；任何输入都不抛 */
function cleanSide(raw: any): PlayerState['side'] {
	const done = [...new Set(strList(raw?.done, 200))].filter((id) => SIDE_QUESTS.some((q) => q.id === id));
	const cur: Record<string, Record<string, number>> = {};
	const rc = raw?.cur && typeof raw.cur === 'object' && !Array.isArray(raw.cur) ? raw.cur : {};
	for (const q of SIDE_QUESTS) {
		// 只留还存在、没做完的支线；进度只留现有的目标，钳到目标次数
		if (done.includes(q.id) || !Object.hasOwn(rc, q.id) || !rc[q.id] || typeof rc[q.id] !== 'object') continue;
		const p: Record<string, number> = {};
		for (const step of q.steps) {
			const n = Object.hasOwn(rc[q.id], step.id) ? rc[q.id][step.id] : undefined;
			if (typeof n === 'number' && Number.isFinite(n) && n >= 1) p[step.id] = Math.min(step.n ?? 1, Math.floor(n));
		}
		cur[q.id] = p;
	}
	return { done, cur };
}

function cleanDaily(r: any, now?: number): PlayerState['daily'] {
	const daily = { day: Math.floor(num(r.daily?.day, 0, 1e7, 0)), streak: Math.floor(num(r.daily?.streak, 0, 1e6, 0)) };
	if (now === undefined) return daily;
	const today = realDayOf(now);
	return daily.day > today ? { day: today, streak: 0 } : daily;
}

/** 主要路线进度：只留已知路线；站数钳到 0..站数；沿途标记只在走到一半时有意义；时间不能在未来 */
function cleanTrails(raw: any, now?: number): PlayerState['trails'] {
	const tMax = now === undefined ? 1e15 : now + FUTURE_SLACK_MS;
	const out: PlayerState['trails'] = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const def of TRAILS) {
		if (!Object.hasOwn(raw, def.id)) continue;
		const p = raw[def.id];
		const at = Math.floor(num(p?.at, 0, def.stops.length, 0));
		const t = finiteIn(p?.t, 0, tMax) ? Math.floor(p.t) : 0;
		if (at === 0 && !t) continue;
		out[def.id] = { at, leg: p?.leg === true && at > 0 && at < def.stops.length, t };
	}
	return out;
}

/** 真实定位相关字段：坐标只留 3 位小数，时间为非负整数且不能在未来，动作名只留已知的 */
function cleanReal(r: any, now?: number): Pick<PlayerState, 'fix' | 'venueCd' | 'venueEvAt' | 'clockIn' | 'realWork'> {
	const tMax = now === undefined ? 1e15 : now + FUTURE_SLACK_MS;
	const f = r.fix;
	const fix = f && finiteIn(f.lat, -90, 90) && finiteIn(f.lon, -180, 180) && finiteIn(f.at, 0, tMax)
		? { lat: Math.round(f.lat * 1000) / 1000, lon: Math.round(f.lon * 1000) / 1000, at: Math.floor(f.at) }
		: null;
	const venueCd: PlayerState['venueCd'] = {};
	for (const op of VENUE_OPS) {
		const t = r.venueCd?.[op.id];
		if (finiteIn(t, 0, tMax)) venueCd[op.id] = Math.floor(t);
	}
	const c = r.clockIn;
	// career 只留已知的职业；旧存档的卡没有这个字段，按零工结算
	const ciCareer = c && CAREERS.some((x) => x.id === c.career) ? { career: c.career as string } : {};
	const clockIn = c && typeof c.venue === 'string' && VENUE_ID.test(c.venue) && finiteIn(c.at, 0, tMax) ? { venue: c.venue, at: Math.floor(c.at), ...ciCareer } : null;
	const realWork = { day: Math.floor(num(r.realWork?.day, 0, 1e7, 0)), min: Math.floor(num(r.realWork?.min, 0, 1440, 0)) };
	const venueEvAt = finiteIn(r.venueEvAt, 0, tMax) ? Math.floor(r.venueEvAt) : 0;
	return { fix, venueCd, venueEvAt, clockIn, realWork };
}

function cleanJob(raw: any, knownLocs?: Set<string>): Job | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = CAREERS.find((x) => x.id === raw.career);
	if (!c || typeof raw.loc !== 'string' || (knownLocs && !knownLocs.has(raw.loc))) return null;
	return {
		career: c.id,
		loc: raw.loc,
		level: Math.floor(num(raw.level, 0, c.levels.length - 1, 0)),
		shifts: Math.floor(num(raw.shifts, 0, 1e6, 0)),
		good: Math.floor(num(raw.good, 0, 1e6, 0)),
		lastDay: Math.floor(num(raw.lastDay, -1, 1e7, -1)),
	};
}

/** 房产与住处要一起校验：住在自有房里时，那套房必须确实拥有、地点一致、且没有出租 */
function cleanEstate(r: any, knownLocs?: Set<string>): { properties: OwnedProperty[]; home: Home | null } {
	const properties: OwnedProperty[] = [];
	if (Array.isArray(r.properties)) {
		for (const def of PROPERTIES) {
			const raw = r.properties.find((p: any) => p && p.id === def.id);
			if (!raw) continue;
			properties.push({
				id: def.id,
				loan: Math.round(num(raw.loan, 0, def.price, 0)),
				rented: raw.rented === true,
				missed: Math.floor(num(raw.missed, 0, FINANCE.graceWeeks, 0)),
				...(raw.rented === true && raw.fresh === true ? { fresh: true } : {}),
				// 旧存档没有 lived：正住在里面就算住过
				...(raw.lived === true || r.home?.owned === def.id ? { lived: true } : {}),
			});
		}
	}
	let home = cleanHome(r.home, knownLocs);
	if (home && typeof r.home.owned === 'string') {
		const def = PROPERTIES.find((p) => p.id === r.home.owned);
		const mine = properties.find((p) => p.id === r.home.owned);
		if (def && mine && !mine.rented && def.loc === home.loc && def.homeType === home.type) {
			home.owned = def.id;
			Reflect.deleteProperty(home, 'bond'); // 自有房没有押金
		}
		else home = null;
	}
	return { properties, home };
}

function cleanHome(raw: any, knownLocs?: Set<string>): Home | null {
	if (!raw || typeof raw !== 'object') return null;
	const def = HOMES.find((h) => h.id === raw.type);
	if (!def || typeof raw.loc !== 'string' || (knownLocs && !knownLocs.has(raw.loc))) return null;
	const furniture: Record<string, string> = {};
	if (raw.furniture && typeof raw.furniture === 'object') {
		for (const f of FURNITURE) if (raw.furniture[f.slot] === f.id) furniture[f.slot] = f.id;
	}
	// 押金（第 26 批）：不超过这种房型该交的押金；旧存档没有，按 0 算（当初没交过，也不退）
	const bond = Math.floor(num(raw.bond, 0, Math.round(def.rentWeek * (def.bondWeeks ?? BOND_WEEKS)), 0));
	return { type: def.id, loc: raw.loc, furniture, ...(bond ? { bond } : {}) };
}

/**
 * 关系只保留已知 NPC，分数钳制，日期为非负整数；剧情门槛只保留该 NPC 真有的，物品只保留已知的。
 * 旧存档没有 seen：按当前分数把已经越过的门槛记为看过（不补发回报），旧的 bonded 视为看过「好友」那一段。
 */
function cleanRelations(raw: unknown): Record<string, Relation> {
	const out: Record<string, Relation> = {};
	if (!raw || typeof raw !== 'object') return out;
	const items = new Set(ITEMS.map((i) => i.id));
	for (const npc of NPCS) {
		const r = (raw as Record<string, any>)[npc.id];
		if (!r || typeof r !== 'object') continue;
		const last: Relation['last'] = {};
		for (const k of ['chat', 'gift', 'help', 'perk', 'favor', 'bond', 'unbond', 'host', 'hobby'] as const) {
			const d = r.last?.[k];
			if (typeof d === 'number' && Number.isFinite(d) && d >= 0) last[k] = Math.floor(d);
		}
		const score = num(r.score, -100, 100, 0);
		const gates = npc.stories.map((st) => st.at);
		const seen = Array.isArray(r.seen)
			? gates.filter((g) => r.seen.includes(g))
			: gates.filter((g) => g <= score || (r.bonded === true && g <= 60));
		const known = Array.isArray(r.known) ? [...new Set(r.known.filter((i: unknown) => typeof i === 'string' && items.has(i)))] as string[] : [];
		out[npc.id] = { score, last, seen, known };
		// 知己（第 29 批）：日子是非负整数才保留；同时最多 CONFIDANT.max 位，超出的按 NPC 表顺序丢掉
		const day = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e7, Math.floor(v)) : undefined);
		const bond = day(r.bond);
		if (bond !== undefined && Object.values(out).filter((x) => x.bond !== undefined).length < CONFIDANT.max) {
			out[npc.id].bond = bond;
			const told = day(r.told);
			if (told !== undefined) out[npc.id].told = told;
		}
	}
	return out;
}

/** 背包只保留已知物品，数量钳制在 1..max，其余丢弃 */
function cleanInventory(raw: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const item of ITEMS) {
		const n = (raw as Record<string, unknown>)[item.id];
		if (typeof n === 'number' && Number.isFinite(n) && n >= 1) out[item.id] = Math.min(item.max, Math.floor(n));
	}
	return out;
}

export function formatClock(clock: number): string {
	const day = Math.floor(clock / 1440) + 1;
	const m = Math.floor(clock % 1440);
	return `第${day}天 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const SWAP_DONE_ID = /^[a-z0-9-]{1,60}$/;

/**
 * 清洗二手市场（换手墙）记录：旧存档缺字段给默认值；任何输入都不抛异常；钳范围；幂等。
 * 游戏日晚于存档时钟的是坏数据，当天记录清零；早于今天的原样保留（动作结算时 swapToday() 会换新，这样动作的结果本身就是规范形式）。
 */
export function cleanSwap(raw: unknown, clock: number): PlayerState['swap'] {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const int = (k: string, max: number) => {
		const v = Object.hasOwn(r, k) ? r[k] : 0;
		return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;
	};
	const today = dayOf(clock);
	const day = int('day', 1e7);
	const ok = day <= today;
	const list = ok && Object.hasOwn(r, 'done') && Array.isArray(r.done) ? r.done : [];
	return {
		day: ok ? day : today,
		done: [...new Set(list.filter((x): x is string => typeof x === 'string' && SWAP_DONE_ID.test(x)))].slice(-SWAP.doneMax),
		sold: ok ? int('sold', SWAP.sellDaily) : 0,
		dodged: int('dodged', 1e6),
		lost: int('lost', 1e6),
	};
}

export const emptyHobby = (): HobbyState => ({ xp: {}, day: -1, today: {}, bag: {}, best: {}, birds: [], works: {}, plants: [], bed: null, made: [], got: [] });

/** 收集里程碑 id 的形状：收集册 id + ':half' / ':full' */
const GOT_ID = /^[a-z]{1,12}:(half|full)$/;

/**
 * 爱好与收集（存档规范见 save-sync.md §5）：旧存档没有就给空的；只留认识的 id；数值钳到范围；条数有上限；幂等。
 * 地点 id 用 knownLocs 过滤（不传时用世界里的全部地点）
 */
export function cleanHobby(raw: unknown, knownLocs?: Set<string>): HobbyState {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const own = (k: string) => (Object.hasOwn(r, k) ? r[k] : undefined);
	const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
	/** 只留 keys 里认识的键，值钳到 [lo, hi]，round 为取整方式 */
	const numMap = (v: unknown, keys: Iterable<string>, lo: number, hi: number, round: (x: number) => number) => {
		const src = obj(v);
		const out: Record<string, number> = {};
		for (const k of keys) {
			const x = Object.hasOwn(src, k) ? src[k] : undefined;
			if (typeof x === 'number' && Number.isFinite(x) && x > 0) out[k] = round(clamp(x, lo, hi));
		}
		return out;
	};
	const fishIds = FISH.map((f) => f.id);
	const locs = knownLocs ?? new Set(WORLD_BASE.locations.map((l) => l.id));
	const day = own('day');
	const bedRaw = obj(own('bed'));
	const bedDay = bedRaw.day;
	const bed = typeof bedRaw.plant === 'string' && PLANTS.some((p) => p.id === bedRaw.plant) && typeof bedDay === 'number' && Number.isFinite(bedDay) && bedDay >= 0
		? { plant: bedRaw.plant, day: Math.floor(Math.min(bedDay, 1e7)) }
		: null;
	return {
		xp: numMap(own('xp'), HOBBY_IDS, 0, HOBBY.xpMax, Math.floor),
		day: typeof day === 'number' && Number.isFinite(day) ? Math.floor(clamp(day, -1, 1e7)) : -1,
		today: numMap(own('today'), HOBBY_IDS, 0, 99, Math.floor),
		bag: numMap(own('bag'), fishIds, 0, 99, Math.floor),
		best: numMap(own('best'), fishIds, 0, 999, (x) => Math.round(x * 10) / 10),
		birds: knownList(own('birds'), new Set(BIRDS.map((b) => b.id))),
		works: numMap(own('works'), locs, 0, 100, Math.floor),
		plants: knownList(own('plants'), new Set(PLANTS.map((p) => p.id))),
		bed,
		made: knownList(own('made'), new Set(CRAFTS.map((c) => c.id))),
		got: [...new Set(strList(own('got'), 64).filter((x) => GOT_ID.test(x)))],
	};
}

/** 存档校验：未知种类丢掉；名字过滤；日期为整数且不晚于今天；寄养地点必须存在、天数不超过上限 */
export function cleanPet(raw: unknown, clock: number, knownLocs?: Set<string>): Pet | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const def = typeof r.kind === 'string' ? getPetKind(r.kind) : undefined;
	if (!def) return null;
	const t = dayOf(clock);
	const day = (v: unknown, lo: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.max(lo, Math.min(t, v))) : d);
	const since = day(r.since, 0, t);
	const b = r.board as Record<string, unknown> | null | undefined;
	const board = b && typeof b === 'object' && typeof b.loc === 'string' && /^[a-z0-9-]{1,40}$/.test(b.loc) && (!knownLocs || knownLocs.has(b.loc)) && typeof b.until === 'number' && Number.isFinite(b.until)
		? { loc: b.loc, until: Math.floor(Math.max(0, Math.min(t + PET.boardMaxDays, b.until))) }
		: null;
	return {
		kind: def.id,
		name: cleanName(r.name).slice(0, PET.nameMax) || def.names[0],
		from: r.from === 'breeder' && def.buy !== undefined ? 'breeder' : 'shelter',
		since,
		bond: typeof r.bond === 'number' && Number.isFinite(r.bond) ? clamp100(r.bond) : PET.startBond,
		fedDay: day(r.fedDay, -1, since),
		playDay: day(r.playDay, -1, -1),
		walkDay: def.walk ? day(r.walkDay, -1, -1) : -1,
		vetDay: day(r.vetDay, -1, since),
		board,
	};
}
