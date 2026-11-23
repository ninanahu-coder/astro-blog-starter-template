// t()：按语言取界面文案，按 LOCALES[x].fallback 回退，最后回到简体中文。
// 返回纯文本，不做 HTML 转义；拼进 innerHTML 时必须经过 esc()（earth.astro 里统一用 tx()，它包了 esc）。
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locales.ts';
import { ZH_HANS, type StrKey } from './strings/zh-Hans.ts';
import { ZH_HANT } from './strings/zh-Hant.ts';
import { EN } from './strings/en.ts';

export { DEFAULT_LOCALE, LOCALE_ORDER, LOCALES, isLocale, type Locale } from './locales.ts';
export type { StrKey } from './strings/zh-Hans.ts';

/** 每门语言的表；简体中文是基准，必须齐全（类型上保证），其他语言缺键时按回退链补 */
export const TABLES: Record<Locale, Partial<Record<StrKey, string>>> = { 'zh-Hans': ZH_HANS, 'zh-Hant': ZH_HANT, en: EN };

/** 必须翻全的语言：测试里缺一个键就失败。新语言先不放进来，翻完再加 */
export const COMPLETE_LOCALES: Locale[] = ['zh-Hans', 'zh-Hant', 'en'];

export type Params = Record<string, string | number>;

/** 文案里的占位符名，去重后排序 */
export const placeholders = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** 取原文（不填占位符），按回退链找；全都找不到返回 null */
export function lookup(locale: Locale, key: StrKey): string | null {
	for (const l of [locale, ...LOCALES[locale].fallback, DEFAULT_LOCALE]) {
		const s = TABLES[l]?.[key];
		if (typeof s === 'string') return s;
	}
	return null;
}

/** 填占位符：缺参数时保留 {name} 原样，让漏传在界面上看得出来，而不是静默变成空字符串 */
export function fill(s: string, params: Params = {}): string {
	return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : m));
}

/** 取文案；键不存在（只可能是运行时拼出来的键）时返回键名本身 */
export function t(locale: Locale, key: StrKey, params?: Params): string {
	const s = lookup(locale, key);
	return s === null ? key : fill(s, params);
}

/** 绑定语言的 t */
export const createT = (locale: Locale) => (key: StrKey, params?: Params) => t(locale, key, params);
