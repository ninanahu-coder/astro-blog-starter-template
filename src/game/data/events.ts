// 到达地点触发的事件。once=true 的是地标“签名事件”，首次到访优先触发。
// 新增事件只需往数组里加一条；effects 全部走 engine.applyEffect，无需写逻辑代码。
import type { GameEvent } from '../core/types.ts';
import { VENUE_EVENTS } from './venue-events.ts';
import { SA_EVENTS } from './events-sa.ts';

export const EVENTS: GameEvent[] = [
	{
		id: 'quokka-selfie', animal: 'quokka', title: '短尾矮袋鼠', icon: '🦘', locs: ['rottnest'], once: true, weight: 10,
		text: '一只短尾矮袋鼠蹦到你脚边，歪着头，嘴角像在笑。',
		choices: [
			{ label: '蹲下来耐心等一张合影', check: { skill: 'charisma', dc: 30 }, ok: { text: '它凑到镜头前，完美合影！朋友圈炸了。', fx: { respect: 3, needs: { fun: 30, social: 15 } } }, fail: { text: '它闻了闻你的鞋，转身走了。至少见到了。', fx: { needs: { fun: 12 } } } },
			{ label: '掏零食喂它', ok: { text: '护林员当场开了罚单——野生动物不能喂。', fx: { cash: -150, heat: 10 } } },
		],
	},
	{
		id: 'whale-shark', animal: 'whale-shark', title: '鲸鲨', icon: '🦈', locs: ['exmouth'], once: true, weight: 10,
		text: '船长喊：“鲸鲨！右舷！”一条八米长的影子从船底滑过。',
		choices: [
			{ label: '跳下去同游（$200）', cost: 200, exposed: 'sea', check: { skill: 'swimming', dc: 45 }, ok: { text: '你和地球上最大的鱼并肩游了十分钟。', fx: { respect: 5, needs: { fun: 50 }, skills: { swimming: 4 } } }, fail: { text: '浪太大，你呛了几口水被拉回船上。', fx: { health: -8, needs: { fun: 10 }, skills: { swimming: 2 } } } },
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
		id: 'pinnacles-dusk', animal: 'emu', title: '石阵黄昏', icon: '🌅', locs: ['pinnacles'], once: true, weight: 10,
		text: '太阳落到石柱后面，几千根影子在黄沙上一起拉长。一只鸸鹋站在不远处盯着你。',
		choices: [
			{ label: '留下来等星星出来', check: { skill: 'survival', dc: 35 }, ok: { text: '没有一点光污染，银河从地平线一直铺到头顶。', fx: { minutes: 120, respect: 3, needs: { fun: 40, energy: -10 }, skills: { survival: 2 } } }, fail: { text: '天一黑就找不到回停车场的路，绕了半天才出来。', fx: { minutes: 150, needs: { fun: 15, energy: -20 }, skills: { survival: 1 } } } },
			{ label: '拍完照就走', ok: { text: '照片里的石柱像一片外星城市。', fx: { needs: { fun: 20 } } } },
		],
	},
	{
		id: 'lucky-bay-roos', animal: 'grey-kangaroo', title: '白沙滩上的袋鼠', icon: '🦘', locs: ['esperance'], once: true, weight: 10,
		text: '海水是透明的蓝，沙子白得晃眼，几只袋鼠正懒洋洋地躺在沙滩上晒太阳。',
		choices: [
			{ label: '在旁边下海游一圈', exposed: 'sea', check: { skill: 'swimming', dc: 30 }, ok: { text: '冰凉的海水，回头就能看见袋鼠在岸上发呆。', fx: { respect: 3, needs: { fun: 40, hygiene: 15, energy: -10 }, skills: { swimming: 2 } } }, fail: { text: '南大洋的水比想象中冷得多，你哆嗦着跑回岸上。', fx: { health: -3, needs: { fun: 15 }, skills: { swimming: 1 } } } },
			{ label: '远远地看着就好', ok: { text: '袋鼠翻了个身，继续晒。', fx: { needs: { fun: 25 } } } },
		],
	},
	{
		id: 'albany-whales', animal: 'humpback-whale', title: '海湾里的鲸', icon: '🐋', locs: ['albany'], once: true, weight: 10,
		text: '码头上有人指着海湾大喊：一对座头鲸母子正从港口外经过，喷出的水雾在阳光里闪。',
		choices: [
			{ label: '跳上最后一班观鲸船（$60）', cost: 60, exposed: 'sea', ok: { text: '小鲸跃出水面的那一刻，整船人都叫了起来。', fx: { minutes: 150, respect: 4, needs: { fun: 50, social: 15 } } } },
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
		id: 'rain-shelter', title: '躲雨', icon: '☔', kinds: ['city', 'town', 'port'], weather: ['rain'], weight: 4,
		text: '雨突然下大了，你和几个陌生人挤在同一个屋檐下。',
		choices: [
			{ label: '跟旁边的人聊几句', check: { skill: 'charisma', dc: 30 }, ok: { text: '雨停的时候，你们已经约好了改天一起喝咖啡。', fx: { minutes: 30, needs: { social: 25 }, skills: { charisma: 1.5 } } }, fail: { text: '对方戴着耳机，冲你礼貌地笑了笑。', fx: { minutes: 30, needs: { social: 5 } } } },
			{ label: '冒雨跑回去', ok: { text: '浑身湿透，但莫名地开心。', fx: { needs: { hygiene: -10, fun: 10 } } } },
		],
	},
	{
		id: 'rainbow', title: '雨后彩虹', icon: '🌈', kinds: ['coast', 'park', 'island'], weather: ['rain'], weight: 4,
		text: '一阵雨刚过，一道完整的双彩虹横跨天边。',
		choices: [
			{ label: '停下来看完', ok: { text: '直到彩虹慢慢淡掉，你才继续上路。', fx: { minutes: 20, needs: { fun: 20 } } } },
		],
	},
	{
		id: 'dolphin-visit', animal: 'bottlenose-dolphin', title: '海豚来了', icon: '🐬', tags: ['dolphin'], once: true, weight: 10,
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
	// 抛锚事件（第 15 轮）：weight 为 0，只在离上次保养超过 SERVICE_KM 的车自驾抵达时按几率抽
	{
		id: 'breakdown-overheat', title: '水箱开锅', icon: '♨️', breakdown: true, weight: 0,
		text: '仪表盘上的水温指针一路冲到红区，引擎盖下冒出白汽。离上次保养已经很久了。',
		choices: [
			{ label: '靠边等它凉下来，加点水', check: { skill: 'survival', dc: 40 }, ok: { text: '等了一个钟头，加上水慢慢开进了镇。', fx: { minutes: 60, needs: { energy: -5 }, skills: { survival: 1 } } }, fail: { text: '水加多了又溢出来，折腾到天快黑。', fx: { minutes: 180, needs: { energy: -15, fun: -10 } } } },
			{ label: '叫拖车', cost: 280, ok: { text: '拖车把你和车一起拉进了镇。', fx: { minutes: 120 } } },
		],
	},
	{
		id: 'breakdown-battery', title: '打不着火', icon: '🔋', breakdown: true, weight: 0,
		text: '加完油回来，钥匙一拧，只有“咔哒”一声。电瓶早该换了。',
		choices: [
			{ label: '找路人帮忙搭电', check: { skill: 'charisma', dc: 35 }, ok: { text: '一位农夫开着皮卡过来，两根线就搞定了。', fx: { minutes: 30, needs: { social: 10 }, skills: { charisma: 1 } } }, fail: { text: '没人停下来，最后还是打了救援电话。', fx: { minutes: 150, cash: -120, needs: { fun: -10 } } } },
			{ label: '叫道路救援换电瓶', cost: 180, ok: { text: '新电瓶装上，一下就着了。', fx: { minutes: 60 } } },
		],
	},
	{
		id: 'breakdown-belt', title: '皮带断了', icon: '🔧', breakdown: true, weight: 0,
		text: '一阵刺耳的尖叫，方向盘突然变得很沉。',
		choices: [
			{ label: '自己凑合着换上', check: { skill: 'driving', dc: 50 }, ok: { text: '照着视频换上了备用皮带，手上全是油。', fx: { minutes: 90, needs: { hygiene: -15 }, skills: { driving: 2 } } }, fail: { text: '没装上，只能慢慢挪进镇里。', fx: { minutes: 240, needs: { energy: -20, fun: -15 }, cash: -150 } } },
			{ label: '叫拖车去修车厂', cost: 320, ok: { text: '修车厂当天就换好了。', fx: { minutes: 180 } } },
		],
	},
	{
		id: 'roo-dusk', animal: 'grey-kangaroo', title: '黄昏的袋鼠', icon: '🌅', arrivedBy: ['road', 'track'], weight: 3,
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
	// ---------- 按时段出现（抵达时的时刻） ----------
	{
		id: 'dawn-boats', title: '清晨的渔船', icon: '🎣', kinds: ['port'], periods: ['dawn'], weight: 5,
		text: '天刚亮，渔船陆续靠岸，码头上全是海鸥和吆喝声。',
		choices: [
			{ label: '帮忙搬鱼箱', check: { skill: 'strength', dc: 30 }, ok: { text: '船老大塞给你一点辛苦钱，还请你喝了杯热茶。', fx: { minutes: 45, cash: 25, needs: { social: 15, energy: -10 }, skills: { strength: 1 } } }, fail: { text: '鱼箱比想象中沉，你差点滑进海里。', fx: { minutes: 30, needs: { energy: -12, hygiene: -10 } } } },
			{ label: '买个刚出炉的鱼肉派（$8）', cost: 8, ok: { text: '你捧着热乎乎的派，看着码头一点点忙起来。', fx: { minutes: 20, needs: { hunger: 25, fun: 10 } } } },
		],
	},
	{
		id: 'dusk-sunset', title: '海边日落', icon: '🌇', tags: ['beach'], periods: ['dusk'], weather: ['sunny', 'cloudy', 'hot', 'cold'], weight: 5,
		text: '太阳正沉进海里，整片海滩都被染成了橘红色。',
		choices: [
			{ label: '坐下来看完', ok: { text: '最后一点光消失时，海滩上有人鼓起了掌。', fx: { minutes: 40, needs: { fun: 25 } } } },
			{ label: '和旁边的人互相拍照', check: { skill: 'charisma', dc: 25 }, ok: { text: '你们互相拍了几张，还加了联系方式。', fx: { minutes: 30, needs: { social: 25, fun: 15 }, skills: { charisma: 1 } } }, fail: { text: '对方只想安静地看日落。', fx: { minutes: 20, needs: { fun: 10 } } } },
		],
	},
	{
		id: 'night-roos', animal: 'grey-kangaroo', title: '夜路上的袋鼠', icon: '🦘', kinds: ['outback', 'mining', 'town'], arrivedBy: ['road', 'track'], periods: ['dusk', 'night'], weight: 4,
		text: '天黑以后的公路上，一群袋鼠突然出现在车灯里。',
		choices: [
			{ label: '提醒司机减速', check: { skill: 'survival', dc: 30 }, ok: { text: '车稳稳停住，袋鼠们慢悠悠地跳进了灌木丛。', fx: { minutes: 20, needs: { fun: 10 }, skills: { survival: 1 } } }, fail: { text: '一个急刹，你的头撞上了前座。', fx: { minutes: 20, health: -6 } } },
			{ label: '抓紧扶手', ok: { text: '有惊无险，后半程你一直盯着路边。', fx: { needs: { energy: -5 } } } },
		],
	},
	{
		id: 'night-lights', title: '河边夜景', icon: '🌃', locs: ['perth'], periods: ['night'], weight: 3,
		text: '夜里的天鹅河两岸灯火通明，倒影一直铺到对岸。',
		choices: [
			{ label: '沿河走一走', ok: { text: '夜风很舒服，你走得比打算的还远。', fx: { minutes: 60, needs: { fun: 20, energy: -8 }, skills: { stamina: 1 } } } },
			{ label: '看一会儿就回去休息', ok: { text: '明天还有事，你没多待。', fx: { minutes: 10, needs: { fun: 5 } } } },
		],
	},
	// 第 24 轮：给还没有专属事件的 10 个地点各补一条（可重复，数值待平衡）
	{
		id: 'freo-doctor', title: '弗里曼特尔医生', icon: '🌬️', locs: ['fremantle'], seasons: ['summer', 'spring'], hours: [12, 20], weight: 3,
		text: '下午的海风准时从海上吹进来，当地人管它叫「弗里曼特尔医生」，热了一上午的街道一下子凉了。',
		choices: [
			{ label: '找个露台坐下吹风', ok: { text: '你在风里坐了半小时，热得发昏的脑子清醒了。', fx: { minutes: 30, needs: { fun: 12, energy: 6 } } } },
			{ label: '帮邻桌追回被吹跑的帽子', check: { skill: 'stamina', dc: 25 }, ok: { text: '你在帽子掉进海里前一把抓住，邻桌请你喝了杯冰水。', fx: { minutes: 15, needs: { social: 15 }, skills: { stamina: 1 } } }, fail: { text: '帽子打着旋飞进了港口，你们一起笑了半天。', fx: { minutes: 15, needs: { social: 10, fun: 6 } } } },
		],
	},
	{
		id: 'mandurah-crabs', title: '捞蓝花蟹', icon: '🦀', locs: ['mandurah'], seasons: ['summer', 'autumn'], weight: 3,
		text: '河口浅水里一排人举着捞网、拖着浮箱，一边走一边低头找蓝花蟹。',
		choices: [
			{ label: '借个网下水试试', check: { skill: 'survival', dc: 30 }, ok: { text: '你捞到几只够尺寸的，旁边的大叔教你量壳宽，还帮你煮了。', fx: { minutes: 60, needs: { hunger: 20, fun: 20 }, skills: { survival: 1 } } }, fail: { text: '捞到的全是小的，按规矩一只只放回了水里。', fx: { minutes: 60, needs: { fun: 10, hygiene: -10 } } } },
			{ label: '在岸边看热闹', ok: { text: '有人一网捞上来三只，岸上一片叫好。', fx: { minutes: 20, needs: { fun: 8 } } } },
		],
	},
	{
		id: 'bunbury-dolphins', title: '浅滩海豚', icon: '🐬', locs: ['bunbury'], periods: ['dawn', 'day'], animal: 'bottlenose-dolphin', weight: 3,
		text: '海豚中心外的浅滩上，几只宽吻海豚游得很近，志愿者让大家站在水里别动。',
		choices: [
			{ label: '照规矩站在齐膝的水里等', exposed: 'sea', ok: { text: '一只海豚从你身边滑过，背鳍上有道旧伤疤，志愿者说它是这片海的常客。', fx: { minutes: 40, needs: { fun: 30 } } } },
			{ label: '在岸上帮志愿者记录', ok: { text: '你帮忙数了海豚、写下时间，志愿者说下次可以来当帮手。', fx: { minutes: 40, respect: 1, needs: { social: 10 } } } },
		],
	},
	{
		id: 'busselton-jetty-walk', title: '走完长栈桥', icon: '🌉', locs: ['busselton'], weather: ['sunny', 'cloudy', 'hot', 'cold'], weight: 3,
		text: '木栈桥伸进海湾快两公里，尽头的海面下是一座水下观测站。',
		choices: [
			{ label: '一口气走到尽头再走回来', check: { skill: 'stamina', dc: 30 }, ok: { text: '来回快四公里，海风一路吹着，回到岸上腿是软的、心情是好的。', fx: { minutes: 75, needs: { fun: 20, energy: -12 }, skills: { stamina: 1 } } }, fail: { text: '走到一半太晒，你坐上了栈桥小火车。', fx: { minutes: 50, needs: { fun: 12, energy: -6 } } } },
			{ label: '在岸边的沙滩上看它', ok: { text: '远远看着那条细线一直伸进蓝色里。', fx: { minutes: 15, needs: { fun: 6 } } } },
		],
	},
	{
		id: 'margaret-cellar', title: '酒庄品酒', icon: '🍷', locs: ['margaret-river'], periods: ['day'], weight: 3,
		text: '路边的酒庄挂着「今日品鉴」的牌子，葡萄园一直铺到山坡后面。',
		choices: [
			{ label: '进去品一轮（$15）', cost: 15, ok: { text: '酿酒师讲了这片土和海风的关系，你挑出了自己最喜欢的一款。', fx: { minutes: 45, needs: { fun: 20, social: 10 } } } },
			{ label: '要开车，只买瓶果汁', cost: 4, ok: { text: '老板夸你懂规矩，送了一小袋葡萄。', fx: { minutes: 10, needs: { hunger: 8 } } } },
		],
	},
	{
		id: 'pemberton-karri', title: '卡里树林', icon: '🌲', locs: ['pemberton'], weather: ['sunny', 'cloudy', 'rain'], weight: 3,
		text: '卡里树笔直地插进雾里，树皮一条条剥落，林子里只有鸟叫和滴水声。',
		choices: [
			{ label: '走一段林间步道', check: { skill: 'survival', dc: 25 }, ok: { text: '你认出了好几种鸟叫，出林子时觉得整个人被洗过一遍。', fx: { minutes: 60, needs: { fun: 18, energy: -8 }, skills: { survival: 1 } } }, fail: { text: '岔路太多，你绕了一圈才回到停车场。', fx: { minutes: 80, needs: { fun: 8, energy: -12 } } } },
			{ label: '在林边的小咖啡馆坐一会儿', cost: 6, ok: { text: '热巧克力配着窗外的雾，正好。', fx: { minutes: 25, needs: { fun: 10, hunger: 10 } } } },
		],
	},
	{
		id: 'geraldton-leaning-trees', title: '歪脖子树', icon: '🌳', locs: ['geraldton'], weight: 3,
		text: '城外的田野上，几棵老树被常年的南风吹得几乎贴着地面长，像在弯腰鞠躬。',
		choices: [
			{ label: '学着树的样子拍张照', check: { skill: 'charisma', dc: 20 }, ok: { text: '你和树一起歪着身子，照片发出去收获了一串大笑。', fx: { minutes: 20, needs: { fun: 15, social: 10 } } } , fail: { text: '风太大，你差点真的被吹歪。', fx: { minutes: 20, needs: { fun: 8 } } } },
			{ label: '听路过的农场主讲这些树', ok: { text: '他说这些树比他爷爷还老，风从来没停过。', fx: { minutes: 20, needs: { social: 12 } } } },
		],
	},
	{
		id: 'hedland-ore-train', title: '运矿长龙', icon: '🚂', locs: ['port-hedland'], weight: 3,
		text: '一列运铁矿石的火车开进港口，车厢一节接一节，好几分钟都没过完。',
		choices: [
			{ label: '站在路口数车厢', ok: { text: '你数到两百多节就放弃了，旁边的矿工说这还不算长的。', fx: { minutes: 15, needs: { fun: 10, social: 6 } } } },
			{ label: '去看港口的白色盐山', ok: { text: '盐田边堆起的白色盐山在烈日下刺眼，像北方的雪。', fx: { minutes: 30, needs: { fun: 12, hygiene: -5 } } } },
		],
	},
	{
		id: 'coral-bay-snorkel', title: '岸边就是礁', icon: '🤿', locs: ['coral-bay'], periods: ['day'], weather: ['sunny', 'cloudy', 'hot'], weight: 3,
		text: '从沙滩往海里走十几米，脚下就是珊瑚，鹦嘴鱼在你膝盖边吃东西。',
		choices: [
			{ label: '租套浮潜装备下水（$20）', cost: 20, exposed: 'sea', check: { skill: 'swimming', dc: 30 }, ok: { text: '一只绿海龟慢悠悠地从你身下游过，你跟着它游了很远，回头才发现岸已经很小了。', fx: { minutes: 75, needs: { fun: 35, energy: -10 }, skills: { swimming: 2 } } }, fail: { text: '面镜一直进水，你在浅水里看了一会儿就上岸了。', fx: { minutes: 40, needs: { fun: 12 }, skills: { swimming: 1 } } } },
			{ label: '站在浅水里低头看', ok: { text: '不用下潜也看得见小丑鱼在海葵里进进出出。', fx: { minutes: 20, needs: { fun: 12 } } } },
		],
	},
	{
		id: 'monkey-mia-feeding', title: '早上的海豚', icon: '🐬', locs: ['monkey-mia'], hours: [7, 12], animal: 'bottlenose-dolphin', weight: 3,
		text: '早上，护林员在浅水里讲解野生海豚的规矩，几只海豚已经游到了岸边。',
		choices: [
			{ label: '举手争取当喂鱼的志愿者', check: { skill: 'charisma', dc: 40 }, ok: { text: '护林员挑中了你。你按指示把一条鱼放进水里，海豚轻轻接走了。', fx: { minutes: 45, respect: 1, needs: { fun: 35 } } }, fail: { text: '这次被一个小朋友抢先了，你在旁边看得很开心。', fx: { minutes: 45, needs: { fun: 15 } } } },
			{ label: '站在后排安静地看', ok: { text: '海豚离你只有几米，呼气的声音都听得见。', fx: { minutes: 30, needs: { fun: 15 } } } },
		],
	},
	// 第 25 轮：夜间事件 +6（天黑后抵达时才会抽到，数值待平衡）
	{
		id: 'night-milky-way', title: '头顶的银河', icon: '🌌', kinds: ['outback', 'park'], periods: ['night'], weather: ['sunny', 'hot', 'cold'], weight: 4,
		text: '离城镇太远，一点灯光都没有，银河从地平线一头拱到另一头。',
		choices: [
			{ label: '躺在地上认星座', check: { skill: 'survival', dc: 25 }, ok: { text: '你找到了南十字星，顺着它指的方向认出了正南。', fx: { minutes: 40, needs: { fun: 25 }, skills: { survival: 1 } } }, fail: { text: '星星太多，你一个星座也没认出来，但看得很满足。', fx: { minutes: 40, needs: { fun: 18 } } } },
			{ label: '看几眼就去休息', ok: { text: '闭上眼睛前，天上还有一颗流星。', fx: { minutes: 10, needs: { fun: 8 } } } },
		],
	},
	{
		id: 'night-pub-quiz', title: '酒吧问答夜', icon: '🍻', tags: ['pub'], periods: ['night'], weight: 3,
		text: '酒吧里正在办问答夜，有一队人数不够，冲你招手。',
		choices: [
			{ label: '入队一起答题', check: { skill: 'charisma', dc: 35 }, ok: { text: '你答对了最后一道关于本地历史的题，全队赢了一张餐券，大家把它折成现金分给了你一份。', fx: { minutes: 90, cash: 20, needs: { social: 30, fun: 20, energy: -8 }, skills: { charisma: 1 } } }, fail: { text: '你们排在倒数第二，但队友说明周还要你来。', fx: { minutes: 90, needs: { social: 22, fun: 12, energy: -8 } } } },
			{ label: '在吧台边旁听', ok: { text: '你偷偷在心里答对了好几道。', fx: { minutes: 30, needs: { fun: 10 } } } },
		],
	},
	{
		id: 'night-turtles', title: '海龟上岸', icon: '🐢', locs: ['exmouth', 'coral-bay'], seasons: ['summer'], periods: ['night'], animal: 'green-turtle', weight: 4,
		text: '夏夜的沙滩上，一只海龟正慢慢爬上岸找地方产卵。护林员示意大家关掉手电。',
		choices: [
			{ label: '关灯，远远地安静看', ok: { text: '它挖了一个多小时的坑，你一动不动地看完了。', fx: { minutes: 70, needs: { fun: 35, energy: -6 } } } },
			{ label: '想凑近拍张照', ok: { text: '护林员拦住了你，讲了闪光灯会让海龟迷路。你红着脸退回去了。', fx: { minutes: 20, heat: 3, needs: { fun: 8 } } } },
		],
	},
	{
		id: 'night-shift-change', title: '换班的矿工', icon: '⛑️', kinds: ['mining'], periods: ['night'], weight: 3,
		text: '半夜的加油站灯火通明，刚下夜班的矿工排着队买热食，脸上还带着红土。',
		choices: [
			{ label: '和他们一起排队聊几句', check: { skill: 'street', dc: 25 }, ok: { text: '有人告诉你哪家矿上缺人，还说可以帮你问问。', fx: { minutes: 25, needs: { social: 20, hunger: 15 }, skills: { street: 1 } } }, fail: { text: '大家都太累了，只冲你点点头。', fx: { minutes: 20, needs: { hunger: 15 } } } },
			{ label: '买个肉派就走（$6）', cost: 6, ok: { text: '烫手的肉派，半夜吃起来格外香。', fx: { minutes: 10, needs: { hunger: 25 } } } },
		],
	},
	{
		id: 'night-squid-jetty', title: '码头夜钓', icon: '🦑', kinds: ['port', 'town'], periods: ['night'], weight: 3,
		text: '码头的灯照着海面，几个人提着桶在钓枪乌贼，水里一闪一闪的。',
		choices: [
			{ label: '借根竿试一试', check: { skill: 'survival', dc: 30 }, ok: { text: '你钓上来两只，被喷了一身墨，大家笑着教你怎么收线。', fx: { minutes: 50, needs: { fun: 22, social: 12, hygiene: -12 }, skills: { survival: 1 } } }, fail: { text: '一只也没上钩，但学会了怎么打结。', fx: { minutes: 50, needs: { fun: 10, social: 10 } } } },
			{ label: '站在一边看他们收获', ok: { text: '有人把一只刚钓上的递给你看，它在灯下变了好几次颜色。', fx: { minutes: 15, needs: { fun: 8 } } } },
		],
	},
	{
		id: 'night-hostel-kitchen', title: '深夜的公共厨房', icon: '🍜', kinds: ['city', 'coast'], periods: ['night'], weight: 3,
		text: '青旅的公共厨房还亮着灯，几个刚到的背包客在煮面，桌上摊着一张地图。',
		choices: [
			{ label: '凑过去交换路线', check: { skill: 'charisma', dc: 20 }, ok: { text: '你们互相推荐了好几个地方，有人还分了你一碗面。', fx: { minutes: 40, needs: { social: 25, hunger: 15, fun: 10 }, skills: { charisma: 1 } } }, fail: { text: '他们讲的语言你听不太懂，不过面很香。', fx: { minutes: 30, needs: { social: 12, hunger: 10 } } } },
			{ label: '打个招呼就回房', ok: { text: '有人说明早一起去看日出，你答应了。', fx: { minutes: 5, needs: { social: 6 } } } },
		],
	},
	...VENUE_EVENTS,
	...SA_EVENTS,
];
