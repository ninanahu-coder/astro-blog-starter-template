// 室友与合租的动作：做家务、找室友、请室友搬走、处理室友事件、转租。规则见 core/flatmates.ts，数值见 data/flatmates.ts。
import { applyEffect, clone, collapsedResult, fail, getLocation, log } from './engine.ts';
import { activeMates, flatAuto, flatBeds, flatCandidates, flatChoiceBlocked, flatText, getFlatEvent, getFlatmate, newMate, rentShare } from './flatmates.ts';
import { FLAT_RULES } from '../data/flatmates.ts';
import { HOMES } from '../data/housing.ts';
import { dayOf } from './time.ts';
import type { ActionResult, PlayerState, Region } from './types.ts';

const atHome = (s: PlayerState) => !!s.home && s.home.loc === s.loc;

/** 做家务现在不能做的原因 */
export function choreBlocked(state: PlayerState): string | undefined {
	if (!activeMates(state).length) return '没有室友，不用排值日';
	if (!atHome(state)) return '要在住处';
	if (state.flatshare.sublet) return '房间转租中';
	if (state.flatshare.clean >= 100) return '家里已经很干净了';
	return undefined;
}

/** 做家务：花 45 分钟，卫生 +30；这周算你值过日 */
export function doChore(prev: PlayerState, region: Region): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = choreBlocked(prev);
	if (why) return fail(prev, why);
	const state = clone(prev);
	if (applyEffect(state, { minutes: FLAT_RULES.choreMinutes, needs: { energy: FLAT_RULES.choreEnergy } }, region)) return collapsedResult(state);
	if (state.home) {
		state.flatshare.clean = Math.min(100, state.flatshare.clean + FLAT_RULES.choreClean);
		state.flatshare.chore = dayOf(state.clock);
	}
	const msg = `🧹 打扫了厨房和浴室，家里卫生 ${state.flatshare.clean}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 找室友：从这周来看房的人里挑一位，花 60 分钟见面，社交 +10 */
export function inviteFlatmate(prev: PlayerState, region: Region, mateId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (!prev.home || prev.home.owned) return fail(prev, '要有租的住处才能找室友。');
	if (flatAuto(prev)) return fail(prev, '合租房间的室友是房东安排的，不能自己挑。');
	if (flatBeds(prev) <= 1) return fail(prev, '这种住处住不下第二个人。');
	const c = flatCandidates(prev).find((x) => x.def.id === mateId);
	if (!c) return fail(prev, '这周没有这个人来看房。');
	if (c.blocked) return fail(prev, c.blocked);
	const state = clone(prev);
	const before = rentShare(prev);
	if (applyEffect(state, { minutes: FLAT_RULES.inviteMinutes, needs: { social: FLAT_RULES.inviteSocial } }, region)) return collapsedResult(state);
	if (!state.home) return { ok: true, state, msg: '见完面回来，住处已经没了（详见日志）。' };
	state.flatshare.mates.push(newMate(mateId, dayOf(state.clock)));
	const msg = `${c.def.avatar} ${c.def.name}搬进来了。你每周那份房租（含水电网）从 $${before} 变成 $${rentShare(state)}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 请室友搬走：只有二房东能请；提前一周通知，关系 −10 */
export function askFlatmateOut(prev: PlayerState, mateId: string): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	if (flatAuto(prev)) return fail(prev, '合租房间的室友不归你管，有问题找房东。');
	const mate = activeMates(prev).find((m) => m.id === mateId);
	if (!mate) return fail(prev, '没有这位室友。');
	if (mate.out !== undefined) return fail(prev, 'TA 已经定好要搬走了。');
	const state = clone(prev);
	const m = state.flatshare.mates.find((x) => x.id === mateId)!;
	m.out = dayOf(state.clock) + 7;
	m.vibe = Math.max(-100, m.vibe + FLAT_RULES.askOutVibe);
	if (state.flatshare.ev?.mate === mateId) state.flatshare.ev = null;
	const msg = `跟${getFlatmate(mateId)?.name ?? '室友'}说了请 TA 下周搬走。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 处理室友事件：按选项付钱、借钱、花时间、改需求和关系 */
export function resolveFlatEvent(prev: PlayerState, region: Region, choice: number): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const ev = prev.flatshare.ev;
	const def = ev && getFlatEvent(ev.id);
	if (!ev || !def) return fail(prev, '没有要处理的室友的事。');
	const c = def.choices[choice];
	if (!c) return fail(prev, '没有这个选项。');
	// 室友的事要回到住处处理（合并 main 时复核：原来在哪都能处理，出门在外也能吃室友做的饭）
	if (!atHome(prev) || prev.flatshare.sublet) return fail(prev, '回到住处才能处理室友的事。');
	const why = flatChoiceBlocked(prev, c);
	if (why) return fail(prev, why);
	const state = clone(prev);
	state.flatshare.ev = null;
	const mate = state.flatshare.mates.find((m) => m.id === ev.mate);
	if (mate) {
		mate.vibe = Math.max(-100, Math.min(100, mate.vibe + c.vibe));
		if (c.lend) mate.owes = Math.min(10000, mate.owes + c.lend);
	}
	state.flatshare.clean = Math.max(0, Math.min(100, state.flatshare.clean + (c.clean ?? 0)));
	const pay = (c.cost ?? 0) + (c.lend ?? 0);
	if (applyEffect(state, { cash: pay ? -pay : undefined, minutes: c.minutes, needs: c.needs, moodlet: c.moodlet }, region)) return collapsedResult(state);
	const msg = `${def.icon} ${def.title}：${flatText(c.label, ev.mate)}。`;
	log(state, msg);
	return { ok: true, state, msg };
}

/** 转租现在不能办的原因 */
export function subletBlocked(state: PlayerState, on: boolean): string | undefined {
	if (!state.home || state.home.owned) return '只有租的住处能转租';
	const home = HOMES.find((h) => h.id === state.home!.type);
	if (home?.vehicleSleep) return '营地车位不能转租';
	if (home?.employerCareer) return '公司床位不能转租';
	if (on && state.flatshare.sublet) return '已经转租出去了';
	if (!on && !state.flatshare.sublet) return '房间没有转租';
	if (on && atHome(state)) return '人还住在这里；出远门时再转租';
	return undefined;
}

/** 转租 / 收回：转租期间不能回去住，每周按你那份房租的 90%（待平衡）收回 */
export function setSublet(prev: PlayerState, region: Region, on: boolean): ActionResult {
	if (prev.pending) return fail(prev, '先处理眼前的事件。');
	const why = subletBlocked(prev, on);
	if (why) return fail(prev, why);
	const state = clone(prev);
	state.flatshare.sublet = on;
	if (on) {
		state.flatshare.ev = null;
		state.flatshare.subFrom = dayOf(state.clock);
	} else delete state.flatshare.subFrom;
	const place = getLocation(region, state.home!.loc)?.name ?? '';
	const msg = on ? `把${place}的房间短期转租出去了，转租整周能收回 $${Math.round(rentShare(state) * FLAT_RULES.subletRate)}（按实际转租的天数折算）。` : `收回了${place}的房间，可以回去住了。`;
	log(state, msg);
	return { ok: true, state, msg };
}
