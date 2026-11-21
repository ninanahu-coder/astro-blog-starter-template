// 从游戏数据生成人物渲染清单：形象（AVATARS）、出身（ORIGINS）、职业（CAREERS）都直接读游戏代码，
// 所以游戏里加了形象、出身或职业，重跑这个脚本，清单就会跟着变（tests/earth/characters.test.ts 也会提醒）。
// 用法：node tools/earth/blender/make-spec.mjs [输出路径]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATARS, ORIGINS, originSkills } from '../../../src/game/core/character.ts';
import { CAREERS } from '../../../src/game/data/careers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOKS = JSON.parse(readFileSync(join(HERE, 'looks.json'), 'utf8'));

/** 证件照的文件名：出身 id + 形象下标（形象下标就是 AVATARS 里的位置） */
export const bustKey = (originId, lookIndex) => `${originId}-${lookIndex}`;

export function buildSpec() {
	const characters = [];
	// 1. 证件照：每个出身 × 每个形象，体型按这个出身的起步力量和体能
	for (const o of ORIGINS) {
		const sk = originSkills(o);
		AVATARS.forEach((_, i) => characters.push({ id: bustKey(o.id, i), look: i, outfit: o.id, attrs: { strength: sk.strength, stamina: sk.stamina }, shots: ['bust'] }));
	}
	// 2. 出身全身照（展示用）：每个出身挑一个不同的形象
	const heroLook = { backpacker: 8, fifo: 3, student: 1, surfer: 5 };
	for (const o of ORIGINS) {
		const sk = originSkills(o);
		characters.push({ id: `full-${o.id}`, look: heroLook[o.id] ?? 0, outfit: o.id, attrs: { strength: sk.strength, stamina: sk.stamina }, shots: ['full'] });
	}
	// 3. 职业全身照（展示用）：形象轮着用，跳过自带头饰的两个，让安全帽、鸭舌帽能露出来
	const plain = AVATARS.map((_, i) => i).filter((i) => LOOKS.looks[i].hair.style !== 'hijab' && !(LOOKS.looks[i].extras ?? []).includes('widehat'));
	CAREERS.forEach((c, n) => characters.push({ id: `job-${c.id}`, look: plain[(n * 3 + 1) % plain.length], outfit: c.id, attrs: { strength: 30, stamina: 30 }, shots: ['full'] }));
	// 4. 数值怎么变成外形（展示用）：同一个人，只改一项数值
	const demo = { look: 0, outfit: 'student', shots: ['full'] };
	const base = { strength: 10, stamina: 10, energy: 80, hygiene: 80, fun: 80, social: 80 };
	for (const [id, attrs] of [
		['demo-base', {}],
		['demo-strength-55', { strength: 55 }],
		['demo-strength-100', { strength: 100, stamina: 60 }],
		['demo-energy-10', { energy: 10 }],
		['demo-hygiene-10', { hygiene: 10 }],
		['demo-mood-10', { fun: 10, social: 10 }],
	]) characters.push({ ...demo, id, attrs: { ...base, ...attrs } });
	return { characters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2] ?? join(HERE, 'out', 'spec.json');
	mkdirSync(dirname(out), { recursive: true });
	const spec = buildSpec();
	writeFileSync(out, JSON.stringify(spec, null, '\t'));
	console.log(`${out}: ${spec.characters.length} 个人物，${spec.characters.reduce((n, c) => n + c.shots.length, 0)} 张图`);
}
