# 平衡调试工具

> 给开发者和 Codex 做平衡分析用，不对玩家开放。
> 分支 `claude/earth-balance-tools`，从 main `4f9c9e5` 开出。
> 代码：`tools/earth/balance/`（模拟器、系统开关、导出、A/B、基线、待平衡面板）、`src/game/dev/` + `tools/earth/gm/`（GM 控制台）、`tools/earth/balance/earth-balance.workflow.yml`（PR 检查的模板，还没启用）。
> 测试：`tests/earth/balance-tools.test.ts`、`tests/earth/gm.test.ts`。变异检查：`python3 tools/earth/balance/mutate.py`。
> 按 AGENTS.md，这批工具只负责产出数据。平衡结论由 Codex 下，用户拍板；本文和代码里都不判断哪个数值该改。

## 0. 做之前的状况

- `npm run earth:sim`（`tools/earth/balance/sim.ts`，一个 630 行的脚本）：十几种机器人策略各跑 N 天 × M 个种子，输出 markdown 报告，内容包括现金、净资产、心情、晕倒、升职、能力、按动作键算的净现金流，以及背包客和共同事件的诊断。它只能整体跑，不能单独关掉某个系统；没有结构化输出；现金流只记净额，看不出投放了多少、回收了多少。
- `docs/earth-game/balance.md`、`balance-report.md`：Codex 每一轮都要手工比对报告表格，判断数值有没有变。
- 「待平衡」标记分散在代码注释里：main 上的 `src/game` 有 25 行，各分支加起来更多（社交分支 41 行、经济分支 28 行）。写法各不相同，没有清单。
- 没有 GM 手段。要测「有钱时」「某个季节」「某个事件」，只能写测试或者手工玩到那一步。
- 统计分支 `claude/earth-analytics`（PR #50）统计的是线上流水，键是 `eco.in.<动作类型>` 和 `eco.out.<动作类型>`。它不统计共同事件、玩家交易和周目标领奖。本文 §2.4 的离线流水沿用同一套键，两边可以直接对照。

## 1. 边界

| 工具 | 谁用 | 在哪跑 | 能不能碰线上 |
| --- | --- | --- | --- |
| 模拟器扩展、A/B、导出 | 开发者、Codex | 本机命令行、CI | 不能。纯离线，走 `applyAction()` |
| 待平衡面板 | 开发者、Codex | 本机命令行 | 不能。只读源码文本 |
| GM 控制台 | 开发者 | 本机命令行；`astro dev` 下的 `/earth/gm` 沙盒页 | 不能。设计上就不接服务端，见 §4.1 |
| 回归基线 | CI、开发者 | GitHub Actions（PR）、本机 | 不能。工作流只有读权限，不部署 |

## 2. 模拟器扩展

### 2.1 改法：sim.ts 原地加几行

第一版曾把 sim.ts 拆成库加命令行两个文件。后来查到至少 9 个已提交的并行分支在改 sim.ts：cooking、economy、health、tax、volunteer、flatmates、disasters、backpacker-baseline、auto-50；兄弟会话的交接记录显示，career-stats、paperwork、side-business 等也在改。拆分会让这些分支合并时整块冲突，所以改回原地插入：

- 新逻辑放在三个新文件里：`systems.ts`（系统开关和流水记账）、`report.ts`（导出、A/B 表、基线对比）、`ab.ts`（A/B 起两个子进程）；
- sim.ts 只加 65 行、改 1 行（文件头的用法说明），插在别的分支没动过的位置；
- 机器人的流水不放进 `Bot.stats`，单独存在一个 `WeakMap` 里，`interface Bot` 和 `runBot` 的初始化都不用改；
- 「关掉事件」放在 `tryAct` 里处理（在动作抽中事件的那一刻丢掉），`step()` 不用改，因为 health 和 tax 分支都改了 `step()` 开头。

**默认输出不变**：不加新参数时，报告和改之前逐字节相同。验证结果如下：

