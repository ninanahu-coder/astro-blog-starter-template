# 税务系统设计

> **2026-11-23 合并 main `2ef25e8`**，更新日志改为 v85。下文 §1「现状」、§3 里「税务居民和 Medicare 按出身」、§8 的模拟数字都是合并前的；合并后的接法和新数字见 §10。

分支 `claude/earth-tax`。玩家是在西澳、南澳生活的华人和留学生，税务是真实生活里绕不开的一块：
来了先办 TFN、打工被预扣、每年 7 到 10 月报税退税、做个体户要 ABN、出租房子要报租金。
这一版把这些做成规则、数据表和「我 · 资产」里的一张卡片。

标记说明：**【现状】** 是 main 上已有的代码；**【新】** 是本分支新加的；**【待平衡】** 是初始值，等 Codex 跑完平衡分析再定，Claude 不下平衡结论。

## 1. 现状（开工前的 main）

- **【现状】工资**：`careerPay()`（`core/engine.ts`）= 等级工资 ×（1 + 证书加成）；`workShift()` 表现好再 × 1.25。全额进现金，没有任何税。
- **【现状】零工**：地点活动 `work-cafe`（$110 / 4 小时）、`work-mine`（$520 / 10 小时）、`work-farm`（$150 / 6 小时）、`busk`（$35）、`recycle`（$8），`performActivity()` 直接加现金。
- **【现状】真实地点打卡上班**：`core/venues.ts` 的 `work()`，按真实停留时长和时薪计薪，全额进现金。
- **【现状】出租**：`settleProperties()` 每周结算：出租的房子 95% 概率收 `rentIncome`，1/12 概率维修，物业费 + 还款（利息 + 本金）。
- **【现状】日历**：一年 4 季 × 28 天 = 112 天，第 1 天是第 1 年春季第 1 天（`core/time.ts`）。周结算 `weeklyTick()` 每 7 天一次。
- **未合并的 `claude/earth-economy`**：`core/economy.ts` 有 `ECON.minHourly`、临时工加给 25%、`weeklyBudget()`（每周收支估算，未含税）；理财 `core/invest.ts`、`core/market.ts`（持仓、行情）。
  它说游戏工资约为现实的 0.75–0.8 倍，本文的换算比例沿用这个口径。两个分支没有改同一个函数；合并后 `weeklyBudget()` 的 `wages` 是税前，要不要显示税后见 §9。
- 其他分支（`git grep` 过 TFN / 报税 / 预扣 / incomeTax）都没有税务相关的东西。

## 2. 真实规则（ATO）与来源

数据和出处都在 `src/game/data/tax.ts`，每条注释带链接。摘要：

