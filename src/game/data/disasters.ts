// 自然灾害（第 43 批）：数据表。规则在 core/disasters.ts，设计文档 docs/earth-game/disasters.md。
// 预警分三级，照抄澳洲统一预警体系（Australian Warning System，AWS）的级别名和颜色；
// 西澳由 DFES 通过 Emergency WA 发布（2024-07-15 起山火、气旋、风暴、洪水都改用 AWS），南澳山火由 CFS 发布。
// 所有触发几率、持续天数、影响门槛都是游戏假设，标「待平衡」；不是真实预警。
import type { LocationKind } from '../core/types.ts';

export type HazardId = 'bushfire' | 'flood' | 'cyclone' | 'heatwave' | 'outage';
export type WarnLevel = 1 | 2 | 3;

/** AWS 三级。英文名是官方叫法，中文是游戏里的说法 */
export const WARN_LEVELS: Record<WarnLevel, { id: string; name: string; en: string; color: 'yellow' | 'orange' | 'red'; meaning: string }> = {
	1: { id: 'advice', name: '提示', en: 'Advice', color: 'yellow', meaning: '事情已经开始，暂时没有危险，留意最新消息。' },
	2: { id: 'watch-act', name: '注意并行动', en: 'Watch and Act', color: 'orange', meaning: '情况在变坏，可能有危险，现在就开始行动。' },
	3: { id: 'emergency', name: '紧急警告', en: 'Emergency Warning', color: 'red', meaning: '现在就有危险，必须马上行动，拖延会有生命危险。' },
};

export interface HazardDef {
	id: HazardId;
	name: string;
	icon: string;
	/** 各级的行动建议（AWS 的「行动语句」思路，用游戏里的话说；内容克制，只讲该做什么） */
	advice: Record<WarnLevel, string>;
	/** 达到这一级时，进出这里的公路（road）关闭；不写表示不封公路 */
	closeRoad?: WarnLevel;
	/** 达到这一级时，进出这里的土路（track）关闭 */
	closeTrack?: WarnLevel;
	/** 达到这一级时，这里的航班停飞 */
	closeAir?: WarnLevel;
	/** 封路时是否只封「进来」的方向（撤离方向保持畅通）。洪水是路面被淹，两个方向都走不了 */
	inboundOnly?: boolean;
	/** 达到这一级时，下面这些户外活动关闭 */
	closeOutdoor?: WarnLevel;
	outdoor?: string[];
	/** 达到这一级时，所在地点停工（上不了班） */
	stopWork?: WarnLevel;
}

/** 户外活动（活动 id，见 data/activities.ts）。「野外找吃的」不在里面：没钱时它是兜底的吃饭办法，封了会把人困死 */
const OUTDOOR = ['hike', 'sleep-camp', 'stargaze', 'sunrise', 'storm-watch', 'work-farm', 'swim', 'snorkel', 'surf'];

