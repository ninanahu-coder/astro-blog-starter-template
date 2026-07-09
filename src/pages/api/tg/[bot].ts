// 盈扬 YNG LAB · Telegram 投资人演示 bot 网关
// 三个演示 bot 共用此 webhook：/api/tg/anlan | /api/tg/analyst | /api/tg/leadgen
// 全部内容为脚本化演示（零 LLM 成本、演示零翻车），每个演示对应 BP 中一条收入线。
// 配置见 docs/telegram-demo-bots.md
export const prerender = false;

import type { APIRoute } from "astro";

type BotKey = "anlan" | "analyst" | "leadgen" | "property";

const BOTS: Record<BotKey, { tokenVar: string; title: string }> = {
	anlan: { tokenVar: "TG_TOKEN_ANLAN", title: "安澜 · 私人助手（演示）" },
	analyst: { tokenVar: "TG_TOKEN_ANALYST", title: "盈扬 · 市场分析（演示）" },
	leadgen: { tokenVar: "TG_TOKEN_LEADGEN", title: "盈扬 · 获客工厂（演示）" },
	property: { tokenVar: "TG_TOKEN_PROPERTY", title: "安宅 · 澳洲房产研究（演示）" },
};

const DISCLAIMER =
	"<i>⚠️ 演示数据，非实时行情，不构成投资建议。</i>";

function kb(rows: [string, string][][]) {
	return {
		inline_keyboard: rows.map((r) =>
			r.map(([text, data]) => ({ text, callback_data: data })),
		),
	};
}

const MENUS: Record<BotKey, ReturnType<typeof kb>> = {
	analyst: kb([
		[["📊 早盘简报", "brief"], ["🏦 议息传导演示", "fed"]],
		[["⚡ 行情警报演示", "alert"], ["₿ 链上监控演示", "whale"]],
		[["💼 了解盈扬 YNG LAB", "about"]],
	]),
	anlan: kb([
		[["🗓 今日安排", "day"], ["🔎 研究委托演示", "research"]],
		[["📄 合同摘要演示", "doc"], ["🔐 隐私三承诺", "privacy"]],
		[["💼 了解盈扬 YNG LAB", "about"]],
	]),
	leadgen: kb([
		[["🚗 车行·一键建站", "car"], ["⌚ 表行获客方案", "watch"]],
		[["🐾 宠物行业方案", "pet"], ["🧮 ROI 快算", "roi"]],
		[["💼 了解盈扬 YNG LAB", "about"]],
	]),
	property: kb([
		[["🏘 Suburb 速查演示", "suburb"], ["🧮 负扣税快算演示", "gearing"]],
		[["🔨 拍卖周报样例", "auction"], ["🏦 贷款结构三分钟", "loan"]],
		[["💼 了解盈扬 YNG LAB", "about"]],
	]),
};

const WELCOME: Record<BotKey, string> = {
	analyst:
		"👋 您好，我是<b>盈扬市场分析</b>（投资人演示版）。\n\n" +
		"正式版每天为订阅客户做三件事：<b>盘前把世界讲清楚、盘中把异动盯住、大事发生时把传导链讲透</b>。\n\n" +
		"点击下方按钮，60 秒体验产品形态 👇\n\n" + DISCLAIMER,
	anlan:
		"👋 您好，我是<b>安澜</b>——盈扬的私人助手（投资人演示版）。\n\n" +
		"正式版是一位<b>全年无休、只为您一人工作、数据只存您自己保险柜</b>的随身参谋。\n\n" +
		"点击下方按钮体验 👇\n\n" + DISCLAIMER,
	leadgen:
		"👋 您好，这里是<b>盈扬获客工厂</b>（投资人演示版）。\n\n" +
		"我们把「建站获客」做成流水线：<b>一句话生成整站、每件商品自己吃搜索流量、询盘 24 小时不漏接</b>。\n\n" +
		"点击下方按钮，看一个网站当场诞生 👇",
	property:
		"👋 您好，我是<b>安宅</b>——盈扬的澳洲房产投资研究助手（投资人演示版）。\n\n" +
		"正式版帮华语投资人<b>看懂</b>澳洲房产：Suburb 数据画像、负扣税与现金流测算、每周拍卖简报、英文报告中文解读。\n\n" +
		"点击下方按钮体验 👇\n\n" +
		"<i>⚠️ 演示数据；正式版每个数字标注来源与日期。不构成财务、信贷或税务建议。</i>",
};

