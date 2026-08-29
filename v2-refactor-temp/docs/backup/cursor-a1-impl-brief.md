# Cursor：实现 A1 — resource planning 模块

> 分支 `feat/backup-v2-full-restore-a1`（基于 `feat/backup-v2-restore-contracts`，含契约 PR #17340）。实现 `planResources`（纯函数）+ 单测。**不改 ImportOrchestrator / BackupService / restorePromotion / MergeEngine**（A2 范围）。

## 必读（实现依据）
- **契约**（已落地）：`src/main/services/backup/resourcePlanning.ts`（ResourcePlan/SkippedResource/PlanCtx/PlanRoots/AddFileResource）+ `src/shared/types/backup.ts`（ResourceClass/RestoreResultSummary）
- **计划骨架**：`v2-refactor-temp/docs/backup/full-restore-plan.md` §10.1
- **评审修法（必遵循）**：`v2-refactor-temp/docs/backup/cursor-a1-a2-review.md`
- **Claude 自审补充**（见下 skills key）

## A1 实现（planResources + assertFull + 类型校验，纯函数）

在 `resourcePlanning.ts` 加 `planResources(ctx: PlanCtx): ResourcePlan` + `assertFullManifestInvariants` + `assertStagingFile`/`assertStagingDir`（lstat）。遵循评审修法：

- **P0-1 A**：files 冲突 → `skippedFileEntryIds`；knowledge_base → `skippedKnowledgeBaseIds`（**存 baseId**）；skills → `skippedSkillFolderNames`（**存 folderName，不是 id**）。全 class 同源 merge skip。
- **⚠️ skills key（Claude 自审）**：`agent_global_skill` PK 是 id（uuid），但 folderName 是 unique identity。`skippedSkillFolderNames` 存 manifest 的 folderName；A2 MergeEngine 必须 `backupRow['folder_name']` 匹配（不是 backupPrimaryKey[0]=id）。A1 只负责产出 folderName 集合（来自 `manifest.skills.folders[].folderName`），A2 消费时注意。
- **P0-2**：`assertFullManifestInvariants` = `domains` 精确等于 `resolvePreset('full')` + 一致性（`includeFiles === files.ids.length>0`，`includeKnowledgeFiles === knowledge.bases.length>0`），**不强制 include\* 恒 true**（空附件库的合法 full 可 `includeFiles:false`）。skills/notes 列表去重 + schema 校验（folderName/baseId SafeName，notes relPath 拒 `..`）。
- **P0-3**：planning 门控用 `presetIncludesFiles(manifest.preset)`（merge 的 includeFiles 对齐是 A2）。
- **P1**：交叉校验双向（KB/skills 也查 backup DB → manifest 有 id 但 backup 无行 = CORRUPT）；notesRoot 缺失或全 userData 外 → 记 `skips`（reason: `no managed notesRoot` / `outside userData`）；`toPathResolvable` 钉死 internal（`origin==='internal'` 收窄再 `resolvePhysicalPath`）；`assertStagingFile`/`assertStagingDir` 用 **lstat 非 stat**（拒 symlink）；缺源/external/错类型/symlink → `ARCHIVE_CORRUPT`（抛错，不 skip）。
- `toRestore`：plan 时按 ResourceClass 算 count（不反推 resources）。

## A2 范围（不实现，仅标注）
spine 改线（planning 前置 merge）/ MergeEngine 读新集合（skills 用 folderName）/ includeFiles 对齐 / 删 full 拒绝 + admit assertFull 接线 / 时序。

## 单测（独立，mock 库，不碰 spine）
- files: 新建 blob-add / 冲突 skip（skippedFileEntryIds）/ external CORRUPT / 缺源 CORRUPT / symlink CORRUPT / 本地行存在 skip（workDb 同源）
- knowledge: 新建 dir-add / 冲突 skip（skippedKnowledgeBaseIds，baseId）
- skills: 新建 dir-add / 冲突 skip（skippedSkillFolderNames，**folderName**）
- notes: managed 新建 note-add / 冲突 skip / userData 外 skip + skips / notesRoot 缺失 skips
- toRestore 预计算正确（knowledge vs skill 分开计数）
- assertFull: full + includeFiles:false（空 files）合法 / domains 不匹配拒绝 / includeFiles 与资源数组不一致拒绝

## 约束
- 分支 `feat/backup-v2-full-restore-a1`（已由 Claude 建好，先 `git checkout` 确认）
- 只 planResources + assertFull + 单测；**不改 spine/promotion/BackupService/MergeEngine**
- 无 Co-authored-by；`--signoff --no-verify`
- 验证：`pnpm typecheck` + `pnpm vitest run src/main/services/backup`（planResources 单测绿）

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "A1 done: <hash>, planResources + 单测绿, no co-author" --enter
```
