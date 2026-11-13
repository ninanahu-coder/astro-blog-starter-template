// 交通工具：在车行（tag 'dealer'）买卖；换车时旧车按回收价自动折抵。
// 转手必亏（resale < 1），不存在买卖套利。
import type { VehicleDef } from '../core/types.ts';

export const VEHICLES: VehicleDef[] = [
	{ id: 'motorbike', name: '摩托车', icon: '🏍️', price: 3000, resale: 0.55, speed: 95, trackSpeed: 0, costPerKm: 0.08, ride: { energy: -0.02 }, desc: '便宜又快，但长途骑行很累，走不了土路。' },
	{ id: 'car', name: '二手轿车', icon: '🚗', price: 4500, resale: 0.6, speed: 85, trackSpeed: 0, costPerKm: 0.15, desc: '可以自驾走公路。' },
	{ id: '4wd', name: '四驱越野', icon: '🚙', price: 12000, resale: 0.65, speed: 80, trackSpeed: 55, costPerKm: 0.2, desc: '越野土路必备。' },
	{
		id: 'campervan', name: '露营车', icon: '🚐', price: 28000, resale: 0.7, speed: 75, trackSpeed: 50, costPerKm: 0.28,
		sleep: { health: 8, needs: { energy: 85, hygiene: 25, fun: 3 } },
		desc: '能走土路，还能在车里睡觉，开到哪住到哪。',
	},
];

export const DEALER_TAG = 'dealer';
export const DEALER_HOURS: [number, number] = [9, 17];
