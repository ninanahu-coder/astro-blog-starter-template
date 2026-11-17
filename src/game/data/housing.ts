// 住房：在城镇租房，按周自动扣租金；回家睡觉免费且恢复更多，住得越好心情加成越高。
import type { HomeDef } from '../core/types.ts';

export const HOMES: HomeDef[] = [
	{ id: 'room', name: '合租房间', rentWeek: 160, comfort: 0, where: { kinds: ['city', 'port', 'town', 'coast', 'mining'] }, desc: '一张床，共用厨房和浴室。' },
	{ id: 'flat', name: '一居室公寓', rentWeek: 320, comfort: 5, where: { kinds: ['city', 'port', 'town', 'coast'] }, desc: '自己的厨房和浴室，安静。' },
	{ id: 'beach', name: '海景小屋', rentWeek: 650, comfort: 10, where: { tags: ['beach'] }, desc: '推开门就是印度洋。' },
	// 第 14 轮新增（租金、舒适度待平衡）
	{ id: 'campground', name: '房车营地', rentWeek: 90, comfort: 2, vehicleSleep: true, where: { kinds: ['coast', 'park', 'outback', 'town'] }, desc: '一块带电桩的车位，公共淋浴和烧烤台；人睡在自己车里。' },
	{ id: 'seaview', name: '海景公寓', rentWeek: 480, comfort: 7, where: { tags: ['beach'] }, desc: '高层阳台看海，楼下就是咖啡街。' },
];
