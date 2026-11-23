// 环境音和背景音乐的合成器（v37）：配方数据在合理范围；引擎按配方接线、换场景时淡出旧的、音乐按小节排音、停了不再排
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEDS, createBeds, FAMILY_TONE, midiHz, MOODS_DEF, parseMusic, PENTA, type BedCtx } from '../../src/game/ui/ambient.ts';

/** 假的 AudioContext：记录每个节点的种类、参数、连到哪、什么时候开始和停 */
export function fakeBedCtx() {
	type N = { kind: string; type?: string; f?: number; q?: number; to: unknown[]; p?: unknown; start?: number; stop?: number; loop?: boolean; buffer?: unknown; gains: [string, number, number][] };
	const nodes: N[] = [];
	let buffers = 0;
	const param = (n: N, name: string) => ({
		value: 1,
		setValueAtTime: (v: number, t: number) => { n.gains.push([name + ':set', v, t]); },
		linearRampToValueAtTime: (v: number, t: number) => { n.gains.push([name + ':lin', v, t]); },
		exponentialRampToValueAtTime: (v: number, t: number) => { n.gains.push([name + ':exp', v, t]); },
	});
	const mk = (kind: string) => { const n: N = { kind, to: [], gains: [] }; nodes.push(n); return n; };
	const ctx: BedCtx = {
		currentTime: 10,
		sampleRate: 1000,
		destination: { dest: true },
		createBuffer(_c, len) { buffers++; const d = new Float32Array(len); return { getChannelData: () => d, data: d } as never; },
		createBufferSource() {
			const n = mk('src');
			return { set buffer(b: unknown) { n.buffer = b; }, get buffer() { return n.buffer; }, set loop(v: boolean) { n.loop = v; }, get loop() { return !!n.loop; }, connect: (x: unknown) => { n.to.push(x); }, start: (t = 0) => { n.start = t; }, stop: (t = 0) => { n.stop = t; } };
		},
		createBiquadFilter() {
			const n = mk('filter');
			const fp = Object.defineProperty(param(n, 'freq'), 'value', { set(v: number) { n.f = v; }, get() { return n.f ?? 0; } });
			n.p = fp;
			return { set type(v: string) { n.type = v; }, get type() { return n.type ?? ''; }, frequency: fp, Q: { set value(v: number) { n.q = v; }, get value() { return n.q ?? 0; } }, connect: (x: unknown) => { n.to.push(x); }, self: n } as never;
		},
		createOscillator() {
			const n = mk('osc');
			return { set type(v: string) { n.type = v; }, get type() { return n.type ?? ''; }, frequency: { set value(v: number) { n.f = v; }, get value() { return n.f ?? 0; } }, connect: (x: unknown) => { n.to.push(x); }, start: (t: number) => { n.start = t; }, stop: (t: number) => { n.stop = t; } };
		},
		createGain() {
			const n = mk('gain');
			n.p = param(n, 'gain');
			const g = { gain: n.p as ReturnType<typeof param>, connect: (x: unknown) => { n.to.push(x); }, self: n };
			return g;
		},
	};
	return { ctx, nodes, buffers: () => buffers };
}

/** 手动定时器 */
function manualTimers() {
	const q: { f: () => void; ms: number; id: number; dead?: boolean }[] = [];
	let id = 0;
	return {
		q,
		setTimer: (f: () => void, ms: number) => { q.push({ f, ms, id: ++id }); return id; },
		clearTimer: (x: unknown) => { for (const t of q) if (t.id === x) t.dead = true; },
		runNext() { const t = q.find((x) => !x.dead); if (!t) return false; t.dead = true; t.f(); return true; },
		live: () => q.filter((x) => !x.dead).length,
	};
}

test('环境音配方：每种都有层，音量很轻，滤波频率在可听范围，起伏不会让音量变负', () => {
	for (const [id, layers] of Object.entries(BEDS)) {
		assert.ok(layers.length >= 1, id);
		for (const L of layers) {
			assert.ok(L.level > 0 && L.level <= 0.12, `${id} 音量 ${L.level}`);
			assert.ok(L.f >= 50 && L.f <= 8000, `${id} 频率`);
			assert.ok(L.q > 0);
			if (L.lfo?.target === 'gain') assert.ok(L.lfo.depth < L.level, `${id} 起伏比音量小`);
			if (L.lfo?.target === 'freq') assert.ok(L.lfo.depth < L.f, `${id} 频率摆动不过零`);
			if (L.lfo) assert.ok(L.lfo.rate > 0 && L.lfo.rate < 1, `${id} 起伏慢于每秒一次`);
		}
	}
	for (const id of ['sea', 'city', 'inland', 'rain', 'storm']) assert.ok(BEDS[id as keyof typeof BEDS]);
});

