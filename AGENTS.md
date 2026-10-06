# AGENTS.md — 给 coding agent 的工作说明

> 任何在此仓库工作的 AI coding agent（omp / Codex / Claude Code / Cursor …）先读本文件。
> 人类贡献者请同时读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 这是什么项目

**Squarefolk（方族）** —— 方形四边网格上的轻量回合制 4X，触摸优先、全平台同源。
开源但**非商业**：CC BY-NC-SA 4.0（见 [LICENSE.md](LICENSE.md)）。

> **当前阶段：M0 · 规格先行；Phase 1 已落地 TS 战斗核心与黄金向量 runner（`core/`、`data/balance.json`）；Phase 2 已落地 State 模型、规范化序列化与 stateHash、splitmix64/FNV（`core/src/`）；Phase 3 已落地移动可达集 `reachable` 与 move 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + 单测 26）；Phase 4 已落地视野可见集 `vision.ts`、领地归属 `territory.ts` 与 vision/territory 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + vision 3 + territory 2 + 单测 32）；Phase 5 已落地动作管线 `actions.ts`（`applyAction`：§2 谓词 + §3.2 结算、§4.7 征服检查）与 turn 域 9 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + vision 3 + territory 2 + turn 9 + 单测 38，共 72 断言）；Phase 6 已落地单文件可玩沙盒 demo（`demo/squarefolk.html`：10×10 手工地图、移动/迷雾/占领村/采集/训练/升级/研究、探索 100% + 占 3 村完成覆盖层；`npm run demo` 打包，UI 只调 core API 不实现规则）；Phase 6.1 已按试玩反馈修缮 demo（顶栏 flex-wrap 窄窗安全换行不压扁、领地按 core `territoryGrid` 半透明染色 + 城市描边/新占领金虚环、单位母城字母徽记、初始自带 `tech.orchard` + 果实 2→4 + 城市面板「人口来源 / 升级需 N 人口」提示 + 采集 rejected reason 上屏；`npm run demo` 产物 44619 bytes；当前 `npm test` 向量 37（turn 域已扩到 12）+ 单测 38 = 75 断言，其中 `turn/no-city-eliminated`、`turn/no-city-grace` 为 T4 向量先行的预期红，其余 73 全绿）。**Phase 7 已落地 T4 残兵淘汰实现（`state.ts` 增 `Player.noCityTurns`、不变量改单向 `eliminated ⇒ 无城市`；`actions.ts` 按 §3.1 在 commit 插入无城宽限计数 / 占城瞬间清零 / 轮转跳过已淘汰玩家；`balance.json` 增 `elimination.eliminationGraceTurns = 5`；turn runner 对 `noCityTurns` 缺省归一，旧 10 条向量零改动；`npm run demo` 产物 45075 bytes；当前 `npm test` 向量 37（turn 12/12 全绿）+ 单测 44 = 81 断言全绿，T4 两条 no-city 向量转绿）。Phase 8 已落地建设线 build 核心实现（`actions.ts` 新增 `build` 分支：§2 谓词 + §4.3 谓词补充与拒绝措辞、road 写 `tiles.road` 豁免 territory 敌方不可修、`ActionContext` 增第四件 `improvementTypes`；prep 并入 §4.3 产出结算：城收入 → 农场落归属城人口（城序）→ 矿入玩家星星，产出随领地易主；turn runner 解析 `given.map.improved`、`improvementTypes` 内容注入（缺省空表）、expect 词表增 `improved`/`roads` 完整集；`npm run demo` 产物 47924 bytes；当前 `npm test` 向量 42（turn 17/17 全绿）+ 单测 55 = 97 断言全绿，五条 build/prep 向量转绿）。**Phase 8b 已落地数据层 + validate CLI（配置/维护）：内容**原样**抽取到 `data/units.json`、`data/techs.json`、`data/improvements.json`、`data/resources.json`（各带 `schemaVersion: 1` / `rulesVersion: "0.1.0"` 头；`tech.mining` 为 `improvement.mine` 引用所需、按黄金向量既有值 tier 1 / requires [] 登记，不改任何既有数值）；`data/schemas/*.schema.json` 五个（draft 2020-12，覆盖四内容文件 + balance 结构）；`tools/validate.mjs`（零新依赖 Schema 子集解释器 + design §6.1 交叉引用：科技树无环 / tech 悬空引用 / allowedOn ⊆ 已知地形 / id 规范 `^\w+\.\w+$` / 数值区间）与 `tools/validate-selftest.mjs`（7 例：基线干净 + 环 / 悬空 / 越界 / 命名 / 未知地形 / 多余字段，全被抓住）进 npm test 链；`demo/src/config.ts` 改从 `data/*.json` 装配 CONTENT（esbuild 内联，单文件零外链不变）；`npm run demo` 产物 48834 bytes 自检通过。当前 `npm test` = 向量 43（turn 18/18）+ 单测 55 = 98 断言全绿 + validate 0 报错 + selftest 7/7 PASS。**

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
data/                内容与数值 JSON 源（balance.json + units/techs/improvements/resources.json + schemas/*.schema.json，schema 见 design §6）
testdata/golden/     语言无关黄金测试向量
core/                规则核心（Phase 1：TypeScript，规格 = docs/core-spec.md §4.1）
demo/                Phase 6 单文件可玩 demo：src/（main/ui/map/config + style.css）、template.html、产物 squarefolk.html（npm run demo 生成）
scripts/             构建脚本（build-demo.mjs：把 esbuild 的 JS/CSS 内联进 HTML 模板）
tools/               配置工具 CLI（validate.mjs / validate-selftest.mjs 已落地；diff、sim、dump 与桌面编辑器 [规划]）
```

> 标 `[规划]` 的目录尚不存在；创建时须按 design §6 的目录结构与命名。

## 常用命令

- **当前**：
  - `npm install` —— 安装 devDependencies（typescript、@types/node、esbuild）
  - `npm run demo` —— esbuild 打包 `demo/src`（`--bundle --format=iife --minify` → `demo/.build/`）+ `scripts/build-demo.mjs` 把 JS/CSS 内联进 `demo/template.html` → 产出单文件 `demo/squarefolk.html`（自检：文件存在、含 `<!DOCTYPE html>`、无 `src=`/`href=` 外链、打印大小）；`file://` 双击即玩，无外部请求。demo 不进 `npm test` 测试链；类型自查 `npx tsc -p demo/tsconfig.json`
  - `npm test` —— `tsc` 编译 + 跑 `testdata/golden/combat/`、`testdata/golden/meta/`、`testdata/golden/move/`、`testdata/golden/vision/`、`testdata/golden/territory/`、`testdata/golden/turn/` 全部黄金向量 + 移动边角单测 + 视野/领地边角单测（viewFor 三态、radius 映射、tie-break、无源空集）+ 动作管线边角单测（征服胜利、killSwap 受阻、被围城收入归零、治疗本土/境外、科技前置拒绝、无城宽限计数与占城清零、轮转跳过淘汰者、淘汰移兵、build 拒绝七条措辞与道路只写 road、改善产出结算与领地易主）+ 序列化/哈希/状态不变量单元断言 + `node tools/validate.mjs`（data/ 五文件 schema 校验 + 交叉引用，0 报错）+ `node tools/validate-selftest.mjs`（7 例故意破坏样例必须全被抓住）（逐条 PASS/FAIL + 汇总，任一失败非零退出）
  - `npm run validate` —— 只跑 `tools/validate.mjs`：data/*.json 的 JSON Schema 子集校验（子集边界见文件头）+ design §6.1 交叉引用检查（科技树无环、tech 悬空引用、allowedOn ⊆ 已知地形、id 规范、数值区间）
  - 自查：`grep -rn "TODO\|FIXME\|XXX" docs/`
  - 改了公式 → 核对 design §3.7 的 8 组标定数值是否仍然自洽
- **后续补充**：`validate`、`sim` —— 添加时**必须同步更新本节**（本文件的命令不能过期）。

## 提交约定

- Conventional Commits + 中文描述：`feat:` / `fix:` / `docs:` / `test:` / `chore:`
- 分支：`main` 为稳定线，任务分支命名 `task/<简述>` 或 `fix/<简述>`
- git 身份已配 global：`Song Li <boltomli@users.noreply.github.com>`
- 提交前确认：`git status` 无意外文件，`._*`、`*.keystore` 等已被忽略
