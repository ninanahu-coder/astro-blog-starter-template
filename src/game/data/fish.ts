// 钓鱼：带着鱼竿去海边、码头、河边，按地点、季节、时段、天气钓到不同的鱼，当场卖给鱼铺。
// 鱼种和分布按西澳常见的钓获写的常识，需 OpenClaw 核实；价格、几率待平衡。
import type { LocationKind } from '../core/types.ts';
import type { SeasonId } from '../core/time.ts';

export interface FishDef {
	id: string;
	name: string;
	icon: string;
	desc: string;
	where: { locs?: string[]; tags?: string[]; kinds?: LocationKind[] };
	seasons?: SeasonId[];
	periods?: ('dawn' | 'day' | 'dusk' | 'night')[];
	weather?: string[];
	weight: number; // 在能钓到的鱼里被抽中的权重（越大越常见）
	price: number; // 卖给鱼铺的价钱
}

/** 一次钓鱼：花的时间和体力；空手而归的权重随生存能力下降（待平衡） */
export const FISHING = { minutes: 90, needs: { energy: -8, fun: 12 }, emptyBase: 45, emptyMin: 15, emptyPerSkill: 0.4, rod: 'rod' };

export const FISH: FishDef[] = [
	{ id: 'herring', name: '澳洲鲱鱼', icon: '🐟', desc: '码头边最常见的小鱼，新手第一条多半是它。', where: { tags: ['beach'] }, weight: 30, price: 6 },
	{ id: 'mullet', name: '鲻鱼', icon: '🐟', desc: '成群在河口和港湾里游。', where: { kinds: ['port'], tags: ['beach'] }, weight: 20, price: 5 },
	{ id: 'whiting', name: '乔治王鳕', icon: '🐠', desc: '沙底浅滩上的白肉鱼，炸鱼薯条的上品。', where: { locs: ['fremantle', 'rottnest', 'bunbury', 'albany', 'esperance', 'busselton'] }, weight: 14, price: 20 },
	{ id: 'black-bream', name: '黑鲷', icon: '🐟', desc: '天鹅河里的老狐狸，清晨傍晚才肯咬钩。', where: { locs: ['perth', 'fremantle', 'bunbury', 'mandurah'] }, periods: ['dawn', 'dusk'], weight: 10, price: 18 },
	{ id: 'salmon', name: '澳洲鲑', icon: '🐟', desc: '秋天成群沿南岸洄游，拉起来很有劲。', where: { locs: ['albany', 'esperance', 'margaret-river', 'bunbury'] }, seasons: ['autumn'], weight: 16, price: 15 },
	{ id: 'squid', name: '南方枪乌贼', icon: '🦑', desc: '天黑后在码头灯下打转。', where: { locs: ['fremantle', 'rottnest', 'bunbury', 'albany'] }, periods: ['dusk', 'night'], weight: 12, price: 14 },
	{ id: 'blue-crab', name: '蓝花蟹', icon: '🦀', desc: '夏天浅水里一抓一个准，记得量尺寸。', where: { locs: ['perth', 'bunbury', 'fremantle', 'mandurah'] }, seasons: ['summer'], weight: 12, price: 12 },
	{ id: 'pink-snapper', name: '粉红鲷', icon: '🐡', desc: '鲨鱼湾和中西海岸的招牌鱼。', where: { locs: ['monkey-mia', 'geraldton', 'kalbarri'] }, weight: 8, price: 35 },
	{ id: 'dhufish', name: '西澳鲈', icon: '🐟', desc: '西澳钓客心中的头号目标，难得一见。', where: { locs: ['geraldton', 'kalbarri', 'fremantle'] }, weight: 3, price: 60 },
	{ id: 'trevally', name: '金鲹', icon: '🐠', desc: '北边暖水里成群冲刺。', where: { locs: ['exmouth', 'monkey-mia', 'broome', 'port-hedland', 'coral-bay'] }, weight: 12, price: 22 },
	{ id: 'mackerel', name: '西班牙马鲛', icon: '🐟', desc: '冬天北部海域的快鱼。', where: { locs: ['exmouth', 'broome', 'port-hedland'] }, seasons: ['winter', 'autumn'], weight: 8, price: 40 },
	{ id: 'barramundi', name: '尖吻鲈', icon: '🐟', desc: '北部河口和湖里的大家伙，下雨天更活跃。', where: { locs: ['kununurra', 'broome'] }, weather: ['rain', 'cloudy'], weight: 8, price: 45 },
];
