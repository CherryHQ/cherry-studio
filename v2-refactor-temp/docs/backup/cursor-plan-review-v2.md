# Cursor adversarial review v2 — full-restore staging plan

审：`.trellis/tasks/07-24-backup-v2-full-restore-staging/{prd,design,implement}.md`（声称已修 5 P0 + preset 自动判断）。  
方法：对照真实代码，假设计划仍有错；不背书。

---

## Claimed fixes — verification

| Claim | Verdict |
|-------|---------|
| 1. journal paths `toRel=relative(userData,abs)` | **OK in sketch**（若照做）；preboot `assertPathInsideUserData` 要求 relative（`restorePromotion.ts:33-36`） |
| 2. file livePath = `resolvePhysicalPath(row)` | **OK direction**；但见 P0 workDb 已关 + row 形状 |
| 3. skills `f.folderName` | **OK**（`manifest.ts:115-119` + `SafeNameSchema`） |
| 4. 已存在 → overwrite + aside | **Forward rename 对目录可用；rollback 对目录不可用** → P0 |
| 5. notes outside userData skip | **部分对**；只查 `isPathInside(live, userData)`，**不**绑 notesRoot → 仍可 traversal |
| auto: `presetIncludesFiles` → `[]` | **OK**（`presets.ts:47`） |
| UI 删 FullGate | **方向对**；调用点未列全 → P1 |
| roots keys | **OK**（`BackupService.ts:216-217`） |

---

## Findings

### P0-1 — `overwrite` 对目录：forward 能过，inverse / failed finalize 会丢用户数据

**Evidence**
- Plan：`design.md:50` / `implement.md:9` 声称「overwrite 对目录 OK，`applyEntry` aside-first + move」
- Forward：`applyEntry` overwrite（`restorePromotion.ts:545-554`）`renameDurable(live→aside)` + `moveIdempotent(staging→live)` — **目录 rename 可以**
- Inverse：`inverseEntry` overwrite（`restorePromotion.ts:640-645`）`fs.rmSync(live, { force: true })` **无 `recursive`**
- Node：对非空目录 → `ERR_FS_EISDIR`（已实测）
- 测试自己承认这是 poison：`restorePromotion.test.ts:473-509`（「live path is a non-empty DIRECTORY, so the inverse's non-recursive rmSync throws」）
- `finalize`（`restorePromotion.ts:661-664`）`rmSync(stagingRoot/restoreId, { recursive })` — plan 的 aside 在 `…/restoreId/aside/…`（`implement.md:45`）→ **terminal 时连同旧 KB/skills 树一起删掉**

**Failure scenario**
1. Full restore，本地已有同 `baseId` KB / 同名 skill → plan 发 `overwrite` + aside  
2. `entries-applied` 中该目录 overwrite 已成功，后续某 entry ENOSPC / 抛错  
3. `revertPostCommit` → `inverseManifest`：目录 `rmSync` 抛 EISDIR（best-effort continue）  
4. 旧目录仍在 `aside`；`finalize(failed)` 删掉整个 `restoreId` 树 → **用户原 KB/skills 目录被物理删除**  
5. DB 已滚回旧库，live 上可能仍留着半新目录 → 旧 DB + 错文件 / 或目录丢失

**Fix（派工前必须定一种）**
- **A（推荐，改 plan）**：KB/skills **禁止** `overwrite`；冲突 → skip 该 resource + degraded，或整次 expire 并文案说明；仅 files/notes 用 overwrite  
- **B（改 promotion，超出本 PR 骨架声称）**：`inverseEntry` 对目录 `rmSync(live, { recursive: true, force: true })`，并加 directory-overwrite 单测；aside **不得**放在会被 `finalize` 删光的 `restoreId/` 下（或 failed 路径先保证 inverse 成功再删）

计划把 B 当成「已验证」是错的。

---

### P0-2 — `stageFileResources` 传入的 `workDb` 在调用点已 close

**Evidence**
- Plan：`implement.md:34` `stageFileResources({ workDir, manifest, workDb })` 在 L234；并用 `workDb.prepare('SELECT * FROM file_entry…')`（`implement.md:50`）
- 真实时序（`ImportOrchestrator.ts:221-234`）：
  - L223-225：`sealWork` → **`workSqlite.close()`** → `workSqlite = undefined`
  - L234：才 `stageFileResources()`
- 调用点没有仍打开的 work 连接

**Failure scenario**
照 plan 接线 → `workDb.prepare` 对已关闭 DB 抛错，或类型上根本传不进已 `undefined` 的 handle；full staging 无法落地。

