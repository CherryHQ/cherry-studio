# Agent Note: 富文本编辑器用户命令交付

Status: implemented

[English](2026-11-03-rich-editor-user-command-delivery.md) | 中文

## Problem

非空笔记的编辑面未聚焦时，工具栏格式命令可能在焦点到达之前修改文档。焦点守卫丢弃了这次更新，导致草稿仍为旧内容，磁盘没有标题标记，或保存了较早的草稿。后续块也会受影响，并非首块专属问题。

## Decision

用户命令入口在格式操作所在的同一事务上标记意图。编辑器 hook 统一读取该意图，即使焦点尚未到达也交付文档变更。编辑器仍须可编辑且文档必须发生变化；未标记事务继续受焦点条件过滤。

本决定与负责会话身份和快照交付的[笔记会话隔离及静默快照加载](2026-10-22-notes-session-isolation.md)互补。

## Alternatives considered

- 只标记 H1 和 H2 会使同类格式命令缺少一致的交付契约。
- 移除焦点过滤会放行未标记的程序化更新，包括初始化时可能发生的数学内容迁移。

## Consequences

`setMarkdown` 仍静默加载快照。图片和公式占位符、链接编辑浮层、表格操作菜单及异步图片粘贴走其他入口，不在本决定覆盖范围内。仅改变存储标记而未改变文档的命令不交付正文。

## Verification

- Regression — `src/renderer/components/RichEditor/__tests__/userCommandDelivery.test.tsx`：工具栏标题在编辑器未聚焦和已聚焦时均交付 Markdown；移除未聚焦标题会交付 `hello`；未标记命令和快照加载保留原行为。
- Regression — `src/renderer/components/RichEditor/__tests__/userCommandDelivery.test.tsx`、`RichEditor.test.tsx`、`useRichEditor.test.ts`、`toolbarFocus.test.tsx` 和 `nativeMarkdown.test.ts`：已记录的单元测试运行中 66 条通过。
- Regression — 当前 main 的本机 macOS Electron 探针：修复前，在未聚焦的非空笔记点击 Heading 1，DOM 出现 `<h1>hello</h1>`，但 3 秒后磁盘仍为 `hello`（`diskHasMarker: false`）；修复后，同一探针发现磁盘为 `# hello\n\n`（`diskHasMarker: true`）。
- Regression — `tests/e2e/smoke/noteHeadingFormattingPersistence.test.ts`：在仅添加此 spec 的未修复基线 `origin/main`（`9164851568673aae54fa6bdd9c4561f9abd62119`）上，`expect.poll` 在 15 秒后超时，结果为 `Expected "# hello" / Received "hello"`；在修复后的树上，同一 spec 的未聚焦 `Heading.md` 和已聚焦 `HeadingFocused.md` 两个用例在 8.1 秒内通过。

这不是对 Windows 2.1.2 现场的验证，也未复现用户“先打字再点 H1”的原句路径。
