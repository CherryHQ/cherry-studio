# Backup v2 问题总清单与修复方案

> 2026-07-31。3 个 sonnet high-effort subagent + 2 个 teammate session 交叉核实，覆盖 Merge / Quiesce / 其他维度。
> B1（identity propagation）+ a1（WindowManager hold）已 landed（commit `895b653864` + `f58336c55c` + docs `d416393891`，未 push）。本文档针对**剩余未解决问题**。

## 核心原则（贯穿所有方案）

1. **ResourcePlan 是唯一决策源**：planning = merge = journal = UI 披露，四者消费同一决策，不在各层重新推导（否则再现"plan skip / merge INSERT / promotion 移文件 / UI 不一致"）。
2. **资源策略与 DB 冲突策略绑定**：SKIP→不动资源；FIELD_MERGE→资源不覆盖；OVERWRITE→DB+资源成对决策。禁止"local metadata + backup 文件"混合实体。
3. **所有用户可见降级脱离 logger**：`logger.warn/error` 只诊断；产品披露必须进 `RestoreResultSummary` / 持久化 task。
4. **Beta 目标 = "不会静默生成坏数据"**，不是"所有策略齐全"。失败可见 > 半成品成功。

## 问题总清单

### P0（当前代码无"未修真 bug"——下面 2 项是已知设计 trade-off，需产品决策）

| 问题 | 现状 | 性质 |
|---|---|---|
| **Channel 新消息 drop**（`ChannelMessageHandler.ts:167` + `ChannelManager` 更早一层 double-drop） | restore quiesce 期间 Discord/飞书新消息静默丢失，无 replay/durable queue | 设计 open（#16849），durable queue 等 @DeJeune adapter ack |
| **Residual write paths**（`quiesceGate.ts:22-28` + `ipc.ts:185-203` File_/Cache_ 未统一 gate + main DbService 直写） | promotion fingerprint backstop 兜底，但 legacy IPC 未统一 gate | 架构接受 residual + backstop，可改进 |

### P1（真问题，按主题）

**A. 安全/质量（本地可修，不依赖上游）**：
1. terminal journal cleanup 路径越界（`restorePromotion.ts:143-156` 未用 containment guard，**安全 bug**）
2. post-seal 双重 relaunch failure 卡死（`application.relaunch` 再失败仅 log）
3. i18n 非英文 locale marker（全库 ~690 marker，backup notification + credentials_warning，数据安全流程显示英文）

**B. Merge/资源（用户问题 1）**：
4. SKILLS full 缺目录（DB row 恢复、目录缺失→skill 坏，manifest 漏校验 skills）— #16684
5. KNOWLEDGE index 静默缺失（reindex 异常只 log，existsSync 跳过重建→搜索空）— #16848
6. export 文件非一致快照（DB snapshot + live filesystem，旧 metadata+新文件/半拷贝）
7. FIELD_MERGE local-wins 静默丢（普通字段冲突不逐字段披露）
8. OVERWRITE/RENAME 未实现（用户无法选策略）
9. Notes additive local-wins（丢 backup body，无 dir-swap）
10. MCP/AGENTS directory latent（ExportOrchestrator throw）
11. external file 跨设备 dangling（row 保留无 payload，by design）

**C. Quiesce UX（用户问题 2）**：
12. 5s 固定 drain timeout（长任务 fail-closed，无分级/选择）
13. quiesce 阶段无进度反馈（a1 destroy 主窗后 ~20s Notification 不显示）
14. cancel 非 force-cancel（drain 不接 AbortSignal，seal 后无取消入口）

### P2（defer）
OOM（`.all()`）/ inverseManifest 逆序 / admitArchive fd leak / UI raw error+路径 / Windows rename durability / composite FK / generic JSON walker / content-hash dedup / orphan blob / array merge。

---

## 方案

### 模块 1：安全/质量（本地可修，~3-7h，beta 前必修）

**1.1 terminal journal containment**（0.5-1h）
- `restorePromotion.ts:143-156` `cleanupTerminalRestoreArtifacts` 复用同文件 `removeStagingTree()`（:728-736）的 path.resolve+relative containment guard，不再手写 `fs.rmSync(path.join(stagingRoot, restoreId))`。
- 测试：篡改 restoreId（`../outside` / 绝对路径）→ 拒绝删除 + outside 文件保留 + journal 保留下次重试。

**1.2 post-seal 双重 relaunch**（2-4h）
- `BackupService.schedulePostSealRelaunch` 第二次失败进 `handlePostSealRelaunchFailure`：main-process `dialog.showMessageBox`（i18n 原生错误框）+ 15s watchdog → `application.forceExit(1)`。一次性 `finished` 标志防双调。
- **不无限 retry**（relaunch 是 fire-and-exit，重复调多实例/不可观测 child）。不释放 hold/删 journal（forceExit 后进程态消失，staged journal 留下次 preboot）。
- 新 i18n keys：`backup.restore.notification.relaunch_failed_title/relaunch_failed/exit`。

