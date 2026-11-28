import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCharacter } from '../../src/game/core/character.ts';
import { CAREERS } from '../../src/game/data/careers.ts';
import { WORLD_BASE } from '../../src/game/data/areas-base.ts';
import { careerGuide, careerGuideHtml } from '../../src/game/ui/career-guide.ts';

const make = () => createCharacter({ id: 'guide-test', name: '测', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: 'perth', seed: 7 });

test('十个部门都有入门路线，背包客的缺项完全来自现有数据', () => {
	const rows = careerGuide(make(), WORLD_BASE);
	assert.deepEqual(rows.map((x) => x.id), CAREERS.map((x) => x.id));
	assert.deepEqual(rows.filter((x) => x.missing.length).map((x) => x.id), ['lifeguard', 'miner', 'trucker', 'builder', 'carer', 'it-support']);
	assert.match(rows.find((x) => x.id === 'lifeguard')!.missing[0], /^游泳 5\/25：冲浪学校 \$42\/次，2 小时；去/);
	assert.match(rows.find((x) => x.id === 'miner')!.missing[0], /^力量 5\/20：健身私教 \$48\/次，1\.5 小时；去/);
	assert.deepEqual(rows.find((x) => x.id === 'trucker')!.missing.map((x) => x.split('；')[0]), [
		'重型卡车驾照：$600，8 小时',
		'驾驶 5/20：驾校课程 $48/次，2 小时',
	]);
	assert.match(rows.find((x) => x.id === 'builder')!.missing[0], /^White Card 建筑安全卡：\$35，7\.5 小时；去/);
	assert.match(rows.find((x) => x.id === 'carer')!.missing[0], /^急救证（HLTAID011）：\$145，8 小时；去/);
	assert.deepEqual(rows.find((x) => x.id === 'it-support')!.missing.map((x) => x.split('；')[0]), [
		'英语强化班：10 次 × $25，每次 2 小时',
		'TAFE 四级证书·信息技术（ICT40120）：15 次 × $45，每次 4 小时',
	]);
});

test('拿到证照、练够能力后缺项消失；函数不修改存档', () => {
	const s = make();
	s.certs.push('hr-licence', 'white-card', 'first-aid', 'english', 'cert4-it');
	s.skills.swimming = 25;
	s.skills.strength = 20;
	s.skills.driving = 20;
	const before = JSON.stringify(s);
	assert.ok(careerGuide(s, WORLD_BASE).every((x) => x.missing.length === 0));
	assert.equal(JSON.stringify(s), before);
});

test('最近地点固定，HTML 转义玩家可见的地点和职业文字', () => {
	const s = make();
	const a = careerGuide(s, WORLD_BASE);
	const b = careerGuide(s, WORLD_BASE);
	assert.deepEqual(a.map((x) => x.apply.id), b.map((x) => x.apply.id));
	const dirty = structuredClone(WORLD_BASE);
	dirty.locations.find((x) => x.id === 'perth')!.name = '<珀斯>';
	const html = careerGuideHtml(s, dirty, (x) => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
	assert.doesNotMatch(html, /<珀斯>/);
	assert.match(html, /&lt;珀斯&gt;/);
});
