// 第一阶段区域：西澳大利亚州（Western Australia）。
// 地点坐标为城镇/地标的近似经纬度；海岸线为手工简化多边形，仅用于示意地图。
// 更精细的 POI 由 OpenClaw 采集后写入 wa.pois.json（见 tools/earth/openclaw/）。
import type { GameLocation, Poi, Region, Route, Venue } from '../core/types.ts';
import pois from './wa.pois.json' with { type: 'json' };
import venues from './wa.venues.json' with { type: 'json' };

const L = (
	id: string,
	name: string,
	en: string,
	lat: number,
	lon: number,
	kind: GameLocation['kind'],
	tags: string[],
	radiusKm: number,
	blurb: string,
): GameLocation => ({ id, name, en, lat, lon, kind, tags, radiusKm, blurb });

const locations: GameLocation[] = [
	L('perth', '珀斯', 'Perth', -31.95, 115.86, 'city', ['airport', 'hospital', 'dealer', 'pub', 'gym', 'beach'], 25, '天鹅河畔的州府，世界上最孤独的大城市之一。'),
	L('fremantle', '弗里曼特尔', 'Fremantle', -32.056, 115.747, 'port', ['pub', 'market', 'beach'], 6, '老港口、周末市集和街头艺人。'),
	L('rottnest', '罗特尼斯岛', 'Rottnest Island', -32.0, 115.52, 'island', ['beach', 'reef'], 8, '没有汽车的小岛，短尾矮袋鼠的家。'),
	L('pinnacles', '尖峰石阵', 'The Pinnacles', -30.6, 115.16, 'park', ['desert'], 15, '黄沙里立着成千上万根石灰岩柱。'),
	L('bunbury', '班伯里', 'Bunbury', -33.33, 115.64, 'town', ['beach', 'pub'], 10, '西南海岸的港城，海湾里常有海豚。'),
	L('margaret-river', '玛格丽特河', 'Margaret River', -33.95, 115.07, 'coast', ['beach', 'wine', 'surf', 'pub'], 20, '葡萄酒庄与世界级浪点。'),
	L('albany', '奥尔巴尼', 'Albany', -35.02, 117.88, 'coast', ['beach', 'pub', 'whale', 'hospital'], 15, '南冰洋边的老捕鲸镇。'),
	L('esperance', '埃斯佩兰斯', 'Esperance', -33.86, 121.89, 'coast', ['beach'], 20, '白得晃眼的沙滩，袋鼠在海边晒太阳。'),
	L('wave-rock', '波浪岩', 'Wave Rock', -32.44, 118.9, 'outback', ['rock'], 8, '一道凝固在麦田带里的花岗岩巨浪。'),
	L('kalgoorlie', '卡尔古利', 'Kalgoorlie', -30.75, 121.47, 'mining', ['airport', 'pub', 'gold', 'hospital'], 15, '金矿之城，超级矿坑日夜不停。'),
	L('geraldton', '杰拉尔顿', 'Geraldton', -28.77, 114.61, 'town', ['beach', 'pub', 'airport', 'hospital'], 12, '龙虾渔港，风筝冲浪者的天堂。'),
	L('kalbarri', '卡尔巴里', 'Kalbarri', -27.71, 114.16, 'park', ['beach', 'gorge'], 20, '河流切出的红色峡谷与海崖。'),
	L('monkey-mia', '猴子米亚', 'Monkey Mia', -25.79, 113.72, 'coast', ['beach', 'dolphin'], 10, '鲨鱼湾里，野生海豚每天来岸边报到。'),
	L('exmouth', '埃克斯茅斯', 'Exmouth', -21.93, 114.13, 'coast', ['beach', 'reef', 'airport'], 25, '宁格鲁珊瑚礁的门户，与鲸鲨同游。'),
	L('karijini', '卡瑞吉尼', 'Karijini', -22.48, 118.4, 'park', ['gorge'], 40, '皮尔巴拉深处的红色峡谷与天然泳池。'),
	L('port-hedland', '黑德兰港', 'Port Hedland', -20.31, 118.6, 'mining', ['airport', 'pub', 'hospital'], 15, '铁矿石出海口，货轮与运矿列车。'),
	L('broome', '布鲁姆', 'Broome', -17.96, 122.24, 'coast', ['beach', 'airport', 'pearl', 'pub', 'hospital'], 20, '珍珠之乡，凯布尔海滩上的骆驼与落日。'),
	L('kununurra', '库努纳拉', 'Kununurra', -15.77, 128.74, 'outback', ['airport', 'gorge'], 25, '金伯利东端，通往邦格尔邦格尔山脉。'),
];

const R = (a: string, b: string, mode: Route['mode'] = 'road'): Route => ({ a, b, mode });

const routes: Route[] = [
	R('perth', 'fremantle'),
	R('fremantle', 'rottnest', 'ferry'),
	R('perth', 'pinnacles'),
	R('pinnacles', 'geraldton'),
	R('perth', 'bunbury'),
	R('fremantle', 'bunbury'),
	R('bunbury', 'margaret-river'),
	R('margaret-river', 'albany'),
	R('bunbury', 'albany'),
	R('albany', 'esperance'),
	R('perth', 'wave-rock'),
	R('wave-rock', 'esperance'),
	R('wave-rock', 'kalgoorlie'),
	R('perth', 'kalgoorlie'),
	R('kalgoorlie', 'esperance'),
	R('geraldton', 'kalbarri'),
	R('kalbarri', 'monkey-mia'),
	R('monkey-mia', 'exmouth'),
	R('exmouth', 'karijini', 'track'),
	R('karijini', 'port-hedland'),
	R('exmouth', 'port-hedland'),
	R('port-hedland', 'broome'),
	R('broome', 'kununurra', 'track'),
	R('perth', 'kalgoorlie', 'air'),
	R('perth', 'geraldton', 'air'),
	R('perth', 'exmouth', 'air'),
	R('perth', 'port-hedland', 'air'),
	R('perth', 'broome', 'air'),
	R('perth', 'kununurra', 'air'),
	R('broome', 'kununurra', 'air'),
];

export const WA: Region = {
	id: 'wa',
	name: '西澳大利亚',
	bounds: { minLon: 112.3, maxLon: 129.7, minLat: -35.6, maxLat: -13.4 },
	// [lon, lat]，自北领地边界北端起沿海岸逆时针
	outline: [
		[129.0, -14.9], [128.1, -14.8], [127.0, -13.9], [126.0, -14.1], [125.2, -14.6], [124.4, -15.5],
		[124.0, -16.3], [123.5, -17.3], [122.9, -16.4], [122.2, -18.0], [121.5, -19.0], [119.8, -20.0],
		[118.6, -20.3], [116.8, -20.6], [115.1, -21.6], [114.1, -21.8], [113.7, -22.6], [113.8, -23.1],
		[113.6, -24.9], [113.15, -26.15], [114.15, -27.7], [114.6, -28.8], [115.0, -30.3], [115.75, -31.95],
		[115.7, -32.5], [115.6, -33.3], [115.0, -33.55], [115.1, -34.37], [116.0, -34.85], [117.9, -35.1],
		[119.4, -34.4], [121.9, -33.87], [123.9, -33.6], [126.0, -32.3], [129.0, -31.7],
	],
	spawn: 'perth',
	hospital: 'perth',
	locations,
	routes,
	pois: (pois as { pois: Poi[] }).pois,
	venues: (venues as { venues: Venue[] }).venues,
};

export const REGIONS: Record<string, Region> = { wa: WA };
