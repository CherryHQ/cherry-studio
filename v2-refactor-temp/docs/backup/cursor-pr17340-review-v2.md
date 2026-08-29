# PR #17340 Review v2 — A+B 合体后集成视角

- **PR**: https://github.com/CherryHQ/cherry-studio/pull/17340（@DeJeune）
- **Head**: `a64e91ab58` (`feat/backup-v2-restore-contracts`，与 `gh` headRefOid 一致)
- **Base**: `feat/backup-v2-restore`
- **Diff**: `origin/feat/backup-v2-restore...origin/feat/backup-v2-restore-contracts`
- **合体点**: squash `a64e91ab58` = A1+A2+A3（原 #17346）叠在 disclosure/relaunch-gate（B）之上
- **对照**: `cursor-pr17340-review.md`（B-only v1）+ `cursor-pr17346-review-v2.md`（A 修复后 P0/P1/P2=0）
- **范围**: 本地报告；**未** post 上游 comment（同学 PR）

## Verdict

A+B 集成主路径正确：`planResources`（snapshot 后 / merge 前）→ merge skip sets → `journal.fileResources = plan.resources` → `sealed` → `broadcastRestoreSummary({ toRestore: plan.toRestore, toSkip: plan.skips })` → renderer 确认 `app.relaunch`，quiesce 持有到进程退出。v1 的 P1-1（空 summary stub）/ P1-2（e2e spine todo）已被 A squash 关闭。

仍 open：**P1-3**（`app.relaunch` 失败 UI 无恢复 → quiesce 软锁）同学未修；v1 的三个文档/文案 P2 仍在。无新的合体回归 P0/P1。

**计数：P0=0 / P1=1 / P2=3**

---

## 端到端（A+B）

```
admitArchive (+ assertFull for full)
  → quiesce (BACKUP_IN_PROGRESS + JobManager.pause + drain)
  → fingerprint → snapshot
  → planResources          // A
  → merge (skipped* + presetIncludesFiles)  // A
  → migrate → seal → 2nd fingerprint
  → journal.fileResources = plan.resources  // A；无 skips 字段
  → sealed=true; broadcast plan→RestoreResultSummary  // A3 + B
  → wait; renderer Restart → app.relaunch   // B
  → next boot: promotion gate + onAllReady KB reindex  // B2
```

| 检查项 | 结果 |
| --- | --- |
| A3 `toSkip: plan.skips` | `BackupService.ts:456` ✅ |
| 无 `triggerRelaunch` | 全树无命中 ✅ |
| `sealed` + `finally if (!sealed) release` | `:348,:454-461` ✅ |
| `ImportBackupResult.plan` | `ImportOrchestrator.ts:73-78,:301-304` ✅ |
| P0-4 时序 / skill `folder_name` / assertFull | 与 A review-v2 一致 ✅ |
| B1 单入口 | `V2BackupActionGate` 按 `manifest.preset` 内路由；full gate 已去 ✅ |
| B2 reindex | `BackupService.onAllReady` 扫 journal knowledge dirs ✅ |
| B4 UI | `useIpcOn('backup.restore_summary')` + future-tense + empty fallback ✅ |
| 测试护栏 | NON-empty `toSkip←skips` 单测 + spine e2e journal/plan ✅ |
| squash 相对 A tip `dfeeb8f314` | `src/main/services/backup/` 关键文件无 diff；squash 消息含 A3；无 Co-authored-by ✅ |

---

## P0（阻塞）

无。

---

## P1（应修）

### P1-3 — `app.relaunch` 失败时 UI 无恢复，quiesce 永久卡住本进程（v1 残留，合体后仍 open）

- **file:line**: `RestoreV2Popup.tsx:239-242`  
  `onClick={() => void ipcApi.request('app.relaunch')}` — **无 try/catch**；同学在 squash 后未改。
