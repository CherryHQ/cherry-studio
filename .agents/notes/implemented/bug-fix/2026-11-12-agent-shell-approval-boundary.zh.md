# Agent Note: 在子智能体和代码模式中保留根会话审批策略

Status: implemented

[English](2026-11-12-agent-shell-approval-boundary.md) | 中文

## Problem

Pi 和 Pi Durable 子智能体获得了 `bypassPermissions`，而非根会话的权限模式。模型端点可以委派工具调用，绕过根会话要求的审批。根回复中没有对应工具部件的子智能体调用，还缺少渲染审批卡所需的输入。

`codemode` 在 worker 中通过 `new Function` 执行代码，却使用 `permissionClass: 'meta'`。闸门对 meta 调用直接放行，因此代码模式在 `default` 和 `auto` 下无提示执行。审批发出后，provider 执行的 dynamic tool 部件可能保持 `input-available` 状态，同时带有 `approval.id`；输入区扫描却要求 `approval-requested`，使整轮等待而没有审批控件。

原始端点报告在打包的 2.1.10 上复现了普通 Bash 无提示执行，将 `id` 输出写入文件。本 PR 修复子智能体权限继承和代码模式审批；普通 auto Bash 仍然自动执行。命令风险规则与解析在独立的 [Spec #24419](https://github.com/CherryHQ/cherry-studio/pull/24419) 中处理。

## Decision

根线程和子线程读取相同的实时权限模式、交互状态和工具限制。委派不会授予 Full Access。子智能体调用在根回复中没有对应部件时，审批流包含其输入和发起子任务的工具调用标识。根消息投影保留该标识，使输入区能够识别请求来自哪个任务。

`ToolCategory` 包含 `shell`，闸门按此分类执行现有危险 Shell 检查。`codemode` 归为 shell 类，在 `default` 和 `auto` 下明确要求审批，包括子智能体调用。根会话 Full Access 仍是例外。普通 auto Shell 调用保留现有危险命令检测器；本 PR 不增加首次 Shell 确认、整个会话的 Shell 授权或扩展的命令模式。

输入区将尚未结束的部件上未决的审批视为待审批。审批卡展示发起请求的智能体或子任务、后台状态及可用时的任务导航，并提供完整、可滚动和复制的命令预览。可选拒绝原因按需展开。在导航或展开控件上按 Enter 不会批准调用。

## Alternatives considered

- 首次 Shell 确认和整个连接的授权：原始端点修复曾考虑此方案，后按维护者要求从本 PR 分离。此类确认可以打断普通无人值守执行，但不能约束批准后的程序。独立命令策略 Spec 负责已选择的 auto 行为。
- 仅扩充危险命令模式名单：无法修复子智能体权限绕过或审批界面缺失，而且仍会让原始 `id > file` 示例在 auto 中无提示执行。检测器扩展应与解析器和命令策略一起处理。
- 不向自定义端点提供 `bash`/`codemode`：移除了能力却没有授权路径，而且仍需入站校验才能建立执行边界。
- 操作系统沙箱（Seatbelt/bwrap）和可信侧分类器：作为更大的边界改动暂缓。同一端点提供的分类无法建立独立信任。

## Consequences

- 根会话当前策略要求审批时，子智能体必须请求审批。没有响应者时，需审批的调用被阻止；前台/后台状态不会绕过闸门。
- `codemode` 在 `default` 和 `auto` 下询问；根会话显式 `bypassPermissions` 会放行，除非标记为不可绕过。
- Auto 保持普通 Shell 自动执行。危险命令仍按现有检测器要求询问。不保存会话级 Shell 授权。
- 这是审批路由修复，不是操作系统执行边界。未命中规则的 auto 命令仍可能通过别名、脚本或任意程序执行破坏性或外部操作。收敛后的 PR 没有完整解决原始普通 Bash 端点报告。

## Verification

- Regression — `packages/agent-behavior/tests/core/approval/approval.test.ts`：Shell 分类保留现有 auto 行为；代码模式在 default/auto 下询问，没有响应者时阻止，并保留显式 Full Access 例外。
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`：普通 auto Bash 和允许根内的写入无需审批；代码模式发出可响应请求，不再直接按 meta 放行。
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`：根会话每次危险 auto 调用独立等待；default 和 auto 下的前台/后台子智能体在原生 Bash/代码模式产生文件效果之前，遵循批准、拒绝和响应者不可用的结果。
- Regression — `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`：根会话为 default 模式时，子智能体写入需要审批。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts` 和 `RootMessageProjection.test.ts`：子智能体审批保留输入与来源元数据，且不重复已缓冲的输入。
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts` 和 `PermissionRequestComposer.test.tsx`：动态审批可见，已决调用不再询问，来源和命令正确展示，在展开控件上按 Enter 不会批准。
