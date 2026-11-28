// 带密钥的随机数（v106）。纯函数，不碰时钟和存储。
//
// 为什么要有：state.seed 和 marketSeed 都只有 32 位，行情又只由 (行情种子, 资产, 天) 的无密钥哈希决定。
// 客户端拿到 30 天行情价后，离线穷举 2^32 个种子就能对上，之后每天的价格和所有检定都能预知。
// 现在每个存档另有一把 128 位密钥 rngKey（服务端生成，存在 rk:<id> 而不是存档里，读档时只在内存里拼上；publicState 清掉，不发给客户端），
// 检定、行情、看房人数都先过这把密钥。穷举的空间从 2^32 变成 2^128。
//
// 结构：Even–Mansour（输入异或密钥 → 公开置换 → 输出异或密钥），置换用 Chaskey 的 12 轮 ARX。
// 没有照 Chaskey 的消息填充和子密钥规范做，不要拿它当通用 MAC；这里只需要「不知道密钥就算不出输出」。
//
// rngKey 为空串 = 旧算法（mulberry32 / fmix32）。平衡模拟、测试和客户端都走旧算法，基线数字不变。
import type { PlayerState } from './types.ts';

export const RNG_KEY_RE = /^[0-9a-f]{32}$/;

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

// 密钥解析缓存：服务端同时服务很多玩家，满了整体清空
const keys = new Map<string, Int32Array>();
const KEYS_MAX = 512;

function words(key: string): Int32Array {
	let k = keys.get(key);
	if (!k) {
		if (keys.size >= KEYS_MAX) keys.clear();
		k = new Int32Array(4);
		for (let i = 0; i < 4; i++) k[i] = parseInt(key.slice(i * 8, i * 8 + 8), 16) | 0;
		keys.set(key, k);
	}
	return k;
}

/** 32 位输出的带密钥函数。key 必须是 32 位十六进制（RNG_KEY_RE），调用方先判断 */
export function prf32(key: string, a: number, b: number, c: number, d: number): number {
	const k = words(key);
	let v0 = a ^ k[0];
	let v1 = b ^ k[1];
	let v2 = c ^ k[2];
	let v3 = d ^ k[3];
	for (let i = 0; i < 12; i++) {
		v0 = (v0 + v1) | 0; v1 = rotl(v1, 5) ^ v0; v0 = rotl(v0, 16);
		v2 = (v2 + v3) | 0; v3 = rotl(v3, 8) ^ v2;
		v0 = (v0 + v3) | 0; v3 = rotl(v3, 13) ^ v0;
		v2 = (v2 + v1) | 0; v1 = rotl(v1, 7) ^ v2; v2 = rotl(v2, 16);
	}
	return (v0 ^ k[0] ^ v1 ^ k[1] ^ v2 ^ k[2] ^ v3 ^ k[3]) >>> 0;
}

// 用途标签（域分隔）：不同用途即使输入相同，输出也互不相关
export const PRF_ROLL = 0x726f6c6c;
export const PRF_MARKET = 0x6d6b7431;
export const PRF_SEED = 0x73656564;
export const PRF_CROWD = 0x63727764;

/** 有密钥的存档返回密钥，没有（旧存档、模拟、客户端）返回空串 */
export const keyOf = (state: Pick<PlayerState, 'rngKey'>): string => (typeof state.rngKey === 'string' && RNG_KEY_RE.test(state.rngKey) ? state.rngKey : '');

/**
 * 给「只读种子的哈希」（unit(`${seed}|…`) 那一类）用的种子：有密钥时换成由密钥和 state.seed 派生的 32 位数。
 * state.seed 每次检定后都变，所以这个数也跟着变：就算从某次结果反推出它，也只管那一刻，推不回 seed 和密钥。
 * 一个存档里永远不变的随机量（看房人数）不能用这个办法——32 位的常数能从十几次结果穷举出来，要直接过 prf32（见 rental.ts applicantsFor）。
 */
export function secretSeed(state: Pick<PlayerState, 'rngKey' | 'seed'>): number {
	const key = keyOf(state);
	return key ? prf32(key, state.seed, PRF_SEED, 0, 0) : state.seed;
}
