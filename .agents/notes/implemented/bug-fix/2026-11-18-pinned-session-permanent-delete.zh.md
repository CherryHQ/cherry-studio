# Agent Note: 直接删除置顶的智能体会话

Status: implemented

[English](2026-11-18-pinned-session-permanent-delete.md) | 中文

## Problem

置顶的智能体会话在列表菜单中没有「永久删除」，用户必须先取消置顶。[2026-10-19 的永久删除守卫](2026-10-19-permanent-deletion-guards.md)把置顶当作直接删除的守卫，对智能体会话和 Chat 话题一并生效。置顶是常用的「留在手边」操作。把它当成删除限制后，用户必须在置顶管理与删除之间来回，才能完成一次删除。

## Decision

智能体会话的直接永久删除不再因置顶而拒绝。渲染层列表菜单与历史页都对置顶行显示并执行该动作。主进程通过 `pinService.purgeForEntitiesTx` 在同一写入事务中清除本次删除批次的会话自身的置顶，覆盖普通工作空间与系统工作空间根会话两条路径。

这部分取代了旧 note 的会话侧决策。忙碌准入、确认弹窗、回收站只接受已归档会话的规则保持不变。Chat 话题的直接永久删除仍拒绝置顶：`TopicService` 与 `topicContextMenuActions` 未改，话题菜单仍对置顶话题隐藏该动作。

## Alternatives considered

- 先取消置顶再删除：需要两次 IPC 调用，会使列表重排，且不是原子操作；菜单里仍没有用户要找的动作。
- 只放开 UI 动作：数据层仍会拒绝整个事务批次，菜单项无法执行其对应动作。

## Consequences

置顶对智能体会话不再是删除守卫。被删除会话自身的置顶随事务清除。经父会话级联删除的子会话的置顶不保证覆盖：`DELETE … RETURNING` 只返回受批次 ID 影响的行，不返回外键级联移除的行。话题侧行为保持不变。

会话永久删除后侧边栏快捷键（`ui.sidebar_shortcut`）残留是既有问题，与本决策无关，本 PR 不修复。

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`：通过；直接删除置顶的活动会话及混合批次会移除选中会话、消息和其自身的置顶，并保留用户工作空间；删除置顶的 Chat 话题仍会拒绝整批操作。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionArchivePersistence.integration.test.ts`：通过；`deleteActiveSessionsPermanently` 拒绝未完成的流或运行时工作，删除空闲的活动会话和消息并保留用户工作空间，且在视图过期时仍遵守活动与已归档的状态边界。
- Regression — `src/renderer/components/chat/actions/__tests__/sessionItemActions.test.tsx`：通过；菜单为置顶会话提供并执行永久删除，忙碌或删除进行中仍会阻止该动作。
- Regression — `src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx`：通过；确认前新增置顶仍允许删除，确认前会话变为忙碌则阻止删除；置顶的活动行通过永久删除快捷键打开确认弹窗。
- Regression — `src/renderer/pages/agents/components/sessions/__tests__/SessionItem.test.tsx`：通过；置顶行提供可执行的永久删除，删除进行中会阻止该动作。
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`：通过；置顶历史行提供可执行的永久删除，接受确认前新增的置顶，并在确认时重新检查忙碌准入。
