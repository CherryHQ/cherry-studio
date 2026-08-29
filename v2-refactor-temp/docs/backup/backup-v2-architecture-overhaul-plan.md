# Backup v2 整体架构方案（直接做好）

> 2026-07-31。综合 6 个 sonnet high-effort subagent 架构审查（契约一致性 / 生命周期+崩溃恢复 / 数据原子性+资源系统 / UI+UI 生命周期 / 安全威胁模型 / 性能可扩展性）+ 之前问题层调查 + 2 轮 cursor 对抗 review。
> 安全/质量（模块 1）已全完成（9 commit `578de5c92b..8e7ca02e46`，未 push，2 轮对抗无 high/medium）。
> 用户要求：**这个 PR 要直接做好**（非 beta 速成）。本文是整体架构方案。

## 总判断

backup v2 的 **detached DB + journal durability + promotion 文件级 crash recovery + archive admission 安全 + migration chain 检测** 是强项，方向正确。主要缺口集中在 **运行时一致性 / 生命周期 / 可扩展性 / 决策统一** 四类，安全基本 OK。

**一句话**：文件级崩溃恢复扎实，但"应用运行中 service 重启 / writer 未全 gate / DB 与 FS 无共同快照 / 决策图四层分叉 / 大库 OOM / a1 后无控制面"是"直接做好"必须补的架构层。

---

## 强项（保持，不退化）

- **migration chain 检测完整**（appliedChain hash/created_at + admission exact/prefix/fork 检测 + seal/promotion 复核）
- **SQLite fingerprint 方向正确**（checkpoint + busy==0 + SHA-256 主文件 + staging/promotion 复核）— 但只盖 DB 主文件，不盖 FS payload
- **archive admission 安全**（zip-slip lexical containment + entry count/size/ratio limit + manifest binding + strict Zod）
- **journal durability**（sibling tmp + fsync + atomic rename + POSIX parent fsync + DB 同目录 coupling）
- **detached work.sqlite**（merge/migrate/FTS/integrity 都在 detached DB，live DB 只在 preboot promotion 动）
- **promotion 文件级 crash recovery**（commit boundary probe + pre-commit rollback + post-commit forward/revert）
- **IPC 安全**（managed sender + validateSender 限制 app-owned renderer + backup.* 严格 Zod）
- **安全维度无 exploit chain**（6 维度审查，安全 confidence≥8 零 finding）

---

## 架构问题全清单（跨 6 维度去重整合）

### P0（架构正确性根基）

| # | 问题 | 证据 | 维度 |
|---|------|------|------|
| **A1** | **writer quiesce 不完整** — DataApi 仅入口 gate 不 drain in-flight；Cache_Sync / legacy File IPC（Save/Write/Move/Rename/Mkdir）/ legacy Backup 旁路；gate 是无 owner/epoch/lease 的 boolean → snapshot 后写入被 promotion 静默覆盖丢数据 | BackupService.ts:360-585 / IpcAdapter.ts:65-81 / CacheService.ts:813-851 / ipc.ts:185-203 / quiesceGate.ts:33-64 | 生命周期 P0 |
| **A2** | **DB 与 FS 无共同一致性快照** — VACUUM INTO detached DB 后，文件/knowledge/skill/notes 从 live FS 读，无共同 snapshot boundary；外部进程/应用写入可致 DB row 与 payload 版本不一致 | ExportOrchestrator.ts:14-18,236-241,322-375 / SqliteFileStager.ts:176-335 | 数据 P0 + 契约 P1 |
| **A3** | **promotion 非原子事务，rollback 不严格可逆** — DB rename 与资源移动分步；inverseManifest per-entry best-effort，失败继续 finalize → 可能 old DB+new resource 或 new DB+old resource | restorePromotion.ts:532-713,664-679 | 数据 P0 |
| **A4** | **OOM 多处** — MergeEngine scanAggregates/junction/polymorphic 每 root `SELECT *.all()`（源码 TODO Stage3 承认未 stream）；contributor 全量物化 Set；member 全量累积；大消息历史/大知识库 restore 时主进程 OOM 崩溃且无法恢复 | MergeEngine.ts:557-581,1113-1128,1688-1692,1808-1810 / backupContributor*.ts / resourcePlanning.ts:266-277 | 性能 P0 |

