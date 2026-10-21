# Agent Note: 沙盒未完成资源的归属

Status: implemented

[English](2026-10-18-sandbox-pending-resources.md) | 中文

## Problem

MXC 启动或退出一直未完成时，清理返回未完成状态后输出队列仍保持打开。等待输出的调用方无法完成停止，也无法进入 manager 的清理重试。另外，RPC 超时释放了调用方配额，但 `vscode-jsonrpc` 仍持有响应 promise，导致请求可无限积累。`not-started` 通知还可能把启动错误掩盖为取消。MXC 1.0.0 的 `wait()` 可以在调用方持有的输出流到达 EOF 前完成，此时关闭队列或释放流会静默丢失尾部字节。

## Decision

终止与清理独立处理异常：SDK 的 `kill()` 抛错不能跳过有界输出清理，也不能让消费者一直等待。lease 清理未完成时关闭两个输出队列，保留已缓冲字节，并报告 `OUTPUT_TRUNCATED`。manager 继续持有失败实例和 SDK 资源，以便重试清理。只有目标确实退出才触发 `exited` 路径；准备和启动失败保留原始就绪错误及 `startup-error` 完成原因。

确认退出后，继续收集和消费输出，直到两个管道均到达 EOF 且队列排空，等待上限取 `ioDrainTimeoutMs` 与 `cleanupTimeoutMs` 中的较小值，随后才释放 SDK 流。管道提前关闭、输出预算导致丢弃或等待超时均报告 `OUTPUT_TRUNCATED`，即使缓冲中已经没有字节。

RPC 的 32 个请求上限统计所有尚未完成的传输请求，包括已经超时或取消的调用，直到响应到达或连接释放使其完成。调用方仍会及时收到超时错误。可接受的超时值为 1 到 2147483647 毫秒之间的整数。

## Alternatives considered

- 将进程完成视作输出 EOF 会丢失有效的尾部字节；无限等待则可能被继承的管道或缺席的消费者阻塞。
- 只在应用服务中限制输出收集，会让 CLI 和其他包调用方仍然面临相同的卡住问题。
- 任意请求超时即释放整个 RPC 连接，会中断无关调用。保留传输配额使连接在上限内仍可使用。
- 本地取消时释放配额，无法限制底层库中待完成响应 promise 的数量。

## Consequences

清理未完成后的输出被主动舍弃；这不代表目标已停止。已缓冲输出仍可读取。不返回响应的 RPC 对端可以耗尽所有配额，此后新请求失败，直到收到响应或释放 peer。超时不能证明远端操作已被取消。

## Verification

- Regression — `packages/sandbox/tests/contracts/lease.test.ts` 覆盖准备与 SDK 启动错误、准备阶段停滞、输出收集结束、缓冲输出保留，以及退出后的清理重试。真实 SDK 下的原生 kill 抛错用例验证输出收集带截断报告结束，实例仍处于失败状态，随后可成功停止且不替换最初的 completion。它还使用已安装 SDK 的真实 `MxcProcess` 和可控的原生驱动流，验证延迟 stdout/stderr、提前关闭、未消费缓冲，以及排空和清理期限。
- Regression — `packages/sandbox/tests/contracts/peer.test.ts` 使用真实 JSON-RPC 流连接验证超时或取消后的配额耗尽、延迟响应后的恢复、预先取消的请求、断线结算及计时器边界。
- Regression — 沙盒包已有的 `tests/cli.test.ts`、`tests/rpc.test.ts`、`tests/contracts/instance.test.ts` 和 `tests/contracts/manager.test.ts` 在 macOS 通过，包括 Node/Python 回调。当前宿主受支持，因此跳过不支持平台的测试；本次未验证 Windows 执行。
