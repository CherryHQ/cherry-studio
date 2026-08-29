# Cursor：实现 A2 — spine 改线（同 PR #17346，feat/backup-v2-full-restore-a1 追加）

> 在 `feat/backup-v2-full-restore-a1` 追加 A2 commit（同 PR #17346，已 draft）。基于 A1（`planResources` 已就位）。**原子 commit**：spine 改线 + MergeEngine + admitArchive + 测试夹具必须同 commit，否则中间态 dangling。

## 必读
- **A1（已就位）**：`src/main/services/backup/resourcePlanning.ts`（`planResources` + `assertFullManifestInvariants`）
- **契约**：`resourcePlanning.ts`（ResourcePlan/PlanCtx）+ `merge/types.ts`（MergeContext `skippedKnowledgeBaseIds`/`skippedSkillFolderNames` optional）+ `shared/types/backup.ts`（RestoreResultSummary）
- **计划**：`v2-refactor-temp/docs/backup/full-restore-plan.md` §10.2
- **评审修法**：`v2-refactor-temp/docs/backup/cursor-a1-a2-review.md`（P0-4 时序 / P1-4 原子 / P1-5 删 journal-skips / P1-6 admit assertFull）

## A2 范围（核心 spine；KB 索引重建/UI 是 B 外围，不在 A2）

### ImportOrchestrator spine（src/main/services/backup/ImportOrchestrator.ts）
时序（P0-4）：`createSnapshot`(L173) → **`planResources`（merge 前，只读开 work.sqlite，finally close）** → `new Database(workPath)` 写连接(L180) → merge（消费 plan 集合）→ seal → `journal.fileResources = plan.resources`（删 stageFileResources stub L234）。

- 新 dep `planResources: (ctx: PlanCtx) => ResourcePlan`（merge 前调）
- MergeContext 构造（L190-198）喂真实集合：`skippedFileEntryIds`/`stagedFileEntryIds`/`skippedKnowledgeBaseIds`/`skippedSkillFolderNames` 来自 plan
- **includeFiles 对齐（P0-3）**：MergeContext.includeFiles 与 planning 门控一致（A1 用 `presetIncludesFiles(preset)`；merge 用 includeFiles 跳 notes overlay）。单测覆盖 full + 零 files + 有 notes（不分裂）
- **删 journal-skips 误述（P1-5）**：journal 仅 `fileResources`；skips 走 `RestoreResultSummary`（relaunch 前弹窗，B4 范围，A2 只保证内存 plan.skips 可取到）

### MergeEngine（src/main/services/backup/merge/MergeEngine.ts）
skip 逻辑（L435）扩全 class：
```ts
const skippedBlob =
  (agg.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))) ||
  (agg.root === 'knowledge_base' && ctx.skippedKnowledgeBaseIds?.has(String(backupPrimaryKey[0]))) ||
  (agg.root === 'agent_global_skill' && ctx.skippedSkillFolderNames?.has(String(backupRow['folder_name'])))
```
**skills 用 `backupRow['folder_name']`（identity），不是 backupPrimaryKey[0]（id）**。

### BackupService（src/main/services/backup/BackupService.ts）
- 注入 `planResources` dep + roots（filesRoot=`feature.files.data`/knowledgeRoot=`feature.knowledgebase.data`/skillsRoot=`feature.agents.skills`/notesRoot=`resolveNotesRoot()`）
- admitArchive wrapper（L389）：删 `preset==='full'` 拒绝 + **admit 必调 `assertFullManifestInvariants`**（P1-6，对称 lite）
- stageFileResources stub（L434）删（spine 用 plan.resources）

### 原子 commit 检查表（P1-4，缺一即红）
ImportOrchestrator 时序 / BackupService admit 去 full gate + planResources 注入 / MergeEngine skip 扩 / 所有测试里 `stageFileResources: async () => []` 与空集合 MergeContext 夹具改 / BackupService full 拒绝用例翻转 —— **同 commit**。

### e2e restore.full（spine 验证）
planning→merge 一致（skippedFileEntryIds 生效→file_entry 行未导入）/ DB SKIP 与资源决策一致 / 缺失·错类型·external→ARCHIVE_CORRUPT / full 伪造→admission 拒 / add 目标出现→clean expire（assertNoAddConflicts）/ skills skip 用 folder_name。**KB 索引重建 enqueue（B2）/ UI Full gate（B1）/ 弹窗（B4）不在 A2**。

## 约束
- 分支 `feat/backup-v2-full-restore-a1`（追加 commit，同 PR #17346 draft）
- 原子 commit；无 Co-authored-by；`--signoff --no-verify`
- 验证：`pnpm typecheck` + `pnpm vitest run src/main/services/backup` + `pnpm lint`

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "A2 done: <hash>, spine+merge+admit atomic, e2e green, no co-author" --enter
```
