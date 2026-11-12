# Agent Note: 智能体内置工具目录

Status: proposed

[English](2026-11-11-agent-builtin-tool-catalog.md) | 中文

## Problem

原先按运行时分别手写的目录没有为 Pi 和 Pi Durable 提供它们能够执行的 Cherry MCP 工具。当前投影组合原生工具与公开 MCP 定义（`src/shared/ai/agentRuntimeCapabilities.ts:26`、`:135`；`src/shared/ai/builtinMcpToolName.ts:5`）。此前只有 Claude ID 检查会隐藏知识库行，而浏览器和计算机行显示不可用徽章，没有绘图模型时 Generate Image 仍显示开启；当前可用性和分组控件见 `src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1156`、`:1175`、`:1231`、`:1256`。

Knowledge Search 声明了列表和文档读取依赖（`src/shared/ai/claudecode/toolRegistry.ts:286`、`:297`、`:309`），但 Pi 未展开依赖，关闭搜索后仍能读取。Pi 和 Durable 现在展开运行时生效的限制（`src/main/ai/runtime/pi/piDisabledTools.ts:4`；`src/main/ai/runtime/pi/PiRuntimeConnection.ts:979`；`src/main/ai/runtime/piDurable/durableDesktop.ts:53`）。

## Proposal

从满足 `exposure === 'user' && mcpServer !== undefined` 的规范定义投影公开 MCP 行，并与受支持的原生工具一起展示。运行时无关的审批策略注册表仍是审批来源，不决定可见性。`disabledTools` 保存运行时原生 ID：Claude Code 使用 `mcp__cherry-tools__*`，Pi 和 Pi Durable 使用 `mcp__cherry_tools__*`。无需修改智能体 schema、保存 ID 映射或新增偏好设置。

在规范定义中统一声明知识库和绘图前置条件，由对话框消费。未绑定知识库或无法解析绘图模型时，行保持可见、未选中且不可用，已保存选择不变。浏览器和计算机保留分组控件。根据声明展开运行时生效的禁用集合，不改写持久化选择：关闭 Knowledge Search 也阻止列表和读取；Manage Knowledge 仍独立控制。审批与禁用选择分离。

由于本自动化无法创建单独的 Spec 栈，提议中的 Spec 与实现一同提交。仍需人工批准 Spec 的确切 head；此处不声称已获批准。这不满足通常的实现前审批顺序。

## Alternatives considered

- 为每个运行时手写十个 MCP 行：重复列表容易产生偏差。
- 从策略注册表推导可见性：注册审批策略不代表工具应公开。
- 扩大 `PI_BUILTIN_TOOLS` 或 `PiBuiltinToolCategory`：MCP 行不是 Pi 原生工具，混用会影响结果分类。
- 保存 Claude ID 并在运行时转换：原生 ID 无需持久化映射即可使保存内容与策略一致。
- 隐藏不可用行：用户无法看到能力及其不可用状态。
- 以后再修复知识库依赖：搜索开关仍会留下文档读取入口。

## Acceptance criteria

- AC1 — 每个受支持的运行时在其受支持的原生工具旁展示声明的公开 MCP 工具，内部工具保持隐藏 (verification: unit)
- AC2 — 关闭某行会保存该运行时的原生 ID，重新打开并重新启用时保留无关限制 (verification: renderer)
- AC3 — 禁用的 MCP 工具在运行时被排除或拒绝，包括依赖 Knowledge Search 的列表和读取工具，而持久化选择不变 (verification: unit)
- AC4 — 未绑定知识库或绘图模型无法解析时，相关行可见、未选中且不可用，已保存选择不变 (verification: renderer)
- AC5 — 扩展目录后仍保留原生工具、MCP 和元工具分类以及图片结果 (verification: renderer)
- AC6 — 空禁用集合的默认行为、审批行为、codemode 暴露、仅 Windows 的 PowerShell 以及 Durable 不提供 `vcc_recall` 的行为不变 (verification: unit)
- AC7 — 本说明、中文对应文件及受影响的开发者文档描述交付契约并通过文档检查 (verification: docs gate)

## Risks

本 PR 尚未建立真实 Electron 或服务提供商验证。已连接会话继续使用连接时捕获的绘图模型。Pi 目录工具通过 codemode 延迟提供，因此未出现在模型的即时声明中不能证明它已被排除。本说明仍为 proposed，确切 head 的人工批准尚未完成。
