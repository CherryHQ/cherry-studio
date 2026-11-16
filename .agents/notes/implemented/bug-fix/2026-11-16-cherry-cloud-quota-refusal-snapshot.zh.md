# Agent Note: Cherry Cloud 额度拒绝以账号快照为准

Status: implemented

[English](2026-11-16-cherry-cloud-quota-refusal-snapshot.md) | 中文

## Problem

Cloud 网关在处理请求前，会预扣"预估输入费用 + `max_tokens` × 输出单价"。已用额度、其他进行中请求的预扣和本次预扣加起来超过任一窗口上限时，网关返回 `429 QUOTA_EXHAUSTED`。因此，一个较大的 Agent 请求可能在额度池仍有余量时被拒绝，一秒后的下一个请求又能成功。

`CherryCloudService` 会记录每个被拒绝的模型，并一直把它所在的额度池标为已耗尽，直到某个窗口的 `remaining_units` 超过拒绝时的值。一次拒绝就会让模型选择器和输入框在该额度窗口剩余时间内锁定该模型。所有 Cloud 额度拒绝也都显示为"套餐额度已用完"，即使套餐还剩大部分额度。

## Decision

[`CherryCloudService`](../../../../src/main/services/cherryCloud/CherryCloudService.ts) 不再保存任何拒绝状态。只有最新账号快照报告某个窗口为零时，额度池才视为耗尽。消息请求收到 `429 QUOTA_EXHAUSTED` 后（无论是首次响应，还是认证或重放重试后的响应），服务以 `quota_refusal` 为原因完整刷新账号（账号、模型、套餐），刷新结束后再返回响应。同一账号范围内并发的拒绝共用一次刷新，上限为五秒。刷新未完成时记录日志并仍返回原始 429；调用方中止请求时停止等待并收到中止。

渲染端依据该快照选择拒绝提示。[错误块](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx)和[会话 toast](../../../../src/renderer/hooks/useConversationErrorToasts.ts)只有在快照把该模型列为已耗尽时才提示额度已用完；否则（包括快照已过期或尚未加载时）提示本次请求所需额度不足，建议减少上下文或等待进行中的请求结束。toast 重试再次失败时，不沿用原始失败时的快照结论。

本决定部分取代 [Cherry Cloud 归属 Spec](../../proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md) 中"保留 quota-refusal floors"的要求。

## Alternatives considered

- 保留 floors，只是更早刷新：不采用，因为进行中请求的预扣释放后余量不变，floor 仍会锁住额度池。
- 在拒绝时把"耗尽/本次不足"写入序列化错误：暂不采用，因为这需要让 Cloud 专属信息穿过共享错误序列化和 Claude Code 回放链路。因此，历史错误消息的提示会随当前快照变化。
- 根据服务端建议的重试时间或提示文字推断原因：不采用，因为网关并未把它作为契约提供。
- 像 [#24660](https://github.com/CherryHQ/cherry-studio/pull/24660) 那样在后台刷新、不等待：不采用，因为错误提示会读到拒绝前的快照。

## Consequences

额度池仍有余量时，被拒绝的模型保持可选；只有额度真正为零时才显示输入框上方的额度提示。拒绝送达会话前最多多等一次账号刷新。网关仍用同一个错误码表示两种原因，区分它们需要后端改动。

## Verification

- Regression — `pnpm test:main src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`：`quota refusals` 用例覆盖有余量时的拒绝、真实零额度在余量恢复后解除、并发拒绝共用一次刷新、重放请求上的拒绝、等待中中止、模型请求以外不刷新，以及刷新失败仍返回 429。其中五个用例在旧实现上失败。五秒上限没有单元测试，因为 `AbortSignal.timeout` 不受假计时器控制。
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/services/__tests__/toast.test.ts src/renderer/hooks/__tests__/useConversationErrorToasts.test.ts`：拒绝提示跟随经 IPC 边界加载的快照，toast 重试时丢弃原始结论。
