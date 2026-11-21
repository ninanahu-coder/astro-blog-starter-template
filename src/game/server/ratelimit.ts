// 服务端限流小工具（安全加固 v40）：固定窗口计数 + 来源地址归一。
// 只放在 Durable Object 的内存里：实例重启会清零，这是有意的取舍（限流只是挡刷，不是账务）。

/**
 * 来源地址的限流键：IPv6 按 /64 前缀算（同一台设备或同一家宽带能随手换出无数个 /128 地址，
 * 按完整地址计数等于没有限流）；IPv4 按完整地址算。没有地址时用 'local'（本地开发和测试）。
 */
export function ipKey(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim().toLowerCase();
	if (!s) return 'local';
	if (!s.includes(':')) return s.slice(0, 64);
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s); // IPv4 映射地址按 IPv4 算，不和别人挤进同一个 /64
	if (mapped) return mapped[1];
	// 展开 '::' 后取前 4 段
	const [head, tail = ''] = s.split('::');
	const h = head ? head.split(':') : [];
	const t = s.includes('::') ? (tail ? tail.split(':') : []) : [];
	const full = s.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
	return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/**
 * 固定窗口计数器：hit() 返回这次是否放行。
 * 记录太多时先清掉已过期的；还是太多就丢掉计数最少的一批——
 * 不再像以前那样整张表清空：那样攻击者换着地址刷满 5000 条，就能把所有人的计数（包括他自己的）一起清零。
 */
export class RateLimiter {
	private hits = new Map<string, { n: number; resetAt: number }>();
	private readonly limit: number;
	private readonly windowMs: number;
	private readonly maxKeys: number;
	constructor(limit: number, windowMs: number, maxKeys = 5000) {
		this.limit = limit;
		this.windowMs = windowMs;
		this.maxKeys = maxKeys;
	}

	hit(key: string, now: number): boolean {
		const r = this.hits.get(key);
		if (r && now <= r.resetAt) return ++r.n <= this.limit;
		if (r) this.hits.delete(key);
		if (this.hits.size >= this.maxKeys) this.evict(now);
		this.hits.set(key, { n: 1, resetAt: now + this.windowMs });
		return this.limit >= 1;
	}

	get size(): number {
		return this.hits.size;
	}

	private evict(now: number) {
		for (const [k, r] of this.hits) if (now > r.resetAt) this.hits.delete(k);
		if (this.hits.size < this.maxKeys) return;
		// 还是满的：丢掉计数最少的一成（一次腾出一批，不用每来一个新地址就全表扫一遍）。
		// 计数多的（正在刷、已经被拦的）留着——换一堆地址把表挤满，也挤不掉自己主地址上的计数
		const drop = [...this.hits].sort((a, b) => a[1].n - b[1].n).slice(0, Math.max(1, Math.ceil(this.maxKeys / 10)));
		for (const [k] of drop) this.hits.delete(k);
	}
}

/**
 * 读请求体，超过 max 字节立刻停止并返回 null（不先把整个请求体读进内存再量长度）。
 * Content-Length 声明超限的直接拒绝；没有声明（分块上传）的边读边数。
 */
export async function readBounded(request: Request, max: number): Promise<string | null> {
	const declared = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(declared) && declared > max) return null;
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			try {
				await reader.cancel();
			} catch {}
			return null;
		}
		chunks.push(value);
	}
	const buf = new Uint8Array(size);
	let off = 0;
	for (const c of chunks) {
		buf.set(c, off);
		off += c.byteLength;
	}
	return new TextDecoder().decode(buf);
}
