# 保险系统

分支 `claude/earth-insurance`（从 main `4f9c9e5` 开出），2026-11-23 合并 main `7664905`，更新日志改为 v78。合并时改了什么见 §10：**健康险去掉了**（看病跟签证的保障走，见 `health.md`），**自然灾害还没接理赔**。

标记说明：**【现状】** 是 main 上已有的；**【本批实现】** 是这个分支写进代码的第一版；**【提议】** 只是设计，没写代码。
所有新数值都是**待平衡**：保费、免赔额按下文的真实价格折算，事件的权重和损失金额是游戏设定，没有真实出处，交 Codex 跑模拟分析。

---

## 1. 现状

| 东西 | 在哪 | 现在怎么算 |
| --- | --- | --- |
| 车辆「保险保养」 | `data/vehicles.ts` 的 `weekly`，`engine.ts` `weeklyTick()` | 每周结算一笔（摩托 $15、轿车 $25、四驱 $40、露营车 $60），名字叫「保险保养」，没有区分保险种类。付不起不收车，麻烦值 +8 |
| 抛锚 | `breakdownChance()`、`data/events.ts` 的 `breakdown` 事件 | 离上次保养超过 5,000 公里后，每趟自驾抵达按几率抛锚；叫拖车、换电瓶的钱全自付 |
| 晕倒住院 | `engine.ts` `collapse()` | 医药费 $100 + 现金 10%，最多 $500，全自付 |
| 袋鼠撞车 | 事件 `roo-dusk` | 检定失败扣 $300（「车要修」）。事件按 `arrivedBy: road/track` 触发，**坐巴士的人也会抽到并扣钱**（小毛病，见 §9） |
| 风暴 | `data/weather.ts` | 风暴天关海上活动，不造成财产损失 |

另一个分支 `claude/earth-home-vehicle`（未合并）的 `home-and-vehicle.md` §2.2 提议把 `weekly` 拆成 `rego`（牌照 + 强制险）和 `insurance`（车损险，可选），并查了西澳牌照费。本分支**没有拆 `weekly`**，避免和它冲突：CTP 在这里只当作「已含在每周车辆费用里」显示（§3.1）。两个分支合并后，rego 拆分落地时把 CTP 的说明改成指向 rego 即可。

## 2. 真实规定和价格

只写查到出处的数；查不到的写「未查」，游戏里另定并标待平衡。2026-11-20 查。