### P1（架构完整性）

| # | 问题 | 证据 |
|---|------|------|
| **B1** | **ResourcePlan 非唯一决策源** — planning 只产资源路径/skip 集；MergeEngine 再按 identity/natural key/conflictDefault 独立 scan；promotion 只读 fileResources；四层无共享 decision graph → 未来 FIELD_MERGE/OVERWRITE/RENAME 必分叉 | resourcePlanning.ts:81-98,289-465 / MergeEngine.ts:533-695 / ImportOrchestrator.ts:212-251 |
| **B2** | **DB 冲突与资源策略未绑定** — Notes 仅按 livePath existence 产生 note-add，本地 overlay 行存在但 body 缺失时 plan 仍 note-add，MergeEngine SKIP overlay 但 promotion 写 backup body → local metadata+backup body 混合 | resourcePlanning.ts:416-449 / MergeEngine.ts:588-607,665-681 / backupContributorPreferences.ts:86-104 |
| **B3** | **composite PK/FK identity 不完备** — identity map 单 string key，composite FK 跳过；codegen 有 composite PK/FK/self-FK（agent junctions、preference、knowledge_item self-FK）→ schema 增长会静默不改写或 dangling | MergeEngine.ts:335-342,1377-1409,1729-1754 / dbSchemaRefs.ts:655-800 |
| **B4** | **JSON soft-ref 硬编码** — policy 声明可配，实现只处理 agent_workspace + 2 固定 shape；新 contributor 无法 rewrite → 跨设备引用断裂 | MergeEngine.ts:384-427,1509-1565 / contributorTypes.ts:126-134 |
| **B5** | **sealed restore service stop/restart 提前释放** — seal 后 activeOperation=null，onStop 见 null 直接 releaseRestoreQuiesce，但 staged journal 待 promotion；service restart 后 writer/window 重开，下次 promotion 覆盖新写入 | BackupService.ts:571-575,1325-1335 |
| **B6** | **service stop 只 abort 不 await cleanup** — 无 generation fencing，旧 instance 与新 instance 重叠（emitter 继续 broadcast、orchestrator 继续 cleanup、finally 释放 hold） | BackupService.ts:1325-1335 / ImportOrchestrator.ts:156-360 |
| **B7** | **a1 后无可靠控制面** — a1 摧毁所有 mutation-capable window（Main/Sub/QuickAssistant/SelectionAction）；无 BackupProgress window；restore_relaunch/status 要 managed sender → dev mode/无幸存窗口时控制面消失 | WindowManager.ts:834-915 / windowRegistry.ts:52-495 / ipc handlers/backup.ts:33-35 |
| **B8** | **无 durable progress / late subscriber** — 只有 backup.progress（event）+ restore_summary；ImportOrchestrator 10 phase 只走 native notification；无 backup.restore_progress/status replay → 窗口关闭/a1 destroy/重开/late subscriber 无法恢复 active 状态 | schemas/backup.ts:74-87 / ImportOrchestrator.ts:47-57 / RestoreV2Popup.tsx:92-121 |
| **B9** | **undo-aside / expired / artifact GC 不完整** — old DB aside 保留但无 undo API/retention/GC owner；expired 有 schema 无触发策略；quarantine/staging 残留无统一 sweeper → 磁盘累积 + 用户误以为可 undo | restorePromotion.ts:286-308,391-460,723-730,755-770 / BackupService.ts:780-807,856-870 / restoreJournal.ts:90-99,110-125 |
| **B10** | **external file + MCP package DB-payload 分离** — external row 只 schema+绝对 path 无 payload；MCP DXT/MCPB 只 schema 不带 dxtPath → 跨设备 restore 功能不可用（MCP 无法启动、external 永久悬空），summary 不覆盖 | backupContributorFileStorage.ts:60-76 / backupContributorMcpServers.ts:69-77 |
| **B11** | **资源完整性** — SKILLS full 缺目录生成坏 archive；KNOWLEDGE existsSync 判完成 + reindex logger-only；manifest 无通用 content checksum（payload 可替换） | ExportOrchestrator assertFullResourceManifestSets / BackupService.onAllReady / manifest.ts:33-137 |
| **B12** | **FIELD_MERGE 无字段级披露** — 普通 scalar 冲突保 local 无 disclosure；只有 deep-merge type conflict 进 summary（table/count，无 entity/field） | MergeEngine.ts:1208-1279 / backup.ts:87-149 |
| **B13** | **UI 契约断裂** — main auto-relaunch + a1 destroy 后，RestoreV2Popup 仍展示 Restart 按钮请求 backup.restore_relaunch（死按钮）；raw error/绝对 archivePath/skip id/journal reason 直出；degradation generic；10 locale v2 backup ~55 keys 全 marker | RestoreV2Popup.tsx:283-383,261-362 / BackupExportV2Popup.tsx:250-285 |
| **B14** | **drain timeout 固定 + cancel 不贯穿** — 4 writer 串行 5000ms（最坏 20s）；admission/unpack/cp 无 AbortSignal；cancel 只 abort orchestrator，drain 阶段不响应 | BackupService.ts:508-519 / ImportOrchestrator.ts:99-100,172-188 / SqliteFileStager.ts:219-409 |
| **B15** | **TOCTOU + 内部 symlink 防御不足** — restorePromotion resolveEntry 裸 path.resolve + existsSync→rename（同用户权限外部进程可 symlink 替换越出 userData）；knowledge/skills 只验根不递归验成员（Notes 有 realpath）— 安全 subagent 评估无 exploit chain，属 defense-in-depth | restorePromotion.ts:67-79,271-281,774-801 / SqliteFileStager.ts:219-335 / resourcePlanning.ts:198-225 |
| **B16** | **contributor 扩展模型不闭合** — directory descriptor（mcp/agent）定义但 ExportOrchestrator throw；hook（beforeArchive/restoreResources/afterImport/transformRow）声明但不全接线；registry finalize 不校验 capability→hook 闭环 | contributorTypes.ts:191-210,372-397 / ExportOrchestrator.ts:1-12,289-315 |
| **B17** | **性能：N+1 / 物化 / 磁盘放大 / 重复扫描 / fsync 吞吐** — merge 每 root/member 逐行 lookup；export/import 多次全库 VACUUM+fingerprint+FTS rebuild；restore 无磁盘 preflight（archive+staging+backup DB+work DB+scratch 叠加晚失败）；promotion 每资源 renameDurable fsync 数量级 | MergeEngine.ts:647-663,1143-1169 / ExportOrchestrator.ts:193-590 / ImportOrchestrator.ts:172-301 / restorePromotion.ts:532-560 |
| **B18** | **FTS bulk merge 重复** — message INSERT trigger 逐行算 searchableText + 插 FTS，MergeEngine 又 whole-index rebuild → 10万消息双倍 CPU/写放大 | message.ts:166-173 / agentSessionMessage.ts:71-81 / MergeEngine.ts:519-522 / ftsCentral.ts:24-35 |