function demoContent(bot: BotKey, action: string, origin: string): string | null {
	const C: Record<string, Record<string, string>> = {
		analyst: {
			brief:
				"📊 <b>早盘简报 · 演示样例</b>\n" +
				"──────────────\n" +
				"🌏 <b>隔夜市场</b>\n· 美股三大指数涨跌互现，费城半导体指数 +1.8%（存储板块续强）\n· 美元指数 103.2（+0.3%），金价承压\n· BTC 62,300（-1.1%），资金费率转负\n\n" +
				"🇦🇺 <b>今日关注</b>\n· ASX 开盘前：矿业股受铁矿石期货 +2.1% 提振\n· 14:30 中国 CPI 数据（对澳元敏感）\n\n" +
				"🎯 <b>三件今天真正重要的事</b>\n1. 存储超级周期：SK Hynix 财报超预期的产业链传导\n2. 美债收益率逼近关键位，成长股承压信号\n3. 澳元兑人民币波段触及三个月高位\n\n" + DISCLAIMER,
			fed:
				"🏦 <b>议息事件传导 · 演示样例</b>\n──────────────\n" +
				"<b>事件</b>：美联储维持利率不变，点阵图转鹰\n\n" +
				"<b>传导链</b>：\n美元指数短线走强 ⟶ 非美货币与黄金承压 ⟶ 高贝塔风险资产（成长股 / BTC）流动性预期收紧 ⟶ 关注两日内美债收益率确认信号\n\n" +
				"<b>历史对照</b>：与 2024-09 情景相似度 78%（当时美元 5 日 +1.2%，BTC 一周 -6%）\n\n" +
				"正式版：事件发生后 <b>3 分钟内</b>推送，附数据出处。\n\n" + DISCLAIMER,
			alert:
				"⚡ <b>行情警报 · 演示样例</b>\n──────────────\n" +
				"🔴 <b>[警报]</b> BTC 永续资金费率 0.12%/8h，突破您设置的阈值 0.10%\n\n" +
				"<b>背景</b>：过去 24h 全网多单杠杆快速累积，历史上该水平后 48h 内出现 3% 以上回撤的概率为 64%（样本 n=41）\n\n" +
				"<b>您的监控还包括</b>：巨鲸地址异动 · 稳定币增发 · 交易所净流入\n\n" +
				"正式版 7×24 值守，一条不漏。\n\n" + DISCLAIMER,
			whale:
				"₿ <b>链上监控 · 演示样例</b>\n──────────────\n" +
				"🐋 <b>[巨鲸异动]</b> 标记地址 bc1q...x7f2 向交易所转入 1,200 BTC（约 $74.8M）\n· 该地址历史行为：前 3 次转入后 7 日均价 -4.2%\n· 同时段稳定币增发：+$210M（承接力量增强）\n\n" +
				"<b>综合判读</b>：短期抛压信号与承接信号并存，关注 61,800 支撑位。\n\n" + DISCLAIMER,
		},
		anlan: {
			day:
				"🗓 <b>今日安排 · 演示样例</b>\n──────────────\n" +
				"上午\n· 09:00 已为您整理 3 封重要邮件的摘要与建议回复\n· 10:30 与会计师通话（R&amp;D 退税材料已备好，要点已列）\n\n下午\n· 14:00 提醒：车行客户的月度获客报告已生成，待您过目\n· 16:00 您关注的两只股票财报发布，安澜将自动出解读\n\n晚间\n· BTC 警报值守中；明早 7:30 送早盘简报\n\n<i>正式版：日程、邮件、提醒全部在这个对话框完成。</i>",
			research:
				"🔎 <b>研究委托 · 演示样例</b>\n──────────────\n" +
				"您说：「帮我调研 Perth 二手车市场」\n\n<b>安澜 · 45 分钟后交付</b>：\n" +
				"· 市场规模：WA 年二手车交易约 XX 万台，Perth 占七成\n· 渠道结构：平台挂车为主，车行自有线上渠道普遍缺位——<b>获客空档明确</b>\n· 价格带：$15k–35k 为流转最快区间\n· 竞对动作：仅 2/10 抽样车行有独立官网，无一有单车 SEO 页\n· 附：12 家目标车行清单与联系方式（公开信息）\n\n<i>演示版隐去具体数字；正式版每条结论附来源链接。</i>",
			doc:
				"📄 <b>合同摘要 · 演示样例</b>\n──────────────\n" +
				"您上传了一份 38 页供应商合同，安澜 6 分钟后返回：\n\n" +
				"🔴 <b>高风险条款 ×2</b>\n· 第 12.3 条：单方涨价权（建议加入 30 天通知 + 封顶条款）\n· 第 18 条：争议管辖在对方所在州（建议改仲裁）\n\n🟡 <b>需注意 ×3</b>：付款周期 / 独家条款范围 / 自动续约\n\n🟢 其余 31 项条款与行业惯例一致\n\n<i>敏感文件走本地推理，阅后可即焚。</i>",
			privacy:
				"🔐 <b>隐私三承诺</b>\n──────────────\n" +
				"1️⃣ <b>隐私</b>：您的资料存在我们自建的加密数据库，不进任何第三方云端 SaaS，不用于外部模型训练\n\n2️⃣ <b>私密</b>：按客户物理隔离；敏感任务由本地模型处理，可「阅后即焚」\n\n3️⃣ <b>稳定</b>：不受第三方平台改价、限流、停服影响\n\n顶配选项：<b>私有化部署</b>——整套系统进您自己的环境，数据不出您的门。\n\n<i>「您的数据存在谁的服务器上」——我们希望这是您问每家 AI 公司的第一个问题。</i>",
		},
		leadgen: {
			car:
				"🚗 <b>车行 · 一键建站演示</b>\n──────────────\n" +
				"收到需求：「Perth 二手车行，主营日系家用车」\n\n" +
				"⚙️ 生成中……\n✓ 站点框架与品牌配色\n✓ 每台在售车辆独立 SEO 页（示例：「2019 Mazda CX-5 Perth 二手」）\n✓ 24 小时询价表单 + Telegram 线索直达\n✓ 部署到边缘网络\n\n" +
				`✅ <b>网站已生成</b>（真实可点）：\n${origin}/demo-caryard/\n\n` +
				"<i>从需求到上线 &lt;1 小时（实测）；本演示站即由同一条流水线产出。</i>",
			watch:
				"⌚ <b>表行获客方案 · 演示</b>\n──────────────\n" +
				"名表买卖的获客闭环：\n" +
				"1. <b>每款表一页</b>：吃走「Perth 二手 Submariner 行情」这类高意向搜索\n2. <b>行情参考价</b>：公开参考价先建立信任，询价率翻倍的关键\n3. <b>询价即留资</b>：报价机器人即时响应，每条询价进客户库\n4. <b>一鱼两吃</b>：名表客户 = 私人助手服务的天然高净值客群\n\n" +
				"<b>12 个月示例目标</b>：曝光 ×5+ · 询价翻倍 · 销售额 ×2\n\n<i>需要演示站？回复「表行演示」，48 小时内生成。</i>",
			pet:
				"🐾 <b>宠物行业方案 · 演示</b>\n──────────────\n" +
				"这是我们自己在运营的行业（实盘）：\n" +
				"· 中文宠物垂直站运行中，内容无人值守日更\n· 正在复制<b>澳洲英文版</b>——澳洲约七成家庭养宠，年支出超 A$330 亿（AMA 2022）\n· 长期布局：宠物<b>智能硬件</b>（喂食器 / AI 摄像头）——内容站就是未来硬件的销售渠道\n\n" +
				"<i>给宠物店 / 宠物品牌的获客包与车行同构：建站 + 内容 + 询盘直达。</i>",
			roi:
				"🧮 <b>ROI 快算 · 演示</b>\n──────────────\n" +
				"以月销售额 <b>A$100k</b> 的车行为例：\n\n" +
				"线上曝光 ×5 ⟶ 有效询盘 ×3 ⟶ 按现有成交率折算\n" +
				"📈 销售额目标：A$100k → <b>A$150k–200k / 月</b>\n💰 年增量：<b>A$600k–1.2M</b>\n💸 获客系统投入：项目费 + 月费，约为年增量的 <b>零头</b>\n\n" +
				"<i>示例测算（非承诺）：上线后按实际曝光、询盘、成交数据按月校准——账算得过来，续费才可持续。</i>",
		},
	};
	(C as any).property = {
		suburb:
			"🏘 <b>Suburb 速查 · 演示样例（Willetton WA 6155）</b>\n──────────────\n" +
			"中位房价（house）：A$92 万（12 个月 +6.8%）\n租金中位：$680/周 · 毛回报 3.8%\n空置率：0.6%（供不应求区间）\n去化天数：11 天（热区信号）\n学区：Willetton SHS——WA 公立前列，学区溢价明显\n一句话画像：家庭自住盘为主、租售两旺，适合稳健型持有\n\n" +
			"<i>演示数据；正式版逐项标注 REIWA / CoreLogic 来源与日期。不构成财务建议。</i>",
		gearing:
			"🧮 <b>负扣税快算 · 演示样例</b>\n──────────────\n" +
			"输入：购入 A$75 万 · 首付 20% · 利率 6.1% · 周租 $650 · 边际税率 37%\n\n" +
			"年租金收入（扣 2% 空置）：A$33.1k\n贷款利息（IO 口径）：A$36.6k\n持有成本（估）：A$7.5k\n税前缺口：−A$11.0k\n负扣税退税：+A$4.1k\n<b>税后真实现金流：≈ −$133/周</b>\n\n" +
			"利率 +1% 情景：≈ −$217/周\n\n<i>演示口径（WA 印花税另计）；正式版按您的真实参数逐项计算。不构成税务建议，细节请咨询注册会计师。</i>",
		auction:
			"🔨 <b>珀斯拍卖周报 · 演示样例</b>\n──────────────\n" +
			"上周清空率：71%（前周 68%，连续三周走强）\n成交中位价：A$81.2 万\n挂牌量：环比 −4%（供给收紧）\n热度前三：Willetton（学区）· Baldivis（首置刚需）· Scarborough（海滨翻新盘）\n本周值得注意：银行固定利率下调 15bp，观望盘或入场\n\n" +
			"<i>演示数据；正式版每周一 8:00 自动推送，数据来自公开拍卖结果。</i>",
		loan:
			"🏦 <b>贷款结构三分钟 · 演示</b>\n──────────────\n" +
			"· <b>IO vs P&amp;I</b>：只息还款现金流压力小、利息全额可抵扣；本息同还建立净值——投资房常用前者，自住房常用后者\n" +
			"· <b>Offset 账户</b>：存款直接抵减计息本金，灵活性优于提前还款\n" +
			"· <b>LVR 与 LMI</b>：首付低于两成要付贷款保险，通常得不偿失\n\n" +
			"<i>常识性介绍，非信贷建议；具体方案请咨询持牌 broker。</i>",
	};
	const about =
		"💼 <b>盈扬工作室 YNG LAB</b>\n──────────────\n" +
		"立足西澳 Perth（UTC+8）· 100+ 天实盘验证\n" +
		"一套 AI 员工编队：<b>获客 · 分析 · 私人助手 · 内容</b>\n\n" +
		`📑 投资人企划书（50 页精华版）：\n${origin}/pitch-deck-50/\n\n` +
		"📞 联系：AY · 0405 098 765\n\n<i>本 bot 为投资人演示版；正式产品按订阅开通。</i>";
	if (action === "about") return about;
	return C[bot]?.[action] ?? null;
}

