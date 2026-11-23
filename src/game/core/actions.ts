// 动作协议：客户端只发送「想做什么」，由服务端调用引擎结算并保存。
// parseAction 负责把不可信的网络输入校验成 GameAction；applyAction 把它分发给引擎。
import {
	travelOptions, applyJob, seekCare, buyProperty, moveIntoProperty, repayLoan, sellProperty, toggleRentOut, buyFurniture, relaxAtHome, sellFurniture, buyItem, sellItem, buyVehicle, doExperience, sellVehicle, sleepInVehicle, serviceVehicle, takeCert, takeQuestPhoto, takeCourse, gpsCheckIn, interactNpc, leaveHome, performActivity, quitJob, applyForHome, inspectHome, leaseAction, settleBondClaim, handleScam, resolveEvent, sleepHome, travel, useItem, workShift,
} from './engine.ts';
import { buyGroceries, cookRecipe, hostDinner, orderDelivery } from './cooking.ts';
import { GROCER_BATCH_MAX } from '../data/cooking.ts';
import { refreshWishes, settleWishes } from './wishes.ts';
import { doHobby, goFishing } from './hobbies.ts';
import { HOBBY_IDS, type HobbyId } from '../data/hobbies.ts';
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
import { buyInsurance } from './insure.ts';
import { venueAction } from './venues.ts';
import { doVolunteer } from './volunteer.ts';
import { takeTrip } from './trips.ts';
import { applyAbn, applyTfn, lodgeReturn } from './tax-actions.ts';
import { buyListing, sellToBuyer } from './secondhand.ts';
import { SWAP_GOODS, type SwapKind } from '../data/secondhand.ts';
import { trailStep } from './trails.ts';
import { studyProgram } from './education.ts';
import { buyAsset, sellAsset } from './invest.ts';
import { marketView } from './market.ts';
import { VENUE_OPS } from '../data/venues.ts';
import { askFlatmateOut, doChore, inviteFlatmate, resolveFlatEvent, setSublet } from './flat-actions.ts';
import { DEBT_KINDS, type DebtKind } from '../data/credit.ts';
import { applyCard, buyFurnitureBnpl, buyPropertyWithLoan, buyVehicleWithLoan, carLoanBlocks, cashAdvance, openAccount, personalLoan, repayBank } from './bank.ts';
import { fail } from './engine.ts';

/** 银行动作金额的上限（远高于任何产品额度，只防坏输入） */
const BANK_AMOUNT_MAX = 1e6;
import { closeShop, doGig, getLicense, hireStaff, openShop, restockShop, settleBiz, tendShop } from './business.ts';
import { mindAction, settleMind } from './mind.ts';
import { MIND_ACTS, type MindOp } from '../data/mind.ts';
import { clubSession, enterRace, joinClub, noteTraining, quitClub, runRace } from './sports.ts';
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
	| { t: 'tax'; op: 'tfn' | 'abn' | 'lodge' } // 税务：申请 TFN、注册 ABN、申报上一财年
	| { t: 'activity'; id: string }
	| { t: 'event'; choice: number }
	| { t: 'gps'; lat: number; lon: number; acc?: number } // acc：定位精度（米）；旧客户端不带，服务端会拒绝并提示刷新
	| { t: 'buy'; item: string }
	| { t: 'use'; item: string }
	| { t: 'sell'; item: string }
	| { t: 'npc'; npc: string; act: NpcAction; item?: string }
	| { t: 'job'; op: 'apply'; career: string }
	| { t: 'job'; op: 'work' | 'quit' }
	| { t: 'home'; op: 'rent'; home: string; term?: 'fixed' | 'periodic' } // 递申请（营地直接租）；term 不写为固定期限
	| { t: 'home'; op: 'sleep' | 'leave' | 'relax' | 'delivery' }
	| { t: 'home'; op: 'cook'; recipe?: string } // 不带 recipe：随手做一顿（旧客户端）
	| { t: 'home'; op: 'host'; recipe: string }
	| { t: 'grocery'; id: string; n: number }
	| { t: 'rental'; op: 'inspect'; home: string } // 租房市场：看房
	| { t: 'rental'; op: RentalOp }
	| { t: 'flat'; op: 'chore' | 'sublet' | 'unsublet' }
	| { t: 'flat'; op: 'invite' | 'askout'; mate: string }
	| { t: 'flat'; op: 'resolve'; choice: number }
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
	| { t: 'study'; id: string }
	| { t: 'fish' }
	| { t: 'photo' }
	| { t: 'hobby'; id: HobbyId }
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
	| { t: 'care'; kind: CareKind } // 看病（健康系统第 1 版）
	| { t: 'insure'; id: string } // 买 / 续保险（第 43 批）
	| { t: 'sport'; op: 'enter' | 'race' | 'join'; id: string }
	| { t: 'sport'; op: 'club' | 'quit' } // 运动和比赛（第 43 批）
	| { t: 'mind'; op: MindOp } // 主动调节心情：给家里打视频、找人聊聊（第 43 批）
	| { t: 'swap'; op: 'buy'; id: string; ref: string; how: 'pickup' | 'prepay'; haggle: boolean } // 二手市场：买一条挂单（价格、骗局由服务端算）
	| { t: 'swap'; op: 'sell'; kind: SwapKind; ref: string; buyer: number; verify: boolean } // 二手市场：卖给第 buyer 个买家；verify＝等钱到账再交货
	| { t: 'biz'; op: 'gig' | 'license'; id: string }
	| { t: 'biz'; op: 'open'; shop: string; site: string }
	| { t: 'biz'; op: 'restock'; qty: number }
	| { t: 'biz'; op: 'hire' | 'fire' | 'tend' | 'close' } // 副业与小生意（第 43 批）
	| { t: 'volunteer'; id: string } // 志愿者（第 43 批）
	| { t: 'trip'; dest: string; days: number }; // 离开地图的旅行（跨州、回国），见 core/trips.ts

