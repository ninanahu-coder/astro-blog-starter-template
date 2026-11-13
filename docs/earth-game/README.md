# 地球人生 / Terra Life —— 游戏框架说明

在真实地图上生活的在线人生模拟。第一阶段以**西澳大利亚**为试点：
生活需求（吃、睡、清洁、娱乐、社交）+ 开放世界式能力成长（体能、力量、驾驶、游泳、魅力、生存、街头）+
**到达地点触发事件** + 同地点玩家互动 + **手机多端云同步**。

- 试玩入口：`/earth`（手机优先）
- 本地运行：`npm run preview`（需要 Durable Object，所以用 wrangler 而不是 `astro dev`）
- 测试：`npm test`

> 这是原创设定。生活模拟与开放世界属性成长只是玩法类型上的参考，不使用任何现有游戏的名称、角色、美术或关卡。

## 1. 四个工具的分工

| 角色 | 工具 | 负责什么 | 产物落在哪里 | 不做什么 |
| --- | --- | --- | --- | --- |
| 逻辑 + 前端 | **Claude Code** | 类型、规则引擎、Durable Object、`/earth` 页面、测试；按 Codex 的分析报告实施调参 | `src/game/`、`src/pages/earth.astro`、`tests/earth/` | 不手写大批量数据、不生成图片、不自己下平衡分析结论 |
| 数据采集 | **OpenClaw** | 按任务书采集 POI、地点和节日的真实资料（OSM / Wikidata） | `tools/earth/openclaw/inbox/*.json` → `src/game/data/wa.pois.json` | 不改代码；只交 JSON |
| 检查与分析 | **Codex** | 审 PR（规则正确性、安全、数据许可）；跑数值模拟并写平衡分析；分析 OpenClaw 的数据。任务书 [codex-tasks.md](codex-tasks.md) | PR 审查评论；`docs/earth-game/balance.md` 的分析小节 | 不写逻辑和前端；调参只提建议 |
| CGI 素材 | **远程 ComfyUI** | 地点主视觉、事件插图 | `public/earth/cgi/*.png` + `manifest.json` | 不参与逻辑；缺图时前端自动用占位图 |

四者之间只通过**仓库里的文件**交接，互不依赖对方在线：

```
OpenClaw ──inbox/*.json──▶ npm run earth:pois ──▶ wa.pois.json ─┐
                                                               ├─▶ PR ──▶ Codex 审查 ──▶ 合并 ──▶ 部署
Claude Code ──▶ src/game/** + earth.astro + tests ─────────────┤
                                    Codex 跑 earth:sim ──▶ balance.md 分析 ──▶ Claude Code 按报告调参
                                                               │
src/game/data/* ──▶ prompts.mjs ──▶ 远程 ComfyUI ──▶ cgi/*.png ─┘
```

## 2. 代码结构

```
src/game/
  core/types.ts       全部数据结构（PlayerState / Region / GameEvent / Activity / Effect）
  core/character.ts   出身、初始属性、存档校验 sanitizeState()
  core/engine.ts      规则引擎：travel / performActivity / resolveEvent / gpsCheckIn（纯函数、确定性）
  core/geo.ts         距离、地图投影、真实坐标 → 游戏地点
  data/wa.ts          西澳：18 个地点、路线图、海岸线轮廓
  data/wa.pois.json   打卡点（OpenClaw 写入）
  data/activities.ts  地点互动表（数值调参都在这里）
  data/events.ts      到达事件表（加事件只加数据，不写逻辑）
  server/world.ts     Durable Object：在线位置、同地点聊天/表情、云存档
src/pages/earth.astro 手机端单页客户端（只负责渲染和输入）
tools/earth/openclaw/ 采集任务书、JSON Schema、校验合并脚本
tools/earth/comfyui/  提示词生成、工作流模板、远程出图脚本
tests/earth/          引擎与数据自洽性测试
```

人物属性、派生数值公式和基本元素的完整说明见 [core-design.md](core-design.md)。数值平衡模拟的方法和结论见 [balance.md](balance.md)（`npm run earth:sim`）。消费与资产系统的方案（待确认）见 [economy-plan.md](economy-plan.md)。

设计原则：

1. **规则是纯函数**。`engine.ts` 不碰 DOM、不碰网络，随机数种子存在存档里。同一份代码前端跑、测试跑，第二阶段直接搬到服务端做权威结算。
2. **内容是数据**。新地点、新互动、新事件都是往数组里加一条；`Effect` 一种结构描述所有数值变化。
3. **不可信输入一律过 `sanitizeState()`**。本地存档、云端存档、别的设备传来的状态都先校验再用。

## 3. 玩法设定

### 初始属性

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| 生活需求（0–100，随时间下降） | 饱食、精力、清洁、娱乐、社交 | 饱食或精力归零会持续掉健康 |
| 能力（0–100，用进废退式成长） | 体能、力量、驾驶、游泳、魅力、生存、街头 | 影响事件检定、行车速度、可做的互动 |
| 状态 | 现金、健康、声望、麻烦值、座驾 | 麻烦值 ≥ 60 会被盘查；健康归零会在最近的医院醒来，付医药费 $100 + 现金的 10%（最多 $500） |