| 运行 | 结果 |
| --- | --- |
| `npm run earth:sim -- --days=180 --runs=100` | 和 main 上原版输出 `cmp` 一致（8,363 字节） |
| `--days=60 --runs=20`、`--days=20 --runs=3` | 一致 |
| `--origins --days=30 --runs=5`、`--origins --days=10 --runs=2` | 一致 |

### 2.2 系统开关和 A/B

```bash
npm run earth:sim -- --list-systems                         # 列出能关的系统
npm run earth:sim -- --off=events,coop                      # 关掉再跑，报告末尾注明关了什么
npm run earth:sim -- --ab=courses --days=90 --runs=40       # 全开 vs 关掉 courses，同样的种子
npm run earth:sim -- --ab=events --format=csv --out=ab.csv
```

| id | 系统 | 关掉的含义 |
| --- | --- | --- |
| `events` | 随机事件 | 动作抽中的抵达或到店事件直接丢掉，不结算任何选项 |
| `coop` | 共同事件 | 带 coop 假设的策略不再做共同事件 |
| `courses` | 课程 | 不发起 `course` |
| `furniture` | 家具 | 不发起 `furniture` |
| `experience` | 体验 | 不发起 `experience` |
| `property` | 房产 | 不发起 `property`（买房、搬进自有房） |
| `vehicle` | 车辆 | 不发起 `vehicle` |
| `rent` | 租房 | 不发起 `home rent` |
| `social` | NPC 社交 | 不发起 `npc` |
| `shop` | 商店 | 不发起 `buy` |
| `gigs` | 零工 | 不做 work-mine、work-farm、work-cafe、busk |
| `charity` | 免费餐 | 不吃 charity-meal、charity-dinner |

- 实现方式：`systems.ts` 的 `systemOf(action)` 把动作归到系统，sim.ts 的 `tryAct` 在调用 `applyAction` 之前拦截。拦下的次数记在结果的 `blocked` 字段里（每人平均）。注意它统计的是**尝试次数**：机器人每一步都会重新尝试，所以数字会比真实需求大，只适合确认「确实拦到了」。
- A/B 起两个子进程（`ab.ts`），一个全开，一个关掉指定系统，其余参数相同。两边种子相同，差异只来自被关掉的系统，以及关掉后机器人行为路径的连锁变化。
- **关掉 ≠ 这个系统不存在**：机器人不发起这类动作，但引擎里的效果仍然存在。例如关了 `rent`，没房的人在引擎里照样按无房规则结算。

### 2.3 第一版不做的

| 不做 | 原因 | 要做时怎么做 |
| --- | --- | --- |
| 关天气、需求衰减、周结算 | 这些在引擎内部，模拟器外面关不掉 | 要在 `src/game/core` 里加开关参数，属于改引擎，必须另开分支并补测试 |
| 关某个具体事件或职业 | 粒度太细，第一版先按系统 | 在 `SYSTEMS` 里加一项，再给 `systemOf` 加判断 |
| 并行跑多组变体 | 一次 A/B 正好两组；需要多组时，用 `--off` 跑几次再合并 CSV | 以后需要再说 |

### 2.4 导出和经济流水

```bash
npm run earth:sim -- --eco                          # 报告末尾加「经济流水：投放与回收」表
npm run earth:sim -- --format=json --out=r.json
npm run earth:sim -- --format=csv --only=barista,idle
```

- **投放**是一个动作让现金增加的部分（工资、零工、事件奖励、卖东西）；**回收**是让现金减少的部分（吃、住、行、房租、学费、买东西）。两者都按动作类型 `a.t` 汇总，键名和统计分支的 `eco.in.<类型>`、`eco.out.<类型>` 一致；另外按 sim.ts 的动作键（activity 按活动 id）再汇总一份细表。共同事件记在 `coop` 下，线上统计没有这一项（见 §0）。
- 口径和原报告「钱从哪来」一致：动作途中扣掉的周租、物业费，算在那个动作头上。
- 自洽检查（有测试）：投放合计 − 回收合计 = 各动作键净现金之和；按类型汇总和按动作键汇总的总额相等。
- **JSON**：`{ variant, days, runs, origins, off, plans: [{ id, name, metrics, skills, flow, eco: { in, out, inDetail, outDetail }, blocked }] }`。A/B 时是两个这样的对象组成的数组。`metrics` 里现金和净资产取中位数；晕倒、升职等取每人平均；`ecoIn`、`ecoOut`、`flow`、`eco.*` 都是每人每天的美元数。
- **CSV**：长表，只有 `variant,plan,section,key,value` 五列。section 取值有 metric、skill、flow、eco_in、eco_out、eco_in_detail、eco_out_detail、blocked。一种格式就能同时装下单次结果和 A/B，用透视表打开即可。

