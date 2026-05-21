---
name: cherry-skill-marketplace
description: Cherry Studio 内置 Skill 市场。通过 `mcp__skills__skills` MCP 工具搜索/安装/卸载/列出/新建 Skill，并行查询 claude-plugins.dev / skills.sh / clawhub.ai 三家 registry。安装后**自动 enable 给当前 agent 立刻可用**。当用户说"搜个技能"、"找个 X 工具"、"装一个 skill"、"帮我做个 skill"，或当 agent 遇到不熟领域、需要专业能力主动找工具时触发。优先级高于 skills-manager skill（skills-manager 是 npx CLI 兜底，仅在没有 Cherry Studio MCP 工具的环境用）。
---

# Cherry Skill Marketplace

## 工具：`mcp__skills__skills`

单个 MCP 工具，6 个 action：

| action | 必填参数 | 行为 |
|--------|---------|------|
| `search` | `query` | 三家 registry 并行搜索，返回 `[{slug, name, description, author, stars, downloads, sourceRegistry, sourceUrl, identifier}]` |
| `install` | `identifier` | 装一个搜索结果（用 search 返回的 `identifier` 原样传），**装完自动 enable 给当前 agent** |
| `list` | — | 列已安装 skill：`[{name, folder, path, enabled}]`（`path` 是绝对路径，可读取/修改） |
| `remove` | `name` | 卸载 |
| `init` | `name` | 在 `{userData}/Skills/{name}/` 新建空骨架（用来写自定义 skill） |
| `register` | `name` | 把 `init` 出来的目录注册为 skill 并自动 enable |

## 标准流程：发现 → 授权 → 安装 → 调用

1. **理解需求**：从对话里提炼 1-3 个关键词
2. **搜索**：`mcp__skills__skills` action=search query="..."
3. **筛选展示**：
   - 至多列前 3-5 个，按 stars × downloads 综合排序
   - 每条至少展示：名称 / 作者 / stars / 来源 registry / 一句描述
   - 给源码链接（`sourceUrl`），让用户能自己看
4. **请求授权**：
   - 默认问句："想装 `{slug}` 吗？它由 `{author}` 维护，{stars} 星。"
   - 用户可选回应：
     - "装" → 第 5 步直接装
     - "我想在 UI 里看" → 调 `mcp__assistant__navigate` 到 `/settings/skills?q={query}`，告诉用户「👆 在上方面板里挑」
     - "都不行" → 进入"没找到合适"分支
5. **安装**：`mcp__skills__skills` action=install identifier="{identifier}"
6. **立刻使用**：装完 skill 自动 enable，可以**当回合就调用它**完成原任务
7. **解决后**：如果 skill 真的好用，主动问用户要不要收录到 FAQ（走 faq-collector skill）

## 没找到合适的怎么办

三选一让用户挑：

1. **直接用基础工具做** — Read / Write / Bash / Edit / Glob / Grep / @cherry/browser / Exa Web 搜索都能凑活
2. **我现写一个 skill** — 走"创建自定义 Skill"流程，写完装给我自己用
3. **去 https://skills.sh 人工挑** — 调 `mcp__assistant__browser` 打开网页让用户自己看

## 创建自定义 Skill

适用场景：
- 用户描述了一个**重复出现**的任务模式（不是一次性需求）
- 市场上确实没有现成的
- 用户授权"帮我写一个"

### 流程

1. **需求捕获**（必须问清楚）：
   - Skill 做什么？（一句话描述）
   - 什么时候触发？（用户怎么说才该用它）
   - 输入是什么？输出格式？
   - 有什么外部依赖？（API key / CLI 工具 / 文件等）

2. **`mcp__skills__skills` action=init name="my-skill"** → 拿到空目录的绝对路径

3. **写 `SKILL.md`**：
   ```markdown
   ---
   name: my-skill
   description: <一句话，包含明确的触发条件和关键词>
   ---

   # My Skill

   <祈使句风格，≤500 行，含 1-2 个示例>
   ```

   原则：
   - description 写**触发场景关键词**，不是功能堆叠
   - 内容用祈使句（"做 X"），不堆 MUST/SHOULD
   - 大于 500 行 → 拆 `references/` 子目录按需加载
   - 每个示例要可执行可验证

