// 真实地点的类型：玩家拿着手机真的走到某家餐馆、健身房、公园，就能在游戏里做对应的事。
// 具体地点由 OpenClaw 从 OpenStreetMap 采集进 wa.venues.json，这里只定义类型。
// 每种动作的计算公式在 core/formulas.ts，冷却时间和时长在下面的 VENUE_OPS。
import type { VenueOp, VenueTypeDef } from '../core/types.ts';

export const VENUE_TYPES: VenueTypeDef[] = [
	{ id: 'restaurant', name: '餐馆', icon: '🍽️', osm: 'amenity=restaurant', radiusM: 60, tier: 2, gigRate: 27, ops: ['meal', 'work'] },
	{ id: 'fast-food', name: '快餐店', icon: '🍔', osm: 'amenity=fast_food', radiusM: 60, tier: 1, gigRate: 25, ops: ['meal', 'work'] },
	{ id: 'cafe', name: '咖啡馆', icon: '☕', osm: 'amenity=cafe', radiusM: 50, tier: 1, gigRate: 26, ops: ['meal', 'work'] },
	{ id: 'pub', name: '酒吧', icon: '🍺', osm: 'amenity=pub|bar', radiusM: 60, tier: 2, gigRate: 28, ops: ['drink', 'work'] },
	{ id: 'gym', name: '健身房', icon: '🏋️', osm: 'leisure=fitness_centre', radiusM: 60, tier: 2, quality: 1, ops: ['train'] },
	{ id: 'sports-centre', name: '体育中心', icon: '🏟️', osm: 'leisure=sports_centre', radiusM: 120, tier: 2, quality: 0.8, ops: ['train', 'swim'] },
	{ id: 'pool', name: '游泳池', icon: '🏊', osm: 'leisure=swimming_pool + access=yes', radiusM: 80, tier: 1, ops: ['swim', 'work'] },
	{ id: 'park', name: '公园', icon: '🌳', osm: 'leisure=park', radiusM: 250, tier: 1, ops: ['run', 'relax'] },
	{ id: 'library', name: '图书馆', icon: '📚', osm: 'amenity=library', radiusM: 60, tier: 1, ops: ['study'] },
	{ id: 'supermarket', name: '超市', icon: '🛒', osm: 'shop=supermarket', radiusM: 80, tier: 1, gigRate: 25, ops: ['groceries', 'work'] },
	{ id: 'clinic', name: '诊所', icon: '🏥', osm: 'amenity=clinic|doctors|hospital', radiusM: 80, tier: 2, ops: ['heal'] },
];

export interface VenueOpDef {
	id: VenueOp;
	name: string;
	icon: string;
	minutes: number; // 游戏内花的时间（真实上班除外，按真实时长）
	cooldownMin: number; // 同一种动作两次之间至少隔多少真实分钟（在哪家店都算）
	desc: string;
}

export const VENUE_OPS: VenueOpDef[] = [
	{ id: 'meal', name: '吃一顿', icon: '🍴', minutes: 45, cooldownMin: 90, desc: '补饱食和体力，花钱看档次；吃撑了效果递减。' },
	{ id: 'train', name: '训练', icon: '🏋️', minutes: 90, cooldownMin: 120, desc: '消耗体力，涨力量、体能和魅力；心情和状态越好练得越有效。' },
	{ id: 'work', name: '打卡上班', icon: '💼', minutes: 0, cooldownMin: 0, desc: '人在店里打上班卡，离开前打下班卡，按真实时长计薪。' },
	{ id: 'run', name: '跑步', icon: '🏃', minutes: 45, cooldownMin: 90, desc: '消耗体力，涨体能。' },
	{ id: 'swim', name: '游泳', icon: '🏊', minutes: 60, cooldownMin: 90, desc: '消耗体力，涨游泳和体能，顺便洗个澡。' },
	{ id: 'relax', name: '坐一会儿', icon: '🧺', minutes: 60, cooldownMin: 60, desc: '恢复一点体力和娱乐。' },
	{ id: 'study', name: '自习', icon: '📖', minutes: 120, cooldownMin: 180, desc: '进入「专注」状态：之后几小时所有能力成长 +25%。' },
	{ id: 'drink', name: '喝一杯', icon: '🍻', minutes: 90, cooldownMin: 120, desc: '社交和娱乐大涨，练魅力，花钱。' },
	{ id: 'groceries', name: '采购', icon: '🧺', minutes: 30, cooldownMin: 240, desc: '买一周的干粮和水，比便利店便宜。' },
	{ id: 'heal', name: '看病', icon: '🩺', minutes: 60, cooldownMin: 240, desc: '恢复健康。' },
];

/** 真实定位的约束 */
export const FIX_RULES = {
	maxAccuracyM: 150, // 定位精度差于这个值不受理
	accuracySlackM: 50, // 判定距离时最多容忍的定位误差
	maxSpeedKmh: 200, // 两次定位之间推算的速度超过这个值视为定位异常（防“瞬移”）
	speedFreeKm: 2, // 两次定位相距不到这么远时不查速度（GPS 漂移）
	clockInMinMin: 15, // 上班至少待满这么多真实分钟才计薪
	shiftMaxMin: 480, // 一次上班最多计这么多分钟
	dayMaxMin: 600, // 每个现实日最多计薪这么多分钟
	clockInStaleMin: 16 * 60, // 上班卡超过这么久没打下班卡就作废
};
