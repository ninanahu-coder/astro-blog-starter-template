// 运动和比赛：五项日常运动、比赛日程、俱乐部。设计见 docs/earth-game/sports.md。
// 规则在 core/sports.ts（纯函数）；这里只放数据。全部数值待平衡（未经 Codex 分析）。
//
// 比赛按游戏日历举行（一年四季，每季 28 天，第 1 天是春季第 1 天），参照真实赛事放在对应的季节：
//   真实月份 → 游戏季节：9–11 月春、12–2 月夏、3–5 月秋、6–8 月冬（南半球）；
//   季内第几天 = round((该季第几个月 × 30.4 + 日) ÷ 91 × 28)，夹在 1–28。
// ref 记真实赛事的名称、日期和来源。status：'已核实' = 2026-11-20 直接取官方页面（或官方报名平台）原文核对过；
// '待核实' = 只有第三方日历或往年规律，官方页面没取到（反爬页）或还没公布。游戏内名称是自己起的中文名，描写也是自己写的。
import type { Hours, Skills } from '../core/types.ts';

export type SportId = 'run' | 'swim' | 'gym' | 'surf' | 'cycle';
export const SPORT_IDS: SportId[] = ['run', 'swim', 'gym', 'surf', 'cycle'];

export interface SportDef {
	id: SportId;
	name: string;
	icon: string;
	/** 算作这项运动训练的地点互动（data/activities.ts） */
	acts: string[];
	/** 算作这项运动训练的真实地点动作（data/venues.ts 的 VENUE_OPS） */
	ops: string[];
	/** 比赛检定时各能力的权重，合计 1 */
	weights: Partial<Skills>;
	/** 俱乐部训练课涨的能力（待平衡） */
	clubSkills: Partial<Skills>;
	desc: string;
}

export const SPORTS: SportDef[] = [
	{ id: 'run', name: '跑步', icon: '🏃', acts: ['jog'], ops: ['run'], weights: { stamina: 0.75, strength: 0.25 }, clubSkills: { stamina: 2.5, strength: 0.5 }, desc: '路跑、公园 5 公里、城市长跑。' },
	{ id: 'swim', name: '游泳', icon: '🏊', acts: ['swim', 'snorkel'], ops: ['swim'], weights: { swimming: 0.7, stamina: 0.3 }, clubSkills: { swimming: 2.5, stamina: 1 }, desc: '泳池和公开水域。' },
	{ id: 'gym', name: '健身', icon: '🏋️', acts: ['gym'], ops: ['train'], weights: { strength: 0.8, stamina: 0.2 }, clubSkills: { strength: 2.5, stamina: 0.5 }, desc: '没有单独的比赛；练出来的准备度按一部分算进其他项目（交叉训练）。' },
	{ id: 'surf', name: '冲浪', icon: '🏄', acts: ['surf'], ops: [], weights: { swimming: 0.5, stamina: 0.3, strength: 0.2 }, clubSkills: { swimming: 1.5, stamina: 1.5 }, desc: '要有浪点。' },
	{ id: 'cycle', name: '骑车', icon: '🚴', acts: ['cycle'], ops: [], weights: { stamina: 0.6, strength: 0.4 }, clubSkills: { stamina: 2, strength: 1 }, desc: '沿河、沿海的自行车道，或上山。' },
];

/** 训练准备度、健康和比赛的规则（全部待平衡） */
export const SPORT_RULES = {
	/** 一次训练涨的准备度；同一项当天第 2 次减半，第 3 次起不涨（避免一天刷满） */
	formGain: 12,
	/** 准备度上限 */
	formMax: 100,
	/** 歇几天后才开始掉 */
	graceDays: 2,
	/** 之后每天掉多少 */
	decayPerDay: 4,
	/** 健身的准备度按这个比例算进其他项目的比赛 */
	crossGym: 0.3,
	/** 比赛检定里准备度的权重：准备度 100 → +25 */
	formWeight: 0.25,
	/** 每个游戏日第一次运动加的健康 */
	healthPerDay: 1,
	/** 比赛检定的随机部分：0 到这个数 */
	raceRoll: 40,
	/** 精力低于这个值开赛，每差 1 点检定 −fatigueK */
	fatigueBelow: 50,
	fatigueK: 0.3,
	/** 比赛名次：检定分 ≥ 难度 + 这些值分别拿金、银、铜；≥ 难度完赛；更低未完赛 */
	gold: 40,
	silver: 30,
	bronze: 20,
	/** 提前多少天开放报名 */
	entryDays: 28,
	/** 比赛当天现场报名的加价倍率 */
	lateFee: 1.5,
	/** 比赛记录最多留几条（最新的在前） */
	resultsMax: 20,
	/** 报名单最多几条 */
	entriesMax: 10,
	/** 俱乐部：会费管多少天；训练课准备度倍率；近几天上过课比赛有队友加成 */
	clubDays: 28,
	clubFormMult: 1.5,
	clubBonusDays: 7,
	clubBonus: 4,
};

