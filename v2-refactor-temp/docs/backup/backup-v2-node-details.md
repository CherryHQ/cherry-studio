# Backup v2 各推进节点细节方案（阶段 C）

> 2026-08-01（第 3 轮收敛重构）。基于 `backup-v2-forward-plan.md`（整体方案 节点 0-4）+ `backup-v2-disposition-matrix.md`（唯一权威，禁 ID 漂移）+ `backup-v2-architecture-recheck.md`（§3.0 分类）。
> **节点集合 = disposition matrix「节点映射」唯一权威**；本文 ↔ matrix ↔ forward-plan §2.1 三处同集合（subagent 第 2/3 轮自洽要求）。
> 每项六字段：**楠总 design 出处**（ef1ae2cbc 蓝本）+ **现状代码证据**（file:line）+ **实现要点** + **测试** + **上游依赖** + **多方案**（🔀 供用户最后决策；无分叉标"无"）。
> 纪律：防过度（不新架构，落到楠总 design）；上游谨慎；决策点 0 = A 且产品 gate 通过后这些细节才执行。

---

## 节点 0 · 安全修复（拆 0G/0M；详见 disposition matrix 节点映射）

### 0G · merge 分支自有安全修复（不迁 #17499，用户决策 2026-08-01）
- **design**：楠总 §9 crash containment + native notification + auto-relaunch escape
- **现状**：阶段 0 九 commit 已 landed 未 push（containment / i18n marker / relaunch escape）
- **实现**：作为 merge 分支自有安全加固正常推进 push；**不做 #17499 适用性审计与迁移**（两线独立，#17499 走 vaayne 整库替换自己的路）；C 下随分支退役
- **测试**：九 commit landed 时已有对应测试
- **上游**：无（不再涉及 vaayne 适用性协调）
- **🔀**：无（不迁移，无分叉）

### 0M · merge-only（仅决策点 0 = A）—— ✅ 已实施（feat/backup-v2-merge-impl，subagent+cursor review 过）
- a1 WindowManager hold（**核心已闭合**）：resumePool gate / dispose 精确恢复 / i18n `t()` / setImmediate 双 gate 均已修
- **0M 4 项核实+实施（2026-08-01）**：① 单测缺口 **已闭合**（`WindowManager.test.ts:915-1000` a1 测试组 + mock mutationCapable）；② consumer catch **已实施**（`MainWindowService.showMainWindow` catch `WindowBlockedDuringRestoreError`，区分 show/payload：带 initData 显式 log dropped——replay 不可行因 relaunch 新进程；覆盖 tray/activate/second-instance/toggle）；③ 错误码映射 **已闭合**（`IpcApiService.ts:34` name 检查 + 测试 `:135`）；④ stale comment **已改**（`BackupService.ts:25/420` a1 "follow-up"→"acquired first"）
- **follow-up（非节点 0 scope，pre-existing）**：relaunch 注释同步——`BackupService.ts:21-22` restore_relaunch 描述 / `:347-351` renderer-confirmed relaunch / `backup.ts:80-83` IPC schema（production 实为 `schedulePostSealRelaunch` auto-relaunch，dev 才 renderer confirm）
- A1 drain（节点 1.1）

---

## 节点 1 · 修实现 bug（代码偏离楠总 design，不改架构；~2-3w）

### 1.1 A1 drain + legacy gate（partial quiesce 补全）—— P0
- **design**：楠总 §9 step1 **a1 + drain 并存**（a1 摧毁 renderer + dispatcher drain in-flight 已入场写）+ §9 :398 **residual 写路径 gate**（`File_`/`Cache_`/`Backup_*` legacy IPC + DbService 直写，atomic rename 为 backstop）；[[backup-a1-must-do]]
- **现状**：`BackupService.ts:445-519` 只 drain Channel/AI/Agent/Job，**缺 DataApi/Preference/IpcApi in-flight drain**；`ipc.ts:44-53` `Backup_*Restore*` **已 gate**，但 `ipc.ts:185-214` `File_*` mutation / `Cache_Sync` **未 gate**
- **实现**：① BackupService drain 加 DataApi mutation / Preference set / IpcApi 非 backup.* 已入场请求 drain（admission gate `IpcAdapter.ts:65-82` 已拒新请求，in-flight 未 drain）；② `File_*`/`Cache_Sync` mutation handler 加 backup-in-progress gate（对齐已 gate 的 `Backup_*Restore*`）；③ DbService 直写边界 audit（标 residual，靠 atomic rename backstop）
- **测试**：每 writer in-flight drain 覆盖 + stale 拒绝 + legacy `File_*`/`Cache_Sync` gate 拒绝
- **上游**：DataApi/Preference/IpcApi drain owner（@DeJeune dispatcher）—— 标需上游
- **🔀**：① A1-a 每 writer 各 drain（楠总 §9 各模块 own drain 契约，对齐上游 #16850）→ **推荐**；~~② A1-b 统一 drain API~~ → **删除**（subagent 第 2 轮 P0-9：撤回的 D1 方向，不平级候选）

