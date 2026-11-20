// 「地球人生」联机服务端 —— Cloudflare Durable Object。
// 一个区域一个实例（idFromName(regionId)）：在线玩家位置、同地点聊天、互动表情。
// 另有保留实例 '@SAVES' 负责云存档（跨设备同步）。
// 权威结算：客户端只发送动作（create / act），由本实例调用规则引擎结算并保存；
// 客户端不能上传存档，改本地数据不会影响服务器上的进度。
import { applyAction, applyBlock, applyCoop, applyTrade, applyWeeklyClaim, parseAction, publicState } from '../core/actions.ts';
import { addReport, BLOCK_MAX, isBlocked, isReportReason, REPORTS_PER_DAY, reportHidden, type ReportRec } from '../core/safety.ts';
import { addWeekly, goalOfWeek, weekDaysLeft, weeklyMine, weekOf, type WeeklyMetric } from '../core/weekly.ts';
import { giveBlocked, saleRange } from '../core/trade.ts';
import { noteMet } from '../core/social.ts';
import { cleanNote, contactError, NOTES_LOC_DAY, NOTES_PER_DAY, NOTES_PER_LOC } from '../core/notes.ts';
import { EXPERIENCES } from '../data/experiences.ts';
import { getItem } from '../core/attributes.ts';
import { coopBlocked } from '../core/coop.ts';
import { getCoop } from '../data/coop.ts';
import { claimDaily, realDayOf } from '../core/daily.ts';
import { noteReturn } from '../core/onboard.ts';
import { refreshWishes } from '../core/wishes.ts';
import { cleanName, createCharacter, sanitizeState } from '../core/character.ts';
import { carryUnknown, SAVE_VERSION } from '../core/save.ts';
import { boardEntry, rankBoard } from '../core/board.ts';
import type { PlayerState, Region } from '../core/types.ts';
import { FULL_AREAS, WORLD } from '../data/wa.ts';
import { areaOf } from '../data/areas-base.ts';
import { ipKey, RateLimiter, readBounded } from './ratelimit.ts';

const SAVES_ROOM = '@SAVES';
const MAX_CONNS = 200;
// 安全加固（v40，见 docs/earth-game/security-review.md）
const CONNS_PER_IP = 6; // 同一来源在一个区域频道里最多同时连几个：不然一个人开 200 个连接就能把整个区域占满
const CHAT_WINDOW_MS = 10_000;
const CHAT_PER_IP = 6; // 同一来源 10 秒内最多发 6 句（多开几个连接也算在一起）；原来只有每个连接 5 秒 20 条的总消息限流，聊天能刷到每秒 4 句
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_PER_IP = 20; // 同一来源每小时最多新建 20 个角色：挡批量注册刷每日奖励、送礼养大号、灌榜和撑大存储；手机运营商共用出口地址，不能卡太死
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
/** 动作编号（客户端发出前生成，断网重交时沿用同一个）：服务器记住每个存档最近处理过的几个，重复到达的不再执行 */
const OP_RE = /^[a-z0-9]{8,32}$/;
const OPS_KEEP = 16;
interface OpDone { op: string; ok: boolean; msg: string }
const CONFLICT_MSG = '进度刚刚更新过（另一台设备，或别的玩家和你一起做的事、和你的交易），已载入最新进度，请再操作一次';
const OFFER_RE = /^[a-f0-9]{10}$/;
const NOTE_RE = /^[a-f0-9]{8}$/;
const HASH_RE = /^[a-f0-9]{12}$/;
const OFFER_TTL_MS = 30 * 60 * 1000; // 送礼、二手摊的挂单 30 分钟没人接就撤下
const OFFER_MAX = 500;
const OFFER_PER_PLAYER = 3; // 每人同时挂着的送礼 + 二手摊最多 3 件
const OFFER_PER_TARGET = 3; // 每人同时最多收到 3 份待收的礼物
const OFFER_PER_LOC = 30; // 每个地点同时最多 30 张挂单
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

/**
 * 送礼和二手摊的挂单：只在 '@SAVES' 实例的内存里，物品在成交前一直留在卖方背包里（实例重启只会丢挂单，不会丢东西）。
 * from 是真实存档 id，绝不发给客户端；送礼的收件人用在线状态里同样的 id 哈希前缀（to）指定。
 */
interface Offer {
	id: string;
	kind: 'gift' | 'sale';
	from: string;
	/** 挂单人的 id 哈希前缀：屏蔽了他的人看不到这张单 */
	fromHash: string;
	fromName: string;
	fromAvatar: string;
	to: string | null;
	/** 送礼的收件人真实存档 id（服务端按哈希查到并核对过存档在同一地点），只在服务端用 */
	toId: string | null;
	toName: string;
	item: string;
	price: number;
	loc: string;
	at: number;
	/** 有人接单的请求已经排队：这时不能撤回、拒绝或再被别人接 */
	taking?: boolean;
}

/** 地点留言：落盘在 'notes:<地点>'；author 是 id 哈希前缀，不发给客户端（只告诉是不是自己的） */
interface Note {
	id: string;
	author: string;
	name: string;
	avatar: string;
	text: string;
	at: number;
	day: number;
}

