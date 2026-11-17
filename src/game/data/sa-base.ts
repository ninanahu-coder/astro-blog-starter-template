// 第二个区域：南澳大利亚州（South Australia，第 42 轮）。
// 地点的坐标、类型、标签和简介由 OpenClaw 从 Wikidata / OpenStreetMap 采集（2026-11-18，原始结果见 tools/earth/openclaw/inbox/sa-locations-2026-11-18.json），
// Claude 按常识核对后修正了几条不存在的路线（袋鼠岛到格莱内尔格的公路、林肯港到维克多港的公路等）和几个标签。
// 海岸线是 Claude 按沿海城镇的大致坐标手工简化的多边形（种子数据，仅用于示意地图；OpenClaw 这次没取到可核验的行政边界）。
import type { GameLocation, Region, Route } from '../core/types.ts';

const L = (id: string, name: string, en: string, lat: number, lon: number, kind: GameLocation['kind'], tags: string[], radiusKm: number, blurb: string): GameLocation => ({ id, name, en, lat, lon, kind, tags, radiusKm, blurb });

const locations: GameLocation[] = [
	L('adelaide', '阿德莱德', 'Adelaide', -34.93, 138.6, 'city', ['airport', 'hospital', 'market', 'gym', 'pub'], 25, '南澳首府，城中心按棋盘格规划，四周一圈公园。'),
	L('glenelg', '格莱内尔格', 'Glenelg', -34.98, 138.51, 'coast', ['beach', 'market', 'pub'], 10, '阿德莱德的海滨区，沙滩、码头和有轨电车。'),
	L('hahndorf', '汉多夫', 'Hahndorf', -35.03, 138.81, 'town', ['pub', 'market'], 10, '阿德莱德山里的德国移民老镇。'),
	L('barossa', '巴罗萨谷', 'Barossa Valley', -34.52, 138.96, 'town', ['wine', 'market', 'pub'], 15, '以塔南达镇为中心的著名葡萄酒产区。'),
	L('mclaren-vale', '麦克拉伦谷', 'McLaren Vale', -35.22, 138.54, 'town', ['wine', 'beach'], 15, '阿德莱德以南的酒乡，离海滩不远。'),
	L('victor-harbor', '维克多港', 'Victor Harbor', -35.55, 138.62, 'coast', ['beach', 'whale', 'pub', 'market'], 15, '弗勒里厄半岛南岸的度假小城，花岗岩岛连着海堤。'),
	L('kangaroo-island', '袋鼠岛', 'Kangaroo Island', -35.65, 137.63, 'island', ['airport', 'beach', 'pub'], 20, '澳洲第三大岛，海狮、袋鼠和小企鹅的家。'),
	L('port-lincoln', '林肯港', 'Port Lincoln', -34.73, 135.86, 'port', ['airport', 'hospital', 'pub', 'beach', 'market'], 20, '艾尔半岛的渔港，金枪鱼之乡。'),
	L('coober-pedy', '库伯佩迪', 'Coober Pedy', -29.01, 134.75, 'mining', ['airport', 'hospital', 'pub', 'opal'], 8, '世界欧泊之都，很多人住在地下。'),
	L('flinders-ranges', '弗林德斯山脉', 'Flinders Ranges', -31.53, 138.6, 'park', ['gorge'], 30, '古老的褶皱山脉，威尔佩纳盆地像一座天然环形剧场。'),
	L('mount-gambier', '甘比尔山', 'Mount Gambier', -37.83, 140.78, 'city', ['airport', 'hospital', 'pub', 'market', 'gym'], 20, '建在休眠火山上的南澳第二大城，有会变色的蓝湖。'),
	L('ceduna', '锡杜纳', 'Ceduna', -32.13, 133.68, 'coast', ['airport', 'hospital', 'pub', 'beach'], 12, '从西澳横穿纳拉伯平原过来的第一个南澳小镇。'),
];

const R = (a: string, b: string, mode: Route['mode'] = 'road'): Route => ({ a, b, mode });
const routes: Route[] = [
	R('adelaide', 'glenelg'),
	R('adelaide', 'hahndorf'),
	R('adelaide', 'barossa'),
	R('adelaide', 'mclaren-vale'),
	R('hahndorf', 'mclaren-vale'),
	R('mclaren-vale', 'victor-harbor'),
	R('victor-harbor', 'kangaroo-island', 'ferry'),
	R('adelaide', 'kangaroo-island', 'air'),
	R('adelaide', 'port-lincoln'),
	R('adelaide', 'port-lincoln', 'air'),
	R('port-lincoln', 'ceduna'),
	R('adelaide', 'ceduna', 'air'),
	R('adelaide', 'coober-pedy'),
	R('adelaide', 'coober-pedy', 'air'),
	R('adelaide', 'flinders-ranges'),
	R('victor-harbor', 'mount-gambier'),
	R('adelaide', 'mount-gambier'),
	R('adelaide', 'mount-gambier', 'air'),
];

export const SA_BASE: Region = {
	id: 'sa',
	name: '南澳大利亚',
	bounds: { minLon: 128.8, maxLon: 141.3, minLat: -38.3, maxLat: -25.8 },
	// [lon, lat]：西北角起顺时针，北界、东界是直线，南边沿海岸往西（袋鼠岛是岛，不在轮廓里）
	outline: [
		[129.0, -26.0], [141.0, -26.0], [141.0, -38.06], [140.65, -38.05], [140.3, -37.85], [139.75, -37.16], [139.85, -36.83], [139.4, -36.2],
		[138.95, -35.56], [138.62, -35.57], [138.12, -35.63], [138.45, -35.15], [138.48, -35.0], [138.5, -34.85], [138.25, -34.45], [138.15, -34.18],
		[137.92, -34.42], [137.75, -35.08], [136.88, -35.3], [137.0, -34.9], [137.48, -34.5], [137.62, -33.93], [138.02, -33.18], [137.77, -32.49],
		[137.58, -33.03], [136.92, -33.68], [136.1, -34.37], [135.87, -34.73], [135.6, -34.95], [135.47, -34.6], [134.89, -33.65], [134.2, -32.8],
		[133.68, -32.13], [132.45, -31.98], [131.1, -31.5], [129.0, -31.69],
	],
	spawn: 'adelaide',
	hospital: 'adelaide',
	locations,
	routes,
	pois: [], // 打卡点之后由 OpenClaw 采集
	venues: [],
};
