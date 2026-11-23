// 爱好与收集（第一版，设计见 docs/earth-game/hobbies.md）。
// 六个爱好：摄影、钓鱼、观鸟、园艺、手工、乐器。每做一次涨熟练度，熟练度分五级；同一天反复做同一件事，乐趣递减。
// 所有数值都「待平衡」：Claude 按直觉定的初值，等 Codex 跑模拟和分析后再调。
// 鸟种、植物分布按公开常识写，需 OpenClaw 核实；曲目只用公有领域的民歌和老歌。
import type { Needs, SkillKey } from '../core/types.ts';
import type { SeasonId } from '../core/time.ts';

export type HobbyId = 'photo' | 'fishing' | 'birding' | 'garden' | 'craft' | 'music';
export const HOBBY_IDS: HobbyId[] = ['photo', 'fishing', 'birding', 'garden', 'craft', 'music'];

export interface HobbyDef {
	id: HobbyId;
	name: string;
	icon: string;
	desc: string;
	minutes: number; // 一次花多久（钓鱼沿用 FISHING.minutes）
	needs: Partial<Needs>; // 第一次做的心情收益，之后按 HOBBY.repeat 打折（体力消耗不打折）
	skills: Partial<Record<SkillKey, number>>; // 每次给的能力成长
	pals: string[]; // 同好 NPC：他们此刻在场时一起做，好感 +HOBBY.palGain、社交 +HOBBY.palSocial
}

/** 熟练度和共通规则（待平衡） */
export const HOBBY = {
	xpFirst: 3, // 当天第一次做给的熟练度
	xpRepeat: 1, // 当天再做给的熟练度
	xpMax: 999,
	levels: [0, 10, 30, 60, 100] as const, // 各级起点：1 级入门 … 5 级大师
	levelNames: ['入门', '熟手', '行家', '高手', '大师'] as const,
	repeat: [1, 0.5, 0.25] as const, // 当天第 1、2、3 次及以后的心情收益倍率
	palGain: 2, // 和同好一起做：好感
	palSocial: 6, // 和同好一起做：社交
	moodlet: 'hobby-flow', // 当天第一次做给的心情状态
};

export const HOBBIES: HobbyDef[] = [
	{ id: 'photo', name: '摄影', icon: '📷', desc: '随手拍一组：清晨傍晚的光最好，坏天气反而出片。每个地方留最好的一张进作品集。', minutes: 45, needs: { fun: 10, energy: -4 }, skills: { charisma: 0.3 }, pals: ['harry', 'yuki'] },
	{ id: 'fishing', name: '钓鱼', icon: '🎣', desc: '量尺寸、守数量，钓到不合规定的当场放生。鱼种图鉴记下每种鱼的最大尺寸。', minutes: 90, needs: { fun: 12, energy: -8 }, skills: { survival: 0.5 }, pals: ['jack', 'tom'] },
	{ id: 'birding', name: '观鸟', icon: '🐦', desc: '带上耐心慢慢找，熟练了更容易发现稀有的鸟。和野生动物图鉴里的飞鸟互通。', minutes: 60, needs: { fun: 10, energy: -6 }, skills: { survival: 0.3, stamina: 0.2 }, pals: ['linda', 'ayla', 'rosa'] },
	{ id: 'garden', name: '园艺', icon: '🌱', desc: '在住处种点东西：按季节播种，过几天收成。要有住处、人在住处。', minutes: 30, needs: { fun: 8, energy: -3 }, skills: { strength: 0.2 }, pals: ['mack', 'greta'] },
	{ id: 'craft', name: '手工', icon: '🧶', desc: '在住处做点小东西，熟练了能做更难的。要有住处、人在住处，材料要花钱。', minutes: 90, needs: { fun: 14, energy: -4 }, skills: { charisma: 0.2 }, pals: [] },
	{ id: 'music', name: '乐器', icon: '🪕', desc: '练一会儿尤克里里，熟练度到了就学会新曲子。要先买一把琴。', minutes: 60, needs: { fun: 12, energy: -4 }, skills: { charisma: 0.4 }, pals: ['leo'] },
];

// ---------- 摄影：作品集 ----------
/** 作品分数（0–100）的构成，待平衡。分数 ≥ good 算一张「佳作」，进收集 */
export const PHOTO_WORK = {
	base: 25,
	perLevel: 8, // 每级熟练度
	golden: 15, // 清晨、傍晚的光
	weather: { storm: 12, rain: 6, cloudy: 4 } as Record<string, number>, // 坏天气反而出片
	luck: 30, // 随机部分的上限
	good: 70,
	quest: 85, // 摄影任务拍下的照片直接进作品集的分数
};

// ---------- 观鸟 ----------
export interface BirdDef {
	id: string; // 和野生动物图鉴同一种鸟时用同一个 id，看见就一起记下
	name: string;
	icon: string;
	desc: string;
	where: { locs?: string[]; kinds?: string[]; tags?: string[] };
	seasons?: SeasonId[];
	periods?: ('dawn' | 'day' | 'dusk' | 'night')[];
	weight: number; // 被找到的权重，越小越稀有（待平衡）
}

