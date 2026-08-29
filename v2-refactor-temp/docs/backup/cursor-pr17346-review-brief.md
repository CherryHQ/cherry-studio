# Cursor：Review PR #17346（A 系列：A1 + A2 + A3 接线）

> 这是**我们自己**的 PR。你之前实现了 A1/A2；**A3 接线 + rebase 合并 disclosure 是 Claude 做的**（你没参与）。严格 review，重点查 A3 接线 + rebase 合并（Claude 做的部分），并复核你自己做的 A1/A2（不要因自己做的就放松）。输出本地报告，不 post comment。

## PR
- https://github.com/CherryHQ/cherry-studio/pull/17346
- head `1794cf6dfb`，base `feat/backup-v2-restore-contracts`（含 disclosure UI + relaunch gate）
- A1 `8458e3e26f`（planResources）+ A2 `1794cf6dfb`（spine + merge + A3 接线 + 测试）
- 先 `git fetch origin && git checkout feat/backup-v2-full-restore-a1`（本地已是 1794cf6dfb）
- 看 diff：`git diff feat/backup-v2-restore-contracts...HEAD`（= A1+A2+A3）

## 背景（谁做了什么）
- **A1（你做）**：`planResources` + `assertFullManifestInvariants`（resourcePlanning.ts）
- **A2（你做）**：spine 改线（planning 前置 merge）+ MergeEngine skip 扩（skill folder_name）+ admit 去 full gate + planResources 注入 + ImportBackupResult.plan
- **A3 接线（Claude 做，你没参与，重点查）**：rebase 到 disclosure head 后，`broadcastRestoreSummary` 改接 `summary` 参数 + `startRestore` 喂 `plan.toRestore`/`plan.skips` + `importBackup` 解构 `{ plan }`；丢掉 triggerRelaunch 对齐 disclosure 的 broadcast-then-wait
- **rebase 合并（Claude 做，重点查）**：BackupService.ts 把 A2（planResources/admit/roots）+ disclosure（sealed quiesce/broadcastRestoreSummary）auto-merge + 解 JSDoc 注释冲突

## review 维度
1. **A3 接线正确性**（Claude 做，重点）：
   - `broadcastRestoreSummary({ toRestore: plan.toRestore, toSkip: plan.skips })` 形状匹配 `RestoreResultSummary`（types/backup.ts）？
   - 丢 triggerRelaunch 后：sealed success → broadcast → 等 renderer `app.relaunch`，逻辑完整、无悬空？
   - `const { plan } = await importOrch.importBackup(...)` plan 取用正确？broadcast 在 sealed 之后、return 之前？
2. **rebase 合并一致性**（Claude 做，重点）：BackupService.ts 的 sealed quiesce（`let sealed` + finally `if(!sealed) releaseRestoreQuiesce`）+ broadcast-then-wait + A2 的 planResources/admit/roots 完整无丢失？
3. **复核 A1/A2**（你做，别放松）：
   - spine 时序（P0-4：planning 在 snapshot 后、写连接前；planning 自管只读 work.sqlite）
   - MergeEngine skill 用 `backupRow['folder_name']`（非 backupPrimaryKey[0] id）—— backupRow 来自 `SELECT *` 确有 folder_name？
   - includeFiles 对齐（planning + merge 都用 `presetIncludesFiles(preset)`，P0-3）
   - journal 不附 skips（P1-5，skips 走 ImportBackupResult.plan 内存）
   - admit assertFull（P1-6，assertFullManifestInvariants 在 admitArchive 内 unpack 前）
4. **测试覆盖深度**：315 pass，但要看 disclosure/relaunch 关键场景（broadcast 喂 plan / sealed quiesce 持有 / A3 接线 mock 是否真实，而非 stub 空 plan 掩盖问题）
5. **规范对照**：`docs/references/main-process-architecture.md` / `data/README.md` / `ipc/README.md` / `lifecycle/README.md`

## 输出
- 本地报告 `v2-refactor-temp/docs/backup/cursor-pr17346-review.md`
- findings 分 P0/P1/P2，每条 file:line + 问题 + 修法
- **特别标注 A3 接线/rebase 合并的疑点**（Claude 做的，最易出问题）
- 不 post comment（我们的 PR，自己看）

## 约束
- review-only，不改代码
- 无 Co-authored-by

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "PR17346 review done: <P0数/P1数/P2数>, 报告 v2-refactor-temp/docs/backup/cursor-pr17346-review.md" --enter
```