### P2（长期质量）

| # | 问题 |
|---|------|
| C1 | journal 无 transition validator / monotonic step（schema-valid 但非法转移如 staged→completed、step 回退） |
| C2 | clearRestoreJournal 不清 .tmp + 不 fsync parent，与 removeRestoreJournal 语义不一致 |
| C3 | relaunch timer 未纳入 lifecycle + 无 one-shot/idempotency guard |
| C4 | renderer summary 全量 li 渲染 + progress IPC tick 每 setState（无 throttle/virtualization） |
| C5 | DESIGN/a11y（Dialog size、aria-live、role=alert、semantic token） |
| C6 | v1/v2 popup 并存（legacy IPC 语义不同，UX 歧义） |
| C7 | startup restore outcome 仅检查一次（一次性 flag，不重试） |
| C8 | summary IPC 无 restoreId/version/correlation envelope（stale event 难御） |

---

## 缺失架构组件（需新建）

1. **统一 writer coordinator**（admission gate + in-flight registry + drain + epoch fencing，覆盖 DataApi/Preference/Cache/File/legacy Backup）
2. **immutable RestorePlan decision graph**（decisionId + aggregate identity + DB action + resource action + target fingerprint/treeHash + strategy source/reason；四层只消费不重算）
3. **DB-FS 共同一致性快照**（quiesce + per-resource content hash + combined fingerprint 进 manifest）
4. **promotion 可证原子事务**（per-resource durable state + inverse 证明 + inverse 失败不 finalize + boot reconciliation）
5. **artifact lifecycle**（aside/quarantine/staging 统一 sweeper + undo API + retention + expired 触发 + GC）
6. **restore runtime lease/generation**（restoreId + epoch，sealed hold 持到 process exit/promotion，service restart fencing）
7. **mutation-free 控制面**（WindowType.BackupProgress，singleton，a1 前 open）+ durable progress（backup.restore_progress/status replay）+ cancel/relaunch/forceExit 统一状态机
8. **identity propagation 升级**（composite tuple key + 通用 JSON soft-ref rewriter）
9. **资源系统闭环**（MCP/AGENT/Notes directory descriptor + external 披露 + skill fail-closed + KNOWLEDGE backupIndexStore）
10. **可扩展性**（流式 merge iterator/分批 + 磁盘 preflight + FTS bulk 模式 + N+1 临时表批量 lookup）
11. **journal 状态机**（transition API + monotonic step + explicit commit boundary）
12. **UI 契约**（删死按钮 + 脱敏 + degradation 分类披露 + i18n 补全 + DESIGN/a11y + envelope）
13. **promotion/staging 路径 hardening**（symlink 递归 realpath + apply 前 lexical containment + O_NOFOLLOW，defense-in-depth 防 TOCTOU 越出 userData）

