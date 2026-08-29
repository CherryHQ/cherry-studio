# Backup v2 整体推进方案（forward-plan）

> 2026-08-01。基于 [`backup-v2-architecture-recheck.md`](./backup-v2-architecture-recheck.md)（阶段 A 梳理）+ [`backup-v2-disposition-matrix.md`](./backup-v2-disposition-matrix.md)（唯一权威，禁 ID 漂移）。
> 本文件 = **整体推进方案 + 对抗 review 记录**。细节方案见 [`backup-v2-node-details.md`](./backup-v2-node-details.md)（阶段 C）。
> **旧 `stage1-6-plan.md` + `backup-v2-architecture-overhaul-plan.md` 已 supersede**（仅历史审计材料，不可复用 contract，见 disposition matrix）。
> **纪律**：防过度设计/架构漂移；涉及上游谨慎；多方案记文档供用户最后决策（[[backup-architecture-frozen-baseline]] + [[review-must-check-docs-references]] + [[feedback-upstream-findings-ask-first]]）。

---

## 1. 决策点 0（用户最后 review 决策）—— 一切前提

> 详见 recheck.md §1。beta 主线 #17499 已 supersede merge 方案。merge 最终定位未决。
> **对抗 review（general-purpose P1-1）**：取消无条件推荐 A —— design approval/沉没投入 ≠ 产品保留 merge。**进入实现/执行节点 0M-2 前需产品 gate**（Kenny + @0xfullex + @DeJeune 拍板 A/B/C 定位）；gate 前只做只读规划与评审（阶段 C 细节 review 允许，subagent 第 2 轮 P1-7）。拍板前只做 merge 分支自有安全修复（0G）+ 分支保全。

| 选项 | 推进路径 | 工时 |
|---|---|---|
| A. merge beta 后重启（瘦身） | 撤回过度架构 + 落地楠总 follow-up + 修 bug（见 §2）| implementation ~5-8w（cursor P1-6：含节点 0M+1+2+4，optimistic + 多人并行，排除上游决策/KNOWLEDGE/性能/加密）+ upstream calendar gate |
| B. merge 移出备份层（苏垚质疑）| merge design+实现迁出 backup 到独立同步层 | ~~出局~~（2026-08-01 用户决策：基础 merge 不等同步层，B 的"推迟"理由不成立 → 收敛 **A vs C**） |
| C. 放弃 merge | feat/backup-v2-restore 退役（分支成果随退役，不迁 #17499）| ~1w 清理 |

**条件推荐 A**（非无条件）：**若**产品（Kenny）明确保留"离线备份导入到已有设备并合并"能力 + @0xfullex 确认仍归 backup-layer，则 A 是最小改动方案。理由：B1/a1 已 landed（非沉没投入谬误——是"已可用的 correctness 实现"）+ 楠总 design 已批准 + 苏垚质疑未形成定论（独立同步层不存在）。**但产品 gate 前不展开 merge 细节**。

---

## 2. 决策点 0 = A 瘦身方案（implementation ~5-8w，详见 §2.2）

### 2.1 推进节点（基于 recheck.md §3.0 分类）

> **基础 merge MVP 切分（2026-08-01 用户决策，不改架构）**：
> - **correctness 层（节点 1）不可拆，全做**——quiesce/drain/atomic rename/reconcile/identity 是 merge 成立的原子条件，**不等任何上游 gate，决策点 0 + 多方案决策拍完即开工**。
> - **特性-基础**：additive 资源 + 基础 identity propagation + 基础 undo（同 gate）。
> - **特性-进阶（节点 2-3 gate）**：dir-swap / retention / 性能 / cancel SLA。
> - **MCP dir（B10，用户决策：统计告知版）**：基础 merge 用**统计告知版**——扫描 allowlist 起步 = `mcp_server.dxtPath`（AGENT 同类列若有则加），**排除** `file_entry`/已收集 skill·KB/`external_path`（external by-design dangling）；聚合打 loggerService + restore summary/result page **告知不拒绝**。**不实现 staging provider → 不阻塞 @DeJeune**，可进基础 merge；完整 merge 可升级 staging（后续，gate @DeJeune）。**与 B11 区分**：B11 = 已收集资源损坏 fail-closed 拒绝；本项 = 故意未收集的本地路径引用，统计告知。
> - 楠总冻结架构不动（surgical 范围判断，非架构改）。

