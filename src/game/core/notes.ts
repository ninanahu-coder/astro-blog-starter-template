// 地点留言板的文字规则（纯函数）：服务端发帖前检查，界面用同一套提示。
// 只留一句短话：去掉控制字符和多余空白，不许带网址、联系方式（长串数字、@ 账号），防止拿来打广告或泄露隐私。

export const NOTE_MAX = 60;
export const NOTES_PER_LOC = 20; // 每个地点只留最近 20 条
export const NOTES_PER_DAY = 3; // 每人每个现实日最多留 3 条，同一个地点一天一条
export const NOTES_LOC_DAY = 10; // 每个地点每个现实日最多新增 10 条，防止一批新号把留言板刷掉

/** 清洗留言：合格返回 { text }，否则返回 { error } */
export function cleanNote(raw: unknown): { text: string } | { error: string } {
	const text = String(raw ?? '')
		.replace(/\s+/g, ' ') // 换行、制表符先变成空格
		.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
		.replace(/ {2,}/g, ' ')
		.trim();
	if (!text) return { error: '写点什么再留言。' };
	if ([...text].length > NOTE_MAX) return { error: `最多 ${NOTE_MAX} 个字。` };
	// 检测用的副本：全角转半角（NFKC）、小写；合法的日期、钟点、金额先拿掉（不然「2026-11-17」「09:00-17:00」「$1,234.56」去掉分隔符后像电话），
	// 再去掉空白和常见分隔符，防止「h t t p」「0412.345.678」这类绕过
	const plain = text.normalize('NFKC').toLowerCase();
	const squeezed = plain
		.replace(/(19|20)\d{2}\s*[-/.年]\s*(0?[1-9]|1[0-2])\s*[-/.月]\s*(0?[1-9]|[12]\d|3[01])(?!\d)日?/g, ' ')
		.replace(/(?<!\d)([01]?\d|2[0-3])\s*[:：]\s*[0-5]\d(?!\d)/g, ' ')
		.replace(/[$¥]\s*[1-9]\d{0,2}(,\d{3})?(\.\d{1,2})?(?![\d,])/g, ' ')
		.replace(/[\s.\-_·•,，。、:：/\\|()（）\[\]【】]+/g, '');
	if (/https?|www|\.(com|net|org|au|cn|io|me|xyz|top|link)\b/.test(plain) || /[a-z]{3,}(com|net|org|cn|xyz)$/.test(squeezed) || /https?|www/.test(squeezed)) return { error: '留言里不能带网址。' };
	// 联系方式：长串数字、@ 账号、平台名后面跟着像账号的一串字母数字（「微信真的很好用」「QQ音乐」这种普通说法不拦）
	if (/\p{Nd}{6,}/u.test(squeezed) || /@[\p{L}\p{N}]/u.test(plain) || /(?<![a-z])(微信|vx|wx|qq|whatsapp|telegram|电报|tg|ig|instagram|line)\s*(号|id)?\s*[:：]?\s*[a-z0-9_-]{5,}/u.test(plain)) return { error: '留言里不能带电话、账号这类联系方式。' };
	return { text };
}
