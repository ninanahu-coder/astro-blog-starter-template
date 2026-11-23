// 钓鱼规定：最小尺寸、每人每天数量（bag limit）、禁捕区和禁渔季，参照西澳 DPIRD、南澳 PIRSA（第一版，2026-11-20 整理）。
//
// 重要：官方的物种规则页（rules.fish.wa.gov.au、pir.sa.gov.au）是动态页面或拒绝自动抓取，这里的数字来自官方页面链接的搜索摘要，
// 每条都写了来源链接和 checked 日期，**都需要 OpenClaw 用浏览器逐条核实**（verified: false）。没查到的鱼种不写规定，界面显示「规定待核实」，游戏里不限。
// 游戏只有岸钓（不出海），西澳岸钓不需要执照；出海钓要「船钓执照」（RFBL），留到以后。
// 游戏的季节是四季各 28 天，官方按月份的禁渔期折算成最接近的季节（见各条 note）。
//
// 鱼的体长是游戏里随机出的（cm 区间按常见钓获写的常识，待平衡），和真实分布无关。
import type { SeasonId } from '../core/time.ts';

export type StateId = 'wa' | 'sa';

export interface FishRule {
	fish: string;
	state: StateId;
	locs?: string[]; // 只在这些地点适用（分区规定）；不写就是这个州其余地方
	minCm?: number; // 最小尺寸（鱼量全长，蟹量甲壳宽），不写是没有最小尺寸
	bag?: number; // 每人每天能带走几条
	closed?: boolean; // 全年禁捕
	closedSeasons?: SeasonId[]; // 禁渔季
	why?: string; // 禁捕或禁渔的说明
	note?: string;
	src: string;
	verified: false;
}

