// 成就：只是里程碑展示，不发奖励、不进存档——由当前存档现算（core/achievements.ts）。
// 加一条成就只要选一个指标（metric）和目标值，不写针对单条成就的代码。
import type { AchievementDef } from '../core/achievements.ts';

export const ACHIEVEMENTS: AchievementDef[] = [
	{ id: 'explore-5', icon: '🧭', name: '出门看看', desc: '去过 5 个地方', metric: 'places', goal: 5 },
	{ id: 'explore-10', icon: '🗺️', name: '西澳半壁', desc: '去过 10 个地方', metric: 'places', goal: 10 },
	{ id: 'explore-all', icon: '🌏', name: '活地图', desc: '去过西澳全部地方', metric: 'places', goal: 'all-places' },
	{ id: 'checkin-5', icon: '📌', name: '打卡达人', desc: '本人到场打卡 5 个地点', metric: 'checkins', goal: 5 },
	{ id: 'collect-5', icon: '🎟️', name: '体验派', desc: '收藏 5 项体验', metric: 'collected', goal: 5 },
	{ id: 'collect-all', icon: '🏅', name: '收藏册满了', desc: '收藏全部体验', metric: 'collected', goal: 'all-experiences' },
	{ id: 'friend-1', icon: '🤝', name: '有个朋友', desc: '和 1 位当地人成为朋友', metric: 'friends', goal: 1 },
	{ id: 'friend-3', icon: '👥', name: '人缘不错', desc: '和 3 位当地人成为朋友', metric: 'friends', goal: 3 },
	{ id: 'bestie', icon: '💛', name: '挚友', desc: '和 1 位当地人成为挚友', metric: 'besties', goal: 1 },
	{ id: 'home', icon: '🏠', name: '有个家', desc: '租下或住进自己的住处', metric: 'home', goal: 1 },
	{ id: 'owner', icon: '🔑', name: '有房一族', desc: '拥有 1 套房产', metric: 'properties', goal: 1 },
	{ id: 'landlord', icon: '🏘️', name: '包租公', desc: '同时拥有 2 套房产', metric: 'properties', goal: 2 },
	{ id: 'top-job', icon: '💼', name: '做到头了', desc: '在一份工作里升到最高职位', metric: 'topJob', goal: 1 },
	{ id: 'worth-10k', icon: '💵', name: '小有积蓄', desc: '净资产达到 $10,000', metric: 'worth', goal: 10_000 },
	{ id: 'worth-100k', icon: '💰', name: '十万身家', desc: '净资产达到 $100,000', metric: 'worth', goal: 100_000 },
	{ id: 'level-5', icon: '⭐', name: '本地通', desc: '等级达到 5', metric: 'level', goal: 5 },
];
