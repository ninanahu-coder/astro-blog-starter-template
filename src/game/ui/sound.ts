// 声音（第 29 轮音效；v37 扩成分轨的声音系统，设计见 docs/earth-game/audio-design.md）。
// 全部用 Web Audio 现场合成，不需要音频文件。提示音这部分很小，跟首屏一起加载；
// 环境音和背景音乐的合成器在 ui/ambient.ts，只有玩家打开了其中一个才动态加载。
// 浏览器要求先有用户操作才能出声：AudioContext 只在玩家点了按钮之后才建（见 earth.astro 的 ensureAudio）。
import type { VolumeLevel } from './prefs.ts';
import { zzfxSamples, type ZzfxParams } from './zzfx.ts';

export type Cue = 'tap' | 'ok' | 'fail' | 'event' | 'ach' | 'arrive' | 'level' | 'stamp' | 'rain' | 'storm' | 'coin';

/**
 * 每个提示音由一到四个「声部」叠成：从第几秒开始，加一组 ZzFX 参数（体验改造 P2，见 ui/zzfx.ts）。
 * ZzFX 参数顺序：音量、随机、频率、起音、持续、释放、波形（0 正弦 1 三角 4 噪声）、波形曲线、滑音、滑音变化、跳音、跳音时刻、重复、噪声……滤波。
 * 设计原则：短（整段不超过半秒）、轻、只用正弦 / 三角，噪声只用在盖章和雷声这种本来就是闷响的地方。
 * 这些数值没有人用耳朵试听过，真机试听后在这里调（docs/earth-game/ux-p2.md）。
 */
export interface Voice { at: number; zz: ZzfxParams }

export const CUES: Record<Cue, Voice[]> = {
	tap: [{ at: 0, zz: [0.5, 0, 1200, 0, 0.005, 0.03, 0] }], // 切换标签：很短的一下
	ok: [{ at: 0, zz: [0.8, 0, 660, 0.005, 0.03, 0.12, 1, 1, 0, 0, 220, 0.05] }], // 做成一件事：一声上扬的「叮」（660 → 880）
	coin: [{ at: 0, zz: [0.7, 0, 988, 0.005, 0.02, 0.1, 1, 1, 0, 0, 330, 0.04] }], // 进账：投币声（B5 → E6）
	fail: [{ at: 0, zz: [0.8, 0, 260, 0.01, 0.06, 0.16, 1, 1, -0.8] }], // 没做成：往下滑的低音（260 → 约 170 Hz，不滑过 0）
	event: [{ at: 0, zz: [0.7, 0, 523, 0.005, 0.05, 0.12, 0] }, { at: 0.1, zz: [0.7, 0, 784, 0.005, 0.06, 0.18, 0] }], // 事件弹出：上行两音
	ach: [{ at: 0, zz: [0.7, 0, 523, 0.005, 0.04, 0.1, 1] }, { at: 0.09, zz: [0.7, 0, 659, 0.005, 0.04, 0.1, 1] }, { at: 0.18, zz: [0.8, 0, 784, 0.005, 0.08, 0.22, 0] }], // 成就：三音
	arrive: [{ at: 0, zz: [0.7, 0, 392, 0.01, 0.06, 0.14, 1] }, { at: 0.08, zz: [0.6, 0, 587, 0.01, 0.08, 0.2, 0] }], // 到达：低到高两音
	level: [523, 659, 784].map((f, i) => ({ at: i * 0.07, zz: [0.7, 0, f, 0.005, 0.03, 0.08, 1] as ZzfxParams })).concat([{ at: 0.21, zz: [0.8, 0, 1047, 0.005, 0.06, 0.2, 0] }]), // 升级：四音上行
	stamp: [{ at: 0, zz: [1, 0, 160, 0, 0.02, 0.09, 0, 1, -0.8, 0, 0, 0, 0, 0.4] }, { at: 0, zz: [0.4, 0, 300, 0, 0, 0.04, 4] }], // 入境盖章：一声闷响加纸面的「啪」（160 → 约 115 Hz，手机喇叭放得出来）
	rain: [1319, 1047, 1568].map((f, i) => ({ at: [0, 0.09, 0.17][i], zz: [0.5, 0, f, 0.002, 0.01, 0.05, 0, 1, -1] as ZzfxParams })), // 到达时在下雨：几滴水声
	storm: [{ at: 0, zz: [0.45, 0, 70, 0.02, 0.2, 0.25, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, -200] }], // 到达时是风暴：低通滤过的低沉雷声（ZzFX 里滤波为负是低通；22.05 kHz 下 -200 约等于 400 Hz 截止）
};

/** 单个声部的峰值音量：提示音要轻，不盖过系统声音（再乘总音量） */
export const VOLUME = 0.08;

/** 提示音的采样率：手机上 22.05 kHz 足够这些短音用，算得也快 */
export const CUE_RATE = 22050;

/** 把一个提示音的各声部叠成一段采样（纯函数；随机固定，同一个音每次一样） */
export function cueSamples(cue: Cue, rate = CUE_RATE): Float32Array {
	const parts = CUES[cue].map((v) => ({ off: Math.round(v.at * rate), s: zzfxSamples(v.zz, rate, () => 0.5) }));
	const out = new Float32Array(parts.reduce((n, p) => Math.max(n, p.off + p.s.length), 0));
	for (const p of parts) for (let i = 0; i < p.s.length; i++) out[p.off + i] += p.s[i] * VOLUME;
	return out;
}

type Param = { value?: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void; setTargetAtTime?(v: number, t: number, c: number): void };
export interface GainLike { gain: Param; connect(n: unknown): unknown; disconnect?(): void }
export interface BufferLike { getChannelData(c: number): Float32Array }

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
	createBuffer(channels: number, length: number, rate: number): BufferLike;
	createBufferSource(): { buffer: unknown; connect(n: unknown): unknown; start(t?: number): void };
}

/** 每个 AudioContext 一份缓存：同一个提示音只算一次采样 */
const cache = new WeakMap<object, Map<Cue, BufferLike>>();

/** 播一个提示音：第一次用到时按 ZzFX 参数算好采样、存起来，之后直接放。out 是要接到的分轨（默认直接接扬声器） */
export function playCue(ctx: AudioLike, cue: Cue, out: unknown = ctx.destination) {
	if (ctx.state === 'suspended') void ctx.resume?.();
	let m = cache.get(ctx);
	if (!m) cache.set(ctx, (m = new Map()));
	let buf = m.get(cue);
	if (!buf) {
		const s = cueSamples(cue);
		buf = ctx.createBuffer(1, Math.max(1, s.length), CUE_RATE);
		buf.getChannelData(0).set(s);
		m.set(cue, buf);
	}
	const src = ctx.createBufferSource();
	src.buffer = buf;
	src.connect(out);
	src.start(ctx.currentTime);
}

/** 一个动作结算完放哪个提示音（纯函数）：成就 > 升级 > 到达（按天气换） > 进账（钱多了） > 做成；失败一律低音。到达后马上弹事件的，让事件那一声来响 */
export function cueAfter(r: { ok: boolean; ach?: boolean; levelUp?: boolean; travel?: boolean; pending?: boolean; weather?: string; coin?: boolean }): Cue | null {
	if (!r.ok) return 'fail';
	if (r.ach) return 'ach';
	if (r.levelUp) return 'level';
	if (r.travel) {
		if (r.pending) return null;
		return r.weather === 'storm' ? 'storm' : r.weather === 'rain' ? 'rain' : 'arrive';
	}
	return r.coin ? 'coin' : 'ok';
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
