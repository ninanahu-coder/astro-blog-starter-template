# 随机事件引擎

分支 `claude/earth-event-engine`。本文说明事件引擎**第一版之前的现状**、**本分支已落地的第一版**、**还只是提议的部分**。每一节标题后面都标了属于哪一类。

代码位置：

- 规则层（纯函数）：`src/game/core/event-rules.ts`
- 抽取和结算：`src/game/core/engine.ts` 的 `pickArrivalEvent`、`pickVenueEvent`、`startEvent`、`resolveEvent`
- 数据：`src/game/data/events.ts`（到达事件，末尾合入 `VENUE_EVENTS`、`SA_EVENTS`、`TRAIL_EVENTS`）、`events-sa.ts`、`venue-events.ts`、`trail-events.ts`（实地路线的到站和沿途事件，合并 main 后加入）
- 测试：`tests/earth/event-engine.test.ts`

---

## 1. 现状（第一版之前，main 4f9c9e5）

### 1.1 数据

每个事件是一条 `GameEvent`：`id`、`title`、`icon`、`text`、`weight`、`choices`。共 84 个：西澳到达事件 + 南澳签名事件 64 个，真实地点（到店）事件 20 个。其中 25 个 `once`（地标签名事件）、3 个抛锚事件、1 个盘查事件（`heat-check`），这 4 个 `weight: 0`。

匹配条件（都可不写）：

| 字段 | 含义 |
| --- | --- |
| `locs` / `tags` / `kinds` | 地点 id、地点标签、地点类型，**任一命中**即可；都不写是全局事件 |
| `arrivedBy` | 到达方式（自驾、越野、轮渡、飞机）；GPS 抵达不算任何方式 |
| `seasons` | 季节 |
| `weather` | 抵达地点当天的天气 |
| `periods` | 时段（清晨 5–8、白天 8–17、傍晚 17–20、夜晚 20–5） |
| `hours` | 整点区间 `[开, 关)` |
| `venueTypes` | 真实地点事件：只在这些类型的真实地点做完事后抽，到达城镇时不出 |
| `once` | 每个角色只出一次，首次到访必出 |
| `breakdown` | 抛锚事件，只在该保养的车自驾抵达时按几率抽 |

选项 `EventChoice`：`label`、`cost`（先付的钱）、`check`（能力检定 `{ skill, dc }`）、`exposed: 'sea'`（风暴天不能选）、`ok`、`fail`。结果 `Outcome` 是 `{ text, fx }`，`fx` 走 `applyEffect`。

### 1.2 抽取

到达（`arrive` → `pickArrivalEvent`），先后：

1. 麻烦值 ≥ 60 → 必出盘查；
2. 首次到访且池里有 `once` 事件 → 掷 1 次骰，从签名事件里等概率选一个；
3. 这趟抛锚了 → 抛锚事件；
4. 池空 → 不出；
5. 掷 1 次骰，> 0.55 → 不出（`ARRIVAL_EVENT_CHANCE`）；
6. 再掷 1 次骰，按 `weight` 加权抽一个。

池 = `weight > 0`、条件匹配、`once` 没出过的事件。

真实地点（`venues.ts` 的 `venueEvent` → `pickVenueEvent`）：现实时间至少隔 `FIX_RULES.eventGapMin` 分钟；池 = `weight > 0`、`venueTypes` 含这个类型、季节匹配、`once` 没出过；掷 1 次骰过几率，再掷 1 次按权重抽。**只看季节**，不看时段、天气。

抛锚在 `travel` 里另抽（从 `breakdown` 事件里等概率），作为 `override` 传进到达抽取。

### 1.3 结算和确定性

- 抽中后写 `state.pending = { eventId }`。有待处理事件时不能出行、互动、交易。
- `resolveEvent`：查选项、扣 `cost`、`once` 记进 `state.seen`、检定（`checkScore + roll × 60 ≥ dc`）、`applyEffect`、写日志。
- 所有随机数来自 `roll(state)`（mulberry32，状态存在 `state.seed`）。同一份存档、同一串动作，结果相同。
- 事件数据没有加载时校验，只有零散的测试（id 唯一、`locs` 存在、付费选项文字、`hours` 合法……）。

