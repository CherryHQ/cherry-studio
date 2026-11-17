# Agent Note: 永久删除守卫

Status: implemented

[English](2026-10-19-permanent-deletion-guards.md) | 中文

## Problem

直接永久删除可能删掉用户在另一个窗口里已经置顶的会话。

渲染进程的置顶状态可能落后于跨窗口已经提交的置顶，即便异步同步本身正确。直接永久删除活动话题或智能体会话时，就可能删掉数据库里已经置顶的成员。

## Decision

直接永久删除活动话题和智能体会话时，在同一写入事务内、任何删除写入之前读取置顶成员。置顶成员会拒绝整批删除，消息、置顶和目标都保留。话题的 `requireAll` 与智能体缺失 id 的行为保持不变。该置顶守卫只覆盖直接的活动删除。显式的所有者级联仍会删除活动及已归档的置顶子项。回收站清空保持不变。现有的运行中忙碌守卫仍在上游。`TRASH_TOPIC_PINNED` / `isTrashTopicPinnedError` 与 `AI_AGENT_SESSION_PINNED` / `isAgentSessionPinnedError` 映射到现有的 `recycle_bin.delete.pinned`。不新增语言键，也不做数据库迁移。

早先的修订还会把智能体文件草稿的丢弃推迟到删除成功之后。#22687 让智能体文件导航在后台保存脱离的草稿、不再弹出丢弃确认，因此本分支合并 main 时移除了该守卫。

## Alternatives considered

- 仅在 UI 上拦截置顶无法消除渲染进程置顶状态与已提交置顶行之间的竞争。
- 在共享清空路径上无条件禁止删除置顶，会阻断显式所有者级联和回收站清空。

## Consequences

删除事务开始前已提交的置顶会拒绝整批直接活动删除。级联和回收站清空仍会在原先就会删除的路径上移除置顶子项。忙碌准入仍是现有的上游检查。调用方展示现有的置顶文案。

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`：选择之后才提交的置顶会拒绝直接活动话题或会话的整批删除，并保留消息和置顶；混合批次不删除任何行；未置顶的活动删除仍会移除消息；缺失或已归档的话题 id 仍为未找到；回收站清空仍能清掉归档时已置顶的行；显式的助手与智能体子项级联仍会删除活动及已归档的置顶子项。
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`：确认前落下的置顶会被拒绝。
- Regression — `src/renderer/hooks/agent/__tests__/useSession.test.ts`：`AI_AGENT_SESSION_PINNED` 会刷新，返回置顶文案，并且不关闭标签。
- Regression — `src/renderer/hooks/__tests__/useTopic.test.ts`：活动话题删除使用 `trash.topic.delete_permanently`；`TRASH_TOPIC_PINNED` 会刷新，抛出现有置顶文案，并且不关闭标签。
