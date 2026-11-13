// 性格特质：创建角色时选 2 个，永久生效。
// 每个特质只是一组修正系数（TraitMods），引擎统一读取，不为某个特质写特例。
import type { TraitDef } from '../core/types.ts';

export const MAX_TRAITS = 2;

export const TRAITS: TraitDef[] = [
	{ id: 'athletic', name: '运动健将', desc: '体能、力量涨得快，但饿得也快。', mods: { gain: { stamina: 1.5, strength: 1.25 }, decay: { hunger: 1.15 } } },
	{ id: 'charming', name: '自来熟', desc: '魅力检定 +10，但离不开人群。', mods: { check: { charisma: 10 }, decay: { social: 1.3 } }, conflicts: ['loner'] },
	{ id: 'loner', name: '独行侠', desc: '不太需要社交，野外成长更快；不擅长与人打交道。', mods: { decay: { social: 0.5 }, gain: { survival: 1.3 }, check: { charisma: -5 } }, conflicts: ['charming'] },
	{ id: 'neat', name: '爱干净', desc: '清洁掉得快，但形象好、魅力成长快。', mods: { decay: { hygiene: 1.5 }, gain: { charisma: 1.2 } } },
	{ id: 'frugal', name: '精打细算', desc: '出行和购物便宜 15%，街头检定 +5。', mods: { cost: 0.85, check: { street: 5 } } },
	{ id: 'daredevil', name: '胆大包天', desc: '体能、街头检定 +5，但更容易惹麻烦。', mods: { check: { stamina: 5, street: 5 }, heat: 1.5 }, conflicts: ['lawful'] },
	{ id: 'lawful', name: '守规矩', desc: '麻烦值只涨一半，但街头检定 −5。', mods: { heat: 0.5, check: { street: -5 } }, conflicts: ['daredevil'] },
	{ id: 'waterborn', name: '水性好', desc: '游泳成长 ×1.5，游泳检定 +5。', mods: { gain: { swimming: 1.5 }, check: { swimming: 5 } } },
	{ id: 'tough', name: '皮糙肉厚', desc: '受到的伤害减少 30%。', mods: { hurt: 0.7 } },
	{ id: 'easygoing', name: '没心没肺', desc: '娱乐需求掉得慢，心情不容易低落。', mods: { decay: { fun: 0.7 }, mood: 8 } },
];
