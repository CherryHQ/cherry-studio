# CherryV2 Backup v2 Rollout — 全景 Review 文档

> **目的**：架构 / 实现 / 测试 review 的单一信息源。读完即可对照代码 review。
> **分支**：`feat/backup-v2-merge-impl`（HEAD `abfa238357`，origin 已同步）
> **日期**：2026-08-02
> **方案定位**：**merge 方案**（增量合并 backup 进 live DB），非 #17499 whole-db replacement。
> **状态**：本地 rollout 完成；27 commit；双 adversarial review 闭环（review-partial + drift-check）；剩余全等上游协调。
> **冻结设计来源**：`docs/references/backup/backup-architecture.md`（楠总 @0xfullex，2026-06-19 doc-approved，2026-06-20 解冻 surgical）。
>   `ef1ae2cbc`（"docs(backup): clarify manifest and step-0 version gate readability"）只是文档澄清，**不是架构本身**。

---

## 1. 执行摘要

Backup v2 是 CherryV2 的**增量合并式**备份恢复：导出产 `.cherrybackup`（manifest + backup.sqlite + files/knowledge/skills），恢复经 admission gate 校验 → 合并进 work.sqlite → 原子提升替换 live。

本地 rollout 已覆盖所有不依赖上游决策的工作：

| 维度 | 状态 |
|---|---|
| 节点 0 安全 | ✅ done |
| 节点 1 correctness/hardening/e2e | ✅ done |
| 节点 2 follow-ups | 🔄 partial（D8 MCP scan / D6 框架落地；D5/D8-Notes/B4/B2 阻塞） |
| 节点 3 upstream TBD | 🔄 partial（A4/B17/B18/B6/B12/B14 落地；SLA/contract 阻塞） |
| 节点 4 验证 | 4.1 ✅；4.2-4.4 ⛔ blocked |
| 提交链 | 27 commit（`b4ddaff793`→`abfa238357`，10 主题组） |
| adversarial review | review-partial（2 轮 6 finding，唯一真 bug = D8 已修）+ drift-check（无新漂移） |

**结论**：本地无更多可推进项。剩余 10 项上游阻塞（@0xfullex / @DeJeune / @eeee0717）。

---

## 2. 架构设计（冻结核心）

> 严格区分 4 层（见 §2.7），避免把"现实现"或"已撤回 overhaul"误当冻结契约。

### 2.1 设计来源与冻结状态

- **原始蓝本**：`docs/references/backup/backup-architecture.md`（75KB）。2026-06-19 doc-approved，2026-06-20 解冻（允许 surgical 改动）。
- **`ef1ae2cbc`**：commit subject = "docs(backup): clarify manifest and step-0 version gate readability"——**仅 manifest 与 step-0 version gate 的文档澄清**，不是架构重写。记忆 [[backup-architecture-frozen-baseline]] 指向的"冻结蓝本"即此文件。
- **matrix**：disposition matrix `D1-D11 / A1-A4 / B1-B18 / C1-C8` 是唯一权威节点映射（`backup-v2-disposition-matrix.md`）。forward-plan / node-details / matrix 三文档同集合，禁 ID 漂移。
- **方案定位**：merge 方案。#17499（beta 主线）supersede merge beta，但 merge 是否 beta 后重启由**决策点 0**（产品 gate A/B/C）决定；gate 前 merge 仅只读规划 + 0G 安全项。

### 2.2 威胁模型（§3）

恢复**第一步是 manifest admission gate**（先于 RESTORE BARRIER、不碰 live DB）：

- **archive admission（strict）**：`backupFormatVersion` major bump → 拒绝；`schemaMigrationId` 按 migration `when/folderMillis` 做 exact / prefix / fork 判定，老备份只在独立 client migrate-forward，跨分支/损坏拒绝并保 live 原状；zip-slip lexical containment、entry count/size/ratio、manifest 资源绑定、strict Zod。
- **SQLite fingerprint**：`checkpoint TRUNCATE + busy==0 + SHA-256 主文件`（`fingerprintProducer.ts:32` + `checkpoint.ts:13-24` + `hashDbFile.ts:12-15`），staging 与 promotion 两侧对称复核。
  - ⚠️ **原始蓝本 fingerprint 只盖主 DB**，不是 DB-FS combined；overhaul **D2 combined fingerprint 已撤回**。现行 FS 侧加固只保留 **per-resource contentHash admission**（防坏 archive）。
