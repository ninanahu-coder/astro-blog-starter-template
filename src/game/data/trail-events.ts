// 主要路线（实地路线）的事件：到站事件和沿途事件，由 data/trails.ts 按 id 指定。
// weight 都是 0：不进到达城镇、真实地点的普通抽取，只在走路线时按数据触发。
// 数值和真实地点事件同级（刻意小）：路线是一次性的，奖励在路线本身。全部待平衡。
import type { GameEvent } from '../core/types.ts';

export const TRAIL_EVENTS: GameEvent[] = [
	// ---------- 到站 ----------
	{
		id: 'trail-quay-start', title: '出发前', icon: '🧭', weight: 0,
		text: '你站在起点，手机地图上是一条还不熟的路。旁边有个拿着同款地图的人也在东张西望。',
		choices: [
			{ label: '上去问问要不要一起走', check: { skill: 'charisma', dc: 25 }, ok: { text: '对方也是刚来的留学生，你们走了一段，加了联系方式。', fx: { minutes: 10, needs: { social: 15 }, skills: { charisma: 0.5 }, moodlet: 'warm-moment' } }, fail: { text: '对方戴着耳机没听见，你笑笑自己走了。', fx: { needs: { social: 3 } } } },
			{ label: '先把路线记熟再走', ok: { text: '你把几个路口记在心里，走起来顺多了。', fx: { minutes: 5, skills: { street: 0.5 } } } },
		],
	},
	{
		id: 'trail-library-seat', title: '自习区的空位', icon: '📚', weight: 0,
		text: '图书馆里人不少，窗边还剩一个位子，桌上贴着一张「欢迎自习」的小卡片。',
		choices: [
			{ label: '坐下来看会儿书', ok: { text: '安静了半小时，脑子清楚多了。', fx: { minutes: 30, needs: { fun: 4, energy: -2 }, moodlet: 'focused' } } },
			{ label: '看看服务台有什么免费活动', ok: { text: '你拿了一张英语角和求职讲座的传单。', fx: { minutes: 10, needs: { social: 4 }, skills: { street: 0.5 } } } },
		],
	},
	{
		id: 'trail-asian-grocer', title: '家乡味道', icon: '🥢', weight: 0,
		text: '货架上是熟悉的调料和零食，收银台边有人在用你的家乡话聊天。',
		choices: [
			{ label: '买一包零食解解馋（$8）', cost: 8, ok: { text: '小时候的味道，一口下去心情好了不少。', fx: { needs: { hunger: 10, fun: 10 } } } },
			{ label: '跟收银台边的人搭句话', check: { skill: 'charisma', dc: 20 }, ok: { text: '对方在这边好几年了，告诉你哪天进货最新鲜。', fx: { minutes: 10, needs: { social: 12 }, skills: { street: 0.5 } } }, fail: { text: '人家在赶时间，冲你点点头就走了。', fx: { needs: { social: 3 } } } },
			{ label: '逛一圈就走', ok: { text: '光是看看就觉得踏实。', fx: { needs: { fun: 4 } } } },
		],
	},
	{
		id: 'trail-notice-board', title: '布告栏', icon: '📌', weight: 0,
		text: '布告栏上贴满了小纸条：找室友、二手自行车、周末打零工。',
		choices: [
			{ label: '拍下几张招工的', ok: { text: '有一张写着「会中文优先」，你存进了相册。', fx: { minutes: 5, skills: { street: 1 } } } },
			{ label: '自己也贴一张「求合租」', check: { skill: 'street', dc: 25 }, ok: { text: '你写得清楚又靠谱，当天就有人回了消息。', fx: { minutes: 10, needs: { social: 8 }, respect: 1 } }, fail: { text: '纸条贴上去了，暂时没人联系。', fx: { minutes: 10 } } },
		],
	},
	{
		id: 'trail-prison-gate', title: '老监狱门口', icon: '🏰', weight: 0,
		text: '高墙下的告示牌讲着这座监狱一百多年的历史，导览的队伍刚刚出发。',
		choices: [
			{ label: '站着把告示牌读完', ok: { text: '你多知道了一点这座港口城市的来历。', fx: { minutes: 15, needs: { fun: 6 }, skills: { street: 0.5 } } } },
			{ label: '在门口拍张照发给家里', ok: { text: '家里人回了一串问号：「这是哪儿？看着好吓人。」', fx: { minutes: 5, needs: { social: 8, fun: 4 } } } },
		],
	},
	{
		id: 'trail-city-view', title: '山顶的城市', icon: '🌆', weight: 0,
		text: '观景台上风很大，脚下是整片市中心和弯弯的天鹅河。',
		choices: [
			{ label: '找找自己上班和住的地方', ok: { text: '你认出了好几栋楼，原来这座城也没那么大。', fx: { minutes: 15, needs: { fun: 10 }, moodlet: 'good-time' } } },
			{ label: '帮一对游客拍合照', check: { skill: 'charisma', dc: 20 }, ok: { text: '他们很满意，非要请你喝瓶水。', fx: { minutes: 10, needs: { social: 10, hunger: 2 }, respect: 1 } }, fail: { text: '拍糊了一张，重拍一张就好了。', fx: { minutes: 10, needs: { social: 5 } } } },
		],
	},
	// ---------- 沿途 ----------
	{
		id: 'trail-along-busker', title: '街头艺人', icon: '🎸', weight: 0,
		text: '路边有人在弹吉他，琴盒里散着几枚硬币。',
		choices: [
			{ label: '投两块钱（$2）', cost: 2, ok: { text: '他冲你点头，换了一首更欢快的曲子。', fx: { minutes: 5, needs: { fun: 8 } } } },
			{ label: '停下来听完这首', ok: { text: '一首歌的时间，走路的累消了一半。', fx: { minutes: 5, needs: { fun: 5 } } } },
		],
	},
	{
		id: 'trail-along-crossing', title: '路口', icon: '🚦', weight: 0,
		text: '红灯很长，路口的提示音哒哒哒地响。旁边有人在问路，用的是你听得懂的口音。',
		choices: [
			{ label: '帮忙指路', check: { skill: 'street', dc: 20 }, ok: { text: '你指得清清楚楚，对方连声道谢。', fx: { needs: { social: 8 }, respect: 0.5 } }, fail: { text: '你也说不准，两个人一起看了半天地图。', fx: { minutes: 5, needs: { social: 5 } } } },
			{ label: '等绿灯', ok: { text: '绿灯亮了，你接着往前走。', fx: {} } },
		],
	},
	{
		id: 'trail-along-sea-breeze', title: '起风了', icon: '🍃', weight: 0,
		text: '下午的海风吹过来，树叶哗哗地响，空气一下子凉快了。',
		choices: [
			{ label: '找个树荫歇一会儿', ok: { text: '坐了几分钟，脚步轻快了些。', fx: { minutes: 10, needs: { energy: 4, fun: 3 } } } },
			{ label: '趁凉快加快脚步', ok: { text: '你一口气走了好长一段。', fx: { skills: { stamina: 0.5 }, needs: { energy: -2 } } } },
		],
	},
	{
		id: 'trail-along-stairs', title: '上坡', icon: '🪜', weight: 0,
		text: '往山上去的路越来越陡，前面是一长段台阶，有人在上面来回跑着训练。',
		choices: [
			{ label: '一口气爬上去', check: { skill: 'stamina', dc: 25 }, ok: { text: '爬到顶上喘着气回头一看，值了。', fx: { needs: { energy: -6, fun: 6 }, skills: { stamina: 1 } } }, fail: { text: '爬到一半歇了两次，腿有点软。', fx: { minutes: 10, needs: { energy: -8 }, skills: { stamina: 0.5 } } } },
			{ label: '走旁边的缓坡', ok: { text: '多绕了一点路，不过一路都是树荫。', fx: { minutes: 10, needs: { energy: -3, fun: 3 } } } },
		],
	},
];
