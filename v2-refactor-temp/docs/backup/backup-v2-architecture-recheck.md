# Backup v2 架构重新梳理（基于楠总蓝本 ef1ae2cbc + 全局现状）

> 2026-08-01。起因：用户指出我的 `backup-v2-architecture-overhaul-plan.md`（D1-D11 大重构）可能偏离楠总冻结蓝本 + 涉及大量上游更改。重新对照楠总 design + memory + 全局现状梳理，**防止过度设计/架构漂移**。
> **本文是"现状梳理 + 决策框架"**，代码核实部分由 subagent 填（待补 §2/§3）。

---

## 0. 全局现状（关键发现，重塑整个推进方案）

### 0.1 两套实现并行（不是一套）

| 方案 | PR / 分支 | 机制 | 状态 |
|---|---|---|---|
| **整库替换（beta 主线）** | `#17499`（vaayne，`feat/backup-v2-replacement`） | whole-database replacement，回归 v1 语义，**不用 MergeEngine/identity propagation**（README §10 列为 do-not-reintroduce） | **OPEN，产品 2026-07-27 Kenny 拍板 beta 主线** |
| **merge 方案（推迟）** | `#17206`（GeorgeDong32，`feat/backup-v2-restore`） | partial quiesce + backfill/SKIP/FIELD_MERGE merge + identity propagation（楠总 D model） | **OPEN，产品推迟 beta 后** |

### 0.2 楠总 `docs/references/backup/backup-architecture.md` = **merge 方案的 design**

- ef1ae2cbc doc-approved（2026-06-19），2026-06-20 解冻 surgical（整体架构不大改）
- 它是 **merge 方案**的完整设计（contributor 14 域 + D model detached merge + preboot promotion + identity propagation + 26 invariants）
- **不是 #17499 整库替换的设计**（#17499 回归 v1 语义，README §10 明确 do-not-reintroduce MergeEngine）
- **#17499 明确 supersede #17206**：README 声明 "No MergeEngine, no conflict strategy, no contributor framework. Replacement over merge." + "this PR supersedes the selective-domain merge contract of #17206"；作者 vaayne 立场 "merge contract was the source of most of #17206's complexity, serving a contract **nobody had chosen**; removing it deletes the failure modes (no partial-domain restore, no identity collision, no dangling reference)"
- → **楠总 merge design + 我的 overhaul + `feat/backup-v2-restore` 分支，在 beta 主线下整体被 supersede**；是否"beta 后重启作为独立能力"= 决策点 0

### 0.3 我的 overhaul 审查的是哪个？

- 我的 `backup-v2-architecture-overhaul-plan.md`（D1-D11，12-18w）基于**读 `feat/backup-v2-restore`（merge 分支）代码 + 6 维度 subagent 审查**
- 即：我在**产品已推迟的 merge 分支**上，对**楠总已批准的 merge design** 提"架构 gap"
- 复核后发现：大多数所谓"gap"是**楠总 design 选择**（partial quiesce+backstop / atomic rename / native notification / schema single source），非真 gap

### 0.4 苏垚(@DeJeune)的未决质疑（更根本）

> 跨设备合并不该在备份恢复层，是数据同步/一致性层的事。

- 若此质疑成立 → merge 方案应**移出备份层**到独立同步层 → 楠总 merge design + 我的 overhaul **整体重新定位**，不只是"回炉"
- 产品 Kenny 拍板"beta 走 #17499，merge 推迟"，但**未决 merge 最终定位**（保留推迟 / 移出 / 放弃）

---

## 1. 推进方案的根本决策点（用户最后 review 决策）

### 决策点 0（最根本）：merge 方案（`feat/backup-v2-restore` / #17206）的最终定位