**Fix**
- 签名改传 `workPath`（或 `backupDbPath`），在 stager 内 `new Database(workPath, { readonly: true, fileMustExist: true })` 再 SELECT；或  
- 在 seal/close **之前**读出所需 `file_entry` 行（仍保持 journal 写在 seal 之后）

不要假装 L234 还能用合并期的 `workDb`。

---

### P0-3 — notes / knowledge 路径穿越：只护 userData，不护 resource root

**Evidence**
- Plan notes：`implement.md:81-82` 仅 `isPathInside(liveAbs, userData)`  
- Export 侧 notes 有根内守卫（`SqliteFileStager.ts:351-354`：拒 `..` + `isPathInside(resolve(notesRoot,rel), notesRoot)`）  
- Restore 入站 manifest：**不信任**：`notes.paths: z.array(z.string())`、`knowledge.bases: z.array(z.string())`（`manifest.ts:110,123`）— **无** SafeName / 无 traversal 校验  
- skills `folderName` 有 `SafeNameSchema`（无 `/`、`..`）— 不对称  
- `isPathInside`（`path.ts:43-51`）在 child 仍位于 userData 内时返回 true，即使已逃出 notesRoot

**Failure scenario**
篡改 `.cherrybackup` 的 `manifest.json`：
- `notes.paths: ["../Data/Files/<id>"]` 且 zip 内有对应 `notes/…` 载荷（或同布局）  
- `liveAbs` 仍在 userData 内 → plan **不会 skip** → `note-overwrite`/`note-add` 可打到 Files / 其他托管树  
- 同理 `knowledge.bases: ["../Files/…"]` 或逃向其他 userData 子树

preboot 只保证「在 userData 内」，**不**保证「在 notes/KB root 内」。

**Fix**
对每个 resource：`isPathInside(resolve(root, id), root)`（notes 对齐 export）；拒 `..` 段；KB `baseId` 建议收紧为 SafeName/UUID；失败 skip 或拒收 archive。

---

### P0-4 — merge SKIP 后仍按 `existsSync` overwrite → DB/blob 语义撕裂

**Evidence**
- Plan：凡 live 存在 → `overwrite`（files/KB/skills）（`implement.md:54-75`）  
- Merge：uuid-entity 冲突默认 **SKIP 保留本地行**（架构 / `MergeEngine`）；`ImportOrchestrator.ts:193-194` 仍传空 `skippedFileEntryIds` / `stagedFileEntryIds`  
- Staging 在 merge **之后**，且只看磁盘 `existsSync`，不看「该 id 是否从 backup INSERT」

**Failure scenario**
本地已有同 id 的 `file_entry` / 同 `knowledge_base` id / 磁盘上已有 KB dir：  
- DB：SKIP → 本地行列保留  
- FS：plan overwrite → 本地 blob/目录被 backup 替换  
→ 本地元数据 + backup 内容，或本地 KB 行 + 被覆盖的目录；undo/披露都对不齐。

**Fix**
只为「backup 侧实际进入 work 的行 / manifest 且 merge 未 SKIP」建 FileResource；或 files：仅当 work 行来自 backup INSERT 时 stage；冲突目录 → skip+degraded，而不是静默 overwrite。至少在 plan 里写清与 SKIP 的交点（当前零字）。

---

### P1-1 — `stagedFileEntryIds` 仍为空：full 的 soft-ref disclosure 仍按 DB-only

**Evidence**
- `ImportOrchestrator.ts:193-194`：`stagedFileEntryIds: new Set()`  
- `MergeEngine`：空集 → message attachment **全部 disclose**（测试注释 DB-only）  
- Plan 的 auto full 路径不填 `manifest.files.ids`

**Failure scenario**
Full archive 明明带了 blob，merge 仍把已 staged 的 `fileEntryId` 当未 staged 披露/降级。

**Fix**
merge 前：`stagedFileEntryIds = new Set(archiveContext.resourceMetadata.fileIds)`（或 `manifest.files.ids`）。

---

### P1-2 — aside 生命周期：成功后立即删掉；失败路径与 P0-1 叠加

**Evidence**
- aside 规划在 `feature.backup.restore.staging/<restoreId>/aside`（`implement.md:45`）  
- `finalize` 删除整个 `restoreId` 目录（`restorePromotion.ts:661-664`）  
- completed 后文件级 aside 不存在 → 无法靠文件 aside 做 undo（只剩 DB aside）

**Failure scenario**
成功 restore 后用户期望「撤销」恢复旧 KB 文件树 → 只有 DB undo，文件 overwrite 不可逆。失败路径见 P0-1（aside 未 inverse 成功就被 finalize 删）。

**Fix**
文档写明：文件 overwrite 不可 undo；aside 仅服务 promotion crash；或把 file aside 迁出 `restoreId` 并纳入保留/GC 策略。失败路径必须先修好 P0-1。

