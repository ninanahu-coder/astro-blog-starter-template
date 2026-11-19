# 地球人生性能审查（第 41 批）

分支 `claude/earth-perf`，基于 main `e429bcd`。测量日期 2026-11-20。

玩家主要是在西澳、南澳的华人和留学生，用手机玩。下面的「低端安卓 + 4G」按这个人群估算。

本文分三部分：

- 一、现状测量：首屏体积构成、关键渲染路径、数据和图片什么时候加载、Worker 和 Durable Object 的往返、整页重绘的开销。
- 二、优化清单：本批已经落地的，和只写成提案、没有动的。
- 三、首屏体积上限：各分支现在的说法不一致，这里给出合并后的预计体积和建议，最后由用户决定。

## 0. 结论和前后对比

| 指标 | main（改前） | 本分支（改后） | 变化 |
| --- | --- | --- | --- |
| 首屏 `<head>` 里阻塞渲染的 CSS | 2 个文件，98.5 KiB，gzip 16.5 KiB | 1 个文件，28.7 KiB，gzip 6.6 KiB | **-60%（gzip）** |
| 首屏 JS（Vite 实际产物） | 301.0 KiB，gzip 114.5 KiB，br 94.4 KiB | 295.8 KiB，gzip 112.3 KiB，br 92.8 KiB | -5.2 KiB，gzip -2.2 KiB |
| 首屏 HTML、CSS、JS 合计 | 402.5 KiB，gzip 132.5 KiB，br 109.4 KiB | 327.3 KiB，gzip 120.3 KiB，br 99.7 KiB | **-75 KiB，gzip -12.2 KiB（-9%）** |
| 关键路径上的请求数 | 4 个（HTML、2 个 CSS、JS） | 3 个（HTML、CSS、JS） | -1 |
| 首屏脚本（esbuild 口径，`bundle.test.ts` 用的那个） | 392,671 字节，gzip 121,263 | 382,101 字节，gzip 118,348 | -10,570 字节 |
| 回访时构建文件（`/_astro/*`）要不要回源校验 | 每个文件发一次条件请求，服务器回 304 | `immutable`，不再发请求 | 每个文件省 1 个往返 |
| 按需加载的分块（真实地点、地图库、更新日志）在 Service Worker 里能不能留住 | 每次联网打开页面都被删掉 | 不发新版本就一直留着 | 见 §2.1 第 4 条 |
| 后台同步、在线人数变化时的 DOM 重建 | 每次都把顶栏、标签栏、地图、面板、弹窗整块重写 | 内容没变的块不碰 | 见 §1.5 |
| Worker 上传体积（`npm run check`） | 1257.31 KiB，gzip 287.13 KiB | 1255.43 KiB，gzip 287.07 KiB | 基本不变（服务端代码没改） |

收益要说清楚：首屏在 4G 下大约快 0.05–0.1 秒（§1.6），省得不多。真正卡的地方有三个：首屏 JS 里一半以上是数据，真实地图库 gzip 后约 435 KiB，各分支全部合并后首屏会涨到约 540–565 KB。这三项都要改结构，本批只写进提案（§2.2），没有动。

复现命令：

```bash
npm run build && node tools/earth/bundle-report.mjs --top 30
```

`tools/earth/bundle-report.mjs` 是本批新增的脚本。它输出两部分：一是用 esbuild 按模块拆分（口径和 `tests/earth/bundle.test.ts` 相同）；二是 `dist/earth/index.html` 实际引用的 JS 和 CSS 的原始、gzip、brotli 大小。也可以传另一个工作区的路径去量别的分支，加 `--json` 输出机器可读的结果。

> 口径说明：`bundle.test.ts` 用 esbuild 压缩，Vite 实际构建用的是 Rollup 加 esbuild 压缩，两者差约 25%（382 KB 对 296 KiB）。测试量的是 esbuild 口径，所以上限也按这个口径定；玩家实际下载的是 Vite 产物，而且 Cloudflare 会自动用 brotli 压缩。

## 一、现状测量

### 1.1 首屏 JS 构成（改后，esbuild 口径 382,101 字节）

