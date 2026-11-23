# 数据统计与埋点（第 39 批，第一版）

> 范围：「地球人生」线上统计。离线数值平衡仍用 `npm run earth:sim`（`docs/earth-game/balance.md`），两者不混用。
> 代码：`src/game/server/stats.ts`（计数与缓冲）、`src/game/server/world.ts`（挂接点、上报与查询接口）、`src/game/ui/telemetry.ts`（客户端）、`src/pages/earth.astro`（埋点调用、设置开关、告知）。
> 测试：`tests/earth/analytics.test.ts`；变异检查：`python3 tools/earth/analytics/mutate.py`。

## 0. 现状（做之前）

- 仓库里**没有任何埋点或统计**。`src/` 下没有 `console.*` 日志、没有 `track`/`analytics` 调用。
- 唯一和「观测」沾边的是 `wrangler.json` 的 `"observability": { "enabled": true }`：Cloudflare Workers Logs 会记录请求级别的日志（URL、状态码、耗时）。存档请求走 POST body，同步码不在 URL 里；但在线频道 WebSocket 握手 URL 带着 `id`、`name`（AGENTS.md 允许的例外），**这部分会进 Workers Logs**。见第 6 节「遗留风险」。
- 服务端有两类可复用的「天然去重点」：每日奖励 `claimDaily()`（每个存档每个现实日只触发一次）和权威结算（每个动作在 `@SAVES` 实例里由 `applyAction()` 结算）。第一版的留存、漏斗、经济全部挂在这两处，不信客户端。

## 1. 要回答的问题

| 问题 | 指标 | 怎么算 | 数据来源 |
| --- | --- | --- | --- |
| 留存 | 次日留存、7 日留存（以及 1–30 任意天） | 注册日 C 的 `ret.k ÷ new`，k = 1、7 | 服务端：建角色时记注册日，之后每个现实日第一次上线（领每日奖励那一刻）记一次 |
| 新手漏斗 | 创建角色 → 第一次出行 → 第一次打工 → 第一次真实打卡 | 注册日 C 的 `new`、`fn.travel`、`fn.work`、`fn.real` | 服务端：比较结算前后的存档（`funnelSteps()`） |
| 活跃 | 日活 | 当天的 `active` | 服务端：每日奖励触发次数 |
| 各功能使用率 | 每种动作的次数、失败率；各页面被多少会话打开过 | `use.*`、`fail.*`；`c.tab.*` ÷ `c.session` | 动作：服务端；页面：客户端上报 |
| 经济流水（平衡用） | 每类动作的现金投放（流入）和回收（流出） | `eco.in.<类型>`、`eco.out.<类型>` 合计 | 服务端：结算前后现金差 |
| 报错 | JS 异常、未处理的 Promise、断网、接口 5xx、WebSocket 出错 | `c.err.*` ÷ `c.session` | 客户端上报（每种每会话最多 3 次） |
| 性能 | 首屏加载、接口耗时分布 | `c.perf.load.<档>`、`c.perf.api.<档>`，×4 还原抽样 | 客户端上报（25% 会话抽样，分 5 档） |

做不到的（第一版刻意不做）：单个玩家的行为路径、会话时长、按出身/特质细分。要做就得存逐人事件，违背第 3 节的最少化原则；真有需要时另行评估。

## 2. 事件清单

### 2.1 服务端结算产生的计数（`@SAVES` 实例）

全部是「某个现实日」汇总里的一个计数键，现实日按珀斯时间（UTC+8）切分，日序号 = `realDayOf()`（例：2026-11-20 是 20777）。

| 计数键 | 含义 | 触发点 | 记在哪天 |
| --- | --- | --- | --- |
| `new` | 新建角色 | `create` 成功落盘后 | 当天 |
| `active` | 活跃（今天第一次来） | `create`；`get` 领到每日奖励并落盘；`act` 领到每日奖励并落盘 | 当天 |
| `ret.<k>` | 注册后第 k 天来过（k = 1…30） | 同上（领每日奖励那次） | **注册日** |
| `fn.travel` | 第一次去到出生点以外的地点 | `act` 成功、结算前只到过 1 个地点、结算后更多 | **注册日** |
| `fn.work` | 第一次算了一个班次（打工或真实打卡下班） | `act` 成功、`workDay` 从 −1 变成别的 | **注册日** |
| `fn.real` | 第一次真实打卡（到场定位成功的 POI 打卡或真实地点动作） | `act` 成功、`checkins` 和 `venueCd` 从全空变成有 | **注册日** |
| `use.<功能>` | 动作成功次数；功能 = 类型或「类型.子操作」，如 `use.job.work`、`use.venue.meal`、`use.npc.gift` | `act` 结算成功 | 当天 |
| `fail.<类型>` | 被规则拒绝的次数 | `act` 结算失败 | 当天 |
| `eco.in.<类型>` / `eco.out.<类型>` | 这次动作让现金多了 / 少了多少（合计，澳元） | `act` 结算成功 | 当天 |
| `eco.in.daily` | 每日奖励发出的现金 | 领每日奖励 | 当天 |

