// 做饭：食材、食谱、外卖、请客的数据表。规则在 core/cooking.ts。
// 第一版（cooking 分支）所有数值都是「待平衡」：价格、保质期、饱食、成长都没有经过 Codex 平衡分析。
// 价格只是游戏内的「一份」的价钱（够做一道菜的用量），不是对照某家超市的实价；现实参照见 docs/earth-game/cooking.md §3。
import type { IngredientDef, LocationKind, RecipeDef } from '../core/types.ts';
import { HOME_COOK } from './furniture.ts';

/** 有超市的地点类别（和物品表 items.ts 的城镇类别一致） */
export const GROCER_KINDS: LocationKind[] = ['city', 'port', 'town', 'coast', 'mining', 'island'];

/**
 * 有亚洲超市的地点。第一版按两个首府近似（待平衡、待采集）：
 * 等 OpenClaw 按 OSM（shop=supermarket / convenience，按名称筛）采集到真实亚洲超市后，改成按真实店铺判断。
 */
export const ASIAN_GROCER_LOCS = ['perth', 'adelaide'];

/** 超市营业时间（待平衡；真实超市各家不同，第一版统一） */
export const GROCER_HOURS: [number, number] = [7, 22];
/** 逛一趟超市花的时间 */
export const GROCER_MINUTES = 25;
/** 一次最多买几份 */
export const GROCER_BATCH_MAX = 8;

/** 食材：price 是一份的价钱，days 是保质期（游戏日），store 是哪里能买到 */
export const INGREDIENTS: IngredientDef[] = [
	{ id: 'staple', name: '米面', icon: '🍚', price: 2, days: 60, store: 'super', desc: '大米、面条、面粉、面包，放得久。' },
	{ id: 'veg', name: '新鲜蔬菜', icon: '🥬', price: 3, days: 5, store: 'super', desc: '番茄、土豆、青菜，五天内吃掉。' },
	{ id: 'meat', name: '肉', icon: '🥩', price: 6, days: 3, store: 'super', desc: '猪牛羊鸡和香肠，冷藏三天。' },
	{ id: 'seafood', name: '海鲜', icon: '🐟', price: 9, days: 2, store: 'super', desc: '鱼和虾，最好当天做。' },
	{ id: 'dairy', name: '蛋奶', icon: '🥚', price: 2, days: 10, store: 'super', desc: '鸡蛋、牛奶、黄油、奶油。' },
	{ id: 'tofu', name: '豆腐', icon: '🧈', price: 3, days: 4, store: 'asian', desc: '亚洲超市才有的嫩豆腐、豆皮。' },
	{ id: 'sauce', name: '中式调料', icon: '🫙', price: 2, days: 120, store: 'asian', desc: '酱油、豆瓣酱、八角、辣椒油，一瓶用很久。' },
];

/** 储物上限：所有食材合计最多几份（待平衡）；记录条数上限防存档膨胀 */
export const PANTRY_MAX = 24;
export const PANTRY_ROWS = 24;

/** 厨房设备等级的名字（家具 kitchen 字段） */
export const KITCHEN_LEVELS: Record<number, string> = { 1: '炉灶', 2: '烤箱' };

/**
 * 食谱。unlock：skill 是烹饪技能门槛（达到即会）；npc 是跟这位 NPC 的关系达到 at 后，TA 教你（关系够了就算学会）。
 * kitchen：要求厨房设备等级（1 炉灶、2 烤箱）。serves：一锅够几个人吃，请客时按人数算要做几锅。
 * cash：不用食材、现场买现成的花多少钱（只有「随手做一顿」用，保留旧版在家做饭 $6 的玩法）。
 */
