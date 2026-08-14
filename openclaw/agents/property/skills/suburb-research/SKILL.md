---
name: suburb-research
description: 澳洲（重点西澳/珀斯）suburb 投资研究的数据源分层、指标体系与引用纪律。当用户查询任何区域画像、对比区域、或要求投资评分时使用。
---

# Suburb 研究：数据源分层与指标体系

## 数据源分层（严格按层使用，2026-07 核实）

**T1 · 可编程官方源（优先，开放许可 CC BY）**
- **ABS Data API**（api.data.abs.gov.au，SDMX，免 key）：人口、收入、租购比（Census QuickStats，当前 2021 版；2026 普查结果 2027 年中起发布）；building approvals（LGA 级，供应管线）
- **RBA**（rba.gov.au）：cash rate 与 F 系列利率 CSV——所有现金流测算的利率锚

**T2 · 免费专业源（低频按需引用 + 署名 + 数据日期）**
- **REIWA**（reiwa.com.au，WA 王牌）：suburb profile 月更——中位价、成交量、selling days、租金、增长率
- **SQM Research**（sqmresearch.com.au，邮编级 CSV）：空置率（2005 起）、Stock on Market、Asking Prices、implied yield——市场温度计
- **Cotality**（原 CoreLogic，2025 改名）：Daily/Monthly Home Value Index 免费发布——城市级基准
- **YIP top-suburbs 页**：免注册的 suburb 级交叉验证源
- **onthehouse.com.au**（Cotality 旗下）：免费查询单一地址的估值区间与成交/挂牌历史——物业级尽调的首选免费源（引用时注明为自动估值 AVM 口径，非评估师估值）
- **PropTrack**（REA 集团旗下）：月度 Home Price Index 报告免费发布——城市级第二基准，与 Cotality HVI 交叉验证

**T3 · API 源（有 key 时启用）**
- **Domain 官方 API**（developer.domain.com.au，免费档限流）：listings、sales results、suburb performance；引用需署名

**❌ 禁用**
- realestate.com.au 自动化抓取（ToS 明文禁止，有诉讼先例）——其数据经由 **PropTrack 免费月报**引用，或人工查阅其 suburb profile 页后署名转述；Domain 公开页同样禁爬（走官方 API）
- 任何无法给出来源链接的数字

## 指标 × 来源对照（回答时按此取数）

| 指标 | 首选 | 交叉验证 |
|---|---|---|
| 空置率 | SQM（邮编级） | REIWA / YIP |
| Selling days (DOM) | REIWA | SQM / Domain API |
| 在售库存 | SQM Stock on Market | REIWA 挂牌量 |
| 租金回报 | SQM implied yield / REIWA | YIP / Cotality 月报 |
| 中位价与 10 年增长 | REIWA suburb profile | Cotality HVI / PropTrack 月报 / Domain API |
| 供应管线 | ABS building approvals | data.wa.gov.au 规划层 |
| 人口 / 收入 / 租购比 | ABS QuickStats | Microburbs |
| 单一物业估值与历史 | onthehouse（AVM 口径） | Landgate 单址报告（小额付费） |
| 利率环境 | RBA | — |

## 珀斯特殊口径（专业细节，答错会露怯）

- **珀斯以私约（private treaty）为主**，Domain 每周拍卖清空率**不覆盖 Perth**——绝不给珀斯编造「清空率」；市场热度用 **selling days + 挂牌量变化 + 空置率** 三件套替代
- WA 成交明细（Landgate Sales Evidence）为付费数据；免费层用 REIWA sold 口径并注明

## realestate.com.au 深链自动附带（每次 suburb 输出必带）

数据不爬 REA 页面（见禁用清单），但**每次区域查询的输出末尾自动拼接官方深链**，客户点开即达：

- 区域画像：`https://www.realestate.com.au/neighbourhoods/<suburb>-<postcode>-wa`
- 在售列表：`https://www.realestate.com.au/buy/in-<suburb>,+wa+<postcode>/list-1`
- 成交记录：`https://www.realestate.com.au/sold/in-<suburb>,+wa+<postcode>/list-1`

（`<suburb>` 小写、空格转 `+`；示例 Willetton 6155 → `.../neighbourhoods/willetton-6155-wa`）。
物业级尽调时同样附 onthehouse 单址页链接。定位：深链是「自动连接 REA」的合规形态——
链接引流到 REA 官方页，引用数字仍取自 PropTrack 月报等许可来源。

## 输出纪律

1. 每个数字后随行标注：`（来源，数据截止 YYYY-MM）`
2. 两源冲突时并列呈现并说明口径差异，不擅自取舍
3. 数据超 60 天必须重新核实；查不到写「暂无公开数据」
4. 投资评分（如给出）必须展示打分项与权重，不给黑箱分数
5. 末尾固定 disclaimer 行（见 AGENTS.md）
