# Cursor 实施任务：vaayne 第三轮 re-review 4 issues

> 连贯任务，4 个一起修。**完成后必须 orca send 到 GLM terminal（见末尾，不走收件箱）。**

## 工作目录

`cd /Users/gd32/Coding/CherryV2`（主仓 `feat/backup-v2-restore` @ `ded94d49ea`）。GLM 已暂停改 src，你独占主仓。

## 背景

vaayne 第三轮 re-review（2026-07-23T12:30 UTC）提 4 issues（前两轮 8 issues 已修）。inline 已给 file:line + 修复方向，照着修。核心：上轮 issue #1（`preset==='full'` reject）被他指出**可被重标签绕过**——archive untrusted + unsigned，Full 把 manifest `preset` 改写成 `'lite'` 就过 gate，仍丢资源。这轮要验证 **lite manifest 的语义不变量**，不只看 label。

## 4 issues（按序）

### 1. [Blocker] Lite gate 只信任 manifest label，可被重标签绕过
`src/main/services/backup/BackupService.ts:386`（上轮加的 admitArchive wrapper，`manifest.preset === 'full'` → reject）

**问题**：只查 `preset` 标签。archive 没签名、不可信，Full archive 把 `preset` 字段改写成 `'lite'` 就过这道 gate，然后用 Full domain set 驱动 ImportOrchestrator，而 `stageFileResources()` 仍返 `[]` → 资源照样丢。

**修复**：在 admission（`admitArchive.ts`）加 **lite 语义不变量校验**。`preset === 'lite'` 时必须满足全部：
- `includeFiles === false`
- `includeKnowledgeFiles === false`
- `files.ids.length === 0`（且 `files.total === 0`）
- `knowledge.bases.length === 0`
- `skills.folders.length === 0`
- `notes.paths.length === 0`

任一违反 → `throw new IpcError('BACKUP_RESTORE_LITE_INVARIANT_VIOLATED', ...)`（"backup: manifest claims lite but carries full resources — refusing restore"）。重标签 Full→lite 时 Full 的资源字段非空，此校验抓住。

依据（定义层，已核对）：
- `presets.ts`: `LITE_EXCLUDED = ['KNOWLEDGE','PAINTINGS','FILE_STORAGE','TRANSLATE_HISTORY']`；`presetIncludesFiles`/`presetIncludesKnowledge` 均 `preset === 'full'`
- `manifest.ts`: `files{ids,total,totalBytes}` / `knowledge{bases}` / `skills{folders}` / `notes{paths}`

放 admission 层（`admitArchive`）而非 BackupService wrapper——所有 restore 路径都过 admitArchive，且 e2e fixture 本就是合法 lite/full，不受影响。保留上轮 `preset==='full'` reject 作为快速路径（合法 full archive 直接拒，不必跑不变量）。

**测试**：加回归测试——构造 `preset:'lite'` 但 `files.ids` 非空（及 `includeFiles:true` 两个变体）的 manifest，断言 restore reject with `BACKUP_RESTORE_LITE_INVARIANT_VIOLATED`。

### 2. [Warning] archive 含明文凭证但用 umask 默认权限（0644）
`src/main/services/backup/archive.ts:111`（`createWriteStream(tmpPath)` 无 mode）

**问题**：POSIX umask 022 下 `createWriteStream` 创建 `0644`，archive 含明文 API key/credentials，其他本地用户可读。link/rename 保留该权限。UI 的 credentials_warning 不是 access control。

**修复**：`createWriteStream(tmpPath, { mode: 0o600 })`。确认所有发布分支保留 0600：
- rename（atomic overwrite 分支）：rename 保留 tmp 的 mode ✓
- link（no-clobber 分支）：link 保留 ✓
- 若有 copy 分支：`copyFile` 后显式 `chmod(dest, 0o600)`（copyFile 不保证保留源 mode）

**测试**：POSIX 权限回归测试——导出到 tmp，断言最终 archive 文件 mode 为 `0o600`（用 `stat().mode & 0o777`，skip on win32）。

### 3. [Warning] restore 文案说 replace，实际是 additive merge
`src/renderer/i18n/locales/en-us.json:5692`（`settings.data.backup.v2.restore.confirm_content`）

**问题**：现文案 `"Restoring will replace current data and relaunch the app. Continue?""` 说 replace，但 engine 实际是 additive merge（backfill missing + FIELD_MERGE natural-key + SKIP uuid，local-first）。误导用户同意一个实质不同的操作。

**修复**：改成实际 merge 语义，例如 `"Restoring will merge backup data into your current data (local non-empty values are kept), then relaunch the app. Continue?"`。**同步所有 locale**（`src/renderer/i18n/locales/{en-us,zh-cn}.json` + `src/renderer/i18n/translate/*.json`），en-us 为准。

### 4. [Nit] pick_prompt 还用旧 .cbu 扩展名
`src/renderer/i18n/locales/en-us.json:5696`（`settings.data.backup.v2.restore.pick_prompt`）

**问题**：`"Select a .cbu backup archive to restore."` 还写 `.cbu`，本 PR 已改 `.cherrybackup`。

**修复**：改成 `.cherrybackup`（dialog filter 已是 cherrybackup）。**同步所有 locale**。

## 约束

- 只改主仓 feat `src/` + 测试 + i18n。不碰 packaged-full 长期 resource staging（仍后续）。
- 对照 inline file:line + 修复方向；不偏离。
- **不要用控制字符正则**（oxlint `no-control-regex` 在 `--deny-warnings` 下 fail）——strip control 用 charCode filter（若有）。
- i18n 改完跑 `pnpm i18n:check`，失败先 `pnpm i18n:sync`。

## 测试

- 若 better-sqlite3 报 NODE_MODULE_VERSION 不匹配：`pnpm rebuild better-sqlite3`
- `pnpm vitest run src/main/services/backup src/main/data/db/backup src/renderer/pages/settings/DataSettings/__tests__`（全绿）
- `pnpm lint`（typecheck + i18n + biome + oxlint）

## Commit

- `git commit --signoff --no-verify`，分 logical commits 或一个；subject conventional + `backup` scope，英文 ≤50 char。
- **不要 push**（等 GLM 审）。

## ⚠️ 完成后必须反向通知 GLM（不走 orca 收件箱）

完成（commit 后）**立即**执行（直接发到 GLM terminal，不是 orchestration 收件箱）：

```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "vaayne-r3 done: <commit hashes>, tests green, lint green" --enter
```

GLM 收到后会 review 你的 commit。

## 参考

- vaayne 第三轮 inline：PR #17206 review 4764030642 的 4 条 comment（12:30 UTC）
- 定义层：`src/main/services/backup/presets.ts`、`src/main/services/backup/manifest.ts`
- 架构：`docs/references/backup/backup-architecture.md` §6.1（lite 边界）
