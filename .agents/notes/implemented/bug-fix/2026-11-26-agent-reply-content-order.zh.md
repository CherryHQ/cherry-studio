# Agent Note: 保留智能体回复的内容顺序

Status: implemented

[English](2026-11-26-agent-reply-content-order.md) | 中文

## Problem

[#25407](https://github.com/CherryHQ/cherry-studio/issues/25407) 中，阶段说明被显示在对应的工具调用之后。实时渲染把中间文字集中放在过程历史末尾。结束态渲染从最后一段正文回溯，可能在停止后把 `AskUserQuestion` 前后的文字都移到结果区。已保存的 part 顺序是正确的。

## Decision

宿主管理 Run 归属和 Turn 生命周期。共用渲染层按每条助手回复的有序 parts 和稳定 part ID 展示内容。实时和结束态都按原顺序渲染连续的工具与思考分组，直接显示的正文在原处隔开各组。交互式提问卡保留原位置，消息搜索复用结束态渲染的直接展示文字投影。 [实时布局](../../../../src/renderer/components/chat/messages/blocks/addressedPartLayout.ts) · [结束态布局](../../../../src/renderer/components/chat/messages/blocks/messagePartLayouts.ts) · [消息搜索](../../../../src/renderer/components/chat/messages/list/messageSearch.ts)

## Alternatives considered

- 限制停止后的向前回溯范围。实时布局仍可能把中间文字挪到工具之后。
- 给三个 harness 都增加最终答复标记。渲染层已经可以根据收到的有序 parts 保留发生顺序。

## Consequences

智能体会话继续直接显示中间文字。在关闭中间文字的视图里，如果正文后面还有普通过程活动，该文字在原位置归入可展开的过程组。连续的回复尾部内容以及有明确直接展示类型的结果保持可见。一个折叠区域可以拆为多个分组。相邻正文与过程组使用一致的纵向间距，回复总耗时只显示一次。 [过程分组](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx) · [折叠组件](../../../../src/renderer/components/chat/messages/blocks/MessageProcessGroup.tsx)

## Verification

- Regression — 定向 Renderer 测试通过 167 项，覆盖 part 布局、消息渲染、过程分组和消息搜索，包括按 ID 更新的实时内容、Stop 和提问后继续调用工具。
- Regression — Electron 中使用真实 DeepSeek Flash，在 Claude Code、Pi 和 Pi Durable 分别读取两个样例文件，正常结束和重开后均按顺序显示说明和工具。三个 harness 都通过了脚本化 Stop 和重开验证。
- Regression — Electron 在基线与修复版重放同一条已保存的 Pi Durable 记录，复现并验证了顺序修复。Claude Code 样例折叠时的五处间距修复后均为 8 CSS px。