| 类别 | 大小 | 占比 |
| --- | --- | --- |
| 数据 `src/game/data` | 201.3 KiB | 54.0% |
| 页面脚本（`earth.astro` 里的 `<script>`） | 108.7 KiB | 29.1% |
| 引擎 `src/game/core` | 48.1 KiB | 12.9% |
| 界面工具 `src/game/ui` | 15.0 KiB | 4.0% |

最大的模块：

| 模块 | 大小 | 首屏真的要用吗 |
| --- | --- | --- |
| 页面脚本 | 108.7 KiB | 要。六个标签页的拼 HTML 代码都在这一个文件里，其中「成长」「我」「社交」三页（含同步、共同事件、交易卡片）约 34 KB 源码，占页面脚本的 20% 左右 |
| `data/events.ts` + `events-sa.ts` + `venue-events.ts` | 69.5 KiB | 只用到一小部分：首屏只要事件 id、触发地点和是否一次性；正文和选项要等弹窗打开才用 |
| `data/npcs.ts` | 26.5 KiB | 大部分不用：今天页只要名字和日程，对话文本要等互动时才用 |
| `data/facts.ts` | 20.1 KiB | 只用一条：今天页显示当前地点的小知识 |
| `core/engine.ts` | 11.7 KiB | 要 |
| `core/character.ts` | 11.2 KiB | 要（`sanitizeState`） |
| `data/coop.ts`、`experiences.ts`、`activities.ts` | 21.5 KiB | 部分 |
| `data/wa-base.ts`、`sa-base.ts` | 10.6 KiB | 要（地点和地图） |

不在首屏、按需加载的分块：

| 分块 | 原始 | gzip | 什么时候下载 |
| --- | --- | --- | --- |
| maplibre-gl（地图库） | 1079 KiB | 292 KiB | 第一次打开「出行」并且开着真实地图时 |
| maplibre-gl 的后台线程 | 507 KiB | 144 KiB | 同上 |
| maplibre-gl 的样式 | 70 KiB | 10 KiB | 同上（**本批之前**：每次打开页面都在 `<head>` 里阻塞渲染） |
| `wa.venues.json`（西澳真实地点） | 209 KiB | 39 KiB | 第一次打开西澳的「附近」 |
| `sa.venues.json`（南澳真实地点） | 121 KiB | 23 KiB | 第一次打开南澳的「附近」 |
| qrcode-generator（二维码） | 21 KiB | 7.5 KiB | 打开「我 · 同步」的二维码 |
| 更新日志 | 6.3 KiB（Vite） | — | 第一次打开「我」页（**本批之前**：在首屏） |

CSS 方面，`earth.css` 是 28.7 KiB（gzip 6.6 KiB），全是 `earth.astro` 里的 `<style is:global>`，没有拆分的必要。

### 1.2 关键渲染路径

```
HTML（2.9 KiB，静态预渲染，Cloudflare 静态资源直接返回，不经过 Worker）
 ├─ earth.css      阻塞渲染
 ├─ maplibre-gl.css 阻塞渲染  ← 本批去掉
 └─ earth 入口 JS（type=module，延迟执行）
      └─ 执行：读 localStorage 存档 → sanitizeState → renderCreate() → render()
           ├─ 新玩家：创建页本来就写在 HTML 里，CSS 一到就能看到
           └─ 老玩家：#game 是 hidden，要等 JS 下载、解析、执行完并且第一次 render() 之后，才看得到内容
      之后（不阻塞首屏）：fetch /earth/cgi/manifest.json → 再画一次面板和事件
                        WebSocket /api/earth/ws、POST /api/earth/save（拉取云端存档）
                        注册 Service Worker
```

老玩家占大多数，他们的首屏时间基本等于首屏 JS 的下载加执行时间。所以削减首屏 JS 是收益最大的方向（§2.2 的 P1、P2）。

### 1.3 数据和图片什么时候加载

