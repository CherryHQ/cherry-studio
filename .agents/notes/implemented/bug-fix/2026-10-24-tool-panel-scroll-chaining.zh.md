# Agent Note: 恢复工具面板边界的滚动链

Status: implemented

[English](2026-10-24-tool-panel-scroll-chaining.md) | 中文

## 问题

展开的工具面板（`ToolDisclosure` 浅色变体与 `AgentToolDisclosure`）同时使用了 `overflow-auto` 和 `overscroll-contain`。只要元素是滚动容器，Chromium 就会应用该遏制，包括内容没有溢出以及已经滚动到边界的情况。鼠标位于短面板上，或位于已滚到底的长面板上时，滚轮输入被吞掉，对话无法滚动。#21160 在对齐这些面板与思考面板时引入了该条件；#20924 的评审早已将无条件遏制标记为非阻塞风险，#21604 随后又从思考面板中移除了它，使工具面板与聊天区其余部分不一致。

## 决策

从两个工具面板的 body 中移除 `overscroll-contain`，保留 `overflow-auto` 与视口自适应的 `max-h` 上限。嵌套滚动现在遵循 `ScrollOwnershipContext` 中记录的策略：面板在还能继续滚动时消费滚轮、触摸和键盘输入，到达边界后把输入交还消息视口。思考面板、`TerminalOutput`、MCP 工具响应和元工具代码块已经采用这一行为。

## 考虑过的替代方案

- 保留 `overscroll-contain`：不采用，因为面板没有溢出时遏制同样会拦截输入，而这正是本次报告的故障，并且它与共享的嵌套滚动策略相矛盾。
- 仅在内容溢出时应用遏制，如同 VS Code 聊天内容使用 `consumeMouseWheelIfScrollbarIsNeeded` 的做法：本次修复不采用，因为它在边界处仍然拦截输入，而且 CSS 无法检测溢出，每个面板都需要一套尺寸观察状态机。
- 通过 JavaScript 把面板的边界滚轮输入转发给消息视口：不采用，因为这会在主线程重新实现原生滚动链；该转发路径是为无法原生链式滚动的跨文档 iframe 准备的，同文档面板不需要。

## 后果

面板还能滚动时，对话不会移动。面板到达自然边界，或内容从未溢出时，同一手势会继续作用于消息视口。面板结束后，触控板惯性可能进入对话；接受这一点是不拦截所有输入的代价，也与浏览器默认行为和聊天区其余部分一致。因为 `canConsumeVerticalWheel` 会先检查实际溢出，触摸、触控笔和键盘输入也恢复了同样的边界交接。

## 验证

- Regression — `pnpm exec vitest run src/renderer/components/chat/messages/tools/__tests__/AgentToolRenderer.test.tsx`：类名修改后，展开的 agent 工具内容仍能渲染和切换。
- Regression — `pnpm exec vitest run src/renderer/components/chat/messages/list/__tests__/MessageVirtualList.test.tsx`：嵌套滚动器在有溢出时消费滚轮，并在边界把输入交还 runtime。
- Chromium 探针 — 3000px 页面中一个 200px 的 `overflow:auto` 面板：启用遏制时，短面板与已到底面板都会让 `window.scrollY` 保持 0；移除遏制后，两者都会滚动窗口，而面板中段滚动仍然只在本地生效。
- 未运行真实 Electron 手动验证；复现路径见 pull request。
