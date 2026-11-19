// 旅行回来时的事件（第 43 批）：weight 为 0，不进普通抵达抽取，只由 core/trips.ts 按 data/trips.ts 的 RETURN_EVENTS 抽。
// 数值都待平衡。入境申报的文案不写真实罚款金额（没有查到对应条目的出处）。
import type { GameEvent } from '../core/types.ts';

export const TRIP_EVENTS: GameEvent[] = [
	{
		id: 'trip-biosecurity', title: '入境申报', icon: '🛃', weight: 0,
		text: '过海关前才想起来，箱子里有妈妈塞的腊肠和一盒月饼。入境卡上「是否携带食品」那一栏还空着。',
		choices: [
			{ label: '勾「是」，如实申报', ok: { text: '检疫官打开看了看，腊肠留下了，月饼放行。多排了半小时队，心里踏实。', fx: { minutes: 30, items: { 'souvenir-home': -1 }, needs: { energy: -5 } } } },
			{ label: '勾「否」，碰碰运气', check: { skill: 'street', dc: 70 }, ok: { text: '检疫犬从你身边走了过去。出了海关才发现手心全是汗。', fx: { heat: 5, needs: { fun: -5 } } }, fail: { text: '检疫犬在你的箱子前坐下了。食品被没收，还被叫到一边做了笔录。', fx: { minutes: 90, items: { 'souvenir-home': -2 }, heat: 15, cash: -200, needs: { fun: -15 } } } },
		],
	},
	{
		id: 'trip-mailbox', title: '塞满的信箱', icon: '📬', weight: 0,
		text: '到家门口，信箱已经塞不下了：账单、超市传单，还有一张没送到的包裹通知。',
		choices: [
			{ label: '坐下来一封封处理', ok: { text: '账单都交了，包裹也约好了改天去取。', fx: { minutes: 60, needs: { fun: -5 }, skills: { street: 1 } } } },
			{ label: '先睡觉，明天再说', ok: { text: '一觉醒来，有一张账单已经过了期，多付了一笔滞纳金。', fx: { cash: -30, needs: { energy: 10 } } } },
		],
	},
	{
		id: 'trip-jetlag-night', title: '凌晨三点醒了', icon: '🌙', weight: 0,
		text: '身体还在别的时区，凌晨三点就睁开了眼，窗外一片黑。',
		choices: [
			{ label: '起来整理旅行的照片', ok: { text: '把照片一张张挑出来，天亮时发了一组朋友圈。', fx: { minutes: 120, needs: { fun: 10, energy: -10, social: 5 } } } },
			{ label: '逼自己再睡一会儿', check: { skill: 'stamina', dc: 40 }, ok: { text: '数到第三百只羊时睡着了，醒来精神不错。', fx: { needs: { energy: 15 } } }, fail: { text: '翻来覆去到天亮，白天一直打哈欠。', fx: { needs: { energy: -10, fun: -5 } } } },
		],
	},
];
