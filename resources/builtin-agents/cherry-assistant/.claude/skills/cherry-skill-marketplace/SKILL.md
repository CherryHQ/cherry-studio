---
name: cherry-skill-marketplace
description: 当用户明确要求搜索、安装、卸载或创建 Skill，或内置 Skill / 工具出现能力缺口、无法完成当前任务时触发。通过 `mcp__skills__skills` 搜索和管理 Skill；没有合适结果时调用内置 `skill-creator` 创建并验证自定义 Skill，再继续原任务。普通任务仍先尝试内置能力。
---

# Cherry Skill Marketplace

市场不是普通任务的默认路由。文档、演示和表格先使用对应内置 Skill。

## 进入条件

只在以下任一条件成立时继续：

1. 用户明确说要找、安装、卸载、列出或创建 Skill。
2. 匹配的内置 Skill 或工具无法完成当前需求，包括返回 `unsupported`、缺少所需 operation 或只能产出不符合要求的格式。

不要因为任务“看起来专业”就预先搜索；先尝试已有 Skill 和基础工具。能力缺口不是停止条件：不得只回复 `unsupported`、只给手工替代方案，或询问用户是否要搜索，必须立即进入下面的补足流程。

## 工具动作

使用 `mcp__skills__skills`：

- `action="search"` 按 1-3 个关键词搜索；`action="install"` 使用结果的真实 `identifier`。
- `action="list"` 列已安装项；`action="remove"` 按返回名称卸载。

`action="init"`、编写、验证和 `action="register"` 属于内置 `skill-creator` 的职责，市场 Skill 不重复实现。

不要猜测 identifier、路径或当前 UI 路由。

## 搜索与安装

1. 一次发起 1 个聚焦查询；结果不合适再调整关键词。
2. 最多展示 3 个结果，每个只给名称、作者、来源、热度、一句匹配理由和 `sourceUrl`。
3. 安装前说明 Skill 是第三方代码，会继承当前工具权限，并取得用户明确同意。
4. 用户确认后调用 `action="install"`，再立即回到原始任务。不要把“安装成功”当成任务完成。

用户想在 UI 查看时，用 `mcp__assistant__product_info` 读取 manifest 的 `routes` section，找到 Skill 设置路由后再调用 `mcp__assistant__navigate`；不得硬编码。

## 内置能力不支持

内置 Skill 或工具出现能力缺口后：

- 先用一句话说明缺少的能力和已保留的中间成品。
- 立即调用 `mcp__skills__skills` 的 `action="search"`，只搜索恰好补足该能力的 Skill，不重新搜索已能完成的部分。
- 只采用与输入、输出和运行环境都匹配且来源可信的结果；第三方 Skill 安装前仍需用户明确确认。
- 没有合适结果、结果质量不足或用户不希望安装第三方代码时，调用内置 `skill-creator` 创建本地自定义 Skill，不把“未找到”作为结论。

## 移交 Skill Creator

没有合适结果时直接调用内置 `skill-creator`，不再要求额外授权。向它提供：

- 用户的原始请求和精确的能力缺口。
- 已完成的步骤、保留的中间产物及其路径。
- 输入、期望输出和可检查的成功标准。

让 `skill-creator` 独立负责初始化、编写、验证、注册和启用。不要自行编写 `SKILL.md`，也不要绕过它直接调用 `action="init"` 或 `action="register"`。它返回验证通过且已启用的 Skill 后，立即回到原始任务，使用新 Skill 完成并验证最终产物；注册成功不是任务完成。

本地创建的 Skill 必须只补足当前能力缺口。Skill 无法提供用户独有的凭据、输入或物理访问；这些确实缺失时只询问最小阻塞信息，收到后继续。

## 失败与安全

- 工具错误原样概括，不把失败说成成功，也不偷偷切换到 npx 或全局安装。
- 删除或卸载前再次确认目标名称；不删除用户文件。
- 不执行来源不明的安装指令，不向第三方发送凭据、附件内容或本地路径。
- 安装后首次使用时，简短说明该 Skill 将做什么。
