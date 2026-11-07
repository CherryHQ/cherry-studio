# Agent Note: 审批卡片比能回答它的请求活得更久

Status: implemented

[English](2026-11-06-retire-abandoned-approval-cards.md) | 中文

## Problem

运行连接在审批仍挂起时销毁，事件发射器持有者的 dispose 会调用 `toolApprovalRegistry.abort(sessionId, 'stream-ended')`。它把等待中的 `canUseTool` promise 以拒绝解决并删除注册表条目，但 `message` 呈现形式的审批——即 `handleToolApprovalRequest` 单独存成一条 `success` 助手行、好让发起方在父回合结束后继续等用户回答的那类——在数据库里原样留在 `approval-requested`。

渲染端把这个 part 读作待答问题，于是输入区继续渲染交互卡片。卡片上没有任何操作能生效：`AgentSessionRuntimeService.respondToolApproval` 在注册表里找不到条目并返回失败，其后的 `AiService` 兜底路径把决定写到聊天用 `message` 表，而 agent 会话的行从来不在那张表里。提交答案与关闭卡片走的是同一条路径，所以每次尝试都在主进程留下 "Tool-approval response anchor is missing or deleted"、在渲染端留下 "Tool approval response was not accepted"，卡片却一直留在屏幕上，会话也就一直不可用。

## Decision

`ToolApprovalRegistry` 现在为每个被 `abort()` 或 `clear()` 未经用户决定就解决的审批触发 `onAborted`，携带会话、工具调用、呈现形式和原因。注册表保持纯内存；持久化后果由监听方负责。`AgentSessionRuntimeService` 订阅该事件，并通过新增的 `AgentSessionMessageService.retireAbandonedApproval(sessionId, approvalId, errorText)` 收回 `message` 呈现形式的卡片：它定位持有该挂起审批的行，把 part 终态化为带固定原因的 `output-error`。该行保留原有 role 与 `success` 状态，因为它是已落定的交互记录而不是活跃回合。`stream` 呈现形式的审批不处理：它们的 part 从未离开回合并流，该流自身的销毁路径已经把其终结。

点击仍可能落到一个活得比请求更久的卡片上——本修复之前存下的，或连接在用户作答途中断开的。`AgentSessionRuntimeService.respondToolApproval` 现在用在线路径同一个 `applyToolApprovalDecision` 把该决定记录到卡片上，同时仍报告为未送达，因此卡片不再被当作可答，也不会假装运行环境收到了任何东西。`AiService` 不再把 agent 会话的响应送进那条永远匹配不到其锚点的聊天表查找。

渲染端把未送达的答案变成会话的下一条用户消息——每个已答问题、所选选项，以及旁边输入的备注——而不是丢弃它；关闭操作没有内容可重投，只做刷新。发起方消失后，会话正是仅剩的通道，答案由此到达继续该会话的一方。

## Alternatives considered

- 只在点击到达时惰性结算，不在 abort 时收回：否决，因为卡片会继续显得可答，而实际已无法触达其发起方，且普通权限卡片还会继续提供一个其工具永远不会运行的批准入口。
- 只在 abort 时收回，不重投答案：否决，因为刚提交的答案会被丢弃，而会话本身仍是它天然的落点。
- 把卡片存成 `pending` 或 `paused`，让中断处理顺带终结它：否决，因为这行是被刻意存成已落定状态的，以免挂起的子代理阻塞会话的下一个回合。
- 依赖启动时对孤儿审批的重整：否决，因为它已不再覆盖所有原生 agent 类型，而且会丢弃会话的 resume token——对一次在线的连接销毁是错的处置。
- 把 abort 本身记作用户拒绝：否决，因为 `attributeUserDenialReasons` 会把宿主给的原因当作用户自己的话回放给模型；这也是为什么只有点击路径——决定确实出自用户——才记录为拒绝。

## Consequences

发起方运行环境已消失的卡片会被以固定原因终态化，从而不再阻塞会话；此时仍然落到该卡片上的点击也不再是死路：卡片记录用户决定，其内容成为会话的下一条消息。运行环境从未看到的答案因此出现在对话记录里，而不是无声消失。

连接断开那一瞬正打在卡片里的草稿会随草稿缓存一起丢弃；强杀进程仍依赖启动路径，它尚未为所有 agent 类型收回挂起卡片。

## Verification

- Regression — `pnpm exec vitest run src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/toolApproval/__tests__/ToolApprovalRegistry.test.ts src/main/data/services/__tests__/AgentSessionMessageService.test.ts src/main/ai/__tests__/AiService.test.ts`：401 项测试通过，覆盖 abort 时的收回、幂等重复，以及注册表条目已消失的卡片上记录的决定。首个收回测试在修复前失败于 `expected "vi.fn()" to be called with arguments: [ 'session-1', 'approval-bg', …(1) ]`——abort 只解决了等待中的 promise，什么也没收回。
- Regression — `pnpm exec vitest run --project renderer src/renderer/pages/agents/__tests__/useAgentChatRuntimeState.test.tsx`：54 项测试通过，含把未送达答案重投为消息，以及关闭操作不发送任何内容。改动前被拒响应直接抛错，这两个用例根本无法到达。
- Regression — 在已发布的 2.1.10 版本上复现：会话 `3fb71b0d` 出现 `Aborted pending approvals … reason "stream-ended"` 之后，卡片仍保留 `approval-requested` part，28 次回答尝试均被以 `Tool-approval response anchor is missing or deleted` 拒绝。
