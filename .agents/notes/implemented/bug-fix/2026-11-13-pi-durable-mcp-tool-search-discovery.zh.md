# Agent Note: 通过搜索加载 Pi Durable 延迟 MCP 工具

Status: implemented

[English](2026-11-13-pi-durable-mcp-tool-search-discovery.md) | 中文

## Problem

普通 MCP 工具此前注册为 `callers: ['tools']`。Codemode 可以调用它们，但原生 `tool_search` 仅搜索模型可调用的延迟工具。仅供工具调用的注册方式将它们排除在发现和加载范围之外。

## Decision

将所有 MCP 工具注册为 `callers: ['model', 'tools']`，并延迟提供普通服务器的工具。原生 `tool_search` 可发现并加载它们，供模型直接调用。脚本在加载前后均可通过 codemode 发现并调用它们。`automation` 仍从一开始就提供给模型。已安装的类型仅接受 `deferred: true` 或省略值，因此 automation 使用 `undefined`。

## Alternatives considered

- 在已纳入仓库的依赖补丁中放宽 `callers` 或 `offeredTools` 语义，会让加载操作在整个 harness 中覆盖仅供工具调用的资格限制。这违背已安装依赖的契约，并为修复局部注册不匹配而改变无关注册项的行为。
- 仅添加 `deferred: true`，仍无法让仅供工具调用的注册项进入原生搜索候选集合。

## Consequences

普通 MCP 工具不再出现在 codemode 的内联提示词目录中，但仍可被发现并通过脚本调用。加载后模型可直接调用它们。直接调用和嵌套调用仍经过共享审批关卡；加载并不授予审批。Automation 的提供方式和基于注解的重放安全策略保持不变。

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/piDurable/durableMcp.test.ts`：真实 Harness、QuickJS codemode 和相连的 MCP 执行可捕获加载前发现或调用缺失、搜索声称已加载却未启用直接执行、加载后脚本失效，以及配置禁用的工具通过搜索或脚本暴露的问题；现有 automation 结果与重放检查保持不变。
