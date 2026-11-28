# Agent Note: 保持手动启动的 OpenClaw 网关运行

Status: implemented

[English](2026-11-28-openclaw-manual-gateway.md) | 中文

## 问题

打开智能体服务时，后台可能通过 OpenClaw 网关执行 ACP 探测。探测释放租约时会停止网关，即使用户已经为 WebUI 手动启动了该网关。

## 决策

在网关进程上记录显式启动状态。ACP 租约复用该进程，最后一个租约结束后，进程继续运行。

## 考虑过的替代方案

- 跳过设置页的后台探测仍会在聊天会话释放租约时触发同样的停止行为。

## 影响

为 ACP 会话启动的网关仍在最后一个租约结束后停止。用户可以通过**停止服务**结束显式启动的网关。进程退出时清除启动记录。

## 验证

- Regression — `pnpm test:main src/main/services/__tests__/OpenClawService.test.ts`: ACP 租约结束后，显式启动的进程继续运行，用户主动停止时进程退出。