- 地点、区域、事件、NPC、小知识：全在首屏 JS 里，同步可用。
- 真实地点：打开「附近」时按区域动态 `import()`，西澳和南澳分开（`venueLoads`），失败了可以重试。
- 插图清单 `manifest.json`（7 KB）：首屏 `render()` 之后才 fetch，到了再重画一次面板。
- 插图（CGI）：120 张 WebP，宽 960，平均 90 KiB，总共 11 MB。今天页顶部的地点图高 140px，事件弹窗至少 170px，两处都是 `loading="lazy"` 加 `object-fit: cover`。屏幕宽 360、DPR 2 的手机，显示宽度只要 720px 左右。
  - 抽样 19 张实测：缩到 640 宽再按 q75 编码，大小降到原来的 **44%**；保持 960 宽只把质量降到 q75，只降到 98%（说明现在已经接近 q75）。所以有用的办法是**缩小尺寸**，不是降质量。见提案 P4。
- 地图库：出行页开着真实地图（默认开）时才下载，gzip 约 435 KiB，另外 OpenFreeMap 的样式、字形、图块还要几百 KB。这是整个游戏在 4G 下最大的一笔下载。
- 字体：main 没有自定义字体。开场分支 `claude/earth-start-ui` 加了 13 KB 的 woff2，合并后建议 `font-display: swap`，不 preload（它不在老玩家的首屏上）。

### 1.4 Worker 冷启动和 Durable Object 往返

- **页面本身不经过 Worker**：`/earth/` 是构建时预渲染的静态 HTML，由 Cloudflare 的静态资源层直接返回，没有冷启动。
- **API 要经过 Worker**：`/api/earth/save`（每个动作一次 POST）和 `/api/earth/ws`（在线频道）。Worker 包是 1.25 MiB（gzip 287 KiB），里面有 Astro SSR 运行时、博客、百家乐和地球人生服务端。隔离环境冷启动一般在几毫秒到几十毫秒，脚本越大越慢；只有第一个 API 请求会遇到。
- **所有存档都在同一个 DO 实例里**（`idFromName(SAVES_ROOM)`）。每个动作的路径是：手机 →（4G 往返约 50–100ms）就近机房的 Worker → 存档 DO → `storage.get('save:'+id)`、`ops:`，再 `put` → 原路返回。DO 放在它第一次被创建的地方附近。如果在悉尼，珀斯过去还要多约 50ms；如果在亚洲或美国，就是 150–250ms。**现在放在哪我没法从本机确认**，要看线上日志（例如在 DO 里记下 `request.cf.colo`）。
- 在线频道按区域分 DO（`wa`、`sa`），WebSocket 建好以后是长连接，单条消息不再有握手开销。
- 动作是服务器权威结算，至少要一个完整往返才出结果（断网时有本机排队）。这是设计上的取舍，本批不动。

### 1.5 `render()` / `renderPanel()` 整页重绘

- `render()` 在页面脚本里有 31 处调用，`renderPanel()` 也有 31 处。`renderPanel()` 每次都会重画标签栏、顶栏、（出行页的）SVG 地图和整块面板；`render()` 还会重画事件弹窗。
- 触发重绘的来源：每个动作的结果、拉取云端存档、WebSocket 的 `join`/`leave`/`move`（每次都会 `renderMap()` 加 `renderTabs()`，在社交页还会 `renderPanel()`）、「附近」页每 30 秒的倒计时刷新、插图清单到达、真实地点加载完。
- 本批之前，每次重绘都是 `innerHTML = 整块字符串`。即使内容一个字没变，浏览器也要拆掉旧节点、解析新 HTML、重新排版，插图要重新解码；面板里的焦点、展开的 `<details>`、输入框里打到一半的字也会丢。
- 本批加了 `setHtml()`（`src/game/ui/dom.ts`）。它和上一次写进去的字符串比较，一样就跳过写入。用在顶栏、标签栏、SVG 地图、面板和事件弹窗这 6 处。字符串照样要拼，这部分 JS 开销还在；省掉的是 DOM 的销毁和重建、样式计算、排版和图片解码，在低端机上这部分通常比拼字符串贵得多。
- 哪些情况能跳过：别的玩家在**你看不到的地点**进出（地图和标签栏都没变）、30 秒倒计时刷新时按钮状态没变、云端拉回来的存档和本机一样、插图清单到达但当前页没有插图。
- 还没做的：在同一帧里多次调用 `render()` 时合并成一次（提案 P6）。

