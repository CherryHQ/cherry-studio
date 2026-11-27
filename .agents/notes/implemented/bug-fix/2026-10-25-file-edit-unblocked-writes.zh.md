# Agent Note: 文件编辑去除写入回执、已搁置会话阻塞和离开提示

Status: implemented

[English](2026-10-25-file-edit-unblocked-writes.md) | 中文

## 问题

源自[独立生命周期提案](../../proposed/architecture/2026-10-23-independent-file-edit-lifecycle.md)的文件编辑运行时承担了两项没有对应故障的成本。其一，`EditWriteLedger`、`file.edit.settle_write` 和 Renderer 的结果未知状态用于防范提交后写入回复丢失。`ipcApi` 没有请求超时，只有进程退出才会丢失回复，而此时负责确认结果的 Renderer 状态也已不存在。其二，`prepareMutation()` 刷写全部保留会话，并在首个失败处中止。因此一个处于冲突或保存失败状态的文件会阻止窗口内所有重命名、移动和删除，正如[冲突对话框修复](2026-10-25-conflict-dialog-resolution.md)所观察到的。其三，笔记和 Agent 产物面板在会话为脏时即询问是否放弃，而 800 ms 自动保存防抖期间会话也为脏，因此输入后立即切换总会弹出提示。该守卫早于会话保留机制，当时离开视图会丢失草稿。

## 决策

`file.edit.write` 接收 `{ editId, expected, data }`，返回新基线和 `metadataRecoveryPending`，失败时抛出 `IpcError`。移除写入账本、结果确认路由、写入序号和 `outcomeUnknown`。Main 释放租约前仍等待进行中的读写完成。Renderer 的会话级队列保证写入顺序。未收到回复的已提交写入在重试时遇到 `STALE_VERSION`，发现磁盘已是自身字节后将其视为已保存。

`prepareMutation()` 仍封闭全部会话，但只刷写尚未处于冲突或保存失败状态的会话。已搁置的会话在恢复界面保留草稿；变更继续执行，`finish()` 照旧重新验证挂载中的会话。准备期间新出现的刷写失败仍会取消该操作。

笔记立即切换，由保留会话在分离时保存。输入法组合输入结束前保持当前编辑器挂载。后台保存中的草稿不会触发失败提示。失败草稿可重新打开、复制、重试或明确放弃；冲突笔记重新打开后处理冲突，不提供无法成功的普通重试。窗口组装层在标签页 Provider 内提供笔记专属的重新打开操作；共享恢复界面只负责通用草稿操作。Agent 产物面板也会立即导航，由保留的会话继续保存。保存完成不会执行导航或弹出离开确认框；保存失败的草稿可通过窗口恢复界面处理，也可返回原会话和文件并进入编辑模式恢复。

## 备选方案

- 只刷写被变更路径下的会话：与提案一致地否决，因为这需要跨 entry 句柄、符号链接和大小写不敏感文件系统的别名感知路径匹配。
- 准备期间忽略所有刷写失败：否决，因为准备时才发现的失败是文件移动前用户能够处理它的最后时机。
- 每次导航前先保存：拒绝，因为它把持久化绑定到可能过时的目标，包括绕过文件保护的同工作区会话导航。
- 回滚会话运行时：否决，因为这会恢复跨文件覆盖问题并失去草稿保留。

## 后果

自身文件被重命名或删除的已搁置草稿在 `finish()` 后不可写入；它通过复制或丢弃保持可恢复，而不是阻止操作。若进程在提交后退出，下一个会话照常从磁盘读取文件。如果 Renderer 缺陷对同一租约发出并发写入，条件写入会返回 `STALE_VERSION`，而不是序号错误。

## 验证

- 回归 — `pnpm test:renderer src/renderer/services/fileEdit/__tests__/FileEditSessionManager.test.ts`：已分离的冲突会话不再阻止 `prepareMutation()`，另一文件的草稿得以刷写；移除已搁置会话过滤后该测试失败。回复丢失的已提交写入在下次刷写时被视为已保存，不产生误报冲突。
- 回归 — `pnpm test:renderer src/renderer/pages/notes/__tests__/NotesPage.test.tsx src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`：笔记切换不等待进行中或失败的保存，也不丢弃草稿；组合输入期间延迟导航，当前文件被删除时保留草稿。Agent 面板在保存等待或失败时也会立即切换文件和工作区，不丢弃草稿。
- 回归 — `pnpm test:main src/main/services/file/__tests__/FileEditService.test.ts`：去除账本后，条件写入、目标改指向、entry/path 写入竞争、元数据恢复和租约关闭时的排空仍满足契约。

- 回归 — `pnpm test:renderer src/renderer/windows/__tests__/WindowFileEditRecovery.test.tsx`：后台保存中不显示失败提示；失败草稿可重试，放弃需确认；冲突可重新打开原笔记且不覆盖外部内容。
