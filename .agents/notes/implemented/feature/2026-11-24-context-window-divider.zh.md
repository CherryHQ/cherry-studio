# Agent Note: 在首页对话中标出最近消息数的截断位置

Status: implemented

[English](2026-11-24-context-window-divider.md) | 中文

## Problem

`chat.context_settings.max_messages` 和助手级的 `contextSettings.maxMessages` 限制当前分支路径中发给模型的历史。这个截断以前只在设置里看得到。v1 中保存了默认值 `contextCount = 5` 的助手会迁移为 `maxMessages = 6`，原有的无限制设置也会保留。有限上限会跳过回合开始时的压缩，被截掉的内容也不会进入摘要。模型可能因此在短对话中忘掉较早的消息，#25260 报告了类似现象。

## Decision

首页对话在下一次提交的窗口起点处画一条分隔线，文案为"以上消息不会发送给模型（保留最近消息数：N）"。

- 主进程和 renderer 共用 `src/shared/utils/contextSettings.ts` 中的 `normalizeMaxMessages`、`applyMaxMessagesWindow` 和按属性是否存在合并的 `resolveMaxMessages`。
- `useTopicMessages` 从当前节点沿父节点 ID 回溯已加载的历史。链路之外的并列回复不计入窗口。
- `src/renderer/pages/home/messages/contextWindowBoundary.ts` 中的 `findContextWindowBoundary` 去掉最近一个清除上下文标记及之前的行，除非下一次提交是填充预留的空白 user 叶子，否则追加一条待发送的 user 行，再套用共享窗口函数，返回请求保留的第一行。这一行必定是 user 行，因此在列表中单独成组。只有新消息放得下时，分隔线改为显示在全部历史之后。
- 有关联助手的话题等助手设置就绪后才预测截断位置。助手没有覆盖值，或话题没有关联助手时，使用全局偏好。
- 共享 `MessageList` 新增 `messageHead` 插槽，渲染在以指定消息开头的分组上方。首页通过它或 `afterMessages` 传入分隔线，图片截取模式下不传。
- 首条已加载的用户消息恰好是窗口起点时，首页会查它紧邻的上一条消息，确认清除上下文之后确实还有一条旧消息。截断落在尚未加载的页面里时，等该页加载后再显示分隔线。

## Alternatives considered

- 在主进程计算截断位置并随分支消息一起返回：被否决。DataApi 不会自动同步，偏好或助手设置变化后分隔线会一直过期，直到下次重新拉取。
- LobeChat 的定位公式（`historyCount === length - index`）：被否决。它忽略了向前扩展到 user 行的规则，位置最多会和真实截断差一轮。
- 像 SillyTavern 那样标出上一次请求实际携带的范围：被否决。这需要主进程逐轮上报发送的 id，而用户关心的是下一条消息还能不能看到之前的内容。
- 把迁移来的 6 改写为不限制：未纳入。刻意保留 5 的 v1 用户与从未改动的用户无法区分，这个决定属于维护者。

## Consequences

分隔线在首页对话空闲时预测当前分支的下一次新提交。打开回合、流式生成和等待审批时隐藏分隔线。临时对话和 Agent 会话不显示它。主进程根据提交的锚点计算实际请求的窗口。

## Verification

- Regression — `src/renderer/pages/home/messages/__tests__/contextWindowBoundary.test.ts`：不限制或没有丢弃时不画分隔线；会计入待发送的 user 行（限制 6 时三轮完整对话全部保留，四轮后截在 u2 前）；向前扩展到 user 行；只有新消息放得下时放在全部历史之后；清除上下文标记之后重新计算窗口；预留的空白叶子被填充而不是追加。
- Regression — `src/renderer/hooks/__tests__/useTopicMessages.test.ts` 覆盖乐观缓存中的并列回复。`src/renderer/pages/home/__tests__/ChatContent.test.tsx` 验证助手就绪状态和实时回合中的分隔线显示。边界测试同时覆盖截断点在首条已加载消息的场景。
- Regression — `src/shared/utils/__tests__/maxMessagesWindow.test.ts`：迁移后的窗口函数保持原有约定（落在 user 行时恰好保留最后 N 条、向前扩展、续写中的助手回合、非法限制视为不限制）。
- Regression — `src/main/ai/contextBuild/__tests__/resolveContextSettings.test.ts`：助手显式设为 `null` 时，经由 `resolveMaxMessages` 仍然覆盖全局的有限值。
- Electron — 通过 CDP 在开发版中打开一个当前路径为 14 行、助手没有覆盖设置的话题：全局限制设为 6 时，分隔线出现在第五条用户消息上方，与 `findContextWindowBoundary` 预测的行一致；限制设为 1 时出现在最后一条消息之后；清空限制后消失，全程无需刷新。
