# Agent Note：修复 Gemini 工具调用历史的名称以便配对调用与结果

Status: implemented

[English](2026-10-28-gemini-tool-call-history-names-repaired.md) | 中文

## 问题

重放包含已完成工具调用的存储对话时，`@ai-sdk/google` 会序列化 `functionCall` / `functionResponse`
部分，但这些部分的 `name` 可能缺失（`missing name`）或不匹配（`name "kb_list" does not
match name "kb_search" at …`）。提供商以 HTTP 400 `invalid Gemini function call history`
拒绝整个轮次，导致对话永久阻塞。记录为 #22577（两个桌面诊断：`contents[455]` 和
`contents[55]`/`contents[56]`）。

故障源于 Cherry 为 Gemini 请求重建工具调用历史的方式：

- 存储的 `dynamic-tool` 部分可能丢失其 `toolName`（迁移、手动编辑，或审批桥路径将名称持久化在
  `callProviderMetadata.cherry.toolName` 而非部分本身上）。
- `@ai-sdk/google` 直接从部分为每个线上部分命名；它没有可匹配的工具调用 ID，因此当一半缺少名称或携带不同名称时，调用/结果配对就会失去同步。
- 现有的清理器 `sanitizeDynamicToolNames` 仅重写非线上合法的名称，从不添加缺失名称或同步不匹配的配对。

## 决策

新增管道步骤 `repairToolNames`（运行于 `sanitizeDynamicToolNames` 之后、媒体门控之前），为每个
`dynamic-tool` 部分恢复名称，并重写部分，使配对的两半发出相同的合法名称。

每个部分的恢复顺序：

1. `part.toolName`（动态工具部分上的规范字段）。
2. `part.callProviderMetadata?.cherry?.toolName`（审批桥的预最终化副本）。

若两者均不存在，该部分获得纯占位符 `unknown_tool`。若恢复的名称非线上合法且非声明工具，则由
`toWireToolName` 重写——这正是清理器所做的——使此步骤与现有契约幂等。

占位符不摘要化：它是合法的线上名称（`/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/`）且在日志中人类可读。并行未命名调用可通过
`toolCallId` 与 `args` 区分，因此占位符仅在调用/结果配对间共享，而不在不同调用间共享。

静态 `tool-{name}` 部分保持原样：其名称即其类型，这已是 SDK 发出的内容。

管道顺序（记录在 `toModelMessages` 的 JSDoc 中）：

```
… → make legacy v1 tool names wire-legal → repair missing/unmatchable tool-call names →
    strip media the model can't accept → …
```

## 考虑的替代方案

- 当名称缺失时丢弃整个调用/结果配对：拒绝，因为它静默重写历史，丢失用户（和模型）期望看到的工具执行证据。
- 改为结构化错误而非占位符：拒绝，因为历史已存储；硬失败不提供恢复路径，用户无法修复。
- 摘要化占位符（如 `unknown_tool_5cf2b45d`）：拒绝，因为不透明摘要在日志中更难 grep，且用户想手动恢复真实名称时无法修正。
- 仅针对 Gemini 修复：拒绝，因为相同的名称一致性不变量对任何从部分命名调用/结果的提供商均有用，且对按 `toolCallId` 匹配的提供商无害。

## 后果

- 重放已完成工具调用的对话不再产生 `invalid Gemini function call history`（HTTP 400）。
- 发出的历史保持每个函数调用的 `name` 与其配对结果的名称相等，包括从存储恢复的条目。
- 存储名称缺失的条目在客户端以 `unknown_tool` 修复，而非作为无效历史发送。
- 历史中的 N 个工具调用为 Gemini 请求产生 N 个一致的调用/结果配对（由回归测试
  `messageRules.geminiToolNames.test.ts` 断言）。

## 验证

- 新增回归套件：9 个测试覆盖 `@ai-sdk/google` 将发送的线上字节（捕获 `generateText` 的
  fetch 请求体）。无修复时 7/8 失败，有修复时全部通过。
- 现有套件：`src/main/ai/messages/` 228 测试通过；`src/main/ai/runtime/aiSdk/` 749 测试通过（一个易超时的测试现运行 15s，远低于 20s 限制）。
- 更改文件通过 `oxlint --deny-warnings`、`oxfmt --check` 与 `tsc --noEmit`（忽略预存的工作区链接错误）。
- 无公开 API 表面变更；修复内部于 `toModelMessages` 管道。