// 物品：消耗品（use）、随身装备（passive，持有即生效，不叠加）、礼物（只为送人，第 34 批）。
// shop 决定在游戏里哪类地点能买到，规则与互动相同：kind 或 tag 任一命中。
// cat / stores / perish 见 docs/earth-game/shop-items.md；物品 id 不要改名（NPC 喜好、委托、存档都按 id 记）。
import type { ItemDef } from '../core/types.ts';

const TOWNS = ['city', 'port', 'town', 'coast', 'mining', 'island'] as const;

export const ITEMS: ItemDef[] = [
	{ id: 'water', name: '饮用水', icon: '💧', price: 3, max: 10, shop: { kinds: [...TOWNS] }, use: { needs: { hunger: 4, energy: 6 } }, cat: 'consumable', stores: ['convenience', 'supermarket'], desc: '内陆必备。' },
	{ id: 'snack', name: '能量棒', icon: '🍫', price: 6, max: 10, shop: { kinds: [...TOWNS] }, use: { needs: { hunger: 25 } }, cat: 'consumable', stores: ['convenience', 'supermarket'], desc: '路上垫一口。' },
	{ id: 'coffee', name: '外带咖啡', icon: '☕', price: 5, max: 3, shop: { kinds: ['city', 'port', 'town', 'coast'] }, use: { needs: { energy: 20 } }, cat: 'consumable', stores: ['cafe', 'convenience'], desc: '续命。' },
	{ id: 'vitamins', name: '复合维生素', icon: '💊', price: 18, max: 3, shop: { kinds: ['city', 'town', 'mining'], tags: ['hospital'] }, use: { moodlet: 'vitamins' }, cat: 'consumable', stores: ['pharmacy', 'supermarket'], desc: '吃一片，之后 3 天吃饱睡足时健康恢复翻倍（数值待平衡）。' },
	{ id: 'firstaid', name: '急救包', icon: '🩹', price: 35, max: 3, shop: { kinds: ['city', 'town', 'mining'], tags: ['hospital'] }, use: { health: 25 }, cat: 'consumable', stores: ['pharmacy', 'hardware'], desc: '处理擦伤和小伤。' },
	{ id: 'flynet', name: '防蝇网帽', icon: '🪰', price: 12, max: 1, shop: { kinds: ['town', 'mining', 'outback'] }, passive: { survival: 3 }, cat: 'gear', stores: ['outdoor'], desc: '内陆生存检定 +3。' },
	{ id: 'swag', name: '澳式睡袋', icon: '🛌', price: 120, max: 1, shop: { kinds: ['city', 'town', 'mining'] }, passive: { survival: 8 }, cat: 'gear', stores: ['outdoor'], desc: '露营专用，生存检定 +8。' },
	{ id: 'jerrycan', name: '备用油桶', icon: '⛽', price: 45, max: 1, shop: { kinds: ['city', 'town', 'mining'] }, passive: { driving: 5 }, cat: 'gear', stores: ['hardware', 'outdoor'], desc: '长途不慌，驾驶检定 +5。' },
	{ id: 'raincoat', name: '轻便雨衣', icon: '🧥', price: 25, max: 1, shop: { kinds: [...TOWNS] }, passive: { stamina: 4, survival: 3 }, weather: ['rain', 'storm'], cat: 'gear', stores: ['outdoor'], desc: '下雨和风暴天：体能检定 +4、生存检定 +3。' },
	{ id: 'umbrella', name: '折叠伞', icon: '☂️', price: 15, max: 1, shop: { kinds: ['city', 'port', 'town', 'coast'] }, passive: { charisma: 3 }, weather: ['rain'], cat: 'gear', stores: ['supermarket', 'convenience'], desc: '下雨天不至于淋成落汤鸡：魅力检定 +3。' },
	{ id: 'sunhat', name: '宽檐帽', icon: '👒', price: 18, max: 1, shop: { kinds: [...TOWNS, 'outback'] }, passive: { survival: 4 }, weather: ['hot', 'sunny'], cat: 'gear', stores: ['outdoor', 'surf'], desc: '晴天和炎热天：生存检定 +4。' },
	{ id: 'sunscreen', name: '防晒霜', icon: '🧴', price: 12, max: 1, shop: { kinds: [...TOWNS] }, passive: { stamina: 3, swimming: 2 }, weather: ['hot', 'sunny'], cat: 'gear', stores: ['pharmacy', 'supermarket'], desc: '晴天和炎热天：体能检定 +3、游泳检定 +2。' },
	{ id: 'drybag', name: '防水袋', icon: '🎒', price: 22, max: 1, shop: { tags: ['beach', 'reef'] }, passive: { swimming: 3 }, weather: ['rain', 'cloudy'], cat: 'gear', stores: ['surf', 'outdoor'], desc: '阴雨天下水也不怕东西湿：游泳检定 +3。' },
	{ id: 'electrolyte', name: '电解质冲剂', icon: '🥤', price: 4, max: 6, shop: { kinds: [...TOWNS, 'outback'] }, use: { needs: { energy: 12, hunger: 3 } }, cat: 'consumable', stores: ['pharmacy', 'supermarket'], desc: '热天出汗多，冲一包补回来。' },
	{ id: 'rod', name: '鱼竿', icon: '🎣', price: 40, max: 1, shop: { kinds: ['port', 'coast', 'town'], tags: ['beach'] }, passive: { survival: 2 }, cat: 'gear', stores: ['tackle'], desc: '带着它就能在海边、码头和河边钓鱼；等鱼上钩练耐心，生存检定 +2（数值待平衡）。' },
	{ id: 'ukulele', name: '尤克里里', icon: '🪕', price: 90, max: 1, shop: { kinds: ['city'], tags: ['market'] }, passive: { charisma: 2 }, cat: 'gear', stores: ['music'], desc: '小小四根弦，有了它就能练「乐器」爱好；会弹两首，魅力检定 +2（数值待平衡）。' },
	// 第 43 批：物资准备。停电时在家还能用炉头做饭（core/disasters.ts）；价格待平衡
	{ id: 'emergency-kit', name: '应急包', icon: '🔦', price: 60, max: 1, shop: { kinds: ['city', 'town', 'mining'] }, passive: { survival: 2 }, cat: 'gear', stores: ['hardware', 'outdoor'], desc: '手电、电池、收音机、卡式炉和几天的干粮：停电时在家也能做饭，生存检定 +2。' },
	{ id: 'surfboard', name: '冲浪板', icon: '🏄', price: 350, max: 1, shop: { tags: ['surf', 'beach'] }, passive: { swimming: 5, stamina: 3 }, cat: 'gear', stores: ['surf'], desc: '游泳检定 +5、体能检定 +3。' },
	// 第 34 批新增礼物（价格参照现实超市标价，来源见 shop-items.md；效果待平衡）
	{ id: 'biscuits', name: '巧克力夹心饼干', icon: '🍪', price: 6, max: 3, shop: { kinds: [...TOWNS] }, cat: 'gift', stores: ['supermarket', 'convenience'], use: { needs: { hunger: 12, fun: 4 } }, desc: '一盒拿得出手的伴手礼，自己吃也行。' },
	{ id: 'flowers', name: '一束鲜花', icon: '💐', price: 15, max: 1, shop: { kinds: ['city', 'town'] }, cat: 'gift', stores: ['florist', 'supermarket'], perish: true, desc: '只能送人。超市晚上 6 点后贴打折贴。' },
];