不计入的：动作编号重复（`dup`）、版本冲突（409）、格式不对（400）。晕倒送医（`collapsed`）只记 `use`/`eco`，不推进漏斗。
第一版没覆盖的现金流：共同事件奖励（`handleCoop`）、玩家之间交易（`handleTrade`，转移不是投放）、全服周目标领奖（`weekly claim`）。平衡分析时要知道这几处缺口，下一版补。

### 2.2 客户端上报的事件（`@STATS` 实例）

接口 `POST /api/earth/stats`，请求体 `{ "v": 1, "ev": [[名字, 参数?, 毫秒?], …] }`，每批最多 30 条、4 KB。服务端换成计数键 `c.<名字>[.<参数>][.<耗时档>]`。

| 事件 | 参数（白名单） | 触发点（`earth.astro`） | 去重 / 抽样 |
| --- | --- | --- | --- |
| `session` | 无 | 页面脚本启动 | 每次打开页面一次 |
| `tab` | `place` `near` `go` `grow` `me` `social` | 点底部标签 | 每会话每页一次（算「多少会话用过」） |
| `metab` | `overview` `career` `assets` `people` `log` `news` `sync` | 「我」页的分页 | 同上 |
| `err` | `js` `promise` `net` `api4xx` `api5xx` `ws` | `window` 的 `error`/`unhandledrejection`、存档请求断网或 5xx、在线频道 `onerror` | 每种每会话最多 3 次 |
| `perf` | `load`（首屏脚本跑完的 `performance.now()`）、`api`（存档请求往返） | 启动末尾；每次存档请求 | 25% 的会话才报；每种每会话最多 5 次；服务端分 5 档：<1s、<2s、<4s、<8s、≥8s，不存毫秒 |

白名单只有一份：`STAT_EVENTS`（`telemetry.ts`），服务端 `cleanBatch()` 用同一份表校验，不认识的名字、参数、多余字段整条丢掉。测试还会扫描页面里每一处 `tm.track(...)`，要求名字和参数都是白名单字面量（参数只允许 `tab`/`meTab` 这两个变量）。
`api4xx` 留在白名单里但第一版没有调用（409 冲突、429 限流是正常流程）。

## 3. 隐私

### 3.1 原则与落地

| 要求 | 第一版怎么做 |
| --- | --- |
| 不采集真实坐标轨迹 | 统计键只来自白名单；`venue` 动作只记子操作（`use.venue.meal`），不带地点 id、经纬度、精度。测试用真实 POI 坐标走一遍，断言汇总里找不到坐标（原值和 3 位小数）、POI id |
| 不采集同步码、凭证 | 客户端上报不带任何 id；服务端汇总不带 id、key、id 哈希。测试断言汇总里找不到 id、key、id 哈希前缀 |
| 不采集名字 | 同上；测试断言汇总和客户端上报里都找不到角色名 |
| 玩家 id 匿名化 / 哈希 | 汇总里**根本没有玩家标识**。唯一的逐人记录是 `born:<id 的 SHA-256 前 12 位>` = 注册日序号，用来算留存和漏斗 |
| 数据最少化 | 不存原始事件，只存按天汇总的计数；IP 只在内存里做限流，不落盘（测试断言） |
| 保留期限 | 汇总 400 天（约 13 个月，能对比去年同期，自动删除）；`born:` 注册后第 31 天第一次上线时删除 |
| 告知 | 创建角色页底部一句告知加「关闭统计」按钮；「我 · 设置 · 隐私」写明收什么、存哪里、默认值规则；更新日志 v39 |
| 可关闭 | 设置开关；关掉后客户端立即清空本机排队、不再上报；存档请求带 `nt: true`，服务端这名玩家的动作不记任何统计、建角色时不写 `born:` |

