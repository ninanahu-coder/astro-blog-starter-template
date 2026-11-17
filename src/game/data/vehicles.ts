// 交通工具：在车行（tag 'dealer'）买卖；换车时旧车按回收价自动折抵。
// 转手必亏（resale < 1），不存在买卖套利。
import type { Hours, VehicleDef, Where } from '../core/types.ts';

export const VEHICLES: VehicleDef[] = [
	{ id: 'motorbike', name: '摩托车', icon: '🏍️', price: 3000, resale: 0.55, speed: 95, trackSpeed: 0, costPerKm: 0.08, weekly: 15, service: 150, ride: { energy: -0.02 }, desc: '便宜又快，但长途骑行很累，走不了土路。' },
	{ id: 'car', name: '二手轿车', icon: '🚗', price: 4500, resale: 0.6, speed: 85, trackSpeed: 0, costPerKm: 0.15, weekly: 25, service: 220, desc: '可以自驾走公路。' },
	{ id: '4wd', name: '四驱越野', icon: '🚙', price: 12000, resale: 0.65, speed: 80, trackSpeed: 55, costPerKm: 0.2, weekly: 40, service: 320, desc: '越野土路必备。' },
	{
		id: 'campervan', name: '露营车', icon: '🚐', price: 28000, resale: 0.7, speed: 75, trackSpeed: 50, costPerKm: 0.28, weekly: 60, service: 450,
		sleep: { health: 8, needs: { energy: 85, hygiene: 25, fun: 3 } },
		desc: '能走土路，还能在车里睡觉，开到哪住到哪。',
	},
];

export const DEALER_TAG = 'dealer';
export const DEALER_HOURS: [number, number] = [9, 17];

/**
 * 车辆保养（第 15 轮新增，数值待平衡）：开自己的车出行累计里程；离上次保养超过 SERVICE_KM 后，
 * 每趟自驾抵达时有一定几率抛锚（几率随超出的里程上涨，有上限）。到修车厂保养后从零算起。
 */
export const SERVICE_KM = 5000;
export const BREAKDOWN = { base: 0.1, perKm: 1 / 20000, max: 0.5 };
export const GARAGE: { where: Where; hours: Hours; minutes: number } = { where: { kinds: ['city', 'port', 'town', 'mining'] }, hours: [8, 17], minutes: 120 };
