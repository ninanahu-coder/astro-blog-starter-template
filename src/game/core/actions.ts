// 动作协议：客户端只发送「想做什么」，由服务端调用引擎结算并保存。
// parseAction 负责把不可信的网络输入校验成 GameAction；applyAction 把它分发给引擎。
import {
	applyJob, buyProperty, moveIntoProperty, repayLoan, sellProperty, toggleRentOut, buyFurniture, cookAtHome, relaxAtHome, sellFurniture, buyItem, buyVehicle, doExperience, sellVehicle, sleepInVehicle, serviceVehicle, takeCert, goFishing, takeQuestPhoto, takeCourse, gpsCheckIn, interactNpc, leaveHome, performActivity, quitJob, rentHome, resolveEvent, sleepHome, travel, useItem, workShift,
} from './engine.ts';
import { refreshWishes, settleWishes } from './wishes.ts';
import { settleStory } from './story.ts';
import { rollDay } from './recap.ts';
import { capState, nextRev } from './character.ts';
import { pruneMoodlets } from './engine.ts';
import type { ActionResult, CoopDef, NpcAction, PlayerState, Region, TravelMode, VenueOp } from './types.ts';
import { resolveCoop, type CoopMember, type CoopResult } from './coop.ts';
import { resolveTrade } from './trade.ts';
import { claimWeekly } from './weekly.ts';
import { venueAction } from './venues.ts';
import { VENUE_OPS } from '../data/venues.ts';
import { DEBT_KINDS, type DebtKind } from '../data/credit.ts';
import { applyCard, buyFurnitureBnpl, buyPropertyWithLoan, buyVehicleWithLoan, carLoanBlocks, cashAdvance, openAccount, personalLoan, repayBank } from './bank.ts';
import { fail } from './engine.ts';

/** 银行动作金额的上限（远高于任何产品额度，只防坏输入） */
const BANK_AMOUNT_MAX = 1e6;

export type GameAction =
	| { t: 'travel'; to: string; mode: TravelMode }
	| { t: 'activity'; id: string }
	| { t: 'event'; choice: number }
	| { t: 'gps'; lat: number; lon: number; acc?: number } // acc：定位精度（米）；旧客户端不带，服务端会拒绝并提示刷新
	| { t: 'buy'; item: string }
	| { t: 'use'; item: string }
	| { t: 'npc'; npc: string; act: NpcAction; item?: string }
	| { t: 'job'; op: 'apply'; career: string }
	| { t: 'job'; op: 'work' | 'quit' }
	| { t: 'home'; op: 'rent'; home: string }
	| { t: 'home'; op: 'sleep' | 'leave' | 'cook' | 'relax' }
	| { t: 'furniture'; op: 'buy'; id: string }
	| { t: 'furniture'; op: 'sell'; slot: string }
	| { t: 'property'; op: 'buy'; id: string; loan: boolean }
	| { t: 'property'; op: 'sell' | 'movein' | 'rentout'; id: string }
	| { t: 'property'; op: 'repay'; id: string; amount: number }
	| { t: 'bank'; op: 'open' | 'card' }
	| { t: 'bank'; op: 'draw' | 'loan'; amount: number }
	| { t: 'bank'; op: 'carloan'; id: string }
	| { t: 'bank'; op: 'bnpl'; id: string; ack: true } // ack：玩家确认看过风险提示，不带就不受理
	| { t: 'bank'; op: 'repay'; kind: DebtKind; amount: number }
	| { t: 'vehicle'; op: 'buy'; id: string }
	| { t: 'vehicle'; op: 'sell' | 'sleep' | 'service' }
	| { t: 'course'; id: string }
	| { t: 'cert'; id: string }
	| { t: 'fish' }
	| { t: 'photo' }
	| { t: 'experience'; id: string }
	| { t: 'venue'; venue: string; op: VenueOp; lat: number; lon: number; acc: number };