**节点 0 · 安全修复（~2-3d；显式拆 0G/0M，cursor 第 2 轮 P1-1）**
- **0G · merge 分支自有安全修复（不迁 #17499，用户决策 2026-08-01）**：阶段 0 九 commit（已 landed 未 push：containment / i18n marker / relaunch escape）作为 merge 分支自有加固正常推进 push；**不做 #17499 适用性审计与迁移**（两线独立）；C 下随分支退役
- **0M · merge-only（仅决策点 0 = A）**：a1 WindowManager hold 核心已闭合（核实 + hold-audit最新）：resumePool gate `WindowManager.ts:987-992` / dispose 精确恢复 / i18n `t()` `BackupService.ts:606-637` / setImmediate 双 gate 均已修 → **a1 修大幅缩减**，剩 P2：① WindowManager 单测缺口（mock registry 缺 mutationCapable）；② main-process consumer 边界 catch（MainWindowService activate/second-instance）；③ WindowBlockedDuringRestoreError → BACKUP_IN_PROGRESS IPC code 映射；④ stale comment 清理（`BackupService.ts:414-420`）
- A1 drain 见节点 1.1（0M 不双计工期）

**节点 1 · 修实现 bug（代码偏离楠总 design，不改架构；~2-3w）**
> 节点集合 = disposition matrix「节点映射」唯一权威；本表 ↔ matrix ↔ node-details 三处同集合（subagent 第 2 轮 P0-4 自洽要求）。

| bug | 修法（落到楠总 design，非新架构） | 测试反转 |
|---|---|---|
| A1 drain + legacy gate（partial quiesce 补全） | 补 DataApi/Preference/IpcApi in-flight drain（a1+drain 并存 [[backup-a1-must-do]]）+ **楠总 §9 :398 residual：legacy `File_`/`Cache_` mutation gate**（`ipc.ts:44-53` `Backup_*Restore*` 已 gate；`:185-214` `File_*` / `Cache_Sync` **未 gate**）+ DbService 直写边界 audit（撤 D1 coordinator，补 partial quiesce 漏点，surgical） | + drain + legacy gate 覆盖测试 |
| A3 inverse 失败吞掉 finalize | inverse 失败不 finalize，保留 promoting + filesystem probe reconcile（**A3-a：复用现有 probe，不新增 durable marker**，subagent 第 2 轮 P1-1） | + inverse failure 不 finalize 测试 |
| B5 sealed onStop 误释放 | sealed lease 持到 process exit/promotion | **反转** `BackupService.restore.test.ts:749-762`（sealed onStop 不释放） |
| B3 composite identity（**先证明 consumer，subagent 第 2 轮 P0-8**） | **先证明现存 composite FK target 场景**（`dbSchemaRefs.ts:796-803` knowledge_item self-FK，但 PK 单列 UUID 非 canonical remap target）；**无场景则降 hardening**，仅修单列 propagation bug，**不做 tuple map 重构** | + composite propagation（证明后）|
| B16 contributor hook（**分 owner，subagent 第 2 轮 P0-7**；restoreResources 除外） | ExportOrchestrator→`beforeArchive`；MergeEngine/import pipeline→`transformRow`；detached transaction→`afterImport`/FTS（楠总 §7 :312-316）；**restoreResources 是 §9 paper-contract**（promotion 走 journal fileResources，非 per-contributor runtime hook，不接线） | + hook 分 owner 测试（restoreResources 不在） |
| B9 undo 同 gate | 用户 undo 走同一 quiesce/promotion gate（零拷贝 aside → live） | + undo round-trip 测试 |
| D11 path hardening（B15=D11） | 递归 realpath + lexical containment（**symlink/root-containment hardening**，统一 staging/promotion 全路径；楠总 §9「symlinks not followed out of root」；**不单独声称关闭 TOCTOU**，剩余风险标注，subagent 第 2 轮 P1-6） | + symlink 越出拒测试 |
| B11 SKILLS/KNOWLEDGE | SKILLS full fail-closed + **admit 明确拒绝旧 archive**（无 skill-dir 元数据，稳定错误码，非"兼容回放"，subagent 第 2 轮 P1-2）；KNOWLEDGE 删 existsSync 用 backupIndexStore（待 @eeee0717 #16848） | + SKILLS/KNOWLEDGE 测试 |
| B13 UI 拆分（subagent 第 1 轮） | 撤控制面/notification；**保留 result credential warning + 删死 restart button + 脱敏 + i18n**（楠总 §3 plaintext warning） | + UI 契约测试 |
| C4-C8 UI 加固 | C4 renderer throttle/虚拟化 / C5 DESIGN+a11y / C6 v1/v2 popup gate / C7 startup 幂等 / C8 summary envelope | + 各项加固测试 |
| contentHash hardening（撤 D2 保留项，subagent 第 2 轮 P0-2） | per-resource contentHash admission 校验（防坏 archive；`SqliteFileStager.ts:289-335` 现仅透传 skill hash 未校验复制内容） | + corruption/admission 测试 |

