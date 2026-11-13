// 角色创建与存档校验。初始属性参考开放世界动作游戏的“能力条”思路：
// 体能/力量/驾驶/游泳/魅力/生存/街头，全部通过实际行为成长。
import { NEED_KEYS, SKILL_KEYS } from './types.ts';
import type { Home, Job, Needs, PlayerState, Relation, Skills, Vehicle } from './types.ts';
import { ITEMS } from '../data/items.ts';
import { MAX_TRAITS } from '../data/traits.ts';
import { NPCS } from '../data/npcs.ts';
import { CAREERS } from '../data/careers.ts';
import { HOMES } from '../data/housing.ts';
import { validTraits } from './attributes.ts';

export const NEED_META: Record<string, { name: string; icon: string }> = {
	hunger: { name: '饱食', icon: '🍔' },
	energy: { name: '精力', icon: '⚡' },
	hygiene: { name: '清洁', icon: '🚿' },
	fun: { name: '娱乐', icon: '🎉' },
	social: { name: '社交', icon: '💬' },
};

export const SKILL_META: Record<string, { name: string; icon: string; hint: string }> = {
	stamina: { name: '体能', icon: '🏃', hint: '徒步、冲浪、长途旅行' },
	strength: { name: '力量', icon: '💪', hint: '健身、矿场和码头的体力活' },
	driving: { name: '驾驶', icon: '🚗', hint: '自驾里程越多越熟练，行车更快' },
	swimming: { name: '游泳', icon: '🏊', hint: '下海、浮潜' },
	charisma: { name: '魅力', icon: '😎', hint: '社交、街头表演、谈判' },
	survival: { name: '生存', icon: '🧭', hint: '内陆探索、露营' },
	street: { name: '街头', icon: '🎲', hint: '应付麻烦、捡漏、讨价还价' },
};

export interface Origin {
	id: string;
	name: string;
	icon: string;
	desc: string;
	cash: number;
	vehicle: Vehicle;
	skills: Partial<Skills>;
}

export const ORIGINS: Origin[] = [
	{ id: 'backpacker', name: '背包客', icon: '🎒', desc: '钱不多，但能走能扛，适应力强。', cash: 600, vehicle: 'none', skills: { stamina: 30, survival: 25, charisma: 15 } },
	{ id: 'fifo', name: '矿区轮班工', icon: '⛏️', desc: '飞进飞出的矿工，力气大、存款厚。', cash: 2500, vehicle: 'none', skills: { strength: 35, stamina: 20, driving: 15 } },
	{ id: 'student', name: '留学生', icon: '🎓', desc: '人缘好脑子快，开着一辆二手小车。', cash: 1200, vehicle: 'car', skills: { charisma: 30, street: 15, driving: 10 } },
	{ id: 'surfer', name: '冲浪手', icon: '🏄', desc: '为浪而生，海里比岸上自在。', cash: 800, vehicle: 'none', skills: { swimming: 40, stamina: 25, charisma: 10 } },
];

export const AVATARS = ['🧑', '👩', '👨', '🧔', '👱', '🧑‍🦱', '👩‍🦰', '🧕', '🤠', '😎'];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const clamp100 = (n: number) => clamp(n, 0, 100);

export const START_CLOCK = 8 * 60; // 第 1 天 08:00

