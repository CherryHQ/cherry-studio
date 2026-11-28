# Agent Note: Responses 工具退出默认严格模式

Status: implemented

[English](2026-11-02-responses-tool-strict-default.md) | 中文

## 问题

OpenAI Responses API 会尽可能把未设置 `strict` 的函数工具按严格模式处理，Azure OpenAI 文档也将 `strict` 的默认值写为 `true`。严格模式会把所有属性标为必填。Cherry 的内置工具和 MCP 工具有意不设置 `strict`（#18179），因此在路由到 Responses 端点的模型上（包括 Azure 的 `azure-responses` 部署），所有可选参数都变成了必填。内置 Sequential Thinking 工具开始新思维链时不应传 `chainId`；模型却自行编造了一个，导致服务端拒绝调用。

## 决策

当解析出的端点为 `openai-responses` 时，`toolSchemaCompatibility` 为所有 `strict` 未定义的函数工具显式设置 `strict: false`。显式设置了 `strict` 的工具保留原值。其他端点不会收到它们未请求的 `strict` 字段。输入 Schema 及其 `required` 列表保持不变。API 网关已对 OpenAI Responses 目标发送 `strict: false`（#23382）。

## 考虑过的替代方案

- 为内置工具恢复 `strict: true` 会重现 #18179 已消除的问题：Anthropic 将所有严格 Schema 编译成同一个语法，超出上限时拒绝请求；可选字段也需要占位值。此外仍无法覆盖 MCP 工具。
- 在所有端点发送 `strict: false` 会破坏不认识该字段的上游，例如会拒绝多余字段的 Bedrock（#23378）。
- 把每个 MCP Schema 改写为严格形式（所有属性必填且可为 null）会改变第三方工具的参数语义。
- 只修补 Azure 会让 OpenAI 及其他 Responses 提供商保留同样的默认行为。

## 影响

Responses 模型重新把可选的工具参数视为可选。除非工具设置 `strict: true`，Responses 上的工具调用不再受语法约束。Cherry 发往非 Responses 端点的请求不受影响，即使上游中转将其转发到 Responses。

## 验证

- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/toolSchemaCompatibility.test.ts`：Azure Responses 请求为未设置 `strict` 的工具发送 `strict: false` 且保留原始 `required` 列表，并保留显式的 `strict: true`；Chat Completions 与 Anthropic Messages 请求中的非严格工具不携带 `strict` 字段。
