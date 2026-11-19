// 证件和办事的存档校验（第 43 批）。单独一个文件：character.ts 要用，只依赖数据表，不和 engine 循环引用。
import { PAPER_RULES, PAPERS } from '../data/paperwork.ts';
import type { PaperRec } from './types.ts';

export type Papers = Record<string, PaperRec>;

// ---------- 存档校验 ----------
const int = (v: unknown, lo: number, hi: number): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : undefined;

/** 清洗存档里的办事记录：只留数据表里有的 id；缺字段的旧存档得到 {}（什么都没办）；幂等 */
export function cleanPapers(raw: unknown, knownLocs?: Set<string>): Papers {
	const out: Papers = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const r = raw as Record<string, unknown>;
	for (const p of PAPERS) {
		if (!Object.hasOwn(r, p.id)) continue;
		const x = r[p.id] as Record<string, unknown> | null;
		if (!x || typeof x !== 'object') continue;
		const at = int(x.at, 0, 1e7);
		const ready = int(x.ready, 0, 1e7);
		if (at === undefined || ready === undefined || ready < at) continue;
		const rec: PaperRec = { at, ready };
		if (typeof x.loc === 'string' && x.loc.length <= 64 && (!knownLocs || knownLocs.has(x.loc))) rec.loc = x.loc;
		if (x.fail === true) rec.fail = true;
		out[p.id] = rec;
		if (Object.keys(out).length >= PAPER_RULES.max) break;
	}
	return out;
}
