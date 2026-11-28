// 「地球人生」联机服务端 —— Cloudflare Durable Object。
// 一个区域一个实例（idFromName(regionId)）：在线玩家位置、同地点聊天、互动表情。
// 另有保留实例 '@SAVES' 负责云存档（跨设备同步）。
// 权威结算：客户端只发送动作（create / act），由本实例调用规则引擎结算并保存；
// 客户端不能上传存档，改本地数据不会影响服务器上的进度。
import { applyAction, applyBlock, applyCoop, applyTrade, applyWeeklyClaim, parseAction, publicState } from '../core/actions.ts';
import { addReport, BLOCK_MAX, isBlocked, isReportReason, REPORTS_PER_DAY, reportHidden, type ReportRec } from '../core/safety.ts';
import { addWeekly, goalOfWeek, weekDaysLeft, weeklyMine, weekOf, type WeeklyMetric } from '../core/weekly.ts';
import { giveBlocked, saleRange, TRADE_DAILY, tradesToday } from '../core/trade.ts';
import { bidLot, buyLot, cancelLot, claimMail, createLot, EXCHANGE, lotView, newbieBlocked, parseSwapSide, pushMail, quotaAdd, quotaBlocked, quotaOf, resolveSwap, settleLot, swapCash, swapShapeBlocked, type Lot, type Mail, type SwapSide } from '../core/exchange.ts';
import { noteMet } from '../core/social.ts';
import { cleanNote, contactError, NOTES_LOC_DAY, NOTES_PER_DAY, NOTES_PER_LOC } from '../core/notes.ts';
import { EXPERIENCES } from '../data/experiences.ts';
import { getItem } from '../core/attributes.ts';
import { coopBlocked } from '../core/coop.ts';
import { getCoop } from '../data/coop.ts';
import { claimDaily, DAILY, realDayOf } from '../core/daily.ts';
import { noteReturn } from '../core/onboard.ts';
import { refreshWishes } from '../core/wishes.ts';
import { cleanName, createCharacter, sanitizeState } from '../core/character.ts';
import { carryUnknown, SAVE_VERSION } from '../core/save.ts';
import {
	addTitles, cleanLbEntry, cleanPref, LB_PREF_DEFAULT, cleanSeason, cleanTitles, contestPoints, lbAwards, lbEntry, lbSeasonRec, lbSort, lbView, parseQuery, patchPref,
	seasonDaysLeft, seasonLabel, seasonOfDay, seasonStartDay, titleText, type LbItem, type LbQuery, type LbRanked,
} from '../core/leaderboard.ts';
import { LB_CACHE_MS, LB_DIMS, LB_FIRST_SEASON } from '../data/leaderboard.ts';
import { MET_MAX } from '../core/social.ts';
import type { PlayerState, Region } from '../core/types.ts';
import { FULL_AREAS, WORLD } from '../data/wa.ts';
import { areaOf } from '../data/areas-base.ts';
import { liveDeal, monthOfDay, redeemCode, redeemProblem, statementFor } from '../core/sponsor.ts';
import { SPONSORS, type SponsorDeal } from '../data/sponsors.ts';
import { actionCounts, BORN_KEEP_DAYS, BORN_PREFIX, cleanBatch, funnelSteps, mergeDays, READ_MAX_DAYS, StatsBuffer, STATS_BODY_MAX, type Counts, type FunnelStep } from './stats.ts';
import { ipKey, RateLimiter, readBounded } from './ratelimit.ts';

const SAVES_ROOM = '@SAVES';
/** 客户端统计上报（界面使用、报错、性能）汇总在这个保留实例，不挤占存档实例 */
const STATS_ROOM = '@STATS';
const STATS_WINDOW_MS = 60 * 1000;
const STATS_LIMIT = 6; // 每 IP 每分钟最多几批（客户端正常一分钟最多一批）
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
const PIN_RE = /^\d{6}$/;
const PIN_TRIES_PLAYER = 5; // 每个玩家每条赞助每天最多输错这么多次 PIN
const PIN_TRIES_DEAL = 100; // 每条赞助每天合计最多输错这么多次，超过当天锁定（6 位 PIN 有一百万种，一天最多猜中万分之一）
/** 一个玩家某天在某条赞助的核销记录：at 领码时间，ok 店员确认时间，tries 输错 PIN 次数 */
interface RedeemRec { at: number; ok?: number; tries: number }
/** 店员 PIN：只存加盐哈希 */
interface PinRec { salt: string; hash: string }
const OFFER_TTL_MS = 30 * 60 * 1000; // 送礼、二手摊的挂单 30 分钟没人接就撤下
const OFFER_MAX = 500;
const OFFER_PER_PLAYER = 3; // 每人同时挂着的送礼 + 二手摊最多 3 件
const OFFER_PER_TARGET = 3; // 每人同时最多收到 3 份待收的礼物
const OFFER_PER_LOC = 30; // 每个地点同时最多 30 张挂单
const KEY_RE = /^[a-zA-Z0-9]{16,64}$/;
// 交易所（寄卖、拍卖，见 docs/earth-game/player-trade.md）：拍品、邮箱、额度、账本都落盘，所有改动在 marketChain 里排队
const LOT_RE = /^[a-f0-9]{12}$/;
const LOTS_MAX = 600; // 全服同时在售 / 在拍的上限
const LOTS_SHOWN = 60; // 列表一次最多返回几件
const MOPS_KEEP = 16; // 交易所请求编号记住最近几个（防重放：同一编号只执行一次）

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
	kind: 'gift' | 'sale' | 'swap';
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
	/** 面交换物（kind 'swap'）：发起人给出的、想换来的 */
	give?: SwapSide;
	want?: SwapSide;
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

/** 内部路径：这个 id 有没有存档（只在 Durable Object 之间调用） */
const KNOWN_PATH = '/api/earth/known';

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

/** 还没有随机数密钥的旧存档补一把；行情从今天之后才换算法（rngDay），历史价格不变。已有密钥的原样返回 */
function keyUp<T extends PlayerState | null>(s: T): T {
	return s && !s.rngKey ? { ...s, rngKey: newRngKey(), rngDay: Math.floor(s.clock / 1440) } : s;
}