- **安全三件套**：
  1. **RESTORE BARRIER**：partial quiesce + renderer mutation gate，跨 snapshot→files→DB→promote 全程。
  2. **安全文件提升 rollback**：integrity / fsync / atomic rename，清 WAL/SHM。
  3. **6 态 durable journal + on-boot reconcile + completed gate**。
- **A3 marker reconcile**：已收敛为 **inverse 失败不 finalize**（保留 promoting + filesystem probe reconcile）。A3-a **不新增 durable marker**；marker failure/方向 durable marker 是旧 overhaul 契约缺口，**不当冻结要求**。

### 2.3 合并模型（§5.4 identity propagation）

**不是 uuid id remap，是 identity propagation**：

- natural-key target FIELD_MERGE 时建立 `backup target id → local canonical id`；source 的 owning/required DB FK 与 required JSON soft-ref **必须改写**；optional 可保留/SET_NULL 但**不得悬空**；tolerant file refs 不改写，缺失仅降级 + orphan 检测；junction 依 FK cascade。
- 源 PK 保留、重复恢复幂等。
- **策略**：uuid-entity 默认 `SKIP`；natural-key/slot 默认 `FIELD_MERGE`；显式 `RENAME` 仅 renamable（否则退化 SKIP + 告知）；显式 `OVERWRITE` 以 backup 为准（按 identityKey upsert / 行级覆盖，local-only 成员保留，不做差集删除）。
- ⚠️ **原始蓝本没有 "INSERT" 或 "tupleKey" 字面量**——`MergeEngine` / `tupleKey` 长度前缀是**现实现**。matrix **B3** 已证明：全库唯一 composite FK = `knowledge_item` self-FK 指向 uuid PK，`MergeEngine.ts:1399` 跳过无害，**无真实 composite FK target 场景，不做 tuple map 重构**，仅修单列 propagation。
- ⚠️ **D4 immutable decision graph / tuple map 已撤回**，不当冻结核心。

### 2.4 贡献者模型（§6-7）

- 每域一个 `BackupContributor`：Entity facts（tables/refs/PK/aggregate/file-ref/JSON refs）与 policy（omitted overrides / uniqueMerge / fieldMerge）和 operations **分层**。
- `ContributorManager` 收静态 contributors → 启动 `finalize` 校验 **25 invariants**（纯内存、不连 DB）→ `BackupRegistry` 供 Export/Import；失败启动中断并带 domain/table/owner/invariant。
- **hooks**：`collectFileResources`（导出前）/ `beforeArchive`（只改备份副本）/ `transformRow`（导入前，可返回 null）/ `afterImport`（域导入后，FTS）/ `restoreResources`（DB 导入前、事务外）/ `cloneAggregate`（仅 renamable RENAME）。SKIP root 不调用 members transformRow。
- **资源 archive** = manifest + backup.sqlite + files + knowledge。
- ⚠️ `restoreResources` 是 **§9 paper-contract**：promotion 走 journal `fileResources`，**不接 per-contributor runtime hook**。
- ⚠️ **KNOWLEDGE backupIndexStore 是 #16848 follow-up**（替代 existsSync completion 判定；B11 处置为 backupIndexStore；SKILLS full 缺目录 fail-closed）。**原 `ef1ae2cbc` 蓝本未定义该 store**——仅 5 文档提到。

### 2.5 提升状态机（§9）

`journal` 是 durable **6 态** + atomic sibling tmp/fsync/rename + on-boot reconcile/completed gate。

**§9 流程**：admission → quiesce/barrier → `VACUUM INTO` pre-snapshot → 事务外 restoreResources/file staging → `withWriteTx` 仅 DB rows → promotion atomic rename。

