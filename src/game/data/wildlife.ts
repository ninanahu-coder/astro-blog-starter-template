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
	{ id: 'sea-lion', name: '澳洲海狮', icon: '🦭', group: 'sea', desc: '躺在礁石上晒太阳，懒得理人。', where: { locs: ['esperance', 'albany'] }, chance: 0.12 },
	// 陆地
	{ id: 'grey-kangaroo', name: '西部灰袋鼠', icon: '🦘', group: 'land', desc: '清晨傍晚在草地上成群吃草。', where: { kinds: ['outback', 'park', 'town'], locs: ['esperance', 'margaret-river'] }, periods: ['dawn', 'dusk', 'night'], chance: 0.35 },
	{ id: 'red-kangaroo', name: '赤袋鼠', icon: '🦘', group: 'land', desc: '内陆红土上跳得最远的大袋鼠。', where: { locs: ['karijini', 'kununurra', 'port-hedland', 'kalgoorlie'] }, chance: 0.2 },
	{ id: 'quokka', name: '短尾矮袋鼠', icon: '🐹', group: 'land', desc: '看起来总在笑，别喂它。', where: { locs: ['rottnest'] }, chance: 0.6 },
	{ id: 'emu', name: '鸸鹋', icon: '🐦', group: 'land', desc: '跑得飞快、不会飞的大鸟。', where: { locs: ['pinnacles', 'kalbarri', 'wave-rock'], kinds: ['outback'] }, chance: 0.2 },
	{ id: 'echidna', name: '针鼹', icon: '🦔', group: 'land', desc: '满身是刺，用长鼻子舔蚂蚁。', where: { kinds: ['park', 'outback'] }, chance: 0.06 },
	{ id: 'thorny-devil', name: '魔蜥', icon: '🦎', group: 'land', desc: '浑身尖刺的小蜥蜴，靠皮肤喝露水。', where: { kinds: ['outback', 'mining'], locs: ['karijini'] }, seasons: ['spring', 'summer'], chance: 0.06 },
	{ id: 'quenda', name: '短鼻袋狸', icon: '🐀', group: 'land', desc: '夜里在灌木丛下翻土找虫吃。', where: { locs: ['perth', 'albany', 'margaret-river'] }, periods: ['dusk', 'night'], chance: 0.1 },
	{ id: 'saltwater-crocodile', name: '湾鳄', icon: '🐊', group: 'land', desc: '北边河口的霸主，离水边远一点。', where: { locs: ['kununurra', 'broome'] }, chance: 0.1 },
	// 飞鸟
	{ id: 'black-swan', name: '黑天鹅', icon: '🦢', group: 'bird', desc: '西澳的州鸟，天鹅河因它得名。', where: { locs: ['perth', 'bunbury'] }, chance: 0.35 },
	{ id: 'pelican', name: '澳洲鹈鹕', icon: '🐦', group: 'bird', desc: '在码头边等渔民扔鱼。', where: { locs: ['fremantle', 'bunbury', 'monkey-mia', 'kalbarri'] }, chance: 0.2 },
	{ id: 'black-cockatoo', name: '卡氏黑凤头鹦鹉', icon: '🐦‍⬛', group: 'bird', desc: '一群一群从头顶飞过，叫声很响。', where: { locs: ['perth', 'margaret-river', 'bunbury'] }, chance: 0.15 },
	{ id: 'galah', name: '粉红凤头鹦鹉', icon: '🦜', group: 'bird', desc: '粉红胸脯，在路边草地上蹦。', where: { kinds: ['town', 'outback', 'mining'] }, chance: 0.25 },
	{ id: 'wedge-tailed-eagle', name: '楔尾雕', icon: '🦅', group: 'bird', desc: '澳洲最大的猛禽，在热气流里盘旋。', where: { kinds: ['outback', 'mining', 'park'] }, chance: 0.1 },
];
