// 宠物规则（v31 第一版）：纯函数，不改入参，随机数只来自存档（起名用哈希，不推进种子）。
// 设计文档 docs/earth-game/pets-wildlife.md。原则：适合所有玩家——没照顾只会让好感度下降，宠物不会离开、受伤或死亡。
import { addMoodlet, applyEffect, clone, collapsedResult, fail, getLocation, log } from './engine.ts';
import { cleanName, clamp100 } from './character.ts';
import { dayOf, period } from './time.ts';
import { unit, weatherAt } from './weather.ts';
import { getPetKind, homeAllowsPet, PET, PET_ADOPT_KINDS, PET_KINDS, PET_NO_GO, PET_VET_TAG, type PetKindDef, type PetSource } from '../data/pets.ts';
import type { ActionResult, Pet, PlayerState, Region, TravelMode } from './types.ts';

export type PetOp = 'feed' | 'play' | 'walk' | 'vet' | 'pickup' | 'rehome';
export const PET_OPS: PetOp[] = ['feed', 'play', 'walk', 'vet', 'pickup', 'rehome'];

const today = (s: PlayerState) => dayOf(s.clock);

/** 宠物最近一次被照顾的游戏日：喂、玩、遛、领回家；寄养期间（含超期没接）算寄养所每天在照顾 */
export function lastCare(s: PlayerState, pet: Pet): number {
	if (pet.board) return today(s);
	return Math.max(pet.fedDay, pet.playDay, pet.walkDay, pet.since);
}

/** 连续几天没人照顾（今天、昨天照顾过都算 0） */
export const neglectDays = (s: PlayerState, pet: Pet) => Math.max(0, today(s) - lastCare(s, pet) - 1);

export const vetDue = (s: PlayerState, pet: Pet) => today(s) - pet.vetDay >= PET.vetEvery;

/** 现在领养 / 购买这种宠物还差什么；能做返回 undefined */
export function adoptBlocked(s: PlayerState, region: Region, kind: PetKindDef, from: PetSource): string | undefined {
	const loc = getLocation(region, s.loc);
	if (s.pending) return '先处理眼前的事件';
	if (s.pet) return '第一版最多养一只宠物';
	if (!loc || !(PET_ADOPT_KINDS as readonly string[]).includes(loc.kind)) return '要到城市里的救助站或宠物店';
	if (from === 'breeder' && kind.buy === undefined) return '这里买不到';
	if (!s.home) return '先要有个住处：救助站会确认你能安顿它';
	if (!s.home.owned && !homeAllowsPet(s.home.type, kind.id)) return `你现在的住处不许养${kind.name}`;
	const price = (from === 'shelter' ? kind.adopt : kind.buy!) + kind.register;
	if (s.cash < price) return `要 $${price}（含登记费 $${kind.register}）`;
	return undefined;
}

/** 某个宠物动作现在做不了的原因；能做返回 undefined */
export function petOpBlocked(s: PlayerState, region: Region, op: PetOp): string | undefined {
	const pet = s.pet;
	if (!pet) return '你还没有宠物';
	if (s.pending) return '先处理眼前的事件';
	const def = getPetKind(pet.kind);
	if (!def) return '宠物数据缺失';
	const loc = getLocation(region, s.loc);
	if (op === 'pickup') {
		if (!pet.board) return `${pet.name}没在寄养`;
		return pet.board.loc === s.loc ? undefined : `要回到${getLocation(region, pet.board.loc)?.name ?? '寄养的地方'}接它`;
	}
	if (op === 'rehome') return undefined; // 随时可以把它送回救助站，由救助站重新找家
	if (pet.board) return `${pet.name}在寄养，先接回来`;
	const t = today(s);
	switch (op) {
		case 'feed':
			if (pet.fedDay >= t) return '今天喂过了';
			return s.cash < def.food ? `口粮要 $${def.food}` : undefined;
		case 'play':
			return pet.playDay >= t ? `${pet.name}今天玩累了，明天再来` : undefined;
		case 'walk': {
			if (!def.walk) return `${def.name}不用遛`;
			if (pet.walkDay >= t) return '今天遛过了';
			if (loc?.kind === 'park') return '国家公园和保护区不许带宠物';
			const w = weatherAt(s);
			if (w.closesSea) return '风暴天别出门，在家陪它玩吧';
			// 炎热天中午地面烫脚：只在清晨、傍晚、夜里遛
			if (w.id === 'hot' && period(s.clock).id === 'day') return '天太热，地面烫脚，清晨或傍晚再遛';
			return undefined;
		}
		case 'vet':
			if (!loc?.tags.includes(PET_VET_TAG)) return '这里没有兽医，要去有医院的城镇';
			return s.cash < def.vet ? `体检要 $${def.vet}` : undefined;
	}
	return undefined;
}