/** 租房市场：交入住检查报告、报修、续约、接受或申诉押金扣款、骗租广告（转钱 / 核实） */
export type RentalOp = 'report' | 'repair' | 'renew' | 'accept' | 'dispute' | 'scam-pay' | 'scam-check';
const RENTAL_OPS: RentalOp[] = ['report', 'repair', 'renew', 'accept', 'dispute', 'scam-pay', 'scam-check'];

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
			if (a.op === 'rent') {
				if (!str(a.home) || (a.term !== undefined && a.term !== 'fixed' && a.term !== 'periodic')) return null;
				return a.term ? { t: 'home', op: 'rent', home: a.home, term: a.term } : { t: 'home', op: 'rent', home: a.home };
			}
			if (a.op === 'cook') return a.recipe === undefined ? { t: 'home', op: 'cook' } : str(a.recipe) ? { t: 'home', op: 'cook', recipe: a.recipe } : null;
			if (a.op === 'host') return str(a.recipe) ? { t: 'home', op: 'host', recipe: a.recipe } : null;
			return a.op === 'sleep' || a.op === 'leave' || a.op === 'relax' || a.op === 'delivery' ? { t: 'home', op: a.op } : null;
		case 'grocery':
			return str(a.id) && Number.isInteger(a.n) && (a.n as number) >= 1 && (a.n as number) <= GROCER_BATCH_MAX ? { t: 'grocery', id: a.id, n: a.n as number } : null;
		case 'rental':
			if (a.op === 'inspect') return str(a.home) ? { t: 'rental', op: 'inspect', home: a.home } : null;
			return RENTAL_OPS.includes(a.op as RentalOp) ? { t: 'rental', op: a.op as RentalOp } : null;
		case 'flat':
			if (a.op === 'invite' || a.op === 'askout') return str(a.mate) ? { t: 'flat', op: a.op, mate: a.mate } : null;
			if (a.op === 'resolve') return Number.isInteger(a.choice) && (a.choice as number) >= 0 && (a.choice as number) < 10 ? { t: 'flat', op: 'resolve', choice: a.choice as number } : null;
			return a.op === 'chore' || a.op === 'sublet' || a.op === 'unsublet' ? { t: 'flat', op: a.op } : null;
		case 'furniture':
			if (a.op === 'buy') return str(a.id) ? { t: 'furniture', op: 'buy', id: a.id } : null;
			return a.op === 'sell' && str(a.slot) ? { t: 'furniture', op: 'sell', slot: a.slot } : null;
		case 'vehicle':
			if (a.op === 'buy') return str(a.id) ? { t: 'vehicle', op: 'buy', id: a.id } : null;
			return a.op === 'sell' || a.op === 'sleep' || a.op === 'service' ? { t: 'vehicle', op: a.op } : null;
		case 'fish':
		case 'photo':
			return { t: a.t };
		case 'hobby':
			return HOBBY_IDS.includes(a.id as HobbyId) && a.id !== 'fishing' ? { t: 'hobby', id: a.id as HobbyId } : null;
		case 'course':
		case 'cert':
		case 'study':
		case 'experience':
		case 'volunteer':
		case 'insure':
			return str(a.id) ? { t: a.t, id: a.id } : null;
		case 'trip':
			return str(a.dest) && Number.isInteger(a.days) && (a.days as number) >= 1 && (a.days as number) <= 60 ? { t: 'trip', dest: a.dest, days: a.days as number } : null;
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
		case 'swap':
			// 只收形状合法的字段；客户端发来的价格等多余字段一律丢掉
			if (a.op === 'buy') return str(a.id) && str(a.ref) && (a.how === 'pickup' || a.how === 'prepay') ? { t: 'swap', op: 'buy', id: a.id, ref: a.ref, how: a.how, haggle: a.haggle === true } : null;
			if (a.op !== 'sell' || !str(a.ref) || !SWAP_GOODS.some((g) => g.kind === a.kind && g.ref === a.ref)) return null;
			return Number.isInteger(a.buyer) && (a.buyer as number) >= 0 && (a.buyer as number) < 10 ? { t: 'swap', op: 'sell', kind: a.kind as SwapKind, ref: a.ref, buyer: a.buyer as number, verify: a.verify === true } : null;
		case 'sport':
			if (a.op === 'enter' || a.op === 'race' || a.op === 'join') return str(a.id) ? { t: 'sport', op: a.op, id: a.id } : null;
			return a.op === 'club' || a.op === 'quit' ? { t: 'sport', op: a.op } : null;
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
		case 'tax':
			return a.op === 'tfn' || a.op === 'abn' || a.op === 'lodge' ? { t: 'tax', op: a.op } : null;
		case 'biz':
			if (a.op === 'gig' || a.op === 'license') return str(a.id) ? { t: 'biz', op: a.op, id: a.id } : null;
			if (a.op === 'open') return str(a.shop) && str(a.site) ? { t: 'biz', op: 'open', shop: a.shop, site: a.site } : null;
			if (a.op === 'restock') return Number.isInteger(a.qty) && (a.qty as number) >= 1 && (a.qty as number) <= 1000 ? { t: 'biz', op: 'restock', qty: a.qty as number } : null;
			return a.op === 'hire' || a.op === 'fire' || a.op === 'tend' || a.op === 'close' ? { t: 'biz', op: a.op } : null;
		case 'mind':
			return typeof a.op === 'string' && Object.hasOwn(MIND_ACTS, a.op) ? { t: 'mind', op: a.op as MindOp } : null;
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
			r = a.op === 'rent' ? applyForHome(state, region, a.home, a.term)
				: a.op === 'sleep' ? sleepHome(state, region)
				: a.op === 'cook' ? cookRecipe(state, region, a.recipe)
				: a.op === 'host' ? hostDinner(state, region, a.recipe)
				: a.op === 'delivery' ? orderDelivery(state, region)
				: a.op === 'relax' ? relaxAtHome(state, region)
				: leaveHome(state);
			break;
		case 'grocery': r = buyGroceries(state, region, a.id, a.n); break;
		case 'rental':
			r = a.op === 'inspect' ? inspectHome(state, region, a.home)
				: a.op === 'accept' || a.op === 'dispute' ? settleBondClaim(state, region, a.op === 'dispute')
				: a.op === 'scam-pay' || a.op === 'scam-check' ? handleScam(state, region, a.op === 'scam-pay')
				: leaseAction(state, region, a.op);
			break;
		case 'flat':
			r = a.op === 'chore' ? doChore(state, region)
				: a.op === 'invite' ? inviteFlatmate(state, region, a.mate)
				: a.op === 'askout' ? askFlatmateOut(state, a.mate)
				: a.op === 'resolve' ? resolveFlatEvent(state, region, a.choice)
				: setSublet(state, region, a.op === 'sublet');
			break;
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
		case 'study': r = studyProgram(state, region, a.id); break;
		case 'fish': r = goFishing(state, region); break;
		case 'photo': r = takeQuestPhoto(state, region); break;
		case 'hobby': r = doHobby(state, region, a.id); break;
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
		case 'insure': r = buyInsurance(state, a.id); break;
		case 'sport':
			r = a.op === 'enter' ? enterRace(state, region, a.id)
				: a.op === 'race' ? runRace(state, region, a.id)
				: a.op === 'join' ? joinClub(state, a.id)
				: a.op === 'club' ? clubSession(state, region)
				: quitClub(state);
			break;
		case 'mind': r = mindAction(state, region, a.op); break;
		case 'swap': r = a.op === 'buy' ? buyListing(state, region, a.id, a.ref, a.how, a.haggle) : sellToBuyer(state, region, a.kind, a.ref, a.buyer, a.verify); break;
		case 'biz':
			r = a.op === 'gig' ? doGig(state, region, a.id)
				: a.op === 'license' ? getLicense(state, region, a.id)
				: a.op === 'open' ? openShop(state, region, a.shop, a.site)
				: a.op === 'restock' ? restockShop(state, region, a.qty)
				: a.op === 'tend' ? tendShop(state, region)
				: a.op === 'close' ? closeShop(state, region)
				: hireStaff(state, region, a.op);
			break;
		case 'tax': r = a.op === 'tfn' ? applyTfn(state) : a.op === 'abn' ? applyAbn(state) : lodgeReturn(state); break;
		case 'volunteer': r = doVolunteer(state, region, a.id, now); break;
		case 'trip': r = takeTrip(state, region, a.dest, a.days); break;
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
			noteTraining(r.state, a); // 日常运动记一次训练（跑步、游泳、健身……，见 core/sports.ts）
		} else refreshWishes(r.state); // 跨日晕倒也要换成新一天的心愿
		pruneMoodlets(r.state);
		// 自己的店结算到昨天（没有店时什么也不做、不消耗随机数）；结算出的钱单独记成「工作与零工」，不算到这次动作头上（合并 main 后）
		const bizCash = r.state.cash;
		msg += settleBiz(r.state, region);
		if (r.state.tally && r.state.cash !== bizCash) {
			r.state.tally = copyTally(r.state.tally);
			tallyCash(r.state, 'work', r.state.cash - bizCash);
		}
		settleMind(r.state, dayOf(state.clock)); // 跨过午夜：结算孤独、思乡、压力和低落天数（同一天什么也不做）
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
		settleMind(x.state, dayOf(members[i].state.clock));
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
