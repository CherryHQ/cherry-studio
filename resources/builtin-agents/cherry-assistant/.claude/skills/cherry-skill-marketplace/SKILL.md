---
name: cherry-skill-marketplace
description: 仅在用户明确要求搜索、安装、卸载或创建 Skill，或匹配的内置 Skill 已报告 unsupported 时触发。通过 `mcp__skills__skills` 管理 Skill。不要为普通文档、PPT 或表格任务预先搜索市场。
---

# Cherry Skill Marketplace

市场不是普通任务的默认路由。文档、演示和表格先使用对应内置 Skill。

## 进入条件

只在以下任一条件成立时继续：

1. 用户明确说要找、安装、卸载、列出或创建 Skill。
2. 匹配的内置 Skill 已明确返回 `unsupported`，当前需求确实需要额外能力。

不要因为任务“看起来专业”就搜索；一次性任务优先用已有 Skill 或基础工具。

## 工具动作

使用 `mcp__skills__skills`：

- `search` 按 1-3 个关键词搜索；`install` 使用结果的真实 `identifier`。
- `list` 列已安装项；`remove` 按返回名称卸载。
- `init` 创建骨架；`register` 注册完成的 Skill。

不要猜测 identifier、路径或当前 UI 路由。

## 搜索与安装

1. 一次发起 1 个聚焦查询；结果不合适再调整关键词。
2. 最多展示 3 个结果，每个只给名称、作者、来源、热度、一句匹配理由和 `sourceUrl`。
3. 安装前说明 Skill 是第三方代码，会继承当前工具权限，并取得用户明确同意。
4. 用户确认后调用 `install`，再立即回到原始任务。不要把“安装成功”当成任务完成。

用户想在 UI 查看时，用 `mcp__assistant__product_info` 读取 manifest 的 `routes` section，找到 Skill 设置路由后再调用 `mcp__assistant__navigate`；不得硬编码。

## 内置能力不支持

内置 Skill 报告 `unsupported` 后：

- 先用一句话说明缺少的能力和已保留的中间成品。
- 搜索恰好补足该能力的 Skill，不重新搜索已能完成的部分。
- 没有合适结果时，提供基础工具完成、创建自定义 Skill 或停止三种选择，不自动安装替代品。

## 创建自定义 Skill

仅在用户明确授权且任务会重复时使用。确认目标、触发语、输入和输出后 `init`；写好含精确描述、最小工作流和验证的 `SKILL.md` 后 `register`。

## 失败与安全

- 工具错误原样概括，不把失败说成成功，也不偷偷切换到 npx 或全局安装。
- 删除或卸载前再次确认目标名称；不删除用户文件。
- 不执行来源不明的安装指令，不向第三方发送凭据、附件内容或本地路径。
- 安装后首次使用时，简短说明该 Skill 将做什么。