/** 寄养 days 天现在做不了的原因 */
export function boardBlocked(s: PlayerState, region: Region, days: number): string | undefined {
	const pet = s.pet;
	if (!pet) return '你还没有宠物';
	if (s.pending) return '先处理眼前的事件';
	if (pet.board) return `${pet.name}已经在寄养了`;
	if (!Number.isInteger(days) || days < 1 || days > PET.boardMaxDays) return `一次寄养 1–${PET.boardMaxDays} 天`;
	if (!getLocation(region, s.loc)?.tags.includes(PET_VET_TAG)) return '这里没有寄养所，要去有医院的城镇';
	const cost = (getPetKind(pet.kind)?.board ?? 0) * days;
	return s.cash < cost ? `寄养 ${days} 天要 $${cost}` : undefined;
}

/** 带着宠物（没寄养）去不了的地方或坐不了的交通；没问题返回 undefined */
export function petTravelBlocked(s: PlayerState, to: string, mode: TravelMode): string | undefined {
	const pet = s.pet;
	if (!pet || pet.board) return undefined;
	if (mode === 'air') return `${pet.name}不能随你坐飞机，先寄养`;
	if (PET_NO_GO.includes(to)) return '那里是保护区，不许带宠物上岛，先寄养';
	return undefined;
}

/** 照顾后的好感度：先扣掉连续没照顾的天数，再加这次的；体检过期时加的减半 */
function bondAfter(s: PlayerState, pet: Pet, gain: number): number {
	const g = vetDue(s, pet) ? gain * PET.overdueBondMult : gain;
	return clamp100(Math.max(0, pet.bond - neglectDays(s, pet) * PET.neglectBond) + g);
}

