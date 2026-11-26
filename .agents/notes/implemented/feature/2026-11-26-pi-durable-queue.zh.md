# Agent Note: 输入区展示 Pi Durable 后续消息队列

Status: implemented

[English](2026-11-26-pi-durable-queue.md) | 中文

## 问题

Pi Durable 会话忙碌时，后续消息持久化在原生队列中。用户需要查看和修改等待中的消息。Work 输入区也需要在发起流请求时透传「排队」意图，供 Pi Durable 区分排队和追加到当前轮。

## 决策

Work 输入区立即提交后续消息，并在队列面板按原生顺序显示。原生队列变化或会话恢复时发布当前等待的条目。消息被取用或撤回后移出面板。「排队」和「追加到当前轮」沿用原有发送控件。

编辑和排序在原生事务内检查操作目标是否仍然有效。修改后的模型输入和会话文本 part 随原来的提交一起被取用。桌面端在实时投影和恢复时按原消息标识更新文本 part。嵌入的引用提示移到编辑后正文的末尾，独立成行。附件和其他消息部分继续保留。拖动以开始时的顺序为准。撤回通过原生接口取消单条提交，启动时可以凭已保存的请求标识恢复未发送状态。回复归属与恢复遵循 [Pi Durable 轮次约定](../architecture/2026-11-18-pi-durable-turn-authority.md)。

## 考虑过的替代方案

由渲染进程维护队列会推迟原生接收，渲染进程或应用退出时等待中的消息可能丢失。撤回后重新提交会改变原生提交标识，也可能与消息取用交错。

## 影响

Pi Durable 后续消息在取用前可编辑和排序，队列顺序和编辑结果在应用重启后保留。撤回的输入可通过现有的未发送消息操作恢复。Pi 和 Claude Code 保持现有输入区队列行为。

## 验证

- AC1 — Electron 使用保持打开的本地模型请求，显示了三条原生后续消息。重启 Electron 后，在释放当前请求前，面板按保存的顺序显示余下两条。
- AC2 — `agentSessionFollowups.test.ts` 检查带嵌入链接的消息编辑后保留完整 Unicode 字符和单词。`followups.test.ts` 检查原生标识和修改后的模型输入在重开后保留。Electron 中验证编辑保留了原消息标识，重启后历史记录和模型均收到编辑后的文本。
- AC3 — `NativeQueuedFollowups.test.tsx` 检查拖动中途队列变更以及重新拖动成功。`followups.test.ts` 检查过期的编辑和排序请求。Electron 中将第二条拖到第一条之前，确认模型请求按新顺序发出，并拒绝了消息取用后的编辑。
- AC4 — `PiDurableRuntimeConnection.test.ts` 检查仅原生撤回已提交时，重开能恢复未发送消息。`followups.test.ts` 检查只撤回一条提交。Electron 中撤回一条等待的消息后，当前模型请求仍然打开，模型未收到撤回的文本。
- AC5 — `useAgentChatRuntimeState.test.tsx` 覆盖发送请求中的「排队」与「追加到当前轮」。`AgentComposer.test.tsx`、`QueuedFollowupsDock.test.tsx` 和 `useFollowupQueue.test.ts` 覆盖原有输入区队列操作。