---

## 目标架构（"直接做好"）

**核心原则升级**：从"ResourcePlan 是唯一决策源"落地为**单一 immutable RestorePlan decision graph**，四层（planning/merge/journal/promotion）只消费不重算；每 decision 含 `{decisionId, aggregate identity, DB action, resource action, target fingerprint/treeHash, strategy source, reason}`。

### 10 大设计（对应缺失组件）

| # | 设计 | 解决 | 依赖 |
|---|------|------|------|
| **D1** | 统一 writer coordinator（WriteEpoch/lease + registry + drain，**仅 fencing 基建**；不领 B5/B6） | A1, B14(drain) | 无（基建） |
| **D2** | DB-FS 共同快照（quiesce hold + content hash + combined fingerprint） | A2, B11 | D1 |
| **D3** | promotion 原子事务（per-resource durable + inverse 证明 + reconcile） | A3 | D2 |
| **D4** | 单一 RestorePlan decision graph + strategyByAggregate + 统一 ConflictDecision（**一次冻结宽 union + newIdentity + resourceDecision**，四层只消费） | B1, B2, B12, B16 | D2/D3 |
| **D5** | identity 升级（composite tuple key + 通用 JSON soft-ref） | B3, B4 | D4 |
| **D6** | artifact lifecycle（undo/expired/GC/sweeper + retention）+ **restore lease/RestoreGeneration**（sealed hold 持到 process exit/promotion + service restart fencing，承接 B5/B6） | B5, B6, B9 | D3 |
| **D7** | mutation-free 控制面 + durable progress + cancel/relaunch/forceExit 状态机 | B7, B8, B13, B14(cancel) | D1 |
| **D8** | 资源系统闭环（MCP/AGENT/Notes directory + external 披露 + skill fail-closed + KNOWLEDGE index） | B10, B11 | D4 |
| **D9** | 可扩展性（流式 merge + 磁盘 preflight + FTS bulk + N+1 批量） | A4, B17, B18 | D4/D5 |
| **D10** | journal 状态机 + UI 契约（transition + envelope + 脱敏 + i18n + DESIGN/a11y） | C1-C8, B13 | D6/D7 |
| **D11** | promotion/staging 路径 hardening（symlink 递归 realpath + apply 前 lexical containment + O_NOFOLLOW，defense-in-depth 防 TOCTOU 越出 userData） | B15 | D2/D3 |

**关键约束**：OVERWRITE/RENAME/Notes dir-swap 在 D4（统一 decision graph）+ D3（原子事务）+ D6（artifact lifecycle）完成前**必须 fail-closed**，不开 UI 入口。

---

## 推进计划（分阶段，依赖排序）

