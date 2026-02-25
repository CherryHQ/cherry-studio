# Code Review: PR #13030 — refactor(backup): enhance backup functionality with direct backup and legacy backup support

**PR:** https://github.com/CherryHQ/cherry-studio/pull/13030
**Author:** kangfenmao
**Branch:** `refactor/backup-v6` → `main`
**Scope:** +1,738 / −1,150 across 27 files

---

## Summary

This PR introduces a new "direct backup" mechanism (version 6) that copies IndexedDB and Local Storage directories directly instead of serializing them to JSON. The old JSON-based approach is preserved as "legacy backup" for LAN transfer and backward compatibility. Additional changes include:

- Renaming `deleteTempBackup` → `deleteLanTransferBackup` (IPC channel + method)
- Extracting `BasicDataSettings` from the monolithic `DataSettings.tsx`
- Moving Joplin/Siyuan icons into `SVGIcon.tsx`
- Deleting `lifecycle.ts` (`closeAllDataConnections`) — replaced by Windows `.restore` suffix strategy
- Adding `handleStartupRestore()` to process `.restore` directories on app launch
- New `resetData()` method with Windows-aware logic

---

## Architecture Assessment

The core design decision — copying LevelDB/IndexedDB files directly rather than serializing via Dexie — is sound for performance. The dual-format detection (metadata.json presence = v6, otherwise legacy) is clean.

The Windows `.restore` suffix strategy (rename-on-restart to avoid EBUSY) is a practical solution to locked file handles.

---

## Critical Issues

### 1. Race condition in `restoreDirect` — data loss risk on non-Windows platforms

**File:** `src/main/services/BackupManager.ts` — `restoreDirect()`

On macOS/Linux (`restoreSuffix = ''`), the method directly removes and replaces IndexedDB/Local Storage directories **while the app is running**. The old `closeAllDataConnections()` call was removed (lifecycle.ts deleted), meaning active database connections may still hold file handles during the `fs.remove()` + `fs.copy()` sequence. While this is immediately followed by `app.relaunch() / app.exit(0)`, there's a window where:
- Chromium's IndexedDB engine may be writing to files being deleted
- A crash between `fs.remove()` and `fs.copy()` completion would leave the user with no data

**Recommendation:** Either restore `closeAllDataConnections()` for non-Windows platforms before the destructive operations, or adopt the `.restore` suffix approach universally (not just Windows).

### 2. `restore()` calls `fs.remove(this.tempDir)` then `restoreDirect()` re-creates it

**File:** `src/main/services/BackupManager.ts` — `restore()` lines near:
```typescript
await fs.remove(this.tempDir).catch(() => {}) // Clean up before restoreDirect creates its own temp
await this.restoreDirect(backupPath)
```

The `restore()` method extracts the ZIP to `this.tempDir`, checks for `metadata.json`, then removes `this.tempDir` before calling `restoreDirect()`, which re-extracts the same ZIP to `this.tempDir` again. This is wasteful — extracting the ZIP twice for direct backups. Consider passing the already-extracted temp directory path to `restoreDirect()` instead.

### 3. `resetData()` — inconsistent behavior between platforms

**File:** `src/main/services/BackupManager.ts` — `resetData()`

```typescript
public async resetData() {
  if (!isWin) {
    return await fs.remove(getDataPath()).catch(() => {})
  }
  const dataRestorePath = getDataPath() + '.restore'
  await fs.remove(dataRestorePath).catch(() => {})
  await fs.ensureDir(dataRestorePath)
}
```

On non-Windows: removes the Data directory immediately. On Windows: creates an empty `.restore` directory that gets swapped in on next startup. But `handleStartupRestore()` only handles `Data.restore` if it **exists** — the empty directory will replace the real Data directory, effectively wiping all data. This is correct for a reset, but on non-Windows, `closeAllDataConnections()` is no longer called before `fs.remove()`, which may cause EBUSY-like issues if the knowledge base or file watchers hold handles.

---

## Significant Issues

### 4. `handleStartupRestore()` silently swallows errors per directory

```typescript
await fs.remove(indexedDBDest).catch(() => {})
await fs.rename(indexedDBRestore, indexedDBDest)
```

If `fs.remove` fails silently and `fs.rename` then fails because the target still exists, the restoration will throw at the rename step. The catch-all at the bottom logs the error but doesn't clean up the `.restore` directories, meaning the next startup will attempt the same failed restore again (infinite loop on every restart).

**Recommendation:** Add cleanup of `.restore` files in the catch block to prevent retry loops.

### 5. Backup API signature change is a breaking change for preload consumers

**File:** `src/preload/index.ts`

The `backup()` signature changed from:
```typescript
backup(filename, content, path, skipBackupFile) // old: 4 params, includes content (JSON string)
```
to:
```typescript
backup(fileName, destinationPath, skipBackupFile) // new: 3 params, no content
```

