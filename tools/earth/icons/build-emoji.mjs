// 体验改造 P2：把游戏里用到的 emoji 换成 Microsoft Fluent Emoji 的扁平版（MIT），所有手机上长得一样。
// 用法：git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/fluentui-emoji.git <dir>
//       （sparse-checkout 只要 /LICENSE、/assets/*/metadata.json、/assets/*/Flat/*、/assets/*/Default/Flat/*）
//       node tools/earth/icons/build-emoji.mjs <dir>
// 做的事：扫描 src/game 和 earth.astro 里出现的 emoji → 找到 Fluent 扁平版 SVG → 检查（不许有脚本、事件属性、外链）→
//        拷到 public/earth/emoji/<编码>.svg，生成 src/game/data/emoji-set.ts（字形 → 编码）。找不到图的 emoji 照旧用系统字。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src || !existsSync(join(src, 'assets'))) { console.error('用法：node tools/earth/icons/build-emoji.mjs <fluentui-emoji 目录>'); process.exit(2); }
const OUT = 'public/earth/emoji';
const strip = (g) => g.replace(/️/g, '');
const meta = new Map();
for (const d of readdirSync(join(src, 'assets'))) {
	const mp = join(src, 'assets', d, 'metadata.json');
	if (!existsSync(mp)) continue;
	const m = JSON.parse(readFileSync(mp, 'utf8'));
	const dirs = [join(src, 'assets', d, 'Flat'), join(src, 'assets', d, 'Default', 'Flat')].filter(existsSync);
	const svg = dirs.length ? readdirSync(dirs[0]).find((f) => f.endsWith('.svg')) : undefined;
	const code = String(m.unicode).trim().toLowerCase().replace(/\s+/g, '-');
	if (svg && /^[0-9a-f]+(-[0-9a-f]+)*$/.test(code)) meta.set(strip(m.glyph), { code, file: join(dirs[0], svg) });
}
export const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?|[\u{1F3FB}-\u{1F3FF}])*/gu;
const files = ['src/game/data', 'src/game/core', 'src/game/ui'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts') && f !== 'emoji-set.ts').map((f) => join(d, f))).concat(['src/pages/earth.astro']);
const used = new Set();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(EMOJI_RE)) used.add(strip(m[0]));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const map = {};
const missing = [];
let bytes = 0;
for (const g of [...used].sort()) {
	const hit = meta.get(g);
	if (!hit) { missing.push(g); continue; }
	const svg = readFileSync(hit.file, 'utf8');
	// 只当数据用：拒绝脚本、事件属性、外链和外部样式（图是用 <img> 放的，本来也不会执行，这里再挡一层）
	if (/<script|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?!#)|@import|<foreignObject/i.test(svg)) throw new Error(`可疑 SVG：${g} ${hit.file}`);
	copyFileSync(hit.file, join(OUT, hit.code + '.svg'));
	bytes += svg.length;
	map[g] = hit.code;
}
copyFileSync(join(src, 'LICENSE'), join(OUT, 'LICENSE.txt'));
writeFileSync('src/game/data/emoji-set.ts', `// 自动生成：node tools/earth/icons/build-emoji.mjs（体验改造 P2）。不要手改。
// 游戏里用到的 emoji 字形（去掉 U+FE0F）→ Fluent Emoji 扁平版的文件编码，图在 public/earth/emoji/<编码>.svg（MIT，许可见同目录 LICENSE.txt）。
export const EMOJI_CODES: Readonly<Record<string, string>> = ${JSON.stringify(map)};
`);
console.log(`用到 ${used.size} 个，拷了 ${Object.keys(map).length} 个（${Math.round(bytes / 1024)} KB），没有图 ${missing.length} 个：${missing.join(' ')}`);
