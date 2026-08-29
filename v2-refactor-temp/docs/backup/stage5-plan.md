# 阶段 5 计划：资源系统 + 可扩展性（D8 资源闭环 + D9 性能）

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（5b 范围/Design/测试"worker/IPC 不阻塞"以 PRD 5b-1/5b-2 选边为准；contributor 不物化以 P0-3 sink contract 为准）若与修正冲突即作废。实施前先读文末修正段。

> 目标：消除 B10/B11（external/MCP DB-payload 分离 + SKILLS/KNOWLEDGE/manifest 资源完整性）+ B16（contributor 扩展模型不闭合）+ A4/B17/B18（OOM + N+1 + 物化 + 磁盘放大 + 重复扫描 + FTS 双倍）。
> 工时修正后 ~3-4 周。**4 PR**：5a 资源闭环 / **5b-1** iterate+JOIN+boundedness / **5b-2** contributor sink contract + worker / 5c 磁盘 preflight + FTS bulk（5b 拆分因 contributor contract 重构影响面大）。
> 前置：阶段 2 decision graph（资源 decision 对齐）+ 阶段 1 contentHash（资源校验）。**5a 的 resource decision 字段从 stage2 2b `ConflictDecision.resourceDecision` 消费（2b 已一次冻结，5a 不平行造状态）**。

---

## PR 5a · 资源系统闭环（SKILLS / KNOWLEDGE / external / MCP-AGENT / Notes directory）

### PRD
**目标**：所有资源类型完整闭环（DB+payload 一致 / 失败可见可重试 / 不静默）。

**范围**：
- **SKILLS full fail-closed**：full preset 缺 zip/local skill 目录 → ExportOrchestrator throw `BackupResourceIncompleteError`（不生成 archive）；`assertFullResourceManifestSets` 加 skill exact-set（builtin/marketplace 不校验）；admitArchive 拒旧 `skill-dir-missing` full archive；lite 继续 schema-only
- **KNOWLEDGE backupIndexStore**：删 existsSync 判完成；`backupIndexStore`（`{restoreId,baseId,sourceFingerprint,state,attempts,lastError}`）作唯一状态源；失败 → `RestorePostRestoreTask`/degradation（`knowledge_index_rebuild_failed`）；UI 显示"内容已恢复，索引构建中/失败可重试"
- **external 披露**：manifest 加 `files.externalCount`（不含路径）；引用 external row 披露 `external_file_payload_not_included`（不显绝对 path）；保留 dangling row
- **MCP/AGENT directory descriptor**：实现 staging provider（不再 ExportOrchestrator throw）；admission/finalize capability negotiation；unsupported resource fail-fast 稳定码
- **contributor 扩展模型闭合**：registry finalize 校验 capability→hook→phase→result serializer 闭环；未实现 hook 不声明可用

**验收**：
1. SKILLS full 缺目录不生成 archive（builtin/marketplace 不误伤）
2. KNOWLEDGE 不用 existsSync 判完成，失败 durable 可重试
3. external payload 未包含明确提示（不显路径）
4. MCP/AGENT directory 不再 throw（实现或显式 unsupported 稳定码）
5. contributor hook 声明与执行闭合

### Design
**SKILLS fail-closed**（`ExportOrchestrator.assertFullResourceManifestSets`）：
```ts
// 加 skill exact-set 校验
const activeSkills = agentGlobalSkillTable.select({ source: inArray(['zip','local']) })
assertManifestMatches(manifest.skills.folders, activeSkills, 'skill')
// 缺目录 → throw BackupResourceIncompleteError（不写 degraded）
```

**KNOWLEDGE backupIndexStore**（新 durable store，与 @eeeee0717 #16848 对齐/自建）：
```ts
type KnowledgeIndexTask = { restoreId, baseId, sourceFingerprint, state: 'pending'|'running'|'completed'|'failed', attempts, lastError }
// onAllReady：不 existsSync 跳过；每 base 创建 task → enqueue reindex → job 完成回调更新 task
// 失败 → task.state='failed' + summary degradation（不 report 完全成功）
```

**external 披露**（manifest + summary）：
```ts
manifest.files.externalCount = externalRows.length   // 不含 path
summary.mergeLosses.degradations.push({ kind: 'external_file_payload_not_included', count })
```

