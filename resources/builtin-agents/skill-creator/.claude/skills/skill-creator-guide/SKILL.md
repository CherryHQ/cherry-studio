---
name: skill-creator-guide
description: 创建、搜索、安装和管理 Claude Code Agent Skills。当用户想要搜索技能、安装工具、创建自定义 Skill，或者说"find a skill"、"搜索技能"、"帮我做个 skill"、"create a skill"时触发。也适用于用户说"有没有做 X 的工具"、"我想扩展 Agent 能力"、"把这个流程做成 Skill"的场景。
---

# Skill Creator Guide

## 1. 创建 Skills

### 需求捕获

从对话上下文提取或直接询问：
- Skill 名称（小写字母、数字、连字符，如 `gh-create-pr`）
- 功能描述
- 触发场景
- 公开（shared）还是私有

如果用户说"把刚才的流程做成 Skill"，从对话历史提取工具用法、步骤顺序、用户修正。

### 编写 SKILL.md

frontmatter：
```yaml
---
name: skill-name
description: 功能描述 + 触发场景。写得具体且"积极触发"——列出所有应该使用的场景，避免 Agent 不触发。
---
```

正文编写要点：
- 用祈使句，解释为什么重要而不是堆 MUST
- 控制在 500 行以内，超出拆到 references/
- 包含 1-2 个示例输入/输出
- 大参考文件（>300 行）加目录

### Skill 目录结构

```
skill-name/
├── SKILL.md          # 必需：frontmatter + 指令
├── scripts/          # 可选：可执行脚本
├── references/       # 可选：参考文档
└── assets/           # 可选：模板等资源
```

### 创建流程

1. 收集需求
2. 创建 `.agents/skills/<skill-name>/SKILL.md`
3. 如果公开：添加到 `.agents/skills/public-skills.txt` 并运行 `pnpm skills:sync`
4. 验证：`pnpm skills:check`
5. 报告：展示创建的文件、验证结果、使用方法

### 公开 vs 私有

| 类型 | 位置 | 要求 |
|------|------|------|
| 私有 | `.agents/skills/` | 直接创建 |
| 公开 | 两个位置 | 添加到 `public-skills.txt` + `pnpm skills:sync` |

## 2. 搜索和安装 Skills

### 运行时检测

```bash
if command -v npx &>/dev/null; then
  SKILLS_CMD="npx skills"
elif [ -n "$CHERRY_STUDIO_BUN_PATH" ] && [ -x "$CHERRY_STUDIO_BUN_PATH" ]; then
  SKILLS_CMD="$CHERRY_STUDIO_BUN_PATH x skills"
else
  echo "需要 npx 或 Cherry Studio 内置的 bun。"
  exit 1
fi
```

### 搜索

`$SKILLS_CMD find [query]`

常见搜索方向：

| 领域 | 关键词 |
|------|--------|
| Web 开发 | react, nextjs, typescript, tailwind |
| 测试 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 文档 | docs, readme, changelog |
| 代码质量 | review, lint, refactor |
| 效率 | workflow, automation, git |

### 安装

**安全要求**：Skills 是第三方代码，拥有 Agent 完整权限。安装前必须：
1. 展示安全警告
2. 提供源码链接
3. 获得用户确认

```bash
$SKILLS_CMD add <owner/repo@skill> -y
```

安装位置：
- 项目级：`.claude/skills/`
- 用户级：`~/.claude/skills/`

## 3. 管理 Skills

- **列表**：展示所有已安装 Skill 及描述
- **更新**：修改 SKILL.md（先展示 diff）
- **删除**：需用户确认后删除目录
- **同步**：`pnpm skills:sync`

## 4. 测试

设计 2-3 个真实测试用例，用 subagent 并行跑 with-skill 和 baseline 对比。

## 5. Skill 编写原则

- 解释 why 而不是堆 MUST
- 用 theory of mind 写通用指令
- 先写草稿，换视角审视后改进
- 多领域 Skill 按 variant 组织 references/
- 不包含恶意代码或误导性内容

## 参考

- Skills 生态：https://skills.sh/
- 搜索：`npx skills find [query]`
- 安装：`npx skills add <package> -y`
- 验证：`pnpm skills:check`
- 同步：`pnpm skills:sync`
