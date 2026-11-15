// 天气：每个地点每个游戏日一种，按季节的权重抽取（core/weather.ts）。
// 目前只有「风暴」有玩法效果：海上的活动（下海游泳、浮潜、冲浪）当天取消。其余天气只是显示。
import type { SeasonId } from '../core/time.ts';

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
	{ id: 'hot', name: '炎热', icon: '🥵', desc: '东边吹来的热风，记得多喝水。' },
	{ id: 'rain', name: '小雨', icon: '🌦️', desc: '下下停停的阵雨。' },
	{ id: 'storm', name: '风暴', icon: '⛈️', desc: '大风大浪，海边的活动全部取消。', closesSea: true },
];

/** 各季节的天气权重（合计 100）。冬季是西澳的雨季，风暴最多 */
export const WEATHER_WEIGHTS: Record<SeasonId, [string, number][]> = {
	spring: [['sunny', 50], ['cloudy', 25], ['rain', 17], ['storm', 8]],
	summer: [['sunny', 58], ['cloudy', 18], ['hot', 18], ['rain', 3], ['storm', 3]],
	autumn: [['sunny', 45], ['cloudy', 30], ['rain', 15], ['storm', 10]],
	winter: [['sunny', 30], ['cloudy', 30], ['rain', 26], ['storm', 14]],
};