### 1.6 低端安卓 + 4G 下的预期（估算）

假设：Lighthouse 的移动端模拟参数，下行 1.6 Mbps（约 195 KiB/s），往返 150ms，CPU 比开发机慢 4 倍以上（千元安卓机）。这是**估算**，不是真机测量；用户约定不用浏览器工具，所以这里没有跑 Lighthouse。

| 阶段 | 改前 | 改后 |
| --- | --- | --- |
| 建立连接（DNS + TCP + TLS，约 3 个往返）加 HTML | 约 0.6 s | 约 0.6 s |
| 阻塞渲染的 CSS 下完（新玩家能看到创建页） | 16.5 KiB，两个请求，还要和 JS 抢带宽 | 6.6 KiB，一个请求 |
| 首屏 JS 下完 | 114.5 KiB，约 0.6 s | 112.3 KiB，约 0.6 s |
| 首屏全部传输 | 132.5 KiB，约 0.68 s | 120.3 KiB，约 0.62 s |
| 解析、编译、执行 296 KiB 压缩后的 JS，加上第一次 render() | 估计 0.5–1.0 s（这一档机器上 300 KB 级 JS 的常见量级） | 基本不变 |
| 老玩家看到内容 | 约 1.8–2.3 s | 约 1.7–2.2 s |
| 回访（Service Worker 已装好） | 构建文件走 SW 缓存，不受影响；没装 SW 时每个文件一个 304 往返 | 不再回源校验 |
| 第一次打开出行页的真实地图 | 地图库 gzip 435 KiB，约 2.3 s，再加样式和图块 | 一样（但预连接图块服务器，省 1–2 个往返，约 0.2–0.4 s） |
| 第一次打开「附近」 | 西澳地点 gzip 39 KiB，约 0.2 s 加 1 个往返 | 一样；以后不再每次打开页面都被 SW 删掉 |

结论：首屏主要卡在 JS 的执行，不在网络。改善首屏只能靠把首屏 JS 削下去（P1、P2、P3），本批的改动只是去掉了明显浪费的部分。

## 二、优化清单

### 2.1 本批已落地（收益明确、风险低）