export type Medal = 'gold' | 'silver' | 'bronze' | 'finish' | 'dnf';
export const MEDALS: Record<Medal, { name: string; icon: string }> = {
	gold: { name: '金牌', icon: '🥇' },
	silver: { name: '银牌', icon: '🥈' },
	bronze: { name: '铜牌', icon: '🥉' },
	finish: { name: '完赛奖牌', icon: '🏅' },
	dnf: { name: '未完赛', icon: '🚩' },
};

export interface RaceRef {
	/** 参照的真实赛事名称 */
	name: string;
	/** 真实日期（当地），没公布或拿不准的写月份 */
	date: string;
	status: '已核实' | '待核实';
	source: string;
	/** 核对日期 */
	checked: string;
	note?: string;
}

export interface RaceDef {
	id: string;
	name: string;
	icon: string;
	sport: Exclude<SportId, 'gym'>;
	/** 在哪些游戏地点举行（每周赛可以多个地点） */
	locs: string[];
	/** 每年一次：季节 + 季内第几天。每周赛不写 */
	season?: 'spring' | 'summer' | 'autumn' | 'winter';
	day?: number;
	/** 每周赛：星期几（0 = 周一 … 6 = 周日，同 time.ts） */
	weekday?: number;
	/** 发令时段：只能在这段时间里开赛 */
	start: Hours;
	km: number;
	/** 报名费；0 = 免费、不用报名 */
	fee: number;
	/** 难度：检定分达到它才能完赛 */
	dc: number;
	/** 参赛门槛（像真实赛事的资格赛） */
	requires?: Partial<Skills>;
	/** 开赛至少要有的精力 */
	energy: number;
	/** 冠军大约用时（分钟），用来换算玩家的成绩 */
	par: number;
	/** 参赛人数（只用来显示名次） */
	field: number;
	/** 金、银、铜、完赛各加多少声望 */
	respect: [number, number, number, number];
	/** 海上项目：风暴天取消，退报名费 */
	sea?: boolean;
	/** 终点在另一个游戏地点：比完人在那里 */
	finish?: string;
	desc: string;
	ref?: RaceRef;
}

const CHECKED = '2026-11-20';