- 失败：checkpoint/close/integrity/fsync/rename 恢复 live DB + 删 WAL/SHM，支持 aside undo。
- A3 inverse failure **不能 finalize**，保留 promoting 等 reconcile。
- **B5 sealed quiesce/hold 必须持到 process exit/relaunch**，`onStop` 不可释放。
- **a1 WindowManager hold 与 dispatcher drain 并存**：a1 摧毁 mutation-capable renderer/window、禁止 resume warm mutation-capable window；drain 必须覆盖 DataApi/Preference/IpcApi in-flight 及 legacy File_/Cache_ gates；native notification/auto-relaunch，**不建 BackupProgress BrowserWindow**（D7 撤回）。
- undo 走同一 quiesce/promotion gate，aside→live 零拷贝；retention/expired/GC 数值 TBD。

### 2.6 关键不变量（25 finalize + §9 摘要）

每域恰一 contributor；每用户数据表恰一 owner（或有事实+reason 排除）；infra/ALWAYS_STRIP 不归 contributor；job row-scope 穷尽；每 source ref owner、每 DB FK 反向有声明；PK fact/codegen 列存在、禁 ambiguous/autoincrement；依赖图无环；FileRefSourceType 有 owner/排除；JSON soft refs 全分类；aggregate root owner、identityKey=PK 或业务 UNIQUE；members 仅域内 owning include refs 指向该 root（junction/跨聚合不算），parent 链无环；renamable 必须 cloneAggregate；ReferenceKind 与 FK onDelete 一致，NOT NULL 不可 SET_NULL；natural-key/slot conflictDefault 不得 SKIP；schema 深冻结/错误带定位；**恢复只增不删、保留 local-only**；SKIP 整聚合且重复恢复幂等；required identity refs 不得悬空；restore transaction `defer_foreign_keys + foreign_key_check`，OVERWRITE 不删 parent、仅 upsert；**文件 IO 不可放 withWriteTx**；snapshot 失败必须阻塞；symlink 不得越出 root；manifest/version/hash/admission 失败必须 fail-closed；sealed hold 直到 promotion/process exit；inverse 失败不得 terminalize/finalize，必须 reconcile；promotion journal durable/completed gate，recoverOnBoot 先于 migrateDb。

### 2.7 四层严格区分（review 必读）

| 层 | 内容 | review 态度 |
|---|---|---|
| **① 冻结核心** | 原始蓝本 + matrix D/B/A/C ID + 25 invariants + §9 | 不可违反 |
| **② 现实现** | MergeEngine / tupleKey 长度前缀 / INSERT 路径（蓝本无字面量） | 实现细节，可重构 |
| **③ 已撤回 overhaul** | D2 DB-FS combined fingerprint / D4 immutable decision graph + tuple map / marker failure·方向 durable marker | **不当冻结要求**，勿当契约查 |
| **④ follow-up** | KNOWLEDGE backupIndexStore（#16848）/ D8 MCP·AGENT full staging / OVERWRITE·RENAME strict replace / Notes dir-swap / B16 hooks / undo retention 数值 | 未落地，待 owner |

---

## 3. 实现地图

### 3.1 端到端主流程

```
ExportOrchestrator.exportBackup (ExportOrchestrator.ts:175-447)
  → dbService.createSnapshot (VACUUM INTO backup.sqlite)
  → FULL/LITE strip + rowScopes, snapshot readonly collect
  → SqliteFileStager stage files/knowledge/skills/notes
  → pruneMissingRows + VACUUM
  → assembleArchive (manifest+sqlite+files into zip, 0600, fsync, atomic)

admitArchive (admitArchive.ts:135-237)
  → 建 0700 workDir, catalog 全 entry (zip-slip/count/size/ratio)
  → manifest format + lite/full invariants, 资源绑定校验
  → bounded stream 解包, chain compare / migrate-forward / integrity_check
  → 返回 ArchiveContext

ImportOrchestrator.importBackup (ImportOrchestrator.ts:222-455)
  → admission → a1 hold + BACKUP_IN_PROGRESS + writer pause/drain (BackupService.ts:450-567)
  → capture fingerprint (fingerprintProducer.ts:32)
  → snapshot work.sqlite → planResources
  → MergeEngine.mergeBackupIntoWork
  → MCP non-throwing scan (missingLocalResourceScan.ts)
  → migrate / readAppliedChain exact chain → seal / no WAL
  → 2nd fingerprint → write staged journal (summary/resources)

restorePromotion.runRestorePromotion (restorePromotion.ts:109-136)
  → gate → staged/promoting recovery
  → promoteStaged (286-308): add-conflict + seal sidecars + fingerprint + chain prefix
  → executeForward (479-530): step markers
      gate → additive files → remove live sidecars → live aside
      → work rename live → apply file entries → integrity
  → failure rollback/revert; finalize terminal + remove staging
```