> 总工时修正后 **~12-18 周（中位 ~15 周）**（"直接做好"；各 stage 对抗修正后人天求和，超原估 8-12 周 ~3-6 周）。可砍 scope 压回 8-12 周（见决策点 1）。每阶段独立可测、可 review。
> **D7 仅依赖 D1** → stage4 可与 stage2/stage3 **并行**（见依赖图），缩短关键路径。

### 依赖图（关键路径）

```
stage1 (D1+D2) ──┬── stage2 (D3+D4+D5) ── stage3 (D6+状态机) ──┬── stage5 (D8+D9) ── stage6
                 │                                            │
                 ├── 4a (D7 控制面) ──────────────────────────┤
                 ├── 4c (UI 脱敏/i18n) ───────────────────────┤
                 └── 4b (cancel/drain) ── after 3b ───────────┘
```
> 4a/4c 仅依赖 stage1 → 可并行 stage2/3；**4b after stage3 3b**（消费 journal validator + RestoreGeneration）；4c degradation 文案 after stage5 5a。

- **stage4 并行边界（N6 细化）**：4a（D7 控制面，仅依赖 D1）+ 4c 部分（UI 脱敏/i18n）可 ∥ stage2/stage3；**4b（cancel/drain + relaunch token + operation 状态机）after stage3 3b**（消费 3b journal validator + RestoreGeneration 同源）；4c degradation 文案 after stage5 5a
- **stage2 内部解环顺序**：`2b-schema(冻结 ConflictDecision) → 2a(marker 绑 decisionId) → 2b-engine(四层消费) → 2c`（见 stage2 plan，破 2a↔2b 循环）
- **stage5 需 stage2(D4)/stage3(D6) 完**；B11/D11 落 stage1 1b + stage2 2a
- **stage6 是整体验证**，需 stage1-5 完成
- **crash test 分层（P0-4）**：stage2-5 的 crash/restart 测试为 **fault injection**（I/O failure，`markerFailure`/`fsyncDirFailure` 是可捕获异常 + 存活 SQLite handle）；**真进程边界 crash matrix 集中 stage6**（`arrange-and-crash` 关所有 SQLite handle + 销毁 module graph → `fresh-boot-recover` 新 module graph 执行 `runBackupRestoreGate()`）。各 stage 勿把 fault injection 绿当真 crash 验证（否则 reconcile 读内存态 ≠ 断电后读磁盘，虚假通过）
- **工时注**：各 stage per-plan 工时（见各 stage plan 开头）求和 ~13-20w；总工时 12-18w 含 **stage4∥stage2 并行优化**（D7 仅依赖 D1，非简单串行求和）。推进计划各 stage 标题工时为概数，**以各 stage plan 工时为准**

### 阶段 0 · 已完成 ✅
安全/质量 9 commit（containment / 双 relaunch escape / i18n marker / cursor 2 轮对抗无 high/medium）。

### 阶段 1 · 数据正确性根基（D1 + D2 基建，~2-3 周）
- 统一 writer coordinator（epoch/lease + in-flight registry + drain），迁移 DataApi/Preference/Cache/File/legacy Backup
- DB-FS 共同快照：resource quiesce hold + per-resource content hash + combined fingerprint 进 manifest
- **验证**：in-flight writer race 测试 + snapshot 期间写入 fail-closed + combined fingerprint drift 检测

### 阶段 2 · 决策统一 + 原子性（D3 + D4 + D5，~2-3 周）
- promotion 原子事务（per-resource durable state + inverse 证明 + inverse 失败不 finalize + boot reconcile）
- 单一 RestorePlan decision graph + strategyByAggregate + 统一 ConflictDecision（DB+资源成对）
- identity 升级（composite tuple key + 通用 JSON soft-ref rewriter + 未实现 shape fail-closed）
- FIELD_MERGE 字段级披露（携 decision graph）
- **验证**：composite round-trip + JSON soft-ref rewrite + inverse 失败 reconcile + decision graph 四层一致性

### 阶段 3 · 生命周期 + 策略（D6 + journal 状态机，~3-4 周；最大低估修正）
- artifact lifecycle（undo API + retention + expired 触发 + quarantine/staging/aside sweeper + GC）
- journal transition validator + monotonic step + explicit commit boundary
- restore runtime lease/generation（sealed hold + service restart fencing）
- OVERWRITE/RENAME/Notes dir-swap 在 decision graph 上实现（D4 完成后解锁）
- **验证**：crash matrix 每步 + service restart 不释放 sealed + journal 非法转移拒 + undo round-trip

