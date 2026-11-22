// 提示音（第 29 轮；体验改造 P2 起用 ZzFX 合成，见 ui/zzfx.ts）：短、轻、频率在人耳舒适范围；同一个音只算一次采样，按分轨播放
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUE_RATE, CUES, cueSamples, playCue, VOLUME, type AudioLike, type Cue } from '../../src/game/ui/sound.ts';
import { zzfxSamples } from '../../src/game/ui/zzfx.ts';

/** 假的 AudioContext：记下建过的采样缓冲、放过的声源接到哪里、什么时候开始 */
export function fakeAudio(now = 5) {
	const buffers: { len: number; rate: number; data: Float32Array }[] = [];
	const plays: { buf: unknown; to: unknown; at: number | undefined }[] = [];
	let resumed = 0;
	const ctx: AudioLike & { state: string } = {
		currentTime: now,
		state: 'suspended',
		resume: () => { resumed++; },
		destination: {},
		createOscillator() { throw new Error('提示音不再用振荡器'); },
		createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => {} }; },
		createBuffer(_c: number, len: number, rate: number) { const data = new Float32Array(len); const b = { len, rate, data, getChannelData: () => data }; buffers.push(b); return b; },
		createBufferSource() { const p = { buf: null as unknown, to: null as unknown, at: undefined as number | undefined }; plays.push(p); return { set buffer(v: unknown) { p.buf = v; }, get buffer() { return p.buf; }, connect: (n: unknown) => { p.to = n; }, start: (t?: number) => { p.at = t; } }; },
	};
	return { ctx, buffers, plays, resumed: () => resumed };
}

const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('提示音数据：每种都有声部，整段不超过半秒，频率 60–2000 Hz，只用正弦、三角，噪声只给盖章和雷声', () => {
	assert.ok(VOLUME > 0 && VOLUME <= 0.15);
	for (const [cue, voices] of Object.entries(CUES) as [Cue, (typeof CUES)[Cue]][]) {
		assert.ok(voices.length >= 1 && voices.length <= 4, cue);
		for (const v of voices) {
			const [vol = 1, , f = 220, a = 0, su = 0, re = 0.1, shape = 0] = v.zz;
			assert.ok(vol > 0 && vol <= 1, `${cue} 音量 ${vol}`);
			assert.ok(f >= 60 && f <= 2000, `${cue} 频率 ${f}`);
			assert.ok(v.at >= 0 && v.at + a + su + re <= 0.5, `${cue} 太长`);
			assert.ok(shape === 0 || shape === 1 || (shape === 4 && (cue === 'stamp' || cue === 'storm')), `${cue} 波形 ${shape}`);
		}
		const s = cueSamples(cue);
		assert.ok(s.length > 0 && s.length <= 0.5 * CUE_RATE + 2, `${cue} 采样长度 ${s.length}`);
		assert.ok(peak(s) <= VOLUME * voices.length + 1e-6, `${cue} 峰值 ${peak(s)}`);
		assert.ok(peak(s) > VOLUME * 0.05, `${cue} 不是静音`);
	}
});

test('ZzFX 采样：长度 = 起音 + 衰减 + 持续 + 释放 + 延迟；随机固定时每次一样；起音和释放从 0 开始、回到 0（不爆音）', () => {
	const p = [1, 0.05, 440, 0.01, 0.02, 0.05, 1] as const;
	const a = zzfxSamples([...p], 22050, () => 0.5);
	assert.equal(a.length, Math.floor((0.01 + 0.02 + 0.05) * 22050));
	assert.deepEqual([...a], [...zzfxSamples([...p], 22050, () => 0.5)]);
	assert.ok(Math.abs(a[0]) < 0.01 && Math.abs(a[a.length - 1]) < 0.01);
	assert.ok(peak(a) > 0.5 && peak(a) <= 1);
	// 随机 0.5 时频率不偏：440 Hz 正弦 / 三角每秒约 880 次过零
	const zc = a.slice(0, Math.floor(0.08 * 22050)).reduce((n, v, i, arr) => (i && Math.sign(v) !== Math.sign(arr[i - 1]) ? n + 1 : n), 0);
	assert.ok(Math.abs(zc / 0.08 - 880) < 60, `过零 ${zc}`);
});

