// 家具：买给当前住处，每个槽位一件，换新时旧的半价折现；搬走或被收房时全部半价折现。
import type { FurnitureDef } from '../core/types.ts';

export const FURNITURE_SLOTS: Record<string, string> = { bed: '床', kitchen: '厨房', bath: '浴室', fun: '娱乐', decor: '装饰' };

export const FURNITURE: FurnitureDef[] = [
	{ id: 'mattress', slot: 'bed', name: '好床垫', price: 400, sleep: { health: 10, needs: { fun: 3 } }, desc: '回家睡觉多恢复 10 点健康。' },
	{ id: 'kingbed', slot: 'bed', name: '大床套装', price: 1200, comfort: 2, sleep: { health: 18, needs: { fun: 8 } }, desc: '睡得更好，住处心情 +2。' },
	{ id: 'cookset', slot: 'kitchen', name: '炊具套装', price: 250, unlock: 'cook', desc: '解锁「在家做饭」，一顿只要 $6。' },
	{ id: 'heater', slot: 'bath', name: '热水器', price: 300, sleep: { needs: { hygiene: 50 } }, desc: '回家睡觉后清洁直接回满。' },
	{ id: 'stereo', slot: 'fun', name: '音响', price: 500, unlock: 'relax', desc: '解锁「在家放松」，免费恢复娱乐。' },
	{ id: 'plants', slot: 'decor', name: '绿植和挂画', price: 150, comfort: 2, desc: '住处心情 +2。' },
	{ id: 'designer', slot: 'decor', name: '设计师软装', price: 900, comfort: 5, desc: '住处心情 +5。' },
];

/** 家具折现比例 */
export const FURNITURE_RESALE = 0.5;
/** 在家做饭 / 放松的数值 */
export const HOME_COOK = { cost: 6, minutes: 40, hunger: 55 };
export const HOME_RELAX = { minutes: 90, fun: 32 };
