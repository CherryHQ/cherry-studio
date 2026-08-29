# Backup v2 剩余问题解决规划（Roadmap）

> 2026-07-31。综合 2 个 sonnet high-effort subagent 深度代码调查 + 主方案 + 2 轮 cursor 对抗 review。
> 安全/质量（模块 1）已全完成（9 commit `578de5c92b..8e7ca02e46`，未 push，2 轮对抗 review 无 high/medium）。
> 本文覆盖剩余 **10 项 beta 前必修**，分 Merge/资源（用户问题 1）+ Quiesce（用户问题 2）+ 2 个 P0 设计项。

## 总览

| # | 问题 | 维度 | 优先级 | 工时 | 依赖 |
|---|------|------|--------|------|------|
| 1 | SKILLS full 缺目录 fail-closed | Merge | P1 | 1-2d | 本地 |
| 2 | KNOWLEDGE index 静默缺失 | Merge | P1 | 1-3d 或 0.5-1d(禁用) | #16848 @eeeee0717 |
| 3 | Export 文件一致性（quiesce+hash） | Merge | P1 | 3-5d | 依赖 #6 |
| 4 | FIELD_MERGE 字段级披露 | Merge | P1 | 2-3d | 产品 remote-wins |
| 5 | External file 披露 | Merge | P1 | 1-2d | 本地 |
| 6 | Residual write paths（gate+lease+registry） | Quiesce | **P0** | 5-10d | 本地 |
| 7 | Channel drop | Quiesce | **P0** | 0.5-1.5d(A)/1-2周(B) | #16849 @DeJeune |
| 8 | drain timeout 分级 | Quiesce | P1 | 5-8d | 产品 hard timeout |
| 9 | 进度反馈（BackupProgress window） | Quiesce | P1 | 5-8d | 产品 window 形态 |
| 10 | cancel 状态机 | Quiesce | P1 | 5-8d | 依赖 #6/#8 |

**总工时**：本地 beta 前 ~28-50d（4-7 周）。

---

## Merge/资源（用户问题 1）

### 1. SKILLS full 缺目录 fail-closed（#16684）

- **现状**：full preset 遇 zip/local skill 缺目录，`stageSkillDirs()` 返 `missing`，ExportOrchestrator 写 `manifest.degraded.resources`（`skill-dir-missing`）**仍生成 archive** → restore DB row 恢复但目录缺 → skill 坏（半成品）。`assertFullResourceManifestSets()` 只校验 files/knowledge，漏 skill exact-set。
- **方案**：full 缺目录 → `ExportOrchestrator` throw `BackupResourceIncompleteError`；`assertFullResourceManifestSets()` 加 zip/local skill exact-set（builtin/marketplace 可重下载不校验）；admitArchive 拒旧 `skill-dir-missing` full archive；lite 继续 schema-only omission。
- **依赖**：本地。需确认 builtin/marketplace 重下载 + 旧 archive 兼容。
- **工时**：1-2d
- **测试**：full 缺目录 reject、exact-set match、admitArchive 拒旧、lite 不阻塞、builtin/marketplace 不误伤、roundtrip
- **风险**：只在 admission 拒（不在 export）仍让用户存坏 archive；exact-set 不分 source 误伤可重下载 skill

### 2. KNOWLEDGE index 静默缺失（#16848）

