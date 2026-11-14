// 动作协议：客户端只发送「想做什么」，由服务端调用引擎结算并保存。
// parseAction 负责把不可信的网络输入校验成 GameAction；applyAction 把它分发给引擎。
import {
	applyJob, buyProperty, moveIntoProperty, repayLoan, sellProperty, toggleRentOut, buyFurniture, cookAtHome, relaxAtHome, sellFurniture, buyItem, buyVehicle, doExperience, sellVehicle, sleepInVehicle, takeCourse, gpsCheckIn, interactNpc, leaveHome, performActivity, quitJob, rentHome, resolveEvent, sleepHome, travel, useItem, workShift,
} from './engine.ts';
import { settleWishes } from './wishes.ts';
import { pruneMoodlets } from './engine.ts';
import type { ActionResult, NpcAction, PlayerState, Region, TravelMode, VenueOp } from './types.ts';
import { venueAction } from './venues.ts';
import { VENUE_OPS } from '../data/venues.ts';

export type GameAction =
	| { t: 'travel'; to: string; mode: TravelMode }
	| { t: 'activity'; id: string }
	| { t: 'event'; choice: number }
	| { t: 'gps'; lat: number; lon: number }
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
	| { t: 'vehicle'; op: 'buy'; id: string }
	| { t: 'vehicle'; op: 'sell' | 'sleep' }
	| { t: 'course'; id: string }
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
			return finite(a.lat) && finite(a.lon) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 ? { t: 'gps', lat: a.lat, lon: a.lon } : null;
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
			return a.op === 'sell' || a.op === 'sleep' ? { t: 'vehicle', op: a.op } : null;
		case 'course':
		case 'experience':
			return str(a.id) ? { t: a.t, id: a.id } : null;
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
		case 'gps': r = gpsCheckIn(state, region, a.lat, a.lon); break;
		case 'buy': r = buyItem(state, region, a.item); break;
		case 'use': r = useItem(state, region, a.item); break;
		case 'npc': r = interactNpc(state, region, a.npc, a.act, a.item); break;
		case 'job': r = a.op === 'apply' ? applyJob(state, region, a.career) : a.op === 'work' ? workShift(state, region) : quitJob(state); break;
		case 'home': r = a.op === 'rent' ? rentHome(state, region, a.home) : a.op === 'sleep' ? sleepHome(state, region) : a.op === 'cook' ? cookAtHome(state, region) : a.op === 'relax' ? relaxAtHome(state, region) : leaveHome(state); break;
		case 'furniture': r = a.op === 'buy' ? buyFurniture(state, region, a.id) : sellFurniture(state, a.slot); break;
		case 'vehicle': r = a.op === 'buy' ? buyVehicle(state, region, a.id) : a.op === 'sell' ? sellVehicle(state, region) : sleepInVehicle(state, region); break;
		case 'property':
			r = a.op === 'buy' ? buyProperty(state, region, a.id, a.loan)
				: a.op === 'sell' ? sellProperty(state, a.id)
				: a.op === 'movein' ? moveIntoProperty(state, a.id)
				: a.op === 'repay' ? repayLoan(state, a.id, a.amount)
				: toggleRentOut(state, a.id);
			break;
		case 'course': r = takeCourse(state, region, a.id); break;
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
		}
		pruneMoodlets(r.state);
	}
	return { ...r, msg, state: { ...r.state, rev: state.rev + 1 } };
}

/** 发给客户端的存档：隐去随机数种子，客户端无法预知检定结果 */
export function publicState(state: PlayerState): PlayerState {
	return { ...state, seed: 0 };
}
