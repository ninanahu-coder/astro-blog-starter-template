// 动作协议：客户端只发送「想做什么」，由服务端调用引擎结算并保存。
// parseAction 负责把不可信的网络输入校验成 GameAction；applyAction 把它分发给引擎。
import {
	travelOptions, applyJob, seekCare, buyProperty, moveIntoProperty, repayLoan, sellProperty, toggleRentOut, buyFurniture, relaxAtHome, sellFurniture, buyItem, sellItem, buyVehicle, doExperience, sellVehicle, sleepInVehicle, serviceVehicle, takeCert, goFishing, takeQuestPhoto, takeCourse, gpsCheckIn, interactNpc, leaveHome, performActivity, quitJob, rentHome, resolveEvent, sleepHome, travel, useItem, workShift,
} from './engine.ts';
import { buyGroceries, cookRecipe, hostDinner, orderDelivery } from './cooking.ts';
import { GROCER_BATCH_MAX } from '../data/cooking.ts';
import { refreshWishes, settleWishes } from './wishes.ts';
import { settleStory } from './story.ts';
import { claimAchievement, settleSide, wearTitle } from './quests.ts';
import { TITLE_RE } from './titles.ts';
import { rollDay } from './recap.ts';
import { actionCats, copyTally, finishTally, tallyCash } from './tally.ts';
import { capState, nextRev } from './character.ts';
import { pruneMoodlets } from './engine.ts';
import type { ActionResult, CoopDef, NpcAction, PlayerState, Region, TravelMode, VenueOp } from './types.ts';
import { resolveCoop, type CoopMember, type CoopResult } from './coop.ts';
import { resolveTrade } from './trade.ts';
import { claimWeekly } from './weekly.ts';
import { venueAction } from './venues.ts';
import { trailStep } from './trails.ts';
import { studyProgram } from './education.ts';
import { buyAsset, sellAsset } from './invest.ts';
import { marketView } from './market.ts';
import { VENUE_OPS } from '../data/venues.ts';
import { CARE, type CareKind } from '../data/health.ts';
import { applyOnboard, parseOnboardOp, settleOnboard, type OnboardOp } from './onboard.ts';
import { claimLive, LIVE_ID_RE } from './live.ts';
import { blockPlayer, unblockPlayer } from './safety.ts';
import { settleDecay } from './relations.ts';
import { dayOf } from './time.ts';
import { adoptPet, boardPet, dogJoinsRun, petAction, petTravelBlocked, PET_OPS, type PetOp } from './pets.ts';
import { PET, PET_KINDS } from '../data/pets.ts';
import { VISA_ROUTES } from '../data/visas.ts';
import { applyVisa, settleVisa, takeIelts, visaWorkBlocked } from './immigration.ts';

