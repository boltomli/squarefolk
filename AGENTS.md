# AGENTS.md — 给 coding agent 的工作说明

> 任何在此仓库工作的 AI coding agent（omp / Codex / Claude Code / Cursor …）先读本文件。
> 人类贡献者请同时读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 这是什么项目

**Squarefolk（方族）** —— 方形四边网格上的轻量回合制 4X，触摸优先、全平台同源。
开源但**非商业**：CC BY-NC-SA 4.0（见 [LICENSE.md](LICENSE.md)）。

> **当前阶段：M0 · 规格先行。仓库里没有实现代码，只有设计文档、规格骨架与测试向量。**

## 必读顺序

1. **本文件**（约定与红线）
2. **[docs/design.md](docs/design.md)** —— 唯一权威设计文档（v0.9）。按需读章节，不必通读：
   - §3 战斗系统（公式、姿态与先手、8 组标定数值）—— 动战斗代码前**必读**
   - §4 机制（经济与 TTR、围城、胜利条件）
   - §5.1 核心可移植设计（7 个 API 入口、移植性硬规则）—— 动 core 前**必读**
   - §5.2 确定性五军规 —— 写**任何**代码前必读
   - §6 数据五层与三红线 / §6.2 sim 方法论 —— 动数据或工具前必读
   - **§9 待拍板清单** —— 标 ✅ 的才是定案；🔶 候选与 ⏸ 暂缓的**不要实现**
3. **[docs/core-spec.md](docs/core-spec.md)** —— 可编码规格（骨架已建，M0 逐步填充）
4. **[docs/README.md](docs/README.md)** —— 文档地图与阅读路线

## 硬红线（违反 = 任务失败）

1. **确定性**：战斗与结算路径禁随机、禁浮点、禁系统时间、禁 I/O。数值定点（属性 ×10），四舍五入只在**最后一步 half-up**，不调用语言自带 round()。
2. **三件套边界**：core **不许硬编码任何数值**（连"3 杀晋升"也是配置项）；core 不读 i18n / presentation；数据文件里**不许出现文件路径**；持久化只用字符串 id（`unit.warrior`），**禁止枚举整数入库**。
3. **遍历显式排序**（按 id / 坐标），不依赖哈希表迭代序；PRNG 用 core-spec 指定算法，禁 `Math.random()` / `rand()`。
4. **许可**：禁止引入 GPL 系代码（design §7.2 红线表）；禁止使用 Polytopia 的任何素材、命名、数据文件；复用 MIT/Apache/CC0 代码需保留版权头并在文件中注明来源。
5. **不替项目拍板**：§9 中标 🔶 / ⏸ 的决策未定案；遇到规格空白或歧义 → **停下来报告**，不要自行发明语义。

## 任务如何交付（完成的定义）

- 任务必须附带两样东西：**对应的 core-spec 章节** + **黄金向量**（`testdata/golden/`）。
- **完成 = 黄金向量 100% 断言通过 + 相关文档同步更新**，不是"我觉得写完了"。
- 交付说明里列出：改了哪些文件、跑了什么命令、真实输出是什么（贴结果，不贴形容词）。
- 规格有歧义导致实现卡住 → 在**规格层**报告（引用 design.md / core-spec.md 具体行），不要在实现层绕过去。
- 改动 `docs/design.md` 必须同时在文件顶部的**修订记录**追加一行。

## 目录约定

```
README.md            项目门面
AGENTS.md            本文件
CONTRIBUTING.md      贡献流程与授权声明
LICENSE.md           CC BY-NC-SA 4.0
docs/
  README.md          文档地图
  design.md          权威设计文档（v0.9，~1000 行）
  core-spec.md       可编码规格（骨架 → 随 M0 填充）
data/                [规划] 内容与数值 JSON 源（schema 见 design §6）
testdata/golden/     [规划] 语言无关黄金测试向量
core/                [规划] 规则核心（语言待定，见 design D13）
tools/               [规划] 配置工具 CLI + 桌面编辑器
```

> 标 `[规划]` 的目录尚不存在；创建时须按 design §6 的目录结构与命名。

## 常用命令

- **当前（文档阶段）**：无构建命令。自查用：
  - `grep -rn "TODO\|FIXME\|XXX" docs/`
  - 改了公式 → 核对 design §3.7 的 8 组标定数值是否仍然自洽
- **M0 起补充**：测试命令、`validate`、`sim` —— 添加时**必须同步更新本节**（本文件的命令不能过期）。

## 提交约定

- Conventional Commits + 中文描述：`feat:` / `fix:` / `docs:` / `test:` / `chore:`
- 分支：`main` 为稳定线，任务分支命名 `task/<简述>` 或 `fix/<简述>`
- git 身份已配 global：`Song Li <boltomli@users.noreply.github.com>`
- 提交前确认：`git status` 无意外文件，`._*`、`*.keystore` 等已被忽略