/** 随机数密钥：128 位，32 位十六进制（core/prf.ts）。只存在服务端的存档里 */
function newRngKey(): string {
	return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
	private guests = new Set<WebSocket>(); // 没有存档的连接（v106）：只能旁观，不能聊天、发表情
	private sockIp = new Map<WebSocket, string>(); // 连接 -> 来源限流键（只在内存，不广播、不落盘）
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private locks = new Map<string, Promise<unknown>>(); // 同一存档的请求排队执行，避免并发读改写
	// 排行榜（docs/earth-game/leaderboard.md）：所有存档都写在这个实例里，榜单在这里聚合。
	// lb：当前赛季的内存索引（每人一条 LbItem），第一次看榜时从存储整批读入，之后每次落盘就地更新，不再整表重读
	private lb: { sid: number; items: Map<string, LbItem> } | null = null;
	private lbLoading: Promise<void> | null = null;
	/** 索引读入期间发生的写入：读完后补上（读到的列表可能比这些写入旧） */
	private lbBacklog: { sid: number; fns: ((items: Map<string, LbItem>, sid: number) => void)[] } | null = null;
	/** 排名结果缓存：键 = 维度|范围|地区，LB_CACHE_MS 内重复看榜不重排 */
	private lbCache = new Map<string, { at: number; ranked: LbRanked[] }>();
	private lbTtl = LB_CACHE_MS;
	private lbSettling: Promise<void> | null = null;
	private lbSettled = -1; // 这个实例已确认结算到哪个赛季之前：同一季里看榜不再每次读 lbsettled
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
	private lots: Map<string, Lot> | null = null; // 交易所拍品（内存一份，落盘在 'lot:<id>'；只在 marketChain 里读写）
	private marketChain: Promise<unknown> = Promise.resolve(); // 交易所的所有改动排队：拍品、邮箱、账本不会被两个请求交错改

	private stats: StatsBuffer; // 统计计数（见 stats.ts）：内存里攒一会儿再合并落盘
	private statsRate = new Map<string, { n: number; resetAt: number }>();

	private sponsorToken: string; // 商户对账单接口的令牌（Workers 机密 EARTH_SPONSOR_TOKEN）；没配置就不开放这个接口
	private redeemChain: Promise<unknown> = Promise.resolve(); // 核销计数排队写入：每天、每月的计数是所有玩家共用的

	constructor(ctx: DurableObjectState, env: unknown) {
		this.ctx = ctx;
		this.stats = new StatsBuffer(ctx.storage as never);
		const t = (env as { EARTH_SPONSOR_TOKEN?: unknown } | null)?.EARTH_SPONSOR_TOKEN;
		this.sponsorToken = typeof t === 'string' && t.length >= 32 ? t : '';
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api/earth/save') return this.handleSave(request);
		if (url.pathname === '/api/earth/sponsor-report') return this.handleSponsorReport(request, url);
		if (url.pathname === '/api/earth/sponsor-pin') return this.handleSponsorPin(request);
		if (url.pathname === '/api/earth/stats') return this.handleStats(request);
		// 只有 routeEarth 核对过查询令牌后才会转到这里（外部请求到不了这个路径）
		if (url.pathname === '/api/earth/stats/read') return this.handleStatsRead(url);
		// 这个 id 有没有存档（v106，只有 routeEarth 在转发在线频道连接前会问 '@SAVES' 实例；外部请求到不了这个路径）
		if (url.pathname === KNOWN_PATH) {
			const kid = url.searchParams.get('id') || '';
			const known = ID_RE.test(kid) && (await this.ctx.storage.get('h:' + (await sha256Hex(kid)).slice(0, 12))) === kid;
			return json({ ok: true, known });
		}
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
		// 没有存档的连接（v106）：known 由 routeEarth 向存档实例查实后写上，客户端自己带的会被覆盖。
		// 这种连接屏蔽不了也举报不了（屏蔽、举报都要按哈希找到存档），所以只让旁观：不能自己起名字，不能聊天、发表情
		const guest = url.searchParams.get('known') !== '1';
		const me: Presence = {
			// 对外只暴露 id 的哈希前缀：真实 id 是存档凭证的一部分，不能广播
			id: (await sha256Hex(id)).slice(0, 12),
			name: guest ? '旅人' : cleanName(url.searchParams.get('name')) || '旅人',
			avatar: guest ? '🧑' : (url.searchParams.get('avatar') || '🧑').replace(/[<>&"']/g, '').slice(0, 8),
			loc: locs.has(loc) ? loc : region.spawn,
		};

		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();
		this.sockets.set(server, me);
		if (guest) this.guests.add(server);
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
				if (this.guests.has(ws)) {
					this.send(ws, { t: 'notice', msg: '没发出去：先创建角色才能聊天' });
					break;
				}
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
				if (this.guests.has(ws)) break;
				// 共同事件大厅或交易挂单有变化：只提醒同一地点的其他人去拉一次列表，不带任何内容（内容以服务端为准）
				const last = this.hintAt.get(ws) ?? {};
				if (now - (last[m.t] ?? 0) < COOP_HINT_MS) break;
				this.hintAt.set(ws, { ...last, [m.t]: now });
				for (const [sock, p] of this.sockets) if (p.loc === me.loc && sock !== ws) this.send(sock, { t: m.t });
				break;
			}
			case 'emote':
				if (!this.guests.has(ws) && EMOTES.includes(m.kind) && typeof m.to === 'string') {
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
		this.guests.delete(ws);
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

	// ---------- 统计（设计见 docs/earth-game/analytics.md） ----------

	/**
	 * 记一次服务端结算的统计。claim：这次领了每日奖励（= 今天第一次来，算一个活跃日，并按注册日记留存）；
	 * steps：这次第一次走到的漏斗步骤（记在注册那天的汇总里）。出错只丢统计，不影响游戏。
	 */
	private async track(id: string, day: number, add: Counts, claim: { cash: number } | null | undefined, steps: FunnelStep[] = []): Promise<void> {
		try {
			this.stats.add(day, claim ? { ...add, active: 1, 'eco.in.daily': claim.cash } : add);
			if (!claim && steps.length === 0) return;
			const bornKey = BORN_PREFIX + (await sha256Hex(id)).slice(0, 12);
			const born = await this.ctx.storage.get<number>(bornKey);
			if (typeof born !== 'number' || !Number.isInteger(born)) return;
			const k = day - born;
			const cohort: Counts = {};
			if (claim && k >= 1 && k <= BORN_KEEP_DAYS) cohort['ret.' + k] = 1;
			for (const s of steps) cohort['fn.' + s] = 1;
			this.stats.add(born, cohort);
			// 过了留存窗口就删掉注册日：不再需要
			if (k > BORN_KEEP_DAYS) await this.ctx.storage.delete(bornKey);
		} catch {}
	}

	/** 客户端上报一批事件（'@STATS' 实例）：限流、限大小、白名单校验后只记计数 */
	private async handleStats(request: Request): Promise<Response> {
		if (request.method !== 'POST') return json({ ok: false }, 405);
		const ip = request.headers.get('CF-Connecting-IP') || 'local';
		const now = Date.now();
		const rate = this.statsRate.get(ip);
		if (!rate || now > rate.resetAt) {
			if (this.statsRate.size > 5000) this.statsRate.clear();
			this.statsRate.set(ip, { n: 1, resetAt: now + STATS_WINDOW_MS });
		} else if (++rate.n > STATS_LIMIT) return json({ ok: false }, 429);
		const text = await request.text();
		if (text.length > STATS_BODY_MAX) return json({ ok: false }, 413);
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return json({ ok: false }, 400);
		}
		const counts = cleanBatch(raw);
		if (!counts) return json({ ok: false }, 400);
		this.stats.add(realDayOf(now), counts);
		return json({ ok: true });
	}

	private async handleStatsRead(url: URL): Promise<Response> {
		const from = Number(url.searchParams.get('from'));
		const to = Number(url.searchParams.get('to'));
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from > READ_MAX_DAYS) return json({ ok: false, msg: '日期范围无效' }, 400);
		return json({ ok: true, days: await this.stats.read(from, to) });
	}

	// ---------- 云存档与权威结算（仅 '@SAVES' 实例；storage 键：save:<id> = { keyHash, state, at }） ----------
	// 同步码 = id + '.' + key。key 只在客户端与请求体里出现，服务端只存哈希。
	// 接口：
	//   create { id, key, profile: { name, avatar, origin, traits } }  新建角色（id 未被占用时）
	//   get    { id, key }                                             读取存档
	//   act    { id, key, rev, act: GameAction, op? }                  执行一个动作；rev 与服务端不一致返回 409
	//          op：动作编号。这个编号的动作已经结算过（响应在路上丢了、客户端重交）时不再执行，返回当时的结果和最新存档（dup: true）
	//   board  { id, key, dim?, scope?, board? }                       排行榜（前 20 名和自己的名次），只读。维度 worth/places/dex/respect/contest，
	//          范围 all（总榜）/season（本赛季），榜 global/region/friends；不带参数 = 全服身家总榜。只有同意上榜的人出现在榜上
	//   boardpref { id, key, pref: { on?, anon?, region?, friends? } }  上榜同意和显示方式（服务端 lbp:<h>，不在存档里）
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
	// raw 必填：落盘前的原存档。漏传会丢掉别的分支加的字段和较新的格式版本号（新建角色没有原存档，直接走 persistMany）
	private async persist(id: string, keyHash: string, state: PlayerState, now: number, raw: unknown): Promise<void> {
		await this.persistMany([{ id, keyHash, state, at: now, raw }]);
	}

	/**
	 * 多个存档在同一次 put 里写入（Durable Object 存储对单次多键 put 保证全写或全不写）：共同事件不会出现一部分人拿到奖励。
	 * week：这次要给全服周计数加几，和存档一起写（见 commitWeek）
	 */
	private async persistMany(saves: { id: string; keyHash: string; state: PlayerState; at: number; raw?: unknown; contest?: number }[], week?: { week: number; k: number }, extra: Record<string, unknown> = {}): Promise<void> {
		const entries: Record<string, unknown> = { ...extra };
		const lbUpdates: [string, { entry: ReturnType<typeof lbEntry>; season: { sid: number; rec: ReturnType<typeof lbSeasonRec> } }][] = [];
		for (const x of saves) {
			const h = (await sha256Hex(x.id)).slice(0, 12);
			const rankKey = 'rank:' + h;
			// 净资产没变时沿用上一条记录的时间，「同分先达到的在前」才成立
			// 赛季记录：本赛季第一次落盘时以上一条榜单记录为起点；比赛积分（共同事件里的比赛）和存档一起记
			const sid = seasonOfDay(realDayOf(x.at));
			const seaKey = `lbs:${sid}:${h}`;
			const [prev, prevSea] = await Promise.all([this.ctx.storage.get(rankKey), this.ctx.storage.get(seaKey)]);
			// raw：落盘前的原存档。这版代码不认识的字段（别的分支加的）原样带上，不在来回部署时丢掉（见 core/save.ts）
			entries['save:' + x.id] = { keyHash: x.keyHash, state: x.raw === undefined ? x.state : carryUnknown(x.raw, x.state), at: x.at };
			// 在线状态里的 id 哈希 -> 真实 id：送礼时按哈希找到收件人。只存在服务端存储里，从不发给客户端
			entries['h:' + h] = x.id;
			// 榜单数值由服务端从刚结算完的存档算；涨得不正常就挂起复核（lbEntry 里的 lbAnomaly）
			const entry = lbEntry(x.state, x.at, prev, { places: WORLD.pois.length });
			// 旧格式的 rank: 记录（排行榜之前的代码或别的分支部署写的）没有 stats：只有净资产可信，打卡、图鉴、声望按现在的值当赛季起点，
			// 不然终身成绩会整个算进这一季（合并 main 后复核）
			const pe = cleanLbEntry(prev);
			const legacy = !!pe && !(prev && typeof prev === 'object' && typeof (prev as { stats?: unknown }).stats === 'object' && (prev as { stats?: unknown }).stats !== null);
			const before = pe ? (legacy ? { ...entry.stats, worth: pe.stats.worth } : pe.stats) : null;
			const rec = lbSeasonRec(prevSea, { stats: entry.stats, before, region: x.state.region, now: x.at, realDay: realDayOf(x.at), contest: x.contest });
			entries[rankKey] = entry;
			entries[seaKey] = rec;
			lbUpdates.push([h, { entry, season: { sid, rec } }]);
		}
		if (week && week.k > 0) await this.commitWeek(week.week, week.k, entries);
		else await this.ctx.storage.put(entries);
		// 写成功才更新内存索引
		for (const [h, u] of lbUpdates) this.lbApply(h, u);
	}

	// ---------- 排行榜 ----------

	/** 改一个人在内存索引里的记录（索引还在读入时记下来，读完再补） */
	private lbApply(h: string, u: { entry?: LbItem['entry']; pref?: LbItem['pref']; titles?: LbItem['titles']; season?: { sid: number; rec: LbItem['season'] }; remove?: boolean }) {
		const f = (items: Map<string, LbItem>, sid: number) => {
			if (u.remove) { items.delete(h); return; }
			const it = items.get(h) ?? { h, entry: null, pref: cleanPref(undefined), season: null, titles: [] };
			if (u.entry !== undefined) it.entry = u.entry;
			if (u.pref !== undefined) it.pref = u.pref;
			if (u.titles !== undefined) it.titles = u.titles;
			if (u.season && u.season.sid === sid) it.season = u.season.rec;
			items.set(h, it);
		};
		if (this.lb) f(this.lb.items, this.lb.sid);
		if (this.lbBacklog) this.lbBacklog.fns.push(f);
		// 自己的变化（同意上榜、改匿名）要马上看得到：清掉排名缓存。普通落盘不清，等缓存过期
		if (u.pref !== undefined || u.remove || u.titles !== undefined) this.lbCache.clear();
	}

	/** 当前赛季的内存索引：第一次用时把 rank: / lbp: / lbs:<赛季>: / lbt: 整批读进来；赛季换了重新读 */
	private async lbIndex(sid: number): Promise<Map<string, LbItem>> {
		while (!this.lb || this.lb.sid !== sid) {
			if (!this.lbLoading) {
				const backlog = { sid, fns: [] as ((items: Map<string, LbItem>, sid: number) => void)[] };
				this.lbBacklog = backlog;
				this.lbLoading = (async () => {
					const items = new Map<string, LbItem>();
					const item = (h: string) => {
						let it = items.get(h);
						if (!it) items.set(h, (it = { h, entry: null, pref: cleanPref(undefined), season: null, titles: [] }));
						return it;
					};
					for (const [k, v] of await this.ctx.storage.list({ prefix: 'rank:' })) item(k.slice(5)).entry = cleanLbEntry(v);
					for (const [k, v] of await this.ctx.storage.list({ prefix: 'lbp:' })) item(k.slice(4)).pref = cleanPref(v);
					const sp = `lbs:${sid}:`;
					for (const [k, v] of await this.ctx.storage.list({ prefix: sp })) item(k.slice(sp.length)).season = cleanSeason(v);
					for (const [k, v] of await this.ctx.storage.list({ prefix: 'lbt:' })) item(k.slice(4)).titles = cleanTitles(v);
					for (const f of backlog.fns) f(items, sid);
					this.lb = { sid, items };
					this.lbCache.clear();
				})().finally(() => {
					this.lbLoading = null;
					if (this.lbBacklog === backlog) this.lbBacklog = null;
				});
			}
			await this.lbLoading;
		}
		return this.lb.items;
	}

	/** 全服、地区榜的排名：缓存 LB_CACHE_MS，期间的落盘不触发重排 */
	private lbRanked(items: Map<string, LbItem>, q: LbQuery, region: string | undefined, now: number, wall: number): LbRanked[] {
		const key = `${q.dim}|${q.scope}|${region ?? ''}`;
		const hit = this.lbCache.get(key);
		if (hit && wall - hit.at < this.lbTtl && wall >= hit.at) return hit.ranked;
		const ranked = lbSort(items.values(), { dim: q.dim, scope: q.scope, region }, now);
		this.lbCache.set(key, { at: wall, ranked });
		return ranked;
	}

	/**
	 * 赛季结算：上一季（以及更早没结算的）按全服赛季榜发称号。看榜时顺带检查，一个实例同时只跑一次。
	 * 结算完删掉再上一季的赛季记录（只留当前和上一季）。中途失败下次重跑：称号按（赛季, 维度）去重，不会重复发。
	 */
	private lbSettle(sid: number): Promise<void> {
		if (this.lbSettled === sid) return Promise.resolve();
		if (!this.lbSettling) {
			this.lbSettling = (async () => {
				const last = await this.ctx.storage.get<number>('lbsettled');
				let s = Number.isFinite(last) ? (last as number) + 1 : LB_FIRST_SEASON;
				s = Math.max(s, sid - 4); // 很久没人看榜：只补最近几季
				for (; s < sid; s++) {
					const items = await this.lbIndex(sid);
					const sp = `lbs:${s}:`;
					const recs = await this.ctx.storage.list({ prefix: sp });
					const list: LbItem[] = [];
					for (const [k, v] of recs) {
						const it = items.get(k.slice(sp.length));
						const season = cleanSeason(v);
						if (it && season) list.push({ ...it, season });
					}
					const tz = DAILY.tzOffsetHours * 3_600_000;
					const start = seasonStartDay(s) * 86_400_000 - tz;
					const end = seasonStartDay(s + 1) * 86_400_000 - tz;
					const { awards, withheld } = lbAwards(list, s, end, start);
					const puts: [string, unknown][] = [];
					const titled: [string, LbItem['titles']][] = [];
					for (const [h, add] of awards) {
						const t = addTitles(items.get(h)?.titles ?? [], add);
						puts.push(['lbt:' + h, t]);
						titled.push([h, t]);
					}
					if (withheld.length) puts.push(['lbrev:' + s, withheld]);
					for (let i = 0; i < puts.length; i += 100) await this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + 100)));
					await this.ctx.storage.put('lbsettled', s);
					for (const [h, t] of titled) this.lbApply(h, { titles: t });
					// 再上一季的赛季记录用不到了
					const old = [...(await this.ctx.storage.list({ prefix: `lbs:${s - 1}:` })).keys()];
					for (let i = 0; i < old.length; i += 100) await this.ctx.storage.delete(old.slice(i, i + 100));
				}
				this.lbSettled = sid;
			})().finally(() => { this.lbSettling = null; });
		}
		return this.lbSettling;
	}

	/** board：看榜（只读）。查询参数不对时回到默认（全服 · 总榜 · 身家），和旧版净资产榜一样 */
	private async lbBoard(body: any, id: string, st: any, now: number, wall: number): Promise<Response> {
		const h = (await sha256Hex(id)).slice(0, 12);
		const q = parseQuery(body);
		const day = realDayOf(now);
		const sid = seasonOfDay(day);
		await this.lbSettle(sid);
		const items = await this.lbIndex(sid);
		const mine = items.get(h);
		let ranked: LbRanked[];
		let region: { id: string; name: string } | null = null;
		if (q.board === 'friends') {
			// 好友 = 存档里「常遇见的人」（一起做过共同事件、交易过的玩家），加上自己
			const met = st && typeof st.met === 'object' && st.met ? Object.keys(st.met).filter((k) => HASH_RE.test(k)).slice(0, MET_MAX) : [];
			const only = new Set([h, ...met]);
			ranked = lbSort([...only].map((x) => items.get(x)).filter((x): x is LbItem => !!x), { dim: q.dim, scope: q.scope, only }, now);
		} else {
			let rid: string | undefined;
			if (q.board === 'region') {
				// 地区 = 本赛季登记的地区（第一次落盘时所在的州），不是现在的位置
				rid = mine?.season?.region || areaOf(st?.loc)?.id || FULL_AREAS[0].id;
				const a = FULL_AREAS.find((x) => x.id === rid);
				region = { id: rid, name: a?.name ?? rid };
			}
			ranked = this.lbRanked(items, q, rid, now, wall);
		}
		const view = lbView(ranked, (x) => items.get(x), h, q, now);
		const pref = mine?.pref ?? cleanPref(undefined);
		return json({
			ok: true,
			q,
			...view,
			season: { id: sid, label: seasonLabel(sid), daysLeft: seasonDaysLeft(day), startDay: seasonStartDay(sid) },
			pref: { on: pref.on, anon: pref.anon, region: pref.region, friends: pref.friends },
			titles: (mine?.titles ?? []).slice(-10).reverse().map((t) => ({ text: titleText(t), s: t.s, dim: t.dim, tier: t.tier, rank: t.rank })),
			region,
			dims: LB_DIMS.map((d) => ({ id: d.id, name: d.name, icon: d.icon, allTime: d.allTime })),
			at: now,
		});
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
			return this.lbBoard(body, id, rec.state, now, wall);
		}
		if (action === 'boardpref') {
			// 上榜同意、匿名、地区榜、好友榜四个开关。不是游戏进度：不改存档、不要版本号
			if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
			const h = (await sha256Hex(id)).slice(0, 12);
			const next = patchPref(await this.ctx.storage.get('lbp:' + h), body.pref, wall);
			if (!next) return json({ ok: false, msg: '请求无效' }, 400);
			await this.ctx.storage.put('lbp:' + h, next);
			this.lbApply(h, { pref: next });
			return json({ ok: true, msg: next.on ? (next.anon ? '已匿名上榜' : '已用昵称上榜') : '已退出排行榜', pref: { on: next.on, anon: next.anon, region: next.region, friends: next.friends }, at: now });
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
				rngKey: newRngKey(),
			});
			refreshWishes(state);
			const first = claimDaily(state, realDayOf(now));
			const created = first ? { ...first.state, rev: 0 } : state;
			// 统计：记下注册日（只存现实日序号，键是 id 哈希前缀；关了统计的玩家不记）
			const track = body.nt !== true;
			const day = realDayOf(now);
			// 排行榜：新角色记下默认的上榜设置（不上榜）：只有排行榜上线前就有的旧角色没有这条，读档时据此问一次要不要上榜
			const ch = (await sha256Hex(id)).slice(0, 12);
			const pref = { ...LB_PREF_DEFAULT, at: now };
			// 建号的现实日另记一份 'since:' + id：交易所的新号限制按它算，是玩法规则，和统计开不开无关（和存档一次写入）。
			// 不能用 'born:'：那是统计的注册日（按 id 哈希、玩家关了统计就不记），合并 main 时两边撞了前缀
			await this.persistMany([{ id, keyHash, state: created, at: now }], undefined, { ['since:' + id]: day, ['lbp:' + ch]: pref, ...(track ? { [BORN_PREFIX + ch]: day } : {}) });
			this.lbApply(ch, { pref });
			if (track) this.stats.add(day, { new: 1, active: 1, ...(first ? { 'eco.in.daily': first.cash } : {}) });
			return json({ ok: true, state: publicState(created), at: now, daily: first?.msg });
		}

		if (!rec) return json({ ok: false, msg: '云端没有这个存档' }, 404);
		// 规则用整个世界（所有区域合在一起，第 41 轮）：跨区域出行、找最近的医院、成就都不分区域
		const region = WORLD;
		const sane = sanitizeState(rec.state, new Set(region.locations.map((l) => l.id)), { fallbackLoc: region.spawn, now });
		// 存档里写的 id 必须就是这个存档的 id：不然动作会记在别人的名下（榜单哈希、送礼收件人都按 id 算）
		// v106：还没有随机数密钥的旧存档在这里补一把（之后的检定和行情都过密钥，见 core/prf.ts）。行情从今天之后才换算法，历史价格不变。
		// 补了密钥的存档和落盘的不一样，下面的 migrated 会把它写回
		const keyed = keyUp(sane);
		const current = keyed && keyed.id === id ? keyed : null;
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
		if (claim && action === 'get' && body.nt !== true) await this.track(id, realDayOf(now), {}, claim);

		if (action === 'get') {
			// 旧玩家（排行榜改成「要本人同意」之前建的角色，还没有上榜设置）：告诉页面问一次。回答（包括「暂不上榜」）后写下设置，换设备也不再问
			const lbAsk = !(await this.ctx.storage.get('lbp:' + (await sha256Hex(id)).slice(0, 12)));
			return json({ ok: true, state: publicState(live), at: now, daily: claim?.msg, ...(lbAsk ? { lbAsk: true } : {}) });
		}

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
			// 统计（玩家关了就不记）：功能使用、现金流入流出、新手漏斗、每日活跃和留存。只按结算结果记，不信客户端
			if (body.nt !== true) await this.track(id, realDayOf(now), actionCounts(act, live, r.state, r.ok), next !== current ? claim : null, r.ok && !r.collapsed ? funnelSteps(live, r.state) : []);
			return json({ ok: r.ok, msg: r.msg, state: publicState(next), at: now, daily: claim?.msg });
		}
		if (action === 'coop') return this.handleCoop(body, id, keyHash, current, live, region, now, wall, locked, raw);
		if (action === 'trade') return this.handleTrade(body, id, keyHash, current, live, region, now, wall, locked, raw);
		if (action === 'market') return this.handleMarket(body, id, keyHash, current, live, region, now, wall, raw, migrated);
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
		if (action === 'redeem') return this.handleRedeem(body, id, current, region, now);
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
		if (action === 'safety') return this.handleSafety(body, id, keyHash, current, live, now, canon, raw);
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
		const sid = seasonOfDay(realDayOf(wall));
		const lb = {
			pref: cleanPref(await this.ctx.storage.get('lbp:' + h)),
			titles: cleanTitles(await this.ctx.storage.get('lbt:' + h)),
			season: cleanSeason(await this.ctx.storage.get(`lbs:${sid}:${h}`)),
		};
		// 真实 id 是同步码的一半：导出文件可能被转给别人，只放哈希前缀（和在线状态、榜单里一样）
		const { id: _id, ...state } = carryUnknown(raw, publicState(current)) as PlayerState & Record<string, unknown>;
		return { format: 'earth-save-export', v: SAVE_VERSION, exportedAt: wall, player: h, state, notes, rank: rank ?? null, leaderboard: lb };
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
		const sid = seasonOfDay(realDayOf(Date.now()));
		await this.inMarket(async () => {
			// 交易所：他挂的东西撤下（有人出价的退给出价人）；他是最高出价的拍品清掉出价（托管的钱随账号一起删）
			const lots = await this.loadLots();
			const entries: Record<string, unknown> = {};
			const mails = new Map<string, Mail[]>();
			for (const lot of lots.values()) {
				if (lot.seller === id) {
					if (lot.bidder && lot.bid > 0 && lot.bidder !== id) {
						const box = mails.get(lot.bidder) ?? (await this.mailOf(lot.bidder));
						mails.set(lot.bidder, pushMail(box, { id: EarthWorld.hex(5), cash: lot.bid, item: null, n: 0, text: '拍卖的卖家注销了账号，退回你出的钱', at: Date.now() }));
					}
					entries['lot:' + lot.id] = { gone: true };
				} else if (lot.bidder === id) entries['lot:' + lot.id] = { ...lot, bid: 0, bidder: null, bidderHash: '' };
			}
			for (const [to, box] of mails) entries['mail:' + to] = box;
			if (Object.keys(entries).length) await this.ctx.storage.put(entries);
			for (const [k, v] of Object.entries(entries)) {
				if (!k.startsWith('lot:')) continue;
				if ((v as { gone?: boolean }).gone) lots.delete(k.slice(4));
				else lots.set(k.slice(4), v as Lot);
			}
		});
		await this.ctx.storage.delete(['save:' + id, 'ops:' + id, 'rank:' + h, 'h:' + h, 'notecd:' + h, 'mail:' + id, 'mops:' + id, 'since:' + id, 'xq:' + h, 'lbp:' + h, 'lbt:' + h, `lbs:${sid}:${h}`, `lbs:${sid - 1}:${h}`, `lbs:${sid + 1}:${h}`]);
		for (const [k, o] of this.offers) if (o.from === id || o.toId === id) this.offers.delete(k);
		for (const [k, l] of this.lobbies) {
			if (l.done) { l.done.ids = l.done.ids.filter((x) => x !== id); continue; }
			if (l.host === id) this.lobbies.delete(k);
			else l.members = l.members.filter((m) => m.id !== id);
		}
		this.lbApply(h, { remove: true });
	}

	// ---------- 共同事件 ----------
	// coop { op: 'list' }                       这个地点的大厅，和我参加过、刚结束的结果
	// coop { op: 'open', coop, role }            发起（要求现在能参加）
	// coop { op: 'join', lobby, role }           加入同一地点的大厅
	// coop { op: 'leave', lobby }                退出；发起人退出就解散
	// coop { op: 'start', lobby, rev }           发起人开始：重新检查每个成员，人够就结算并写所有人的存档
	// 大厅的过期和结果时间用服务器真实时间（wall），不用为防时钟回拨而沿用的存档时间
	/**
	 * 商户赞助的核销，分两步，都只读存档、不改存档：
	 * 1. redeem { op: 'claim', deal, lat, lon, acc }：人在店里才发核销码。同一个玩家、同一条赞助、同一个珀斯日期只有一个码，再点返回同一个。
	 *    这一步只记「领了」（当月领取数，给商户参考），不计费。
	 * 2. redeem { op: 'confirm', deal, pin }：店员在玩家手机上输入这家店的 PIN，输对才算核销一次，当天、当月核销数各加一，
	 *    对账单只按这个数收费。商户设了每日上限时，到上限就不再发码、也不再确认。
	 * PIN 由运营用对账令牌通过 /api/earth/sponsor-pin 生成，只存加盐哈希。试错：每人每条赞助每天 5 次，每条赞助每天合计 100 次，超过当天锁定。
	 */
	private async handleRedeem(body: any, id: string, state: PlayerState, region: Region, now: number): Promise<Response> {
		const dealId = typeof body.deal === 'string' ? body.deal.slice(0, 80) : '';
		const day = realDayOf(now);
		const hash = (await sha256Hex(id)).slice(0, 12);
		if (body.op === 'confirm') return this.confirmRedeem(dealId, typeof body.pin === 'string' ? body.pin : '', hash, day, region, now);
		const req = { deal: dealId, lat: Number(body.lat), lon: Number(body.lon), acc: Number(body.acc) };
		const bad = redeemProblem(state, region.venues, SPONSORS, req, now);
		if (bad) return json({ ok: false, msg: bad, at: now });
		const deal = liveDeal(SPONSORS, dealId, now)!;
		const code = redeemCode(await sha256Hex(`${deal.id}:${day}:${hash}`));
		const view = (confirmed: boolean) => this.redeemView(deal, region, code, day, confirmed);
		return this.inRedeem(async () => {
			const mine = `rd:${deal.id}:${day}:${hash}`;
			const rec = await this.ctx.storage.get<RedeemRec>(mine);
			if (rec) return json({ ok: true, dup: true, msg: rec.ok ? '今天已经核销过这张优惠。' : '今天已经领过这张优惠，给店员看同一个核销码就行。', redeem: view(!!rec.ok), at: now });
			const n = Number((await this.ctx.storage.get<number>(`rdd:${deal.id}:${day}`)) ?? 0);
			if (deal.dailyCap && n >= deal.dailyCap) return json({ ok: false, msg: '这家店今天的优惠已经发完了，明天再来。', at: now });
			const claimKey = `rdc:${deal.id}:${monthOfDay(day)}`;
			const c = Number((await this.ctx.storage.get<number>(claimKey)) ?? 0);
			await this.ctx.storage.put({ [mine]: { at: now, tries: 0 } satisfies RedeemRec, [claimKey]: c + 1 });
			return json({ ok: true, msg: '已领取，把这个页面给店员看，请店员输入店铺 PIN 确认。', redeem: view(false), at: now });
		});
	}

	private redeemView(deal: SponsorDeal, region: Region, code: string, day: number, confirmed: boolean) {
		const venue = region.venues.find((v) => v.id === deal.venueId);
		return { deal: deal.id, venue: venue?.name ?? '', offer: deal.offer, terms: deal.terms, code, day, confirmed };
	}

	/** 店员输入 PIN 确认核销。不再查定位（店员就在店里），但必须是今天领过码的人、赞助今天还生效 */
	private confirmRedeem(dealId: string, pin: string, hash: string, day: number, region: Region, now: number): Promise<Response> {
		return this.inRedeem(async () => {
			const deal = liveDeal(SPONSORS, dealId, now);
			if (!deal) return json({ ok: false, msg: '这个优惠不存在或已经过期。', at: now });
			const mine = `rd:${deal.id}:${day}:${hash}`;
			const rec = await this.ctx.storage.get<RedeemRec>(mine);
			if (!rec) return json({ ok: false, msg: '今天还没领这张优惠：先在店里点「使用优惠」。', at: now });
			const code = redeemCode(await sha256Hex(`${deal.id}:${day}:${hash}`));
			if (rec.ok) return json({ ok: true, dup: true, msg: '今天已经核销过这张优惠。', redeem: this.redeemView(deal, region, code, day, true), at: now });
			const pinRec = await this.ctx.storage.get<PinRec>(`pin:${deal.id}`);
			if (!pinRec) return json({ ok: false, msg: '这家店还没开通店员确认，请直接出示核销码。', at: now });
			const failKey = `rdf:${deal.id}:${day}`;
			const fails = Number((await this.ctx.storage.get<number>(failKey)) ?? 0);
			if (rec.tries >= PIN_TRIES_PLAYER || fails >= PIN_TRIES_DEAL) return json({ ok: false, msg: '今天输错次数太多，已锁定，明天再试。', at: now });
			if (!PIN_RE.test(pin) || !timingSafeEqual(await sha256Hex(pinRec.salt + ':' + pin), pinRec.hash)) {
				await this.ctx.storage.put({ [mine]: { ...rec, tries: rec.tries + 1 } satisfies RedeemRec, [failKey]: fails + 1 });
				const left = PIN_TRIES_PLAYER - rec.tries - 1;
				return json({ ok: false, msg: left > 0 ? `PIN 不对，还能试 ${left} 次。` : 'PIN 不对，今天已锁定。', at: now });
			}
			const dayKey = `rdd:${deal.id}:${day}`;
			const n = Number((await this.ctx.storage.get<number>(dayKey)) ?? 0);
			if (deal.dailyCap && n >= deal.dailyCap) return json({ ok: false, msg: '这家店今天的优惠已经发完了，明天再来。', at: now });
			const monthKey = `rdm:${deal.id}:${monthOfDay(day)}`;
			const m = Number((await this.ctx.storage.get<number>(monthKey)) ?? 0);
			// 三个键一次写入：要么都记上，要么都没记
			await this.ctx.storage.put({ [mine]: { ...rec, ok: now } satisfies RedeemRec, [dayKey]: n + 1, [monthKey]: m + 1 });
			return json({ ok: true, msg: '核销成功。', redeem: this.redeemView(deal, region, code, day, true), at: now });
		});
	}

	/** 核销相关的读改写排队执行：每天、每月的计数和每条赞助的试错次数是所有玩家共用的 */
	private inRedeem(fn: () => Promise<Response>): Promise<Response> {
		const run = this.redeemChain.then(fn);
		this.redeemChain = run.catch(() => undefined);
		return run;
	}

	/** 运营接口（对账单、PIN）的鉴权：没配置令牌返回 404，令牌不对返回 401，通过返回 null */
	private async sponsorAuth(request: Request): Promise<Response | null> {
		if (!this.sponsorToken) return json({ ok: false, msg: '未开放' }, 404);
		const auth = request.headers.get('Authorization') ?? '';
		const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
		if (!timingSafeEqual(await sha256Hex(given), await sha256Hex(this.sponsorToken))) return json({ ok: false, msg: '未授权' }, 401);
		return null;
	}

	/** 商户对账单 GET /api/earth/sponsor-report?month=YYYY-MM：只有计数和金额，不含玩家信息。收费只按店员确认过的核销数 */
	private async handleSponsorReport(request: Request, url: URL): Promise<Response> {
		const denied = await this.sponsorAuth(request);
		if (denied) return denied;
		if (request.method !== 'GET') return json({ ok: false, msg: '请求无效' }, 405);
		const month = url.searchParams.get('month') ?? '';
		if (!/^\d{4}-\d{2}$/.test(month)) return json({ ok: false, msg: '月份格式应为 YYYY-MM' }, 400);
		const rows = [];
		for (const d of SPONSORS) {
			const r = statementFor(d, month, Number((await this.ctx.storage.get<number>(`rdm:${d.id}:${month}`)) ?? 0));
			if (r) rows.push({ ...r, claims: Number((await this.ctx.storage.get<number>(`rdc:${d.id}:${month}`)) ?? 0), pin: !!(await this.ctx.storage.get(`pin:${d.id}`)) });
		}
		return json({ ok: true, month, currency: 'AUD', unit: 'cents', rows });
	}

	/**
	 * 生成或重置一条赞助的店员 PIN：POST /api/earth/sponsor-pin { deal }。新 PIN 只在这次返回一次，服务端只存加盐哈希；
	 * 重置后旧 PIN 立刻失效。PIN 线下交给商户，不进仓库、不进日志。
	 */
	private async handleSponsorPin(request: Request): Promise<Response> {
		const denied = await this.sponsorAuth(request);
		if (denied) return denied;
		if (request.method !== 'POST') return json({ ok: false, msg: '请求无效' }, 405);
		const text = await request.text();
		if (text.length > 1024) return json({ ok: false, msg: '请求过大' }, 413);
		let body: any;
		try {
			body = JSON.parse(text);
		} catch {
			return json({ ok: false, msg: '请求无效' }, 400);
		}
		const deal = SPONSORS.find((d) => d.id === body?.deal);
		if (!deal) return json({ ok: false, msg: '没有这条赞助' }, 404);
		const rnd = crypto.getRandomValues(new Uint32Array(1))[0];
		const pin = String(rnd % 1_000_000).padStart(6, '0');
		const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
		await this.ctx.storage.put(`pin:${deal.id}`, { salt, hash: await sha256Hex(salt + ':' + pin) } satisfies PinRec);
		return json({ ok: true, deal: deal.id, pin });
	}

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
				const st = rec ? keyUp(sanitizeState(rec.state, locs, { fallbackLoc: region.spawn, now: mNow })) : null;
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
				// 比赛类共同事件给每个成员记比赛积分（排行榜「比赛」维度），只记在服务端的赛季记录里，不改存档
				return { id: m.id, keyHash: m.keyHash, at: m.now, raw: m.raw, contest: contestPoints(def.id, r.success), state: sanitizeState(met, locs, { fallbackLoc: region.spawn, now: m.now }) ?? met };
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
	private async handleSafety(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, now: number, canon: (s: PlayerState) => PlayerState, raw: unknown): Promise<Response> {
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
			await this.persist(id, keyHash, next, now, raw);
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
		await this.persist(id, keyHash, next, now, raw);
		return json({ ok: true, msg: msg ? `${msg}${r.msg}` : r.msg, state: publicState(next), at: now });
	}

	private tradeView(id: string, hash: string, loc: string, blocked: PlayerState['blocked'] = {}) {
		const offers = [...this.offers.values()]
			.filter((o) => o.from === id || (o.loc === loc && (o.kind === 'sale' || o.to === hash) && !Object.hasOwn(blocked, o.fromHash)))
			.map((o) => ({ id: o.id, kind: o.kind, item: o.item, price: o.price, name: o.fromName, avatar: o.fromAvatar, toName: o.from === id ? o.toName : '', loc: o.loc, mine: o.from === id, taking: !!o.taking, ...(o.kind === 'swap' ? { give: o.give, want: o.want } : {}) }));
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
		if (op === 'swap') {
			// 面交换物：发给同一地点的某位玩家，对方收下时锁住双方存档再结算（见 docs/earth-game/player-trade.md）
			const give = parseSwapSide(body.give);
			const want = parseSwapSide(body.want);
			if (!give || !want) return no('交换内容无效');
			const shape = swapShapeBlocked(give, want);
			if (shape) return no(shape);
			if (live.pending) return no('先处理眼前的事件。');
			if (!give.items.every((x) => (live.inventory[x.item] ?? 0) >= x.n) || live.cash < give.cash) return no('你没有这么多东西或钱');
			if (tradesToday(live, day).out >= TRADE_DAILY) return no(`今天已经给出去 ${TRADE_DAILY} 次了，明天再来。`);
			if (swapCash(give, want) > 0) {
				const nb = newbieBlocked(live, await this.bornOf(id), day);
				if (nb) return no(nb);
				const qb = quotaBlocked(quotaOf(await this.ctx.storage.get('xq:' + hash), day), give.cash, null);
				if (qb) return no(qb);
			}
			if (mineOpen() >= OFFER_PER_PLAYER) return no(`同时最多挂 ${OFFER_PER_PLAYER} 件，先撤回一件`);
			if (typeof body.to !== 'string' || !HASH_RE.test(body.to)) return no('要和谁交换？');
			if (body.to === hash) return no('不能和自己交换');
			const target = await this.ctx.storage.get<string>('h:' + body.to);
			const trec = typeof target === 'string' ? await this.ctx.storage.get<{ state: any }>('save:' + target) : undefined;
			if (!target || !trec || trec.state?.loc !== current.loc) return no('对方不在这里，换不了');
			// 屏蔽（第 24 批，合并 main 时补上）：我屏蔽了对方，或对方屏蔽了我，都换不了；不告诉是谁屏蔽了谁
			if (isBlocked(current, body.to)) return no('你屏蔽了对方，先解除屏蔽再换');
			const tbs = trec.state?.blocked;
			if (tbs && typeof tbs === 'object' && Object.hasOwn(tbs, hash)) return no('对方现在不能和你交换');
			if ([...this.offers.values()].filter((x) => x.toId === target).length >= OFFER_PER_TARGET) return no('对方还有好几份没处理，等等再说');
			if (this.offers.size >= OFFER_MAX || [...this.offers.values()].filter((x) => x.loc === current.loc).length >= OFFER_PER_LOC) return no('现在挂单太多了，稍后再试');
			const oid = newId();
			const first = give.items[0]?.item ?? want.items[0].item;
			this.offers.set(oid, { id: oid, kind: 'swap', from: id, fromHash: hash, fromName: current.name, fromAvatar: current.avatar, to: body.to, toId: target, toName: cleanName(trec.state?.name) || '旅人', item: first, price: 0, loc: current.loc, at: wall, give, want });
			return reply({ msg: `🤝 等${cleanName(trec.state?.name) || '旅人'}回应换物` });
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
			if ((o.kind !== 'gift' && o.kind !== 'swap') || o.to !== hash) return no('这不是给你的');
			if (o.taking) return no('正在处理，稍后再试', 409);
			this.offers.delete(o.id);
			return reply({ msg: `没有收下${item.name}` });
		}
		if (op === 'accept') {
			if (o.from === id) return no('不能收下自己挂的');
			if ((o.kind === 'gift' || o.kind === 'swap') && o.toId !== id) return no('这不是给你的');
			if (o.loc !== current.loc) return no('要在同一个地点才能拿');
			if (!locked.has(o.from)) return no('正在处理，稍后再试', 409);
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), ...view(current), at: now }, 409);
			const locs = new Set(region.locations.map((x) => x.id));
			const rec = await this.ctx.storage.get<{ keyHash: string; state: any; at: number }>('save:' + o.from);
			const fNow = EarthWorld.saveNow(rec, wall);
			const fromState = rec ? keyUp(sanitizeState(rec.state, locs, { fallbackLoc: region.spawn, now: fNow })) : null;
			if (!rec || !fromState || fromState.id !== o.from) {
				this.offers.delete(o.id);
				return no('对方的存档不在了');
			}
			// 送礼和摆摊都要挂单人还在这里：人走了单子就撤下（东西一直在他背包里，没有托管）
			if (fromState.loc !== o.loc) {
				this.offers.delete(o.id);
				return no(o.kind === 'gift' ? '对方已经离开这里了' : '摊主已经走了，这个摊收了');
			}
			if (o.kind === 'swap') return this.acceptSwap(o, id, hash, keyHash, current, live, raw, rec, fromState, fNow, now, day, locs, region, view);
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
	// ---------- 交易所：寄卖（一口价）、拍卖 ----------
	// market { op: 'list' }                                  在售 / 在拍、我挂的、我的邮箱、今天的额度
	// market { op: 'sell', kind, item, price, hours, rev, nonce }  挂出：东西从背包扣走托管，扣挂单费
	// market { op: 'buy', lot, rev, nonce }                  一口价买下
	// market { op: 'bid', lot, amount, rev, nonce }          出价：钱从现金扣走托管，被超过的人退回邮箱
	// market { op: 'cancel', lot, rev, nonce }               撤回（拍卖有人出价后不能撤）
	// market { op: 'claim', rev, nonce }                     领邮箱
	// 所有改动都在 marketChain 里排队，并且持有本人的存档锁：拍品、邮箱、账本、额度、本人存档在同一次 put 里写入（全写或全不写）。
	// 到期的拍品在任何一次交易所请求开头统一结算（不需要定时器）：结算只写邮箱，不碰别人的存档。
	// nonce：客户端生成的请求编号，断网重交沿用同一个；服务端记住最近 MOPS_KEEP 个，重复到达的不再执行。
	private static hex(bytes: number): string {
		return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	private inMarket<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.marketChain.then(fn);
		this.marketChain = run.catch(() => undefined);
		return run;
	}

	/** 只在 marketChain 里调用 */
	private async loadLots(): Promise<Map<string, Lot>> {
		if (!this.lots) {
			const m = new Map<string, Lot>();
			for (const [k, v] of await this.ctx.storage.list<Lot | { gone: true }>({ prefix: 'lot:' })) {
				if (v && !('gone' in v) && typeof v.id === 'string') m.set(k.slice(4), v);
			}
			this.lots = m;
		}
		return this.lots;
	}

	/** 只在 marketChain 里调用 */
	private async mailOf(id: string): Promise<Mail[]> {
		const raw = await this.ctx.storage.get<unknown>('mail:' + id);
		return Array.isArray(raw) ? (raw as Mail[]).filter((m) => m && typeof m.id === 'string' && Number.isFinite(m.cash) && m.cash >= 0) : [];
	}

	private async bornOf(id: string): Promise<number | null> {
		const b = await this.ctx.storage.get<unknown>('since:' + id);
		return Number.isInteger(b) ? (b as number) : null;
	}

	/** 结算所有到期的拍品（只在 marketChain 里调用）：拍品作废、邮箱、账本、回收的手续费一次写入 */
	private async settleDue(wall: number, day: number): Promise<void> {
		const lots = await this.loadLots();
		const due = [...lots.values()].filter((l) => wall >= l.endsAt);
		if (!due.length) return;
		const entries: Record<string, unknown> = {};
		const boxes = new Map<string, Mail[]>();
		let sink = 0;
		for (const lot of due) {
			const r = settleLot(lot, wall, { a: EarthWorld.hex(5), b: EarthWorld.hex(5), tx: EarthWorld.hex(6) })!;
			for (const { to, mail } of r.mails) boxes.set(to, pushMail(boxes.get(to) ?? (await this.mailOf(to)), mail));
			if (r.entry) entries[`tx:${day}:${r.entry.tx}`] = r.entry;
			sink += r.fee;
			entries['lot:' + lot.id] = { gone: true };
		}
		for (const [to, box] of boxes) entries['mail:' + to] = box;
		if (sink) entries['sink:' + day] = ((await this.ctx.storage.get<number>('sink:' + day)) ?? 0) + sink;
		await this.ctx.storage.put(entries);
		for (const lot of due) lots.delete(lot.id);
		// 作废标记写成功后再删（删失败也无妨：读的时候跳过）
		try {
			void Promise.resolve(this.ctx.storage.delete(due.map((l) => 'lot:' + l.id))).catch(() => undefined);
		} catch {}
	}

	private async handleMarket(body: any, id: string, keyHash: string, current: PlayerState, live: PlayerState, region: Region, now: number, wall: number, raw: unknown, migrated: boolean): Promise<Response> {
		const hash = (await sha256Hex(id)).slice(0, 12);
		const day = realDayOf(now);
		const op = body.op;
		const locs = new Set(region.locations.map((x) => x.id));
		const canon = (st: PlayerState) => sanitizeState(st, locs, { fallbackLoc: region.spawn, now }) ?? st;
		return this.inMarket(async () => {
			await this.settleDue(wall, day);
			const lots = await this.loadLots();
			const box = await this.mailOf(id);
			const qRaw = await this.ctx.storage.get('xq:' + hash);
			const quota = quotaOf(qRaw, day);
			const born = await this.bornOf(id);
			const view = (st: PlayerState, mail: Mail[], q = quota) => {
				const all = [...lots.values()];
				// 屏蔽（第 24 批，合并 main 时补上）：我屏蔽了的人挂的东西不显示，和送礼、二手摊的列表一样
				const open = all.filter((l) => l.seller !== id && !isBlocked(st, l.sellerHash)).sort((a, b) => a.endsAt - b.endsAt).slice(0, LOTS_SHOWN);
				return {
					lots: open.map((l) => lotView(l, id)),
					mine: all.filter((l) => l.seller === id).map((l) => lotView(l, id)),
					mail: mail.map((m) => ({ id: m.id, cash: m.cash, item: m.item, n: m.n, text: m.text, at: m.at })),
					quota: { deals: q.deals, volume: q.volume, maxDeals: EXCHANGE.dailyDeals, maxVolume: EXCHANGE.dailyVolume },
					newbie: newbieBlocked(st, born, day) ?? null,
				};
			};
			const no = (msg: string, status = 400) => json({ ok: false, msg, ...view(live, box), at: now }, status);
			if (op === 'list') return json({ ok: true, ...view(live, box), at: now });
			if (!['sell', 'buy', 'bid', 'cancel', 'claim'].includes(op)) return no('请求无效');

			// 防重放：同一请求编号只执行一次（结果和存档同一次写入）
			const nonce = typeof body.nonce === 'string' && OP_RE.test(body.nonce) ? body.nonce : null;
			if (!nonce) return no('请求编号无效');
			const mopsRaw = await this.ctx.storage.get<unknown>('mops:' + id);
			const mops: OpDone[] = Array.isArray(mopsRaw) ? mopsRaw.filter((o): o is OpDone => !!o && typeof o === 'object' && typeof o.op === 'string' && typeof o.ok === 'boolean' && typeof o.msg === 'string').slice(-MOPS_KEEP) : [];
			const seen = mops.find((o) => o.op === nonce);
			if (seen) return json({ ok: seen.ok, msg: seen.msg, dup: true, state: publicState(current), ...view(current, box), at: now });
			if (body.rev !== current.rev) return json({ ok: false, conflict: true, msg: CONFLICT_MSG, state: publicState(current), ...view(current, box), at: now }, 409);
			const done = (ok: boolean, msg: string) => ({ ['mops:' + id]: [...mops, { op: nonce, ok, msg }].slice(-MOPS_KEEP) });
			/** 规则拒绝：记下编号（重交得到同样的答复），校验时修过的存档顺带写回 */
			const refuse = async (msg: string, status = 400) => {
				if (migrated) await this.persistMany([{ id, keyHash, state: current, at: now, raw }], undefined, done(false, msg));
				else await this.ctx.storage.put(done(false, msg));
				return no(msg, status);
			};
			/** 成交：本人存档、拍品、邮箱、额度、账本、回收的手续费一次写入；写成功后才改内存里的拍品 */
			const commit = async (st: PlayerState, msg: string, extra: Record<string, unknown>, lotSet: [string, Lot | null][], mail: Mail[]) => {
				const next = canon(st);
				await this.persistMany([{ id, keyHash, state: next, at: now, raw }], undefined, { ...extra, ...done(true, msg) });
				for (const [k, l] of lotSet) {
					if (l) lots.set(k, l);
					else lots.delete(k);
				}
				return json({ ok: true, msg, state: publicState(next), ...view(next, mail, quotaOf(extra['xq:' + hash] ?? qRaw, day)), at: now });
			};
			const sinkAdd = async (fee: number) => (fee ? { ['sink:' + day]: ((await this.ctx.storage.get<number>('sink:' + day)) ?? 0) + fee } : {});

			if (op === 'claim') {
				const r = claimMail(live, box);
				if (typeof r === 'string') return refuse(r);
				return commit(r.state, `📬 领到${r.cash ? ` $${r.cash}` : ''}${r.cash && r.items ? ' 和' : ''}${r.items ? ` ${r.items} 件东西` : ''}`, { ['mail:' + id]: r.left }, [], r.left);
			}
			const nb = newbieBlocked(live, born, day);
			if (nb && op !== 'cancel') return refuse(nb, 403);

			if (op === 'sell') {
				const kind = body.kind === 'auction' ? 'auction' : body.kind === 'fixed' ? 'fixed' : null;
				if (!kind) return refuse('请求无效');
				if (lots.size >= LOTS_MAX) return refuse('交易所现在挂满了，稍后再试', 429);
				const qb = quotaBlocked(quota, 0, null);
				if (qb) return refuse(qb, 429);
				const lotId = EarthWorld.hex(6);
				const mineN = [...lots.values()].filter((l) => l.seller === id).length;
				const r = createLot(live, { kind, item: String(body.item ?? ''), price: body.price, hours: Number(body.hours) }, { lotId, hash, now: wall, openLots: mineN });
				if (typeof r === 'string') return refuse(r);
				const q = quotaAdd(quota, 0, null);
				return commit(r.state, kind === 'fixed' ? '挂到交易所了' : '送去拍卖了', { ['lot:' + lotId]: r.lot, ['xq:' + hash]: q, ...(await sinkAdd(r.fee)) }, [[lotId, r.lot]], box);
			}

			const lot = typeof body.lot === 'string' && LOT_RE.test(body.lot) ? lots.get(body.lot) : undefined;
			if (!lot) return refuse('这件已经卖掉、拍完或撤回了', 404);

			if (op === 'cancel') {
				const r = cancelLot(live, lot, { now: wall, mailId: EarthWorld.hex(5) });
				if (typeof r === 'string') return refuse(r);
				const next = r.mail ? pushMail(box, r.mail) : box;
				return commit(r.state, '已撤回', { ['lot:' + lot.id]: { gone: true }, ...(r.mail ? { ['mail:' + id]: next } : {}) }, [[lot.id, null]], next);
			}
			// 屏蔽：我屏蔽了卖家，或卖家屏蔽了我，都买不了、拍不了（不告诉是谁屏蔽了谁，同送礼）
			if (op === 'buy' || op === 'bid') {
				if (isBlocked(live, lot.sellerHash)) return refuse('你屏蔽了对方，先解除屏蔽再买');
				const srec = await this.ctx.storage.get<{ state: any }>('save:' + lot.seller);
				const sb = srec?.state?.blocked;
				if (sb && typeof sb === 'object' && Object.hasOwn(sb, hash)) return refuse('对方现在不接受你的出价');
			}
			if (op === 'buy') {
				const qb = quotaBlocked(quota, lot.price, lot.sellerHash);
				if (qb) return refuse(qb, 429);
				const tx = EarthWorld.hex(6);
				const r = buyLot(live, lot, { now: wall, mailId: EarthWorld.hex(5), tx, buyerHash: hash });
				if (typeof r === 'string') return refuse(r);
				const sellerBox = pushMail(await this.mailOf(lot.seller), r.mail);
				return commit(r.buyer, `花 $${lot.price} 买下了`, {
					['lot:' + lot.id]: { gone: true }, ['mail:' + lot.seller]: sellerBox, ['xq:' + hash]: quotaAdd(quota, lot.price, lot.sellerHash),
					[`tx:${day}:${tx}`]: r.entry, ...(await sinkAdd(r.fee)),
				}, [[lot.id, null]], box);
			}
			if (op === 'bid') {
				const amount = body.amount;
				// 额度按这次新付出的钱算（自己加价只算差额）
				const extraCash = Number.isInteger(amount) ? amount - (lot.bidder === id ? lot.bid : 0) : 0;
				const qb = quotaBlocked(quota, extraCash, lot.sellerHash, lot.id);
				if (qb) return refuse(qb, 429);
				const r = bidLot(live, lot, amount, { now: wall, mailId: EarthWorld.hex(5), bidderHash: hash });
				if (typeof r === 'string') return refuse(r);
				const extra: Record<string, unknown> = { ['lot:' + lot.id]: r.lot, ['xq:' + hash]: quotaAdd(quota, extraCash, lot.sellerHash, lot.id) };
				if (r.refund) extra['mail:' + r.refund.to] = pushMail(await this.mailOf(r.refund.to), r.refund.mail);
				return commit(r.bidder, `出价 $${amount}，钱先由交易所保管`, extra, [[lot.id, r.lot]], box);
			}
			return no('请求无效');
		});
	}

	/** 面交换物的接单（handleTrade 里已经锁住双方存档、核对过地点和版本号） */
	private async acceptSwap(o: Offer, id: string, hash: string, keyHash: string, current: PlayerState, live: PlayerState, raw: unknown, rec: { keyHash: string; state: any; at: number }, fromState: PlayerState, fNow: number, now: number, day: number, locs: Set<string>, region: Region, view: (st: PlayerState) => ReturnType<EarthWorld['tradeView']>): Promise<Response> {
		const no = (msg: string, status = 400) => json({ ok: false, msg, ...view(current), at: now }, status);
		const give = o.give!;
		const want = o.want!;
		const cash = swapCash(give, want);
		const fromHash = (await sha256Hex(o.from)).slice(0, 12);
		let qa = quotaOf(await this.ctx.storage.get('xq:' + fromHash), day);
		let qb = quotaOf(await this.ctx.storage.get('xq:' + hash), day);
		if (cash > 0) {
			// 带钱的面交：双方都要过新号限制和每日额度（同一对玩家每天的笔数也算）
			const na = newbieBlocked(fromState, await this.bornOf(o.from), day);
			if (na) return no('对方还不能做带钱的交易：' + na, 403);
			const nb = newbieBlocked(live, await this.bornOf(id), day);
			if (nb) return no(nb, 403);
			const ba = quotaBlocked(qa, give.cash, hash);
			if (ba) return no('对方' + ba, 429);
			const bb = quotaBlocked(qb, want.cash, fromHash);
			if (bb) return no(bb, 429);
			qa = quotaAdd(qa, give.cash, hash);
			qb = quotaAdd(qb, want.cash, fromHash);
		}
		const tx = EarthWorld.hex(6);
		const r = resolveSwap(fromState, live, give, want, { now, day, tx, aHash: fromHash, bHash: hash });
		if (typeof r === 'string') {
			if (r.startsWith('发起人')) this.offers.delete(o.id);
			return no(r);
		}
		const canon = (st: PlayerState, t: number) => sanitizeState(st, locs, { fallbackLoc: region.spawn, now: t }) ?? st;
		const met = (st: PlayerState, p: { hash: string; name: string; avatar: string }) => noteMet(st, [p], day);
		const mine = canon(met(r.b, { hash: fromHash, name: o.fromName, avatar: o.fromAvatar }), now);
		const theirs = canon(met(r.a, { hash, name: current.name, avatar: current.avatar }), fNow);
		// 双方存档、额度、账本、回收的手续费一次写入（和交易所共用账本，所以排进 marketChain）
		await this.inMarket(async () => {
			const extra: Record<string, unknown> = {};
			if (cash > 0) {
				extra['xq:' + fromHash] = qa;
				extra['xq:' + hash] = qb;
				extra[`tx:${day}:${tx}`] = r.entry;
			}
			if (r.fee) extra['sink:' + day] = ((await this.ctx.storage.get<number>('sink:' + day)) ?? 0) + r.fee;
			await this.persistMany([
				{ id: o.from, keyHash: rec.keyHash, state: theirs, at: fNow, raw: rec.state },
				{ id, keyHash, state: mine, at: now, raw },
			], undefined, extra);
		});
		this.offers.delete(o.id);
		return json({ ok: true, msg: `🤝 和${o.fromName}换好了`, state: publicState(mine), ...view(mine), at: now });
	}
}

