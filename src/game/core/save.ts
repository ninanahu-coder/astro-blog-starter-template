// 存档格式版本、迁移、未知字段保留（第 50 批）。规范见 docs/earth-game/save-sync.md §5「给 PlayerState 加字段的规范」。
// 纯函数：不碰存储和时间，服务端和页面都能用。
//
// 为什么要保留未知字段：任何分支推送都会直接部署到正式环境，正式环境的代码会在几个分支之间来回切换。
// 分支 A 给存档加了 pets，分支 B 的代码没有这个字段：如果 B 结算动作时按自己的 sanitizeState 重写存档，
// A 的玩家养的宠物就被删掉了。所以服务端落盘时把「这版代码不认识的顶层字段」原样带上，等认识它的代码回来再校验。

/** 这版代码写出的存档格式版本。只有改了已有字段的形状（不是加新字段）才加一，并在 MIGRATIONS 里补一步 */
export const SAVE_VERSION = 1;

/**
 * 迁移表：MIGRATIONS[n] 把 v=n 的存档变成 v=n+1。必须是纯函数、不改入参、可以重复执行（幂等）：
 * 回滚过的存档可能被旧代码改过一部分，再升级时又跑一遍。例子见 save-sync.md §5.3。
 */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** 已经删掉、不要再保留的旧字段（删字段时登记在这里，不然会被当成「别的分支的新字段」一直带着） */
export const RETIRED_KEYS: readonly string[] = [];

/** 未知字段的上限：最多这么多个、序列化后总长不超过这么多字符，超了整批不带（防止坏数据把存档撑大） */
export const FOREIGN_MAX_KEYS = 32;
export const FOREIGN_MAX_CHARS = 16 * 1024;
const FOREIGN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 读存档的第一步：认格式版本，旧版本按迁移表一步步升上来。
 * - 没有版本号、版本号不是正整数：不是存档，返回 null
 * - 比这版代码新（回滚、或者正式环境切到了旧分支）：不判损坏，按现在的格式尽量读（新字段由 carryUnknown 保留）
 * 返回的是新对象，不改入参。
 */
export function migrateSave(raw: unknown, target = SAVE_VERSION, steps = MIGRATIONS): Record<string, unknown> | null {
	if (!isObj(raw)) return null;
	const v = raw.v;
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null;
	let r: Record<string, unknown> = { ...raw };
	for (let n = v; n < target; n++) {
		const step = Object.hasOwn(steps, n) ? steps[n] : undefined;
		if (!step) return null; // 缺一步迁移：宁可报损坏，不按错的格式读
		r = { ...step(r), v: n + 1 };
	}
	return r;
}

/**
 * 落盘用的存档：清洗后的 clean，加上原存档里这版代码不认识的顶层字段（原样），版本号取两者较大的。
 * 只有服务端落盘时用；发给客户端的仍是 publicState(clean)，不带未知字段。
 * 认识的字段一律以 clean 为准（未知字段不能盖掉它们）；RETIRED_KEYS、奇怪的键名、超限的整批丢掉。
 */
export function carryUnknown<T extends object>(raw: unknown, clean: T): T {
	if (!isObj(raw)) return clean;
	const known = new Set(Object.keys(clean));
	const foreign: Record<string, unknown> = {};
	let n = 0;
	for (const k of Object.keys(raw)) {
		if (known.has(k) || !FOREIGN_KEY.test(k) || RETIRED_KEYS.includes(k)) continue;
		const val = raw[k];
		if (val === undefined || typeof val === 'function') continue;
		foreign[k] = val;
		if (++n > FOREIGN_MAX_KEYS) return withVersion(raw, clean);
	}
	if (!n) return withVersion(raw, clean);
	let size = 0;
	try {
		size = JSON.stringify(foreign).length;
	} catch {
		return withVersion(raw, clean);
	}
	if (size > FOREIGN_MAX_CHARS) return withVersion(raw, clean);
	return withVersion(raw, { ...foreign, ...clean } as T);
}

/** 版本号不倒退：比这版代码新的存档落盘后还是新版本号，新代码回来时不会把它当旧档再迁移一遍 */
function withVersion<T extends object>(raw: Record<string, unknown>, out: T): T {
	const rv = raw.v;
	const cv = (out as Record<string, unknown>).v;
	if (typeof rv === 'number' && Number.isInteger(rv) && typeof cv === 'number' && rv > cv) return { ...out, v: rv };
	return out;
}
