# 商店与物品系统设计（第 34 批）

> 分支 `claude/earth-shop-items`，更新日志 v34。
>
> 标记说明：**【现状】** 是 main（e429bcd）里已经有的；**【已落地·第一版】** 是本批写进代码的；**【提议】** 只是设计，没写代码。
> 本批所有新数值都标「待平衡」，平衡结论由 Codex 跑模拟后给出，本文不下结论。

相关文档：[economy-plan.md](economy-plan.md)（车、课、体验、家具、房产）；经济分支 `claude/earth-economy` 的 `economy-design.md`（收入侧和价格尺度，尚未合并）。

## 1. 现状速览【现状】

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 物品表 | `src/game/data/items.ts` | 15 件。`use` 是消耗品，`passive` 是随身装备；`shop` 按地点类别（`kind`）或标签（`tag`）决定在哪能买；`max` 是每件最多带几个 |
| 查物品 | `core/attributes.ts` 的 `getItem()` | |
| 商店 | `core/engine.ts` 的 `shopAt()`、`buyItem()`、`useItem()` | 价格 = 标价 × 特质折扣（精打细算 0.85）；买一件花 5 分钟 |
| 装备加值 | `attributes.ts` 的 `checkScore()` | 同一项检定只取加值最高的一件，不叠加；有 `weather` 的只在那几种天气生效 |
| 背包 | 存档 `inventory: Record<物品id, 数量>`；页面的 `bagIds` 是 NPC 卡片上的送礼按钮 | 只有每件的 `max`，没有总容量；`sanitizeState()` 丢掉不认识的物品、把数量钳到 1..max |
| 送礼给 NPC | `engine.ts` 的 `interactNpc(…, 'gift')`、`giftReaction()` | 最爱 +15 / 喜欢 +9 / 一般 +3 / 讨厌 −8；不指定物品时自动挑反应最好的，随身装备不会被自动送 |
| 玩家之间交易 | `core/trade.ts` + `server/world.ts` 的 `handleTrade()` | 送礼、二手摊，见第 6 节 |
| 真实超市采购 | `formulas.ts` 的 `groceriesOutcome()` | 到真实超市（`wa/sa.venues.json` 里的 `supermarket`）$14 买 3 根能量棒 + 3 瓶水（便利店要 $27） |
| 卖车 | `engine.ts` 的 `sellBlocked()`、`sellVehicle()` | 车行营业时间内按残值回收 |
| 家具 | `data/furniture.ts`；`engine.ts` 的 `furnitureAt()`、`furnitureValue()`、`getFurniture()`；`attributes.ts` 的 `furnitureSets()` | 不进背包，按槽位摆在住处；换新、搬走时半价折现 |

## 2. 价格参照【已落地·第一版：只新增两件，旧价格没动】

方法：只列找到来源的价格。来源全部是 2026-11-20 的网络搜索摘要，**没有打开原文核对**，所以都标「转述」；搜到的多是比价网站快照，日期见备注。没找到来源的不填现实价。

