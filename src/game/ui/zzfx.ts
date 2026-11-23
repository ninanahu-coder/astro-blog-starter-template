// ZzFX 采样生成器（体验改造 P2）：移植自 ZzFXMicro v1.4.0 的 zzfx()，只保留「按参数算出采样」这一步，
// 播放交给 sound.ts（接到分轨增益上、记缓存）。这样它是纯函数，可以在测试里直接算、直接比。
// 改动：sampleRate、随机数改成参数传入（测试里传 0 随机）；不再自己建 AudioContext；
// 返回 Float32Array；音量不再乘全局 zzfxV（总音量由 sound.ts 的混音台管）。
//
/*!
ZzFX - Zuper Zmall Zound Zynth - Micro Edition
MIT License - Copyright 2019 Frank Force
https://github.com/KilledByAPixel/ZzFX

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * ZzFX 参数，顺序和 ZzFX 一样（可以直接从 ZzFX 网页设计器复制过来）：
 * 音量、随机、频率、起音、持续、释放、波形（0 正弦 1 三角 2 锯齿 3 tan 4 噪声 5 方波）、波形曲线、滑音、滑音变化、
 * 跳音、跳音时刻、重复、噪声、调制、降采样、延迟、持续音量、衰减、颤音、滤波
 */
export type ZzfxParams = [number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?, number?];

/** 按 ZzFX 参数算出单声道采样（-1..1 量级，未乘总音量）。rand 是 0..1 的随机数来源，测试里传 () => 0.5 得到确定结果 */
export function zzfxSamples(p: ZzfxParams, sampleRate = 44100, rand: () => number = Math.random): Float32Array {
	let [volume = 1, randomness = 0.05, frequency = 220, attack = 0, sustain = 0, release = 0.1, shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0, repeatTime = 0, noise = 0, modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1, decay = 0, tremolo = 0, filter = 0] = p;
	const PI2 = Math.PI * 2;
	const abs = Math.abs;
	const sign = (v: number) => (v < 0 ? -1 : 1);
	let startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
	let startFrequency = (frequency *= ((1 + randomness * 2 * rand() - randomness) * PI2) / sampleRate);
	let modOffset = 0, repeat = 0, crush = 0, jump = 1, t = 0, i = 0, s = 0, f = 0;
	const quality = 2, w = (PI2 * abs(filter) * 2) / sampleRate;
	const cos = Math.cos(w), alpha = Math.sin(w) / 2 / quality;
	const a0 = 1 + alpha, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
	const b0 = (1 + sign(filter) * cos) / 2 / a0, b1 = -(sign(filter) + cos) / a0, b2 = b0;
	let x2 = 0, x1 = 0, y2 = 0, y1 = 0;
	const minAttack = 9; // 起音为 0 时防爆音
	attack = attack * sampleRate || minAttack;
	decay *= sampleRate;
	sustain *= sampleRate;
	release *= sampleRate;
	delay *= sampleRate;
	deltaSlide *= (500 * PI2) / sampleRate ** 3;
	modulation *= PI2 / sampleRate;
	pitchJump *= PI2 / sampleRate;
	pitchJumpTime *= sampleRate;
	repeatTime = (repeatTime * sampleRate) | 0;
	const length = (attack + decay + sustain + release + delay) | 0;
	const b = new Float32Array(Math.max(0, length));
	for (; i < length; b[i++] = s * volume) {
		if (!(++crush % ((bitCrush * 100) | 0))) {
			s = shape
				? shape > 1
					? shape > 2
						? shape > 3
							? shape > 4
								? (((t / PI2) % 1) < shapeCurve / 2 ? 1 : 0) * 2 - 1
								: Math.sin(t ** 3)
							: Math.max(Math.min(Math.tan(t), 1), -1)
						: 1 - ((((2 * t) / PI2) % 2) + 2) % 2
					: 1 - 4 * abs(Math.round(t / PI2) - t / PI2)
				: Math.sin(t);
			s =
				(repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
				(shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
				(i < attack
					? i / attack
					: i < attack + decay
						? 1 - ((i - attack) / decay) * (1 - sustainVolume)
						: i < attack + decay + sustain
							? sustainVolume
							: i < length - delay
								? ((length - i - delay) / release) * sustainVolume
								: 0);
			s = delay ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2 / volume) : s;
			if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
		}
		f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
		t += f + f * noise * (((i * i * PI2) % 2) - 1);
		if (jump && ++jump > pitchJumpTime) {
			frequency += pitchJump;
			startFrequency += pitchJump;
			jump = 0;
		}
		if (repeatTime && !(++repeat % repeatTime)) {
			frequency = startFrequency;
			slide = startSlide;
			jump ||= 1;
		}
	}
	return b;
}
