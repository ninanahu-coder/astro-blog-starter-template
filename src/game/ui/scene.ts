// 场景背景（虚拟人生风格界面）：今天页顶栏和事件弹窗后面画一幅当地的小场景——天空、云、远山或城市、海、地面、树、你自己。
// 天色跟着当地真实的日出日落（sky.ts 的 skyPhase），天气换云和雨；地点类型决定画城市、海滩、港口还是内陆红土。
// 只是背景图：纯装饰（aria-hidden），不参与任何规则；输出确定（同样的输入同样的 SVG），方便测试。
// 画不画海和气温模型用同一个判断（sky.ts 的 isCoastal）：海滩标签或港口、海岛、海边类型才有海，内陆小镇不画海。

import { isCoastal } from '../core/sky.ts';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export interface SceneInput {
	phase: Phase;
	/** 天气 id：sunny / cloudy / hot / rain / storm */
	weather: string;
	/** 地点类型：city / port / island / coast / town / park / outback / mining */
	kind: string;
	tags: string[];
	/** 不画人（事件弹窗的背景） */
	noFigure?: boolean;
}

interface Palette { sky1: string; sky2: string; sky3: string; sun: string; cloud: string; far: string; city: string; sea: string; foam: string; ground: string; path: string; tree: string; trunk: string; shirt: string; skin: string; hair: string }
const PAL: Record<Phase, Palette> = {
	dawn: { sky1: '#e9a99a', sky2: '#f3c6a5', sky3: '#fbe2c0', sun: '#ffb347', cloud: '#f8d9c6', far: '#c7a98f', city: '#8c7c8c', sea: '#6f8fb3', foam: '#c9d8ea', ground: '#b9b07a', path: '#d9c9a0', tree: '#7f9a5c', trunk: '#6b4e3a', shirt: '#1d5fd1', skin: '#e7b98f', hair: '#3a2a20' },
	day: { sky1: '#7fbbe6', sky2: '#a4d0ef', sky3: '#c9e5f5', sun: '#ffd45c', cloud: '#ffffff', far: '#a9c98a', city: '#6f87a0', sea: '#3f8fc4', foam: '#d6ecf8', ground: '#9cc06e', path: '#e6d9b0', tree: '#5f9a4c', trunk: '#7a5a40', shirt: '#1d5fd1', skin: '#e7b98f', hair: '#3a2a20' },
	dusk: { sky1: '#5d4f8f', sky2: '#c06a7e', sky3: '#f0a46b', sun: '#ff8a4c', cloud: '#e59a8e', far: '#7a5a72', city: '#3f3a5a', sea: '#4a5f8f', foam: '#a9a3c9', ground: '#6f6a4f', path: '#a68f7a', tree: '#4f5a3f', trunk: '#3f2f2a', shirt: '#3f7fe0', skin: '#d9a985', hair: '#2a1e18' },
	night: { sky1: '#0b1630', sky2: '#13264a', sky3: '#1e365c', sun: '#e8eef8', cloud: '#24395c', far: '#1c2b3f', city: '#0f1a2a', sea: '#13283a', foam: '#2e4a66', ground: '#1f2d24', path: '#33403a', tree: '#1f3326', trunk: '#1a1410', shirt: '#5d8fe6', skin: '#b98f70', hair: '#140e0a' },
};
/** 内陆（红土）换地面和远山的颜色 */
const RED: Record<Phase, Pick<Palette, 'far' | 'ground' | 'path' | 'tree'>> = {
	dawn: { far: '#c98a68', ground: '#d08a5a', path: '#e3b48a', tree: '#8a9a5c' },
	day: { far: '#c97b52', ground: '#c9703f', path: '#e2a777', tree: '#6f8f4c' },
	dusk: { far: '#8a4f4f', ground: '#8a4a34', path: '#a8705a', tree: '#4f5a3f' },
	night: { far: '#2a1f26', ground: '#2e1f1a', path: '#3f2c24', tree: '#1f2a1f' },
};
const WET = { sky1: '#3f4855', sky2: '#4d5765', sky3: '#5d6775', cloud: '#6b7583', sea: '#36495a', foam: '#8696a6' };