test('播放：第一次用到时算好采样存起来，之后直接放；接到给定的分轨，不写时接扬声器；挂起的音频会被唤醒', () => {
	const a = fakeAudio();
	const bus = { bus: 1 };
	playCue(a.ctx, 'ok', bus);
	playCue(a.ctx, 'ok');
	playCue(a.ctx, 'stamp', bus);
	assert.equal(a.buffers.length, 2, '同一个音只建一次缓冲');
	assert.equal(a.buffers[0].rate, CUE_RATE);
	assert.deepEqual([...a.buffers[0].data], [...cueSamples('ok')]);
	assert.equal(a.plays.length, 3);
	assert.equal(a.plays[0].to, bus);
	assert.equal(a.plays[1].to, a.ctx.destination);
	assert.equal(a.plays[0].buf, a.plays[1].buf, '复用同一份缓冲');
	assert.ok(a.plays.every((p) => p.at === 5), '从当前时刻开始');
	assert.equal(a.resumed(), 3);
	const b = fakeAudio();
	playCue(b.ctx, 'ok');
	assert.equal(b.buffers.length, 1, '换一个 AudioContext 重新建');
});

// ---------- v37：分轨声音系统 ----------
import { ambienceFor, channelGains, createMixer, cueAfter, familyOf, MASTER, musicFor } from '../../src/game/ui/sound.ts';
import { WA_BASE } from '../../src/game/data/wa-base.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';

test('动作结算后放哪一声：失败 > 成就 > 升级 > 到达（按天气） > 做成；到达就弹事件的不响', () => {
	assert.equal(cueAfter({ ok: false, ach: true, levelUp: true }), 'fail');
	assert.equal(cueAfter({ ok: true, ach: true, levelUp: true, travel: true }), 'ach');
	assert.equal(cueAfter({ ok: true, levelUp: true, travel: true }), 'level');
	assert.equal(cueAfter({ ok: true, travel: true, weather: 'sunny' }), 'arrive');
	assert.equal(cueAfter({ ok: true, travel: true, weather: 'cold' }), 'arrive', '不认识的天气按普通到达');
	assert.equal(cueAfter({ ok: true, travel: true, weather: 'rain' }), 'rain');
	assert.equal(cueAfter({ ok: true, travel: true, weather: 'storm' }), 'storm');
	assert.equal(cueAfter({ ok: true, travel: true, pending: true, weather: 'storm' }), null);
	assert.equal(cueAfter({ ok: true, pending: true }), 'ok', '不是出行时 pending 不影响');
	assert.equal(cueAfter({ ok: true }), 'ok');
	assert.equal(cueAfter({ ok: true, coin: true }), 'coin', '进账：投币声');
	assert.equal(cueAfter({ ok: true, coin: true, levelUp: true }), 'level', '升级比进账优先');
	assert.equal(cueAfter({ ok: true, coin: true, travel: true, weather: 'sunny' }), 'arrive', '到达比进账优先');
});

test('分轨增益：关掉的轨是 0；总音量三档递增、不认识的档按中', () => {
	assert.deepEqual(channelGains({ sfx: true, ambience: false, music: true, volume: 'mid' }), { master: 1, sfx: 1, ambience: 0, music: 1 });
	assert.ok(MASTER.low < MASTER.mid && MASTER.mid < MASTER.high);
	assert.ok(MASTER.high * 0.08 <= 0.15, '最响时单个提示音也不刺耳');
	assert.equal(channelGains({ sfx: false, ambience: true, music: false, volume: 'x' as never }).master, 1);
	assert.equal(channelGains({ sfx: false, ambience: true, music: false, volume: 'low' }).master, 0.5);
});

