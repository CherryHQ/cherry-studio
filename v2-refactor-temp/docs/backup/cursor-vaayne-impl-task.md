# Cursor 实施任务：PR #17206 vaayne 4 阻塞修复

> 一个连贯任务，4 个修复一起做。读规划文档照着实施，不要偏离。

## 工作目录

`cd /Users/gd32/Coding/CherryV2`（主仓 `feat/backup-v2-restore` @ `dd4eaf7bea`）。**不是你的 backup-cs-audit 工作树**（那分支不对，PR #17206 head 是 feat）。GLM 已暂停改 src，你独占主仓 src，无冲突。

## 背景

vaayne 对 PR #17206 re-review（2026-07-23）提 **CHANGES_REQUESTED**，4 个 PR-merge blocker 必须修完才能合并。规划文档已就绪（prd + design），照着实施。

## 4 个修复（按序，每个先读对应 prd/design）

1. **vaayne-unclean-drain-abort（A7，小）** — 读 `.trellis/tasks/07-23-vaayne-unclean-drain-abort/prd.md`
   - `BackupService.ts:394` 现只查 `stragglerIds.length`、忽略 `startupRecoveryPending`
   - 改：unclean drain（straggler OR startupRecoveryPending）→ abort restore，新 IPC code `BACKUP_RESTORE_DRAIN_UNCLEAN`

2. **vaayne-admit-archive-limits（A3，小-中）** — 读 `.trellis/tasks/07-23-vaayne-admit-archive-limits/prd.md` + `design.md`
   - `admitArchive.ts:180` manifest unbounded `entryData()`，无 entry-count/per-entry/total-size/compression-ratio 限制
   - 改：metadata preflight + runtime streaming hard cap（entry-count / per-entry / total-uncompressed / compression-ratio），reject oversized

3. **vaayne-entity-tag-restore（A1，中）** — 读 `.trellis/tasks/07-23-vaayne-entity-tag-restore/prd.md` + `design.md`
   - `entity_tag` 三阶段全 miss（非 aggregate root/member + junctionDeriver 排除 + contributor TODO deferred）→ restore 丢所有 tag binding
   - 改：dedicated polymorphic-association import path（selected-domain filter + tagId 重写 + entityType 路由）

4. **vaayne-packaged-full-restore-gate（A1，短期小）** — 读 `.trellis/tasks/07-23-vaayne-packaged-full-restore-gate/prd.md` + `design.md`
   - `V2BackupActionGate.tsx:25-27` 启用 packaged Full，但 `stageFileResources` 返回 `[]` → Full restore 提 DB 不提 blob，UI 误报成功
   - 改（**只做短期**）：加 `isV2BackupRestoreFullReady()`=false + `<V2BackupRestoreFullGate>` 组件禁用 packaged Full。**长期 resource staging 不在此轮**（= dbonly-blob 扩展，单独跟进）

## 约束

- 只改主仓 feat 的 `src/` + 测试 + breaking-changes；**不 commit** `.trellis/`、`v2-refactor-temp/docs/` 本地文档（除 breaking-changes 条目）。
- 严格对照 prd/design 实施；每个 prd 的 Acceptance Criteria 必须满足。
- breaking-changes 条目（`v2-refactor-temp/docs/breaking-changes/`）写 packaged Full 禁用；**committed 文档不要引用** openspec/FINAL_REVIEW/reviews 路径。
- 不碰 packaged-full 长期 staging、不碰 hardening 19 child（那些是后续）。

## 测试

- 若 better-sqlite3 报 NODE_MODULE_VERSION 不匹配：`pnpm rebuild better-sqlite3`
- `pnpm vitest run src/main/services/backup src/main/data/db/backup src/main/data/services/backupContributor`（全绿）
- `pnpm lint`（typecheck node/web/aicore + i18n + biome）
- 为 4 个修复补单测（drain abort / admitArchive limits / entity_tag import / Full gate）

## Commit

- `git commit --signoff --no-verify`，分 logical commits（如 A7+A3 一个、entity_tag 一个、gate 一个；或你判断）。
- commit subject 用 conventional + `backup` scope，英文，≤50 char。
- **不要 push**（等 GLM 审 commit 后 push）。

## 完成后

`orca orchestration` 通知 `term_17766fca`（GLM），告知：commit 列表 + 测试结果 + 任何偏离 prd 的决策。

## 参考

- 审计事实源：`v2-refactor-temp/docs/backup/backup-v2-correctness-audit.md`
- cursor 计划审查：`v2-refactor-temp/docs/backup/hardening-plan-review.md`
- vaayne inline comments：PR #17206 review（gh api pulls/17206/comments）
