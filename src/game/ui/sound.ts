// 声音（第 29 轮音效；v37 扩成分轨的声音系统，设计见 docs/earth-game/audio-design.md）。
// 全部用 Web Audio 现场合成，不需要音频文件。提示音这部分很小，跟首屏一起加载；
// 环境音和背景音乐的合成器在 ui/ambient.ts，只有玩家打开了其中一个才动态加载。
// 浏览器要求先有用户操作才能出声：AudioContext 只在玩家点了按钮之后才建（见 earth.astro 的 ensureAudio）。
import type { VolumeLevel } from './prefs.ts';

export type Cue = 'tap' | 'ok' | 'fail' | 'event' | 'ach' | 'arrive' | 'level' | 'stamp' | 'rain' | 'storm';

/** 每个音：频率（Hz）、从第几秒开始、持续几秒、波形（默认正弦） */
export interface Note { f: number; at: number; d: number; w?: 'sine' | 'triangle' }

export const CUES: Record<Cue, Note[]> = {
	tap: [{ f: 880, at: 0, d: 0.03 }], // 切换标签：很短的一下
	ok: [{ f: 660, at: 0, d: 0.07 }], // 做成一件事：一声轻响
	fail: [{ f: 220, at: 0, d: 0.12 }], // 没做成：一声低音
	event: [{ f: 523, at: 0, d: 0.1 }, { f: 784, at: 0.1, d: 0.16 }], // 事件弹出：上行两音
	ach: [{ f: 523, at: 0, d: 0.09 }, { f: 659, at: 0.09, d: 0.09 }, { f: 784, at: 0.18, d: 0.22 }], // 成就：三音
	arrive: [{ f: 392, at: 0, d: 0.12, w: 'triangle' }, { f: 587, at: 0.08, d: 0.2 }], // 到达：低到高两音，像车停稳后的一声提示
	level: [{ f: 523, at: 0, d: 0.08 }, { f: 659, at: 0.07, d: 0.08 }, { f: 784, at: 0.14, d: 0.08 }, { f: 1047, at: 0.21, d: 0.26 }], // 升级：四音上行
	stamp: [{ f: 170, at: 0, d: 0.07, w: 'triangle' }, { f: 340, at: 0.01, d: 0.05, w: 'triangle' }], // 入境盖章：短促的闷响
	rain: [{ f: 1319, at: 0, d: 0.04 }, { f: 1047, at: 0.09, d: 0.04 }, { f: 1568, at: 0.17, d: 0.04 }], // 到达时在下雨：几滴水声
	storm: [{ f: 165, at: 0, d: 0.42, w: 'triangle' }, { f: 196, at: 0.05, d: 0.35, w: 'triangle' }], // 到达时是风暴：低沉的闷雷
};

/** 单个音的峰值音量：提示音要轻，不盖过系统声音（再乘总音量） */
export const VOLUME = 0.08;

type Param = { value?: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void; setTargetAtTime?(v: number, t: number, c: number): void };
export interface GainLike { gain: Param; connect(n: unknown): unknown; disconnect?(): void }

/** 只用到的 Web Audio 接口，方便在测试里换成假的 */
export interface AudioLike {
	currentTime: number;
	state?: string;
	sampleRate?: number;
	resume?: () => Promise<void> | void;
	suspend?: () => Promise<void> | void;
	destination: unknown;
	createOscillator(): { type: string; frequency: { value: number }; connect(n: unknown): unknown; start(t: number): void; stop(t: number): void };
	createGain(): GainLike;
}

/** 播一个提示音：每个音一个振荡器，起音 10 毫秒、指数衰减，避免爆音。out 是要接到的分轨（默认直接接扬声器） */
export function playCue(ctx: AudioLike, cue: Cue, out: unknown = ctx.destination) {
	if (ctx.state === 'suspended') void ctx.resume?.();
	const t0 = ctx.currentTime;
	for (const n of CUES[cue]) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = n.w ?? 'sine';
		osc.frequency.value = n.f;
		const start = t0 + n.at;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
		osc.connect(gain);
		gain.connect(out);
		osc.start(start);
		osc.stop(start + n.d + 0.02);
	}
}

