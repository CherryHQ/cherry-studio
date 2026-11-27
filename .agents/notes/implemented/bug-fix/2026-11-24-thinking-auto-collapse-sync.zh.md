# Agent Note: 将已完成处理分组与思考自动折叠设置同步

Status: implemented

[English](2026-11-24-thinking-auto-collapse-sync.md) | 中文

## 问题

关闭“思考内容自动折叠”（`chat.message.thought.auto_collapse`）后，思考内容仍然保持折叠（#18457）。推理内容渲染在两层嵌套的展开状态之后：外层的已完成 `MessageProcessGroup`（`completed-process`）和内层的 `ThinkingBlock`（`reasoning:${id}`）。PR #18073 只修复了内层块的初始状态。外层分组仅在挂载时把该偏好用作 `defaultExpanded`，没有任何同步 effect，因此缓存的折叠状态在切换偏好后、重新挂载后依然生效。超大历史守卫（超过 80 条或 100KB）还会在用户明确关闭自动折叠时强制折叠外层分组。已完成的推理内容还渲染在固定的 `max-h-[min(32rem,60dvh)]` 内层滚动区中，后续 QQ 反馈称其可读性差。

## 决策

以外层分组是否包含推理内容为条件，将其与偏好同步。`MessageProcessLayout` 计算 `reasoningSyncTarget = hasReasoning ? !thoughtAutoCollapse : undefined`，并作为 `syncExpanded` 传给 `MessageProcessGroup`。该分组沿用 `ThinkingBlock` 的模式：用 `completed-process-preference` 记录上一个目标，effect 在两个方向上把 `completed-process` 强制设为新目标。`undefined`（纯工具历史）跳过 effect，因此切换思考设置不会干扰手动的工具展开状态。默认值变为 `reasoningSyncTarget === true || (!oversized && expandToolSteps)`，即关闭自动折叠时，即使超大，含推理的历史也会展开。`ThinkingBlock` 面板仅在流式传输时保留视口自适应上限（保证跟随区域有界），已完成的推理按自然高度渲染。流式传输时该块渲染 `effectiveExpanded`（除非用户在同一次挂载中明确收起，否则保持展开），且不写入 `reasoning:${id}` 展开缓存，因此 live 的 `true` 不会泄漏到已完成挂载；思考结束后视图回落到缓存的偏好默认值，自动折叠开启时（含智能体会话，#25247）收起为一行摘要条，正式回答继续流式输出。同一次挂载中的手动切换会设置 `hasManualOverride` 并在此后被尊重；切换偏好会强制写入缓存并清除该标记。

## 考虑过的替代方案

- 切换偏好时清除 `completed-process` 缓存：不采用，因为过于粗暴，会连带展开与该设置无关的纯工具历史。
- 关闭自动折叠时仍保持超大历史折叠：不采用，因为这保留了本次报告的故障；明确的用户意图优先于性能守卫，纯工具折叠的既有测试仍然通过。
- 跨重启持久化 `message.ui.*` 展开状态：本次修复不采用；关闭偏好后，全新缓存本来就默认展开，而按消息的手动持久化是另一个有键空间和淘汰成本的功能。
- 保留已完成内容的高度上限并增加“完全展开”入口：不采用，因为内层滚动区本身就是可读性投诉的对象；流式传输保留上限以保证跟随行为。

## 后果

切换该设置会立即在两个方向上作用于所有已渲染的含推理历史，包括缓存的旧分组和超大对话。纯工具历史永不同步，保持手动状态。关闭自动折叠时，超大推理会挂载完整 DOM（这是尊重明确意图所接受的代价）；流式对话保持上限并跟随底部。流式思考会自动展开且不污染展开缓存，因此思考结束后自动折叠开启时已完成视图会收起（含智能体会话）；同一次挂载中的手动切换优先于自动行为。

## 验证

- Regression — `pnpm vitest run src/renderer/components/chat/messages/blocks/__tests__/ThinkingBlock.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessageProcessGroup.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx src/renderer/components/chat/messages/hooks/__tests__/useMessageDisclosureState.test.tsx`：130 项通过，包括新增的流式自动展开/自动收起、流式中手动收起，以及既有的外层分组同步、挂载中切换和超大推理用例。
- Regression — `pnpm vitest run src/renderer/components/chat/messages/__tests__/MessageGroup.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx`：74 项通过。
- Regression — 对所有改动的源码和测试文件执行 `pnpm exec oxlint`：干净；同一集合执行 `pnpm exec oxfmt --check`：格式化后干净。
