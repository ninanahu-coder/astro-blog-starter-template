// 环境音和背景音乐的合成器（v37）。只在玩家打开了环境音或音乐时才由 earth.astro 动态加载，不进首屏。
// 环境音：一段 2 秒的白噪声循环播放，经过滤波器塑形（海浪 = 低通 + 慢慢起伏的音量；风 = 带通 + 频率摆动；雨 = 高通）。
// 音乐：按「情绪:地点类」选一组和弦，每小节铺一个柔和的和弦垫，偶尔点缀几个五声音阶的音。不用任何现成的曲子。
import type { AmbId, AudioLike, Family, GainLike, Mood } from './sound.ts';

// ---------- 需要的额外 Web Audio 接口 ----------

type AParam = GainLike['gain'];
export interface FilterLike { type: string; frequency: AParam & { value: number }; Q: { value: number }; connect(n: unknown): unknown; disconnect?(): void }
export interface SourceLike { buffer: unknown; loop: boolean; connect(n: unknown): unknown; start(t?: number): void; stop(t?: number): void; disconnect?(): void }
export interface BedCtx extends AudioLike {
	sampleRate: number;
	createBuffer(ch: number, len: number, rate: number): { getChannelData(i: number): Float32Array };
	createBufferSource(): SourceLike;
	createBiquadFilter(): FilterLike;
}

// ---------- 环境音配方 ----------

/** 一层噪声：滤波器、音量；lfo 让音量（gain）或滤波频率（freq）慢慢起伏，rate 是每秒几次 */
export interface Layer { filter: 'lowpass' | 'bandpass' | 'highpass'; f: number; q: number; level: number; lfo?: { rate: number; depth: number; target: 'gain' | 'freq' } }

export const BEDS: Record<AmbId, Layer[]> = {
	// 海浪：低沉的噪声，音量约 9 秒一起落
	sea: [{ filter: 'lowpass', f: 480, q: 0.7, level: 0.11, lfo: { rate: 0.11, depth: 0.07, target: 'gain' } }],
	// 城市：远处车流那样平稳的低频，加一点中频的人声底噪
	city: [{ filter: 'bandpass', f: 220, q: 0.6, level: 0.06 }, { filter: 'bandpass', f: 900, q: 0.9, level: 0.02, lfo: { rate: 0.05, depth: 0.012, target: 'gain' } }],
	// 内陆：空旷的风，风声的音高慢慢摆动
	inland: [{ filter: 'bandpass', f: 700, q: 1.6, level: 0.05, lfo: { rate: 0.07, depth: 300, target: 'freq' } }],
	// 雨：细密的高频
	rain: [{ filter: 'highpass', f: 2600, q: 0.5, level: 0.05 }, { filter: 'lowpass', f: 900, q: 0.5, level: 0.03 }],
	// 风暴：雨加低沉起伏的风
	storm: [{ filter: 'highpass', f: 2200, q: 0.5, level: 0.06 }, { filter: 'lowpass', f: 200, q: 0.8, level: 0.09, lfo: { rate: 0.13, depth: 0.06, target: 'gain' } }],
};

// ---------- 音乐配方 ----------

/** 一种情绪：小节长度（秒）、和弦进行（相对根音的半音数）、点缀音的密度（每小节 0–1 个的概率）、整体音量 */
export interface MoodDef { bar: number; chords: number[][]; sparkle: number; level: number }

export const MOODS_DEF: Record<Mood, MoodDef> = {
	dawn: { bar: 4.8, chords: [[0, 7, 16], [5, 12, 21], [-3, 7, 16], [7, 14, 19]], sparkle: 0.35, level: 0.035 },
	day: { bar: 4, chords: [[0, 7, 16], [-3, 4, 12], [5, 12, 16], [7, 11, 14]], sparkle: 0.5, level: 0.04 },
	dusk: { bar: 5, chords: [[-3, 4, 12], [5, 9, 16], [0, 7, 16], [7, 14, 17]], sparkle: 0.3, level: 0.035 },
	night: { bar: 6, chords: [[-3, 7, 12], [5, 12, 16], [-5, 7, 14], [0, 7, 11]], sparkle: 0.2, level: 0.025 },
	festival: { bar: 2.4, chords: [[0, 7, 16], [5, 9, 12], [7, 11, 14], [0, 4, 7]], sparkle: 0.9, level: 0.04 },
};

/** 地点类决定根音和音色：海边明亮的正弦、城市三角波、内陆低一个全音的正弦 */
export const FAMILY_TONE: Record<Family, { root: number; wave: 'sine' | 'triangle' }> = {
	sea: { root: 57, wave: 'sine' }, // A3
	city: { root: 60, wave: 'triangle' }, // C4
	inland: { root: 55, wave: 'sine' }, // G3
};

/** 点缀音用的五声音阶（相对根音） */
export const PENTA = [12, 14, 16, 19, 21, 24];

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** 解析「情绪:地点类」，不认识的返回 null */
export function parseMusic(id: string): { mood: Mood; family: Family } | null {
	const [mood, family] = id.split(':');
	return Object.hasOwn(MOODS_DEF, mood) && Object.hasOwn(FAMILY_TONE, family) ? { mood: mood as Mood, family: family as Family } : null;
}

// ---------- 引擎 ----------

export interface BedsOpts {
	/** 定时器：测试里换成手动的 */
	setTimer?: (f: () => void, ms: number) => unknown;
	clearTimer?: (id: unknown) => void;
	/** 随机数：只决定点缀音的位置，默认 Math.random */
	rand?: () => number;
}

