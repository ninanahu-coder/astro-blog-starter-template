// 动作协议：客户端只发送「想做什么」，由服务端调用引擎结算并保存。
// parseAction 负责把不可信的网络输入校验成 GameAction；applyAction 把它分发给引擎。
import {
	buyItem, gpsCheckIn, interactNpc, performActivity, resolveEvent, travel, useItem,
} from './engine.ts';
import type { ActionResult, NpcAction, PlayerState, Region, TravelMode } from './types.ts';

export type GameAction =
	| { t: 'travel'; to: string; mode: TravelMode }
	| { t: 'activity'; id: string }
	| { t: 'event'; choice: number }
	| { t: 'gps'; lat: number; lon: number }
	| { t: 'buy'; item: string }
	| { t: 'use'; item: string }
	| { t: 'npc'; npc: string; act: NpcAction };

const MODES: TravelMode[] = ['road', 'track', 'ferry', 'air'];
const NPC_ACTS: NpcAction[] = ['chat', 'gift', 'help'];
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
			return str(a.npc) && NPC_ACTS.includes(a.act as NpcAction) ? { t: 'npc', npc: a.npc, act: a.act as NpcAction } : null;
		default:
			return null;
	}
}

/** 执行一个动作。成功时存档版本号 +1 */
export function applyAction(state: PlayerState, region: Region, a: GameAction): ActionResult {
	let r: ActionResult;
	switch (a.t) {
		case 'travel': r = travel(state, region, a.to, a.mode); break;
		case 'activity': r = performActivity(state, region, a.id); break;
		case 'event': r = resolveEvent(state, region, a.choice); break;
		case 'gps': r = gpsCheckIn(state, region, a.lat, a.lon); break;
		case 'buy': r = buyItem(state, region, a.item); break;
		case 'use': r = useItem(state, region, a.item); break;
		case 'npc': r = interactNpc(state, region, a.npc, a.act); break;
	}
	// resolveEvent 在“待处理事件已失效”时会返回 ok:false 但清掉了 pending，这个修正也要保存
	const changed = r.ok || r.state !== state;
	return changed ? { ...r, state: { ...r.state, rev: state.rev + 1 } } : r;
}

/** 发给客户端的存档：隐去随机数种子，客户端无法预知检定结果 */
export function publicState(state: PlayerState): PlayerState {
	return { ...state, seed: 0 };
}
