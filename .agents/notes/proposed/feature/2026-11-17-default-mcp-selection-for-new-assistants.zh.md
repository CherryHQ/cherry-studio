# Agent Note：新建助手的默认 MCP 选择

Status: proposed

[English](2026-11-17-default-mcp-selection-for-new-assistants.md) | 中文

## Problem

每个新建助手的 `mcpMode` 都默认为 `manual`（见 `src/shared/data/types/assistant.ts` 中的 `DEFAULT_MCP_MODE`），`mcpServerIds` 为空列表（见 `src/main/data/services/AssistantService.ts` 中的 `dto.mcpServerIds ?? []`）。总是使用相同 MCP 服务器的用户，每创建一个助手都要重新选择一次。Issue CherryHQ/cherry-studio#19772 要求为新建助手提供安全的默认值。

## Proposal

新增一个用户偏好 `assistant.default_mcp_server_ids`（`string[]`，默认 `[]`），保存新建助手应继承的 MCP 服务器。该偏好只在创建助手时读取。

- 偏好声明在 `scripts/data-classify/data/target-key-definitions.json` 中，并生成到 `src/shared/data/preference/preferenceSchemas.ts`；生成文件不手动编辑。
- 偏好在现有的聊天设置区域中编辑，为 MCP 服务器多选控件。未配置任何服务器时显示空状态。
- 创建助手时，`mcpServerIds` 由该偏好初始化，并过滤掉已不存在或未激活（`mcpServer.isActive`）的服务器。`mcpMode` 保持现有默认值，因此只有模式为 `manual` 时继承的服务器才会生效，与现状一致。
- 创建对话框在保存前显示继承的服务器，用户可以仅为该助手修改或清空。
- 编辑已有助手不会写入该偏好；修改偏好也不会改变已有助手。不执行迁移。

## Alternatives considered

- 记住上一个创建助手的选择。本 Spec 不采用：它会复制用户可能并不希望保留的选择，并使默认值依赖创建历史。
- 为新建助手启用全部 MCP 服务器。不采用：会暴露用户未主动选择的工具。
- 在 MCP 服务器记录上增加“新建助手默认启用”标记。不采用：会把同一偏好分散到 MCP 服务器 schema 中，并使默认值更难在一处查看。
- 将默认值存入 Cache。不采用：Cache 是可丢失的临时数据；用户设置属于 Preference（`AGENTS.md` 的数据表）。

## Acceptance criteria

- AC1 — 当 `assistant.default_mcp_server_ids` 非空时，新建助手的 `mcpServerIds` 恰好为这些服务器，并过滤为现存且激活的服务器（verification: unit）
- AC2 — 当默认值为空时，新建助手的 `mcpServerIds` 等于 `[]`，且 `mcpMode` 保持不变（verification: unit）
- AC3 — 创建对话框在保存前显示继承的服务器，在此处移除某个服务器只影响该助手（verification: renderer）
- AC4 — 编辑已有助手的 MCP 服务器不会修改该偏好，修改该偏好也不会改变任何已有助手（verification: unit）
- AC5 — 偏好中已删除或未激活的服务器在创建时被跳过，不报错，且不会从偏好中移除（verification: unit）
- AC6 — 新偏好键出现在生成的偏好 schema 中，默认值为 `[]`，类型为 `string[]`（verification: docs gate）
- AC7 — 所有新增的用户可见字符串在每个渲染进程语言包中都有翻译，并通过 `pnpm i18n:check`（verification: docs gate）

## Risks

从 MCP 列表中删除的服务器会保留在偏好中，直到用户编辑它；AC5 将其设为静默跳过，可能使期望列表自动清理的用户感到困惑。创建对话框每次新建助手会多出一个可见步骤。已有助手和导入的助手不受影响，因此该功能不提供追溯修复。
