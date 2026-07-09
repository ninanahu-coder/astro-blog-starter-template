# 安宅 · OpenClaw 房产投资 Agent 部署指南

这是一个**真 Agent**（接大模型、实时查数、有记忆），与 `/api/tg/*` 的脚本化演示 bot 互补：
演示 bot 给投资人看「产品形态」，安宅给种子客户交付「真实价值」。

## 文件结构

```
openclaw/agents/property/
├── SOUL.md                        # 人格、能力、数据纪律、合规红线
├── AGENTS.md                      # 工作流手册（/suburb、现金流、周报、报告解读）
├── skills/
│   └── property-cashflow/SKILL.md # 现金流与负扣税计算公式（含自检示例）
└── README.md                      # 本文件
```

## 部署步骤（在运行 OpenClaw 的机器上）

1. **建 bot**：BotFather `/newbot` → 名称「安宅 · 澳洲房产研究」，记下 token
2. **放置工作区**：把本目录拷到 OpenClaw 工作区位置，例如
   `cp -r openclaw/agents/property ~/.openclaw/workspaces/property`
3. **注册 agent 与绑定**（合并进 `~/.openclaw/openclaw.json`；字段名以你安装版本的
   `openclaw --help` / 官方文档为准，以下为多 agent 常见结构示意）：

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "property",
        "name": "安宅 · 房产投资研究",
        "workspace": "~/.openclaw/workspaces/property"
        // 模型路由建议：日常问答走中档模型，报告解读/周报走 Claude
      }
    ]
  },
  "bindings": [
    { "agentId": "property", "match": { "channel": "telegram", "accountId": "anzhai" } }
  ],
  "channels": {
    "telegram": {
      "accounts": { "anzhai": { "botToken": "<BotFather 给的 token>" } }
    }
  }
}
```

4. **周报定时任务**（OpenClaw cron / 或系统 cron 调 CLI）：
   每周一 08:00 AWST 触发 prompt：`执行 AGENTS.md 第 3 节：生成上周珀斯拍卖与挂牌简报并推送`
5. **重启网关**，给 bot 发三条验收消息：
   - `/suburb Willetton` → 应返回带来源的画像表
   - `帮我算：75 万，首付两成，利率 6.1%，周租 650，税率 37%` → 应返回 ≈ −$133/周（公式自检值）
   - 发一段英文合同截图 → 应返回 🔴🟡🟢 三段式摘要

## 成本与风控

- 真 Agent 有推理成本：建议模型路由（粗活便宜模型、细活 Claude），单客户月成本可控在几美元级
- SOUL.md 的合规红线与每条输出的 disclaimer **不可删**——这是信息服务与持牌建议的边界
- 给投资人演示时：安宅演示「真数据能力」，脚本 bot 演示「产品矩阵」，两者一起上效果最好

## 与产品矩阵的关系

安宅 = 「分析线」的行业化落地 + 「获客线」房产垂直的入口；
沉淀的客户偏好（预算/区域）直接喂给自建客户库，高净值线索转介安澜。
