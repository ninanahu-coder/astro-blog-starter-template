// 各地点的常驻 NPC。只在自己的地点、营业/作息时间内出现。
// likes：送这些物品关系涨得多；bond：关系第一次达到「好友」时的一次性回报。
import type { NpcDef } from '../core/types.ts';

export const NPCS: NpcDef[] = [
	{ id: 'mia', name: '米娅', role: '咖啡师', loc: 'perth', hours: [7, 17], likes: ['snack'], bio: '在城里最忙的咖啡馆干了五年，谁都认识。', bond: { text: '米娅把你推荐给了一位找帮手的老板，预付了一周工钱。', fx: { cash: 250, skills: { charisma: 3 } } } },
	{ id: 'jack', name: '老杰克', role: '渔夫', loc: 'fremantle', hours: [5, 12], likes: ['snack', 'coffee'], bio: '码头上补了四十年渔网，故事比鱼多。', bond: { text: '老杰克把他年轻时的冲浪板送给了你。', fx: { items: { surfboard: 1 } } } },
	{ id: 'linda', name: '琳达', role: '护林员', loc: 'rottnest', hours: [8, 17], likes: ['water'], bio: '岛上每一只短尾矮袋鼠她都叫得出名字。', bond: { text: '琳达带你走了一条只有护林员知道的小路。', fx: { respect: 3, skills: { survival: 5 } } } },
	{ id: 'leo', name: '里奥', role: '冲浪教练', loc: 'margaret-river', hours: [6, 18], likes: ['snack', 'coffee'], bio: '浪好的日子从不接电话。', bond: { text: '里奥免费给你上了一整天私教课。', fx: { skills: { swimming: 5, stamina: 3 } } } },
	{ id: 'nan', name: '南希', role: '民宿老板娘', loc: 'esperance', hours: [7, 21], likes: ['coffee'], bio: '她的民宿永远有一壶热茶。', bond: { text: '南希让你免费住了一晚，还做了顿大餐。', fx: { health: 30, needs: { energy: 60, hunger: 60, social: 30 } } } },
	{ id: 'bill', name: '比尔', role: '矿工', loc: 'kalgoorlie', hours: [16, 23], likes: ['coffee', 'firstaid'], bio: '下了班就在老酒吧的同一个位子上。', bond: { text: '比尔给你在矿上找了个短工，还教你怎么省力。', fx: { cash: 400, skills: { strength: 4 } } } },
	{ id: 'sam', name: '萨姆', role: '潜水向导', loc: 'exmouth', hours: [7, 16], likes: ['snack'], bio: '和鲸鲨游泳的次数比和人吃饭还多。', bond: { text: '萨姆带你潜了一次游客去不了的礁区。', fx: { respect: 3, skills: { swimming: 6 } } } },
	{ id: 'dave', name: '戴夫', role: '长途卡车司机', loc: 'port-hedland', hours: [20, 6], likes: ['coffee', 'snack'], bio: '夜里跑矿区公路，白天睡觉。', bond: { text: '戴夫把他的路书送给了你，哪里有坑哪里有袋鼠都写着。', fx: { skills: { driving: 6, survival: 2 } } } },
	{ id: 'yuki', name: '由纪', role: '珍珠商', loc: 'broome', hours: [9, 18], likes: ['water', 'coffee'], bio: '一眼能分出真珠和塑料珠。', bond: { text: '由纪教了你鉴别珍珠的诀窍。', fx: { skills: { street: 5 }, cash: 150 } } },
];
