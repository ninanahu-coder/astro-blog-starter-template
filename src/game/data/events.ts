// 到达地点触发的事件。once=true 的是地标“签名事件”，首次到访优先触发。
// 新增事件只需往数组里加一条；effects 全部走 engine.applyEffect，无需写逻辑代码。
import type { GameEvent } from '../core/types.ts';

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
			{ label: '跳下去同游', check: { skill: 'swimming', dc: 45 }, ok: { text: '你和地球上最大的鱼并肩游了十分钟。', fx: { cash: -200, respect: 5, needs: { fun: 50 }, skills: { swimming: 4 } } }, fail: { text: '浪太大，你呛了几口水被拉回船上。', fx: { cash: -200, health: -8, needs: { fun: 10 }, skills: { swimming: 2 } } } },
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
			{ label: '叫道路救援', ok: { text: '救援三小时后才到，账单也不便宜。', fx: { minutes: 180, cash: -220 } } },
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
			{ label: '投个硬币就走', ok: { text: '他冲你眨了眨眼。', fx: { cash: -2 } } },
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
			{ label: '买顶防蝇网帽', ok: { text: '丑，但管用。', fx: { cash: -12 } } },
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
			{ label: '买来转手', check: { skill: 'street', dc: 50 }, ok: { text: '你一眼挑出了真货，转手赚了一笔。', fx: { cash: 400, heat: 15, skills: { street: 3 } } }, fail: { text: '塑料珠子。钱没了。', fx: { cash: -200, heat: 10, skills: { street: 1 } } } },
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
			{ label: '躲进酒吧喝杯热的', ok: { text: '半个镇子的人都在这儿，壁炉烧得正旺。', fx: { cash: -15, needs: { social: 20, fun: 10 } } } },
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
];