**MCP/AGENT directory descriptor**（`ExportOrchestrator` 不再 throw）：
```ts
// 实现 staging provider（cp dxtPath/workspaceDir）
// 或 admission/finalize capability negotiation：
if (domain.hasDirectoryResource && !capabilitySupported('directory-staging')) {
  throw new BackupResourceUnsupportedError(stableCode)  // 不在 export 中途 throw
}
```

**contributor capability 闭合**（`contributors/finalize.ts`）：
```ts
// finalize 校验：declared hooks → 有对应 pipeline phase 接线 → result serializer
// 未接线的 hook 不声明为可用（或 throw "contributor X declares hook Y but no phase wires it"）
```

### Implement steps
1. SKILLS fail-closed（exact-set + throw + admitArchive 拒旧）+ 测试
2. KNOWLEDGE backupIndexStore（删 existsSync + task 状态机 + 失败 degradation）+ 测试（协调/对齐 #16848）
3. external 披露（externalCount + degradation）+ 测试
4. MCP/AGENT directory descriptor（staging provider 或 capability negotiation）+ 测试
5. contributor capability 闭合（finalize 校验）+ 测试
6. e2e 资源 round-trip（各类型）+ 测试

### 测试矩阵
- SKILLS full 缺目录 reject（builtin/marketplace 不误伤）
- SKILLS lite schema-only
- admitArchive 拒旧 skill-dir-missing
- KNOWLEDGE 空/损坏/fingerprint 不匹配重建
- KNOWLEDGE 失败 summary 可见 + 重试
- external externalCount + 不显 path
- MCP/AGENT directory staging
- contributor capability finalize 拒未接线 hook

### 风险 + 回滚
- **KNOWLEDGE #16848 协调**→ 自建 task store + 对齐 #16848（二选一不冲突）；临时禁用 fallback
- **SKILLS fail-closed 改行为**→ 旧 archive 兼容（admitArchive 拒而非 export 中途崩）
- **回滚**：fail-closed flag；backupIndexStore additive

---

## PR 5b · 流式 merge（**拆 5b-1 iterate+JOIN+boundedness / 5b-2 contributor sink contract + worker**）

### PRD
**目标**：消除 A4 OOM（merge scanAggregates/junction/polymorphic/member 全量 `.all()` + contributor 全量物化）。大库（10万消息/GB 知识库）restore 不 OOM。

**D9 worker 选边（破"IPC 不阻塞"vs"worker 可选"矛盾，二选一写死）**：
- **5b-1（MVP，必做）**：有界同步 merge —— iterate + 批量 + identity 临时表 JOIN + contributor 不物化 + transaction-scoped temp mapping table；验收 = 峰值 RSS/SQL lookup count 有界（不 OOM），**主进程同步但 有界**
- **5b-2（依决策点 1）**：contributor sink/cursor/batch contract 重构 + worker thread（worker 自建 DB connection，不 transfer better-sqlite3）；**仅当验收要"IPC 不阻塞"才必做 5b-2，否则删"不阻塞主进程"验收**，worker 后续 PR

**拆分**：
- **5b-1**：scanAggregates/member/junction/polymorphic iterate + identity 批量 JOIN temp table + boundedness 证明（RSS + SQL lookup count 门）；**contributor 不物化降级为"尽力（ID Set 不全留）"，彻底 sink/cursor contract 在 5b-2**（N5：5b-1 限定 MergeEngine 侧有界）
- **5b-2**：contributor contract 重构为 sink/cursor/batch callback + worker thread（可选）

**范围**：
- MergeEngine `scanAggregates`（`:557-581`）：`SELECT *.all()` → `prepare().iterate()` + 有界 batch
- `mergeIncludeMembers`（`:1113-1128`）：member 累积全量 → 分批流式
- junction/polymorphic（`:1688-1692,1808-1810`）：全量 → iterate + 批量
- N+1（`:647-663,1143-1169`）：逐行 lookup → backup identity keys 批量写临时表 + JOIN
- contributor 不物化（`backupContributor*`）：只查需要列 + raw iterator + 流入 staging 队列（不同时留全量 ID Set + 全量 rows）
- `ExportOrchestrator.pruneMissingRows`（`:519-529`）无界 SELECT → 分批
- `resourcePlanning`（`:320-413`）O(N) 同步 → 批量 JOIN 临时表 + 有界并发 worker
- merge 放 worker thread（不阻塞主进程 IPC）