export const HAZARDS: Record<HazardId, HazardDef> = {
	bushfire: {
		id: 'bushfire', name: '山火', icon: '🔥',
		advice: {
			1: '附近有山火，暂时没有威胁。留意 Emergency WA / CFS 的消息，想好万一要走往哪走。',
			2: '火在靠近。准备离开：带上证件、药、水和充电宝，不要往林区走。',
			3: '马上离开，往已经确认安全的城镇走；走不了就到坚固的建筑里躲着。',
		},
		closeRoad: 3, closeTrack: 2, inboundOnly: true,
		closeOutdoor: 2, outdoor: OUTDOOR,
		stopWork: 3,
	},
	flood: {
		id: 'flood', name: '洪水封路', icon: '🌊',
		advice: {
			1: '雨季河水上涨，有的土路可能封闭。出门前查 Main Roads WA 的路况。',
			2: '低洼路段被淹，土路已经封闭。不要开车涉水，备好几天的吃的和水。',
			3: '公路被洪水切断，进不来也出不去。待在高处，按当地通知行动，能飞的话坐飞机走。',
		},
		closeRoad: 3, closeTrack: 2,
		closeOutdoor: 3, outdoor: ['hike', 'sleep-camp', 'stargaze', 'swim', 'snorkel', 'surf'],
		stopWork: 3,
	},
	cyclone: {
		id: 'cyclone', name: '热带气旋', icon: '🌀',
		advice: {
			1: '海上有气旋在发展，可能会靠近。检查应急包，把院子里会被吹走的东西收好。',
			2: '气旋在靠近。备好水、吃的、电池，给车加满油；住房车、帐篷的人准备搬去结实的房子。',
			3: '气旋过境：待在室内最坚固的房间，不要出门，等通知说安全再出来。',
		},
		closeRoad: 3, closeTrack: 2, closeAir: 3,
		closeOutdoor: 2, outdoor: OUTDOOR,
		stopWork: 3,
	},
	heatwave: {
		id: 'heatwave', name: '热浪', icon: '🥵',
		advice: {
			1: '连着几天高温。多喝水，最热的中午少在外面待。',
			2: '高温还在持续，内陆更热。户外体力活和徒步暂停，照看身边的老人和小孩。',
			3: '极端高温。待在凉快的地方，不要在户外干活或长途开车。',
		},
		closeOutdoor: 2, outdoor: ['hike', 'work-farm', 'sleep-camp'],
	},
	outage: {
		id: 'outage', name: '停电', icon: '🔌',
		advice: {
			1: '这一带停电了。冰箱少开门，手机省着用电；在家做饭要有不用电的炉头（应急包里有）。',
			2: '大范围停电，恢复要一阵子。用应急包里的手电和收音机，不要在室内用炭火或发电机。',
			3: '大范围长时间停电，恢复可能要好几天。按当地通知行动，留意身边需要用电的病人和老人。',
		},
	},
};

/** 各灾害的季节、地区和触发参数。几率、天数都是游戏假设（待平衡） */
export const DISASTER_RULES = {
	/** 山火：火险「极端」「灾难性」的日子里，非城市地点按几率起火。0.35 / 0.7 待平衡 */
	bushfire: {
		kinds: ['park', 'outback', 'town', 'coast', 'mining'] as LocationKind[],
		/** 城市里的海滨区（格莱内尔格是阿德莱德的海滩区）不算 */
		exclude: ['glenelg'],
		igniteExtreme: 0.35,
		igniteCatastrophic: 0.7,
	},
	/** 洪水：北部（南纬 23° 以北）雨季 12–3 月。当天风暴 → 注意并行动；近 3 天风暴 ≥ 2 天 → 紧急警告；前 1–2 天有风暴 → 提示（待平衡） */
	flood: { latAbove: -23, months: [11, 0, 1, 2], lookback: 3 },
	/** 气旋：西北海岸（布鲁姆、黑德兰港、埃克斯茅斯、珊瑚湾）11–4 月，BOM 的气旋季。风暴天按几率算气旋过境（紧急警告），前一天注意并行动、前两天提示、过后一天提示。0.5 待平衡 */
	cyclone: { locs: ['broome', 'port-hedland', 'exmouth', 'coral-bay'], months: [10, 11, 0, 1, 2, 3], chance: 0.5 },
	/** 热浪：今天和前两天都是炎热 → 提示；连续 4 天或内陆连续 3 天 → 注意并行动；连续 5 天且在内陆 → 紧急警告（待平衡） */
	heatwave: { minRun: 3, watchRun: 4, emergencyRun: 5, lookback: 5 },
	/** 停电：气旋紧急警告、山火紧急警告必停；气旋注意并行动、热浪注意并行动以上、普通风暴天（城市除外）按几率（待平衡） */
	outage: { stormChance: 0.15, cycloneWatchChance: 0.4, heatChance: 0.25 },
} as const;

/** 应急包：物资准备。停电时在家还能用炉头做饭（见 core/disasters.ts outageBlocksCook） */
export const KIT_ITEM = 'emergency-kit';

/** 真实预警去哪看（界面链接）。西澳所有灾害都在 Emergency WA（DFES 发布）；南澳山火是 CFS，其他是 SES（洪水、风暴、热浪） */
export const WARN_AGENCY: Record<string, { default: { name: string; url: string }; bushfire?: { name: string; url: string } }> = {
	wa: { default: { name: 'Emergency WA（DFES）', url: 'https://www.emergency.wa.gov.au/' } },
	sa: {
		default: { name: '南澳应急服务 SES', url: 'https://www.ses.sa.gov.au/' },
		bushfire: { name: '南澳乡村消防局 CFS', url: 'https://www.cfs.sa.gov.au/' },
	},
};