### 阶段 4 · 控制面 + UX（D7 + UI 契约，~1.5-2.5 周）
- BackupProgress window（mutationCapable:false，a1 前 open）+ durable backup.restore_progress/status + late subscriber
- cancel/relaunch/forceExit 统一状态机（普通 cancel 不 abort 业务；a1 后 relaunch；sealed 禁 cancel）
- drain 分级 timeout（soft/hard + absolute deadline + AbortSignal）
- UI 契约：删 RestoreV2Popup 死按钮 + raw error/路径脱敏 + degradation 分类披露 + summary envelope(restoreId/version) + i18n 补全 + DESIGN/a11y + v1/v2 popup gate
- **验证**：a1 destroy 后控制面可用 + late subscriber + cancel 各 phase + 脱敏 + locale marker

### 阶段 5 · 资源系统 + 可扩展性（D8 + D9，~2-3 周）
- 资源闭环：SKILLS full fail-closed + KNOWLEDGE backupIndexStore（或禁用）+ external 披露 + MCP/AGENT/Notes directory descriptor 实现
- 可扩展性：流式 merge iterator/分批（Stage3 TODO）+ 磁盘 preflight + FTS bulk 模式（pause trigger + 单次 rebuild）+ N+1 临时表批量 lookup + contributor 不物化
- **验证**：大库（10万消息/GB 知识库）restore 不 OOM + 磁盘满 preflight + FTS 一致性 + 资源 round-trip

### 阶段 6 · 测试矩阵 + e2e（~1 周）
- 端到端 roundtrip（真实 export→restore→promote，之前 plan 的 it.todo）
- crash matrix 每步 + service restart + 大库 + 跨设备 + symlink + 并发 writer + 多 restore retention
- 对抗 review（cursor/codex 多轮到无 high/medium）

---

## 产品决策点 → Decision Log（需你定，未拍板阻塞对应 stage 开工）

| # | 决策 | 选项 | 阻塞 stage |
|---|------|------|-----------|
| 1 | 范围 + 排期 | 全做阶段 1-6（修正后 12-18 周"直接做好"）vs 砍 scope 压回 8-12 周（defer 3c OVERWRITE + undo API + MCP staging + merge worker） | 全局（排期基线） |
| 2 | OVERWRITE/RENAME/Notes dir-swap | 本次做完（D4/D3/D6 后解锁）vs 继续 fail-closed defer | stage3 3c |
| 3 | MCP/AGENT directory | 本次实现 descriptor 闭环 vs 继续 throw defer | stage5 5a |
| 4 | KNOWLEDGE | 等 @eeeee0717 #16848 backupIndexStore vs 本次自建 durable task | stage5 5a |
| 5 | Channel drop | 等 @DeJeune #16849 durable vs 本次临时 A + 自建 durable spool | stage1/stage4（drain 语义） |
| 6 | undo | 本次做 undo API + retention（完整）vs 只保留 aside 不做 undo 入口 | stage3 **3a-2**（undo）；3a-1 sidecar+expired 不阻塞 |
| 7 | identity 升级范围 | composite tuple key 全量迁移 vs 分批（先单列 + 渐进 composite） | stage2 2c |
| 8 | 控制面形态 | 独立 BackupProgress BrowserWindow（D7 推荐）vs main-process native UI | stage4 4a |

> 拍板后在此表补"决定 / 日期 / 影响 PR"列；阻塞 stage 开工前对应决策必须定格。

---

## 风险

- **D1 writer coordinator 迁移面广**（DataApi/Preference/Cache/File/legacy Backup + direct DML inventory）— 遗漏即虚假安全；需完整 inventory + 端到端并发测试
- **D2 DB-FS 共同快照**对外部进程写入只能 hash fail-closed（不能完全阻）；需明确"应用内 gate + 外部 hash 拒"边界
- **D3 promotion 原子事务** redesign 影响崩溃恢复矩阵（当前强项不能退化）；需每步 crash test
- **D4 decision graph** 是大重构（四层契约改），风险高；需充分测试 + 渐进迁移（旧 path 并存期）
- **D5 composite identity** 全量迁移影响所有 contributor；需 schema 完整 inventory + round-trip
- **D9 流式 merge** 是 Stage3 大改（源码 TODO）；可能需 worker/thread + 阶段性提交
- **上游依赖**（@eeeee0717 #16848 / @DeJeune #16849）排期不确定；临时方案需明确不静默
- **不 push 约束**：当前 9 commit 未 push，整体方案实施过程中需决定何时开 PR / 是否拆多 PR

