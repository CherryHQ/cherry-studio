# PR #17346 Review v2 — 修复后最终回归

- **PR**: https://github.com/CherryHQ/cherry-studio/pull/17346
- **Head**: `dfeeb8f314` (`feat/backup-v2-full-restore-a1`，与 `origin` 一致)
- **Base**: `feat/backup-v2-restore-contracts`
- **Commits（A1/A2）**: `e8dac64a6a` A1 · `dfeeb8f314` A2（含 P1-1/P2-1/P1-2 amend）
- **对照**: 上一版 `cursor-pr17346-review.md`（P0=0 / P1=2 / P2=3）+ `cursor-pr17346-fix-plan.md`
- **范围**: `feat/backup-v2-restore-contracts...HEAD`；本地报告，**未** post comment、**未**改代码

## Verdict

上一轮 P1-1 / P1-2 / P2-1 / P2-3 **均已正确落地**；A3 `plan.skips → toSkip` 接线与 `sealed` quiesce **未回退**。针对性测试 + 全文件相关 vitest 绿。本轮 fresh 复核未发现新的 P0/P1；无必须跟进的 P2。

**计数：P0=0 / P1=0 / P2=0**

---

## 修复项逐条核验

### 1. P1-1 — 非空 fixture 钉死 `toSkip ← plan.skips` ✅

- **file:line**: `BackupService.restore.test.ts:261-284`
- **生产接线**: `BackupService.ts:456` `broadcastRestoreSummary({ toRestore: plan.toRestore, toSkip: plan.skips })`
- **断言**: broadcast payload 为非空、且 `toSkip` 形状/内容来自 `skips`（`id/kind/reason`），`toRestore` 来自 `[{ kind:'file', count:2 }]`——交换字段会红。
- **mock 隔离**: 用 `mockImplementationOnce`（**非** fix-plan 草稿里的 `mockResolvedValueOnce`）。Once 内显式 `runQuiesceViaImportBackupMock()`，避免覆盖 describe 级 quiesce drive 导致 `isBackupInProgress` 假阴性。Once 只吃一次调用；后续 case 仍走 describe `beforeEach` 的空 plan `mockImplementation`，无污染。
- **配套**: 仍保留空 summary 的 broadcast-then-wait / sealed hold 用例（`:240-259`）。

### 2. P1-2 — spine e2e（真实 ImportOrchestrator）✅

- **file:line**: `restore.full.resources.test.ts:293-360`；文件头 `:11-13`
- **deps**: `makeDeps` 注入真实 `admitArchive` / `planResources` / `MergeEngine.mergeBackupIntoWork`（非 stub 空 plan）。`planRoots.notes: () => undefined` 故意造出 note skip。
- **断言**:
  - `result.plan.toRestore` = file/knowledge/skill 各 1
  - `result.plan.skips` = `[{ id:'folder/note.md', kind:'note', reason:'no managed notesRoot' }]`
  - `result.plan.resources.length === 3`
  - journal `fileResources === plan.resources` 且 **无 `skips` 属性**（P1-5）
- **todo**: forged-manifest 旧 todo 已删（既有 reject it 覆盖）；planning conflict/corrupt 标 unit-covered；clean-expire 标 follow-up——与 fix-plan 一致。
- **缺口说明（不计入 finding）**: 本 e2e 钉的是 ImportOrchestrator→journal/plan；A3 broadcast 映射由 P1-1 单测钉。两者合起来覆盖 brief 要求，无需 BackupService 再套一层真实 archive。

### 3. P2-1 — 顶栏注释对齐 broadcast-then-wait ✅

- **file:line**: `BackupService.ts:18-22`
- **文案**: `… journal → broadcast restore_summary → renderer app.relaunch`
- **与** `startRestore` JSDoc `:321-326`（broadcast disclosure → wait renderer `app.relaunch`）一致；不再暗示 seal 后 auto-relaunch。

### 4. P2-3 — Claude：去 Co-authored-by + 重签 ✅

- `git log --format='%B' 1a6e5fda75..HEAD | grep -i co-authored` → **无命中**
- A1 `e8dac64a6a` / A2 `dfeeb8f314` 均含 `gpgsig -----BEGIN SSH SIGNATURE-----`（本机未配 `gpg.ssh.allowedSignersFile`，`git verify-commit` 无法验签内容，但签名块存在）
- 两 commit 均有 `Signed-off-by: George·Dong <…>`；作者/committer 均为 George·Dong

### 5. 整体回归 — A3 + sealed quiesce ✅

| 检查项 | 结果 |
| --- | --- |
| `toSkip: plan.skips` / `toRestore: plan.toRestore` | 仍在 `:456` |
| `triggerRelaunch` | 无命中 |
| `sealed=true` → broadcast → `finally if (!sealed) release` | 保留 `:348,:454-461` |
| post-seal 持有 `BACKUP_IN_PROGRESS` + JobManager pause | 单测仍断言；broadcast 失败吞掉不 unlock |
| `planResources` + `planRoots` 注入 / admit full | 保留 |

修复仅触及注释 + 测试 +（A2 amend 内既有 spine）；未见生产 A3/sealed 回退。

---

## P0（阻塞）

无。

## P1（应修）

无。上一轮 P1-1 / P1-2 已关闭。

## P2（可选）

无新增。上一轮 P2-2（`assertFullManifestInvariants` admit+plan 双调用，defense in depth）仍成立，属已知可保留设计，**本轮不重开**。

---

## 维度对照（相对 v1）

| 维度 | v1 | v2 |
| --- | --- | --- |
| A3 接线 | 主体正确，测试未钉映射 | 接线仍正确 + P1-1 非空钉死 |
| rebase / sealed | 通过 | 通过（无回退） |
| A1/A2 时序与 skip | 通过 | 通过；e2e spine 补上 journal/plan |
| 测试深度 | BackupService A3 浅；e2e spine todo | 两处已补；相关 vitest 25 pass / 3 todo |
| Co-authored-by / 签名 | A1 有 Co-authored-by | 区间无 Co-authored-by；A1/A2 有 gpgsig |
| 规范 | 合规 | 合规 |

---

## 验证命令（本轮执行）

```
pnpm vitest run src/main/services/backup/__tests__/BackupService.restore.test.ts \
  src/main/services/backup/__tests__/e2e/restore.full.resources.test.ts
# → 2 files, 25 passed | 3 todo
```

## 正向

- P1-1 相对 fix-plan 草稿主动改用 `mockImplementationOnce` + quiesce drive，避免空/Once 覆盖导致的假绿/假红——实现比草稿更稳。
- P1-2 用真实 `planResources` 造 note skip，同时钉住 journal 不加 `skips`，直接锁 P1-5 契约。

## 未做

- 未改代码、未 push、未 post GitHub comment
- 未跑全仓 `pnpm lint` / 全 `backup` vitest（本轮只复跑修复相关两文件；上一修复轮次已全绿）
