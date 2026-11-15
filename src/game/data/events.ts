// 到达地点触发的事件。once=true 的是地标“签名事件”，首次到访优先触发。
// 新增事件只需往数组里加一条；effects 全部走 engine.applyEffect，无需写逻辑代码。
import type { GameEvent } from '../core/types.ts';
import { VENUE_EVENTS } from './venue-events.ts';

export const EVENTS: GameEvent[] = [
	{
		id: 'quokka-selfie', title: '短尾矮袋鼠', icon: '🦘', locs: ['rottnest'], once: true, weight: 10,
		text: '一只短尾矮袋鼠蹦到你脚边，歪着头，嘴角像在笑。',
		choices: [
			{ label: '蹲下来耐心等一张合影', check: { skill: 'charisma', dc: 30 }, ok: { text: '它凑到镜头前，完美合影！朋友圈炸了。', fx: { respect: 3, needs: { fun: 30, social: 15 } } }, fail: { text: '它闻了闻你的鞋，转身走了。至少见到了。', fx: { needs: { fun: 12 } } } },
			{ label: '掏零食喂它', ok: { text: '护林员当场开了罚单——野生动物不能喂。', fx: { cash: -150, heat: 10 } } },
		],
	},
	{
		id: 'whale-shark', title: '鲸鲨', icon: '🦈', locs: ['exmouth'], once: true, weight: 10,
		text: '船长喊：“鲸鲨！右舷！”一条八米长的影子从船底滑过。',
		choices: [
			{ label: '跳下去同游（$200）', cost: 200, check: { skill: 'swimming', dc: 45 }, ok: { text: '你和地球上最大的鱼并肩游了十分钟。', fx: { respect: 5, needs: { fun: 50 }, skills: { swimming: 4 } } }, fail: { text: '浪太大，你呛了几口水被拉回船上。', fx: { health: -8, needs: { fun: 10 }, skills: { swimming: 2 } } } },
			{ label: '在甲板上看就好', ok: { text: '隔着水面也足够震撼。', fx: { needs: { fun: 20 } } } },
		],
	},
	{
		id: 'gold-nugget', title: '路边的闪光', icon: '🪙', locs: ['kalgoorlie'], once: true, weight: 10,
		text: '旧矿渣堆里有什么东西反了一下光。',
		choices: [
			{ label: '翻一翻', check: { skill: 'street', dc: 35 }, ok: { text: '一粒指甲盖大的天然金块！收购店给了个好价。', fx: { cash: 900, respect: 2, skills: { street: 3 } } }, fail: { text: '只是块黄铁矿——“愚人金”。', fx: { needs: { fun: 5 }, skills: { street: 1 } } } },
			{ label: '那是别人的矿权地，走开', ok: { text: '守规矩的人睡得踏实。', fx: { heat: -5 } } },
		],
	},
	{
		id: 'staircase-moon', title: '登月阶梯', icon: '🌕', locs: ['broome'], once: true, weight: 10,
		text: '满月从退潮的泥滩上升起，月光在水洼间铺成一道通往天上的台阶。',
		choices: [
			{ label: '坐下来看完', ok: { text: '全镇的人都安静了。', fx: { minutes: 60, respect: 2, needs: { fun: 40, social: 20 } } } },
			{ label: '趁人多去夜市摆摊', check: { skill: 'charisma', dc: 40 }, ok: { text: '生意出奇的好。', fx: { cash: 260, skills: { charisma: 3 } } }, fail: { text: '没人看你，都在看月亮。', fx: { needs: { fun: -5 } } } },
		],
	},
	{
		id: 'pinnacles-dusk', title: '石阵黄昏', icon: '🌅', locs: ['pinnacles'], once: true, weight: 10,
		text: '太阳落到石柱后面，几千根影子在黄沙上一起拉长。一只鸸鹋站在不远处盯着你。',
		choices: [
			{ label: '留下来等星星出来', check: { skill: 'survival', dc: 35 }, ok: { text: '没有一点光污染，银河从地平线一直铺到头顶。', fx: { minutes: 120, respect: 3, needs: { fun: 40, energy: -10 }, skills: { survival: 2 } } }, fail: { text: '天一黑就找不到回停车场的路，绕了半天才出来。', fx: { minutes: 150, needs: { fun: 15, energy: -20 }, skills: { survival: 1 } } } },
			{ label: '拍完照就走', ok: { text: '照片里的石柱像一片外星城市。', fx: { needs: { fun: 20 } } } },
		],
	},
	{
		id: 'lucky-bay-roos', title: '白沙滩上的袋鼠', icon: '🦘', locs: ['esperance'], once: true, weight: 10,
		text: '海水是透明的蓝，沙子白得晃眼，几只袋鼠正懒洋洋地躺在沙滩上晒太阳。',
		choices: [
			{ label: '在旁边下海游一圈', check: { skill: 'swimming', dc: 30 }, ok: { text: '冰凉的海水，回头就能看见袋鼠在岸上发呆。', fx: { respect: 3, needs: { fun: 40, hygiene: 15, energy: -10 }, skills: { swimming: 2 } } }, fail: { text: '南大洋的水比想象中冷得多，你哆嗦着跑回岸上。', fx: { health: -3, needs: { fun: 15 }, skills: { swimming: 1 } } } },
			{ label: '远远地看着就好', ok: { text: '袋鼠翻了个身，继续晒。', fx: { needs: { fun: 25 } } } },
		],
	},
	{
		id: 'albany-whales', title: '海湾里的鲸', icon: '🐋', locs: ['albany'], once: true, weight: 10,
		text: '码头上有人指着海湾大喊：一对座头鲸母子正从港口外经过，喷出的水雾在阳光里闪。',
		choices: [
			{ label: '跳上最后一班观鲸船（$60）', cost: 60, ok: { text: '小鲸跃出水面的那一刻，整船人都叫了起来。', fx: { minutes: 150, respect: 4, needs: { fun: 50, social: 15 } } } },
			{ label: '在岸边的山头上看', check: { skill: 'stamina', dc: 30 }, ok: { text: '爬到山顶正好赶上它们转身，看得清清楚楚。', fx: { minutes: 60, respect: 2, needs: { fun: 30, energy: -10 }, skills: { stamina: 1.5 } } }, fail: { text: '爬到一半就喘不过气，只看到远处的水花。', fx: { minutes: 60, needs: { fun: 10, energy: -15 }, skills: { stamina: 1 } } } },
		],
	},
	{
		id: 'natures-window', title: '自然之窗', icon: '🪟', locs: ['kalbarri'], once: true, weight: 10,
		text: '红色砂岩被风蚀出一个天然的窗洞，窗外是弯弯曲曲的默奇森河峡谷。清晨的光正好从洞里斜照进来。',
		choices: [
			{ label: '沿着峡谷边的步道走一圈', check: { skill: 'stamina', dc: 35 }, ok: { text: '走完一圈，太阳刚好升到峡谷上方，整条河都亮了。', fx: { minutes: 120, respect: 3, needs: { fun: 35, energy: -15 }, skills: { stamina: 2 } } }, fail: { text: '太阳一出来就热得受不了，走了一半就折回来了。', fx: { minutes: 90, needs: { fun: 10, energy: -20 }, skills: { stamina: 1 } } } },
			{ label: '坐在窗洞里拍张照', ok: { text: '经典的窗框构图，背后是两百米深的峡谷。', fx: { needs: { fun: 20, social: 5 } } } },
		],
	},
	{
		id: 'spider-walk', title: '蜘蛛步', icon: '🕷️', locs: ['karijini'], once: true, weight: 10,
		text: '峡谷窄到两边岩壁只隔一臂宽，下面是流水。要往前走，只能像蜘蛛一样两手两脚撑着两边的石壁。',
		choices: [
			{ label: '撑着岩壁过去', check: { skill: 'strength', dc: 40 }, ok: { text: '过了最窄的那段，眼前豁然开朗：一汪碧绿的水潭。', fx: { minutes: 90, respect: 4, needs: { fun: 40, energy: -20 }, skills: { strength: 2, survival: 1 } } }, fail: { text: '脚一滑掉进了水里，好在不深，只是浑身湿透。', fx: { minutes: 60, health: -4, needs: { fun: 15, hygiene: 10 }, skills: { strength: 1 } } } },
			{ label: '在入口看别人过', ok: { text: '有人卡在中间进退两难，你决定下次再来。', fx: { needs: { fun: 12 } } } },
		],
	},
	{
		id: 'beehive-domes', title: '蜂巢山', icon: '🐝', locs: ['kununurra'], once: true, weight: 10,
		text: '一架小飞机愿意带你飞过邦格尔邦格尔山脉：橙黑相间的圆顶石丘，像一片巨大的蜂巢。',
		choices: [
			{ label: '上飞机看看（$180）', cost: 180, ok: { text: '从空中看下去，几万个圆顶一直排到地平线。', fx: { minutes: 120, respect: 5, needs: { fun: 50 } } } },
			{ label: '跟车队开进山脚下走走', check: { skill: 'driving', dc: 40 }, ok: { text: '土路颠了三个小时，但站在圆顶中间抬头看，一点也不后悔。', fx: { minutes: 240, respect: 3, needs: { fun: 35, energy: -20 }, skills: { driving: 2, survival: 1 } } }, fail: { text: '车陷在沙里，等了两个小时才有人路过帮你拖出来。', fx: { minutes: 180, needs: { fun: -5, energy: -25 }, skills: { driving: 1 } } } },
		],
	},
	{
		id: 'wave-rock-top', title: '浪尖上', icon: '🌊', locs: ['wave-rock'], once: true, weight: 10,
		text: '十五米高的花岗岩像一道凝固的巨浪。顶上有人朝你挥手，说上面的风景更好。',
		choices: [
			{ label: '沿着石坡爬上去', check: { skill: 'stamina', dc: 35 }, ok: { text: '站在浪尖上，四周的麦田一直铺到天边。', fx: { minutes: 60, respect: 3, needs: { fun: 35, energy: -15 }, skills: { stamina: 2 } } }, fail: { text: '石坡比看起来陡，你在半路坐下来歇了很久。', fx: { minutes: 60, needs: { fun: 10, energy: -20 }, skills: { stamina: 1 } } } },
			{ label: '在浪底下摆个冲浪的姿势拍照', ok: { text: '经典游客照，到此一游。', fx: { needs: { fun: 20, social: 5 } } } },
		],
	},
	{
		id: 'dolphin-visit', title: '海豚来了', icon: '🐬', tags: ['dolphin'], once: true, weight: 10,
		text: '清晨的浅滩，三只野生宽吻海豚游到了你膝盖边。',
		choices: [{ label: '站着别动', ok: { text: '其中一只侧过身，看了你一眼。', fx: { respect: 2, needs: { fun: 35 } } } }],
	},
	{
		id: 'super-pit-blast', title: '矿坑爆破', icon: '💥', tags: ['gold'], weight: 3,
		text: '观景台上响起警报——超级矿坑要爆破了。',
		choices: [{ label: '看', ok: { text: '地面抖了一下，半面坑壁滑了下去。', fx: { needs: { fun: 18 } } } }],
	},
	{
		id: 'flat-tyre', title: '爆胎', icon: '🛞', arrivedBy: ['road', 'track'], kinds: ['outback', 'park', 'mining'], weight: 4,
		text: '快到的时候“砰”的一声，车子往一边歪。',
		choices: [
			{ label: '自己换备胎', check: { skill: 'strength', dc: 40 }, ok: { text: '二十分钟搞定，手上全是红土。', fx: { minutes: 20, needs: { hygiene: -10 }, skills: { strength: 2, survival: 1 } } }, fail: { text: '千斤顶打滑，折腾了两小时。', fx: { minutes: 120, needs: { energy: -15, hygiene: -15 }, skills: { strength: 1 } } } },
			{ label: '叫道路救援', cost: 220, ok: { text: '救援三小时后才到，账单也不便宜。', fx: { minutes: 180 } } },
		],
	},
	{
		id: 'roo-dusk', title: '黄昏的袋鼠', icon: '🌅', arrivedBy: ['road', 'track'], weight: 3,
		text: '夕阳正对着挡风玻璃，一只袋鼠突然跳上公路。',
		choices: [
			{ label: '稳住方向，点刹', check: { skill: 'driving', dc: 35 }, ok: { text: '它从车头前一跃而过。', fx: { skills: { driving: 2 } } }, fail: { text: '擦到了保险杠，人没事，车要修。', fx: { cash: -300, health: -5, skills: { driving: 1 } } } },
		],
	},
	{
		id: 'rbt', title: '路边临检', icon: '🚓', arrivedBy: ['road'], weight: 3,
		text: '警察挥手让你靠边：随机呼气酒精测试。',
		choices: [
			{ label: '配合检查', ok: { text: '“祝您旅途愉快。”', fx: { heat: -10 } } },
			{ label: '找借口搪塞', check: { skill: 'street', dc: 55 }, ok: { text: '他们摆摆手放你走了。', fx: { skills: { street: 2 } } }, fail: { text: '越描越黑，被开了罚单。', fx: { cash: -250, heat: 20 } } },
		],
	},
	{
		id: 'hitchhiker', title: '搭车客', icon: '👍', arrivedBy: ['road', 'track'], weight: 3,
		text: '进镇前的路口，一个背包客竖着大拇指。',
		choices: [
			{ label: '捎一段', ok: { text: '一路聊得很开心，她请你吃了派。', fx: { needs: { social: 30, hunger: 20 }, skills: { charisma: 1 } } } },
			{ label: '不停车', ok: { text: '你从后视镜里看着她变小。', fx: {} } },
		],
	},
	{
		id: 'busker-duet', title: '街头合奏', icon: '🎻', kinds: ['port', 'city'], weight: 3,
		text: '街角的提琴手朝你点头，示意你加入。',
		choices: [
			{ label: '上！', check: { skill: 'charisma', dc: 30 }, ok: { text: '围观的人越来越多，琴盒满了。', fx: { cash: 80, respect: 1, needs: { social: 25, fun: 20 }, skills: { charisma: 2 } } }, fail: { text: '你跑调了，但大家笑得很开心。', fx: { needs: { social: 15, fun: 10 }, skills: { charisma: 1 } } } },
			{ label: '投个硬币就走', cost: 2, ok: { text: '他冲你眨了眨眼。', fx: {} } },
		],
	},
	{
		id: 'shark-alarm', title: '鲨鱼警报', icon: '🚨', tags: ['beach'], weight: 2,
		text: '救生员吹响了警报，海滩上的人纷纷上岸。',
		choices: [
			{ label: '帮忙喊人上岸', ok: { text: '救生员冲你竖了大拇指。', fx: { respect: 2, needs: { social: 10 } } } },
			{ label: '举起手机拍', ok: { text: '只拍到一片背鳍。', fx: { needs: { fun: 8 } } } },
		],
	},
	{
		id: 'wildflowers', title: '野花季', icon: '🌼', seasons: ['spring'], kinds: ['park', 'outback', 'town'], weight: 2,
		text: '路两边铺满了粉色和黄色的永生花，一直开到地平线。',
		choices: [{ label: '停下走一走', ok: { text: '风里全是花的味道。', fx: { minutes: 30, needs: { fun: 22 } } } }],
	},
	{
		id: 'flies', title: '苍蝇大军', icon: '🪰', kinds: ['outback', 'park', 'mining'], weight: 2,
		text: '下车三秒，脸上已经落了十几只苍蝇。',
		choices: [
			{ label: '买顶防蝇网帽（$12）', cost: 12, ok: { text: '丑，但管用。', fx: { items: { flynet: 1 } } } },
			{ label: '练“澳式挥手”硬扛', ok: { text: '你学会了本地人的打招呼方式。', fx: { needs: { fun: -8, hygiene: -5 }, skills: { survival: 1 } } } },
		],
	},
	{
		id: 'gorge-pool', title: '峡谷深潭', icon: '🏞️', tags: ['gorge'], weight: 4,
		text: '沿着岩壁下到谷底，一汪翡翠色的水潭。',
		choices: [
			{ label: '攀下去游一圈', check: { skill: 'stamina', dc: 40 }, ok: { text: '水冰得你大叫，然后是彻底的安静。', fx: { respect: 2, needs: { fun: 35, hygiene: 20 }, skills: { stamina: 2, swimming: 1 } } }, fail: { text: '下到一半脚滑，擦破了膝盖。', fx: { health: -10, skills: { stamina: 1 } } } },
			{ label: '在崖顶看看', ok: { text: '风从谷里吹上来。', fx: { needs: { fun: 12 } } } },
		],
	},
	{
		id: 'pearl-offer', title: '“便宜珍珠”', icon: '🦪', tags: ['pearl'], weight: 3,
		text: '巷子里有人拉开外套：“南洋珠，店里十分之一的价。”',
		choices: [
			// 先付 $200：真货转手拿回 $600（净赚 $400），假货钱就没了（净亏 $200）
			{ label: '买来转手', cost: 200, check: { skill: 'street', dc: 50 }, ok: { text: '你一眼挑出了真货，转手赚了一笔。', fx: { cash: 600, heat: 15, skills: { street: 3 } } }, fail: { text: '塑料珠子。钱没了。', fx: { heat: 10, skills: { street: 1 } } } },
			{ label: '摆手走开', ok: { text: '不惹麻烦。', fx: {} } },
		],
	},
	{
		id: 'heatwave', title: '热浪', icon: '🥵', seasons: ['summer'], kinds: ['outback', 'mining', 'park'], weight: 4,
		text: '下车的一瞬间像打开了烤箱门，路面上的热气在抖。',
		choices: [
			{ label: '找个阴凉地方等太阳下去', ok: { text: '你在加油站的雨棚下坐到了傍晚。', fx: { minutes: 180, needs: { fun: -5 } } } },
			{ label: '硬顶着继续', check: { skill: 'stamina', dc: 50 }, ok: { text: '你喝光了水，但撑下来了。', fx: { needs: { energy: -15, hygiene: -15 }, skills: { stamina: 2, survival: 1 } } }, fail: { text: '你有点中暑，头晕得厉害。', fx: { health: -15, needs: { energy: -25 } } } },
		],
	},
	{
		id: 'winter-swell', title: '冬季风暴', icon: '🌊', seasons: ['winter'], tags: ['beach'], weight: 4,
		text: '南边来的风暴把海搅成了灰白色，浪头砸在防波堤上。',
		choices: [
			{ label: '躲进酒吧喝杯热的（$15）', cost: 15, ok: { text: '半个镇子的人都在这儿，壁炉烧得正旺。', fx: { needs: { social: 20, fun: 10 } } } },
			{ label: '裹紧外套去看浪', ok: { text: '浪花溅了你一身，但值得。', fx: { needs: { fun: 18, hygiene: -10 } } } },
		],
	},
	{
		id: 'heat-check', title: '被盯上了', icon: '👮', weight: 0,
		text: '两名警员拦住你：“最近有人反映了一些情况，麻烦配合一下。”',
		choices: [
			{ label: '老实配合', ok: { text: '问了半小时话，交了罚款，这事算翻篇了。', fx: { minutes: 30, cash: -200, heat: -50 } } },
			{ label: '想办法溜走', check: { skill: 'stamina', dc: 60 }, ok: { text: '你拐进小巷甩掉了他们。', fx: { heat: -15, skills: { stamina: 2, street: 2 } } }, fail: { text: '没跑出五十米就被按住了。', fx: { cash: -500, health: -10, heat: -30 } } },
		],
	},
	...VENUE_EVENTS,
];
