# Agent Note: Permission modes for interactive Agent delegation

Status: implemented

[English](2026-10-18-agent-delegation-approval.md) | 中文

## Problem

`session_create` 和 `session_send` 每次调用都要求审批，即使使用智能批准或完全访问模式也不例外。同一项例外规则还阻止无人值守委派，因此不能直接整体移除，否则会放开后续委派。

## Decision

中央内置工具策略将这两个工具归类为 `delegation`。Claude 的钩子和权限回调，以及 Pi 原生调用和嵌套 Code Mode 的授权，共用同一判定：无人值守回合或无法接收用户响应时拒绝；其余情况下，`auto` 和 `bypassPermissions` 自动允许，其他模式询问用户。

工具禁用及现有安全拒绝规则优先。执行层授权和目标可见性检查继续生效。权限模式切换仍沿用现有的下一回合生效边界。

## Alternatives considered

- 独立的消息开关或有方向的 Agent 对白名单会增加另一套授权配置；本次修复复用现有权限模式。
- 放开无人值守的多跳委派需要明确的委派授权、可信调用链、循环与深度检查以及预算；本次不涉及。

## Consequences

已使用智能批准或完全访问的 Agent，现在可以免审批发起交互式委派，包括首次请求。需要逐次审批的用户应选择会询问的权限模式。不新增或改变存储设置、迁移、公开工具参数或目标 Agent 的权限。

[运行时参考文档](../../../../docs/references/ai/agent-session-runtime.md) 说明了权限和单跳边界。本次处理 [#21927](https://github.com/CherryHQ/cherry-studio/issues/21927) 中的重复审批问题，不实现该 Issue 提出的独立消息开关或 Agent 对授权。

## Verification

- Regression — `guardRules.test.ts`、`settingsBuilder.test.ts` 和 `approvalExtension.test.ts`：自动模式允许交互式委派，其他模式询问，禁用或无人值守调用仍被阻止。
- Regression — `PiRuntimeConnection.test.ts`、`piNativeTools.test.ts`、`piVcc.test.ts`、`agentTools.test.ts` 和 `cherryAutonomyTools.test.ts`：验证运行时接入、嵌套授权、模式更新和执行边界。
- Regression — Windows Electron 配合本地模拟服务商：两个运行时在自动模式下免审批发送；默认模式等待点击允许；创建目标会话和回传完成结果均成功。这不代表已验证生产服务商或原生 macOS/Linux。
