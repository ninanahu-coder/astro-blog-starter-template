# AGENTS.md

本仓库是 Astro + Cloudflare Workers 站点。`/earth` 是在线人生模拟游戏「地球人生」，说明见 `docs/earth-game/README.md`。

## 常用命令

- `npm test` —— 游戏引擎与数据测试（Node ≥ 22.18，原生跑 TypeScript）
- `npm run check` —— 构建 + `tsc` + `wrangler deploy --dry-run`
- `npm run preview` —— 本地带 Durable Object 运行
- `npm run earth:pois -- --dry-run` —— 校验 POI 数据

## 代码约定

- `src/game/core/` 必须保持纯函数：不引用 DOM、`fetch`、`Date.now()`、`Math.random()`（随机数只能来自 `state.seed`）。
- 相对导入写完整的 `.ts` 扩展名（Node 直接执行测试需要）。
- 新玩法内容优先加数据（`src/game/data/`），不要在引擎里写针对某个地点或事件的特例。
- 界面文案用简体中文。

## Review guidelines

审查 PR 时重点看下面这些，按严重程度排序：

1. **不可信输入**：任何来自网络、`localStorage`、URL 参数、WebSocket 的数据，在使用或落盘前必须经过 `sanitizeState()` 或等价校验；插入 HTML 的字符串必须经过 `esc()`。
2. **凭证**：同步码的 `key`、玩家真实 `id` 不得出现在广播消息、日志或 URL 里（WebSocket 握手的 `id` 参数除外，广播时只用其哈希）。仓库里不得出现任何密钥、令牌、内网地址。
3. **Durable Object**：新增或改名 DO 类必须同步 `wrangler.json` 的 migrations 和 `astro.config.mjs` 的 `namedExports`；消息处理要有大小上限和限流。
4. **规则引擎**：动作函数不得修改入参；数值必须钳制在合法范围；有 `pending` 事件时不允许出行或互动；改动要有对应测试。
5. **数据文件**：`wa.pois.json` 的条目必须有 `source`，来源只能是 OSM / Wikidata / seed；不接受抓取自商业地图或点评网站的数据。事件和互动文案不得使用现有游戏的专有名称、角色或台词。
6. **素材**：`public/earth/cgi/` 里的图片必须能在 `manifest.json` 中找到对应项；单张不超过 1 MB。
7. 不要因为纯格式问题或个人风格偏好提意见。
