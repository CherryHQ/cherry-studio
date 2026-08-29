# Cursor：CI fix（rebase 后 format + BackupExportV2Popup test）

> rebase 到 origin（另一位同学 + main merge）后 CI 红 2 处。修 + commit（不 push）。完成后 orca send 到 term_6468b98a。

## 工作目录
主仓 `feat/backup-v2-restore` @ `4b16defeeb`（刚 push 的）。working tree 已有 format 改动（GLM 跑了 pnpm format）。

## 2 个 CI 失败

### 1. basic-checks format（已修，在 working tree）
`pnpm format` 已改 2 文件（rebase 自动 merge 测试文件 format 乱）：
- `src/main/services/backup/__tests__/e2e/restore.lite.test.ts`
- `src/main/services/backup/merge/__tests__/MergeEngine.test.ts`
**确认这 2 文件 format OK**（`pnpm format:check` 绿），保留改动一起 commit。

### 2. renderer-test: BackupExportV2Popup.test.tsx 5 fail
CI renderer-test (3/3) fail：`BackupExportV2Popup.test.tsx` 5 个 test（overwrite confirm retry / cancel / failure / cancel export / **ignores late success after cancel timeout**）。
- 关键错误：`TypeError: resolveBackup is not a function`（L268）+ 多处 `waitFor` 超时
- **根因**：rebase 后 base（main merge）改了 `createPopup` API（加了 `opts: CreatePopupOptions<R>` 第二参 + single-flight `show()`）和/或 `useBackupV2`。本 test 的 mock（L63 `createPopup` mock + L31 `useBackupV2` mock）是旧 API，不兼容。

**修**：
1. 读当前 `src/renderer/services/popup/createPopup.ts` 签名（`createPopup(Component, opts)` + `PopupHandle.show()`）+ `src/renderer/hooks/useBackupV2.ts` 当前导出
2. 对照 test mock（`BackupExportV2Popup.test.tsx` L31 useBackupV2 mock、L63 createPopup mock），修 mock 适配新 API（createPopup 接 opts 第 2 参；show 返回 Promise；resolve 正确 propagate 使 `resolveBackup` 在 startBackupMock 回调内赋值）
3. 别动组件 `BackupExportV2Popup.tsx`（它没 fail，是 test mock 旧）
4. `pnpm vitest run src/renderer/pages/settings/DataSettings/__tests__/BackupExportV2Popup.test.tsx` 全绿

## 约束
- 只改 test mock（+ 保留 working tree 的 format 改动），不动组件/核心
- 无 Co-authored-by，`fix(backup):` scope，`--signoff --no-verify`
- commit 包含 format 2 文件 + test 修复
- **不 push**（等 GLM 审 + push）

## 验证
- `pnpm vitest run src/renderer/pages/settings/DataSettings/__tests__/BackupExportV2Popup.test.tsx`（5 fail → 全绿）
- `pnpm format:check`（绿）
- 最好 `pnpm vitest run src/renderer/pages/settings/DataSettings/__tests__`（全绿）

## ⚠️ 反向通知
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "ci-fix done: <hash>, BackupExportV2Popup green, format green, no co-author" --enter
```