/** Worker 入口路由：命中 /api/earth/* 返回 Response，否则返回 null 交给 Astro */
export function routeEarth(request: Request, env: any): Promise<Response> | null {
	const url = new URL(request.url);
	if (url.pathname === '/api/earth/stats') {
		return env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(STATS_ROOM)).fetch(request);
	}
	if (url.pathname === '/api/earth/stats/read') return readStats(request, env);
	if (url.pathname === '/api/earth/save' || url.pathname === '/api/earth/sponsor-report' || url.pathname === '/api/earth/sponsor-pin') {
		return env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(SAVES_ROOM)).fetch(request);
	}
	if (url.pathname === '/api/earth/ws') {
		const region = (url.searchParams.get('region') || 'wa').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'wa';
		// 先向存档实例查这个 id 有没有存档，结果写进 known 再转给区域实例（客户端自己带的 known 被覆盖）。
		// 查不到或查询出错都按没有存档算：只能旁观，不能聊天（见 EarthWorld.fetch）
		return (async () => {
			const id = url.searchParams.get('id') || '';
			let known = false;
			if (ID_RE.test(id)) {
				try {
					const res = await env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(SAVES_ROOM)).fetch(new Request('https://internal' + KNOWN_PATH + '?id=' + encodeURIComponent(id)));
					known = ((await res.json()) as any)?.known === true;
				} catch {}
			}
			url.searchParams.set('known', known ? '1' : '0');
			return env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(region)).fetch(new Request(url.toString(), request));
		})();
	}
	return null;
}

