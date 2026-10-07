# itch.io 发布清单（Squarefolk v0.1.0 demo）

## 上传物（本目录）

| 文件 | 用途 |
| --- | --- |
| `squarefolk-v0.1.0.html` | 游戏本体（`npm run demo` 产物快照，74 KB 单文件） |
| `DESCRIPTION.md` | 页面文案（短描述 / 正文，中英双语，粘贴即用） |
| `DEVLOG.md` | Devlog #1（英文，粘贴即用；无第三方游戏名） |
| `screenshots/01-start.png` | 首图：起始屏（模式选择 + 种子）1280×720 |
| `screenshots/02-vs-board.png` | 对战棋盘（迷雾 + 顶栏 + 规则面板） |
| `screenshots/04-city-panel.png` | 城市面板（训练/升级/研究，按钮可用态） |
| `screenshots/03-highlights.png` | 单位选中高亮（绿框可达） |

## 上传步骤

1. itch.io → **Dashboard → Upload new project**
2. **Classification**: `Browser`（web）；**Recommended**: Desktop
3. 上传 `squarefolk-v0.1.0.html`，勾选 **"This file will be played in the browser"**
   - Embed view window：建议 **1280 × 760**，`Responsive` 关（当前布局按桌面固定宽）；上传后用 **Game player 预览**确认可点
4. **Price = Free**（CC BY-NC-SA 4.0 禁商用，**不可设价/PWYW**）
5. 短描述 / 正文 → 从 `DESCRIPTION.md` 粘贴（中文为主，末尾附 English 段）
6. 按截图顺序传 4 张图（01 为首图）
7. Tags：`turn-based strategy` `4x` `html5` `single-player` `procedural generation` `fog of war` `web game` `中文`
8. **Community**: Comments 开（收手感反馈）；**Credits**: Song Li；页面底部放许可与源码链接（正文已含）
9. 发布前自检：
   - [ ] iframe 内可正常开局（itch 预览器跑一回合 + bot 回合）
   - [ ] `file://` 双击与 iframe 内行为一致（单文件、无外链 —— 构建脚本已断言无 `src=`/`href=` 外链）
   - [ ] 4 张截图文案为新版（无 `unit.000001`、无 `§8.1 legalActions`、无 `worldgen 尝试` 字样）
   - [ ] 胜利文案为新规（"对手无城无兵/被淘汰"，非"占领全部首都"）
   - [ ] 沙盒模式可完成（探索 100% + 占村）→ 结算开全图正常
   - [ ] 页面写明 **界面语言：中文**

## 版本口径

- 游戏版本：**Demo 0.1.0**（`rulesVersion 0.1.0`，与 core-spec 同步）
- 快照刷新：改代码后 `npm run demo` → 复制 `demo/squarefolk.html` 覆盖本目录 html → 重截有变化的图
- 发布记录：建议在 git tag（如 `demo-0.1.0`）后再上传，便于对账

## 后续可选

- Devlog 一篇：项目缘起（自研回合制策略）、规格驱动 + 黄金向量的开发方法（现成素材 = 本仓库 README；**避免任何第三方游戏名**）
- 英文界面（i18n 已在架构里预留 —— 文案均出 presentation 层）
- 移动端适配（触控优先是设计目标，布局尚按桌面宽度）
