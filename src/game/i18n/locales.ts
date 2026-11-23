// 多语言（第 38 批）：支持的语言、回退顺序。设计见 docs/earth-game/i18n.md。
// 这里和 strings/ 都是纯数据 + 纯函数：不碰 DOM、localStorage、Date.now()，core 和测试都能直接用。

export type Locale = 'zh-Hans' | 'zh-Hant' | 'en';

export const DEFAULT_LOCALE: Locale = 'zh-Hans';

export interface LocaleMeta {
	/** 设置页里显示的名字，永远用这门语言自己写（玩家看不懂当前语言时也能找到自己的） */
	label: string;
	/** <html lang> 和 Intl 用的 BCP 47 标签 */
	tag: string;
	/** 找不到这门语言的文案时依次去哪找；最后一定落到 DEFAULT_LOCALE */
	fallback: Locale[];
}

export const LOCALES: Record<Locale, LocaleMeta> = {
	'zh-Hans': { label: '简体中文', tag: 'zh-CN', fallback: [] },
	'zh-Hant': { label: '繁體中文', tag: 'zh-TW', fallback: ['zh-Hans'] },
	en: { label: 'English', tag: 'en-AU', fallback: ['zh-Hans'] },
};

/** 设置页语言选项的顺序 */
export const LOCALE_ORDER: Locale[] = ['zh-Hans', 'zh-Hant', 'en'];

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && Object.hasOwn(LOCALES, v);