/** 一个动作结算完放哪个提示音（纯函数）：成就 > 升级 > 到达（按天气换） > 做成；失败一律低音。到达后马上弹事件的，让事件那一声来响 */
export function cueAfter(r: { ok: boolean; ach?: boolean; levelUp?: boolean; travel?: boolean; pending?: boolean; weather?: string }): Cue | null {
	if (!r.ok) return 'fail';
	if (r.ach) return 'ach';
	if (r.levelUp) return 'level';
	if (r.travel) {
		if (r.pending) return null;
		return r.weather === 'storm' ? 'storm' : r.weather === 'rain' ? 'rain' : 'arrive';
	}
	return 'ok';
}

// ---------- 分轨 ----------

/** 总音量三档对应的倍数 */
export const MASTER: Record<VolumeLevel, number> = { low: 0.5, mid: 1, high: 1.6 };

export interface Channels { sfx: boolean; ambience: boolean; music: boolean; volume: VolumeLevel }

/** 各分轨的增益（纯函数）：关掉的是 0；总音量不认识的档按「中」 */
export function channelGains(c: Channels) {
	return { master: MASTER[c.volume] ?? 1, sfx: c.sfx ? 1 : 0, ambience: c.ambience ? 1 : 0, music: c.music ? 1 : 0 };
}

/** 混音台：总线 → 扬声器；提示音、环境音、音乐三条分轨接到总线上 */
export interface Mixer { master: GainLike; sfx: GainLike; ambience: GainLike; music: GainLike; set(c: Channels): void }

export function createMixer(ctx: AudioLike, c: Channels): Mixer {
	const mk = (to: unknown) => { const g = ctx.createGain(); g.connect(to); return g; };
	const master = mk(ctx.destination);
	const m: Mixer = {
		master, sfx: mk(master), ambience: mk(master), music: mk(master),
		set(next) {
			const g = channelGains(next);
			const t = ctx.currentTime;
			// 平滑过渡（约 50 毫秒），开关时不咔哒，打开后的试听音也来得及
			for (const k of ['master', 'sfx', 'ambience', 'music'] as const) {
				if (m[k].gain.setTargetAtTime) m[k].gain.setTargetAtTime(g[k], t, 0.015);
				else m[k].gain.setValueAtTime(g[k], t);
			}
		},
	};
	for (const k of ['master', 'sfx', 'ambience', 'music'] as const) m[k].gain.setValueAtTime(channelGains(c)[k], ctx.currentTime);
	return m;
}

// ---------- 场景 → 环境音和音乐（纯函数，首屏用来判断要放什么；合成在 ambient.ts） ----------

export type Family = 'sea' | 'city' | 'inland';
export type AmbId = Family | 'rain' | 'storm';
export type Mood = 'dawn' | 'day' | 'dusk' | 'night' | 'festival';

/** 地点属于哪一类声景：城市 > 海边（海岸、岛、港口，或有海滩、礁石、冲浪）> 内陆（矿区、内陆、公园、不靠海的小镇） */
export function familyOf(kind: string, tags: readonly string[]): Family {
	if (kind === 'city') return 'city';
	if (kind === 'coast' || kind === 'island' || kind === 'port' || tags.some((t) => t === 'beach' || t === 'reef' || t === 'surf')) return 'sea';
	return 'inland';
}

export interface SceneIn { kind: string; tags: readonly string[]; weather: string; phase: string; festival: boolean }

/** 环境音：下雨、风暴盖过地点本身的声音；其他天气（包括以后新加的）按地点 */
export function ambienceFor(s: SceneIn): AmbId {
	if (s.weather === 'storm') return 'storm';
	if (s.weather === 'rain') return 'rain';
	return familyOf(s.kind, s.tags);
}

const MOODS: Mood[] = ['dawn', 'day', 'dusk', 'night'];
/** 背景音乐：节日进行中用节日曲；否则按天色。返回「情绪:地点类」，比如 day:sea */
export function musicFor(s: SceneIn): `${Mood}:${Family}` {
	const mood: Mood = s.festival ? 'festival' : MOODS.includes(s.phase as Mood) ? (s.phase as Mood) : 'day';
	return `${mood}:${familyOf(s.kind, s.tags)}`;
}