**验收**：
1. 10万消息/GB 知识库 restore 不 OOM
2. **MVP（5b-1）**：有界同步 merge，主进程峰值 RSS < 阈值 + SQL lookup count 有界；**5b-2（依决策点 1）**：worker thread 不阻塞 IPC，否则删本项验收（二选一，不在 5b 内悬空）
3. 内存峰值有界（identity map / decisions / members 批量）
4. 单元行为不退化（小库 round-trip 一致）

### Design
**iterate + 有界 batch**（`MergeEngine.scanAggregates`）：
```ts
// 旧：const rows = stmt.all()
// 新：
const batch: Row[] = []
for (const row of stmt.iterate()) {
  batch.push(row)
  if (batch.length >= BATCH_SIZE) { processBatch(batch); batch.length = 0 }
}
if (batch.length) processBatch(batch)
```

**identity 批量 JOIN**（替代 N+1）：
```ts
// backup identity keys 批量写临时表
INSERT INTO tmp_backup_keys (natural_key) VALUES (?), (?)...
// JOIN 一次查所有
SELECT b.* FROM tmp_backup_keys t JOIN backup_table b ON b.natural_key = t.natural_key
```

**contributor 不物化**：
```ts
// 旧：const rows = db.select().from(table)  // 全量
// 新：raw iterator + 流入 staging
const stmt = db.prepare(`SELECT id, root_path FROM ${table}`)
for (const row of stmt.iterate()) stageRow(row)   // 不留全量 Set
```

**merge worker thread**：merge 逻辑放 worker（`worker_threads`），主进程 progress IPC 不阻塞。

### Implement steps
1. scanAggregates iterate + batch + 测试（小库一致 + 大库内存）
2. member/junction/polymorphic 分批流式 + 测试
3. identity 批量 JOIN（临时表）+ 测试（替代 N+1）
4. contributor 不物化（iterator + staging 流）+ 测试
5. resourcePlanning 批量 JOIN + 并发 worker + 测试
6. merge worker thread + progress 回调 + 测试

### 测试矩阵
- 10万消息 merge 不 OOM（内存监控）
- 小库 round-trip 一致（不退化）
- identity 批量 JOIN 正确（对比 N+1）
- contributor 流式（不留全量）
- merge worker 不阻塞主进程（IPC 响应）
- 大 junction/polymorphic 流式

### 风险 + 回滚
- **iterate 行为差异**（事务内）→ 测试 + 同步路径 fallback
- **worker thread 复杂**（better-sqlite3 同步）→ 可选（先 iterate + 分批，worker 后续）
- **回滚**：iterate 可回 `.all()`（小库无影响）；worker 可回主进程

---

## PR 5c · 磁盘 preflight + FTS bulk + 减重复 VACUUM/hash

### PRD
**目标**：restore 磁盘 preflight（不晚失败）+ FTS bulk 模式（消除 trigger 逐行 + rebuild 双倍）+ 减少重复 VACUUM/hash/integrity 全库扫描。

**范围**：
- restore 磁盘 preflight：admission 后根据 archive 声明 + live DB + work DB 估算 + staging 资源总量，分别检查 staging/live/archive volume + SQLite VACUUM scratch 安全系数
- FTS bulk：受控 bulk import 暂停 message/agentSessionMessage INSERT trigger，批量填 FTS，单次 rebuild（不再 trigger 逐行 + 最后全量 rebuild 双倍）
- 减重复：export 多次 VACUUM（snapshot + stripper + final）合并；restore 多次 hash/checkpoint（before snapshot + after merge + preboot gate）阶段性合并或保留必要（正确性不退化）

**验收**：
1. 磁盘不足 preflight 拒（不在解压/snapshot/merge 晚失败）
2. FTS bulk 一致（trigger 暂停 + 单次 rebuild，结果与逐行一致）
3. VACUUM/hash 次数减少（性能基准）
4. 正确性不退化（fingerprint/integrity 仍校验）

### Design
**磁盘 preflight**（`ImportOrchestrator` admission 后）：
```ts
const needed = archiveSize + workDbEstimate + stagingResources + vacuumScratch
for (const vol of [stagingVol, liveVol, archiveVol]) {
  if (statfs(vol).available * 0.9 < needed) throw new BackupDiskFullError(...)
}
```