`born:` 的说明：键是 id 哈希前缀，而存档实例里本来就有 `h:<哈希前缀>` → 真实 id 的映射（送礼用），所以它**是可以关联回存档的假名数据**，按个人信息对待：只存一个日期、30 天后删除、关了统计的玩家不写。已经注册超过 30 天却一直没再上线的玩家，`born:` 会留着（没有清扫任务）；第二版可以在汇总落盘时顺带清掉超过 31 天的。

### 3.2 默认值：默认开启（浏览器开了 GPC / DNT 时默认关闭）

理由：
1. 收的是不能识别个人的按天计数，玩家关掉统计后连 `born:` 都不写；对玩家的影响很小。
2. 默认关闭的话，自愿打开的玩家极少且不具代表性（会主动进设置的玩家本身就更投入），留存和漏斗数字会系统性偏高，统计失去用处。
3. 尊重浏览器层面的明确意愿：`navigator.globalPrivacyControl === true` 或 `doNotTrack === '1'` 时默认关闭；玩家在设置里明确选过的以设置为准。
4. 告知在玩家建角色之前就能看到，并且当场就能关。

**这是需要用户拍板的决定**：如果更倾向「默认关闭、需要时询问」，改 `statsDefault()` 一处即可，测试里有对应断言要一起改。

已知偏差：关了统计的玩家仍然计入不了 `new`，所以漏斗和留存的分子分母都不含他们，比例本身不受影响；但开关中途切换的玩家会造成小幅偏差。

### 3.3 澳洲 Privacy Act 1988（Cth）

原文出处：Federal Register of Legislation，*Privacy Act 1988*，Compilation No. C2026C00227（2026 年 6 月版），<https://www.legislation.gov.au/C2004A03712/latest/text>。以下引文 2026-11-20 从该版本原文摘录。

- **个人信息的定义**（s 6(1)）：“personal information means information or an opinion about an identified individual, or an individual who is reasonably identifiable”。
  → 按天汇总的计数不针对任何可识别个人；`born:` 可以经 `h:` 映射关联回存档，按个人信息对待。
- **APP 3.2**（收集）：组织“must not collect personal information (other than sensitive information) unless the information is reasonably necessary for one or more of the entity’s functions or activities”。
  → 只收算留存所需的一个日期；其余全是汇总。
- **APP 5.1**（告知）：收集时或之后尽快，“the entity must take such steps (if any) as are reasonable in the circumstances”去告知个人 5.2 列出的事项。
  → 建角色页告知 + 设置页说明（收什么、为什么、存哪里、怎么关）。正式上线前建议补一份隐私说明页，覆盖 5.2 的全部事项（联系方式、境外披露等）。
- **APP 8.1**（跨境披露）：向境外接收方披露前，“the entity must take such steps as are reasonable in the circumstances to ensure that the overseas recipient does not breach the Australian Privacy Principles”。
  → Cloudflare 存储不保证在澳洲（见第 4.4 节）。把数据放在云服务商那里算「披露」还是「使用」，OAIC 的 APP 指南有专门说明，**本次没有核对指南原文**，上线前要核对。
- **APP 11.1**（安全）：“take such steps as are reasonable in the circumstances to protect the information: (a) from misuse, interference and loss; and (b) from unauthorised access, modification or disclosure”；**APP 11.3** 写明这些步骤“include technical and organisational measures”。
  → 查询接口要令牌，没令牌一律 404；汇总不出现在任何发给玩家的响应里。
- **APP 11.2**（销毁）：不再需要时“take such steps as are reasonable in the circumstances to destroy the information or to ensure that the information is de-identified”。
  → `born:` 31 天后删；汇总 400 天后删。

适用范围提示：Privacy Act 对年营业额不超过 300 万澳元的小企业一般有豁免（s 6D，原文“annual turnover of more than $3,000,000”是界定条件之一），但有多种例外。**运营方是否属于 APP entity 需要用户确认**；第一版按 APP 的要求来做，不依赖豁免。玩家里有学生，OAIC 正在依法制定儿童网络隐私守则，**本次没有核对其内容**，正式推广前要复查。

## 4. 存储与查询方案

### 4.1 选型比较（价格 2026-11-20 摘自 Cloudflare 官方文档）