And `backupToWebdav` changed from `(data, webdavConfig)` to `(webdavConfig)`. These are breaking changes to the preload API. If any external code or tests depend on these signatures, they will break silently (wrong arguments passed to wrong parameters).

### 6. `backupToS3` and `backupToWebdav` don't clean up temp files on `this.backup()` failure

In `backupToS3()`:
```typescript
const backupedFilePath = await this.backup(_, filename, undefined, s3Config.skipBackupFile)
```
If `this.backup()` throws, `backupedFilePath` is never assigned, so the catch block's `fs.remove(backupedFilePath)` will attempt to remove `undefined`, which silently fails. But the internal `this.tempDir` may have leftover files that are never cleaned up. The `backup()` method does clean up on failure, so this is mitigated, but the pattern is fragile.

### 7. `restoreLegacy()` on Windows writes to `Data.restore` but never triggers a relaunch

The legacy restore writes to `getDataPath() + '.restore'` on Windows, but unlike `restoreDirect()`, it doesn't call `app.relaunch()` / `app.exit(0)`. The caller (`BackupService.ts` in renderer) handles the data via `handleData()`, but the Data directory swap only happens at next startup via `handleStartupRestore()`. This means the restored IndexedDB data from the JSON (processed client-side) may be inconsistent with the Data directory that hasn't been swapped yet.

---

## Minor Issues

### 8. Typo in comment

**File:** `src/main/services/BackupManager.ts` — `restoreDirect()`:
```typescript
// IndexedDB & Local Storag Path
```
Should be "Local Storage Path".

### 9. Typo in variable name

**File:** `src/renderer/src/components/Popups/BackupPopup.tsx`:
```typescript
const isLanTransfterMode = backupType === 'lan-transfer'
```
`isLanTransfterMode` → `isLanTransferMode`

### 10. `getBackupData()` is still exported but no longer used by backup/S3/WebDAV/local flows

**File:** `src/renderer/src/services/BackupService.ts`

The function is still exported and used only by `backupToLanTransfer()` and Nutstore. The import was removed from `NutstoreService.ts`. Verify whether `getBackupData` is still needed anywhere — if only for LAN transfer, consider documenting this clearly.

### 11. Comment says "Step 2" but there's no "Step 1" in `backup()`

In the direct `backup()` method, the comment says `// Step 2: Copy IndexedDB and Local Storage directories` but there is no Step 1 comment. Minor, but inconsistent.

### 12. Chinese comments remain in `BasicDataSettings.tsx`

The newly extracted `BasicDataSettings.tsx` still contains Chinese comments:
```typescript
// 显示确认迁移的对话框
// 显示进度模态框
// 开始迁移数据
```
These were carried over from the original `DataSettings.tsx`. Consider translating to English for consistency with the rest of the refactored code.

### 13. `NutstoreService.ts` — removed `getBackupData` import but still calls `backupToWebdav` with new signature

The change correctly updates the call from `backupToWebdav(backupData, {...})` to `backupToWebdav({...})`, and correctly removes the `getBackupData` import. This is fine.

---

## Test Coverage Assessment

The test file was renamed from `BackupManager.deleteTempBackup.test.ts` to `BackupManager.test.ts`, and all references to `deleteTempBackup` were updated to `deleteLanTransferBackup`. The 27 security test cases for path traversal remain comprehensive.

However, there are **no tests** for:
- `handleStartupRestore()` — the critical startup restoration logic
- `restoreDirect()` — the new direct restore path
- `backup()` (new direct backup) — the core new feature
- `restoreLegacy()` — the extracted legacy restore
- `resetData()` — the new reset method with platform-specific behavior
- `createDirectBackupMetadata()` — metadata creation

Given that this is a data-critical path (backup/restore), the lack of tests for the new functionality is concerning.

---

## Positive Aspects

1. **Performance improvement** — Direct file copy avoids JSON serialization overhead for large databases
2. **Clean backward compatibility** — Automatic format detection via metadata.json presence
3. **Good component extraction** — `BasicDataSettings.tsx` separation reduces the monolithic DataSettings
4. **Icon consolidation** — Moving Joplin/Siyuan icons to `SVGIcon.tsx` follows existing patterns
5. **Improved comments** — Chinese comments translated to English in BackupManager.ts
6. **Good JSDoc documentation** — New methods have proper documentation
7. **Sensible compression level** — Using `zlib: { level: 0 }` for direct backups since LevelDB data is already compressed

---

## Verdict

**Request Changes.** The PR introduces a valuable performance optimization, but the critical issues around data safety during restore on non-Windows platforms (Issue #1), the double ZIP extraction (Issue #2), and the lack of test coverage for new backup/restore paths need to be addressed before merging. Issues #4 and #7 also warrant attention for production reliability.
