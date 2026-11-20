// 天气：每个地点每个游戏日一种，按季节的权重抽取（core/weather.ts）。
// 「风暴」当天下海、浮潜、冲浪、出海（普通活动、事件选项、NPC 专属互动里标了 exposed: 'sea' 的）都做不了。
// 第 26 批起「小雨」「风暴」还影响从当地出发的陆路和渡轮（见 road 字段）；其余天气只是显示。
import type { SeasonId } from '../core/time.ts';

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
	{ id: 'hot', name: '炎热', icon: '🥵', desc: '东边吹来的热风，记得多喝水。' },
	{ id: 'rain', name: '小雨', icon: '🌦️', desc: '下下停停的阵雨，路上开慢点。', road: { mult: 1.1, trackMult: 1.3 } },
	{ id: 'storm', name: '风暴', icon: '⛈️', desc: '大风大浪：下海、浮潜、冲浪、出海都做不了，渡轮停航，土路封闭。', closesSea: true, road: { mult: 1.25, trackMult: 1, trackClosed: true } },
];

/** 各季节的天气权重（合计 100）。冬季是西澳的雨季，风暴最多 */
export const WEATHER_WEIGHTS: Record<SeasonId, [string, number][]> = {
	spring: [['sunny', 50], ['cloudy', 25], ['rain', 17], ['storm', 8]],
	summer: [['sunny', 58], ['cloudy', 18], ['hot', 18], ['rain', 3], ['storm', 3]],
	autumn: [['sunny', 45], ['cloudy', 30], ['rain', 15], ['storm', 10]],
	winter: [['sunny', 30], ['cloudy', 30], ['rain', 26], ['storm', 14]],
};