test('音乐配方：五种情绪 × 三类地点都能解析；和弦落在人耳舒适的音域；音量比提示音轻', () => {
	for (const [mood, d] of Object.entries(MOODS_DEF)) {
		assert.ok(d.bar >= 2 && d.bar <= 8, mood);
		assert.ok(d.level > 0 && d.level <= 0.05, mood);
		assert.ok(d.sparkle >= 0 && d.sparkle <= 1);
		for (const fam of Object.keys(FAMILY_TONE)) {
			assert.deepEqual(parseMusic(`${mood}:${fam}`), { mood, family: fam });
			for (const ch of d.chords) for (const n of ch) {
				const hz = midiHz(FAMILY_TONE[fam as keyof typeof FAMILY_TONE].root + n);
				assert.ok(hz >= 80 && hz <= 1200, `${mood}:${fam} ${hz}`);
			}
		}
	}
	assert.equal(MOODS_DEF.night.level < MOODS_DEF.day.level, true, '夜里更轻');
	assert.ok(MOODS_DEF.festival.bar < MOODS_DEF.day.bar, '节日更欢快');
	assert.ok(PENTA.every((n) => n >= 12 && n <= 24));
	assert.equal(midiHz(69), 440);
	for (const bad of ['day', 'day:moon', 'toString:sea', 'day:__proto__', '', ':']) assert.equal(parseMusic(bad), null, bad);
});

test('环境音：按配方接好「噪声 → 滤波 → 音量 → 分轨」并循环；起伏接到对应参数；淡入', () => {
	const f = fakeBedCtx();
	const out = { amb: true };
	const beds = createBeds(f.ctx, out, {}, { setTimer: () => 0, clearTimer: () => {} });
	beds.setAmbience('inland');
	assert.equal(beds.amb, 'inland');
	const srcs = f.nodes.filter((n) => n.kind === 'src');
	assert.equal(srcs.length, BEDS.inland.length);
	assert.ok(srcs.every((s) => s.loop && s.buffer && s.start === 10));
	const flt = f.nodes.find((n) => n.kind === 'filter')!;
	assert.equal(flt.type, 'bandpass');
	assert.equal(flt.f, 700);
	assert.ok(srcs[0].to[0] && (srcs[0].to[0] as { self: unknown }).self === flt, '噪声接滤波');
	// 风：起伏接到滤波频率上
	const lfo = f.nodes.find((n) => n.kind === 'osc')!;
	assert.equal(lfo.f, BEDS.inland[0].lfo!.rate);
	const depth = f.nodes.find((n) => n.kind === 'gain' && n.gains.some(([k, v]) => k === 'gain:set' && v === 300))!;
	assert.equal((lfo.to[0] as { self?: unknown }).self, depth, '起伏振荡器接深度');
	assert.equal(depth.to[0], flt.p, '深度接到滤波频率参数上');
	// 分轨总线淡入、接到给的输出
	const bus = f.nodes.find((n) => n.kind === 'gain' && n.to.includes(out))!;
	assert.deepEqual(bus.gains.map(([k, v]) => [k, v]), [['gain:set', 0], ['gain:lin', 1]]);
	// 同一个场景再设一次不重建
	const before = f.nodes.length;
	beds.setAmbience('inland');
	assert.equal(f.nodes.length, before);
	assert.equal(f.buffers(), 1);
});

test('海浪的起伏接到音量上；换场景时旧的淡出并停掉，噪声只生成一次', () => {
	const f = fakeBedCtx();
	const beds = createBeds(f.ctx, {}, {}, { setTimer: () => 0, clearTimer: () => {} });
	beds.setAmbience('sea');
	const seaSrc = f.nodes.find((n) => n.kind === 'src')!;
	const seaLfo = f.nodes.find((n) => n.kind === 'osc')!;
	const layerGain = f.nodes.find((n) => n.kind === 'gain' && n.gains.some(([k, v]) => k === 'gain:set' && v === BEDS.sea[0].level))!;
	const depth = f.nodes.find((n) => n.kind === 'gain' && n.gains.some(([k, v]) => k === 'gain:set' && v === BEDS.sea[0].lfo!.depth))!;
	assert.equal(depth.to[0], layerGain.p, '海浪的起伏接到这一层的音量参数上');
	assert.equal(seaSrc.stop, undefined);
	f.ctx.currentTime = 20;
	beds.setAmbience('rain');
	assert.equal(beds.amb, 'rain');
	assert.ok(seaSrc.stop! > 20 && seaSrc.stop! <= 22, '旧的淡出后停');
	assert.ok(seaLfo.stop! > 20, '起伏也停');
	assert.equal(f.buffers(), 1, '噪声复用');
	assert.equal(f.nodes.filter((n) => n.kind === 'filter' && n.type === 'highpass').length, 1);
	beds.setAmbience(null);
	assert.equal(beds.amb, null);
	assert.ok(f.nodes.filter((n) => n.kind === 'src').every((s) => s.stop !== undefined), '关掉后全部停');
	beds.setAmbience('bogus' as never);
	assert.equal(beds.amb, null, '不认识的不放');
});

