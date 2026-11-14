// 各地点的常驻 NPC。
//   loc / hours：常驻地点和作息；schedule：按星期、季节、节日改变去处，按顺序取第一条满足的（见 engine.ts npcPlan）
//   gifts：送礼反应，最爱 / 喜欢 / 讨厌，没列出的物品算一般（送过一次玩家就会记住）
//   stories：好感度第一次达到 at 时的小剧情，各触发一次；60（好友）那段带主要回报
//   perk：好感度够了解锁的专属互动，每 every 个游戏日一次
// 星期：0 = 周一 … 6 = 周日
import type { NpcDef } from '../core/types.ts';

export const NPCS: NpcDef[] = [
	{
		id: 'mia', name: '米娅', role: '咖啡师', loc: 'perth', hours: [7, 17],
		bio: '在城里最忙的咖啡馆干了五年，谁都认识。',
		schedule: [
			{ festival: 'skyshow', loc: 'perth', hours: [15, 23], note: '烟火夜在河岸摆咖啡摊' },
			{ weekdays: [5], loc: 'rottnest', hours: [10, 16], note: '周六去罗特尼斯岛骑车' },
			{ weekdays: [6], loc: 'fremantle', hours: [9, 14], note: '周日在弗里曼特尔集市摆摊' },
		],
		gifts: { love: ['snack'], like: ['water'], dislike: ['coffee'] },
		stories: [
			{ at: 10, title: '记住你的口味', text: '米娅不用问就做好了你常点的那杯。' },
			{ at: 30, title: '打烊后的闲聊', text: '打烊后米娅留你喝了杯试新豆的咖啡，说她想开一家自己的小店。', fx: { moodlet: 'warm-moment' } },
			{ at: 60, title: '成了好友', text: '米娅把你推荐给了一位找帮手的老板，预付了一周工钱。', fx: { cash: 250, skills: { charisma: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '小店开张', text: '米娅的小店开张了，墙上的第一张照片里有你。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '米娅的早餐', desc: '米娅塞给你一个刚出炉的牛角包。', every: 1, fx: { minutes: 20, needs: { hunger: 25, energy: 10 }, moodlet: 'warm-moment' } },
	},
	{
		id: 'jack', name: '老杰克', role: '渔夫', loc: 'fremantle', hours: [5, 12],
		bio: '码头上补了四十年渔网，故事比鱼多。',
		schedule: [
			{ weekdays: [6], loc: 'fremantle', hours: [8, 13], note: '周日在集市卖鱼' },
			{ seasons: ['summer'], weekdays: [1, 3], loc: 'rottnest', hours: [5, 11], note: '夏天周二、周四去岛外海打鱼' },
		],
		gifts: { love: ['coffee'], like: ['snack', 'water'], dislike: ['surfboard'] },
		stories: [
			{ at: 10, title: '码头上的点头', text: '老杰克开始在你路过时点点头。' },
			{ at: 30, title: '那条大鱼', text: '老杰克第三次给你讲那条差点把船拖翻的大鱼，这次长了半米。', fx: { needs: { fun: 15 } } },
			{ at: 60, title: '成了好友', text: '老杰克把他年轻时的冲浪板送给了你。', fx: { items: { surfboard: 1 }, moodlet: 'new-friend' } },
			{ at: 90, title: '船的名字', text: '老杰克说他的船一直没有名字，问你愿不愿意给它起一个。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '跟船出海', desc: '跟老杰克出海收了一上午网，分到一条鱼。', every: 3, fx: { minutes: 180, needs: { fun: 25, hunger: 20, energy: -12 }, skills: { swimming: 1, survival: 1 } } },
	},
	{
		id: 'linda', name: '琳达', role: '护林员', loc: 'rottnest', hours: [8, 17],
		bio: '岛上每一只短尾矮袋鼠她都叫得出名字。',
		schedule: [
			{ weekdays: [0], loc: 'perth', hours: [9, 15], note: '周一回珀斯总部开会' },
		],
		gifts: { love: ['water'], like: ['flynet', 'firstaid'], dislike: ['snack'] },
		stories: [
			{ at: 10, title: '别喂袋鼠', text: '琳达第一次叫住你，是提醒你别喂短尾矮袋鼠。第二次是笑着打招呼。' },
			{ at: 30, title: '巡岛记录', text: '琳达让你帮忙记下今天看到的鸟，你的字被抄进了正式记录。', fx: { skills: { survival: 1 } } },
			{ at: 60, title: '成了好友', text: '琳达带你走了一条只有护林员知道的小路。', fx: { respect: 3, skills: { survival: 5 }, moodlet: 'new-friend' } },
			{ at: 90, title: '起名字', text: '新出生的小袋鼠用了你取的名字。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '护林员小路', desc: '琳达带你走了一段游客不知道的海岸。', every: 3, fx: { minutes: 120, needs: { fun: 20, energy: -10 }, skills: { survival: 1.5, stamina: 0.5 } } },
	},
	{
		id: 'leo', name: '里奥', role: '冲浪教练', loc: 'margaret-river', hours: [6, 18],
		bio: '浪好的日子从不接电话。',
		schedule: [
			{ festival: 'surf-pro', loc: 'margaret-river', hours: [5, 20], note: '大师赛期间整天泡在浪点' },
			{ seasons: ['winter'], weekdays: [0, 1], loc: 'bunbury', hours: [9, 17], note: '冬天周一、周二去班伯里上泳池课' },
		],
		gifts: { love: ['surfboard'], like: ['snack', 'coffee'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '看浪', text: '里奥教你怎么看一组浪什么时候来。' },
			{ at: 30, title: '摔得漂亮', text: '你在白浪里摔了十几次，里奥说其中有一次摔得很漂亮。', fx: { needs: { fun: 15 } } },
			{ at: 60, title: '成了好友', text: '里奥免费给你上了一整天私教课。', fx: { skills: { swimming: 5, stamina: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '秘密浪点', text: '里奥开车带你去了一个他从不告诉别人的浪点。', fx: { skills: { swimming: 3 }, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '私教冲浪课', desc: '里奥陪你在浪里泡了两个小时。', every: 3, fx: { minutes: 120, needs: { fun: 20, energy: -15 }, skills: { swimming: 1.5 } } },
	},
	{
		id: 'nan', name: '南希', role: '民宿老板娘', loc: 'esperance', hours: [7, 21],
		bio: '她的民宿永远有一壶热茶。',
		schedule: [
			{ weekdays: [2], loc: 'albany', hours: [10, 16], note: '周三去奥尔巴尼进货' },
		],
		gifts: { love: ['coffee'], like: ['firstaid', 'snack'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '一杯热茶', text: '南希不管你住不住店，都给你倒了杯热茶。' },
			{ at: 30, title: '老照片', text: '南希翻出相册，给你看民宿刚开时的样子。', fx: { needs: { social: 15 } } },
			{ at: 60, title: '成了好友', text: '南希让你免费住了一晚，还做了顿大餐。', fx: { health: 30, needs: { energy: 60, hunger: 60, social: 30 }, moodlet: 'new-friend' } },
			{ at: 90, title: '留给你的房间', text: '南希说二楼靠海那间以后就留给你，什么时候来都行。', fx: { moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '留你吃晚饭', desc: '南希多做了一份晚饭。', every: 2, fx: { minutes: 60, needs: { hunger: 50, social: 20 }, moodlet: 'well-fed' } },
	},
	{
		id: 'bill', name: '比尔', role: '矿工', loc: 'kalgoorlie', hours: [16, 23],
		bio: '下了班就在老酒吧的同一个位子上。',
		schedule: [
			{ festival: 'goldfields-cup', loc: 'kalgoorlie', hours: [10, 23], note: '赛马周整天在赛马场' },
			{ weekdays: [6], loc: 'kalgoorlie', hours: [12, 23], note: '周日中午就到酒吧了' },
		],
		gifts: { love: ['firstaid'], like: ['coffee', 'water'], dislike: ['surfboard'] },
		stories: [
			{ at: 10, title: '让个位子', text: '比尔把旁边的凳子往你这边推了推。' },
			{ at: 30, title: '矿上的规矩', text: '比尔讲了一晚上矿上的规矩，哪些钱能赚，哪些不能。', fx: { skills: { street: 1 } } },
			{ at: 60, title: '成了好友', text: '比尔给你在矿上找了个短工，还教你怎么省力。', fx: { cash: 400, skills: { strength: 4 }, moodlet: 'new-friend' } },
			{ at: 90, title: '父亲的矿灯', text: '比尔把他父亲留下的旧矿灯擦干净送给了你。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '老酒吧请客', desc: '比尔请你喝了一轮，整个酒吧都跟着起哄。', every: 2, fx: { minutes: 60, needs: { fun: 20, social: 20 } } },
	},
	{
		id: 'sam', name: '萨姆', role: '潜水向导', loc: 'exmouth', hours: [7, 16],
		bio: '和鲸鲨游泳的次数比和人吃饭还多。',
		schedule: [
			{ seasons: ['summer'], weekdays: [4, 5, 6], loc: 'monkey-mia', hours: [8, 15], note: '夏天周末去猴子米亚帮忙' },
		],
		gifts: { love: ['snack'], like: ['water', 'firstaid'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '潜水日志', text: '萨姆给你看了他的潜水日志，第一页写着十五岁。' },
			{ at: 30, title: '礁石上的规矩', text: '萨姆教你怎么在礁区游而不碰到珊瑚。', fx: { skills: { swimming: 1 } } },
			{ at: 60, title: '成了好友', text: '萨姆带你潜了一次游客去不了的礁区。', fx: { respect: 3, skills: { swimming: 6 }, moodlet: 'new-friend' } },
			{ at: 90, title: '同一片海', text: '萨姆在日志里写下你的名字，旁边画了一条鲸鲨。', fx: { moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '带你浮潜', desc: '萨姆带你在近岸礁区浮潜了两个小时。', every: 3, fx: { minutes: 120, needs: { fun: 25, energy: -10 }, skills: { swimming: 1.5 } } },
	},
	{
		id: 'dave', name: '戴夫', role: '长途卡车司机', loc: 'port-hedland', hours: [20, 6],
		bio: '夜里跑矿区公路，白天睡觉。',
		schedule: [
			{ weekdays: [4], loc: 'broome', hours: [20, 6], note: '周五夜里跑布鲁姆线' },
		],
		gifts: { love: ['coffee'], like: ['jerrycan', 'snack'], dislike: ['flynet'] },
		stories: [
			{ at: 10, title: '车灯', text: '戴夫开车经过时闪了两下车灯，算是打招呼。' },
			{ at: 30, title: '袋鼠时间', text: '戴夫告诉你黄昏和凌晨是袋鼠最爱上路的时候。', fx: { skills: { driving: 1 } } },
			{ at: 60, title: '成了好友', text: '戴夫把他的路书送给了你，哪里有坑哪里有袋鼠都写着。', fx: { skills: { driving: 6, survival: 2 }, moodlet: 'new-friend' } },
			{ at: 90, title: '电台频道', text: '戴夫把卡车司机们的电台频道告诉了你，说以后路上有事喊一声。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '讲路书', desc: '戴夫给你讲了一段新路况。', every: 3, fx: { minutes: 60, needs: { social: 10 }, skills: { driving: 1.5 } } },
	},
	{
		id: 'yuki', name: '由纪', role: '珍珠商', loc: 'broome', hours: [9, 18],
		bio: '一眼能分出真珠和塑料珠。',
		schedule: [
			{ festival: 'pearl-festival', loc: 'broome', hours: [9, 23], note: '珍珠节夜市开到很晚' },
			{ weekdays: [0], loc: 'broome', hours: [14, 18], note: '周一下午才开门' },
		],
		gifts: { love: ['coffee'], like: ['water'], dislike: ['jerrycan', 'swag'] },
		stories: [
			{ at: 10, title: '看珠子', text: '由纪让你摸了摸一颗真珍珠，说它比看上去凉。' },
			{ at: 30, title: '采珠人', text: '由纪讲起她祖父当年下海采珠的事。', fx: { needs: { social: 15 } } },
			{ at: 60, title: '成了好友', text: '由纪教了你鉴别珍珠的诀窍。', fx: { skills: { street: 5 }, cash: 150, moodlet: 'new-friend' } },
			{ at: 90, title: '祖父的珠子', text: '由纪把祖父留下的一颗小珍珠串成链子送给了你。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '珍珠鉴别课', desc: '由纪拿出一盘珠子让你挑真货。', every: 3, fx: { minutes: 60, needs: { fun: 10 }, skills: { street: 1, charisma: 0.5 } } },
	},
];
