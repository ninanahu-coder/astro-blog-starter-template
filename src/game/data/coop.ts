// 共同事件：同一地点两名以上玩家一起做的事。每人选一个分工（用自己的那项能力），合起来做一次团队检定，所有人拿同一个结果。
// 团队分 = 每人（检定分 + 随机 0–60）的平均值 + 每多一人 +6，达到 dc 就成功。
import type { CoopDef } from '../core/types.ts';

export const COOP_EVENTS: CoopDef[] = [
	{
		id: 'beach-cleanup', title: '海滩清洁', icon: '🧹', tags: ['beach'], min: 2, max: 4, dc: 45,
		text: '潮水退下去，沙滩上留了一长条塑料瓶和渔网。几个人一起清干净吧。',
		roles: [
			{ label: '沿着潮线捡垃圾', skill: 'stamina' },
			{ label: '招呼路人一起来', skill: 'charisma' },
			{ label: '把渔网拖上岸', skill: 'strength' },
		],
		ok: { text: '一整片海滩干干净净，路过的人都冲你们竖大拇指。', fx: { minutes: 60, respect: 4, needs: { social: 25, fun: 10, energy: -12, hygiene: -10 } } },
		fail: { text: '垃圾比想象中多，只清了一小段，不过大家聊得挺开心。', fx: { minutes: 60, needs: { social: 15, energy: -12, hygiene: -10 } } },
	},
	{
		id: 'busk-band', title: '街头合奏', icon: '🎶', kinds: ['city', 'port'], hours: [9, 21], min: 2, max: 4, dc: 55,
		text: '几个陌生人凑成一支临时乐队，在街角开唱。',
		roles: [
			{ label: '主唱', skill: 'charisma' },
			{ label: '打拍子招揽观众', skill: 'street' },
			{ label: '扛着音箱跑场', skill: 'stamina' },
		],
		ok: { text: '围了一圈人，琴盒里的零钱叮当作响，大家平分了。', fx: { minutes: 90, cash: 45, respect: 2, needs: { social: 30, fun: 20, energy: -12 } } },
		fail: { text: '没几个人停下来，不过合唱得很尽兴。', fx: { minutes: 90, cash: 8, needs: { social: 20, fun: 10, energy: -12 } } },
	},
	{
		id: 'push-car', title: '帮人推车', icon: '🚙', kinds: ['outback', 'coast', 'park'], min: 2, max: 4, dc: 55,
		text: '一辆旅行车陷在软沙里，车主急得直挠头。',
		roles: [
			{ label: '在后面使劲推', skill: 'strength' },
			{ label: '指挥车主打方向', skill: 'driving' },
			{ label: '找树枝垫在轮子下', skill: 'survival' },
		],
		ok: { text: '车子一下子冲了出来，车主非要请你们喝冰可乐。', fx: { minutes: 40, respect: 3, needs: { social: 25, fun: 10, energy: -15, hygiene: -12 } } },
		fail: { text: '轮子越陷越深，最后还是等来了拖车。', fx: { minutes: 40, needs: { social: 15, energy: -15, hygiene: -15 } } },
	},
	{
		id: 'dolphin-rescue', title: '救搁浅的海豚', icon: '🐬', tags: ['dolphin'], weather: ['sunny', 'cloudy', 'hot', 'rain'], min: 2, max: 4, dc: 60,
		text: '退潮时一只小海豚被困在了浅滩上，得有人帮它回到深水里。',
		roles: [
			{ label: '扶住它的身体', skill: 'strength' },
			{ label: '不停往它身上浇水', skill: 'swimming' },
			{ label: '跑去叫护林员', skill: 'survival' },
		],
		ok: { text: '海豚摆了摆尾巴游回了深水，浅滩上的人都欢呼起来。', fx: { minutes: 60, respect: 6, needs: { fun: 30, social: 20, energy: -12, hygiene: -10 } } },
		fail: { text: '你们撑到护林员赶来，海豚被专业人员接手了。', fx: { minutes: 60, respect: 1, needs: { social: 15, energy: -12, hygiene: -10 } } },
	},
];

export const getCoop = (id: string) => COOP_EVENTS.find((c) => c.id === id);
