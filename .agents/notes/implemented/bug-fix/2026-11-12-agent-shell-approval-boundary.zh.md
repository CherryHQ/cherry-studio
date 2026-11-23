# Agent Note: 保留根会话审批并识别子智能体请求来源

Status: implemented

[English](2026-11-12-agent-shell-approval-boundary.md) | 中文

## Problem

Pi 和 Pi Durable 子智能体获得了 `bypassPermissions`，而非根会话的权限模式。模型端点可以委派工具调用，绕过根会话要求的审批。根回复中没有对应工具部件的子智能体调用，还缺少渲染审批卡所需的输入。

provider 执行的 dynamic tool 部件可能保持 `input-available` 状态，同时带有 `approval.id`；输入区扫描却要求 `approval-requested`，使整轮等待而没有审批控件。代码模式内部工具发出的审批也会受到这一展示缺陷影响。

原始端点报告在打包的 2.1.10 上复现了普通 Bash 无提示执行，将 `id` 输出写入文件。本 PR 修复子智能体权限继承和审批展示；普通 auto Bash 仍然自动执行。命令风险规则与解析在独立的 [Spec #24419](https://github.com/CherryHQ/cherry-studio/pull/24419) 中处理。

## Decision

根线程和子线程读取相同的实时权限模式、交互状态和工具限制。委派不会授予 Full Access。子智能体调用在根回复中没有对应部件时，审批流包含其输入和发起子任务的工具调用标识。根消息投影保留该标识，使输入区能够识别请求来自哪个任务。

`codemode` 保留现有 meta 分类和自动分发行为。它在 QuickJS 中执行 JavaScript，不能直接访问 Node、文件系统或网络；嵌套工具调用仍然通过标准审批闸门。因此，子智能体脚本调用 Bash 时，只要根会话策略要求，就会针对该 Bash 调用请求审批。不增加强制的代码模式外层确认。普通 auto Shell 调用保留现有危险命令检测器；本 PR 不增加首次 Shell 确认、整个会话的 Shell 授权或扩展的命令模式。

输入区将尚未结束的部件上未决的审批视为待审批。审批卡展示发起请求的智能体或子任务、后台状态及可用时的任务导航，并提供完整、可滚动和复制的命令预览。可选拒绝原因按需展开。在导航或展开控件上按 Enter 不会批准调用。

## Alternatives considered

- 强制逐次确认代码模式：会与实际嵌套操作的审批重复。QuickJS 执行已经与宿主直接访问隔离；闸门应保护嵌套工具的实际效果，包括子智能体中的调用，而非给脚本再加一层确认。
- 首次 Shell 确认和整个连接的授权：原始端点修复曾考虑此方案，后按维护者要求从本 PR 分离。此类确认可以打断普通无人值守执行，但不能约束批准后的程序。独立命令策略 Spec 负责已选择的 auto 行为。
- 仅扩充危险命令模式名单：无法修复子智能体权限绕过或审批界面缺失，而且仍会让原始 `id > file` 示例在 auto 中无提示执行。检测器扩展应与解析器和命令策略一起处理。
- 不向自定义端点提供 `bash`/`codemode`：移除了能力却没有授权路径，而且仍需入站校验才能建立执行边界。
- 操作系统沙箱（Seatbelt/bwrap）和可信侧分类器：作为更大的边界改动暂缓。同一端点提供的分类无法建立独立信任。

## Consequences

- 根会话当前策略要求审批时，子智能体必须请求审批。没有响应者时，需审批的调用被阻止；前台/后台状态不会绕过闸门。
- 代码模式分发不增加单独弹窗。内部文件、Shell 和 MCP 调用保留各自的工具限制和审批要求，包括响应者不可用时的处理。
- Auto 保持普通 Shell 自动执行。危险命令仍按现有检测器要求询问。不保存会话级 Shell 授权。
- 这是审批路由修复，不是操作系统执行边界。未命中规则的 auto 命令仍可能通过别名、脚本或任意程序执行破坏性或外部操作。收敛后的 PR 没有完整解决原始普通 Bash 端点报告。

## Verification

- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`：普通 auto Bash、允许根内的写入和代码模式分发保留现有自动执行行为。
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`：根会话每次危险 auto 调用独立等待；default 和 auto 下的前台/后台子智能体在直接调用或代码模式内部调用 Bash 产生文件效果之前，遵循批准、拒绝和响应者不可用的结果。唯一的审批指向实际 Bash 操作，并保留发起子任务的标识。
- Regression — `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`：根会话为 default 模式时，子智能体写入需要审批。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts` 和 `RootMessageProjection.test.ts`：子智能体审批保留输入与来源元数据，且不重复已缓冲的输入。
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts` 和 `PermissionRequestComposer.test.tsx`：动态审批可见，已决调用不再询问，来源和命令正确展示，在展开控件上按 Enter 不会批准。
