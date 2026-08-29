# Backup v2 Disposition Matrix（唯一权威，禁 ID 漂移）

> 2026-08-01。对抗 review（general-purpose P1-4）要求：建立唯一 disposition matrix 覆盖 D1-D11/A1-A4/B1-B18/C1-C8，**禁止 ID 重用表达不同问题**（历史漂移：B2 消失 / B15 被误标 Notes / D11 无节点 / B6-C3 撤回论证不闭环 / C4-C8 无 disposition）。
> 本文是唯一权威，recheck §3.0 / forward-plan / node-details 引用它。旧 `stage1-6-plan.md` 已 supersede（仅历史审计材料，不可复用 contract）。

| ID | 原定义（overhaul-plan） | 蓝本依据（ef1ae2cbc） | 代码证据 | 分类 | 节点 | 依赖 / 上游 | 处置 |
|---|---|---|---|---|---|---|---|
| **D1** | 统一 writer coordinator 全 gate | §9 partial quiesce+backstop 是设计选择 | BackupService.ts:445-519（a1+drain） | **撤回**（过度） | — | drain 部分移 A1 | 撤回统一 coordinator；**drain 不撤**（A1）；**legacy `File_`/`Cache_` mutation gate 保留**（`ipc.ts:185-214` 未 gate，subagent 第 2 轮 P0-1） |
| **D2** | DB-FS combined fingerprint | §9 DB fingerprint+file journal+atomic rename | `SqliteFileStager.ts:289-335` 仅透传 skill hash | **撤回**（过度） | contentHash→1.8 | content hash 防坏 archive 保留（实现加固） | 撤回 combined；**contentHash admission 校验落节点 1.8**（subagent 第 2 轮 P0-2） |
| **D3** | per-resource atomic marker | §9 step-level marker+atomic rename（OS 级） | restorePromotion.ts:532-560 | **撤回**（过度） | — | inverse 不 finalize 移 A3 | 撤回 per-resource |
| **D4** | decision graph 四层统一 | §6/§7 schema single source | ReadonlyBackupRegistryImpl.ts:115-147 | **撤回**（B1 一致误判） | — | — | 撤回 D4 大重构 |
| **D5** | identity propagation | §5.4/§6.1 已设计 | B1 landed 895b653864；MergeEngine identity map | **保留落地** | 2.3 | 依赖 B4(3) contract（**B3 独立，非前置**，subagent 第 3 轮 P0-3） | 落地边角 |
| **D6** | undo/aside lifecycle | §9 "Undo is primary value"+retention/GC TBD | ImportOrchestrator.ts:164-166 | **保留落地** | 2.2 | retention 数值/consecutive/sweeper 待楠总 | 落地（不自行发明数值） |
| **D7** | BackupProgress BrowserWindow | §9 native notification+auto-relaunch | BackupService.ts:603-685 | **撤回**（过度） | — | — | 用 native notification |
| **D8** | 资源闭环（MCP/OVERWRITE/Notes dir-swap） | §3/§9 follow-up | contributor file-resource | **保留落地** | 2.1 | MCP→@DeJeune / OVERWRITE→#16884 / Notes dir-swap→@0xfullex 扩 kind / **undo round-trip green→Notes dir-swap（verification gate，subagent 第 3 轮 P0-3）** | 落地（gate 依赖） |
| **D9** | 性能/OOM | design 未规定 | MergeEngine.ts:562-581 全量物化 | **保留**（实现优化） | 3 | 依赖楠总性能 SLA | 流式 merge（gate） |
| **D10** | journal transition validator | §9 state machine（已限形状+probe） | restoreJournal.ts:36-48 | C1 hardening | backlog（非关键路径） | — | hardening（非紧急） |
| **D11** | 路径 hardening（symlink containment） | §9 "symlinks not followed out of root" | 已有 lstat/realpath | **保留**（defense-in-depth） | 1.7 | — | 递归 realpath+lexical（**B15 恢复为 D11**；编号对齐 node-details，cursor 第 2 轮 P2-1） |
| **A1** | writer quiesce "丢数据 P0" | §9 partial+backstop，aside 可 undo | a1 已 landed | **撤回 P0 判断**（一致误判） | drain 移 1.1 | a1+drain 并存 [[backup-a1-must-do]] | 撤回 P0；drain 补全（1.1）+ legacy `File_`/`Cache_` gate（`ipc.ts:185-214`，subagent 第 2 轮 P0-1） |
| **A2** | DB-FS 无共同快照 | §9 atomic rename | — | **撤回**（同 D2） | — | content hash 保留 | 撤回 |
| **A3** | promotion 非原子 | §9 step-level+reconcile | restorePromotion.ts:672-679 吞 inverse | **偏离 bug** | 1.2 | — | inverse 失败不 finalize+reconcile |
| **A4** | OOM | design 未规定 | MergeEngine 全量物化 | **design TBD** | 3 | 楠总性能 SLA | 上游明确 |
| **B1** | 四层独立决策 | §6/§7 schema single source | registry schema 单源 | **一致误判**（撤回） | — | — | 撤回 B1/D4 |
| **B2** | Notes overlay SKIP 与 body 写入未绑定 | §3.5 :168-173 note body ownership（overlay vs 独立 file resource）+ §9 :413-421 dir-swap | `resourcePlanning.ts:416-449` / `ImportOrchestrator.ts:212-225`（merge 前） | **design TBD**（subagent 第 2 轮 P0-6） | 3 | @0xfullex dir-swap kind + overlay/body contract | **降节点 3 TBD**：overlay SKIP 控制 body 偏离蓝本，contract 定前不实现 |
| **B3** | composite identity | §5.4/§6.1 + #26 仅 renamable root PK 单列 | `MergeEngine.ts:1388-1409` 跳过 length!==1；`dbSchemaRefs.ts:796-803`（knowledge_item self-FK，PK 单列 UUID `:705` 非 remap target） | **先证明 consumer（subagent 第 2 轮 P0-8）** | 1.4（先证明；无场景降 hardening） | dbSchemaRefs codegen @0xfullex | **先证明现存 composite FK target 场景**；无场景降 hardening，仅修单列 bug，不 tuple 重构（subagent 第 3 轮 P0-1：删 backlog 歧义） |
| **B4** | JSON soft-ref 硬编码 | §5.4 required JSON entity-id + #12 coverage | MergeEngine.ts:364-428 硬编码 agent_workspace | **design TBD** | 3 | 上游 contributor contract（target/path 表达） | 上游扩 contract |
| **B5** | sealed onStop 误释放 | §9 sealed 持到 process exit | BackupService.ts:571-578,1325-1335 | **偏离 bug** | 1.3 | lifecycle 上游 | onStop 不释放 sealed |
| **B6** | generation fencing | §9 crash recovery（未规定同进程 restart） | BackupService.ts:1325-1335 只 abort | **design TBD** | 3 | lifecycle restart 边界 | 上游明确（C3 已撤回，无残留依赖，subagent 第 3 轮 P0-4） |
| **B7** | a1 后无控制面 | §9 native notification | 已实现 | **一致误判**（撤回） | — | — | 撤回 |
| **B8** | 无 durable progress | §9 journal 状态/结果披露 | restoreJournal.ts:90-125 | **一致误判**（撤回） | — | — | 撤回 |
| **B9** | undo/expired/GC 不完整 | §9 Undo primary value+TBD | 无用户 undo API | **实现 gap** | 1.6 | — / undo API（retention 归 D6，cursor 第 2 轮 P2-2） | 用户 undo 同 gate |
| **B10** | external+MCP DB-payload 分离 | §9 external by-design dangling / MCP follow-up | backupContributorFileStorage/McpServers | **external 一致误判 / MCP 实现 gap** | MCP→2.1 | MCP→@DeJeune | external 撤回；MCP 基础 merge **统计告知版**（扫描路径引用缺失→log+summary，不阻塞 @DeJeune），完整 staging provider 后续 |
| **B11** | 资源完整性（SKILLS/KNOWLEDGE/checksum） | §3 full skill / §9 KNOWLEDGE rebuild | SKILLS degradation / KNOWLEDGE existsSync | **SKILLS+KNOWLEDGE 实现 gap / checksum 撤回** | 1.8 | KNOWLEDGE→@eeee0717 #16848 | SKILLS fail-closed + KNOWLEDGE backupIndexStore |
| **B12** | FIELD_MERGE 披露 | §6 fieldMergePolicies | MergeEngine.ts:1212-1279 | **credential 指控撤回 / 披露 contract TBD** | 3 | 上游披露 contract | credential 不成立；披露 contract 上游 |
| **B13** | UI 契约（死 button/raw error/i18n/credential warning） | §3 result page credential warning + §9 native notification | RestoreV2Popup.tsx:342-355(无 warning)+:375-378(死 button) | **控制面撤回 / result credential warning+死 button+脱敏+i18n 保留** | 1（UI contract 拆分） | — | **拆分**：撤回控制面；保留 result warning+删死 button+脱敏+i18n |
| **B14** | drain 固定+cancel 不贯穿 | §9 drain bounded（未规定 SLA） | BackupService.ts:508-519 固定 5000ms | **design TBD** | 3 | 上游 cancel latency SLA | 上游明确 |
| **B15** | TOCTOU+内部 symlink | §9 "symlinks not followed out of root" | 已有 lstat/realpath；Notes 逐文件（dir-swap 在 D8） | **保留 D11 path hardening**（**Notes dir-swap 归 D8，非 B15**） | 1.10（=D11） | — | **恢复 B15=D11** path hardening |
| **B16** | contributor hook 闭合 | §7 hooks + §9 restoreResources paper-contract | ExportOrchestrator 只接 collectFileResources | **实现 gap** | 1.5 | contributor contract @0xfullex / file-resource hooks @DeJeune | **分 owner**：ExportOrchestrator→beforeArchive / MergeEngine-import→transformRow / detached tx→afterImport+FTS（§7 :312-316，subagent 第 2 轮 P0-7）；**restoreResources 不接**（paper-contract） |
| **B17** | 性能 N+1/物化/重复扫描 | design 无性能预算 | MergeEngine.ts:647-669 | **design TBD** | 3 | 楠总规模验收 | 上游明确 |
| **B18** | FTS bulk 重复 | §9 最终 rebuild（bulk 策略未规定） | MergeEngine.ts:519-522 全量 rebuild | **design TBD** | 3 | 上游 bulk trigger 策略 | 上游明确 |
| **C1** | journal transition validator | §9 state machine | restoreJournal.ts:36-48 | **hardening**（非紧急） | backlog | — | 移关键路径外 |
| **C2** | clearRestoreJournal 语义 | §9 journal durability | restoreJournal.ts:227-241 best-effort | **契约清晰度**（非 correctness） | backlog | — | clear best-effort 是设计（subagent 第 3 轮 P0-1） |
| **C3** | relaunch timer | §9 auto-relaunch | BackupService.ts:646-685 单次 | **一致误判**（撤回，B5/B6 覆盖） | — | — | 撤回（subagent 第 3 轮 P0-4：真撤，无残留依赖） |
| **C4** | renderer 线性渲染+无 throttle | §3 result page | summary 全量 li | **保留加固** | 1（UI） | — | 虚拟化/throttle |
| **C5** | DESIGN/a11y | DESIGN.md | — | **保留加固** | 1（UI） | — | Dialog/aria/semantic token |
| **C6** | v1/v2 popup 并存 | §3 | — | **保留加固** | 1（UI） | — | v1/v2 gate |
| **C7** | startup outcome 仅检查一次 | §9 recoverOnBoot | runBackupRestoreGate | **保留加固** | 1 | — | 幂等可重试 |
| **C8** | summary IPC 无 envelope | §9 | backup.ts | **保留加固** | 1 | — | restoreId/version envelope |

