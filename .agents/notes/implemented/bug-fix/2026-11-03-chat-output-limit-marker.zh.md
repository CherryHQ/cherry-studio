# Agent Note: 保留并展示聊天输出上限的结束原因

Status: implemented

[English](2026-11-03-chat-output-limit-marker.md) | 中文

## 问题

普通 Chat 的助手回答以 AI SDK 规范化后的 `finishReason === 'length'` 结束时，看起来仍像完整回答：界面没有截断提示，持久化消息的 `status: 'success'` 也没有记录生成停止的原因。用户无法区分完整回答和因模型输出上限而被截断的回答，重新加载历史消息后同样如此。

## 决策

AI SDK 运行时的 `Agent` 在最终 `finish` 事件上，通过 `toUIMessageStream({ messageMetadata })` 提供 `{ finishReason }`。结束原因属于每条助手消息，而非话题或并行模型回答组。

`MessageServiceBackend` 仅将最终消息元数据中的这个标量复制到 `MessageData`，存入 SQLite 现有的 `data` JSON。`TemporaryChatBackend` 在内存消息数据中保留同一字段。共享契约接受可选的规范化 `FinishReason`，不持久化整个运行时元数据对象。不新增列或迁移；没有该字段的历史消息仍然有效，不做回填。

`messageProjection` 将已保存的结束原因恢复到 UI 消息元数据中，`messageListItem` 再将实时或恢复的元数据传入渲染契约。对于 `finishReason === 'length'` 的助手消息，`MessageContent` 在正文下方展示本地化的 `message.finish_reason.length` 提示，即使正文没有 part 也会显示。提示带有 `role="status"` 和 `aria-live="polite"`。

除输出受限外正常完成的回答仍保持 `success`；标记不新增 error part、终止状态或 toast。结束原因为 `stop` 或缺失时不显示标记。由 #22331 负责的 Pi 运行时行为保持不变。

## 考虑过的替代方案

- 将 `length` 视为错误或新增终止状态。这会将已完成的提供商请求与传输或执行失败混为一谈，仅为解释输出不完整就改变现有成功处理。
- 用 `data-*` part 携带结束原因。该原因描述整条消息的完成情况，并非有序内容块；SDK 的消息元数据可以承载它，无需新增自定义 part 协议。
- 仅在 Renderer 的 `onFinish` 中保存本地状态。Main 独立于 Renderer 拥有最终消息的持久化职责。本地状态无法将结束原因写入 Main 保存的消息行，无法在重新加载历史后保留，也无法让其他窗口读取该行时显示相同标记。

## 影响

新完成的 Chat 回答在实时渲染和历史读取中保留结束原因，不改变终止分类。临时会话仅在既有内存生命周期内保留该字段。旧回答没有记录结束原因，无法可靠展示截断标记；界面不会根据文本或状态猜测。标记解释输出上限，不会自动继续或重新生成回答。

## 验证

下列定向单元检查已在上一轮实现中通过，结果记录于该轮验证报告。本轮仅处理文档，未重新执行这些检查。C-04 是新增的覆盖用例，不代表已执行 Electron/E2E 验证。

- Regression — `src/shared/data/types/__tests__/message.test.ts`：接受规范化结束原因及没有该字段的历史数据；拒绝非法值，包括提供商原始值 `max_tokens`。
- Regression — `src/main/ai/streamManager/persistence/backends/__tests__/TemporaryChatBackend.test.ts`：保存成功完成的回答时，在临时助手消息数据中保留最终消息的 `length` 原因。
- Regression — `src/renderer/utils/message/__tests__/messageProjection.test.ts`：将持久化的 `finishReason: 'length'` 恢复到 UI 消息元数据。
- Regression — `src/renderer/components/chat/messages/utils/__tests__/messageListItem.test.ts`：在消息仍为 pending 时投影流中的 `length` 原因。
- Regression — `src/renderer/components/chat/messages/frame/__tests__/MessageContent.test.tsx`：正文为空时仍渲染可见且可访问的提示；原因为 `stop` 或缺失时不显示。
- Regression — `tests/e2e/regression/03-models-and-assistants.test.ts` C-04（已添加，未执行）：断言最终 finish 前没有标记，随后保留部分正文并显示标记；检查保存的消息为 `success`、携带 `finishReason: 'length'` 且没有 `data-error`；重新加载同一消息 ID 后检查标记；后续 `stop` 回答没有标记，之前的标记仍保留。
