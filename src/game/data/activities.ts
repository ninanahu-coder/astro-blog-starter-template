// 地点互动：生活需求（吃/睡/洗/玩/聊）+ 能力成长 + 赚钱。数值集中在这里便于调参。
import type { Activity } from '../core/types.ts';

export const ACTIVITIES: Activity[] = [
	{ id: 'eat', name: '吃顿饭', icon: '🍽️', minutes: 40, fx: { moodlet: 'well-fed', cash: -18, needs: { hunger: 55, fun: 4 } }, requires: { cash: 18 }, desc: '填饱肚子。' },
	{ id: 'forage', name: '野外找吃的', icon: '🌿', kinds: ['outback', 'park'], minutes: 90, fx: { needs: { hunger: 25, hygiene: -8 }, skills: { survival: 2 } }, desc: '不花钱，靠生存技巧。' },
	{ id: 'sleep-motel', name: '住旅馆', icon: '🛏️', kinds: ['city', 'port', 'town', 'coast', 'mining', 'island'], minutes: 480, fx: { moodlet: 'great-sleep', cash: -90, health: 15, needs: { energy: 100, hygiene: 40 } }, requires: { cash: 90 }, desc: '睡个整觉，顺便洗澡。' },
	{ id: 'sleep-camp', name: '露营过夜', icon: '⛺', minutes: 480, fx: { moodlet: 'camp-calm', health: 5, needs: { energy: 70, hygiene: -15, fun: 5 }, skills: { survival: 1.5 } }, desc: '免费。睡得不算舒服，但醒来看见满天星星，心里很静。' },
	{ id: 'shower', name: '洗澡', icon: '🚿', kinds: ['city', 'port', 'town', 'coast', 'mining', 'island'], minutes: 20, fx: { cash: -5, needs: { hygiene: 80 } }, requires: { cash: 5 }, desc: '公共淋浴。' },
	{ id: 'swim', name: '下海游泳', icon: '🏊', tags: ['beach'], minutes: 60, fx: { needs: { fun: 25, hygiene: 15, energy: -12 }, skills: { swimming: 2, stamina: 1 } }, desc: '印度洋的水，清澈见底。' },
	{ id: 'snorkel', name: '浮潜', icon: '🤿', tags: ['reef'], minutes: 120, fx: { moodlet: 'good-time', cash: -45, needs: { fun: 45, energy: -18 }, skills: { swimming: 3 }, respect: 1 }, requires: { cash: 45, skill: { swimming: 15 } }, hours: [7, 16], desc: '珊瑚礁浮潜，需要一点水性。' },
	{ id: 'surf', name: '冲浪', icon: '🏄', tags: ['surf'], minutes: 120, fx: { moodlet: 'good-time', needs: { fun: 40, energy: -25 }, skills: { stamina: 2.5, swimming: 1.5 }, respect: 1 }, requires: { skill: { swimming: 20 } }, hours: [5, 19], desc: '世界级浪点。' },
	{ id: 'gym', name: '健身', icon: '🏋️', tags: ['gym'], minutes: 90, fx: { cash: -12, needs: { energy: -20, hygiene: -15, fun: 5 }, skills: { strength: 3, stamina: 1.5 } }, requires: { cash: 12 }, hours: [5, 23], desc: '练力量。' },
	{ id: 'hike', name: '徒步探索', icon: '🥾', kinds: ['park', 'outback', 'coast', 'island'], minutes: 180, fx: { needs: { fun: 30, energy: -25, hygiene: -12 }, skills: { stamina: 2.5, survival: 2 }, respect: 1 }, desc: '用脚丈量这片土地。' },
	{ id: 'pub', name: '去酒吧坐坐', icon: '🍺', tags: ['pub'], minutes: 120, fx: { moodlet: 'good-time', cash: -30, needs: { social: 50, fun: 25, energy: -8 }, skills: { charisma: 2 } }, requires: { cash: 30 }, hours: [11, 24], desc: '和本地人聊聊。' },
	{ id: 'busk', name: '街头表演', icon: '🎸', kinds: ['city', 'port'], minutes: 120, fx: { cash: 35, needs: { social: 20, energy: -12 }, skills: { charisma: 2.5 } }, hours: [9, 21], desc: '赚点零钱，练练胆子。' },
	{ id: 'work-cafe', name: '咖啡店打工', icon: '☕', kinds: ['city', 'port', 'town', 'coast'], minutes: 240, fx: { cash: 110, needs: { energy: -22, fun: -12, social: 10 }, skills: { charisma: 1 } }, hours: [6, 18], desc: '时薪稳定的零工。' },
	{ id: 'work-mine', name: '矿场轮班', icon: '⛏️', kinds: ['mining'], minutes: 600, fx: { cash: 520, needs: { energy: -55, fun: -25, hygiene: -35 }, skills: { strength: 2, stamina: 1.5 } }, requires: { skill: { strength: 20 } }, desc: '又脏又累，但真赚钱。' },
	{ id: 'work-farm', name: '农场采摘', icon: '🍇', tags: ['wine'], minutes: 360, fx: { cash: 150, needs: { energy: -35, hygiene: -20 }, skills: { stamina: 2, strength: 1 } }, hours: [6, 16], desc: '背包客的经典零工。' },
	{ id: 'wine', name: '酒庄品酒', icon: '🍷', tags: ['wine'], minutes: 90, fx: { moodlet: 'good-time', cash: -40, needs: { fun: 35, social: 20 } }, requires: { cash: 40 }, hours: [10, 17], desc: '慢下来。' },
	{ id: 'market', name: '逛市集', icon: '🧺', tags: ['market'], minutes: 60, fx: { cash: -15, needs: { fun: 20, social: 15, hunger: 15 }, skills: { street: 1 } }, requires: { cash: 15 }, hours: [8, 14], desc: '砍价是一门手艺。' },
	{ id: 'clinic', name: '看医生', icon: '🏥', tags: ['hospital'], minutes: 60, fx: { cash: -80, health: 60 }, requires: { cash: 80 }, hours: [8, 20], desc: '恢复健康。' },
	{ id: 'charity-meal', name: '慈善午餐', icon: '🥣', kinds: ['city', 'port', 'town'], hours: [12, 13], minutes: 60, fx: { needs: { hunger: 50, social: 5, fun: -5 } }, desc: '教会和社区中心的免费午饭，只在中午开放。' },
	{ id: 'charity-dinner', name: '慈善晚餐', icon: '🍲', kinds: ['city', 'port', 'town'], hours: [18, 19], minutes: 60, fx: { needs: { hunger: 50, social: 5, fun: -5 } }, desc: '社区厨房的免费晚饭，傍晚开放。' },
	{ id: 'rest', name: '歇一会儿', icon: '☕', minutes: 60, fx: { needs: { energy: 4 } }, desc: '找个阴凉地方坐一小时，等上班或等店开门。' },
	{ id: 'lay-low', name: '低调几天', icon: '🕶️', minutes: 300, fx: { heat: -40, needs: { fun: -10, social: -10 } }, desc: '让麻烦值降下来。' },
];