**节点 1 backlog（不进 DoD/工期，cursor P1-9 + subagent 第 2 轮 P0-3）**：
- **C1** journal transition validator（production 无非法 transition，楠总 §9 未要求集中 validator；随手反转 `restoreJournal.test.ts:163-170`）
- **C2** clearRestoreJournal 语义（restore-audit：best-effort 契约，新 write 原子覆盖残留，可选统一 clear/remove）

**已撤回/迁出节点 1**：~~C3 relaunch~~（撤回，B5/B6 覆盖）｜~~B14 cancel~~（→节点 3 design TBD）｜~~B2 Notes overlay/body~~（→节点 3 design TBD，subagent 第 2 轮 P0-6：蓝本 note 表是 state overlay、body 是独立 file resource，@0xfullex 明确 dir-swap kind 前不实现）

**节点 2 · 落地楠总 follow-up（design 已设计，实现未做；~1.5-2w）**
- D8 资源：MCP dxtPath package directory / OVERWRITE/RENAME / **Notes dir-level swap**（cursor P1-2：Notes dir-swap 是 design follow-up 归此，非节点 1 bug；楠总 §3/§9 follow-up，与 D8 一并）
- D6 undo：retention + sweeper + GC（楠总 §9 "Undo is primary value" + retention/GC TBD —— **不自行发明数值，TBD 留上游定**）
- D5 identity：B3 composite 边角 + JSON soft-ref（依赖 B4 上游 contract）

**节点 3 · design TBD 上游协调（design 未规定，需上游明确；工时取决于上游）**
- A4 OOM / B17 N+1 / B18 FTS（**D9 性能族**，subagent 第 3 轮 P0-2）→ 需楠总/design 明确规模验收 + bulk 策略
- B4 JSON soft-ref contributor contract（target/path 表达）→ 需上游扩 contract
- B12 FIELD_MERGE 字段级披露 contract → 需上游明确
- **B14 cancel latency SLA**（timeout/AbortSignal 贯穿 drain）→ 需上游补 cancel contract（楠总 §9 只要求 drain bounded，未规定 SLA）
- **B6 generation fencing**（same-process restart 边界；楠总 §9 未规定，随 B5 sealed lease 评估，cursor P1-4）→ 需上游明确 lifecycle restart 语义（**不新建 D7 控制面**，仅轻量 lease 或随 B5 验证）
- **B2 Notes overlay/body**（subagent 第 2 轮 P0-6：蓝本 §3.5 :168-173 overlay vs 独立 file resource）→ @0xfullex 明确 dir-swap kind + overlay/body contract 前不实现
- → **这些不自行设计，列上游 issue 待楠总定**（[[feedback-upstream-findings-ask-first]] 发前问用户）

### 2.2 工时估算（A 选项，general-purpose P1-8 中性化 —— 不写单一总数）
- **已拍板 implementation effort**（节点 0M+1，contract 已 gate）：~2-3w（多人并行 optimistic）
- **upstream decision calendar**（节点 3 design TBD：A4/B4/B6/B12/B14/B17/B18 + D6 retention + D8 dir-swap kind）：取决于楠总/上游
- **外部依赖**（KNOWLEDGE @eeee0717 #16848 / Notes dir-swap kind @0xfullex）：取决于上游 PR
- **integration/crash/E2E gate**（节点 4 roundtrip/process crash/undo/并发/资源/retention consecutive）：~1-1.5w（节点 1+2 完成后）
- vs 原 overhaul 12-18w，撤回 D1-D4/D7 + design TBD 移上游，省大部分