| 物品 | 游戏价 | 现实参照 | 来源（转述：搜索摘要） | 游戏 / 现实 |
| --- | --- | --- | --- | --- |
| 饮用水 | $3 | Woolworths 600 mL × 12 装 $5.35，约 $0.45 一瓶 | [Grocerize](https://www.grocerize.com.au/product/7782396657747/spring-water-bottles-600ml-x-12-pack)（快照日期不明） | 游戏价相当于便利店单瓶，比超市整箱贵很多；超市便宜这一点已经由「真实超市采购」体现 |
| 外带咖啡 | $5 | 珀斯 flat white 均价约 $6.50 | [CommBank 2026-01 新闻稿](https://www.commbank.com.au/articles/newsroom/2026/01/why-coffee-is-still-getting-more-expensive.html) | ≈ 0.77 |
| 急救包 | $35 | Bunnings：FastAid 小号软包 $21；Sandleford 中号急救箱 $42.88 | [Bunnings 急救包类目](https://www.bunnings.com.au/our-range/tools/safety-equipment-workwear/first-aid-kits)、[BuyWisely](https://buywisely.com.au/product/sandleford-first-aid-box-medium-h360xw310x100mm) | 在两者之间 |
| 防晒霜 | $12 | Cancer Council Everyday Value SPF50 110 mL 原价 $14.95，比价最低 $6.97 | [Cancer Council 网店](https://www.cancercouncilshop.org.au/collections/tube/products/everyday-value-sunscreen-spf50-110ml)、[BuyWisely](https://buywisely.com.au/product/cancer-council-everyday-value-sunscreen-spf50-110-ml-1) | 在两者之间 |
| 电解质冲剂 | $4 / 包 | Hydralyte 24 包装 $17.99，约 $0.75 一包 | [Chemist Warehouse](https://www.chemistwarehouse.com.au/buy/75449/hydralyte-orange-sachets-value-pack-4-9g-x-24)（2025-01 快照） | ≈ 5，明显偏高（**只记录，不改**，交给 Codex 评估） |
| 鱼竿 | $40 | BCF 入门套装：Okuma Steeler $49.99，Shimano Fishquest $74.99 | [BCF](https://www.bcf.com.au/p/okuma-steeler-spinning-combo-6ft-6in/M608311.html)、[BuyWisely](https://buywisely.com.au/product/shimano-fishquest-spinning-combo-6ft-2-4kg) | ≈ 0.5–0.8 |
| 冲浪板 | $350 | 7 尺软板：Redback $269.95；Softlite $429.95–499.95 | [Long Reef Surf](https://longreefsurf.com.au/products/redback-noosa-malibu-woodgrain-softboard)、[BuyWisely](https://buywisely.com.au/product/softlite-chop-stick-7ft-softboard-in-sand) | 在区间内 |
| **巧克力夹心饼干**（新） | $6 | 一包 200 g 的巧克力夹心饼干，Woolworths 平时 $6（2026-05 半价目录写「原价 $6」；2024 年报道 Woolworths $6、Coles $4.50） | [OzBargain](https://www.ozbargain.com.au/node/959691)、[The Nightly](https://thenightly.com.au/business/price-of-tim-tam-biscuits-in-australia-compared-to-overseas-prompts-big-questions-of-coles-woolworths-and-arnotts-c-16359263) | 1 |
| **一束鲜花**（新） | $15 | Coles 母亲节花束系列里最小的一束 $15 | [National Tribune 转载的 Coles 新闻稿](https://www.nationaltribune.com.au/coles-reveals-what-mums-really-want-this-mother-s-day/)（日期不明） | 1 |
| 能量棒、防蝇网帽、澳式睡袋、备用油桶、雨衣、折叠伞、宽檐帽、防水袋 | 沿用 | 没查 | — | 待 OpenClaw 采价 |

打折贴的时间点：Woolworths 发言人说**没有固定时间**，按门店和库存而定；员工说法是傍晚 6 点后可以再降价，面包在烤出当天下午 5 点到关门之间贴价签（[Yahoo 新闻](https://au.news.yahoo.com/woolworths-employee-reveals-the-best-time-to-shop-markdown-bargains-121720542.html)，转述）。游戏取「18 点起半价」是**设计选择**，不是现实规则，待平衡。

读法：小件消费品基本按现实零售价（便利店口径）定，不像房价那样缩到 1/5。这和经济分支 `economy-design.md` 第 2 节的「工资约八折、房租约五折、房价两折」口径不冲突，但消费品偏贵、收入偏低，合并后由 Codex 一起看。

## 3. 物品分类

`ItemDef.cat`（`core/types.ts`），不写时 `core/shop.ts` 的 `itemCat()` 按「有 `use` → 消耗品，有 `passive` → 装备，都没有 → 礼物」推断。其他分支新加物品可以不写 `cat`，类型检查不会报错。

| 分类 | 现有物品 | 用途 | 叠加 | 耐久 | 背包上限 |
| --- | --- | --- | --- | --- | --- |
| 消耗品 | 饮用水、能量棒、外带咖啡、急救包、电解质冲剂 | 用掉补需求或健康【现状】；NPC 委托交物【`claude/earth-social-npc` 分支】 | 同种叠加到 `max`（3–10）【现状】 | 一次性，用一次 −1【现状】 | 每件 `max`【现状】 |
| 装备 | 防蝇网帽、澳式睡袋、备用油桶、雨衣、折叠伞、宽檐帽、防晒霜、防水袋、鱼竿、冲浪板 | 持有就加检定，同一项只取最高一件；天气限定的只在那几种天气算【现状】；鱼竿是钓鱼的门槛【现状】 | 每件 `max: 1`【现状】 | 没有【现状】；见第 9 节提议 | 1 |
| 礼物 | 巧克力夹心饼干、一束鲜花【已落地·第一版】 | 送 NPC、送玩家；饼干也能吃 | 饼干 3、鲜花 1 | 鲜花标 `perish`（易腐），第一版只用于打折贴；「过夜枯萎」见第 9 节提议 | 每件 `max` |
| 收藏 | 暂无背包物品 | 现在的收藏都是记录不是物品：体验收藏册 `collected`、图鉴 `dex`、鱼获 `fish`、天气相册 `photos`【现状】 | — | — | — |
| 家具外观 | 不是背包物品 | 家具按槽位摆在住处，有功能（睡眠恢复、解锁做饭/放松、舒适度）【现状】；外观和装修由 `claude/earth-home-vehicle` 分支负责，本批不碰 | 每槽一件 | 没有 | 每槽一件 |

**防刷相关的分类规则**【已落地·第一版】：二手店只收装备和收藏，消耗品和礼物不收（吃的喝的拆过了，花和饼干不回收）。

## 4. 商店类型和真实店铺的对应

### 4.1 店铺类别表【已落地·第一版：数据表 + 商店里显示「XX 有卖」】

`src/game/data/shops.ts` 的 `STORE_TYPES`，物品用 `stores` 字段指向它。**这个字段只用于标注和对应真实店铺，不决定游戏里在哪能买**（那仍是 `shop` 字段，没改，所以模拟结果不变）。

| 店铺类别 | OSM 标签 | 已采集进真实地点？ | 对应物品 |
| --- | --- | --- | --- |
| 便利店 / 加油站 | `shop=convenience`；`amenity=fuel` | 否 | 水、能量棒、咖啡、伞、饼干 |
| 超市 | `shop=supermarket` | **是**：西澳 129 家、南澳 88 家（类型 `supermarket`） | 水、能量棒、伞、防晒霜、电解质、饼干、鲜花 |
| 亚洲超市 | 没有统一标签，要在 `shop=supermarket` / `convenience` 里按名称筛（待核） | 否 | 第一版还没有对应物品 |
| 药房 | `amenity=pharmacy`；`shop=chemist` | 否 | 急救包、防晒霜、电解质 |
| 五金店 | `shop=hardware`；`shop=doityourself` | 否 | 急救包、备用油桶 |
| 户外露营店 | `shop=outdoor` | 否 | 防蝇网帽、睡袋、油桶、雨衣、宽檐帽、防水袋 |
| 冲浪店 | `shop=surf` 或 `shop=sports` + `sport=surfing`（**待核**，OpenClaw 采集前先查 OSM wiki） | 否 | 冲浪板、防水袋、宽檐帽 |
| 渔具店 | `shop=fishing` | 否 | 鱼竿 |
| 花店 | `shop=florist` | 否 | 鲜花 |
| 咖啡馆 | `amenity=cafe` | **是**：西澳 232 家、南澳 141 家（类型 `cafe`） | 外带咖啡 |

测试检查：每件物品都写了 `stores`，类别都在表里；写了 `venue` 的类别，对应的真实地点类型确实存在。

### 4.2 游戏地点里在哪能买【现状，未改】

游戏里的 35 个地点没有逐家店，商店按地点类别和标签开：城市、港口、城镇、海岸、矿区、海岛卖日用品；内陆、矿区卖防蝇网帽；海滩、冲浪点卖冲浪板、防水袋；鱼竿在港口、海岸、城镇和海滩。新增的饼干和日用品一样，鲜花只在城市和城镇。

### 4.3 真实店铺购物【提议】

- 「附近」页到了真实超市，除了现有的「采购」（固定一篮子），再加「逛超市」：列出 `stores` 含 `supermarket` 的物品，按超市价（比游戏地点商店便宜，比例待平衡）购买。走现有的真实地点动作通道（`venueAction()`，服务端核对定位、冷却）。
- 其余店铺类别等 OpenClaw 按第 4.1 节的 OSM 标签采集（采集脚本 `npm run earth:fetch-venues`，只收 OSM 来源）。采集到哪一类，就给那一类开对应物品的购买。
- 到店事件（`venue-events.ts`）可以按店铺类别加：冲浪店老板推荐浪点、五金店遇到同乡师傅……文案不得用现有游戏的专有名称。

## 5. 买卖、折扣、打折贴、二手

| 项目 | 规则 | 状态 |
| --- | --- | --- |
| 买价 | 标价 × 特质折扣（精打细算 0.85）× 打折贴，四舍五入，至少 $1（`core/shop.ts` 的 `buyPrice()`） | 特质折扣【现状】；整合进 `buyPrice()`【已落地·第一版】 |
| 打折贴 | 标了 `perish` 的物品，18:00 到午夜半价（`SHOP_RULES.markdown`，待平衡）；商店里显示 🏷️ 和原价。第一版只有鲜花 | 【已落地·第一版】 |
| 二手店 | 城市、城镇（`SHOP_RULES.sellKinds`）可以把装备、收藏卖掉，回收标价的 40% 向下取整（`SHOP_RULES.sellBack`，待平衡），花 10 分钟；新动作 `{ t: 'sell', item }` | 【已落地·第一版】 |
| 服务端校验 | `parseAction()` 只收合法 id（多余字段如 `price` 丢掉）；`applyAction()` → `sellItem()` 在服务端重算：有没有事件挂着、背包里有没有、这类收不收、这里有没有二手店；价格只由服务端算 | 【已落地·第一版】 |
| 卖家具、卖车、卖房 | 半价 / 残值 / 95% | 【现状】，不变 |
| 周末大促、会员价 | 按 `dateOf()` 的星期几给某类店打折 | 【提议】，要先有真实店铺购物 |

**防刷不变量**（`tests/earth/shop.test.ts` 会查，改数值时测试会挡住）：

1. 任何能回收的物品，回收价 < 最低可能买价（所有省钱特质叠满、打折贴时段）。所以「买了马上卖」一定亏。
2. 回收比例 < 二手摊最低价比例（`trade.ts` 的 `SALE_MIN` = 50%）。所以「从别人二手摊低价收、转手卖给二手店」也一定亏。
3. 能回收的物品不能是易腐物品（打折贴只用在不回收的东西上）。

## 6. 玩家之间交易【现状，本批只加了不变量】

已经有（`trade.ts`、`world.ts`）：

- 送礼和二手摊。挂单只在服务器内存里，30 分钟没人接自动撤；每人同时最多挂 3 件，每人最多 3 份待收的礼物，每个地点最多 30 张挂单。
- 只能交易物品，不能直接转钱。
- 每人每个现实日最多送出、收下各 5 次（买卖也算）。
- 二手摊价格限定在商店价的 50%–150%。
- 成交时服务端锁住双方存档，重新读档后调用 `applyTrade()`，任何一方条件不满足就拒绝。

本批的影响：

- 新礼物可以送、可以挂摊。鲜花打折贴时 $8 买进、挂摊最高能卖 $22：这是玩家之间的钱转手，不是凭空生钱，仍受每天 5 次和价格区间限制。
- 二手店回收（40%）低于二手摊最低价（50%），小号之间互倒再卖店不赚钱（见第 5 节不变量 2）。

【提议】

- 物品加 `bind: true`（绑定）：任务奖励、成就奖励、限定纪念品不能交易、不能卖店，防止拿小号刷任务奖励再转给大号。`giveBlocked()` 里加一行即可。
- 易腐物品不能挂二手摊（只能直接送人），减少打折贴转卖。

## 7. 和送礼、任务、成就的关系

| 系统 | 现在怎么连 | 本批 | 给其他分支的接口 |
| --- | --- | --- | --- |
| NPC 送礼 | 物品 id 写在 NPC 的 `gifts.love/like/dislike` | 新礼物没写进任何 NPC 的喜好（避免和社交分支同改 `npcs.ts`），所以对所有人都是「一般」+3 | 社交分支可以按人设把 `biscuits`、`flowers` 加进喜好；测试已查 NPC 喜好里的物品都存在 |
| NPC 委托 | `claude/earth-social-npc` 的 `npc-favors.ts` 按 id 引用水、能量棒、急救包、电解质、防晒霜、宽檐帽、咖啡 | **旧物品 id 一个没改**；测试锁住了这 15 个 id | — |
| 任务奖励 | 效果 `Effect.items` 已经能发物品（`addItems()` 会钳到 `max`）【现状】 | 没改 | `claude/earth-quests` 发奖励物品直接用 `items`；如果要发不可交易的奖励，用第 6 节提议的 `bind` |
| 成就 | `data/achievements.ts` | 没加 | 【提议】「第一次卖二手」「送出 10 件礼物」「集齐 N 种装备」等，等任务成就分支合并后再加，避免同改一个文件 |
| 宠物 | `claude/earth-pets-wildlife` 有 `pets.ts`（未提交） | 没碰 | 宠物用品可以直接加进 `ITEMS`：狗粮之类算消耗品，牵引绳算装备；`ItemCat` 不够用可以加 `'pet'` |
| 家具外观 | `claude/earth-home-vehicle` | 没碰 | 家具不进背包，本批的 `sellItem()` 不处理家具 |

## 8. 第一版落地清单【已落地·第一版】

| 文件 | 改动 |
| --- | --- |
| `src/game/core/types.ts` | `ItemDef` 加可选的 `cat`、`stores`、`perish`；新类型 `ItemCat`、`StoreType`、`StoreTypeDef` |
| `src/game/data/shops.ts` | 新增：`STORE_TYPES`（10 类）、`SHOP_RULES`（回收、打折贴，待平衡） |
| `src/game/data/items.ts` | 15 件旧物品补 `cat`、`stores`；新增饼干、鲜花 |
| `src/game/core/shop.ts` | 新增纯函数：`itemCat`、`markdownNow`、`buyPrice`、`sellPrice`、`hasSecondHand`、`sellItemBlocked`、`storesOf` |
| `src/game/core/engine.ts` | `shopAt()` 改用 `buyPrice()`、带 `markdown` 标记；新增 `sellItem()` |
| `src/game/core/actions.ts` | `GameAction` 加 `{ t: 'sell', item }`；`parseAction`、`applyAction` 接上 |
| `src/pages/earth.astro` | 商店每行显示分类和「XX 有卖」、打折贴原价；「我 · 资产」背包每行显示分类，能卖的显示「卖 $N」（不能卖时按钮禁用、悬停说原因）；礼物显示「留着送人」。插值的文字都经过 `esc()` |
| `src/game/data/changelog.ts` | v34 |
| `tests/earth/shop.test.ts` | 新增 8 条 |
| `tests/earth/fuzz.test.ts` | 随机动作加 `sell`，并要求 `sell` 的成功路径至少走到一次；修车厂保养在候选里多放几次（见下） |
| `tests/earth/attributes.test.ts` | 「每件物品要么能用要么是装备」放宽为「……或者是礼物」 |

**卖二手不进离线队列**：`ui/queue.ts` 的 `queueable()` 对买卖一律返回 false，`sell` 落在默认分支，和 `buy` 一样必须在线。

**fuzz 测试的调整**：物品表多了两件后随机序列变了，`vehicle:service`（修车厂保养）这次一次都没走到，覆盖检查失败。单独构造「有车、在珀斯、开了 6,000 公里」的角色保养是成功的，所以是覆盖率靠运气，不是引擎出错。按测试里已有的做法（在家做饭、放松也这样处理），把保养在候选动作里放三次。

### 变异检查

对新代码逐个注入 15 种错误，每次跑 `shop`、`fuzz`、`attributes`、`trade` 四个测试文件，看能不能失败：

| 变异 | 结果 |
| --- | --- |
| 打折贴 `>=` 改 `>`；买价不打折贴；商店列表不标打折贴 | 都抓到 |
| 回收向上取整；回收比例改 0.6；消耗品也收 | 都抓到 |
| 处处有二手店；有事件也能卖；没有也能卖 | 都抓到 |
| 卖了不给钱；卖了不扣物品；卖东西不花时间 | 都抓到 |
| 协议不收 `sell`；`applyAction` 不分发 `sell` | 都抓到 |
| 分类推断顺序（先看 `passive` 再看 `use`） | 第一轮**漏掉**；补了「既能用又有加值的算消耗品」一条后抓到 |

最终 15/15。脚本没有放进仓库（一次性检查）。

## 9. 没做的和后续【提议】

| 项目 | 设计 | 为什么第一版不做 |
| --- | --- | --- |
| 装备耐久 | 冲浪板、鱼竿、睡袋这类按「触发加值的次数」磨损，用满变「旧」，加值减半；修车厂之外加「修理」或折价换新 | 要改存档结构（`inventory` 是 `id → 数量`，放不下每件的耐久），和社交、任务、直播等分支同改 `types.ts`、`character.ts` 的冲突面太大 |
| 背包总容量 | 背包 12 格（同种叠加算 1 格），有车 +6、露营车 +12 | 会改变模拟机器人的行为，也要做旧存档迁移，先让 Codex 评估 |
| 鲜花过夜枯萎 | `perish` 物品买了以后跨一个游戏日就消失 | 要记每件的购买时间，同耐久 |
| 亚洲超市物品 | 茶叶、月饼、辣酱这类送华人 NPC 的礼物 | 没找到价格来源；要等 OpenClaw 采集亚洲超市地点和价格 |
| 纪念品（收藏品） | 每个片区一件限定纪念品，只能在当地买，可绑定 | 价格来源没有 |
| 真实店铺购物 | 见第 4.3 节 | 除超市、咖啡馆外的店铺类别还没有采集 |
| 物品 `bind` | 见第 6 节 | 等任务分支合并后一起做 |

## 10. 模拟结果

`npm run earth:sim -- --days=180 --runs=100`，改动前（main e429bcd）和改动后各跑一次，结果见本节末。

**结果：两份报告逐字相同（81 行，`diff` 无差异），本批没有改变任何模拟数字。**

原因（解释，不是平衡结论）：旧物品的标价、在哪能买都没改，`buyPrice()` 对非易腐物品算出的价格和原来的 `Math.round(标价 × 特质折扣)` 一样；模拟机器人只买能量棒、只用能量棒、水、急救包，不买新礼物，也不会卖二手。所以 `balance-report.md` 没有重新生成。二手店回收和打折贴对经济的影响，要等模拟机器人学会这两种行为后才看得出来，留给 Codex。

## 11. 合并注意

- `src/game/core/types.ts`：只在 `ItemDef` 末尾加了三个可选字段和三个新类型，社交、任务、宠物、直播分支也在改这个文件，位置不重叠。
- `src/game/core/engine.ts`：只改了「物品」一节（`shopAt` 附近）和文件头两行 import。
- `src/game/core/actions.ts`：`GameAction` 联合类型、`parseAction` 的 `buy/use` 分支、`applyAction` 的 `use` 下一行；社交、任务、直播分支也改这个文件。
- `src/pages/earth.astro`：商店卡片、背包行、点击选择器里加 `[data-sell]`、点击处理加一行、import 一行。
- `src/game/data/changelog.ts`：顶部 v34 条目。
- `tests/earth/fuzz.test.ts`：其他分支加动作时也会改 `MUST` 列表。
- 其他分支如果新增物品，不写 `cat`、`stores` 也能通过类型检查，但 `shop.test.ts` 的第一条要求每件都写 `stores`，合并时补上即可。
