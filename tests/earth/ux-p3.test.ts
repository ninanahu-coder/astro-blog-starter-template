// 体验改造 P3：画面设置三档（docs/earth-game/ux-p3.md）。
// 纯函数（档位怎么选、每档开什么、配图地址怎么换）、1 倍配图素材、设置读写、页面接线。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { calmMotion, DEFAULT_PREFS, parsePrefs, VISUAL_OPTIONS } from '../../src/game/ui/prefs.ts';
import { cgiForPreset, cgiSrc, readSaveData, resolvePreset, VISUAL_FX } from '../../src/game/ui/visual.ts';

const PAGE = readFileSync('src/pages/earth.astro', 'utf8');
const CGI = 'public/earth/cgi/';
const manifest = JSON.parse(readFileSync(CGI + 'manifest.json', 'utf8')) as { images: Record<string, string> };

function webpSize(buf: Buffer) {
	const kind = buf.toString('ascii', 12, 16);
	if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
	if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
	if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
	throw new Error('不是 WebP：' + kind);
}

test('P3 档位表：和方案 §7 的表一致', () => {
	assert.deepEqual(VISUAL_FX.standard, { clips: true, basemap: true, calm: false, hiDpi: true, beds: true });
	assert.deepEqual(VISUAL_FX.battery, { clips: false, basemap: true, calm: true, hiDpi: true, beds: false });
	assert.deepEqual(VISUAL_FX.data, { clips: false, basemap: false, calm: true, hiDpi: false, beds: false });
});

test('P3 跟随系统：省流量优先，其次减少动态效果，否则标准；手动选的档位不看系统', () => {
	assert.equal(resolvePreset('auto', { saveData: false, reduceMotion: false }), 'standard');
	assert.equal(resolvePreset('auto', { saveData: false, reduceMotion: true }), 'battery');
	assert.equal(resolvePreset('auto', { saveData: true, reduceMotion: false }), 'data');
	assert.equal(resolvePreset('auto', { saveData: true, reduceMotion: true }), 'data', '两个都开时按省流量（它也省电）');
	for (const m of ['standard', 'battery', 'data'] as const) {
		for (const saveData of [false, true]) for (const reduceMotion of [false, true]) assert.equal(resolvePreset(m, { saveData, reduceMotion }), m);
	}
});

test('P3 系统省流量：只认 navigator.connection.saveData === true；Safari、火狐没有这个接口当作没开', () => {
	assert.equal(readSaveData({ connection: { saveData: true } }), true);
	for (const nav of [undefined, null, {}, { connection: null }, { connection: {} }, { connection: { saveData: false } }, { connection: { saveData: 'true' } }, { connection: { saveData: 1 } }]) {
		assert.equal(readSaveData(nav), false, JSON.stringify(nav));
	}
});

test('P3 配图地址：省流量档换成 /earth/cgi/1x/ 下同名文件；不是标准格式的地址原样返回，拼不出别的路径', () => {
	assert.equal(cgiSrc('/earth/cgi/perth.webp', true), '/earth/cgi/perth.webp');
	assert.equal(cgiSrc('/earth/cgi/perth.webp', false), '/earth/cgi/1x/perth.webp');
	assert.equal(cgiSrc('/earth/cgi/event-v-park-magpie.webp', false), '/earth/cgi/1x/event-v-park-magpie.webp');
	for (const odd of ['/earth/cgi/../sw.js', '/earth/cgi/x.webp?"><b>', '/earth/cgi/1x/perth.webp', '/earth/media/loc/perth.webp', 'https://evil.test/earth/cgi/a.webp', '/earth/cgi/A.webp', '/earth/cgi/a.png', '']) {
		assert.equal(cgiSrc(odd, false), odd, odd);
	}
	assert.deepEqual(cgiForPreset({ a: '/earth/cgi/a.webp', b: '/x' }, false), { a: '/earth/cgi/1x/a.webp', b: '/x' });
	assert.deepEqual(cgiForPreset({ a: '/earth/cgi/a.webp' }, true), { a: '/earth/cgi/a.webp' });
	assert.deepEqual(cgiForPreset({ a: 1 as unknown as string }, false), {}, '清单里不是字符串的项丢掉');
});

test('P3 1 倍配图：清单里每张图都有，正好一半宽高，比原图小；1x 目录里没有清单以外的文件', () => {
	const names = new Set(Object.values(manifest.images).map((u) => u.replace('/earth/cgi/', '')));
	let src = 0, out = 0;
	for (const n of names) {
		const a = readFileSync(CGI + n), b = readFileSync(CGI + '1x/' + n);
		const sa = webpSize(a), sb = webpSize(b);
		assert.ok(Math.abs(sb.w - sa.w / 2) <= 0.5 && Math.abs(sb.h - sa.h / 2) <= 0.5, `${n}：${sa.w}×${sa.h} → ${sb.w}×${sb.h}`);
		assert.ok(b.length < a.length, `${n} 的 1 倍图不比原图小`);
		assert.ok(b.length < 80_000, `${n} 的 1 倍图太大`);
		src += a.length;
		out += b.length;
	}
	assert.ok(out < src * 0.4, `1 倍图总量 ${out} 应不到原图 ${src} 的四成`);
	for (const f of readdirSync(CGI + '1x')) assert.ok(f === 'sources.json' || names.has(f), `1x 目录里多了 ${f}`);
	// 换了原图（尺寸不变）却忘了重跑生成脚本：1 倍图还是旧画面。记录的原图指纹对不上就报
	const sources = JSON.parse(readFileSync(CGI + '1x/sources.json', 'utf8')) as Record<string, string>;
	assert.deepEqual(Object.keys(sources).sort(), [...names].sort(), 'sources.json 和清单一一对应');
	for (const n of names) assert.equal(sources[n], createHash('sha256').update(readFileSync(CGI + n)).digest('hex').slice(0, 16), `${n} 的原图换过了，重跑 tools/earth/media/cgi-1x.py`);
	assert.ok(existsSync('tools/earth/media/cgi-1x.py') && statSync('tools/earth/media/cgi-1x.py').size > 0, '生成脚本在仓库里');
});