/** 领养（救助站）或购买（繁育者） */
export function adoptPet(prev: PlayerState, region: Region, kindId: string, from: PetSource, name?: string): ActionResult {
	const kind = getPetKind(kindId);
	if (!kind) return fail(prev, '没有这种宠物。');
	const blocked = adoptBlocked(prev, region, kind, from);
	if (blocked) return fail(prev, blocked + '。');
	const state = clone(prev);
	const price = (from === 'shelter' ? kind.adopt : kind.buy!) + kind.register;
	const picked = kind.names[Math.floor(unit(`${state.id}|${state.clock}|${kind.id}`) * kind.names.length)];
	const petName = cleanName(name).slice(0, PET.nameMax) || picked;
	if (applyEffect(state, { cash: -price, minutes: PET.adoptMinutes, needs: { fun: 10 } }, region)) return collapsedResult(state);
	const t = today(state);
	state.pet = { kind: kind.id, name: petName, from, since: t, bond: PET.startBond, fedDay: t, playDay: -1, walkDay: -1, vetDay: t, board: null };
	addMoodlet(state, 'new-pet');
	const msg = `${from === 'shelter' ? '从救助站领养了' : '从繁育者那里买了'}${kind.icon}${kind.name}「${petName}」，$${price}${kind.register ? `（含登记费 $${kind.register}）` : ''}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 喂、玩、遛、体检、接回、送回救助站 */
export function petAction(prev: PlayerState, region: Region, op: PetOp): ActionResult {
	const blocked = petOpBlocked(prev, region, op);
	if (blocked) return fail(prev, blocked + '。');
	const state = clone(prev);
	const pet = state.pet!;
	const def = getPetKind(pet.kind)!;
	const t = today(state);
	let msg = '';
	switch (op) {
		case 'feed': {
			const bond = bondAfter(state, pet, PET.feedBond);
			if (applyEffect(state, { cash: -def.food, minutes: PET.feedMinutes }, region)) return collapsedResult(state);
			Object.assign(state.pet!, { bond, fedDay: t });
			msg = `喂了${pet.name}，口粮 $${def.food}。`;
			break;
		}
		case 'play': {
			const bond = bondAfter(state, pet, PET.playBond);
			if (applyEffect(state, def.play, region)) return collapsedResult(state);
			Object.assign(state.pet!, { bond, playDay: t });
			msg = `陪${pet.name}玩了一会儿。`;
			break;
		}
		case 'walk': {
			const bond = bondAfter(state, pet, PET.walkBond);
			if (applyEffect(state, PET.walk, region)) return collapsedResult(state);
			Object.assign(state.pet!, { bond, walkDay: t });
			msg = `带${pet.name}出去遛了一圈，路上和别的狗主人聊了几句。`;
			break;
		}
		case 'vet': {
			const bond = bondAfter(state, pet, PET.vetBond);
			if (applyEffect(state, { cash: -def.vet, minutes: PET.vetMinutes }, region)) return collapsedResult(state);
			Object.assign(state.pet!, { bond, vetDay: t });
			msg = `带${pet.name}做了年度体检和疫苗，$${def.vet}。一切正常。`;
			break;
		}
		case 'pickup': {
			// 超期没接：寄养所照样照顾，接的时候补交超出的天数；钱不够先付能付的（游戏简化，不做惩罚）
			const over = Math.max(0, t - pet.board!.until);
			const due = Math.min(state.cash, over * def.board);
			state.cash -= due;
			state.pet = { ...pet, board: null, fedDay: t };
			msg = `把${pet.name}从寄养所接回来了${due ? `，补交超期 ${over} 天的寄养费 $${due}` : ''}。`;
			break;
		}
		case 'rehome':
			state.pet = null;
			msg = `把${pet.name}送回了救助站，工作人员会给它找一个新家。`;
			break;
	}
	log(state, msg);
	return { ok: true, state, msg };
}

/** 寄养 days 天：先付清，宠物留在当地寄养所 */
export function boardPet(prev: PlayerState, region: Region, days: number): ActionResult {
	const blocked = boardBlocked(prev, region, days);
	if (blocked) return fail(prev, blocked + '。');
	const state = clone(prev);
	const pet = state.pet!;
	const cost = getPetKind(pet.kind)!.board * days;
	state.cash -= cost;
	state.pet = { ...pet, board: { loc: state.loc, until: today(state) + days } };
	const msg = `把${pet.name}寄养在${getLocation(region, state.loc)?.name ?? '这里'}，${days} 天 $${cost}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/**
 * GPS 联动：真实地点「跑步」成功后，狗跟着一起去就算遛过（今天还没遛、没寄养、在能遛的地方）。原地修改，返回附加的提示语。
 * 由 actions.ts 在真实地点动作结算后调用；以后「主要路线」（遛狗路线）也走这里。
 */
export function dogJoinsRun(state: PlayerState, region: Region): string {
	const pet = state.pet;
	if (!pet || petOpBlocked(state, region, 'walk')) return '';
	pet.bond = bondAfter(state, pet, PET.walkBond);
	pet.walkDay = today(state);
	addMoodlet(state, 'dog-walk');
	state.needs.social = clamp100(state.needs.social + (PET.walk.needs?.social ?? 0));
	log(state, `${pet.name}跟着你一起跑了一圈。`);
	return ` 🦮 ${pet.name}也遛过了。`;
}

/** 界面用的宠物状态 */
export function petStatus(s: PlayerState, region: Region) {
	const pet = s.pet;
	if (!pet) return null;
	const def = getPetKind(pet.kind)!;
	const t = today(s);
	return {
		pet,
		def,
		hungry: !pet.board && pet.fedDay < t,
		lonely: neglectDays(s, pet),
		vetDue: vetDue(s, pet),
		boardOver: pet.board ? Math.max(0, t - pet.board.until) : 0,
		ops: PET_OPS.filter((op) => op !== 'walk' || def.walk).map((op) => ({ op, blocked: petOpBlocked(s, region, op) })),
		board: boardBlocked(s, region, 1),
	};
}

/** 这里能领养 / 买的宠物 */
export function petOffers(s: PlayerState, region: Region) {
	const loc = getLocation(region, s.loc);
	if (!loc || !(PET_ADOPT_KINDS as readonly string[]).includes(loc.kind)) return [];
	return PET_KINDS.flatMap((kind) => (['shelter', 'breeder'] as const)
		.filter((from) => from === 'shelter' || kind.buy !== undefined)
		.map((from) => ({ kind, from, price: (from === 'shelter' ? kind.adopt : kind.buy!) + kind.register, blocked: adoptBlocked(s, region, kind, from) })));
}