- **现状**：`BackupService.onAllReady()` 对每 base `existsSync(indexPath)` 存在即 skip（空/损坏/错版本也跳）；`reindexItems()` 只 `jobManager.enqueue`（等"已入队"非"已完成"）；reindex 异常 logger-only，无 durable task/summary/重试。**无 `backupIndexStore`/`knowledge_index_rebuild_failed`/`RestorePostRestoreTask`**。
- **方案**：删 existsSync 完成判定；`backupIndexStore`（`{restoreId,baseId,sourceFingerprint,state,attempts,lastError}`）作唯一状态源；失败 → `RestorePostRestoreTask`/degradation（`knowledge_index_rebuild_failed`），UI "内容已恢复，索引构建中/失败可重试"；sourceFingerprint 变不复用旧 index。**#16848 beta 前来不及 → 临时禁用 KNOWLEDGE full restore**（不继续 logger-only）。
- **依赖**：#16848 @eeeee0717 backupIndexStore/task 设计
- **工时**：1-3d（上游落地）/ 0.5-1d（临时禁用）
- **测试**：空/损坏/fingerprint 不匹配重建、enqueue 不 completed、失败 summary 可见、重启重试、多 base 部分失败、幂等、用户重试
- **风险**：只改存在性判断不够；job 创建文件 ≠ 内容完整可搜

### 3. Export 文件一致性（quiesce + hash verify）

- **现状**：export 顺序 = VACUUM INTO DB snapshot → 读 metadata（从 snapshot DB）→ **文件/knowledge/skill/notes 从 live filesystem 读**。无 resource quiesce hold、无 copy 前后 stat/hash、无 `assertFileMutationAllowed`。→ snapshot DB metadata 与 staged bytes 可能不一致（旧 metadata+新文件/半拷贝/目录复制期间被改）。
- **方案**：A：`startBackup()` snapshot 前获 resource quiesce hold（盖 File/Knowledge/Skill/Notes）— **依赖 #6 residual gate 基建**。B：`SqliteFileStager` 加 `copyFileVerified`/`copyDirectoryVerified`/`hashResource`（前后 stat+hash，source 变 → abort，半拷贝不进 archive）。C（defer）：manifest checksums + filesystem snapshot layer。
- **依赖**：File/Knowledge/Skill/Notes writer inventory；#6 residual gate（共享 gate/drain）
- **工时**：3-5d
- **测试**：writer gate/排队、已进入 writer drain、source 替换/截断/修改 fail、目录复制期间改 fail、半拷贝清理、staged 与 metadata 对齐、symlink/外部进程 fail-closed
- **风险**：writer inventory 不全留 residual；无进度用户以为卡死；hash 大文件耗时

### 4. FIELD_MERGE 字段级披露

- **现状**：字段策略 remote-fills-local-null/empty、deep-merge、local-priority。local/backup 都非空且不同时普通字段保 local **无 disclosure**。只有 deep-merge type conflict 进 `field_conflict`（table/count/reason，无 entity/field）。`RestoreResultSummary` 无字段冲突列表。credential 不泄露因 summary 不携原值。
- **方案**：`FieldConflictDisclosure{table,entityKey,field,resolution}`（不携原值，credential/token/apiKey 只 table/entity/field/resolution）；`MergeResult.fieldConflicts` 进 durable `RestoreResultSummary`，UI 摘要+可展开；保留 deep-merge 兼容。remote-wins 23 列 **需产品确认**；字段级选择器 defer。
- **依赖**：产品 remote-wins 确认；稳定脱敏 entity key；renderer summary/UI/i18n
- **工时**：2-3d（后端 1-2 + UI 1-2）
- **测试**：普通 scalar 冲突 disclosure、local 值不变、多字段聚合、credential 不含原值、deep-merge 兼容、journal 与 MergeResult 一致、旧 journal 兼容、entity key 脱敏
- **风险**：entity key 含敏感；内部 reason 暴露 UI 泄数据；未确认 remote-wins 不改 local-wins 语义

### 5. External file 披露

- **现状**：external row 只保留 schema + 绝对 `externalPath`，payload 不复制（dangling by design）。manifest 无 externalCount/disclosure。summary 无 `external_file_payload_not_included`。
- **方案**：manifest 加 `files.externalCount`（不含路径）；引用 external row 时披露 `external_file_payload_not_included`（不显绝对 path）；不自动访问旧路径；未来用户手动 relink。保留 dangling row（除非产品要求 prune）。
- **依赖**：产品确认"保留 dangling + 提示"；externalCount 统计口径
- **工时**：1-2d
- **测试**：externalCount 准确、summary 聚合、不含 externalPath、跨设备 row 保留+提示、不触发 blob staging、dedup 保持、export 不误删 schema row
- **风险**：externalPath 泄本机路径；统计口径过报/漏报

