// 宠物（第一版，v31）：种类、领养/购买、喂养遛狗看兽医寄养的开销，以及住房和出行的限制。
// 设计文档：docs/earth-game/pets-wildlife.md。所有金额、好感度、时长都是游戏数值，【待平衡】，不代表真实价格。
// 规定类文字（登记、芯片、绝育、租房、禁止上岛）写的是现实规则的简化，来源见 PET_RULES 的 source。
import type { Effect } from '../core/types.ts';

export type PetSource = 'shelter' | 'breeder';

export interface PetKindDef {
	id: string;
	name: string;
	icon: string;
	/** 救助站领养费（含绝育、芯片、疫苗，游戏简化）【待平衡】 */
	adopt: number;
	/** 向登记过的繁育者或宠物店买（不含登记费）【待平衡】；不写表示游戏里不卖 */
	buy?: number;
	/** 向地方政府 / 州登记系统登记的一次性费用（游戏简化，真实收费按市政府定）【待平衡】；0 表示不用登记 */
	register: number;
	/** 每天的口粮【待平衡】 */
	food: number;
	/** 看一次兽医（年度体检 + 疫苗）【待平衡】 */
	vet: number;
	/** 寄养一天【待平衡】 */
	board: number;
	/** 能不能遛（只有狗） */
	walk: boolean;
	/** 陪它玩的效果（时间、需求、心情）【待平衡】 */
	play: Effect;
	desc: string;
	/** 默认名字（玩家没起名时按哈希挑一个） */
	names: string[];
}

export const PET_KINDS: PetKindDef[] = [
	{
		id: 'dog', name: '狗', icon: '🐕', adopt: 350, buy: 1500, register: 50, food: 4, vet: 120, board: 45, walk: true,
		play: { minutes: 30, needs: { fun: 12, social: 4 }, moodlet: 'pet-cuddle' },
		desc: '每天要遛。在西澳满 3 个月要植入芯片并在市政府登记。',
		names: ['豆豆', '旺财', '小黑', '可乐', '奶茶', 'Max', 'Buddy'],
	},
	{
		id: 'cat', name: '猫', icon: '🐈', adopt: 180, buy: 900, register: 20, food: 3, vet: 100, board: 30, walk: false,
		play: { minutes: 30, needs: { fun: 14, social: 3 }, moodlet: 'pet-cuddle' },
		desc: '不用遛，爱在家里晒太阳。在西澳满 6 个月要绝育、植入芯片并登记。',
		names: ['咪咪', '橘子', '年糕', '芝麻', 'Luna', 'Milo'],
	},
	{
		id: 'budgie', name: '虎皮鹦鹉', icon: '🦜', adopt: 40, buy: 60, register: 0, food: 1, vet: 70, board: 15, walk: false,
		play: { minutes: 20, needs: { fun: 10, social: 2 }, moodlet: 'pet-cuddle' },
		desc: '小小一只，会学几句话。不占地方，合租房也能养。',
		names: ['小绿', '啾啾', '蓝蓝', 'Kiwi', 'Sunny'],
	},
];

/** 宠物系统的调参常量（全部【待平衡】） */
export const PET = {
	/** 每天陪伴（喂、玩、遛）以外，连续没照顾的每一天扣的好感度（宠物不会因此离开或受伤） */
	neglectBond: 3,
	/** 刚领回家时的好感度 */
	startBond: 30,
	feedBond: 2,
	feedMinutes: 10,
	playBond: 4,
	walkBond: 5,
	vetBond: 3,
	vetMinutes: 90,
	/** 隔多少个游戏日该做一次年度体检（一年 112 个游戏日） */
	vetEvery: 112,
	/** 体检过期时陪伴涨的好感度减半 */
	overdueBondMult: 0.5,
	/** 遛狗 */
	walk: { minutes: 45, needs: { fun: 10, social: 8, energy: -6 }, skills: { stamina: 0.6 }, moodlet: 'dog-walk' } as Effect,
	/** 领养、买、送回救助站要花的时间（分钟） */
	adoptMinutes: 120,
	/** 一次最多寄养几天 */
	boardMaxDays: 14,
	/** 名字最长几个字 */
	nameMax: 12,
};

