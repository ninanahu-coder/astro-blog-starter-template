// 火险提示去重（第 8 批审查问题 2）：「极端」「灾难性」火险每个地点每个游戏日只弹一次，记在本机，重新载入、来回走动都不重复弹。
// 本机存储当不可信数据：只认「地点id@游戏日」格式的字符串，最多记最近 FIRE_SEEN_MAX 个。

export const FIRE_SEEN_KEY = 'earth.fire.v1';
export const FIRE_SEEN_MAX = 20;
const KEY_RE = /^[a-z0-9-]{1,40}@\d{1,7}$/;

export const fireKey = (loc: string, day: number) => `${loc}@${day}`;

export function parseFireSeen(raw: string | null): string[] {
	let v: unknown = null;
	try { v = raw ? JSON.parse(raw) : null; } catch {}
	if (!Array.isArray(v)) return [];
	return [...new Set(v.filter((x): x is string => typeof x === 'string' && KEY_RE.test(x)))].slice(-FIRE_SEEN_MAX);
}

/** 记下一个已提示的；返回新的列表（原列表不变） */
export function addFireSeen(seen: string[], key: string): string[] {
	if (!KEY_RE.test(key)) return seen;
	return [...seen.filter((k) => k !== key), key].slice(-FIRE_SEEN_MAX);
}

/** 火险提示的文字：写明是游戏估算、不是真实预警，指向真实来源 */
export const fireToastText = (levelName: string, advice: string) =>
	`🔥 今天这里火险${levelName}（游戏里的估算，不是真实预警）：${advice}真实火情请看西澳应急服务 Emergency WA。`;