/** 观鸟：空手而归的权重，随熟练度下降（待平衡） */
export const BIRDING = { emptyBase: 40, emptyPerLevel: 6, emptyMin: 10 };

export const BIRDS: BirdDef[] = [
	{ id: 'silver-gull', name: '银鸥', icon: '🐦', desc: '海边抢薯条的老面孔。', where: { tags: ['beach'], kinds: ['port', 'coast'] }, weight: 30 },
	{ id: 'galah', name: '粉红凤头鹦鹉', icon: '🦜', desc: '粉红胸脯，在路边草地上蹦。', where: { kinds: ['town', 'outback', 'mining', 'city'] }, weight: 25 },
	{ id: 'twenty-eight-parrot', name: '环颈鹦鹉', icon: '🦜', desc: '本地人叫它「二十八」，学的是它的叫声。', where: { locs: ['perth', 'fremantle', 'bunbury', 'margaret-river', 'albany', 'kalgoorlie'] }, weight: 18 },
	// 合并 main 后：宠物与野生动物分支给图鉴加的两种鸟，同 id 同名，观鸟看见时一起记进图鉴（权重待平衡）
	{ id: 'magpie', name: '澳洲喜鹊', icon: '🐦‍⬛', desc: '黑白相间，歌声好听。春天护巢时会俯冲路人，戴帽子绕开走。', where: { kinds: ['city', 'town'] }, weight: 22 },
	{ id: 'kookaburra', name: '笑翠鸟', icon: '🐦', desc: '清晨傍晚放声「大笑」。在西澳是从东部引进的。', where: { locs: ['perth', 'margaret-river', 'pemberton', 'adelaide', 'hahndorf'] }, periods: ['dawn', 'dusk'], weight: 10 },
	{ id: 'black-swan', name: '黑天鹅', icon: '🦢', desc: '西澳的州鸟，天鹅河因它得名。', where: { locs: ['perth', 'bunbury', 'mandurah', 'adelaide'] }, weight: 18 },
	{ id: 'pelican', name: '澳洲鹈鹕', icon: '🐦', desc: '在码头边等渔民扔鱼。', where: { locs: ['fremantle', 'bunbury', 'monkey-mia', 'kalbarri', 'mandurah', 'kangaroo-island', 'glenelg'] }, weight: 15 },
	{ id: 'splendid-fairy-wren', name: '辉蓝细尾鹩莺', icon: '🐦', desc: '雄鸟繁殖季浑身宝蓝，在灌木丛里一跳一跳。', where: { locs: ['perth', 'margaret-river', 'albany', 'esperance', 'kalbarri'] }, seasons: ['spring', 'summer'], weight: 10 },
	{ id: 'superb-fairy-wren', name: '华丽细尾鹩莺', icon: '🐦', desc: '南澳花园里的小蓝鸟，尾巴翘得老高。', where: { locs: ['adelaide', 'hahndorf', 'mclaren-vale', 'victor-harbor'] }, weight: 12 },
	{ id: 'adelaide-rosella', name: '阿德莱德玫瑰鹦鹉', icon: '🦜', desc: '橙红色的玫瑰鹦鹉，只在阿德莱德山一带。', where: { locs: ['hahndorf', 'adelaide', 'barossa'] }, weight: 8 },
	{ id: 'black-cockatoo', name: '卡氏黑凤头鹦鹉', icon: '🐦‍⬛', desc: '一群一群从头顶飞过，叫声很响。', where: { locs: ['perth', 'margaret-river', 'bunbury'] }, weight: 8 },
	{ id: 'rainbow-bee-eater', name: '彩虹蜂虎', icon: '🐦', desc: '春天从北方飞来，在沙地里打洞做窝。', where: { kinds: ['town', 'park', 'outback'], locs: ['perth'] }, seasons: ['spring', 'summer'], weight: 7 },
	{ id: 'osprey', name: '鹗', icon: '🦅', desc: '在灯塔和高杆上筑巢，一头扎进水里抓鱼。', where: { locs: ['kalbarri', 'exmouth', 'coral-bay', 'monkey-mia', 'port-lincoln', 'ceduna'] }, weight: 5 },
	{ id: 'cape-barren-goose', name: '澳洲灰雁', icon: '🪿', desc: '绿黄色的嘴，在袋鼠岛的草场上吃草。', where: { locs: ['kangaroo-island'] }, weight: 8 },
	{ id: 'little-penguin', name: '小蓝企鹅', icon: '🐧', desc: '世界上最小的企鹅，天黑后才成群上岸。', where: { locs: ['kangaroo-island', 'victor-harbor'] }, periods: ['dusk', 'night'], weight: 4 },
	{ id: 'wedge-tailed-eagle', name: '楔尾雕', icon: '🦅', desc: '澳洲最大的猛禽，在热气流里盘旋。', where: { kinds: ['outback', 'mining', 'park'] }, periods: ['day'], weight: 4 },
];