4. **可选**：加 `scripts/`（脚本工具）、`references/`（领域知识/查阅资料）、`assets/`（模板/图标）

5. **注册启用**：`mcp__skills__skills` action=register name="my-skill" → skill 进入当前 agent 的 active 列表

6. **测试**：起一两个对话试它，看 trigger 准不准、输出对不对，必要时迭代 SKILL.md

7. **告诉用户**：
   - skill 装好了，下次直接说"{触发关键词}"就能用
   - 路径在 `{userData}/Skills/{name}/`，可以在 `/settings/skills` UI 里手动改
   - 如果不好用，可以让我 `mcp__skills__skills` action=remove name="my-skill" 卸载

## 推荐 Skill 速查（按使用频率）

按常见需求 → 该装哪个 / 内置已有，按下表查（**identifier 字段需要 `search` 后取真实值**，因为版本可能变化）：

| 用户说 | 推荐 skill | 来源 | 触发关键词 |
|--------|-----------|------|----------|
| 「写个文档 / PRD / README / 纪要」 | `cherry-doc-writer` | **已内置** | 写文档、起草、draft |
| 「做个 PPT / 演示 / 分享」 | `cherry-web-ppt` | **已内置** | PPT、deck、slides、演示 |
| 「分析数据 / 看 CSV / 画趋势」 | `cherry-data-analyst` | **已内置** | 数据分析、报表、CSV |
| 「做个网页 / 落地页 / SaaS 主页」 | `web-designer` | marketplace | 落地页、landing |
| 「做个海报 / 提示词 / 配图」 | `art-director` | marketplace | 海报、提示词、prompt |
| 「写企业级 PRD（飞书白板 + 图表）」 | `enterprise-prd` | marketplace | 详细 PRD、需求文档 |
| 「拆个书 / 读书笔记」 | `speed-reader` | marketplace | 拆书、读书笔记 |
| 「Cherry Studio 社区版 GitHub PRD」 | `prd-creator` | marketplace | 社区需求、issue PRD |
| 「写电子杂志风网页 PPT」 | `magazine-web-ppt` | marketplace | 杂志风、editorial |
| 「飞书相关（消息 / 文档 / 日历 / ...）」 | `lark-*` 系列 | marketplace | 飞书、Lark |

### 用法

1. 看到用户说「做个 PPT」→ 优先用**已内置**的 `cherry-web-ppt`，直接 SKILL 触发，不用调 MCP 工具
2. 看到用户说「做个杂志风发布会页」→ 内置的不够精致，提议安装 marketplace 的 `magazine-web-ppt`：
   - `mcp__skills__skills` action=search query="magazine ppt"
   - 拿真实 identifier 后 → 给用户看 → 授权 → install
3. 表里没有 → 走通用搜索流程

## 跟其他 skill 的协作

- **cherry-assistant-guide**：Cherry Studio 产品本身的问题 → 走它，不走 marketplace
- **cherry-doc-writer / cherry-web-ppt / cherry-data-analyst**：内置三件套，常见需求直接用，不必先搜 marketplace
- **faq-collector**：装完 skill 解决了用户问题 → 主动问要不要收录 FAQ
- **issue-reporter**：skill 用着用着发现 bug → issue-reporter 提 issue 反馈给 skill 作者
- **skills-manager**（fallback）：仅当 `mcp__skills__skills` 工具调用失败（说明环境没有 Cherry Studio MCP）才考虑切换到 npx CLI 路径

## 失败兜底

如果 `mcp__skills__skills` 工具调用返回错误：
- 错误信息直接告诉用户（不要藏）
- 提议三个回退方案：
  1. 调 `mcp__assistant__navigate` 到 `/settings/skills` 让用户在 UI 里自己装
  2. 切到 `skills-manager` skill 用 npx CLI 兜底
  3. 不装 skill，直接用基础工具做

## 安全提醒

- Skill 是**第三方代码**，装上后拥有 Cherry Assistant 当前的工具权限
- 一定要给用户看 `sourceUrl`，让 ta 至少瞄一眼源码
- 不要在用户没明确说"装"前自动 install
- 装完后第一次使用，简短说明这个 skill 在做什么（防止它偷偷调用东西）
