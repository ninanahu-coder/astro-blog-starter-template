// 副业与小生意的存档字段 biz：新建角色的初值和清洗（规范见 docs/earth-game/save-sync.md §5）。
// 单独成文件、只依赖数据表，character.ts 只加一行调用，避免和 engine.ts 循环引用。
import { GIGS, LICENSES, SHOP_RULES, SHOP_SITES, SHOP_TYPES } from '../data/business.ts';
import type { Business, ShopState } from './types.ts';

export const emptyBiz = (): Business => ({ lic: {}, gigs: {}, gst: false, book: { y: 1, gross: 0, net: 0 }, shop: null });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
const int = (v: unknown, lo: number, hi: number, dflt: number) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.min(hi, Math.max(lo, v))) : dflt;
const MONEY = 1e9;

/** 只留已知 id、日期不晚于今天的「id -> 游戏日」表 */
function dayMap(raw: unknown, known: string[], today: number): Record<string, number> {
	const out: Record<string, number> = {};
	if (!isObj(raw)) return out;
	for (const id of known) {
		const d = own(raw, id);
		if (typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= today) out[id] = Math.floor(d);
	}
	return out;
}

function cleanShop(raw: unknown, today: number): ShopState | null {
	if (!isObj(raw)) return null;
	const type = SHOP_TYPES.find((t) => t.id === own(raw, 'type'));
	const site = SHOP_SITES.find((x) => x.id === own(raw, 'site'));
	if (!type || !site) return null;
	const day = int(own(raw, 'day'), 0, today, today);
	// 已结算到的那天：不早于开业前一天、不晚于昨天（今天还没过完，不会结算）
	const last = int(own(raw, 'last'), day - 1, Math.max(day - 1, today - 1), day - 1);
	const hist = Array.isArray(raw.hist)
		? raw.hist
				.filter((h): h is Record<string, unknown> => isObj(h) && typeof h.d === 'number' && Number.isFinite(h.d) && h.d >= day && h.d <= last)
				.slice(-SHOP_RULES.histDays)
				.map((h) => ({ d: Math.floor(h.d as number), sold: int(h.sold, 0, 1e6, 0), net: int(h.net, -MONEY, MONEY, 0) }))
		: [];
	return {
		type: type.id,
		site: site.id,
		day,
		last,
		stock: int(own(raw, 'stock'), 0, type.maxStock, 0),
		staff: int(own(raw, 'staff'), 0, SHOP_RULES.maxStaff, 0),
		tend: (() => {
			const t = int(own(raw, 'tend'), -1, today, -1);
			return t > last ? t : -1; // 已经结算过的看店日没有用了
		})(),
		rep: int(own(raw, 'rep'), 0, 100, SHOP_RULES.repStart),
		debt: int(own(raw, 'debt'), 0, MONEY, 0),
		bond: int(own(raw, 'bond'), 0, MONEY, 0),
		hist,
	};
}

/**
 * 清洗存档里的 biz：旧存档没有这个字段时给空值；任何坏值都不抛异常；幂等。
 * clock 用存档自己的游戏时间（已经清洗过的 out.clock）。
 */
export function cleanBiz(raw: unknown, clock: number): Business {
	const today = Math.max(0, Math.floor(clock / 1440));
	if (!isObj(raw)) return emptyBiz();
	const book = isObj(raw.book) ? raw.book : {};
	return {
		lic: dayMap(raw.lic, LICENSES.map((l) => l.id), today),
		gigs: dayMap(raw.gigs, GIGS.map((g) => g.id), today),
		gst: own(raw, 'gst') === true,
		book: { y: int(own(book, 'y'), 1, 1e7, 1), gross: int(own(book, 'gross'), 0, MONEY, 0), net: int(own(book, 'net'), -MONEY, MONEY, 0) },
		shop: cleanShop(own(raw, 'shop'), today),
	};
}
