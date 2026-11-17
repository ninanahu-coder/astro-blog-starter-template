// 家具：买给当前住处，每个槽位一件，换新时旧的半价折现；搬走或被收房时全部半价折现。
import type { FurnitureDef, FurnitureSetDef } from '../core/types.ts';

export const FURNITURE_SLOTS: Record<string, string> = { bed: '床', kitchen: '厨房', bath: '浴室', fun: '娱乐', decor: '装饰' };

export const FURNITURE: FurnitureDef[] = [
	{ id: 'mattress', slot: 'bed', name: '好床垫', price: 400, sleep: { health: 10, needs: { fun: 3 } }, desc: '回家睡觉多恢复 10 点健康。' },
	{ id: 'kingbed', slot: 'bed', name: '大床套装', price: 1200, comfort: 2, sleep: { health: 18, needs: { fun: 8 } }, desc: '睡得更好，住处心情 +2。' },
	{ id: 'cookset', slot: 'kitchen', name: '炊具套装', price: 250, unlock: 'cook', desc: '解锁「在家做饭」，一顿只要 $6。' },
	{ id: 'heater', slot: 'bath', name: '热水器', price: 300, sleep: { needs: { hygiene: 50 } }, desc: '回家睡觉后清洁直接回满。' },
	{ id: 'stereo', slot: 'fun', name: '音响', price: 500, unlock: 'relax', desc: '解锁「在家放松」，免费恢复娱乐。' },
	{ id: 'plants', slot: 'decor', name: '绿植和挂画', price: 150, comfort: 2, desc: '住处心情 +2。' },
	{ id: 'designer', slot: 'decor', name: '设计师软装', price: 900, comfort: 5, desc: '住处心情 +5。' },
	// 第 13 轮新增（价格、效果待平衡）
	{ id: 'espresso', slot: 'kitchen', name: '厨房和咖啡机', price: 650, comfort: 1, unlock: 'cook', desc: '能做饭，早上还有现磨咖啡，住处心情 +1。' },
	{ id: 'bathtub', slot: 'bath', name: '浴缸', price: 900, comfort: 1, sleep: { needs: { hygiene: 50, fun: 5 } }, desc: '泡个澡再睡，清洁回满、娱乐 +5，住处心情 +1。' },
	{ id: 'console', slot: 'fun', name: '游戏机和大电视', price: 600, comfort: 1, unlock: 'relax', desc: '解锁「在家放松」，住处心情 +1。' },
];

/** 成套家具：几件都摆在同一个住处时，住处心情再加一点（第 13 轮新增，加成待平衡） */
export const FURNITURE_SETS: FurnitureSetDef[] = [
	{ id: 'restful', name: '安睡套房', items: ['kingbed', 'bathtub'], comfort: 3, desc: '大床配浴缸，睡前泡个澡。' },
	{ id: 'host', name: '待客之家', items: ['espresso', 'console', 'designer'], comfort: 4, desc: '朋友来了有咖啡、有游戏，屋子也好看。' },
	{ id: 'full-house', name: '样样齐全', items: ['kingbed', 'espresso', 'bathtub', 'console', 'designer'], comfort: 3, desc: '五个位置都摆上最好的。' },
];

/** 家具折现比例 */
export const FURNITURE_RESALE = 0.5;
/** 在家做饭 / 放松的数值 */
export const HOME_COOK = { cost: 6, minutes: 40, hunger: 55 };
export const HOME_RELAX = { minutes: 90, fun: 32 };