### 2.3 优先级 + 依赖（依赖图只从 matrix 生成，subagent 第 2 轮 P0-5；去环 + gate 同步）
- 节点 0 → 节点 1（正确性 + 安全修复先）→ 节点 2（落地 follow-up，gate contract）∥ 节点 3（上游 TBD，并行不阻塞主路径）
- **节点 1 内**：正确性（A1/A3/B5）→ identity/hook（B3 先证明/B16 分 owner）→ 资源（B11/B9/D11/contentHash）→ UI（B13/C4-C8）；**C1/C2 backlog 不进序**
- **C3 撤回**（B5/B6 覆盖，subagent 第 3 轮 P0-4：真撤无残留依赖）；**B14 在节点 3**；**B2 在节点 3 TBD**（subagent 第 2 轮 P0-6：蓝本 overlay/body 分离）
- **依赖（单向无环，gate vs impl 分列）**：B4 contract approved → **D5**（**非 B3**；B3 独立先证明 consumer）；undo retention 定 → D6 sweeper；**undo round-trip green → D8 Notes dir-swap/OVERWRITE**（verification gate，同步 matrix + node-details）；#16848 landed → KNOWLEDGE；Notes dir-swap kind 定 → B2 明确

### 2.4 上游协调（general-purpose P1-9 补全；详见 disposition matrix）
- **Kenny（产品）**：决策点 0 A/B/C 定位 + §3.6 产品 TBD（settings-class default / keep-both 披露 / encryption / workspace cascade）
- **vaayne（#17499）**：format compat + 两套 restore UX 交界（仅当产品决定两套长期共存时相关；**通用修复迁移已取消**）
- **@0xfullex（楠总）**：design TBD（A4/B4/B6/B12/B14/B17/B18）+ D6 retention/consecutive/sweeper + D8 Notes dir-swap kind + B3 dbSchemaRefs codegen + **WindowManager/dispatcher API** + B16 generic contributor contract
- **@eeee0717**：B11 KNOWLEDGE backupIndexStore（#16848）
- **@DeJeune（苏垚）**：D8 MCP/AGENTS file-resource hooks + **dispatcher drain**（DataApi/Preference/IpcApi）+ 决策点 0-B 质疑

→ 公共 API/contract 任务逐项标 **需上游谨慎**（[[feedback-upstream-findings-ask-first]] 发前问用户）

---

## 3. 撤回清单（recheck.md §3.0 🔴 一致误判）

> 这些是我原 overhaul 误把"楠总 design 选择"当架构 gap，**全部撤回**：

- **D1** 统一 writer coordinator 全 gate（楠总 partial quiesce + atomic rename backstop）
- **D2** DB-FS combined fingerprint（楠总 DB fingerprint + file journal + atomic rename 已够）—— 撤 combined，**但保留 per-resource contentHash 作 hardening**（防坏 archive，实现加固非新架构，cursor P1-1）
- **D3** per-resource atomic marker（楠总 step-level + atomic rename）
- **D4** decision graph 四层统一（subagent-2 确认 B1 一致误判：代码已 schema single source）
- **D7** BackupProgress BrowserWindow（楠总 native notification，已 landed）
- **B1**（撤回，代码 schema single source）/ **B7/B8**（native notification 已覆盖）/ **B13 部分**（控制面/notification 撤回；**result credential warning 保留** —— 楠总 §3 要 plaintext credential warning，是 result page 非 notification）/ **B10 external**（by-design dangling）/ **B11 通用 checksum**（非 design 要求）/ **B12 credential 泄露指控**（不成立）

---

## 4. 防过度设计 / 上游谨慎 纪律（recheck.md §5）