### 1.2 A3 inverse 失败吞掉 finalize —— P1（confirmed）
- **design**：楠总 §9 step-level marker + reconcile（inverse 未完成不 terminalize）
- **现状**：`restorePromotion.ts:672-679` inverse 吞失败 + `:623-627`/`:640-655` finalize failed + `:723-730` 删 staging → old DB + new resource mixed
- **实现**：inverse 失败不 finalize（保留 promoting + 现有 filesystem probe reconcile，**A3-a 不新增 durable marker**）
- **测试**：inverse failure 不 finalize + reconcile 重试
- **上游**：无（restorePromotion 内部 reconcile）
- **🔀（已决策 2026-08-01：A3-a）**：① A3-a 最小改（复用现有 filesystem probe，不新增 marker）→ **已选**；② A3-b + journal `direction` durable marker → 仅当 reconcile 复杂度证明 probe 不足再议

### 1.3 B5 sealed onStop 误释放 —— P1（confirmed）
- **design**：楠总 §9 sealed quiesce 持到 process exit/relaunch
- **现状**：`BackupService.ts:571-578` seal 后 activeOperation=null → `:1325-1335` onStop 释放 hold
- **实现**：onStop 不释放 sealed hold（持到 process exit）；或 sealed 标记阻止 releaseRestoreQuiesce
- **测试**：**反转** `BackupService.restore.test.ts:749-762`（sealed onStop 不释放）
- **上游**：lifecycle（BackupService stop 语义）—— 标需上游
- **🔀**：无（sealed 持到 exit 是楠总 §9 唯一 design）

### 1.4 B3 composite identity —— 实现 gap（**先证明 consumer，subagent 第 2 轮 P0-8**）
- **design**：楠总 §5.4/§6.1 identity propagation（composite PK/FK）+ #26 仅限 renamable root PK 单列
- **现状**：`MergeEngine.ts:1388-1409` 跳过 `length!==1` composite FK + identity map 用 PK[0]；`dbSchemaRefs.ts:796-803` 已生成 composite（knowledge_item self-FK `baseId,groupId`→`baseId,id`）；但 `knowledge_item` PK（`:705`）是**单列 UUID**，非 canonical remap target
- **实现**：**先证明现存 composite FK target 场景**（backup tuple → 不同 local canonical tuple 真实复现）；**有场景** → identity map/FK target 按 tuple；**无场景** → 降 hardening，仅修单列 propagation bug，**不做 tuple map 重构**
- **测试**：composite propagation（证明后）；无场景则单列 propagation 回归
- **上游**：dbSchemaRefs codegen（@0xfullex）—— 标需上游谨慎（codegen 产物不手改）
- **🔀**：无（先证明再定范围，避免过度）；**⚠️ 防过度**：agent junctions 是 composite PK ≠ composite FK target，不主动扩覆盖

### 1.5 B16 contributor hook —— 实现 gap（**分 owner，subagent 第 2 轮 P0-7**；restoreResources 除外）
- **design**：楠总 §7 :312-316 hooks 分 owner：`beforeArchive`（export）/ `transformRow`（import row path）/ `afterImport`（detached transaction 内，含 FTS）；**restoreResources 是 §9 paper-contract**（promotion 走 journal fileResources，非 per-contributor runtime hook）
- **现状**：`ExportOrchestrator.ts:290` 只接 `collectFileResources`；`:8` 注释 beforeArchive 仍是 **TODO step 3 未实现**；FTS 由 MergeEngine 直调非 afterImport
- **实现**：**分 owner 接线**：ExportOrchestrator→`beforeArchive`；MergeEngine/import pipeline→`transformRow`；detached transaction→`afterImport`（FTS 经此）；**restoreResources 不接线**（paper-contract）
- **测试**：每 hook 分 owner 接线（restoreResources 不在）+ FTS 经 afterImport
- **上游**：contributor contract（@0xfullex generic contract）+ file-resource hooks（@DeJeune 4 域）
- **🔀**：无（分 owner 是楠总 §7 :312-316 唯一 design）