**1.3 i18n marker**（1-2h）
- **改 resolver，不手改 690 marker**（translate/ 是生成产物，README 禁手改）：
  - `main/i18n/resolver.ts`：`[to be translated]:` 开头视为缺失 → fallback en-US
  - `renderer/i18n/resolver.ts`：`resourcesToBackend` loader 递归清洗 marker leaf，让 `fallbackLng: en-US` 生效
- 后续 `pnpm i18n:translate` 流程补正式翻译（10 locale 建议已备）。

### 模块 2：Quiesce（用户问题 2，~10-20d）

**2.1 Channel drop（P0）**
- **目标 B**：durable pending queue + replay。独立 live DB 的 append-only spool（`feature.backup.channelPending`），ADD+fsync 后才 ack adapter；restore 完成/cancel/boot ready 后 replay（复用 `chatQueues` 保 FIFO）。需 adapter delivery contract（`deliveryId` + `ack/retry`）—— **依赖 @DeJeune #16849**。
- **Beta 临时 A**（上游未就绪）：显式提示"restore 期间 Channel 消息不接收"或暂停 intake 让平台 retry。**绝不静默 drop**。

**2.2 Residual write paths（P0）—— 三层防线**
- 入口 gate：`quiesceGate` 升级 boolean→epoch/lease（stale lease 不能释放新 gate）；`ipc.ts` File_* mutation + `CacheService.Cache_Sync` + `LegacyBackupManager.*restore*` + `DbService.withWriteTx` 全 `assertNotBackupInProgress`。
- in-flight registry + drain：gate 前已进入的异步 writer（`trackLegacyWrite`）drain 完才 snapshot。
- fingerprint：保留 SQLite 最终 backstop（不弱化）。
- `getDb()` 不 gate（读路径 + snapshot 依赖），但 inventory 所有 `getDb().insert/update/delete` 迁移 `withWriteTx`。

**2.3 drain timeout（P1）—— 分级 soft/hard**
| Writer | soft | hard |
|---|---|---|
| Channel | 5s | 30s |
| AI stream | 30s | 2min |
| Agent turn | 60s | 10min（可配） |
| Job | 30s | handler `quiesceTimeoutMs` 默认 5min |
- soft→进度窗显示"仍在等待"+ 可继续/取消；hard→fail-closed。`AbortSignal` 中止等待不丢 batch。`deadlineAt` 绝对值防无限延长。
- embedding 不在 AiStreamManager，归 Job handler policy（不虚构独立 drain）。

**2.4 进度反馈（P1）**
- 扩展 `BackupProgressUpdate.phase` 覆盖所有 ImportOrchestrator phase（admission/quiesce/fingerprint/snapshot/stage/merge/migrate/seal/verify/journal/relaunch）。
- 新 `WindowType.BackupProgress`（`mutationCapable:false`，singleton）—— **a1 acquire 前 open**，不被 destroy。含 cancel/continue/restart 按钮，全 i18n。
- native Notification 仅 fallback（Electron Notification 跨平台 action 不一致，不能当主控面）。
- `BackupService` 存 `lastRestoreProgress` + `backup.restore_progress` IPC（late subscriber）。

**2.5 cancel（P1）—— 状态机**
- 普通 cancel = 取消 restore 编排，**不 abort 业务任务**（AI/Agent/Job 继续跑完）。
- drain 接 AbortSignal，abort 后不进 snapshot，进 cancel cleanup。
- **a1 后 cancel 必须 relaunch**（主窗已 destroy 不复活）。sealed 后 cancel=false（journal commit 不可逆）。
- force-cancel（abort AI/Agent/Job）是单独高级操作，非默认。

**beta 交付顺序**：residual gate+lease → drain signal+分级 timeout → cancel 状态机 → progress window → Channel 临时 A → durable B（目标）。

### 模块 3：Merge/资源（用户问题 1，~15-30d）

**3.1 SKILLS full 缺目录（P1）—— fail-closed**
- full preset 遇 zip/local skill 缺目录 → `ExportOrchestrator` throw `BackupResourceIncompleteError`，不生成 archive。`assertFullResourceManifestSets` 只校验 `source IN ('zip','local')`（builtin/marketplace 可重下载不校验）。旧 `degraded=skill-dir-missing` archive admission 拒绝。
- lite 继续 schema-only omission（显式）。

