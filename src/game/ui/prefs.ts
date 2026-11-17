// 本机显示设置（第 28 轮）：动画、字号、提示开关。只存在这台设备的 localStorage 里，不进存档、不上传。
// 读进来的内容一律当不可信数据：不认识的值退回默认，旧版「大字模式」开关迁移成字号「大」。

export type Motion = 'auto' | 'reduce' | 'full';
export type FontSize = 'm' | 'l' | 'xl';

export interface Prefs {
	motion: Motion; // 动画：跟随系统 / 减少 / 正常
	font: FontSize; // 字号：标准 / 大 / 特大
	guide: boolean; // 显示新手指南
	recap: boolean; // 显示昨天回顾
	achToast: boolean; // 达成成就时弹出提示
}

export const PREFS_KEY = 'earth.prefs.v1';
/** 旧版设置：大字模式开关（'1' 为开） */
export const LEGACY_BIG_KEY = 'earth.big.v1';

export const DEFAULT_PREFS: Prefs = { motion: 'auto', font: 'm', guide: true, recap: true, achToast: true };

export const MOTION_OPTIONS: [Motion, string][] = [['auto', '跟随系统'], ['reduce', '减少'], ['full', '正常']];
export const FONT_OPTIONS: [FontSize, string][] = [['m', '标准'], ['l', '大'], ['xl', '特大']];
export const TIP_OPTIONS: [keyof Pick<Prefs, 'guide' | 'recap' | 'achToast'>, string, string][] = [
	['guide', '新手指南', '前三天在今天页顶上的分步提示'],
	['recap', '昨天回顾', '跨过一天后在今天页顶上显示前一天的变化'],
	['achToast', '成就提示', '达成成就时在屏幕底部弹出一句'],
];

const pick = <T extends string>(v: unknown, opts: [T, string][], d: T): T => (opts.some(([k]) => k === v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** 从本机存储读出设置；raw 是 PREFS_KEY 的内容，legacy 是旧版大字模式键的内容（只在还没有新设置时用来迁移） */
export function parsePrefs(raw: string | null, legacy: { big?: string | null } = {}): Prefs {
	let o: Record<string, unknown> | null = null;
	if (raw) {
		try {
			const v = JSON.parse(raw);
			if (v && typeof v === 'object' && !Array.isArray(v)) o = v;
		} catch {}
	}
	if (!o) return { ...DEFAULT_PREFS, font: legacy.big === '1' ? 'l' : 'm' };
	const own = (k: string) => (Object.hasOwn(o!, k) ? o![k] : undefined);
	return {
		motion: pick(own('motion'), MOTION_OPTIONS, DEFAULT_PREFS.motion),
		font: pick(own('font'), FONT_OPTIONS, DEFAULT_PREFS.font),
		guide: bool(own('guide'), DEFAULT_PREFS.guide),
		recap: bool(own('recap'), DEFAULT_PREFS.recap),
		achToast: bool(own('achToast'), DEFAULT_PREFS.achToast),
	};
}

/** 要不要减少动画：选了「跟随系统」时看系统的减少动态效果设置 */
export const calmMotion = (p: Prefs, systemReduce: boolean) => p.motion === 'reduce' || (p.motion === 'auto' && systemReduce);
