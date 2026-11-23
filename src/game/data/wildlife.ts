// 野生动物图鉴：抵达一个地方时，按地点、季节、时段可能看见动物，第一次见到就记进图鉴。
// 遇见几率不消耗存档里的随机种子（只读一次哈希），所以加图鉴不改变别的随机结果。
// 一组集齐发一次声望（数值待平衡）。动物种类和分布按公开资料写的常识，需 OpenClaw 核实。
import type { Where } from '../core/types.ts';
import type { SeasonId } from '../core/time.ts';

export interface AnimalDef {
	id: string;
	name: string;
	icon: string;
	group: 'sea' | 'land' | 'bird';
	desc: string;
	where: Where & { locs?: string[] };
	seasons?: SeasonId[];
	periods?: ('dawn' | 'day' | 'dusk' | 'night')[];
	/** 只在当地当天是这些天气时出现（天气 id，见 data/weather.ts）。v31 起：海洋动物风暴天一律看不到，不用写 */
	weather?: string[];
	chance: number; // 每次抵达看见它的几率（待平衡）
}

export const DEX_GROUPS: Record<AnimalDef['group'], { name: string; respect: number }> = {
	sea: { name: '海洋', respect: 4 },
	land: { name: '陆地', respect: 4 },
	bird: { name: '飞鸟', respect: 4 },
};

