# PR #17340 Review — disclosure UI + relaunch gate（最近 4 commits）

- **PR**: https://github.com/CherryHQ/cherry-studio/pull/17340
- **Head**: `1a6e5fda75` (`feat/backup-v2-restore-contracts`)
- **Base**: `feat/backup-v2-restore`
- **Review worktree**: `/tmp/pr-review-17340-1a6e5fda756`（detached）
- **范围**: 仅同学最近 4 个 commit；本地报告，**未** post 上游 comment
- **对照**: A2 本地分支 `feat/backup-v2-full-restore-a1`（`ImportBackupResult.plan` 已暴露，仍 `triggerRelaunch`）

| Commit | Summary |
| --- | --- |
| `fd43bd83e0` | disclosure UI + `backup.restore_summary` event + i18n + breaking-changes |
| `edabfe44ee` | full-restore resource e2e fixtures / suite |
| `d8a84aab7a` | pin broadcast-then-wait spine contract（schema 注释） |
| `1a6e5fda75` | seal 后 broadcast + 等 renderer `app.relaunch`；quiesce 持有到进程退出 |

## Verdict

四 commit 在 **B4 自身契约内正确**：broadcast-then-wait、sealed 后不释放 quiesce、renderer 确认才 relaunch、broadcast 失败不炸 seal——与 `d8a84aab7a` 文档一致，也修掉了 fd43 时代「broadcast + 无条件 relaunch」的 sol blocker。

与 **A2 spine** 尚未真正接线：本 PR 的 `broadcastRestoreSummary` 仍硬编码空 summary；`ImportBackupResult` 尚无 `plan`。A2 已返回 `{ skips, toRestore, resources }` 但仍自动 `triggerRelaunch`。合体时若处理不当会重新引入 blocker 或披露说谎。

**计数：P0=0 / P1=3 / P2=3**

---

## P0（阻塞）

无。本 PR 在当前「DB-only / 空 ResourcePlan」前提下行为自洽；空 disclosure 是注释里写明的 A2 stub，不单独构成合入 base 的 blocker。

---

## P1（应修）

### P1-1 — A2 合体：必须吃 `ImportBackupResult.plan`，并丢掉 A2 的 `triggerRelaunch`

- **file:line**
  - PR: `BackupService.ts:487-494`（`broadcastRestoreSummary` 硬编码 `{ toRestore: [], toSkip: [] }`）
  - PR: `ImportOrchestrator.ts:70-74`（尚无 `plan`）
  - A2: `ImportOrchestrator.ts:73-79`（已有 `plan: Pick<ResourcePlan,'skips'|'toRestore'|'resources'>`）
  - A2: `BackupService.ts:449,465-467`（仍 `triggerRelaunch()`）
- **问题**: brief 要求 disclosure 消费 A2 暴露的 `plan`。形状上 `toRestore` 同名可直传；`plan.skips` → `RestoreResultSummary.toSkip`（1:1，见 `resourcePlanning.ts:10` / `backup.ts:78-79`）。本 PR 未消费；A2 未 wait。盲合并会二选一坏掉：恢复无条件 relaunch（disclosure 无交互窗口），或 wait 但永远空 summary（「将恢复 0」说谎）。
- **修法**（合体 commit，建议落在 A2 或 follow-up，不要求本 PR 独改）:

```ts
const { plan } = await importOrch.importBackup(...)
sealed = true
this.activeOperation = null
this.broadcastRestoreSummary({
  toRestore: plan.toRestore,
  toSkip: plan.skips
})
return { restoreId }
// 删除 triggerRelaunch；finally 仅 !sealed 时 releaseRestoreQuiesce
```

### P1-2 — e2e fixtures 未覆盖 disclosure / relaunch 关键路径

- **file:line**: `restore.full.resources.test.ts:247-256`（全是 `it.todo`）；`fullArchiveFixture.ts` 只服务 admission / merge skip
- **问题**: brief 维度 4 要覆盖「有 skips / 全 restore / renderer 拒绝 relaunch」。实际 e2e 只钉了 admission round-trip + MergeEngine 对 skip/staged 集合的消费。disclosure/relaunch 仅有单测：
  - `BackupService.restore.test.ts:239-272`（no auto-relaunch + quiesce held + broadcast 失败吞掉）
  - `RestoreV2Popup.test.tsx:151-224`（summary 渲染 / broadcast 丢失 fallback / 点 Restart → `app.relaunch`）
  - UI **没有**「拒绝 relaunch」路径（`canClose=false`，只能 Restart），故「拒绝」场景无法测、也不存在
