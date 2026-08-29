# Cursor 实施任务：vaayne 第二轮 re-review 4 issues

> 连贯任务，4 个一起修。**完成后必须 orca send 到 GLM terminal（见末尾，不走收件箱）。**

## 工作目录

`cd /Users/gd32/Coding/CherryV2`（主仓 `feat/backup-v2-restore` @ `85893e4449`）。**不是你的 backup-cs-audit 工作树**。GLM 已暂停改 src，你独占主仓。

## 背景

vaayne 第二轮 re-review（2026-07-23T09:26）提 4 issues（前 4 个 A7/A3/entity_tag/packaged-gate 已通过）。inline 已给 file:line + 修复方向，照着修。

## 4 issues（按序）

1. **[Blocker] ordinary restore 仍能恢复 Full archive**（`BasicDataSettings.tsx:217`）
   - packaged Full gate 已禁，但 Lite-gated Restore 按钮开同一个 `RestoreV2Popup`，popup 不查 manifest，`BackupService.startRestore` 仍 `stageFileResources=[]` → Full archive 被普通路径 DB-only 恢复（无 blob），违背 breaking-change doc。
   - **修复**：`startRestore`（或 admitArchive 后）读 manifest `preset === 'full'` → 拒绝（resource staging 未完成，用 `BACKUP_RESTORE_FULL_NOT_SUPPORTED` 或类似 IPC code）。确保 ordinary + packaged 两路径都拦。

2. **[Blocker] `platformSpecificKeys` 声明却 restore 没用**（`backupContributorPreferences.ts:80`）
   - 声明 + finalize 测试存在，但 `MergeEngine.scanAggregates` 导入 preference 没过滤 → fresh target backfill 源机器的 `feature.notes.path` / OS shortcuts，违背架构 §6.1。
   - **修复**：restore merge 前按 `platformSpecificKeys` 过滤（skip matching preference keys，不 backfill 到目标）。

3. **[Warning] Lite restore 导入 dangling Notes overlays**（`backupContributorPreferences.ts:85`）
   - Lite archive 无 Notes body，但 `note` 行在 backup.sqlite，MergeEngine 照导入 → starred/expanded overlays 指向不存在文件，违背 §3.5。
   - **修复**：Lite restore strip/skip 所有 `note` 行（lite stages zero note bodies）。加 e2e 断言无 dangling overlay。

4. **[Warning] export UI 没传 overwrite**（`BackupExportV2Popup.tsx:133`）
   - `useBackupV2.startBackup` 第 3 参 default false；save dialog 选已存在 + 确认替换仍 `BACKUP_OUTPUT_PATH_EXISTS`（dd4eaf7bea 修的 use case 又坏了）。
   - **修复**：`BackupExportV2Popup` save dialog 检测目标已存在 → 弹确认覆盖 → `startBackup(preset, path, overwrite=true)`（保留 main 的 path/TOCTOU guard）。

## 约束

- 只改主仓 feat `src/` + 测试 + breaking-changes（如需）。
- 对照 inline file:line + 修复方向；不偏离。
- **不要用控制字符正则**（oxlint `no-control-regex` 在 `--deny-warnings` 下 fail）——strip control 用 charCode filter。
- 不碰 packaged-full 长期 resource staging（仍后续）。

## 测试

- 若 better-sqlite3 报 NODE_MODULE_VERSION 不匹配：`pnpm rebuild better-sqlite3`
- `pnpm vitest run src/main/services/backup src/main/data/db/backup src/main/data/services/backupContributor src/renderer/pages/settings/DataSettings/__tests__`（全绿）
- `pnpm lint`（typecheck node/web/aicore + i18n + biome）
- 为 4 修复补单测

## Commit

- `git commit --signoff --no-verify`，分 logical commits 或一个；subject conventional + `backup` scope，英文 ≤50 char。
- **不要 push**（等 GLM 审）。

## ⚠️ 完成后必须反向通知 GLM（不走 orca 收件箱）

完成（commit 后）**立即**执行（直接发到 GLM terminal，不是 orchestration 收件箱）：

```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "vaayne-new4 done: <commit hashes>, tests green, lint green" --enter
```

GLM 收到后会 review 你的 commit。

## 参考

- vaayne inline：PR #17206 review comments（`gh api repos/CherryHQ/cherry-studio/pulls/17206/comments`，09:26 那 4 条）
- 架构：`docs/references/backup/backup-architecture.md` §6.1 / §3.5
- breaking-changes：`v2-refactor-temp/docs/breaking-changes/`
