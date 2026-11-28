# Agent Note: 拆分模型重试策略、派发与生命周期

Status: implemented

[English](2026-11-28-model-retry.md) | 中文

## Problem

模型重试包装器在多层回调中选择尝试、激活凭据与模型，并发送实时状态。库接受候选之前，候选求值就可能改变请求使用的辅助函数。凭据状态跨工具步保留，请求修正和重试状态则属于单次模型调用。

## Decision

重试策略为两个 Chat 入口和由调用方持有上下文的请求统一计算调用方能力。包装器保留 AI SDK 模型层对轮换凭据、修正请求、临时错误重试和备选模型的有序规则。用 ai-retry 组合条件，由动态修正规则返回下一次调用的参数。选中的目标使用自己的提供商中间件、工具修复和用量归因。包装器在开始派发时激活目标。

凭据选择跨工具步保留，重试参数和事件上报限定在单次模型调用。嵌套的 ai-retry 包装器共用同一个上报入口。发过实时重试状态的调用结算一次，包括流取消。提供商上下文恢复、绑定路由的工具续调、公有 Gateway 策略和调用方负责的传输重试仍由各自原有边界处理。

## Alternatives considered

- 所有目标共用一个 ai-retry 包装器。库按提供商和模型 ID 计数，同一模型的两个凭据会共享尝试额度。
- 只提取事件回调。这会让候选激活和流式结算继续分散在多层。

## Consequences

每次模型调用创建自己的执行包装器。已解析的候选在工具步间复用，外层流结束或取消时清除实时状态。现有调用方继续使用提供商适配器和原有 UI 事件结构。

## Verification

- AC1 — `createRetryableWrap.apiKeyFailover.test.ts` 验证重试顺序、跨工具步保留凭据、事件结算以及凭据用尽时的有序错误。
- AC2 — `createRetryableWrap.test.ts` 和 `gatewayIntegration.test.ts` 验证共享尝试计数和实际请求值。与 PR #25726 的集成测试也验证了字段修正在 503 后仍生效，并在下一次调用时重置。
- AC3 — `createRetryableWrap.test.ts` 和 `proxyStream.stream.test.ts` 验证流取消、输出后的失败和绑定路由的工具续调。
- AC4 — `AiService.test.ts` 和 `gatewayIntegration.test.ts` 验证两个 Chat 入口的策略一致性及各 Gateway 调用方的行为。
- AC5 — `createRetryableWrap.test.ts` 和 `buildFallbackModels.test.ts` 验证派发时激活，以及目标各自的请求参数和适配器。
