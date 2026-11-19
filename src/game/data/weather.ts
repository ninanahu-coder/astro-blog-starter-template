// 天气：每个地点每个游戏日一种（core/weather.ts）。出现的概率不再按「季节」一张表，而是按地点参照的真实气象站的当月气候平均推出来（data/climate.ts，第 30 批）。
// 玩法效果：风暴天下海、浮潜、冲浪、出海（普通活动、事件选项、NPC 专属互动里标了 exposed: 'sea' 的）当天都做不了；
// 活动、事件、钓鱼、拍照任务、随身装备可以用 weather 列表限定天气。其余只是显示（气温、紫外线、火险的修正见 core/sky.ts）。

export interface WeatherDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	/** 当天取消海上的活动 */
	closesSea?: boolean;
}

export const WEATHERS: WeatherDef[] = [
	{ id: 'sunny', name: '晴', icon: '☀️', desc: '万里无云。' },
	{ id: 'cloudy', name: '多云', icon: '⛅', desc: '云层时厚时薄，不冷不热。' },
	{ id: 'hot', name: '炎热', icon: '🥵', desc: '内陆吹来的热风，记得多喝水。' },
	{ id: 'cold', name: '寒冷', icon: '🥶', desc: '早上可能结霜，白天也凉，出门多穿一件。' },
	{ id: 'rain', name: '小雨', icon: '🌦️', desc: '下下停停的阵雨。' },
	{ id: 'storm', name: '风暴', icon: '⛈️', desc: '大风大浪：下海、浮潜、冲浪、出海都做不了。', closesSea: true },
];
