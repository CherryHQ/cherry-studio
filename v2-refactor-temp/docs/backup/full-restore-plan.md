# Backup v2 全量恢复 — 资源暂存实施计划（v2.1）

> **v2.1 自审增量**：① 冲突判定与 merge 同源——planning 加 `work.sqlite` 输入，files/KB 以「本地 DB 有同 id 行 OR 磁盘存在」判冲突（避免 existsSync-only 与 merge SKIP 分叉 → 孤儿 blob / 混合实体）；② 弹窗文案改将来时（`toRestore`/`toSkip`，relaunch 前 promotion 未跑，preboot 可能整单 expire，不说谎）。
>
> **v2 评审修订**：4 阻断（A1 planning 前置 merge / A2 全 skip / A3 ARCHIVE_CORRUPT / A4 full manifest 不变量）+ 2 必须（skip 披露弹窗 + KB 索引重建 enqueue）已采纳；冲突一律全 skip、完全不碰 restorePromotion。

## 1. 目标

让 full（完整）备份的 file / 知识库 / 笔记 / 技能 blob 真正恢复到 app，消除「导出能导全量、恢复只恢复数据库」的不对称。恢复类型由备份清单（`manifest.preset`）自动判断，UI 合并为单一恢复入口。作为 stack PR，基于已 APPROVED 的 `feat/backup-v2-restore`。**完全不修改已上线的 `restorePromotion`**（全 skip 只走 add 路径，原则真正守住）。

## 2. 现状（骨架已在，只缺暂存填充）

- 导出 full ✓：archive 含 blob（`files/ knowledge/ notes/ skills/` 目录）
- 恢复 full ✗：`stageFileResources` 是空 stub（`return []`），只恢复 DB
- 已就绪、可直接复用的件：
  - **admitArchive**：解压 archive 到 workDir（`files/knowledge/notes/skills` 前缀已识别）
  - **restorePromotion**：preboot 阶段 apply fileResource。FileResource `kind` 枚举只有 `blob-add / dir-add / note-add / note-overwrite / overwrite` 五种（restoreJournal.ts:72）；`add` 的 inverse 是 rename-back 永不删除（restorePromotion.ts:622-638），单文件 `overwrite` 的 inverse 是非递归 rmSync + aside。**当前 kind/forward/inverse/admission 合同未定义「目录 overwrite」**——所以本 PR 对 KB/skills 冲突一律 skip，不引入目录 overwrite。
  - **FileResource schema**：已定义（`kind / stagingPath / livePath / asidePath`，restoreJournal.ts:71-77）
  - **export 端 SqliteFileStager**：4 个 stage 方法（恢复端对称参考）

## 3. 恢复类型自动判断

`manifest.preset` 在导出时写明 `full | lite`。恢复时读同字段：

- **lite** → planning 直接产出空 ResourcePlan，纯 DB 恢复
- **full** → planning 交叉校验 + 产出 FileResource[]，DB + blob 恢复

UI 因此删除「完整恢复」单独入口与 gate，恢复按钮始终可用，内部按 manifest 自动路由。

## 4. 冲突策略（全 skip）

**本 PR 四类资源冲突一律 skip + 记录原因**，不做 overwrite。理由：

1. `file_entry` 是 uuid 实体，DB merge 冲突默认 SKIP 保留本地行；若资源层 overwrite（备份 blob 覆盖）→ 本地元数据 + backup blob 混合实体，且 promotion 成功后 aside 随 staging tree 删除 → **本地原文件永久丢失**。
2. FileResourceSchema 无目标 fingerprint，journal 落盘到 preboot 之间目标可能变 → overwrite 是跨重启 TOCTOU。
3. 安全 overwrite 需扩展 journal/promotion 做 expected-state 校验，与「不碰 restorePromotion」不可兼得。

全 skip 后只走 `add` 路径，promotion 侧本就安全（`assertNoAddConflicts` 对 add 目标已存在是整单 clean expire，fail-safe，restorePromotion.ts:269-278）。

