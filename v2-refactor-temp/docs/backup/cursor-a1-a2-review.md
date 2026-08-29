# Cursor against-review：A1/A2 执行计划

审：`full-restore-plan.md` v2.1 §5–§10 + trellis `{prd,design,implement}.md`，对照契约 `resourcePlanning.ts` / 真实 spine。  
假设仍有错；契约类型本身（ResourcePlan / RestoreResultSummary / FileResource export）已落地，不重复审。

---

## A1 `planResources`（§10.1）

### P0-1 — KB/skills「磁盘冲突 skip」与 merge 不同源 → dangling DB 行

**Evidence**
- 计划：`design.md:10-11`、`full-restore-plan.md:53-56` — files/**KB** 冲突 =「本地 DB 同 id 行 OR `existsSync`」，与 merge SKIP 同源
- 契约：`ResourcePlan.skippedFileEntryIds` **只服务 file_entry**（`resourcePlanning.ts:41-42`；`MergeEngine.ts:435` 仅 `agg.root === 'file_entry'`）
- knowledge_base：uuid-entity → 无本地行时 merge **INSERT**（`backupContributorKnowledge.ts` 注释）
- skills：`folderName` natural-key **FIELD_MERGE**（`backupContributorSkills.ts:32-33`），无本地行时同样 **INSERT**
- §10.1 骨架：`skipped.add(id)` 仅出现在 **files** 循环；`planDirClass` 只把冲突记入 `skips[]`，**没有**任何 merge 侧 skip 集合

**Failure scenario**
本地无 `knowledge_base`/`agent_global_skill` 行，但磁盘上已有同名目录（孤儿目录 / 半清理残留）：
1. planning：`existsSync` → skip `dir-add`，只写 `skips[]`
2. merge：INSERT 备份行（无 skipped\* 可挡）
3. journal 无对应 resource → promotion 不搬目录  
→ **DB 有 KB/skill 行，目录仍是旧孤儿或缺失**（dangling / 混合实体）。正是计划声称要用「同源冲突」避免的失败模式，但只在 file_entry 上成立。

**Fix（派工前选一）**
- 扩展 MergeContext（如 `skippedKnowledgeBaseIds` / `skippedSkillFolderNames`）并在 MergeEngine 对对应 root 强制 skip；或
- 对「磁盘存在且本地无行」的 KB/skills：**整单 abort**（要求用户清孤儿目录），不要静默 skip+INSERT；或
- 缩小文案：明确「同源」**仅 files**；KB/skills 仅 `existsSync` skip 资源且接受（并披露）「可能已有本地目录则行仍可能 INSERT」——若选此条，e2e 必须覆盖孤儿目录并改产品预期。

---

### P0-2 — `assertFullManifestInvariants` 误绑 `resolvePreset` 的 include\* 标志

**Evidence**
- 计划 §9：`preset=full` 时字段须匹配 `resolvePreset('full')`（**includeFiles / includeKnowledgeFiles / domains**）
- 真实：`resolvePreset` **只返回 domains 数组**（`presets.ts:29-44`），不定义 include\*
- 导出：`includeFiles: filesTotal > 0`、`includeKnowledgeFiles: knowledgeBases.length > 0`（`ExportOrchestrator.ts:400-401`）——与 **preset 无关**，空附件库的合法 full 归档可为 `preset:'full', includeFiles:false, notes.paths`/`knowledge.bases` 非空

**Failure scenario**
若实现写成「full ⇒ `includeFiles===true`」：
- 无 file blob、仅有 notes/KB 的合法 full 归档在 admit/planning 被拒；或
- 反过来用 `includeFiles` 当「是否规划资源」会与 `presetIncludesFiles(preset)`（§10.1 L139）分叉（见 P0-3）

**Fix**
Full 不变量应类似 lite：
- `domains` 精确等于 `resolvePreset('full')`
- **一致性**：`includeFiles === (files.ids.length > 0)`（及 total 对齐）、`includeKnowledgeFiles === (knowledge.bases.length > 0)`；skills/notes 列表 schema/去重/`..` 拒绝
- **不要**要求 full 时 include\* 恒为 true

---

### P0-3 — planning 用 `preset`、merge 用 `manifest.includeFiles` 门控 notes → 分裂

**Evidence**
- §10.1：`if (!presetIncludesFiles(manifest.preset)) return EMPTY_PLAN` → full 会规划 notes
- merge：`includeFiles: archiveContext.includeFiles`（今日 `ImportOrchestrator.ts:197`）；`MergeEngine.ts:361` `skipAllNotes = ctx.includeFiles === false`
- 导出 full 且 `filesTotal===0` ⇒ `includeFiles:false` 但仍可有 `notes.paths`（见上）

**Failure scenario**
Full 归档：有 notes/KB、无 files → planning 产出 `note-add`，merge **跳过全部 note overlay** → 正文可能恢复、星标/展开态不合并（或反向预期混乱）。A2 若「只接线、不改 includeFiles 语义」会原样打进生产。

**Fix**
A2 明确 MergeContext.includeFiles（或更名）语义，与「是否恢复 file-ish / notes body」对齐，例如：
- `includeFiles: presetIncludesFiles(manifest.preset)`，或
- `manifest.includeFiles || manifest.notes.paths.length > 0 || …`  
并与 assertFull 一致性规则、lite 行为一起写进 plan；单测覆盖「full + 零 files + 有 notes」。

---

### P1-1 — 交叉校验主要是「manifest → 源」单向；§9「集合一致」未在骨架落地

**Evidence**
- §8/§10.1：按 `manifest.files.ids` / bases / folders / paths 查 staging + backup DB
- §9 还写「manifest 与 archive **实际资源集合**一致性」
- 骨架无：扫描 `workDir/files|knowledge|notes|skills` 反查「archive 有、manifest 无」；KB/skills 也未写「manifest 有 id 但 backup DB 无行 → CORRUPT」（files 有）

**Failure scenario**
篡改/半写归档：manifest 少报、磁盘多目录 → 不 CORRUPT，多余 blob 留在 staging 无 journal 引用（多半无害）；manifest 有 KB id、backup.sqlite 无行 → 若 `planDirClass` 不查 backup DB，可能对缺失源 `existsSync` 失败才 CORRUPT，或行为未定义。

**Fix**
A1 清单写死：四类均「manifest 声称 ⇒ backup 行存在 + staging 存在且类型对」；可选严格模式「staging 树 ⊆ manifest」。至少 KB/skills 与 files 对称查 backup DB。

---

### P1-2 — `notesRoot` 缺失 / 全在 userData 外时，可能不记 `skips`

**Evidence**
- §10.1：`if (notesRoot) for (...)`；无 root 则整段跳过
- 契约 `SkippedResource` 要喂披露 UI（`resourcePlanning.ts:23-25`）

**Failure scenario**
归档含 notes，目标机 `resolveNotesRoot()` 为 undefined（或全 outside）→ 用户看不到「将跳过 notes」摘要，以为恢复完整。

**Fix**
`manifest.notes.paths.length > 0` 且无法托管时，对每条或聚合一条 `skips`（reason: `no managed notesRoot` / `outside userData`）。

---

### P1-3 — `toPathResolvable` / snake_case：骨架依赖正确，需钉死 internal 字段

**Evidence**
- §10.1：`resolvePhysicalPath(toPathResolvable(row))`；说明 snake→camel
- `PathResolvableEntry`（`pathResolver.ts:17-19`）：internal 要 `id/origin/ext`；external 要 `externalPath`
- 骨架在 resolve 前已 `origin !== 'internal'` → CORRUPT，故 external 映射是死路径；`ext` 列名与 camel 一致

**Failure scenario**
若有人把 raw row 直接传入、或漏 `origin` 字符串校验（SQLite 类型松）→ 错路径或 throw。

**Fix**
`toPathResolvable` 显式映射 + `origin === 'internal'` 收窄类型后再 `resolvePhysicalPath`；单测覆盖 ext null。

---

### P2-1 — ARCHIVE_CORRUPT 覆盖面（files 侧）与声明基本一致

lstat 拒 symlink、files/notes 须 regular file、KB/skills 须目录、缺源/external → CORRUPT：与 §8 一致；实现时 `assertStagingFile` / `assertStagingDir` 必须用 **lstat 非 stat**（避免跟 symlink）。不单列阻断。

---

## A2 spine 原子改线（§10.2）

### P0-4 — 时序「snapshot → planning → merge」正确，但须在 **打开 work 写连接之前** 跑 planning（或保证只读短连接）

**Evidence**
- 今日：`ImportOrchestrator.ts:173` snapshot → `180-182` **立即** `new Database(workPath)` 写连接 → `199` merge → `223-225` seal/close → `234` stage
- 计划 §5：snapshot → **planning** → merge → seal → 序列化
- §10.1：planning **自己** `new Database(workPath, { readonly: true })` + `finally close`

**Failure scenario**
若 A2 插在 L182 之后、与写连接并行：多数平台可共存，Windows 上偶发 lock；更糟的是有人复用未 close 的 drizzle `workDb` 又在 plan 里再开。若仍把 planning 放在 seal **之后**（旧 stage 位）→ 又回到「merge 已写入、skipped 集合无效」。

**Fix**
A2 伪代码钉死：`createSnapshot(workPath)` → `plan = planResources({ workPath, ... })`（只读开闭）→ **再** `new Database(workPath)` → merge 注入 `plan.skippedFileEntryIds` / `stagedFileEntryIds` → … → seal → `fileResources = plan.resources`（删空 stub）。禁止在 seal 后重算计划。

---

### P1-4 — 原子性中间态分析：正确；落地清单需写全「同 commit」文件

**Evidence**
- 计划：planning 前置 + 真实集合喂 merge + `journal.fileResources = plan.resources` + 删 full 拒绝 **必须同 commit**
- 半落地：merge 已吃 `stagedFileEntryIds` 但 journal 仍 `[]` → promote 后 **file_entry 在、blob 不在**（dangling）——分析对

**Fix**
Commit 检查表：`ImportOrchestrator` 时序、`BackupService` admit 去 full gate、`planResources` 注入、所有测试里 `stageFileResources: async () => []` 与空集合 MergeContext 夹具、`BackupService.restore.test` full 拒绝用例翻转。缺一即红。

---

### P1-5 — `journal 附 skips 摘要` 与冻结 journal schema 不符

**Evidence**
- §5 L63：`journal 附 skips 摘要`
- `RestoreJournal` / `FileResourceSchema`（`restoreJournal.ts:71-91`）**无** skips 字段
- 契约：skips → `RestoreResultSummary.toSkip`（relaunch **前**弹窗，`backup.ts:64-75`）

**Failure scenario**
实现去改 journal schema「附 skips」→ 越界且与「不碰 promotion」压力；或不改 journal 却依赖 journal 做披露 → B4 无数据。

**Fix**
删掉「journal 附 skips」表述；A2 只保证内存/`RestoreResultSummary` 在确认 relaunch 前传到 renderer。Journal 仅 `fileResources`。

---

### P1-6 — `admitArchive`：删 full 拒绝 + `assertFullManifestInvariants` 位置

**Evidence**
- 今日：`BackupService.ts:389-394` wrapper 拒 full；`admitArchive.ts:175` 仅 `assertLiteManifestInvariants`
- 计划：删拒绝 + §9 full 不变量；§10.1 又在 `planResources` 调一次 assertFull

**Failure scenario**
只放在 planning：伪造 full 仍会 quiesce+snapshot 后才失败（浪费/差 UX）。只放 admit、planning 假设已校验：OK。双重调用无害。

**Fix**
**admit 必调** assertFull（对称 lite）；planning 可 re-assert 或信任 admit。A2 删 wrapper 拒绝与加 assertFull 必须同 commit（否则 full 进 spine 但无规划 → DB-only 静默丢 blob）。

---

### P2-2 — `stageFileResources` dep 删除 vs passthrough

删 dep、journal 直接用 `plan.resources` 更清晰；passthrough 易残留空 stub。偏好删除。非阻断。

---

## 契约对齐速查（声称已修项）

| 项 | 结论 |
|----|------|
| ResourcePlan 三用 | 类型 OK；KB/skills skip **未**进入 merge 输入（P0-1） |
| 冲突全 skip / 不碰 promotion | 方向对；files 同源 OK；KB/skills 缺口 |
| workPath + workDb.close | 骨架 OK；须插在 snapshot 后、写连接前（P0-4） |
| ARCHIVE_CORRUPT + lstat | files 路径清晰；KB backup 行对称不足（P1-1） |
| assertFull ↔ resolvePreset | 文案错误（P0-2） |
| MergeContext 真实集合 | A2 意图对；notes/`includeFiles` 未改（P0-3） |

---

## 总体判断

**A1 不可按 §10.1 草图原样派工**——先修 P0-1/P0-2/P0-3（KB/skills 与 merge 同源、full 不变量、notes/`includeFiles`）。  
**A2 方向正确且应与 A1 同原子落地**，但须钉死 planning 插入点（P0-4），并去掉 journal-skips 误述（P1-5）。

**建议派工门槛**
1. 书面选定 P0-1 修复策略（扩 MergeContext **或** 孤儿目录 abort）  
2. 重写 §9 assertFull（domains + 与资源数组一致，不强制 includeFiles）  
3. 明确 merge `includeFiles` 与 full notes 行为 + 单测  
4. A2 伪代码：snapshot → planResources → open work → merge(plan sets) → seal → journal.resources=plan.resources；同 commit 去 full gate  

未满足前：A1 可先写 **纯函数单测**（mock 库），**不要**合入 ImportOrchestrator。