### 1.6 B9 undo 同 gate —— 实现 gap
- **design**：楠总 §9 :411 "Undo is primary value"（aside = renamed old live），用户 undo 走同一 quiesce/promotion gate
- **现状**：`ImportOrchestrator.ts:164-166` 创建 aside；promotion 内部 rollback 有；**用户触发 reverse promotion 无**
- **实现**：用户 undo API 走 quiesce + promotion gate（零拷贝 aside → live）
- **测试**：undo round-trip + 可再 undo
- **上游**：undo retention 数值（楠总 §9 TBD）—— **不自行发明数值**
- **🔀**：无（undo 同 gate 是楠总 §9 唯一 design）

### 1.7 D11 path hardening（B15=D11）
- **design**：楠总 §9 "symlinks not followed out of root"
- **现状**：已有 realpath/lstat 防御 —— `SqliteFileStager.ts:350-376`（notes root realpath containment）+ `BackupService.ts:287-288`（outputPath realpath）+ `:1102-1109`（lstat 不 follow symlink）；但未统一到 staging/promotion 全路径
- **实现**：递归 realpath + lexical containment（**symlink/root-containment hardening**，统一 staging/promotion 全路径）；**不单独声称关闭 TOCTOU**（需 handle-relative/openat 原子策略，超范围，剩余风险标注，subagent 第 2 轮 P1-6）
- **测试**：symlink 越出 root 拒
- **上游**：无（defense-in-depth，本地实现）
- **🔀**：无（realpath+lexical 是 containment 标准手段）

### 1.8 B11 SKILLS / KNOWLEDGE + contentHash —— 实现 gap
- **design**：楠总 §3 full 含 zip/local skill；§9 KNOWLEDGE additive restore 后可靠重建 index
- **现状**：SKILLS full 缺目录只 degradation；KNOWLEDGE `existsSync` 判完成（空/半成品抑制重建）；`SqliteFileStager.ts:289-335` 仅透传 skill `contentHash` 未校验复制内容
- **实现**：① SKILLS full fail-closed（缺目录不生成 archive）+ **admit 明确拒绝旧 archive**（无 skill-dir 元数据，稳定错误码，非"兼容回放"，subagent 第 2 轮 P1-2）；② KNOWLEDGE 删 existsSync 用 backupIndexStore（[[knowledge-backup-quiesce-alignment]]）；③ **per-resource contentHash admission 校验**（撤 D2 保留项，防坏 archive）
- **测试**：SKILLS full 完整性 + admit 拒旧 archive + KNOWLEDGE reindex + contentHash corruption 拒
- **上游**：KNOWLEDGE `@eeee0717` backupIndexStore（#16848 已对齐冻结）
- **🔀**：无（fail-closed + backupIndexStore 是楠总 §3/§9 唯一 design；旧 archive 拒而非兼容）

### 1.9 B13 UI 拆分 + C4-C8 UI 加固
- **B13**（楠总 §3 result page credential warning + §9 native notification）
  - 现状：`RestoreV2Popup.tsx:342-355`（无 plaintext credential warning）+ `:375-378`（死 restart button）
  - 实现：**撤控制面/notification**；**保留 result credential warning + 删死 restart button + 脱敏 + i18n**
  - 测试：UI 契约（warning 渲染 + button 移除 + 脱敏）
  - 上游：无；🔀 无（楠总 §3 plaintext warning 唯一 design）