---

## Quiesce（用户问题 2）

### 6. Residual write paths（P0）

- **现状**：`quiesceGate.ts:22-28` 模块级 boolean，无 owner/epoch/lease/stale 保护。已覆盖 IpcApiService 非 backup.* mutation、PreferenceService、部分 legacy restore。**绕过**：`ipc.ts:185-203` File IPC（Save/Write/Move/Rename/Mkdir）、`CacheService.Cache_Sync`、`DbService.getDb()` 直写、`withWriteTx()` 不查 gate、gate 前进入的异步 writer 无 in-flight registry。fingerprint 是 fail-closed backstop（但写入后才发现，不阻 filesystem/gate 后写入）。
- **方案（三层防线）**：
  - L1 入口 gate：boolean → epoch/lease（acquire 返唯一 lease，release 匹配，stale 不清新 gate）；统一保护 mutation File IPC + Cache_Sync + legacy + withWriteTx + inventoried direct DML；`getDb()` 不整体 gate（读/snapshot 依赖）但 direct DML 全迁 withWriteTx
  - L2 in-flight registry：gate acquire 前停 admission → 等已进入 writer 完成 → drain 完才 fingerprint/snapshot
  - L3 fingerprint backstop：保留不弱化，drift → fail-closed
- **依赖**：本地。需确认"所有 live DB mutation 经 protected 写入口" + filesystem writer 同 quiesce contract + 未纳入 gate 的 legacy writer 是否 beta blocker
- **工时**：5-10d（gate 1-2 + 接线 1-3 + DML inventory 2-4 + registry/drain 2-4 + 测试 1-2）
- **测试**：gate 未持正常、持时 File/Cache/withWriteTx 拒、direct DML inventory 全覆盖、writer 入场 registry drain、并发无 snapshot race、stale lease 不清新 gate、fingerprint drift fail-closed、restore work DB 写不被 live gate 阻
- **风险**：只 gate withWriteTx 漏 direct DML 虚假安全；全局 gate 阻 restore 内部 live DB 操作；registry 漏 fire-and-forget 仍 race；lease 错误永久 gate

### 7. Channel drop（P0）

- **现状**：adapter EventEmitter 发 message/command；ChannelManager + ChannelMessageHandler **两层** quiesce 时 warning + return（不创 batch/不 AI run）。pause() 只 flush 已存 debounce batch。内存 pendingBatches/chatQueues，**无 durable queue**。adapter 无 deliveryId/ack/retry。
- **方案**：目标 B：durable pending queue（独立 live DB append-only spool `feature.backup.channelPending`）+ ADD+fsync 后才 ack + restore 完成/cancel/boot replay（复用 chatQueues FIFO）+ deliveryId 幂等。**依赖 #16849 @DeJeune adapter ack contract**。Beta 临时 A（B 未就绪）：显式提示"restore 期间不接收"或暂停 intake 让平台 retry。**绝不静默 drop**。
- **依赖**：#16849 @DeJeune（deliveryId/durable ack/retry/duplicate/ack 超时/断线）
- **工时**：A 0.5-1.5d；B 本地 5-10d + adapter 对接 3-5d（~1-2 周）
- **测试**：quiesce 前正常、quiesce 后进 spool 不丢、spool 写失败不 ack、ack 后崩溃重启幂等、adapter 重试同 deliveryId、多消息 FIFO、replay 中途失败保留、cancel/complete/boot 三触发点、双层入口不静默 drop、adapter 断线/ack 超时/重复/DB 损坏
- **风险**：ack 早于 durable append 丢消息；replay 失败误重复 AI run；deliveryId 不一致破幂等；spool 与主 DB 生命周期不一致

