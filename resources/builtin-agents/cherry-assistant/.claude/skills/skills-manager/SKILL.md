---
name: skills-manager
description: **兜底**：通过 npx CLI 管理 Claude Code Agent Skills（搜索/安装/创建）。**仅当当前环境没有 Cherry Studio 的 `mcp__skills__skills` MCP 工具时使用**（如 Cherry Assistant 被复制到 Cherry Studio 外当独立 agent 运行）。在 Cherry Studio 内运行时，**优先用 `cherry-skill-marketplace` skill**——它直通三家 registry、装完自动 enable、UX 更顺。当 `mcp__skills__skills` 调用报错（tool not found），或者用户明确说"用 npx 装"时才触发本 skill。
---

# Skills Manager (npx fallback)

> **这是 fallback skill。** 在 Cherry Studio 内使用 Cherry Assistant 时，请优先用 `cherry-skill-marketplace`。本 skill 仅在 MCP 工具不可用时启用。

## 搜索和安装

**运行时检测**: 优先 `npx skills`，备选 `$CHERRY_STUDIO_BUN_PATH x skills`，都没有则提示安装 Node.js

**搜索**: 理解需求→提取关键词→`npx skills find [query]`→展示名称/功能/来源

**安装**: Skills 是第三方代码有完整权限，必须: 展示安全警告→提供源码链接→用户确认→`npx skills add <owner/repo@skill> -y`。位置: 项目级 `.claude/skills/` 或用户级 `~/.claude/skills/`

**无结果**: 告知→提议直接完成→建议创建自定义Skill

## 创建 Skills

**目录结构**: `skill-name/` 下 `SKILL.md`(必需) + `scripts/`(可选) + `references/`(可选) + `assets/`(可选)

**流程**:
1. **需求捕获**: Skill做什么？触发场景？输出格式？"把刚才的流程做成Skill"→从对话提取
2. **编写 SKILL.md**: frontmatter(name+description写具体触发场景) + 正文(祈使句, ≤500行, 含1-2示例, 大文件拆references/)
3. **测试**: 2-3个用例，subagent并行跑 with-skill vs baseline 对比
4. **迭代**: 根据测试和反馈修改，确保触发准确

**原则**: 解释why不堆MUST, 通用指令不绑特定示例, 多领域按variant组织references/

**参考**: https://skills.sh/ | `npx skills find/add/init`
