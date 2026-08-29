# PR #17346 Review — A1 + A2 + A3（planResources spine + disclosure 接线）

- **PR**: https://github.com/CherryHQ/cherry-studio/pull/17346
- **Head**: `1794cf6dfb` (`feat/backup-v2-full-restore-a1`)
- **Base**: `feat/backup-v2-restore-contracts`（含 disclosure + relaunch gate）
- **Commits**: `8458e3e26f` A1 · `1794cf6dfb` A2 spine + **A3 接线（Claude rebase）**
- **Worktree**: `/tmp/pr-review-17346-1794cf6dfbe`
- **范围**: `origin/feat/backup-v2-restore-contracts...HEAD`；本地报告，**未** post comment

## 谁做了什么（对照 brief）

| 段 | 作者 | 内容 |
| --- | --- | --- |
| A1 | 你 | `planResources` + `assertFullManifestInvariants` + 单测 |
| A2 | 你 | planning 前置 merge、MergeEngine skip 扩、admit full、deps 注入、`ImportBackupResult.plan` |
| **A3 + rebase** | **Claude** | `broadcastRestoreSummary(summary)`、`toSkip: plan.skips`、丢掉 `triggerRelaunch`、合并 sealed quiesce |

## Verdict

A3 接线与 rebase **主体正确**：`plan.toRestore` / `plan.skips→toSkip` 形状匹配 `RestoreResultSummary`；seal 成功后 broadcast-then-wait；`let sealed` + `finally if (!sealed)` 与 A2 的 `planResources`/`planRoots`/去 full-gate **无丢失**。A1/A2 时序与 skip 语义复核通过。

主要缺口在**测试未钉死 A3 字段映射**（空 plan stub 可掩盖 `skips`/`toSkip` 写反），以及 e2e spine todo 未收。

**计数：P0=0 / P1=2 / P2=3**

---

## P0（阻塞）

无。

A3 关键路径（`BackupService.ts:437-456`）顺序为：

1. `const { plan } = await importOrch.importBackup(...)`（journal 已 commit）
2. `sealed = true` → `activeOperation = null`
3. `broadcastRestoreSummary({ toRestore: plan.toRestore, toSkip: plan.skips })`
4. `return { restoreId }`
5. `finally`: 仅 `!sealed` 时 `releaseRestoreQuiesce`

`triggerRelaunch` 已清除；broadcast 失败仍吞掉。与 base disclosure 契约一致。

---

## P1（应修）

### P1-1 — 【A3】BackupService 单测只用空 plan，掩盖 `skips → toSkip` 映射

- **file:line**
  - `BackupService.restore.test.ts:98`（default mock `{ toRestore: [], skips: [] }`）
  - `BackupService.restore.test.ts:252,303,328`（断言 broadcast `{ toRestore: [], toSkip: [] }`）
  - 生产接线：`BackupService.ts:455` `toSkip: plan.skips`
- **问题**: A3 的核心是字段重命名映射。当前所有断言在两边都是 `[]` 时成立——若误写成 `toSkip: plan.toRestore` 或漏传 `skips`，空 stub 仍绿。brief 维度 4 明确要求「broadcast 喂 plan / A3 mock 真实，而非 stub 空 plan 掩盖」。
- **修法**: 至少一条非空 fixture：

```ts
importBackup.mockResolvedValueOnce({
  plan: {
    toRestore: [{ kind: 'file', count: 2 }],
    skips: [{ id: 'f1', kind: 'file', reason: 'live exists' }],
    resources: []
  }
})
// …
expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
  toRestore: [{ kind: 'file', count: 2 }],
  toSkip: [{ id: 'f1', kind: 'file', reason: 'live exists' }]
})
expect(relaunchMock).not.toHaveBeenCalled()
expect(isBackupInProgress()).toBe(true)
```

### P1-2 — e2e spine / disclosure 路径仍 `it.todo`，文件头注释过时

- **file:line**
  - `restore.full.resources.test.ts:11-13,248-256`（仍写 Deferred to A1/A2；spine todo 未翻）
  - A2 只把 forged-manifest 用例翻成 reject（`169-178`），未接 `planResources`→journal→broadcast
- **问题**: A1 单测 + MergeEngine skip 单测充足，但 brief 要的「有 skips / 全 restore + disclosure」端到端未落地。生产 A3 接线缺少回归护栏。
- **修法**: 用现有 `fullArchiveFixture` 跑 ImportOrchestrator（或 BackupService + 可控 IpcApi broadcast mock）：断言 `result.plan.skips/toRestore`、journal `fileResources === plan.resources`（无 skips 字段）、以及（若测 BackupService）broadcast payload。收掉对应 `it.todo` / 更新文件头。

