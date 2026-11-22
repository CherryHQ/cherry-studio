# Agent Note: 保留子任务失败原因并复用模型重试状态

Status: implemented

[English](2026-11-19-subagent-retry-error-projection.md) | 中文

## Problem

模型请求超过并发上限时，CherryAI 返回 HTTP 429 和 `CONCURRENCY_LIMITED`。Pi Durable 在原生历史中保留了具体失败原因，但没有内容的子任务助手消息被投影为空的成功产品记录。重开子任务后，界面显示未知错误或无响应，丢失了提供商的原因。原生重试也绕过了 Cherry 的共享重试状态。

## Decision

已完成的 runtime 消息可以携带自身的模型错误。子任务投影将现有 `data-error` part 附加到实时和恢复内容。历史尝试的错误继续可见；只有原生 input/run 结果决定任务最终状态，因此后续成功运行不会被旧错误标记为失败。

桌面 Pi 和 Pi Durable 关闭原生 provider 重试。内部对象调用通过 caller 拥有执行权的单步 SDK 路径使用现有 `ai-retry` 包装器，在同一提供商和模型上进行首次尝试及最多三次重试。包装器位于 provider middleware 外层；SDK 内置重试和密钥／模型回退均关闭。仅在输出内容前发生的失败可以重试，取消会停止退避。重试耗尽后保留最后一次上游错误，包括状态和响应体。

流式 caller 请求发送与聊天一致、具有稳定标识的 `data-retry` 状态。带类型的对象传输回调在原生协议事件之外转发状态，桌面绑定识别原生调用归属。主任务流和独立子任务视图分别更新自身最新状态。成功、失败和取消均清除提示。子任务状态在归档协调后应用，从不写入原生或产品历史。事件时机沿用现有包装器：退避结束、选定下一次尝试时发送重试通知。

本决策更新了 [SDK 转发](../architecture/2026-11-09-gateway-sdk-forwarding.md)和[对象传输](../architecture/2026-11-18-agent-object-transport.md)中的重试边界。公开 HTTP 网关请求保留不重试策略；原生调度、工具、上下文和恢复仍由 harness 拥有。

## Alternatives considered

- 保留原生重试：无法复用模型重试与状态路径，若同时启用网关重试，还会放大尝试次数。
- 在 `ai-retry` 之外启用 SDK 内置重试：引入第二个重试决策者，且无法覆盖所有输出内容前的流失败。
- 根据历史错误 part 推断子任务最终状态：会将后续成功运行错误地标记为失败。
- 持久化重试状态或将其编码进原生协议事件：临时展示会混入重放或保存的历史。

## Consequences

提供商并发限制仍然有效。可恢复的失败可能在有限重试后成功；持续限流仍然失败，并保留具体原因。部分输出不会重放。不引入新的重试偏好、原生任务重启或数据库迁移。

## Verification

- Regression — `ChildThreadProjection.test.ts` 和原生 Durable `projection.test.ts` 保留空内容／部分内容的失败原因，覆盖实时投影、归档和重开，且不覆盖后续成功的原生结果。
- Regression — `gatewayIntegration.test.ts` 使用真实网关执行和本地回环 provider，验证重试恢复、四次尝试耗尽后保留最后的 429 响应体、取消、部分流不重放以及 retry/settled 事件。
- Regression — `singleStep.test.ts` 证明 caller 模型包装器执行重试，且不叠加 SDK 重试或本地工具执行；`PiDurableRuntimeConnection.test.ts` 证明原生主任务和子任务重试已关闭。
- Regression — Pi 和 Pi Durable 连接测试分别路由主任务及两个并发子任务的重试状态；子任务投影测试仅保留最新实时状态，并确保其不进入归档。
- Regression — 隔离 Electron 配合 aimock 1.48.0 运行了 20 个原生子任务：15 个完成，五个耗尽重试。主任务和子任务的重试提示出现、更新并消失；重开后保留原始并发错误且没有重试提示。只读 SQLite 检查确认主任务及 20 个子任务归档中均无 `data-retry` part。这是本地模拟提供商的验证，不代表生产发布结果。