### 8. drain timeout 分级（P1）

- **现状**：`BackupService.startRestore()` 对 Channel/AI/Agent/Job **统一 5000ms** drain。各 writer 行为不同。**无统一 AbortSignal**。Job 有 `JobContext.signal`+handler timeout 但未接 restore drain。`AiService.embedMany` 不经 AiStreamManager（归 Job handler policy）。
- **方案**：writer-specific soft/hard + absolute deadline：

  | Writer | soft | hard |
  |---|---|---|
  | Channel | 5s | 30s |
  | AI stream | 30s | 2min |
  | Agent turn | 60s | 10min（可配）|
  | Job | 30s | handler 默认 5min |

  soft → 进度窗显示等待对象/数量/已等 + 可继续/取消；hard → fail-closed。AbortSignal 中止等待不丢 batch。普通 cancel 不 abort 业务任务；force-cancel 另设计。embedding 归 Job handler。
- **依赖**：本地。产品确认 Agent 10min/Job 5min；soft timeout UI 动作；embedding 归属
- **工时**：5-8d（API signal/deadline 2-3 + 分级 2-4 + 兼容 2-3 + 测试 1-2）
- **测试**：soft 前完成、soft 后继续成功、hard fail-closed、deadline 不延长、Channel straggler 不强丢、cancel 只 abort restore 不 abort 业务、Job signal 组合、多 writer 同时超时 UI 披露
- **风险**：hard 太短误判长任务；太长用户以为卡死；signal 叠加错优先级；只加 timeout 无进度仍感知差

### 9. 进度反馈（P1）

- **现状**：`BackupProgressUpdate.phase` 主要覆盖 snapshot/merge/seal 少数阶段，漏 admission/quiesce/fingerprint/stage/migrate/verify/journal/relaunch。native Notification 跨平台 action 不一致。a1 后主窗 destroy → renderer 进度组件不可靠。无 lastRestoreProgress、无 backup.restore_progress late subscriber。
- **方案**：新 `WindowType.BackupProgress`（mutationCapable:false，singleton），**a1 acquire 前 open** 不被 destroy；含 cancel/continue/restart；全 i18n。扩展 `BackupProgressUpdate.phase` 覆盖 ImportOrchestrator 全阶段。BackupService 存 `lastRestoreProgress` + `backup.restore_progress` IPC（late subscriber）。native Notification 仅 fallback。progress IPC 属 backup.* 不被 mutation gate 阻。
- **依赖**：本地。产品确认独立 BrowserWindow vs Notification
- **工时**：5-8d（WindowManager 1-2 + schema/IPC 1-2 + renderer/i18n 2-3 + 全阶段接线 1-2）
- **测试**：a1 前 open、主窗 destroy 后存在、全 ImportPhase 对应 progress、late subscriber、完成/失败/cancel/relaunch 状态、mutationCapable false、quiesce 期间 IPC 可用、locale 不显 marker、崩溃/relaunch 不泄 hold
- **风险**：新窗口 lifecycle/关闭顺序/relaunch 竞态；progress 频繁 IPC 噪音；窗口暴露 mutation 重新引入 residual

### 10. cancel 状态机（P1）

