# Cursor：against review 契约（PR #17340）

> 对抗审 PR #17340 的契约类型。**假如有问题**，对照真实代码找出来，不背书。

## 审什么（PR #17340 的 3 个文件）
- `src/main/services/backup/resourcePlanning.ts`（新增：ResourcePlan/SkippedResource/PlanCtx/PlanRoots/ResourceClass）
- `src/shared/types/backup.ts`（加 RestoreResultSummary）
- `src/main/data/db/restore/restoreJournal.ts`（加 `export type FileResource = z.infer<typeof FileResourceSchema>`）

## 审点

### resourcePlanning.ts
- `ResourcePlan.skippedFileEntryIds/stagedFileEntryIds: Set<string>` —— 与 MergeContext（merge/types.ts）的类型兼容？方向对否（MergeContext 是 `ReadonlySet<string>`，Set 赋给 ReadonlySet）？反过来 merge 会不会 mutate？
- `resources: FileResource[]` —— FileResource 类型来源（restoreJournal export）正确？与 FileResourceSchema 一致？
- `PlanCtx.manifest: BackupManifest` —— 引用 manifest.ts 的 BackupManifest，字段匹配（files.ids/knowledge.bases/skills.folders/notes.paths）？
- `PlanCtx.workPath/backupDbPath/workDir/userData` —— planning 输入完整？缺什么（restoreId？—— 全 skip 无 aside 是否真不需要）？
- `PlanRoots.notes: () => string | undefined` —— 与 BackupService.resolveNotesRoot 签名一致？
- `Set<string>` 序列化问题？ResourcePlan 会不会跨进程/落 journal（Set 不能 JSON）？
- 命名规范（docs/references/naming-conventions.md）？

### RestoreResultSummary
- `toRestore/toSkip` 结构 —— 与 plan.skips mirror 一致？（plan.skips: {id, kind: ResourceClass, reason}[] vs toSkip: {id, kind: string, reason}[]）
- `kind: string` vs ResourceClass —— 跨进程边界类型严格性？shared 不能 import main 的 ResourceClass，如何处理？
- 位置（shared/types/backup.ts）对？event 纯 type 非 zod（schemas/backup.ts 注释说 main→renderer 是 pure type）？
- 弹窗将来时语义（toRestore/toSkip）对？

### FileResource export
- `export type FileResource = z.infer<typeof FileResourceSchema>` —— 正确？
- restorePromotion.ts:24 也有局部 `type FileResource = RestoreJournal['fileResources'][number]` —— 双定义冲突？等价？该不该统一（restorePromotion 改 import）？

## 对照真实代码
- `src/main/services/backup/merge/types.ts`（MergeContext，skippedFileEntryIds/stagedFileEntryIds/includeFiles）
- `src/main/services/backup/manifest.ts`（BackupManifest L33）
- `src/main/data/db/restore/restoreJournal.ts`（FileResourceSchema/RestoreJournal）
- `src/main/data/db/restore/restorePromotion.ts:24`（局部 FileResource）
- `docs/references/naming-conventions.md`

## 输出
写 `v2-refactor-temp/docs/backup/cursor-contracts-review.md`：每条 finding（severity P0/P1/P2 + evidence file:line + fix）+ 末尾总体判断（契约可否合入 feat/backup-v2-restore）。只要真问题。

## 约束
只审，不改代码。无 Co-authored-by。不 push/commit。当前分支已是 feat/backup-v2-restore-contracts。
