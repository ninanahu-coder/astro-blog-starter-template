// 「地球人生」联机服务端 —— Cloudflare Durable Object。
// 一个区域一个实例（idFromName(regionId)）：在线玩家位置、同地点聊天、互动表情。
// 另有保留实例 '@SAVES' 负责云存档（跨设备同步）。
// 权威结算：客户端只发送动作（create / act），由本实例调用规则引擎结算并保存；
// 客户端不能上传存档，改本地数据不会影响服务器上的进度。
import { applyAction, parseAction, publicState } from '../core/actions.ts';
import { claimDaily, realDayOf } from '../core/daily.ts';
import { refreshWishes } from '../core/wishes.ts';
import { cleanName, createCharacter, sanitizeState } from '../core/character.ts';
import { REGIONS } from '../data/wa.ts';

const SAVES_ROOM = '@SAVES';
const MAX_CONNS = 200;
const MSG_WINDOW_MS = 5000;
const MSG_LIMIT = 20;
const IDLE_TIMEOUT_MS = 70000; // 客户端每 20s ping
const CHAT_MAX = 120;
const SAVE_BODY_MAX = 48 * 1024;
const SAVE_WINDOW_MS = 60 * 1000;
const SAVE_LIMIT = 90; // 每 IP 每分钟（每个动作一次请求）
const EMOTES = ['👋', '🤝', '🍻', '📸', '❤️', '😂'];
const ID_RE = /^[a-zA-Z0-9_-]{6,40}$/;
const KEY_RE = /^[a-zA-Z0-9]{16,64}$/;

interface Presence {
	id: string;
	name: string;
	avatar: string;
	loc: string;
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
}

export class EarthWorld {
	private ctx: DurableObjectState;
	private sockets = new Map<WebSocket, Presence>();
	private lastSeen = new Map<WebSocket, number>();
	private msgCount = new Map<WebSocket, { n: number; resetAt: number }>();
	private saveRate = new Map<string, { n: number; resetAt: number }>();
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private locks = new Map<string, Promise<unknown>>(); // 同一存档的请求排队执行，避免并发读改写