test('音乐：每小节排一个和弦，点缀音按概率；定时器接着排下一小节；换曲和停止后不再排', () => {
	const f = fakeBedCtx();
	const tm = manualTimers();
	const out = { music: true };
	const beds = createBeds(f.ctx, {}, out, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, rand: () => 0 });
	beds.setMusic('day:city');
	assert.equal(beds.music, 'day:city');
	const def = MOODS_DEF.day;
	const oscs = () => f.nodes.filter((n) => n.kind === 'osc');
	// 第一小节：三个和弦音 + 一个点缀音（rand=0 < sparkle）
	assert.equal(oscs().length, def.chords[0].length + 1);
	assert.deepEqual(oscs().slice(0, 3).map((o) => Math.round(o.f!)), def.chords[0].map((n) => Math.round(midiHz(60 + n))));
	assert.ok(oscs().slice(0, 3).every((o) => o.type === 'triangle'), '城市用三角波');
	assert.equal(oscs()[3].f, midiHz(60 + PENTA[0]));
	const t1 = oscs()[0].start!;
	assert.ok(t1 >= 10 && t1 < 10.5);
	assert.ok(oscs().every((o) => o.stop! > o.start!));
	assert.equal(tm.live(), 1);
	tm.runNext();
	assert.equal(oscs().length, 2 * (def.chords[0].length + 1));
	assert.ok(Math.abs(oscs()[4].start! - (t1 + def.bar)) < 1e-9, '下一小节紧接着');
	assert.deepEqual(oscs().slice(4, 7).map((o) => Math.round(o.f!)), def.chords[1].map((n) => Math.round(midiHz(60 + n))), '和弦往下走');
	// 后台标签页定时器慢了：落后时从现在接着排，不一口气补
	f.ctx.currentTime = 100;
	tm.runNext();
	assert.ok(oscs()[8].start! >= 100);
	// 换曲：旧的定时器取消，新曲从头排
	beds.setMusic('night:sea');
	assert.equal(tm.live(), 1, '只剩新曲的定时器');
	const n = oscs().length;
	beds.setMusic('night:sea');
	assert.equal(oscs().length, n, '同一首不重来');
	beds.setMusic(null);
	assert.equal(beds.music, null);
	assert.equal(tm.live(), 0);
	assert.equal(tm.runNext(), false);
	beds.setMusic('nope');
	assert.equal(beds.music, null, '不认识的不放');
});

test('音乐：点缀音概率为 0 时不加；stop() 同时停环境音和音乐', () => {
	const f = fakeBedCtx();
	const tm = manualTimers();
	const beds = createBeds(f.ctx, {}, {}, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, rand: () => 0.99 });
	beds.setMusic('night:inland');
	assert.equal(f.nodes.filter((n) => n.kind === 'osc').length, MOODS_DEF.night.chords[0].length, '0.99 超过夜晚的点缀概率');
	beds.setAmbience('city');
	beds.stop();
	assert.equal(beds.amb, null);
	assert.equal(beds.music, null);
	assert.equal(tm.live(), 0);
});

test('音乐：已经排进队列、取消不掉的旧定时器在换曲或停止后触发，也不会再排音', () => {
	const f = fakeBedCtx();
	const tm = manualTimers();
	// 浏览器里回调可能已经在队列里了：这里让取消不起作用来模拟
	const beds = createBeds(f.ctx, {}, {}, { setTimer: tm.setTimer, clearTimer: () => {}, rand: () => 0.99 });
	beds.setMusic('day:sea');
	beds.setMusic(null);
	const n = f.nodes.filter((x) => x.kind === 'osc').length;
	for (let i = 0; i < 10 && tm.runNext(); i++) {}
	assert.equal(f.nodes.filter((x) => x.kind === 'osc').length, n, '旧曲不再出声');
	assert.equal(tm.live(), 0, '也不再排新的定时器');
});
