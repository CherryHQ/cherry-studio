# Agent Note: 连接拒绝探测请求 ID 的旧版 MCP 服务器

Status: implemented

[English](2026-10-21-mcp-null-error-id.md) | 中文

## 问题

旧版 MCP 服务器可能会拒绝 Cherry Studio 在 `server/discover` 探测中发送的字符串 ID，并以 HTTP 200 返回 JSON-RPC 错误，错误 ID 为 `null`。Core schema 会拒绝此错误；即使只允许解析它，HTTP 传输仍无法将 `null` 与当前请求对应，因此探测会在 Cherry Studio 尝试旧版 `initialize` 之前失败或超时。

## 决策

仅允许 JSON-RPC 错误响应使用可空 ID。对于恰好包含一个请求、且只返回一个 null-ID 错误响应的 Streamable HTTP POST，将该响应关联到同一 POST 中的请求 ID。现有探测分类器随后会将此错误识别为旧版证据，并继续执行 `initialize`。

## 考虑过的替代方案

- 对所有无法使用的 2xx 响应扩大应用层回退范围，会把格式错误的响应也当作旧版，并将失败推迟到 `initialize`。
- 只修改错误 schema 仍无法关联响应，探测会一直等待到超时。
- 将所有探测请求改成数字 ID 会全局改变请求生成方式，也没有正确处理服务器合法返回的 null-ID 错误响应。

## 影响

此兼容修复仅适用于单请求、单响应的 Streamable HTTP 交互；批处理或多响应中的 null-ID 错误仍不会被关联。MCP SDK 版本升级时应重新检查这些版本固定的 SDK 补丁。

## 验证

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`：模拟旧版服务器返回报告中的 HTTP 200 null-ID parse error，随后接受 `initialize`；客户端以旧版模式成功连接并列出其工具。