export type GameAction =
	| { t: 'travel'; to: string; mode: TravelMode }
	| { t: 'activity'; id: string }
	| { t: 'event'; choice: number }
	| { t: 'gps'; lat: number; lon: number; acc?: number } // acc：定位精度（米）；旧客户端不带，服务端会拒绝并提示刷新
	| { t: 'buy'; item: string }
	| { t: 'use'; item: string }
	| { t: 'sell'; item: string }
	| { t: 'npc'; npc: string; act: NpcAction; item?: string }
	| { t: 'job'; op: 'apply'; career: string }
	| { t: 'job'; op: 'work' | 'quit' }
	| { t: 'home'; op: 'rent'; home: string }
	| { t: 'home'; op: 'sleep' | 'leave' | 'relax' | 'delivery' }
	| { t: 'home'; op: 'cook'; recipe?: string } // 不带 recipe：随手做一顿（旧客户端）
	| { t: 'home'; op: 'host'; recipe: string }
	| { t: 'grocery'; id: string; n: number }
	| { t: 'furniture'; op: 'buy'; id: string }
	| { t: 'furniture'; op: 'sell'; slot: string }
	| { t: 'property'; op: 'buy'; id: string; loan: boolean }
	| { t: 'property'; op: 'sell' | 'movein' | 'rentout'; id: string }
	| { t: 'property'; op: 'repay'; id: string; amount: number }
	| { t: 'vehicle'; op: 'buy'; id: string }
	| { t: 'vehicle'; op: 'sell' | 'sleep' | 'service' }
	| { t: 'course'; id: string }
	| { t: 'cert'; id: string }
	| { t: 'study'; id: string }
	| { t: 'fish' }
	| { t: 'photo' }
	| { t: 'experience'; id: string }
	| { t: 'claim'; id: string } // 领成就奖励（第 28 批）
	| { t: 'title'; id: string } // 佩戴称号，'' 为摘下
	| { t: 'live'; id: string }
	| { t: 'asset'; op: 'buy' | 'sell'; id: string; amount: number }
	| { t: 'venue'; venue: string; op: VenueOp; lat: number; lon: number; acc: number }
	| { t: 'pet'; op: 'adopt'; kind: string; from: 'shelter' | 'breeder'; name?: string }
	| { t: 'pet'; op: 'board'; days: number }
	| { t: 'pet'; op: PetOp }
	| { t: 'trail'; lat: number; lon: number; acc: number }
	| ({ t: 'onboard' } & OnboardOp)
	| { t: 'visa'; op: 'apply'; route: string }
	| { t: 'visa'; op: 'ielts' }
	| { t: 'care'; kind: CareKind }; // 看病（健康系统第 1 版）

const MODES: TravelMode[] = ['road', 'track', 'ferry', 'air', 'transit', 'rail', 'walk'];
const NPC_ACTS: NpcAction[] = ['chat', 'gift', 'help', 'perk', 'favor', 'bond', 'unbond'];
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
		case 'sell':
			return str(a.item) ? { t: a.t, item: a.item } : null;
		case 'npc':
			if (!str(a.npc) || !NPC_ACTS.includes(a.act as NpcAction)) return null;
			if (a.item === undefined) return { t: 'npc', npc: a.npc, act: a.act as NpcAction };
			return a.act === 'gift' && str(a.item) ? { t: 'npc', npc: a.npc, act: 'gift', item: a.item } : null;
		case 'care':
			return CARE.some((c) => c.id === a.kind) ? { t: 'care', kind: a.kind as CareKind } : null;
		case 'venue':
			return str(a.venue) && VENUE_OPS.some((o) => o.id === a.op) && finite(a.lat) && finite(a.lon) && finite(a.acc) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && a.acc >= 0 && a.acc <= 10000
				? { t: 'venue', venue: a.venue, op: a.op as VenueOp, lat: a.lat, lon: a.lon, acc: a.acc }
				: null;
		case 'trail':
			return finite(a.lat) && finite(a.lon) && finite(a.acc) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && a.acc >= 0 && a.acc <= 10000
				? { t: 'trail', lat: a.lat, lon: a.lon, acc: a.acc }
				: null;
		case 'job':
			if (a.op === 'apply') return str(a.career) ? { t: 'job', op: 'apply', career: a.career } : null;
			return a.op === 'work' || a.op === 'quit' ? { t: 'job', op: a.op } : null;
		case 'home':
			if (a.op === 'rent') return str(a.home) ? { t: 'home', op: 'rent', home: a.home } : null;
			if (a.op === 'cook') return a.recipe === undefined ? { t: 'home', op: 'cook' } : str(a.recipe) ? { t: 'home', op: 'cook', recipe: a.recipe } : null;
			if (a.op === 'host') return str(a.recipe) ? { t: 'home', op: 'host', recipe: a.recipe } : null;
			return a.op === 'sleep' || a.op === 'leave' || a.op === 'relax' || a.op === 'delivery' ? { t: 'home', op: a.op } : null;
		case 'grocery':
			return str(a.id) && Number.isInteger(a.n) && (a.n as number) >= 1 && (a.n as number) <= GROCER_BATCH_MAX ? { t: 'grocery', id: a.id, n: a.n as number } : null;
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
		case 'study':
		case 'experience':
			return str(a.id) ? { t: a.t, id: a.id } : null;
		case 'claim':
			return str(a.id) ? { t: 'claim', id: a.id } : null;
		case 'title':
			return a.id === '' || (typeof a.id === 'string' && TITLE_RE.test(a.id)) ? { t: 'title', id: a.id as string } : null;
		case 'live':
			return typeof a.id === 'string' && LIVE_ID_RE.test(a.id) ? { t: 'live', id: a.id } : null;
		case 'pet':
			if (a.op === 'adopt') {
				if (!PET_KINDS.some((k) => k.id === a.kind) || (a.from !== 'shelter' && a.from !== 'breeder')) return null;
				if (a.name === undefined) return { t: 'pet', op: 'adopt', kind: a.kind as string, from: a.from };
				// 名字是玩家输入：只查类型和长度，过滤和截断由引擎（cleanName）做
				return typeof a.name === 'string' && a.name.length <= 40 ? { t: 'pet', op: 'adopt', kind: a.kind as string, from: a.from, name: a.name } : null;
			}
			if (a.op === 'board') return Number.isInteger(a.days) && (a.days as number) >= 1 && (a.days as number) <= PET.boardMaxDays ? { t: 'pet', op: 'board', days: a.days as number } : null;
			return PET_OPS.includes(a.op as PetOp) ? { t: 'pet', op: a.op as PetOp } : null;
		case 'visa':
			if (a.op === 'ielts') return { t: 'visa', op: 'ielts' };
			return a.op === 'apply' && typeof a.route === 'string' && VISA_ROUTES.some((r) => r.id === a.route) ? { t: 'visa', op: 'apply', route: a.route } : null;
		case 'property':
			if (!str(a.id)) return null;
			if (a.op === 'buy') return { t: 'property', op: 'buy', id: a.id, loan: a.loan === true };
			if (a.op === 'repay') return finite(a.amount) && a.amount > 0 && a.amount <= 1e9 ? { t: 'property', op: 'repay', id: a.id, amount: Math.floor(a.amount) } : null;
			return a.op === 'sell' || a.op === 'movein' || a.op === 'rentout' ? { t: 'property', op: a.op, id: a.id } : null;
		case 'onboard': {
			const o = parseOnboardOp(a);
			return o ? { t: 'onboard', ...o } : null;
		}
		case 'asset':
			return str(a.id) && (a.op === 'buy' || a.op === 'sell') && finite(a.amount) && a.amount > 0 && a.amount <= 1e9 ? { t: 'asset', op: a.op, id: a.id, amount: a.amount } : null;
		default:
			return null;
	}
}

