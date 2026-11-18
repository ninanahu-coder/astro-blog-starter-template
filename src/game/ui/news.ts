// 「我 · 更新」页的已读记录（第 48 轮）：本机只记看过的最新批次号。本机存储当不可信数据：不是 0 到最新批次号之间的整数一律当没看过。
import { CHANGELOG, CHANGELOG_LATEST } from '../data/changelog.ts';

export const NEWS_SEEN_KEY = 'earth.news.v1';

export function parseNewsSeen(raw: string | null): number {
	const n = raw === null ? NaN : Number(raw);
	return Number.isInteger(n) && n >= 0 && n <= CHANGELOG_LATEST ? n : 0;
}

/** 没看过的批次数 */
export const unseenNews = (seen: number) => CHANGELOG.filter((e) => e.v > seen).length;