### 1.4 缺口

- 没有冷却和次数上限：同一个高权重事件可以连着出，`weight` 是唯一的控制手段；
- 没有事件链：一个选择不会影响以后遇到什么；
- 条件只有地点、时间、天气，不能按属性（钱、能力、需求）、NPC 关系、物品；
- 到店事件只看季节；
- 内容写错（字段名拼错、引用不存在的东西）不会报错，事件默默不出现；
- GPS 路线分支（PR #55）的到站事件按 id 直接挂 `pending`，绕过抽取，也就不会有任何记录。（合并 main 后已改成走 `startEvent`，见 §6。）

---

## 2. 设计原则（第一版）

1. **不写 = 和以前一样。** 所有新字段可选；全局防厌倦规则默认关闭。现有事件（第一版时 84 个，合并 main 后 97 个，多出的 13 个是实地路线事件，权重都是 0）的抽取结果、掷骰次数、种子走向都不变。之后合进来的法律分支又加了 2 个交通事件（共 99 个），并且 `driving` 事件只在自己开车时进池，这是法律分支有意的改动。
2. **规则层是纯函数，不碰随机数。** `event-rules.ts` 里的函数只接收数据、返回新数据；需要随机的地方（按权重抽）由调用方传进一个 [0,1) 的数，引擎只用 `roll(state)` 产生它。
3. **数据驱动。** 新玩法写在事件数据里，引擎不为某个事件写特例（AGENTS.md）。
4. **加载时报错。** `data/events.ts` 末尾调用 `assertEvents(EVENTS)`，数据有问题直接抛错并列出全部问题；`npm test` 在合并前就会跑到。
5. **新数值一律【待平衡】。** 本分支不定任何建议值，只提供开关。

---

## 3. 数据格式（第一版，已落地）

在 1.1 的字段之外新增（都可不写）：

### 3.1 事件字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `need.min` | `{ [数值]: number }` | 下限（含）。数值可以是 `cash`、`health`、`respect`、`heat`、五项需求（`hunger` `energy` `hygiene` `fun` `social`）、七项能力（`stamina` `strength` `driving` `swimming` `charisma` `survival` `street`） |
| `need.max` | 同上 | 上限（含）。例：`{ energy: 30 }` 只在很累时出现 |
| `need.rel` | `{ npc, min?, max? }[]` | 和某 NPC 的关系分在范围内；没认识过算 0 |
| `need.items` | `string[]` | 身上各至少有 1 个这些物品 |
| `cooldown` | 游戏小时 | 出现后这么久内不再出现 |
| `daily` | 正整数 | 每个游戏日最多出现几次 |
| `max` | 正整数 | 每个角色一共最多出现几次（`once` 是 1 次**且首次到访必出**；`max` 只限次数） |
| `locked` | `true` | 链式事件：要被某个结果解锁才会出现，见 §3.3 |
| `unlockDays` | 游戏日 | 链式事件解锁后这么多天内没出现就作废；不写不过期 |

### 3.2 结果字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `unlocks` | `string[]` | 结算到这个结果时解锁这些 `locked` 事件 |
| `then` | `string` | 结算完立刻接着弹出这个事件（同一场景的下一幕） |

`unlocks`、`then` 写在**结果**（`ok` / `fail`）上而不是选项上，所以检定成功和失败可以走向不同的后续。

### 3.3 事件链的两种写法

- **延后（`unlocks` + `locked`）**：选择现在做，后果以后在合适的地方出现。被解锁的事件仍然要满足自己的地点、时间、天气、属性条件；条件满足时**优先于**随机事件出现（不看 `weight`，不掷到达几率），出现一次就消耗掉，要再出现得再被解锁。已经解锁着的事件被重复解锁时不刷新解锁时间（免得反复选同一项一直续着）。
- **立刻（`then`）**：同一场景的下一幕。不掷骰，不受冷却、次数、条件限制。

例：