| 方案 | 免费计划额度 | 付费计划（Workers Paid） | 数据保留 | 优点 | 缺点 |
| --- | --- | --- | --- | --- | --- |
| **DO 内聚合（第一版采用）** | SQLite DO：写入 10 万行/天，读取 500 万行/天，存储 5 GB；请求 10 万/天 | 写入每月含 5000 万行，超出 $1.00/百万行；存储每月含 5 GB，超出 $0.20/GB-月；请求每月含 100 万，超出 $0.15/百万 | 自己定（400 天） | 已有绑定，**不新增服务**；只存汇总，隐私最好；和权威结算在一处，天然防刷 | 只能查预先定义的计数；没有 SQL；查询要自己写接口 |
| Workers Analytics Engine | 写入 10 万数据点/天，查询 1 万次/天 | 每月含 1000 万数据点，超出 $0.25/百万；查询每月含 100 万，超出 $1.00/百万 | **3 个月**，不可改 | SQL 查询灵活；写入不阻塞 | 要新增 `analytics_engine_datasets` 绑定；存的是逐条事件（更多原始数据）；高量时会自动降采样；官方页面写明目前尚未收费 |
| D1 | 写入 10 万行/天，读取 500 万行/天，存储 5 GB | 写入每月含 5000 万行，超出 $1.00/百万；存储超出 5 GB 后 $0.75/GB-月 | 自己定 | 完整 SQL，能做逐人分析 | 要新增 D1 绑定和迁移；逐人数据隐私负担重 |

来源：
- DO 价格：<https://developers.cloudflare.com/durable-objects/platform/pricing/>（SQLite 存储计费 2026 年 1 月起生效）
- Analytics Engine 价格：<https://developers.cloudflare.com/analytics/analytics-engine/pricing/>；保留 3 个月、每次调用最多 250 个数据点：<https://developers.cloudflare.com/analytics/analytics-engine/limits/>；降采样：<https://developers.cloudflare.com/analytics/analytics-engine/sql-api/>
- D1 价格：<https://developers.cloudflare.com/d1/platform/pricing/>

结论：第一版用 DO 内聚合，**不新增任何绑定**。以后需要灵活的即席查询，优先考虑 Analytics Engine（仍然只写白名单计数维度，不写 id），这要新增绑定，**等用户决定**。

### 4.2 第一版的写入成本

- 计数先攒在 DO 内存里，**攒够 200 次或满 60 秒**合并写一次，每个涉及的现实日一行（通常是今天，加上留存/漏斗要写的注册日）。所以每个实例每天最多约 1440 次合并写入，每次 1–3 行，即 **≤ 约 4300 行/天/实例**，两个实例（`@SAVES`、`@STATS`）合计 ≤ 约 8600 行/天，和玩家数量基本无关。
- 对比：现有每个成功动作落盘一次就写 3 行（存档、`h:`、`rank:`）。免费计划 10 万行/天的额度里，统计最多占不到一成。
- 额外读取：每次合并读一次当天汇总；领每日奖励或漏斗推进时读一次 `born:`。
- 客户端上报：每个打开的页面约每分钟一个请求（有事件时才发），走 `@STATS` 实例，不挤占存档实例。免费计划每天 10 万次 DO 请求，按每人每天在线 15 分钟估算，约 500 日活会用掉约 7500 次。
- 代价：实例被回收时最多丢最近 60 秒的计数。统计可以接受这个误差。

### 4.3 查询

```bash
curl -s -H "Authorization: Bearer $EARTH_STATS_TOKEN" "https://<站点>/api/earth/stats/read?from=20770&to=20777"
```

- 返回 `{ ok: true, days: { "<日序号>": { 计数键: 数值, … } } }`，合并了 `@SAVES`（服务端结算）和 `@STATS`（客户端上报）两个实例；查询前会先把内存缓冲落盘。
- 一次最多查 120 天。日序号 = `Math.floor((UTC 毫秒 + 8 小时) / 86400000)`。
- 令牌是 Worker secret（`wrangler secret put EARTH_STATS_TOKEN`，至少 32 个字符），不是付费服务。**没有配置令牌时接口一律 404，第一版上线后默认就是这样**；需要查数时由用户自己配置令牌。
- 常用算式：次日留存 = `days[C]["ret.1"] / days[C].new`；7 日留存 = `ret.7 / new`；漏斗 = `new → fn.travel → fn.work → fn.real`（同一个注册日 C）；页面使用率 = `c.tab.go / c.session`；报错率 = `c.err.js / c.session`；加载 P50 看 `c.perf.load.*` 各档的累计占比。

