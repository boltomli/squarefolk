# itch.io 页面文案（粘贴即用）

> 用途：itch.io 新建项目时的字段素材。短描述 = "Short description"，正文 = "Long description"。
> 截图：`screenshots/01-start.png`（首图）、`02-vs-board.png`、`04-city-panel.png`、`03-highlights.png`。
> 上传文件：`squarefolk-v0.1.0.html`（74 KB 单文件，离线可玩）。

---

## 字段速查

| 字段 | 值 |
| --- | --- |
| Title | **Squarefolk（方族）** |
| By | Song Li |
| Classification | Browser（HTML5） |
| Recommended | Desktop（鼠标） |
| Price | **Free**（许可为 CC BY-NC-SA 4.0，禁止商用 → 必须免费） |
| Short description | 迷你回合制 4X：程序生成地图、战争迷雾、围城攻防，浏览器里人机对战。 |
| Tags | turn-based strategy, 4x, html5, single-player, procedural generation, fog of war, web game, 中文 |
| 语言 | 界面为中文（English description 见下） |

---

## Short description（短描述）

**中文**：迷你回合制 4X —— 程序生成地图、战争迷雾、围城攻防，浏览器里的人机对战。规格驱动开发，全程整数运算、同种子必同图。

**EN**: A tiny deterministic 4X in your browser — procedural maps, fog of war, siege & capture, vs an AI opponent. One 74 KB HTML file, no install.

---

## Long description（正文，粘贴用）

### 中文

**Squarefolk（方族）** 是一个轻量回合制 4X 沙盘 demo：正方形网格、触控优先、人机对战 + 自由沙盒两种模式。

**玩法（30 秒上手）**
1. 点击己方单位 → **绿框** = 可移动、**红框** = 可攻击（含攻城）；移动后仍可出手（走打一体）。
2. 点击城市 → 训练 / 升级（人口三选一：工坊、金库、城墙）/ 研究科技。
3. 派单位踩进领地内的 🍎 采集（+1 人口，升级的唯一来源）；🐗 猎物给星星。
4. 结束回合 → Bot 按同样的视野与规则行动。
5. **胜利**：让对手无城无兵 → 立即获胜；对方只剩残兵 → 连续 5 回合无城将其淘汰。占下首都**不会**直接获胜 —— 残兵有 5 回合宽限期可以反扑占回任意城池。

**特性**
- 🗺 **程序生成地图**：同一种子必出同一张图（整数算法，可分享种子）
- 🌫 **真实战争迷雾**：Bot 和你按同一套视野规则打（各看各的）
- ⚔ **战斗系统**：走打一体、夹击 / 支援 / 姿态 / 晋升加成、垂死反击
- 🏰 **围城攻防**：先破墙（攻城伤害），破城后**从相邻格进入**才可占领 —— "围一回合"由移动规则自然涌现；**被围城照样可以招兵守城**；围城方 ≥2 人时城墙持续掉耐久
- 🏗 **城市建设**：农场（人口）/ 矿（星星）/ 道路、四科技树、城市容量 = 城级 + 1（反滚雪球）
- 🤖 **确定性 Bot**：L1 分层策略 + 种子随机，复盘同一局只要同一个种子
- 🧪 **规格驱动开发**：公开设计文档 + 68 条黄金测试向量 + 146 项断言，规则与实现永不漂移

**技术**：HTML5 + TypeScript，单文件 74 KB，零依赖、零联网、双击即玩；纯整数运算（战斗无随机、无浮点），可做电竞级回放校验。

**已知限制（诚实版）**：界面目前仅中文；AI 为轻量启发式（会打但不强）；数值未做模拟校准（v1 初版）；单局遭遇战 + 沙盒，无战役。

**许可与源码**：CC BY-NC-SA 4.0（禁止商用）· 源码：<https://github.com/boltomli/squarefolk>

---

### English (short)

**Squarefolk** is a tiny turn-based 4X demo that runs entirely in your browser as a single HTML file.

- Procedural maps — same seed, same map (integer-only generator)
- Real fog of war — the AI plays by the same vision rules you do
- Move & attack in one turn, with flank / support / stance / promotion bonuses
- Siege warfare: break the wall, then enter from an adjacent tile to capture — and besieged cities can still raise defenders
- City economy: farms → population → upgrades (workshop / bank / wall), 4-tech tree, unit capacity = city level + 1
- Win by leaving your opponent with **no cities and no units**, or by eliminating a cityless remnant within a 5-turn grace period
- Spec-driven development: public rules document, 68 golden test vectors, 146 assertions

Runs offline. Desktop + mouse recommended. UI is currently in Chinese.

License: CC BY-NC-SA 4.0 (non-commercial) · Source: https://github.com/boltomli/squarefolk