/**
 * 查询统计汇总：GET /api/earth/stats/read?from=<现实日>&to=<现实日>，带 Authorization: Bearer <EARTH_STATS_TOKEN>。
 * 令牌是 Worker 的 secret（不是付费服务）；没配置或不对一律 404，不暴露接口存在。
 * 合并存档实例（服务端结算的计数）和统计实例（客户端上报的计数）。
 */
async function readStats(request: Request, env: any): Promise<Response> {
	const token = typeof env?.EARTH_STATS_TOKEN === 'string' ? env.EARTH_STATS_TOKEN : '';
	const auth = request.headers.get('Authorization') || '';
	if (request.method !== 'GET' || token.length < 32 || !timingSafeEqual(auth, 'Bearer ' + token)) return json({ ok: false }, 404);
	const q = new URL(request.url).search;
	const parts: Record<string, Counts>[] = [];
	for (const room of [SAVES_ROOM, STATS_ROOM]) {
		const res = await env.EARTH_WORLD.get(env.EARTH_WORLD.idFromName(room)).fetch(new Request('https://internal/api/earth/stats/read' + q));
		const data = (await res.json()) as any;
		if (!data?.ok) return json(data, res.status);
		parts.push(data.days);
	}
	return json({ ok: true, days: mergeDays(...parts) });
}
