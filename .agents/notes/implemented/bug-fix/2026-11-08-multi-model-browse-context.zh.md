# Agent Note: 浏览多模型回答不是上下文选择操作

Status: implemented

[English](2026-11-08-multi-model-browse-context.md) | 中文

## Problem

折叠视图的模型选择和上下文操作共用了同一个处理函数。切换可见回答因此会沿该回答移动 `topic.activeNodeId`。当同一组回答后面还有已发送轮次时，可见对话会切换到该回答的分支，导致后续轮次看起来消失了。浏览与实际指示下一轮请求使用某个回答是两种不同的用户意图。

## Decision

在折叠视图切换可见回答只更新该组的 `foldSelected` UI 状态和选中回答，不调用 `setActiveBranch`，也不修改 `topic.activeNodeId`。显式选择上下文仍调用 `setActiveBranch`，由分支导航引起的 active branch 变化仍会选择该分支的可见回答。

## Alternatives considered

- 保留共用处理函数并增加视觉标记：这能让新意图可见，但用户仅浏览时仍会移动 active path。
- 移除 active branch 到视图的同步：这也会破坏显式分支导航，此时可见回答应跟随所选分支。

## Consequences

在折叠视图浏览其他模型回答不再修改 active path 或上下文标记。显式选择上下文仍保留现有的分支切换行为。UI 缓存同时记录浏览选择及当时的 active reply：重新挂载时，只有 active reply 未变化才恢复浏览选择，否则跟随分支导航。挂载及后续选择变化会将缓存与可见回答对齐，并清除过期选择，避免后续导航再次恢复它们。该缓存是临时状态，不跨应用重启保留。快速的显式上下文选择仍按顺序执行。

## Verification

- Regression — `pnpm test:renderer src/renderer/components/chat/messages/__tests__/MessageGroup.test.tsx src/renderer/pages/home/__tests__/ChatContent.test.tsx`：折叠视图下浏览其他回答在流式更新期间保留原上下文标记且不调用 `setActiveBranch`，在同分支重挂载后恢复所浏览回答，在卸载期间分支变更后跟随新的分支，并在挂载或卸载期间活动回答变化、随后导航回原分支时不会恢复过期的浏览选择。
