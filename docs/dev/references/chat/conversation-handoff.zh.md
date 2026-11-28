---
description: 可复用的会话交接笔记——阈值提示、可编辑审阅、显式保存与新会话附件
sources:
  - src/main/ai/messages/handoffNote.ts
  - src/main/ai/AiService.ts
  - src/main/ipc/handlers/ai.ts
  - src/shared/ipc/schemas/ai.ts
  - src/renderer/components/chat/shell/ConversationHandoff.tsx
  - src/renderer/pages/home/ChatContent.tsx
  - src/renderer/pages/home/HomePage.tsx
  - src/renderer/pages/agents/AgentChat.tsx
  - src/renderer/pages/agents/AgentPage.tsx
---

# 会话交接笔记

[English](conversation-handoff.md) | 中文

交接笔记的权威参考：在上下文上限摧毁细节之前，把长期进行中的工作迁移到新会话。

## 职责划分

`ConversationHandoff`（渲染进程）持有提示状态、审阅对话框与所有用户操作。它挂载在
两种会话界面的舞台上方：话题聊天的 `ChatContent.tsx` 与 Agent 会话的 `AgentChat.tsx`。
`AiService` 通过 `ai.handoff.generate` IPC 路由负责生成；渲染进程不直接读取消息，
也不直接调用服务商。

## 提示阈值

当会话测得的上下文用量达到所选模型上下文窗口的 80% 时出现提示。话题聊天从当前分支的
`contextUsage` 计算百分比；Agent 会话读取 `useAgentSessionContextUsage`。提示是非阻塞的，
每个会话只出现一次，直到被关闭；它本身不会生成、保存或附加任何内容。只要会话中至少有
一条消息，无论用量如何，都可以手动执行"创建交接"。

## 生成来源

`readHandoffSource` 通过 `readAllConversationMessages` 读取已存储的选中分支，而不是
面向模型的压缩投影，因此生成不依赖暂停自动压缩。长会话会按模型的上下文窗口切成以
UTF-8 字节为界的片段；每个片段按时间顺序提取，再经过分层合并，直到合并为一份
完整的 Markdown 文档。每个请求都可以通过 `ai.text.abort` 取消；生成失败不会改动源会话与压缩
流程，错误可重试。

## 审阅步骤

生成只填充可编辑的预览。对话框会披露所选模型将读取已存储的会话（包括工具结果），且
生成可能消耗多次模型请求。必备小节按顺序为：Goals、Confirmed decisions、Constraints、
Pending questions、Relevant files、Next steps；`validateHandoff` 会拒绝缺少任何小节的
模型输出。取消不会写入任何内容。

## 保存与附加

没有显式操作就不会导出任何内容。"保存 Markdown" 通过 `window.api.file.save` 写入编辑后
的文本。"附加到新会话" 在同一助手下创建新话题（或在同一 Agent 下创建新会话），并通过
`HomePage.tsx` 与 `AgentPage.tsx` 中的草稿缓存把审阅后的文件作为编辑器草稿写入；新会话
的第一条请求携带交接文件，而不是原始 transcript。源会话永远不会被修改。
