# Cursor Review：feat/backup-p1-p2-fix（P1 rowScopes + P2 member FK rewrite）

| 项 | 值 |
|---|---|
| Branch | `feat/backup-p1-p2-fix` |
| Commit | `f7eab4bf6a` — `fix(backup): apply rowScopes + member FK rewrite at restore boundary` |
| Base | `feat/backup-v2-restore@51d1cd59df` |
| Diff | `MergeEngine.ts` (+64/−3) · `__tests__/MergeEngine.test.ts` (+63) |
| Reviewer | Cursor Grok 4.5（read-only） |
| Date | 2026-07-27 |
| Tests spot-check | `MergeEngine.test.ts -t 'P1\|P2\|rewrites member\|rowScopes'` → **2 PASS** |

## Verdict

**无 P0。可以合入。** P1/P2 对声称的威胁模型成立；对照 `backup-architecture.md` §2.9（Restore / identity propagation）与 invariant **#5 / #23** 方向正确。残留为对称性完整性缺口与测试覆盖偏窄（P1/P2），以及 B1 全量仍未覆盖的已知边界（文档已标明 partial）。

---

## 修复摘要（对照实现）

### P1 — `scanAggregates` 应用 contributor `rowScopes`

```388:397:src/main/services/backup/merge/MergeEngine.ts
        const rootScope = this.registry
          .getSchema(domain)
          .rowScopes?.find((rs) => rs.table === agg.root && rs.filter.op === 'eq')
        const backupRoots = rootScope
          ? (backupDb
              .prepare(
                `SELECT * FROM ${quoteIdent(agg.root)} WHERE ${quoteIdent(physicalColumn(rootScope.filter.column))} = ?`
              )
              .all(rootScope.filter.value) as Record<string, unknown>[])
          : (backupDb.prepare(`SELECT * FROM ${quoteIdent(agg.root)}`).all() as Record<string, unknown>[])
```

- 威胁：手搓 / 旧版 archive 携带非 `agent.task` 的 `job_schedule` → restore 后 `JobScheduleService.listEnabled()` 可能 arm。
- 对照 export：`ExportOrchestrator.applyRowScopes` 在快照上 `DELETE … WHERE col != ?`；restore 侧改为 SELECT 过滤，效果等价（只导入 owned partition）。
- 对照 #5：`job_schedule` 不全表排除，仅 `type='agent.task'` 归 AGENTS。
- 对照 #23：filter / `typeCoverage` 由 finalize 保证；此处复用 registry，不另写死 type 字面量。

### P2 — `mergeIncludeMembers` → `rewriteMemberFks`

```845:851:src/main/services/backup/merge/MergeEngine.ts
      for (let memberRow of memberRows) {
        // P2: rewrite member FKs to canonical IDs ...
        memberRow = this.rewriteMemberFks(member.table, memberRow, identityMap)
```

```1098:1119:src/main/services/backup/merge/MergeEngine.ts
  private rewriteMemberFks(...): Record<string, unknown> {
    // DB_FOREIGN_KEYS + targetMap；单列 FK；无命中则原样返回；有改写则 shallow copy
  }
```

- 威胁：`file_entry` 经 `lower(external_path)` 去重 SKIP（`findLocalByExternalPath`）后 `targetMap[fe-backup]=fe-local`，但 `chat_message_file_ref.file_entry_id` 仍写 backup PK → `repairDanglingRefs` prune → 附件/Logo 丢失。
- 改写发生在 uniqueMergeRules / PK 查找与 insert **之前**（正确：unique 含 `fileEntryId` 时必须用 canonical 查重）。
- 明确标注 **B1 partial**：仅 member 单列 FK；composite / root owning FK / required JSON soft-ref 仍属 B1 全量。

---

## Findings

### P0

_无。_

---

### P1

#### P1-1 — 与 export `applyRowScopes` 的对称性不完整；注释「future shared tables covered automatically」过强

**Evidence**
- Export（`ExportOrchestrator.ts:548-571`）：遍历 **全部** domain 的 **全部** `rowScopes`，对 `rs.table` 执行 DELETE，不要求该表是 aggregate root。
- Restore P1：仅当 `rs.table === agg.root` 时在 `scanAggregates` 过滤；非 root 的 shared table scope 会被静默忽略。
- 注释（`MergeEngine.ts:386-387`）声称复用 registry 后 future shared tables 自动覆盖。

**Impact**
- 今日 schema 只有 AGENTS `job_schedule`（且为 aggregate root）→ **生产路径正确**，不构成当前回归。
- 若未来 rowScope 落在 member / 非 root 共享表，export 会删、restore 仍可能 SELECT 全表导入 → 对称性再次破洞；与 commit message「symmetric」不完全一致。

**Fix（可选，非合入阻断）**
- 收窄注释：写明「仅 root 表 rowScope；今日 = job_schedule」。
- 或抽 `collectEqRowScopes(registry)`，restore 对 scope.table 一律加 WHERE（scan + 任何直接读该表的路径），与 export 集合对齐。

#### P1-2 — P2 测试只钉 `chat_message_file_ref`，未覆盖同构 Logo 成员表

**Evidence**
- 实现泛化遍历 `DB_FOREIGN_KEYS`（`painting_file_ref` / `provider_logo_file_ref` / `mini_app_logo_file_ref` 均为单列 `fileEntryId→file_entry`）。
- 单测仅一条：`rewrites member file_entry_id… (P2)`（`MergeEngine.test.ts` ~754）。