> overwrite 全家桶（files/notes/KB/skills 的 overwrite + aside + journal fingerprint + DB 层 OVERWRITE 策略）移到 §14 后续。

## 5. 架构与数据流（三段）

评审 A1 指出：`MergeContext.skippedFileEntryIds` 是 **merge 的输入契约**，MergeEngine 用它把 blob 未暂存的 file_entry 整个跳过不导入。资源决策必须在 merge **之前**确定，否则行已落进 work.sqlite → dangling。故改为三段：

```
archive
 → admitArchive 解压到 workDir
    （删 full 拒绝分支 + 补 full manifest 跨字段不变量 §9）
 → snapshot live → work.sqlite
 → 【段1·resource planning】（merge 前，纯函数，独立可测 §10）
    输入：manifest + workDir（archive 解压）+ backup.sqlite（archiveContext.backupDbPath）+ **work.sqlite（snapshot 后的本地状态快照）** + 本地 roots
    ※ work.sqlite 让 planning 的 DB 行冲突判定与 merge SKIP 同源，避免 existsSync-only 分叉（孤儿 blob / 混合实体）
    交叉校验 manifest ↔ archive 文件 ↔ backup DB：
      缺源 / external id / 错类型 / symlink → ARCHIVE_CORRUPT 终止（§8）
      本地已存在（livePath existsSync）→ 全 skip，记 skips[]
      否则 → staged（加 resources + stagedFileEntryIds）
    产出 ResourcePlan（§6）
 → 【段2·merge】消费 ResourcePlan 真实集合：
    skippedFileEntryIds → 不导入 dangling file_entry 行
    stagedFileEntryIds → message 附件软引用披露正确
 → seal + close work.sqlite
 → 【段3·序列化】journal.fileResources = plan.resources；journal 附 skips 摘要
 → relaunch 前给 renderer 恢复结果摘要（restored/skipped）→ 确认弹窗（§11）
 → 重启 preboot restorePromotion apply（全 add）
 → promotion 完成后首启：为新恢复 KB 幂等 enqueue knowledge.index-documents（§11）
```

## 6. ResourcePlan 契约（开工前先冻结）

planning 模块输出，一身三用（merge 输入 + journal 来源 + 披露 UI 数据源）：

```ts
interface ResourcePlan {
  stagedFileEntryIds: Set<string>                                   // 喂 merge：disclose 依据
  skippedFileEntryIds: Set<string>                                  // 喂 merge：不导入 dangling 行
  resources: FileResource[]                                         // 序列化进 journal.fileResources
  skips: { id: string; kind: 'file'|'knowledge'|'skill'|'note'; reason: string }[]  // 披露 UI 数据源
}
```

配套冻结的第二个契约 —— **恢复结果 IPC 载荷**（relaunch 前给 renderer）：

