// 本机显示设置（第 28 轮）：动画、字号、提示开关。只存在这台设备的 localStorage 里，不进存档、不上传。
// 读进来的内容一律当不可信数据：不认识的值退回默认，旧版「大字模式」开关迁移成字号「大」。
// 界面语言（第 38 批）也存在这里：语言是这台设备的显示偏好，不进存档（见 docs/earth-game/i18n.md §4）。

import { DEFAULT_LOCALE, isLocale, type Locale, type StrKey } from '../i18n/index.ts';
import type { VisualMode } from './visual.ts';

export type Motion = 'auto' | 'reduce' | 'full';
export type FontSize = 'm' | 'l' | 'xl';
export type VolumeLevel = 'low' | 'mid' | 'high';

export interface Prefs {
	motion: Motion; // 动画：跟随系统 / 减少 / 正常
	font: FontSize; // 字号：标准 / 大 / 特大
	guide: boolean; // 显示新手指南
	recap: boolean; // 显示昨天回顾
	achToast: boolean; // 达成成就时弹出提示
	sound: boolean; // 音效（体验改造 P2 起默认开，用户 2026-11-21 定；第一次点页面后才出声）
	ambience: boolean; // 环境音：海浪、城市、风、雨（v37，默认关）
	music: boolean; // 背景音乐（v37，默认关）
	volume: VolumeLevel; // 总音量（v37）：轻 / 中 / 响；P2 起默认「轻」
	basemap: boolean; // 出行页用真实地图（第 31 轮，默认开）
	haptic: boolean; // 做事成功、失败时手机轻震（体验改造 P1，默认开；只有安卓浏览器支持）
	lang: Locale; // 界面语言（第 38 批，默认简体中文）
	visual: VisualMode; // 画面档（体验改造 P3）：跟随系统 / 标准 / 省电 / 省流量，默认跟随系统（见 ui/visual.ts）
}

export const PREFS_KEY = 'earth.prefs.v1';
/** 旧版设置：大字模式开关（'1' 为开） */
export const LEGACY_BIG_KEY = 'earth.big.v1';

export const DEFAULT_PREFS: Prefs = { motion: 'auto', font: 'm', guide: true, recap: true, achToast: true, sound: true, ambience: false, music: false, volume: 'low', basemap: true, haptic: true, lang: DEFAULT_LOCALE, visual: 'auto' };

// 第二项是字符串表的键（第 38 批），显示时用 t() 取当前语言的文字
export const MOTION_OPTIONS: [Motion, StrKey][] = [['auto', 'pref.motion.auto'], ['reduce', 'pref.motion.reduce'], ['full', 'pref.motion.full']];
export const FONT_OPTIONS: [FontSize, StrKey][] = [['m', 'pref.font.m'], ['l', 'pref.font.l'], ['xl', 'pref.font.xl']];
export const VISUAL_OPTIONS: [VisualMode, StrKey][] = [['auto', 'pref.visual.auto'], ['standard', 'pref.visual.standard'], ['battery', 'pref.visual.battery'], ['data', 'pref.visual.data']];
export const VOLUME_OPTIONS: [VolumeLevel, StrKey][] = [['low', 'pref.volume.low'], ['mid', 'pref.volume.mid'], ['high', 'pref.volume.high']];
export const TIP_OPTIONS: [keyof Pick<Prefs, 'guide' | 'recap' | 'achToast'>, string, string][] = [
	['guide', '新手指南', '前三天在今天页顶上的分步提示'],
	['recap', '昨天回顾', '跨过一天后在今天页顶上显示前一天的变化'],
	['achToast', '成就提示', '达成成就时在屏幕底部弹出一句'],
];

const pick = <T extends string>(v: unknown, opts: [T, unknown][], d: T): T => (opts.some(([k]) => k === v) ? (v as T) : d);
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
		sound: bool(own('sound'), DEFAULT_PREFS.sound),
		ambience: bool(own('ambience'), DEFAULT_PREFS.ambience),
		music: bool(own('music'), DEFAULT_PREFS.music),
		volume: pick(own('volume'), VOLUME_OPTIONS, DEFAULT_PREFS.volume),
		basemap: bool(own('basemap'), DEFAULT_PREFS.basemap),
		haptic: bool(own('haptic'), DEFAULT_PREFS.haptic),
		lang: isLocale(own('lang')) ? (own('lang') as Locale) : DEFAULT_PREFS.lang,
		visual: pick(own('visual'), VISUAL_OPTIONS, DEFAULT_PREFS.visual),
	};
}

/** 要不要减少动画：选了「跟随系统」时看系统的减少动态效果设置；presetCalm 是画面档要求的（省电、省流量档），动画明确设成「正常」时听玩家的 */
export const calmMotion = (p: Prefs, systemReduce: boolean, presetCalm = false) => p.motion === 'reduce' || (p.motion === 'auto' && (systemReduce || presetCalm));
