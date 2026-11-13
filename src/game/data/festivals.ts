// 节日：每年固定日期在固定地点举行，持续 days 天。
// 节日期间当地开放专属体验（见 experiences.ts 里带 festival 字段的条目）。
import type { FestivalDef } from '../core/types.ts';

export const FESTIVALS: FestivalDef[] = [
	{ id: 'wildflower', name: '野花节', loc: 'kalbarri', season: 'spring', day: 10, days: 3, desc: '峡谷和海崖上铺满野花，镇上摆起花市。' },
	{ id: 'goldfields-cup', name: '金矿杯赛马周', loc: 'kalgoorlie', season: 'spring', day: 20, days: 3, desc: '全矿区的人都换上礼帽，挤进赛马场。' },
	{ id: 'skyshow', name: '天鹅河烟火夜', loc: 'perth', season: 'summer', day: 14, days: 2, desc: '半个城市的人坐在河岸等天黑。' },
	{ id: 'surf-pro', name: '冲浪大师赛', loc: 'margaret-river', season: 'autumn', day: 8, days: 4, desc: '世界各地的冲浪手来挑战主浪点。' },
	{ id: 'pearl-festival', name: '珍珠节', loc: 'broome', season: 'winter', day: 18, days: 4, desc: '灯笼游行、龙舟和夜市，纪念采珠人的历史。' },
];
