// AIGC 媒体（第 1 轮试点，见 docs/earth-game/aigc-media.md）：地点 5 秒环境短片、NPC 打招呼语音。
// 清单 public/earth/media/manifest.json 在页面起来后异步拉取，不进首屏；没有的项一律退回静态图 / 纯文字。
// 清单内容当不可信数据：路径只认 /earth/media/ 下的固定格式，文字只当纯文本，拼 HTML 时一律过 esc。

export interface LocClip { src: string; poster?: string }
export interface VoiceLine { src: string; text: string }
export interface MediaManifest { loc: Record<string, LocClip>; voice: Record<string, VoiceLine> }

export const EMPTY_MEDIA: MediaManifest = { loc: {}, voice: {} };
/** 单个文件的体积上限（测试里核对）：短片约 1MB，语音 100KB */
export const CLIP_MAX_BYTES = 1_000_000;
export const VOICE_MAX_BYTES = 100_000;

const KEY = /^[a-z0-9-]{1,40}$/;
const CLIP = /^\/earth\/media\/loc\/[a-z0-9-]+\.(webm|mp4)$/;
const POSTER = /^\/earth\/(cgi|media\/loc)\/[a-z0-9-]+\.(webp|jpg)$/;
const VOICE = /^\/earth\/media\/voice\/[a-z0-9-]+\.mp3$/;

/** 把拉回来的 JSON 过滤成可用的清单；格式不对的项直接丢掉 */
export function parseMedia(raw: unknown): MediaManifest {
	const out: MediaManifest = { loc: {}, voice: {} };
	if (!raw || typeof raw !== 'object') return out;
	const r = raw as { loc?: unknown; voice?: unknown };
	if (r.loc && typeof r.loc === 'object') {
		for (const [k, v] of Object.entries(r.loc as Record<string, unknown>)) {
			const c = v as Partial<LocClip> | null;
			if (!KEY.test(k) || !c || typeof c.src !== 'string' || !CLIP.test(c.src)) continue;
			out.loc[k] = { src: c.src, ...(typeof c.poster === 'string' && POSTER.test(c.poster) ? { poster: c.poster } : {}) };
		}
	}
	if (r.voice && typeof r.voice === 'object') {
		for (const [k, v] of Object.entries(r.voice as Record<string, unknown>)) {
			const l = v as Partial<VoiceLine> | null;
			if (!KEY.test(k) || !l || typeof l.src !== 'string' || !VOICE.test(l.src) || typeof l.text !== 'string' || !l.text.trim()) continue;
			out.voice[k] = { src: l.src, text: l.text.trim().slice(0, 120) };
		}
	}
	return out;
}

type Esc = (s: unknown) => string;

/** 地点主视觉：有短片放静音循环短片（preload=none，进入视口且没开「减少动画」才播），否则静态图，再否则 fallback */
export function heroHtml(esc: Esc, clip: LocClip | undefined, img: string | undefined, fallback: string): string {
	const poster = clip?.poster ?? img;
	if (clip) {
		return `<div class="hero has-media"><video class="loc-clip" src="${esc(clip.src)}"${poster ? ` poster="${esc(poster)}"` : ''} muted loop playsinline preload="none" disablepictureinpicture aria-hidden="true" tabindex="-1"></video><span class="ai-tag">AI 生成示意</span></div>`;
	}
	if (img) return `<div class="hero has-media"><img src="${esc(img)}" alt="" loading="lazy" /><span class="ai-tag">AI 生成示意</span></div>`;
	return `<div class="hero">${fallback}</div>`;
}

/** NPC 打招呼：文字一直显示（静音也能看），有语音时多一个「听招呼」按钮，点了才播，从不自动播放 */
export function greetHtml(esc: Esc, npcId: string, npcName: string, line: VoiceLine | undefined): string {
	if (!line) return '';
	return `<p class="greet"><span>「${esc(line.text)}」</span><button type="button" data-voice="${esc(npcId)}" aria-label="听${esc(npcName)}打招呼（AI 语音示意）">🔊 听</button><small class="muted">AI 语音示意</small></p>`;
}
