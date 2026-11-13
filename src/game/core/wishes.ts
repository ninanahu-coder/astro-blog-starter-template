// 短期心愿的生成与完成判定。随机数来自 state.seed。
import { WISH_REWARD, WISHES, WISHES_PER_DAY } from '../data/wishes.ts';
import type { GameAction } from './actions.ts';
import { clamp100 } from './character.ts';
import { addLog, rngRoll } from './engine.ts';
import { dayOf } from './time.ts';
import type { PlayerState, WishDef } from './types.ts';

export const getWish = (id: string): WishDef | undefined => WISHES.find((w) => w.id === id);

function eligible(state: PlayerState, w: WishDef): boolean {
	if (w.needs === 'job') return !!state.job;
	if (w.needs === 'home') return !!state.home;
	return true;
}

/** 进入新的一天时换一批心愿。原地修改传入的 state，调用方负责先复制 */
export function refreshWishes(state: PlayerState): boolean {
	const today = dayOf(state.clock);
	if (state.wishDay === today) return false;
	const pool = WISHES.filter((w) => eligible(state, w));
	const picked: string[] = [];
	while (picked.length < WISHES_PER_DAY && pool.length) {
		const i = Math.floor(rngRoll(state) * pool.length);
		picked.push(pool.splice(i, 1)[0].id);
	}
	state.wishes = picked;
	state.wishDay = today;
	return true;
}

/** 这个动作是否满足某个心愿 */
export function wishMatches(w: WishDef, a: GameAction, before: PlayerState, after: PlayerState): boolean {
	const d = w.done;
	switch (d.t) {
		case 'activity': return a.t === 'activity' && d.ids.includes(a.id);
		case 'npc': return a.t === 'npc' && d.acts.includes(a.act);
		case 'job': return a.t === 'job' && a.op === 'work';
		case 'home': return a.t === 'home' && d.ops.includes(a.op);
		case 'course': return a.t === 'course';
		case 'experience': return a.t === 'experience';
		case 'buy': return a.t === 'buy' || (a.t === 'furniture' && a.op === 'buy');
		case 'travel': return (a.t === 'travel' || a.t === 'gps') && after.loc !== before.loc;
		case 'newplace': return Object.keys(after.visited).length > Object.keys(before.visited).length;
	}
}

/**
 * 成功的动作之后调用：结算达成的心愿，并在进入新的一天时换新。
 * 返回达成的心愿文字。原地修改 after。
 */
export function settleWishes(before: PlayerState, after: PlayerState, a: GameAction): string[] {
	const done: string[] = [];
	// 先按动作开始那天的心愿结算，再换新：跨午夜的动作也算数
	for (const id of [...after.wishes]) {
		const w = getWish(id);
		if (!w || !wishMatches(w, a, before, after)) continue;
		after.wishes = after.wishes.filter((x) => x !== id);
		after.needs.fun = clamp100(after.needs.fun + WISH_REWARD.fun);
		after.respect += WISH_REWARD.respect;
		addLog(after, `心愿达成：${w.text}。`);
		done.push(w.text);
	}
	refreshWishes(after);
	return done;
}
