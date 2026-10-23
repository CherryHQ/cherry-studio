# Agent Note: 永久删除守卫

Status: implemented

[English](2026-10-19-permanent-deletion-guards.md) | 中文

## Problem

两条永久删除路径会丢掉用户尚未确认放弃的状态。

脏的智能体文件守卫会在最终永久删除弹窗之前丢弃草稿。用户确认丢弃后再取消删除，草稿就丢失了。先显示删除弹窗，删除 API 失败时草稿同样会丢失。

渲染进程的置顶状态可能落后于跨窗口已经提交的置顶，即便异步同步本身正确。直接永久删除活动话题或智能体会话时，就可能删掉数据库里已经置顶的成员。

## Decision

中央文件守卫在调用方要求时授予一次窄范围的延迟丢弃授权。最终取消、守卫取消、删除已过期或不存在，以及 API 失败，都不会消耗该授权。只有实际删除成功的 id 才会调用回调，并且发生在 hook 关闭标签或失效查询之前，且仅当当前选中项仍需要移除。已批准的文件与草稿身份防止丢掉之后产生的草稿。普通导航在确认后仍然立即丢弃。

直接永久删除活动话题和智能体会话时，在同一写入事务内、任何删除写入之前读取置顶成员。置顶成员会拒绝整批删除，消息、置顶和目标都保留。话题的 `requireAll` 与智能体缺失 id 的行为保持不变。该置顶守卫只覆盖直接的活动删除。显式的所有者级联仍会删除活动及已归档的置顶子项。回收站清空保持不变。现有的运行中忙碌守卫仍在上游。`TRASH_TOPIC_PINNED` / `isTrashTopicPinnedError` 与 `AI_AGENT_SESSION_PINNED` / `isAgentSessionPinnedError` 映射到现有的 `recycle_bin.delete.pinned`。不新增语言键，也不做数据库迁移。

## Alternatives considered

- 只调整对话框顺序，API 失败时仍会丢掉草稿。
- 在下游快照并恢复草稿没有必要，因为已批准的草稿只在会话删除成功之后才丢弃。
- 仅在 UI 上拦截置顶无法消除渲染进程置顶状态与已提交置顶行之间的竞争。
- 在共享清空路径上无条件禁止删除置顶，会阻断显式所有者级联和回收站清空。

## Consequences

取消或失败的永久删除会保留已批准的脏草稿。之后对同一文件的修改，或其他文件，不会被先前的授权丢弃。普通的脏文件导航不变。

删除事务开始前已提交的置顶会拒绝整批直接活动删除。级联和回收站清空仍会在原先就会删除的路径上移除置顶子项。忙碌准入仍是现有的上游检查。调用方展示现有的置顶文案。

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`：选择之后才提交的置顶会拒绝直接活动话题或会话的整批删除，并保留消息和置顶；混合批次不删除任何行；未置顶的活动删除仍会移除消息；缺失或已归档的话题 id 仍为未找到；回收站清空仍能清掉归档时已置顶的行；显式的助手与智能体子项级联仍会删除活动及已归档的置顶子项。
- Regression — `src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`：普通脏文件导航只在确认后丢弃，取消时保留当前文件；延迟丢弃把草稿保留到对已批准文件和草稿调用 `commitDiscard`，任一身份变化后忽略该回调。
- Regression — `src/renderer/pages/agents/components/__tests__/Sessions.test.tsx`：取消未保存文件守卫不会打开永久删除；最后一个活动会话先等待守卫，再进入确认；确认失败时不删除。
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`：活动历史记录的永久删除等待文件导航；取消守卫后可以重试且不删除；确认前落下的置顶会被拒绝。
- Regression — `src/renderer/hooks/agent/__tests__/useSession.test.ts`：`onDeleted` 只在 id 已删除之后、关闭标签或失效查询之前运行；`AI_AGENT_SESSION_PINNED` 会刷新，跳过 `onDeleted`，并且不关闭标签。
- Regression — `src/renderer/hooks/__tests__/useTopic.test.ts`：活动话题删除使用 `trash.topic.delete_permanently`；`TRASH_TOPIC_PINNED` 会刷新，抛出现有置顶文案，并且不关闭标签。
