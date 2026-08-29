# Backup v2 Hardening 计划审查报告

- 日期：2026-07-23
- 审查对象：`.trellis/tasks/07-23-backup-v2-hardening-roadmap` + 19 child + branding 占位
- 对照源码：`/Users/gd32/Coding/CherryV2/src` @ `dd4eaf7bea`（`feat/backup-v2-restore`）
- 审计事实源：`v2-refactor-temp/docs/backup/backup-v2-correctness-audit.md`
- 方法：只读核对各 child `prd.md`/`design.md` 的根因 file:line、方案、边界/验收、依赖关系；不改计划与代码

> 任务原文写 commit `dd4af7bea` — 实际 tip 为 `dd4eaf7bea`（拼写差一位）。下文一律按后者。

判定图例：`✅合理` / `⚠️问题` / `🔴严重`

---

## 整体小结

### 计划完整性

- Parent 问题地图与审计 **基本一一对应**（19 修复项 + FIELD_MERGE 明确排除 + branding 占位另列）。
- 12 个复杂 child 均有 `design.md`（与 roadmap 要求一致）；P0 与部分轻量 P1 仅 prd — 可接受。
- 多数根因锚点与 `dd4eaf7bea` 源码 **一致或仅轻微行号偏移**；个别路径写错（见下「计划↔源码不一致」）。

### 优先级建议（修订后）

1. **立即开工（低冲突）**  
   - `p0-journal-path-guard`（真·任意路径 rename/rm）  
   - `p0-managed-path-canonical`（校验==发布契约；纵深防御）  
   - `p1-pending-journal-busy-gate`  
   - `p1-dangling-multifk-count`（小、局部）  
   - `p1-overwrite-parent-writable`（主进程校验即可，UI 可拆）

2. **先设计对齐再开工（阻塞/冲突）**  
   - **`p1-uniquemergerules-fk` 必须并入或 blocked-by `p1-merge-identity-propagation`**（见 🔴）  
   - Roadmap「B1 是 dbonly-fileentry-blob 的基础」**不成立** — dbonly 可独立  
   - `journal-crash-converge` **复用** path-guard 的 containment resolver  
   - overwrite：`parent-fsync` ↔ `cancel-window` 先钉「rename 后不可再标 cancelled」  
   - GC：`staging-gc-corrupt` 独占 `.corrupt-*`；`residual-artifacts-gc` 只做 aside/work-failed

3. **可并行但需约定插入点**  
   - `fts-migration-order` + `appstate-invariant-timing` → 统一 `migrate → chain → (app_state?) → FTS → seal`  
   - `composite-fk-partialnull` 与 multifk-count 同改 `repairDanglingRefs` → 错开或同 PR

4. **降优先级 / 产品门**  
   - `backup-extension-rename`（产品未定）  
   - `completed-disclosure` UI/i18n 可第二 PR；先 journal v2 + IPC  
   - FIELD_MERGE remote-wins（23 列）继续等产品（roadmap 已排除 — 正确）

### 阻塞性问题清单

| # | 阻塞 | 说明 |
|---|---|---|
| 1 | 🔴 `uniquemergerules-fk` vs B1 双轨 | 相位顺序、map 角色（source vs target）、degradation 语义三处与 B1 冲突；独立落地会制造抛弃型代码 |
| 2 | Roadmap 依赖误判 | 「B1 是 dbonly-fileentry-blob 的基础」错误；会误绑排期 |
| 3 | overwrite cancel × fsync | rename 成功后若仍 `BackupCancelledError`，比现状更糟 — 两 task 未写死同一 commit point |
| 4 | residual × staging-gc 争 `.corrupt-*` | 双策略互踩风险；必须单 owner |
| 5 | composite-fk `design.md` 与 PRD 决策表不一致 | cascade+全 NOT NULL 写成 setNull(空列) vs DELETE — 实现会踩坑 |

### 可立即开工 vs 需返工

| 可立即开工 | 需返工/对齐后再开 |
|---|---|
| p0-journal-path-guard | p1-uniquemergerules-fk（并入 B1） |
| p0-managed-path-canonical | p1-overwrite-cancel-window（与 fsync 对齐） |
| p1-pending-journal-busy-gate | p1-residual-artifacts-gc（划界 + 缩 scope） |
| p1-dangling-multifk-count | p1-appstate-invariant-timing（收窄语义） |
| p1-overwrite-windows | p1-composite-fk-partialnull（修 design） |
| p1-fts-migration-order | p1-completed-disclosure（缩 UI scope） |
| p1-merge-identity-propagation（B1） | busy-gate 超时 takeover 策略再评估 |
| p1-dbonly-fileentry-blob（修正路径引用） | branding rename（等产品） |
| p1-journal-crash-converge（依赖 path-guard） | |
| p1-staging-gc-corrupt | |
| p1-overwrite-parent-fsync（与 cancel 对齐后） | |
| p1-overwrite-parent-writable（主进程优先） | |
| p1-busy-gate-restart（修注释 + drain guard） | |

