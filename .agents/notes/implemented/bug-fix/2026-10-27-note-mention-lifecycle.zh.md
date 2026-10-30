# Agent Note: Notes 引用会话清理

Status: implemented

[English](2026-10-27-note-mention-lifecycle.md) | 中文

## 问题

PR #20196 的 Notes 来源按需启动，但聊天 `@` 面板关闭后仍保留目录监听。在加载未完成时关闭面板，还需要结束该请求，避免旧结果进入重新打开的面板。

## 决策

现有建议来源把 `onExit` 转发给 Notes hook。退出会取消等待中的请求并清空目录根路径，由既有 `useDirectoryTree` 生命周期释放原生订阅。每次加载都有独立的请求身份，包括同一 React 批次内关闭再打开的情况。延迟完成的目录创建仍由既有目录会话的所有者释放。

输入器还把真实 QuickPanel 的 `onClose` 回调接到当前建议的退出函数。该函数通过已安装的插件 key 调用 Tiptap 的 `exitSuggestion`，不修改草稿，也不把焦点拉回编辑器。关闭校验匹配 Tiptap 的激活装饰身份和触发起点，因此新查询等待结果期间仍可关闭当前会话，同时忽略已关闭会话或其他触发会话的旧回调；结果投递仍独立检查查询、文本、范围和结果代次是否匹配。已销毁的编辑器会被忽略。这是因为点击外部或按 Escape 可以在编辑器选区仍位于 `@` 内时关闭面板，仅隐藏面板不会触发来源的 `onExit`。

Notes 目录校验器放在 `src/main/utils/notesDirectory.ts`，不属于通用文件服务模块。类型化 IPC 适配器和旧 `FileStorage` 共用原有策略。配置路径校验、默认路径回退、无深度限制的 Markdown 发现，以及既有附件和 token 流程均予以保留。

## 考虑过的替代方案

- 在输入器整个生命周期保留监听，会在面板闲置时继续扫描和观察 Notes。
- 仅按路径复用旧请求，可能在 React 提交前重开同一面板时接受过期数据。
- 把 Notes 选择策略留在通用文件模块，会让该模块依赖 Notes 专有的受管目录限制。
- 面板关闭时仅调用 Notes 清理，会让建议保持激活，后续更新仍可能重新打开它。既有 Tiptap 退出接口负责关闭建议，再通过正常来源生命周期转发清理。
- 要求面板最后展示的查询与编辑器最新查询一致，会在话题与 Notes 的组合搜索尚未返回时拒绝关闭，导致监听保留、迟到结果重新打开面板。

## 后果

重新打开会重新取得目录快照；文件发现仍沿用既有异步监听和短暂的 builder 释放宽限期。取消的请求返回空结果。不引入持久化格式、偏好设置、凭据访问或新的引用 token 类型。主线的文件 token 来源身份和草稿保护机制继续负责相应行为。

## 验证

- Regression — `src/renderer/components/composer/__tests__/noteMentionPanel.lifecycle.test.tsx`：使用真实输入器、话题与 Notes 的组合来源、Tiptap 插件、QuickPanel provider/view、UI 组件、虚拟列表和目录 hook，覆盖结果已返回及新查询的话题搜索延迟返回时，实际点击外部或按 Escape 均释放模拟原生订阅，迟到结果不会重开面板。草稿保留，仅重新聚焦不会恢复订阅，重新输入触发符会加载新的 Notes 快照。两条查询等待用例在关闭身份与结果新鲜度分离前失败。
- Regression — `src/renderer/components/composer/__tests__/suggestionSession.test.ts`：保留的关闭回调不会关闭查询和位置完全相同的重开会话，也不会关闭直接切换到的另一处触发会话；当前会话的退出仍能移除装饰且不修改文档。
- Regression — `src/renderer/components/composer/variants/chat/__tests__/useNoteReferenceMentionItems.lifecycle.test.tsx`：通过模拟 IPC 验证真实目录 hook 的释放、重开后的新结果、取消、延迟目录清理，以及同批次重开。
- Regression — `src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx` 和 `src/renderer/components/composer/tools/definitions/__tests__/noteReferenceTool.test.tsx`：Notes 提及和既有引用工具保留附件流程。
- Regression — `src/main/utils/__tests__/notesDirectory.test.ts`、`src/main/ipc/handlers/__tests__/file.test.ts` 和 `src/renderer/services/__tests__/NotesService.test.ts`：配置目录限制与回退仍由不同传输入口共用。