export type SceneKind = 'city' | 'coast' | 'town' | 'outback';
/** 地点类型 → 画哪种场景 */
export function sceneKind(kind: string, tags: string[]): SceneKind {
	if (kind === 'city' || kind === 'port') return 'city';
	if (kind === 'coast' || kind === 'island' || tags.includes('beach')) return kind === 'town' ? 'town' : 'coast';
	if (kind === 'outback' || kind === 'mining' || kind === 'park') return 'outback';
	return 'town';
}

const r = (x: number, y: number, w: number, h: number, fill: string, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"/>`;
const el = (cx: number, cy: number, rx: number, ry: number, fill: string) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const TOWERS: [number, number, number][] = [[28, 22, 70], [52, 18, 96], [72, 26, 128], [100, 20, 84], [122, 24, 110], [148, 16, 62], [166, 20, 78]];
const STARS: [number, number][] = [[30, 20], [80, 44], [130, 16], [190, 52], [226, 24], [260, 70], [350, 110], [18, 96], [160, 88], [372, 22], [300, 14]];
const SUN_AT: Record<Phase, [number, number, number]> = { dawn: [62, 150, 26], day: [325, 52, 28], dusk: [322, 160, 30], night: [318, 50, 17] };

/** 这个地点的场景里有没有海（和气温模型的「海边」一致） */
export const sceneWater = (kind: string, tags: string[]): boolean => isCoastal({ kind, tags });

/** 画一幅 390×220 的场景（viewBox；外面按宽度缩放、底部对齐） */
export function sceneSvg(s: SceneInput): string {
	const wet = s.weather === 'rain' || s.weather === 'storm';
	const kind = sceneKind(s.kind, s.tags);
	const water = sceneWater(s.kind, s.tags);
	const p: Palette = { ...PAL[s.phase], ...(kind === 'outback' ? RED[s.phase] : {}), ...(wet ? WET : {}), ...(s.weather === 'cloudy' && !wet ? { cloud: s.phase === 'night' ? '#2f4466' : '#e4e9ef' } : {}) };
	const night = s.phase === 'night';
	const out: string[] = [];
	out.push(r(0, 0, 390, 220, p.sky3), r(0, 0, 390, 56, p.sky1), r(0, 56, 390, 50, p.sky2));
	if (night && !wet) for (const [x, y] of STARS) out.push(r(x, y, 2.5, 2.5, '#f4f7ff', 1));
	if (!wet) {
		const [x, y, rad] = SUN_AT[s.phase];
		out.push(`<circle cx="${x}" cy="${y}" r="${rad}" fill="${p.sun}"/>`);
		if (s.weather === 'hot' && !night) out.push(`<circle cx="${x}" cy="${y}" r="${rad + 10}" fill="${p.sun}" opacity="0.3"/>`);
	}
	const clouds = wet ? 5 : s.weather === 'cloudy' ? 4 : 2;
	const CL: [number, number, number][] = [[70, 46, 50], [262, 78, 40], [160, 30, 44], [330, 34, 36], [20, 80, 34]];
	for (let i = 0; i < clouds; i++) { const [x, y, w] = CL[i]; out.push(r(x - w, y - 9, w * 2, 18, p.cloud, 9), r(x - w * 0.45, y - 20, w * 0.9, 20, p.cloud, 10)); }
	// 远景
	out.push(el(80, 168, 170, 60, p.far), el(320, 176, 160, 56, p.far));
	if (kind === 'city') {
		for (const [x, w, h] of TOWERS) out.push(r(x, 160 - h * 0.8, w, h * 0.8, p.city, 2));
		if (night) TOWERS.forEach(([x, , h], i) => { for (let k = 0; k < 3; k++) if ((i + k) % 2 === 0) out.push(r(x + 5 + (k % 2) * 7, 160 - h * 0.8 + 8 + k * 14, 3.5, 3.5, '#ffd27a')); });
	} else if (kind === 'town') {
		for (const [x, w, h] of [[40, 34, 26], [86, 28, 22], [126, 36, 30]] as [number, number, number][]) out.push(r(x, 160 - h, w, h, p.city, 2), `<path d="M${x - 3} ${160 - h}L${x + w / 2} ${160 - h - 14}L${x + w + 3} ${160 - h}Z" fill="${p.city}"/>`);
	} else if (kind === 'outback') {
		out.push(r(30, 128, 90, 34, p.far, 14), r(60, 116, 40, 20, p.far, 10));
	}
	// 海（海边的地点）或一直铺到远处的地面
	if (water) out.push(r(0, 160, 390, 26, p.sea), r(26, 168, 50, 2.5, p.foam, 1), r(220, 176, 70, 2.5, p.foam, 1));
	out.push(r(0, water ? 186 : 160, 390, 60, p.ground));
	out.push(`<path d="M-10 214 L400 200 L400 214 L-10 228Z" fill="${p.path}"/>`);
	// 树：海边是棕榈，其他是圆冠树
	if (kind === 'coast') out.push(r(312, 150, 6, 44, p.trunk, 3), el(306, 150, 22, 7, p.tree), el(326, 150, 22, 7, p.tree), el(316, 144, 8, 14, p.tree));
	else out.push(r(312, 160, 8, 36, p.trunk), el(316, 152, 24, 20, p.tree));
	// 你
	if (!s.noFigure) out.push(el(195, 206, 20, 4.5, 'rgba(0,0,0,0.22)'), r(184, 178, 22, 28, p.shirt, 9), `<circle cx="195" cy="168" r="9" fill="${p.skin}"/>`, `<path d="M185 167 a10 10 0 0 1 20 0 Z" fill="${p.hair}"/>`);
	// 雨
	if (wet) for (let i = 0; i < (s.weather === 'storm' ? 34 : 18); i++) out.push(`<rect x="${(i * 53) % 390}" y="${(i * 97) % 200}" width="1.6" height="12" fill="#dfe7f0" opacity="0.8" transform="rotate(14 ${(i * 53) % 390} ${(i * 97) % 200})"/>`);
	if (s.weather === 'storm') out.push(r(0, 0, 390, 220, 'rgba(15,22,34,0.18)'));
	// 寒冷：地上一层白霜、整幅偏冷色（第 30 批）
	if (s.weather === 'cold') out.push(r(0, water ? 186 : 160, 390, 6, 'rgba(238,244,251,0.75)'), r(0, 0, 390, 220, 'rgba(170,200,235,0.14)'));
	return `<svg class="scene-art" viewBox="0 0 390 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${out.join('')}</svg>`;
}

/** 需求环：半径 21 的圆周按百分比描边（stroke-dasharray） */
export function ringDash(v: number, radius = 21): string {
	const c = 2 * Math.PI * radius;
	const pct = Math.max(0, Math.min(100, v)) / 100;
	return `${(c * pct).toFixed(1)} ${c.toFixed(1)}`;
}

/** NPC 立绘（半身像）：脸型、发色、衣服颜色由 NPC id 定，同一个人每次一样 */
export function portraitSvg(id: string): string {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
	const pick = <T>(xs: T[], k: number) => xs[(h >>> (k * 4)) % xs.length];
	const skin = pick(['#f1c9a5', '#e2b48e', '#c99a72', '#a4734f', '#7a5236'], 0);
	const hair = pick(['#2a1e18', '#5a3a24', '#8a6a3a', '#c9a15a', '#9aa0a8', '#b8432f'], 1);
	const shirt = pick(['#2f5d7c', '#7a3f5a', '#3f7a52', '#8a5a1f', '#4f4a8a', '#a2400f'], 2);
	const long = (h >>> 12) % 3 === 0;
	return `<svg class="portrait" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
		<rect width="80" height="80" rx="20" fill="var(--tint-blue)"/>
		<path d="M10 80 C12 62 24 56 40 56 C56 56 68 62 70 80Z" fill="${shirt}"/>
		<rect x="33" y="46" width="14" height="12" fill="${skin}"/>
		${long ? `<rect x="20" y="22" width="40" height="38" rx="14" fill="${hair}"/>` : ''}
		<ellipse cx="40" cy="36" rx="17" ry="19" fill="${skin}"/>
		<path d="M22 32 C22 16 58 16 58 32 C52 26 30 26 22 32Z" fill="${hair}"/>
		<circle cx="33" cy="38" r="2.2" fill="#2a1e18"/><circle cx="47" cy="38" r="2.2" fill="#2a1e18"/>
		<path d="M35 46 Q40 49 45 46" stroke="#6b3a2a" stroke-width="2" fill="none" stroke-linecap="round"/>
	</svg>`;
}
