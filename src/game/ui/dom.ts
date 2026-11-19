// 局部重绘（第 41 批，性能）：页面每次 render() 都会把顶栏、标签栏、地图、面板、弹窗整块重新拼成 HTML。
// 后台同步、在线人数变化、30 秒倒计时刷新时，拼出来的内容常常和上一次一模一样；这时不碰 DOM，
// 省掉整块拆掉重建（重新排版、图片重新解码、焦点和输入框内容丢失）。
// 只和「上一次写进去的字符串」比，不读 el.innerHTML（浏览器序列化回来的写法会变，比不准）。
// 约定：用 setHtml 写的元素，别处不要再直接改它的 innerHTML，否则下一次内容相同的重绘会被误跳过。

export interface HtmlTarget { innerHTML: string }

const last = new WeakMap<HtmlTarget, string>();

/** 内容变了才写入；返回是否真的写了 */
export function setHtml(el: HtmlTarget, html: string): boolean {
	if (last.get(el) === html) return false;
	last.set(el, html);
	el.innerHTML = html;
	return true;
}