### 3.2 模块地图（file:line anchors）

| # | 模块 | 路径 | 职责 |
|---|---|---|---|
| 1 | ExportOrchestrator | `ExportOrchestrator.ts:147/175/189-243/322-445` | preset topo, snapshot, strip/rowScope, readonly DB collect, staged sets, missing-row prune, final VACUUM, manifest+archive |
| 2 | SqliteFileStager | `SqliteFileStager.ts:135/142-259/261-356/360-495/498-569` | files（snapshot rows, internal only, chunk 500, lexical+realpath containment）/ knowledge（excl `.cherry` index）/ skills（`computeSkillContentHash` 校验）/ notes（containment/relpath） |
| 3 | archive | `archive.ts:101-264` | manifest+backup.sqlite+trees into zip, warning fail-closed, bounded temp, fsync, atomic hardlink/copy exclusive no-clobber or rename overwrite, 0600 |
| 4 | admitArchive | `admitArchive.ts:135-237/243-299/301-373/516-584/587-705` | preflight all entries, bounded extraction, manifest declaration binding/zip-slip, chain classify+migrate+integrity |
| 5 | ImportOrchestrator | `ImportOrchestrator.ts:222-455/148-210` | detached work spine, D6 aside discovery/TBD config |
| 6 | fingerprint | `fingerprintProducer.ts:32` + `checkpoint.ts:13-24` + `hashDbFile.ts:12-15` | checkpoint TRUNCATE + stream sha256, 对称两侧 |
| 7 | MergeEngine | `MergeEngine.ts:474/503-575/585-795/817-869/1059-1520/1893-2089/2123-2187/2199-2248` | transaction phase order, FIELD_MERGE/SKIP decisions, identity prepass, roots/members + B17 bulk tupleKey（`:96-110,:905-1037`）, junction/polymorphic, dangling FK repair, B12 telemetry + FK/integrity/FTS/app_state checks, B18 `ftsSourceChanged`（`:559-565` + marks `:1517-1518/:1888-1889/:2167-2174`） |
| 8 | resourcePlanning | `resourcePlanning.ts:289-466` | same-source work+backup conflict planning, skip sets, additive fileResources, path containment |
| 9 | missingLocalResourceScan | `missingLocalResourceScan.ts:53-88` | MCP dxtPath post-merge stat（directory check）, query/path errors swallowed, logger-only |
| 10 | snapshot | `snapshot.ts:16-21` | VACUUM INTO target-nonexist |
| 11 | restoreJournal | `restoreJournal.ts:36-44/110-163/172-210` | marker order, strict states + legacy summary optional, atomic fsync write/remove |
| 12 | restorePromotion | `restorePromotion.ts:33-79/109-224/286-362/371-530/532-613/617-770/780-827/841-894` | userData containment, corruption/terminal/crash net, admission/fingerprint, prefix+forward, step actions, rollback/revert, terminal/quarantine, durable rename+fsync |

### 3.3 已落地特性（节点 0-1）