## 3. 待平衡面板

```bash
npm run earth:tuning                     # markdown：按系统分组
npm run earth:tuning -- --format=csv --out=tuning.csv
npm run earth:tuning -- --format=json
npm run earth:tuning -- --dir=src/game,tools
```

- 扫描 `src/game` 下所有含「待平衡」的行，每行算一项（有测试保证不多不少）。纯文本扫描，不 import 游戏模块，所以各分支的数据结构不同也能扫。
- 每项给出：**系统**（按文件名映射，见 `SYSTEM_BY_FILE`，没映射的直接用文件名，新文件不会被漏掉）、**位置**（文件:行）、**范围**、**当前值**（那一行去掉注释后的代码）、**数字**（这一行里的数字，字符串里的数字不算）。

| 范围 | 认法 | 当前值取哪 |
| --- | --- | --- |
| 这一行 `inline` | 标记写在代码行尾的注释里，或者写在这一行的字符串里 | 这一行 |
| 下一行的声明 `decl` | 独立注释，后面紧跟一个声明或对象属性 | 下一行 |
| 这一段 `block` | 数组中间的分段注释，比如「第 24 轮新增，待平衡」 | 下一条数据。遇到多行对象，往下拼到第一个 `}` 为止，最多 6 行 |
| 字段 `field` | 写在类型字段的注释里，比如 `chance: number; // …待平衡` | 没有单一的值，每条数据各不相同 |
| 整个文件 `file` | 写在文件开头的说明注释里 | 没有单一的值，要打开文件看 |

- 在其他分支的工作区上试过：weather 27 行、economy 28 行、social-npc 41 行，扫出来的项数和 `git grep` 的行数都对得上。
- **建议今后统一写法**：把「待平衡」写在数值所在那一行的行尾注释里，例如 `price: 40, // 待平衡`。这样面板能直接取到当前值。整段、整个文件的标记只能告诉 Codex 去哪里看。
- 顺带发现一个问题（没有改）：`src/game/data/items.ts:21` 鱼竿的 `desc` 里写着「（数值待平衡）」，这是**玩家看得到的文案**。要不要删，留给负责商店和物品的分支处理。

## 4. GM 控制台（仅开发环境）

### 4.1 设计

- **只改本地沙盒存档，不接服务端。** 游戏状态只能由服务端的 `applyAction()` 改变（AGENTS.md 审查第 4 条）。如果要给线上存档加 GM 接口，就得在 Worker 或 DO 里加一个绕过规则的入口，这个入口会跟着生产包一起发布。所以不做。GM 改出来的存档只存在于命令行文件或浏览器的 `localStorage`（键 `earth-gm-sandbox`），不会被同步上云。
- 核心是 `src/game/dev/gm.ts`，和 core 一样是纯函数：不改入参，返回新存档；每次修改都会写一条 `[GM] …` 日志；改完的存档会再过一遍 `sanitizeState()`，校验不通过就放弃这次修改。

| 命令 | 作用 |
| --- | --- |
| `cash=5000`、`cash+=300`、`cash-=300` | 改现金，范围钳在 0 到 10 亿，取整 |
| `skip=2d`、`skip=1d6h30m`、`clock=2000` | 直接改时钟，**不结算**这段时间（不扣需求、不收租、不发工资）。用来看某个时段、季节或节日 |
| `pass=1d` | 反复「歇一会儿」，按规则把时间过掉，需求、房租、工资都照常结算。碰到事件就停下。单次最多 60 天，更长的用模拟器 |
| `event=<id>` | 让事件立刻出现，挂到 `pending` 上。已有待选事件时拒绝 |
| `choose=<序号>` | 选择事件选项，走 `applyAction` |
| `act=<动作 JSON>` | 按规则做一个普通动作，和服务端走同一条路径 |