**3.2 KNOWLEDGE index（P1）—— backupIndexStore task（C，对齐 #16848）**
- 删 `existsSync(index.sqlite)` 完成判定。`backupIndexStore` 作为 reindex 状态唯一入口（`{restoreId,baseId,sourceFingerprint,state,attempts,lastError}`）。
- 失败进 `RestorePostRestoreTask`/degradation（`knowledge_index_rebuild_failed`），UI 显示"内容已恢复，索引构建中/失败可重试"，不显示"完全成功"。
- **若 #16848 beta 前来不及 → 临时 A 禁用 KNOWLEDGE full restore**（不继续 logger-only）。

**3.3 Export 文件一致性（P1）—— A quiesce + B hash verify**
- A：`startBackup` 进 snapshot 前获 resource quiesce hold（`assertFileMutationAllowed`），盖 File_/Knowledge/Skill/Notes 写入。
- B：`SqliteFileStager` 加 `copyFileVerified/copyDirectoryVerified/hashResource`——copy 前/后 stat+hash，source 变化→abort，半拷贝不进 archive。
- C（后续）：manifest checksums + filesystem snapshot layer。

**3.4 FIELD_MERGE local-wins（P1）—— 字段级披露**
- 新 `FieldConflictDisclosure{table,entityKey,field,resolution}`（不携带原值，特别 credential/token）。`MergeResult.fieldConflicts` 进 durable `RestoreResultSummary`。UI 摘要+可展开详情。
- remote-wins policy（23 列）**需产品确认**后加 contributor policy；逐字段选择器 defer。

**3.5 External file（P1）—— 显式披露**
- manifest 加 `files.externalCount`（不写绝对路径）。引用 external row 时披露 `external_file_payload_not_included`（不显示原 path）。未来用户手动 relink（不自动访问 archive 路径）。

**3.6 OVERWRITE/RENAME（defer，7-12d）**
- beta 继续fail-loud + 稳定错误码 `BACKUP_MERGE_STRATEGY_UNSUPPORTED`，UI 不暴露入口。
- 后续：`strategyByAggregate`（非全局）+ 统一 `ConflictDecision`（DB+资源成对）+ scanAggregates 实现 + resourcePlan + restorePromotion 目录 kind。

**3.7 Notes dir-swap（defer，上游）**
- beta 继续 additive/local-wins + `skips` 披露。目录级 `notes-tree-swap` 需上游扩 kind + manifest treeHash + restorePromotion near-atomic swap + Notes writer quiesce。

**3.8 MCP/AGENTS directory（defer）**
- 继续 fail-loud + `BACKUP_RESOURCE_UNSUPPORTED` 稳定码。contributor 不发 descriptor，当前 latent。

---

## Beta 前必修 vs Defer

**🔴 Beta 前必修**（不依赖上游，本地可修）：
- 安全 3 项（containment / 双 relaunch / i18n resolver）—— ~3-7h
- SKILLS full fail-closed —— 1-2d
- Export quiesce+hash —— 3-5d
- FIELD_MERGE 字段披露 —— 2-3d
- External 披露 —— 1-2d
- Quiesce：residual gate+lease + drain signal+分级 timeout + cancel 状态机 + progress window —— ~10d

**🟠 依赖上游/产品决策**：
- KNOWLEDGE backupIndexStore（#16848 @eeeee0717）—— 或 beta 临时禁用
- Channel durable queue（#16849 @DeJeune adapter ack）—— beta 临时 A 显式提示

**🟢 Defer**：OVERWRITE/RENAME / Notes dir-swap / MCP-AGENTS / Channel durable B / filesystem snapshot layer / P2 全部

---

## 产品决策点（需你定）

1. **Channel drop（beta）**：接受临时 A（显式"不接收"提示）先上，还是 block beta 等 @DeJeune durable queue？
2. **KNOWLEDGE（beta）**：等 #16848 backupIndexStore，还是临时禁用 KNOWLEDGE full restore（不继续 logger-only）？
3. **FIELD_MERGE remote-wins policy**：23 列（name/orderKey/isEnabled 等）哪些 remote-wins？需产品确认（涉及 Provider API 配置、Agent runtime state 等）。
4. **drain hard timeout 上限**：Agent turn 10min / Job 5min 可接受？还是更短/更长？
5. **progress window 形态**：独立 BrowserWindow（mutationCapable:false）vs 纯 Notification+系统托盘？前者可交互 cancel/continue，后者轻但不可靠。

## 验收标准（beta 前）
- 越界 restoreId 永不删 stagingRoot 外文件
- 双 relaunch failure 必退出（不卡死）
- 任意 locale marker 不直接显示
- SKILLS full 缺目录不生成成功 archive
- KNOWLEDGE 不用 existsSync 判完成，失败可见可重试
- export 期间应用内文件 writer 被 gate，半拷贝 abort
- FIELD_MERGE 每个差异字段结构化披露（无 credential 原文）
- external payload 未包含被明确提示
- restore cancel 可用（a1 后 relaunch，sealed 不可 cancel）
- quiesce/全阶段进度可见
