// 「地球人生」联机服务端 —— Cloudflare Durable Object。
// 一个区域一个实例（idFromName(regionId)）：在线玩家位置、同地点聊天、互动表情。
// 另有保留实例 '@SAVES' 负责云存档（跨设备同步）。
// 权威结算：客户端只发送动作（create / act），由本实例调用规则引擎结算并保存；
// 客户端不能上传存档，改本地数据不会影响服务器上的进度。
import { applyAction, applyCoop, parseAction, publicState } from '../core/actions.ts';
import { coopBlocked } from '../core/coop.ts';
import { getCoop } from '../data/coop.ts';
import { claimDaily, realDayOf } from '../core/daily.ts';
import { refreshWishes } from '../core/wishes.ts';
import { cleanName, createCharacter, sanitizeState } from '../core/character.ts';
import { boardEntry, rankBoard } from '../core/board.ts';
import type { PlayerState, Region } from '../core/types.ts';
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
const LOBBY_RE = /^[a-f0-9]{8}$/;
const COOP_OPEN_MS = 5 * 60 * 1000; // 没开始的共同事件大厅 5 分钟后解散
const COOP_DONE_MS = 3 * 60 * 1000; // 结果保留 3 分钟，给没在线的队友拉取
const COOP_MAX_LOBBIES = 200;
const COOP_PER_LOC = 4;
const COOP_HINT_MS = 1000; // 同一连接的「队伍有变化」提醒最多 1 秒转发一次（客户端另外合并成 3 秒一拉），防止刷提醒让别人不停拉列表
const CONFLICT_MSG = '进度刚刚更新过（另一台设备，或队友发起的共同事件），已载入最新进度，请再操作一次';
const KEY_RE = /^[a-zA-Z0-9]{16,64}$/;

