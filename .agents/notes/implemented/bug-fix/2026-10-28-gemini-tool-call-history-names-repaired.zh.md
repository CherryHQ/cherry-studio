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

新增管道步骤 `repairToolNames`（运行于 `sanitizeDynamicToolNames` 之前），为每个名称仍存于他处的
`dynamic-tool` 部分恢复真实名称，并重写部分，使配对的两半发出相同的合法名称。

每个部分的恢复顺序：

1. `part.toolName`（动态工具部分上的规范字段）。
2. `part.callProviderMetadata?.cherry?.toolName`（审批桥的预最终化副本）。

若两者均不存在，该部分保持无名，由清理器在转换前丢弃——这是 #23233 已接受的取舍，因为臆造的占位符无法识别原始工具。若恢复的名称非线上合法且非声明工具，则由
`toWireToolName` 重写——这正是清理器所做的——使此步骤与现有契约幂等。

恢复运行于清理器之前，因此空的 `toolName` 不会遮蔽仍存于提供商元数据中的真实名称，且恢复出的已声明名称仍会通过该工具的
`toModelOutput` 路由输出。

静态 `tool-{name}` 部分保持原样：其名称即其类型，这已是 SDK 发出的内容。

管道顺序（记录在 `toModelMessages` 的 JSDoc 中）：

```
… → repair recoverable tool-call names → make remaining undeclared names wire-legal, dropping
    any still nameless → strip media the model can't accept → …
```

## 考虑的替代方案

- 为无处留存的名字保留最初的 `unknown_tool` 占位符：在 #23233 合入上游后拒绝——臆造的身份无法匹配工具声明，因此不可恢复的配对改由清理器丢弃。本修复现在只覆盖真实留存的名字（#23233 本会丢弃并丢失的审批桥元数据情形），其余交由清理器丢弃。
- 改为结构化错误而非修复：拒绝，因为历史已存储；硬失败不提供恢复路径，用户无法修复。
- 仅针对 Gemini 修复：拒绝，因为相同的名称一致性不变量对任何从部分命名调用/结果的提供商均有用，且对按 `toolCallId` 匹配的提供商无害。

## 后果

- 重放已完成工具调用的对话不再产生 `invalid Gemini function call history`（HTTP 400）。
- 发出的历史保持每个函数调用的 `name` 与其配对结果的名称相等，包括从存储恢复的条目。
- 存储名称缺失但可恢复的条目在客户端以其真实名称修复；无处可恢复的条目从重放中丢弃（#23233 的行为），而非作为无效历史发送。
- 历史中的 N 个工具调用为 Gemini 请求产生 N 个一致的调用/结果配对（由回归测试
  `messageRules.geminiToolNames.test.ts` 断言）。

## 验证

- 回归套件：`messageRules.geminiToolNames.test.ts` 共 15 个测试，其中 7 个捕获 `@ai-sdk/google`
  将发送的线上字节（`generateText` 的 fetch 请求体）；在合并后的头部全部通过。
- 合并后头部的现有套件：`src/main/ai/messages/` 240 个测试通过（含 #23233 的空名称丢弃回归）；`src/main/ai/runtime/aiSdk/` 597 个测试通过。
- `oxlint --deny-warnings`、`oxfmt --check` 与 `tsc --noEmit` 交由 CI 在合并后的头部上验证。
- 无公开 API 表面变更；修复内部于 `toModelMessages` 管道。