| # | 改了什么 | 收益 | 风险和对策 |
| --- | --- | --- | --- |
| 1 | **地图样式不进首屏 `<head>`**。`basemap.ts` 原来是 `import('maplibre-gl/dist/maplibre-gl.css')`，Astro 会把它提到页面 `<head>`，变成阻塞渲染的 `<link>`。现在改成 `?url` 拿到地址，加载地图库时才用 `addHeadLink()` 插进去，等样式加载完再建地图 | 首屏少一个阻塞渲染的请求，少 70 KiB（gzip 10 KiB）；不开真实地图的玩家完全不用下载 | 样式到得比地图晚，控件可能没样式：加载完才建地图，失败或 3 秒超时也继续（只是控件难看，不让底图失败）。测试：`perf.test.ts` 禁止页面和 `src/game/ui` 直接 import CSS |
| 2 | **预连接图块服务器**。开始下载地图库时插入 `<link rel=preconnect href=https://tiles.openfreemap.org crossorigin>` | 地图库下载的 1–2 秒里，DNS 和 TLS 已经做完，样式和图块能立刻请求，省 1–2 个往返（4G 下约 0.2–0.4 s） | 只在要画真实地图时才连，不浪费首屏的连接 |
| 3 | **缓存头**。新增 `public/_headers`：`/_astro/*` 设 `max-age=31536000, immutable`（文件名带哈希）；`/earth/cgi/*` 设 `max-age=3600, stale-while-revalidate=86400`。HTML 不设，保持每次回源校验 | 回访时构建文件不再一个个回源校验（没装 SW、SW 被系统清掉、或用浏览器直接打开的情况）；插图 1 小时内直接用缓存，之后先显示旧的、后台再更新 | 插图文件名不带哈希，同名替换后最多 1 小时内还显示旧图，所以不标 `immutable`。规则不能重叠（重叠时 Cloudflare 会把两个值用逗号拼起来），测试会检查。wrangler 会读 `dist/_headers`（Astro 适配器已经把它写进 `.assetsignore`，不会被当成文件对外提供），`npm run check` 通过 |
| 4 | **Service Worker 不再误删按需加载的分块**。`sw.js` 每次联网打开页面都会删掉「新页面没引用的构建文件」，但真实地点、地图库、更新日志本来就不写在页面里，于是每次都被删掉。现在只有页面引用的文件变了（也就是发了新版本）才清理 | 同一个版本内，西澳地点（gzip 39 KiB）和地图库（gzip 435 KiB）不会每个会话都被删掉再下载或校验一遍；断网时也能用上次加载过的真实地点 | 发新版本时照常清理，缓存不会无限增长。测试：`sw.test.ts` 新增一条，用 main 的 `sw.js` 跑会失败 |
| 5 | **更新日志按需加载**。`changelog.ts` 和 `news.ts` 改成第一次打开「我」页时才 `import()`。「新」标记和日志列表在加载完之前不显示；断网加载失败时显示「没加载出来」，30 秒后再打开「我」页会重试 | 首屏少 10.6 KB（esbuild 口径）。以后每批更新日志都不再加在首屏上（各分支合计约 14 KB，见 §3） | 「新」标记要等「我」页打开约一个往返后才出现。测试：`bundle.test.ts` 把 `changelog.ts` 加进不许进首屏的名单 |
| 6 | **内容没变就不重写 DOM**（`setHtml`），见 §1.5 | 后台同步、有人进出地点、倒计时刷新时，不再整块重建 DOM；焦点、展开的卡片、输入框里的字不会被无故打断 | 前提是这些元素**只通过 `setHtml` 写入**。如果别的代码直接改了 `innerHTML` 或子节点，下一次内容相同的重绘会被误跳过。我已经检查过，目前这 6 个元素里没有直接改 DOM 的代码；合并其他分支时要再查一遍（§4）。测试：`perf.test.ts` |

体积回退的防护：

- `tests/earth/bundle.test.ts`：首屏里不许出现 `changelog.ts`（原来的名单是真实地点、地图库、二维码库）。
- `tests/earth/perf.test.ts`：禁止直接 import CSS；`_headers` 里构建文件要 `immutable`、插图不能 `immutable`、页面不能长缓存、规则不能重叠；`setHtml`、`addHeadLink` 的行为。
- `tests/earth/sw.test.ts`：没发新版本时按需加载的分块要留住，发了新版本要清掉。
- 首屏上限：用户 2026-11-20 选了 §3 的方案甲，`FIRST_SCREEN_MAX` 改成临时值 560,000，新增 gzip 上限 `FIRST_SCREEN_GZIP_MAX` = 175,000；首屏改为按「入口 + 静态分块」计算（见 §3.4）。

### 2.2 提案（没有动：改动大、会和并行分支冲突，或者有体验上的取舍）

按收益从大到小排：