/** 共同事件大厅：只在 '@SAVES' 实例的内存里（实例重启就没了，最多影响几分钟内没开始的大厅）。成员 id 是真实存档 id，绝不发给客户端 */
interface Lobby {
	id: string;
	coop: string;
	loc: string;
	host: string;
	at: number;
	members: { id: string; name: string; avatar: string; role: number }[];
	/** 发起人的「开始」已经排队：这时不再接受加入、退出，免得加入的人被悄悄排除在外 */
	starting?: boolean;
	done?: { at: number; success: boolean; text: string; ids: string[] };
}

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
	private boardGen = 0; // 每次写入加一：读榜期间有写入时，读到的旧列表不放进缓存
	private lobbies = new Map<string, Lobby>();
	private coopHintAt = new WeakMap<WebSocket, number>();

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
			case 'coop':
				// 共同事件大厅有变化：只提醒同一地点的其他人去拉一次列表，不带任何内容（内容以服务端为准）
				if (now - (this.coopHintAt.get(ws) ?? 0) < COOP_HINT_MS) break;
				this.coopHintAt.set(ws, now);
				for (const [sock, p] of this.sockets) if (p.loc === me.loc && sock !== ws) this.send(sock, { t: 'coop' });
				break;
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
		// 同一存档串行处理：上一个请求结束后才开始下一个。共同事件开始时要改所有成员的存档，同时排在每个成员的队列后面
		const ids = [id];
		let starting: Lobby | undefined;
		if (body.action === 'coop' && body.op === 'start' && typeof body.lobby === 'string') {
			const l = this.lobbies.get(body.lobby);
			if (l && l.host === id && !l.done && !l.starting) {
				ids.push(...l.members.map((m) => m.id));
				// 从这一刻起成员名单冻结：之后的加入、退出直接拒绝，结算的正好是这里锁住的人
				l.starting = true;
				starting = l;
			}
		}
		// 结算和存档校验用的时间在轮到这个请求时才取，不用请求到达时的时间：
		// 上传得慢的请求可能排在后到的请求后面执行，拿着旧时间会把后者刚写入的时间戳当成「未来」清掉
		const run = this.runLocked(ids, () => this.handleSaveLocked(body, id, key, Date.now(), new Set(ids)));
		if (starting) {
			const lobby = starting;
			const unfreeze = () => { lobby.starting = false; };
			run.then(unfreeze, unfreeze);
		}
		return run;
	}

	private runLocked<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
		const uniq = [...new Set(ids)];
		const prev = Promise.all(uniq.map((i) => this.locks.get(i) ?? Promise.resolve()));
		const run = prev.then(fn);
		const tail = run.then(() => {}, () => {});
		for (const i of uniq) this.locks.set(i, tail);
		tail.then(() => {
			for (const i of uniq) if (this.locks.get(i) === tail) this.locks.delete(i);
		});
		return run;
	}

	/** 存档落盘，同时更新这名玩家的榜单记录。榜单用 id 的哈希前缀做键（和在线状态一样），真实 id 是凭证的一部分，不能外露 */
	private async persist(id: string, keyHash: string, state: PlayerState, now: number): Promise<void> {
		await this.persistMany([{ id, keyHash, state, at: now }]);
	}

	/** 多个存档在同一次 put 里写入（Durable Object 存储对单次多键 put 保证全写或全不写）：共同事件不会出现一部分人拿到奖励 */
	private async persistMany(saves: { id: string; keyHash: string; state: PlayerState; at: number }[]): Promise<void> {
		const entries: Record<string, unknown> = {};
		for (const x of saves) {
			const rankKey = 'rank:' + (await sha256Hex(x.id)).slice(0, 12);
			// 净资产没变时沿用上一条记录的时间，「同分先达到的在前」才成立
			const prev = await this.ctx.storage.get(rankKey);
			entries['save:' + x.id] = { keyHash: x.keyHash, state: x.state, at: x.at };
			entries[rankKey] = boardEntry(x.state, x.at, prev);
		}
		await this.ctx.storage.put(entries);
		this.boardGen++;
		this.board = null;
	}

	/** 某个存档这次用的时间：时钟回拨时沿用它上次落盘的时间（见 handleSaveLocked） */
	private static saveNow(rec: { at: number } | undefined, wall: number): number {
		const last = rec && Number.isFinite(rec.at) ? rec.at : 0;
		return last > wall && last - wall <= CLOCK_BACK_MAX_MS ? last : wall;
	}

	private async handleSaveLocked(body: any, id: string, key: string, wall: number, locked = new Set([id])): Promise<Response> {
		const keyHash = await sha256Hex(id + ':' + key);
		const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + id);
		if (rec && !timingSafeEqual(rec.keyHash, keyHash)) return json({ ok: false, msg: '同步码无效' }, 403);
		// 同一存档的时间不倒退：服务器时钟回拨时沿用上次落盘的时间，不然跨午夜回拨能把刚领的每日奖励改回前一天再领一次，
		// 回拨超过一分钟还会把合法的定位、冷却、上班卡当成「未来」清掉。落盘时间超前太多（超过一天）当作坏数据，不跟它走
		const now = EarthWorld.saveNow(rec, wall);
		const action = body.action;

		if (action === 'board') {
			if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
			// 先算好自己的键；拿到列表后立刻排名，中间不再等待，别的存档写入清掉缓存也不影响这次
			const me = 'rank:' + (await sha256Hex(id)).slice(0, 12);
			let rows = this.board;
			if (!rows) {
				const gen = this.boardGen;
				rows = [...(await this.ctx.storage.list({ prefix: 'rank:' })).entries()];
				if (gen === this.boardGen) this.board = rows;
			}
			return json({ ok: true, ...rankBoard(rows, me), at: now });
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
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), at: now }, 409);
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
		if (action === 'coop') return this.handleCoop(body, id, keyHash, current, live, region, now, wall, locked);
		return json({ ok: false, msg: '请求无效' }, 400);
	}

	// ---------- 共同事件 ----------
	// coop { op: 'list' }                       这个地点的大厅，和我参加过、刚结束的结果
	// coop { op: 'open', coop, role }            发起（要求现在能参加）
	// coop { op: 'join', lobby, role }           加入同一地点的大厅
	// coop { op: 'leave', lobby }                退出；发起人退出就解散
	// coop { op: 'start', lobby, rev }           发起人开始：重新检查每个成员，人够就结算并写所有人的存档
	// 大厅的过期和结果时间用服务器真实时间（wall），不用为防时钟回拨而沿用的存档时间
	private pruneLobbies(now: number) {
		// 正在结算的队伍不清：不然结算写完时大厅已经没了，队友拉不到结果
		for (const [k, l] of this.lobbies) if (!l.starting && (l.done ? now - l.done.at > COOP_DONE_MS : now - l.at > COOP_OPEN_MS)) this.lobbies.delete(k);
	}

	private coopView(id: string, loc: string) {
		// 自己所在的队伍不管在哪都列出来（走开以后还能退出），别的只列这个地点的
		const lobbies = [...this.lobbies.values()].filter((l) => !l.done && (l.loc === loc || l.members.some((m) => m.id === id))).map((l) => ({
			id: l.id,
			coop: l.coop,
			loc: l.loc,
			host: l.host === id,
			mine: l.members.some((m) => m.id === id),
			away: l.loc !== loc,
			starting: !!l.starting,
			members: l.members.map((m) => ({ name: m.name, avatar: m.avatar, role: m.role, me: m.id === id })),
		}));
		const results = [...this.lobbies.values()].filter((l) => l.done?.ids.includes(id)).map((l) => ({ id: l.id, coop: l.coop, success: l.done!.success, text: l.done!.text, at: l.done!.at }));
		return { lobbies, results };
	}

	private async handleCoop(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, region: Region, now: number, wall: number, locked: Set<string>): Promise<Response> {
		this.pruneLobbies(wall);
		const op = body.op;
		const reply = (extra: Record<string, unknown> = {}, status = 200) => json({ ok: true, ...this.coopView(id, current.loc), at: now, ...extra }, status);
		const no = (msg: string, status = 400) => json({ ok: false, msg, ...this.coopView(id, current.loc), at: now }, status);
		const inOpen = () => [...this.lobbies.values()].find((l) => !l.done && l.members.some((m) => m.id === id));
		const role = (def: { roles: unknown[] }) => (Number.isInteger(body.role) && body.role >= 0 && body.role < def.roles.length ? (body.role as number) : -1);

		if (op === 'list') return reply();
		if (op === 'open') {
			const def = typeof body.coop === 'string' ? getCoop(body.coop) : undefined;
			if (!def) return no('没有这件事');
			const r = role(def);
			if (r < 0) return no('分工无效');
			const why = coopBlocked(current, region, def);
			if (why) return no(why);
			if (inOpen()) return no('你已经在一个队伍里了');
			if (this.lobbies.size >= COOP_MAX_LOBBIES || [...this.lobbies.values()].filter((l) => !l.done && l.loc === current.loc).length >= COOP_PER_LOC) return no('这里的队伍太多了，加入一个吧');
			const lid = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
			this.lobbies.set(lid, { id: lid, coop: def.id, loc: current.loc, host: id, at: wall, members: [{ id, name: current.name, avatar: current.avatar, role: r }] });
			return reply({ msg: `已发起「${def.title}」，等人加入` });
		}
		const l = typeof body.lobby === 'string' && LOBBY_RE.test(body.lobby) ? this.lobbies.get(body.lobby) : undefined;
		if (!l || l.done) return no('这个队伍已经解散或结束了', 404);
		const def = getCoop(l.coop)!;
		if (op === 'join') {
			const r = role(def);
			if (r < 0) return no('分工无效');
			if (l.starting) return no('这个队伍已经开始了，加不进去', 409);
			if (l.members.some((m) => m.id === id)) return no('你已经在这个队伍里了');
			if (l.loc !== current.loc) return no('要在同一个地点才能加入');
			if (l.members.length >= def.max) return no('人已经满了');
			const why = coopBlocked(current, region, def);
			if (why) return no(why);
			if (inOpen()) return no('你已经在一个队伍里了');
			l.members.push({ id, name: current.name, avatar: current.avatar, role: r });
			return reply({ msg: `已加入「${def.title}」` });
		}
		if (op === 'leave') {
			if (!l.members.some((m) => m.id === id)) return no('你不在这个队伍里');
			if (l.starting) return no('队伍正在开始，退不出来了', 409);
			if (l.host === id) this.lobbies.delete(l.id);
			else l.members = l.members.filter((m) => m.id !== id);
			return reply({ msg: l.host === id ? '队伍已解散' : '已退出' });
		}
		if (op === 'start') {
			if (l.host !== id) return no('只有发起人能开始');
			// 下面任何一步失败都先解除冻结再生成响应，返回的队伍状态才是解冻后的（不然界面会停在「正在开始…」）
			const unfreeze = () => { l.starting = false; };
			if (body.rev !== current.rev) {
				unfreeze();
				return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), ...this.coopView(id, current.loc), at: now }, 409);
			}
			// 重新读每个成员的存档（已在锁内），还在这里、现在能参加的才算数
			const locs = new Set(region.locations.map((x) => x.id));
			const members: { id: string; keyHash: string; state: PlayerState; name: string; role: number; now: number }[] = [];
			// 只结算排队时已经锁住的成员：之后才加入的人存档没锁，不能动
			for (const m of l.members.filter((x) => locked.has(x.id))) {
				if (m.id === id) {
					members.push({ id, keyHash, state: live, name: m.name, role: m.role, now });
					continue;
				}
				const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + m.id);
				// 每个队友用自己存档的时间校验和落盘，不用发起人的（时钟回拨时两边沿用的时间不一样）
				const mNow = EarthWorld.saveNow(rec, wall);
				const st = rec ? sanitizeState(rec.state, locs, { fallbackLoc: region.spawn, now: mNow }) : null;
				if (rec && st) members.push({ id: m.id, keyHash: rec.keyHash, state: st, name: m.name, role: m.role, now: mNow });
			}
			const ready = members.filter((m) => m.state.loc === l.loc && !coopBlocked(m.state, region, def));
			if (!ready.some((m) => m.id === id)) { unfreeze(); return no(coopBlocked(live, region, def) ?? '你现在不能参加'); }
			if (ready.length < def.min) { unfreeze(); return no(`人不够：至少要 ${def.min} 个人在这里、现在能参加`); }
			const r = applyCoop(def, region, ready.map((m) => ({ state: m.state, role: m.role, name: m.name })));
			const saves = ready.map((m, i) => ({ id: m.id, keyHash: m.keyHash, at: m.now, state: sanitizeState(r.results[i].state, locs, { fallbackLoc: region.spawn, now: m.now }) ?? r.results[i].state }));
			// 所有人一次写入：写失败就谁都没拿到，队伍还在、可以重试；写成功后大厅标记结束，版本号也都变了，重复开始会被拒绝
			await this.persistMany(saves);
			const mine = saves.find((x) => x.id === id)!.state;
			const text = (r.success ? def.ok : def.fail).text;
			l.done = { at: wall, success: r.success, text, ids: ready.map((m) => m.id) };
			return json({ ok: true, msg: `${def.icon} ${def.title}：${text}`, success: r.success, state: publicState(mine), ...this.coopView(id, mine.loc), at: now });
		}
		return no('请求无效');
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
