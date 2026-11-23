// 体验改造 P2：页面画完后把文字里的 emoji 换成 Fluent Emoji 扁平版的小图（所有手机上长得一样）。
// alt 就是原来的 emoji，读屏照样念「汉堡」「狗」；复制文字时也还是 emoji。
// 不碰：SVG 里的文字（地图、印章）、输入框、按钮以外的表单控件、标了 data-no-emo 的元素；属性（aria-label、title）里的 emoji 保持原样。
import { EMOJI_CODES } from '../data/emoji-set.ts';

/** 和生成脚本同一个写法：一个象形符号，后面可以跟变体选择符、零宽连接的另一个符号、肤色 */
const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?|[\u{1F3FB}-\u{1F3FF}])*/gu;

export type Piece = { t: 'text'; v: string } | { t: 'emo'; glyph: string; code: string };

/** 把一段文字切成「普通文字 / 有图的 emoji」几段（纯函数）；没有图的 emoji 留在文字里 */
export function splitEmoji(text: string, codes: Readonly<Record<string, string>> = EMOJI_CODES): Piece[] {
	const out: Piece[] = [];
	let last = 0;
	for (const m of text.matchAll(EMOJI_RE)) {
		const code = Object.hasOwn(codes, m[0].replace(/️/g, '')) ? codes[m[0].replace(/️/g, '')] : undefined;
		if (!code) continue;
		if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) });
		out.push({ t: 'emo', glyph: m[0], code });
		last = m.index! + m[0].length;
	}
	if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
	return out;
}

/** 图的地址：编码只允许十六进制和连字符（来自生成的表，这里再核一遍，防止拼出别的路径） */
export const emojiSrc = (code: string) => (/^[0-9a-f]+(-[0-9a-f]+)*$/.test(code) ? `/earth/emoji/${code}.svg` : '');

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TITLE', 'CODE', 'PRE']);

/** 在 root 里把文字节点中的 emoji 换成 <img class="emo">。浏览器里才有用；没有 DOM 接口（测试的假页面）时什么都不做 */
export function emojify(root: Node | null | undefined, doc: Document | undefined = typeof document === 'object' ? document : undefined) {
	if (!root || !doc || typeof doc.createTreeWalker !== 'function') return;
	const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
		acceptNode(n) {
			for (let p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) {
				const el = p as Element;
				if (!el.tagName) continue;
				if (SKIP.has(el.tagName) || el.namespaceURI === 'http://www.w3.org/2000/svg' || el.hasAttribute?.('data-no-emo')) return 2; // FILTER_REJECT
			}
			return 1; // FILTER_ACCEPT
		},
	});
	const hits: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if (EMOJI_RE.test((n as Text).data)) { hits.push(n as Text); EMOJI_RE.lastIndex = 0; }
	for (const t of hits) {
		const parts = splitEmoji(t.data);
		if (!parts.some((p) => p.t === 'emo')) continue;
		const frag = doc.createDocumentFragment();
		for (const p of parts) {
			if (p.t === 'text') { frag.appendChild(doc.createTextNode(p.v)); continue; }
			const src = emojiSrc(p.code);
			if (!src) { frag.appendChild(doc.createTextNode(p.glyph)); continue; }
			const img = doc.createElement('img');
			img.className = 'emo';
			img.src = src;
			img.alt = p.glyph;
			img.draggable = false;
			img.decoding = 'async';
			frag.appendChild(img);
		}
		t.parentNode?.replaceChild(frag, t);
	}
}