---

## 计划 ↔ 源码不一致 / 行号偏移

| 位置 | 计划声称 | 源码实况 @ dd4eaf7bea |
|---|---|---|
| 任务/审计 commit 拼写 | `dd4af7bea` | `dd4eaf7bea` |
| `p1-dbonly-fileentry-blob` | `src/main/services/backup/restorePromotion.ts` | 实为 `src/main/data/db/restore/restorePromotion.ts` |
| `p1-dbonly` BackupService stage | PRD `373-413` | `stageFileResources` ≈ `410-414`（偏宽） |
| `p1-busy-gate-restart` onStop | PRD ≈ `886` | `881-887`（小偏移） |
| `p1-busy-gate` 注释 | success 在 relaunch 前 dispose hold | 代码故意不释放至 `app.exit`（`427-435`）— **注释过时** |
| `MergeEngine.repairDanglingRefs` | 多处写 `1040-1104` | 实质循环约 `1055-1115`（偏宽，同段） |
| B1 `JsonSoftReferencePolicy` | `contributorTypes.ts:38-43,125-133` | 政策接口约 `127-134`（小偏移） |
| `p1-composite-fk` knowledge FK | refs `738-746` | `knowledge.ts` 复合 FK ≈ `124` + DB_FOREIGN_KEYS 段（略偏） |
| 审计 FAIL #7 叙事 | validate 用「lexical canonical」 | 今日已用 `realpathSync(parent)` + basename（`807`）；缺口是 **void 返回 + 下游仍传 raw**（p0-managed PRD 已更正，审计叙述偏旧） |

---

## Parent roadmap

**判定：⚠️问题**

- 覆盖面与审计对齐良好；FIELD_MERGE 排除正确。
- **依赖表述需改**：B1 是 `uniquemergerules-fk` 的基础 — **对**；是 `dbonly-fileentry-blob` 的基础 — **错**（正交：skip/stage 信号 + journal degradations）。
- P0 把 journal 路径从审计「restore HIGH」升格为安全 P0 — **合理**（preboot 任意文件操作）。

---

## P0 — 安全门禁

### `p0-managed-path-canonical`

**判定：✅合理**

- **file:line**：`BackupService.validateOutputPath` `773-833`（canonical@`807`，managed@`821`，exists@`830`，返回 void）；`startBackup` raw 透传 `257`/`288-291`；`assembleArchive` rename ≈ `174-176` — **准确**。
- **方案**：校验通过的 canonical 成为唯一 publish 路径，堵住「校验路径 ≠ rename 路径」。PRD 已承认纯 `..` 多数已被 `dirname(resolve)` 收掉；价值在 symlink 混用 + `overwrite=true` 纵深防御。
- **残留**：validate→rename TOCTOU、base 内既有 symlink 指外 — PRD 已记，可接受。
- **建议**：验收主轴写「校验==发布」；勿把「今日可复现任意 `..` CVE」写过满。

### `p0-journal-path-guard`

**判定：✅合理**（真·P0）

- **file:line**：`restoreJournal.ts` schema 仅 `z.string().min(1)`（约 `60-76`）；`restorePromotion` `path.resolve(userData, …)`（`150`/`160-161`/`611-612`）— **准确**。
- **方案**：schema 可执行契约 + consume-time containment（拒绝对/`..`）正确；fail-closed、无危险兼容 fallback 符合 preboot。
- **建议**：与 `journal-crash-converge` **共用同一 containment resolver**；`db.promote` 优先 basename + 可信 staging 拼装。

---

## P1 — Restore HIGH（数据正确性）

### `p1-merge-identity-propagation`（B1）

**判定：✅合理**

- **file:line**：缺 ordinary/JSON canonicalize `MergeEngine.ts:286-310`；map 已写未消费 root `626-631` / member `729-785`；仅 junction 消费 `955-997`；repair `1055+` — **准确**。
- **设计**：role 分离、post-import 相位、tuple-safe ledger、imported-row scope、required JSON exact path、fail-closed — 覆盖根因；顺序 `importRows → propagate → junction → repair` 正确。
- **风险**：现 `IdentityMap` 仍是字符串 + `setIdentityEntry` 取 PK`[0]` — 升 tuple 必须一次改 junction 查找；`pin.entityId` polymorphic 明确 out-of-scope（可接受，审计留 follow-up）。
- **依赖**：是 uniquemerge 的真基础；**不是** dbonly 基础。

