# Squarefolk（方族）

方形四边网格上的轻量回合制 4X —— 触摸优先、全平台同源、**CC BY-NC-SA 4.0 非商业开源**。

## 当前状态

**规格 + 核心规则已实现，沙盒 demo 可玩**（自由探索、无对手、可通关）：

- **规格冻结**：[docs/core-spec.md](docs/core-spec.md) §0–§4.7 —— 状态模型、9 类动作谓词、结算管线、战斗/移动/围城/经济/建设/淘汰全域细则
- **黄金向量 43 条**（`testdata/golden/`：combat 12 / meta 2 / move 6 / vision 3 / territory 2 / turn 18），全部由规格手算 + 独立参考实现双重校验，**非由实现反向生成**
- **规则核心**（`core/`，TypeScript 纯函数、整数运算、无 I/O）：战斗、确定性移动（Dijkstra + ZOC + 道路）、视野三态、动态领地、九类动作（训练/移动/攻击/采集/建设/研究/升级/治疗/结束回合）、经济与改善产出、T4 宽限淘汰
- **测试**：`npm test` = 类型检查 + 向量 runner + 单测，**98 断言全绿**
- **沙盒 demo**（`npm run demo` → `demo/squarefolk.html`）：单文件、零外链、双击即玩 —— 迷雾、领地染色、经济闭环（收入/训练/采果/建农场/升级/研究）、胜利判定
- 未实现：世界生成算法（T3）、sim 对局模拟与平衡工具、多平台壳、建设的 demo UI

交付顺序：① 语言无关规格 ✅ ② 黄金向量 ✅ ③ 参考实现 ✅（核心规则）→ ④ 配置工具 CLI（validate / diff / sim / dump）→ ⑤ 世界生成 → sim → 平台壳

## 文档

- **[docs/design.md](docs/design.md)** —— 设计文档（基线调研、战斗/经济/地图、三件套架构、多平台与发行、授权、决策记录 D1–D13 / T1–T6、修订日志）
- **[docs/core-spec.md](docs/core-spec.md)** —— 语言无关的可编码规格（实现与测试的唯一真相源）
- **[docs/README.md](docs/README.md)** —— 文档地图与按角色阅读路线
- **[CONTRIBUTING.md](CONTRIBUTING.md)** —— 贡献流程、PR 自检清单、授权声明
- **[AGENTS.md](AGENTS.md)** —— coding agent 约定与红线（必读顺序、硬红线、完成定义）

## 快速开始

```bash
npm install    # 仅 devDependencies（typescript/esbuild）
npm test       # tsc + 43 条黄金向量 + 单测（98 断言）
npm run demo   # 打包单文件 demo → demo/squarefolk.html（双击即玩）
```

## 架构：三件套分离

| 件 | 内容 | 形态 |
| --- | --- | --- |
| **规则 core** | 战斗 / 移动 / 围城 / 回合 / 胜负 | 纯函数、整数、headless；**语言无关规格 + 黄金向量**，换框架 = 换执行器 |
| **数值 data** | 单位 / 科技 / 地形 / 平衡常数 | JSON + JSON Schema，`schemaVersion` / `rulesVersion` / `contentHash` |
| **界面 shell** | 渲染 / 输入 / 网络 / 平台适配 | 各平台壳 + per-shell 资产清单（core 不读路径与表现数据） |

## 目录

```
docs/             设计与规格（真相源）
data/             内容与数值（JSON 源）
testdata/golden/  语言无关黄金测试向量
core/             规则核心（TypeScript）
demo/             单文件沙盒试玩（esbuild 打包）
scripts/          构建脚本
tools/            配置工具 CLI（规划中）
```

## 许可

CC BY-NC-SA 4.0 —— 允许非商业使用与再分发（演绎作品同许可共享），**作者保留商业授权权**。详见 [LICENSE.md](LICENSE.md)。