	constructor(ctx: DurableObjectState, _env: unknown) {
		this.ctx = ctx;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api/earth/save') return this.handleSave(request);
		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('expected websocket', { status: 426 });
		}
		const region = REGIONS[url.searchParams.get('region') || 'wa'];
		if (!region) return new Response('unknown region', { status: 404 });
		const id = url.searchParams.get('id') || '';
		if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });
		if (this.sockets.size >= MAX_CONNS) return new Response('region full', { status: 503 });
		const locs = new Set(region.locations.map((l) => l.id));
		const loc = url.searchParams.get('loc') || '';
		const me: Presence = {
			// 对外只暴露 id 的哈希前缀：真实 id 是存档凭证的一部分，不能广播
			id: (await sha256Hex(id)).slice(0, 12),
			name: cleanName(url.searchParams.get('name')) || '旅人',
			avatar: (url.searchParams.get('avatar') || '🧑').replace(/[<>&"']/g, '').slice(0, 8),
			loc: locs.has(loc) ? loc : region.spawn,
		};

		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();
		this.sockets.set(server, me);
		this.lastSeen.set(server, Date.now());
		this.send(server, { t: 'hello', you: me.id, players: this.roster(), emotes: EMOTES });
		this.broadcast({ t: 'join', p: me }, server);
		this.ensureSweeper();
		server.addEventListener('message', (e) => {
			try {
				this.onMessage(server, String((e as MessageEvent).data), locs);
			} catch {}
		});
		const drop = () => this.onClose(server);
		server.addEventListener('close', drop);
		server.addEventListener('error', drop);
		return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
	}

	/** 同一玩家多设备在线时只列一次（取最新连接） */
	private roster(): Presence[] {
		const byId = new Map<string, Presence>();
		for (const p of this.sockets.values()) byId.set(p.id, p);
		return [...byId.values()];
	}

	private onMessage(ws: WebSocket, raw: string, locs: Set<string>) {
		const me = this.sockets.get(ws);
		if (!me || raw.length > 1024) return;
		const now = Date.now();
		this.lastSeen.set(ws, now);
		const rate = this.msgCount.get(ws);
		if (!rate || now > rate.resetAt) this.msgCount.set(ws, { n: 1, resetAt: now + MSG_WINDOW_MS });
		else if (++rate.n > MSG_LIMIT) return;
		const m = JSON.parse(raw);
		if (!m || typeof m !== 'object') return;
		switch (m.t) {
			case 'ping':
				this.send(ws, { t: 'pong' });
				break;
			case 'move':
				if (typeof m.loc === 'string' && locs.has(m.loc) && m.loc !== me.loc) {
					me.loc = m.loc;
					this.broadcast({ t: 'move', id: me.id, loc: me.loc });
				}
				break;
			case 'chat': {
				const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, CHAT_MAX);
				if (text) this.broadcastAt(me.loc, { t: 'chat', id: me.id, name: me.name, avatar: me.avatar, text, at: now });
				break;
			}
			case 'emote':
				if (EMOTES.includes(m.kind) && typeof m.to === 'string') {
					// 只能对同一地点的玩家互动
					for (const [sock, p] of this.sockets) {
						if (p.id === m.to && p.loc === me.loc) this.send(sock, { t: 'emote', from: me.id, name: me.name, kind: m.kind });
					}
				}
				break;
		}
	}

	private onClose(ws: WebSocket) {
		const me = this.sockets.get(ws);
		if (!me) return;
		this.sockets.delete(ws);
		this.lastSeen.delete(ws);
		this.msgCount.delete(ws);
		try {
			ws.close();
		} catch {}
		if (![...this.sockets.values()].some((p) => p.id === me.id)) this.broadcast({ t: 'leave', id: me.id });
		if (this.sockets.size === 0 && this.sweeper) {
			clearInterval(this.sweeper);
			this.sweeper = null;
		}
	}

	private ensureSweeper() {
		if (this.sweeper) return;
		this.sweeper = setInterval(() => {
			const now = Date.now();
			for (const [ws, seen] of this.lastSeen) if (now - seen > IDLE_TIMEOUT_MS) this.onClose(ws);
		}, 15000);
	}

	private send(ws: WebSocket, data: unknown) {
		try {
			ws.send(JSON.stringify(data));
		} catch {}
	}
	private broadcast(data: unknown, except?: WebSocket) {
		const raw = JSON.stringify(data);
		for (const ws of this.sockets.keys()) {
			if (ws === except) continue;
			try {
				ws.send(raw);
			} catch {}
		}
	}
	private broadcastAt(loc: string, data: unknown) {
		const raw = JSON.stringify(data);
		for (const [ws, p] of this.sockets) {
			if (p.loc !== loc) continue;
			try {
				ws.send(raw);
			} catch {}
		}
	}

	// ---------- 云存档与权威结算（仅 '@SAVES' 实例；storage 键：save:<id> = { keyHash, state, at }） ----------
	// 同步码 = id + '.' + key。key 只在客户端与请求体里出现，服务端只存哈希。
	// 接口：
	//   create { id, key, profile: { name, avatar, origin, traits } }  新建角色（id 未被占用时）
	//   get    { id, key }                                             读取存档
	//   act    { id, key, rev, act: GameAction }                       执行一个动作；rev 与服务端不一致返回 409
	private async handleSave(request: Request): Promise<Response> {
		if (request.method !== 'POST') return json({ ok: false, msg: '请求无效' }, 405);
		const ip = request.headers.get('CF-Connecting-IP') || 'local';
		const now = Date.now();
		const rate = this.saveRate.get(ip);
		if (!rate || now > rate.resetAt) {
			if (this.saveRate.size > 5000) this.saveRate.clear();
			this.saveRate.set(ip, { n: 1, resetAt: now + SAVE_WINDOW_MS });
		} else if (++rate.n > SAVE_LIMIT) return json({ ok: false, msg: '操作太频繁' }, 429);

		const text = await request.text();
		if (text.length > SAVE_BODY_MAX) return json({ ok: false, msg: '请求过大' }, 413);
		let body: any;
		try {
			body = JSON.parse(text);
		} catch {
			return json({ ok: false, msg: '请求无效' }, 400);
		}
		const { id, key } = body ?? {};
		if (typeof id !== 'string' || !ID_RE.test(id) || typeof key !== 'string' || !KEY_RE.test(key)) {
			return json({ ok: false, msg: '同步码无效' }, 400);
		}
		// 同一存档串行处理：上一个请求结束后才开始下一个
		const prev = this.locks.get(id) ?? Promise.resolve();
		const run = prev.then(() => this.handleSaveLocked(body, id, key, now));
		const tail = run.catch(() => {});
		this.locks.set(id, tail);
		tail.then(() => {
			if (this.locks.get(id) === tail) this.locks.delete(id);
		});
		return run;
	}

	private async handleSaveLocked(body: any, id: string, key: string, now: number): Promise<Response> {
		const keyHash = await sha256Hex(id + ':' + key);
		const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + id);
		if (rec && !timingSafeEqual(rec.keyHash, keyHash)) return json({ ok: false, msg: '同步码无效' }, 403);
		const action = body.action;

		if (action === 'create') {
			if (rec) return json({ ok: false, msg: '这个存档已存在' }, 409);
			const prof = body.profile ?? {};
			const region = REGIONS.wa;
			const state = createCharacter({
				id,
				name: cleanName(prof.name),
				avatar: String(prof.avatar ?? ''),
				origin: String(prof.origin ?? ''),
				traits: Array.isArray(prof.traits) ? prof.traits.filter((t: unknown) => typeof t === 'string').slice(0, 4) : [],
				region: region.id,
				spawn: region.spawn,
				seed: crypto.getRandomValues(new Uint32Array(1))[0],
			});
			refreshWishes(state);
			const first = claimDaily(state, realDayOf(now));
			const created = first ? { ...first.state, rev: 0 } : state;
			await this.ctx.storage.put('save:' + id, { keyHash, state: created, at: now });
			return json({ ok: true, state: publicState(created), at: now, daily: first?.msg });
		}

		if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
		const region = REGIONS[rec.state?.region] ?? REGIONS.wa;
		const current = sanitizeState(rec.state, new Set(region.locations.map((l) => l.id)));
		if (!current) return json({ ok: false, msg: '云端存档已损坏' }, 500);

		// 每日奖励：按现实日期（服务端时钟）每天第一次读取或行动时发放
		const claim = claimDaily(current, realDayOf(now));
		const live = claim ? claim.state : current;
		if (claim && action === 'get') await this.ctx.storage.put('save:' + id, { keyHash, state: live, at: now });

		if (action === 'get') return json({ ok: true, state: publicState(live), at: now, daily: claim?.msg });

		if (action === 'act') {
			// 客户端看到的版本落后（另一台设备刚玩过）：不执行，把最新存档还给它
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: '进度已在另一台设备上更新', state: publicState(current), at: now }, 409);
			const act = parseAction(body.act);
			if (!act) return json({ ok: false, msg: '动作无效' }, 400);
			// 版本号按领奖前的存档比对（上面已检查），动作在领奖后的存档上执行
			const r = applyAction(live, region, act, now);
			if (r.state !== current) await this.ctx.storage.put('save:' + id, { keyHash, state: r.state, at: now });
			return json({ ok: r.ok, msg: r.msg, state: publicState(r.state), at: now, daily: claim?.msg });
		}
		return json({ ok: false, msg: '请求无效' }, 400);
	}
}

/** Worker 入口路由：命中 /api/earth/* 返回 Response，否则返回 null 交给 Astro */
export function routeEarth(request: Request, env: any): Promise<Response> | null {
	const url = new URL(request.url);
	if (url.pathname === '/api/earth/save') {
		return env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(SAVES_ROOM)).fetch(request);
	}
	if (url.pathname === '/api/earth/ws') {
		const region = (url.searchParams.get('region') || 'wa').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'wa';
		return env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(region)).fetch(request);
	}
	return null;
}