```ts
{
	id: 'old-fisherman', title: '码头的老渔夫', icon: '🎣', locs: ['fremantle'], weight: 3, cooldown: 72,
	text: '老渔夫在补网，说明早要出海，缺个帮手。',
	choices: [
		{ label: '答应明早来', ok: { text: '他说五点在码头等你。', fx: {}, unlocks: ['fisherman-dawn'] } },
		{ label: '问问他年轻时的事', ok: { text: '他放下网。', fx: { minutes: 20 }, then: 'fisherman-story' } },
	],
},
{
	id: 'fisherman-dawn', title: '天没亮的码头', icon: '🌅', locs: ['fremantle'], periods: ['dawn'], locked: true, unlockDays: 2, weight: 0,
	text: '老渔夫已经在船上了。',
	choices: [ /* … */ ],
},
```

（示例只说明格式，不是本分支加入的内容；数值待平衡。）

### 3.4 校验规则（加载时报错）

`validateEvents()` 返回全部问题，`assertEvents()` 有问题就抛错。只查事件数据自身能判断的：

- id 唯一，只用小写字母、数字、连字符；
- 不认识的字段报错（抓拼写错误，如 `cooldwon`），事件、选项、结果、`need` 各一张白名单；
- `title` `icon` `text` 非空；`weight` ≥ 0；至少一个选项；
- `seasons`、`periods`、`weather`（从 `data/weather.ts` 读，天气分支加新天气时跟着变）、`hours` 取值合法；
- 真实地点事件不能同时写城镇匹配条件；抛锚事件 `weight` 必须是 0；`once` 和 `locked` 不能同时写；
- `cooldown`、`unlockDays` > 0，`daily`、`max` 是正整数；`unlockDays` 只能配 `locked`；
- `need` 的键必须是可比较的数值，`min` 不能大于 `max`；`need.rel` 每项至少写 `min` 或 `max`；
- 选项：有 `fail` 必须有 `check` 或 `risk`；`check.skill` 是七项能力之一；不能所有选项都下海；
- 保险（第 43 批，v78）的 `exposure` 只能写 `home`，不能配 `venueTypes`；这种事件只在回到自己住处所在地点时进抽取池（`engine.ts` `atOwnHome()`）。
- 法律（第 43 批）带来的三个字段：事件 `driving` 只能写 `true`，不能配 `venueTypes`；选项 `risk` 是 0 到 1 之间（不含两端）的几率，必须配 `fail`；结果 `law` 是违章 id 或 `breath`（取值由测试按 `data/law.ts` 另查）；
- `unlocks` 指向存在的 `locked` 事件；`locked` 事件必须有人解锁；`then` 指向存在的事件且不能绕成圈。

地点、真实地点类型、NPC、物品、心情等**外部 id** 在测试里按世界数据另查（`event-engine.test.ts` 第一条），不在加载时查——那需要把地图数据拉进首屏。

`arrivedBy`、`kinds` 只查是非空字符串数组，不查取值：交通分支在加新的到达方式（`transit`、`rail`、`walk`），取值由 TypeScript 类型保证，运行时写死清单会和并行分支打架。

---

## 4. 抽取和记录（第一版，已落地）

### 4.1 抽取顺序

到达：

1. 麻烦值 ≥ 60 → 盘查（来源记 `forced`）；
2. 首次到访 + 池里有签名事件 → 掷 1 次（`signature`）；
3. 抛锚 → 抛锚事件（`forced`）；
4. **新**：池里有已解锁的链式事件 → 最早解锁的那个，同时解锁的按数据顺序；**不掷骰**（`chain`）；
5. 随机池空，或**新**：今天随机事件已到全局上限 → 不出；
6. 掷 1 次过 0.55；
7. 掷 1 次按权重抽；**新**：权重先过防厌倦打折（`random`）。

池 = 条件匹配 + `once` 没出过 + **新**：`need` 满足、冷却已过、每日和总次数没满、（链式）已解锁未过期、不在最近 `repeatGap` 个里。`weight > 0` 的要求对链式事件不适用。

真实地点：同样走 4–7（几率用 `FIX_RULES.eventChance`）。**新**：除季节外也看 `periods`、`hours`，以及所在城镇当天的 `weather`。现有 20 个到店事件都没写这三项，所以结果不变。