export const RACES: RaceDef[] = [
	{
		id: 'park-5k', name: '周六公园 5 公里', icon: '🌳', sport: 'run', locs: ['perth', 'fremantle', 'mandurah', 'bunbury', 'adelaide', 'glenelg'], weekday: 5, start: [7, 9],
		km: 5, fee: 0, dc: 20, energy: 25, par: 17, field: 300, respect: [3, 2, 1, 0],
		desc: '每周六早上的免费 5 公里计时跑，跑、走、推婴儿车都行。不用报名，到了就跑。',
		ref: { name: 'parkrun（澳洲各地每周六早上的免费 5 公里计时跑）', date: '每周六', status: '待核实', source: 'https://www.parkrun.com.au/', checked: CHECKED, note: '各地起跑时间和具体场地没逐个核对。游戏里用游戏日历的周六 7–9 点。' },
	},
	{
		id: 'city-coast-12k', name: '珀斯城市到海岸长跑', icon: '🏙️', sport: 'run', locs: ['perth'], season: 'winter', day: 28, start: [7, 10],
		km: 12, fee: 65, dc: 35, energy: 40, par: 36, field: 30000, respect: [12, 8, 5, 2],
		desc: '从市中心跑到海边，一路下坡多、最后几公里迎着海风。全城最多人参加的长跑。',
		ref: { name: 'City to Surf Perth（Chevron City to Surf for genU / for Activ）', date: '2027-08-29（2026 年是 08-30）', status: '待核实', source: 'https://www.runningcalendar.com.au/event/city-to-surf-perth/', checked: CHECKED, note: '2027 日期来自第三方跑步日历；珀斯市政府的封路公告页（2026-08-30）是反爬页，没取到原文。报名费是游戏数值，不是真实价格。' },
	},
	{
		id: 'city-bay-12k', name: '阿德莱德城市到海湾长跑', icon: '🌊', sport: 'run', locs: ['adelaide'], season: 'spring', day: 6, start: [7, 10], finish: 'glenelg',
		km: 12, fee: 60, dc: 35, energy: 40, par: 35, field: 30000, respect: [12, 8, 5, 2],
		desc: '从市中心一路跑到格莱内尔格的海湾，终点就在沙滩边。',
		ref: { name: 'City-Bay Fun Run', date: '2027-09-19', status: '已核实', source: 'https://city-bay.org.au/deadlines/', checked: CHECKED, note: '官方页「19 Sep RACE DAY!」及页头「19 SEPTEMBER 2027」。' },
	},
	{
		id: 'channel-swim', name: '罗特尼斯海峡横渡', icon: '🏝️', sport: 'swim', locs: ['perth'], season: 'summer', day: 25, start: [5, 8], finish: 'rottnest', sea: true,
		km: 19.7, fee: 380, dc: 55, requires: { swimming: 40 }, energy: 60, par: 260, field: 2500, respect: [25, 18, 12, 8],
		desc: '从科特斯洛海滩游到罗特尼斯岛，近 20 公里公开水域。要先有一定水性才能报名，风大就取消。',
		ref: { name: 'South32 Rottnest Channel Swim', date: '2027-02-20', status: '已核实', source: 'https://raceroster.com/events/2027/105782/south32-rottnest-channel-swim', checked: CHECKED, note: '官方报名平台原文「Saturday, 20 February 2027」；官网 rottnestchannelswim.com.au 是反爬页。2026 届因天气预报取消（官网公告页标题，未取到全文），游戏里风暴天同样取消。真实赛事单人要先完成 10 公里资格游，游戏里用游泳 40 的门槛代替。' },
	},
	{
		id: 'jetty-swim', name: '海滨栈桥公开水域赛', icon: '🌅', sport: 'swim', locs: ['glenelg'], season: 'summer', day: 21, start: [7, 10], sea: true,
		km: 1.5, fee: 50, dc: 30, energy: 30, par: 20, field: 3000, respect: [10, 7, 4, 2],
		desc: '绕着栈桥游一圈，南澳人数最多的公开水域赛之一。',
		ref: { name: 'Brighton Jetty Classic', date: '2027-02-07', status: '已核实', source: 'https://www.brightonjettyclassic.com.au/', checked: CHECKED, note: '官网原文「Sunday 7th February 2027」。真实举办地在布赖顿（格莱内尔格以南约 4 公里），游戏里放在格莱内尔格。距离和报名费是游戏数值。' },
	},
	{
		id: 'hills-ride', name: '阿德莱德山区骑行挑战', icon: '⛰️', sport: 'cycle', locs: ['adelaide'], season: 'summer', day: 15, start: [6, 9],
		km: 60, fee: 90, dc: 40, energy: 45, par: 110, field: 5000, respect: [14, 10, 6, 3],
		desc: '职业环赛期间给普通车友开放的一段路线，从城里骑上阿德莱德山区。',
		ref: { name: 'Santos Tour Down Under（职业环赛期间的大众骑行）', date: '2027-01-16 至 01-24（赛事周）', status: '待核实', source: 'https://tourdownunder.com.au/blog-articles/your-guide-to-the-2027-santos-tour-down-under-stages', checked: CHECKED, note: '官网页头「16–24 January 2027, South Australia」已核实；大众骑行的具体日期、距离和报名费没核实，游戏里取赛事周中间一天。' },
	},
	{
		id: 'surf-open', name: '玛格丽特河业余冲浪赛', icon: '🏄', sport: 'surf', locs: ['margaret-river'], season: 'autumn', day: 9, start: [7, 12], sea: true,
		km: 0, fee: 40, dc: 40, requires: { swimming: 20 }, energy: 35, par: 25, field: 120, respect: [15, 10, 6, 2],
		desc: '冲浪大师赛期间的业余组，每轮 20 多分钟，裁判按动作打分。',
		ref: { name: 'Margaret River Pro（世界冲浪联赛分站，每年 4 月前后）', date: '4 月前后（2027 年未核实）', status: '待核实', source: 'https://www.worldsurfleague.com/', checked: CHECKED, note: '游戏里放在已有节日「冲浪大师赛」（秋季第 8–11 天）期间。真实赛事是职业赛，业余组是游戏设定。' },
	},
];

export interface ClubMate {
	name: string;
	icon: string;
	/** 一起训练时说的话 */
	lines: string[];
}

export interface ClubDef {
	id: string;
	name: string;
	icon: string;
	sport: SportId;
	loc: string;
	/** 会费：每 SPORT_RULES.clubDays 天 */
	fee: number;
	/** 训练课时段 */
	meet: Hours;
	mates: ClubMate[];
	desc: string;
}