| 特性 | 实现 anchor |
|---|---|
| **a1 WindowManager hold** | `BackupService.ts:450-567`（acquired first）+ `quiesceGate.ts:1-32`（legacy File_/Cache_/Backup_* 新写 gate；⚠️ dispatcher in-flight drain 残留 = A1-drain，阻塞 @DeJeune） |
| **admission gate A3** | `admitArchive.ts:58-89/243-299/516-584`（limits/manifest binding/zip-slip） |
| **marker reconcile A3** | `restorePromotion.ts:236-244/391-460/617-703`（commit probe + no-finalize-on-partial-inverse）；tests `restorePromotion.test.ts:664-736/785-921` |
| **B13 credential safety** | `archive.ts:75-81/221-230`（mode 0600）+ `ExportOrchestrator.ts:411-426`/`manifest.ts:45`（sensitiveData）+ `RestoreV2Popup.tsx:333-335`（renderer warning） |
| **contentHash skills** | `SqliteFileStager.ts:455-494`（hash verify + mismatch degradation） |
| **D11 containment** | `SqliteFileStager.ts:188-217/277-304/389-415/521-545` + `resourcePlanning.ts:303-309/335-339/367-368/395-396/434-435` + `restorePromotion.ts:33-79/795-809`（lexical+realpath/lstat staging） |
| **A1 legacy mutation gate** | `quiesceGate.ts:24-32` + ipc adapter gate |
| **4.1 e2e roundtrip/promotion** | `e2e/restore.roundtrip.test.ts:166-242/254-400` + `restorePromotion.test.ts:504-614` |

### 3.4 partial / 框架特性（节点 2-3）+ 待 owner 决策项

| 特性 | 现状 | 待 owner |
|---|---|---|
| **D8 MCP scan** | `missingLocalResourceScan.ts:1-20/53-88` + `ImportOrchestrator.ts:349-365`（non-throwing, logger-only，无 summary/degradation/gate） | full MCP staging + UI/degradation（@DeJeune） |
| **D6 retention** | `ImportOrchestrator.ts:148-210/232-240`（discovers aside slots + `ASIDE_RETENTION_TBD` null，无 sweeper/deletion） | retention 数值/consecutive/sweeper（@0xfullex） |
| **A4 benchmark/OOM** | `MergeEngine.oomBenchmark.test.ts`（行数/耗时/峰值 RSS）；⚠️ `MergeEngine` 仍 `.all()` materialize（`:609-610/1930-1934/2050-2051`，Stage3 stream TODO） | numeric memory benchmark/SLA（@0xfullex） |
| **B17 batch+tupleKey** | `MergeEngine.ts:96-110/905-1037/1304-1375`（chunk 500 + 长度前缀 tupleKey，实现落地） | scale/SLA/remaining materialization（@0xfullex） |
| **B18 FTS skip flag** | `MergeEngine.ts:482-486/559-565/1888-1889/2167-2174`（`ftsSourceChanged` 条件 rebuild） | bulk trigger policy/design（@0xfullex） |
| **B6 generation fence** | `BackupService.ts:159-192/630-637/1368-1389`（stale-finally fence） | same-process restart 语义/lease（@0xfullex） |
| **B12 telemetry** | `MergeEngine.ts:490-496/1496-1506/2199-2212`（内部 FIELD_MERGE counts+strategy，无值/凭证） | user-visible disclosure contract（@0xfullex） |
| **B14 cancel 观测** | `BackupService.ts:107-114/535-551`（5000ms drain timing/logging fail-closed） | cancel-latency SLA/dispatcher drain（@0xfullex） |
| **OVERWRITE/RENAME** | ❌ 未支持（`MergeEngine.ts:591-595` + `resourcePlanning.ts:33-36`） | strict replace contract（@0xfullex） |
| **Notes dir-swap** | ❌ 未支持 | §3.5 dir-swap kind（@0xfullex） |

---

## 4. 测试覆盖

**总量**：291 个逻辑 it（root `__tests__/` 221 + `MergeEngine.test.ts` 64 + OOM 参数化 1 + e2e 5）。

### 4.1 e2e 5 测（`e2e/restore.roundtrip.test.ts`）

真实 export → ImportOrchestrator → runRestorePromotion 全链：

| # | 用例 | 验证 |
|---|---|---|
| 1 | real full roundtrip | topic 回填、journal completed、integrity ok |
| 2 | file blob + knowledge dir + skill dir | staged 1 blob + 2 dir，promotion 后三类资源 byte-exact、DB rows/integrity |
| 3 | fingerprint mismatch expire | staging 后 live 写入 → journal expired（reason: live fingerprint mismatch），staging 清理、写入保留、backup 不覆盖 |
| 4 | add-conflict expire | promotion 前 additive target 出现 → expired（reason: add target already exists），目标原样保留、DB 不 promote |
| 5 | chain divergence expire | forge journal chain hash → expired（reason: journal chain is not a prefix），旧 DB/完整性保留 |

