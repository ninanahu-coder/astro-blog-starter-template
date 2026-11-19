// 各地点的常驻 NPC。
//   loc / hours：常驻地点和作息；schedule：按星期、季节、节日、天气改变去处，按顺序取第一条满足的（见 core/npc-behavior.ts planFor）
//   休年假、病假优先于日程（data/npc-behavior.ts）
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
			{ weather: ['storm'], weatherAt: 'rottnest', weekdays: [5], loc: 'perth', hours: [9, 15], note: '岛上起风暴，渡轮停航，周六留在城里' },
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
			{ weather: ['storm'], loc: 'fremantle', hours: [9, 15], note: '风暴天不出海，在码头补网' },
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
		perk: { at: 60, exposed: 'sea', name: '跟船出海', desc: '跟老杰克出海收了一上午网，分到一条鱼。', every: 3, fx: { minutes: 180, needs: { fun: 25, hunger: 20, energy: -12 }, skills: { swimming: 1, survival: 1 } } },
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
			{ weather: ['storm'], loc: 'margaret-river', hours: [10, 15], note: '风暴天浪太乱不下水，在店里修板' },
			{ seasons: ['winter'], weekdays: [0, 1], loc: 'bunbury', hours: [9, 17], note: '冬天周一、周二去班伯里上泳池课' },
		],
		gifts: { love: ['surfboard'], like: ['snack', 'coffee'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '看浪', text: '里奥教你怎么看一组浪什么时候来。' },
			{ at: 30, title: '摔得漂亮', text: '你在白浪里摔了十几次，里奥说其中有一次摔得很漂亮。', fx: { needs: { fun: 15 } } },
			{ at: 60, title: '成了好友', text: '里奥免费给你上了一整天私教课。', fx: { skills: { swimming: 5, stamina: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '秘密浪点', text: '里奥开车带你去了一个他从不告诉别人的浪点。', fx: { skills: { swimming: 3 }, moodlet: 'best-friend' } },
		],
		perk: { at: 60, exposed: 'sea', name: '私教冲浪课', desc: '里奥陪你在浪里泡了两个小时。', every: 3, fx: { minutes: 120, needs: { fun: 20, energy: -15 }, skills: { swimming: 1.5 } } },
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
			{ weather: ['storm'], loc: 'exmouth', hours: [9, 13], note: '风暴天潜水船停航，在店里检查装备' },
			{ seasons: ['summer'], weekdays: [4, 5, 6], loc: 'monkey-mia', hours: [8, 15], note: '夏天周末去猴子米亚帮忙' },
		],
		gifts: { love: ['snack'], like: ['water', 'firstaid'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '潜水日志', text: '萨姆给你看了他的潜水日志，第一页写着十五岁。' },
			{ at: 30, title: '礁石上的规矩', text: '萨姆教你怎么在礁区游而不碰到珊瑚。', fx: { skills: { swimming: 1 } } },
			{ at: 60, title: '成了好友', text: '萨姆带你潜了一次游客去不了的礁区。', fx: { respect: 3, skills: { swimming: 6 }, moodlet: 'new-friend' } },
			{ at: 90, title: '同一片海', text: '萨姆在日志里写下你的名字，旁边画了一条鲸鲨。', fx: { moodlet: 'best-friend' } },
		],
		perk: { at: 60, exposed: 'sea', name: '带你浮潜', desc: '萨姆带你在近岸礁区浮潜了两个小时。', every: 3, fx: { minutes: 120, needs: { fun: 25, energy: -10 }, skills: { swimming: 1.5 } } },
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
	},	{
		id: 'tom', name: '汤姆', role: '龙虾船船长', loc: 'geraldton', hours: [5, 14],
		bio: '天不亮就出海，中午回港卸完货就去码头边的长椅上晒太阳。',
		schedule: [
			{ weather: ['storm'], loc: 'geraldton', hours: [9, 15], note: '风暴天不出海，在码头修船' },
			{ weekdays: [5, 6], loc: 'kalbarri', hours: [9, 16], note: '周末开船带游客看卡尔巴里的海崖' },
		],
		gifts: { love: ['coffee'], like: ['water', 'firstaid'], dislike: ['surfboard'] },
		stories: [
			{ at: 10, title: '码头上的招呼', text: '汤姆冲你扬了扬下巴：「新来的？风大的日子别靠近防波堤。」' },
			{ at: 30, title: '一筐龙虾', text: '汤姆从船上拎下一只最大的龙虾塞给你：「卖相不好的，自己吃。」', fx: { needs: { hunger: 40, social: 15 } } },
			{ at: 60, title: '成了好友', text: '汤姆带你出了一趟海，教你看风向、打绳结、收笼子。', fx: { skills: { survival: 4, swimming: 2 }, moodlet: 'new-friend' } },
			{ at: 90, title: '船舱里的名字', text: '汤姆在船舱的木板上刻下了你的名字，旁边是他父亲和他自己的。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, exposed: 'sea', name: '清晨收笼', desc: '跟汤姆天亮前出海收了一趟龙虾笼。', every: 3, fx: { minutes: 180, needs: { fun: 20, hunger: 15, energy: -15 }, skills: { survival: 1, strength: 1 } } },
	},	{
		id: 'harry', name: '哈利', role: '码头博物馆讲解员', loc: 'albany', hours: [9, 17],
		bio: '退休前是灯塔看守人，现在每天在博物馆给游客讲这座港口一百多年的故事。',
		schedule: [
			{ weekdays: [6], loc: 'albany', hours: [6, 9], note: '周日一早在海边的山头上看日出' },
		],
		gifts: { love: ['snack'], like: ['coffee', 'water'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '多问了一句', text: '你多问了一句展柜里的旧船票，哈利眼睛一亮，讲了半个钟头。' },
			{ at: 30, title: '灯塔的钥匙', text: '哈利给你看他留下来的那把灯塔钥匙，说起风暴夜里守灯的日子。', fx: { needs: { social: 15, fun: 10 } } },
			{ at: 60, title: '成了好友', text: '哈利带你去了游客不去的老炮台，教你怎么跟陌生人讲一个好故事。', fx: { respect: 3, skills: { charisma: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '留言簿', text: '哈利把博物馆留言簿翻到他写的那一页，最后一行写着你的名字。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '码头讲古', desc: '跟着哈利在码头走了一圈，听他讲这座港口的故事。', every: 3, fx: { minutes: 90, needs: { fun: 20, social: 20 }, skills: { charisma: 1 } } },
	},
	{
		id: 'ruby', name: '鲁比', role: '峡谷向导', loc: 'karijini', hours: [6, 16],
		bio: '在峡谷里长大，知道哪块石头雨后会滑。',
		schedule: [
			{ weather: ['storm'], loc: 'karijini', hours: [9, 13], note: '暴雨峡谷封闭，只在游客中心值半天班' },
			{ seasons: ['summer'], loc: 'port-hedland', hours: [9, 17], note: '夏天太热不带团，去黑德兰港的办公室排班' },
		],
		gifts: { love: ['water'], like: ['firstaid', 'flynet'], dislike: ['coffee'] },
		stories: [
			{ at: 10, title: '先看天', text: '鲁比拦下正要下谷的你：「先看天，再看脚下。」' },
			{ at: 30, title: '石头的颜色', text: '鲁比教你从岩壁的颜色认出哪层是几十亿年前的海底。', fx: { skills: { survival: 1 } } },
			{ at: 60, title: '成了好友', text: '鲁比带你走了一条只在旱季开放的谷底小路，路上一个游客都没有。', fx: { respect: 3, skills: { survival: 4, stamina: 2 }, moodlet: 'new-friend' } },
			{ at: 90, title: '营火边的故事', text: '鲁比在营火边讲起她外婆教她认星星的事，问你要不要一起守夜。', fx: { moodlet: 'best-friend' } },
		],
		perk: { at: 60, name: '谷底游泳', desc: '鲁比带你去了一个只有向导知道的水潭。', every: 3, fx: { minutes: 150, needs: { fun: 30, hygiene: 20, energy: -15 }, skills: { swimming: 1, survival: 0.5 } } },
	},
	{
		id: 'rosa', name: '罗莎', role: '海豚中心志愿者', loc: 'bunbury', hours: [8, 16],
		bio: '退休前是中学生物老师，现在每天在海边数海豚。',
		schedule: [
			{ weather: ['storm'], loc: 'bunbury', hours: [10, 14], note: '风暴天海豚中心只开半天' },
			{ weekdays: [6], loc: 'margaret-river', hours: [10, 15], note: '周日去玛格丽特河看外孙' },
		],
		gifts: { love: ['snack'], like: ['coffee', 'water'], dislike: ['jerrycan'] },
		stories: [
			{ at: 10, title: '背鳍上的缺口', text: '罗莎指给你看：那只背鳍上有缺口的海豚叫「小剪刀」。' },
			{ at: 30, title: '记录本', text: '罗莎让你帮忙在记录本上填今天看到的海豚，你认对了三只。', fx: { needs: { fun: 15 } } },
			{ at: 60, title: '成了好友', text: '罗莎把你推荐进了志愿者名单，中心发了你一件印着海豚的T恤和一张餐券。', fx: { cash: 120, respect: 3, moodlet: 'new-friend' } },
			{ at: 90, title: '给新生儿起名', text: '中心的新生小海豚要起名，罗莎投了你提的名字。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, exposed: 'sea', name: '浅滩观豚', desc: '罗莎带你站在齐腰深的水里，海豚从你身边游过。', every: 2, fx: { minutes: 90, needs: { fun: 30, social: 15 }, moodlet: 'warm-moment' } },
	},
	{
		id: 'mack', name: '麦克', role: '芒果农场主', loc: 'kununurra', hours: [5, 14],
		bio: '靠一条灌渠种出了半个镇子的芒果。',
		schedule: [
			{ weather: ['hot'], loc: 'kununurra', hours: [5, 10], note: '太热，只干早上凉快那会儿' },
			{ seasons: ['winter'], weekdays: [5], loc: 'broome', hours: [9, 16], note: '冬天周六去布鲁姆集市卖芒果' },
		],
		gifts: { love: ['coffee'], like: ['water', 'firstaid'], dislike: ['surfboard'] },
		stories: [
			{ at: 10, title: '先尝一个', text: '麦克从车斗里扔给你一个芒果：「先尝，再说买不买。」' },
			{ at: 30, title: '灌渠', text: '麦克开车带你看了那条把沙漠变成农田的灌渠。', fx: { skills: { driving: 1 } } },
			{ at: 60, title: '成了好友', text: '采收季缺人，麦克让你来帮了三天，工钱多给了一倍。', fx: { cash: 350, skills: { strength: 3, stamina: 2 }, moodlet: 'new-friend' } },
			{ at: 90, title: '你的那棵树', text: '麦克在果园边上种了一棵新树苗，木牌上写着你的名字。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '果园早饭', desc: '麦克在果园里请你吃了一顿芒果配煎蛋。', every: 2, fx: { minutes: 45, needs: { hunger: 40, social: 15 }, moodlet: 'well-fed' } },
	},
	// ---------- 南澳（第 44 轮）：原创人物。剧情和专属互动的效果数值照西澳 NPC 的同档写，【待平衡】 ----------
	{
		id: 'greta', name: '葛蕾塔', role: '酿酒师', loc: 'barossa', hours: [8, 17],
		bio: '家里第五代酿酒人，说话时总带着一股葡萄皮的味道。',
		schedule: [
			{ weekdays: [5], loc: 'hahndorf', hours: [10, 15], note: '周六去汉多夫的集市摆试饮摊' },
			{ seasons: ['autumn'], loc: 'barossa', hours: [5, 19], note: '秋天采收季从天亮忙到天黑' },
		],
		gifts: { love: ['snack'], like: ['water', 'sunhat'], dislike: ['electrolyte'] },
		stories: [
			{ at: 10, title: '先闻再喝', text: '葛蕾塔教你品酒前先晃一晃、闻一闻。' },
			{ at: 30, title: '老藤', text: '葛蕾塔带你看了她曾祖父种下的那排老葡萄藤。', fx: { needs: { fun: 15 }, moodlet: 'warm-moment' } },
			{ at: 60, title: '成了好友', text: '采收季缺人手，葛蕾塔请你来帮了几天，工钱给得很大方。', fx: { cash: 250, skills: { stamina: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '你的那一桶', text: '葛蕾塔在一只橡木桶上写了你的名字：「这桶酿好了第一瓶归你。」', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '酒窖午餐', desc: '葛蕾塔在酒窖里请你吃了奶酪、面包和一杯新酒。', every: 2, fx: { minutes: 45, needs: { hunger: 35, social: 15 }, moodlet: 'well-fed' } },
	},
	{
		id: 'kev', name: '凯文', role: '欧泊矿工', loc: 'coober-pedy', hours: [6, 14],
		bio: '在地下挖了二十年欧泊，家也住在地下。',
		schedule: [
			{ weekdays: [6], loc: 'coober-pedy', hours: [16, 21], note: '周日傍晚在地下酒吧打台球' },
		],
		gifts: { love: ['water'], like: ['sunhat', 'electrolyte'], dislike: ['umbrella'] },
		stories: [
			{ at: 10, title: '地下比地上凉', text: '凯文招手让你进他的地下房子凉快一会儿。' },
			{ at: 30, title: '一条矿脉', text: '凯文给你看他用手电照出来的一道彩色矿脉，说这辈子就为这个。', fx: { needs: { fun: 15 } } },
			{ at: 60, title: '成了好友', text: '凯文挖到一块好料，分了你一份卖的钱：「你上回帮我搬过石头。」', fx: { cash: 250, skills: { strength: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '矿坑的名字', text: '凯文把新挖的一条坑道用你的名字命了名。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '地下的凉快', desc: '大中午凯文让你在他的地下屋里歇一会儿。', every: 1, fx: { minutes: 40, needs: { energy: 15 }, moodlet: 'warm-moment' } },
	},
	{
		id: 'ayla', name: '艾拉', role: '护林员', loc: 'kangaroo-island', hours: [8, 17],
		bio: '在袋鼠岛的保护区工作，能叫出好几只海狮的名字。',
		schedule: [
			{ weather: ['storm'], weekdays: [6], loc: 'kangaroo-island', hours: [9, 15], note: '风暴天渡轮停航，周日留在岛上' },
			{ weekdays: [6], loc: 'victor-harbor', hours: [10, 16], note: '周日坐渡轮过海到杰维斯角，再开车去维克多港买东西' },
		],
		gifts: { love: ['coffee'], like: ['snack', 'raincoat'], dislike: ['rod'] },
		stories: [
			{ at: 10, title: '离远一点', text: '艾拉提醒你看野生动物要离十米远，语气很温和。' },
			{ at: 30, title: '那只小海狮', text: '艾拉指给你看一只去年救回来的小海狮，现在又胖又精神。', fx: { needs: { fun: 15 }, skills: { survival: 1 } } },
			{ at: 60, title: '成了好友', text: '保护区缺志愿者，艾拉推荐你去帮忙，还发了一笔补贴。', fx: { cash: 250, skills: { survival: 3 }, moodlet: 'new-friend' } },
			{ at: 90, title: '巡护记录', text: '艾拉在保护区的巡护记录里写上了你的名字。', fx: { respect: 3, moodlet: 'best-friend' } },
		],
		perk: { at: 30, name: '跟着巡一圈', desc: '艾拉带你在保护区里巡了一圈，讲了好多动物的事。', every: 2, fx: { minutes: 60, needs: { fun: 25 }, skills: { survival: 1 } } },
	},
];