- 楠总蓝本 ef1ae2cbc 为准，整体架构不大改 surgical（**但 surgical 相对 D1-D7 过度设计，非小补丁**：节点 1-2 仍含 composite identity / Notes swap / undo API 等可感知产品面，cursor P2-2 诚实化）
- review 对照 docs/references（naming/main/renderer/shared/data + lifecycle/job/ipc/window）
- a1 + drain 必做并存（[[backup-a1-must-do]]）
- 上游 API（DbService/JobManager/WindowManager/KnowledgeService/contributor contract）谨慎，标"需上游"
- design TBD（A4/B4/**B6/B12/B14**/B17/B18 + **D6 retention + D8 Notes dir-swap kind + B2 overlay/body**）**不自行设计**，列上游 issue 待楠总定（§2.4 完整清单，subagent 第 2 轮 P1-4）
- 给楠总/@DeJeune 发 finding 前问用户

---

## 5. 对抗 review 记录（阶段 B：整体方案 ≥2 轮）

### 收敛 0（阶段 A 核实 → 方案收敛，已落实）
阶段 A 的 3 subagent（quiesce/promotion/lifecycle + 决策/merge/identity + 资源/undo/UI）+ teammate（hold/tests/restore-audit）核实后，对方案的修正：
- **C1** 从"实现 gap"→ **hardening（非 architecture）**（subagent-1 production+design 视角权威修正 tests-audit 过度：楠总 §9 未要求集中 validator，production 无非法 transition）
- **C3** 从"实现 gap"→ **撤回独立 finding**（production 无双调度，B5/B6 覆盖）
- **B14** 从"实现 gap"→ **design TBD**（楠总 §9 未规定 cancel SLA，固定 5000ms 仍 fail-closed）
- **B1/D4 确认撤回**（subagent-2：代码 `ReadonlyBackupRegistryImpl` schema single source，非四层独立推导）
- **B12 credential 泄露指控确认不成立**（subagent-2）
- **B7/B8/B13/B10/B11(部分) 确认撤回**（subagent-3：native notification 已覆盖 / external by-design / 通用 checksum 非要求）
- **a1 WindowManager hold 核心确认已闭合**（hold-audit 最新 + 当前代码核实：resumePool gate `WindowManager.ts:987-992` / dispose 精确恢复 / i18n `t()` / setImmediate 双 gate 均已修；teammate 第一轮 4P1 基于旧代码过时）→ 节点 0 a1 修大幅缩减，剩 P2 测试/边界
- **C2 降级**（restore-audit：clear best-effort 契约，新 write 原子覆盖残留，非 correctness bug）→ 从节点 1 修 bug 移到可选 hardening

### 第 1 轮（subagent `a3d0c62c6b6f31b2c` final + cursor 待）
**subagent 最终结论**：**当前不宜直接进阶段 C** → 已据此收敛：

**P0**（已修）：撤 D1 漏 dispatcher drain → 节点 1.1 A1 drain（DataApi/Preference/IpcApi in-flight）+ 节点 0 条件化

**P1**（已修/收敛）：
- 推荐 A 过早 → §1 条件推荐 + 产品 gate（Kenny+@0xfullex+@DeJeune 拍板，阶段 C 前）
- 节点 0 "任何选项都做" → 拆 **0G 通用（#17499 适用性审计）/0M merge-only**（disposition matrix 节点映射）—— **2026-08-01 用户决策不迁 #17499，0G 重定义为 merge 分支自有（见 §2.1）；本条为历史决策记录**
- B16 hook ownership → restoreResources paper-contract 不接（节点 1.5）+ generic contract @0xfullex 非 @DeJeune
- **ID 漂移**（B2 消失/B15 误标/D11 无节点/B6-C3 撤回论证不闭环/C4-C8 无 disposition）→ **建 disposition matrix 唯一权威**：B2 补回节点 1 / **B15=D11 恢复**（path hardening）/ Notes dir-swap 归 D8 / B6→节点 3 / C4-C8 disposition 补
- B13 过度撤回 → 拆分（控制面撤回 / **result credential warning + 删死 restart button + 脱敏 + i18n 保留**，节点 1）—— 楠总 §3 要 plaintext warning
- 依赖 gate（undo/Notes/OVERWRITE/KNOWLEDGE/B4）→ disposition matrix 依赖列 + 硬 gate（contract approved → impl；undo round-trip green → Notes/OVERWRITE）
- B3 composite 过度保留 → **需先证明 composite target 场景**（knowledge_item self-FK），否则降 hardening（节点 1.4 标注）
- 4-6w 工期不成立 → §2.2 拆 implementation/upstream/KNOWLEDGE/integration + 加节点 4 验证（roundtrip/process crash/undo/并发/资源/retention）
- stakeholder 不完整 → §2.4 补 Kenny/vaayne/WindowManager/dispatcher + §3.6 产品 TBD

