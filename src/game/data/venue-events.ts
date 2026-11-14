// 真实地点事件：玩家在现实中的餐馆、健身房、公园……做完一件事后，按地点类型抽一个（概率和间隔见 FIX_RULES）。
// venueTypes 对应 src/game/data/venues.ts 的 VENUE_TYPES；这些事件不会在到达城镇时出现。
// 数值刻意比城镇事件小：真实地点每天都能去，不能变成刷钱刷属性的地方。
import type { GameEvent } from '../core/types.ts';

export const VENUE_EVENTS: GameEvent[] = [
	// ---------- 餐馆 / 快餐 / 咖啡馆 ----------
	{
		id: 'v-regular-nod', title: '熟面孔', icon: '👋', venueTypes: ['cafe', 'restaurant', 'fast-food'], weight: 10,
		text: '店员抬头看了你一眼：“老样子？”',
		choices: [
			{ label: '笑着点头，顺便聊两句', check: { skill: 'charisma', dc: 25 }, ok: { text: '你们聊起周末的天气和球赛，走的时候店员冲你挥手。', fx: { needs: { social: 15 }, skills: { charisma: 1 }, moodlet: 'warm-moment' } }, fail: { text: '你一时想不起对方名字，只好尴尬地笑笑。', fx: { needs: { social: 5 } } } },
			{ label: '今天换个口味', ok: { text: '新口味意外地不错。', fx: { needs: { fun: 8 } } } },
		],
	},
	{
		id: 'v-wrong-order', title: '上错了单', icon: '🧾', venueTypes: ['cafe', 'restaurant', 'fast-food'], weight: 8,
		text: '端上来的不是你点的，邻桌那份才是。',
		choices: [
			{ label: '客气地说明一下', check: { skill: 'charisma', dc: 30 }, ok: { text: '店员连声道歉，送了你一份小点心。', fx: { needs: { hunger: 10, fun: 5 }, respect: 0.5 } }, fail: { text: '换回来花了点时间，好在没人不高兴。', fx: { minutes: 15 } } },
			{ label: '算了，就吃这份', ok: { text: '其实也挺好吃。', fx: { needs: { fun: 5 } } } },
			{ label: '跟邻桌换着尝尝', ok: { text: '邻桌是两个刚来珀斯的交换生，你们聊了半天。', fx: { minutes: 20, needs: { social: 20 }, moodlet: 'good-time' } } },
		],
	},
	{
		id: 'v-cafe-laptop', title: '借个插座', icon: '🔌', venueTypes: ['cafe'], weight: 8,
		text: '旁边的人电脑快没电了，插座在你脚边。',
		choices: [
			{ label: '挪一下让给对方', ok: { text: '对方是做活动策划的，塞给你一张名片。', fx: { needs: { social: 10 }, respect: 1 } } },
			{ label: '假装没看见', ok: { text: '你继续喝咖啡，心里有点别扭。', fx: { needs: { fun: -3 } } } },
		],
	},
	{
		id: 'v-food-challenge', title: '大胃王挑战', icon: '🍔', venueTypes: ['fast-food', 'restaurant'], weight: 5,
		text: '墙上贴着告示：二十分钟吃完超大份套餐，免单还上照片墙。',
		choices: [
			{ label: '接受挑战（$25）', cost: 25, check: { skill: 'stamina', dc: 45 }, ok: { text: '最后一口咽下去时全店鼓掌，钱退回来了，照片也挂上了墙。', fx: { cash: 25, needs: { hunger: 60, fun: 25 }, respect: 2, moodlet: 'good-time' } }, fail: { text: '吃到一半就投降了，撑得走不动。', fx: { needs: { hunger: 50, energy: -10 }, health: -2 } } },
			{ label: '看别人挑战就好', ok: { text: '一个大个子十五分钟就吃完了，你跟着鼓掌。', fx: { needs: { fun: 10 } } } },
		],
	},

	// ---------- 酒吧 ----------
	{
		id: 'v-pub-quiz', title: '酒吧问答夜', icon: '❓', venueTypes: ['pub'], weight: 10,
		text: '今晚是问答夜，一桌人缺一个队友，冲你招手。',
		choices: [
			{ label: '入队', check: { skill: 'street', dc: 35 }, ok: { text: '你答对了那道关于天鹅河的冷门题，你们队拿了第一，奖品是一张酒水券。', fx: { cash: 20, needs: { social: 30, fun: 20 }, moodlet: 'good-time' } }, fail: { text: '你们队倒数第二，但笑得最大声。', fx: { needs: { social: 25, fun: 10 } } } },
			{ label: '婉拒，坐吧台', ok: { text: '酒保跟你聊了会儿今天的球赛。', fx: { needs: { social: 8 } } } },
		],
	},
	{
		id: 'v-pub-shout', title: '轮到你请了', icon: '🍻', venueTypes: ['pub'], weight: 8,
		text: '刚认识的几个人按本地规矩轮流请客（shout），这一轮该你了。',
		choices: [
			{ label: '爽快请一轮（$30）', cost: 30, ok: { text: '大家举杯，你在这儿算是混熟了。', fx: { needs: { social: 30 }, respect: 1, skills: { charisma: 1 } } } },
			{ label: '说自己开车，只喝水', check: { skill: 'charisma', dc: 30 }, ok: { text: '大家表示理解，还夸你靠谱。', fx: { needs: { social: 10 } } } , fail: { text: '气氛冷了一下，没人再招呼你。', fx: { needs: { social: -5, fun: -5 } } } },
		],
	},

	// ---------- 健身房 / 体育中心 ----------
	{
		id: 'v-gym-spot', title: '帮忙保护', icon: '🏋️', venueTypes: ['gym', 'sports-centre'], weight: 10,
		text: '卧推架上的人举到最后一组，有点吃力，看向你。',
		choices: [
			{ label: '上去帮他保护', check: { skill: 'strength', dc: 30 }, ok: { text: '你稳稳托住杠铃，他道谢后教了你一个发力技巧。', fx: { skills: { strength: 1 }, needs: { social: 10 } } }, fail: { text: '你也托不太住，两个人一起把杠铃放回去，笑成一团。', fx: { needs: { social: 10, energy: -5 } } } },
			{ label: '去叫教练', ok: { text: '教练过来了，顺手纠正了你的深蹲姿势。', fx: { skills: { stamina: 0.5 } } } },
		],
	},
	{
		id: 'v-gym-trial', title: '私教体验课', icon: '📋', venueTypes: ['gym'], weight: 7,
		text: '前台在推私教课：今天体验价 $20，一对一一小时。',
		choices: [
			{ label: '上一节（$20）', cost: 20, ok: { text: '被练得腿软，但学到的动作很受用。', fx: { minutes: 60, needs: { energy: -15 }, skills: { strength: 1.5, stamina: 1 } } } },
			{ label: '不用了', ok: { text: '你自己练完，回家了。', fx: {} } },
		],
	},
	{
		id: 'v-pickup-game', title: '缺一个人', icon: '🏀', venueTypes: ['sports-centre', 'park'], weight: 8,
		text: '场边有一队人在凑人打球，正好缺一个。',
		choices: [
			{ label: '上场', check: { skill: 'stamina', dc: 35 }, ok: { text: '你投进了制胜一球，散场时被拉进了他们的群。', fx: { minutes: 45, needs: { social: 25, fun: 25, energy: -15 }, skills: { stamina: 1 }, moodlet: 'good-time' } }, fail: { text: '跑了二十分钟就喘不上气，下场当了裁判。', fx: { minutes: 30, needs: { social: 15, energy: -12 } } } },
			{ label: '在场边看', ok: { text: '比赛挺精彩。', fx: { needs: { fun: 8 } } } },
		],
	},

	// ---------- 游泳池 ----------
	{
		id: 'v-pool-lane', title: '快泳道', icon: '🏊', venueTypes: ['pool', 'sports-centre'], weight: 8,
		text: '慢泳道人满为患，快泳道空着一条。',
		choices: [
			{ label: '去快泳道试试', check: { skill: 'swimming', dc: 40 }, ok: { text: '你跟上了节奏，一口气游完一千米。', fx: { skills: { swimming: 1.5, stamina: 0.5 }, needs: { energy: -8 } } }, fail: { text: '后面的人一直踩着你的脚，你只好灰溜溜回慢泳道。', fx: { needs: { fun: -5, energy: -5 } } } },
			{ label: '在慢泳道排队', ok: { text: '慢慢游也不错。', fx: { needs: { fun: 5 } } } },
		],
	},
	{
		id: 'v-pool-lifeguard', title: '救生员的提醒', icon: '🛟', venueTypes: ['pool'], weight: 6,
		text: '救生员吹了声哨，指了指一个在深水区扑腾的小孩。',
		choices: [
			{ label: '离得近，先游过去扶一把', check: { skill: 'swimming', dc: 35 }, ok: { text: '你把孩子托到池边，家长连声道谢，救生员冲你竖拇指。', fx: { respect: 2, needs: { social: 10 }, moodlet: 'warm-moment' } }, fail: { text: '你游过去时救生员已经到了，你呛了口水。', fx: { health: -1 } } },
			{ label: '交给救生员', ok: { text: '救生员几下就把孩子带了上来。专业的事交给专业的人。', fx: {} } },
		],
	},

	// ---------- 公园 ----------
	{
		id: 'v-park-magpie', title: '喜鹊俯冲', icon: '🐦', venueTypes: ['park'], seasons: ['spring'], weight: 10,
		text: '春天是喜鹊的筑巢季，一只喜鹊从背后朝你俯冲过来。',
		choices: [
			{ label: '护住头快步走开', check: { skill: 'survival', dc: 25 }, ok: { text: '你学本地人那样绕开树下，安全通过。', fx: { skills: { survival: 1 } } }, fail: { text: '后脑勺被啄了一下，不疼，但挺丢人。', fx: { health: -1, needs: { fun: -5 } } } },
			{ label: '站着跟它对视', ok: { text: '它又冲了两次，你决定认输。', fx: { needs: { fun: -3 } } } },
		],
	},
	{
		id: 'v-park-dog', title: '跑丢的狗', icon: '🐕', venueTypes: ['park'], weight: 8,
		text: '一只拖着牵引绳的狗跑到你面前，项圈上有电话号码。',
		choices: [
			{ label: '牵住它，打电话给主人', ok: { text: '主人十分钟后跑来，硬塞给你一盒饼干。', fx: { minutes: 15, needs: { social: 15, hunger: 5 }, items: { snack: 1 }, moodlet: 'warm-moment' } } },
			{ label: '陪它在原地等', check: { skill: 'charisma', dc: 20 }, ok: { text: '它在你脚边趴下了。主人来时说它从不让陌生人碰。', fx: { minutes: 20, needs: { fun: 15, social: 10 } } }, fail: { text: '它闻了闻你，又跑走了。', fx: {} } },
		],
	},
	{
		id: 'v-park-bootcamp', title: '户外训练营', icon: '🤸', venueTypes: ['park'], weight: 7,
		text: '草地上有个免费的户外训练营，教练喊你一起来。',
		choices: [
			{ label: '加入', check: { skill: 'stamina', dc: 30 }, ok: { text: '四十分钟高强度间歇，跟下来了。', fx: { minutes: 40, needs: { energy: -18, social: 10 }, skills: { stamina: 1.5 } } }, fail: { text: '做到波比跳就趴下了，教练让你明天再来。', fx: { minutes: 25, needs: { energy: -15 }, skills: { stamina: 0.5 } } } },
			{ label: '在树荫下看', ok: { text: '看别人流汗也挺放松。', fx: { needs: { fun: 5 } } } },
		],
	},

	// ---------- 图书馆 ----------
	{
		id: 'v-library-group', title: '学习小组', icon: '📚', venueTypes: ['library'], weight: 10,
		text: '隔壁桌在复习驾照笔试，问你要不要一起刷题。',
		choices: [
			{ label: '一起刷', check: { skill: 'driving', dc: 20 }, ok: { text: '你答得比他们都快，还帮他们讲了环岛让行。', fx: { minutes: 45, skills: { driving: 1.5 }, needs: { social: 15 } } }, fail: { text: '你错得比他们还多，但总算记住了。', fx: { minutes: 45, skills: { driving: 1 }, needs: { social: 10 } } } },
			{ label: '戴上耳机继续看自己的', ok: { text: '安静又高效。', fx: { moodlet: 'focused' } } },
		],
	},
	{
		id: 'v-library-talk', title: '免费讲座', icon: '🎤', venueTypes: ['library'], weight: 7,
		text: '多功能厅在办讲座：在西澳找工作和租房的那些坑。',
		choices: [
			{ label: '进去听', ok: { text: '你记下了押金、合同和工资单的几条要点。', fx: { minutes: 60, skills: { street: 1.5 }, respect: 0.5 } } },
			{ label: '下次吧', ok: { text: '你拿了张传单。', fx: {} } },
		],
	},

	// ---------- 超市 ----------
	{
		id: 'v-market-markdown', title: '黄色打折贴', icon: '🏷️', venueTypes: ['supermarket'], weight: 10,
		text: '店员推着车在贴打折标签，今天到期的熟食半价。',
		choices: [
			{ label: '抢一份（$5）', cost: 5, check: { skill: 'street', dc: 20 }, ok: { text: '最后一份烤鸡归你了。', fx: { needs: { hunger: 40 }, moodlet: 'well-fed' } }, fail: { text: '慢了一步，只剩一盒沙拉。', fx: { needs: { hunger: 15 } } } },
			{ label: '不凑热闹', ok: { text: '你推着车走了。', fx: {} } },
		],
	},
	{
		id: 'v-market-sausage', title: '门口的香肠摊', icon: '🌭', venueTypes: ['supermarket'], weight: 8,
		text: '本地社区组织在门口摆香肠摊募捐，香肠夹面包 $3。',
		choices: [
			{ label: '买一个（$3）', cost: 3, ok: { text: '洋葱放得很足，志愿者说钱会捐给社区足球队。', fx: { needs: { hunger: 20, social: 5 }, respect: 0.5 } } },
			{ label: '帮忙翻一会儿香肠', check: { skill: 'charisma', dc: 25 }, ok: { text: '你招呼了半小时客人，志愿者们请你吃了两根。', fx: { minutes: 30, needs: { hunger: 30, social: 20 }, respect: 1 } }, fail: { text: '翻焦了几根，被客气地请到一边。', fx: { minutes: 15, needs: { social: 5 } } } },
		],
	},

	// ---------- 诊所 ----------
	{
		id: 'v-clinic-wait', title: '候诊室', icon: '🪑', venueTypes: ['clinic'], weight: 10,
		text: '候诊室里坐着一位老人，手里的表格填了半天。',
		choices: [
			{ label: '帮她填表', ok: { text: '她说孙子也在你这个年纪，临走塞给你一颗薄荷糖。', fx: { minutes: 15, needs: { social: 12 }, moodlet: 'warm-moment' } } },
			{ label: '刷手机等着', ok: { text: '叫到你的号了。', fx: {} } },
		],
	},
	{
		id: 'v-clinic-checkup', title: '顺便体检', icon: '🩺', venueTypes: ['clinic'], weight: 6,
		text: '医生问你要不要顺便做个基础体检，量血压、查一下体能。',
		choices: [
			{ label: '做一个', ok: { text: '各项都在正常范围，医生提醒你多睡觉。', fx: { minutes: 30, health: 5 } } },
			{ label: '改天吧', ok: { text: '医生点点头。', fx: {} } },
		],
	},
];
