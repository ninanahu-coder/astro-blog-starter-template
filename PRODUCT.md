# Product

<!-- impeccable:product-schema 1 -->

> 范围：本仓库里的游戏「地球人生 / Terra Life」（`/earth`）。仓库其余部分是博客模板，不在本文件范围内。

## Platform

web

## Users

在西澳、南澳生活的华人和留学生（2026-11-20 用户确认）。手机为主，中文界面。他们本人就在游戏地图覆盖的真实城市里，可以用「人到现场」打卡：走进真实的餐馆、健身房、公园，游戏里也能做事。

## Product Purpose

在真实地图上过另一种人生的在线生活模拟：吃、睡、清洁、娱乐、社交五项需求，七项用进则长的能力，出行、打工、租房买房，到达地点触发事件，和同地点的玩家互动，手机电脑多端云同步。

## Positioning

地图、地点、店铺都是真实的（西澳、南澳 35 个地点，数据来自 OpenStreetMap / Wikidata），玩家本人到了现场，游戏里也能做事。别的生活模拟可以照搬玩法，搬不走这层和玩家所在城市的对应。

## Operating Context

- 手机浏览器，可加到主屏幕（PWA）；电脑也能玩同一个存档。
- 开场流程：新玩家按四步创建角色（名字、形象、出身、性格特质选 2 个）后进入游戏；老玩家用同步码或扫码从云端恢复存档。
- 创建角色需要联网（服务器建档）。

## Capabilities and Constraints

- Astro 5 部署在 Cloudflare Workers + Durable Object；页面在 `src/pages/earth.astro`，用 HTML 字符串渲染，所有插值必须经过 `esc()`。
- 规则引擎在 `src/game/core`，保持纯函数；界面改动不碰规则和数值。
- 新数值标「待平衡」，Claude 不下平衡结论；数据只来自 OSM、Wikidata 或种子数据。
- 推任何分支都会直接部署到正式环境。

## Brand Commitments

- 名称「地球人生」，原创设定：不使用任何现有游戏的名称、角色、美术或关卡。
- 开场必须保留（2026-11-20 用户确认）：
  - emoji 形象：10 个 emoji 头像；
  - 四步创建：名字、形象、出身、性格；
  - 同步码恢复入口；
  - 三条卖点：真实地图、人到现场、多端同步。
- 中文文案，干货为主，不写套话。

## Evidence on Hand

- `public/earth/cgi/`：35 张地点主视觉、84 张事件插图、17 张 NPC 头像，均为 GPT image 2 生成的示意图（不是实拍），出处见 `docs/earth-game/README.md` 第 7 节。
- 4 个出身、10 个性格特质、10 个 emoji 形象定义在 `src/game/core/character.ts` 和 `src/game/data/traits.ts`。
- 没有真实玩家数量、评价或媒体报道，界面上不能编造。

## Product Principles

- 真实优先：地点、店铺、数据都能追到来源，界面不夸大。
- 手机一只手能玩：主操作在拇指够得着的地方。
- 每天上线几分钟就有收获，没有重罚。

## Accessibility & Inclusion

- 已有约定：弹窗焦点管理、`aria-live`、进度条 `role="progressbar"`；改界面时保持。
- 支持浅色、深色两套主题，跟随系统。