没有链式事件、全局规则关着时，第 1–7 步掷骰的次数和顺序与第一版之前**逐次一致**：测试「向后兼容」在 4000 个随机局面里把新实现和原样搬过来的旧实现对照，事件 id 和最终种子都相同。

### 4.2 记录：`startEvent` 和 `evMem`

任何来源的事件挂成 `pending` 时都应调用 `startEvent(state, ev, src)`：写 `pending`，并记进 `state.evMem`（`noteTriggered`）。现在的来源有到达、真实地点、事件链的下一幕、实地路线。事件自带的附带效果也在 `startEvent` 里统一做：被查（`heat-check`）挂上「有麻烦」状态，带 `animal` 的事件记进图鉴，所以事件链的下一幕、路线事件也一样生效：

```ts
evMem: {
	day: number;                    // rand、today 是哪个游戏日的
	rand: number;                   // 当天随机抽中的事件数（只有 random 来源计入全局上限）
	today: Record<string, number>;  // 写了 daily 的事件：今天几次
	last: Record<string, number>;   // 写了 cooldown 的事件：最近一次的游戏分钟
	n: Record<string, number>;      // 写了 max 的事件：一共几次
	recent: string[];               // 最近出现的事件 id，最多 16 个
	open: Record<string, number>;   // 已解锁、还没出现的链式事件 -> 解锁时的游戏分钟
}
```

只记写了对应规则的事件，体积和事件总数无关（现有事件都没写，只有 `recent` 会有内容，约 16 × 20 字节）。

`resolveEvent` 在应用效果前调用 `noteResolved` 记下 `unlocks`（途中晕倒也算解锁了），效果结算完再按 `then` 挂下一幕。

存档清洗按 `save-sync.md` §5：`createCharacter` 给空记录，`sanitizeState` 一行 `cleanEvMem(r.evMem, EVENTS, clock)`。旧存档没有这个字段给空记录；只留现在还存在、而且写了对应规则的事件；游戏分钟不晚于存档 `clock`；记号日期晚于今天视为坏值；任何输入不抛异常；幂等。没有改 `SAVE_VERSION`。`evMem` 不含秘密，不需要在 `publicState` 里清。

### 4.3 全局防厌倦规则 `EVENT_POLICY`【待平衡】

| 规则 | 含义 | 第一版默认（= 关闭） |
| --- | --- | --- |
| `dailyMax` | 每个游戏日最多几个**随机抽中**的事件（到达 + 到店合计）；签名、链式、盘查、抛锚不占名额 | `0`（不限） |
| `repeatGap` | 同一个事件出现后，至少隔几个别的事件才能再出现 | `0`（不限） |
| `fatigue` / `fatigueN` | 最近 `fatigueN` 个里出现过的事件，权重乘 `fatigue` | `1` / `8`（不打折） |

打开任何一项都会改变抽取结果（`dailyMax` 会让一部分抵达不再掷骰，`repeatGap` 改池子，`fatigue` 改权重），所以第一版全部关着，**数值由 Codex 跑模拟分析后、用户拍板再开**。引擎已经接好：测试「全局规则打开后引擎照办」临时打开 `dailyMax: 1`、`repeatGap: 3`，确认每天最多 1 个随机事件、相邻 3 个内不重复。

请 Codex 在平衡分析里看：机器人每天遇到几个随机事件（分布，而不是平均）、同一事件连续出现的频率、哪些高权重事件占比过高。

---

## 5. 内容作者速查（第一版）

1. 在 `events.ts`（西澳）、`events-sa.ts`（南澳）、`venue-events.ts`（到店）里加一条；
2. 不想它刷屏：写 `cooldown`（小时）或 `daily`；
3. 只给特定的人：写 `need`（钱、能力、累不累、和谁关系好、带没带某样东西）；
4. 想要后续：在某个结果上写 `unlocks: ['后续事件 id']`，后续事件写 `locked: true`（`weight` 写 0 即可，链式事件不看权重），需要时限写 `unlockDays`；同一场景的下一幕用 `then`；
5. 跑 `npm test`：写错会在 `event-engine.test.ts` 和加载时报出具体事件 id 和原因；
6. 新事件的效果数值标【待平衡】；文案不使用现有游戏的专有名称、角色或台词（AGENTS.md）。

