// 做饭存档字段 cooking 的初始值和清洗（save-sync.md §5.1）。单独成文件，不引用 engine.ts，避免和 character.ts 循环引用。
import { INGREDIENTS, PANTRY_MAX, PANTRY_ROWS, RECIPES } from '../data/cooking.ts';
import type { Cooking, PantryRow } from './types.ts';

export const newCooking = (): Cooking => ({ xp: 0, made: {}, pantry: [], hostDay: -1 });

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const own = (o: unknown, k: string): unknown => (o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/** 食材最长保质期（分钟）：清洗时过期时间不能超过「现在 + 最长保质期 + 一天」 */
const MAX_SHELF = (Math.max(...INGREDIENTS.map((i) => i.days)) + 1) * 1440;

/**
 * 清洗不可信的 cooking 字段。clock 是清洗后的存档时钟。
 * 旧存档没有这个字段 → 初始值；坏值丢掉；食材按已知 id 过滤、合计不超过 PANTRY_MAX；做过次数只留已知食谱。幂等。
 */
export function cleanCooking(raw: unknown, clock: number): Cooking {
	const out = newCooking();
	const xp = own(raw, 'xp');
	if (fin(xp)) out.xp = Math.max(0, Math.min(100, xp));
	const made = own(raw, 'made');
	for (const r of RECIPES) {
		const n = own(made, r.id);
		if (fin(n) && n >= 1) out.made[r.id] = Math.min(1e6, Math.floor(n));
	}
	const hd = own(raw, 'hostDay');
	// 请客日不能晚于今天
	if (fin(hd)) out.hostDay = Math.floor(Math.max(-1, Math.min(Math.floor(clock / 1440), hd)));
	const pantry = own(raw, 'pantry');
	let total = 0;
	const rows: PantryRow[] = [];
	for (const row of Array.isArray(pantry) ? pantry.slice(0, PANTRY_ROWS) : []) {
		const id = own(row, 'id');
		const n = own(row, 'n');
		const exp = own(row, 'exp');
		if (typeof id !== 'string' || !INGREDIENTS.some((i) => i.id === id) || !fin(n) || !fin(exp)) continue;
		const k = Math.min(Math.floor(n), PANTRY_MAX - total);
		if (k < 1) continue;
		total += k;
		rows.push({ id, n: k, exp: Math.floor(Math.max(0, Math.min(exp, clock + MAX_SHELF))) });
	}
	out.pantry = rows;
	return out;
}
