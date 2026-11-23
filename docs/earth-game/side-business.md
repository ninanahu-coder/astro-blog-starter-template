# 副业与小生意（创业系统第 1 版）

> **2026-11-23 合并 main `9fb5028`**，更新日志改为 v84。下文提到的经济、商店物品、教育职业、事件引擎等分支都已经在 main；合并时做的（签证工时、生病、灾害停工、记账）见 §11。

> 分支 `claude/earth-side-business`，更新日志 v43（合并时按顺序重排）。
>
> 标记：**【现状】** main（`4f9c9e5`）已有的；**【已落地】** 本分支写进代码的；**【提议】** 只是方案，没写代码。
> 本文所有新数值都「**待平衡**」。第 9 节只列模拟数据，是否合适由 Codex 判断（`AGENTS.md` 分工），本文不下平衡结论。

相关文档（都是未合并分支）：经济 `claude/earth-economy` 的 `economy-design.md`（收入侧、价格尺度、最低时薪 $20、临时工加给 25%）；商店物品 `claude/earth-shop-items` 的 `shop-items.md`（物品分类、店铺类别 `STORE_TYPES`）；教育职业 `claude/earth-education-career` 的 `education-career.md`（学历课程、学生签证工时 `workLog`）。

## 1. 现状【现状】

main 里和「自己做生意」沾边的只有这些，没有独立的副业或开店系统：

| 已有 | 位置 | 说明 |
| --- | --- | --- |
| 零工 | `data/activities.ts` 的 `work-cafe` / `work-mine` / `work-farm` | 雇佣性质，不用应聘 |
| 街头表演、捡瓶子 | `activities.ts` 的 `busk`、`bottles` | 不是雇佣，$35 / $8 |
| 真实地点打卡上班 | `core/venues.ts` 的 `workTerms` | 按职业或地点零工时薪 |
| 玩家二手摊 | `core/trade.ts` | 玩家之间卖物品，不是经营 |
| 出租房产 | `data/properties.ts` + `core/finance.ts` | 被动收入，每周结算 |
| 声望 | `PlayerState.respect` | 升职、体验、事件给；职业有声望门槛 |

没有：ABN、营业执照、营业额、GST、所得税、店铺、雇员。

## 2. 现实规定参照（西澳、南澳）

只收找到出处的规定；「核实」一栏照实写。来源都是 2026-11-20 的网络搜索，**没有逐篇打开原文**的标「转述」。游戏只做简化，第 3 节写清楚简化了什么。

