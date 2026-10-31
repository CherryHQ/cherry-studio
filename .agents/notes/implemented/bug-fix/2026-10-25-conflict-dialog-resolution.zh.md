# Agent Note: 关闭文件编辑冲突对话框后会话卡死

Status: implemented

[English](2026-10-25-conflict-dialog-resolution.md) | 中文

## 问题

笔记与 Agent 产物面板的外部修改冲突对话框中，"保留草稿"只是一个关闭动作：它关闭弹窗但不清除会话的 `conflict` 标志。`FileEditSessionManager.prepareMutation` 会 flush 全部留存会话并在首个失败处中止，因此一个未解决的冲突会让之后所有笔记的重命名/删除/移动失败，且 toast 把责任推给无关操作。由于该标志不再跳变，对话框也不会自行重开。

## 决策

不重载而关闭对话框现在会解决冲突：取消路径调用既有的 `keepDraft` 租约命令——采纳新的磁盘基线并重存草稿，清除冲突。确认路径保持重载行为，并用一个 ref 防止双重解决，因为 `ConfirmDialog` 在 `onConfirm` 结束后总会触发 `onOpenChange(false)`。当 keep 或 reload 本身失败时，对话框以响应式重开——effect 在 `conflict` 之外加入对 `saveError` 的依赖（每次失败都发布新的 Error），使未解决的冲突始终有可达的解决入口；而冲突已清除后的保存失败仍归普通保存失败横幅。两条关闭路径都在启动异步工作前同步敲定对话框状态，使组件的自动关闭永远不会在失败发布重置守卫之后才到达。

## 备选方案

- 仅在关闭时清除冲突、不重存：被否决——草稿会静默偏离新磁盘基线，下一次自动保存会命中同一个 stale-version 守卫。
- 在组件 catch 里重开对话框：被否决——闭包观察到的是过期快照，无法区分基线读取失败（冲突仍在）与冲突清除后的保存失败。
- 给 `ConfirmDialog` 增加 `onCancel` 回调：defer，作为 `@cherrystudio/ui` 契约变更应走独立 PR。

## 后果

被关闭的冲突现在会用保留的草稿覆盖外部版本，而不是静默暂停自动保存——这符合按钮文案与 SkillFileBrowser 参照实现。[后续修复](2026-10-25-file-edit-unblocked-writes.md)使已处于冲突或保存失败状态的会话不再阻止 `prepareMutation`。

## 验证

- 回归 — `pnpm test:renderer src/renderer/pages/notes/__tests__/NotesPage.test.tsx src/renderer/components/chat/panes/__tests__/ArtifactPane.test.tsx`：84 项测试通过，涵盖关闭保留草稿、重载不保留、两类失败重开。守卫变异验证过负向断言会翻转（出现多余 `keepDraft` 调用；多出一次 `file.edit.read`）。
- 回归 — 通过 CDP 的真实 Electron：修复后关闭冲突保留草稿且无关笔记重命名成功；修复前运行复现了带误导性失败 toast 的阻断重命名。
