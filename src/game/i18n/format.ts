// 数字、金额、游戏内时间、现实日期的本地化格式（第 38 批）。纯函数：现实时间由调用方传入毫秒数。
import { LOCALES, type Locale } from './locales.ts';
import { t } from './index.ts';

/** 金额一律是澳元。各语言都写 $1,234（游戏里只有澳元，不写 A$ / AUD / 澳元）；负数写 −$12 */
export function fmtMoney(n: number, locale: Locale): string {
	const abs = Math.abs(Math.round(n));
	const body = new Intl.NumberFormat(LOCALES[locale].tag, { maximumFractionDigits: 0 }).format(abs);
	return `${n < 0 && abs ? '−' : ''}$${body}`;
}

/** 普通数字：千位分隔，最多保留 digits 位小数 */
export function fmtNumber(n: number, locale: Locale, digits = 0): string {
	return new Intl.NumberFormat(LOCALES[locale].tag, { maximumFractionDigits: digits }).format(n);
}

/** 游戏内时钟（分钟数，从第 1 天 00:00 起）。和 core/character.ts 的 formatClock 同一套算法，只是文案随语言换 */
export function fmtGameClock(clock: number, locale: Locale): string {
	const day = Math.floor(clock / 1440) + 1;
	const m = Math.floor(clock % 1440);
	const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	return t(locale, 'clock.day', { day, time });
}

/** 区域对应的时区：西澳全年 UTC+8，没有夏令时；南澳 UTC+9:30，夏令时（10 月第一个周日到 4 月第一个周日）+10:30 */
export const REGION_TZ: Record<string, string> = { wa: 'Australia/Perth', sa: 'Australia/Adelaide' };

/** 现实日期时间（聊天、留言、挂单这类真实时刻），按区域的时区显示；不认识的区域按珀斯 */
export function fmtRealDateTime(ms: number, locale: Locale, region: string): string {
	return new Intl.DateTimeFormat(LOCALES[locale].tag, {
		timeZone: Object.hasOwn(REGION_TZ, region) ? REGION_TZ[region] : REGION_TZ.wa,
		year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	}).format(ms);
}
