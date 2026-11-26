# Agent Note: 追加智能体消息时复用旧历史页

Status: implemented

[English](2026-11-20-agent-history-refresh.md) | 中文

## Problem

[时间线更新](https://github.com/CherryHQ/cherry-studio/pull/25406)已改为按 ID 读取提交后的回复。预留新消息时仍会读取所有已加载的历史页。每次追加都扩大首页也会遇到接口的 200 条上限，回退到每页 50 条后，部分已显示的消息会暂时消失。

## Decision

事务提交后的成员变更通知和预留消息确认共用一条历史刷新路径。更新缓存前，确认新消息确实追加在选中的分支末尾。首页保持常规的 50 条，未满的历史页紧跟在首页后，向上翻页时继续复用剩余页面的服务端游标。即使单次通知包含超过 200 个 ID，每次读取也保持常规页大小。

切换分支或无法确认是追加时，重新验证历史。迟到的追加结果无法覆盖已变化的缓存快照，也不会打断正在进行的历史刷新。

## Alternatives considered

- 持续扩大首页会触及接口上限，此时按常规页大小重读相同页数会丢失已加载的消息。
- 直接用预留确认填充历史缓存，可能显示主进程未选中的分支。

## Consequences

通常一次对话通过 IPC 读取一页历史。连续追加时，已加载的旧消息仍然可见，最旧一页的游标依然可以接着向上翻页。

## Verification

- Regression — `useAgentSessionParts.revalidation.test.ts` 使用真实 SWR 缓存覆盖追加超过 200 条消息、继续向上翻页，以及追加期间切换分支。
- [#24960 的旧版本](https://github.com/CherryHQ/cherry-studio/blob/11a500ebe8ffded55e980f9d41609d04f97c95b5/.agents/notes/implemented/bug-fix/2026-11-20-agent-history-refresh.md#verification) 记录了旧方案在完整智能体页面的性能测量。这些结果早于当前的时间线和分页实现。
