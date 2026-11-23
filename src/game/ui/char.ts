// 入境卡的证件照：Blender 渲染的人物（tools/earth/blender），文件名是「出身 id-形象下标」。
// 不把 manifest.json 打进首屏：路径按约定算，tests/earth/characters.test.ts 保证每个组合的文件都在。
import { AVATARS, ORIGINS } from '../core/character.ts';

/** 出身和形象对应的证件照地址；出身或形象不认识时返回 null（界面退回显示 emoji） */
export function bustUrl(originId: string, avatar: string): string | null {
	const i = AVATARS.indexOf(avatar);
	if (i < 0 || !ORIGINS.some((o) => o.id === originId)) return null;
	return `/earth/char/${originId}-${i}.webp`;
}

/** 照片栏的内容：emoji 垫底，证件照盖在上面。图片加载失败时 alt 为空、不显示破图标，露出下面的 emoji */
export function photoHtml(originId: string, avatar: string): string {
	const url = bustUrl(originId, avatar);
	const face = `<span class="ac-photo-emoji">${avatar}</span>`;
	return url ? `${face}<img class="ac-photo-img" src="${url}" alt="" width="96" height="120" decoding="async">` : face;
}