| # | 提案 | 预期收益 | 风险和代价 |
| --- | --- | --- | --- |
| P1 | **事件正文按需加载**。把 `events*.ts`、`venue-events.ts` 拆成两部分：首屏只留「索引」（id、地点、时段、条件、once），正文和选项另外打包，有待处理事件时再 `import()`，页面空闲时预取 | 首屏约少 55–60 KB（esbuild 口径，约占 15%）；以后加事件也不再加在首屏上 | 中。`getPendingEvent()` 要能处理「正文还没到」（弹窗先显示加载中）；服务端照常用完整数据。数据文件要拆，和所有加事件的分支冲突，适合在一轮合并结束后、没有分支在加事件的时候做 |
| P2 | **低频标签页拆包**。把「成长」「我」「社交」三页拼 HTML 的代码移到独立模块，切到那一页才 `import()`（今天、出行、附近留在首屏） | 页面脚本约少 20–25 KB，再加上只有这几页用的数据（共同事件、图鉴、鱼、成就、NPC 组合、主线、拍照任务，约 27 KB），合计约 45–50 KB | 中到高。`earth.astro` 的 `<script>` 是一个大闭包，各页共用很多局部变量（`state`、`esc`、`card` 等），要先把共用部分抽成模块。这是大改结构，会和二十多个分支冲突，必须等合并完再做 |
| P3 | **NPC 对话、小知识按需加载**。`npcs.ts` 拆成「名字和日程」与「对话」两部分；`facts.ts` 只在今天页空闲时加载 | 约 35–40 KB | 中。NPC 互动结果要等一次 `import()`；小知识晚一点出现 |
| P4 | **插图出 720 宽的版本，加 `srcset`**。生成 `-720.webp`，写进 manifest，`<img srcset="…-720.webp 720w, ….webp 960w" sizes="100vw">` | 抽样测得 640 宽、q75 只有原来的 44%；720 宽估计在 50–55%。120 张约 11 MB，大部分手机能少下载一半左右 | 低到中。图片和 manifest 要和 `claude/earth-cg-screens` 的 97 张新图一起处理，所以等它合并后再统一生成一遍。生成脚本应该放进 `tools/earth/comfyui/` 的出图流程里 |
| P5 | **今天页顶部的地点图不用 lazy**。它在首屏可视范围内，改成 `loading="eager" fetchpriority="high"`，加上 `decoding="async"` | 今天页的主图早出现约 100–300ms | 低。但同一行代码 `cg-screens` 分支也在改，所以合并后再做 |
| P6 | **同一帧里的多次重绘合并成一次**。`render()` 改成先标记、再用 `requestAnimationFrame` 统一画 | 一次动作后接连调用两三次 `render()` 的情况，只画一次 | 中。有些代码在 `render()` 之后马上去找 DOM 里的按钮、设焦点，要逐处检查 |
| P7 | **省流量或网络慢时默认用手绘地图**。`navigator.connection.saveData` 为真，或 `effectiveType` 是 2g、3g 时，真实地图默认关闭，点一下才加载 | 慢网络的玩家第一次打开出行页少下载约 435 KiB 以上 | 低到中。是体验上的取舍（真实地图是卖点），要用户拍板 |
| P8 | **存档 DO 就近放置**。确认现在 `SAVES_ROOM` 在哪个机房；新建 DO 时用 `locationHint: 'oc'`（大洋洲） | 如果现在不在澳洲，每个动作能少 100–200ms | `locationHint` 只对新建的 DO 有效，现有存档要迁移，风险高。先在线上记下 `cf.colo` 看清楚再决定 |
| P9 | **按玩家分存档 DO**（`idFromName('save:' + 哈希 % N)`） | 消除全服存档串行这个瓶颈（现在人少，影响不大） | 高。要迁移数据；跨玩家的交易、共同事件要重新设计 |
| P10 | **地球人生 API 拆成独立 Worker** | Worker 冷启动更快（不用加载 Astro 和百家乐） | 高。要拆部署和路由，收益只在冷启动的那一次 |
| P11 | **真实地点数据瘦身**（去掉统一的 `source: "osm"`，id 去掉 `osm-node-` 前缀） | 原始约 -15%，gzip 后只省约 5%（重复字符串本来就压得很好） | 低，但不值得：数据校验和来源要求（AGENTS.md 第 6 条）都要跟着改 |

建议的顺序：本批的落地项先合并；一轮分支合并完以后做 P1、P3（只拆数据，改页面不多）；再做 P2；P4、P5 跟着 cg-screens 一起做；P7 和 P8 先问用户。

## 三、首屏体积上限的统一（2026-11-20 用户选定方案甲）

### 3.1 现状

2026-11-20 用 `tools/earth/bundle-report.mjs` 量了各个工作区（量的是工作区当前的内容，大多已经提交）。口径和 `bundle.test.ts` 一样：esbuild 压缩后、未 gzip。首屏 = 入口加它静态 import 的分块（几个分支已经把测试改成这个算法，main 的测试只量入口；目前所有分支都只有一个入口文件，两种算法结果相同）。