- **现状**：`BackupService.cancel(backupId)` 主要 abort active restore operation。ImportOrchestrator 只 pipeline boundary 查 cancellation。drain 不接统一 AbortSignal，cancel 在 drain 仍等 5s。cancel 不中断已运行 AI/Agent/Job。a1 后主窗 destroy 需 relaunch。sealed 后 journal 不可逆无取消入口。force-cancel 无独立状态机。
- **方案**：普通 cancel = 取消 restore 编排（drain 接 signal、不进 snapshot、不丢 Channel pending、不强制终止 AI/Agent/Job、进 cleanup；a1 后 cancel 必须 relaunch；sealed 后禁止 cancel）。force-cancel（defer）：明确向 AI/Agent/Job abort + cleanup + 记录；不默认作普通 cancel fallback；无法证明一致则 fail-closed + relaunch。
- **依赖**：本地。依赖 #6/#8；产品确认 cancel 是否继续等业务任务、a1 后自动 relaunch、sealed 禁止、force-cancel 进 beta
- **工时**：普通 cancel 5-8d（状态机 2-4 + drain signal/cleanup/relaunch 2-4 + UI 1-2）；force-cancel 另 3-7d
- **测试**：各 phase cancel、seal 后禁止、a1 后 hold+relaunch、不写 staged journal、业务任务符合产品定义、重复幂等、崩溃后 gate/hold/active 不残留
- **风险**：普通 cancel 误 abort 业务任务半写入；a1 后不 relaunch 无主窗；seal 后允许 cancel 状态不一致；用户混淆"restore 取消"与"后台任务停"

---

## 依赖关系

- **Export 一致性（#3）的 resource quiesce 共享 #6 residual gate/drain 基建** → 先做 #6
- **cancel（#10）依赖 #6 gate + #8 drain signal** → 在 #6/#8 后
- **进度窗（#9）是 #8 soft timeout + #10 cancel 的 UI 载体** → 配合 #8/#10
- **KNOWLEDGE（#2）依赖 @eeeee0717 #16848**
- **Channel durable（#7B）依赖 @DeJeune #16849**

## 建议交付顺序（分阶段）

**阶段 1 · Merge 快项（本地，~5-8d）**：#1 SKILLS → #5 External → #4 FIELD_MERGE（需产品 remote-wins）

**阶段 2 · Quiesce 核心正确性（本地，~10-18d）**：#6 Residual gate（基建）→ #8 drain 分级（需产品 hard timeout）→ #10 cancel

**阶段 3 · 可观测性 + Export 一致性（本地，~10-18d）**：#9 进度窗（需产品 window 形态）→ #3 Export quiesce+hash（依赖 #6）

**阶段 4 · 上游依赖项**：#2 KNOWLEDGE（等 #16848 或禁用）→ #7 Channel 临时 A → durable B（等 #16849）

## 产品决策点（需你定）

1. **Channel drop（beta）**：临时 A（显式"不接收"提示）先上，还是 block beta 等 @DeJeune durable queue？
2. **KNOWLEDGE（beta）**：等 #16848 backupIndexStore，还是临时禁用 KNOWLEDGE full restore（不继续 logger-only）？
3. **FIELD_MERGE remote-wins 23 列**：哪些 remote-wins？（涉 Provider API 配置、Agent runtime state）— 或 beta 全 local-wins + 只披露？
4. **drain hard timeout 上限**：Agent 10min / Job 5min 可接受？
5. **progress window 形态**：独立 BrowserWindow（mutationCapable:false，可 cancel/continue）vs 纯 Notification+托盘？
6. **beta 范围 + 排期**：全做（4-7 周）还是分阶段先上阶段 1+2（核心正确性）？

## Beta 验收标准

- 越界 restoreId 永不删 stagingRoot 外文件 ✅（已做）
- 双 relaunch failure 必退出 ✅（已做）
- 任意 locale marker 不直接显示 ✅（已做）
- SKILLS full 缺目录不生成成功 archive
- KNOWLEDGE 不用 existsSync 判完成，失败可见可重试（或禁用）
- export 期间应用内文件 writer 被 gate，半拷贝 abort
- FIELD_MERGE 每个差异字段结构化披露（无 credential 原文）
- external payload 未包含被明确提示
- residual write paths 统一 gate（File/Cache/DbService）
- drain 分级 timeout + 可 cancel
- restore cancel 可用（a1 后 relaunch，sealed 不可 cancel）
- quiesce/全阶段进度可见
- Channel 不静默 drop（临时 A 或 durable B）
