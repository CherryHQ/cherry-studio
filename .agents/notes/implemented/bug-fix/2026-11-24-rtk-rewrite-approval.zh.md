# Agent Note: RTK 的 Ask 改写需要审批

Status: implemented

[English](2026-11-24-rtk-rewrite-approval.md) | 中文

## 问题

Cherry 曾把 RTK 的退出码 `3` 当作成功，在获得审批前就应用改写。RTK 用该退出码通知宿主需要询问用户，部分版本也会将默认判决归为 Ask 并返回该退出码。[Issue #25227](https://github.com/CherryHQ/cherry-studio/issues/25227)

## 决策

改写结果携带审批要求。Claude Code 在 `PreToolUse` 请求审批，获批后通过 `canUseTool` 提交改写。Pi 和 Pi Durable 将同样的要求交给共享审批流程。完全访问模式下，这项改写仍需用户决定。

## 考虑过的替代方案

- 自动应用退出码 `3` 的改写会覆盖 RTK 的 Ask 判决。
- 每次遇到退出码 `3` 都保留原命令，会丢弃本可由现有审批流程展示给用户的改写。

## 后果

用户可在批准前查看建议执行的命令。RTK 的 Ask 诊断记录在 debug 级别。退出码 `0` 仍返回无需 RTK 审批的改写。退出码 `1` 仍静默透传，退出码 `2` 仍放弃改写并记录警告。

## 验证

- Regression — `src/main/utils/__tests__/rtk.test.ts`: 用模拟的子进程结果覆盖退出码 `0`–`3`，包括 Ask 的空白及未改变的标准输出，以及 debug 日志级别。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts` 和 `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: 在自动和完全访问模式下，改写都进入逐次审批流程，审批请求包含建议执行的命令。
