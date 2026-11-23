// NPC 行为规则表（第 43 批，设计见 docs/earth-game/npc-behavior.md）。
// 规则引擎在 core/npc-behavior.ts；这里只放数据。全部是确定性规则：同一个游戏日、同一个地点，所有玩家看到的一样，不用存档里的随机种子。
// 标【待平衡】的数值是初值，由 Codex 跑模拟分析、用户拍板后再改。
import type { SeasonId } from '../core/time.ts';

// ---------- 不在：休假和病假 ----------

/** 年假：每年同一段时间不在，日程里的节日安排也让位（数据里已避开各自的节日，测试会检查）。日期【待平衡】 */
export interface NpcLeave {
	npc: string;
	season: SeasonId;
	day: number; // 季内第几天，1–28
	days: number;
	note: string; // 界面上的说明，接在「今天」后面
}

export const NPC_LEAVE: NpcLeave[] = [
	{ npc: 'mia', season: 'winter', day: 8, days: 5, note: '休年假回老家探亲' },
	{ npc: 'jack', season: 'winter', day: 20, days: 7, note: '禁渔期，去南边看女儿' },
	{ npc: 'nan', season: 'autumn', day: 2, days: 4, note: '民宿歇业，去珀斯看病的老姐妹' },
	{ npc: 'leo', season: 'summer', day: 3, days: 6, note: '去印尼追浪' },
	{ npc: 'sam', season: 'winter', day: 1, days: 6, note: '淡季休假，回老家' },
	{ npc: 'yuki', season: 'summer', day: 15, days: 7, note: '雨季关店，回日本' },
	{ npc: 'greta', season: 'winter', day: 10, days: 5, note: '去欧洲参加酿酒展' },
	{ npc: 'harry', season: 'spring', day: 15, days: 3, note: '博物馆闭馆布展，在家歇着' },
];

/** 病假：每位 NPC 每天按季节有一个小概率开始生病，一病 1–maxDays 天。概率用「NPC + 游戏日」的哈希决定。【待平衡】 */
export const NPC_SICK = {
	rate: { spring: 0.01, summer: 0.008, autumn: 0.012, winter: 0.02 } as Record<SeasonId, number>,
	maxDays: 2,
	note: '病了，请假在家',
};

// ---------- 心情 ----------

export type NpcMoodLevel = 'great' | 'good' | 'meh' | 'low';
/** 心情的主要原因；对话按「心情 + 原因」挑台词 */
export type NpcMoodCause = 'festival' | 'weather' | 'tired' | 'lonely' | 'company' | 'weekend' | 'calm';

/** 每位 NPC 的脾气：基础心情、对各种天气的反应（天气 id → 加减）。没列出的 NPC 和天气按 0 算。【待平衡】 */
export const NPC_TEMPER: Record<string, { base: number; weather?: Record<string, number> }> = {
	mia: { base: 6, weather: { rain: -4 } },
	jack: { base: 0, weather: { storm: -12, sunny: 4 } },
	linda: { base: 4, weather: { rain: 3, hot: -6 } },
	leo: { base: 8, weather: { storm: -8, sunny: 6 } },
	nan: { base: 8, weather: { rain: 2 } },
	bill: { base: -4, weather: { hot: -6 } },
	sam: { base: 4, weather: { storm: -10, sunny: 6 } },
	dave: { base: -2, weather: { rain: -6, storm: -10 } },
	yuki: { base: 2, weather: { hot: -4 } },
	tom: { base: 0, weather: { storm: -12, cloudy: 2 } },
	harry: { base: 6, weather: { rain: 2, storm: 4 } },
	ruby: { base: 4, weather: { hot: -10, rain: 4 } },
	rosa: { base: 8, weather: { storm: -6 } },
	mack: { base: 2, weather: { rain: 10, hot: -6 } },
	greta: { base: 4, weather: { rain: -4, sunny: 4 } },
	kev: { base: 0, weather: { hot: 2 } },
	ayla: { base: 4, weather: { storm: -6 } },
};