---

## P2（可选）

### P2-1 — 【rebase 文档漂移】顶栏注释仍写「journal → relaunch」

- **file:line**: `BackupService.ts:20-21`（`… journal → relaunch`）
- **问题**: A3 已改为 broadcast-then-wait；同文件 `startRestore` JSDoc（322-325）已正确。顶栏与实现不一致，后续 rebase 易再引入 auto-relaunch 幻觉。
- **修法**: 改为 `journal → broadcast restore_summary → renderer app.relaunch`。

### P2-2 — `assertFullManifestInvariants` 双调用

- **file:line**: `admitArchive.ts:178`（unpack 前）+ `resourcePlanning.ts:233`（plan 入口）
- **问题**: 非错误——admit 满足 P1-6，plan 入口防绕过 admit 的直接调用。略冗余。
- **修法**: 可保留；若求单一真相，plan 侧改注释标明「defense in depth / admit 已检」。

### P2-3 — A1 commit 带 `Co-authored-by: Cursor`

- **commit**: `8458e3e26f`
- **问题**: 与协作约定「无 Co-authored-by」冲突（历史 commit；改写需 force）。
- **修法**: 后续 squash/rebase 时去掉；不必为此单独 rewrite 已推送历史，除非发版政策要求。

---

## 维度对照

### 1. A3 接线正确性（Claude · 重点）

| 检查项 | 结果 |
| --- | --- |
| `{ toRestore: plan.toRestore, toSkip: plan.skips }` vs `RestoreResultSummary` | 匹配；`SkippedResource` ≡ `toSkip` 元素 |
| 丢 `triggerRelaunch` | 通过；`rg triggerRelaunch` 无命中 |
| `const { plan } = await importBackup` | 正确；broadcast 在 `sealed=true` 之后、`return` 之前 |
| broadcast 失败 | 仍吞掉，不影响 seal |

**疑点（已排除）**: `sealed` 是否在读 `plan.*` 之前置位——是（453 在 455 前）。`plan` 缺失时抛错会落在 sealed 之后 → quiesce **不**释放（fail-safe 正确，UX 为错误+卡住直至重启）。

### 2. rebase 合并一致性（Claude · 重点）

| 部件 | 状态 |
| --- | --- |
| `let sealed` + `finally if (!sealed) release` | 保留 |
| broadcast-then-wait + 无 auto-relaunch | 保留并接 plan |
| `planResources` + `planRoots`（files/knowledge/skills/notes） | 注入完整 |
| admit 去 `RESTORE_FULL_NOT_SUPPORTED` | 已去；直通 `admitArchive` |
| stageFileResources stub | 已删 |

未见 A2 与 disclosure 半边丢失。

### 3. 复核 A1/A2（勿放松）

| 项 | 结果 |
| --- | --- |
| P0-4 时序 | snapshot → `planResources`（自开只读 work.sqlite）→ `new Database(workPath)` 写连接 → merge（`ImportOrchestrator.ts:181-223`） |
| skill skip | `backupRow['folder_name']`；根查询 `SELECT *`（`MergeEngine.ts:370,441`）；单测 `MergeEngine.test.ts:698` |
| P0-3 includeFiles | planning early-return + merge `presetIncludesFiles(preset)`，非 raw manifest |
| P1-5 journal | `fileResources: plan.resources` only；skips 仅 `ImportBackupResult.plan` |
| P1-6 assertFull | admit unpack 前调用；forged e2e 已翻 reject |

### 4. 测试覆盖深度

- A1 `resourcePlanning.test.ts`：冲突 / corrupt / toRestore 分档 —— 深
- MergeEngine knowledge/skill skip —— 有
- BackupService A3 —— **浅**（P1-1）
- e2e spine —— **未接**（P1-2）
- sealed quiesce + no relaunch —— 有（空 summary）

### 5. 规范

- 主进程服务边界 / `application.getPath` roots：合规
- IpcApi `backup.restore_summary` event + renderer `app.relaunch`：合规
- 无 DataApi 误用；lifecycle quiesce 持有到确认重启：与 disclosure 契约一致

---

## 正向（A3 / rebase）

- 正确完成 17340 review 指出的合体要求：吃 `plan`、映射 `skips→toSkip`、删除 A2 侧 `triggerRelaunch`
- sealed 标志与 disclosure base 对齐，避免 wait 路径误释放写窗口
- full gate 移除与 `assertFullManifestInvariants` 配套，forged manifest e2e 已翻转

## 未做

- 未改代码、未 push、未 post GitHub comment
- 未重跑 vitest（静态对照 worktree + 测试源）