// 俱乐部和队友都是原创（不用真实俱乐部的名字）
export const CLUBS: ClubDef[] = [
	{
		id: 'swan-river-runners', name: '天鹅河晨跑团', icon: '🏃', sport: 'run', loc: 'perth', fee: 30, meet: [5, 8],
		desc: '每天天没亮就在河边集合，绕桥跑一圈。',
		mates: [
			{ name: '阿杰', icon: '🧑', lines: ['今天配速别跟我，跟着前面那个戴红帽子的。', '跑完去喝咖啡，我请。'] },
			{ name: 'Mia', icon: '👩', lines: ['城市到海岸那场我想进一小时，你呢？', '下坡别放太快，膝盖会记账的。'] },
		],
	},
	{
		id: 'cottesloe-dawn-swim', name: '科特斯洛晨泳队', icon: '🌊', sport: 'swim', loc: 'perth', fee: 40, meet: [5, 8],
		desc: '一年四季早上下海，冬天也不例外。为海峡横渡准备的人都在这里。',
		mates: [
			{ name: '老陈', icon: '🧔', lines: ['换气别抬头太高，看一眼浮标就够了。', '我横渡游了三次，第一次在一半的地方上了船。'] },
			{ name: 'Sophie', icon: '👱', lines: ['今天有点涌，跟紧我。', '下周末拉练 5 公里，来吗？'] },
		],
	},
	{
		id: 'freo-pedal', name: '弗里曼特尔沿海车队', icon: '🚴', sport: 'cycle', loc: 'fremantle', fee: 35, meet: [6, 9],
		desc: '沿着海岸线骑到科特斯洛再折返，回来吃早餐。',
		mates: [
			{ name: 'Tom', icon: '👨', lines: ['跟车别贴太近，留半个轮子。', '逆风那段我带，你在后面省点力。'] },
		],
	},
	{
		id: 'margaret-river-boardriders', name: '玛格丽特河浪友会', icon: '🏄', sport: 'surf', loc: 'margaret-river', fee: 25, meet: [6, 10],
		desc: '本地浪友一起看浪、排队、互相拍视频。',
		mates: [
			{ name: 'Kai', icon: '🤠', lines: ['今天外面那排太大，先在里面练起乘。', '比赛的时候别抢，等属于你的那道浪。'] },
		],
	},
	{
		id: 'torrens-striders', name: '托伦斯河跑团', icon: '🏃', sport: 'run', loc: 'adelaide', fee: 30, meet: [6, 9],
		desc: '沿着托伦斯河跑步，周末拉长距离，为城市到海湾长跑备战。',
		mates: [
			{ name: '小林', icon: '🧑‍🦱', lines: ['最后两公里留点力，海风很顶。', '我去年在海湾那场跑丢了鞋带，这次绑两遍。'] },
			{ name: 'Grace', icon: '👩‍🦰', lines: ['今天间歇跑，400 米 × 8。', '跑完拉伸，别偷懒。'] },
		],
	},
	{
		id: 'glenelg-open-water', name: '格莱内尔格公开水域队', icon: '🌅', sport: 'swim', loc: 'glenelg', fee: 35, meet: [6, 9],
		desc: '绕栈桥游来回，夏天备战栈桥赛。',
		mates: [
			{ name: 'Leo', icon: '😎', lines: ['海里没有池壁可以蹬，节奏要自己找。', '水母季记得穿长袖泳衣。'] },
		],
	},
	{
		id: 'adelaide-hills-riders', name: '阿德莱德山区车友会', icon: '⛰️', sport: 'cycle', loc: 'adelaide', fee: 40, meet: [6, 9],
		desc: '周末一起上山爬坡，环赛那周最热闹。',
		mates: [
			{ name: '阿强', icon: '🧔', lines: ['爬坡用小齿比，踩圈别踩死。', '下山别抢，弯道多。'] },
			{ name: 'Ella', icon: '👩', lines: ['环赛那周我们去山顶给职业车手加油。', '你今天比上周稳多了。'] },
		],
	},
	{
		id: 'perth-iron-gym', name: '北桥力量社', icon: '🏋️', sport: 'gym', loc: 'perth', fee: 45, meet: [17, 21],
		desc: '下班后一起练力量，互相保护、记重量。',
		mates: [
			{ name: '大伟', icon: '💪', lines: ['这组我帮你保护，最后两个自己推。', '腿不练，跑步和骑车都吃亏。'] },
		],
	},
];
