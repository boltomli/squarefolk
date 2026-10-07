# AGENTS.md — 给 coding agent 的工作说明

> 任何在此仓库工作的 AI coding agent（omp / Codex / Claude Code / Cursor …）先读本文件。
> 人类贡献者请同时读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 这是什么项目

**Squarefolk（方族）** —— 方形四边网格上的轻量回合制 4X，触摸优先、全平台同源。
开源但**非商业**：CC BY-NC-SA 4.0（见 [LICENSE.md](LICENSE.md)）。

> **当前阶段：M0 · 规格先行；Phase 1 已落地 TS 战斗核心与黄金向量 runner（`core/`、`data/balance.json`）；Phase 2 已落地 State 模型、规范化序列化与 stateHash、splitmix64/FNV（`core/src/`）；Phase 3 已落地移动可达集 `reachable` 与 move 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + 单测 26）；Phase 4 已落地视野可见集 `vision.ts`、领地归属 `territory.ts` 与 vision/territory 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + vision 3 + territory 2 + 单测 32）；Phase 5 已落地动作管线 `actions.ts`（`applyAction`：§2 谓词 + §3.2 结算、§4.7 征服检查）与 turn 域 9 向量 runner（`npm test` = combat 12 + meta 2 + move 6 + vision 3 + territory 2 + turn 9 + 单测 38，共 72 断言）；Phase 6 已落地单文件可玩沙盒 demo（`demo/squarefolk.html`：10×10 手工地图、移动/迷雾/占领村/采集/训练/升级/研究、探索 100% + 占 3 村完成覆盖层；`npm run demo` 打包，UI 只调 core API 不实现规则）；Phase 6.1 已按试玩反馈修缮 demo（顶栏 flex-wrap 窄窗安全换行不压扁、领地按 core `territoryGrid` 半透明染色 + 城市描边/新占领金虚环、单位母城字母徽记、初始自带 `tech.orchard` + 果实 2→4 + 城市面板「人口来源 / 升级需 N 人口」提示 + 采集 rejected reason 上屏；`npm run demo` 产物 44619 bytes；当前 `npm test` 向量 37（turn 域已扩到 12）+ 单测 38 = 75 断言，其中 `turn/no-city-eliminated`、`turn/no-city-grace` 为 T4 向量先行的预期红，其余 73 全绿）。**Phase 7 已落地 T4 残兵淘汰实现（`state.ts` 增 `Player.noCityTurns`、不变量改单向 `eliminated ⇒ 无城市`；`actions.ts` 按 §3.1 在 commit 插入无城宽限计数 / 占城瞬间清零 / 轮转跳过已淘汰玩家；`balance.json` 增 `elimination.eliminationGraceTurns = 5`；turn runner 对 `noCityTurns` 缺省归一，旧 10 条向量零改动；`npm run demo` 产物 45075 bytes；当前 `npm test` 向量 37（turn 12/12 全绿）+ 单测 44 = 81 断言全绿，T4 两条 no-city 向量转绿）。Phase 8 已落地建设线 build 核心实现（`actions.ts` 新增 `build` 分支：§2 谓词 + §4.3 谓词补充与拒绝措辞、road 写 `tiles.road` 豁免 territory 敌方不可修、`ActionContext` 增第四件 `improvementTypes`；prep 并入 §4.3 产出结算：城收入 → 农场落归属城人口（城序）→ 矿入玩家星星，产出随领地易主；turn runner 解析 `given.map.improved`、`improvementTypes` 内容注入（缺省空表）、expect 词表增 `improved`/`roads` 完整集；`npm run demo` 产物 47924 bytes；当前 `npm test` 向量 42（turn 17/17 全绿）+ 单测 55 = 97 断言全绿，五条 build/prep 向量转绿）。**Phase 8b 已落地数据层 + validate CLI（配置/维护）：内容**原样**抽取到 `data/units.json`、`data/techs.json`、`data/improvements.json`、`data/resources.json`（各带 `schemaVersion: 1` / `rulesVersion: "0.1.0"` 头；`tech.mining` 为 `improvement.mine` 引用所需、按黄金向量既有值 tier 1 / requires [] 登记，不改任何既有数值）；`data/schemas/*.schema.json` 五个（draft 2020-12，覆盖四内容文件 + balance 结构）；`tools/validate.mjs`（零新依赖 Schema 子集解释器 + design §6.1 交叉引用：科技树无环 / tech 悬空引用 / allowedOn ⊆ 已知地形 / id 规范 `^\w+\.\w+$` / 数值区间）与 `tools/validate-selftest.mjs`（7 例：基线干净 + 环 / 悬空 / 越界 / 命名 / 未知地形 / 多余字段，全被抓住）进 npm test 链；`demo/src/config.ts` 改从 `data/*.json` 装配 CONTENT（esbuild 内联，单文件零外链不变）；`npm run demo` 产物 48834 bytes 自检通过。当前 `npm test` = 向量 43（turn 18/18）+ 单测 55 = 98 断言全绿 + validate 0 报错 + selftest 7/7 PASS。**Phase 9 已落地桌面数据编辑器 MVP（`tools/editor/`，Tauri 2.x 独立子包；design §6.1 M4）：前置重构把 `tools/validate.mjs` 拆成纯核心 `tools/validate-core.mjs`（已解析 JSON + schema 对象 → 错误数组，零 node API，CLI/selftest/编辑器 webview 三宿主共用，禁重实现）+ 薄 CLI 壳（输出行不变）；新增 `tools/dump-core.mjs` 纯渲染 + `tools/dump.mjs` CLI 壳；编辑器 = vite+TS 前端（五文件列表 / JSON 源码编辑 + 300ms 防抖实时校验带 JSON 路径 / 保存后重校验 / 与 HEAD 结构化 diff / 导出 Markdown）+ Rust 三命令（read/write 白名单仅 data/ 五件 .json、防穿越 canonicalize 兜底、git_show_head 只读），`cargo test` 白名单 3 例 + `cargo check` + 子包 `vite build` 全过；子包依赖独立（根 package.json 零新增）。⚠ exFAT 外置卷：`src-tauri/target` 已 symlink 到 `~/.cache/`（APFS）绕开 `._*` 兄弟文件打爆 tauri-build；`capabilities/` 出现 `._*.json` 会让构建报 JSON 解析错，`find tools/editor/src-tauri -name '._*' -delete` 即愈。**Phase 10 已落地 T3 世界生成实现（core-spec §4.6 步骤 1–10；`core/src/worldgen.ts` 纯函数 `generate(seed,h,w,params)` + `mergeWorldParams` 浅合并：terrainWeights 按对象键序累计、Jacobi 元胞平滑、8-邻最大陆块严格 `>`、splice 保持候选行主序、索引字典序公平带 + `seed+t`（u64 回绕）重试、失败 reason 逐字、`rngFinal` = 末抽后流状态、评分比例 round_half_up / mob 整除向零截断；`core/test/world-gen-vector-runner.ts` world 向量 5/5 + `core/test/worldgen-assertions.ts` 单测 5 条进 `npm test` 链；当前 `npm test` = 向量 48（turn 18/18、world 5/5）+ 单测 60 = 108 断言全绿 + validate 0 报错 + selftest 7/7 PASS）。**
> **Phase 11 已落地 D6 围城攻占四件套与 §4.7 守卫（`core/src/actions.ts`：attack `targetId=cityId` 攻城削 `wallDurability`、触 0 墙破翻转（hasWall=false/dur=0）+ 两路拒绝措辞逐字；move 敌城占领门（无墙 ∧ 起点切比雪夫=1 ∧ 城空）+ 占领落地（owner 易主、level/isCapital/workshop 保留、pop−1 下限 0、墙清除、占领方 noCityTurns 清零）；§3.1 commit-1 被动侵蚀（按 cities id 序、被围且墙在 → 图内相邻敌 ≥2 则 −1、触 0 墙破）；§4.1-5 killSwap 补位撞未破敌城 → 受阻留原地、补位过门进墙已破敌城 → 即占领（§4.4 裁决 2026-10-06，与 move 同一 captureEnemyCity 路径）；§4.7 征服检查增「开局首都集合 ≥2」真空真值守卫）；turn 域 D6 八条向量（siege-attack-break-wall / siege-attack-no-wall-rejected / passive-siege-erosion / capture-walled-rejected / capture-not-adjacent-rejected / capture-move-in / capture-conquest / killswap-blocked-by-wall）全绿；当前 `npm test` = 向量 59（turn 28/28、world 6/6）+ 单测 72（turn-assertions 34/34）= 131 断言全绿 + validate 0 报错 + selftest 7/7 PASS）。**
> **Phase 13-a 已落地 legalActions 枚举器与最简 bot（core-spec §8 冻结：`legalActions(state, ctx, options?)` = 有界候选生成 → 逐条 applyAction 过滤（禁复制 §2 谓词，单一事实来源）→ §8.1 排序（表序+载荷元组字典序）；新建 `core/src/bot.ts` `botAction(..., seed, level)` —— splitmix64 取步、L0 取模 / L1 十层优先级（占领move>attack>…>endTurn，层内回落 L0，策略层不入 balance）；`core/test/legal-vector-runner.ts` 接入 npm test + `legal-assertions.ts` 7 项（soundness 三夹具逐条 apply、L0 同 seed 复现、L1 层偏好×2、排序单调、phase 行为）；`testdata/golden/legal/` 2 向量（basic-ordered / gated-excluded，手推 13/13 验算）。当前 `npm test` = 向量 61（legal 2/2、turn 28/28、world 6/6）+ 单测 78 = 139 断言全绿 + validate 0 报错 + selftest 7/7 PASS）。**
> **Phase 12 已落地 demo「单人 vs bot」对战壳（无热座；入口 = `demo/squarefolk.html` 模式选择「对战」；关键文件：`demo/src/vsmap.ts`（worldgen→初始 State 装配：两城按 spawns、初始兵、村庄/资源落格）、`main.ts` 对战主循环（点选移动/攻击/攻城高亮 → applyAction、bot 回合 150ms/步 + `BOT_STEP_CAP=500` 死锁上限、ctx.explored 按行动方公平迷雾、winner→征服 overlay 冻结棋盘、T4 淘汰上屏）、`ui.ts` 面板（训练/升级/修墙按 legalActions 过滤）、`style.css` 对战样式；`npm run demo` = esbuild + `scripts/build-demo.mjs` repack 单文件 74,353B。已知限制：bot L1 无前瞻、bot 死亡单位动画从略、v1 仅征服胜利文案。**)
> **Phase 12.1 对战手感修订（用户反馈三条：兵太少/兵又打仗又建设/移动后攻击限制多；design v0.20）**：① 根因 = 起始兵站城格+homeCity=该城 → train「城上格为空」+驻留≥level 双锁 → **开局训练永久锁死** → 改每城 1 工兵+1 斥候落城外邻格、homeCity=null、城格留空（vsmap.ts）；② 「移动后攻击限制」= demo UX bug（move 后 clearSelection 清光提示）→ main.ts 移动后保持选中+recomputeHighlights（走打体 §4.1-G 默认 true 规则本来就通）；③ 新增 unit.builder 工兵（3★/hp5/**atk0**/def5/counter[0,1]/siege0，units.json+schema 无需改 —— atk10 min0）+ config 序列/文案 + ui 🛠️ + bot L1 attack 层跳过 0 攻单位（策略层，bot.ts）；④ START_STARS 5→10、步兵 5★→4★。观察项（未动）：ZOC 贴敌停走、反击对砍约 4/10 血。浏览器实测：⭐10、驻留0 开局可训（3/3/4★）、移动后选中保持。**)
> **Phase 12.2 容量「就差1」修正（用户拍板，design v0.21）**：单位容量 `level` → **`level + 1`**（§2 train 行 + §4.3 + actions.ts capacity 检查与措辞；计数仍按 homeCity 与位置无关 —— 移出城仍占坑）；起始编成回 **1 步兵/城**（homeCity=该城占坑、城外落位不挡 T2，撤 df35b60 的 homeCity=null 权宜计）；产出归属维持「格子归谁人口归谁」（用户明确按格子）。向量：新增 `turn/train-capacity-l1-slot`（驻1可训，对旧公式红）+ `train-capacity-rejected` 改驻2钉上界 → turn 29/29、总 **140** 断言全绿；浏览器实测：驻留1开局可训、训后驻留2/2、⭐10→6。**)
> **Phase 12.3 城籍规矩 + 容量归属过滤（用户拍板「仅攻占换籍」，design v0.22）**：城籍 = 出生城 + 攻占事件（captureEnemyCity 内 `unit.homeCity = city.id`；路经/走回自己城不改 → `turn/enter-own-city-no-rebind`）；容量计数补 `unit.owner === city.owner` 过滤（修敌方残兵占坑 bug，过滤在计数不清数据 → `turn/capacity-owner-filter`）；capture-move-in/conquest 补入籍断言 + killSwap 单测补断言。turn 31/31、总 **142** 断言全绿。**)
> **Phase 12.4 攻方反击致死补 4c（用户报 hp=0 尸体占格 bug，design v0.23）**：§4.1-D 新增步骤 4c（counter 落地后攻方 hp=0 → 移除、跳过补位/晋升/acted；反击击杀无补位；同归于尽两尸俱移）+ §4.1-F/§5 错误表述改正；actions.ts attack 结算重排（守方先移、攻方 4c 判定、顺带清掉过期歧义注释）；新向量 attacker-dies-counter / attacker-dies-mutual（先红后绿）→ turn 33/33、总 **144** 断言全绿。**)
> **Phase 12.5 三拍板（design v0.24）**：① 结算后开全图（demo refreshView settled=全图 explored+视野强制 visible+敌兵直读 state；结算前迷雾照旧）② §4.7 征服重定义 = 全对手淘汰 **或** 对手 0 城 0 兵（**攻占首都 ≠ 即时胜**，残兵 T4 宽限优先；旧全首都判据与 ≥2 守卫废止；单人 <2 玩家无胜利；checkVictory 改写）③ 围城可招兵（train 撤 isBesieged；收入/治疗/城防仍被封）。新向量 conquest-waits-remnant + train-under-siege（先红后绿）、capture-conquest/basic-ordered notes 校准、demo 胜负文案改写。turn 35/35、总 **146** 断言全绿 + repack 75,910B。**)

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
tools/               配置工具 CLI（validate-core.mjs 纯核心 + validate.mjs / validate-selftest.mjs / dump-core.mjs / dump.mjs 已落地；diff、sim [规划]）
tools/editor/        桌面数据编辑器 MVP（Phase 9：Tauri 2.x 独立子包，自己的 package.json/node_modules；vite + TS 前端 src/、Rust 后端 src-tauri/）
```

> 标 `[规划]` 的目录尚不存在；创建时须按 design §6 的目录结构与命名。

## 常用命令

- **当前**：
  - `npm install` —— 安装 devDependencies（typescript、@types/node、esbuild）
  - `npm run demo` —— esbuild 打包 `demo/src`（`--bundle --format=iife --minify` → `demo/.build/`）+ `scripts/build-demo.mjs` 把 JS/CSS 内联进 `demo/template.html` → 产出单文件 `demo/squarefolk.html`（自检：文件存在、含 `<!DOCTYPE html>`、无 `src=`/`href=` 外链、打印大小）；`file://` 双击即玩，无外部请求。demo 不进 `npm test` 测试链；类型自查 `npx tsc -p demo/tsconfig.json`
  - `npm test` —— `tsc` 编译 + 跑 `testdata/golden/combat/`、`testdata/golden/meta/`、`testdata/golden/move/`、`testdata/golden/vision/`、`testdata/golden/territory/`、`testdata/golden/turn/`、`testdata/golden/world/` 全部黄金向量 + 移动边角单测 + 视野/领地边角单测（viewFor 三态、radius 映射、tie-break、无源空集）+ 动作管线边角单测（征服胜利、killSwap 受阻、被围城收入归零、治疗本土/境外、科技前置拒绝、无城宽限计数与占城清零、轮转跳过淘汰者、淘汰移兵、build 拒绝七条措辞与道路只写 road、改善产出结算与领地易主、D6 围城攻占（两路拒绝理由逐字、墙破翻转不变量、占领门两条件逐字拒绝、占领落地逐字段与 pop 下限、被动侵蚀触 0 墙破与 ≥2 边界、killSwap 撞墙门、siegeDamage=0/缺省拒绝、侵蚀破墙后城防回归））+ 序列化/哈希/状态不变量单元断言 + 世界生成单测（同 seed 逐字段幂等、seed+1 地图必异、参数浅合并优先级、大图 30×30 耗时上界）+ `node tools/validate.mjs`（data/ 五文件 schema 校验 + 交叉引用，0 报错）+ `node tools/validate-selftest.mjs`（7 例故意破坏样例必须全被抓住）（逐条 PASS/FAIL + 汇总，任一失败非零退出）
  - `npm run validate` —— 只跑 `tools/validate.mjs`（薄壳）：读 data/ 五文件 + 五个 schema → 调纯核心 `tools/validate-core.mjs`（JSON Schema 子集解释器，子集边界见核心文件头）+ design §6.1 交叉引用检查（科技树无环、tech 悬空引用、allowedOn ⊆ 已知地形、id 规范、数值区间）
  - `node tools/dump.mjs [dataDir] [outFile]` —— 五件数据 → 玩家可读 Markdown 总表（兵种/科技/改善/资源/数值摊平五段；渲染在纯核心 `tools/dump-core.mjs`，编辑器「导出」按钮同源）；缺省打印 stdout
  - 编辑器（`tools/editor/`，独立子包，命令不进根 scripts）：
    - `cd tools/editor && npm install` —— 装子包依赖（vite / @tauri-apps/cli / @tauri-apps/api / typescript；根 node_modules 零新增）
    - `npm run dev` —— `tauri dev`：beforeDevCommand 拉 vite（端口 1420 固定）+ 开窗口「Squarefolk 数据工坊」
    - `npm run build` —— `tsc --noEmit && vite build` → `tools/editor/dist/`
    - `cd src-tauri && cargo check` / `cargo test` —— Rust 侧自查（三命令 + 路径白名单 3 例）；⚠ exFAT 卷上 `target/` 已是指向 `~/.cache/squarefolk-editor-target`（APFS）的符号链接，勿删；`capabilities/` 若出现 `._*.json` 兄弟文件会让 tauri-build 报 JSON 解析错，`find . -name '._*' -delete` 即愈
  - 自查：`grep -rn "TODO\|FIXME\|XXX" docs/`
  - 改了公式 → 核对 design §3.7 的 8 组标定数值是否仍然自洽
- **后续补充**：`sim` —— 添加时**必须同步更新本节**（本文件的命令不能过期）。

## 提交约定

- Conventional Commits + 中文描述：`feat:` / `fix:` / `docs:` / `test:` / `chore:`
- 分支：`main` 为稳定线，任务分支命名 `task/<简述>` 或 `fix/<简述>`
- git 身份已配 global：`Song Li <boltomli@users.noreply.github.com>`
- 提交前确认：`git status` 无意外文件，`._*`、`*.keystore` 等已被忽略
