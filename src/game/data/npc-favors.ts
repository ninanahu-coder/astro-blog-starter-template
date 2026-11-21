// 帮个小忙（第 29 批）：NPC 主动开口托你带样东西。每位 NPC 一条，哪几期开口由 core/relations.ts 的 favorToday 按日子算。
// 交出 qty 件 item，关系 +RELATION_GAIN.favor，外加 fx（不花多少时间，钱只是跑腿费）。数值待平衡。
// 要的东西只用商店买得到的消耗品和小装备，不会是 TA 讨厌的东西（tests/earth/relations.test.ts 检查）。
import type { Effect } from '../core/types.ts';

export interface NpcFavor {
	npc: string;
	item: string;
	qty: number;
	/** NPC 开口时说的话（界面上显示） */
	ask: string;
	/** 帮完之后的一句 */
	thanks: string;
	fx: Effect;
}

export const NPC_FAVORS: NpcFavor[] = [
	{ npc: 'mia', item: 'water', qty: 2, ask: '今天的瓶装水被送错了货，能帮我带两瓶水吗？', thanks: '米娅把两瓶水放进冰柜，给你的杯子多加了一份奶泡。', fx: { minutes: 10, cash: 12, moodlet: 'warm-moment' } },
	{ npc: 'jack', item: 'snack', qty: 1, ask: '一早出海忘了带吃的，帮我买条能量棒？', thanks: '老杰克边嚼边给你讲今天网里的怪鱼。', fx: { minutes: 10, cash: 8, needs: { social: 8 } } },
	{ npc: 'linda', item: 'firstaid', qty: 1, ask: '巡岛的急救包用完了，下一班补给船还要两天。', thanks: '琳达把急救包塞进巡逻背包，说这下安心了。', fx: { minutes: 15, cash: 30, respect: 1 } },
	{ npc: 'leo', item: 'water', qty: 2, ask: '学员今天来了一车，水不够分，帮我带两瓶？', thanks: '里奥把水分给学员，顺手教了你一个起乘的小技巧。', fx: { minutes: 15, cash: 10, skills: { swimming: 0.5 } } },
	{ npc: 'nan', item: 'snack', qty: 2, ask: '客人要早起看日出，帮我备两条能量棒给他们路上吃。', thanks: '南希把能量棒装进小纸袋，给你也留了一块蛋糕。', fx: { minutes: 10, cash: 15, needs: { hunger: 10 } } },
	{ npc: 'bill', item: 'water', qty: 2, ask: '矿上的水车坏了，明天的班得自己带水。', thanks: '比尔拍拍你的肩，说下次这一轮算他的。', fx: { minutes: 10, cash: 15, needs: { social: 8 } } },
	{ npc: 'sam', item: 'electrolyte', qty: 1, ask: '连着带了三趟潜水，帮我弄包电解质冲剂？', thanks: '萨姆冲了一杯一口气喝完，说你救了他下午那一趟。', fx: { minutes: 10, cash: 12, respect: 1 } },
	{ npc: 'dave', item: 'snack', qty: 2, ask: '今晚跑长线，路上没店，帮我备两条能量棒。', thanks: '戴夫把能量棒塞进驾驶室，说回来给你带北边的路况。', fx: { minutes: 10, cash: 15, skills: { driving: 0.3 } } },
	{ npc: 'yuki', item: 'water', qty: 1, ask: '店里一直在跟客人讲价，嗓子都哑了，帮我带瓶水？', thanks: '由纪喝了半瓶，让你看了一颗不卖的老珍珠。', fx: { minutes: 10, cash: 10, needs: { fun: 6 } } },
	{ npc: 'tom', item: 'firstaid', qty: 1, ask: '船上的急救包过期了，出海前得换新的。', thanks: '汤姆把新急救包挂回驾驶舱，说这是船上最要紧的东西。', fx: { minutes: 10, cash: 30, respect: 1 } },
	{ npc: 'harry', item: 'coffee', qty: 1, ask: '今天团多，讲到第三场了，帮我带杯咖啡？', thanks: '哈利捧着咖啡给你多讲了一段没写进展牌的故事。', fx: { minutes: 15, cash: 8, needs: { fun: 8 } } },
	{ npc: 'ruby', item: 'electrolyte', qty: 2, ask: '下午要带团下谷底，帮我备两包电解质冲剂。', thanks: '鲁比把冲剂分进每个人的水壶，说你算半个向导了。', fx: { minutes: 10, cash: 20, skills: { survival: 0.3 } } },
	{ npc: 'rosa', item: 'sunscreen', qty: 1, ask: '站在浅滩一上午，防晒霜用光了，帮我买一支？', thanks: '罗莎抹好防晒，拉你去看今天第一批来的海豚。', fx: { minutes: 10, cash: 12, needs: { fun: 8 } } },
	{ npc: 'mack', item: 'water', qty: 2, ask: '果园的工人中午要水，帮我带两瓶来？', thanks: '麦克塞给你两个刚摘的芒果。', fx: { minutes: 10, cash: 10, needs: { hunger: 12 } } },
	{ npc: 'greta', item: 'water', qty: 2, ask: '试饮摊的清口水不够了，帮我带两瓶？', thanks: '葛蕾塔给你倒了一小杯还没装瓶的新酒尝尝。', fx: { minutes: 10, cash: 15, needs: { fun: 6 } } },
	{ npc: 'kev', item: 'sunhat', qty: 1, ask: '帽子被风吹进矿坑了，帮我买顶宽檐帽？', thanks: '凯文戴上新帽子，让你在他的废矿堆里翻了一会儿碎欧泊。', fx: { minutes: 20, cash: 15, needs: { fun: 10 } } },
	{ npc: 'ayla', item: 'snack', qty: 2, ask: '要在保护区蹲一整天点数，帮我备两条能量棒。', thanks: '艾拉把你记在了今天的观察记录上，算协助人员。', fx: { minutes: 10, cash: 15, respect: 1 } },
];