| 规定 | 内容 | 出处 | 核实 |
| --- | --- | --- | --- |
| ABN | 免费申请；只有「在经营生意」才有资格，爱好（hobby）不行；不是强制，但没有 ABN 时付款方可能按最高税率预扣 | [business.gov.au：Business or hobby](https://business.gov.au/planning/new-businesses/difference-between-a-business-and-a-hobby)、[Register for an ABN](https://www.business.gov.au/Registrations/Register-for-an-Australian-Business-Number-ABN) | 转述 |
| 外卖平台要 ABN | 外卖、网约车等平台按独立承包人结算，要求有 ABN | [Lawpath](https://lawpath.com.au/blog/need-pay-gst-ubereats)（第三方） | 转述，非官方 |
| GST 登记门槛 | 年营业额 ≥ $75,000 必须登记；网约车不论营业额都要登记；送外卖适用一般门槛 | [ATO：Registering for GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst)、[ATO：ride-sourcing](https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/sharing-economy-and-tax/ride-sourcing/registrations) | 转述 |
| 商号注册 | 用自己名字以外的名称营业要在 ASIC 登记商号：2026-07-01 起 1 年 $47、3 年 $108（原 $45 / $104） | [business.gov.au：Changes from 1 July 2026](https://business.gov.au/news/changes-for-businesses-from-1-july-2026) | 转述（搜索摘要引用了该页） |
| 西澳儿童工作检查（WWC） | 有偿的儿童相关工作必须持卡，私人家教属于「coaching or private tuition」类；有效 3 年；有家教因无卡被起诉 | [WA Department of Communities：Who needs a WWC Check](https://www.wa.gov.au/organisation/department-of-communities/working-children-check-who-needs-wwc-check)、[类别 4 说明](https://www.wa.gov.au/system/files/2023-11/wwcc_factsheet_cat04_-_categories_of_child-related_work_4_a_coaching_or_private_tuition_service.pdf)、[起诉通报](https://www.wa.gov.au/government/announcements/tutor-counts-cost-of-failing-hold-current-working-children-check) | 转述 |
| 西澳 WWC 费用 | 雇员和自雇 $87（志愿者 $11） | [RecordingLaw 指南](https://www.recordinglaw.com/australia/background-checks/wwcc-wa/)（第三方，未注明日期） | **未核实**：wa.gov.au 原页没读到金额 |
| 南澳 WWC | 由人类服务部（DHS）审查；标准申请 $145；南澳的检查不被其他州承认 | [RecordingLaw 指南](https://www.recordinglaw.com/australia/background-checks/wwcc-sa/)（第三方）、[SA.gov.au](https://www.sa.gov.au/topics/rights-and-law/rights-and-responsibilities/screening-checks/screening-wwcc/for-individuals/volunteers-moving-to-paid-employment) | **未核实**：有效期各来源说 3 年或 5 年，矛盾 |
| 西澳食品营业 | 市集摊位、餐车、家庭食品生意都要向地方政府登记或通知；收费由各市镇定，例：Exmouth 临时摊 $41、Carnarvon $85、Morawa $177、Joondalup（2026-27）登记 $207 / 通知 $75，另有年费 | [WA Health：Registration of a food business](https://health.wa.gov.au/Articles/N_R/Registration-of-a-food-business)、[ABLIS 各市镇条目](https://ablis.business.gov.au/service/wa/notification-registration-of-a-food-business-city-of-joondalup/22515) | 转述 |
| 南澳食品营业 | Food Act 2001 第 86 条：开业前通知执法机构（一般是地方议会）；市集固定摊用正式通知表，单次活动用临时表 | [Unley 议会](https://yourbusiness.unley.sa.gov.au/Regulations-Approvals/Food-business-regulations-approvals/Food-business-notification)、[SA Health](https://www.sahealth.sa.gov.au/wps/wcm/connect/public%20content/sa%20health%20internet/public%20health/food%20safety%20for%20businesses/starting%20a%20food%20business) | 转述；**通知费没查到** |
| 弗里曼特尔市集 | 由私营公司管理，摊主向市集申请；卖吃的还要在弗里曼特尔市登记食品生意 | [Fremantle Markets 申请表](https://www.fremantlemarkets.com.au/sites/default/files/Application%20Form.pdf) | 转述（表格是旧版） |
| 雇主养老金 | 超级年金保证（SG）2025-07-01 起 12% | [CPA Australia](https://www.cpaaustralia.com.au/public-practice/inpractice/understanding-changes-employer-super-guarantee) 等多家（非 ATO 原页） | 转述 |
| 工伤保险 | 西澳雇主必须为雇员买工伤保险（Workers Compensation and Injury Management Act 2023） | [WorkCover WA：Insurance requirements](https://workcover.wa.gov.au/wp-content/uploads/2024/06/Information-Sheet-41-Insurance-Requirements-for-Employers.pdf) | 转述；**南澳 ReturnToWorkSA 的规定这次没查到** |
| 代购的税务 | ATO 没有专门讲代购的页面；按一般规则，持续、以盈利为目的的买卖是生意，收入要报税；替人从海外买货运进澳洲的「转运」业务可能要登记 GST | [ATO：GST when you sell to Australia（中文）](https://www.ato.gov.au/other-languages/simplified-chinese/gst-when-you-sell-to-australia-chinese) | 转述；从澳洲寄出去的代购适不适用要再查 |

**没有找到来源、本文不填现实数字的**：各街区的商铺租金、人流量；奶茶、杂货、手机维修的现实毛利；家教、摄影的市场价；外卖骑手的实际时薪；零售商铺租约（西澳 Commercial Tenancy (Retail Shops) Agreements Act 1985、南澳 Retail and Commercial Leases Act 1995）的押金惯例。这些都是游戏设计值，第 5 节会逐个标出。

## 3. 游戏简化【已落地】

| 现实 | 游戏 |
| --- | --- |
| ABN 要看是不是「在经营生意」 | 谁都能办，免费、30 分钟；送外卖、摄影接单、开店要先有 |
| 商号按 1 年或 3 年续费 | 只有 1 年档 $47；游戏 1 年 = 112 天 |
| WWC：西澳、南澳各自办，互不承认 | 照做：`wwc-wa` $87、`wwc-sa` $145，都按 3 个游戏年有效；家教要所在州的卡 |
| 食品登记由各市镇收费，金额不同 | 西澳统一 $120/年（落在出处的 $41–$207 区间里，设计值）；南澳通知 $60、长期有效（费用没查到，设计值） |
| 所有证照都是网上办 | 在任何地点都能办，花 30–60 分钟 |
| 市集摆摊卖吃的要食品登记 | 第 1 版的摊位只卖手工小玩意，不需要；卖吃的摊见【提议】 |
| GST：营业额超门槛后 21 天内登记，按季申报 | 营业额一到门槛自动登记，之后每笔生意当场按（营业额 − 这笔进货）÷ 11 扣掉 |
| 雇员：最低工资、行业裁决、养老金、工伤保险、单点触控工资申报 | 每个店员每天 $160（8 小时 × 游戏最低时薪 $20，口径同经济分支），另付 12% 养老金和 2% 工伤保险（费率是设计值） |
| 独资经营者对生意欠债负无限责任 | 欠款到 3 周租金就倒闭，押金抵债，剩下的欠款一笔勾销（只扣声望）。见第 10 节的讨论 |

## 4. 副业【已落地】

数据 `data/business.ts` 的 `GIGS`，规则 `core/business.ts` 的 `gigsAt()`、`doGig()`。每种每个游戏日一次；先付成本，时间走完、没晕倒才拿到收入（和引擎 `applyEffect` 的「付出在前、收获在后」一致）。

收入 = 基础 ×（1 + 对应能力 / 200）× 随机 0.75–1.25；随机落在上半段算「出色」，加声望。

| 副业 | 地点 | 时段 | 门槛 | 耗时 | 成本 | 基础收入 | 能力 | 特别规则 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 周末市集摆摊 | 有 `market` 标签（弗里曼特尔、阿德莱德、格莱内尔格等） | 周六、周日 8–13 点开始 | — | 5 小时 | 摊位费 $60 | $200 | 魅力 | 出色声望 +1 |
| 代购 | 城市 | 9–20 点 | — | 3 小时 | 货款 $200 | $270 | 街头 | 6% 货出意外：货款收不回 |
| 家教 | 城市、城镇 | 15–20 点 | 所在州的 WWC | 2 小时 | — | $70 | 魅力 | 出色声望 +1 |
| 送外卖 | 城市、城镇、港口 | 11–22 点 | ABN | 3 小时 | — | $95 | 驾驶 | 没车 ×0.7；雨天、风暴 ×1.3 |
| 摄影接单 | 城市、海岸、城镇、港口 | 7–18 点 | ABN + 完成 3 个摄影任务（作品集） | 4 小时 | — | $230 | 魅力 | 出色声望 +1 |

能力为 0 时，扣掉成本后的期望每小时：摆摊 $28、代购 $18（含 6% 丢货）、家教 $35、送外卖 $32（没车 $22）、摄影 $58；能力 100 时乘 1.5（成本不变）。参照：经济分支定的游戏最低时薪 $20、零工 $25–37.5。**都待平衡。**

## 5. 小生意：开店【已落地】

### 5.1 店铺类型（`SHOP_TYPES`）

| 店 | 装修 | 每单售价 / 进价 | 基础客流（单/天） | 一个人一天能接待 | 库存上限 | 食品登记 |
| --- | --- | --- | --- | --- | --- | --- |
| 奶茶店 | $9,000 | $7 / $2 | 70 | 60 | 600 | 要 |
| 亚洲杂货店 | $6,000 | $25 / $17 | 32 | 40 | 300 | 要 |
| 手机维修铺 | $4,000 | $85 / $35 | 7 | 8 | 60 | 不要 |

全部是设计值，没有现实毛利数据（第 2 节末）。

### 5.2 选址：真实街区（`SHOP_SITES`）

街区名和所属城市是真实的（各条目的维基百科页面：Northbridge, Western Australia；Cannington；Victoria Park；Subiaco；South Terrace, Fremantle；Mandurah；Chinatown, Adelaide；Rundle Mall；Prospect, South Australia；Glenelg；Mount Gambier）。只挂在已有游戏地点下，**不新增地图点、不放坐标**，所以不需要 OSM 数据。**租金和客流系数是游戏设计值**，按「市中心步行街 > 餐饮街 > 郊区购物中心 > 地区城市」粗分，不代表现实。

| 街区 | 游戏地点 | 州 | 周租 | 客流系数 |
| --- | --- | --- | --- | --- |
| 北桥 Northbridge | 珀斯 | 西澳 | $900 | 1.3 |
| 坎宁顿 Cannington | 珀斯 | 西澳 | $650 | 1.1 |
| 维多利亚公园 Victoria Park | 珀斯 | 西澳 | $600 | 1.0 |
| 苏比亚科 Subiaco | 珀斯 | 西澳 | $700 | 0.9 |
| 卡布奇诺街 South Terrace | 弗里曼特尔 | 西澳 | $850 | 1.2 |
| 曼杜拉市中心 | 曼杜拉 | 西澳 | $450 | 0.8 |
| 阿德莱德中国城 | 阿德莱德 | 南澳 | $850 | 1.3 |
| 兰德尔购物街 Rundle Mall | 阿德莱德 | 南澳 | $1,100 | 1.4 |
| 普罗斯佩克特路 Prospect Road | 阿德莱德 | 南澳 | $550 | 0.9 |
| 杰蒂路 Jetty Road | 格莱内尔格 | 南澳 | $750 | 1.1 |
| 甘比尔山市中心 | 甘比尔山 | 南澳 | $380 | 0.7 |

### 5.3 开店到倒闭

| 步骤 | 规则（`SHOP_RULES`） |
| --- | --- |
| 开店 `openShop` | 人在街区所在地点；有 ABN、有效商号，卖吃的还要店铺所在州的食品登记；付装修 + 押金（4 周租金）；2 小时；声望 +3。第 1 版每人一家 |
| 进货 `restockShop` | 人在店里；按进价付钱，不超过库存上限，1 小时 |
| 雇人、辞退 `hireStaff` | 人在店里；最多 2 人。辞退不付遣散费（现实要按雇佣合同和裁决，见【提议】） |
| 看店 `tendShop` | 人在店里，8–14 点开始，每天一次，6 小时，耗精力、长魅力和街头；当天多一份人手，不付自己工资 |
| 每日结算 `settleBiz` | 每个成功动作之后，由 `applyAction` 把店结算到昨天（今天还没过完不算）。没有店时什么都不做、**不消耗随机数** |
| 开门 | 当天店员人数 + 是否看店 > 0 才开门；关门的日子房租照交，口碑 −1 |
| 客流 | 基础客流 × 街区系数 ×（0.6 + 口碑/100 × 0.8）× 周末 1.3 × 随机 0.8–1.2 |
| 卖出 | min(客流, 人手 × 每人接待量, 库存)；来客多于库存（断货）口碑 −2，否则 +0.5 |
| 每天开销 | 周租 / 7 + 店员工资 +12% 养老金 +2% 工伤保险；已登记 GST 时再交（营业额 − 卖出部分的进价）÷ 11 |
| 经营事件 | 每天 8% 抽一件（`SHOP_EVENTS`）：食品检查（登记过期罚 $1,000、口碑 −10；合格口碑 +3）、探店笔记、差评、冰柜坏、货被偷、店员病了、团购。第 1 版自动结算，没有选项 |
| 钱 | 独资经营：店的钱就是你的现金。当天赚了先还欠款；亏了从现金里出，现金不够的部分记欠款 |
| 倒闭 | 欠款 ≥ 3 周租金：店没了，押金抵债，剩下的勾销；声望 −10 |
| 关店 `closeShop` | 先结算；押金扣欠款后退回，库存按进价五折清货，装修不退 |

### 5.4 存档【已落地】

新字段 `biz`（`PlayerState.biz`，按 `save-sync.md` §5）：

```ts
biz: {
  lic: Record<证照id, 办下来的游戏日>;
  gigs: Record<副业id, 最近一次的游戏日>;
  gst: boolean;
  book: { y: 游戏年, gross: 本年营业额, net: 本年净额 };
  shop: { type, site, day, last, stock, staff, tend, rep, debt, bond, hist: 最近 14 天 } | null;
}
```

清洗在 `core/business-save.ts` 的 `cleanBiz()`（单独成文件、只依赖数据表；`character.ts` 只加一行）：旧存档没有时给空值；未知 id 丢掉；日期不晚于今天；`last` 不晚于昨天；数值钳到上限；幂等。没有秘密字段，`publicState()` 不用改。序列化后不到 1 KB。

## 6. 和经济、税务、声望的关系

| 系统 | 关系 | 状态 |
| --- | --- | --- |
| 经济（`claude/earth-economy`） | 店员日薪按它的游戏最低时薪 $20 × 8 小时；副业收入口径对照它的零工（临时工）时薪。合并后建议把 `$160` 改成引用 `ECON.minHourly * 8` | 【已落地】数值对齐；引用【提议】 |
| 经济：每周收支 `weeklyBudget()` | 店铺的每天固定开销可以 ×7 加进去 | 【提议】，等经济分支合并 |
| 净资产 `netWorth()` | 没算押金和库存（没改 `engine.ts`）；排行榜上开店的人会少算押金 | 【提议】：加 `bond + stock × 进价` |
| GST | 营业额到门槛自动登记，之后每笔扣 1/11 | 【已落地】 |
| 所得税 | `biz.book` 按游戏年记营业额和净额，给税务系统当输入；税务合并后（v85）每笔生意的净额也记进税务账本的个体户收入，报税时交所得税（见 tax.md §10） | 接口【已落地】，扣税归税务分支 |
| 声望 | 副业出色 +1；开店 +3；倒闭 −10 | 【已落地】 |
| 声望门槛 | 高级店型（第二家店、连锁）要声望 | 【提议】 |
| 教育职业：学生签证工时 | 现实里学生签证的 48 小时 / 两周限制是否包括自雇工作，这次没查到 Home Affairs 原文，**未接入**。合并后若要算，在 `doGig()` 和 `tendShop()` 末尾调用教育分支的 `logWork()` 即可 | 【提议】，待核实规定 |
| 商店物品：店铺类别 | 杂货店卖的东西可以对应 `STORE_TYPES` 的「亚洲超市」；摄影接单可以要求背包里有相机（物品归商店分支） | 【提议】 |
| 社交 NPC、节日 | 开店后熟人来捧场、节日客流加成 | 【提议】 |

## 7. 服务端与页面【已落地】

- 动作协议（`core/actions.ts`）：`{ t: 'biz', op: 'gig' | 'license', id }`、`{ op: 'open', shop, site }`、`{ op: 'restock', qty }`（1–1000 的整数）、`{ op: 'hire' | 'fire' | 'tend' | 'close' }`。`parseAction` 只查形状；合不合规则（证照、钱、地点、时段、人手、库存）全由 `core/business.ts` 判断，服务端照常经 `applyAction` 结算、`sanitizeState` 落盘，客户端没有新的写存档途径。
- 这些动作不进离线队列（`queueable` 没加），断网时提示要联网。
- 首屏体积（`tools/earth/bundle-report.mjs`）：main 392,679 → 本分支 409,789 字节（+17 KB，数据表 6.8 KB、规则 3.8 KB、卡片 3.8 KB），在临时上限 560 KB 内。要省的话可以把卡片和数据改成打开「地点」页时再加载（提议）。
- 页面：`src/game/ui/business.ts` 的 `bizCard()` 拼「💼 副业与生意」卡片，放在「地点」页的「工作」卡后面。所有来自数据和存档的文字都过 `esc()`。`earth.astro` 只改了三处：一行 import、卡片插入点、点击选择器加 `[data-biz]` 和一个分支（关店要确认）。

## 8. 测试与变异检查【已落地】

`tests/earth/business.test.ts`（23 条）：数据自洽（证照依赖、两个州都能办到副业要的证、街区挂在真实地点下且州一致）；`parseAction` 的合法和非法形状；证照收费、依赖、有效期和续办；家教的州卡不互认；摆摊只在周末；送外卖要 ABN、没车打折；摄影要作品集；代购的确定性和丢货率；晕倒拿不到收入；GST 门槛、扣税、跨年清零；开店条件和扣款；不开门照交房租；雇人后卖货和开销；断货掉口碑；周末客流；动作后自动结算、没店不消耗随机数；看店一天一次；倒闭；关店退款；食品检查罚款；存档缺字段、坏值、幂等；12 个种子 × 250 步随机动作的不变量；服务端走 `parseAction` + 引擎并落盘。

变异检查：手动把 36 处关键逻辑逐一改坏，每处都有测试失败（36/36）。清单：

| # | 改坏的地方 | # | 改坏的地方 |
| --- | --- | --- | --- |
| 1 | 证照到期边界 `<` → `<=` | 19 | 倒闭线放大 |
| 2 | 按州的证照总按西澳 | 20 | 倒闭不扣声望 |
| 3 | 副业每天一次 | 21 | 食品检查不查登记 |
| 4 | 摆摊只在周末 | 22 | 关店不退押金 |
| 5 | 摄影要作品集 | 23 | 雇人上限 |
| 6 | 没车收入打折 | 24 | 看店每天一次 |
| 7 | 登记后交 GST | 25 | 店里操作要人在店里 |
| 8 | 新一年账本清零 | 26 | 店员工资 |
| 9 | GST 门槛 | 27 | 养老金 |
| 10 | 代购丢货 | 28 | 办证收费 |
| 11 | 开店扣钱 | 29 | 周末客流 |
| 12 | 每人一家 | 30 | 没店不能雇人、进货 |
| 13 | 开店查证照 | 31 | 动作后自动结算 |
| 14 | 没人看店不开门 | 32 | 进货数量上限（协议） |
| 15 | 卖货不超过库存 | 33 | 清洗：未来日期 |
| 16 | 断货掉口碑 | 34 | 清洗：店员上限 |
| 17 | 人手上限 | 35 | 清洗：结算日不晚于昨天 |
| 18 | 欠款累积 | 36 | 清洗：已结算的看店日 |

第一轮有 3 处没被抓到（16、24、29），补了测试后全部抓到。随机序列测试还抓到一个真 bug：没有店时「辞退」会崩溃（`shopActions` 对没店返回空对象），已修。

## 9. 模拟结果（`npm run earth:sim -- --days=180 --runs=100`）

2026-11-20 在 main（`4f9c9e5`）和本分支各跑一次，180 天 × 每种策略 100 个种子。

**原有各行：逐字相同。** 把本分支报告里新加的 4 行和「副业与小生意」一节去掉后，和 main 的报告 `diff` 没有差别。原因：没有店的角色 `settleBiz()` 直接返回、不消耗随机数；原有策略不做 `biz` 动作。所以 `balance-report.md` 没有重新生成（经济分支也在改它，合并后以最后合并的为准重跑）。

**新加的 4 条策略**（排在 PLANS 最后，只出报告，不据此调数值）：

| 策略 | 日均净收入 | 期末净资产（中位） | 第 60 天现金 10%–90% | 被收房/人 | 每天的钱（主要几项） |
| --- | --- | --- | --- | --- | --- |
| 对照：咖啡店上班族（原有） | $71 | $28,067 | $6,412–$6,978 | 0.00 | 上班 +229；买房 −50 |
| 副业留学生：家教 + 送外卖 + 代购（无正式工作） | $92 | $20,574 | $6,700–$7,778 | 0.00 | 送外卖 +84、家教 +43、代购 +42 |
| 咖啡店 + 下班家教 | $182 | $36,956 | $9,054–$10,207 | 0.00 | 上班 +228、家教 +37 |
| 咖啡店攒钱开奶茶店（北桥，雇 1 人） | $55 | $13,918 | $6,396–$7,314 | 0.02 | 上班 +224、店铺 +40；开店 −70、进货 −55 |
| 咖啡店攒钱开手机维修铺（维多利亚公园，自己看店） | $146 | $30,433 | **$192**–$6,920 | **0.54** | 上班 +224、店铺 +126；进货 −89、开店 −36 |

| 策略 | 副业次数/人 | 开店（人数，中位开店日） | 期末还开着 | 倒闭/人 | 店铺日均净额 | 登记 GST | 期末本年营业额（中位） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 副业留学生 | 送外卖 145、代购 99、家教 87 | — | — | — | — | 100/100 | $19,615 |
| 咖啡店 + 家教 | 家教 67.5 | — | — | — | — | 0/100 | $2,746 |
| 奶茶店 | — | 100/100，第 106 天 | 100/100 | 0.00 | $40 | 100/100 | $28,560 |
| 手机维修铺 | — | 100/100，第 60 天 | 100/100 | 0.00 | $126 | 71/100 | $18,785 |

注意（只陈述，不下结论，交 Codex 判断）：

- 「咖啡店」行的净资产含买房；新策略都设了 `spend: false`（不上课、不买房、不买车），净资产主要是现金，和对照行不完全可比。
- 「副业留学生」没有正式工作，日均净收入比咖啡店上班族高，但 180 天里没有升职、心情低 5 点。
- 「咖啡店 + 下班家教」比只上班的咖啡店多出约 $37/天，没有新的代价（家教时段 15–20 点和咖啡店班次不冲突）。
- 手机维修铺自己看店：店铺日均 +$126，但每人平均被收房 0.54 次、第 60 天现金 10% 分位只有 $192——机器人把现金压在进货上，周结算时付不起房租。是机器人策略问题还是数值问题，要 Codex 看。
- 一般玩家 180 天内都能在一个游戏年里跨过 GST 门槛 $17,500（奶茶店、副业留学生 100%）。

复现：`npm run earth:sim -- --days=180 --runs=100`（本分支）。

## 10. 待定和提议【提议】

1. **倒闭后的欠款**：现在押金抵完就勾销。现实里独资经营者要个人偿还；可以改成「欠款转成个人债务，每周从收入里扣」，但会让倒闭的玩家长期翻不了身，属于设计取舍，等用户定。
2. **经营事件带选项**：现在自动结算；可以接事件引擎（`claude/earth-event-engine` 分支，开发中），比如差评时选「道歉送券」或「不理」。
3. **市集卖吃的摊**：要食品登记，收入更高。
4. **辞退和雇佣规则**：通知期、遣散费、临时工和兼职店员。
5. **第二家店、连锁**：声望门槛 + 第二个 `shop` 槽（要扩展—收缩改存档形状，或新加字段）。
6. **店铺价值进净资产**（第 6 节）。
7. **商铺租约到期续租、涨租**：现实零售租约有期限，可以每游戏年涨租。
8. **南澳工伤保险（ReturnToWorkSA）**和各州最低工资裁决：本批没查到原文。
9. 学生签证工时是否计入自雇工作：待核 Home Affairs 原文（第 6 节）。

## 11. 合并 main（2026-11-23，`9fb5028`）时做的

- **冲突**（7 个文件）：`README.md`、`actions.ts`、`character.ts`、`types.ts`、`earth.astro`、`sim.ts`（副业和开店策略、统计和 main 的平衡工具、运动、签证、生涯统计各节都留）、更新日志（改为 v84）。
- **页面**：生意卡放进今天页「在这里」的「工作」抽屉，跟在工作卡后面；抽屉摘要算上能做的副业和自己的店。
- **副业和看店是工作**（`workRules()`，原来 §6 写「未接入」的那条现在接上了）：
  - 签证过期不能做；学生签证在读学历课程期间，副业和看店的时间算进每两周 48 小时（`logWork`）。Home Affairs 对「工作」的定义是通常有报酬的活动，自雇也算；条件 8105 的原文没有逐页核对。
  - 生了不能上班的病（`illnessBlock(…, ['work'])`）不能做；灾害让这里停工（`workStopped`）时也不做。
  - 看店按钮和模拟机器人都按同一条规则判断。
- **生涯统计**：副业、证照、开店、进货都记「工作与零工」；店铺每天结算的钱不管由哪个动作触发，都单独记成「工作与零工」的收入或支出，不和这次动作的钱混在一起（店里的进货、雇人、关店先结算时也一样）。模拟的经济流水表也按同样口径单独记 `shop-days`。
- **复核修正**（3 个角度，每条都做了反驳核查；确认 12 条，去重后 6 项，全部已处理）：店内操作先结算时收支混成一笔净额；看店按钮在工作规则不允许时还能点；「工作」抽屉摘要只写职位；48 小时上限的测试被 `if` 包着从来没跑到；模拟经济流水把店账算到触发动作头上；文档。
  - 没改的：倒闭当天那一步的店账在模拟里仍记在触发动作头上（只影响模拟报告的分类，不影响游戏）；60 天回归基线里开店的两个策略还没攒够钱开店（开店在第 60 天以后），要测开店逻辑得看 180 天报告或加一个提前开店的基线策略（交 Codex 决定）。
- **测试**：`business.test.ts` 27 条（新加 4 条）。故意改坏 9 处，全部抓到。
- **模拟**（180 天 × 100 次，对比 main `9fb5028`）：原有策略各行逐字相同；新加的四条副业、开店策略见报告「副业与小生意」一节，生涯统计对账仍是 $0。回归基线加了这四条（共 19 种策略）。平衡交 Codex。
- **首屏**：gzip 245,782 → 251,705 字节（+5.9KB），上限调到 252,800；未压缩上限 784,500。
