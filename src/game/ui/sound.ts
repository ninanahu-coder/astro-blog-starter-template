// 音效（第 29 轮）：用 Web Audio 现场合成几种很短的提示音，不需要音频文件。默认关闭，在设置里打开。
// 只在玩家点了按钮之后才创建 AudioContext（浏览器要求先有用户操作才能出声）。

export type Cue = 'ok' | 'fail' | 'event' | 'ach';

/** 每个音：频率（Hz）、从第几秒开始、持续几秒 */
export interface Note { f: number; at: number; d: number }

export const CUES: Record<Cue, Note[]> = {
	ok: [{ f: 660, at: 0, d: 0.07 }], // 做成一件事：一声轻响
	fail: [{ f: 220, at: 0, d: 0.12 }], // 没做成：一声低音
	event: [{ f: 523, at: 0, d: 0.1 }, { f: 784, at: 0.1, d: 0.16 }], // 事件弹出：上行两音
	ach: [{ f: 523, at: 0, d: 0.09 }, { f: 659, at: 0.09, d: 0.09 }, { f: 784, at: 0.18, d: 0.22 }], // 成就：三音
};

/** 音量上限：提示音要轻，不盖过系统声音 */
export const VOLUME = 0.08;

/** 只用到的 Web Audio 接口，方便在测试里换成假的 */
export interface AudioLike {
	currentTime: number;
	state?: string;
	resume?: () => Promise<void> | void;
	destination: unknown;
	createOscillator(): { type: string; frequency: { value: number }; connect(n: unknown): unknown; start(t: number): void; stop(t: number): void };
	createGain(): { gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): unknown };
}

/** 播一个提示音：每个音一个正弦波，起音 10 毫秒、指数衰减，避免爆音 */
export function playCue(ctx: AudioLike, cue: Cue) {
	if (ctx.state === 'suspended') void ctx.resume?.();
	const t0 = ctx.currentTime;
	for (const n of CUES[cue]) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.value = n.f;
		const start = t0 + n.at;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + n.d + 0.02);
	}
}
