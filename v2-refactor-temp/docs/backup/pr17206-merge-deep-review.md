# PR #17206 backup v2 merge 深度审查（主审 + codex 第二视角合并）

| 项 | 值 |
|---|---|
| 对象 | `feat/backup-v2-restore`（含 P1/P2 修复 `f7eab4b`）selective-domain merge 实现 |
| 主审 | Claude（架构文档 504 行 + ImportOrchestrator 436 行 + MergeEngine 1444 行 + 辅助模块） |
| 第二视角 | codex gpt-5.6-luna max（read-only，报告 `/tmp/codex-17206-review.md`） |
| 日期 | 2026-07-28 |
| 背景 | beta 走 #17499 全量替换；merge(#17206) 推迟 beta 后。用户立场：merge 该做（同步/高颗粒度备份复用） |

## 核心结论

merge 设计根基站得住——架构 26 invariants + aggregate boundary + identity propagation 合约自洽，junction/entity_tag/FTS/consistency 实现正确（codex 验证无独立问题）。**但 B1 identity propagation 是 P0 Blocker：会引发 silent data loss，且现有测试把这个 data loss 当 expected 固化了。** 补齐 B1（root FK + JSON required + 改测试）+ 4 个同根因 P1 前，不应视为数据安全可合并。

---

## P0 — Blocker（merge 合入前必须修）

### B1 identity propagation 不完整 → silent data loss

**证据**（codex read-only 核实行号）：
- `fieldMergeAggregate`（`MergeEngine.ts:714-730`）/ `insertAggregate`（`:750-767`）对 root 行 insert/merge 时**不改写 root 自己的 owning FK**
- `rewriteMemberFks` 只在 member loop（`:845-851`），composite FK 跳过（`:1103-1117`）
- required JSON soft-ref（`agent_channel.workspace.workspaceId` / `job_schedule.jobInputTemplate.workspace.workspaceId`）在 `backupContributorAgents.ts:298-319` 声明，但 `fieldMergeRow`（`:922-989`）/ `deepMergeJson`（`:179-218`）不查 identityMap；JSON 后处理只筛 `file-ref`（`:1009-1012`），**无 entity-id rewrite**

**关键发现：现有测试把 data loss 当 expected 固化**：
- `restore.full.test.ts:354-364` —— workspace 同 path 冲突，`sess-1.workspaceId` 未改写被 prune，**测试断言 session 消失**
- `MergeEngine.test.ts:1130-1151` —— `embeddingModelId` 冲突 prune `knowledge_base`，同样固化

**机制澄清**（codex 纠正主审）：不是 workspace 的 SQLite `ON DELETE CASCADE`（workspace 行没被删），是 `repairDanglingRefs`（`:1361-1387`）**显式 DELETE agent_session**，还可能级联删 `agent_session_message`（`dbSchemaRefs.ts:716-718`）。`foreign_key_check` 在 repair 后跑（`:325-338 → :1413-1417`），所以"检查通过但数据已丢"。

**修法**：统一 root FK + required JSON identity propagation——所有 target identity 建立后按 registry rewrite，target 不可用时显式 discard/fail + 披露，**不交给 repair pass**。**必须连测试一起改**（`restore.full.test.ts:354-364` 等从"断言 session 消失"改成"断言 workspaceId 改写为 local canonical"）。

---

## P1 — 重要

