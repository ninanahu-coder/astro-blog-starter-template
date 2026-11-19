// 带时限的心情状态：做过的事留下几小时到几天的心情加减。
// 同一种状态再次触发时刷新时长，不叠加。来源有两种：
//   1. 效果里写 moodlet（活动、事件结果等数据）
//   2. 引擎在固定时刻发放（升职、晕倒、被收房、交到朋友……），见 engine.ts 里的 addMoodlet 调用
//   3. 每个游戏日结算一次的心事（孤独、思乡、压力），见 core/mind.ts 和 data/mind.ts
// relieves：获得时清掉列出的心事；生效期间心事也不会再触发（第 43 批，待平衡）
import type { MoodletDef } from '../core/types.ts';

export const MOODLETS: MoodletDef[] = [
	// 正面
	{ id: 'well-fed', name: '吃得很满足', icon: '🍽️', value: 4, hours: 6 },
	{ id: 'fine-dining', name: '吃了顿大餐', icon: '🥂', value: 8, hours: 12 },
	{ id: 'pumped', name: '练完很精神', icon: '💪', value: 4, hours: 6, relieves: ['stressed'] },
	{ id: 'focused', name: '专注', icon: '🎯', value: 3, hours: 6, gain: 1.25 },
	{ id: 'great-sleep', name: '睡了个好觉', icon: '😴', value: 6, hours: 12, relieves: ['stressed'] },
	{ id: 'first-visit', name: '新地方的新鲜感', icon: '🧭', value: 4, hours: 12 },
	{ id: 'wish-done', name: '心愿达成', icon: '✨', value: 5, hours: 8 },
	{ id: 'good-time', name: '玩得很开心', icon: '🎉', value: 5, hours: 8, relieves: ['lonely', 'stressed'] },
	{ id: 'festival', name: '节日气氛', icon: '🏮', value: 8, hours: 24, relieves: ['lonely'] },
	{ id: 'experience', name: '难忘的经历', icon: '🌟', value: 10, hours: 48, relieves: ['stressed'] },
	{ id: 'new-friend', name: '交了新朋友', icon: '🤝', value: 8, hours: 72, relieves: ['lonely'] },
	{ id: 'best-friend', name: '有了一位挚友', icon: '💛', value: 12, hours: 120, relieves: ['lonely'] },
	{ id: 'gift-loved', name: '礼物送到了心坎上', icon: '🎁', value: 4, hours: 8, relieves: ['lonely'] },
	{ id: 'warm-moment', name: '被人照顾了一下', icon: '☕', value: 4, hours: 12, relieves: ['lonely'] },
	{ id: 'promoted', name: '升职了', icon: '📈', value: 12, hours: 72 },
	{ id: 'new-home', name: '乔迁之喜', icon: '🏡', value: 10, hours: 72 },
	// 第 43 批：主动调节心情（core/mind.ts 的 mindAction），待平衡
	{ id: 'called-home', name: '和家里视频了', icon: '📱', value: 5, hours: 24, relieves: ['homesick'] },
	{ id: 'talked-it-out', name: '说出来好多了', icon: '💬', value: 4, hours: 24, relieves: ['lonely', 'stressed', 'homesick'] },
	// 负面
	{ id: 'rough-night', name: '没睡好', icon: '🥱', value: -2, hours: 8 }, // 第七轮起露营改给 camp-calm；保留定义，旧存档里的状态照常显示到过期
	{ id: 'camp-calm', name: '星空下醒来', icon: '🌌', value: 10, hours: 24, relieves: ['stressed'] }, // 露营专属（第七轮平衡：替代「没睡好」，托住穷角色的心情）
	{ id: 'gift-awkward', name: '送错了礼物', icon: '😅', value: -3, hours: 6 },
	{ id: 'sore', name: '肌肉酸痛', icon: '🦵', value: -3, hours: 12 },
	{ id: 'hurt', name: '受了点伤', icon: '🩹', value: -6, hours: 24 },
	{ id: 'in-trouble', name: '惹上了麻烦', icon: '😬', value: -6, hours: 24 },
	{ id: 'collapsed', name: '刚从医院出来', icon: '🏥', value: -12, hours: 48 },
	{ id: 'evicted', name: '被赶出了家门', icon: '📦', value: -15, hours: 72 },
	// 第 43 批：心事（每个游戏日按 data/mind.ts 的条件结算一次，见 core/mind.ts），待平衡
	{ id: 'lonely', name: '有点孤单', icon: '🌧️', value: -5, hours: 24 },
	{ id: 'homesick', name: '想家', icon: '🌙', value: -5, hours: 24 },
	{ id: 'stressed', name: '压力有点大', icon: '😣', value: -5, hours: 24 },
];

/** 存档里最多保留的状态数 */
export const MOODLET_MAX = 12;
