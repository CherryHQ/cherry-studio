# Cursor：CI fix 2（RestoreV2Popup test + _opts lint）

> f27288f291 后 CI 仍红 2 处（ci-fix 没全覆盖）。修 + commit（不 push）。完成 orca send term_6468b98a。

## 工作目录
主仓 `feat/backup-v2-restore` @ `f27288f291`。

## 2 个遗漏

### 1. basic-checks lint: `_opts` unused（oxlint --deny-warnings）
`Parameter '_opts' is declared but never used` —— 你 ci-fix 的 `BackupExportV2Popup.test.tsx` createPopup mock 第 2 参 `_opts`（适配新 API 接 opts 但 mock 没用）。
**修**：grep `_opts` 定位（应在 BackupExportV2Popup.test.tsx createPopup mock）。mock 改为只接 Component 第 1 参（JS 调用传 2 参时第 2 个被忽略，不需要声明），删 `_opts`。oxlint 不再报。

### 2. renderer-test (2/3): RestoreV2Popup.test.tsx 2 fail
- `returns to ready-with-error on reject and shows the code`
- `maps BACKUP_MERGE_STRATEGY_UNSUPPORTED to the SKIP-only copy`

**根因**：同 BackupExportV2Popup（rebase 后 createPopup 加 opts + IpcError，mock 旧）。你 ci-fix（f27288f291）修了 BackupExportV2Popup.test.tsx，**漏了 RestoreV2Popup.test.tsx**（同类）。

**修**：参考你对 BackupExportV2Popup.test.tsx 的 ci-fix 修法（f27288f291：`git show f27288f291 -- .../BackupExportV2Popup.test.tsx`），把同样的 createPopup mock 适配（接 opts / 不引 `_opts`）+ IpcError mock 套用到 `RestoreV2Popup.test.tsx`。别动组件 `RestoreV2Popup.tsx`。

## 约束
- 只改 2 个 test 文件（BackupExportV2Popup.test.tsx 删 `_opts` + RestoreV2Popup.test.tsx mock 适配），不动组件/核心
- 无 Co-authored-by，`fix(backup):` scope，`--signoff --no-verify`，不 push

## 验证
- `pnpm vitest run src/renderer/pages/settings/DataSettings/__tests__/RestoreV2Popup.test.tsx src/renderer/pages/settings/DataSettings/__tests__/BackupExportV2Popup.test.tsx`（全绿）
- `pnpm exec oxlint --deny-warnings src/renderer/pages/settings/DataSettings/__tests__`（无 `_opts` 警告）

## ⚠️ 反向通知
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "ci-fix2 done: <hash>, RestoreV2Popup green, oxlint green, no co-author" --enter
```
