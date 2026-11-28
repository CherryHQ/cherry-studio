# Agent Note: 关闭 Codex 会话时取消审批

Status: implemented

[English](2026-11-28-codex-approval-close-order.md) | 中文

## Problem

关闭 Codex 会话会取消待处理的审批。取消回复异步生成，因此 `turn/interrupt` 可能先到达 App Server。如果中断很快结束回合，进程可能在 App Server 收到回复前被终止。

## Decision

关闭期间，Codex 会话先等待待处理的服务端请求回复写入 stdio，再向仍在运行的回合发出中断。桌面端在关闭进程前仍沿用原有的一秒等待时间。

## Alternatives considered

- 延长关闭前的等待时间。App Server 很快结束回合时，回复和中断的先后顺序依旧不会改变。

## Consequences

在同一条流上，回复先于中断发出。如果回复卡住，等待期满后桌面端仍可关闭进程。

## Verification

- Regression — `connections.test.ts`：有待处理审批时，关闭 Codex 会话会发出取消回复。如需中断，中断请求排在取消回复之后。ACP 用例仍收到其协议规定的取消回复。