## 节点映射（重排，general-purpose 建议 #4）
- **0G merge 自有**：阶段 0 九 commit 正常 push（**不迁 #17499**，用户决策；C 下随分支退役）
- **0M merge-only**：a1 P2 / A1 drain（仅 A）
- **1 修 bug（有复现）**：A1 drain+legacy gate / A3 / B5 / B3（证明后）/ B16（分 owner）/ B9 / D11（=B15）/ B11 / B13 UI 拆分 / C4-C8 / contentHash hardening（subagent 第 2 轮 P0-4/P2-1）
- **1 backlog（不进 DoD）**：C1 / C2
- **2 落地 follow-up（contract 已拍板）**：D8（gate）/ D6（gate）/ D5
- **3 design TBD（上游）**：A4 / B4 / B6 / B12 披露 / B14 / B17 / B18 / D9（性能族）/ **B2 overlay/body**（subagent 第 2 轮 P0-6）
- **4 验证**：roundtrip / process crash / undo round-trip / 并发写 / 资源 integration / retention consecutive

## 上游协调（general-purpose P1-9 补全）
- **Kenny（产品）**：决策点 0 A/B/C 定位 + §3.6 产品 TBD（settings-class default / keep-both 披露 / encryption / workspace cascade）
- **vaayne（#17499）**：format compat + 两套 restore UX 交界（**迁移取消**；仅两套共存时相关）
- **@0xfullex（楠总）**：design TBD（A4/B4/B6/B12/B14/B17/B18）+ D6 retention/consecutive/sweeper + D8 Notes dir-swap kind + B3 dbSchemaRefs codegen + WindowManager/dispatcher API
- **@eeee0717**：B11 KNOWLEDGE backupIndexStore（#16848）
- **@DeJeune**：D8 MCP/AGENTS file-resource hooks（**完整 staging 才等；基础统计告知不阻塞**）+ dispatcher drain + 苏垚质疑（决策点 0-B）