/** 能领养 / 买到宠物的地点类型（有救助站和宠物店的城市，游戏简化） */
export const PET_ADOPT_KINDS = ['city'] as const;
/** 能看兽医、寄养的地点：有医院的地方（游戏里假设同城有兽医和寄养所） */
export const PET_VET_TAG = 'hospital';

/**
 * 各房型能养什么（游戏规则）。现实：西澳 2024-07-29 起、南澳 2024-07-01 起，租客可以申请养宠，房东只能按规定理由拒绝；
 * 公寓楼（strata）的管理条例可以限制。游戏把这些简化成每种房型固定能养哪些：
 *   合租房间：要全屋同意，游戏里只许小鸟；高层公寓：楼规限制养狗；其余都可以。
 * 没写在这里的房型（以后新加的）默认都能养，测试会要求每种房型都写明。
 */
export const HOME_PETS: Record<string, string[]> = {
	room: ['budgie'],
	flat: ['dog', 'cat', 'budgie'],
	beach: ['dog', 'cat', 'budgie'],
	campground: ['dog', 'cat', 'budgie'],
	seaview: ['cat', 'budgie'],
	dugout: ['dog', 'cat', 'budgie'],
};

/** 宠物不能去的地点（不寄养就上不了）：罗特内斯特岛是 A 级保护区，不许带宠物上岛 */
export const PET_NO_GO = ['rottnest'];

/** 现实规定的简化说明（界面「宠物须知」和设计文档用）。只写有官方或政府来源的 */
export const PET_RULES: { id: string; text: string; source: string }[] = [
	{ id: 'wa-dog', text: '西澳：狗满 3 个月要植入芯片，并在所在市政府登记；绝育不是强制的，但绝育过的登记费更便宜。', source: 'https://www.wa.gov.au/organisation/local-government/microchipping-cats-and-dogs' },
	{ id: 'wa-cat', text: '西澳：猫满 6 个月要绝育、植入芯片，并在所在市政府登记（《2011 年猫法》）。', source: 'https://www.wa.gov.au/organisation/local-government/laws-responsible-cat-owners' },
	{ id: 'sa-dog-cat', text: '南澳：猫狗要在 12 周前（或到手 28 天内）植入芯片；2018-07-01 以后出生的要绝育；信息登记在州统一系统 Dogs and Cats Online。', source: 'https://www.dogandcatboard.com.au/' },
	{ id: 'wa-rent', text: '西澳租房：2024-07-29 起租客可以申请养宠，房东只能凭法律、楼规或经消费者保护专员批准才可拒绝；可收宠物押金（上限 $350）。', source: 'https://www.consumerprotection.wa.gov.au/consumer-protection/wa-rent-reforms' },
	{ id: 'sa-rent', text: '南澳租房：2024-07-01 起房东只能按规定理由拒绝养宠，不能另收宠物押金。', source: 'https://www.cbs.sa.gov.au/sections/renting/renting/renting-with-pets' },
	{ id: 'parks', text: '西澳的国家公园、自然保护区和海洋公园不许带宠物（导盲犬等辅助动物除外），野外还常投放对狗有毒的诱饵。', source: 'https://exploreparks.dbca.wa.gov.au/pets-parks' },
	{ id: 'rottnest', text: '罗特内斯特岛是 A 级保护区，不许带宠物上岛（辅助犬需事先联系护林员）。', source: 'https://www.rottnestisland.com/visit/accessibility' },
];

export const getPetKind = (id: string): PetKindDef | undefined => PET_KINDS.find((k) => k.id === id);

/** 这种房型能不能养这种宠物（没写的房型默认能） */
export function homeAllowsPet(homeId: string, kind: string): boolean {
	return !Object.hasOwn(HOME_PETS, homeId) || HOME_PETS[homeId].includes(kind);
}