/** 执行一个动作。成功时存档版本号 +1。now 为服务端的现实时间（毫秒），只有真实地点和路线动作用到；不传则这两类不可用 */
export function applyAction(state: PlayerState, region: Region, a: GameAction, now = 0): ActionResult {
	// 新手引导动作（v36）：只改 onboard 字段，不花时间，不算心愿和主线；有待处理事件时也能关提示。没有变化就不加版本号
	if (a.t === 'onboard') {
		const r = applyOnboard(state, a);
		return r.state === state ? r : { ...r, state: { ...r.state, rev: nextRev(state.rev) } };
	}
	const noVisa = visaWorkBlocked(state, a); // 签证过期不能工作（第 43 批）
	if (noVisa) return { ok: false, state, msg: noVisa };
	let r: ActionResult;
	switch (a.t) {
		case 'travel': {
			const pet = petTravelBlocked(state, a.to, a.mode);
			r = pet ? { ok: false, state, msg: pet + '。' } : travel(state, region, a.to, a.mode);
			break;
		}
		case 'activity': r = performActivity(state, region, a.id); break;
		case 'event': r = resolveEvent(state, region, a.choice); break;
		case 'gps': r = gpsCheckIn(state, region, a.lat, a.lon, a.acc, now); break;
		case 'buy': r = buyItem(state, region, a.item); break;
		case 'use': r = useItem(state, region, a.item); break;
		case 'sell': r = sellItem(state, region, a.item); break;
		case 'npc': r = interactNpc(state, region, a.npc, a.act, a.item); break;
		case 'job': r = a.op === 'apply' ? applyJob(state, region, a.career) : a.op === 'work' ? workShift(state, region) : quitJob(state); break;
		case 'home':
			r = a.op === 'rent' ? rentHome(state, region, a.home)
				: a.op === 'sleep' ? sleepHome(state, region)
				: a.op === 'cook' ? cookRecipe(state, region, a.recipe)
				: a.op === 'host' ? hostDinner(state, region, a.recipe)
				: a.op === 'delivery' ? orderDelivery(state, region)
				: a.op === 'relax' ? relaxAtHome(state, region)
				: leaveHome(state);
			break;
		case 'grocery': r = buyGroceries(state, region, a.id, a.n); break;
		case 'furniture': r = a.op === 'buy' ? buyFurniture(state, region, a.id) : sellFurniture(state, a.slot); break;
		case 'vehicle': r = a.op === 'buy' ? buyVehicle(state, region, a.id) : a.op === 'sell' ? sellVehicle(state, region) : a.op === 'service' ? serviceVehicle(state, region) : sleepInVehicle(state, region); break;
		case 'property':
			r = a.op === 'buy' ? buyProperty(state, region, a.id, a.loan)
				: a.op === 'sell' ? sellProperty(state, a.id)
				: a.op === 'movein' ? moveIntoProperty(state, a.id)
				: a.op === 'repay' ? repayLoan(state, a.id, a.amount)
				: toggleRentOut(state, a.id);
			break;
		case 'course': r = takeCourse(state, region, a.id); break;
		case 'cert': r = takeCert(state, region, a.id); break;
		case 'study': r = studyProgram(state, region, a.id); break;
		case 'fish': r = goFishing(state, region); break;
		case 'photo': r = takeQuestPhoto(state, region); break;
		case 'experience': r = doExperience(state, region, a.id); break;
		case 'venue':
			r = venueAction(state, region, a, now);
			// GPS 联动：在真实地点跑步时狗跟着去，算遛过（r.state 是引擎新建的对象，可以原地改）
			if (r.ok && !r.collapsed && a.op === 'run') r = { ...r, msg: r.msg + dogJoinsRun(r.state, region) };
			break;
		case 'pet':
			r = a.op === 'adopt' ? adoptPet(state, region, a.kind, a.from, a.name) : a.op === 'board' ? boardPet(state, region, a.days) : petAction(state, region, a.op);
			break;
		case 'asset': r = a.op === 'buy' ? buyAsset(state, region, a.id, a.amount) : sellAsset(state, region, a.id, a.amount); break;
		case 'live': r = claimLive(state, region, a.id, now); break;
		case 'trail': r = trailStep(state, region, a, now); break;
		case 'claim': r = claimAchievement(state, region, a.id); break;
		case 'title': r = wearTitle(state, a.id); break;
		case 'visa': r = a.op === 'ielts' ? takeIelts(state, region) : applyVisa(state, region, a.route); break;
		case 'care': r = seekCare(state, region, a.kind); break;
	}
	// resolveEvent 在“待处理事件已失效”时会返回 ok:false 但清掉了 pending，这个修正也要保存
	const changed = r.ok || r.state !== state;
	if (!changed) return r;
	let msg = r.msg;
	if (r.ok) {
		// 成功的动作：结算心愿（r.state 是引擎新建的对象，可以原地改）；途中晕倒不算完成
		if (!r.collapsed) {
			const cashBefore = r.state.cash; // 生涯统计：下面主线、支线、新手引导发的钱记「奖励」
			const done = settleWishes(state, r.state, a);
			if (done.length) msg += ` ✨ 心愿达成：${done.join('、')}`;
			const chapters = settleStory(state, r.state, a);
			if (chapters.length) msg += ` 📖 ${chapters.join('、')}`;
			// 支线放在主线之后：这次动作写完了一章，以这一章为解锁条件的支线马上接下（但这次动作不算进去）
			const sides = settleSide(state, r.state, a);
			if (sides.length) msg += ` 🧩 ${sides.join('、')}`;
			const feats = settleOnboard(r.state);
			if (feats.length) msg += ` 🔓 新出现：${feats.map((f) => f.name).join('、')}`;
			if (r.state.tally && r.state.cash !== cashBefore) {
				r.state.tally = copyTally(r.state.tally); // r.state 可能和旧存档共用 tally 对象，先拷一份再记
				tallyCash(r.state, 'reward', r.state.cash - cashBefore);
			}
		} else refreshWishes(r.state); // 跨日晕倒也要换成新一天的心愿
		pruneMoodlets(r.state);
		const visaNote = settleVisa(state, r.state); // 签证：记经验、毕业、到期提醒和过期（第 43 批）
		if (visaNote) msg += ` ${visaNote}`;
	}
	// 跨过午夜：好久没来往的关系变淡（第 29 批）。按动作开始前后的游戏日结算，失败的动作不推进时间
	const out = capState({ ...settleDecay(r.state, dayOf(state.clock), dayOf(r.state.clock)), rev: nextRev(state.rev) });
	if (r.ok) rollDay(out); // 跨过午夜：把上一天的变化记成「昨天回顾」（晕倒住院也算）；在钳制数值之后记，记号不越过存档上限
	// 生涯统计：收支按类别、出行公里、里程碑、周年小结（career-stats.md）。公里只算真的到了目的地的出行
	if (r.ok) finishTally(state, out, actionCats(a), a.t === 'travel' && out.loc === a.to && state.loc !== a.to ? travelOptions(state, region).find((o) => o.to === a.to && o.mode === a.mode)?.km ?? 0 : 0);
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
		const out = capState({ ...settleDecay(x.state, dayOf(members[i].state.clock), dayOf(x.state.clock)), rev: nextRev(members[i].state.rev) });
		rollDay(out);
		finishTally(members[i].state, out, ['social', 'social']);
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
		const out = capState({ ...s, rev: nextRev(prev.rev) });
		finishTally(prev, out, ['social', 'social']);
		return out;
	};
	return { from: fin(r.from, from), to: fin(r.to, to) };
}

