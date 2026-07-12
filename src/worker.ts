// 百家乐多人游戏服务器 — Cloudflare Durable Object 权威牌桌。
// 每个房间一个 DO 实例：统一倒计时开局、发牌、结算；余额服务端持久化。
// 虚拟筹码，仅供娱乐，无任何真实货币。
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';

// ---------- 规则常量（与单机版一致） ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DECKS = 8;
const CUT_CARD = 30;
const START_BALANCE = 10000;
const TOPUP_AMOUNT = 10000;
const MAX_BET_PER_ROUND = 1000000;

const BET_MS = 15000; // 下注倒计时
const DEAL_STEP_MS = 700; // 每张牌动画间隔
const DEAL_EXTRA_MS = 1600; // 发完牌到开奖的停顿
const RESULT_MS = 6000; // 结果展示时长
const ROAD_LIMIT = 120;
const MAX_CONNS = 50; // 单房间连接上限
const MSG_WINDOW_MS = 5000; // 消息限流窗口
const MSG_LIMIT = 25; // 窗口内消息上限
const IDLE_TIMEOUT_MS = 70000; // 心跳超时（客户端每 20s ping 一次）

// ---------- 账号系统常量 ----------
// 账号数据存放在 BaccaratTable 的一个保留实例（idFromName('@ACCOUNTS')）里，
// 不新增 DO 类以避免 migration。房间名净化只允许 [A-Z0-9]，'@ACCOUNTS' 含 '@' 永不与真实房间冲突。
const ACCOUNTS_ROOM = '@ACCOUNTS';
const AUTH_BODY_MAX = 2048; // auth 请求体上限（字节/字符）
const AUTH_WINDOW_MS = 5 * 60 * 1000; // 限流窗口
const AUTH_LIMIT = 12; // 窗口内每 IP 上限（register/login）
const PBKDF2_ITER = 100000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // token 30 天有效
const USERNAME_RE = /^[A-Za-z0-9_一-龥-]{2,16}$/;

type AccountRec = { u: string; salt: string; hash: string; avatar: string; created: number };
type TokenRec = { u: string; exp: number };

function toHex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(hex.length >> 1);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}
function authJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
}

const SPOTS = ['ppair', 'player', 'tie', 'banker', 'bpair'] as const;
type Spot = (typeof SPOTS)[number];
type Bets = Record<Spot, number>;
type Card = { rank: string; suit: string; v: number };
type Phase = 'idle' | 'bet' | 'deal' | 'settle';
type RoadEntry = { r: 'B' | 'P' | 'T'; pp: boolean; bp: boolean };

interface PlayerInfo {
	name: string;
	avatar: string;
	balance: number;
	conns: number;
}

function emptyBets(): Bets {
	return { ppair: 0, player: 0, tie: 0, banker: 0, bpair: 0 };
}
function betTotal(b: Bets) {
	return b.ppair + b.player + b.tie + b.banker + b.bpair;
}
function handTotal(hand: Card[]) {
	return hand.reduce((s, c) => s + c.v, 0) % 10;
}

export class BaccaratTable {
	private ctx: DurableObjectState;
	private env: any;
	private authRate = new Map<string, { n: number; resetAt: number }>(); // ip -> 限流窗口（仅 @ACCOUNTS 实例使用）
	private sockets = new Map<WebSocket, string>(); // ws -> playerId
	private players = new Map<string, PlayerInfo>();
	private bets = new Map<string, Bets>();
	private chatLast = new Map<string, number>();
	private lastSeen = new Map<WebSocket, number>();
	private msgCount = new Map<WebSocket, { n: number; resetAt: number }>();
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private phaseDur = 0;

	private shoe: Card[] = [];
	private shoeNo = 0;
	private road: RoadEntry[] = [];
	private phase: Phase = 'idle';
	private endsAt = 0;
	private round = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastDeal: {
		p: Card[];
		b: Card[];
		pt: number;
		bt: number;
		outcome: 'P' | 'B' | 'T';
		ppair: boolean;
		bpair: boolean;
	} | null = null;