test('P3 设置：默认跟随系统；四个取值原样读回；坏值、原型链上的值退回默认', () => {
	assert.equal(DEFAULT_PREFS.visual, 'auto');
	assert.deepEqual(VISUAL_OPTIONS.map(([v]) => v), ['auto', 'standard', 'battery', 'data']);
	for (const v of ['auto', 'standard', 'battery', 'data']) assert.equal(parsePrefs(JSON.stringify({ visual: v })).visual, v);
	for (const raw of [JSON.stringify({ visual: 'ultra' }), JSON.stringify({ visual: 1 }), JSON.stringify({ visual: 'toString' }), '{"__proto__":{"visual":"data"}}']) {
		assert.equal(parsePrefs(raw).visual, 'auto', raw);
	}
	assert.equal(parsePrefs(JSON.stringify({ font: 'l' })).visual, 'auto', '老玩家的设置里没有这一项：跟随系统');
});

test('P3 动画：画面档要求从简时「跟随系统」跟着从简；明确选了「正常」或「减少」时听玩家的', () => {
	const p = (motion: 'auto' | 'reduce' | 'full') => ({ ...DEFAULT_PREFS, motion });
	assert.equal(calmMotion(p('auto'), false, true), true);
	assert.equal(calmMotion(p('auto'), false, false), false);
	assert.equal(calmMotion(p('auto'), true, false), true);
	assert.equal(calmMotion(p('full'), true, true), false);
	assert.equal(calmMotion(p('reduce'), false, false), true);
	assert.equal(calmMotion(p('auto'), false), false, '不传画面档时和以前一样');
});

test('P3 页面接线：底图、短片、环境音、动画、配图都经过画面档；系统信号变了跟着换档；省流量档拆掉底图', () => {
	assert.match(PAGE, /canUseBasemap\(\{ pref: prefs\.basemap && fx\.basemap,/, '底图看画面档');
	assert.match(PAGE, /heroHtml\(esc, fx\.clips \? media\.loc\[key\] : undefined, cgi\[key\], fallback\)/, '短片看画面档');
	assert.match(PAGE, /ambience: prefs\.ambience && fx\.beds, music: prefs\.music && fx\.beds/, '混音台看画面档');
	assert.match(PAGE, /beds\.setAmbience\(prefs\.ambience && fx\.beds \?/);
	assert.match(PAGE, /beds\.setMusic\(prefs\.music && fx\.beds \?/);
	assert.match(PAGE, /cl\.toggle\('calm', calmMotion\(prefs, sys, fx\.calm\)\)/, '动画看画面档');
	assert.match(PAGE, /preset = resolvePreset\(prefs\.visual, \{ saveData: readSaveData\(typeof navigator === 'object' \? navigator : null\), reduceMotion: sys \}\);/, '系统的两个信号都传进选档');
	assert.match(PAGE, /function buzz\(p: number \| number\[\]\) \{\n\t+if \(!prefs\.haptic \|\| calmMotion\(prefs, sysReduce\)\) return;/, '震动不跟画面档（复核）');
	assert.match(PAGE, /cgi = cgiForPreset\(cgiRaw, fx\.hiDpi\);[\s\S]{0,40}const cl = document/, '换档时配图地址跟着换');
	assert.match(PAGE, /cgiRaw = m\.images && typeof m\.images === 'object' \? m\.images : \{\}; cgi = cgiForPreset\(cgiRaw, fx\.hiDpi\)/, '清单到了按当前档换地址');
	assert.match(PAGE, /function visualChanged\(\) \{\n\t+if \(!fx\.basemap\) dropBasemap\(\);\n\t+syncScene\(\);/, '换到省流量档马上拆底图、停环境音');
	assert.match(PAGE, /matchMedia\('\(prefers-reduced-motion: reduce\)'\) : null;\n\t+mq\?\.addEventListener\?\.\('change', followSystem\)/, '系统减少动态效果变了跟着换');
	assert.match(PAGE, /connection\?\.addEventListener\?\.\('change', followSystem\)/, '系统省流量变了跟着换');
	assert.match(PAGE, /k === 'visual' && VISUAL_OPTIONS\.some\(\(\[v\]\) => v === d\.val\)\) \{ setPrefs\(\{ visual: d\.val as Prefs\['visual'\] \}\); visualChanged\(\); \}/);
});
