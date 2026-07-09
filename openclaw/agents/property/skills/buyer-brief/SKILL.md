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

## 第三步 · 输出模板

① 需求画像表（客观逐行 + 主观清单；标明哪些进了查询、哪些留给看房）
② 查询链接组（REA 深链；物业级对照附 onthehouse）
③ 看房核实 checklist（全部主观项 + 无法线上确认项）
④ 固定 disclaimer 行（见 AGENTS.md）

## 红线

- 深链只给客户**点开 REA 官方页面**用——绝不自动抓取链接返回的内容（ToS 禁爬）
- 需要引用挂盘/成交数字时走 Domain 官方 API（有 key）或 PropTrack 月报口径并署名
- 只做「区间与成交对照」呈现，不给出价指令、不做信贷建议
