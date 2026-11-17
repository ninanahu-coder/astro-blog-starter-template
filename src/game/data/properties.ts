// 可购买的房产：每套绑定一个地点，全服不限量但每人每套只能买一次。
// 价格约为真实房价的 1/5（西澳为准，南澳照搬西澳同档）。租金与物业费按 finance.ts 的收益上限（年化 ≤ 4%）设定，测试会检查。
import type { PropertyDef } from '../core/types.ts';

export const PROPERTIES: PropertyDef[] = [
	{ id: 'kal-cottage', name: '矿工小屋', loc: 'kalgoorlie', homeType: 'flat', price: 55000, weekly: 22, rentIncome: 82, desc: '铁皮屋顶的老矿工房，前廊能看到矿坑的灯。' },
	{ id: 'perth-apartment', name: '河景公寓', loc: 'perth', homeType: 'flat', price: 90000, weekly: 36, rentIncome: 135, desc: '市中心的一居室，阳台对着天鹅河。' },
	{ id: 'freo-terrace', name: '石灰岩联排', loc: 'fremantle', homeType: 'beach', price: 140000, weekly: 56, rentIncome: 210, desc: '老港口的百年联排，走路到海滩和市集。' },
	{ id: 'margaret-beach-house', name: '海边木屋', loc: 'margaret-river', homeType: 'beach', price: 220000, weekly: 88, rentIncome: 330, desc: '浪点后面的木屋，露台上能听到潮声。' },
	// 第 45 轮（南澳）：价格、物业费、租金照搬西澳同档的房子（阿德莱德 = 珀斯公寓，格莱内尔格 = 弗里曼特尔联排，库伯佩迪 = 卡尔古利小屋），待平衡
	{ id: 'adelaide-villa', name: '青石小屋', loc: 'adelaide', homeType: 'flat', price: 90000, weekly: 36, rentIncome: 135, desc: '阿德莱德老城区的青石平房，前廊有铸铁花边。' },
	{ id: 'glenelg-unit', name: '海滨公寓', loc: 'glenelg', homeType: 'beach', price: 140000, weekly: 56, rentIncome: 210, desc: '离码头和电车站都是几步路，傍晚能看海上日落。' },
	{ id: 'coober-dugout', name: '地下屋', loc: 'coober-pedy', homeType: 'dugout', price: 55000, weekly: 22, rentIncome: 82, desc: '老矿工凿出来的地下屋，有三个房间和一条通风井。' },
];
