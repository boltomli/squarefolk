# itch.io 发布清单（Squarefolk v0.1.0 demo）

## 上传物（本目录）

| 文件 | 用途 |
| --- | --- |
| `squarefolk-v0.1.0.html` | 游戏本体（`npm run demo` 产物快照，74 KB 单文件） |
| `DESCRIPTION.md` | 页面文案（短描述 / 正文，中英双语，粘贴即用） |
| `DEVLOG.md` | Devlog #1（英文，粘贴即用；无第三方游戏名） |
| `push.sh` | **butler 一键上传**（macOS/Linux，用法 `./push.sh <owner>/<game>`，认证见脚本头注释；`.env`/`build/` 已 gitignore） |
| `push.ps1` | **butler 一键上传**（Windows PowerShell 版，用法 `.\push.ps1 <owner>/<game>`，逻辑与 `push.sh` 等同） |
| `build/index.html` | 上传用目录（脚本会自动同步最新构建；butler validate 已过：*Will be opened as HTML5 app*） |
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

## 上传（butler 路径 —— 本体文件推荐）

网页上传报 `Server failed to respond, please try again later` 是 itch.io 的老毛病（社区共识：浏览器/扩展冲突——Safari 最常见、代理节点抖动（换节点或直连都可能修好）、邮箱未验证、服务端抽风）。**封面/截图只能网页传** → 对策：换浏览器、手机端上传、切代理节点。**游戏本体用 butler 传**（官方 CLI，断点重试 + 增量上传 + 30GB 上限，网页只有 2GB）：

```bash
# 认证二选一（key 留本地，别贴聊天）
butler login                                  # A) 浏览器授权一次，凭据落盘
# 或: echo 'BUTLER_KEY=你的key' > .env && chmod 600 .env   # B) https://itch.io/user/settings/api-keys

./push.sh <owner>/<game>                      # 推 build/ → :html channel（自动同步最新构建）
```

Windows（PowerShell，凭据在 `~\.config\itch\butler_creds`，`.env` 无需 chmod）：

```powershell
.\push.ps1 <owner>/<game>                     # 推 build/ → :html channel（逻辑同 push.sh）
# 执行策略拦住时: pwsh -NoProfile -ExecutionPolicy Bypass -File push.ps1 <owner>/<game>
```

推完按脚本尾部提示去 Edit game 收尾：页面类型改 **HTML**、channel 勾 **HTML5 / Playable in browser**（入口 `index.html`）、Embed 1280×760。butler 本体已装 `/opt/homebrew/bin/butler`（v15.32.0，官方 broth darwin-arm64 稳定通道；**别用 brew cask butler** —— 那是别人的任务管理器）；Windows 装 scoop 的 `butler`（v15.31.0，`scoop install butler`）。`butler validate build/` 已过（*Will be opened as HTML5 app*）。

## 版本口径

- 游戏版本：**Demo 0.1.0**（`rulesVersion 0.1.0`，与 core-spec 同步）
- 快照刷新：改代码后 `npm run demo` → 复制 `demo/squarefolk.html` 覆盖本目录 html → 重截有变化的图
- 发布记录：建议在 git tag（如 `demo-0.1.0`）后再上传，便于对账

## 后续可选

- Devlog 一篇：项目缘起（自研回合制策略）、规格驱动 + 黄金向量的开发方法（现成素材 = 本仓库 README；**避免任何第三方游戏名**）
- 英文界面（i18n 已在架构里预留 —— 文案均出 presentation 层）
- 移动端适配（触控优先是设计目标，布局尚按桌面宽度）
