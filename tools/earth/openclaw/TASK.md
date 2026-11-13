# OpenClaw 采集任务：西澳 POI

> 这份文件是给 OpenClaw 代理的任务说明（可直接作为 skill / 任务提示词使用）。
> 产物是**纯数据 JSON**，不改游戏代码；合并由 `npm run earth:pois` 完成，Codex 负责审查合并后的 PR。

## 目标

为 `src/game/data/wa.ts` 里的每个游戏地点采集 5–15 个值得“实地打卡”的兴趣点（POI）。

## 允许的数据源（只用开放许可的数据）

| 来源 | 用途 | 许可 | 备注 |
| --- | --- | --- | --- |
| OpenStreetMap（Overpass API） | 坐标、类别 | ODbL | 必须保留署名；`source: "osm"`，id 用 `osm-<type>-<id>` |
| Wikidata（SPARQL） | 中英文名、地标 | CC0 | `source: "wikidata"`，id 用 `wd-<qid 小写>` |

不要抓取：Google Maps、TripAdvisor、点评类网站、任何需要登录或条款禁止抓取的站点；不要采集个人信息、私人住宅、原住民禁入的圣地。

## 步骤

1. 读取 `src/game/data/wa.ts`，拿到每个地点的 `id / lat / lon / radiusKm`。
2. 对每个地点，在其 `radiusKm` 范围内查询 OSM：`tourism=attraction|viewpoint|museum`、`natural=beach`、`leisure=park`、`historic=*`、`amenity=marketplace|pub`。
3. 只保留有名字、且公众可进入的条目；按知名度（有 wikidata/wikipedia 标签优先）挑 5–15 个。
4. 名字写成 `中文名 English Name`；没有通行中文名时只写英文，不要自己音译。
5. 按 `poi.schema.json` 输出到 `tools/earth/openclaw/inbox/wa-<日期>.json`。
6. 运行 `npm run earth:pois -- --dry-run`，校验通过后再运行不带 `--dry-run` 的版本，并提交 PR。

## 验收

- `npm run earth:pois` 无报错（schema、坐标落在所属地点半径内、id 不重复）。
- `npm test` 通过。
- PR 描述里写明数据源、查询时间、条目数。