**FTS bulk**（merge 受控）：
```ts
// 进入 bulk import：
db.exec('INSERT INTO fts_message(fts_message) VALUES(\"disable-rebuild\")')  // 或类似暂停 trigger
// 批量 INSERT message（trigger 暂停，FTS 不逐行）
// 批量填 FTS 或最后单次 rebuild
db.exec('INSERT INTO fts_message(fts_message) VALUES(\"rebuild\")')
```

**减重复 VACUUM**：export stripper DELETE + VACUUM + final VACUUM → 合并一次（strip 后直接 final VACUUM）。

### Implement steps
1. 磁盘 preflight（statfs + 估算 + 各 volume 检查）+ 测试
2. FTS bulk（暂停 trigger + 批量 + 单次 rebuild）+ 一致性测试（对比逐行）
3. export VACUUM 合并 + 基准测试
4. restore hash/checkpoint 审计（保留必要，合并冗余）+ 测试
5. 大库性能基准（10万消息 restore 时间/内存/磁盘）+ 测试

### 测试矩阵
- 磁盘不足 preflight 拒（各 volume）
- FTS bulk 与逐行结果一致
- VACUUM/hash 减少基准
- 正确性（fingerprint/integrity 不退化）
- 大库性能基准

### 风险 + 回滚
- **FTS trigger 暂停风险**→ 一致性测试 + fallback 逐行
- **VACUUM 合并影响 snapshot 一致性**→ 保留必要 + 测试
- **回滚**：preflag additive；FTS bulk flag

---

## 阶段 5 验证闭环 + 门槛
- vitest + lint + build:check 绿
- 大库基准测试（10万消息/GB 知识库，内存/时间/磁盘）+ 分层 CI（PR correctness / nightly scale / release stress）
- cursor/codex 对抗无 high/medium（审：资源一致 / 不 OOM / preflight / FTS 一致 / **5a resourceDecision 消费 2b 非平行**）
- **局部 traceability**：本 plan 各 PR"测试矩阵"+"可审计验收物"段即 criterion→test 映射（PR 实施时填 test ID + CI tier）；架构 Master Traceability 是汇总索引

---

## 对抗 review 细化修正（stage5 review：3 P0 + 4 P1 + 2 P2）

### P0 修正

**P0-1 · 磁盘 preflight 时机 + 跨 volume（5c）**：原"admission 后 preflight"太晚（`admitArchive` 已在 `unpackRecognized` 解压，ImportOrchestrator.ts:172→admitArchive.ts:166,188，无法阻 ZIP 解压 ENOSPC）。跨 volume 公式错（needed 套三卷，archive source 只读不应计）。
修正：
- 拆 `inspectArchive`（只读 central directory + manifest + migration metadata）vs `unpackRecognized`；inspect 后 preflight 通过才解压
- 按卷映射实际写入路径 + 每卷**增量峰值**：`required[v] = unpackPayload[v] + workDbGrowth[v] + snapshotScratch[v] + vacuumScratch[v] + promotionOverlap[v] + safetyMargin`（archive 原文件不计）
- ZIP 声明 uncompressed / manifest 资源字节 / admission 上限三向校验，不一致按 corruption 拒
- 仍须映射 `ENOSPC`/`SQLITE_FULL` 运行时错误（preflight 只降概率，不替代错误处理）
- 测试：staging/live 同卷/异卷、archive 第三卷、父目录不存在、解压超 manifest

**P0-2 · FTS bulk 显式 lifecycle（5c）**：原 `disable-rebuild`/暂停 trigger **机制不存在**（FTS 表是 `message_fts`/`agent_session_message_fts`，FTS5 无该命令）；停 trigger 会导致 `fts_rowid`/`searchable_text` 不填，rebuild 重建错误内容。
修正：
- 显式事务内 `FtsBulkScope`：保存/移除两套 INSERT trigger → bulk 写 message → 集合/有界 batch 回填 `fts_rowid` + 两表各自等价 `searchable_text` 表达式 → `rebuildFts()` + integrity check
- 失败路径：事务 rollback 后 trigger schema 自动恢复（或 `finally` recreate + 验证 schema）
- `fts_rowid` 分配策略（不沿用逐行 `MAX+1`，bulk 下避重复）
- **baseline 对照测试**：相同 archive 走 trigger 路径 vs bulk 路径，比两 FTS 表/检索结果/JSON parts 文本/rowid 唯一性 + rollback/重复 restore

