// 音效（第 29 轮）：提示音短、轻、频率在人耳舒适范围；播放时每个音一个振荡器，按时间排好、都会停
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUES, playCue, VOLUME, type AudioLike, type Cue } from '../../src/game/ui/sound.ts';

/** 假的 AudioContext：记下每个振荡器的频率和起止时间 */
export function fakeAudio(now = 5) {
	const oscs: { f: number; start: number; stop: number }[] = [];
	const peaks: number[] = [];
	let resumed = 0;
	const ctx: AudioLike & { state: string } = {
		currentTime: now,
		state: 'suspended',
		resume: () => { resumed++; },
		destination: {},
		createOscillator() {
			const o = { f: 0, start: -1, stop: -1 };
			oscs.push(o);
			return { type: '', frequency: { set value(v: number) { o.f = v; }, get value() { return o.f; } }, connect: () => {}, start: (t: number) => { o.start = t; }, stop: (t: number) => { o.stop = t; } };
		},
		createGain() {
			return { gain: { setValueAtTime() {}, linearRampToValueAtTime: (v: number) => { peaks.push(v); }, exponentialRampToValueAtTime() {} }, connect: () => {} };
		},
	};
	return { ctx, oscs, peaks, resumed: () => resumed };
}

test('提示音数据：每种都有音，整段不超过半秒，频率 150–2000 Hz，音量很轻', () => {
	assert.ok(VOLUME > 0 && VOLUME <= 0.15);
	for (const [cue, notes] of Object.entries(CUES)) {
		assert.ok(notes.length >= 1, cue);
		for (const n of notes) {
			assert.ok(n.f >= 150 && n.f <= 2000, `${cue} 频率 ${n.f}`);
			assert.ok(n.at >= 0 && n.d > 0, cue);
			assert.ok(n.at + n.d <= 0.5, `${cue} 太长`);
		}
	}
});

test('播放：从当前时刻起按顺序排好每个音，每个都会停；挂起的音频会被唤醒', () => {
	for (const cue of Object.keys(CUES) as Cue[]) {
		const a = fakeAudio();
		playCue(a.ctx, cue);
		assert.equal(a.oscs.length, CUES[cue].length, cue);
		CUES[cue].forEach((n, i) => {
			assert.equal(a.oscs[i].f, n.f);
			assert.equal(a.oscs[i].start, 5 + n.at);
			assert.ok(a.oscs[i].stop > a.oscs[i].start, '会停');
		});
		assert.ok(a.peaks.every((v) => v === VOLUME), '峰值不超过设定音量');
		assert.equal(a.resumed(), 1);
	}
});