test('混音台：三条分轨接总线、总线接扬声器；改设置时各轨的目标增益跟着变', () => {
	const nodes: { to: unknown; set: number[]; target: number[] }[] = [];
	const a = fakeAudio();
	a.ctx.createGain = () => {
		const n = { to: null as unknown, set: [] as number[], target: [] as number[] };
		nodes.push(n);
		return { gain: { setValueAtTime: (v: number) => { n.set.push(v); }, setTargetAtTime: (v: number) => { n.target.push(v); }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => { n.to = x; } } as any;
	};
	const m = createMixer(a.ctx, { sfx: true, ambience: false, music: false, volume: 'high' });
	assert.equal(nodes.length, 4);
	const [master, sfx, amb, mus] = nodes;
	assert.equal(master.to, a.ctx.destination);
	for (const n of [sfx, amb, mus]) assert.equal(n.to, m.master);
	assert.deepEqual([master.set[0], sfx.set[0], amb.set[0], mus.set[0]], [MASTER.high, 1, 0, 0]);
	m.set({ sfx: false, ambience: true, music: true, volume: 'low' });
	assert.deepEqual([master.target[0], sfx.target[0], amb.target[0], mus.target[0]], [MASTER.low, 0, 1, 1]);
});

test('声景分类：城市 > 海边 > 内陆；全部地点都能分到，三类都用上', () => {
	assert.equal(familyOf('city', ['beach']), 'city');
	assert.equal(familyOf('coast', []), 'sea');
	assert.equal(familyOf('island', []), 'sea');
	assert.equal(familyOf('port', []), 'sea');
	assert.equal(familyOf('town', ['beach', 'pub']), 'sea');
	assert.equal(familyOf('park', ['reef']), 'sea');
	assert.equal(familyOf('park', ['surf']), 'sea');
	assert.equal(familyOf('town', ['wine', 'pub']), 'inland');
	assert.equal(familyOf('mining', ['gold']), 'inland');
	assert.equal(familyOf('outback', []), 'inland');
	const fams = new Set([...WA_BASE.locations, ...SA_BASE.locations].map((l) => familyOf(l.kind, l.tags)));
	assert.deepEqual([...fams].sort(), ['city', 'inland', 'sea']);
	const perth = WA_BASE.locations.find((l) => l.id === 'perth')!;
	assert.equal(familyOf(perth.kind, perth.tags), 'city');
	const kal = WA_BASE.locations.find((l) => l.id === 'kalgoorlie')!;
	assert.equal(familyOf(kal.kind, kal.tags), 'inland');
});

test('环境音和音乐跟着场景换：雨、风暴盖过地点；节日盖过天色；不认识的天色按白天', () => {
	const base = { kind: 'coast', tags: ['beach'], weather: 'sunny', phase: 'day', festival: false };
	assert.equal(ambienceFor(base), 'sea');
	assert.equal(ambienceFor({ ...base, weather: 'rain' }), 'rain');
	assert.equal(ambienceFor({ ...base, weather: 'storm' }), 'storm');
	assert.equal(ambienceFor({ ...base, weather: 'cold' }), 'sea', '以后新加的天气按地点');
	assert.equal(ambienceFor({ ...base, kind: 'mining', tags: [] }), 'inland');
	assert.equal(musicFor(base), 'day:sea');
	assert.equal(musicFor({ ...base, phase: 'night' }), 'night:sea');
	assert.equal(musicFor({ ...base, phase: 'dusk', kind: 'city' }), 'dusk:city');
	assert.equal(musicFor({ ...base, phase: 'night', festival: true }), 'festival:sea');
	assert.equal(musicFor({ ...base, phase: 'noon' }), 'day:sea');
});

test('页面模板（v37，合并 main 时这几处两边都改过）：动作后按结果挑一声、盖章响一声、渲染时换环境音并补交引导动作、NPC 语音照常播放', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/pages/earth.astro', import.meta.url), 'utf8');
	assert.match(src, /toast\(`🏅 达成成就：\$\{got\.map\(\(d\) => d\.name\)\.join\('、'\)\}（去成长页领奖）`\), 1200\);\n\t*const cue = cueAfter\(\{[^\n]*\}\);\n\t*if \(cue\) sfx\(cue\);/, '成就提示带「去成长页领奖」，之后按结果挑一声');
	assert.match(src, /\$\('c-card'\)\.classList\.add\('stamped'\);\n\t*sfx\('stamp'\);/, '入境章落下时响一声');
	assert.match(src, /renderEvent\(\);\n\t*syncScene\(\);\n\t*if \(obPending\.length\) void flushOnboard\(\);/, '每次渲染：换环境音，再补交断网时没交上的引导动作');
	assert.match(src, /voicePlayer = new Audio\(line\.src\);[\s\S]{0,120}voicePlayer\.play\(\)\.catch/, 'NPC 打招呼语音照常播放');
});
