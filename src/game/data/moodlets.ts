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
	{ id: 'race-podium', name: '站上领奖台', icon: '🏆', value: 10, hours: 24, relieves: ['stressed'] },
	{ id: 'race-finish', name: '跑完全程', icon: '🏅', value: 6, hours: 12, relieves: ['stressed'] },
	{ id: 'pumped', name: '练完很精神', icon: '💪', value: 4, hours: 6, relieves: ['stressed'] },
	{ id: 'focused', name: '专注', icon: '🎯', value: 3, hours: 6, gain: 1.25 },
	{ id: 'great-sleep', name: '睡了个好觉', icon: '😴', value: 6, hours: 12, relieves: ['stressed'] },
	{ id: 'first-visit', name: '新地方的新鲜感', icon: '🧭', value: 4, hours: 12 },
	{ id: 'wish-done', name: '心愿达成', icon: '✨', value: 5, hours: 8 },
	{ id: 'hobby-flow', name: '沉浸在爱好里', icon: '🎨', value: 4, hours: 8, relieves: ['stressed'] }, // 当天第一次做某个爱好（待平衡）
	{ id: 'good-time', name: '玩得很开心', icon: '🎉', value: 5, hours: 8, relieves: ['lonely', 'stressed'] },
	{ id: 'festival', name: '节日气氛', icon: '🏮', value: 8, hours: 24, relieves: ['lonely'] },
	{ id: 'experience', name: '难忘的经历', icon: '🌟', value: 10, hours: 48, relieves: ['stressed'] },
	{ id: 'new-friend', name: '交了新朋友', icon: '🤝', value: 8, hours: 72, relieves: ['lonely'] },
	{ id: 'best-friend', name: '有了一位挚友', icon: '💛', value: 12, hours: 120, relieves: ['lonely'] },
	{ id: 'confidant', name: '有了一位知己', icon: '🫶', value: 10, hours: 120, relieves: ['lonely', 'homesick'] }, // 第 29 批，待平衡
	{ id: 'heart-to-heart', name: '说了会儿心里话', icon: '🍵', value: 5, hours: 24, relieves: ['lonely', 'homesick'] }, // 第 29 批，待平衡
	{ id: 'gift-loved', name: '礼物送到了心坎上', icon: '🎁', value: 4, hours: 8, relieves: ['lonely'] },
	{ id: 'warm-moment', name: '被人照顾了一下', icon: '☕', value: 4, hours: 12, relieves: ['lonely'] },
	{ id: 'promoted', name: '升职了', icon: '📈', value: 12, hours: 72 },
	{ id: 'vitamins', name: '吃了维生素', icon: '💊', value: 2, hours: 72, regen: 2 }, // 第 23 批，待平衡
	{ id: 'new-home', name: '乔迁之喜', icon: '🏡', value: 10, hours: 72 },
	// 第 43 批：主动调节心情（core/mind.ts 的 mindAction），待平衡
	{ id: 'called-home', name: '和家里视频了', icon: '📱', value: 5, hours: 24, relieves: ['homesick'] },
	{ id: 'talked-it-out', name: '说出来好多了', icon: '💬', value: 4, hours: 24, relieves: ['lonely', 'stressed', 'homesick'] },
	{ id: 'pet-cuddle', name: '陪宠物玩了一会儿', icon: '🐾', value: 5, hours: 8, relieves: ['lonely', 'stressed'] }, // v31 宠物，数值待平衡
	{ id: 'dog-walk', name: '遛完狗神清气爽', icon: '🦮', value: 5, hours: 8, relieves: ['stressed'] }, // v31 宠物，数值待平衡
	{ id: 'new-pet', name: '家里多了一位成员', icon: '🏠', value: 10, hours: 72, relieves: ['lonely'] }, // v31 宠物，数值待平衡
	// 做饭分支新增（数值待平衡）
	{ id: 'home-cooked', name: '吃上了自己做的饭', icon: '🍳', value: 5, hours: 8 },
	{ id: 'taste-of-home', name: '家乡的味道', icon: '🥢', value: 6, hours: 12, relieves: ['homesick'] },
	{ id: 'hosted', name: '请朋友吃了顿饭', icon: '🍽️', value: 8, hours: 24, relieves: ['lonely'] },
	{ id: 'flat-harmony', name: '室友相处融洽', icon: '🏠', value: 5, hours: 24, relieves: ['lonely'] }, // 室友系统；合并 main 后：和室友处得好能缓解孤单（待平衡）
	{ id: 'trip-glow', name: '旅行回来', icon: '🧳', value: 8, hours: 48, relieves: ['stressed'] }, // 第 43 批：跨州旅行回来；合并 main 后：出去玩一趟能缓解压力（待平衡）
	{ id: 'family-time', name: '见到了家人', icon: '🏮', value: 12, hours: 96, relieves: ['homesick', 'lonely'] }, // 第 43 批：回国探亲回来；合并 main 后：见到家人缓解想家和孤单（待平衡）
	// 负面
	{ id: 'rough-night', name: '没睡好', icon: '🥱', value: -2, hours: 8 }, // 第七轮起露营改给 camp-calm；时间和睡眠（v89）起睡眠质量低于 0.75 的一觉会挂它（白天睡、城里露营等）
	{ id: 'camp-calm', name: '星空下醒来', icon: '🌌', value: 10, hours: 24, relieves: ['stressed'] }, // 露营专属（第七轮平衡：替代「没睡好」，托住穷角色的心情）
	{ id: 'gift-awkward', name: '送错了礼物', icon: '😅', value: -3, hours: 6 },
	{ id: 'sore', name: '肌肉酸痛', icon: '🦵', value: -3, hours: 12 },
	{ id: 'hurt', name: '受了点伤', icon: '🩹', value: -6, hours: 24 },
	{ id: 'in-trouble', name: '惹上了麻烦', icon: '😬', value: -6, hours: 24 },
	{ id: 'sick-mild', name: '身体不太舒服', icon: '🤧', value: -5, hours: 96 }, // 感冒、扭伤（第 1 版健康系统，待平衡）；时长跟病程走，见 core/health.ts
	{ id: 'sick-bad', name: '病得难受', icon: '🤒', value: -10, hours: 120 }, // 流感、肠胃炎、热衰竭（待平衡）
	{ id: 'sleep-debt', name: '熬夜没缓过来', icon: '🫠', value: -5, hours: 12 }, // 第 43 批：醒来时睡眠债还多（待平衡）
	{ id: 'collapsed', name: '刚从医院出来', icon: '🏥', value: -12, hours: 48 },
	{ id: 'evicted', name: '被赶出了家门', icon: '📦', value: -15, hours: 72 },
	// 第 43 批：心事（每个游戏日按 data/mind.ts 的条件结算一次，见 core/mind.ts），待平衡
	{ id: 'lonely', name: '有点孤单', icon: '🌧️', value: -5, hours: 24 },
	{ id: 'homesick', name: '想家', icon: '🌙', value: -5, hours: 24 },
	{ id: 'stressed', name: '压力有点大', icon: '😣', value: -5, hours: 24 },
	{ id: 'scammed', name: '被骗租了', icon: '🪤', value: -10, hours: 48 }, // 租房市场（待平衡）
	{ id: 'debt-collection', name: '被催收', icon: '📞', value: -6, hours: 168 }, // 银行欠款违约后每周刷新（banking.md，待平衡）
	// 室友系统（数值待平衡）
	{ id: 'flat-noisy', name: '被室友吵到了', icon: '🔊', value: -4, hours: 10 },
	{ id: 'flat-annoyed', name: '有点憋屈', icon: '😤', value: -2, hours: 8 },
	{ id: 'flat-messy', name: '家里乱糟糟', icon: '🧺', value: -4, hours: 12 },
	{ id: 'jetlag', name: '倒时差', icon: '🥴', value: -4, hours: 24 }, // 第 43 批：时差 ≥ 2 小时的旅行回来（待平衡）
];

/** 存档里最多保留的状态数 */
export const MOODLET_MAX = 12;
