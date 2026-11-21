// 体验改造 P2：界面图标（按钮、分组、状态）统一用 Lucide 线条图标（ISC 许可，界面里不用署名），和底部标签同一种画法。
// 用法：git clone --depth 1 --filter=blob:none --sparse https://github.com/lucide-icons/lucide.git <dir>（sparse 只要 /LICENSE 和 /icons/*.svg）
//       node tools/earth/icons/build-lucide.mjs <dir>
// 只收下面这几个图标，生成 src/game/ui/lucide-sprite.ts：页面在构建时把雪碧图写进 HTML（不进首屏脚本），用时 <use href="#lu-名字">。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NAMES = ['sparkles', 'shopping-bag', 'briefcase-business', 'house', 'users', 'ticket', 'graduation-cap', 'car', 'paw-print', 'map-pin', 'locate-fixed', 'chevron-right', 'circle-check', 'circle', 'x'];
const dir = process.argv[2];
if (!dir || !existsSync(join(dir, 'icons'))) { console.error('用法：node tools/earth/icons/build-lucide.mjs <lucide 目录>'); process.exit(2); }
const symbols = NAMES.map((n) => {
	const svg = readFileSync(join(dir, 'icons', n + '.svg'), 'utf8');
	if (/<script|\son[a-z]+\s*=|href\s*=|<foreignObject/i.test(svg)) throw new Error('可疑 SVG：' + n);
	const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
	return `<symbol id="lu-${n}" viewBox="0 0 24 24">${inner}</symbol>`;
}).join('');
const license = readFileSync(join(dir, 'LICENSE'), 'utf8').split('\n').slice(0, 3).join(' ').trim();
writeFileSync('src/game/ui/lucide-sprite.ts', `// 自动生成：node tools/earth/icons/build-lucide.mjs（体验改造 P2）。不要手改。
// Lucide 图标 https://lucide.dev — ${license}
export const LUCIDE_NAMES = ${JSON.stringify(NAMES)} as const;
export type LucideName = (typeof LUCIDE_NAMES)[number];
/** 页面在构建时写进 HTML 的雪碧图（隐藏）；线条颜色跟着 currentColor */
export const LUCIDE_SPRITE = ${JSON.stringify(`<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`)};
`);
console.log('生成', NAMES.length, '个图标，', symbols.length, '字节');