---

### P1-3 — 删 FullGate：调用点 / 测试会红，plan 未列全

**Evidence**
- Plan：`implement.md:98-99` 只写删 `V2BackupActionGate.tsx` 内符号  
- 仍引用：`BasicDataSettings.tsx:27,225`、`LocalBackupSettings.tsx:26,197`、`BackupGates.test.tsx` 多处

**Failure scenario**
只删定义 → typecheck/test 红；或留下死 import。

**Fix**
checklist：unwrap 两处 settings 的 `<V2BackupRestoreFullGate>` → 直接 `V2BackupRestoreGate`；重写/删 `BackupGates` 里 Full 用例；搜全仓 `isV2BackupRestoreFullReady`。

---

### P1-4 — notes「userData 内 only」与架构 dir-swap 仍不一致（产品脚枪）

**Evidence**
- 架构：`backup-architecture.md:419` — notes **directory-level near-atomic swap**，additive/per-file 明确写了 wrong  
- Plan：per-file `note-add`/`note-overwrite` + 外置 root 全 skip（`design.md:33`）

**Failure scenario**
用户自定义 `feature.notes.path` 在 userData 外（常见）→ full restore **静默不恢复任何 note body**，DB overlay 可能仍合并 → starred/路径指向空树。  
即使用户Data 内 managed notes，per-file additive 与架构「中断可见 / 重试双污染」风险仍在（promotion 有 rollback，但与架构目标态不符）。

**Fix**
MVP：文档 + UI 明确「仅 managed notes；自定义 path 不恢复正文」；或另任务做 notes 整树 swap（可接受出 userData 的 journal 扩展 — 今日 gate 禁止）。

---

### P1-5 — `resolvePhysicalPath(row)` 与 raw sqlite 行形状 / external

**Evidence**
- `PathResolvableEntry` 要 camelCase `externalPath`（`pathResolver.ts:17-19`）  
- `better-sqlite3` raw `SELECT *` → `external_path`  
- internal 只用 `id/origin/ext`（列名一致）→ 通常 OK  
- 若异常出现 `origin='external'` 且进了 `files.ids`：`resolvePhysicalPath` 走绝对 `externalPath` → `toRel` 越界 → preboot expire 整次恢复

**Fix**
映射 row → `PathResolvableEntry`；`origin !== 'internal'` 跳过；不要把 raw row 直接丢进 resolver。

---

### P2-1 — ENOSPC：live→aside 已成功、staging→live 失败

**Evidence**
- overwrite 顺序 aside-first（`restorePromotion.ts:549-553`）  
- 文件：inverse 通常能 aside→live  
- 目录：撞 P0-1

**Fix**
绑在 P0-1；可另加磁盘预检（非本 plan 必需 blocking，目录修前仍是 P0）。

---

### P2-2 — KB `index.sqlite` + WAL 在 overwrite 整目录时

**Evidence**
- Export 排除 `.cherry/index.sqlite*`（`SqliteFileStager.ts:243-247`）  
- Promotion 在 preboot、主 DB 零连接；KB 服务通常未起 → 打开句柄风险低  
- overwrite 整目录会换掉用户自 restore 以来的本地 KB 改动（预期需产品确认）

**Fix**
e2e 断言无 index 或 restore 后需 rebuild；不阻塞派工若接受「整目录替换」。

---

### P2-3 — `this` / `restoreId` 闭包

**Evidence**
- stub 为 `startRestore` 内 arrow（`BackupService.ts:434`）— `this` / `restoreId` 词法捕获正确  
- `resolveNotesRoot` 为实例方法（`BackupService.ts:741`）— OK

**Fix**
无。Claim 成立。

---

## 总体判断

**不可按当前 implement 草图直接派工。**

Blocking：
1. **目录 `overwrite` + 非递归 inverse + aside 落在 `finalize` 删除树内** → 失败回滚可 **物理删掉用户原 KB/skills**（P0-1）  
2. **`workDb` 在 L234 已关闭**（P0-2）  
3. **untrusted manifest 的 notes/KB path traversal**（P0-3）  
4. **SKIP 与 exists→overwrite 未对齐**（P0-4）

先前 5 个 P0（relative / resolvePhysicalPath / folderName / exists 分支 / notes 外 skip）方向大多对，但 **#4 对目录过度自信**，且漏了 orchestration 时序与 untrusted manifest。

建议派工门槛：先改 plan（KB/skills 冲突策略选 A 或真正修 promotion inverse+aside 布局；workPath 只读重开；root 内 containment；merge/stage 协调），再进实现。估时：修 plan + MVP（files + 冲突 skip 的 KB/skills + managed notes）仍约 **1–2 天**，不是「2h 照抄」。