const MODES: TravelMode[] = ['road', 'track', 'ferry', 'air'];
const NPC_ACTS: NpcAction[] = ['chat', 'gift', 'help', 'perk'];
const ID = /^[a-z0-9-]{1,40}$/;

const str = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 校验网络输入；格式不对返回 null（只查形状，合不合规则由引擎判断） */
export function parseAction(raw: unknown): GameAction | null {
	if (!raw || typeof raw !== 'object') return null;
	const a = raw as Record<string, unknown>;
	switch (a.t) {
		case 'travel':
			return str(a.to) && MODES.includes(a.mode as TravelMode) ? { t: 'travel', to: a.to, mode: a.mode as TravelMode } : null;
		case 'activity':
			return str(a.id) ? { t: 'activity', id: a.id } : null;
		case 'event':
			return Number.isInteger(a.choice) && (a.choice as number) >= 0 && (a.choice as number) < 10 ? { t: 'event', choice: a.choice as number } : null;
		case 'gps':
			if (!finite(a.lat) || !finite(a.lon) || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) return null;
			if (a.acc === undefined) return { t: 'gps', lat: a.lat, lon: a.lon }; // 旧客户端：交给 gpsCheckIn 提示刷新
			return finite(a.acc) && a.acc >= 0 && a.acc <= 1e6 ? { t: 'gps', lat: a.lat, lon: a.lon, acc: a.acc } : null;
		case 'buy':
		case 'use':
			return str(a.item) ? { t: a.t, item: a.item } : null;
		case 'npc':
			if (!str(a.npc) || !NPC_ACTS.includes(a.act as NpcAction)) return null;
			if (a.item === undefined) return { t: 'npc', npc: a.npc, act: a.act as NpcAction };
			return a.act === 'gift' && str(a.item) ? { t: 'npc', npc: a.npc, act: 'gift', item: a.item } : null;
		case 'venue':
			return str(a.venue) && VENUE_OPS.some((o) => o.id === a.op) && finite(a.lat) && finite(a.lon) && finite(a.acc) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && a.acc >= 0 && a.acc <= 10000
				? { t: 'venue', venue: a.venue, op: a.op as VenueOp, lat: a.lat, lon: a.lon, acc: a.acc }
				: null;
		case 'job':
			if (a.op === 'apply') return str(a.career) ? { t: 'job', op: 'apply', career: a.career } : null;
			return a.op === 'work' || a.op === 'quit' ? { t: 'job', op: a.op } : null;
		case 'home':
			if (a.op === 'rent') return str(a.home) ? { t: 'home', op: 'rent', home: a.home } : null;
			return a.op === 'sleep' || a.op === 'leave' || a.op === 'cook' || a.op === 'relax' ? { t: 'home', op: a.op } : null;
		case 'furniture':
			if (a.op === 'buy') return str(a.id) ? { t: 'furniture', op: 'buy', id: a.id } : null;
			return a.op === 'sell' && str(a.slot) ? { t: 'furniture', op: 'sell', slot: a.slot } : null;
		case 'vehicle':
			if (a.op === 'buy') return str(a.id) ? { t: 'vehicle', op: 'buy', id: a.id } : null;
			return a.op === 'sell' || a.op === 'sleep' || a.op === 'service' ? { t: 'vehicle', op: a.op } : null;
		case 'fish':
		case 'photo':
			return { t: a.t };
		case 'course':
		case 'cert':
		case 'experience':
			return str(a.id) ? { t: a.t, id: a.id } : null;
		case 'bank': {
			// 金额：正整数、有上限；利率、额度、期数都不收客户端的，由服务端按规则算
			const amount = finite(a.amount) && a.amount >= 1 && a.amount <= BANK_AMOUNT_MAX ? Math.floor(a.amount) : null;
			if (a.op === 'open' || a.op === 'card') return { t: 'bank', op: a.op };
			if (a.op === 'draw' || a.op === 'loan') return amount ? { t: 'bank', op: a.op, amount } : null;
			if (a.op === 'carloan') return str(a.id) ? { t: 'bank', op: 'carloan', id: a.id } : null;
			if (a.op === 'bnpl') return str(a.id) && a.ack === true ? { t: 'bank', op: 'bnpl', id: a.id, ack: true } : null;
			if (a.op === 'repay') return amount && DEBT_KINDS.includes(a.kind as DebtKind) ? { t: 'bank', op: 'repay', kind: a.kind as DebtKind, amount } : null;
			return null;
		}
		case 'property':
			if (!str(a.id)) return null;
			if (a.op === 'buy') return { t: 'property', op: 'buy', id: a.id, loan: a.loan === true };
			if (a.op === 'repay') return finite(a.amount) && a.amount > 0 && a.amount <= 1e9 ? { t: 'property', op: 'repay', id: a.id, amount: Math.floor(a.amount) } : null;
			return a.op === 'sell' || a.op === 'movein' || a.op === 'rentout' ? { t: 'property', op: a.op, id: a.id } : null;
		default:
			return null;
	}
}

