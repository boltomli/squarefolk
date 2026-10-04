# 贡献指南 Contributing

感谢你对 Squarefolk（方族）的兴趣！本项目开源但**非商业**（CC BY-NC-SA 4.0）。

## AI coding agent

在本仓库工作的 agent 请先读 **[AGENTS.md](AGENTS.md)** —— 红线、交付标准、目录约定都在那里。

## 工作流程

1. 从 `main` 拉分支：`task/<简述>` 或 `fix/<简述>`
2. 改动前先定位规格：设计问题查 `docs/design.md` 对应章节，实现问题查 `docs/core-spec.md`
3. **规格缺口或矛盾 → 先提 issue / 在 PR 里报告**，不要在实现里自行发明规则
4. 提交：Conventional Commits + 中文描述（`feat:` / `fix:` / `docs:` / `test:` / `chore:`）
5. 开 PR，自检清单见下

## PR 自检清单

- [ ] 黄金向量（`testdata/golden/`）全部通过，或本 PR 已包含新增向量
- [ ] 改动涉及规则/数值 → 同步更新 `docs/design.md`（含顶部修订记录）或 `docs/core-spec.md`
- [ ] 未实现 §9 中标 🔶 / ⏸ 的未定决策
- [ ] 未引入 GPL 系代码；第三方代码保留版权头（design §7.2 红线表）
- [ ] core 层无硬编码数值、无浮点、无随机、无文件路径、无枚举入库
- [ ] `git status` 干净，无 `.DS_Store` / `._*` / 密钥文件

## 授权声明

**贡献即授权**：你提交的贡献以本项目的 **CC BY-NC-SA 4.0** 许可授权给项目，并同意作者可就你的贡献另行进行商业授权（作者保留双重授权权，见 design §7.1）。通过提交 PR 即视为接受本条款。

请不要提交：

- Polytopia（The Battle of Polytopia / Midjiwan AB）的任何素材、命名、数据
- 来源不明或 GPL 系的代码
- 任何你无权以上述许可授权的内容

## 行为准则

就事论事、对事不对人；技术分歧用规格与数据（`sim` 结果）说话。