### `p1-dbonly-fileentry-blob`

**判定：⚠️问题**

- **file:line**：主因 `ImportOrchestrator` 空 skip/stage ≈ `190-195` — 准；**错误路径** `services/backup/restorePromotion.ts`（应为 `data/db/restore/...`）。
- **方案**：internal → `skippedFileEntryIds`、external → `stagedFileEntryIds`、hard FK 交 repair — 与引擎语义对齐。
- **副作用**：用户从「列表有附件点开失败」变为「附件行消失」— 需 breaking note。
- **建议**：修正路径引用；**勿绑死 B1**；journal `degradations` 与 crash-converge 字段集对齐。

### `p1-uniquemergerules-fk`

**判定：🔴严重**

- **file:line**：`uniqueMergeRules` providers≈`169`；member 写 map `729-785`；junction 只处理 junction kind — **准确**；问题真实。
- **与 B1 冲突（不可独立落地）**：
  1. 另起 `propagateIdentityToCrossDomainFks` + 字符串 map vs B1 tuple ledger + 统一 phase  
  2. 顺序：本文 `junction → propagate → repair` vs B1 `propagate → junction → repair`  
  3. lookup 用 `sourceMap` 查 target remap — 正确消费端应是 **`targetMap`**（SKIP 目标只进 targetMap）  
  4. 成功 remap 写入 `degradedToSkips` vs B1「无损保留 ≠ degradation」  
  5. design 仍列 `pin.entityId`，与 PRD out-of-scope 自相矛盾
- **建议**：**取消独立实现轨**，并入 B1 AC（`user_model` 七列 FK）；若必须补丁则 `blocked-by: merge-identity-propagation`，且 lookup=`targetMap`、成功 remap 不进 degradation。

### `p1-journal-crash-converge`

**判定：✅合理**

- **file:line**：finalize 先写 terminal 再删 staging（`restorePromotion` ≈`45-50`/`589-592`）；writer/`backupRestoreGate` crash net — **准确**。
- **方案**：prepare-before-staged + rename 激活 intent、proof-before-cleanup — 对症；全盘不可写 → fail-closed 诚实。
- **建议**：`blocked-by` / 复用 path-guard resolver；钉死唯一 durable selector 原语后再开写。

### `p1-busy-gate-restart`

**判定：⚠️问题**

- **file:line**：`activeOperation`/`onStop` abort-only/`setBackupInProgress` 无 epoch/finally 无条件释放 — **大体准确**；`restoreQuiesceHold` 注释与代码不一致。
- **方案**：epoch + pendingInFlight + token 化 gate — 方向对。
- **坑**：drain 超时后仍接受新 op 未消灭互踩；epoch 递增顺序须测死；drain 期间 startBackup/startRestore 须另 guard。
- **建议**：超时优先 **拒绝新 op / fail-fast**，而非 takeover；修正 hold 注释。

---

## P1 — Overwrite RISK

### `p1-overwrite-parent-fsync`

**判定：⚠️问题**

- **file:line**：`archive.ts` rename 后 parent fsync — **准确**。
- **方案**：post-publish fsync 失败 → success-with-warning 合理；签名扩 warnings 有调用面扩散。
- **建议**：先与 cancel-window 约定 rename 后不可再标 cancelled。

### `p1-overwrite-cancel-window`

**判定：⚠️问题**

- **file:line**：detach-on-close / fsync / rename — **准确**。
- **洞**：若 abort 发生在 **rename 已成功** 之后仍 `BackupCancelledError`，会「UI cancelled + 旧 `.cbu` 已被换」— 比现状更糟。
- **建议**：commit point = rename 返回瞬间；其后 abort 只 detach/记 warning。

### `p1-overwrite-windows`

**判定：✅合理**

- **file:line**：win32 跳过 parent fsync；统一 rename；占用无专用 IPC — **准确**。
- **方案**：POSIX 保持原子；Windows best-effort + publish 点 `EACCES/EPERM` → `BACKUP_OUTPUT_FILE_IN_USE`；拒 unlink-first — 正确。

### `p1-overwrite-parent-writable`

**判定：⚠️问题**

- **file:line**：校验无写预检 — **准确**；`wx` probe 优于 `access(W_OK)` — 合理。
- **建议**：主进程 + IPC code 先合；UI 文案可拆第二 PR。

---

## P1 — Restore MEDIUM

### `p1-appstate-invariant-timing`

**判定：⚠️问题**

