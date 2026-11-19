// 保险：保单生效判断、保费、理赔核算、存档清洗。纯函数，只依赖数据表；设计见 docs/earth-game/insurance.md。
// 改状态的只有 settleLoss（改调用方已经 clone 过的 state，和引擎里的结算函数一样）。
import { CLAIM_LOADING, CLAIM_WINDOW, CLAIMS_MAX, COVER_AHEAD_MAX, getPolicy, LOSS_LABEL, POLICIES, START_COVER, type PolicyDef } from '../data/insurance.ts';
import { VEHICLES } from '../data/vehicles.ts';
import type { Cover, Loss, PlayerState } from './types.ts';

/** 这张保单今天管不管用：已过等待期、没到期 */
export function coverActive(cover: Record<string, Cover>, id: string, day: number): boolean {
	const c = Object.hasOwn(cover, id) ? cover[id] : undefined;
	return !!c && c.from <= day && day < c.until;
}

/** 最近 CLAIM_WINDOW 天内的理赔次数 */
export function recentClaims(c: Cover | undefined, day: number): number {
	return c ? c.claims.filter((d) => d <= day && day - d < CLAIM_WINDOW).length : 0;
}

/** 下一期保费：基础保费 × (1 + 近一年理赔次数 × perClaim)，加价有上限 */
export function premiumFor(cover: Record<string, Cover>, id: string, day: number): number {
	const p = getPolicy(id);
	if (!p) return 0;
	const n = recentClaims(Object.hasOwn(cover, id) ? cover[id] : undefined, day);
	return Math.round(p.premium * (1 + Math.min(CLAIM_LOADING.max, n * CLAIM_LOADING.perClaim)));
}

/** 能不能买 / 续这张保单；能买返回 undefined，不能返回原因 */
export function insureBlocked(state: PlayerState, id: string, day: number): string | undefined {
	const p = getPolicy(id);
	if (!p) return '没有这种保险。';
	if (p.compulsory) return '强制险随车辆费用交，不用单独买。';
	if (p.needs === 'vehicle' && !VEHICLES.some((v) => v.id === state.vehicle)) return '你没有车。';
	if (p.needs === 'home' && !state.home) return '要先有住处。';
	const c = Object.hasOwn(state.cover, id) ? state.cover[id] : undefined;
	if (c && c.until > day && c.until + p.days - day > COVER_AHEAD_MAX) return '已经续到很久以后了。';
	const price = premiumFor(state.cover, id, day);
	if (state.cash < price) return `需要 $${price}`;
	return undefined;
}

/** 买或续一期：还没到期就从原到期日往后接（不重新等待）；已过期或第一次买，从 day + 等待期开始 */
export function extendCover(c: Cover | undefined, p: PolicyDef, day: number): Cover {
	if (c && c.until > day) return { from: c.from, until: c.until + p.days, claims: [...c.claims] };
	const from = day + p.wait;
	return { from, until: from + p.days, claims: c ? [...c.claims] : [] };
}

export interface ClaimResult {
	policy: PolicyDef | null; // 走了哪张保单；没有对口保单为 null
	youPay: number; // 自己付（免赔额 + 超出赔付上限的部分；没保险就是全额）
	insurerPays: number;
}

/**
 * 核算一笔损失：在今天有效、赔这种损失的保单里挑免赔额最低的（policies 只给测试换数据表用）。
 * 自己车的损失（保单的 capByCar）最多赔到车的当前价值（carValue），超出的自己付；赔别人的不封顶。免赔额不超过可赔金额。
 */
export function assessClaim(cover: Record<string, Cover>, day: number, loss: Loss, carValue: number, policies: PolicyDef[] = POLICIES): ClaimResult {
	const amount = Math.max(0, Math.round(loss.amount));
	const policy = policies.filter((p) => p.covers.includes(loss.kind) && coverActive(cover, p.id, day)).sort((a, b) => a.excess - b.excess)[0] ?? null;
	if (!policy || amount === 0) return { policy: null, youPay: amount, insurerPays: 0 };
	const coverable = policy.capByCar?.includes(loss.kind) ? Math.min(amount, Math.max(0, Math.round(carValue))) : amount;
	const excess = Math.min(policy.excess, coverable);
	const insurerPays = coverable - excess;
	return { policy, youPay: amount - insurerPays, insurerPays };
}

/**
 * 结算一笔损失（改传进来的 state）：自己付的部分从现金扣，扣到 0 为止；保险赔了钱就记一次理赔（影响续保保费）。
 * 返回核算结果和一句日志。
 */
export function settleLoss(state: PlayerState, loss: Loss, day: number, carValue: number): ClaimResult & { text: string } {
	const r = assessClaim(state.cover, day, loss, carValue);
	state.cash = Math.max(0, Math.round(state.cash - r.youPay));
	const what = LOSS_LABEL[loss.kind];
	let text: string;
	if (r.policy && r.insurerPays > 0) {
		const c = state.cover[r.policy.id];
		state.cover[r.policy.id] = { ...c, claims: [...c.claims, day].slice(-CLAIMS_MAX) };
		text = `${what} $${Math.round(loss.amount)}：${r.policy.name}理赔 $${r.insurerPays}，自付 $${r.youPay}${r.youPay > 0 ? '（免赔额）' : ''}。`;
	} else if (r.policy) {
		text = `${what} $${r.youPay}：没超过${r.policy.name}的免赔额 $${r.policy.excess}，自己付了。`;
	} else {
		text = `${what} $${r.youPay}：没有对口的保险，全部自己付。`;
	}
	return { ...r, text };
}

/** 开局自带的保单 */
export function startCover(originId: string, day: number): Record<string, Cover> {
	const out: Record<string, Cover> = {};
	for (const s of START_COVER[originId] ?? []) if (getPolicy(s.id)) out[s.id] = { from: day, until: day + s.days, claims: [] };
	return out;
}

/**
 * 存档清洗（save-sync.md §5）：旧存档没有这个字段给 {}；只留数据表里能买的保单；
 * 日期取整、钳到 [0, 今天 + COVER_AHEAD_MAX]，from ≤ until；理赔日不晚于今天，按时间排、最多 CLAIMS_MAX 条。幂等。
 */
export function cleanCover(raw: unknown, day: number): Record<string, Cover> {
	const out: Record<string, Cover> = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const top = Math.max(0, Math.floor(day)) + COVER_AHEAD_MAX;
	const int = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.floor(v))) : null);
	for (const p of POLICIES) {
		if (p.compulsory || !Object.hasOwn(raw, p.id)) continue;
		const c = (raw as Record<string, unknown>)[p.id];
		if (!c || typeof c !== 'object') continue;
		const r = c as Record<string, unknown>;
		const until = int(r.until, top);
		const from = int(r.from, top);
		if (until === null || from === null) continue;
		const claims = (Array.isArray(r.claims) ? r.claims : [])
			.map((d) => int(d, Math.max(0, Math.floor(day))))
			.filter((d): d is number => d !== null)
			.sort((a, b) => a - b)
			.slice(-CLAIMS_MAX);
		out[p.id] = { from: Math.min(from, until), until, claims };
	}
	return out;
}