**P2**（已修）：C1 hardening 移关键路径外（backlog）；链接修复（overhaul→recheck）；旧 stage plans 标 supersede（disposition matrix）

→ **第 1 轮 subagent 收敛完成**。

**cursor 第 1 轮**（`/tmp/cursor-forward-plan-review.md`）：4 P0 + 9 P1 + 4 P2，与 subagent 高度一致 + 独特：P0-3 撤 D1 漏楠总 §9 :398 residual gate（legacy `File_`/`Cache_`/`Backup_*`）/ P0-4 §2.3 依赖序指已撤回 C3/迁出 B14 / P1-1 撤 D2 漏 contentHash / P1-2 B15 Notes dir-swap 应归节点 2 / P1-4 B6 失踪 / P1-5 D11 无独立节点 / P1-9 C1 优先级过高 / P2-1 stage1-6 未作废。**全部已修**（见各节 cursor 标注）。

### 第 2 轮（subagent 收敛验证，sonnet）
**核心 meta 发现**：**「唯一权威表（matrix）尚未真正驱动另外两文档」**——forward 单点修，matrix/node-details 没跟上，三文档自洽断裂。11 P0 + 7 P1 + 2 P2，已全部修：
- **P0-1** legacy gate 三文档同步（forward §2.1 + node 1.1 + matrix A1/D1，补 `ipc.ts:185-214` 代码证据）
- **P0-2** contentHash 落地（forward §2.1 + node 1.8 + matrix D2，非仅声明）
- **P0-3** C1/C2 真 backlog（forward §2.1 backlog 小节 + node 1.9 + matrix 节点映射）
- **P0-4** 节点 1 三处同集合（补 B13/C4-C8/contentHash，删 B2/C1 出节点 1）
- **P0-5** 依赖图去环（B2→节点 3 消除 B2↔D8；B3 不依赖 B4；undo gate 同步 matrix）
- **P0-6** B2 降节点 3 TBD（偏离蓝本 §3.5 :168-173：overlay vs 独立 file resource）
- **P0-7** B16 分 owner（ExportOrchestrator/MergeEngine/detached tx，§7 :312-316）
- **P0-8** B3 先证明 consumer（knowledge_item PK 单列 UUID 非 remap target，无场景降 hardening）
- **P0-9** 删 A1-b（撤回项不平级候选）
- **P0-10** node-details 节点 2-3 补全六字段（整体重写）
- **P0-11** §2 标题工时统一 5-8w
- P1（A3-a marker / B11 admit 拒 / D9 alias / §4 上游补 / C2 移出 correctness / D11 TOCTOU 标签 / 产品 gate 命名）+ P2（删重复 C7 / 节点 0-4）全修

**收敛判定（subagent）**：修完 P0 前不可进阶段 D → **已修完，待第 3 轮窄范围复核**。

### 第 3 轮（subagent 窄范围，sonnet）
5 P0 + 1 P1（C2/B3 节点归属、forward 节点3 漏 D9/B2、D5/D8 依赖、C3 未真撤、node-details 六字段、B2/C1C2 结构）→ 全修。

### 第 4 轮（subagent 终轮确认，sonnet）
**判定：三文档收敛，可进阶段 D。**

### cursor 第 2 轮（独立收敛确认，`/tmp/cursor-round2-review.md`）
**判定：可进阶段 D，无需第 3 轮 cursor。** 第 1 轮 findings 实质全修；节点 1/backlog/2/3 ID 集合三文档一致；防过度闭环成立；**无新 P0**。残留 P1（forward §2.1 节点 0 显式拆 0G/0M）+ P2（D11 编号 / B9 依赖 / §5 状态）→ **全修**。

→ **阶段 B + C 对抗 review 收敛完成**（subagent 4 轮 + cursor 2 轮，超过 goal ≥2 轮）。进阶段 D（用户 review 决策）。