/** 心情分怎么算，以及心情对聊天的影响。【待平衡】 */
export const NPC_MOOD = {
	/** 自己所在地点正在办节日 */
	festival: 12,
	/** 周六、周日 */
	weekend: 4,
	/** 精力：低于 pivot 时每少 1 点心情 −1/energyDiv */
	energyPivot: 60,
	energyDiv: 4,
	/** 社交：同一地点有 ≥1 位别的 NPC 在场算有伴（+company），只有自己算孤单（lonely） */
	company: 4,
	lonely: -2,
	/** 分档：分数 ≥ 下限 */
	levels: [
		{ level: 'great', min: 12 },
		{ level: 'good', min: 0 },
		{ level: 'meh', min: -8 },
		{ level: 'low', min: -1000 },
	] as { level: NpcMoodLevel; min: number }[],
	/** 聊天的魅力检定门槛加减（基础 45）：心情好聊得开，心情差难聊 */
	chatDc: { great: -8, good: 0, meh: 4, low: 10 } as Record<NpcMoodLevel, number>,
};

/** NPC 自己的需求（0–100）怎么随时间变化。【待平衡】 */
export const NPC_NEEDS = {
	/** 上班开始时的精力，到收工线性降到 start − shiftDrop */
	start: 95,
	shiftDrop: 55,
	/** 不在班上时（在家、在路上） */
	off: 80,
	travel: 55,
	/** 天气让人累：炎热 −15 */
	weather: { hot: -15 } as Record<string, number>,
};

/** 心情图标，界面用 */
export const NPC_MOOD_ICON: Record<NpcMoodLevel, string> = { great: '😄', good: '🙂', meh: '😐', low: '😮‍💨' };
export const NPC_MOOD_NAME: Record<NpcMoodLevel, string> = { great: '心情很好', good: '心情不错', meh: '一般', low: '心情不好' };

/**
 * 招呼台词：按「心情 + 原因」挑，同一天同一位 NPC 固定一句。没有对应原因时用 calm。
 * 占位符：{weather} 天气名，{festival} 节日名，{place} 所在地点名。
 */
export const NPC_LINES: Record<NpcMoodLevel, Partial<Record<NpcMoodCause, string[]>> & { calm: string[] }> = {
	great: {
		festival: ['「{festival}！今天谁都别想让我板着脸。」', '「这几天镇上热闹，你来得正好。」'],
		weather: ['「这种{weather}天，干什么都顺。」', '「天这么好，你还站着干嘛？」'],
		company: ['「今天熟人多，聊不完。」'],
		weekend: ['「周末嘛，慢慢来。」'],
		calm: ['「哟，你来啦！」', '「今天一切顺利，说吧，有什么事？」'],
	},
	good: {
		festival: ['「{festival}这几天，人比平时多一倍。」', '「来凑{festival}的热闹？」'],
		weather: ['「{weather}，还行。」'],
		company: ['「刚跟老朋友聊完，正好你也来了。」'],
		weekend: ['「周末人多，不过我不急。」'],
		calm: ['「你好呀。」', '「又见面了。」', '「坐，坐。」'],
	},
	meh: {
		tired: ['「忙了一天，腿都软了。」', '「等我喘口气。」'],
		weather: ['「这{weather}天，真烦人。」'],
		lonely: ['「今天一个熟人都没碰到。」'],
		calm: ['「嗯，你说。」', '「今天有点闷。」'],
	},
	low: {
		tired: ['「别问了，累得说不出话。」', '「我快收工了，长话短说。」'],
		weather: ['「{weather}，什么都干不成。」', '「这天气，一肚子火。」'],
		lonely: ['「一个人守了一天，没意思。」'],
		calm: ['「……嗯。」', '「今天别惹我。」'],
	},
};

// ---------- 移动 ----------

/** NPC 在常驻地点和当天去处之间往返的路上时间：按直线距离 ÷ 速度，钳在 [min, max] 小时；没有坐标时用 fallback。【待平衡】 */
export const NPC_TRAVEL = { kmh: 80, min: 1, max: 8, fallback: 2 };
