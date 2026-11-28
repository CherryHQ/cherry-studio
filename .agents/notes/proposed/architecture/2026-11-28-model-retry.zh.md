# Agent Note: 拆分模型重试策略、派发与生命周期

Status: proposed

[English](2026-11-28-model-retry.md) | 中文

## Problem

模型重试包装器在多层回调中选择尝试、激活凭据与模型，并发送实时状态。库接受候选之前，候选求值就可能改变请求使用的辅助函数。凭据状态跨工具步保留，请求修正和重试状态则属于单次模型调用。

## Proposal

为两个 Chat 入口和由调用方持有上下文的请求统一计算调用方能力。保留 AI SDK 模型层对轮换凭据、修正请求、临时错误重试和备选模型的有序规则。用 ai-retry 组合条件，由动态修正规则返回下一次调用的参数。选中的目标使用自己的提供商中间件、工具修复和用量归因。在开始派发时激活目标。

凭据选择跨工具步保留，重试参数和事件上报限定在单次模型调用。嵌套的 ai-retry 包装器共用同一个上报入口。发过实时重试状态的调用结算一次，包括流取消。保留提供商上下文恢复、绑定路由的工具续调、公有 Gateway 策略和调用方负责的传输重试。

## Alternatives considered

- 所有目标共用一个 ai-retry 包装器。库按提供商和模型 ID 计数，同一模型的两个凭据会共享尝试额度。
- 只提取事件回调。这会让候选激活和流式结算继续分散在多层。

## Acceptance criteria

- AC1 — 收到 401 后换 key，新 key 收到 503 时继续用它重试，下一工具步仍使用该 key。第一步上报两次重试和一次结算，凭据用尽时保留有序错误。 (verification: Main model runtime)
- AC2 — 输出预算恢复和临时错误重试共享尝试计数，修正后的请求参数在临时错误后仍生效，独立调用从原始参数开始。 (verification: Main model runtime and Pi gateway)
- AC3 — 取消时结算活跃重试状态，已提交的流不会重放，绑定路由的工具续调使用原目标或报告该目标失败。 (verification: Main streaming and gateway)
- AC4 — Chat 的流式与非流式共用调用方策略，可信 Work 保留调用方选定的恢复能力，公有 Gateway 失败时只发出一次上游请求。 (verification: Main policy and gateway)
- AC5 — 未派发的候选无法更改当前的工具修复、用量归因和提供商参数。跨模型派发使用目标自己的适配器。 (verification: Main model runtime and provider adapters)

## Risks

凭据和模型包装器的尝试额度与流生命周期不同。合并任一边界都可能改变调用次数，或在外层调用完成之前清除状态。目标选择可能跨工具步复用成功解析的结果，因此仍在实际派发时激活目标。
