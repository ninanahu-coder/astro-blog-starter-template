# Codex 任务书：检查与分析

> 这份文件是给 Codex 的任务说明。Codex 负责**检查**和**分析**，产物是 PR 审查意见和分析报告；
> 不写游戏逻辑和前端（那是 Claude Code 的），不采集数据（那是 OpenClaw 的）。

## 任务一：审查每个 PR

在 PR 上评论 `@codex review` 触发，或在 Codex 里为本仓库开启自动审查。

- 按仓库根 `AGENTS.md` 的「Review guidelines」逐条检查，按严重程度排序。
- 先跑 `npm test` 和 `npm run check`，失败的直接指出。
- 数据类 PR（OpenClaw 产出的 `wa.pois.json` 等）：再跑 `npm run earth:pois -- --dry-run`，抽查 5 条坐标是否真在所写的地点、来源和许可是否写全。

## 任务二：数值平衡分析

每次有改动数值、经济或成长规则的 PR（Claude Code 会在 PR 描述里写明“需要 Codex 做平衡分析”），执行：

1. 在 PR 分支和 `main` 上各跑一次：

   ```bash
   npm run earth:sim -- --runs=100 --days=180
   ```

2. 对比两边的结果，重点看：

   | 指标 | 目标 | 越界时 |
   | --- | --- | --- |
   | 咖啡店上班族买房时间 | 第 70–98 天 | 说明是太快还是太慢，指出最可能的原因 |
   | 有工作的策略的断供、被收房次数 | 0 | 必须指出 |
   | 对照组（什么都不干）晕倒次数 | 60 天 ≤ 1 | 必须指出 |
   | 各策略平均心情 | 40–75，不能长期贴着 0 或 100 | 指出是哪个来源造成的 |
   | 第 1 / 2 次升职 | 第 1 次 ≤ 第 15 天；第 2 次 第 30–60 天 | 说明卡在能力还是声望 |
   | 矿工净资产 / 上班族净资产 | ≤ 3 倍 | 给出调整建议 |
   | 买了马上卖（车、家具、房） | 一定亏钱 | 有套利就是严重问题 |

3. 结论写进 `docs/earth-game/balance.md`，新起一节「第 N 轮」，写：改了什么、前后对比表、哪些指标越界、建议怎么调（给出具体数值和文件位置）。
4. 用新结果覆盖 `docs/earth-game/balance-report.md`：

   ```bash
   npm run earth:sim -- --runs=100 --days=180 --out=docs/earth-game/balance-report.md
   ```

调参建议只写在报告里，**不要直接改数值**：数值改动由 Claude Code 按报告实施，再由 Codex 复核。

## 任务三：OpenClaw 数据的分析

OpenClaw 每交一批数据后：

- 统计每个地点的 POI 数量，指出少于 5 个的地点。
- 检查有没有明显重复的 POI（名字相近、坐标相距 < 100 米）。
- 检查节日日期（`src/game/data/festivals.ts`）和体验描述（`experiences.ts`）里提到的真实地标、活动，与 OpenClaw 采集到的资料是否矛盾，列出需要修改的条目。

结果作为 PR 评论提交即可。
