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

// ---------- v37：分轨声音系统 ----------
import { ambienceFor, channelGains, createMixer, cueAfter, familyOf, MASTER, musicFor } from '../../src/game/ui/sound.ts';
import { WA_BASE } from '../../src/game/data/wa-base.ts';
import { SA_BASE } from '../../src/game/data/sa-base.ts';

test('v37 新提示音：到达、升级、盖章、雨、风暴都有；波形只用柔和的正弦、三角', () => {
	for (const c of ['tap', 'arrive', 'level', 'stamp', 'rain', 'storm'] as Cue[]) assert.ok(CUES[c]?.length, c);
	for (const notes of Object.values(CUES)) for (const n of notes) assert.ok(n.w === undefined || n.w === 'sine' || n.w === 'triangle');
	const a = fakeAudio();
	const types: string[] = [];
	const orig = a.ctx.createOscillator.bind(a.ctx);
	a.ctx.createOscillator = () => { const o = orig(); return new Proxy(o, { set(t, k, v) { if (k === 'type') types.push(v); (t as any)[k] = v; return true; } }); };
	playCue(a.ctx, 'stamp');
	assert.deepEqual(types, ['triangle', 'triangle']);
	playCue(a.ctx, 'ok');
	assert.equal(types[2], 'sine', '没写波形的是正弦');
});

test('提示音接到给定的分轨上，不写时接扬声器', () => {
	const conns: unknown[] = [];
	const a = fakeAudio();
	a.ctx.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => { conns.push(n); } });
	const bus = { bus: 1 };
	playCue(a.ctx, 'ok', bus);
	assert.deepEqual(conns, [bus]);
	playCue(a.ctx, 'ok');
	assert.equal(conns[1], a.ctx.destination);
});

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