export function createCharacter(opts: {
	id: string;
	name: string;
	avatar: string;
	origin: string;
	region: string;
	spawn: string;
	seed?: number;
	traits?: string[];
}): PlayerState {
	const origin = ORIGINS.find((o) => o.id === opts.origin) ?? ORIGINS[0];
	const skills = Object.fromEntries(SKILL_KEYS.map((k) => [k, origin.skills[k] ?? 5])) as Skills;
	const needs = Object.fromEntries(NEED_KEYS.map((k) => [k, 80])) as Needs;
	return {
		v: 1,
		id: opts.id,
		name: cleanName(opts.name) || '旅人',
		avatar: AVATARS.includes(opts.avatar) ? opts.avatar : AVATARS[0],
		origin: origin.id,
		region: opts.region,
		clock: START_CLOCK,
		loc: opts.spawn,
		cash: origin.cash,
		health: 100,
		respect: 0,
		heat: 0,
		needs,
		skills,
		vehicle: origin.vehicle,
		visited: { [opts.spawn]: 1 },
		checkins: [],
		seen: [],
		traits: validTraits(opts.traits ?? [], MAX_TRAITS) ? [...(opts.traits ?? [])] : [],
		inventory: { water: 2, snack: 1 },
		relations: {},
		job: null,
		home: null,
		pending: null,
		journal: [{ t: START_CLOCK, text: `以「${origin.name}」的身份开始了新生活。` }],
		seed: (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0,
		rev: 0,
	};
}

export function cleanName(s: unknown): string {
	return String(s ?? '')
		.replace(/[<>&"'\s\u0000-\u001f]/g, '')
		.slice(0, 12);
}

const num = (v: unknown, lo: number, hi: number, dflt: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt;
const strList = (v: unknown, max: number) =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, max) : [];

/**
 * 校验并规范化一份不可信的存档（来自 localStorage 或网络）。
 * 结构不对返回 null；数值全部钳制到合法范围。服务端落盘前必须调用。
 */
export function sanitizeState(raw: unknown, knownLocs?: Set<string>): PlayerState | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, any>;
	if (r.v !== 1 || typeof r.id !== 'string' || typeof r.loc !== 'string') return null;
	if (!/^[a-zA-Z0-9_-]{6,40}$/.test(r.id)) return null;
	if (knownLocs && !knownLocs.has(r.loc)) return null;
	const needs = {} as Needs;
	for (const k of NEED_KEYS) needs[k] = num(r.needs?.[k], 0, 100, 50);
	const skills = {} as Skills;
	for (const k of SKILL_KEYS) skills[k] = num(r.skills?.[k], 0, 100, 0);
	const visited: Record<string, number> = {};
	if (r.visited && typeof r.visited === 'object') {
		for (const [k, v] of Object.entries(r.visited).slice(0, 500)) {
			if (k.length <= 64 && (!knownLocs || knownLocs.has(k))) visited[k] = num(v, 0, 1e6, 1);
		}
	}
	const journal = Array.isArray(r.journal)
		? r.journal
				.slice(-JOURNAL_MAX)
				.filter((j: any) => j && typeof j.text === 'string')
				.map((j: any) => ({ t: num(j.t, 0, 1e9, 0), text: String(j.text).slice(0, 200) }))
		: [];
	return {
		v: 1,
		id: r.id,
		name: cleanName(r.name) || '旅人',
		avatar: AVATARS.includes(r.avatar) ? r.avatar : AVATARS[0],
		origin: ORIGINS.some((o) => o.id === r.origin) ? r.origin : ORIGINS[0].id,
		region: typeof r.region === 'string' ? r.region.slice(0, 16) : 'wa',
		clock: num(r.clock, 0, 1e9, START_CLOCK),
		loc: r.loc,
		cash: Math.round(num(r.cash, 0, 1e9, 0)),
		health: num(r.health, 0, 100, 100),
		respect: num(r.respect, 0, 1e6, 0),
		heat: num(r.heat, 0, 100, 0),
		needs,
		skills,
		vehicle: r.vehicle === 'car' || r.vehicle === '4wd' ? r.vehicle : 'none',
		visited,
		checkins: strList(r.checkins, 2000),
		seen: strList(r.seen, 500),
		traits: (() => {
			const t = strList(r.traits, MAX_TRAITS);
			return validTraits(t, MAX_TRAITS) ? t : [];
		})(),
		inventory: cleanInventory(r.inventory),
		relations: cleanRelations(r.relations),
		job: cleanJob(r.job, knownLocs),
		home: cleanHome(r.home, knownLocs),
		pending: r.pending && typeof r.pending.eventId === 'string' ? { eventId: r.pending.eventId.slice(0, 64) } : null,
		journal,
		seed: num(r.seed, 0, 2 ** 32 - 1, 1) >>> 0,
		rev: Math.floor(num(r.rev, 0, 1e9, 0)),
	};
}

export const JOURNAL_MAX = 40;

function cleanJob(raw: any, knownLocs?: Set<string>): Job | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = CAREERS.find((x) => x.id === raw.career);
	if (!c || typeof raw.loc !== 'string' || (knownLocs && !knownLocs.has(raw.loc))) return null;
	return {
		career: c.id,
		loc: raw.loc,
		level: Math.floor(num(raw.level, 0, c.levels.length - 1, 0)),
		shifts: Math.floor(num(raw.shifts, 0, 1e6, 0)),
		good: Math.floor(num(raw.good, 0, 1e6, 0)),
		lastDay: Math.floor(num(raw.lastDay, -1, 1e7, -1)),
	};
}

function cleanHome(raw: any, knownLocs?: Set<string>): Home | null {
	if (!raw || typeof raw !== 'object') return null;
	if (!HOMES.some((h) => h.id === raw.type) || typeof raw.loc !== 'string' || (knownLocs && !knownLocs.has(raw.loc))) return null;
	return { type: raw.type, loc: raw.loc, paidUntil: Math.floor(num(raw.paidUntil, 0, 1e7, 0)) };
}

/** 关系只保留已知 NPC，分数钳制，日期为非负整数 */
function cleanRelations(raw: unknown): Record<string, Relation> {
	const out: Record<string, Relation> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const npc of NPCS) {
		const r = (raw as Record<string, any>)[npc.id];
		if (!r || typeof r !== 'object') continue;
		const last: Relation['last'] = {};
		for (const k of ['chat', 'gift', 'help'] as const) {
			const d = r.last?.[k];
			if (typeof d === 'number' && Number.isFinite(d) && d >= 0) last[k] = Math.floor(d);
		}
		out[npc.id] = { score: num(r.score, -100, 100, 0), last, bonded: r.bonded === true };
	}
	return out;
}

/** 背包只保留已知物品，数量钳制在 1..max，其余丢弃 */
function cleanInventory(raw: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const item of ITEMS) {
		const n = (raw as Record<string, unknown>)[item.id];
		if (typeof n === 'number' && Number.isFinite(n) && n >= 1) out[item.id] = Math.min(item.max, Math.floor(n));
	}
	return out;
}

export function formatClock(clock: number): string {
	const day = Math.floor(clock / 1440) + 1;
	const m = Math.floor(clock % 1440);
	return `第${day}天 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