/** 执照规定（界面说明用，游戏没有执照物品） */
export const FISH_LICENCE: Record<StateId, { text: string; src: string }> = {
	wa: { text: '西澳岸钓、码头钓一般不需要执照；开动力船出海钓、抓龙虾鲍鱼、西南淡水钓要各自的执照。', src: 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/get-a-recreational-fishing-licence/' },
	sa: { text: '南澳一般的休闲钓鱼不需要执照；水库钓鱼、放龙虾笼要许可。', src: 'https://recfishsa.org.au/fishing-regulations/' },
};

const WA_RULES = 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/recreational-fishing-rules/recreational-bag-and-size-limits';
const WA_DEMERSAL_2026 = 'https://www.dpird.wa.gov.au/siteassets/documents/fisheries/recreational/guides-and-infographics/new-demersal-recfishing-rules-brochure-1june2026.pdf';
const SA_HANDOUT = 'https://pir.sa.gov.au/__data/assets/pdf_file/0007/497149/A4-recreational-fishing-limits-handout.pdf';
/** 西澳西海岸生物区里游戏有的地点（南起奥古斯塔、北到卡尔巴里一带） */
const WA_WEST_COAST = ['perth', 'fremantle', 'rottnest', 'mandurah', 'bunbury', 'busselton', 'geraldton', 'kalbarri'];
/** 南澳两个海湾（圣文森特湾、斯潘塞湾）和袋鼠岛 */
const SA_GULFS = ['glenelg', 'port-lincoln'];

export const FISH_RULES: FishRule[] = [
	// ---- 西澳 ----
	{ fish: 'herring', state: 'wa', bag: 12, note: '没有最小尺寸。另有旧法规写 20 条，以 DPIRD 现行规则为准', src: WA_RULES, verified: false },
	{ fish: 'whiting', state: 'wa', minCm: 28, bag: 12, note: '乔治王鳕按「鳕鱼类」合计', src: 'https://rules.fish.wa.gov.au/Species/Index/24', verified: false },
	{ fish: 'black-bream', state: 'wa', minCm: 25, bag: 6, note: '天鹅河、坎宁河里超过 40 cm 的每天最多 2 条（游戏没做）', src: 'https://rules.fish.wa.gov.au/Species/Index/45', verified: false },
	{ fish: 'blue-crab', state: 'wa', locs: ['perth'], minCm: 12.7, bag: 5, closedSeasons: ['spring'], why: '天鹅河到明尼纳普海滩一带 9 月 1 日到 11 月 30 日禁捕蓝花蟹（游戏里折算成春季）', note: '天鹅河、坎宁河每天 5 只；2026 年 DPIRD 在征求意见要统一规则', src: 'https://www.wa.gov.au/government/announcements/blue-swimmer-crabs-back-the-catch-list-summer', verified: false },
	{ fish: 'blue-crab', state: 'wa', locs: ['fremantle', 'mandurah', 'bunbury'], minCm: 12.7, bag: 10, closedSeasons: ['spring'], why: '天鹅河到明尼纳普海滩一带 9 月 1 日到 11 月 30 日禁捕蓝花蟹（游戏里折算成春季）', note: '皮尔—哈维河口每天 10 只', src: 'https://www.wa.gov.au/government/announcements/crabbing-compliance-operation-continues-long-weekend', verified: false },
	{ fish: 'pink-snapper', state: 'wa', locs: WA_WEST_COAST, bag: 2, note: '西海岸生物区岸钓：底层鱼合计每天 2 条；船钓底层鱼禁到 2027 年春。这一段北边的尺寸没查到', src: 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/west-coast-demersal-scalefish--information-for-recreational-fishers/', verified: false },
	{ fish: 'pink-snapper', state: 'wa', minCm: 45, bag: 2, note: '2026 年 6 月 1 日起西海岸以外 45 cm', src: WA_DEMERSAL_2026, verified: false },
	{ fish: 'dhufish', state: 'wa', locs: WA_WEST_COAST, bag: 2, note: '没有尺寸限制；西海岸岸钓底层鱼合计每天 2 条', src: 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/west-coast-demersal-scalefish--information-for-recreational-fishers/', verified: false },
	{ fish: 'dhufish', state: 'wa', bag: 1, note: '没有尺寸限制；西海岸以外每天 1 条（2026 年 6 月 1 日起）', src: WA_DEMERSAL_2026, verified: false },
	// ---- 南澳 ----
	{ fish: 'whiting', state: 'sa', locs: ['glenelg', 'kangaroo-island'], minCm: 32, bag: 5, closedSeasons: ['autumn'], why: '海湾里 3 月 1 日到 6 月 30 日是产卵期禁捕（游戏里折算成秋季）', note: '圣文森特湾和袋鼠岛每天 5 条', src: 'https://pir.sa.gov.au/fishing-and-aquaculture/recreational-fishing/rules/species-limits/species-profile/king_george_whiting', verified: false },
	{ fish: 'whiting', state: 'sa', locs: ['port-lincoln'], minCm: 32, bag: 10, closedSeasons: ['autumn'], why: '海湾里 3 月 1 日到 6 月 30 日是产卵期禁捕（游戏里折算成秋季）', note: '斯潘塞湾每天 10 条', src: 'https://pir.sa.gov.au/fishing-and-aquaculture/recreational-fishing/rules/species-limits/species-profile/king_george_whiting', verified: false },
	{ fish: 'whiting', state: 'sa', minCm: 30, bag: 10, note: '东经 136° 以西、海湾以外 30 cm', src: 'https://pir.sa.gov.au/fishing-and-aquaculture/recreational-fishing/rules/species-limits/species-profile/king_george_whiting', verified: false },
	{ fish: 'pink-snapper', state: 'sa', closed: true, why: '南澳除东南海域外全部水域禁捕鲷鱼', src: SA_HANDOUT, verified: false },
	{ fish: 'squid', state: 'sa', locs: [...SA_GULFS, 'kangaroo-island'], closed: true, why: '斯潘塞湾、圣文森特湾和袋鼠岛禁捕南方枪乌贼', src: SA_HANDOUT, verified: false },
	{ fish: 'squid', state: 'sa', bag: 15, note: '其他水域每天 15 只', src: SA_HANDOUT, verified: false },
];

/** 每种鱼游戏里的体长区间（cm，待平衡；只是让尺寸有意义，不是真实分布） */
export const FISH_CM: Record<string, [number, number]> = {
	herring: [15, 32],
	mullet: [20, 50],
	whiting: [22, 45],
	'black-bream': [18, 40],
	salmon: [35, 80],
	squid: [10, 30],
	'blue-crab': [9, 17],
	'pink-snapper': [30, 80],
	dhufish: [40, 100],
	trevally: [30, 70],
	mackerel: [60, 130],
	barramundi: [40, 100],
};