| 分支 | 首屏（字节） | 比 main 多 | 其中更新日志 | 该分支写的上限 |
| --- | --- | --- | --- | --- |
| main | 392,671 | — | — | 400,000 |
| **claude/earth-perf（本分支）** | **382,101** | **-10,570** | 移出首屏 | 400,000（不改） |
| claude/earth-pets-wildlife | 412,152 | +19,481 | 1,015 | 415,000 |
| claude/earth-gps-route | 411,959 | +19,288 | 706 | 420,000 |
| claude/earth-onboarding | 407,565 | +14,894 | 1,157 | 420,000 |
| claude/earth-live-social | 407,494 | +14,823 | 822 | 420,000 |
| claude/earth-quests | 405,835 | +13,164 | 720 | 420,000 |
| claude/earth-weather | 404,186 | +11,515 | 647 | 410,000 |
| claude/earth-social-npc | 402,886 | +10,215 | 744 | 420,000 |
| claude/earth-save-sync | 401,807 | +9,136 | 718 | 410,000 |
| claude/earth-economy | 400,841 | +8,170 | 622 | 410,000 |
| claude/earth-transport | 400,598 | +7,927 | 627 | 420,000 |
| claude/earth-education-career | 399,350 | +6,679 | 349 | 400,000 |
| claude/earth-shop-items | 398,374 | +5,703 | 526 | 400,000 |
| claude/earth-i18n | 398,326 | +5,655 | 384 | 400,000 |
| claude/earth-analytics | 397,601 | +4,930 | 431 | 400,000 |
| claude/earth-audio | 397,342 | +4,671 | 562 | 400,000 |
| claude/earth-activity-attrs | 395,659 | +2,988 | 903 | 400,000 |
| claude/earth-home-vehicle | 395,406 | +2,735 | 672 | 400,000 |
| claude/earth-start-ui | 395,373 | +2,702 | 363 | 400,000 |
| claude/earth-cg-screens | 395,235 | +2,564 | 601 | 400,000 |
| claude/earth-map | 394,796 | +2,125 | 499 | 400,000 |
| claude/earth-main-ui | 393,778 | +1,107 | 525 | 400,000 |
| claude/earth-security | 393,234 | +563 | 323 | 400,000 |
| claude/earth-npc-portraits | 393,191 | +520 | 232 | 400,000 |
| claude/earth-initial-stats | 393,092 | +421 | 0 | 400,000 |
| claude/earth-gps-anticheat-3d8db4 | 392,871 | +200 | 0 | 400,000 |
| claude/earth-feature-spec、claude/earth-monetization | 392,671 | 0 | 0 | 400,000 |

「其中更新日志」是该分支在 `changelog.ts` 里新增的源码字节数，用来估计本分支把更新日志移出首屏以后能省多少。

### 3.2 合并后预计

各分支改的大多是不同的功能，增量基本可以相加（重复的部分很少，比如两个分支加了同一个工具函数）：

- **全部合并、不含本分支**：392,671 + 172,176 ≈ **565 KB**（gzip 约 170 KB），比 main 涨 44%。
- **全部合并、含本分支**：再减去 main 上的更新日志 10.6 KB 和各分支新增的更新日志约 14 KB，约 **540 KB**（gzip 约 163 KB）。
- 现在各分支写的 400 / 410 / 415 / 420 KB **全都会超**，单是 pets-wildlife 加 gps-route 两个分支一起合并就到约 431 KB。「合并时取最大的那个上限」这个做法行不通。
- 按 §1.6 的估算，540 KB 的 esbuild 口径约等于 Vite 产物 420 KiB、gzip 约 160 KiB。低端机上的解析和执行时间会从 0.5–1.0 秒涨到约 0.7–1.4 秒，老玩家看到内容大约晚 0.3–0.5 秒。

### 3.3 可选方案

| 方案 | 做法 | 好处 | 代价 |
| --- | --- | --- | --- |
| **甲：两步走（建议）** | 合并期间：上限临时设成「全部合并后实测 + 3%」（预计约 560,000），在测试里写明这是临时值。合并结束后立刻做 P1 加 P3（约 -95 KB，加上本分支约 -120 KB），把上限降到 **450,000**（565 − 25 更新日志 − 60 事件正文 − 35 NPC 和小知识 ≈ 445 KB），同时加一个 gzip 上限 **140,000** | 合并不会被体积卡住；之后有一个明确、能做到的目标；gzip 上限反映玩家实际下载的量 | 中间有一段时间首屏比现在大约 40% |
| 乙：保持硬线 | 上限定在 420,000 不动，先把 P1 合进 main，其他分支 rebase 以后再合并 | 首屏一直不变大 | 合并要排队，P1 要先做；P1 会和加事件的分支冲突 |
| 丙：只提高上限 | 直接改成 600,000 | 最省事 | 测试就失去了防回退的作用；首屏会一直涨下去 |