- **file:line**：merge tx 内 key-set 检查早于 `applyMigrations` — **准确**。
- **风险**：把「merge 不得改 key-set」扩成「migration 也不得改」会挡合法跨版本 restore。
- **建议**：若只防 merge bug，保留 in-tx check并改注释；若真禁 migration 改 key，须写进 migration 作者契约 + 合成测试；与 FTS 统一 post-migration 顺序。

### `p1-composite-fk-partialnull`

**判定：⚠️问题**

- **file:line**：`repairDanglingRefs` + `knowledge_item` 复合 FK — **准确**（行号略偏）。
- **文档自相矛盾**：design `decide()` 对 cascade+全 NOT NULL 写成 setNull(空列)，与 PRD/现状 DELETE 不一致。
- **建议**：以 PRD 三元决策为准修 design；reason 字符串同步测试。

### `p1-dangling-multifk-count`

**判定：✅合理**

- **file:line**：按 violation 快照循环、不看 `changes` — **准确**。
- **方案**：`(table,rowid)` 去重 + `changes>0` 才计数 — 最小正确修复。

### `p1-fts-migration-order`

**判定：✅合理**

- **file:line**：FTS rebuild/check 在 migration 前 — **准确**。
- **方案**：最终 FTS 挪到 migration + chain verify 之后、seal 之前 — 正确。
- **建议**：与 appstate 约定统一插入点。

### `p1-staging-gc-corrupt`

**判定：✅合理**

- **file:line**：corrupt quarantine 后整根 `rmSync` staging — **准确**。
- **方案**：preboot 只隔离；PID `.restore-live`；dead-only scoped GC — 安全优先。
- **划界**：`.corrupt-*` GC **归本任务独占**（residual 不得再实现）。

### `p1-residual-artifacts-gc`

**判定：⚠️问题**

- **file:line**：aside / work-failed / corrupt 积累；recovery 不扫 — **准确**。
- **问题**：与 staging-gc 争 `.corrupt-*`；AC 再加 list/ack IPC 扩 scope。
- **建议**：本任务只做 aside + work-failed；corrupt 交给 staging-gc；IPC 并进 completed-disclosure 或后续。

### `p1-completed-disclosure`

**判定：⚠️问题**

- **file:line**：degradedToSkips 不进 journal；无 ack API；下次 startRestore 清 completed — **准确**。
- **方案**：journal v2 + get/ack IPC — 对症；UI/i18n 过重。
- **建议**：先 journal 字段 + IPC + 未 ack 拒绝再 restore；UI banner 第二 PR；与 pending-busy-gate 保持「completed 不拦 export」。

### `p1-pending-journal-busy-gate`

**判定：✅合理**

- **file:line**：`startBackup` 只查内存 `activeOperation`，不查 staged/promoting — **准确**。
- **方案**：复用 `hasPendingRestore()` → `BACKUP_RESTORE_PENDING`，插在 reserve 前 — 面小正确。**优先合入。**

---

## Branding 占位

### `backup-extension-rename`

**判定：⚠️问题**（非 hardening）

- 扩展名产品未定；「机械替换」无兼容矩阵；RC 前不兼容旧 `.cbu` 需产品确认。
- **建议**：等产品拍板；勿与正确性 P1 抢带宽。

---

## 重点关注复核（任务书要求）

### P0 安全能否真正堵住

| 项 | 结论 |
|---|---|
| `journal-path-guard` | **能**堵住绝对路径/`../` 注入到 promote/aside/rm（lexical containment + schema）。base 内既有 symlink 指外仍残留 — 计划已标。 |
| `managed-path-canonical` | **能收紧契约**（校验==发布）。今日已有 realpath 父目录检查，剩余是 raw 透传分歧；symlink-in-base / TOCTOU 仍在。 |

### B1 identity ledger

- 设计层完备；必须一次性替换 string/`[0]` map，并 **吞掉 uniquemergerules 独立轨**。
- post-import 相位时机（propagate before junction before repair）正确。

### 数据正确性主线

| Task | 结论 |
|---|---|
| dbonly-fileentry-blob | 方向对；修路径引用后可独立开工 |
| uniquemergerules-fk | 🔴 并入 B1，禁止双轨 |
| journal-crash-converge | ✅ 依赖 path-guard |
| busy-gate-restart | ⚠️ 方向对，超时策略收紧 |

---

## 审查人备注

- 本报告只读；未改 `.trellis/`、`src/`、测试。
- 子 agent 交叉审查 + 主审查对 P0/B1/uniquemerge/validateOutputPath 源码抽检。
- 建议 GLM 下一步：先改 roadmap 依赖句 + 把 uniquemergerules 标为 B1 子集/blocked-by，再开 P0 双 commit。
