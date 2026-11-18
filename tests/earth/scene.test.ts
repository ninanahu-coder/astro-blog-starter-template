// 虚拟人生风格界面：场景背景、需求环、NPC 立绘。都是纯函数，输出确定
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { portraitSvg, ringDash, sceneKind, sceneSvg, sceneWater } from '../../src/game/ui/scene.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import { isCoastal } from '../../src/game/core/sky.ts';

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

// 逐个地点写明该画什么：[场景类型, 有没有海]。新加地点时这里会报缺，逼着人看一眼画得对不对（Codex 界面审查问题 1、3）
const SCENES: Record<string, [string, boolean]> = {
	// 西澳
	perth: ['city', true], fremantle: ['city', true], rottnest: ['coast', true], pinnacles: ['outback', false], bunbury: ['town', true],
	'margaret-river': ['coast', true], albany: ['coast', true], esperance: ['coast', true], 'wave-rock': ['outback', false], kalgoorlie: ['outback', false],
	geraldton: ['town', true], kalbarri: ['coast', true], 'monkey-mia': ['coast', true], exmouth: ['coast', true], karijini: ['outback', false],
	'port-hedland': ['outback', false], broome: ['coast', true], kununurra: ['outback', false], mandurah: ['city', true], busselton: ['town', true],
	pemberton: ['town', false], 'coral-bay': ['coast', true],
	// 南澳
	adelaide: ['city', false], glenelg: ['coast', true], hahndorf: ['town', false], barossa: ['town', false], 'mclaren-vale': ['town', true],
	'victor-harbor': ['coast', true], 'cape-jervis': ['coast', true], 'kangaroo-island': ['coast', true], 'port-lincoln': ['city', true],
	'coober-pedy': ['outback', false], 'flinders-ranges': ['outback', false], 'mount-gambier': ['city', false], ceduna: ['coast', true],
};
const SEA_DAY = '#3f8fc4';

test('场景：每个地点（西澳 + 南澳）画的类型和有没有海都对；内陆小镇不画海，海边一定有海', () => {
	assert.deepEqual(WORLD.locations.map((l) => l.id).sort(), Object.keys(SCENES).sort(), '地点清单和期望表一致');
	for (const l of WORLD.locations) {
		const [kind, water] = SCENES[l.id];
		assert.equal(sceneKind(l.kind, l.tags), kind, `${l.id} 场景类型`);
		assert.equal(sceneWater(l.kind, l.tags), water, `${l.id} 有没有海`);
		assert.equal(sceneWater(l.kind, l.tags), isCoastal(l), `${l.id} 和气温模型的「海边」一致`);
		assert.equal(sceneSvg({ ...base, kind: l.kind, tags: l.tags }).includes(SEA_DAY), water, `${l.id} 画面里${water ? '有' : '没有'}海`);
	}
	// 内陆小镇（彭伯顿、汉多夫）的画面里没有海，地面一直铺到远处
	const inland = sceneSvg({ ...base, kind: 'town', tags: ['wine'] });
	assert.ok(!inland.includes(SEA_DAY) && inland.includes('<rect x="0" y="160" width="390" height="60"'), '内陆小镇不画海');
	assert.ok(sceneSvg({ ...base, kind: 'town', tags: ['beach'] }).includes(SEA_DAY), '海边小镇画海');
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
