# Cursor：修复 PR #17346 review findings

> 基于 cursor-pr17346-review.md + contract 分析。你修 **P1-1 / P2-1 / P1-2**（代码/测试）+ amend A2。**P2-3（去 A1 Co-authored-by rebase + 重签 + push）Claude 做**（敏感 git，避免越界）。你**不 push、不 rebase A1**。

## 分支
`feat/backup-v2-full-restore-a1`（本地 `1794cf6dfb`，最新）。

## Contract 依据（最新分析）
- `RestoreResultSummary`（`src/shared/types/backup.ts:81-84`）：`{ toRestore: {kind,count}[], toSkip: {id,kind,reason}[] }`
- `ResourcePlan.skips` = `SkippedResource[]` = `{id,kind,reason}[]` → **1:1 `toSkip`**（L79 注释确认）
- A3 接线（`BackupService.ts:455`）`toSkip: plan.skips` 形状匹配 ✅；P1-1 是用非空 fixture **钉死**它（防写反）

## P2-1（顶栏注释漂移）
`BackupService.ts:20-21`：
- old: `→ 2nd fingerprint → journal → relaunch`
- new: `→ 2nd fingerprint → journal → broadcast restore_summary → renderer app.relaunch`
- 对齐 startRestore JSDoc（L322-325）

## P1-1（非空 plan fixture，钉死 skips→toSkip）
`BackupService.restore.test.ts`（drain verdict describe，L239 附近）加一个 it：
```ts
it('broadcasts a NON-empty plan: toSkip maps from plan.skips (not toRestore)', async () => {
  drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
  importBackup.mockResolvedValueOnce({
    plan: {
      toRestore: [{ kind: 'file', count: 2 }],
      skips: [{ id: 'f1', kind: 'file', reason: 'live exists' }],
      resources: []
    }
  })
  const service = new BackupService()
  await service.startRestore({ archivePath: '/x.cherrybackup' })
  expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
    toRestore: [{ kind: 'file', count: 2 }],
    toSkip: [{ id: 'f1', kind: 'file', reason: 'live exists' }]
  })
  expect(relaunchMock).not.toHaveBeenCalled()
  expect(isBackupInProgress()).toBe(true)
  setBackupInProgress(false)
})
```
用 `mockResolvedValueOnce`（不覆盖 beforeEach 默认 mock）。

## P1-2（e2e spine 收 todo）
`restore.full.resources.test.ts`：
- **核心 L253**：参考 `restore.full.test.ts` 的 ImportOrchestrator spine 跑法（`planResources` + `planRoots` + `admitArchive` deps 注入），用 `fullArchiveFixture` 跑 spine，断言：
  - `result.plan.toRestore` / `result.plan.skips` 符合 fixture
  - 读 staged journal：`fileResources === plan.resources`，**无 skips 字段**（P1-5）
- **L251 forged flip**：已做（L169-178 reject），**删这个 todo**
- L249 planning conflict / L250 corrupt：A1 单测（`resourcePlanning.test.ts`）已覆盖；e2e 可 defer（保留 todo 注明 "unit-covered"）
- **L256 clean-expire**：restorePromotion e2e，超 A2 范围，**保留 todo**（标 follow-up）
- 更新文件头 L11-13："Deferred to A1/A2" → "A1/A2 landed; spine e2e below"

## commit（P2-1/P1-1/P1-2 改完后）
```
git add src/main/services/backup/BackupService.ts \
  src/main/services/backup/__tests__/BackupService.restore.test.ts \
  src/main/services/backup/__tests__/e2e/restore.full.resources.test.ts
git commit --amend --no-edit --no-verify
```
（amend A2 含修复；**不签名**——Claude rebase 时统一签 A1+A2）

## 验证
- `pnpm vitest run src/main/services/backup`（全绿，含新 P1-1 fixture + P1-2 e2e）
- `pnpm lint`（0 errors）

## 约束
- 无 Co-authored-by；`--no-verify`（prek 阻塞）
- **不 push、不 rebase A1**（Claude 做 P2-3 + push）

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "PR17346 fixes done: P1-1/P2-1/P1-2 + amend A2, vitest+lint 绿, 未 push/rebase" --enter
```
