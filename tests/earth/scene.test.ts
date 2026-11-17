// 虚拟人生风格界面：场景背景、需求环、NPC 立绘。都是纯函数，输出确定
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { portraitSvg, ringDash, sceneKind, sceneSvg } from '../../src/game/ui/scene.ts';
import { WA } from '../../src/game/data/wa.ts';

const base = { phase: 'day' as const, weather: 'sunny', kind: 'city', tags: [] as string[] };

test('场景：同样的输入同样的图；装饰图不给读屏；时段、天气、地点类型都会改变画面', () => {
	const a = sceneSvg(base);
	assert.equal(sceneSvg(base), a);
	assert.match(a, /^<svg class="scene-art" viewBox="0 0 390 220"[^>]*aria-hidden="true"/);
	assert.ok(!a.includes('#f4f7ff'), '白天没有星星');
	assert.ok(sceneSvg({ ...base, phase: 'night' }).includes('#f4f7ff'), '夜里有星星');
	assert.ok(sceneSvg({ ...base, phase: 'night' }).includes('#ffd27a'), '夜里城里亮灯');
	const storm = sceneSvg({ ...base, weather: 'storm' });
	assert.ok(storm.includes('#3f4855') && !storm.includes('<circle cx="325"'), '风暴天灰天、没有太阳');
	assert.ok((storm.match(/rotate\(14/g) ?? []).length > (sceneSvg({ ...base, weather: 'rain' }).match(/rotate\(14/g) ?? []).length, '风暴雨比小雨大');
	assert.ok(sceneSvg({ ...base, weather: 'hot' }).includes('opacity="0.3"'), '炎热天太阳有光晕');
	for (const ph of ['dawn', 'day', 'dusk', 'night'] as const) assert.notEqual(sceneSvg({ ...base, phase: ph }), sceneSvg({ ...base, phase: ph === 'day' ? 'dusk' : 'day' }));
	assert.ok(sceneSvg({ ...base, kind: 'outback' }).includes('#c9703f'), '内陆是红土');
	assert.ok(!sceneSvg({ ...base, noFigure: true }).includes('<circle cx="195"'), '事件弹窗背景不画人');
	assert.ok(sceneSvg(base).includes('<circle cx="195"'));
});

test('场景类型：每个地点都有一种；城市港口画楼、海边画海滩、内陆画红土', () => {
	assert.equal(sceneKind('city', []), 'city');
	assert.equal(sceneKind('port', ['beach']), 'city');
	assert.equal(sceneKind('coast', ['beach']), 'coast');
	assert.equal(sceneKind('island', []), 'coast');
	assert.equal(sceneKind('town', ['beach']), 'town');
	assert.equal(sceneKind('outback', []), 'outback');
	assert.equal(sceneKind('mining', []), 'outback');
	assert.equal(sceneKind('park', []), 'outback');
	for (const l of WA.locations) assert.ok(['city', 'coast', 'town', 'outback'].includes(sceneKind(l.kind, l.tags)), l.id);
});

test('需求环和立绘', () => {
	const c = 2 * Math.PI * 21;
	assert.equal(ringDash(0), `0.0 ${c.toFixed(1)}`);
	assert.equal(ringDash(100), `${c.toFixed(1)} ${c.toFixed(1)}`);
	assert.equal(ringDash(150), ringDash(100), '超出按满');
	assert.equal(ringDash(-5), ringDash(0));
	assert.equal(portraitSvg('mia'), portraitSvg('mia'), '同一个人每次一样');
	assert.notEqual(portraitSvg('mia'), portraitSvg('tom'));
	assert.match(portraitSvg('x'), /aria-hidden="true"/);
});