| 规则 | 内容 | 来源 |
| --- | --- | --- |
| 居民税率 2026–27 | 0–$18,200 免税；–$45,000 15%（2026-07-01 起由 16% 降到 15%）；–$135,000 30%；–$190,000 37%；以上 45% | [ATO 居民税率](https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents)、[减税说明](https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer) |
| 打工度假（WHM） | 第一块钱起 15% 到 $45,000，以上按外国居民税率 | [ATO WHM 税率](https://www.ato.gov.au/tax-rates-and-codes/tax-rates-working-holiday-makers)、[Schedule 15](https://www.ato.gov.au/tax-rates-and-codes/schedule-15-tax-table-for-working-holiday-makers) |
| 外国居民 | 无免税额，30% 到 $135,000，之后 37% / 45%（现在没有出身用到） | [ATO 外国居民税率](https://www.ato.gov.au/tax-rates-and-codes/tax-rates-foreign-residents) |
| LITO | ≤ $37,500 抵 $700；到 $45,000 每多 $1 少 5 分；到 $66,667 从 $325 起每多 $1 少 1.5 分；只抵到 0 | [ATO LITO](https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset) |
| Medicare 税 | 2%；单身低收入：≤ $28,011 不交，到 $35,013 交超出部分的 10%（2025–26 数字，2026–27 未公布） | [ATO 低收入减免](https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners) |
| 留学生免 Medicare 税 | 不享受 Medicare 的临时居民凭 Medicare Entitlement Statement 全额免除 | [ATO 不享受 Medicare](https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-exemption/not-entitled-to-medicare-benefits) |
| 留学生税务身份 | 在澳读超过 6 个月课程的海外学生一般是税务居民（税务居民身份和移民身份是两套标准） | [ATO 在澳留学](https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/coming-to-australia/studying-in-australia)、[居民身份判断](https://www.ato.gov.au/calculators-and-tools/tax-return-work-out-your-tax-residency) |
| 没 TFN 的预扣 | 居民 47%、外国居民 45%；申报了「已申请 TFN」的有 28 天宽限，先按正常税率 | [ATO 员工申报](https://www.ato.gov.au/tax-rates-and-codes/schedule-1-tax-table-01-july-2024-to-30-june-2026/employee-declarations) |
| 报税期 | 自己报：7 月 1 日到 10 月 31 日 | [ATO 报税截止](https://www.ato.gov.au/media-centre/time-is-running-out-to-lodge-your-own-tax-return) |
| 逾期罚款（FTL） | 每逾期 28 天（不足也算）一个罚款单位，最多 5 个；罚款单位金额以 ato.gov.au/penalty 为准 | [ATO FTL 罚款](https://www.ato.gov.au/individuals-and-families/paying-the-ato/interest-and-penalties/penalties/failure-to-lodge-on-time-penalty) |
| 爱好与生意 | 爱好收入一般不计税；做生意要 ABN 和 TFN | [business.gov.au 爱好还是生意](https://business.gov.au/planning/new-businesses/difference-between-a-business-and-a-hobby) |
| 出租 | 租金计税；贷款利息、物业费、维修（出租期间的磨损）可当年抵扣；净亏损可抵工资等其他收入（负扣税） | [ATO 出租费用](https://www.ato.gov.au/forms-and-instructions/rental-properties-2025/worksheet-work-out-your-net-rental-income-or-loss) |

查证日期 2026-11-20。ATO 每年 7 月更新，到时要核对税率、LITO、Medicare 门槛。

## 3. 游戏里的简化【新】

| 现实 | 游戏 | 理由 |
| --- | --- | --- |
| 财年 7 月 1 日到次年 6 月 30 日 | **财年 = 游戏年**（春季第 1 天到冬季最后一天，112 天） | 一年一结最好懂；不另造一个错开的财年。现实财年结束在入冬，游戏在冬末，季节对不上，接受 |
| 报税期 7 月 1 日–10 月 31 日（4 个月） | **新一年开头 28 天**（整个春季）`TAX_GAME.lodgeDays`【待平衡】 | 一季正好约等于「年初几个月」 |
| 税档金额（$18,200 等） | **现实金额 × `TAX_GAME.scale` = 0.46**（第十轮平衡定，原 0.23）；税率不变 | 原推导 16/52 × 0.75 ≈ 0.23 假设游戏时薪约为现实 0.75 倍，实测工资曲线更高（§8.3）。第十轮按实际工资定锚：咖啡店一年约 $25.6k ÷ 0.46 ≈ 现实 $5.6 万、矿工约 $10.9 万。所有门槛同乘一个数，税额正好也缩小这么多倍，测试用这一点核对 |
| PAYG 按发薪周期折年（周薪 × 52） | **每笔工资当一天工资 × 96 个工作日**折年再摊回`TAX_GAME.payDaysPerYear`【待平衡】 | 一班或一次打工就是一个发薪周期；96 = 每周 6 班 × 16 周（同 economy 分支 `shiftsPerWeek`）。打得少的人多扣、年底退 |
| TFN 处理时间（最长约 28 天） | **3 个游戏日**`tfnWaitDays`【待平衡】；网上申请，不花钱不花时间 | 按一年 112 天压缩 |
| 税务居民按事实判定（183 天、课程长度等） | **按出身固定**：留学生 = 居民 + 免 Medicare；背包客 = 打工度假；矿工、冲浪手 = 居民 | 出身就是身份；短期课程（≤ 6 个月）的外国居民学生、换签证等以后再加 |
| FTL 罚款：每 28 天一个罚款单位，最多 5 个 | **每逾期 7 个游戏日罚 $60，最多 5 次**，只对要补税的申报罚（`lateEveryDays`、`lateUnit`）【待平衡】 | 结构照搬；金额不对应现实，现实中 ATO 对退税的逾期申报常不罚，这里直接不罚 |
| 补税 11 月 21 日前付清，之后计利息；可以申请分期 | **报税当场扣现金，不够的进分期**：每周结算扣「欠款 × 25%」，至少 $20（`planShare`、`planMin`）【待平衡】；不计利息 | 不让一次补税把人逼到付不起房租 |
| 不报税，ATO 会催、可以默认评税 | **下一个财年结束时还没报，按记录默认评税**：补税照扣、要补税的加满罚款；有 TFN 照退，**没有 TFN 多扣的退不回** | 给不办 TFN 一个代价；卡片上提前写明 |
| 报税要 TFN | 同 | — |
| 爱好 vs 生意看是否以盈利为目的、是否有规律 | **街头表演：没 ABN = 爱好（不计税）；注册 ABN 后 = 生意**：能接商演、市集档期，收入 × 1.4（`abnBonus`）【待平衡】，按生意收入记账、报税时交税，不预扣 | 给 ABN 一个玩法意义：多挣但要交税 |
| 没 ABN 的商业付款要预扣 47% | 不做 | 游戏里没有企业付钱给玩家的场景 |
| 个体户 PAYG 分期预缴（instalments） | 不做，年底一次交 | 收入规模太小 |
| 超级年金、海外收入、资本利得（卖房、理财）、扣除项（工作服、车费） | 不做，见 §9 | 第一版只做最常见的 |
| 退瓶押金 | 不是收入 | 退的是押金 |

## 4. 规则（`src/game/core/tax.ts`）【新】

- **应纳税额** `assess(book, status)`：应税收入 = 工资 + 生意 + 租金 − 出租费用（不低于 0）；按身份的税档算税；居民减 LITO（只抵到 0）；加 Medicare 税（居民且不免除，含低收入减免）。
- **预扣** `withholding(state, gross)`：没 TFN（`tfn = −1`）按 47% / 45%；在等号码或已有 TFN：`assess(gross × 96) / 96`，不超过工资。
- **记账**（原地修改，引擎在发钱成功后调用）：`recordWage`（税前工资和预扣）、`recordBiz`、`recordRent`、`recordRentCost`。
  - 职业上班 `workShift`、零工活动（`ACTIVITY_INCOME` 里标 `wage` 的）、真实地点打卡上班 `venues.work`：预扣后发到手的钱；途中晕倒不发钱也不记账。
  - 街头表演（`hobby`）：有 ABN 时 `hobbyIncome()` 上浮并 `recordBiz`。
  - 出租：周结算收到租金时 `recordRent`；出租中的维修费、物业费、利息（不含本金）`recordRentCost`；自住不记。断供没付的那周不记费用。
- **周结算** `taxTick(state)`（挂在 `weeklyTick` 每一轮的末尾）：
  1. 跨进新财年：上一份还没报的先默认评税；本年账目有任何数字就结转成待申报 `ret`，没有收入的年份不用报；账目清零，`fy` 记成新年。
  2. 有欠税且有现金：扣一期分期。
  工资在跨周结算之前入账（`advance` 的 `gains`），所以跨年那一班的工资记在新财年的账上。
- **动作**（`core/tax-actions.ts`，协议 `{ t: 'tax', op: 'tfn' | 'abn' | 'lodge' }`）：
  - `tfn`：没申请过才行，`tfn = 今天 + 3`；
  - `abn`：要已拿到 TFN；
  - `lodge`：要有待申报和 TFN；退税入账，补税 + 逾期罚款先扣现金、不够的记欠税；记下 `last`。
  - 都不花游戏时间、不进离线队列（`queueable` 默认不收）；有待处理事件时不能做。

## 5. 存档字段【新】（按 save-sync.md §5）

`PlayerState.tax: TaxState`（`core/types.ts`）：

```ts
tax: {
  tfn: number;   // −1 没申请；否则拿到 TFN 的游戏日（大于今天表示还在等）
  abn: boolean;
  fy: number;    // 正在记账的财年（= 游戏年）
  book: { wages, withheld, biz, rent, rentCost };            // 本财年账目，都 ≥ 0
  ret: { fy, wages, withheld, biz, rent, rentCost } | null; // 待申报的上一财年
  debt: number;  // 欠税
  last: { fy, due, penalty } | null;                          // 最近一次申报：due 正为补、负为退
}
```

- 字段名 `tax` 在所有 `claude/earth-*` 分支里都没用过。`createCharacter` 用 `newTaxState()`；`sanitizeState` 一行 `cleanTax(r.tax, clock)`。
- **旧存档没有这个字段：视为已有 TFN（`tfn = 0`）**，从当前财年开始记账——不让已经在上班的老玩家下一班突然被扣 47%。
- `cleanTax`：任何输入不抛异常；数字取整并钳到 [0, 1e7]（`last.due` 可为负）；`fy` 钳到 [1, 今年]；`tfn` 不晚于「今天 + 3」；待申报的财年必须早于 `fy`，否则整份丢掉（钳过去会把今年的账当上一年报掉）；幂等（测试覆盖）。
- 不需要改 `SAVE_VERSION`；没有秘密，不用在 `publicState()` 里清。序列化后约 200 字节。

## 6. 界面【新】

「我 · 资产」在资产卡片后面加一张「🧾 税务」卡片（`src/game/ui/tax.ts` 的 `taxCard(s, esc)`，`earth.astro` 只改了 import、一处插入、点击分发）：

- 身份（税务居民 / 打工度假，是否免 Medicare 税）；
- 没 TFN：警告 + 「申请 TFN」按钮；在等：还要几天；有了：TFN ✓、ABN ✓；
- 有 TFN 没 ABN：「注册 ABN」按钮（点击时确认一次）；
- 本财年：工资（已预扣）、个体户收入、出租收入和费用；按现在的账目估算应纳税和预计退补；
- 待申报：应纳税、已预扣、退或补多少、报税期还剩几天或已逾期的罚款；「报税」按钮（没 TFN 时禁用）；
- 欠税、上次申报结果、一句「规则参照 ATO 2026–27，金额按比例缩小」。

所有插值经过 `esc()`（测试用一个加标记的 esc 检查过；变异检查去掉一处 `esc` 测试会失败）。上班、打工的结果消息带「工资 $X，预扣税 $Y，到手 $Z」。

## 7. 测试与变异检查

- 新增 `tests/earth/tax.test.ts`（15 条）：数据自洽；按现实金额核对税额（居民 / 留学生 / 打工度假，$60k、$30k、$40k、$18k 各档和 LITO、Medicare 减免，负扣税）；预扣（无 TFN、等号码、有 TFN、不超过工资）；上班、零工、街头表演（有无 ABN）、捡瓶子的记账；出租记账（多种子，含空置）和自住不记；财年结转；报税（退、补、分期、无 TFN、重复报、有事件）；逾期罚款；默认评税（有无 TFN）；分期扣款；TFN / ABN 动作；动作协议；存档清洗（旧存档、坏值、幂等、整份存档幂等）；界面卡片。
- 改了 4 条现有测试（`economy`、`life`、`moodlets`、`venues`）：它们断言「工资全额到手」，现在给测试角色加 TFN、按税后算；`venues` 加了预扣记账和无 TFN 对照。
- **变异检查**（脚本把源码改坏一处、跑 `tax` / `venues` / `life` 测试、再还原）：24 个变异全部被测试抓到，包括：去掉 LITO、忽略 Medicare 免除、去掉 Medicare 低收入减免、无 TFN 按正常税率、等号码期间按 47%、退税也罚、罚款无上限、没 ABN 也加成、空账也要报、无 TFN 也退税、欠税一次扣光、旧存档无 TFN、出租亏损不抵、自住费用也抵、上班不记账 / 不预扣、零工不预扣、租金不记账、打卡上班不预扣、报税 / ABN 不要 TFN、协议放过坏操作、卡片不转义、背包客当居民。第一轮有 4 个存活（零工不预扣、租金不记账、打卡上班不预扣、报税不要 TFN），补了断言后重跑全部抓到。

## 8. 模拟结果

`npm run earth:sim -- --days=180 --runs=100`，同样的种子，main（4f9c9e5）对比本分支。完整报告存在 [tax-sim-report.md](tax-sim-report.md)（没有覆盖 `balance-report.md`，免得和别的分支冲突）。
模拟器改动：机器人（对照组除外）开局申请 TFN（第 4 天拿到，之前 3 天按正常税率扣）、有待申报就报税；报告新增「税务」一节。

### 8.1 主要指标（main → 本分支）

| 策略 | 第 60 天现金（中位） | 日均净收入 | 期末净资产（中位） | 买房（中位天数） | 升职/人 |
| --- | --- | --- | --- | --- | --- |
| 咖啡店上班族（珀斯，合租） | $6,589 → $3,932 | $71 → $30 | $28,067 → $18,555 | 第 89 天 → 第 122 天 | 2.00 → 2.00 |
| 救生员（珀斯，公寓） | $8,448 → $3,777 | $107 → $31 | $35,318 → $19,207 | 第 75 天 → 第 111 天 | 2.00 → 2.00 |
| 矿工（卡尔古利，合租） | $14,522 → $7,830 | $343 → $205 | $74,396 → $48,906 | 第 26 天 → 第 39 天 | 2.00 → 2.00 |
| 打零工的背包客（无房） | $391 → $367 | $-2 → $-2 | $177 → $277 | — → — | 0 → 0 |
| 保守背包客（无房，少漫游） | $752 → $735 | $1 → $1 | $751 → $738 | — → — | 0 → 0 |
| 什么都不干（对照组） | $4 → $4 | $-3 → $-3 | $4 → $4 | — → — | 0 → 0 |
| 酒保（珀斯，合租） | $7,424 → $4,359 | $84 → $38 | $30,525 → $20,296 | 第 84 天 → 第 116 天 | 2.00 → 2.00 |
| 农场工（玛格丽特河，合租） | $6,992 → $3,347 | $21 → $116 | $22,181 → $22,451 | 第 144 天 → 没买（不到一半人买） | 2.00 → 2.00 |
| 咖啡店 + 共同事件：理想搭档 | $8,697 → $6,099 | $95 → $51 | $33,252 → $23,941 | 第 76 天 → 第 97 天 | 2.00 → 2.00 |
| 咖啡店 + 共同事件：疲惫搭档 | $8,560 → $5,898 | $94 → $50 | $32,997 → $23,567 | 第 76 天 → 第 100 天 | 2.00 → 2.00 |
| 咖啡店 + 共同事件：一半时候没人 | $8,602 → $6,039 | $94 → $50 | $32,915 → $23,559 | 第 76 天 → 第 100 天 | 2.00 → 2.00 |

日均净收入 =（期末现金 − 开局现金）/ 天数，买房付的钱会把它拉低；农场工这一行变高，是因为 180 天内多数人没攒够首付、钱留在现金里。

### 8.2 税务一节（本分支）

| 策略 | 180 天累计预扣/人 | 第 1 财年已预扣（中位） | 应纳税（中位） | 退(−)/补(+)（中位） |
| --- | --- | --- | --- | --- |
| 咖啡店上班族 | $8,701 | $4,854 | $4,831 | −$24 |
| 救生员 | $14,219 | $8,024 | $7,833 | −$187 |
| 矿工 | $25,303 | $14,373 | $14,176 | −$196 |
| 打零工的背包客 | $1,653 | $1,184 | $1,092 | −$76 |
| 保守背包客 | $542 | $323 | $314 | −$9 |
| 酒保 | $9,037 | $5,105 | $5,124 | +$19 |
| 农场工 | $11,696 | $6,620 | $6,164 | −$423 |

100/100 个机器人都在第 113 天（报税期第 1 天）报了税；期末没有人欠税。

### 8.3 观察（事实，不是平衡结论）

- **工资到手少了约 22%–31%**：上班收入（每人每天）咖啡店 $229 → $178、救生员 $306 → $222、矿工 $448 → $307；按「预扣 /（到手 + 预扣）」算，平均税率约咖啡店 21%、救生员 26%、矿工 31%。
- 买房推迟 13–36 天；第 60 天现金少 30%–55%。晕倒、被收房、升职次数没变；第 2 次升职有几行推迟了 2–10 天。
- 零工背包客的现金几乎不变，但不是没交税：机器人是「现金低于目标线才去打工」，每次实收从 $110 降到 $93，开工次数就从每人每天 0.46 次多到 0.53 次（保守背包客 0.15 → 0.18）。180 天累计预扣 $1,653 / $542。
- 年底退补很小（中位 −$196 到 +$19）：预扣口径和年终算税基本对齐；农场工退得多一点（中位 −$423），原因没细查。
- 平均税率偏高的来源：按 `scale = 0.23` 折回现实，机器人咖啡店上班族一年的工资相当于现实约 $11 万（升到店长、每周 6 班、表现奖金），落在 30% 档。
  `scale` 是按 economy 分支「游戏时薪约为现实 0.75 倍」推的，main 上现在的工资曲线高职级时比这个比例高。第十轮平衡（balance.md）由用户定方案 B：`scale` 0.23 → 0.46，咖啡店全职平均税率约 21% → 13%；`payDaysPerYear` 不变。

## 9. 待定与以后

- 【待平衡】§8.3 的税负水平；§3 表里所有标了待平衡的数：`scale`、`payDaysPerYear`、`tfnWaitDays`、`lodgeDays`、`lateUnit`、`lateEveryDays`、`planShare`、`planMin`、`abnBonus`。
- economy 分支合并后：`weeklyBudget()` 的工资是税前，要不要扣预估预扣；`ECON` 和 `TAX_GAME.payDaysPerYear` 都是「每周 6 班」，可以合成一个常量。
- 理财（economy 分支的持仓）卖出赚钱、卖房赚钱要不要交资本利得税（CGT，持有超过 12 个月减半）——本版不做。
- 短期课程学生（外国居民税率、无免税额）、学生签证打工时长限制、换签证改变税务身份。
- 常见扣除项（工作服、工作用车、学费）、私人医保与 Medicare 附加税（MLS）、超级年金和离境退还（DASP）。
- 引导（onboarding 分支）可以在第一次上班前提示「先申请 TFN」。

## 10. 合并 main（2026-11-23，`2ef25e8`）时做的

- **冲突**（8 个文件）：`README.md`、`actions.ts`、`character.ts`、`engine.ts`、`types.ts`、`earth.astro`、`sim.ts`、更新日志（改为 v85）。
- **和 main 新系统的接法**：
  - 零工活动的预扣和 main 的身体系数（`bodyScaled`）、签证工时（`logWork`）、喝酒记录、社区服务并在一起；职业上班同样。
  - 出租收入按 main 的租金指数实收记账（`rentOn`）。
  - 周结算里报税分期扣的钱记生涯统计「其他」；报税动作（退税、补税、罚款）也记「其他」。
  - **Medicare 税跟着签证带的医疗保障走**（`taxStatusOf()`，main 的 `coverOf()`）：持学生签证用 OSHC、毕业签和工作签自费的临时居民不享受 Medicare，免税；拿到永居有了 Medicare 就要交。居民身份仍按出身（背包客是打工度假）。
  - **ABN 和副业与小生意是同一个**（`hasAbn()`）：在税务卡注册的副业里也有，在副业里办的税务卡也认；两边都要先有 TFN。
  - **副业和自己店的钱算个体户收入**：副业与小生意的账本（`business.ts` `recordBiz`）每记一笔净额，也记进税务账本的 `biz`。
- **复核修正**（3 个角度，每条都做了反驳核查；确认 10 条，去重后 3 项，全部已处理）：
  - **先亏后赚的生意亏损被丢掉**：税务账本的个体户收入原来每笔都钳到 0，开店装修、进货这些先发生的亏损扣不上，亏了钱还要交税。现在本年带符号累计，算税时按不低于 0 计（生意亏损不抵工资，出租亏损照旧能抵）。
  - **报上一年的税时用报税那天的 Medicare 身份**：学生拿到永居后报上一年的税，会被收整年 Medicare 税。现在周结算记下这一年有几周免 Medicare 税（账目新加可选字段 `wk`、`mx`），报税按比例算，和 ATO 按天数部分免除一样。
  - 文档：本节、`features.md`、`side-business.md`、`career-stats.md`；`tax-sim-report.md` 是合并前的报告（文件头已注明）。
- **测试**：`tax.test.ts` 20 条（新加 5 条）；`business.test.ts` 的测试角色默认有 TFN，服务端那条改成「没 TFN 办 ABN 被拦，别的证照照常落盘」。故意改坏 11 处，抓到 10 处；没抓到的「报税动作记到哪一类」和默认类别一样（都是「其他」），是等价变异。
- **模拟**（180 天 × 100 次，对比 main `2ef25e8`，平衡交 Codex）：
  - 期末净资产：咖啡店上班族 $23,263 → $14,189，救生员 $33,630 → $15,455，矿工 $72,088 → $46,183，酒保 $25,203 → $15,729，农场工 $20,800 → $20,123；背包客两行、对照组基本不变。
  - 被收房或断供：救生员 0.36 → 1.77 次/人，农场工 0.66 → 2.04 次/人（到手工资少了二到三成，周租照旧，现金垫子变薄）。
  - 税负水平：`scale` 第十轮已定为 0.46（原 0.23），见 balance.md 第十轮。
  - 60 天回归基线已更新。
- **首屏**：gzip 251,705 → 254,586 字节（+2.9KB），上限调到 255,600；未压缩上限 792,100。