/** 执行一个动作。成功时存档版本号 +1。now 为服务端的现实时间（毫秒），只有真实地点动作用到；不传则真实地点不可用 */
export function applyAction(state: PlayerState, region: Region, a: GameAction, now = 0): ActionResult {
	let r: ActionResult;
	switch (a.t) {
		case 'travel': r = travel(state, region, a.to, a.mode); break;
		case 'activity': r = performActivity(state, region, a.id); break;
		case 'event': r = resolveEvent(state, region, a.choice); break;
		case 'gps': r = gpsCheckIn(state, region, a.lat, a.lon, a.acc, now); break;
		case 'buy': r = buyItem(state, region, a.item); break;
		case 'use': r = useItem(state, region, a.item); break;
		case 'npc': r = interactNpc(state, region, a.npc, a.act, a.item); break;
		case 'job': r = a.op === 'apply' ? applyJob(state, region, a.career) : a.op === 'work' ? workShift(state, region) : quitJob(state); break;
		case 'home': r = a.op === 'rent' ? rentHome(state, region, a.home) : a.op === 'sleep' ? sleepHome(state, region) : a.op === 'cook' ? cookAtHome(state, region) : a.op === 'relax' ? relaxAtHome(state, region) : leaveHome(state); break;
		case 'furniture': r = a.op === 'buy' ? buyFurniture(state, region, a.id) : sellFurniture(state, a.slot); break;
		case 'vehicle': {
			// 有车贷时，车是抵押物：卖车、换车（旧车折抵）都要先还清
			const held = a.op === 'buy' || a.op === 'sell' ? carLoanBlocks(state) : undefined;
			r = held ? fail(state, held) : a.op === 'buy' ? buyVehicle(state, region, a.id) : a.op === 'sell' ? sellVehicle(state, region) : a.op === 'service' ? serviceVehicle(state, region) : sleepInVehicle(state, region);
			break;
		}
		case 'bank':
			r = a.op === 'open' ? openAccount(state)
				: a.op === 'card' ? applyCard(state)
				: a.op === 'draw' ? cashAdvance(state, a.amount)
				: a.op === 'loan' ? personalLoan(state, a.amount)
				: a.op === 'carloan' ? (carLoanBlocks(state) ? fail(state, carLoanBlocks(state)!) : buyVehicleWithLoan(state, region, a.id))
				: a.op === 'bnpl' ? buyFurnitureBnpl(state, region, a.id, a.ack)
				: a.op === 'repay' ? repayBank(state, a.kind, a.amount)
				: fail(state, '未知的银行操作。');
			break;
		case 'property':
			r = a.op === 'buy' ? (a.loan ? buyPropertyWithLoan(state, region, a.id) : buyProperty(state, region, a.id, false))
				: a.op === 'sell' ? sellProperty(state, a.id)
				: a.op === 'movein' ? moveIntoProperty(state, a.id)
				: a.op === 'repay' ? repayLoan(state, a.id, a.amount)
				: toggleRentOut(state, a.id);
			break;
		case 'course': r = takeCourse(state, region, a.id); break;
		case 'cert': r = takeCert(state, region, a.id); break;
		case 'fish': r = goFishing(state, region); break;
		case 'photo': r = takeQuestPhoto(state, region); break;
		case 'experience': r = doExperience(state, region, a.id); break;
		case 'venue': r = venueAction(state, region, a, now); break;
	}
	// resolveEvent 在“待处理事件已失效”时会返回 ok:false 但清掉了 pending，这个修正也要保存
	const changed = r.ok || r.state !== state;
	if (!changed) return r;
	let msg = r.msg;
	if (r.ok) {
		// 成功的动作：结算心愿（r.state 是引擎新建的对象，可以原地改）；途中晕倒不算完成
		if (!r.collapsed) {
			const done = settleWishes(state, r.state, a);
			if (done.length) msg += ` ✨ 心愿达成：${done.join('、')}`;
			const chapters = settleStory(state, r.state, a);
			if (chapters.length) msg += ` 📖 ${chapters.join('、')}`;
		} else refreshWishes(r.state); // 跨日晕倒也要换成新一天的心愿
		pruneMoodlets(r.state);
	}
	const out = capState({ ...r.state, rev: nextRev(state.rev) });
	if (r.ok) rollDay(out); // 跨过午夜：把上一天的变化记成「昨天回顾」（晕倒住院也算）；在钳制数值之后记，记号不越过存档上限
	return { ...r, msg, state: out };
}