---

## 6. 和并行分支的关系

| 分支 | 关系 | 合并时 |
| --- | --- | --- |
| `claude/earth-gps-route`（PR #55） | 到站、沿途事件 `weight: 0`，在 `core/trails.ts` 里直接写 `state.pending = { eventId }`，不经抽取 | 已合并（2026-11-21 合并 main 时）。`trails.ts` 的两处改成 `startTrailEvent` → `startEvent(state, ev, 'forced')`，路线事件也记进 `evMem`，以后写冷却、次数上限、链式解锁都算数。抽取结果不变（权重 0，不进池）。用它的事件数据跑过 `validateEvents`：94 个全部通过 |
| `claude/earth-transport` | 新增 `arrivedBy: ['transit' / 'rail' / 'walk']` 事件 | 校验不查 `arrivedBy` 取值，不会误报；用它的事件数据跑过：87 个全部通过 |
| `claude/earth-weather` | 三个事件加了 `cold` 天气 | 校验从 `data/weather.ts` 读天气清单，合并后那边的 `WEATHERS` 带着 `cold`，不会误报。只拿它的事件配本分支的天气表会报 3 条，这是预期的 |
| `claude/earth-live-social`（PR #56） | 不碰事件引擎 | `PlayerState` 都加了字段（对方 `live`、`blocked`，本分支 `evMem`），`types.ts`、`createCharacter`、`sanitizeState` 各一行，合并时两边都留 |
| 其他给 `PlayerState` 加字段的分支 | 同上 | 同上 |

`pickVenueEvent` 的返回值从 `GameEvent | null` 改成 `{ ev, src } | null`（为了把来源交给 `startEvent`）。调用方只有 `core/venues.ts`，已改；其他分支如果新调用了它，合并时按新签名改。

---

## 7. 验证（第一版）

- `tests/earth/event-engine.test.ts` 18 条：校验规则（32 种写错）、条件边界、冷却 / 每日 / 总次数 / 链式 / 不重复 / 防厌倦的纯函数、按权重抽和旧写法逐个一致、4000 个随机局面和旧实现对照、同种子逐字相同、事件链 / 冷却 / 每日次数接进引擎、全局规则打开后引擎照办、存档清洗。
- 变异检查：对 `event-rules.ts` 和 `engine.ts` 做 32 处单点变异（边界 `<` / `<=`、删掉某条规则、链式消耗、种子消耗、清洗不钳……），每处单独跑测试，**32 处全部被测试抓到**。
- `npm run earth:sim -- --days=180 --runs=100`：改动前后输出见 §8。

## 8. 模拟结果

改动前（main 4f9c9e5）和改动后输出**逐字相同**（`diff` 无差异）。2026-11-21 合并最新 main（fdd7b44）后再比一次，仍和 main 逐字相同，回归基线 `earth:baseline` 无变化。原因：现有事件没有写任何新字段、全局规则默认关闭，抽取池、掷骰次数和顺序都没变；新加的 `evMem` 只记录，不参与现有事件的抽取。

---

## 9. 后续提议（未做）

| 提议 | 说明 | 谁 |
| --- | --- | --- |
| 打开全局防厌倦规则 | 按 §4.3 请 Codex 分析后定值 | Codex 分析，用户拍板，Claude 实施 |
| 第一批链式事件内容 | 例如码头老渔夫、合租室友、打工老板三条短链（2–3 幕），先在一个城市试 | 文案和数值待平衡 |
| 给现有高权重事件加 `cooldown` | 会改变现有抽取结果，需要和平衡一起做 | 同上 |
| 界面提示「有后续」 | 解锁了链式事件时在日志里给一句提示（不剧透内容） | Claude，改 `earth.astro` 局部 |
| 主线剧情、任务分支接事件链 | `story.ts` 的目标可以写成「某个链式事件出现过」；等任务分支（`claude/earth-quests`）定了目标格式再接 | 待定 |
| 条件里加「去过某地」「做过某职业」「有房 / 有车」 | 现在 `need` 只能比数值、关系、物品；按需要再加，加之前先确认没有别的分支在做 | 待定 |