四种出身（背包客 / 矿区轮班工 / 留学生 / 冲浪手）决定起始现金、座驾和能力侧重。

### 到达事件

- 每次抵达一个地点都会掷一次事件；**首次到访**且当地有“签名事件”（如罗特尼斯岛的短尾矮袋鼠、埃克斯茅斯的鲸鲨）时必定触发。
- 事件按 `locs / tags / kinds / arrivedBy` 匹配地点和到达方式，选项可带能力检定（`能力值 + 0~60 随机 ≥ 难度`）。
- **真实定位打卡**：手机本人到了某个地点的半径内，可以直接“抵达”并触发事件；400 米内的 POI 首次打卡加声望。

### 出行

公路（无车坐巴士、有车自驾并涨驾驶）、越野土路（需四驱）、渡轮、航班。时间流逝会带动需求衰减，所以长途前要吃饱睡好。

## 4. 联机与手机同步

| 接口 | 作用 |
| --- | --- |
| `GET /api/earth/ws?region=wa&id&name&avatar&loc`（WebSocket） | 区域在线状态：`hello / join / leave / move / chat / emote`。聊天和表情只发给同一地点的玩家 |
| `POST /api/earth/save` `{action:'create'|'get'|'act', id, key, …}` | **服务端权威结算**。`create` 由服务器创建角色；`act` 发送一个动作（`{ rev, act: GameAction }`），服务器调用规则引擎结算、保存并返回新存档；客户端版本落后时返回 409 和最新存档。服务端只存 key 的哈希，不接受客户端上传存档 |

- **同步码** = `id.key`，在“同步”页复制，到另一台设备粘贴即可恢复。等同密码。
- 每个动作都发给服务器结算，成功后 `rev + 1`。同一存档的请求在服务器上排队执行。
- 两台设备同时玩：后发的一方因版本落后被拒绝，并自动载入最新进度。
- 服务器返回的存档隐去了随机数种子，客户端无法预知检定结果。
- 本机 `localStorage` 只缓存最近一次的服务器存档用于显示；联网时一律以服务器为准，改缓存没有作用。
- 断网时可以查看，但不能行动；创建角色也需要联网。

## 5. 数据采集（OpenClaw）

任务书：[`tools/earth/openclaw/TASK.md`](../../tools/earth/openclaw/TASK.md)。只用开放许可数据源（OSM / Wikidata）。

```bash
# OpenClaw 把批次放进 tools/earth/openclaw/inbox/ 之后：
npm run earth:pois -- --dry-run   # 只校验
npm run earth:pois                # 校验并合并进 wa.pois.json
```

校验内容：字段白名单、类别枚举、坐标必须落在所属地点的打卡半径内、id 规范。任何一条不合格整批不写入。

## 6. CGI 素材（远程 ComfyUI）

```bash
npm run earth:cgi -- --dry-run                       # 只看提示词（不需要 ComfyUI）
COMFYUI_URL=http://<主机>:8188 \
COMFYUI_CKPT=sd_xl_base_1.0.safetensors npm run earth:cgi
npm run earth:cgi -- --only=perth,event:whale-shark --force
```

- 提示词由游戏数据自动拼出（`prompts.mjs`），统一画风只改 `STYLE` 一处。
- 工作流模板 `workflow.sdxl.json` 是 ComfyUI 的 API 格式，可在 ComfyUI 里用 “Save (API Format)” 导出替换，保留 `__POSITIVE__ / __NEGATIVE__ / __CKPT__` 占位符。
- 脚本逐张落盘并更新 `manifest.json`，中断可续跑；已存在的图默认跳过。
- ComfyUI 本身没有鉴权，**不要把 8188 端口直接暴露到公网**：走 VPN / SSH 隧道，或放在带令牌的反向代理后面（`COMFYUI_TOKEN`）。

## 7. 审查（Codex）

审查规则写在仓库根的 [`AGENTS.md`](../../AGENTS.md)。在 Codex 里为本仓库开启 GitHub 代码审查后，PR 上评论 `@codex review` 即可触发。

## 8. 路线图

| 阶段 | 内容 |
| --- | --- |
| **1（当前）** | 西澳 18 地点、21 种互动、17 个事件、云同步、在线状态与同地点聊天、数据/出图管线 |
| 2 | ~~服务端权威结算~~（已完成）；账号体系；真实瓦片底图（MapLibre + OSM）；PWA 离线与推送 |
| 3 | 玩家间交易/组队/共同事件；职业线与住房；昼夜与天气（接 BOM 开放数据） |
| 4 | 新区域：按 `Region` 结构加数据文件即可（澳洲其他州 → 全球） |

## 9. 已知限制（第一阶段）

- 真实定位打卡信任客户端上报的坐标，手机上伪造定位可以“瞬移”打卡。要防这一点需要另做位置可信度校验。
- 所有存档在同一个 Durable Object 实例里，适合当前规模；玩家多了要按 id 分片。
- 地图是手工简化的示意轮廓，不是测绘级数据。
- ComfyUI 脚本已对照 API 协议用模拟服务验证过流程，尚未连真实出图机跑过；首次使用请先 `--only=perth` 试一张。