- **问题**: seal 后 `BACKUP_IN_PROGRESS` + JobManager pause **故意**持有到进程退出。Restart 若 IPC/`application.relaunch` 抛错：UI 停在 `relaunching`（`canClose=false`，Cancel 禁用），写窗口不恢复；二次 restore 还会被 staged journal 挡住。Fail-safe 变成「杀进程才能脱身」，对 relaunch 失败不友好。
- **修法**: Restart onClick catch → 展示错误 + **保留 Restart 可重试**；或提供「退出应用」兜底（`app.exit`，仍不 `releaseRestoreQuiesce`）。**不要**在未退出时释放 quiesce（会破坏 clean-expire）。
- **状态**: 记本地；**未**发上游（需用户点头后再发）。

---

## P2（可选 · v1 残留，合体未动）

### P2-1 — `relaunching` 文案仍像自动重启

- **file:line**: `en-us.json` / `zh-cn.json` `settings.data.backup.v2.restore.relaunching`  
  EN: `"Restore staged. The app is relaunching…"` / ZH: `"恢复已暂存，应用正在重启…"`
- **问题**: `1a6e5fda75` 后主进程不再 auto-relaunch；summary 到达前的短暂文案易误导。
- **修法**: “Restore staged. Preparing summary…” / 「恢复已暂存，正在准备摘要…」。

### P2-2 — `ImportOrchestrator` 方法 JSDoc 仍写 caller 触发 relaunch

- **file:line**: `ImportOrchestrator.ts:125`  
  `the caller (BackupService) triggers a relaunch so the preboot gate promotes it.`
- **问题**: 与 broadcast-then-wait + A3 漂移（caller 改为 broadcast + wait）。文件头注释已提到 B4，方法 JSDoc 未跟。
- **修法**: 改为「caller broadcasts `restore_summary` and waits for renderer-confirmed `app.relaunch`」。

### P2-3 — popup 单测注释残留「request pending」

- **file:line**: `RestoreV2Popup.test.tsx:154`  
  `// Spine keeps the request pending (relaunch-gated) — the summary event drives the UI.`
- **问题**: 合体后 `startRestore` **会 resolve**；hanging promise 只为测「事件先于 resolve」的 UI，注释仍像生产 pending。
- **修法**: 注明「模拟 broadcast 先于 resolve；生产路径 seal 后 request 会 resolve」。

---

## 已关闭（相对 v1）

| ID | v1 问题 | v2 |
| --- | --- | --- |
| P1-1 | `broadcastRestoreSummary` 硬编码空 summary；A2 仍 `triggerRelaunch` | **关闭** — A squash A3 接线 |
| P1-2 | e2e spine / disclosure 路径全 `it.todo` | **关闭** — spine e2e + BackupService 非空 mapping 单测 |

---

## 维度对照（brief）

| # | 维度 | 结论 |
| --- | --- | --- |
| 1 | A+B 集成 | 一致；plan → merge → journal → broadcast → relaunch gate 端到端对齐 |
| 2 | P1-3 | **仍 open**；同学未修；记本地未发 |
| 3 | squash 完整 | 相对 A tip 无丢失；assertFull / skill folder skip / A3 / 测试均在 |
| 4 | 整体回归 | full restore staging 契约自洽；B2 reindex 与 journal knowledge `dir-add` 衔接合理 |
| 5 | 规范 | IpcApi event + `app.relaunch`；roots 经 `application.getPath`；reindex 在 `onAllReady`；无 DataApi 误用 |

---

## 正向

- squash 一次带上 A1/A2/A3，避免「disclosure wait + 空 summary」与「A2 auto-relaunch」两条半截路径并存。
- P1-1 非空 fixture + P1-2 spine e2e 留在 contracts tip，合体后仍可回归 A3 字段映射与 journal P1-5。
- schema 注释（`d8a84aab7a`）与实现（sealed wait + A3 喂 plan）一致。

## 未做

- **未** post GitHub review / comment（同学 PR；发 finding 前需问用户）
- 未改代码、未 push
- 未跑全量 CI（静态对照 `origin/feat/backup-v2-restore-contracts` @ `a64e91ab58`）