- **C4** renderer 线性渲染（楠总 §3 result page）：现状 `RestoreV2Popup.tsx:46-48` summary `degradations.map` 全量 li；实现 throttle/虚拟化；测试 大量 degradations 渲染；上游 无；🔀 无
- **C5** DESIGN/a11y（DESIGN.md）：现状 popup 未全量对齐 DESIGN.md；实现 Dialog/aria/semantic token；测试 a11y；上游 无；🔀 无
- **C6** v1/v2 popup 并存（楠总 §3）：现状 v1/v2 popup 共存；实现 gate；测试 切换；上游 无；🔀 无
- **C7** startup outcome 幂等（楠总 §9 recoverOnBoot）：现状 `main.ts:58` + `backupRestoreGate.ts:37` 单次检查；实现 幂等可重试；测试 重复启动；上游 无；🔀 无
- **C8** summary IPC envelope（楠总 §9）：现状 `BackupService.ts:742` broadcast `restore_summary` 无 envelope + `RestoreV2Popup.tsx:92` useIpcOn；实现 restoreId/version envelope；测试 envelope 解析；上游 无；🔀 无

### 节点 1 backlog（不进 DoD/工期，subagent 第 3 轮 P1-1 独立小节）
- **C1** journal transition validator：楠总 §9 state machine（代码已限形状 + filesystem probe，未要求集中 validator）；production 无非法 transition；`restoreJournal.ts:36-48`；测试 `restoreJournal.test.ts:163-170` 固化绕过 —— **backlog**：随手反转测试，不计节点 1 工期/DoD
- **C2** clearRestoreJournal 语义：楠总 §9 journal durability；`restoreJournal.ts:227-241` best-effort —— **backlog**：clear 是 best-effort 契约，新 write 原子覆盖残留，非 correctness bug，可选统一 clear/remove

---

## 节点 2 · 落地楠总 follow-up（design 已设计，实现未做；~1.5-2w）

### 2.1 D8 资源（MCP / OVERWRITE / Notes dir-swap）
- **design**：楠总 §3/§9 follow-up（directory-level swap + custom root）
- **现状**：`resourcePlanning.ts:90` additive file resources（blob-add/dir-add/note-add **only; no overwrite**）；MCP dxtPath package dir / OVERWRITE-RENAME / Notes 逐文件非 dir-swap 未闭环
- **实现**：**基础 merge**——MCP/AGENT dir 统计告知版（扫描 `dxtPath` 等路径引用缺失 → log + summary，**无 staging**）；**完整 merge**——MCP dxtPath staging provider（gate @DeJeune file-resource hooks）+ OVERWRITE/RENAME strict-replace + Notes dir-level near-atomic swap + custom root（gate @0xfullex 扩 dir-swap kind）
- **测试**：MCP dir 完整 + OVERWRITE strict-replace + Notes swap + custom root
- **上游**：MCP/AGENT dir @DeJeune file-resource hooks / OVERWRITE #16884 / Notes dir-swap kind @0xfullex
- **🔀（已决策 2026-08-01：统计告知版）**：MCP/AGENT dir **基础 merge 用 ②-统计告知版**——扫描 backup/restore 中"路径引用但文件未备份/恢复缺失"的条目（**allowlist 起步 = `mcp_server.dxtPath`**；AGENT 同类列若有则加；**排除** `file_entry`/已收集 skill·KB/`external_path`；**禁 contentHash/存在性当拒绝条件**），聚合统计打 loggerService + restore summary/result page **告知不拒绝**；**不改资源系统 → 不阻塞 @DeJeune**，可进基础 merge。完整 merge 阶段可升级 ① staging provider（后续，待 @DeJeune file-resource hooks）。**和 B11 区分**：B11 = archive 损坏 fail-closed 拒绝；本项 = 故意未收集的本地路径引用，统计告知不拒绝
- **依赖 gate**：undo round-trip green → Notes dir-swap/OVERWRITE（verification gate）

### 2.2 D6 undo retention / GC
- **design**：楠总 §9 :411 retention/GC "numbers TBD"
- **现状**：`ImportOrchestrator.ts:164-166` aside 创建，无 sweeper/GC
- **实现**：sweeper 骨架 + retention/consecutive 逻辑（**数值留上游定，不自行发明**）
- **测试**：retention consecutive + sweeper
- **上游**：retention/consecutive/sweeper 数值（楠总 @0xfullex TBD）
- **🔀**：无（retention 数值待上游，本地只做 sweeper 骨架）
- **依赖 gate**：retention 数值定 → sweeper

