# Cursor：Review PR #17346（修复后，最终 v2）

> P1-1/P2-1/P1-2 你刚修 + P2-3 Claude 修（去 A1 Co-authored-by + 重签 A1/A2）。再 review 一遍：验证修复正确 + 没引入新问题 + 整体回归。**fresh 看，别因自己修的就放松**。

## PR
- head `dfeeb8f314`，base `feat/backup-v2-restore-contracts`
- `git diff feat/backup-v2-restore-contracts...HEAD`

## 重点验证（你修的 + Claude 修的）
1. **P1-1 非空 fixture**（`BackupService.restore.test.ts`）：`toSkip` 真钉死 `plan.skips`（非 `toRestore`）？`mockResolvedValueOnce` 不污染其他 case？
2. **P1-2 spine e2e**（`restore.full.resources.test.ts`）：跑真实 `new ImportOrchestrator(makeDeps())`，断言 `result.plan` + `journal.fileResources === plan.resources` + **无 skips 字段**？`makeDeps` 真实（非 stub 掩盖）？文件头/todo 更新？
3. **P2-1 顶栏注释**：broadcast-then-wait，与 startRestore JSDoc 一致？
4. **P2-3**（Claude 修）：`git log --format='%B' 1a6e5fda75..HEAD | grep -i co-authored` 无命中；A1/A2 有 gpgsig（`git cat-file commit <hash> | grep gpgsig`）
5. **整体回归**：修复没破坏 A3 接线（broadcast 喂 plan）？没破坏 sealed quiesce？

## 输出
- 本地报告 `v2-refactor-temp/docs/backup/cursor-pr17346-review-v2.md`（区别上一版）
- P0/P1/P2，每条 file:line + 问题 + 修法
- 不 post comment

## 约束
- review-only，不改代码
- 无 Co-authored-by

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "PR17346 review-v2 done: <P0数/P1数/P2数>" --enter
```