export const RECIPES: RecipeDef[] = [
	{ id: 'quick', name: '随手做一顿', icon: '🍳', cuisine: 'basic', cash: HOME_COOK.cost, ingredients: {}, minutes: HOME_COOK.minutes, kitchen: 1, serves: 1, hunger: HOME_COOK.hunger, fun: 3, health: 0, xp: 0.5, desc: '不用备菜，路上顺手买点现成的下锅。' },
	// 中餐家常菜
	{ id: 'tomato-egg', name: '番茄炒蛋', icon: '🍅', cuisine: 'zh', ingredients: { veg: 1, dairy: 1, staple: 1 }, minutes: 30, kitchen: 1, serves: 1, hunger: 60, fun: 5, health: 2, xp: 2, unlock: { skill: 0 }, desc: '谁家都会的第一道菜，配一碗白米饭。' },
	{ id: 'fried-rice', name: '蛋炒饭', icon: '🍛', cuisine: 'zh', ingredients: { staple: 1, dairy: 1, veg: 1, sauce: 1 }, minutes: 25, kitchen: 1, serves: 1, hunger: 62, fun: 5, health: 1, xp: 2, unlock: { skill: 5 }, desc: '隔夜饭最好，酱油要亚洲超市买。' },
	{ id: 'mapo-tofu', name: '麻婆豆腐', icon: '🌶️', cuisine: 'zh', ingredients: { tofu: 1, meat: 1, sauce: 1, staple: 1 }, minutes: 35, kitchen: 1, serves: 2, hunger: 66, fun: 8, health: 2, xp: 3, unlock: { skill: 15 }, desc: '麻、辣、烫，下饭。' },
	{ id: 'dumplings', name: '包饺子', icon: '🥟', cuisine: 'zh', ingredients: { staple: 2, meat: 1, veg: 1, sauce: 1 }, minutes: 90, kitchen: 1, serves: 4, hunger: 70, fun: 12, health: 2, xp: 4, unlock: { skill: 20 }, desc: '一个人包很慢，请人来一起包刚好。' },
	{ id: 'braised-pork', name: '红烧肉', icon: '🍖', cuisine: 'zh', ingredients: { meat: 2, sauce: 1, staple: 1 }, minutes: 100, kitchen: 1, serves: 3, hunger: 72, fun: 10, health: 0, xp: 4, unlock: { skill: 30 }, desc: '小火慢炖一个多小时，满屋子都是香味。' },
	{ id: 'steamed-fish', name: '清蒸鱼', icon: '🐠', cuisine: 'zh', ingredients: { seafood: 1, sauce: 1, veg: 1, staple: 1 }, minutes: 40, kitchen: 1, serves: 2, hunger: 64, fun: 8, health: 4, xp: 4, unlock: { skill: 35 }, desc: '鱼要新鲜，火候差一分钟就老了。' },
	{ id: 'hotpot', name: '在家火锅', icon: '🍲', cuisine: 'zh', ingredients: { meat: 1, seafood: 1, veg: 2, tofu: 1, sauce: 1 }, minutes: 120, kitchen: 1, serves: 4, hunger: 75, fun: 15, health: 1, xp: 3, unlock: { skill: 25 }, desc: '一口锅、一桌人，最适合请客。' },
	// 澳洲本地菜
	{ id: 'sausage-sizzle', name: '香肠夹面包', icon: '🌭', cuisine: 'au', ingredients: { meat: 1, staple: 1 }, minutes: 20, kitchen: 1, serves: 1, hunger: 55, fun: 5, health: 0, xp: 1.5, unlock: { skill: 0 }, desc: '一片白面包、一根香肠、一圈洋葱和番茄酱。' },
	{ id: 'bbq', name: '后院烧烤', icon: '🔥', cuisine: 'au', ingredients: { meat: 2, veg: 1, staple: 1 }, minutes: 60, kitchen: 1, serves: 4, hunger: 68, fun: 14, health: 0, xp: 3, unlock: { skill: 10 }, desc: '牛排、羊排、玉米，一人一瓶饮料。' },
	{ id: 'fish-chips', name: '炸鱼薯条', icon: '🍟', cuisine: 'au', ingredients: { seafood: 1, veg: 1, staple: 1 }, minutes: 45, kitchen: 1, serves: 2, hunger: 66, fun: 8, health: -1, xp: 3, unlock: { npc: 'jack', at: 30 }, desc: '老杰克教的面糊配方：啤酒加一点点醋。' },
	{ id: 'meat-pie', name: '澳式肉派', icon: '🥧', cuisine: 'au', ingredients: { meat: 1, staple: 1, dairy: 1 }, minutes: 80, kitchen: 2, serves: 2, hunger: 66, fun: 7, health: 0, xp: 3, unlock: { skill: 20 }, desc: '酥皮要进烤箱，肉馅里有浓浓的肉汁。' },
	{ id: 'roast-lamb', name: '烤羊腿', icon: '🍗', cuisine: 'au', ingredients: { meat: 2, veg: 2 }, minutes: 150, kitchen: 2, serves: 4, hunger: 74, fun: 12, health: 2, xp: 5, unlock: { npc: 'nan', at: 30 }, desc: '南希的周日烤肉：迷迭香、蒜、土豆垫底。' },
	{ id: 'pavlova', name: '帕夫洛娃', icon: '🍰', cuisine: 'au', ingredients: { dairy: 2 }, minutes: 120, kitchen: 2, serves: 6, hunger: 35, fun: 18, health: 0, xp: 4, unlock: { npc: 'mia', at: 30 }, desc: '米娅说蛋白霜要在烤箱里慢慢放凉，别急着开门。' },
];

/** 烹饪技能（0–100）的成长：和其他能力同一套递减曲线；第一次做某道菜额外 ×first，做到 master 次算拿手菜（待平衡） */
export const COOK_GROWTH = { scale: 0.35, cap: 110, first: 2, master: 10 };

/**
 * 做出来好不好吃：品质 = base + (技能 − 解锁门槛) × perSkill + 已做次数 × perTry（最多 tryMax），钳在 [min, max]。
 * 饱食、娱乐按品质乘（健康不乘）。品质 ≥ great 算「做得很成功」。
 */
export const COOK_QUALITY = { base: 0.8, perSkill: 0.008, perTry: 0.02, tryMax: 0.1, min: 0.6, max: 1.25, great: 1.05 };

/** 叫外卖：只有能送到的地点类别、营业时段才行（待平衡） */
export const DELIVERY = { cost: 28, minutes: 45, hunger: 50, fun: 6, health: -1, hours: [10, 23] as [number, number], kinds: ['city', 'port', 'town', 'coast'] as LocationKind[] };

/**
 * 请客：每个游戏日一次；在家里，饭点开饭。来的是常驻这里、关系到「朋友」的 NPC（最多 maxGuests 位）。
 * 没有够格的朋友时请的是邻居、室友，只涨社交，不涨关系。
 * 收获：社交 social + perGuest × 人数、娱乐 fun、声望 respect；每位客人关系 +rel，摆齐「待客之家」再 +setRel。
 */
export const HOSTING = { hours: [11, 22] as [number, number], extraMinutes: 90, minEnergy: 20, friendAt: 30, maxGuests: 3, social: 25, perGuest: 10, fun: 15, respect: 1, rel: 6, setRel: 2, hostSet: 'host' };
