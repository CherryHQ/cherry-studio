# Agent Note: 文件编辑写入去除回执，变更不再被已搁置会话阻止

Status: implemented

[English](2026-10-25-file-edit-unblocked-writes.md) | 中文

## 问题

源自[独立生命周期提案](../../proposed/architecture/2026-10-23-independent-file-edit-lifecycle.md)的文件编辑运行时承担了两项没有对应故障的成本。其一，`EditWriteLedger`、`file.edit.settle_write` 和 Renderer 的结果未知状态用于防范提交后写入回复丢失。`ipcApi` 没有请求超时，只有进程退出才会丢失回复，而此时负责确认结果的 Renderer 状态也已不存在。其二，`prepareMutation()` 刷写全部保留会话，并在首个失败处中止。因此一个处于冲突或保存失败状态的文件会阻止窗口内所有重命名、移动和删除，正如[冲突对话框修复](2026-10-25-conflict-dialog-resolution.md)所观察到的。

## 决策

`file.edit.write` 接收 `{ editId, expected, data }`，返回新基线和 `metadataRecoveryPending`，失败时抛出 `IpcError`。移除写入账本、结果确认路由、写入序号和 `outcomeUnknown`。Main 释放租约前仍等待进行中的读写完成。Renderer 的会话级队列保证写入顺序。未收到回复的已提交写入在重试时遇到 `STALE_VERSION`，发现磁盘已是自身字节后将其视为已保存。

`prepareMutation()` 仍封闭全部会话，但只刷写尚未处于冲突或保存失败状态的会话。已搁置的会话在恢复界面保留草稿；变更继续执行，`finish()` 照旧重新验证挂载中的会话。准备期间新出现的刷写失败仍会取消该操作。

## 备选方案

- 只刷写被变更路径下的会话：与提案一致地否决，因为这需要跨 entry 句柄、符号链接和大小写不敏感文件系统的别名感知路径匹配。
- 准备期间忽略所有刷写失败：否决，因为准备时才发现的失败是文件移动前用户能够处理它的最后时机。
- 回滚会话运行时：否决，因为这会恢复跨文件覆盖问题并失去草稿保留。

## 后果

自身文件被重命名或删除的已搁置草稿在 `finish()` 后不可写入；它通过复制或丢弃保持可恢复，而不是阻止操作。若进程在提交后退出，下一个会话照常从磁盘读取文件。如果 Renderer 缺陷对同一租约发出并发写入，条件写入会返回 `STALE_VERSION`，而不是序号错误。

## 验证

- 回归 — `pnpm test:renderer src/renderer/services/fileEdit/__tests__/FileEditSessionManager.test.ts`：已分离的冲突会话不再阻止 `prepareMutation()`，另一文件的草稿得以刷写；移除已搁置会话过滤后该测试失败。回复丢失的已提交写入在下次刷写时被视为已保存，不产生误报冲突。
- 回归 — `pnpm test:main src/main/services/file/__tests__/FileEditService.test.ts`：去除账本后，条件写入、目标改指向、entry/path 写入竞争、元数据恢复和租约关闭时的排空仍满足契约。
