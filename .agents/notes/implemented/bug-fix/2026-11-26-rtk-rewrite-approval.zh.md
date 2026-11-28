# Agent Note: RTK 的 Ask 改写需要审批

Status: implemented

[English](2026-11-26-rtk-rewrite-approval.md) | 中文

## 问题

`rtkRewrite()` 曾将 RTK 的退出码 `3` 当作无条件成功处理，并在每次匹配命令时输出警告日志。按照 RTK 的退出码协议，退出码 `3`（`Ask` 判决）表示改写需要用户审批，不能静默自动应用。[Issue #25227](https://github.com/CherryHQ/cherry-studio/issues/25227)

## 决策

`rtkRewrite()` 改为返回 `{ command, approvalRequired }`：退出码 `0` 返回 `approvalRequired: false`，退出码 `3` 返回 `approvalRequired: true` 并将诊断日志降至 `debug` 级别。Claude Code 在 `PreToolUse` 同时返回 `permissionDecision: 'ask'` 和 `updatedInput`，使原生项目 `deny` 规则仍可对改写后的命令生效，同时 `canUseTool` 在所有模式（含 `auto` 和 `bypassPermissions`）下保持逐次审批。Pi 与 Pi Durable 将 `approvalRequired` 和 `nonBypassable` 传入共享审批门控。

## 考虑过的替代方案

- 仅降低退出码 `3` 的日志级别并继续自动应用，会绕过 RTK 的 Ask 审批要求。
- 遇到退出码 `3` 时直接丢弃改写，会浪费已有审批流可呈现给用户的有效改写。
- 仅在 `canUseTool` 内替换改写命令，会跳过 Claude Code 原生针对改写后命令的拒绝规则检查。

## 后果

用户在交互模式下可在执行前查看并审批改写后的命令，无人值守回合则会拒绝 Ask 改写。退出码 `0` 继续自动应用，退出码 `1` 保持静默，退出码 `2` 丢弃标准输出并记录警告。

## 验证

- Regression — `src/main/utils/__tests__/rtk.test.ts`: 覆盖退出码 `0`–`3`、退出码 `3` 的空白与未变更输出以及 `debug`/`warn` 日志级别。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts` 与 `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: 覆盖 `PreToolUse` 返回 `permissionDecision: 'ask'` 与 `updatedInput`、`auto` 和 `bypassPermissions` 下的逐次审批，以及无人值守拒绝。
