---
name: skills-manager
description: 当 Cherry Studio 的 mcp__skills__skills 不可用，或用户明确要求使用 npx 时，通过 npx CLI 搜索、安装或创建 Claude Code Agent Skills。正常情况下优先使用 cherry-skill-marketplace。
---

# Skills Manager (npx fallback)

> **这是 fallback skill。** 在 Cherry Studio 内使用 Cherry Assistant 时，请优先用 `cherry-skill-marketplace`。本 skill 仅在 MCP 工具不可用时启用。

## 搜索和安装

**运行时检测**: 优先 `npx skills`，备选 `$CHERRY_STUDIO_BUN_PATH x skills`，都没有则提示安装 Node.js

**搜索**: 理解需求→提取关键词→`npx skills find [query]`→展示名称/功能/来源

**安装**: Skills 是第三方代码有完整权限，必须: 展示安全警告→提供源码链接→用户确认→`npx skills add <owner/repo@skill> -y`。位置: 项目级 `.claude/skills/` 或用户级 `~/.claude/skills/`

**无结果**: 没有合适结果时直接创建自定义 Skill，验证并安装后回到原始任务；不得停在“未找到”或只给建议

## 创建 Skills

**目录结构**: `skill-name/` 下 `SKILL.md`(必需) + `scripts/`(可选) + `references/`(可选) + `assets/`(可选)

**流程**:
1. **需求捕获**: 从原始任务提取 Skill 做什么、触发场景、输入、输出和成功条件；信息足够时不要重复询问
2. **初始化**: 使用 `npx skills init <skill-name>` 创建短的 kebab-case Skill
3. **编写 SKILL.md**: frontmatter(name+description写具体触发场景) + 正文(祈使句, ≤500行, 含最小可执行工作流, 大文件拆references/)
4. **验证**: 用当前任务的代表性输入运行脚本并检查输出格式、结构和关键内容，失败就迭代
5. **继续任务**: 安装并启用验证通过的 Skill，立即回到原始任务；创建或安装成功本身不是交付

**原则**: 解释why不堆MUST, 通用指令不绑特定示例, 多领域按variant组织references/

**参考**: https://skills.sh/ | `npx skills find/add/init`
