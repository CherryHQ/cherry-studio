# Cursor：against review A1/A2 执行计划

> 对抗审 trellis 的 A1/A2 执行计划。契约已推 PR #17340，v2.1 评审修订已采纳。**假设计划仍有错**，对照真实代码找出来，不背书。

## 已落地（不用再审）
- 契约 PR #17340：`resourcePlanning.ts`（ResourcePlan/SkippedResource/PlanCtx/PlanRoots）+ restoreJournal export `FileResource` + shared `RestoreResultSummary`
- v2.1 评审修订已采纳（4 阻断 A1-A4 + 2 必须 + 冲突判定同源 + 弹窗文案将来时 + workDb.close）

## 审什么
- `.trellis/tasks/07-24-backup-v2-full-restore-staging/{prd,design,implement}.md`
- `v2-refactor-temp/docs/backup/full-restore-plan.md`（v2.1，详版，§10 代码骨架）
- 契约代码：`src/main/services/backup/resourcePlanning.ts` + `src/shared/types/backup.ts`（RestoreResultSummary）+ `src/main/data/db/restore/restoreJournal.ts`（FileResource export）

## A1 planning 模块（planResources，§10.1）
- 交叉校验 manifest↔archive↔backup DB 完整否？
- ARCHIVE_CORRUPT 判定（缺源/external/错类型/symlink）覆盖全否？
- assertFullManifestInvariants（preset=full 跨字段匹配 resolvePreset）逻辑对否？
- lstat 类型校验（files/notes 须 regular file、KB/skills 须目录、拒 symlink）？
- 冲突同源：workDb 读 work.sqlite（snapshot 后本地快照）查本地行 OR existsSync——时序对否（snapshot 在 planning 前）？workDb.close 漏否？
- ResourcePlan 产出（staged/skipped/resources/skips）与契约类型一致否？
- toPathResolvable（snake_case external_path → camelCase externalPath）映射对否？

## A2 spine 原子改线（§10.2）
- planning 前置 merge（ImportOrchestrator 时序：snapshot→planning→merge→seal→序列化）对否？
- MergeContext 消费 plan.skippedFileEntryIds/stagedFileEntryIds（真实值，不空集/不高估）？
- seal 后 journal.fileResources = plan.resources（stageFileResources dep 删/瘦身）？
- admitArchive 删 full 拒绝 + assertFullManifestInvariants？
- 原子性（同 commit 翻转，否则 dangling）——中间态分析对否？

## 对照真实代码验证（别信计划声明）
- `src/main/services/backup/ImportOrchestrator.ts`（snapshot L173 / merge L199 / seal L223 / stage L234）
- `src/main/services/backup/BackupService.ts`（stageFileResources stub L434 / admitArchive L389 / roots L216-223）
- `src/main/services/backup/merge/types.ts`（MergeContext skippedFileEntryIds/stagedFileEntryIds 类型）
- `src/main/data/db/restore/restorePromotion.ts`（assertNoAddConflicts / add apply）
- `src/main/services/backup/SqliteFileStager.ts`（export 端对称参考）

## 输出
写 `v2-refactor-temp/docs/backup/cursor-a1-a2-review.md`：每条 finding（severity P0/P1/P2 + evidence file:line + failure scenario + fix）+ 末尾总体判断（A1/A2 可否派工）。只要真问题，不要 nitpick。

## 约束
只审，不改代码/计划文档。无 Co-authored-by。不 push/commit。

## 完成后
写完 cursor-a1-a2-review.md 即可（Claude 会主动读）。
