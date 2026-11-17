// NPC 之间的联动剧情：两位 NPC 的好感都达到 at 时，和其中任何一位互动后触发一次。
// 两人之间有现成的交集（日程会碰面、同一行当、同一片海岸），由你在中间牵线。
// fx 只用不花时间的效果（钱、声望、需求、心情），触发时直接结算。数值待平衡。
import type { Effect } from '../core/types.ts';

export interface NpcDuo {
	id: string;
	a: string;
	b: string;
	at: number;
	title: string;
	text: string;
	fx: Effect;
}

export const NPC_DUOS: NpcDuo[] = [
	{ id: 'market-sandwich', a: 'mia', b: 'jack', at: 40, title: '集市的早晨', text: '周日集市上，米娅用老杰克当天的鱼做了新的鱼肉三明治，两人都说这是你牵的线。', fx: { respect: 1, moodlet: 'warm-moment' } },
	{ id: 'island-ride', a: 'mia', b: 'linda', at: 40, title: '绕岛一圈', text: '琳达带米娅和你骑车绕罗特尼斯岛一圈，一路叫得出每只短尾矮袋鼠的名字。', fx: { needs: { fun: 15, social: 10 } } },
	{ id: 'dolphin-wave', a: 'leo', b: 'rosa', at: 40, title: '浪里的海豚', text: '里奥说他在浪里被一只海豚陪游过，罗莎翻出记录本，认出是中心登记过的那只。', fx: { needs: { fun: 12 }, moodlet: 'warm-moment' } },
	{ id: 'old-boats', a: 'jack', b: 'tom', at: 40, title: '谁的船更老', text: '老杰克和汤姆在电话里争了半小时谁的船更老，最后约好一起出海，请你当裁判。', fx: { respect: 1, needs: { fun: 10 } } },
	{ id: 'night-radio', a: 'dave', b: 'bill', at: 40, title: '夜班电台', text: '戴夫跑夜车时在电台点了一首歌给比尔，说是替你转达的问候。比尔在矿上听见了。', fx: { needs: { social: 15 }, moodlet: 'warm-moment' } },
	{ id: 'whaling-photo', a: 'nan', b: 'harry', at: 40, title: '墙上的老照片', text: '哈利在南希民宿的墙上认出一张捕鲸站时代的老照片，你帮忙把它送回了博物馆。', fx: { respect: 2 } },
	{ id: 'pearl-reef', a: 'sam', b: 'yuki', at: 40, title: '水下的网箱', text: '由纪托萨姆帮忙看一眼养殖场的水下网箱，你在两人之间传话，由纪付了跑腿费。', fx: { cash: 60 } },
	{ id: 'mango-box', a: 'ruby', b: 'mack', at: 40, title: '一箱芒果', text: '鲁比带团路过库努纳拉，麦克塞给她一箱芒果，她分了你一半。', fx: { needs: { hunger: 20, fun: 8 } } },
];