async function tg(token: string, method: string, payload: unknown) {
	return fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
}

export const GET: APIRoute = async ({ params, locals }) => {
	const bot = params.bot as BotKey;
	if (!BOTS[bot]) return new Response("unknown bot", { status: 404 });
	const env = (locals as any)?.runtime?.env ?? {};
	return Response.json({
		ok: true,
		bot,
		title: BOTS[bot].title,
		token_configured: Boolean(env[BOTS[bot].tokenVar]),
	});
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	const bot = params.bot as BotKey;
	const cfg = BOTS[bot];
	if (!cfg) return new Response("unknown bot", { status: 404 });

	const env = (locals as any)?.runtime?.env ?? {};
	const reqUrl = new URL(request.url);
	// token 优先取 Cloudflare Secret；否则取 setWebhook 时嵌在 URL 里的 ?tk= 参数
	const token = env[cfg.tokenVar] || reqUrl.searchParams.get("tk");
	if (!token) return new Response("bot not configured", { status: 503 });

	// 可选的 webhook 秘钥校验
	const secret = env.TG_WEBHOOK_SECRET;
	if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
		return new Response("forbidden", { status: 403 });
	}

	const origin = reqUrl.origin;
	let update: any;
	try {
		update = await request.json();
	} catch {
		return new Response("bad request", { status: 400 });
	}

	try {
		if (update.callback_query) {
			const q = update.callback_query;
			const chatId = q.message?.chat?.id;
			const text = demoContent(bot, q.data, origin);
			await tg(token, "answerCallbackQuery", { callback_query_id: q.id });
			if (chatId && text) {
				await tg(token, "sendMessage", {
					chat_id: chatId,
					text,
					parse_mode: "HTML",
					disable_web_page_preview: false,
					reply_markup: kb([[["⬅️ 返回菜单", "menu"]]]),
				});
			}
			if (chatId && q.data === "menu") {
				await tg(token, "sendMessage", {
					chat_id: chatId,
					text: WELCOME[bot],
					parse_mode: "HTML",
					reply_markup: MENUS[bot],
				});
			}
		} else if (update.message) {
			const m = update.message;
			const chatId = m.chat?.id;
			if (!chatId) return new Response("ok");
			// 任何消息（含 /start）都回欢迎菜单；演示版不做自由对话
			const isStart = typeof m.text === "string" && m.text.startsWith("/start");
			const prefix = isStart
				? ""
				: "演示版暂不支持自由对话（正式版支持）。请用下方按钮体验 👇\n\n";
			await tg(token, "sendMessage", {
				chat_id: chatId,
				text: isStart ? WELCOME[bot] : prefix + WELCOME[bot],
				parse_mode: "HTML",
				reply_markup: MENUS[bot],
			});
		}
	} catch {
		// 演示 bot：任何异常都静默吞掉，永远给 Telegram 返回 200 防止重试风暴
	}
	return new Response("ok");
};
