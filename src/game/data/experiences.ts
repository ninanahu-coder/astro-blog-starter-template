// 收费体验：绑定地点，第一次体验进收藏册并加声望；重复只给心情。
// 集齐一个片区的全部体验获得称号。
import type { ExperienceDef } from '../core/types.ts';

export const AREAS: Record<string, { name: string; title: string }> = {
	perth: { name: '珀斯周边', title: '珀斯通' },
	southwest: { name: '西南海岸', title: '西南漫游者' },
	midwest: { name: '中西部', title: '珊瑚海岸旅人' },
	goldfields: { name: '金矿区', title: '淘金客' },
	north: { name: '西北与金伯利', title: '北方探险家' },
};

export const EXPERIENCES: ExperienceDef[] = [
	{ id: 'rottnest-cycle', name: '环岛骑行', loc: 'rottnest', area: 'perth', price: 60, minutes: 180, respect: 3, fx: { needs: { fun: 30, energy: -15 }, skills: { stamina: 1 } }, desc: '租一辆单车，绕岛一圈，见 20 个海湾。' },
	{ id: 'prison-night', name: '老监狱夜游', loc: 'fremantle', area: 'perth', price: 45, minutes: 90, respect: 3, hours: [18, 22], fx: { needs: { fun: 28, social: 8 } }, desc: '打着手电走过 19 世纪的牢房。' },
	{ id: 'swan-cruise', name: '天鹅河日落游船', loc: 'perth', area: 'perth', price: 80, minutes: 120, respect: 3, hours: [16, 20], fx: { needs: { fun: 30, social: 15 } }, desc: '看着城市天际线被夕阳点亮。' },
	{ id: 'margaret-dinner', name: '酒庄晚宴', loc: 'margaret-river', area: 'southwest', price: 180, minutes: 180, respect: 4, hours: [17, 22], fx: { needs: { fun: 40, social: 25, hunger: 60 } }, desc: '葡萄园里的长桌晚餐，七道菜配七款酒。' },
	{ id: 'albany-whales', name: '观鲸船', loc: 'albany', area: 'southwest', price: 110, minutes: 180, respect: 4, hours: [8, 15], fx: { needs: { fun: 38 } }, desc: '座头鲸在船边跃出水面。' },
	{ id: 'lucky-bay', name: '幸运湾四驱一日游', loc: 'esperance', area: 'southwest', price: 90, minutes: 300, respect: 4, hours: [8, 12], fx: { needs: { fun: 35, energy: -10 } }, desc: '开上白沙滩，和袋鼠一起晒太阳。' },
	{ id: 'pinnacles-stars', name: '尖峰石阵观星', loc: 'pinnacles', area: 'midwest', price: 70, minutes: 150, respect: 4, hours: [19, 24], fx: { needs: { fun: 35 } }, desc: '没有光污染的银河，石柱在星光下像一片森林。' },
	{ id: 'kalbarri-skywalk', name: '峡谷天空步道', loc: 'kalbarri', area: 'midwest', price: 20, minutes: 90, respect: 3, hours: [6, 18], fx: { needs: { fun: 25 } }, desc: '悬在百米峡谷上方的透明步道。' },
	{ id: 'monkey-mia-feed', name: '海豚喂食志愿者', loc: 'monkey-mia', area: 'midwest', price: 30, minutes: 120, respect: 4, hours: [7, 11], fx: { needs: { fun: 30, social: 10 } }, desc: '在护林员指导下给野生海豚喂鱼。' },
	{ id: 'super-pit-tour', name: '超级矿坑参观', loc: 'kalgoorlie', area: 'goldfields', price: 40, minutes: 120, respect: 3, hours: [9, 16], fx: { needs: { fun: 22 } }, desc: '坐巴士下到坑底，看 200 吨的矿车。' },
	{ id: 'wave-rock-dawn', name: '波浪岩日出', loc: 'wave-rock', area: 'goldfields', price: 15, minutes: 90, respect: 3, hours: [5, 8], fx: { needs: { fun: 28 } }, desc: '晨光一点点爬上花岗岩的浪尖。' },
	{ id: 'whale-shark-swim', name: '与鲸鲨同游', loc: 'exmouth', area: 'north', price: 400, minutes: 480, respect: 8, hours: [7, 10], fx: { needs: { fun: 55, energy: -25 }, skills: { swimming: 2 } }, desc: '宁格鲁礁外，和地球上最大的鱼并肩游。' },
	{ id: 'karijini-canyon', name: '峡谷探险', loc: 'karijini', area: 'north', price: 150, minutes: 360, respect: 6, hours: [7, 11], fx: { needs: { fun: 45, energy: -30 }, skills: { stamina: 2, survival: 1 } }, desc: '攀岩、溯溪、跳进天然泳池。' },
	{ id: 'broome-camels', name: '骆驼骑行看日落', loc: 'broome', area: 'north', price: 120, minutes: 90, respect: 4, hours: [16, 19], fx: { needs: { fun: 35 } }, desc: '凯布尔海滩上的经典驼队剪影。' },
	{ id: 'bungle-flight', name: '邦格尔邦格尔观光飞行', loc: 'kununurra', area: 'north', price: 550, minutes: 240, respect: 8, hours: [6, 14], fx: { needs: { fun: 55 } }, desc: '从空中看蜂巢一样的橙黑条纹圆顶。' },
];

/** 重复体验只给心情的比例 */
export const REPEAT_FUN_SHARE = 0.5;