```ts
interface RestoreResultSummary {
  toRestore: { kind: string; count: number }[]              // 按 kind 聚合
  toSkip: { id: string; kind: string; reason: string }[]    // 直接来自 plan.skips
}
```
> 弹窗在 relaunch **前**展示，promotion 尚未 apply（preboot 可能整单 expire），文案必须「将恢复 / 将跳过」，不能写「已恢复」。
```

这两个契约一冻结，工作流 A/B 即可完全并行。

## 7. FileResource 映射（全 add，userData 相对路径）

所有路径 userData 相对（preboot `resolve(userData, ...)` + containment 校验）。

| 资源 | kind | stagingPath | livePath |
|------|------|-------------|----------|
| files（internal） | `blob-add` | `workDir/files/{id}` | `resolvePhysicalPath(row)` = `userData/Data/Files/{id}.{ext}` |
| 知识库 | `dir-add` | `workDir/knowledge/{baseId}/` | `{knowledgeRoot}/{baseId}/`（`feature.knowledgebase.data`） |
| 技能 | `dir-add` | `workDir/skills/{folderName}/` | `{skillsRoot}/{folderName}/`（`feature.agents.skills`） |
| notes（managed） | `note-add` | `workDir/notes/{relPath}` | `{notesRoot}/{relPath}`（`resolveNotesRoot()`） |

冲突（本地已存在）→ 不产出 resource，记 `skips[]`。external origin → ARCHIVE_CORRUPT。

路径根（BackupService 已有）：knowledgeRoot=`feature.knowledgebase.data`、skillsRoot=`feature.agents.skills`、notesRoot=`resolveNotesRoot()`（可能 userData 外 → 其下 notes 全 skip + 记原因）、filesRoot=`feature.files.data`。

## 8. ARCHIVE_CORRUPT 判定 + 类型校验（planning 阶段）

导出端已保证 manifest↔blob↔DB 三方对齐（`stagedFileIds = collected − missing`，缺源 prune，external 不进文件集合，notes 缺正文 fail-closed）。所以合法 full 归档里出现下列情况**只可能是损坏/篡改**，planning 阶段直接抛 `ARCHIVE_CORRUPT` 终止恢复（非降级）：

- manifest 有 id 但 `workDir/files/{id}` 不存在
- file_entry row 缺失或 `origin !== 'internal'`
- 类型不符：files/notes 须为 regular file、KB/skills 须为目录
- symlink（`lstat` 检测，拒）

另用 `lstat`/`realpath` 校验资源类型，错类型同判损坏。

## 9. full manifest 跨字段不变量（admitArchive）

删 full 拒绝分支的同时补 `assertFullManifestInvariants`：

- `preset=full` 时各字段须匹配 `resolvePreset('full')`（includeFiles / includeKnowledgeFiles / domains）
- 资源列表去重 + 各自路径/标识符 schema 校验（KB baseId / skills folderName SafeName，notes relPath 拒 `..`）
- manifest 与 archive 实际资源集合一致性检查（与 §8 损坏判定同一处落地）

防止伪造 `preset=full, includeFiles=false` 导致资源按 full 暂存、DB 按 lite 跳 notes overlay 的两层分叉。

## 10. 具体实施（文件级改动）

### 10.1 planning 模块（纯新增，工作流 A1，独立可测）

```ts
// resource planning —— merge 前，纯函数
function planResources({ manifest, workDir, backupDbPath, workPath, userData, roots }: PlanCtx): ResourcePlan {
  assertFullManifestInvariants(manifest)                          // §9
  if (!presetIncludesFiles(manifest.preset)) return EMPTY_PLAN    // lite
  const staged = new Set<string>(), skipped = new Set<string>()
  const resources: FileResource[] = []
  const skips: Skip[] = []
  const toRel = (abs: string) => relative(userData, abs)
  const backupDb = new Database(backupDbPath, { readonly: true })   // archive 的 DB（判 backup 行 origin）
  const workDb = new Database(workPath, { readonly: true })         // 本地快照（判 DB 行冲突，与 merge SKIP 同源）
  try {
    // files：internal only；冲突 = 本地 DB 有同 id 行 OR 磁盘存在（与 merge SKIP 同源）；缺源/external/错类型 → CORRUPT
    for (const id of manifest.files.ids) {
      const row = backupDb.prepare('SELECT * FROM file_entry WHERE id = ?').get(id) as FileEntryRow | undefined
      if (!row || row.origin !== 'internal') throw archiveCorrupt(`file ${id}: missing or external`)
      const stagingAbs = path.join(workDir, 'files', id)
      assertStagingFile(stagingAbs)                               // exists + regular file + 非 symlink，否则 CORRUPT
      const liveAbs = resolvePhysicalPath(toPathResolvable(row))
      if (!isPathInside(liveAbs, roots.files)) throw archiveCorrupt(`file ${id}: outside filesRoot`)
      const localRow = workDb.prepare('SELECT 1 FROM file_entry WHERE id = ?').get(id)  // 本地 DB 行
      if (localRow || existsSync(liveAbs)) { skips.push({ id, kind: 'file', reason: localRow ? 'local DB row exists' : 'live exists' }); skipped.add(id); continue }
      staged.add(id)
      resources.push({ kind: 'blob-add', stagingPath: toRel(stagingAbs), livePath: toRel(liveAbs) })
    }
    // 知识库 / 技能（dir，冲突 = 本地 DB 有同 id 行 OR 目录存在，与 merge SKIP 同源；错类型 → CORRUPT）
    planDirClass(manifest.knowledge.bases, 'knowledge', roots.knowledge, workDir, { staged, skipped, resources, skips, toRel })
    planDirClass(manifest.skills.folders.map(f => f.folderName), 'skill', roots.skills, workDir, { staged, skipped, resources, skips, toRel })
    // notes（managed only，冲突 skip）
    const notesRoot = roots.notes()
    if (notesRoot) for (const relPath of manifest.notes.paths) {
      if (relPath.includes('..')) throw archiveCorrupt(`note traversal: ${relPath}`)
      const stagingAbs = path.join(workDir, 'notes', relPath), liveAbs = path.join(notesRoot, relPath)
      assertStagingFile(stagingAbs)
      if (!isPathInside(liveAbs, notesRoot) || !isPathInside(liveAbs, userData)) { skips.push({ id: relPath, kind: 'note', reason: 'outside managed notesRoot' }); continue }
      if (existsSync(liveAbs)) { skips.push({ id: relPath, kind: 'note', reason: 'exists — skip' }); continue }
      resources.push({ kind: 'note-add', stagingPath: toRel(stagingAbs), livePath: toRel(liveAbs) })
    }
  } finally { backupDb.close(); workDb.close() }
  return { stagedFileEntryIds: staged, skippedFileEntryIds: skipped, resources, skips }
}
```

import：`resolvePhysicalPath` + `PathResolvableEntry`（`@main/services/file/utils/pathResolver`）、`isPathInside`（`@main/utils/file`）、`isSafeName`、`Database`（`better-sqlite3`）。`toPathResolvable(row)`：snake_case `external_path` → camelCase `externalPath`。

### 10.2 ImportOrchestrator spine 改线（工作流 A2，原子 commit）

唯一动行为的 commit，必须整体翻转（否则中间态 dangling）：

- 新增 dep `planResources: (ctx: PlanCtx) => ResourcePlan`（merge 前调用）
- `MergeContext` 消费 `plan.skippedFileEntryIds` / `plan.stagedFileEntryIds`（不再空集/高估）
- seal 后 `journal.fileResources = plan.resources`（原 `stageFileResources` dep 删除或瘦身为 passthrough）
- `admitArchive` 删 `preset === 'full'` 拒绝（§9 不变量补上后）

### 10.3 BackupService

- 注入 `planResources`（新 dep）+ roots（filesRoot/knowledgeRoot/skillsRoot/notesRoot）
- `admitArchive` 删 full 拒绝 + 补 `assertFullManifestInvariants`

### 10.4 UI — 恢复单入口（工作流 B1）

- 删 `isV2BackupRestoreFullReady` + `V2BackupRestoreFullGate`
- unwrap `BasicDataSettings.tsx:27,225`、`LocalBackupSettings.tsx:26,197` → 直接 `V2BackupRestoreGate`
- 重写 `BackupGates.test` Full 用例；全仓 grep 确认无残留

### 10.5 skip 结果披露（工作流 B4，必须随本 PR）

relaunch 前 staging 已跑完、`plan.skips` 完全确定 → 不需要 §14 的 journal v2 跨重启方案。在**重启确认弹窗**给结果摘要（RestoreResultSummary，恢复了什么 / 跳过了什么及原因）+ i18n。不落地则保留 Full gate。

### 10.6 KB 索引重建 enqueue（工作流 B2，必须随本 PR）

导出排除 `<baseId>/.cherry/index.sqlite`，空索引不会自动重建。promotion 完成后的**首次启动**，为 plan.resources 中 `dir-add` 的新恢复 KB 幂等 enqueue `knowledge.index-documents`。不补则「知识库恢复完成」不成立，KB 检索静默失效。

### 10.7 e2e — restore.full.test.ts（工作流 B3，按评审重排）

- planning 产出真实集合传入 merge（`skippedFileEntryIds` 生效 → file_entry 行未导入）
- DB SKIP 与文件资源决策一致（冲突实体：行保本地 + blob 未动）
- 本地 DB 有同 id file_entry/knowledge_base 行但 blob/目录缺失 → skip 非 add（DB 行判定与 merge SKIP 同源，避免孤儿 blob / 混合实体）
- manifest 声称但 archive 缺失 / 错类型 / external id → `ARCHIVE_CORRUPT`
- full manifest 跨字段伪造 → admission 拒绝
- journal 落盘后 add 目标出现 → 整单 clean expire（assertNoAddConflicts 路径）
- KB 恢复后索引重建 enqueue 触发
- symlink / 错类型资源；（Windows 大小写别名 — 可降级到 §14）

验证命令：focused vitest + `pnpm test` + `pnpm lint` + 提交前 `pnpm build:check`。

## 11. 验证

- `pnpm vitest run src/main/services/backup`（restore.full 全场景）
- `pnpm test` + `pnpm lint` + `pnpm build:check`
- 手动：导出 full → 恢复 → blob 真恢复 + KB 可检索 + 弹窗显示 skip；导出 lite → 恢复 → 无 blob 但 DB 恢复；KB 已存在 → skip 保留本地

## 12. 工作量拆分（两人，约 3 人天）

**开工前先冻结两个契约（半小时，两人一起定）**：ResourcePlan 类型 + RestoreResultSummary IPC 载荷。定了即可完全并行。

**工作流 A — 核心链路（约 1.5-2 天，关键路径）**，独占 ImportOrchestrator / BackupService / admitArchive + 新 planning 模块：

- **A1** resource planning 模块（纯新增、独立可测）：交叉校验、ARCHIVE_CORRUPT、full 不变量、lstat 类型校验，产出 ResourcePlan（冲突全 skip + 原因）
- **A2** spine 改线（唯一动行为的原子 commit）：planning 前置 + 真实集合喂 MergeContext + seal 后序列化 + stageFileResources 签名改造 + 删 full 拒绝。**必须同 commit 翻转**，否则中间态 dangling

**工作流 B — 外围（约 1 天，与 A 并行起步）**：

- **B1** UI 单入口（删 Full gate + unwrap + 重写 test）—— 半天内
- **B2** KB 索引重建 enqueue（promotion 后首启幂等）—— 与 spine 正交
- **B3** e2e fixtures 提前搭（全量/损坏/伪造 manifest/冲突），A2 后接真实链路
- **B4** 披露 UI（relaunch 弹窗摘要，对 mock 载荷开发）+ i18n + breaking-changes

**合并顺序（同 stack PR）**：A1 → A2+B3 → B2 → B1+B4。

**取舍**：B2/B4 不砍（砍了回到「不能删 Full gate」）；压时间砍 e2e 的 Windows 大小写别名 / symlink 边角（记 §14）。

## 13. 产品语义（用户可见变化，需文档）

- 恢复不再让用户选「恢复 / 完整恢复」，按备份清单自动判断。
- 完整恢复时，本地已存在的资源（文件 / 知识库 / 技能 / 笔记）一律**保留本地版本并在结果弹窗提示**哪些未恢复及原因。
- 自定义笔记目录（userData 之外）的正文不恢复，仅恢复受管理笔记。
- 知识库恢复后自动重建检索索引。

## 14. 后续（不在本 PR）

- overwrite 全家桶（files/notes/KB/skills 的 overwrite + aside + journal fingerprint 校验 + DB 层 OVERWRITE 策略）——「旧版改名保留、新版放上去」UX
- Stage3 流式读取：MergeEngine 用 `.all()` 全量载入，全量门一开大归档 OOM 风险
- B1 identity propagation：required JSON 软引用（workspaceId 等）冲突时不改写本地 canonical PK 仍悬空
- 笔记整树 dir-swap（架构目标态）
- 跨重启降级结果披露（journal v2 + IPC + renderer，若 §10.5 弹窗不够）
- e2e 边角：Windows 大小写别名 / symlink 深化