不管选哪个，都建议：

1. 上限只在一个地方定义（`bundle.test.ts` 的 `FIRST_SCREEN_MAX`）。合并时以最后合并的那次实测为准，不要「取各分支里最大的那个」。
2. 首屏统一按「入口加静态分块」来算（已经有几个分支这样改了）。
3. 新的大块数据默认按需加载，进首屏要在 PR 里说明理由。

### 3.4 决定和执行（方案甲）

2026-11-20 用户选了方案甲。本分支已经改好 `tests/earth/bundle.test.ts`：

| 阶段 | 原始（esbuild 压缩后） | gzip | 什么时候 |
| --- | --- | --- | --- |
| 第一步：合并期间（临时） | **560,000** | **175,000** | 现在。这个数是按「全部合并约 540 KB + 3%」估的 |
| 第一步收尾 | 实测 + 3% | 实测 + 3% | 合完最后一个分支后，用 `node tools/earth/bundle-report.mjs` 重量一次，把两个数改成实测加 3% |
| 第二步：拆分以后 | **450,000** | **140,000** | 做完 P1（事件正文按需加载）和 P3（NPC 对话、小知识按需加载）以后 |

同时：

- 首屏统一按「入口 + 它静态 import 的分块」计算，动态 `import()` 的分块不算。
- 测试里写明了这是临时值，以及下一步要做什么。
- 本分支现在的首屏是 382,101 字节，gzip 119,181 字节，离临时上限还有很大余量。在第二步之前，新功能也不要把大块数据静态地放进首屏（见 §3.3 的第 3 条建议）。

## 四、合并注意事项

本分支改的地方都很小，和其他分支只会有行级冲突：

- `src/pages/earth.astro`
  - import 区删了 `changelog.ts`、`news.ts` 两行，加了一行 `setHtml`。
  - 6 处 `xxx.innerHTML = …` 改成 `setHtml(xxx, …)`：顶栏、地图、标签栏、面板、事件弹窗 2 处。`claude/earth-main-ui` 改过 `renderPanel` 的页面表达式，`claude/earth-onboarding` 改过事件弹窗的 kicker，合并时保留对方的内容，外面再包上 `setHtml(…)`。
  - `panelMe` 里「新」标记那两行、`panelNews` 前面那段按需加载的代码。
- **合并后要检查一遍**：顶栏 `#hud`、标签栏 `#tabs`、地图 `#map`、面板 `#panel`、弹窗 `#modal` 这几个元素，有没有其他分支直接写 `innerHTML` 或者往里面插节点（`grep -n "innerHTML =" src/pages/earth.astro`）。如果有，改成 `setHtml`，否则内容相同时会误跳过重绘。
- `src/game/ui/basemap.ts`：只改了 `loadMapLibre`，新增 `addHeadLink`、`BASEMAP_ORIGIN`。
- `public/earth/sw.js`：`refreshFrom` 开头加了几行。其他分支如果把 `VERSION` 改大了，保留对方的版本号。
- `tests/earth/bundle.test.ts`：上限改成方案甲的临时值，首屏改为「入口 + 静态分块」，加了 gzip 上限，「不许进首屏」名单加了更新日志。其他分支也改过这个文件（420KB、410KB、改成入口加分块的都有），合并时**以本分支为准**，丢掉各分支自己的上限数字。
- `src/game/data/changelog.ts`：顶部加了 v41，照常冲突，保留所有条目、按 v 排好。
- 新文件：`public/_headers`、`src/game/ui/dom.ts`、`tests/earth/perf.test.ts`、`tools/earth/bundle-report.mjs`、本文。
