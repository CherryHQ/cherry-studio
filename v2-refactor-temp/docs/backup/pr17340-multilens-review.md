# PR #17340 多视角 Review（A+B 合体）— 综合

> **workflow 3 finder**（integration / failure-paths / data-consistency，MiniMax-M3）+ **cursor review-v2** + **Claude 亲自验证**。本地记录，**未发上游**（PR #17340 是 @DeJeune 的，发 finding 前问用户）。
>
> Head `a64e91ab58`（disclosure B + A squash），base `feat/backup-v2-restore`。

## 结论

A+B 集成主路径正确（`plan → merge → journal.fileResources=plan.resources → sealed → broadcastRestoreSummary(plan) → renderer app.relaunch → next boot promotion + KB reindex`），**无阻塞合体的 P0**。真问题集中在 **fail-safe 边缘 + silent degradation**。

## 已验证为误报（Claude 亲自读代码）

| 原发现 | 验证 |
|---|---|
| ❌ data-consistency P1：assertFull 拒绝合法 full backup（新用户空附件） | `ExportOrchestrator.ts:400` `includeFiles: filesTotal > 0`（一致性，非恒 true）→ 合法 full `includeFiles:false + files.ids:[]` 通过。test:645 测的是**伪造**（includeFiles=true 配空 ids） |
| ❌ integration P1（resourcePlanning L343）：notes abort-not-skip | `assertStagingFile` 是 archive 完整性检查（staging 缺才 CORRUPT，对）；staging 在则 skip。逻辑合理 |

## 真风险（去误报后）

### P1（应修，最实际）

1. **app.relaunch 失败卡死（=P1-3）** — `RestoreV2Popup.tsx` Restart 按钮 `void ipcApi.request('app.relaunch')` 无 catch。relaunch 失败 → UI 卡 `relaunching`（`canClose=false`）+ quiesce 持有 + 二次 restore 被 staged journal 阻塞 → 杀进程才能脱身。
2. **KB reindex silent empty** — `enqueueRestoredKnowledgeReindex` per-base `try/catch` 只 `logger.error`。reindex 失败 / journal 被清 / vector store 文件存在但空或损坏 → KB 搜索 silent empty，用户无 UI 信号。
3. **skips 跨重启丢失** — skips 不进 journal（P1-5 设计，只在 `ImportBackupResult.plan` 内存）。用户中断（杀进程）在 popup 显示 skips 后、relaunch 前 → 下次 boot disclosure 丢失，conflict 静默成为 archive↔live 永久分歧。
4. **reindex dirname 严格比对** — `dirname(live) === knowledgeRoot` 字符串比对。symlink / macOS sandbox 路径前缀不同 → baseIds=0 → KB empty。

### P2（可选 / follow-up）

- **sealed 后无 watchdog** — renderer 进程死（窗口销毁未退出）则 quiesce 永久持有，无 main-side 超时清理。
- **二次 restore 清 completed journal**（BackupService L371）— B3 跨重启 disclosure 丢失（边缘）。
- **db handle leak** — resourcePlanning `archiveCorrupt` 在 `try/finally` 之外抛出 → sqlite handle 悬空到进程退出。
- **MergeEngine skill `folder_name` String 脆弱** — `String(backupRow['folder_name'])`，undefined→'undefined'。防御性 hardening（非 bug，manifest 应有效）。
- **migration 时序** — `planResources` 在 `applyMigrations` 前（readonly 连接）；当前只查 3 个 legacy 表 OK，forward-compat hazard。
- **broadcast race** — popup 在 broadcast 后才订阅 `useIpcOn` → miss event，空 fallback（罕见，popup 在 seal 前开）。

## 维度来源对照

| 发现 | workflow lens | cursor v2 | Claude 亲自 |
|---|---|---|---|
| P1-3 relaunch 卡死 | failure-paths P0 | P1 | ✅ 确认 |
| KB reindex silent | data-consistency P0×2 | — | ✅ 发现 + 确认 |
| skips 跨重启 | data-consistency P1 | — | 验证 |
| reindex symlink | data-consistency P1 | — | 验证 |
| 其余 P2 | failure-paths / integration | — | — |

## 处理

- 本地记录，**未发上游**
- P1-3 / KB reindex silent 最实际 —— 待用户决定是否拟 review comment 给 @DeJeune
- 其余 P2 follow-up（合 main 前或独立 hardening PR）
