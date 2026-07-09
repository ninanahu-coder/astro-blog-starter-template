# 盈扬 YNG LAB · 投资人演示 Telegram Bot 配置指南

三个演示 bot 共用一套已部署的 webhook 代码（`src/pages/api/tg/[bot].ts`），
按钮演示脚本化（零翻车），**自由对话已开通（正式版）**：默认走 Cloudflare Workers AI
（llama-3.3-70b，免 key、免费额度内零成本）；在 Cloudflare 配置 `ANTHROPIC_API_KEY` Secret 后
自动升级为 Claude（可选 `ANTHROPIC_MODEL` 覆盖默认 haiku）。每个 bot 有独立人格与合规规则，
均声明无法联网、不报实时行情。

| bot | webhook 路径 | 对应收入线 | 演示亮点 |
|---|---|---|---|
| 安澜 · 私人助手 | `/api/tg/anlan` | 高端线（私人助手/私有化） | 研究委托、合同摘要、隐私三承诺 |
| 盈扬 · 市场分析 | `/api/tg/analyst` | 订阅线（股市/加密/宏观） | 早盘简报、议息传导、行情警报 |
| 盈扬 · 获客工厂 | `/api/tg/leadgen` | 项目线（建站获客） | 一键建站（真实交付演示车行网站）、ROI 快算 |
| 安宅 · 房产研究（**正式版**，非演示） | `/api/tg/property` | 分析线（房产垂直） | Suburb 速查（自动附 realestate.com.au 深链）、找房画像（REA 式关键词查询）、负扣税快算、市场周报、贷款内推（Broker Jeff 0449 999 922） |

## 一次性配置（约 15 分钟）

### 第 1 步 · 在 BotFather 创建三个 bot

Telegram 搜索 `@BotFather` → `/newbot`，依次创建（用户名被占用就加后缀）：

1. 名称 `安澜 · 盈扬私人助手（演示）`，用户名建议 `YngAnlanBot`
2. 名称 `盈扬市场分析（演示）`，用户名建议 `YngAnalystBot`
3. 名称 `盈扬获客工厂（演示）`，用户名建议 `YngLeadgenBot`

每个创建完成后 BotFather 会给一个 **token**（形如 `1234567:ABC-DEF...`），记下来。

可选优化：`/setdescription` 填一句简介；`/setuserpic` 上传 logo（企划书封面的金色圆环柱状图标截图即可）。

> **免后台快捷方式**：不想进 Cloudflare 后台的话，可以把 token 直接嵌进 webhook URL：
> `setWebhook?url=https://<HOST>/api/tg/<bot>%3Ftk%3D<TOKEN 且冒号编码为 %3A>`
> 网关会优先读 Cloudflare Secret，读不到时使用 URL 里的 `tk` 参数。

### 第 2 步 · 在 Cloudflare 配置 token

Cloudflare Dashboard → Workers & Pages → `astro-blog-starter-template` →
Settings → Variables and Secrets → 添加三个 **Secret**：

- `TG_TOKEN_ANLAN` = 安澜的 token
- `TG_TOKEN_ANALYST` = 市场分析的 token
- `TG_TOKEN_LEADGEN` = 获客工厂的 token
- `TG_TOKEN_PROPERTY` = 安宅的 token
- `DOMAIN_API_KEY` = Domain 官方房源 API key（安宅「找房画像」实时房源查询用）——
  developer.domain.com.au 免费注册 → 建 Project → 拿 API Key（免费档即可）。
  说明：realestate.com.au **无公开 API**（其数据接口 PropTrack 仅签商业协议），
  所以实时房源用 Domain 官方 API；REA 深链自动附在结果里供交叉核对。未配置此 key 时找房功能退化为纯链接模式。
- （可选）`TG_WEBHOOK_SECRET` = 随便一串长随机字符，防伪造请求

保存后 Redeploy 一次使其生效。

### 第 3 步 · 把 bot 指向 webhook

把 `<HOST>` 换成站点域名（当前为
`claude-investor-pitch-ai-agent-a4eb-astro-blog-starter-template.ninanahu.workers.dev`），
`<TOKEN>` 换成对应 bot 的 token，逐个执行：

```bash
curl "https://api.telegram.org/bot<TOKEN_ANLAN>/setWebhook?url=https://<HOST>/api/tg/anlan"
curl "https://api.telegram.org/bot<TOKEN_ANALYST>/setWebhook?url=https://<HOST>/api/tg/analyst"
curl "https://api.telegram.org/bot<TOKEN_LEADGEN>/setWebhook?url=https://<HOST>/api/tg/leadgen"
```

（若设置了 `TG_WEBHOOK_SECRET`，每个 URL 追加 `&secret_token=<那串随机字符>`。）

返回 `{"ok":true,...}` 即成功。

### 第 4 步 · 验证

- 浏览器打开 `https://<HOST>/api/tg/anlan` 应返回 `{"ok":true,...,"token_configured":true}`
- Telegram 里给每个 bot 发 `/start`，应出现欢迎语与按钮菜单

## 给投资人演示的 30 秒话术（每个 bot）

- **市场分析**：「您平时看盘吗？加这个 bot，点『议息传导』——正式版在美联储决议后 3 分钟就把这条传导链推给订阅客户。」
- **获客工厂**：「点『车行·一键建站』——您现在点开的这个车行网站，就是这条流水线不到 1 小时的产出。」
- **安澜**：「点『研究委托』——想象把您想调研的任何事丢给它；再点『隐私三承诺』，这是我们跟所有云端产品的区别。」

## 注意事项

- 演示 bot 不接大模型、不做自由对话（用户随便输入会被引导回按钮菜单）——这是刻意设计：演示永不翻车、成本为零。
- 换自有域名后需重新执行第 3 步的 setWebhook。
- token 一旦泄露，在 BotFather 用 `/revoke` 重置并更新 Cloudflare Secret。
