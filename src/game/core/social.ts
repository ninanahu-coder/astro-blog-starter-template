// 常遇见的人：一起做过共同事件、交易过的玩家。纯函数，由服务端在结算后调用（玩家用在线状态里同样的 id 哈希前缀标识，不存真实 id）。
import type { PlayerState } from './types.ts';

export const MET_MAX = 30;
export const MET_HASH_RE = /^[a-f0-9]{12}$/;

export interface MetPerson {
	hash: string;
	name: string;
	avatar: string;
}

/** 记下这次遇到的人：次数加一、更新名字头像和最近一次的现实日；超过上限时丢掉最久没见的。返回新存档，不改入参 */
export function noteMet(state: PlayerState, people: MetPerson[], day: number): PlayerState {
	const met = { ...(state.met ?? {}) };
	for (const p of people) {
		if (!MET_HASH_RE.test(p.hash)) continue;
		const prev = met[p.hash];
		met[p.hash] = { name: p.name, avatar: p.avatar, n: (prev?.n ?? 0) + 1, last: day };
	}
	const keys = Object.keys(met);
	if (keys.length > MET_MAX) {
		keys.sort((a, b) => met[b].last - met[a].last || met[b].n - met[a].n);
		for (const k of keys.slice(MET_MAX)) delete met[k];
	}
	return { ...state, met };
}

/** 界面用：按一起做事的次数、再按最近见过排序 */
export function metList(state: PlayerState): (MetPerson & { n: number; last: number })[] {
	return Object.entries(state.met ?? {})
		.map(([hash, m]) => ({ hash, ...m }))
		.sort((a, b) => b.n - a.n || b.last - a.last);
}
