# Agent Note: Token 计数共享内部 Agent 请求预算

Status: implemented

[English](2026-11-26-gateway-token-count-budget.md) | 中文

## 问题

Anthropic Token 计数会转换消息与附件，也可能将计数请求转发给上游。内部 Agent 调用 `/v1/messages/count_tokens` 时，可以并发执行这些工作，却没有使用 `/v1/messages` 已有的请求预算。Issue #25445 记录了这个缺口。

## 决策

两个路由使用同一项内部 Agent 会话检查和请求预算。Token 计数先等待预算，再执行估算，期间传递请求的取消信号，估算成功或失败时均释放配额。

## 考虑过的替代方案

为 Token 计数单独设置预算，会让生成与估算同时用满各自的配额。共享现有预算，可以对两类工作施加合计上限。

## 后果

内部 Agent 的 Token 计数可能等待生成请求释放配额。公开请求沿用现有路由行为。预算检查发生在 HTTP 请求体解析后，覆盖后续估算与转换工作。

## 验证

- 回归 — `routes.integration.test.ts` 覆盖等待预算、等待期间公开请求正常执行、成功与失败时释放配额，以及估算前取消。
- 回归 — `ApiGatewayService.test.ts` 和 `estimateAnthropicRequestTokens.test.ts` 覆盖真实预算实现与估算器。三个定向测试文件共通过 139 项测试。
