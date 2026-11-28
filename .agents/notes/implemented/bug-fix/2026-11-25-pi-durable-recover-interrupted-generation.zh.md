# Agent Note: 异常退出后恢复 Pi Durable 生成

Status: implemented

[English](2026-11-25-pi-durable-recover-interrupted-generation.md) | 中文

## Problem

Pi Durable Harness 使用同一个开关控制上游模型失败重试和宿主退出导致的生成中断恢复。Cherry 网关接管上游重试后，关闭原生重试也关闭了崩溃恢复。重新打开应用时，Durable 把中断轮次记为终态，后续消息仍在队列中。

## Decision

Durable 依赖补丁允许独立开启宿主退出后的恢复。桌面端开启该选项，并使用 Durable 现有的重试上限和退避。上游 provider 重试仍由共享网关负责。[Provider 重试策略](2026-11-19-subagent-retry-error-projection.md)

## Alternatives considered

开启全部原生重试会让网关和 Durable 都能重试同一次 provider 失败。从主进程重新提交输入会绕过 Durable 已记录的任务和输入标识。

## Consequences

重新打开应用时，Durable 从已提交的历史继续生成，保留已完成的子智能体工作。本轮结束后，可以继续处理排队的消息。用户主动停止仍按原有语义取消。

## Verification

- Regression — `piDurableTurnAuthority.test.ts`：macOS Electron 用例在部分回复已输出时终止主进程，使用相同的数据目录重启，确认原回复和排队的回复均已完成，且已完成的子智能体报告仍可查看。