/** 领全服周目标的奖励（全服累计数由服务端传入）：和 applyAction 一样的收尾 */
export function applyWeeklyClaim(state: PlayerState, week: number, count: number): ActionResult {
	const r = claimWeekly(state, week, count);
	if (!r.ok) return r;
	pruneMoodlets(r.state);
	const out = capState({ ...r.state, rev: nextRev(state.rev) });
	finishTally(state, out, ['reward', 'reward']);
	return { ...r, state: out };
}

/**
 * 屏蔽 / 解除屏蔽（第 24 批）：只由服务端调用（屏蔽对象由服务端按哈希或留言查实）。和 applyAction 一样版本号加一。
 * 屏蔽名单只影响自己看到什么、谁能给自己送礼，不改游戏数值。
 */
export function applyBlock(state: PlayerState, op: 'block' | 'unblock', p: { hash: string; name: string; avatar: string }, day: number, selfHash?: string): ActionResult {
	const next = op === 'block' ? blockPlayer(state, p, day, selfHash) : unblockPlayer(state, p.hash);
	if (typeof next === 'string') return { ok: false, state, msg: next };
	if (next === state) return { ok: false, state, msg: op === 'block' ? '已经屏蔽过了。' : '没有屏蔽这位玩家。' };
	const msg = op === 'block' ? `已屏蔽${p.name}：看不到对方的聊天、表情、留言和挂单，对方也送不了你东西。` : `已解除对${p.name}的屏蔽。`;
	return { ok: true, state: capState({ ...next, rev: nextRev(state.rev) }), msg };
}

/** 发给客户端的存档：隐去随机数种子，客户端无法预知检定结果 */
export function publicState(state: PlayerState): PlayerState {
	// 两个种子都不能给客户端：知道种子就能推算以后的随机结果和行情。行情改由服务端算好放进 quotes（只到今天）
	return { ...state, seed: 0, marketSeed: 0, quotes: marketView(state) };
}
