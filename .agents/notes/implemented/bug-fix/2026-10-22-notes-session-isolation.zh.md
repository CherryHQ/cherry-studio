# Agent Note: 笔记会话隔离与静默加载快照

Status: implemented

[English](2026-10-22-notes-session-isolation.md) | 中文

## Problem

从 B 重新打开已缓存的笔记 A 时，在 `useFileEditSession` 采用 A 的快照之前，页面可能以 A 的身份渲染 B 的草稿。编辑回调通过当前模型引用写入，因此携带 B 正文的回调可能修改 A。实时读取的 `RichEditor.getMarkdown()` 让这个问题无需输入就能触发：Markdown 序列化可能把 `__bold__` 转成 `**bold**`，导致页面的字符串比较触发 `setMarkdown`。这个加载快照的方法会发出正文变更回调并安排自动保存。A 的磁盘版本仍然有效，无法检测替换正文实际来自 B。

## Decision

只有已采用的模型与请求的文件键匹配时，才暴露就绪会话及其正文。将 `setDraft` 绑定到已采用的模型实例，并在该实例脱离后拒绝其回调，包括重新打开相同路径的情况。保留离开模型原有的串行最终保存行为。

使用 Tiptap 的 `emitUpdate: false` 加载富文本编辑器快照，不发出使用方的正文变更回调。真实编辑继续通知使用方。保留实时 Markdown getter，使编辑命令后的立即读取仍能获得最新正文。

## Alternatives considered

- 回退 getter 会掩盖这个触发条件，但会恢复立即读取到旧正文的问题，且会话归属仍不安全。
- 仅设置编辑器 key，会用会话提供的旧草稿重新挂载编辑器。
- 磁盘版本检查防止外部文件变更，无法识别被归到错误会话的正文。

## Consequences

切换文件时，即使目标快照已缓存，也可能短暂显示加载状态。旧编辑器的回调不能修改较新的会话。`setMarkdown` 是静默加载快照的 API；需要编辑正文的使用方应调用编辑命令。无需变更持久化格式或执行迁移。

[文件编辑生命周期提案](../../proposed/architecture/2026-10-22-file-edit-session-lifecycle.md) 定义异步完成、会话保留、编辑器模式和关闭协调的完整目标。本记录仅描述局部覆盖修复；其验证不代表该提议生命周期已通过验收。

## Verification

- Regression — `src/renderer/hooks/__tests__/useFileEditSession.switching.test.tsx`：缓存 A→B→A 切换不会暴露其他文件的就绪草稿；已脱离的回调不能写入 B 或重新打开的 A，而当前回调仍可保存。
- Regression — `src/renderer/components/RichEditor/__tests__/RichEditor.test.tsx`：加载序列化写法不同的 Markdown 不发出编辑回调；随后聚焦编辑仍报告正文，立即读取仍能获得最新正文。
- Regression — 本地 Electron 验证：A 为 150006 字符，B 包含 `__BRAVO other note__`，修复前 A→B→A 无需输入就会覆盖 A；修复后两个文件及 A 的修改时间均保持不变，编辑 A 仅保存 A。这是本地 macOS 证据，不代表安装包或 Windows 验收。
