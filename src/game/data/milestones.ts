// 生涯里程碑（docs/earth-game/career-stats.md）：只是记下「哪一天第一次做到」，不发奖励、不影响数值。
// 门槛是展示用的整数，不是平衡数值；以后想调可以直接改，已经记下的日子不会被收回。
// 标题不得带具体地点名：分享卡会用到它们，分享卡上不带真实位置。

/** 用哪个计数判断：days 来澳天数、places 到过的地点数、km 累计公里、earned 累计收入（元）、people 认识的人，其余是「有没有 / 有几个」 */
export type MilestoneKind = 'days' | 'places' | 'km' | 'earned' | 'people' | 'job' | 'home' | 'property' | 'vehicle' | 'cert';

export interface MilestoneDef {
	id: string;
	title: string;
	kind: MilestoneKind;
	/** 计数达到 n 就算达成 */
	n: number;
}

export const MILESTONES: MilestoneDef[] = [
	{ id: 'ms-days-7', title: '来澳满一周', kind: 'days', n: 7 },
	{ id: 'ms-days-30', title: '来澳满一个月', kind: 'days', n: 30 },
	{ id: 'ms-days-100', title: '来澳满 100 天', kind: 'days', n: 100 },
	{ id: 'ms-days-365', title: '来澳满一年', kind: 'days', n: 365 },
	{ id: 'ms-job', title: '找到第一份工作', kind: 'job', n: 1 },
	{ id: 'ms-home', title: '有了自己的住处', kind: 'home', n: 1 },
	{ id: 'ms-vehicle', title: '有了自己的车', kind: 'vehicle', n: 1 },
	{ id: 'ms-cert', title: '考到第一张证书', kind: 'cert', n: 1 },
	{ id: 'ms-property', title: '买下第一套房产', kind: 'property', n: 1 },
	{ id: 'ms-places-10', title: '到过 10 个地方', kind: 'places', n: 10 },
	{ id: 'ms-places-30', title: '到过 30 个地方', kind: 'places', n: 30 },
	{ id: 'ms-km-100', title: '走过 100 公里', kind: 'km', n: 100 },
	{ id: 'ms-km-1000', title: '走过 1000 公里', kind: 'km', n: 1000 },
	{ id: 'ms-km-5000', title: '走过 5000 公里', kind: 'km', n: 5000 },
	{ id: 'ms-earned-1k', title: '累计收入 $1,000', kind: 'earned', n: 1000 },
	{ id: 'ms-earned-10k', title: '累计收入 $10,000', kind: 'earned', n: 10000 },
	{ id: 'ms-earned-100k', title: '累计收入 $100,000', kind: 'earned', n: 100000 },
	{ id: 'ms-people-5', title: '认识了 5 个人', kind: 'people', n: 5 },
	{ id: 'ms-people-20', title: '认识了 20 个人', kind: 'people', n: 20 },
];