const FADE = 1.5; // 换场景时的交叉淡入淡出（秒）

export interface Beds { setAmbience(id: AmbId | null): void; setMusic(id: string | null): void; stop(): void; readonly amb: AmbId | null; readonly music: string | null }

export function createBeds(ctx: BedCtx, ambOut: unknown, musicOut: unknown, opts: BedsOpts = {}): Beds {
	const setTimer = opts.setTimer ?? ((f, ms) => setTimeout(f, ms));
	const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
	const rand = opts.rand ?? Math.random;
	let noise: unknown = null;
	const noiseBuf = () => {
		if (noise) return noise;
		const len = Math.round(ctx.sampleRate * 2);
		const b = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = b.getChannelData(0);
		// 线性同余生成器：噪声固定，循环接缝处也不会突然变
		let x = 12345;
		for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) >>> 0; d[i] = (x / 2 ** 31) - 1; }
		return (noise = b);
	};
	/** 淡出一组节点然后停掉 */
	const fadeOut = (bus: GainLike, stops: { stop(t?: number): void }[]) => {
		const t = ctx.currentTime;
		bus.gain.setValueAtTime(bus.gain.value ?? 1, t);
		bus.gain.linearRampToValueAtTime(0, t + FADE);
		for (const s of stops) s.stop(t + FADE + 0.05);
	};
	const fadeIn = (bus: GainLike) => {
		const t = ctx.currentTime;
		bus.gain.setValueAtTime(0, t);
		bus.gain.linearRampToValueAtTime(1, t + FADE);
	};

	let amb: { id: AmbId; bus: GainLike; stops: { stop(t?: number): void }[] } | null = null;
	function startAmb(id: AmbId) {
		const bus = ctx.createGain();
		bus.connect(ambOut);
		const stops: { stop(t?: number): void }[] = [];
		const t = ctx.currentTime;
		for (const L of BEDS[id]) {
			const src = ctx.createBufferSource();
			src.buffer = noiseBuf();
			src.loop = true;
			const flt = ctx.createBiquadFilter();
			flt.type = L.filter;
			flt.frequency.value = L.f;
			flt.Q.value = L.q;
			const g = ctx.createGain();
			g.gain.setValueAtTime(L.level, t);
			src.connect(flt);
			flt.connect(g);
			g.connect(bus);
			if (L.lfo) {
				const lfo = ctx.createOscillator();
				lfo.type = 'sine';
				lfo.frequency.value = L.lfo.rate;
				const depth = ctx.createGain();
				depth.gain.setValueAtTime(L.lfo.depth, t);
				lfo.connect(depth);
				depth.connect(L.lfo.target === 'gain' ? g.gain : flt.frequency);
				lfo.start(t);
				stops.push(lfo);
			}
			src.start(t);
			stops.push(src);
		}
		fadeIn(bus);
		amb = { id, bus, stops };
	}

	let mus: { id: string; bus: GainLike; timer: unknown; stops: { stop(t?: number): void }[] } | null = null;
	function startMusic(id: string) {
		const p = parseMusic(id);
		if (!p) return;
		const def = MOODS_DEF[p.mood];
		const tone = FAMILY_TONE[p.family];
		const bus = ctx.createGain();
		bus.connect(musicOut);
		const me = { id, bus, timer: null as unknown, stops: [] as { stop(t?: number): void }[] };
		let bar = 0;
		let next = ctx.currentTime + 0.1;
		const note = (m: number, at: number, d: number, peak: number, wave: string) => {
			const o = ctx.createOscillator();
			o.type = wave;
			o.frequency.value = midiHz(m);
			const g = ctx.createGain();
			// 和弦垫：慢起慢收，避免任何突兀的起音
			g.gain.setValueAtTime(0.0001, at);
			g.gain.linearRampToValueAtTime(peak, at + Math.min(1, d / 3));
			g.gain.exponentialRampToValueAtTime(0.0001, at + d);
			o.connect(g);
			g.connect(bus);
			o.start(at);
			o.stop(at + d + 0.05);
		};
		const schedule = () => {
			if (mus !== me) return;
			// 提前排好一小节；后台标签页定时器会变慢，所以落后时从现在接着排
			if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
			const chord = def.chords[bar % def.chords.length];
			for (const n of chord) note(tone.root + n, next, def.bar * 1.15, def.level, tone.wave);
			if (rand() < def.sparkle) {
				const m = tone.root + PENTA[Math.floor(rand() * PENTA.length) % PENTA.length];
				note(m, next + def.bar * (0.25 + 0.5 * rand()), 0.9, def.level * 0.8, 'sine');
			}
			next += def.bar;
			bar++;
			me.timer = setTimer(schedule, Math.max(200, (next - ctx.currentTime - 0.5) * 1000));
		};
		mus = me;
		fadeIn(bus);
		schedule();
	}
	function stopMusic() {
		if (!mus) return;
		clearTimer(mus.timer);
		fadeOut(mus.bus, mus.stops);
		mus = null;
	}

	return {
		get amb() { return amb?.id ?? null; },
		get music() { return mus?.id ?? null; },
		setAmbience(id) {
			if ((amb?.id ?? null) === id) return;
			if (amb) fadeOut(amb.bus, amb.stops);
			amb = null;
			if (id && Object.hasOwn(BEDS, id)) startAmb(id);
		},
		setMusic(id) {
			if ((mus?.id ?? null) === id) return;
			stopMusic();
			if (id) startMusic(id);
		},
		stop() { this.setAmbience(null); this.setMusic(null); },
	};
}