---

## 与之前文档的关系

- `backup-v2-issues-and-fix-plan.md`（问题层，beta 前必修）→ 本文是架构层升级，覆盖更广（含 defer 项的架构缺口）
- `backup-v2-remaining-roadmap.md`（10 项 roadmap）→ 本文 D1-**D11** 整合这 10 项 + 新增架构层（decision graph / 原子事务 / artifact lifecycle / composite identity / OOM / 控制面 / 路径 hardening）
- 安全/质量 9 commit（已完成）= 阶段 0

---

## Master Traceability（问题 → 设计 → stage PR → 验收 criterion；test ID 在各 stage 实施时填）

> 贯穿各 stage 的可审计映射索引。各 stage plan 维护自己的局部表（criterion → test ID → CI tier），本表是汇总；stage6 6c 只做汇总审计，**不负责首次发明映射**。

| 问题 | 设计 | stage PR | 验收 criterion（摘） |
|---|---|---|---|
| A1 | D1 | stage1 1a | writer gate 全 + WriteEpoch fencing + drain |
| A2 | D2 | stage1 1b | DB-FS 共同快照 + combinedFingerprint |
| A3 | D3 | stage2 2a | per-resource marker + inverse 失败不 finalize + reconcile |
| A4 | D9 | stage5 5b | 大库不 OOM + 有界 merge |
| B1 | D4 | stage2 2b | 四层消费同一 decisions（grep 无独立 scan） |
| B2 | D4 | stage2 2b + stage3 3c | Notes DB overlay + path 绑定 |
| B3 | D5 | stage2 2c | composite PK/FK round-trip |
| B4 | D5 | stage2 2c | 通用 JSON soft-ref rewriter |
| B5 | D6 | stage3 3b | sealed RestoreGeneration 持到 promotion |
| B6 | D6 | stage3 3b | generation fencing 覆盖全 async 副作用点 |
| B7 | D7 | stage4 4a | a1 后 BackupProgress 控制面存活 |
| B8 | D7 | stage4 4a | durable progress + late subscriber pull |
| B9 | D6 | stage3 3a | undo/expired/GC/sweeper + CAS |
| B10 | D8 | stage5 5a | external/MCP payload 披露 |
| B11 | D2+D8 | stage1 1b + stage5 5a | content checksum + skill fail-closed |
| B12 | D4 | stage2 2b | FIELD_MERGE 字段级披露（无原值） |
| B13 | D7+D10 | stage4 4c | UI 契约 + 脱敏 + i18n |
| B14 | D1+D7 | stage1 1a + stage4 4b | drain 分级 + cancel 贯穿 |
| **B15** | **D11** | **stage1 1b + stage2 2a** | **symlink 递归 realpath + apply 前 lexical containment** |
| B16 | D8 | stage5 5a | contributor capability→hook 闭合 |
| B17 | D9 | stage5 5b/5c | N+1 批量 JOIN + 磁盘 preflight |
| B18 | D9 | stage5 5c | FTS bulk（显式 trigger lifecycle） |
| C1 | D10 | stage3 3b | journal transition validator |
| C2 | D10 | stage3 3b | clearRestoreJournal 统一 durable 语义 |
| C3 | D10 | stage4 4b | relaunch lifecycle + token idempotency |
| C4 | D10 | stage4 4c | renderer 虚拟化/throttle |
| C5 | D10 | stage4 4c | DESIGN/a11y 合规 |
| C6 | D10 | stage4 4c | v1/v2 popup gate |
| C7 | D10 | stage4 4a | startup outcome 幂等可重试（见 stage4 修正） |
| C8 | D10 | stage2 2b + stage4 4a | summary envelope（restoreId/version） |
