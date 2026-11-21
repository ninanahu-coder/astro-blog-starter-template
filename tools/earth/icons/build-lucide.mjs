// 体验改造 P2：界面图标（按钮、分组、状态）统一用 Lucide 线条图标（ISC 许可，界面里不用署名），和底部标签同一种画法。
// 用法：git clone --depth 1 --filter=blob:none --sparse https://github.com/lucide-icons/lucide.git <dir>（sparse 只要 /LICENSE 和 /icons/*.svg）
//       node tools/earth/icons/build-lucide.mjs <dir>
// 只收下面这几个图标，生成 src/game/ui/lucide-sprite.ts：页面在构建时把雪碧图写进 HTML（不进首屏脚本），用时 <use href="#lu-名字">。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 只由图形元素和几何属性组成（纯函数，测试里也用） */
export function isSafeIcon(inner) {
	const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
	const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points']);
	const rest = inner.replace(/<([a-z]+)((?:\s+[a-z0-9-]+="[^"<>]*")*)\s*\/>/g, (m, tag, attrs) => {
		if (!TAGS.has(tag)) return '\u0000';
		for (const a of attrs.matchAll(/([a-z0-9-]+)="/g)) if (!ATTRS.has(a[1])) return '\u0000';
		return '';
	});
	return rest.trim() === '';
}
export const NAMES = ['sparkles', 'shopping-bag', 'briefcase-business', 'house', 'users', 'ticket', 'graduation-cap', 'car', 'paw-print', 'map-pin', 'locate-fixed', 'chevron-right', 'circle-check', 'circle', 'x'];
function main() {
	const dir = process.argv[2];
	if (!dir || !existsSync(join(dir, 'icons'))) { console.error('用法：node tools/earth/icons/build-lucide.mjs <lucide 目录>'); process.exit(2); }
	const symbols = NAMES.map((n) => {
		const svg = readFileSync(join(dir, 'icons', n + '.svg'), 'utf8');
		const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
		// 白名单：雪碧图是用 set:html 直接写进页面的，只许这几种图形元素和几何属性（黑名单挡不住 <img/src/onerror> 这类写法）
		if (!isSafeIcon(inner)) throw new Error('图标里有白名单以外的内容：' + n);
		return `<symbol id="lu-${n}" viewBox="0 0 24 24">${inner}</symbol>`;
	}).join('');
	const license = readFileSync(join(dir, 'LICENSE'), 'utf8').trim();
	writeFileSync('src/game/ui/lucide-sprite.ts', `// 自动生成：node tools/earth/icons/build-lucide.mjs（体验改造 P2）。不要手改。
	// Lucide 图标 https://lucide.dev（ISC，许可全文见 public/earth/LICENSES.txt 和下面雪碧图里的注释）
	export const LUCIDE_NAMES = ${JSON.stringify(NAMES)} as const;
	export type LucideName = (typeof LUCIDE_NAMES)[number];
	/** 页面在构建时写进 HTML 的雪碧图（隐藏）；线条颜色跟着 currentColor */
	export const LUCIDE_SPRITE = ${JSON.stringify(`<!-- Lucide icons https://lucide.dev ${license.replace(/--/g, '-').replace(/\s+/g, ' ')} --><svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`)};
	`);
	console.log('生成', NAMES.length, '个图标，', symbols.length, '字节');
}
// 被测试 import 时只导出 isSafeIcon、NAMES，不跑生成
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
