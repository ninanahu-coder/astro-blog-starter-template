// 物品：可消耗品（use）与随身装备（passive，持有即生效，不叠加）。
// shop 决定在哪类地点能买到，规则与互动相同：kind 或 tag 任一命中。
import type { ItemDef } from '../core/types.ts';

const TOWNS = ['city', 'port', 'town', 'coast', 'mining', 'island'] as const;

export const ITEMS: ItemDef[] = [
	{ id: 'water', name: '饮用水', icon: '💧', price: 3, max: 10, shop: { kinds: [...TOWNS] }, use: { needs: { hunger: 4, energy: 6 } }, desc: '内陆必备。' },
	{ id: 'snack', name: '能量棒', icon: '🍫', price: 6, max: 10, shop: { kinds: [...TOWNS] }, use: { needs: { hunger: 25 } }, desc: '路上垫一口。' },
	{ id: 'coffee', name: '外带咖啡', icon: '☕', price: 5, max: 3, shop: { kinds: ['city', 'port', 'town', 'coast'] }, use: { needs: { energy: 20 } }, desc: '续命。' },
	{ id: 'firstaid', name: '急救包', icon: '🩹', price: 35, max: 3, shop: { kinds: ['city', 'town', 'mining'], tags: ['hospital'] }, use: { health: 25 }, desc: '处理擦伤和小伤。' },
	{ id: 'flynet', name: '防蝇网帽', icon: '🪰', price: 12, max: 1, shop: { kinds: ['town', 'mining', 'outback'] }, passive: { survival: 3 }, desc: '内陆生存检定 +3。' },
	{ id: 'swag', name: '澳式睡袋', icon: '🛌', price: 120, max: 1, shop: { kinds: ['city', 'town', 'mining'] }, passive: { survival: 8 }, desc: '露营专用，生存检定 +8。' },
	{ id: 'jerrycan', name: '备用油桶', icon: '⛽', price: 45, max: 1, shop: { kinds: ['city', 'town', 'mining'] }, passive: { driving: 5 }, desc: '长途不慌，驾驶检定 +5。' },
	{ id: 'surfboard', name: '冲浪板', icon: '🏄', price: 350, max: 1, shop: { tags: ['surf', 'beach'] }, passive: { swimming: 5, stamina: 3 }, desc: '游泳检定 +5、体能检定 +3。' },
];