| 项目 | 数 | 出处 | 可靠度 |
| --- | --- | --- | --- |
| 西澳强制人身伤害险（MII，即西澳的 CTP） | 2026/27 轿车（class 1A）$520.50（不含 GST）；含 GST 和保险印花税约 $629.81 | 保险委员会 ICWA [Premium Schedule 2026-27](https://www.icwa.wa.gov.au/__data/assets/pdf_file/0016/122065/Premium-Schedule-26-27-FINAL.pdf)；交通部 [Motor injury insurance](https://transport.wa.gov.au/licensing/motor-injury-insurance.asp) | 中：两个官方页面自动抓取都被拒（403），数字来自搜索摘要；520.50 × 1.1 × 1.1 ≈ 629.8，和 home-vehicle 分支查到的第三方计算器数吻合 |
| 西澳 MII 随车辆牌照强制交 | — | 同上 | 高 |
| 南澳 CTP | 2025/26 都市私家车最低 $262.07（比上年 +$1.36）；2026/27 最低 $274.73 | 南澳州长 [媒体稿 2025-05-16](https://www.premier.sa.gov.au/media-releases/news-items/car-registration-up-by-just-1.7)；CTP Regulator [保费表](https://ctp.sa.gov.au/__data/assets/pdf_file/0008/816668/Table-SA-CTP-Premium-Classes-1-September-2026.pdf) | 2025/26 中高；2026/27 只见搜索摘要 |
| CTP 只赔人身伤害，不赔车和财物 | — | 西澳 ICWA、南澳 CTP Regulator 的说明 | 高（各州 CTP 制度的定义） |
| 车辆全险平均年保费（西澳） | 2025 年 $2,032（Canstar 2026 年报告把 2025 年改成 $2,148，2026 年 $2,208）；报价用的免赔额 $800–$1,000 | Canstar [Car insurance prices continue to accelerate](https://www.canstar.com.au/car-insurance/car-insurance-prices-continue-to-accelerate/)、[WA 比价页](https://www.canstar.com.au/car-insurance/compare/western-australia/) | 中：来自搜索摘要，未逐页核对 |
| 第三方财产险平均年保费 | $522（同一调研全险 $1,362） | Finder [How much is car insurance](https://www.finder.com.au/how-much-does-car-insurance-cost) | 中：全国数，不分州 |
| 第三方财产险免赔额 | **未查** | — | 游戏暂用和全险一样的 $800 |
| 家财险（租客 contents） | 西澳最便宜的平均年保费 $273；全国报价 $143（南澳）到 $1,270 以上 | CHOICE [Contents insurance for renters](https://www.choice.com.au/money/insurance/home-and-contents/buying-guides/contents-insurance-for-renters) | 中：年份和方法没在摘要里写清 |
| 家财险免赔额 | **未查** | — | 游戏暂用 $500 |
| 学生签证必须持有 OSHC | 学生签证（500）条件 8501：在澳期间一直保持足够的健康保险；留学生用 OSHC | 内政部 [Adequate health insurance factsheet](https://immi.homeaffairs.gov.au/supporting/files/adequate-health-insurance-factsheet.pdf)；联邦监察专员 [OSHC factsheet](https://www.ombudsman.gov.au/__data/assets/pdf_file/0025/88324/Factsheet_student_OSHC.pdf) | 高 |
| OSHC 单人年保费 | 大致 $600–$800（各比价网站互相矛盾，从 $478 到 $1,358 都有） | 例如 [student-insurance.com OSHC 比较](https://www.student-insurance.com/insurance/australia/oshc-compare/) | 低：都是二手比价站，没有官方价目表 |
| 国内旅行险 | 单人 7 天平均 $90（情侣 $123、家庭 $137），2025-10-31 更新 | CHOICE [Domestic travel insurance](https://choice.com.au/travel/money/travel-insurance/review-and-compare/domestic-travel-insurance) | 中高 |
| 国内旅行险出险率 | 2024-06 到 2025-05 有 6.34% 的保单出险，平均赔 $2,003 | Southern Cross Travel Insurance [新闻](https://scti.com.au/about-us/news/scti-domestic-travel-claims-more-expensive-than-international-over-summer) | 中：单一保险公司数据（本批只作参考，没用到数值里） |
| 车辆失窃 | 西澳 2025 年车辆失窃理赔数下降约 15% | 澳洲保险理事会 [2026-06 媒体稿](https://insurancecouncil.com.au/resource/victoria-still-leads-australias-car-crime-insurance-claims/) | 只有趋势；每千辆车的失窃率**未查**到可靠的近年数 |
| 出险后续保加价 | **未查**：各家规则不同（无赔款优待、评级） | — | 游戏设定 |
| 风暴临近时暂停出新单 | **未查具体条款** | — | 游戏的「新单等待期」是为了防止看天气预报再买，不是照某条真实规定 |
| 机械故障、磨损不在车险赔付范围 | 一般车险条款的除外责任 | **未逐家核对** | 游戏按「抛锚不赔」处理 |

## 3. 第一版设计【本批实现】

### 3.1 险种

数据在 `src/game/data/insurance.ts` 的 `POLICIES`，每项带 `source` 字段写出处。一期保费 = 真实年保费 ÷ 365 × 保期天数，取整。

| 险种 | id | 保期 | 一期保费（待平衡） | 免赔额（待平衡） | 赔哪些损失 | 新买等待 | 条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 强制第三者人身险（CTP） | `ctp` | — | 不能单独买 | — | 游戏里没有「伤到别人」的损失，所以不赔任何东西 | — | 有车时在保险卡里显示「已含」 |
| 第三方财产险 | `car-tpp` | 28 天 | $40（$522/年） | $800 | 赔别人的车和财物 | 0 | 有车 |
| 车辆全险 | `car-comp` | 28 天 | $156（$2,032/年） | $800 | 赔别人的 + 自己的车撞坏 / 被撬被偷 / 被风暴砸坏；自己车的损失最多赔到车的当前价值 | 2 天 | 有车 |
| 租客财产险 | `contents` | 28 天 | $21（$273/年） | $500 | 住处被盗、被风暴泡坏 | 2 天 | 有住处（租的或自己的） |
| 国内旅行险 | `travel` | 7 天 | $90 | $250 | 行李丢失 | 0 | 无 |

- 车价没按真实缩小（二手轿车 $4,500），而全险按真实平均年保费收，所以便宜车买全险一年要花掉小半辆车——这和现实里「老车只买第三方」的取舍一致，但是否合适留给平衡分析。
- 旅行险不管看病：澳洲国内旅行险一般不含医疗（本地人有 Medicare，留学生靠 OSHC）。游戏里看病的钱按签证带的保障算（`core/health.ts` `coverOf()`），不归这里的保险管（§10）。

### 3.2 保期、续保和等待期

- 买一期：网上办，不花游戏时间，有待处理事件时不能买。
- 已经有保单且还没到期（包括还在等待期）：从原到期日往后接一期，**不重新等**。
- 第一次买或已过期：从「今天 + 等待期」开始。车险全险、租客险等 2 天：天气是人人一样、能预报的（`weatherOn()`），不设等待期的话可以看到风暴预报再买。
- 最多续到今天之后 400 天（`COVER_AHEAD_MAX`，也是存档钳制上限）。
- 没有退保、没有按天退费（【提议】§9）。

### 3.3 理赔流程

`core/insurance.ts`，纯函数：

1. 事件选项的结果里写 `fx.loss: [{ kind, amount }]`（`Effect` 新字段），`applyEffect()` 在「付出在前」那一步逐笔调用 `settleLoss()`。
2. `assessClaim()` 在今天有效、赔这种损失的保单里挑免赔额最低的一张：
   - 没有对口保单：全额自付。
   - 有：可赔金额 = 损失（自己车的损失封顶到车的当前价值 `resaleValue()`），自付 = 免赔额（不超过可赔金额）+ 超出封顶的部分，其余保险付。
   - 损失不到免赔额：自己付，**不记理赔**。
3. 自付部分从现金扣，扣到 0 为止（和事件罚款一致，不欠债）。
4. 保险付了钱就在这张保单的 `claims` 记一笔（游戏日，最多 10 条）。
5. 日志写一句：损失多少、哪张保单赔了多少、自付多少。

续保加价：近 365 天内每理赔一次，下一期保费 +20%，最多 +60%（`CLAIM_LOADING`，游戏设定）。

### 3.4 出险事件

都在 `data/events.ts`，id 以 `ins-` 开头。车的意外写法律分支的 `driving: true` + `arrivedBy: ['road']`：只在自己开车（有车、驾照没暂停、走公路）抵达时抽，四驱土路自驾不抽。住处的意外写新字段 `exposure: 'home'`：只在回到自己住处所在地点时抽（`engine.ts` `atOwnHome()`，在 `pickArrivalEvent()` 的事件池里过滤；`event-rules.ts` 校验它只能写 `home`、不能配 `venueTypes`）。权重和金额都是游戏设定、待平衡。

| 事件 | 触发 | 权重 | 结果 |
| --- | --- | --- | --- |
| 追尾 `ins-rear-end` | 开车抵达城市 / 镇 | 2 | 驾驶检定 45；失败：自己车损 $1,800 + 赔对方 $2,500，健康 −5 |
| 车窗被砸 `ins-car-breakin` | 夜里开车抵达城市 | 2 | 车被撬 $700 |
| 冰雹 `ins-hail` | 风暴天开车抵达 | 3 | 驾驶检定 40；失败：车被砸 $1,500 |
| 家里被撬 `ins-burglary` | 回到自己住处 | 1 | 住处被盗 $1,200 |
| 屋顶漏水 `ins-roof-leak` | 风暴天回到自己住处 | 4 | 力量检定 40；失败：泡坏 $900 |
| 行李没出来 `ins-lost-bag` | 坐飞机抵达 | 2 | 行李丢失 $600 |


抛锚**不走保险**：抛锚是没保养造成的机械故障，车险一般不赔，拖车费照旧自付（【提议】道路救援附加险，§9）。

### 3.5 开局保单

哪个出身都没有。分支原来给留学生开局送一年 `health`；合并 main 后去掉了：留学生的 OSHC 由学生签证带来（`core/health.ts` `coverOf()`），见 §10。

## 4. 存档字段

按 `save-sync.md` §5：

- 新字段 `cover: Record<保单 id, { from, until, claims }>`：from / until 是游戏日（until 不含），claims 是理赔日列表。
- `createCharacter()` 给初值 `{}`；`sanitizeState()` 只加了一行 `cover: cleanCover(r.cover, 今天)`。
- `cleanCover()`：旧存档没有字段给 `{}`；只留数据表里能买的保单（CTP、未知 id、原型链上的键都丢）；日期取整、钳到 `[0, 今天 + 400]`，`from ≤ until`；理赔日钳到 `[0, 今天]`、排序、最多 10 条；幂等。
- 没改已有字段形状，没改 `SAVE_VERSION`，字段很小（几百字节）。没有秘密，`publicState()` 不用改。

## 5. 动作和界面

- 新动作 `{ t: 'insure', id }`（`core/actions.ts` 校验 id 形状，规则在 `core/insure.ts` `buyInsurance()`）。走 `applyAction()`，服务端结算。
- 「我 · 资产」在「工作与住处」和「背包」之间加了一张保险卡（`src/game/ui/insurance.ts`，页面只加了 import、一行卡片、一行点击分发）。每种保险显示状态（保障中到第几天 / 第几天起生效 / 未投保）、保期和保费（出过险显示已加价）、免赔额、等待期、赔什么；买不了的按钮禁用并写原因。卡片里所有文字都经过页面传入的 `esc()`。
- 新事件的插图：`tools/earth/comfyui/prompts.mjs` 加了 6 条提示词；`manifest.json` 暂时借用相近的旧图（追尾 → 路边临检、撬车 → 城市夜景、冰雹 → 冬季大浪、被撬 → 警察、漏水 → 躲雨、丢行李 → 搭便车）。**还没出图**，见 §9。

## 6. 模拟结果变化（下面是合并前对 main `4f9c9e5` 的结果；合并后重跑和 main 一字不差，见 §10）

`npm run earth:sim -- --days=180 --runs=100`，改动前（main `4f9c9e5`）和改动后对比。机器人不会买保险，只受新事件和「留学生自带 OSHC」影响；遇到事件选第一个能选的选项（急诊事件就是去急诊）。完整报告见 [insurance-sim.md](insurance-sim.md)。

只有两条策略有变化，其余策略（咖啡店、救生员、矿工、酒保、冲浪手……）所有指标逐字相同：这些机器人不自己开车进城、不坐飞机，住处事件的权重也小。

| 策略 | 指标 | 改动前 | 改动后 |
| --- | --- | --- | --- |
| 打零工的背包客（无房） | 第 60 天现金（中位） | $391 | $374 |
| | 第 60 天 10%–90% | $5–$492 | $0–$485 |
| | 期末净资产（中位） | $177 | $4 |
| | 晕倒 / 人 | 10.63 | 13.18 |
| | 破产天数占比 | 26% | 33% |
| | 事件支出（每人每天，美元） | −3 | −7 |
| 农场工（玛格丽特河，合租） | 第 60 天现金（中位） | $6,992 | $6,857 |
| | 第 60 天 10%–90% | $5,875–$8,052 | $5,141–$8,031 |
| | 期末净资产（中位） | $22,181 | $22,122 |

解读（只陈述现象，结论交 Codex）：

- 背包客变差主要来自「扭伤脚踝」：没有健康险，机器人总选去急诊，$450 对只有几百块的背包客是大头，之后更容易饿晕。真人玩家可以选硬扛。
- 农场工的事件支出每天不到 $1，没进收支表；第 60 天 10% 分位低了约 $700。它住合租、会碰到住处事件，但新事件进了抽取池以后随机序列也变了，这次没有单独拆开验证差异来自哪一边。
- 没有策略买保险，所以这份模拟**看不出保险值不值**。要评估保费，需要加「买保险」的机器人策略（【提议】§9）。

## 7. 测试和变异检查（合并前；合并后的见 §10）

`tests/earth/insurance.test.ts`，15 条：数据自洽、生效期边界、保费加价和上限、续保接期、理赔核算（封顶、免赔额、挑最低免赔额、等待期）、扣现金到 0、事件损失走保险、晕倒医药费走健康险、出险事件范围（含 400 个种子的抵达抽样：坐巴士永远抽不到车险事件，开车能抽到）、买保险动作（不改入参、各种不能买）、开局 OSHC、存档清洗（坏值、幂等、`sanitizeState` 接入）、保险卡（esc、禁用按钮）。

变异检查：对 `core/insurance.ts`、`core/insure.ts`、`engine.ts`、`actions.ts`、`character.ts`、`ui/insurance.ts` 的源码逐条注入 31 个变异（边界 `<`/`<=`、去掉上限、去掉条件、换排序、删掉接入点、去掉 esc……），每次只跑保险测试：**31/31 被测试抓到**。

第一轮有 5 个没抓到，补测试后全抓到：
- 挑最低免赔额的排序：现在两张车险免赔额一样，换排序结果不变（等价变异）；改成 `assessClaim` 可以传入数据表，用两张免赔额不同的假保单测。
- 理赔日排序：原测试数据顺序碰巧是排好的。
- 抵达抽事件时的 `exposedTo` 过滤：原来只测了函数本身，补了抽样测试。
- `sanitizeState` 是否真的调用 `cleanCover`。
- 一条变异的目标字符串写错了（没注入），改正后抓到。

写测试时还抓到一个真问题：车值封顶一开始对全险赔的所有损失都生效，连「赔别人的车」也被封到自己车的价值。已改成只封自己车的损失（`capByCar` 列出损失种类）。

## 8. 和其他分支的关系（合并前写的；下面这些分支都已经在 main，合并时的处理见 §10）

| 分支 | 关系 | 合并时注意 |
| --- | --- | --- |
| `earth-home-vehicle` | 它提议拆 `weekly` 为 rego + 车损险；本分支没拆，CTP 只做说明。它的 `resaleValue(id, km)` 加了里程参数 | 本分支在 `applyEffect` 里调用 `resaleValue(state.vehicle)`；合并后改成按里程的版本（传 `state.car.km`），车损封顶就按折旧后的车值 |
| `earth-economy` | `weeklyBudget()` 没算保险 | 保险是预付一期，不进每周结算；如果要在预算里显示，按「保费 ÷ 保期天数 × 7」折算 |
| `earth-initial-stats` | 出身表 | 只按出身 id 查 `START_COVER`，没改 `Origin`；新出身（比如打工度假）要不要自带 OVHC 由那边定 |
| `earth-health`（进行中） | 可能会改医疗、住院 | 本分支改了 `collapse()` 的医药费扣款（走 `settleLoss`）；那边如果改账单公式，保留 `settleLoss(state, { kind: 'medical', amount: bill }, …)` 这一行即可 |
| `earth-cg-screens` / CGI | 7 个新事件借用旧图 | 出图后把 manifest 里 7 项改成 `event-ins-*.webp` |
| `earth-weather` | 风暴天有 `road` 路况 | 冰雹、漏水事件按到达地当天天气抽，不依赖那边的字段 |
| 改 `engine.ts` 的分支 | 本分支在 `engine.ts` 只改了 4 处：import 一行、`collapse()` 两行、`applyEffect()` 一行、`pickArrivalEvent()` 一个条件 + 新函数 `exposedTo()` | `pickArrivalEvent` 那行如果别的分支也加了过滤条件，两边条件都保留 |
| `changelog.ts` | 用了 v43 | 合并时按顺序重新编号 |

## 9. 待定和提议（没写代码）

1. **rego 拆分**（home-vehicle 分支的提议）：拆完后 CTP 跟着 rego 走，不交 rego 就无牌无强制险。南澳 CTP 可以选保险公司、价格按地区分，西澳统一由 ICWA 承保。
2. **整车被偷**：现在「车被撬」只赔损失，车还在。整车失窃要处理没车之后的住处（露营车）和理赔金 = 车值，工作量大，单独一批。
3. **保费按车价**：全险真实保费和车值、车型、驾龄、邮编相关；现在一刀切。可以改成「基础 + 车值 × 比例」，比例要查数据。
4. **理赔审核**：现在当场赔。可以加「报案号」（撬车、被盗不报警就拒赔）、等几天到账。
5. **退保和按天退费**：卖车时车险怎么处理（现在保单跟人走，换车继续保）。
6. **非学生签证的健康险（OVHC）**：合并 main 后归健康系统（`health.md` §3.2），485、482 要不要买 OVHC 还等用户定。原文：：打工度假签证（417/462）是否必须持有健康险、哪些国家有 Medicare 互惠协议，**未查**；查清前不强制。
7. **袋鼠撞车 `roo-dusk`**：改成 `driving: true` + `loss: collision $300`，坐巴士就不会扣钱了。改了会动一个老事件的抽取范围，留给平衡分析决定。
8. **道路救援附加险**：真实保险公司和汽车协会卖 roadside assistance，抛锚叫拖车可以省钱。价格未查。
9. **房东险 / 自有房产的建筑险**：本批租客险也给自住的人买，但只赔家里东西；房子本身的风暴损失没做。
10. **模拟加投保策略**：给机器人加「买全套保险」「只买车险」两条策略，才能比较保费和期望损失。
11. **出图**：6 张新事件插图。
12. **自然灾害理赔**：main 的 `core/disasters.ts` `incidentsFor()` 已经给出「住处或车所在地点遇到气旋、山火、洪水紧急警告」的事实（`disasters.md` §6）。2026-11-23 用户定这次先不接：要接就得新定损失金额，单独一批做。

## 10. 合并 main（2026-11-23，`7664905`）时做的

- **冲突**（6 个文件）：`actions.ts`（`insure` 动作和 main 的看病、签证等并列）、`character.ts`、`engine.ts`、`types.ts`（`Effect.loss` 和 main 的 `illness`、`asleep` 并列；事件字段 `exposure` 和法律的 `driving` 并列）、`earth.astro`（保险卡放在「我 · 资产」的「工作与住处」和「背包」之间，点击名单补上 `[data-insure]`）、更新日志（改为 v78）。
- **用户定的两件事**：
  - **健康险去掉**：main 的健康系统已经按签证给保障（学生签证 OSHC、永居 Medicare、其他自费）。分支的 `health` 保单、`START_COVER`（留学生开局送一年）、损失种类 `medical`、晕倒医药费走保险、「扭伤脚踝去急诊」事件全部去掉，晕倒医药费照 main 自付、记「日常」。读档时旧的 `health` 保单被 `cleanCover()` 丢掉（只留数据表里有的）。
  - **自然灾害理赔这次不接**：见 §9 第 12 条。
- **和 main 新系统的接法**：
  - 车的意外改用法律分支的 `driving: true`，不再单独写 `exposure: 'car'`：驾照暂停时开不了车，也就碰不上；坐大巴不会被扣修车钱。
  - 住处的意外：`exposure` 只剩 `'home'`，在事件引擎的抽取池里用 `atOwnHome()` 过滤；`event-rules.ts` 的字段白名单加了它并校验取值。`event-engine.test.ts` 的「第一版之前」参照实现跟着加了这一条。
  - 生涯统计：买保险的钱按险种记——车险记「车」，租客险记「住房」，旅行险记「出行」；出险时自付的钱跟着触发它的动作（出行、事件）记。
- **复核修正**（3 个角度，每条都做了反驳核查；确认 5 条，去重后 3 项，全部已处理）：
  - **车损封顶用的是新车价**：main 的 `resaleValue(id, km)` 按里程折旧，卖车、折抵、净资产都传 `state.car.km`，理赔没传，跑了很多公里的车会被赔到超过它的价值。现在传了（§8 表里原本就写了要改）。
  - **更新日志说「车险新买两天后生效」**：第三方财产险当天生效，只有车辆全险、租客险要等，已改。
  - 文档：本文件、`features.md`、`README.md`、`disasters.md`、`event-engine.md`、`health.md`；提示词脚本里指向本文件的章节号。
- **测试**：`insurance.test.ts` 19 条（新加：按里程折旧的车值封顶、住处事件抵达抽样、`exposure` 校验、保费的生涯统计类别和资产页位置；改写：晕倒医药费不归保险、开局没有保单、车的意外要写 `driving`）。故意改坏 12 处，全部抓到。全部 1026 条测试通过。
- **模拟**（180 天 × 100 次，对比 main `7664905`）：报告一字不差，60 天回归基线也没变。模拟的机器人不自己开车进城、不坐飞机、不买保险，原来造成背包客变差的「扭伤脚踝」事件去掉了。所以这份模拟仍然**看不出保险值不值**（§9 第 10 条），平衡交 Codex。
- **首屏**：gzip 214,893 → 218,125 字节（+3.2KB），上限调到 219,200；未压缩 668,516 → 679,227，上限 682,300。