**Impact**
- 逻辑同构，回归风险低；但 commit 正文点名四表，测试未防「某 domain member 循环绕过 rewrite」类重构。

**Fix**
- 至少再加一条 `provider_logo_file_ref` 或 `painting_file_ref` 的 file_entry 去重用例（可参数化同一 helper）。

---

### P2

#### P2-1 — Root owning FK / required JSON soft-ref / composite FK 仍不在本修复范围（已知 B1 缺口，非本 commit 引入）

**Evidence**
- `rewriteMemberFks`：`fk.columns.length !== 1` → continue；只在 `mergeIncludeMembers` 调用。
- §5.4 / §2.9：`agent_session.workspaceId → agent_workspace`、`job_schedule.jobInputTemplate.workspace.workspaceId` 等 required 传播仍标 B1 follow-up。
- Junction 相位已有独立 `identityMap` 改写（`importAllJunctionRows`），与 P2 正交。

**Impact**
- 不削弱 P2 对 file_entry 去重→附件 prune 的修复。
- 文档/commit 已写 partial，避免误读为 B1 完成即可。

**Fix**
- 无需改本 PR；B1 全量单独立项。可选：在 `rewriteMemberFks` JSDoc 链到 §5.4 未覆盖清单。

#### P2-2 — `op !== 'eq'` 与 `.find()` 首条 scope

**Evidence**
- `RowScope.filter.op` 类型字面量仅 `'eq'`（`contributorTypes.ts:105-108`）；export 同样只处理 `eq`。
- `.find(...)` 同 root 多 scope 时只取第一条（今日 AGENTS 仅一条）。

**Impact**
- 当前无行为 bug；类型系统已禁非 eq。属防御性冗余。

**Fix**
- 可保持；若担心多 scope，改为 `filter` 累积 AND（需 product 定义）。

#### P2-3 — P1 过滤为静默 drop，无 `degradedToSkips` 披露

**Evidence**
- 出圈 `job_schedule` 不进 `decisions`，无 degrade 行。
- Export 侧同样静默 DELETE + VACUUM。

**Impact**
- 对伪造 archive 的安全过滤合理；运维排查「为何某 schedule 没进来」缺少 restore 侧线索。

**Fix**
- 可选：count 被 WHERE 滤掉的行 → `degradedToSkips`（`rows_skipped` / reason=`rowScope filtered`）。非必须。

#### P2-4 — targetMap 时机 / topo（验证通过，记为非问题）

**Evidence**
- `importRows` 按 `topoSort(ctx.domains)` 产出的 `decisions` 顺序处理；SKIP 分支在成员写入前写入 `targetMap`（`MergeEngine.ts:649-666`）。
- TOPICS/PROVIDERS/PAINTINGS 经 `fileEntryId` ref 依赖 FILE_STORAGE → topo 保证 file_entry 决策先于成员 rewrite。
- 现有 P2 测例 `domains: ['FILE_STORAGE','TOPICS']` 且断言 `file_entry_id === 'fe-local'` + `foreign_key_check` 空。

**Impact**
- 无新 bug。Lite 排除 FILE_STORAGE 时无 map → 仍靠 `repairDanglingRefs` prune（预期）。

#### P2-5 — P1 测例未覆盖 FIELD_MERGE / junction 联路

**Evidence**
- 仅：`js-keep` 导入、`js-other` 不在；未测已有本地 `(agent.task, name)` FIELD_MERGE，也未测出圈 schedule 被 `agent_channel_task` 引用时的 cascade-prune。

**Impact**
- FIELD_MERGE 与过滤正交（先 filter 再 decision）；junction 在 target 缺失时本就会 prune。覆盖缺口小。

**Fix**
- 可选补测：出圈 `taskId` junction 不落地；或 in-scope schedule FIELD_MERGE 后 junction 仍指向 local canonical（属 junction/B1，非 P1 必测）。

---

## 维度结论

| 维度 | 结论 |
|---|---|
| 1) 修复正确性 / 完整性 | **P1**：对当前唯一 rowScope（job_schedule root）正确，堵住伪造/旧 archive 注入。对称 export 在「非 root scope」上不完整（P1-1）。**P2**：member 单列 FK + targetMap 时机正确，能防 file_entry 去重后的附件 prune；完整 B1 未宣称完成。 |
| 2) 新引入 bug | **未发现** composite 误改写（显式 skip）、部分映射（无 map → 留给 repair）、topo 时序问题、非 eq 误处理。`rewrite` 置于 unique 查找前是正确选择。 |
| 3) 测试覆盖 | 核心路径有测且 PASS；缺 Logo 成员表、P1 FIELD_MERGE/junction、degrade 披露（P1-2 / P2-3 / P2-5）。 |
| 4) 对照架构 §2.9 + #5 / #23 | 对齐 #5（不全表排除 job_schedule，按 row-scope 归属 AGENTS）与 #23（复用已 finalize 的 scope，不另开过滤语义）。§2.9 / §5.4 identity propagation：P2 是 B1 的 member 单列切片，与「conflict identity propagation still B1」叙述一致，未假装完成 root/JSON required 改写。 |

---

## 合入建议

- **可以合。** 无 blocking finding。
- 建议 follow-up（不挡本 PR）：修 P1-1 注释或真正对齐 export 的全表 scope 应用；补一条 Logo/`provider_logo_file_ref` 测例（P1-2）。

## 未改动

- 未改 `src/`、未改测试、未 push、未开 PR comment。
- 本文件为 review-only 产物。