### 4.2 单元覆盖

- **MergeEngine**（64 it）：identity propagation / merge strategy（SKIP/INSERT/FIELD_MERGE）/ tupleKey 无碰撞（含 `U+001F` collision）/ B17 batch chunk / B18 FTS rebuild+skip / B12 telemetry Map（不含值）/ composite FK / member rewrite / NULL handling。
- **SqliteFileStager**：contentHash success/mismatch、缺 SKILL.md、symlink/traversal、cleanup rm fail-closed。
- **D8 scanner**（7 it）：absent/null/empty/regular-file/NUL/missing-table 全部 non-throwing。
- **restorePromotion**：state machine（completed/failed/expired → 清 staging 不重试）+ path-traversal containment。

### 4.3 测试缺口（非运行时阻塞，多为 owner-TBD）

| 缺口 | 原因 |
|---|---|
| B18 FTS FIELD_MERGE UPDATE / repairDanglingRefs SET NULL·DELETE 路径 | 当前覆盖 message + agent_session_message INSERT rebuild + PROVIDERS skip；FIELD_MERGE/repair 路径未单独测 |
| B12 logger.info spy（单次/commit 后/rollback 不发） | logger 是模块私有 const，spy 需 ad-hoc mock（违反 no-ad-hoc-mocks）；当前私查 fieldMergeStats Map 已证聚合 |
| crash/undo 矩阵（rename/step failure、重启恢复/幂等/aside retention） | blocked — B5 lifecycle stop（@0xfullex） |
| 真实并发 writer（blocked/quiesce race） | blocked — A1-drain（@DeJeune） |
| OOM benchmark SLA threshold | A4 benchmark 默认 `RUN_BACKUP_OOM_BENCHMARK=1` 门控 skip，仅观测无 SLA |

---

## 5. 提交链（27 commit / 10 主题组）

分支 `feat/backup-v2-merge-impl`，`b4ddaff793`→`abfa238357`，全部 SSH 签名 + DCO signoff + gpgsig 验证。

| 组 | 数 | commits |
|---|---|---|
| 节点 0 安全 | 1 | `b4ddaff793`（a1 consumer catch） |
| 节点 1 correctness | 3 | `765883c755`（A3 inverse 不 finalize）/ `37b3259ee3`（B13 credential）/ `af5678d32b`（A1 legacy gate） |
| 节点 1 e2e | 5 | `8fdb9cd6e3`（DB roundtrip）/ `f7d0c2197d`（文件资源 byte-exact）/ `c40054b701`（fingerprint expire）/ `72ca2fca51`（add-conflict expire）/ `a0fd272364`（chain divergence expire） |
| 节点 1 hardening | 4 | `6e9c00156d`（D11 export containment）/ `3dbbe24a83`（quiesce 注释同步）/ `458d9cd92e`（contentHash 校验）/ `9508b3afd2`（stager rm fail-closed） |
| contentHash 测试 | 3 | `daaa026e02`（helper 契约）/ `48f9c4a1f4`（present-skill fixture 真实 sha256）/ `d8f995485f`（roundtrip skill fixture） |
| UI dead-code | 2 | `692b652ddb`（删 restart button）/ `7bf993d4bb`（删 v1 RestorePopup 链） |
| B17 链 | 5 | `a076053584`（batch lookup）/ `c9ab7f44ad`（tupleKey 无碰撞）/ `395699c6b8`（bit-identical 覆盖）/ `d3b2602a3f`（chunk 精确断言）/ `e5576b29c8`（member PK bulk skip） |
| A4 | 1 | `04ce5b4650`（OOM benchmark） |
| partial 批次 | 1 | `ebb22dc59c`（B18/B12/B14/B6/D6/D8） |
| review-fix | 2 | `36b3739e11`（D8 non-throwing + isDirectory）/ `abfa238357`（B18 第二 FTS source + B6 fence 注释） |

---

## 6. 上游阻塞清单（10 项）

