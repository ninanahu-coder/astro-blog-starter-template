---
name: buyer-brief
description: 买家需求画像与关键词找房。当用户说「帮我找房」「预算 XX 想买」或给出预算/区域/户型等条件时使用：结构化收集客观与主观因素，生成模仿 realestate.com.au 查询机制的关键词深链组合。
---

# 买家需求画像 → 关键词找房（查询机制模仿 realestate.com.au）

## 第一步 · 需求画像（一次问全，客观 + 主观分开记）

**客观因素（硬条件，直接进查询 URL）**

| 字段 | 示例 | 进查询的方式 |
|---|---|---|
| 预算区间 | A$750k–850k | `between-750000-850000` |
| 目标 suburb（1–5 个） | Willetton / Riverton | `in-willetton,+wa+6155;+riverton,+wa+6155` |
| 房型 | house / townhouse / unit / land | `property-house` |
| 卧 / 浴 / 车位 | 4 / 2 / 2 | `with-4-bedrooms`（浴与车位提示客户用页面筛选） |
| 土地面积 | ≥450㎡ | 关键词或页面筛选 |
| 结构 / 建造 | 双砖 double brick、建成年代 | 关键词 `double+brick` |
| 户型 | 单层 / 双层、open plan、theatre、granny flat | 关键词 `single+storey,granny+flat` |
| 学区 / 通勤 | Willetton SHS 学区、火车站 2km 内 | suburb 圈定 + 尽调核实 |

**主观因素（软偏好——能转关键词的转，不能转的进看房清单）**

- 可转关键词：北向采光 `north+facing`、已翻新 `renovated`、原始状态可改造 `original+condition`、
  泳池 `pool`、工作间 `workshop`、可分割潜力 `subdivision`
- 只能看房核实：街区氛围与噪音、私密性、实际采光、动线与风水朝向、邻里状况——
  逐条列入「看房核实 checklist」，绝不假装查询能覆盖

## 第二步 · 生成查询组合（REA 深链模板）

```
https://www.realestate.com.au/buy/property-<type>-with-<N>-bedrooms-between-<min>-<max>-in-<suburb>,+wa+<postcode>/list-1?keywords=<k1,k2>
```

- keywords 逗号分隔多词，空格用 `+`
- 把 `/buy/` 换成 `/sold/` = 同条件近期成交——用来校准预算是否现实
- 固定输出 3–5 组，每组附一句「这组能看到什么」：
  ① **严格版**（全部硬条件 + 最重要的 2 个关键词）
  ② **放宽版**（去掉最弱的条件 / 扩一个 suburb）
  ③ **成交校准版**（sold 口径，判断预算 vs 市场）
  ④ 可选：关键词替换版（如 renovated ↔ original condition 两种策略）

## 第二步 B · 有 Domain API key 时：实时房源查询（优先于纯链接）

realestate.com.au 无公开 API（PropTrack 仅商业协议），实时房源走 **Domain 官方 API**：
`POST https://api.domain.com.au/v1/listings/residential/_search`（Header `X-Api-Key`）

画像 → 请求体字段映射：

| 画像字段 | API 字段 |
|---|---|
| 预算区间 | `minPrice` / `maxPrice` |
| 目标 suburb | `locations:[{state:"WA",suburb,postCode,includeSurroundingSuburbs:true}]` |
| 房型 | `propertyTypes:["House"\|"Townhouse"\|"ApartmentUnitFlat"\|"Villa"\|"VacantLand"]` |
| 卧/浴/车 | `minBedrooms` / `minBathrooms` / `minCarspaces` |
| 土地面积 | `minLandArea` |
| 户型/结构关键词 | `keywords:["double brick","single storey",…]` |

返回 top 5–6：地址 · 卧浴车 · 土地 · displayPrice · 上架天数 · 设施 · `domain.com.au/<listingSlug>` 链接；
末尾仍附同条件 REA 深链交叉核对。查询失败或 0 结果 → 自动放宽后重查，最后给纯链接兜底。

## 搜索机制对齐 realestate.com.au（参数模型参考 GitHub）

| REA 搜索行为 | 我们的实现 |
|---|---|
| 默认排序＝最新上架 | `sort:{sortKey:"DateListed",direction:"Descending"}`；可切 Price 升/降 |
| Buy / Sold 频道 | `listingType: "Sale" / "Sold"`；REA 深链 `/buy/` ↔ `/sold/` |
| Surrounding suburbs 开关 | `includeSurroundingSuburbs`（用户说「只看本区」→ false） |
| 排除 under offer | REA 深链加 `misc=ex-under-contract`（API 侧无对应字段，深链承担） |
| 设施筛选（泳池/空调…） | `propertyFeatures:["Pool","AirConditioning","SecureParking","Ensuite","Study"]` |
| 无精确匹配→展示放宽结果 | 三级级联：严格 → 去关键词/设施 → 预算 ±10% + 含周边区，结果注明放宽级别 |

**GitHub 参考（仅借鉴数据/参数模型，不部署）**：
- `tomquirk/realestate-com-au-api`——REA 非官方接口封装；借鉴其 search 参数设计
  （channel、surrounding_suburbs、exclude_under_contract、min/max bedrooms、sort、keywords）。
  该项目为非官方且禁商用，REA ToS 禁第三方接口——**绝不部署**，只对齐参数语义
- `fsingletonthorn/domain-public-api-client`——Domain 官方 API 客户端实现参考

## 第三步 · 输出模板

① 需求画像表（客观逐行 + 主观清单；标明哪些进了查询、哪些留给看房）
② 查询链接组（REA 深链；物业级对照附 onthehouse）
③ 看房核实 checklist（全部主观项 + 无法线上确认项）
④ 固定 disclaimer 行（见 AGENTS.md）

## 红线

- 深链只给客户**点开 REA 官方页面**用——绝不自动抓取链接返回的内容（ToS 禁爬）
- 需要引用挂盘/成交数字时走 Domain 官方 API（有 key）或 PropTrack 月报口径并署名
- 只做「区间与成交对照」呈现，不给出价指令、不做信贷建议