| 选项 | 含义 | 对我的 overhaul 的含义 |
|---|---|---|
| **A. 推迟重启** | beta 后 (#17499) 之外，merge 作为"跨设备合并"独立能力重启 | overhaul **有意义但需大幅瘦身**：撤回 D1/D2/D3/D7（楠总 design 选择），保留落地楠总 TBD（D5/D6/D8/D11）+ 修实现 bug（A4/B1/B16/C1-C8）；12-18w → ~4-6w |
| **B. 移出备份层** | 苏垚质疑成立，merge 移到独立数据同步层（非备份） | overhaul **整体重新定位**：merge design + 实现迁出 backup 模块；楠总 design + 我的 overhaul 都要重做 |
| **C. 放弃 merge** | beta #17499 整库替换够，merge 不再做（vaayne/#17499 立场："complexity serving contract nobody chose"） | overhaul **无意义**（撤回）；`feat/backup-v2-restore` 分支退役；只保留阶段 0 安全修复（含 B1/a1 已 landed 的通用部分评估） |
| **D. 其他** | （用户自定义） | — |

> **决策点 0 是一切的前提**。在它确定前，"overhaul 回炉"无从谈起——B/C 下 overhaul 直接作废，A 下才需瘦身。

### 决策点 0 的子决策（若选 A 推迟重启）

- 0-A-1：苏垚质疑是否在 beta 后正式评估（决定 A vs B）
- 0-A-2：merge 重启时机（beta 稳定后？特定版本？）
- 0-A-3：当前 `feat/backup-v2-restore` 分支处置（保留待重启 / rebase main 保活 / 退役）

---

## 2. 楠总 design vs 代码现状（§9 D model / §5-6 contributor / §9 资源）—— 待 subagent 核实填充

> 3 个 sonnet high subagent 核实中（quiesce+promotion+lifecycle / 决策+merge+identity / 资源+undo+UI）。每个 finding 对照楠总 design 判断四类：**实现 gap** / **design TBD** / **偏离 bug** / **一致误判**。
> 核实要点：A1（a1/drain 现状 + aside 是否可 undo）、A3（promotion 现状）、A4（OOM）、B1（决策是否 schema single source）、B7（native notification 现状）、B9（undo 现状）、B10/B11（资源 by-design vs gap）。

（待填）

### 2.1 已 landed 代码（`feat/backup-v2-restore`）真实 bug —— teammate 审计回传（hold-audit/tests-audit/restore-audit）

> 这些是 **merge 分支已 landed 代码的实现 bug**（a1 hold = f58336c55c / B1 = 895b653864）。**与决策点 0 关系**：仅决策点 0 = A（merge 重启）时必修；B/C 下随分支退役。**注意：#17499 整库替换不用 a1**（用 prepared/armed split + checkpoint，不走 mutation barrier）→ a1 bug 不迁移到 beta。

**a1 WindowManager hold（f58336c55c）—— 核心机制已闭合（当前代码核实 + hold-audit 最新确认；teammate 第一轮 4P1 基于旧代码，过时）**：

最新核实（2026-08-01，feat/backup-v2-restore HEAD）：
- ✅ **resumePool barrier 绕过已修**：`WindowManager.ts:987-992` `if (this.mutationCapableOpenBlocked && metadata.mutationCapable) { ...return }`（hold 期间拒 resume warm）
- ✅ **dispose 错误恢复 pre-suspended pool 已修**：hold-audit 确认 `:834-914` 精确 pool 状态恢复（记录本次 acquire 实际 suspend 的 type）
- ✅ **native notification i18n 已实现**：`BackupService.ts:606/609/612/637` 用 `t('backup.restore.notification.*')`（**非** restore-audit 早期说的硬编码英文 —— 它基于旧代码；当前已 i18n）
- ✅ **setImmediate 双 gate 已实现**：`:1089-1123`

剩余 P2（非核心 hold 机制，可选）：
- WindowManager 单测缺口（`WindowManager.test.ts` mock registry 缺 mutationCapable，无 acquire/destroy/block/dispose 测试）
- main-process consumer 边界（MainWindowService activate/second-instance）WindowBlockedDuringRestoreError 未 catch（IPC 路径已被 IpcApiService `:85-97` gate 覆盖）
- WindowBlockedDuringRestoreError → BACKUP_IN_PROGRESS IPC code 映射（`IpcApiService.ts:94-96` 当前 INTERNAL，违反注释 contract）
- stale comment `BackupService.ts:414-420` "a1 follow-up"（已 landed）

**结论修正**：a1 hold 核心机制（resumePool/dispose/i18n/setImmediate）**已闭合**（最新 hold-audit + 当前代码核实）。teammate 第一轮 4P1（resumePool 绕过/dispose/i18n）基于旧代码，**已修**。剩余仅 P2 测试缺口 + 边界 consumer。→ forward-plan 节点 0 a1 hold 修**大幅缩减**（核心已修，只剩 P2）。

---

## 3. 我的 overhaul 逐个复核（D1-D11 + A1-A4/B1-B18/C1-C8）—— 待 §2 核实后填

### 3.0 综合分类（3 subagent + teammate + general-purpose 核实后）

> 来源：subagent-决策/merge/identity（B1/A4/B3/B4/B12/B16/B17/B18）+ subagent-资源/undo/UI（B7/B8/B9/B10/B11/B13/B15）+ general-purpose（A1/A3/B5/B6/B14/C1/C2/C3）+ teammate（a1 hold bug + stage2 缺口）。**subagent-1（quiesce/promotion 正式 task-notification 待）**，C1/C3 冲突待它确认。

**🔴 撤回（一致误判 —— 楠总 design/代码已覆盖，我误判为架构 gap）**：
- **D1/A1** writer 全 gate（楠总 partial quiesce+backstop 是设计选择；a1 已 landed；[[backup-a1-must-do]]）
- **D4/B1** 四层决策（subagent-2 确认 **B1 一致误判**：`ReadonlyBackupRegistryImpl.ts:115-147` schema single source，MergeEngine 读 registry 非独立推导）→ **撤回 D4 大重构**
- **D3/A3 per-resource marker**（楠总 step-level+atomic rename 已够；per-resource 撤回，仅 inverse 失败吞掉是偏离 bug）
- **D7/B7,B8,B13** window/durable progress/popup（subagent-3 一致误判：native notification + auto-relaunch 已实现 `BackupService.ts:603-685`）
- **B10 external**（subagent-3 一致误判：by-design dangling，只恢复 externalPath）
- **B11 通用 checksum**（subagent-3 撤回：非冻结 design 要求）
- **B12 credential 泄露指控**（subagent-2 **不成立**：现有披露未含 credential 值）
- **C1 journal transition**（**hardening，非 architecture finding**，subagent-1 权威）：楠总 §9 要 state machine（代码 `restoreJournal.ts:36-48,110-126` 已限制状态/step 形状 + filesystem probe 恢复），**未要求集中 validator API**；production 无实际非法 transition 路径；但 tests-audit 发现测试 `restoreJournal.test.ts:163-170` 固化绕过 validator 的任意写 → **防未来 hardening + 反转测试**（teammate §3.1 promotion inverse/quarantine 缺口属 A3 范畴，非 C1）
- **C3 relaunch**（**一致误判，撤回独立 finding**，subagent-1）：production 无双调度路径（`BackupService.ts:815-825` relaunch 前重验 journal staged + active-operation guard），same-process restart 由 B5/B6 覆盖 → 撤回独立 C3（B5/B6 修复时验证 relaunch）
- **B14 cancel**（**design TBD**，subagent-1）：楠总 §9 只要求 drain bounded + unclean verdict 阻止 snapshot，**未规定 timeout/AbortSignal SLA**；代码固定 5000ms 仍 fail-closed → 需上游补 cancel latency contract 再改（非 architecture P1）
- **C2 clearRestoreJournal**（**契约清晰度，非 correctness bug**）：subagent-1 判实现 gap（clear 不清 `.tmp`/fsync parent），但 restore-audit 判不成立（clear 是 best-effort 契约 `restoreJournal.ts:227-241`，新 `writeRestoreJournal` 原子覆盖残留 `:166-193`，**不破坏 promotion correctness**，最坏 terminal disclosure 暂时重复）→ **非 correctness bug**，可选统一 clear/remove 语义（契约清晰度）

**🟡 design TBD（design 未规定，需上游明确，非 bug 非误判）**：
- **A4 OOM**（subagent-2：design 无内存/批边界；代码全量物化 `MergeEngine.ts:562-581,1066-1205,1670-1810` 属实）→ 需 design 明确性能约束
- **B4 JSON soft-ref**（subagent-2：contributor contract 无 target/path 表达；MergeEngine 硬编码 agent_workspace `:364-428,1508-1602`）→ **需上游补 contributor contract**
- **B12 FIELD_MERGE 披露 contract**（subagent-2：design 未定义字段级披露）→ 需上游明确
- **B17 性能 N+1 / B18 FTS 双倍**（subagent-2：design 无性能预算；最终 rebuild 符合 design）→ 需上游明确 bulk 策略
- **B6 generation fencing**（general-purpose 判 design TBD）

**🟢 修实现 bug（代码偏离 design，不改架构）**：
- **A3** inverse 失败吞掉后 finalize（general-purpose 偏离 bug + teammate §3.1 PR2a 印证）
- **B5** sealed service restart 误释放 quiesce（general-purpose 偏离 bug）
- **B3 composite identity**（subagent-2 实现 gap：MergeEngine 用 PK[0] + 跳过 composite FK `:1388-1409`，dbSchemaRefs 已生成 composite `:796-803`）
- **B16 contributor hook**（subagent-2 实现 gap：ExportOrchestrator 只接 collectFileResources，beforeArchive/transformRow/restoreResources/afterImport 未接；FTS 由 MergeEngine 直调非 afterImport）
- **B9 undo / B15 Notes dir-swap / B11 SKILLS+KNOWLEDGE**（subagent-3：undo 同 gate 未落地；Notes 应 dir-level swap+custom root 非逐文件 note-add `resourcePlanning.ts:416-449`；SKILLS full 完整性 + KNOWLEDGE existsSync 判完成，KNOWLEDGE 需 @eeee0717 #16848）
- **C2 clearRestoreJournal**（general-purpose 实现 gap）
- **a1 hold 4P1**（teammate §2.1：barrier 绕过 / 状态污染 / 未捕获异常 / i18n）

**🟠 保留落地（楠总 follow-up，方向稳）**：D5 identity（B1 landed + B3 composite 修）/ D6 undo（B9）/ D8 资源（MCP/SKILLS/KNOWLEDGE/OVERWRITE/Notes）/ D11 路径（B15）/ D9 性能（A4 需 design TBD 先明确）

**通用安全修复（与 merge 定位无关）**：阶段 0 九 commit + B1/a1 已 landed —— 任何决策点 0 选项都评估保留/迁移（注意 #17499 不用 a1，a1 bug 不迁移）。

### 3.1 stage2 plan 契约缺口（teammate 审 stage2 promotion/decision）—— 决策点 0 = A 时必修

> 这些是我 **overhaul plan（stage2）的契约缺口**（teammate hold-audit/restore-audit 回传，含 file:line + 复现）。**与决策点 0 关系**：仅 A（merge 重启）时 relevant（stage2 是 merge 重启的 PR）；B/C 下 stage2 plan 随 overhaul 撤回。**重要**：这些是 plan 层缺口，印证 D3/D4 设计不全（非楠总 design gap，是我的 overhaul 细节没闭环）。

**PR2a promotion/reconcile（A3 原子性）—— 3 个 P1**（restore-audit）：
- **P1-1 `inverse-pending` 无 reconcile 分支**：`stage2-plan.md:53-66` inverse 前落 `inverse-pending`，成功后 `inverse-done`，但 `:69-74` reconcile 只定义 `inverse-failed` 重试 + DB 已 promote 继续 forward，无 `inverse-pending`（尤其 DB 已回 old 后）方向判定。代码 `restorePromotion.ts:640-655`（park new DB → restore aside → inverse manifest）+ `:442-452`（aside 消失识别 interrupted revert）证明该状态真实存在。失败 → old DB + new resource mixed。修法：journal 加 `direction: 'forward'|'inverse'` durable 写入
- **P1-2 `applied` marker 写失败无 fail-closed**：`:44-50` apply 后才写 `applied`，`:69-75` reconcile inverse 只处理 `applied` 未 `inverse-done` 的；但 `:78-83` 无 marker write failure case。代码 `restoreJournal.ts:166-193` write 可失败 + `restorePromotion.ts:513-526` post-commit marker failure 继续。失败 → A apply 但 `applied` write 失败 → inverse selector 跳过 A → mixed。修法：marker write failure 纳入状态机（写失败立即停，不跨 DB commit）
- **P1-3 N 次 inverse 失败 quarantine 无 durable 状态**：`:69-74/:81/:87-94` 要求 quarantine 但 marker schema `:31-42` 无 journal-level quarantine state。代码 `restoreJournal.ts:101-129` state union 无 quarantined + `restorePromotion.ts:119-131` terminal 删 staging + `:755-769` corrupt quarantine 删整个 staging（不能用于 inverse，会丢重试材料）。修法：独立 schema-valid `quarantined` state + 工件保留 + boot policy

**PR2b decision graph（B1/D4）—— 3 个 P1**（hold-audit）：
- **P1-1 2a/2b decisionId 循环依赖（深化 Cursor 发现）**：`stage2-plan.md:34-47` 2a `resourceStates.decisionId` 关联 2b，但 2b 声明依赖 2a + decisionId 只在 2b `ConflictDecision` 生成；代码 `restoreJournal.ts:72-78` + `resourcePlanning.ts:33-38` `FileResource` 无 decisionId。即使我细化时解环（2b-schema→2a→2b-engine），2a 仍不能真正独立（decisionId 未定义）。修法：2a 用独立 `resourceOperationId` 或前置最小 DecisionId contract
- **P1-2 ConflictDecision 未持久化 source/local PK**：`:110-112/:126-148` ConflictDecision 仅 `aggregateIdentity{table,key}`，无 `backupPrimaryKey`/`localCanonicalPrimaryKey`；代码 `merge/types.ts:23-38` + `MergeEngine.ts:647-689/697-767` pre-pass 需 source PK → local canonical PK 建 targetMap（否则 FK/JSON soft-ref 不能改写）。MergeEngine 必重算 identity → 违反"只消费不重算"（B1 复发）。修法：decision 持久化 source/target tuple
- **P1-3 planHash 未覆盖 FileResource operation**：`:110-111/:129-136` `planHash=hash(decisions)` 但 ConflictDecision 只含粗粒度 resourceAction + 可选 fingerprint，无 operation payload（kind/stagingPath/livePath/asidePath）；代码 `restoreJournal.ts:72-99` + `restorePromotion.ts:316-324/537-560` promotion 直接遍历 `fileResources`（另一未绑定输入）。planHash 校验通过但 fileResources 可分叉 → 不能达成"promotion 按 decisionId"验收。修法：immutable resource operation 进 hash，promotion 仅遍历带 decisionId 的 operation

**结论**：stage2 plan 的 D3（promotion 原子）+ D4（decision graph）契约不全（inverse direction/marker failure/quarantine + decisionId 循环/source-local PK/planHash 覆盖）。**这些是我的 overhaul 设计细节没闭环，不是楠总 design gap**（楠总 §9 step-level + schema single source 已覆盖大方向，我的 D3/D4 是在其上叠加的过度细化，叠加时引入了这些契约缺口）。决策点 0 = A 时，要么修这些缺口（若坚持 D3/D4），要么**进一步撤回 D3/D4 到楠总 step-level/schema-single-source**（更符合"防过度设计"）。

---

## 4. 瘦身后推进方案（决策点 0 = A "merge beta 后重启" 时；待 §2/§3 subagent 核实确认）

> 框架基于楠总 design 初判；subagent 核实后细化每个项的"楠总 design 出处 + 落地原因 + 最终设计为什么好 / 为什么撤回"。工期 12-18w → **~4-6w**。

### 4.1 撤回（楠总 design 选择，我误判为架构 gap）—— 标注"楠总哲学已覆盖"
- **D1 统一 writer coordinator 全 gate**：楠总 §9 step1 = **partial quiesce（a1+drain+IPC gate）+ atomic rename backstop** 是设计选择；snapshot 后写入进 aside（可 undo）非丢数据；[[backup-a1-must-do]] a1+drain 必做并存。→ 撤回统一 coordinator；只补 partial quiesce 漏点（legacy File_/Cache_/Backup_*）
- **D2 DB-FS combined fingerprint**：楠总 atomic rename + file journal 顺序已保证 promotion 一致 → 撤回 combined；保留 content hash 防坏 archive（实现加固）
- **D3 per-resource atomic marker**：楠总 step-level marker + atomic rename（OS 级原子）已够 → 撤回 per-resource；保留"inverse 失败不 finalize + reconcile"
- **D7 BackupProgress BrowserWindow**：楠总选 native Notification（a1 后无 renderer）+ 阶段 0 已 landed main-process auto-relaunch + native notification → 撤回 window

### 4.2 保留落地（楠总 design TBD / follow-up，方向稳）
- **D5 identity propagation**：楠总 §5.4/§6.1 已设计，**B1 已 landed（895b653864）**；剩余 composite/JSON soft-ref 边角 + 测试覆盖
- **D6 undo/aside lifecycle**：楠总 §9 "Undo is primary value" + retention/GC **numbers TBD**；落地 retention + sweeper + undo API
- **D8 资源闭环**：楠总 §9 File resources by visibility + external by-design dangling + MCP/SKILLS/OVERWRITE/Notes dir-swap **follow-up**；落地（KNOWLEDGE 待 @eeee0717 #16848 backupIndexStore）
- **D9 性能/OOM**：楠总 design 未规定 merge 全量物化 → 流式 merge + 批量 JOIN（实现优化）
- **D11 路径 hardening**：楠总 §9 已提 Notes symlink → 递归 realpath + lexical containment（defense-in-depth）

### 4.3 修实现 bug（代码偏离楠总 design，不改架构）
- **A4 OOM**：MergeEngine scanAggregates 全量物化 → 流式（D9 一部分）
- **B1 决策四层**：**待 subagent 核实** —— 若代码四层独立推导=偏离 bug（修代码读 schema single source）；若读 schema=我误判（撤回 B1/D4）
- **B16 contributor hook**：楠总 §7 hooks + finalize 已设计，hook 未全接线 → 修代码
- **C1-C8**：journal transition / relaunch idempotency / startup outcome —— 楠总已设计，加固

### 4.4 通用安全修复（与 merge 定位无关，任何选项都保留）
- 阶段 0 九 commit（containment / i18n marker / relaunch escape / B1+a1 landed）—— `feat/backup-v2-restore` HEAD，未 push；B/C 选项下也评估哪些通用可 cherry-pick 到 #17499

### 4.5 阶段 0 安全修复对 #17499 的可迁移性（决策点 0 = B/C 时仍要做）
- 阶段 0 修复（terminal journal containment / i18n fallback / post-seal relaunch escape / B1 identity / a1 WindowManager hold）部分是**通用 backup/restore 安全**，#17499 整库替换也可能受益 → 评估 cherry-pick（待 subagent 或单独核实 #17499 是否有同类问题）

---

## 5. 防过度设计 / 上游谨慎 纪律（贯穿）

- **楠总蓝本 ef1ae2cbc 为准**：[[backup-architecture-frozen-baseline]] —— 整体架构不大改，surgical
- **review 对照 docs/references**：[[review-must-check-docs-references]] —— naming/main/renderer/shared/data + lifecycle/job/ipc/window
- **a1 + drain 必做并存**：[[backup-a1-must-do]] —— 纠正"a1 可省/接受 backstop"误判
- **上游谨慎**：[[feedback-upstream-findings-ask-first]] —— 给楠总/@DeJeune 发 finding 前问用户；涉及 DbService/JobManager/WindowManager/KnowledgeService 上游 API 标"需上游"
- **不提新架构方案**：复核只分类（实现 gap/TBD/偏离/误判），不另起炉灶；真 gap 才改架构且标注"原因 + 最终设计为什么好"