	constructor(ctx: DurableObjectState, env: unknown) {
		this.ctx = ctx;
		this.env = env;
		// DO 若在一局中途被回收（如重新部署），内存中的注码会丢失但余额已扣；
		// 重启时把持久化的未结算注码退回玩家余额。
		this.ctx.blockConcurrencyWhile(async () => {
			const pending = await this.ctx.storage.get<Record<string, number>>('pending');
			if (!pending) return;
			for (const [pid, staked] of Object.entries(pending)) {
				if (!Number.isFinite(staked) || staked <= 0) continue;
				const bal = (await this.ctx.storage.get<number>('bal:' + pid)) ?? 0;
				await this.ctx.storage.put('bal:' + pid, bal + staked);
			}
			await this.ctx.storage.delete('pending');
		});
	}

	private persistPending() {
		const pending: Record<string, number> = {};
		for (const [pid, b] of this.bets) {
			const total = betTotal(b);
			if (total > 0) pending[pid] = total;
		}
		if (Object.keys(pending).length === 0) void this.ctx.storage.delete('pending');
		else void this.ctx.storage.put('pending', pending);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// 账号接口：只有 '@ACCOUNTS' 保留实例会被路由到该路径，此实例只做账号、不跑游戏循环
		if (url.pathname === '/api/baccarat/auth') return this.handleAuth(request);
		if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
			return new Response('expected websocket', { status: 426 });
		}
		let playerId = (url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
		let name = (url.searchParams.get('name') || '').replace(/[<>&"'\s]/g, '').slice(0, 8);
		let avatar = (url.searchParams.get('avatar') || '').replace(/[<>&"']/g, '').slice(0, 4) || '🙂';
		const token = url.searchParams.get('token') || '';
		if (token) {
			// 注册用户：向 @ACCOUNTS 实例校验 token 后以账号身份入桌。
			// 本实例自身是 '@ACCOUNTS' 时不会走到这里（auth 路径在上面已提前 return）。
			let verified: any = null;
			try {
				const stub = this.env.BACCARAT_TABLE.get(this.env.BACCARAT_TABLE.idFromName(ACCOUNTS_ROOM));
				const res = await stub.fetch('https://internal/api/baccarat/auth', {
					method: 'POST',
					body: JSON.stringify({ action: 'verify', token }),
					headers: { 'Content-Type': 'application/json' },
				});
				verified = await res.json();
			} catch {}
			if (!verified || verified.ok !== true || typeof verified.username !== 'string') {
				return new Response('invalid token', { status: 401 });
			}
			const uname: string = verified.username;
			playerId = ('u-' + uname.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-')).slice(0, 32);
			name = uname.replace(/[<>&"'\s]/g, '').slice(0, 8);
			avatar = String(verified.avatar || '').replace(/[<>&"']/g, '').slice(0, 4) || '🙂';
		} else if (playerId.startsWith('u-')) {
			// 游客不得占用注册用户的 'u-' pid 前缀（否则可冒领账号在本房间的余额）
			playerId = ('g' + playerId).slice(0, 32);
		}
		if (!playerId) return new Response('missing id', { status: 400 });
		if (!name) name = '玩家' + playerId.slice(-4);
		if (this.sockets.size >= MAX_CONNS) return new Response('room full', { status: 503 });

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();
		await this.addPlayer(server, playerId, name, avatar);
		server.addEventListener('message', (e) => {
			try {
				this.onMessage(server, String((e as MessageEvent).data));
			} catch {}
		});
		const drop = () => this.onClose(server);
		server.addEventListener('close', drop);
		server.addEventListener('error', drop);
		return new Response(null, { status: 101, webSocket: client } as ResponseInit);
	}

	// ---------- 账号系统（仅 '@ACCOUNTS' 保留实例承载，storage 键：acct:<user小写> / tok:<token>） ----------
	private async handleAuth(request: Request): Promise<Response> {
		if (request.method !== 'POST') return authJson({ ok: false, msg: '请求无效' }, 405);
		const cl = Number(request.headers.get('Content-Length') || '0');
		if (cl > AUTH_BODY_MAX) return authJson({ ok: false, msg: '请求无效' }, 413);
		let body: any = null;
		try {
			const text = await request.text();
			if (text.length > AUTH_BODY_MAX) return authJson({ ok: false, msg: '请求无效' }, 413);
			body = JSON.parse(text);
		} catch {
			body = null;
		}
		if (!body || typeof body !== 'object') return authJson({ ok: false, msg: '请求无效' }, 400);

		if (body.action === 'verify') return this.authVerify(body);

		// register / login 走密码流程：每 IP 限流防爆破。
		// verify 不限流：房间 DO 的内部校验不带 CF-Connecting-IP（会共用 'unknown' 桶把入桌打挂），
		// 且 token 为 256bit 随机值，无爆破风险。
		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		const now = Date.now();
		if (this.authRate.size > 500) {
			for (const [k, v] of this.authRate) if (now > v.resetAt) this.authRate.delete(k);
		}
		let rl = this.authRate.get(ip);
		if (!rl || now > rl.resetAt) {
			rl = { n: 0, resetAt: now + AUTH_WINDOW_MS };
			this.authRate.set(ip, rl);
		}
		if (++rl.n > AUTH_LIMIT) return authJson({ ok: false, msg: '尝试太频繁，请稍后再试' }, 429);

		const username = typeof body.username === 'string' ? body.username.trim() : '';
		const password = typeof body.password === 'string' ? body.password : '';
		if (!USERNAME_RE.test(username) || password.length < 6 || password.length > 64) {
			return authJson({ ok: false, msg: '用户名或密码格式不合法' });
		}
		const acctKey = 'acct:' + username.toLowerCase();

		if (body.action === 'register') {
			if (await this.ctx.storage.get(acctKey)) return authJson({ ok: false, msg: '用户名已被注册' });
			const salt = crypto.getRandomValues(new Uint8Array(16));
			const hash = await this.pbkdf2Hex(password, salt);
			const avatar =
				(typeof body.avatar === 'string' ? body.avatar : '').replace(/[<>&"']/g, '').slice(0, 4) || '🙂';
			const acct: AccountRec = { u: username, salt: toHex(salt), hash, avatar, created: Date.now() };
			// PBKDF2 的 await 期间可能插入并发请求，落库前复查占用（storage 读写受 DO 输入门保护）
			if (await this.ctx.storage.get(acctKey)) return authJson({ ok: false, msg: '用户名已被注册' });
			await this.ctx.storage.put(acctKey, acct);
			return this.issueToken(acct);
		}

		if (body.action === 'login') {
			const acct = await this.ctx.storage.get<AccountRec>(acctKey);
			if (!acct) {
				// 用户不存在也做一次同代价散列，避免时间侧信道枚举用户名
				await this.pbkdf2Hex(password, crypto.getRandomValues(new Uint8Array(16)));
				return authJson({ ok: false, msg: '用户名或密码错误' });
			}
			const hash = await this.pbkdf2Hex(password, fromHex(acct.salt));
			if (hash !== acct.hash) return authJson({ ok: false, msg: '用户名或密码错误' });
			return this.issueToken(acct);
		}

		return authJson({ ok: false, msg: '请求无效' }, 400);
	}

	private async authVerify(body: any): Promise<Response> {
		const token = typeof body.token === 'string' ? body.token : '';
		if (!/^[0-9a-f]{64}$/.test(token)) return authJson({ ok: false });
		const rec = await this.ctx.storage.get<TokenRec>('tok:' + token);
		if (!rec) return authJson({ ok: false });
		if (Date.now() > rec.exp) {
			await this.ctx.storage.delete('tok:' + token);
			return authJson({ ok: false });
		}
		const acct = await this.ctx.storage.get<AccountRec>('acct:' + rec.u);
		if (!acct) return authJson({ ok: false });
		return authJson({ ok: true, username: acct.u, avatar: acct.avatar });
	}

	private async issueToken(acct: AccountRec): Promise<Response> {
		const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
		const rec: TokenRec = { u: acct.u.toLowerCase(), exp: Date.now() + TOKEN_TTL_MS };
		await this.ctx.storage.put('tok:' + token, rec);
		return authJson({ ok: true, token, username: acct.u, avatar: acct.avatar });
	}

	private async pbkdf2Hex(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
		const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
			'deriveBits',
		]);
		const bits = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
			key,
			256,
		);
		return toHex(new Uint8Array(bits));
	}

	// ---------- 玩家 ----------
	private async addPlayer(ws: WebSocket, playerId: string, name: string, avatar: string) {
		let info = this.players.get(playerId);
		if (!info) {
			let balance = await this.ctx.storage.get<number>('bal:' + playerId);
			if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) {
				balance = START_BALANCE;
				await this.ctx.storage.put('bal:' + playerId, balance);
			}
			info = { name, avatar, balance, conns: 0 };
			this.players.set(playerId, info);
		}
		info.name = name;
		info.avatar = avatar;
		info.conns++;
		this.sockets.set(ws, playerId);
		this.lastSeen.set(ws, Date.now());
		if (!this.sweeper) {
			// 半开连接清扫：客户端每 20s ping，超时未见任何消息则强制断开
			this.sweeper = setInterval(() => {
				const now = Date.now();
				for (const [sock, seen] of this.lastSeen) {
					if (now - seen > IDLE_TIMEOUT_MS) {
						try {
							sock.close(1001, 'idle');
						} catch {}
						this.onClose(sock);
					}
				}
			}, 30000);
		}

		this.ensureLoop();
		this.send(ws, {
			t: 'welcome',
			you: { id: playerId, name: info.name, balance: info.balance, bets: this.bets.get(playerId) || emptyBets() },
			phase: this.phase,
			endsAt: this.endsAt,
			now: Date.now(),
			dur: this.phaseDur,
			round: this.round,
			players: this.playerList(),
			totals: this.totals(),
			road: this.road,
			shoeLeft: this.shoe.length,
			shoeNo: this.shoeNo,
			deal: this.phase === 'deal' || this.phase === 'settle' ? this.lastDeal : null,
		});
		this.broadcast({ t: 'players', players: this.playerList() }, ws);
	}

	private onClose(ws: WebSocket) {
		const pid = this.sockets.get(ws);
		if (pid === undefined) return;
		this.sockets.delete(ws);
		this.lastSeen.delete(ws);
		this.msgCount.delete(ws);
		if (this.sockets.size === 0 && this.sweeper) {
			clearInterval(this.sweeper);
			this.sweeper = null;
		}
		const info = this.players.get(pid);
		if (info) {
			info.conns = Math.max(0, info.conns - 1);
			// 无未结算注码的离线玩家直接移除；有注码的留到结算后清理
			if (info.conns === 0 && betTotal(this.bets.get(pid) || emptyBets()) === 0) {
				this.players.delete(pid);
				this.chatLast.delete(pid);
			}
		}
		this.broadcast({ t: 'players', players: this.playerList() });
		if (this.sockets.size === 0 && this.phase === 'bet' && this.betsEmpty()) {
			// 空桌且无注码：停摆等待下个玩家
			this.clearTimer();
			this.phase = 'idle';
			this.endsAt = 0;
		}
	}

	private playerList() {
		const list: { id: string; name: string; avatar: string; balance: number; online: boolean; betting: boolean }[] =
			[];
		for (const [pid, info] of this.players) {
			list.push({
				id: pid.slice(-6),
				name: info.name,
				avatar: info.avatar,
				balance: info.balance,
				online: info.conns > 0,
				betting: betTotal(this.bets.get(pid) || emptyBets()) > 0,
			});
			if (list.length >= 40) break;
		}
		return list;
	}

	private totals(): Bets {
		const t = emptyBets();
		for (const b of this.bets.values()) for (const s of SPOTS) t[s] += b[s];
		return t;
	}
	private betsEmpty() {
		for (const b of this.bets.values()) if (betTotal(b) > 0) return false;
		return true;
	}

	// ---------- 消息 ----------
	private onMessage(ws: WebSocket, raw: string) {
		if (raw.length > 500) return;
		this.lastSeen.set(ws, Date.now());
		// 消息限流：窗口内超限直接丢弃
		const now = Date.now();
		let mc = this.msgCount.get(ws);
		if (!mc || now > mc.resetAt) {
			mc = { n: 0, resetAt: now + MSG_WINDOW_MS };
			this.msgCount.set(ws, mc);
		}
		if (++mc.n > MSG_LIMIT) return;
		let msg: any;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		const pid = this.sockets.get(ws);
		if (!pid) return;
		const info = this.players.get(pid);
		if (!info) return;
		this.ensureLoop();

		switch (msg.t) {
			case 'ping':
				this.send(ws, { t: 'pong', now: Date.now() });
				break;
			case 'bet': {
				if (this.phase !== 'bet') return this.send(ws, { t: 'err', msg: '当前不可下注' });
				const spot = msg.spot as Spot;
				const amt = msg.amt;
				if (!SPOTS.includes(spot)) return;
				if (!Number.isInteger(amt) || amt <= 0 || amt > MAX_BET_PER_ROUND) return;
				if (amt > info.balance) return this.send(ws, { t: 'err', msg: '余额不足' });
				const b = this.bets.get(pid) || emptyBets();
				if (betTotal(b) + amt > MAX_BET_PER_ROUND) return this.send(ws, { t: 'err', msg: '超出单局限额' });
				info.balance -= amt;
				b[spot] += amt;
				this.bets.set(pid, b);
				void this.ctx.storage.put('bal:' + pid, info.balance);
				this.persistPending();
				this.sendYou(pid);
				this.broadcast({ t: 'bets', totals: this.totals(), players: this.playerList() });
				break;
			}
			case 'clear': {
				if (this.phase !== 'bet') return;
				const b = this.bets.get(pid);
				if (!b || betTotal(b) === 0) return;
				info.balance += betTotal(b);
				this.bets.delete(pid);
				void this.ctx.storage.put('bal:' + pid, info.balance);
				this.persistPending();
				this.sendYou(pid);
				this.broadcast({ t: 'bets', totals: this.totals(), players: this.playerList() });
				break;
			}
			case 'topup': {
				const pending = betTotal(this.bets.get(pid) || emptyBets());
				if (info.balance > 0 || pending > 0) return this.send(ws, { t: 'err', msg: '余额为 0 时才能补充' });
				info.balance = TOPUP_AMOUNT;
				void this.ctx.storage.put('bal:' + pid, info.balance);
				this.sendYou(pid);
				this.broadcast({ t: 'players', players: this.playerList() });
				break;
			}
			case 'chat': {
				const now = Date.now();
				if (now - (this.chatLast.get(pid) || 0) < 1500) return;
				const text = String(msg.text || '')
					.replace(/[<>&]/g, '')
					.trim()
					.slice(0, 60);
				if (!text) return;
				this.chatLast.set(pid, now);
				this.broadcast({ t: 'chat', name: info.name, avatar: info.avatar, text });
				break;
			}
		}
	}

	// ---------- 游戏循环 ----------
	private clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
	private schedule(fn: () => void, ms: number) {
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			try {
				fn();
			} catch {}
		}, ms);
	}

	/** 看门狗：加入/消息时确保循环在跑（DO 若被回收过则恢复） */
	private ensureLoop() {
		if (this.phase === 'idle') {
			if (this.sockets.size > 0) this.startBet();
			return;
		}
		if (this.timer === null) {
			// 定时器丢失，按当前阶段立刻恢复推进
			const overdue = Math.max(0, this.endsAt - Date.now());
			if (this.phase === 'bet') this.schedule(() => this.onBetEnd(), overdue);
			else if (this.phase === 'deal') this.schedule(() => this.settle(), overdue);
			else this.schedule(() => this.nextRound(), overdue);
		}
	}

	private newShoe() {
		this.shoe = [];
		for (let d = 0; d < DECKS; d++) {
			for (const suit of SUITS) {
				for (let i = 0; i < RANKS.length; i++) {
					this.shoe.push({ rank: RANKS[i], suit, v: i + 1 <= 9 ? i + 1 : 0 });
				}
			}
		}
		for (let i = this.shoe.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
		}
		this.shoeNo++;
		this.road = [];
	}
	private draw(): Card {
		return this.shoe.pop()!;
	}

	private startBet() {
		let shoeChanged = false;
		if (this.shoe.length < CUT_CARD) {
			this.newShoe();
			shoeChanged = true;
		}
		this.phase = 'bet';
		this.round++;
		this.bets.clear();
		this.lastDeal = null;
		this.phaseDur = BET_MS;
		this.endsAt = Date.now() + BET_MS;
		this.broadcast({
			t: 'phase',
			phase: 'bet',
			endsAt: this.endsAt,
			now: Date.now(),
			dur: this.phaseDur,
			round: this.round,
			shoeLeft: this.shoe.length,
			shoeNo: this.shoeNo,
			totals: emptyBets(),
			players: this.playerList(),
			...(shoeChanged ? { road: this.road } : {}),
		});
		this.schedule(() => this.onBetEnd(), BET_MS);
	}

	private onBetEnd() {
		if (this.betsEmpty()) {
			if (this.sockets.size === 0) {
				this.phase = 'idle';
				this.endsAt = 0;
				return;
			}
			return this.startBet(); // 无人下注，重新倒计时
		}
		this.runDeal();
	}

	private runDeal() {
		const p: Card[] = [];
		const b: Card[] = [];
		p.push(this.draw());
		b.push(this.draw());
		p.push(this.draw());
		b.push(this.draw());

		const pt0 = handTotal(p);
		const bt0 = handTotal(b);
		if (pt0 < 8 && bt0 < 8) {
			let p3: Card | null = null;
			if (pt0 <= 5) {
				p3 = this.draw();
				p.push(p3);
			}
			const bt = handTotal(b);
			let drawB: boolean;
			if (!p3) {
				drawB = bt <= 5;
			} else {
				const v = p3.v;
				drawB =
					bt <= 2 ||
					(bt === 3 && v !== 8) ||
					(bt === 4 && v >= 2 && v <= 7) ||
					(bt === 5 && v >= 4 && v <= 7) ||
					(bt === 6 && (v === 6 || v === 7));
			}
			if (drawB) b.push(this.draw());
		}

		const pt = handTotal(p);
		const bt = handTotal(b);
		const outcome: 'P' | 'B' | 'T' = pt > bt ? 'P' : bt > pt ? 'B' : 'T';
		const ppair = p[0].rank === p[1].rank;
		const bpair = b[0].rank === b[1].rank;
		this.lastDeal = { p, b, pt, bt, outcome, ppair, bpair };

		const animMs = (p.length + b.length) * DEAL_STEP_MS + DEAL_EXTRA_MS;
		this.phase = 'deal';
		this.phaseDur = animMs;
		this.endsAt = Date.now() + animMs;
		this.broadcast({
			t: 'deal',
			p,
			b,
			stepMs: DEAL_STEP_MS,
			endsAt: this.endsAt,
			now: Date.now(),
			shoeLeft: this.shoe.length,
		});
		this.schedule(() => this.settle(), animMs);
	}

	private settle() {
		const deal = this.lastDeal;
		if (!deal) return this.nextRound();
		const { outcome, ppair, bpair, pt, bt } = deal;

		this.road.push({ r: outcome, pp: ppair, bp: bpair });
		if (this.road.length > ROAD_LIMIT) this.road.shift();

		const nets: Record<string, number> = {};
		for (const [pid, bet] of this.bets) {
			let returned = 0;
			if (outcome === 'P') returned += bet.player * 2;
			if (outcome === 'B') returned += bet.banker + Math.floor(bet.banker * 0.95);
			if (outcome === 'T') returned += bet.tie * 9 + bet.player + bet.banker;
			if (ppair) returned += bet.ppair * 12;
			if (bpair) returned += bet.bpair * 12;
			nets[pid] = returned - betTotal(bet);
			const info = this.players.get(pid);
			if (info && returned > 0) {
				info.balance += returned;
				void this.ctx.storage.put('bal:' + pid, info.balance);
			}
		}

		this.phase = 'settle';
		this.phaseDur = RESULT_MS;
		this.endsAt = Date.now() + RESULT_MS;
		// 净输赢按完整 pid 私发（未下注者不带 net 字段），广播只带公开信息
		for (const [ws, pid] of this.sockets) {
			this.send(ws, { t: 'you', balance: this.players.get(pid)?.balance ?? 0, bets: emptyBets(), net: nets[pid] });
		}
		this.broadcast({
			t: 'result',
			outcome,
			pt,
			bt,
			ppair,
			bpair,
			endsAt: this.endsAt,
			now: Date.now(),
			road: this.road,
			players: this.playerList(),
			shoeLeft: this.shoe.length,
			shoeNo: this.shoeNo,
		});

		// 清理已离线玩家（注码已结算完毕）
		this.bets.clear();
		void this.ctx.storage.delete('pending');
		for (const [pid, info] of this.players) {
			if (info.conns === 0) {
				this.players.delete(pid);
				this.chatLast.delete(pid);
			}
		}
		this.schedule(() => this.nextRound(), RESULT_MS);
	}

	private nextRound() {
		if (this.sockets.size === 0) {
			this.phase = 'idle';
			this.endsAt = 0;
			return;
		}
		this.startBet();
	}

	// ---------- 发送 ----------
	private send(ws: WebSocket, data: unknown) {
		try {
			ws.send(JSON.stringify(data));
		} catch {}
	}
	/** 私发给同一玩家的所有连接（多标签页保持同步） */
	private sendYou(pid: string, extra: Record<string, unknown> = {}) {
		const info = this.players.get(pid);
		if (!info) return;
		const raw = JSON.stringify({
			t: 'you',
			balance: info.balance,
			bets: this.bets.get(pid) || emptyBets(),
			...extra,
		});
		for (const [ws, id] of this.sockets) {
			if (id !== pid) continue;
			try {
				ws.send(raw);
			} catch {}
		}
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
}

// ---------- Worker 入口 ----------
export function createExports(manifest: SSRManifest) {
	const app = new App(manifest);
	return {
		default: {
			async fetch(request: Request, env: any, ctx: any): Promise<Response> {
				const url = new URL(request.url);
				if (url.pathname === '/api/baccarat/auth') {
					// 账号系统复用 BaccaratTable 的 '@ACCOUNTS' 保留实例（不新增 DO 类，免 migration）。
					// 方法校验在 handleAuth 内完成（非 POST 返回 JSON 405）。
					const id = env.BACCARAT_TABLE.idFromName(ACCOUNTS_ROOM);
					return env.BACCARAT_TABLE.get(id).fetch(request);
				}
				if (url.pathname === '/api/baccarat/ws') {
					const room =
						(url.searchParams.get('room') || 'LOBBY')
							.toUpperCase()
							.replace(/[^A-Z0-9]/g, '')
							.slice(0, 8) || 'LOBBY';
					const id = env.BACCARAT_TABLE.idFromName(room);
					return env.BACCARAT_TABLE.get(id).fetch(request);
				}
				return handle(manifest, app, request as any, env, ctx);
			},
		},
		BaccaratTable,
	};
}