| 项 | Owner | 原因 |
|---|---|---|
| B4 JSON soft-ref | @0xfullex | `JsonSoftReferencePolicy` 缺 path/target contract，MergeEngine 硬编码 agent_workspace |
| B2 Notes overlay/body | @0xfullex | §3.5 dir-swap kind + overlay/body contract 未定 |
| D5 identity | @0xfullex | 依赖 B4 soft-ref contract |
| D8 Notes dir-swap | @0xfullex | Notes 资源类型扩展 + dir-swap kind 待 contract |
| B5 lifecycle stop | @0xfullex | sealed hold 在 onStop 是否释放、promotion 安全生命周期语义未定（**解锁节点 4.2 crash**） |
| B9 undo retention | @0xfullex | undo retention 数值 + 保留策略未拍板 |
| 节点 3 SLA | @0xfullex | A4 OOM / B6 fencing / B12 披露 / B14 cancel / B17 N+1 / B18 FTS 性能资源验收 SLA 未明确 |
| A1 drain | @DeJeune | DataApi/Preference/IpcApi dispatcher in-flight drain 未完成 |
| D8 MCP·AGENT hooks | @DeJeune | MCP/AGENT 文件资源 hooks + 完整 staging provider contract 待上游 |
| B11② KNOWLEDGE backupIndexStore | @eeee0717 | 依赖 backupIndexStore（#16848 已对齐冻结，实现未完成） |

---

## 7. 已知风险 + follow-up

### 风险

| 风险 | 说明 |
|---|---|
| **relaunch 卡死** | B5 sealed hold + lifecycle stop 语义未定，可能影响 restore relaunch 与窗口生命周期衔接 |
| **KB reindex silent** | KNOWLEDGE backupIndexStore 未落地，可能出现重建未执行但缺显式失败反馈 |
| **skips 跨重启** | B6 验证的是 stale-finally fence，不等价 stop→start restart lease，跨重启 skip 语义待 owner |
| **symlink** | realpath + lexical containment 已覆盖主要路径，但导出/资源目录 symlink 边界需持续验证 |

### 非阻塞 follow-up

- **A4 benchmark fixture 污染**：多 scale 复用 setupTestDatabase + 固定 ID；200/500 规模通过（beforeEach truncate），10k+ 应改唯一前缀/独立 setup 增强 robustness。
- **B12 logger spy**：待统一 mock 方案后补 logger 断言。
- **B18 FTS FIELD_MERGE/repair 测试**：当前覆盖 agent_session_message INSERT rebuild；FIELD_MERGE UPDATE + repairDanglingRefs 路径待补。

---

## 8. Review 指引（给 review 者）

### 8.1 架构 review 重点
1. 对照 §2.7 四层区分：冻结核心 / 现实现 / 已撤回 overhaul / follow-up——勿把 ②③ 当 ① 查。
2. 25 finalize invariants + §9 不变量（§2.6）逐条对照实现。
3. A3 收敛（inverse 不 finalize，A3-a 不新增 marker）是否符合预期；marker 缺口是否接受为非冻结。
4. fingerprint 只盖主 DB（D2 combined 已撤回）+ per-resource contentHash 是否足够。

### 8.2 实现 review 重点
1. 端到端主流程（§3.1）各步骤的 fail-closed 边界。
2. MergeEngine identity propagation（§2.3）：required ref 改写、optional 不悬空、tolerant file ref 降级。
3. B17 tupleKey 长度前缀（现实现，非蓝本）——碰撞防护是否充分。
4. D8/D6/A4/B17/B18/B6/B12/B14 的 partial 边界（§3.4）是否清晰标注"待 owner"。

### 8.3 测试 review 重点
1. e2e 5 测（§4.1）覆盖 happy + 3 类 fail-closed。
2. 测试缺口（§4.3）是否可接受（多为 owner-TBD blocked）。
3. B18 INSERT 路径证明 gate；FIELD_MERGE/repair 列 follow-up 是否合理。

### 8.4 关键文件入口
- 架构蓝本：`docs/references/backup/backup-architecture.md`
- 主流程：`ExportOrchestrator.ts` / `admitArchive.ts` / `ImportOrchestrator.ts` / `restorePromotion.ts`
- 合并：`merge/MergeEngine.ts`
- 模块地图：§3.2
- 状态源：`.trellis/tasks/08-01-backup-v2-rollout/prd.md`
