---
name: skills-manager
description: 搜索、安装和协调创建 Claude Code Agent Skills。当用户想要搜索技能、安装工具、创建自定义 Skill，或者说"find a skill"、"搜索技能"、"帮我做个 skill"、"create a skill"时触发。也适用于用户说"有没有做 X 的工具"、"我想扩展 Agent 能力"，或当前能力不足需要先查找可复用方案的场景。
---

# Skills Manager

## 搜索和安装

**优先复用**: `find-skills` 可用时先调用它完成搜索、质量检查和安装确认；只有不可用时才执行下面的 CLI 降级流程。

**运行时检测**: 优先 `npx skills`，备选 `$CHERRY_STUDIO_BUN_PATH x skills`，都没有则提示安装 Node.js

**搜索**: 理解需求→提取关键词→`npx skills find [query]`→展示名称/功能/来源

**安装**: Skills 是第三方代码有完整权限，必须: 展示安全警告→提供源码链接→用户确认→`npx skills add <owner/repo@skill> -y`。位置: 项目级 `.claude/skills/` 或用户级 `~/.claude/skills/`

**无结果**: 告知→先尝试直接完成→可复用流程再建议创建自定义 Skill

## 创建 Skills

1. 先确认现有 Skill 无法满足需求，并判断这是不是值得复用的流程；一次性任务直接完成，不强行创建 Skill。
2. 检查可用 Skill 列表。`skill-creator` 可用时必须调用它，并完整遵循其需求澄清、初始化、编辑、验证和迭代流程；不要绕过它直接手写 `SKILL.md`。
3. 只有 `skill-creator` 确实不可用时，才明确告诉用户正在降级，然后用 `npx skills init <skill-name>` 初始化，保持 `SKILL.md` 精简，并按需加入 `scripts/`、`references/`、`assets/`。
4. 创建后至少验证 frontmatter、触发描述和一个真实用例；验证失败就修正后重跑。

**参考**: https://skills.sh/ | `npx skills find/add/init`
