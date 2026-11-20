// 换设备（第 32 轮）：同步码 + 二维码。存档本身一直在服务器上（服务端权威），换设备只是把凭证带过去：
// 二维码里是一个链接 /earth/#sync=<同步码>，另一台手机用相机扫了直接打开本页，页面读出同步码、从云端恢复。
// 同步码放在 # 后面，不会发给服务器、不进服务器日志；页面读完马上从地址栏抹掉。

export interface Cred { id: string; key: string }

const CODE = /^([a-zA-Z0-9_-]{6,40})\.([a-zA-Z0-9]{16,64})$/;

/** 解析同步码：可以是「id.key」本身，也可以是带 #sync= 的整条链接（扫码后复制出来的） */
export function parseSyncCode(raw: unknown): Cred | null {
	if (typeof raw !== 'string') return null;
	const s = raw.trim();
	const fromLink = readSyncHash(s.includes('#') ? s.slice(s.indexOf('#')) : '');
	const m = CODE.exec(fromLink ?? s);
	return m ? { id: m[1], key: m[2] } : null;
}

/** 地址栏 # 后面的同步码（没有或格式不对返回 null） */
export function readSyncHash(hash: unknown): string | null {
	if (typeof hash !== 'string') return null;
	const m = /^#sync=([^&]+)$/.exec(hash.trim());
	if (!m) return null;
	let v: string;
	try { v = decodeURIComponent(m[1]); } catch { return null; }
	return CODE.test(v) ? v : null;
}

export const codeOf = (c: Cred) => `${c.id}.${c.key}`;

/** 本机存的凭证（不可信）：必须是 { id, key } 且格式和同步码一致，不然当没有 */
export function parseCred(raw: unknown): Cred | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const { id, key } = raw as Record<string, unknown>;
	if (typeof id !== 'string' || typeof key !== 'string') return null;
	const m = CODE.exec(`${id}.${key}`);
	return m && m[1] === id && m[2] === key ? { id, key } : null;
}

/** 换码进行中（第 50 批）：新码先记在本机再发请求，回复丢了也能补完。只认和当前角色同一个 id、key 不同的 */
export function parsePendingKey(raw: unknown, current: Cred | null): Cred | null {
	const c = parseCred(raw);
	return c && current && c.id === current.id && c.key !== current.key ? c : null;
}

/** 导出文件名：地球人生存档-年月日.json（按服务器时间） */
export function exportName(at: unknown): string {
	const d = new Date(typeof at === 'number' && Number.isFinite(at) ? at : 0);
	const p = (n: number) => String(n).padStart(2, '0');
	return `earth-save-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.json`;
}

/** 二维码里的链接：本页地址 + #sync=同步码 */
export const syncLink = (origin: string, c: Cred) => `${origin.replace(/\/+$/, '')}/earth/#sync=${encodeURIComponent(codeOf(c))}`;

/** 扫码打开时该怎么办：这台设备还没有角色 → 恢复；已经是这个角色 → 什么也不做；是别的角色 → 先问 */
export function hashAction(current: Cred | null, incoming: Cred): 'restore' | 'same' | 'ask' {
	if (!current) return 'restore';
	return current.id === incoming.id ? 'same' : 'ask';
}

/** 二维码矩阵（true 为深色格），只用到库的这两个方法 */
export interface QrLike { getModuleCount(): number; isDark(r: number, c: number): boolean }

/** 把二维码矩阵画成 SVG：一条 path，四周留 4 格白边（扫码要求），白底黑格，深色模式下也能扫 */
export function qrSvg(qr: QrLike, label: string): string {
	const n = qr.getModuleCount();
	const q = 4;
	let d = '';
	for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
	const size = n + q * 2;
	const esc = label.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
	return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** 生成二维码（库动态加载，点「显示二维码」时才下载）；纠错等级 M */
export async function makeQr(text: string): Promise<QrLike> {
	const { default: qrcode } = await import('qrcode-generator');
	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();
	return qr;
}
