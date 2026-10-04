# Squarefolk（方族）

方形四边网格上的轻量回合制 4X —— 触摸优先、全平台同源、**CC BY-NC-SA 4.0 非商业开源**。

## 当前状态

**M0 · 规格先行** —— 目前只有设计文档与规格，尚无实现代码。
交付顺序：① 语言无关的 `core-spec.md` ② 黄金测试向量 `testdata/golden/` ③ 参考实现 ④ 配置工具 CLI（validate / diff / sim / dump）。

## 文档

- **[docs/design.md](docs/design.md)** —— 设计文档 v0.9（权威设计：基线调研、战斗/经济/地图、三件套架构、多平台与发行、授权、待拍板清单 §9）
- **[docs/core-spec.md](docs/core-spec.md)** —— 语言无关的可编码规格（骨架）+ 黄金测试向量格式
- **[docs/README.md](docs/README.md)** —— 文档地图与按角色阅读路线
- **[CONTRIBUTING.md](CONTRIBUTING.md)** —— 贡献流程、PR 自检清单、授权声明
- **[AGENTS.md](AGENTS.md)** —— coding agent 约定与红线（必读顺序、5 条硬红线、完成定义、目录与提交约定）

## 架构：三件套分离

| 件 | 内容 | 形态 |
| --- | --- | --- |
| **规则 core** | 战斗 / 移动 / 围城 / 回合 / 胜负 | 纯函数、整数、headless；**语言无关规格 + 黄金向量**，换框架 = 换执行器 |
| **数值 data** | 单位 / 科技 / 地形 / 平衡常数 | JSON + JSON Schema，`schemaVersion` / `rulesVersion` / `contentHash` |
| **界面 shell** | 渲染 / 输入 / 网络 / 平台适配 | 各平台壳 + per-shell 资产清单（core 不读路径与表现数据） |

## 目录（规划）

```
docs/             设计与规格
data/             内容与数值（JSON 源）
testdata/golden/  语言无关黄金测试向量
core/             规则核心
tools/            配置工具 CLI + 桌面编辑器
```

## 许可

CC BY-NC-SA 4.0 —— 允许非商业使用与再分发（演绎作品同许可共享），**作者保留商业授权权**。详见 [LICENSE.md](LICENSE.md)。