// ---------- 园艺 ----------
export interface PlantDef {
	id: string;
	name: string;
	icon: string;
	seasons: SeasonId[]; // 能播种的季节
	days: number; // 播下后几天能收（游戏日）
	seed: number; // 种子钱
	harvest: Partial<Needs>; // 收成时的额外收益（吃到自己种的菜）
	rarity: Rarity;
}

export const GARDEN = { waterFun: 0.5 }; // 还没到收成时去照看，心情收益打折（待平衡）

export const PLANTS: PlantDef[] = [
	{ id: 'basil', name: '罗勒', icon: '🌿', seasons: ['spring', 'summer'], days: 3, seed: 4, harvest: { hunger: 6 }, rarity: 'common' },
	{ id: 'cherry-tomato', name: '圣女果', icon: '🍅', seasons: ['spring', 'summer'], days: 6, seed: 5, harvest: { hunger: 12 }, rarity: 'common' },
	{ id: 'chilli', name: '辣椒', icon: '🌶️', seasons: ['spring', 'summer'], days: 7, seed: 5, harvest: { hunger: 6, fun: 4 }, rarity: 'uncommon' },
	{ id: 'bok-choy', name: '小白菜', icon: '🥬', seasons: ['autumn', 'winter', 'spring'], days: 4, seed: 4, harvest: { hunger: 10 }, rarity: 'common' },
	{ id: 'coriander', name: '香菜', icon: '🌿', seasons: ['autumn', 'winter'], days: 4, seed: 4, harvest: { hunger: 6 }, rarity: 'common' },
	{ id: 'snow-pea', name: '荷兰豆', icon: '🫛', seasons: ['autumn', 'winter'], days: 6, seed: 5, harvest: { hunger: 10 }, rarity: 'uncommon' },
	{ id: 'everlasting', name: '蜡菊', icon: '🌼', seasons: ['autumn'], days: 8, seed: 8, harvest: { fun: 10 }, rarity: 'rare' },
	{ id: 'kangaroo-paw', name: '袋鼠爪花', icon: '🌺', seasons: ['autumn', 'spring'], days: 10, seed: 12, harvest: { fun: 15 }, rarity: 'legend' },
];

// ---------- 手工 ----------
export interface CraftDef {
	id: string;
	name: string;
	icon: string;
	level: number; // 熟练度几级才会做
	cost: number; // 材料钱
	rarity: Rarity;
}

export const CRAFTS: CraftDef[] = [
	{ id: 'tote', name: '手绘帆布袋', icon: '👜', level: 1, cost: 12, rarity: 'common' },
	{ id: 'candle', name: '香薰蜡烛', icon: '🕯️', level: 1, cost: 12, rarity: 'common' },
	{ id: 'macrame', name: '绳编挂饰', icon: '🪢', level: 2, cost: 15, rarity: 'uncommon' },
	{ id: 'clay-mug', name: '陶土杯', icon: '☕', level: 3, cost: 20, rarity: 'uncommon' },
	{ id: 'wood-spoon', name: '木勺', icon: '🥄', level: 4, cost: 18, rarity: 'rare' },
	{ id: 'quilt', name: '拼布小毯', icon: '🧵', level: 5, cost: 30, rarity: 'legend' },
];

// ---------- 乐器 ----------
/** 乐器：要有这件物品才能练（data/items.ts） */
export const INSTRUMENT = 'ukulele';

export interface SongDef {
	id: string;
	name: string;
	xp: number; // 乐器熟练度到多少学会
	rarity: Rarity;
}

// 只用公有领域的曲目
export const SONGS: SongDef[] = [
	{ id: 'scales', name: '音阶练习', xp: 0, rarity: 'common' },
	{ id: 'twinkle', name: '小星星', xp: 6, rarity: 'common' },
	{ id: 'jasmine', name: '茉莉花', xp: 15, rarity: 'uncommon' },
	{ id: 'auld-lang-syne', name: '友谊地久天长', xp: 30, rarity: 'uncommon' },
	{ id: 'waltzing-matilda', name: '丛林流浪', xp: 50, rarity: 'rare' },
	{ id: 'greensleeves', name: '绿袖子', xp: 80, rarity: 'legend' },
];

// ---------- 收集：统一框架 ----------
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend';
export const RARITY: Record<Rarity, { name: string; icon: string }> = {
	common: { name: '常见', icon: '⚪' },
	uncommon: { name: '少见', icon: '🟢' },
	rare: { name: '稀有', icon: '🔵' },
	legend: { name: '传说', icon: '🟣' },
};

/** 由出现权重（钓鱼、观鸟的 weight）定稀有度的分界：≥ common 常见，≥ uncommon 少见，≥ rare 稀有，其余传说（待平衡） */
export const WEIGHT_RARITY = { common: 20, uncommon: 10, rare: 5 };
/** 由看见几率（野生动物的 chance）定稀有度的分界 */
export const CHANCE_RARITY = { common: 0.3, uncommon: 0.15, rare: 0.08 };

/** 收集册里程碑奖励：收到一半、收齐各发一次（待平衡）。野生动物图鉴沿用原来的分组奖励，天气相册不发奖 */
export const COLLECTION_REWARD = { half: { respect: 2 }, full: { respect: 5 } };
