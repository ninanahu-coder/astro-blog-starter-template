// 「地球人生」联机服务端 —— Cloudflare Durable Object。
// 一个区域一个实例（idFromName(regionId)）：在线玩家位置、同地点聊天、互动表情。
// 另有保留实例 '@SAVES' 负责云存档（跨设备同步）。
// 权威结算：客户端只发送动作（create / act），由本实例调用规则引擎结算并保存；
// 客户端不能上传存档，改本地数据不会影响服务器上的进度。
import { applyAction, parseAction, publicState } from '../core/actions.ts';
import { claimDaily, realDayOf } from '../core/daily.ts';
import { refreshWishes } from '../core/wishes.ts';
import { cleanName, createCharacter, sanitizeState } from '../core/character.ts';
import { boardEntry, rankBoard } from '../core/board.ts';
import type { PlayerState } from '../core/types.ts';
import { getRegion, REGIONS } from '../data/wa.ts';

const SAVES_ROOM = '@SAVES';
const MAX_CONNS = 200;
const MSG_WINDOW_MS = 5000;
const MSG_LIMIT = 20;
const IDLE_TIMEOUT_MS = 70000; // 客户端每 20s ping
const CHAT_MAX = 120;
const SAVE_BODY_MAX = 48 * 1024;
const SAVE_WINDOW_MS = 60 * 1000;
const CLOCK_BACK_MAX_MS = 24 * 60 * 60 * 1000; // 时钟回拨最多按这么久处理
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
	private board: [string, unknown][] | null = null; // 榜单记录的内存缓存；所有存档都写在这个实例里，写入时作废

	constructor(ctx: DurableObjectState, _env: unknown) {
		this.ctx = ctx;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api/earth/save') return this.handleSave(request);
		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('expected websocket', { status: 426 });
		}
		const region = getRegion(url.searchParams.get('region') || 'wa');
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
	//   board  { id, key }                                             净资产排行榜（前 20 名和自己的名次），只读
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
		// 结算和存档校验用的时间在轮到这个请求时才取，不用请求到达时的时间：
		// 上传得慢的请求可能排在后到的请求后面执行，拿着旧时间会把后者刚写入的时间戳当成「未来」清掉
		const run = prev.then(() => this.handleSaveLocked(body, id, key, Date.now()));
		const tail = run.catch(() => {});
		this.locks.set(id, tail);
		tail.then(() => {
			if (this.locks.get(id) === tail) this.locks.delete(id);
		});
		return run;
	}

	/** 存档落盘，同时更新这名玩家的榜单记录。榜单用 id 的哈希前缀做键（和在线状态一样），真实 id 是凭证的一部分，不能外露 */
	private async persist(id: string, keyHash: string, state: PlayerState, now: number): Promise<void> {
		const pub = (await sha256Hex(id)).slice(0, 12);
		await this.ctx.storage.put({ ['save:' + id]: { keyHash, state, at: now }, ['rank:' + pub]: boardEntry(state, now) });
		this.board = null;
	}

	private async handleSaveLocked(body: any, id: string, key: string, wall: number): Promise<Response> {
		const keyHash = await sha256Hex(id + ':' + key);
		const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + id);
		if (rec && !timingSafeEqual(rec.keyHash, keyHash)) return json({ ok: false, msg: '同步码无效' }, 403);
		// 同一存档的时间不倒退：服务器时钟回拨时沿用上次落盘的时间，不然跨午夜回拨能把刚领的每日奖励改回前一天再领一次，
		// 回拨超过一分钟还会把合法的定位、冷却、上班卡当成「未来」清掉。落盘时间超前太多（超过一天）当作坏数据，不跟它走
		const last = rec && Number.isFinite(rec.at) ? rec.at : 0;
		const now = last > wall && last - wall <= CLOCK_BACK_MAX_MS ? last : wall;
		const action = body.action;

		if (action === 'board') {
			if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
			if (!this.board) this.board = [...(await this.ctx.storage.list({ prefix: 'rank:' })).entries()];
			const me = 'rank:' + (await sha256Hex(id)).slice(0, 12);
			return json({ ok: true, ...rankBoard(this.board, me), at: now });
		}

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
			await this.persist(id, keyHash, created, now);
			return json({ ok: true, state: publicState(created), at: now, daily: first?.msg });
		}

		if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
		const region = getRegion(rec.state?.region) ?? REGIONS.wa;
		const current = sanitizeState(rec.state, new Set(region.locations.map((l) => l.id)), { fallbackLoc: region.spawn, now });
		if (!current) return json({ ok: false, msg: '云端存档已损坏' }, 500);

		// 每日奖励：按现实日期（服务端时钟）每天第一次读取或行动时发放
		// 落盘和返回之前统一再过一遍存档校验：存下来的永远是规范形式，不依赖每条规则各自守住上限
		const locs = new Set(region.locations.map((l) => l.id));
		const canon = (s: typeof current) => sanitizeState(s, locs, { fallbackLoc: region.spawn, now }) ?? s;
		const claim = claimDaily(current, realDayOf(now));
		const live = claim ? canon(claim.state) : current;
		// 校验时修过存档（挪了地点、清了未来的时间戳等）也要写回：不然只上线不操作的话，每次都重新修一遍，
		// 被改成「今天已领」的每日奖励永远领不到
		const migrated = JSON.stringify(current) !== JSON.stringify(rec.state);
		if ((claim || migrated) && action === 'get') await this.persist(id, keyHash, live, now);

		if (action === 'get') return json({ ok: true, state: publicState(live), at: now, daily: claim?.msg });

		if (action === 'act') {
			// 客户端看到的版本落后（另一台设备刚玩过）：不执行，把最新存档还给它
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: '进度已在另一台设备上更新', state: publicState(current), at: now }, 409);
			const act = parseAction(body.act);
			if (!act) return json({ ok: false, msg: '动作无效' }, 400);
			// 版本号按领奖前的存档比对（上面已检查），动作在领奖后的存档上执行
			const r = applyAction(live, region, act, now);
			const next = r.state !== live ? canon(r.state) : r.state;
			if (next !== current) await this.persist(id, keyHash, next, now);
			// 动作没改动存档（被规则拒绝）但校验时修过存档：把修好的写回，不带这次没落定的每日奖励
			else if (migrated) await this.persist(id, keyHash, current, now);
			return json({ ok: r.ok, msg: r.msg, state: publicState(next), at: now, daily: claim?.msg });
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
