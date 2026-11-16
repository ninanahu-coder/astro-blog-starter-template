// 地点留言板的文字规则（纯函数）：服务端发帖前检查，界面用同一套提示。
// 只留一句短话：去掉控制字符和多余空白，不许带网址、联系方式（长串数字、@ 账号），防止拿来打广告或泄露隐私。

export const NOTE_MAX = 60;
export const NOTES_PER_LOC = 20; // 每个地点只留最近 20 条
export const NOTES_PER_DAY = 3; // 每人每个现实日最多留 3 条，同一个地点一天一条

/** 清洗留言：合格返回 { text }，否则返回 { error } */
export function cleanNote(raw: unknown): { text: string } | { error: string } {
	const text = String(raw ?? '')
		.replace(/\s+/g, ' ') // 换行、制表符先变成空格
		.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
		.replace(/ {2,}/g, ' ')
		.trim();
	if (!text) return { error: '写点什么再留言。' };
	if ([...text].length > NOTE_MAX) return { error: `最多 ${NOTE_MAX} 个字。` };
	if (/https?:|www\.|\.(com|net|org|au|cn|io|me|xyz)\b/i.test(text)) return { error: '留言里不能带网址。' };
	if (/\d[\d\s-]{5,}\d/.test(text) || /[@＠]\w/.test(text)) return { error: '留言里不能带电话、账号这类联系方式。' };
	return { text };
}