### 4.2 两个入口

```bash
npm run earth:gm -- --new=student cash=5000 event=heat-check --out=sandbox.json
npm run earth:gm -- --save=sandbox.json choose=0 pass=1d --out=sandbox.json
npm run earth:gm -- --list-events
```

- **命令行**（`tools/earth/gm/gm.ts`）：可以新建角色，也可以读一份存档 JSON（「导出我的数据」那种外面包了一层的文件也能读）。逐条执行命令，最后打印状态。只要有一条失败，退出码就是 1，方便 Codex 写进脚本。
- **沙盒页 `/earth/gm`**（`src/game/dev/gm-page.astro`）：提供新建、导入、导出、改现金、跳时间或快进、按列表触发事件、选择选项、自由命令。插值全部经过 `esc()`。页面不在 `src/pages` 下，不会被自动路由。

### 4.3 生产环境为什么完全不可用（三道闸）

1. **路由只在 dev 注入**：`tools/earth/gm/integration.mjs` 的 `astro:config:setup` 钩子只在 `command === 'dev'` 时调用 `injectRoute`；`build`、`preview`、`sync` 什么都不做。生产构建里根本没有这条路由，页面和 `gm.ts` 也就不会被打包。
2. **页面自己挡一道**：frontmatter 第一行是 `if (!import.meta.env.DEV) return 404`。如果有人用别的方式把页面挂了上去，构建时 `DEV` 会被编译成 `false`，后面的模板成了死代码被删掉（对照构建里实测，页面标记确实不在产物中）。
3. **线上入口不 import `src/game/dev`**：`src/pages`、`src/worker.ts`、`src/game` 下 dev 以外的所有文件都不得 import 它，有测试检查。

**测试证明**（`tests/earth/gm.test.ts` 最后一项，每次 `npm test` 都会跑，约 30 秒）：

- 真跑一次 `astro build` 到临时目录。扫描全部产物，查四种痕迹：页面标记 `__earth_gm_console__`、沙盒存储键 `earth-gm-sandbox`、命令解析文案「看不懂的命令」、路由 `earth/gm`。中文痕迹会同时查原文和 `\uXXXX` 转义两种写法，因为打包器会转义中文。还要求路径里没有 `earth/gm`。结果必须是零处。
- **对照组**：用一个只存在于测试里的集成，无条件注入 GM 页，再构建一次。同样的扫描必须能找到痕迹（实测命中了 `_astro/gm-page…js`、`_worker.js/pages/earth/gm.astro.mjs`、manifest 和 sitemap）。这证明扫描真的会失败，不是空跑。

**没验证到的**：`astro dev` 在这台机器的沙盒环境里启动时卡住（打印 DO 绑定警告后不再返回，和本改动无关），所以沙盒页没有在真实的 dev 服务器上打开过。能证明的是：页面和客户端脚本在对照构建里编译通过，dev 钩子会注入路由（单测）。第一次在本机用 `npm run dev` 打开 `/earth/gm` 时请看一眼。

## 5. 回归基线

```bash
npm run earth:baseline                     # 跑 60 天 × 20 种子，和 baseline.json 比；有差异退出码 1
npm run earth:baseline -- --update         # 确认是有意改数值：重写基线并一起提交
```

