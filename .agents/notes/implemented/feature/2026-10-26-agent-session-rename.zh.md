# Agent Note: Agent 工具支持重命名 Session

Status: implemented

[English](2026-10-26-agent-session-rename.md) | 中文

## 问题

Agent 可以为新 Session 命名，但无法通过 Cherry 工具修改已有 Session 的标题。Session 数据服务已经支持显式重命名，并能防止自动命名覆盖。

## 决策

在 `cherry-tools` 暴露 `session_rename`，要求提供 `title`，可选提供 `session_id`。省略 ID 时使用运行时注入的可信当前 Session。显式 ID 可以选择其他 Agent 的 Session。名称去除首尾空格后限制为 1–255 个字符；目标不存在或已在回收站时调用失败。

工具复用现有 Session 交互授权检查，并通过共享运行时策略自动批准。它调用 `AgentSessionService.update`，保留手动名称保护和读模型通知，不启动其他回合。

## 考虑过的替代方案

- 在 `config` 增加 Session 操作：不采用，因为该工具管理 Agent 身份和频道，Session 操作由 Session 工具负责。
- 将重命名限制在当前 Agent：不采用，因为需求包含显式指定其他 Agent 的 Session，并沿用现有交互用户授权边界。
- 直接向 SQLite 写入名称：不采用，因为这会绕过手动名称保护和读模型通知。

## 影响

两个运行时适配器均使用共享批准策略。即使重命名当前 Session，也要求存在交互响应方。目标选择不受 Agent 归属限制；调用者仍必须拥有其可信当前 Session。不需要数据库迁移或新的 IPC 端点。

## 验证

- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/cherrySessionRename.integration.test.ts`：验证当前、同一 Agent 和跨 Agent Session 的持久化重命名、参数校验、手动名称保护，以及对无效调用者、不存在或回收站目标和无交互调用的拒绝。
- Regression — `pnpm test:main src/main/ai/toolApproval/__tests__/builtinToolPolicy.test.ts`：验证自动批准仅在挂载 `cherry-tools` 服务时生效。
