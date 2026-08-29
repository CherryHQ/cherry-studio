# Cursor：codex review 4 findings 修复（round 1）

> 4 个已验证的 codex findings，连贯修。严守 backup 架构边界，不过度设计。完成后 orca send 到 term_6468b98a。

## 工作目录
主仓 `feat/backup-v2-restore` @ HEAD（4 个规范 commit 之上）。你已在。

## 4 findings（按序）

### 1. [critical] canonical path 未贯穿发布
`src/main/services/backup/BackupService.ts:796,833` + `startBackup:258,289,292`

**问题**：`validateOutputPath` 算了 `canonical`（L833）但返回 `void`；`startBackup` 继续用 raw `outputPath` 做 preflight + 传给 ExportOrchestrator 发布。含 symlink 的路径（`/safe/link/../live.db`）可校验为安全但 rename 解析到 managed 路径。

**修**：
- `validateOutputPath` 改 `return string`（返回 canonical = realpath 完全解析 symlink 后的绝对路径，用 `realpath` 而非只 `resolve`）
- `startBackup` 接 canonical，**贯穿** preflightDisk + ExportOrchestrator 发布（rename/link/copyFile 用 canonical，不再用 raw outputPath）
- 校验（managed-path 拦截、no-clobber existsSync）也用 canonical（已是）
- 保留错误 message 里的原 outputPath（用户可读）

### 2. [high] lite 不变量缺 domains 校验（补全 vaayne #1）
`src/main/services/backup/admitArchive.ts` — `assertLiteManifestInvariants`

**问题**：现只校验 resource 字段空，没校验 `manifest.domains`。重标签 full→lite + zero resource + 保留 full domains（14）可绕过，MergeEngine 按 manifest.domains 导入 excluded data。

**修**：`assertLiteManifestInvariants` 加 domains 校验：
- `preset === 'lite'` → `new Set(manifest.domains)` 必须 **精确等于** `resolvePreset('lite')` 的 set（即不含 `LITE_EXCLUDED` 的 10 个，来自 `presets.ts`）
- 拒重复 domain、拒 LITE_EXCLUDED 命中
- 违反 → `throw new IpcError(backupErrorCodes.RESTORE_LITE_INVARIANT_VIOLATED, ...)`
- 加测试：preset=lite 但 domains 含 KNOWLEDGE → reject

### 3. [medium] local-priority 语义错误（NOT NULL DEFAULT '[]' 列）
`src/main/services/backup/merge/MergeEngine.ts:899-906`

**问题**：`local-priority` 分支降级成 NULL-only（只在 local SQL NULL 时填 backup）。但语义该是 **local 非空赢，local 空填 backup**。`agent_global_skill.tags`（NOT NULL DEFAULT '[]'）local 永远非 null（空数组）→ backup 非空 tags 永远不恢复，无 degradation。

**修**：local-priority 分支改为：
```ts
} else if (policy.strategy === 'local-priority') {
  // local non-empty wins; local empty (null/''/[]/{}) fills from backup
  if (isEmptyForRemoteFill(localVal) && !isEmptyForRemoteFill(backupVal)) nextVal = backupVal
}
```
复用既有 `isEmptyForRemoteFill`（remote-fills-local-empty 已用）。加测试：local=[] backup=[tags] → backup；local=[a] backup=[b] → local；local=null backup=[tags] → backup。

### 4. [medium] publish 后 fsync 失败误报失败
`src/main/services/backup/archive.ts:174-225`

**问题**：rename/link/copyFile 成功（archive 已发布，overwrite 可能已替换旧文件）后，`fsyncParentDir(outPath)` 失败 → 进 catch → 报 export 失败。用户重试 no-clobber 撞已存在的 archive。

**修**：publish（rename/link/copyFile 成功）= commit point。之后的 fsync（`fsyncPath` for copy + `fsyncParentDir`）失败 → **log warn + 不 throw**（archive 已发布，durability 未满但不该报失败）。具体：把 publish 后的 fsync 用独立 try-catch 包，失败 `logger.warn('archive published but durability fsync failed', ...)` 不进外层 catch。保留 unlink(tmp) 清理。

## 约束
- 只改 backup 架构内（BackupService/admitArchive/MergeEngine/archive），不改架构边界
- 无 Co-authored-by，conventional + `backup` scope，分 logical commits，`--signoff --no-verify`
- **不 push**（等 GLM 审 + 迭代）
- 对照 `docs/references/backup/backup-architecture.md`（path 校验 §9、admission、merge、durability）

## 验证
- `pnpm vitest run src/main/services/backup`（绿，含新测试）
- `pnpm lint`（绿）
- grep 自检：`validateOutputPath` return string 且 startBackup 用其返回值；assertLiteManifestInvariants 含 domains 校验；local-priority 用 isEmptyForRemoteFill；archive publish 后 fsync 不报失败

## ⚠️ 反向通知
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "codex-r1 done: <hashes>, tests green, lint green, no co-author" --enter
```