### 4.4 数据存放位置

**Cloudflare 不提供澳洲数据驻留。** Durable Objects 的强制驻留只有 `eu`、`us`、`fedramp` 三个辖区；澳洲只有位置提示 `oc`，官方原文“Hints are a best effort and not a guarantee”，见 <https://developers.cloudflare.com/durable-objects/reference/data-location/>。而且提示只在实例第一次创建时起作用，`@SAVES` 早已存在，现在位置未知。统计数据和存档一样，可能存放在澳洲境外。设置页的告知已经写明「服务器可能在澳洲境外」。

## 5. 采样与防刷

- **重要指标不信客户端**：留存、漏斗、日活、经济流水全部由服务端在权威结算时按存档前后状态计算，改客户端、伪造请求都改不了（伪造请求要有合法同步码，而且每个动作照常过规则引擎）。每日活跃靠 `claimDaily()` 天然每存档每天一次。
- **客户端上报只作参考**（使用率、报错、性能），防刷手段：
  - 每 IP 每分钟最多 6 批（正常客户端每分钟最多一批），超了 429；IP 只在内存里，不落盘。
  - 每批最多 30 条、请求体 4 KB；名字、参数白名单校验，耗时只接受 0–600000 毫秒的数并分档。
  - 每个现实日的汇总最多 2000 个不同计数键（`STATS_MAX_KEYS`），防止任何漏洞把汇总撑大。
  - 刷量的上限因此是可计算的：一个 IP 一天最多 6 × 30 × 1440 ≈ 26 万条计数。分析使用率时以 `c.session` 为分母，单个 IP 刷量会表现为 `c.session` 异常暴涨，可以识别。需要更强防护时再考虑按 Cloudflare 的 bot 信号过滤（未做）。
- **抽样**：只有性能事件抽样（25% 会话，分析时乘 4）；报错每种每会话最多 3 次；页面每会话只记一次。服务端结算产生的计数不抽样。

## 6. 遗留风险与后续

1. **Workers Logs 里的 WebSocket 握手 URL**：`wrangler.json` 开着 `observability`，在线频道的 `/api/earth/ws?…&id=…&name=…` 会进 Cloudflare 的请求日志，含真实 id（同步码的一半）和角色名。这不是本次新增的，但和本设计的隐私承诺冲突。建议：握手改用首条消息传 id/name，或对 `/api/earth/ws` 关闭日志采样。**改动涉及在线频道协议，没有在本分支做**，留给对应分支评估。
2. 共同事件、交易、周目标领奖的现金流还没进 `eco.*`。
   - 2026-11-21 合并 main 后补记：`eco.out.asset` / `eco.in.asset` 是理财买入、卖出（现金换成持仓或换回来），**不是货币回收或投放**，算平衡时要单独看或剔除；持仓的盈亏只在卖出时以现金差出现。宠物（`pet`）、学历课程（`study`）、现实活动纪念（`live`）、领成就（`claim`）等 main 新加的动作按动作类型自动计入 `use.*` 和 `eco.*`，子操作不在白名单里的只记类型。
3. 长期不再上线的玩家的 `born:` 不会被删（见 3.1）。
4. 运营方是否是 APP entity、APP 8 对云存储的适用、儿童网络隐私守则，需要用户或法律顾问确认。
5. 默认开启是需要用户确认的决定（3.2）。

## 7. 验证

- `tests/earth/analytics.test.ts`（13 个测试）：不泄露坐标、同步码、名字、id 哈希；关掉后客户端不排队、不发送、清空本机排队；服务端带 `nt` 时一条不记；留存、漏斗、经济计数；上报接口的 400/413/429；查询接口无令牌 404 且不碰存储；缓冲写失败不丢、过期清理。
- 变异检查 `python3 tools/earth/analytics/mutate.py`：把 13 处关键防线逐个改坏（关后仍发送、关后仍排队、忽略 `nt`、不查白名单、功能名带地点 id 和坐标、查询不验令牌、页面把名字传进埋点等），测试应当全部失败。第一版结果：13/13 被测试抓到。