**P0-3 · merge 真正有界（5b）**：仅 `.all()→iterate` 不够（`AggregateDecision[]`/`IdentityMap`/members/resource plan 仍全量线性增长，types.ts:108/MergeEngine.ts:683,716,1117）。temp table JOIN 不能跨 backup/work 独立 connection。contributor API 要求返完整数组（contributorTypes.ts:372），`BackupReadonlyDb` 无 raw iterator（contexts.ts:79）。
修正：
- 每 batch 完整生命周期：读 source batch → temp key table（同 connection）→ bulk local lookup → merge/soft-ref → 写持久化 mapping table 或释放
- 跨 batch mapping 落 **transaction-scoped temp SQLite table**（非进程 Map）；同连接创建/清空/cleanup
- contributor contract 重构为 **sink/cursor/batch callback**（非 `Promise<ResourceDescriptor[]>`）；改造 ExportOrchestrator/resourcePlanning 的 arrays/Sets
- better-sqlite3 transaction 同步：iterate 可行，但 batch processor/contributor transform/merge hook **不得 await**
- worker thread：**收敛矛盾** — 若验收"IPC 不阻塞"则本 PR 完整交付（worker 自建 DB connection，不 transfer better-sqlite3，定义 Electron 入口/progress/cancel/错误序列化/journal/fingerprint 边界）；否则删"IPC 不阻塞"验收，worker 后续 PR

### P1 修正

- **5a MCP/AGENT 冻结一种**：支持目录 staging（source discovery/archive prefix/manifest identity/byte size+content hash/safe extraction/symlink policy/restore target/DB path rewrite/导入校验+失败）**或**显式 unsupported（export planning 前按 capability 拒，稳定 IPC code，不写一半 throw，contributorTypes.ts:191/ExportOrchestrator.ts:247 现 throw）；`finalize.ts`（:576）需 capability→phase→serializer→archive path→importer 注册表；`BackupResourceIncompleteError`/`UnsupportedError` 当前不存在（backup.ts:2），决定复用或新增 shared IPC code + main mapping + renderer i18n
- **5a KNOWLEDGE 与 #16848 收敛**：不并行自建不兼容 task store。定义唯一键/fingerprint invalidation/状态迁移/claim-lease/crash 时 `running→pending/failed` 恢复/restore promote 时 task 创建边界/job terminal result 触发 completed-failed/onAllReady Condition 1/2/lazy-open/失败回退/UI retry ownership；替换 BackupService.ts:887,896 + KnowledgeService.ts:457,466（await 仅 enqueue）；测试覆盖 crash/reboot/重复启动/fingerprint 变/enqueue 成功 job 失败
- **5a SKILLS/external 口径**：SKILLS exact-set（identity/排序/重复/缺失目录/content hash 验证位置/legacy full archive 拒绝规则，skills additive default 不能仅靠 manifest major version）；`externalCount` 统一谓词（active/被引用/soft-deleted 是否计入，manifest count 与 summary degradation 同谓词）；external 披露只 count/type 不序列化绝对 path；round-trip dangling row 保留测试
- **5a D4 decision graph 前置依赖**：5a 开工前 stage2 2b 已冻结的 `resourceDecision` 字段就绪，5a **只读消费**（非 5a 定义 schema；否则 5b batch/5c journal 产生平行状态，resourcePlanning.ts:289/types.ts:150 现分离）

### P2 修正
- **5c VACUUM 不退化证明**：`SqliteBackupStripper` VACUUM 清 freelist 敏感数据（SqliteBackupStripper.ts:80），不能删；ExportOrchestrator.ts:397 final VACUUM。每个 hash/checkpoint/VACUUM 标注安全不变量 + 覆盖区间，证明最终 archive assembly 前仍一次完整 scrub VACUUM；"次数减少"非唯一依据
- **大库验收可审计**：fixture（消息数/JSON+附件分布/junction+polymorphic 基数/KB 文件总量+小文件比例）+ 环境（Electron/Node/SQLite/CPU/内存/磁盘/heap）+ 指标（main+worker 峰值 RSS/heap/wall time/每卷 peak bytes/IPC heartbeat 延迟/SQL statement 数）+ 阈值（绝对+相对回归，写 metadata）+ 分层（PR small correctness / nightly scale / release stress）

### PR 重排
5a（资源决策+durable state，含 D4 decision graph 前置）→ 5b（同步严格有界 merge，RSS+SQL lookup count 证 boundedness）→ 5c（admission 前按卷 preflight → FTS bulk 显式 trigger lifecycle → VACUUM/hash 审计）