export const ANIMALS: AnimalDef[] = [
	// 海洋
	{ id: 'bottlenose-dolphin', name: '宽吻海豚', icon: '🐬', group: 'sea', desc: '成群在浅湾里追鱼，常凑到船边。', where: { tags: ['dolphin'], locs: ['bunbury', 'rottnest', 'fremantle'] }, chance: 0.3 },
	{ id: 'humpback-whale', name: '座头鲸', icon: '🐋', group: 'sea', desc: '每年冬春沿澳洲海岸南来北往。', where: { tags: ['whale'], locs: ['exmouth'] }, seasons: ['winter', 'spring'], chance: 0.3 },
	{ id: 'southern-right-whale', name: '南露脊鲸', icon: '🐳', group: 'sea', desc: '冬天会进南岸的海湾里生小鲸。', where: { locs: ['albany', 'esperance'] }, seasons: ['winter'], chance: 0.15 },
	{ id: 'whale-shark', name: '鲸鲨', icon: '🦈', group: 'sea', desc: '世界上最大的鱼，只吃浮游生物。', where: { locs: ['exmouth'] }, seasons: ['autumn', 'winter'], chance: 0.15 },
	{ id: 'manta-ray', name: '蝠鲼', icon: '🪽', group: 'sea', desc: '在珊瑚礁上方慢慢扇着「翅膀」。', where: { tags: ['reef'], locs: ['exmouth'] }, chance: 0.12 },
	{ id: 'green-turtle', name: '绿海龟', icon: '🐢', group: 'sea', desc: '夏夜爬上沙滩产卵。', where: { locs: ['exmouth', 'broome'] }, seasons: ['summer'], chance: 0.2 },
	{ id: 'dugong', name: '儒艮', icon: '🦭', group: 'sea', desc: '在海草床上低头吃草的「海牛」。', where: { locs: ['monkey-mia'] }, chance: 0.1 },
	{ id: 'sea-lion', name: '澳洲海狮', icon: '🦭', group: 'sea', desc: '躺在礁石上晒太阳，懒得理人。', where: { locs: ['esperance', 'albany', 'kangaroo-island'] }, chance: 0.12 },
	// v31 新增（南澳与天气联动）。分布按公开常识写，待 OpenClaw 核实；几率待平衡
	{ id: 'leafy-seadragon', group: 'sea', name: '叶海龙', icon: '🐉', desc: '南澳的州海洋标志，身上长着海藻一样的叶片。看看就好，不能碰。', where: { locs: ['cape-jervis', 'kangaroo-island'] }, weather: ['sunny', 'cloudy', 'hot'], chance: 0.08 },
	// 陆地
	{ id: 'grey-kangaroo', name: '西部灰袋鼠', icon: '🦘', group: 'land', desc: '清晨傍晚在草地上成群吃草。', where: { kinds: ['outback', 'park', 'town'], locs: ['esperance', 'margaret-river'] }, periods: ['dawn', 'dusk', 'night'], chance: 0.35 },
	{ id: 'red-kangaroo', name: '赤袋鼠', icon: '🦘', group: 'land', desc: '内陆红土上跳得最远的大袋鼠。', where: { locs: ['karijini', 'kununurra', 'port-hedland', 'kalgoorlie'] }, chance: 0.2 },
	{ id: 'quokka', name: '短尾矮袋鼠', icon: '🐹', group: 'land', desc: '看起来总在笑，别喂它。', where: { locs: ['rottnest'] }, chance: 0.6 },
	{ id: 'emu', name: '鸸鹋', icon: '🐦', group: 'land', desc: '跑得飞快、不会飞的大鸟。', where: { locs: ['pinnacles', 'kalbarri', 'wave-rock'], kinds: ['outback'] }, chance: 0.2 },
	{ id: 'echidna', name: '针鼹', icon: '🦔', group: 'land', desc: '满身是刺，用长鼻子舔蚂蚁。', where: { kinds: ['park', 'outback'] }, chance: 0.06 },
	{ id: 'thorny-devil', name: '魔蜥', icon: '🦎', group: 'land', desc: '浑身尖刺的小蜥蜴，靠皮肤喝露水。', where: { kinds: ['outback', 'mining'], locs: ['karijini'] }, seasons: ['spring', 'summer'], chance: 0.06 },
	{ id: 'quenda', name: '短鼻袋狸', icon: '🐀', group: 'land', desc: '夜里在灌木丛下翻土找虫吃。', where: { locs: ['perth', 'albany', 'margaret-river'] }, periods: ['dusk', 'night'], chance: 0.1 },
	{ id: 'saltwater-crocodile', name: '湾鳄', icon: '🐊', group: 'land', desc: '北边河口的霸主，离水边远一点。', where: { locs: ['kununurra', 'broome'] }, chance: 0.1 },
	{ id: 'bobtail', group: 'land', name: '短尾蜥', icon: '🦎', desc: '圆滚滚的蓝舌头蜥蜴，春天晴暖的日子爬到路边晒太阳。', where: { kinds: ['town', 'park', 'outback'], locs: ['perth'] }, seasons: ['spring', 'summer'], periods: ['day'], weather: ['sunny', 'hot'], chance: 0.12 },
	{ id: 'motorbike-frog', group: 'land', name: '摩托蛙', icon: '🐸', desc: '叫声像远处摩托车换挡，下过雨的夜里最热闹。', where: { locs: ['perth', 'pemberton', 'albany', 'margaret-river'] }, periods: ['dusk', 'night'], weather: ['rain', 'storm'], chance: 0.2 },
	{ id: 'koala', group: 'land', name: '考拉', icon: '🐨', desc: '抱着桉树睡一整天。袋鼠岛上的考拉是上世纪引进的。', where: { locs: ['kangaroo-island', 'hahndorf'] }, chance: 0.15 },
	{ id: 'rock-wallaby', group: 'land', name: '黄足岩袋鼠', icon: '🦘', desc: '尾巴上一圈圈黄色条纹，在弗林德斯山脉的岩壁上跳来跳去。', where: { locs: ['flinders-ranges'] }, periods: ['dawn', 'dusk'], chance: 0.2 },
	// 飞鸟
	{ id: 'black-swan', name: '黑天鹅', icon: '🦢', group: 'bird', desc: '西澳的州鸟，天鹅河因它得名。', where: { locs: ['perth', 'bunbury'] }, chance: 0.35 },
	{ id: 'pelican', name: '澳洲鹈鹕', icon: '🐦', group: 'bird', desc: '在码头边等渔民扔鱼。', where: { locs: ['fremantle', 'bunbury', 'monkey-mia', 'kalbarri'] }, chance: 0.2 },
	{ id: 'black-cockatoo', name: '卡氏黑凤头鹦鹉', icon: '🐦‍⬛', group: 'bird', desc: '一群一群从头顶飞过，叫声很响。', where: { locs: ['perth', 'margaret-river', 'bunbury'] }, chance: 0.15 },
	{ id: 'galah', name: '粉红凤头鹦鹉', icon: '🦜', group: 'bird', desc: '粉红胸脯，在路边草地上蹦。', where: { kinds: ['town', 'outback', 'mining'] }, chance: 0.25 },
	{ id: 'magpie', group: 'bird', name: '澳洲喜鹊', icon: '🐦‍⬛', desc: '黑白相间，歌声好听。春天护巢时会俯冲路人，戴帽子绕开走。', where: { kinds: ['city', 'town'] }, chance: 0.3 },
	{ id: 'kookaburra', group: 'bird', name: '笑翠鸟', icon: '🐦', desc: '清晨傍晚放声「大笑」。在西澳是从东部引进的。', where: { locs: ['perth', 'margaret-river', 'pemberton', 'adelaide', 'hahndorf'] }, periods: ['dawn', 'dusk'], chance: 0.2 },
	{ id: 'wedge-tailed-eagle', name: '楔尾雕', icon: '🦅', group: 'bird', desc: '澳洲最大的猛禽，在热气流里盘旋。', where: { kinds: ['outback', 'mining', 'park'] }, chance: 0.1 },
];

/**
 * 野生动物保护规则（界面「看动物的规矩」和事件文案依据）。只写有官方来源的；罚款金额各来源说法不一，不写具体数字。
 */
export const WILDLIFE_RULES: { id: string; text: string; source: string }[] = [
	{ id: 'quokka', text: '罗特内斯特岛上的短尾矮袋鼠不能摸、不能喂，违者当场罚款，严重的按《2016 年生物多样性保护法》起诉。', source: 'https://www.rottnestisland.com/learn/nature-wildlife/protect-our-wildlife' },
	{ id: 'whale', text: '西澳海上看鲸：船不能开到离鲸 100 米以内，也不能从正前方或正后方靠近。', source: 'https://www.dbca.wa.gov.au/news/2019/have-whale-time-watching-southern-migration' },
	{ id: 'dolphin', text: '猴子米亚的海豚喂食是受管理的活动，每天最多三次；码头等其他地方写明不要喂海豚。', source: 'https://exploreparks.dbca.wa.gov.au/park/monkey-mia-conservation-park' },
	{ id: 'general', text: '在保护区里喂野生动物也算干扰野生动物，会被当场罚款。看动物就站远一点看。', source: 'https://www.rottnestisland.com/learn/nature-wildlife/protect-our-wildlife' },
];