| # | 项 | 证据 | 影响 / 修法 |
|---|---|---|---|
| 1 | **B1 同根因：root → user_model FK** | member FIELD_MERGE 建 backup→local 映射（`:882-895`）但 root 不改写；`agent.model/planModel/smallModel`（`dbSchemaRefs:691-694`）、`assistant.modelId`（`:726-728`）、`knowledge_base.embeddingModelId/rerankModelId`（`:750-753`） | model PK 冲突时 FK 悬空→repair NULL/prune；embeddingModelId no-action 直接删 KB。**建议 generic root-FK propagation，别按表补丁** |
| 2 | **repair 无 touched-row provenance** | pre-check 只证 base FK-clean（`:294-297`）；`fieldMergeRow` 更新既有 local row（`:922-989`）；repair 全局 `foreign_key_check` 按 rowid NULL/DELETE（`:1337-1391`） | 可能**误删 pre-existing local row**（FIELD_MERGE 改 FK 后），DELETE 还触发 child cascade。建议记 imported/touched rowids，repair 只处理这些，非 touched **fail-closed** |
| 3 | **pin polymorphic 不验 target** | pin root scan 只查 entityType→domain（`:398-437`）；排除在 generic polymorphic phase 外（`polymorphicAssociationDeriver:47-50`）；pin 无硬 FK（`dbSchemaRefs:781`） | target 缺失/skip/identity merge 时 pin 仍插入，`foreign_key_check` 不报错（silent dangling pin）。建议 pin 进同一 polymorphic phase，查 `targetMap` rewrite entityId，不可用 drop+披露 |
| 4 | **partial quiesce 锁语义** | fingerprint 是检测器非锁（`ImportOrchestrator:292-301,375-380`；`restorePromotion:251-265,318-326`）；gate 通过→rename 间**无锁屏障**（`restorePromotion:270-272,497-520`） | 绕过 gate 的 writer（legacy/直接 DbService）可能被新 DB 覆盖。建议共享排他锁到 rename，做不到则明确为"可能丢写、fail-closed 重试"契约 |
| 5 | **Stage3 流式未做（OOM）** | scanAggregates/junction/polymorphic 全 `.all()`（`MergeEngine:378/1186/1264` TODO Stage3） | 大 archive（TOPICS 长历史）OOM |
| 6 | **full quiesce 未做** | a1 WindowManager hold / #17014 AI-channel pause follow-up | snapshot→relaunch 漏写→fingerprint mismatch→restore 无故失败 |

---

## P2 — follow-up

- composite FK propagation（`:1106-1110` 跳过；建议 tuple mapping 或 required fail-closed）
- OVERWRITE/RENAME 策略（`:363/677` throw NotImplemented；ASSISTANTS/TOPICS 无法 keep-both）
- aside 保留策略 + GC（架构 §9 numbers TBD）
- KB reindex 显式调度（架构 §6.7）

---

## codex 验证 OK（无独立问题）

- **junction phase**：role-aware rewrite（`:1175-1203`）+ source SKIP prune 有测试（`junctionPhase.test.ts:176-189`）
- **entity_tag phase**：selected-domain + tag/entity canonical rewrite/drop（`:1267-1298`，`MergeEngine.polymorphic.test.ts:149-188`）
- **FTS rebuild + integrity**（`:335-337`，`ftsCentral:24-54`）
- **consistency check**：hard FK + integrity + FTS + app_state key-set（`:1408-1443`）；唯一盲区是 required JSON soft-ref（已归 P0）

---

## beta 后推进 roadmap

1. **P0**：B1 全量 identity propagation（root owning FK + JSON required + generic root-FK）+ 改固化测试 + 真实 DB e2e roundtrip（catch silent prune）
2. **P1**：repair provenance / pin polymorphic / Stage3 流式 / full quiesce / partial quiesce 锁语义
3. **P2**：composite FK / OVERWRITE-RENAME / aside+GC / KB reindex

---

## 苏垚质疑回应（设计定位）

merge 复杂度主要来自"两套 identity 协调"（propagation/conflict/repair），这确是同步层核心问题——苏垚的同构性直觉对。但 Cherry 当前无独立跨设备同步层，备份是唯一载体 → merge 留备份层是现实必然。MergeEngine 的抽象（registry-driven、aggregate boundary、identityMap）已为未来抽取做准备：若建同步层（CRDT/op-log），这套逻辑可抽为共享协调模块，备份和同步复用。**不必现在拆，但保持解耦设计**。

---

## 未改动

read-only 审查，未改代码、未 post、未开 PR comment。行号来自 codex read-only 核实 + 主审交叉。