### 2.3 D5 identity 边角
- **design**：楠总 §5.4/§6.1（B1 landed 895b653864）
- **现状**：B1 identity propagation landed；MergeEngine identity map 边角未覆盖
- **实现**：JSON soft-ref + 边角 propagation（依赖 **B4 contract only**；**B3 独立，非 D5 前置**，subagent 第 3 轮 P0-3）
- **测试**：soft-ref propagation
- **上游**：B4 JSON soft-ref contract @0xfullex
- **🔀**：无（边角 propagation，无分叉）
- **依赖 gate**：B4 contract approved → D5

---

## 节点 3 · design TBD（design 未规定，需上游明确，不自行设计）

> 这些 design 未规定，**列上游 issue 待楠总定**（[[feedback-upstream-findings-ask-first]] 发前问用户），不自行设计。每项：当前证据 + 禁止本地实现边界 + 待问问题 + 上游答复后路径。

| ID | 当前证据（file:line） | 禁止本地实现边界 | 待问问题（上游） | 上游答复后路径 |
|---|---|---|---|---|
| **A4 OOM** | `MergeEngine.ts:562-581` 全量物化 | 不自行改 merge 策略 | 楠总性能/规模验收 SLA | 流式 merge（gate）|
| **B17 N+1** | `MergeEngine.ts:647-669` | 不自行优化 | 楠总规模验收 | bulk 策略 |
| **B18 FTS 双倍** | `MergeEngine.ts:519-522` 全量 rebuild | 不自行改 rebuild | 上游 bulk trigger 策略 | bulk FTS |
| **D9（=A4/B17/B18 性能族）** | 同上 | 同上 | 同上 | 同上 |
| **B4 JSON soft-ref** | `MergeEngine.ts:364-428` 硬编码 agent_workspace | 不自行扩 contract | 上游 contributor contract（target/path 表达）| 扩 contract |
| **B6 generation fencing** | `BackupService.ts:1325-1335` 只 abort | **不新建 D7 控制面**，仅轻量 lease 或随 B5 验证 | lifecycle 同进程 restart 语义（楠总 §9 未规定）| lease 或随 B5 |
| **B12 FIELD_MERGE 披露** | `MergeEngine.ts:1212-1279` | credential 指控不成立；不自行定披露范围 | 上游披露 contract（仅 loss/conflict vs 含合并字段名）| 扩披露 contract |
| **B14 cancel latency SLA** | `BackupService.ts:508-519` 固定 5000ms | 不自行定 SLA（固定 ms 仍 fail-closed）| 上游 cancel contract（楠总 §9 只要求 drain bounded）| timeout/AbortSignal 贯穿 |
| **B2 Notes overlay/body**（subagent 第 2 轮 P0-6 从节点 1 迁此） | `resourcePlanning.ts:416-449` / `ImportOrchestrator.ts:212-225`（merge 前） | **不把 overlay SKIP 当 body 不写**（偏离蓝本 §3.5 :168-173：overlay vs 独立 file resource）| @0xfullex dir-swap kind + overlay/body contract | contract 定后实现 |

---

## 节点 4 · 验证（general-purpose 第 1 轮 P1：缺 roundtrip/crash/e2e 节点）

> forward-plan 原缺验证节点，工时不成立。补（~1-1.5w，节点 1+2 完成后）：

### 4.1 roundtrip e2e
- 真实 export → restore → promotion roundtrip（之前 `restore.full.resources.test.ts:427` it.todo）
- **依赖**：节点 1 修 bug 完成

### 4.2 crash matrix
- 真进程边界 crash（arrange-and-crash + fresh-boot-recover）
- **依赖**：A3/B5（promotion reconcile）完成

### 4.3 大库 / 性能
- **依赖**：节点 3 A4/B17/B18 上游明确后

### 4.4 undo / 并发 / 资源 integration
- undo round-trip + 并发写 + 资源 integration + retention consecutive
- **依赖**：B9/D6/D8

---

## 待解决（等整体 review 收敛 + 用户决策）
- 决策点 0（merge 定位 A/B/C/D）—— 用户 + 产品 gate（Kenny）
- 多方案（A3-a/b、MCP ①②、B3 composite 范围）—— 用户审查时决策
- 上游协调 owners（Kenny 产品 / vaayne #17499〔format compat / UX 交界，**迁移已取消**，仅两套共存时相关〕/ @0xfullex design TBD + codegen / @eeee0717 KNOWLEDGE / @DeJeune file-resource hooks + dispatcher）—— disposition matrix §上游协调完整表