interface Presence {
	id: string;
	name: string;
	avatar: string;
	loc: string;
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		// 响应里有存档：不进任何缓存；不让浏览器按内容猜类型
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});

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
	private saveRate = new RateLimiter(SAVE_LIMIT, SAVE_WINDOW_MS);
	private createRate = new RateLimiter(CREATE_PER_IP, CREATE_WINDOW_MS);
	private chatRate = new RateLimiter(CHAT_PER_IP, CHAT_WINDOW_MS);
	private sockIp = new Map<WebSocket, string>(); // 连接 -> 来源限流键（只在内存，不广播、不落盘）
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private locks = new Map<string, Promise<unknown>>(); // 同一存档的请求排队执行，避免并发读改写
	private board: [string, unknown][] | null = null; // 榜单记录的内存缓存；所有存档都写在这个实例里，写入时作废
	private boardGen = 0; // 每次写入加一：读榜期间有写入时，读到的旧列表不放进缓存
	private lobbies = new Map<string, Lobby>();
	private hintAt = new WeakMap<WebSocket, Record<string, number>>();
	/** 每个连接屏蔽了谁（id 哈希前缀，客户端按自己存档里的屏蔽名单发来）：这些人的聊天和表情不转给这个连接 */
	private mutes = new WeakMap<WebSocket, Set<string>>();
	private offers = new Map<string, Offer>();
	private week: { week: number; count: number } | null = null; // 这周全服累计数（内存里一份，落盘在 'week:<序号>'）
	private weekLoading: Promise<void> | null = null;
	private weekChain: Promise<unknown> = Promise.resolve(); // 记入全服周计数的写入排队提交：每次都从已落盘的数往上加
	private notes = new Map<string, Note[]>(); // 地点 -> 留言（内存一份，先改内存再落盘，不会丢别人同时写的）
	private notesLoading = new Map<string, Promise<void>>();
	private notesChain = new Map<string, Promise<unknown>>(); // 同一地点的发帖、删帖排队执行：限额检查和写入之间不会插进别人的

	constructor(ctx: DurableObjectState, _env: unknown) {
		this.ctx = ctx;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api/earth/save') return this.handleSave(request);
		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('expected websocket', { status: 426 });
		}
		// 在线频道按区域分（每个区域一个实例，见 routeEarth）：只认注册过的区域 id，不认 world
		const regionId = url.searchParams.get('region') || 'wa';
		const region = FULL_AREAS.find((a) => a.id === regionId);
		if (!region) return new Response('unknown region', { status: 404 });
		const id = url.searchParams.get('id') || '';
		if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });
		if (this.sockets.size >= MAX_CONNS) return new Response('region full', { status: 503 });
		const ip = ipKey(request.headers.get('CF-Connecting-IP'));
		if (this.connsFrom(ip) >= CONNS_PER_IP) return new Response('too many connections', { status: 429 });
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
		this.sockIp.set(server, ip);
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

	private connsFrom(ip: string): number {
		let n = 0;
		for (const v of this.sockIp.values()) if (v === ip) n++;
		return n;
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
		// 聊天另有按来源的限流：超出的句子直接丢掉（不回错误，免得刷屏的人拿它当节拍器）
		if (m.t === 'chat' && !this.chatRate.hit(this.sockIp.get(ws) ?? 'ws:' + me.id, now)) return;
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
				if (!text) break;
				// 在线频道不能发网址、联系方式和坐标（第 24 批）：不转发，只告诉发的人
				const why = contactError(text);
				if (why) {
					this.send(ws, { t: 'notice', msg: '没发出去：聊天里' + why });
					break;
				}
				this.broadcastAt(me.loc, { t: 'chat', id: me.id, name: me.name, avatar: me.avatar, text, at: now }, me.id);
				break;
			}
			case 'mute':
				// 屏蔽名单（第 24 批）：整份替换，只收合法的哈希，最多 BLOCK_MAX 个
				if (Array.isArray(m.ids)) this.mutes.set(ws, new Set(m.ids.filter((x: unknown): x is string => typeof x === 'string' && HASH_RE.test(x)).slice(0, BLOCK_MAX)));
				break;
			case 'coop':
			case 'trade': {
				// 共同事件大厅或交易挂单有变化：只提醒同一地点的其他人去拉一次列表，不带任何内容（内容以服务端为准）
				const last = this.hintAt.get(ws) ?? {};
				if (now - (last[m.t] ?? 0) < COOP_HINT_MS) break;
				this.hintAt.set(ws, { ...last, [m.t]: now });
				for (const [sock, p] of this.sockets) if (p.loc === me.loc && sock !== ws) this.send(sock, { t: m.t });
				break;
			}
			case 'emote':
				if (EMOTES.includes(m.kind) && typeof m.to === 'string') {
					// 只能对同一地点的玩家互动
					for (const [sock, p] of this.sockets) {
						if (p.id === m.to && p.loc === me.loc && !this.mutes.get(sock)?.has(me.id)) this.send(sock, { t: 'emote', from: me.id, name: me.name, kind: m.kind });
					}
				}
				break;
		}
	}

	private onClose(ws: WebSocket) {
		const me = this.sockets.get(ws);
		if (!me) return;
		this.sockets.delete(ws);
		this.sockIp.delete(ws);
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
	/** from：发消息的人的 id 哈希前缀；屏蔽了他的连接收不到 */
	private broadcastAt(loc: string, data: unknown, from?: string) {
		const raw = JSON.stringify(data);
		for (const [ws, p] of this.sockets) {
			if (p.loc !== loc) continue;
			if (from && this.mutes.get(ws)?.has(from)) continue;
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
	//   act    { id, key, rev, act: GameAction, op? }                  执行一个动作；rev 与服务端不一致返回 409
	//          op：动作编号。这个编号的动作已经结算过（响应在路上丢了、客户端重交）时不再执行，返回当时的结果和最新存档（dup: true）
	//   board  { id, key }                                             净资产排行榜（前 20 名和自己的名次），只读
	//   rekey  { id, key, newKey }                                     更换同步码：旧 key 立即失效。重交（旧 key 已失效、newKey 已生效）当作成功
	//   export { id, key }                                             导出这名玩家在服务器上的全部数据（存档、留言、榜单记录），不含 key 和种子
	//   delete { id, key, confirm: 'delete' }                          删除账号：存档、动作编号、榜单、留言、挂单、队伍全部删掉
	// 存档的格式版本、迁移和「别的分支加的字段」怎么保留，见 core/save.ts 和 docs/earth-game/save-sync.md
	private async handleSave(request: Request): Promise<Response> {
		if (request.method !== 'POST') return json({ ok: false, msg: '请求无效' }, 405);
		const ip = ipKey(request.headers.get('CF-Connecting-IP'));
		const now = Date.now();
		if (!this.saveRate.hit(ip, now)) return json({ ok: false, msg: '操作太频繁' }, 429);

		// 边读边数：超过上限立刻停，不先把几十 MB 的请求体整个读进内存
		const text = await readBounded(request, SAVE_BODY_MAX);
		if (text === null) return json({ ok: false, msg: '请求过大' }, 413);
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
		// 新建角色另有按来源的限流（在格式检查之后：格式不对的请求不占名额）
		if (body.action === 'create' && !this.createRate.hit(ip, now)) return json({ ok: false, msg: '这个网络新建角色太频繁了，过一会儿再试' }, 429);
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
		// 接单（收下礼物、买下）要改双方的存档：同时锁住挂单人的存档，并冻结这张挂单
		let taking: Offer | undefined;
		if (body.action === 'trade' && body.op === 'accept' && typeof body.offer === 'string') {
			const o = this.offers.get(body.offer);
			if (o && !o.taking && o.from !== id) {
				ids.push(o.from);
				o.taking = true;
				taking = o;
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
		if (taking) {
			const offer = taking;
			const unfreeze = () => { offer.taking = false; };
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

	/** 这周的全服累计数（第一次用时从存储读） */
	private async weekCount(week: number): Promise<number> {
		while (!this.week || this.week.week !== week) {
			if (!this.weekLoading) {
				this.weekLoading = (async () => {
					const n = await this.ctx.storage.get<number>('week:' + week);
					if (!this.week || this.week.week !== week) this.week = { week, count: Number.isFinite(n) ? Math.max(0, Math.floor(n as number)) : 0 };
				})().finally(() => { this.weekLoading = null; });
			}
			await this.weekLoading;
		}
		return this.week.count;
	}

	/**
	 * 带全服周计数的写入：排队一个个提交，每次从已落盘的计数加 k，和存档放在同一次 put 里；
	 * 写成功后才更新内存里的计数（领奖只看已落盘的数）。写失败时计数和存档都没变，后面排队的照常提交。
	 */
	private commitWeek(week: number, k: number, entries: Record<string, unknown>): Promise<void> {
		const run = this.weekChain.then(async () => {
			const base = await this.weekCount(week);
			const next = base + k;
			await this.ctx.storage.put({ ...entries, ['week:' + week]: next });
			if (this.week && this.week.week === week) this.week.count = next;
		});
		this.weekChain = run.catch(() => undefined);
		return run;
	}

	/** 同一地点的留言改动排队执行 */
	private inNotes<T>(loc: string, fn: () => Promise<T>): Promise<T> {
		const run = (this.notesChain.get(loc) ?? Promise.resolve()).then(fn);
		const tail = run.catch(() => undefined);
		this.notesChain.set(loc, tail);
		void tail.then(() => { if (this.notesChain.get(loc) === tail) this.notesChain.delete(loc); });
		return run;
	}

	private async notesAt(loc: string): Promise<Note[]> {
		while (!this.notes.has(loc)) {
			let p = this.notesLoading.get(loc);
			if (!p) {
				p = (async () => {
					const raw = await this.ctx.storage.get<Note[]>('notes:' + loc);
					if (!this.notes.has(loc)) this.notes.set(loc, Array.isArray(raw) ? raw.slice(-NOTES_PER_LOC) : []);
				})().finally(() => this.notesLoading.delete(loc));
				this.notesLoading.set(loc, p);
			}
			await p;
		}
		return this.notes.get(loc)!;
	}

	/** 存档落盘，同时更新这名玩家的榜单记录。榜单用 id 的哈希前缀做键（和在线状态一样），真实 id 是凭证的一部分，不能外露 */
	private async persist(id: string, keyHash: string, state: PlayerState, now: number, raw?: unknown): Promise<void> {
		await this.persistMany([{ id, keyHash, state, at: now, raw }]);
	}

	/**
	 * 多个存档在同一次 put 里写入（Durable Object 存储对单次多键 put 保证全写或全不写）：共同事件不会出现一部分人拿到奖励。
	 * week：这次要给全服周计数加几，和存档一起写（见 commitWeek）
	 */
	private async persistMany(saves: { id: string; keyHash: string; state: PlayerState; at: number; raw?: unknown }[], week?: { week: number; k: number }, extra: Record<string, unknown> = {}): Promise<void> {
		const entries: Record<string, unknown> = { ...extra };
		for (const x of saves) {
			const h = (await sha256Hex(x.id)).slice(0, 12);
			const rankKey = 'rank:' + h;
			// 净资产没变时沿用上一条记录的时间，「同分先达到的在前」才成立
			const prev = await this.ctx.storage.get(rankKey);
			// raw：落盘前的原存档。这版代码不认识的字段（别的分支加的）原样带上，不在来回部署时丢掉（见 core/save.ts）
			entries['save:' + x.id] = { keyHash: x.keyHash, state: x.raw === undefined ? x.state : carryUnknown(x.raw, x.state), at: x.at };
			// 在线状态里的 id 哈希 -> 真实 id：送礼时按哈希找到收件人。只存在服务端存储里，从不发给客户端
			entries['h:' + h] = x.id;
			entries[rankKey] = boardEntry(x.state, x.at, prev);
		}
		if (week && week.k > 0) await this.commitWeek(week.week, week.k, entries);
		else await this.ctx.storage.put(entries);
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
		if (rec && !timingSafeEqual(rec.keyHash, keyHash)) {
			// 换码的回复在路上丢了：客户端拿旧码重交，而存档已经认新码了。新码对得上就当成功，不然这台设备就被锁在外面
			if (body.action === 'rekey' && typeof body.newKey === 'string' && KEY_RE.test(body.newKey) && timingSafeEqual(rec.keyHash, await sha256Hex(id + ':' + body.newKey))) {
				const st = sanitizeState(rec.state, new Set(WORLD.locations.map((l) => l.id)), { fallbackLoc: WORLD.spawn, now: wall });
				return json({ ok: true, dup: true, msg: '同步码已更换', state: st && st.id === id ? publicState(st) : undefined, at: wall });
			}
			return json({ ok: false, badKey: true, msg: '同步码无效（可能已在另一台设备更换）' }, 403);
		}
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
			const region = WORLD;
			const state = createCharacter({
				id,
				name: cleanName(prof.name),
				avatar: String(prof.avatar ?? ''),
				origin: String(prof.origin ?? ''),
				traits: Array.isArray(prof.traits) ? prof.traits.filter((t: unknown) => typeof t === 'string').slice(0, 4) : [],
				region: areaOf(region.spawn)?.id ?? FULL_AREAS[0].id,
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
		// 规则用整个世界（所有区域合在一起，第 41 轮）：跨区域出行、找最近的医院、成就都不分区域
		const region = WORLD;
		const sane = sanitizeState(rec.state, new Set(region.locations.map((l) => l.id)), { fallbackLoc: region.spawn, now });
		// 存档里写的 id 必须就是这个存档的 id：不然动作会记在别人的名下（榜单哈希、送礼收件人都按 id 算）
		const current = sane && sane.id === id ? sane : null;
		// 损坏的存档原样留着不覆盖（能人工救回），也不让客户端新建同 id 的角色盖掉它
		if (!current) return json({ ok: false, corrupt: true, msg: '云端存档已损坏' }, 500);
		const raw = rec.state;

		// 每日奖励：按现实日期（服务端时钟）每天第一次读取或行动时发放
		// 落盘和返回之前统一再过一遍存档校验：存下来的永远是规范形式，不依赖每条规则各自守住上限
		const locs = new Set(region.locations.map((l) => l.id));
		const canon = (s: typeof current) => sanitizeState(s, locs, { fallbackLoc: region.spawn, now }) ?? s;
		// 回流（v36）：离开几天后第一次回来，在发每日奖励之前记下离开了多久（领奖会把 daily.day 改成今天）
		const claim = claimDaily(noteReturn(current, realDayOf(now)), realDayOf(now));
		const live = claim ? canon(claim.state) : current;
		// 校验时修过存档（挪了地点、清了未来的时间戳等）也要写回：不然只上线不操作的话，每次都重新修一遍，
		// 被改成「今天已领」的每日奖励永远领不到
		// 比较的是带上未知字段后的落盘形式：别的分支加的字段不算「修过」，不会每次读取都写一遍
		const migrated = JSON.stringify(carryUnknown(raw, current)) !== JSON.stringify(rec.state);
		if ((claim || migrated) && action === 'get') await this.persist(id, keyHash, live, now, raw);

		if (action === 'get') return json({ ok: true, state: publicState(live), at: now, daily: claim?.msg });

		if (action === 'act') {
			// 客户端看到的版本落后（另一台设备刚玩过）：不执行，把最新存档还给它
			// 先认动作编号：重交的动作带着新版本号来（客户端先同步过），不先查就会再执行一遍
			const op = typeof body.op === 'string' && OP_RE.test(body.op) ? body.op : null;
			const opsRaw = op ? await this.ctx.storage.get<unknown>('ops:' + id) : undefined;
			const ops: OpDone[] = Array.isArray(opsRaw) ? opsRaw.filter((o): o is OpDone => !!o && typeof o === 'object' && typeof o.op === 'string' && typeof o.ok === 'boolean' && typeof o.msg === 'string').slice(-OPS_KEEP) : [];
			const seen = op ? ops.find((o) => o.op === op) : undefined;
			// 不带这次没落定的每日奖励：返回已落盘的存档
			if (seen) return json({ ok: seen.ok, msg: seen.msg, dup: true, state: publicState(current), at: now });
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), at: now }, 409);
			const act = parseAction(body.act);
			if (!act) return json({ ok: false, msg: '动作无效' }, 400);
			// 版本号按领奖前的存档比对（上面已检查），动作在领奖后的存档上执行
			const r = applyAction(live, region, act, now);
			// 全服周目标：出行抵达新地点、完成收费体验各算一次（只算这周目标对应的那类）
			// 周和现实日都按这个存档单调不倒退的时间算（防时钟回拨把旧周重开）
			const week = weekOf(realDayOf(now));
			const paid = act.t === 'experience' && (EXPERIENCES.find((e) => e.id === act.id)?.price ?? 0) > 0; // 免费的节日体验不算「收费体验」
			const metric: WeeklyMetric | null = !r.ok || r.collapsed ? null : act.t === 'travel' && r.state.loc !== live.loc ? 'travel' : paid ? 'experience' : null;
			const after = metric !== null && goalOfWeek(week).metric === metric ? addWeekly(r.state, week) : r.state;
			const counted = after !== r.state;
			const next = after !== live ? canon(after) : after;
			// 结算结果和存档一起记下（同一次写入）：要么都落盘，要么重交时照常再算
			const opEntry = op ? { ['ops:' + id]: [...ops, { op, ok: r.ok, msg: String(r.msg ?? '') }].slice(-OPS_KEEP) } : {};
			// 存档和全服周计数一次写入
			if (next !== current) await this.persistMany([{ id, keyHash, state: next, at: now, raw }], counted ? { week, k: 1 } : undefined, opEntry);
			// 动作没改动存档（被规则拒绝）但校验时修过存档：把修好的写回，不带这次没落定的每日奖励
			else if (migrated) await this.persistMany([{ id, keyHash, state: current, at: now, raw }], undefined, opEntry);
			else if (op) await this.ctx.storage.put(opEntry);
			return json({ ok: r.ok, msg: r.msg, state: publicState(next), at: now, daily: claim?.msg });
		}
		if (action === 'coop') return this.handleCoop(body, id, keyHash, current, live, region, now, wall, locked, raw);
		if (action === 'trade') return this.handleTrade(body, id, keyHash, current, live, region, now, wall, locked, raw);
		if (action === 'rekey') {
			// 换码只改 keyHash，存档、版本号、榜单都不动。不带这次没落定的每日奖励（和规则拒绝的动作一样）
			const newKey = body.newKey;
			if (typeof newKey !== 'string' || !KEY_RE.test(newKey) || newKey === key) return json({ ok: false, msg: '新同步码无效' }, 400);
			const newHash = await sha256Hex(id + ':' + newKey);
			await this.persist(id, newHash, current, now, raw);
			return json({ ok: true, msg: '同步码已更换，旧的同步码和二维码已失效', state: publicState(current), at: now });
		}
		if (action === 'export') return json({ ok: true, export: await this.exportOf(id, raw, current, wall), at: now });
		if (action === 'delete') {
			if (body.confirm !== 'delete') return json({ ok: false, msg: '请求无效' }, 400);
			await this.deleteAccount(id);
			return json({ ok: true, msg: '账号和云端存档已删除', at: wall });
		}
		if (action === 'notes') {
			// notes { op: 'list' }：这个地点的留言；{ op: 'post', text }：留一句；{ op: 'delete', note }：删自己的
			const loc = current.loc;
			const hash = (await sha256Hex(id)).slice(0, 12);
			const day = realDayOf(now);
			const list = await this.notesAt(loc);
			// 屏蔽的人的留言不给我看；最近被好几个人举报的人的留言先对所有人隐藏（自己的照常看得到，第 24 批）
			const hidden = await this.hiddenAuthors(list.map((n) => n.author), day);
			const view = () => ({ notes: list.filter((n) => n.author === hash || (!isBlocked(current, n.author) && !hidden.has(n.author))).map((n) => ({ id: n.id, name: n.name, avatar: n.avatar, text: n.text, at: n.at, mine: n.author === hash })).reverse() });
			if (body.op === 'list') return json({ ok: true, ...view(), at: now });
			if (body.op === 'post') {
				const c = cleanNote(body.text);
				if ('error' in c) return json({ ok: false, msg: c.error, ...view(), at: now }, 400);
				// 同一地点排队：读计数、检查、写入之间不会插进别人的发帖
				return this.inNotes(loc, async () => {
					// 个人计数和地点计数各自记着日期，只往前走：发留言不推进存档时间，时钟回拨也不会把今天的额度重开
					const cd = await this.ctx.storage.get<{ day: number; n: number }>('notecd:' + hash);
					const ld = await this.ctx.storage.get<{ day: number; n: number }>('notesday:' + loc);
					const today = Math.max(day, cd?.day ?? 0);
					if (list.some((n) => n.author === hash && n.day === today)) return json({ ok: false, msg: '今天已经在这里留过言了，明天再来。', ...view(), at: now }, 429);
					const used = cd && cd.day === today ? cd.n : 0;
					if (used >= NOTES_PER_DAY) return json({ ok: false, msg: `今天已经留了 ${NOTES_PER_DAY} 条，明天再来。`, ...view(), at: now }, 429);
					// 地点计数记的是当天新增了几条，删帖不退额度；计数的日期比我的还新时按它算（别的存档时间可能稍快）
					const locDay = Math.max(today, ld?.day ?? 0);
					const locUsed = ld && ld.day === locDay ? ld.n : 0;
					if (locUsed >= NOTES_LOC_DAY) return json({ ok: false, msg: '今天这里的留言已经很多了，明天再来。', ...view(), at: now }, 429);
					const nid = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
					const next = [...list, { id: nid, author: hash, name: current.name, avatar: current.avatar, text: c.text, at: wall, day: today }].slice(-NOTES_PER_LOC);
					await this.ctx.storage.put({ ['notes:' + loc]: next, ['notecd:' + hash]: { day: today, n: used + 1 }, ['notesday:' + loc]: { day: locDay, n: locUsed + 1 } });
					list.splice(0, list.length, ...next); // 写成功才改内存
					return json({ ok: true, msg: '留言贴上了', ...view(), at: now });
				});
			}
			if (body.op === 'delete') {
				return this.inNotes(loc, async () => {
					const i = typeof body.note === 'string' && NOTE_RE.test(body.note) ? list.findIndex((n) => n.id === body.note) : -1;
					if (i < 0) return json({ ok: false, msg: '这条留言已经不在了', ...view(), at: now }, 404);
					if (list[i].author !== hash) return json({ ok: false, msg: '只能删自己的留言', ...view(), at: now }, 403);
					const next = list.filter((_, j) => j !== i);
					await this.ctx.storage.put('notes:' + loc, next);
					list.splice(0, list.length, ...next);
					return json({ ok: true, msg: '留言删掉了', ...view(), at: now });
				});
			}
			return json({ ok: false, msg: '请求无效' }, 400);
		}
		if (action === 'safety') return this.handleSafety(body, id, keyHash, current, live, now, canon);
		if (action === 'weekly') {
			// weekly { op: 'status' }：这周的目标、全服进度、我出了几份力；{ op: 'claim', rev }：达成后领奖
			const day = realDayOf(now);
			const week = weekOf(day);
			const count = await this.weekCount(week);
			const view = (st: PlayerState) => ({ week: { week, goal: goalOfWeek(week), count, daysLeft: weekDaysLeft(day), mine: weeklyMine(st, week) } });
			if (body.op === 'status') return json({ ok: true, ...view(live), at: now });
			if (body.op === 'claim') {
				if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), ...view(current), at: now }, 409);
				const r = applyWeeklyClaim(live, week, count);
				if (!r.ok) return json({ ok: false, msg: r.msg, ...view(live), at: now });
				const next = canon(r.state);
				await this.persist(id, keyHash, next, now, raw);
				return json({ ok: true, msg: r.msg, state: publicState(next), ...view(next), at: now });
			}
			return json({ ok: false, msg: '请求无效' }, 400);
		}
		return json({ ok: false, msg: '请求无效' }, 400);
	}

	// ---------- 导出与删除账号 ----------
	/** 这名玩家在服务器上的全部数据：存档（含这版代码不认识的字段，种子清零）、自己的留言、榜单记录。不含 key、keyHash、真实 id 以外的别人的数据 */
	private async exportOf(id: string, raw: unknown, current: PlayerState, wall: number) {
		const h = (await sha256Hex(id)).slice(0, 12);
		const notes: { loc: string; text: string; at: number }[] = [];
		for (const [k, list] of await this.ctx.storage.list<Note[]>({ prefix: 'notes:' })) {
			for (const n of Array.isArray(list) ? list : []) if (n && n.author === h) notes.push({ loc: k.slice(6), text: String(n.text), at: n.at });
		}
		const rank = await this.ctx.storage.get('rank:' + h);
		// 真实 id 是同步码的一半：导出文件可能被转给别人，只放哈希前缀（和在线状态、榜单里一样）
		const { id: _id, ...state } = carryUnknown(raw, publicState(current)) as PlayerState & Record<string, unknown>;
		return { format: 'earth-save-export', v: SAVE_VERSION, exportedAt: wall, player: h, state, notes, rank: rank ?? null };
	}

	/** 删除账号：调用方已经持有这个存档的锁。同一次 delete 删掉所有按 id、id 哈希记的键；留言按地点排队改；内存里的挂单和队伍一起清 */
	private async deleteAccount(id: string): Promise<void> {
		const h = (await sha256Hex(id)).slice(0, 12);
		const locs = [...(await this.ctx.storage.list<Note[]>({ prefix: 'notes:' })).entries()]
			.filter(([, list]) => Array.isArray(list) && list.some((n) => n && n.author === h))
			.map(([k]) => k.slice(6));
		for (const loc of locs) {
			await this.inNotes(loc, async () => {
				const list = await this.notesAt(loc);
				const next = list.filter((n) => n.author !== h);
				await this.ctx.storage.put('notes:' + loc, next);
				list.splice(0, list.length, ...next);
			});
		}
		await this.ctx.storage.delete(['save:' + id, 'ops:' + id, 'rank:' + h, 'h:' + h, 'notecd:' + h]);
		for (const [k, o] of this.offers) if (o.from === id || o.toId === id) this.offers.delete(k);
		for (const [k, l] of this.lobbies) {
			if (l.done) { l.done.ids = l.done.ids.filter((x) => x !== id); continue; }
			if (l.host === id) this.lobbies.delete(k);
			else l.members = l.members.filter((m) => m.id !== id);
		}
		this.boardGen++;
		this.board = null;
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

	private async handleCoop(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, region: Region, now: number, wall: number, locked: Set<string>, raw: unknown): Promise<Response> {
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
			const members: { id: string; keyHash: string; state: PlayerState; name: string; role: number; now: number; raw: unknown }[] = [];
			// 只结算排队时已经锁住的成员：之后才加入的人存档没锁，不能动
			for (const m of l.members.filter((x) => locked.has(x.id))) {
				if (m.id === id) {
					members.push({ id, keyHash, state: live, name: m.name, role: m.role, now, raw });
					continue;
				}
				const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + m.id);
				// 每个队友用自己存档的时间校验和落盘，不用发起人的（时钟回拨时两边沿用的时间不一样）
				const mNow = EarthWorld.saveNow(rec, wall);
				const st = rec ? sanitizeState(rec.state, locs, { fallbackLoc: region.spawn, now: mNow }) : null;
				if (rec && st && st.id === m.id) members.push({ id: m.id, keyHash: rec.keyHash, state: st, name: m.name, role: m.role, now: mNow, raw: rec.state });
			}
			const ready = members.filter((m) => m.state.loc === l.loc && !coopBlocked(m.state, region, def));
			if (!ready.some((m) => m.id === id)) { unfreeze(); return no(coopBlocked(live, region, def) ?? '你现在不能参加'); }
			if (ready.length < def.min) { unfreeze(); return no(`人不够：至少要 ${def.min} 个人在这里、现在能参加`); }
			const r = applyCoop(def, region, ready.map((m) => ({ state: m.state, role: m.role, name: m.name })));
			// 常遇见的人：每个成员记下其他成员（用 id 哈希前缀，和在线状态一致）
			const hashes = await Promise.all(ready.map(async (m) => (await sha256Hex(m.id)).slice(0, 12)));
			const people = ready.map((m, i) => ({ hash: hashes[i], name: m.name, avatar: m.state.avatar }));
			const coopDay = realDayOf(now);
			const week = weekOf(coopDay);
			let counted = 0;
			const saves = ready.map((m, i) => {
				const noted = noteMet(r.results[i].state, people.filter((_, j) => j !== i), coopDay);
				const met = goalOfWeek(week).metric === 'coop' ? addWeekly(noted, week) : noted;
				if (met !== noted) counted++;
				return { id: m.id, keyHash: m.keyHash, at: m.now, raw: m.raw, state: sanitizeState(met, locs, { fallbackLoc: region.spawn, now: m.now }) ?? met };
			});
			// 所有人和全服周计数一次写入：写失败就谁都没拿到，队伍还在、可以重试；写成功后大厅标记结束，版本号也都变了，重复开始会被拒绝
			await this.persistMany(saves, { week, k: counted });
			const mine = saves.find((x) => x.id === id)!.state;
			const text = (r.success ? def.ok : def.fail).text;
			l.done = { at: wall, success: r.success, text, ids: ready.map((m) => m.id) };
			return json({ ok: true, msg: `${def.icon} ${def.title}：${text}`, success: r.success, state: publicState(mine), ...this.coopView(id, mine.loc), at: now });
		}
		return no('请求无效');
	}

	// ---------- 送礼与二手摊 ----------
	// trade { op: 'list' }                         这里给我的礼物、这里的二手摊，和我挂出去的
	// trade { op: 'gift', to, toName, item }        送给同一地点的某位玩家（to 是在线状态里的 id 哈希）
	// trade { op: 'sale', item, price }             挂到这里的二手摊
	// trade { op: 'cancel', offer }                 撤回自己挂的
	// trade { op: 'decline', offer }                不要别人送的
	// trade { op: 'accept', offer, rev }            收下礼物 / 买下：锁住双方存档后重新检查，一次写入
	private pruneOffers(wall: number) {
		for (const [k, o] of this.offers) if (!o.taking && wall - o.at > OFFER_TTL_MS) this.offers.delete(k);
	}

	/** 最近被足够多的不同的人举报的作者（只查这些作者的举报记录） */
	private async hiddenAuthors(authors: string[], day: number): Promise<Set<string>> {
		const keys = [...new Set(authors)].filter((a) => HASH_RE.test(a)).map((a) => 'report:' + a);
		const out = new Set<string>();
		if (!keys.length) return out;
		// 逐个取（最多 NOTES_PER_LOC 个作者）
		const got = await Promise.all(keys.map((k) => this.ctx.storage.get<ReportRec[]>(k)));
		keys.forEach((k, i) => { const v = got[i]; if (Array.isArray(v) && reportHidden(v, day)) out.add(k.slice('report:'.length)); });
		return out;
	}

	// ---------- 屏蔽与举报（第 24 批） ----------
	// safety { op: 'block', peer | note, rev }          屏蔽在线的某人（peer = 在线状态里的哈希）或某条留言的作者
	// safety { op: 'unblock', hash, rev }               解除屏蔽
	// safety { op: 'report', peer | note, reason, quote?, rev }  举报并顺手屏蔽；留言的原话由服务端从留言板取，聊天的原话由举报人提交（只作参考）
	// 目标一律由服务端查实：peer 必须是有存档的玩家，note 必须是我所在地点留言板上的留言。别人的真实 id 不出服务端
	private async handleSafety(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, now: number, canon: (s: PlayerState) => PlayerState): Promise<Response> {
		const hash = (await sha256Hex(id)).slice(0, 12);
		const day = realDayOf(now);
		const op = body.op;
		if (op !== 'block' && op !== 'unblock' && op !== 'report') return json({ ok: false, msg: '请求无效' }, 400);
		if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), at: now }, 409);
		if (op === 'unblock') {
			if (typeof body.hash !== 'string' || !HASH_RE.test(body.hash)) return json({ ok: false, msg: '请求无效' }, 400);
			const who = live.blocked[body.hash];
			const r = applyBlock(live, 'unblock', { hash: body.hash, name: who?.name ?? '对方', avatar: who?.avatar ?? '' }, day);
			if (!r.ok) return json({ ok: false, msg: r.msg, state: publicState(current), at: now });
			const next = canon(r.state);
			await this.persist(id, keyHash, next, now);
			return json({ ok: true, msg: r.msg, state: publicState(next), at: now });
		}
		// 找到对方：在线状态里的哈希，或我所在地点的一条留言
		let target: { hash: string; name: string; avatar: string; quote: string; ctx: ReportRec['ctx'] } | null = null;
		if (typeof body.note === 'string' && NOTE_RE.test(body.note)) {
			const n = (await this.notesAt(current.loc)).find((x) => x.id === body.note);
			if (n) target = { hash: n.author, name: n.name, avatar: n.avatar, quote: n.text, ctx: 'note' };
		} else if (typeof body.peer === 'string' && HASH_RE.test(body.peer)) {
			const pid = await this.ctx.storage.get<string>('h:' + body.peer);
			const prec = typeof pid === 'string' ? await this.ctx.storage.get<{ state: any }>('save:' + pid) : undefined;
			if (prec?.state) target = { hash: body.peer, name: cleanName(prec.state.name) || '旅人', avatar: String(prec.state.avatar ?? '🧑').replace(/[<>&"']/g, '').slice(0, 8), quote: typeof body.quote === 'string' ? body.quote : '', ctx: typeof body.quote === 'string' && body.quote ? 'chat' : 'player' };
		}
		if (!target) return json({ ok: false, msg: '找不到这位玩家', state: publicState(current), at: now }, 404);
		if (target.hash === hash) return json({ ok: false, msg: op === 'report' ? '不能举报自己' : '不能屏蔽自己', state: publicState(current), at: now }, 400);
		let msg = '';
		if (op === 'report') {
			if (!isReportReason(body.reason)) return json({ ok: false, msg: '选一个举报原因', state: publicState(current), at: now }, 400);
			const reason = body.reason;
			const t = target;
			const res = await this.inNotes('@report', async () => {
				// 举报人的每日次数和被举报人的记录排队写：两个人同时举报也不会互相覆盖
				const cd = await this.ctx.storage.get<{ day: number; n: number }>('reportcd:' + hash);
				const today = Math.max(day, cd?.day ?? 0);
				const used = cd && cd.day === today ? cd.n : 0;
				if (used >= REPORTS_PER_DAY) return `今天已经举报了 ${REPORTS_PER_DAY} 次，明天再来。`;
				const list = (await this.ctx.storage.get<ReportRec[]>('report:' + t.hash)) ?? [];
				const next = addReport(Array.isArray(list) ? list : [], { by: hash, reason, ctx: t.ctx, day: today, quote: t.quote });
				if (typeof next === 'string') return next;
				await this.ctx.storage.put({ ['report:' + t.hash]: next, ['reportcd:' + hash]: { day: today, n: used + 1 } });
				return null;
			});
			if (typeof res === 'string') return json({ ok: false, msg: res, state: publicState(current), at: now }, 429);
			msg = '举报收到了，谢谢。';
		}
		// 举报顺手屏蔽；已经屏蔽过就只记举报
		if (isBlocked(live, target.hash)) {
			if (op === 'block') return json({ ok: false, msg: '已经屏蔽过了。', state: publicState(current), at: now });
			return json({ ok: true, msg, state: publicState(current), at: now });
		}
		const r = applyBlock(live, 'block', target, day, hash);
		if (!r.ok) return json({ ok: !!msg, msg: msg ? `${msg}${r.msg}` : r.msg, state: publicState(current), at: now });
		const next = canon(r.state);
		await this.persist(id, keyHash, next, now);
		return json({ ok: true, msg: msg ? `${msg}${r.msg}` : r.msg, state: publicState(next), at: now });
	}

	private tradeView(id: string, hash: string, loc: string, blocked: PlayerState['blocked'] = {}) {
		const offers = [...this.offers.values()]
			.filter((o) => o.from === id || (o.loc === loc && (o.kind === 'sale' || o.to === hash) && !Object.hasOwn(blocked, o.fromHash)))
			.map((o) => ({ id: o.id, kind: o.kind, item: o.item, price: o.price, name: o.fromName, avatar: o.fromAvatar, toName: o.from === id ? o.toName : '', loc: o.loc, mine: o.from === id, taking: !!o.taking }));
		return { offers };
	}

	private async handleTrade(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, region: Region, now: number, wall: number, locked: Set<string>, raw: unknown): Promise<Response> {
		this.pruneOffers(wall);
		const hash = (await sha256Hex(id)).slice(0, 12);
		const day = realDayOf(now);
		const op = body.op;
		const view = (st: PlayerState) => this.tradeView(id, hash, st.loc, st.blocked);
		const reply = (extra: Record<string, unknown> = {}) => json({ ok: true, ...view(current), at: now, ...extra });
		const no = (msg: string, status = 400) => json({ ok: false, msg, ...view(current), at: now }, status);
		const mineOpen = () => [...this.offers.values()].filter((o) => o.from === id).length;
		const newId = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('');

		if (op === 'list') return reply();
		if (op === 'gift' || op === 'sale') {
			const item = typeof body.item === 'string' ? getItem(body.item) : undefined;
			if (!item) return no('没有这件东西');
			const why = giveBlocked(live, item.id, day);
			if (why) return no(why);
			if (mineOpen() >= OFFER_PER_PLAYER) return no(`同时最多挂 ${OFFER_PER_PLAYER} 件，先撤回一件`);
			if (this.offers.size >= OFFER_MAX) return no('现在挂单太多了，稍后再试');
			// 同一件物品挂的单不能超过背包里的数量
			const pending = [...this.offers.values()].filter((o) => o.from === id && o.item === item.id).length;
			if (pending >= (live.inventory[item.id] ?? 0)) return no('这件东西已经都挂出去了');
			if ([...this.offers.values()].filter((o) => o.loc === current.loc).length >= OFFER_PER_LOC) return no('这里挂着的东西太多了，稍后再试');
			let to: string | null = null;
			let toId: string | null = null;
			let toName = '';
			let price = 0;
			if (op === 'gift') {
				if (typeof body.to !== 'string' || !HASH_RE.test(body.to)) return no('要送给谁？');
				if (body.to === hash) return no('不能送给自己');
				// 收件人必须是真实存在、现在就在这个地点的玩家
				const target = await this.ctx.storage.get<string>('h:' + body.to);
				const trec = typeof target === 'string' ? await this.ctx.storage.get<{ state: any }>('save:' + target) : undefined;
				if (!target || !trec || trec.state?.loc !== current.loc) return no('对方不在这里，送不了');
				// 屏蔽（第 24 批）：我屏蔽了对方，或对方屏蔽了我，都送不了；不告诉是谁屏蔽了谁
				if (isBlocked(current, body.to)) return no('你屏蔽了对方，先解除屏蔽再送');
				const tb = trec.state?.blocked;
				if (tb && typeof tb === 'object' && Object.hasOwn(tb, hash)) return no('对方现在收不到礼物');
				if ([...this.offers.values()].filter((o) => o.toId === target).length >= OFFER_PER_TARGET) return no('对方还有好几份礼物没收，等等再送');
				to = body.to;
				toId = target;
				toName = cleanName(trec.state?.name) || '旅人';
			} else {
				const range = saleRange(item.id)!;
				if (!Number.isInteger(body.price) || body.price < range.min || body.price > range.max) return no(`价格要在 $${range.min}–$${range.max} 之间`);
				price = body.price;
			}
			// 查收件人时等过存储，期间别人可能也挂了单：挂上之前（中间不再等待）再查一次全局和地点上限
			if (this.offers.size >= OFFER_MAX) return no('现在挂单太多了，稍后再试');
			if ([...this.offers.values()].filter((o) => o.loc === current.loc).length >= OFFER_PER_LOC) return no('这里挂着的东西太多了，稍后再试');
			const oid = newId();
			this.offers.set(oid, { id: oid, kind: op, from: id, fromHash: hash, fromName: current.name, fromAvatar: current.avatar, to, toId, toName, item: item.id, price, loc: current.loc, at: wall });
			return reply({ msg: op === 'gift' ? `${item.icon} 等${toName}收下${item.name}` : `${item.icon} ${item.name}挂上二手摊了，$${price}` });
		}
		const o = typeof body.offer === 'string' && OFFER_RE.test(body.offer) ? this.offers.get(body.offer) : undefined;
		if (!o) return no('这件东西已经被拿走或撤回了', 404);
		const item = getItem(o.item)!;
		if (op === 'cancel') {
			if (o.from !== id) return no('只能撤回自己挂的');
			if (o.taking) return no('对方正在收下，撤不回来了', 409);
			this.offers.delete(o.id);
			return reply({ msg: '已撤回' });
		}
		if (op === 'decline') {
			if (o.kind !== 'gift' || o.to !== hash) return no('这不是给你的');
			if (o.taking) return no('正在处理，稍后再试', 409);
			this.offers.delete(o.id);
			return reply({ msg: `没有收下${item.name}` });
		}
		if (op === 'accept') {
			if (o.from === id) return no('不能收下自己挂的');
			if (o.kind === 'gift' && o.toId !== id) return no('这不是给你的');
			if (o.loc !== current.loc) return no('要在同一个地点才能拿');
			if (!locked.has(o.from)) return no('正在处理，稍后再试', 409);
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), ...view(current), at: now }, 409);
			const locs = new Set(region.locations.map((x) => x.id));
			const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + o.from);
			const fNow = EarthWorld.saveNow(rec, wall);
			const fromState = rec ? sanitizeState(rec.state, locs, { fallbackLoc: region.spawn, now: fNow }) : null;
			if (!rec || !fromState || fromState.id !== o.from) {
				this.offers.delete(o.id);
				return no('对方的存档不在了');
			}
			// 送礼和摆摊都要挂单人还在这里：人走了单子就撤下（东西一直在他背包里，没有托管）
			if (fromState.loc !== o.loc) {
				this.offers.delete(o.id);
				return no(o.kind === 'gift' ? '对方已经离开这里了' : '摊主已经走了，这个摊收了');
			}
			const r = applyTrade(fromState, live, o.item, o.price, day, { from: o.fromName, to: current.name });
			if (typeof r === 'string') {
				// 对方已经没有这件东西（或今天给出去太多次）：这张单作废
				if (giveBlocked(fromState, o.item, day)) this.offers.delete(o.id);
				return no(r);
			}
			const canon = (st: PlayerState, t: number) => sanitizeState(st, locs, { fallbackLoc: region.spawn, now: t }) ?? st;
			const fromHash = (await sha256Hex(o.from)).slice(0, 12);
			const week = weekOf(day);
			const tradeCounts = goalOfWeek(week).metric === 'trade';
			const wk = (st: PlayerState) => (tradeCounts ? addWeekly(st, week) : st);
			const toAfter = wk(noteMet(r.to, [{ hash: fromHash, name: o.fromName, avatar: o.fromAvatar }], day));
			const mine = canon(toAfter, now);
			// 一笔交易算一次（双方都记一份力）；和双方存档一次写入
			await this.persistMany([
				{ id: o.from, keyHash: rec.keyHash, state: canon(wk(noteMet(r.from, [{ hash, name: current.name, avatar: current.avatar }], day)), fNow), at: fNow, raw: rec.state },
				{ id, keyHash, state: mine, at: now, raw },
			], { week, k: toAfter.weekly !== r.to.weekly ? 1 : 0 });
			this.offers.delete(o.id);
			const msg = o.price > 0 ? `${item.icon} 花 $${o.price} 买下了${item.name}` : `${item.icon} 收下了${o.fromName}送的${item.name}`;
			return json({ ok: true, msg, state: publicState(mine), ...view(mine), at: now });
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
