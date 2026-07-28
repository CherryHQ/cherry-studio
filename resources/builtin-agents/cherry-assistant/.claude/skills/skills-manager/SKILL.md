---
name: skills-manager
description: 搜索、安装和创建 Claude Code Agent Skills。当用户想要搜索技能、安装工具、创建自定义 Skill，或者说"find a skill"、"搜索技能"、"帮我做个 skill"、"create a skill"时触发。也适用于用户说"有没有做 X 的工具"、"我想扩展 Agent 能力"的场景。
---

# Skills Manager

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
