// 商店类别与买卖规则（第 34 批，设计见 docs/earth-game/shop-items.md）。
// STORE_TYPES：现实里的店铺类别和 OpenStreetMap 标签的对应。目前只有超市、咖啡馆采集进了真实地点数据（wa/sa.venues.json），
// 其余类别要等 OpenClaw 按 osm 字段采集；写「待核」的标签要先查 OSM wiki 确认。
// SHOP_RULES：回收、打折贴的数值，全部待平衡。
import type { ItemCat, LocationKind, StoreTypeDef } from '../core/types.ts';

export const STORE_TYPES: StoreTypeDef[] = [
	{ id: 'convenience', name: '便利店 / 加油站', icon: '🏪', osm: 'shop=convenience；amenity=fuel', desc: '贵一点，但哪儿都有、开得晚。' },
	{ id: 'supermarket', name: '超市', icon: '🛒', osm: 'shop=supermarket', venue: 'supermarket', desc: '日用品最全最便宜，晚上生鲜贴打折贴。' },
	{ id: 'asian-grocer', name: '亚洲超市', icon: '🥢', osm: '无统一标签：shop=supermarket / convenience 中按名称筛（待核）', desc: '家乡口味、茶叶点心。第一版还没有对应物品。' },
	{ id: 'pharmacy', name: '药房', icon: '💊', osm: 'amenity=pharmacy；shop=chemist', desc: '急救、防晒、电解质。' },
	{ id: 'hardware', name: '五金店', icon: '🔧', osm: 'shop=hardware；shop=doityourself', desc: '工具、油桶、工地用的急救包。' },
	{ id: 'outdoor', name: '户外露营店', icon: '🏕️', osm: 'shop=outdoor', desc: '睡袋、雨衣、帽子、防蝇网。' },
	{ id: 'surf', name: '冲浪店', icon: '🏄', osm: 'shop=surf（待核）；shop=sports + sport=surfing（待核）', desc: '冲浪板、防水袋、帽子。' },
	{ id: 'tackle', name: '渔具店', icon: '🎣', osm: 'shop=fishing', desc: '鱼竿和饵料。' },
	{ id: 'florist', name: '花店', icon: '💐', osm: 'shop=florist', desc: '送人的花。超市也有一小架。' },
	{ id: 'cafe', name: '咖啡馆', icon: '☕', osm: 'amenity=cafe', venue: 'cafe', desc: '外带咖啡。' },
];

export const SHOP_RULES = {
	/** 卖回给二手店的比例（按物品标价，不吃特质折扣）。只收装备和收藏；消耗品和礼物不收。待平衡 */
	sellBack: { gear: 0.4, collectible: 0.4 } as Partial<Record<ItemCat, number>>,
	/** 哪类地点有二手店 / 寄卖店（待平衡） */
	sellKinds: ['city', 'town'] as LocationKind[],
	/** 卖一件花的游戏分钟 */
	sellMinutes: 10,
	/** 打折贴：易腐物品从 fromHour 点起到午夜按 mult 计价（待平衡；现实里没有固定时间，见文档） */
	markdown: { fromHour: 18, mult: 0.5 },
};