- **修法**: A2 接线后补 spine 级断言：`broadcast('backup.restore_summary', { toRestore: plan.toRestore, toSkip: plan.skips })` 且 `relaunch` 未调。若产品需要放弃恢复，另开 abandon 路径再测；否则从验收里删掉「拒绝 relaunch」。

### P1-3 — `app.relaunch` 失败时 UI 无恢复，quiesce 永久卡住本进程

- **file:line**: `RestoreV2Popup.tsx:239-242`（`void ipcApi.request('app.relaunch')`，无 catch）
- **问题**: seal 后 `BACKUP_IN_PROGRESS` + JobManager pause 故意持有到进程退出。Restart 若 IPC/relaunch 抛错，用户停在 `relaunching`（Cancel 禁用），写窗口不恢复；二次 restore 还会被 staged journal 挡住。Fail-safe 偏「卡死直到杀进程」，对 relaunch 失败不够友好。
- **修法**: Restart onClick catch → 展示错误 + 保留 Restart 可重试；或提供「退出应用」兜底（仍不释放 quiesce，只 `app.exit`）。不要在未退出时 `releaseRestoreQuiesce`（会破坏 clean-expire 契约）。

---

## P2（可选）

### P2-1 — `relaunching` 文案仍像自动重启

- **file:line**: `en-us.json`（及 locales）`settings.data.backup.v2.restore.relaunching` = `"Restore staged. The app is relaunching…"`
- **问题**: `1a6e5fda75` 后主进程不再自动 relaunch；summary 到达前的短暂文案易误导。
- **修法**: 改为 “Restore staged. Preparing summary…” / 「恢复已暂存，正在准备摘要…」。

### P2-2 — `ImportOrchestrator` JSDoc 仍写「caller triggers a relaunch」

- **file:line**: `ImportOrchestrator.ts:115-118`
- **问题**: 与 broadcast-then-wait 契约漂移（调用方改为 broadcast + wait）。
- **修法**: 改为「caller broadcasts restore_summary and waits for renderer-confirmed app.relaunch」。

### P2-3 — popup 单测注释残留「request pending」

- **file:line**: `RestoreV2Popup.test.tsx:154`
- **问题**: `1a6e5fda75` 后 `startRestore` **会 resolve**；hanging promise 只是为了测「事件先到」的 UI，注释仍写 relaunch-gated pending，易误导后续接线。
- **修法**: 注明「模拟 broadcast 先于 resolve；生产路径 seal 后 request 会 resolve」。

---

## 维度对照（摘要）

| 维度 | 结论 |
| --- | --- |
| 1. 正确性 | 数据流事件侧正确（`RestoreResultSummary` + `useIpcOn` + fallback）。Gate fail-safe：不点 Restart 不 relaunch；quiesce 持有正确。缺 relaunch 失败恢复（P1-3）。 |
| 2. A2 衔接 | 类型层 `toRestore`/`SkippedResource`↔`toSkip` 元素形状一致；**运行时未接线**（P1-1）。无重复定义 `RestoreResultSummary`。 |
| 3. 契约 | `d8a84aab7a` 注释 ↔ `1a6e5fda75` 实现吻合。 |
| 4. 测试 | 单测覆盖 gate/UI；e2e 未覆盖 disclosure/relaunch（P1-2）。 |
| 5. 规范 | IpcApi event + `app.relaunch` route 合规；popup 放在 DataSettings 合理；relaunch 经 `application.relaunch`（handler）符合 lifecycle 指引。 |

## 正向

- sealed 标志避免 wait 路径误释放 quiesce——这是去掉 auto-relaunch 后的关键正确性修复。
- broadcast 失败吞掉 + renderer empty fallback，保证 Restart 按钮可达。
- future-tense i18n + breaking-changes 条目与「promotion 尚未发生」一致。
- `ResourceClass` 放 shared，knowledge/skill 可区分，和 A2 `toRestore` 预聚合对齐。

## 未做

- 未 post GitHub review / comment
- 未改同学 PR 代码、未 push
- 未跑全量 CI（静态对照 worktree + A2 本地分支）
