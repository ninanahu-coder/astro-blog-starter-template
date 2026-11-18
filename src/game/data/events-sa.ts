// 南澳的地点签名事件（第 44 轮；第 9 批审查后补上杰维斯角）：每个南澳地点一条，首次到访优先触发（once）。
// 写的都是真实存在的东西（阿德莱德中央市场、格莱内尔格有轨电车、汉多夫的德式面包、花岗岩岛的马拉电车、袋鼠岛的神奇岩石和海豹湾、
// 库伯佩迪的地下教堂和翻矿渣找欧泊、蓝湖、锡杜纳的生蚝……），细节按维基百科和政府旅游网站的公开资料。
// 选项的效果数值是 Claude 参照西澳同类签名事件的量级写的，【待平衡】：合并前请 Codex 在平衡分析里一起看。
import type { GameEvent } from '../core/types.ts';

export const SA_EVENTS: GameEvent[] = [
	{
		id: 'central-market', title: '中央市场的早上', icon: '🧺', locs: ['adelaide'], once: true, weight: 10,
		text: '阿德莱德中央市场开门不久，奶酪摊、面包摊和水果摊已经挤满了人，有个摊主在招呼你尝一口。',
		choices: [
			{ label: '一路尝过去', ok: { text: '吃了一圈，午饭都省了。', fx: { cash: -25, minutes: 60, needs: { hunger: 40, fun: 15 } } } },
			{ label: '帮摊主搬一上午货', check: { skill: 'strength', dc: 30 }, ok: { text: '摊主塞给你工钱和一袋卖剩的水果。', fx: { cash: 120, minutes: 180, needs: { energy: -15, hunger: 15 }, skills: { strength: 2 } } }, fail: { text: '一箱桃子摔在地上，摊主叹了口气，说下次吧。', fx: { minutes: 60, needs: { fun: -5 } } } },
		],
	},
	{
		id: 'glenelg-tram', title: '坐电车去海边', icon: '🚋', locs: ['glenelg'], once: true, weight: 10,
		text: '从城里坐有轨电车一路晃到终点，下车就是海滩和长长的码头。',
		choices: [
			{ label: '走到码头尽头看日落', ok: { text: '海风有点凉，天边一片橙红。', fx: { minutes: 60, needs: { fun: 30 }, moodlet: 'good-time' } } },
			{ label: '下海游一圈', check: { skill: 'swimming', dc: 25 }, ok: { text: '海水清爽，游完整个人都醒了。', fx: { minutes: 45, needs: { fun: 20, hygiene: 10 }, skills: { swimming: 2 } } }, fail: { text: '浪比看起来大，呛了两口水。', fx: { minutes: 30, health: -3 } } },
		],
	},
	{
		id: 'hahndorf-bakery', title: '德式面包房', icon: '🥨', locs: ['hahndorf'], once: true, weight: 10,
		text: '老街上一排十九世纪的石头房子，面包房门口飘出椒盐卷饼和烤香肠的味道。',
		choices: [
			{ label: '买一根香肠配卷饼', ok: { text: '店主说这配方是他曾祖父从德国带来的。', fx: { cash: -15, needs: { hunger: 35 }, moodlet: 'well-fed' } } },
			{ label: '去路德教堂坐一会儿', ok: { text: '教堂很安静，墙上挂着第一批移民的名字。', fx: { minutes: 40, needs: { fun: 10 }, respect: 1 } } },
		],
	},
	{
		id: 'barossa-vintage', title: '酒窖门口', icon: '🍇', locs: ['barossa'], once: true, weight: 10,
		text: '一家老酒庄的酒窖开着门，酿酒师说他们的老藤设拉子是一百多年前种下的。',
		choices: [
			{ label: '跟着品一轮', ok: { text: '你分不清哪杯更好，但每杯都有故事。', fx: { cash: -20, minutes: 60, needs: { fun: 25, social: 15 } } } },
			{ label: '帮着摘一下午葡萄', check: { skill: 'stamina', dc: 35 }, ok: { text: '腰都直不起来，但拿到了工钱和一瓶酒。', fx: { cash: 110, minutes: 240, needs: { energy: -25 }, skills: { stamina: 2 } } }, fail: { text: '剪了一个小时就被太阳晒蔫了。', fx: { minutes: 60, needs: { energy: -15 } } } },
		],
	},
	{
		id: 'mclaren-coast', title: '酒乡边上的海', icon: '🏖️', locs: ['mclaren-vale'], once: true, weight: 10,
		text: '葡萄园一直铺到坡下，再往前十分钟就是海边的悬崖和沙滩。',
		choices: [
			{ label: '骑车穿过葡萄园', check: { skill: 'stamina', dc: 25 }, ok: { text: '一路下坡，风里都是葡萄叶的味道。', fx: { minutes: 90, needs: { fun: 30, energy: -10 }, skills: { stamina: 2 } } }, fail: { text: '上坡推着车走了一半。', fx: { minutes: 90, needs: { energy: -20, fun: 5 } } } },
			{ label: '在海边坐着发呆', ok: { text: '什么也没干，心情好了不少。', fx: { minutes: 45, needs: { fun: 15 } } } },
		],
	},
	{
		id: 'horse-tram', title: '马拉电车', icon: '🐴', locs: ['victor-harbor'], once: true, weight: 10,
		text: '一匹大挽马拉着双层电车，沿着海堤慢慢走向花岗岩岛。',
		choices: [
			{ label: '坐上去', ok: { text: '车夫说这几匹挽马轮流上班，一天来回好几趟。', fx: { cash: -10, minutes: 40, needs: { fun: 25 } } } },
			{ label: '走海堤，顺便看有没有鲸鱼', check: { skill: 'survival', dc: 40 }, ok: { text: '远处一道水柱！是一头南露脊鲸。', fx: { minutes: 60, respect: 2, needs: { fun: 35 } } }, fail: { text: '只看到了海鸥。', fx: { minutes: 60, needs: { fun: 5 } } } },
		],
	},
	{
		id: 'heysen-start', title: '步道起点', icon: '🥾', locs: ['cape-jervis'], once: true, weight: 10,
		text: '渡轮码头旁边立着海森步道的起点牌子：往北一直走，约 1200 公里后到弗林德斯山脉。一艘渡轮正在靠岸。',
		choices: [
			{ label: '沿步道走一段海边悬崖', check: { skill: 'stamina', dc: 30 }, ok: { text: '走了一个多钟头，海峡对面的袋鼠岛看得清清楚楚。', fx: { minutes: 90, needs: { fun: 25, energy: -15 }, skills: { stamina: 2 } } }, fail: { text: '风太大，走了一小段就回来了。', fx: { minutes: 40, needs: { energy: -10 } } } },
			{ label: '在码头看渡轮进出', ok: { text: '车一辆辆开上船，船尾翻起白浪。', fx: { minutes: 30, needs: { fun: 10 } } } },
		],
	},
	{
		id: 'remarkable-rocks', title: '神奇岩石', icon: '🪨', animal: 'sea-lion', locs: ['kangaroo-island'], once: true, weight: 10,
		text: '海角上一堆被风雨掏空的巨大花岗岩，表面长着橙色的地衣；岛的另一头，海豹湾的沙滩上躺着一群海狮。',
		choices: [
			{ label: '跟着护林员下到海狮沙滩', ok: { text: '护林员让大家离海狮十米远，小海狮在妈妈身边打滚。', fx: { cash: -40, minutes: 90, respect: 2, needs: { fun: 40 } } } },
			{ label: '自己翻过栏杆凑近拍', ok: { text: '护林员把你叫了回来，记下了你的名字。', fx: { heat: 10, needs: { fun: 5 } } } },
		],
	},
	{
		id: 'tuna-port', title: '金枪鱼码头', icon: '🐟', locs: ['port-lincoln'], once: true, weight: 10,
		text: '码头上停满了金枪鱼船，有船在招人去海上的养殖网箱帮忙喂鱼。',
		choices: [
			{ label: '上船帮一天忙', check: { skill: 'strength', dc: 35 }, ok: { text: '一桶桶沙丁鱼倒进网箱，金枪鱼翻腾起来像开了锅。', fx: { cash: 150, minutes: 300, needs: { energy: -25, hygiene: -20 }, skills: { strength: 2 } } }, fail: { text: '晕船晕了一路，船长让你在码头下了。', fx: { minutes: 120, health: -3, needs: { fun: -10 } } } },
			{ label: '在码头吃一份炸鱼', ok: { text: '鱼是今天早上才上岸的。', fx: { cash: -18, needs: { hunger: 35 } } } },
		],
	},
	{
		id: 'opal-noodling', title: '翻矿渣找欧泊', icon: '💎', locs: ['coober-pedy'], once: true, weight: 10,
		text: '镇中心有一片允许游客翻找的矿渣堆，当地人管这叫「noodling」。旁边就是一座挖在地下的教堂。',
		choices: [
			{ label: '蹲下来翻', check: { skill: 'street', dc: 40 }, ok: { text: '一小片碎欧泊在阳光下闪出蓝绿色，收购店给了个价。', fx: { cash: 300, minutes: 120, needs: { fun: 20 }, skills: { street: 2 } } }, fail: { text: '翻了两小时，只翻出一手红土。', fx: { minutes: 120, needs: { hygiene: -15, fun: 5 } } } },
			{ label: '进地下教堂躲太阳', ok: { text: '地下常年二十几度，外面四十度。', fx: { minutes: 30, needs: { energy: 10 } } } },
		],
	},
	{
		id: 'wilpena-wallaby', title: '黄脚岩袋鼠', icon: '🦘', locs: ['flinders-ranges'], once: true, weight: 10,
		text: '威尔佩纳盆地的步道边，岩缝里蹲着一只尾巴一圈圈黄黑花纹的岩袋鼠。',
		choices: [
			{ label: '爬到盆地边上看全景', check: { skill: 'stamina', dc: 35 }, ok: { text: '一圈山脊围着一大片平地，像巨人留下的碗。', fx: { minutes: 180, respect: 2, needs: { fun: 40, energy: -20 }, skills: { stamina: 2 } } }, fail: { text: '爬到一半水喝完了，只好回头。', fx: { minutes: 120, needs: { energy: -25 }, health: -3 } } },
			{ label: '安静地拍几张就走', ok: { text: '它看了你一眼，跳回了岩缝。', fx: { minutes: 20, needs: { fun: 15 } } } },
		],
	},
	{
		id: 'blue-lake', title: '蓝湖', icon: '💧', locs: ['mount-gambier'], once: true, weight: 10,
		text: '火山口里的湖，水蓝得不像真的。路边的牌子说它每年秋天会变回灰色，夏天再变蓝。',
		choices: [
			{ label: '沿湖走一圈', ok: { text: '三公里多的步道，每个转角颜色都不太一样。', fx: { minutes: 60, needs: { fun: 25, energy: -5 } } } },
			{ label: '去看旁边的天坑花园', ok: { text: '塌下去的石灰岩坑里长满了花。', fx: { minutes: 40, needs: { fun: 20 } } } },
		],
	},
	{
		id: 'ceduna-oysters', title: '刚撬开的生蚝', icon: '🦪', locs: ['ceduna'], once: true, weight: 10,
		text: '码头边的小棚子在卖本地养的生蚝；墙上的地图画着往西 1200 公里的纳拉伯平原。',
		choices: [
			{ label: '来一打', ok: { text: '咸咸的海水味，挤点柠檬就够了。', fx: { cash: -22, needs: { hunger: 25, fun: 15 }, moodlet: 'fine-dining' } } },
			{ label: '跟刚横穿平原的司机聊聊', ok: { text: '他说一路上最长的直路有 146 公里，一个弯都没有。', fx: { minutes: 30, needs: { social: 25 } } } },
		],
	},
];
