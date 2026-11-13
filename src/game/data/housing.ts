// 住房：在城镇租房，按周自动扣租金；回家睡觉免费且恢复更多，住得越好心情加成越高。
import type { HomeDef } from '../core/types.ts';

export const HOMES: HomeDef[] = [
	{ id: 'room', name: '合租房间', rentWeek: 160, comfort: 0, where: { kinds: ['city', 'port', 'town', 'coast', 'mining'] }, desc: '一张床，共用厨房和浴室。' },
	{ id: 'flat', name: '一居室公寓', rentWeek: 320, comfort: 5, where: { kinds: ['city', 'port', 'town', 'coast'] }, desc: '自己的厨房和浴室，安静。' },
	{ id: 'beach', name: '海景小屋', rentWeek: 650, comfort: 10, where: { tags: ['beach'] }, desc: '推开门就是印度洋。' },
];
