# 人物模型（Blender）

玩家形象原来只是 10 个 emoji。这一版用 Blender 脚本生成原创三维人物，渲染成图片给游戏用。

## 1. 产物

| 文件 | 内容 |
|---|---|
| `tools/earth/blender/character.py` | 生成器：只用放样管和椭球体建模，不引用任何第三方模型、贴图或插件 |
| `tools/earth/blender/looks.json` | 10 个形象（顺序和 `AVATARS` 一一对应）+ 14 套装束（4 个出身 + 10 个职业） |
| `tools/earth/blender/make-spec.mjs` | 从游戏数据生成渲染清单（60 个人物） |
| `tools/earth/blender/export.py` | 证件照转 256×256 WebP；全身照补脚下影子（展示用） |
| `tools/earth/blender/sheet.py` | 拼总览图，目检用 |
| `public/earth/char/` | 40 张证件照（4 出身 × 10 形象），共约 340KB，平均 8.5KB；`manifest.json` |

**还没接进游戏界面**：入境卡和主界面仍显示 emoji，存档里 `avatar` 也仍是 emoji。

## 2. 怎么跑

```bash
node tools/earth/blender/make-spec.mjs
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/earth/blender/character.py -- --spec tools/earth/blender/out/spec.json --out tools/earth/blender/out --samples 64
python3 tools/earth/blender/export.py tools/earth/blender/out
```

- M4 Max、Cycles + Metal：60 张约 4–5 分钟。
- `--only id1,id2` 只重渲部分人物，结果并进已有的 `report.json`。
- `--blend 路径.blend --lineup id1,id2` 额外把这些人物并排存成 `.blend` 和 `.glb`，可在 Blender 里打开看模型。
- **门禁**：有人物出画面、或一张都没渲出来，Blender 以非零退出。
- `tools/earth/blender/out/` 不进仓库。

## 3. 数值怎么变成外形（系数都「待平衡」）

| 游戏数值 | 外形 | 档位 |
|---|---|---|
| 力量 | 肩宽、胸厚、手臂粗细 | 连续 |
| 体能 | 腰线收紧 | 连续 |
| 精力 < 35 | 驼背、眼睛半闭、眉毛压低 | 连续 |
| 娱乐和社交的平均 | 嘴角上扬或下垂；低时眉头上抬（难过，不是生气） | 连续 |
| 清洁 < 35 / < 15 | 脸和衣服上 2 / 4 块灰 | 3 档 |
| 出身、职业 | 整套装束（上衣、裤子、鞋、背包、安全帽、围裙、工牌……） | 换件 |

魅力、街头、驾驶**故意不影响长相**：长相和「讨不讨人喜欢」挂钩会变成以貌取人。

证件照只用出身的起步力量和体能；需求和职业的变化只在展示用的全身照里体现，因为游戏里还没有按当前数值重渲的机制。

## 4. 参考了什么（GitHub，2026-11-20 用 GitHub API 核对过）

| 仓库 | 借鉴 | 许可证（读的是仓库原文） |
|---|---|---|
| makehumancommunity/makehuman | 「宏形态」：少数几条连续轴（体重、身高）驱动体型 | 代码 AGPL；素材 CC0；LICENSE.md 写明输出不受限制 |
| makehumancommunity/mpfb2 | 人物参数存成预设，可复现 | 代码 GPLv3；素材 CC0 |
| LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator | 体型底 + 分层换装 | 代码 GPL-3.0；素材逐张不同，含 CC-BY-SA（要署名、衍生作品要同许可） |
| DLR-RM/BlenderProc | `blender run 脚本` 的无界面批量渲染流程 | GPL-3.0 |

**这一版没有用上面任何一个仓库的代码或素材**，只借鉴做法，所以不受它们的许可证约束。以后要换成 MakeHuman/MPFB 的写实人体，只能把它们当离线工具，只提交渲染出来的图；LPC 素材要逐张查许可，不能整包用。

## 5. 已知不足

- 戴鸭舌帽时卷发两侧的发卷像耳罩。
- 力量 100 和 10 的体型差别仍偏小。
- 人物是站姿，没有骨骼和动画；要做动作需要另加骨架。
- 帽子类配件只在全身照里戴，证件照不戴（免得每张证件照都是安全帽）。

## 6. 下一步（待定）

1. 把证件照接进入境卡：选形象时显示对应出身的证件照，emoji 留作加载失败时的后备。
2. 给 NPC 做全身像，替换现在的 AI 生成头像（需要先定风格是否统一）。
