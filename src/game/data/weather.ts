// 天气：每个地点每个游戏日一种（core/weather.ts）。出现的概率不再按「季节」一张表，而是按地点参照的真实气象站的当月气候平均推出来（data/climate.ts，第 30 批）。
// 玩法效果：风暴天下海、浮潜、冲浪、出海（普通活动、事件选项、NPC 专属互动里标了 exposed: 'sea' 的）当天都做不了；
// 活动、事件、钓鱼、拍照任务、随身装备可以用 weather 列表限定天气。第 26 批起「小雨」「风暴」还影响从当地出发的陆路和渡轮（见 road 字段）。其余只是显示（气温、紫外线、火险的修正见 core/sky.ts）。

export interface WeatherDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	/** 当天取消海上的活动（第 26 批起也停渡轮） */
	closesSea?: boolean;
	/**
	 * 第 26 批（待平衡）：从这里出发走陆路时的影响。mult 乘公路（自驾、巴士）耗时，trackMult 乘土路耗时；
	 * trackClosed 为 true 时土路当天封闭。参照：西澳内陆土路雨后常封路（见 docs/earth-game/home-and-vehicle.md）。
	 */
	road?: { mult: number; trackMult: number; trackClosed?: boolean };
}

export const WEATHERS: WeatherDef[] = [
	{ id: 'sunny', name: '晴', icon: '☀️', desc: '万里无云。' },
	{ id: 'cloudy', name: '多云', icon: '⛅', desc: '云层时厚时薄，不冷不热。' },
	{ id: 'hot', name: '炎热', icon: '🥵', desc: '内陆吹来的热风，记得多喝水。' },
	{ id: 'cold', name: '寒冷', icon: '🥶', desc: '早上可能结霜，白天也凉，出门多穿一件。' },
	{ id: 'rain', name: '小雨', icon: '🌦️', desc: '下下停停的阵雨，路上开慢点。', road: { mult: 1.1, trackMult: 1.3 } },
	{ id: 'storm', name: '风暴', icon: '⛈️', desc: '大风大浪：下海、浮潜、冲浪、出海都做不了，渡轮停航，土路封闭。', closesSea: true, road: { mult: 1.25, trackMult: 1, trackClosed: true } },
];
