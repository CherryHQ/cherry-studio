# Agent Note: Cherry Cloud 额度拒绝以服务端为准

Status: implemented

[English](2026-11-16-cherry-cloud-quota-refusal-snapshot.md) | 中文

## Problem

Cloud 网关在处理请求前，会预扣"预估输入费用 + 按次费用"，不预扣 `max_tokens`。已用额度、其他进行中请求的预扣和本次预扣加起来超过任一窗口上限时，网关返回 `429 QUOTA_EXHAUSTED`。因此，请求可能在额度池仍有余量时被拒绝，一秒后的下一个请求又能成功。窗口额度真正用完时也返回同一个错误码；网关只通过 `Retry-After` 和提示文字（其中写明建议等待多久）区分两者。

`CherryCloudService` 会记录每个被拒绝的模型，并一直把它所在的额度池标为已耗尽，直到某个窗口的 `remaining_units` 超过拒绝时的值。一次拒绝就会让模型选择器和输入框在该额度窗口剩余时间内锁定该模型。所有 Cloud 额度拒绝也都显示为"套餐额度已用完"，即使套餐还剩大部分额度。

## Decision

客户端不再自行推断请求被拒的原因。

- [`CherryCloudService`](../../../../src/main/services/cherryCloud/CherryCloudService.ts) 不再保存任何拒绝状态。只有某个窗口的已结算用量达到上限（`used_units >= limit_units`）时，额度池才视为耗尽。不使用 `remaining_units`，因为它还扣除了进行中请求的预扣，而这些预扣几秒内就会释放。
- 模型请求（`/v1/messages` 或 `/v1/chat/completions`）收到 `429 QUOTA_EXHAUSTED` 后（无论是首次响应，还是认证或重放重试后的响应），服务立即返回拒绝，并以 `quota_refusal` 为原因在后台完整刷新账号（账号、模型、套餐）。同一账号范围内并发的拒绝共用这次刷新；刷新未完成时记录日志。
- [错误块](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx)和 [toast](../../../../src/renderer/services/toast.ts) 只在响应体带有网关自己的 `QUOTA_EXHAUSTED` 错误码时，才把 Cloud 额度拒绝显示为"套餐额度不足以完成本次请求"，并显示服务端原文，其中带有网关自己估算的重试时间。输入框的恢复时间也按同样的已结算用量规则计算。
- 其他 Cloud 额度拒绝，以及带服务端原文的 Cloud 限流错误，统一显示中性标题"请求暂时被限制"。其中包括 AMD 免费模型的限制，它们到达客户端时不带 Cloud 的 `QUOTA_EXHAUSTED` 错误码（见 [AMD 免费模型 Spec](../../proposed/feature/2026-11-10-amd-free-models.md)）。服务端原文（如有）完整显示在标题下方，不截断，也不再加通用的 HTTP 429 提示句，错误上不提供设置或付费入口。AMD 的文案本身可能写有 "quota"，所以共享的提供商错误序列化会把响应体的 `code` 保留为 `providerErrorCode`；响应体本身仍会丢弃。

本决定部分取代 [Cherry Cloud 归属 Spec](../../proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md) 中"保留 quota-refusal floors"的要求。

## Alternatives considered

- 保留 floors，只是更早刷新：不采用，因为进行中请求的预扣释放后余量不变，floor 仍会锁住额度池。
- 在 `remaining_units == 0` 时锁定，并根据刷新后的快照在"已用完"和"本次不足"两种标题间选择：不采用，因为并发的进行中预扣会让余量读成零，锁住几秒后就能恢复的模型，而且拒绝必须等待刷新完成。
- 根据 `Retry-After` 选择标题：不需要，因为服务端原文已写明等待时间；传递这个响应头需要让 Cloud 专属信息穿过共享错误序列化。
- 根据提示文字推断原因：不采用，因为提示文字不是契约。
- 按模型目录识别 AMD 模型：不采用，因为 toast 拿不到模型 ID，而错误块和 toast 必须显示相同的标题。

## Consequences

被拒绝的模型在窗口已结算用量用完之前保持可选，拒绝也会立即送达会话。标题不再区分"套餐已用完"还是"只是本次请求放不下"，由下方的服务端原文说明。只剩少量额度的额度池仍会拒绝较大的请求但保持可选，每次拒绝都显示服务端建议的等待时间。

Claude Code 上报的套餐拒绝只以文本形式到达客户端（`API Error: Request rejected (429) · …`），因此显示的是中性标题加套餐原文，而不是套餐标题。

## Verification

- Regression — `pnpm test:main src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`：`quota refusals` 用例覆盖刷新完成前即返回拒绝、进行中预扣占满额度池时被拒模型仍可用、只在已结算用量达到上限时锁定并在用量重置后解除、并发拒绝共用一次刷新、重放请求上的拒绝，以及模型请求以外不刷新。其中五个用例在本次修复之前的实现上失败。
- Regression — `pnpm test:renderer src/renderer/hooks/__tests__/useCherryCloudQuotaExhaustion.test.tsx`：仅因进行中预扣而读成零的窗口不会推迟恢复时间。
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/services/__tests__/toast.test.ts`：AMD 的每分钟超限、当天额度用完和服务繁忙 429 都在中性标题下保留完整的服务端原文，只有文本的 Claude Code 套餐拒绝在中性标题下显示套餐原文，写有 quota 的 AMD 拒绝不会显示套餐标题，普通的 Cloud 限流 toast 显示中性标题并保留重试操作，没有原文的 Cloud 额度拒绝既不显示套餐标题，也不提供付费或设置入口。其中七个用例在之前的展示逻辑上失败。
- Regression — `pnpm test:shared src/shared/ai/__tests__/providerError.test.ts`：API 错误及每次重试尝试在序列化后都保留响应体的错误码。