- `tools/earth/balance/baseline.json`：每种策略一行，存核心指标（现金、净资产、心情、晕倒、升职、破产占比、事件、共同事件、投放和回收合计），以及按类型的 `eco.in.*`、`eco.out.*`。数值四舍五入到 4 位小数，避免不同 Node 版本的浮点尾数造成误报。整次运行约 15 秒。
- 比较规则：容差为 0。任何指标变化都算差异；一边有、另一边没有的策略或指标也算；天数或种子数不同时直接报错。
- **PR 检查（还没启用）**：模板在 `tools/earth/balance/earth-balance.workflow.yml`。2026-11-21 合并时，本机 gh 授权没有 workflow 权限，推送 `.github/workflows/` 被 GitHub 拒绝；用户定先不启用。要启用就把它拷到 `.github/workflows/earth-balance.yml`。在那之前，改了数值的分支要在本机跑 `npm run earth:baseline`，基线有变就 `--update` 一起提交。
  启用后：PR 改动 `src/game/**`、`tools/earth/balance/**` 或依赖时触发。
  1. 和 PR 自己提交的 baseline.json 比较，不一致就失败。改了数值就必须连基线一起改，基线的 diff 就是这次平衡变化的清单。
  2. 和目标分支上的 baseline.json 比较，把变化表写进这次运行的 Summary，只报告，不判失败。审查者和 Codex 可以直接看。
  - 权限只有 `contents: read`：不部署、不推送、不评论。**这个工作流还没在 GitHub 上实际跑过**，启用后第一次开 PR 时要看一下它是否正常运行。
- 并行分支合并时：两个分支都改了数值的话，baseline.json 一定会冲突。**不要手工合并这个文件**，合并完代码后重跑 `npm run earth:baseline -- --update`。

## 6. 测试和变异检查

- `tests/earth/balance-tools.test.ts`（14 项，约 4 秒）：系统归类；结果的确定性；`--eco` 和 `--off` 对报告的影响；关掉事件和课程的效果（有全开时的对照）；流水的三条自洽等式；CSV 和 JSON 的格式；命令行的错误码；基线的取整、容差、口径和缺失项；提交的基线文件和工作流本身；面板的五种范围和全仓库的行数对账。
- `tests/earth/gm.test.ts`（8 项，约 30 秒，大部分时间花在两次构建上）：见 §4。
- 变异检查：`python3 tools/earth/balance/mutate.py` 一共 32 个变异，结果见下表。加 `--fast` 可以跳过需要构建的那两个。

| 范围 | 变异数 | 结果 |
| --- | --- | --- |
| 模拟器（开关、流水、默认输出、--only、--eco、A/B、参数校验、零工清单） | 12 | 全部杀死 |
| 导出与基线 | 5 | 全部杀死 |
| 待平衡面板 | 4 | 全部杀死 |
| GM（不改入参、钳值、跳时间与快进、事件、校验、坏 JSON、集成钩子、页面闸、线上 import、扫描转义） | 11 | 全部杀死 |

第一轮有 5 个变异存活，都是测试没覆盖到的情况：

- 关掉共同事件没有测试；
- `--eco` 吞掉了默认报告末尾的换行；
- 字符串里的数字混进了面板的「数字」一栏；
- GM 日志里写出了钳值之前的数；
- 「改完的存档不合法就放弃」这条路径没被走到。

补上对应的测试后，第二轮 32/32 全部杀死。

## 7. 和其他分支的关系

- **统计分支 `claude/earth-analytics`**：离线流水的键和线上统计一致（§2.4）。线上统计的缺口（共同事件、交易、周目标）不在本分支处理，写在那边的文档里。
- **改 sim.ts 的 9 个分支**（§2.1）：本分支只在 sim.ts 里插入了几段，合并冲突应该只会出现在相邻的插入点，按「两边都保留」处理即可。这些分支如果新增了策略，会自动出现在 JSON、CSV 和基线里；如果新增了报告小节，不影响导出。
- **加了「待平衡」标记的各分支**：面板不需要改就能扫到（§3）。新文件名没有映射时，系统一栏会显示文件名，到 `SYSTEM_BY_FILE` 里补一行即可。
- **`claude/earth-balance-r9`**（第九轮平衡）：只改数值，和本分支没有代码冲突。它合并后需要重写基线。
- 更新日志（`src/game/data/changelog.ts`）**没有加条目**：这批改动玩家完全感知不到。