/**
 * 共同事件的结算（只由服务端在凑齐人后调用，客户端不能直接发起）：团队检定后，每个人的结果走和 applyAction 一样的收尾
 * ——清理过期心情、钳制数值、版本号加一；跨日时换新心愿；记下当天做过（每种每 COOP_COOLDOWN_DAYS 个游戏日一次）。成员事先由调用方用 coopBlocked 检查过。
 */
export function applyCoop(def: CoopDef, region: Region, members: CoopMember[]): CoopResult {
	const r = resolveCoop(def, region, members);
	const results = r.results.map((x, i) => {
		// 共同事件不算任何心愿，但跨过午夜时要换成新一天的心愿（同一天时 refreshWishes 什么也不做）
		refreshWishes(x.state);
		pruneMoodlets(x.state);
		const out = capState({ ...x.state, rev: nextRev(members[i].state.rev) });
		rollDay(out);
		return { ...x, state: out };
	});
	return { ...r, results };
}

/**
 * 玩家之间的一次交易（送礼 price=0、二手摊 price>0）。只由服务端在锁住双方存档后调用。
 * 双方各自走 applyAction 一样的收尾：清理心情、钳制数值、版本号加一。失败返回原因字符串。
 */
export function applyTrade(from: PlayerState, to: PlayerState, itemId: string, price: number, day: number, names: { from: string; to: string }): { from: PlayerState; to: PlayerState } | string {
	const r = resolveTrade(from, to, itemId, price, day, names);
	if (typeof r === 'string') return r;
	const fin = (s: PlayerState, prev: PlayerState) => {
		pruneMoodlets(s);
		return capState({ ...s, rev: nextRev(prev.rev) });
	};
	return { from: fin(r.from, from), to: fin(r.to, to) };
}

/** 领全服周目标的奖励（全服累计数由服务端传入）：和 applyAction 一样的收尾 */
export function applyWeeklyClaim(state: PlayerState, week: number, count: number): ActionResult {
	const r = claimWeekly(state, week, count);
	if (!r.ok) return r;
	pruneMoodlets(r.state);
	return { ...r, state: capState({ ...r.state, rev: nextRev(state.rev) }) };
}

/** 发给客户端的存档：隐去随机数种子，客户端无法预知检定结果 */
export function publicState(state: PlayerState): PlayerState {
	return { ...state, seed: 0 };
}
