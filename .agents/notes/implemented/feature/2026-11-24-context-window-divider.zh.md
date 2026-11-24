# Agent Note: 在首页对话中标出最近消息数的截断位置

Status: implemented

[English](2026-11-24-context-window-divider.md) | 中文

## Problem

`chat.context_settings.max_messages` 和助手级的 `contextSettings.maxMessages` 会让主进程只发送当前分支路径上的最后 N 行。这个截断以前只在设置里看得到。v1 迁移把 `contextCount` 映射为 `maxMessages = contextCount + 1`，而 v1 给每个助手都写入了默认值 5，所以大多数升级用户的助手都带着一个从没主动设置过的 6 条限制。设置了有限值时还会跳过回合开始时的压缩，被截掉的轮次也不会被摘要。用户于是反馈模型在很短的对话里就"记不住"，并怀疑历史丢失（#25260）。

## Decision

首页对话在下一次提交的窗口起点处画一条分隔线，文案为"以上消息不会发送给模型（保留最近消息数：N）"。

- `normalizeMaxMessages`、`applyMaxMessagesWindow` 以及按属性是否存在合并的 `resolveMaxMessages` 放在 `src/shared/utils/contextSettings.ts`。主进程（`PersistentChatContextProvider`、`TemporaryChatService`、`resolveContextSettings`）和 renderer 调用同一组函数，因此画出的截断位置不会与实际发送的偏离。
- `useTopicMessages` 返回 `pathMessages`，即已加载的、从根到当前节点、不含兄弟消息的行，也就是主进程做窗口裁剪的那些行。
- `src/renderer/pages/home/messages/contextWindowBoundary.ts` 中的 `findContextWindowBoundary` 去掉最近一个清除上下文标记及之前的行，除非下一次提交是填充预留的空白 user 叶子，否则追加一条待发送的 user 行，再套用共享窗口函数，返回请求保留的第一行。这一行必定是 user 行，因此在列表中单独成组。只有新消息放得下时，分隔线改为显示在全部历史之后。
- 生效的限制与主进程一致：话题有 `assistantId` 时才应用助手覆盖，否则使用全局偏好。
- 共享 `MessageList` 新增 `messageHead` 插槽，渲染在以指定消息开头的分组上方。首页通过它或 `afterMessages` 传入分隔线，图片截取模式下不传。
- 没有行被丢弃时不画。起点不为 0 的边界必定是已加载的 user 行，所以只加载了部分路径也足够判断。截断落在尚未加载的页面里时不画，直到那一页加载出来。

## Alternatives considered

- 在主进程计算截断位置并随分支消息一起返回：被否决。DataApi 不会自动同步，偏好或助手设置变化后分隔线会一直过期，直到下次重新拉取。
- LobeChat 的定位公式（`historyCount === length - index`）：被否决。它忽略了向前扩展到 user 行的规则，位置最多会和真实截断差一轮。
- 像 SillyTavern 那样标出上一次请求实际携带的范围：被否决。这需要主进程逐轮上报发送的 id，而用户关心的是下一条消息还能不能看到之前的内容。
- 把迁移来的 6 改写为不限制：未纳入。刻意保留 5 的 v1 用户与从未改动的用户无法区分，这个决定属于维护者。

## Consequences

分隔线预测的是当前分支上的下一次新提交。重新生成旧消息、引导进行中的回合、临时对话和 Agent 会话使用不同的锚点或界面，不显示分隔线。它的位置依赖 renderer 的当前路径与主进程提交时解析出的父节点一致；不一致时只会让分隔线位置错，不影响请求本身。窗口函数现在位于共享层，以后修改窗口规则会同时作用于两个进程。

## Verification

- Regression — `src/renderer/pages/home/messages/__tests__/contextWindowBoundary.test.ts`：不限制或没有丢弃时不画分隔线；会计入待发送的 user 行（限制 6 时三轮完整对话全部保留，四轮后截在 u2 前）；向前扩展到 user 行；只有新消息放得下时放在全部历史之后；清除上下文标记之后重新计算窗口；预留的空白叶子被填充而不是追加。
- Regression — `src/shared/utils/__tests__/maxMessagesWindow.test.ts`：迁移后的窗口函数保持原有约定（落在 user 行时恰好保留最后 N 条、向前扩展、续写中的助手回合、非法限制视为不限制）。
- Regression — `src/main/ai/contextBuild/__tests__/resolveContextSettings.test.ts`：助手显式设为 `null` 时，经由 `resolveMaxMessages` 仍然覆盖全局的有限值。
- Electron — 通过 CDP 在开发版中打开一个当前路径为 14 行、助手没有覆盖设置的话题：全局限制设为 6 时，分隔线出现在第五条用户消息上方，与 `findContextWindowBoundary` 预测的行一致；限制设为 1 时出现在最后一条消息之后；清空限制后消失，全程无需刷新。
