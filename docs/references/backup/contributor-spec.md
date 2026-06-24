# Contributor 实现规范摘要（PR Reviewer / Contributor 速读）

> 本文档合成自主架构 `docs/references/backup/backup-architecture.md`（§2/§3.5/§5.4/§6/§6.2/§7/§8.5）与配套 openspec change `modular-backup-contributors-refined` 的 5 源 spec 提取（contributor-framework / registry / backup-service-lifecycle / design / tasks）。**目的**：让 reviewer / contributor 不跨 repo（不读 openspec 完整 spec）即可理解 contributor 体系如何落地（A3 修订后的 placement + lifecycle + 聚合边界 + 不变量 + identity propagation）。

---

## 1. 概述：contributor 体系是什么

备份把"哪个域拥有哪些用户数据表、引用、聚合边界、恢复策略"从集中式规则库（`DomainRegistry`/`DomainStripper`/`DomainImporter`/`FileCollector`，v1 throwaway）下放给各业务域，由每个域声明一个 `BackupContributor`。

**BackupContributor = schema + backupPolicy + operations 三层分离**：

| 层 | 放什么 | 不放什么 |
|---|---|---|
| `schema`（Entity facts） | 表归属、引用事实、主键形态、聚合边界、file-ref source、JSON 软引用 | SET_NULL/DELETE_ROW 动作、导入顺序、恢复策略 |
| `backupPolicy` | 省略引用 override、唯一键合并、列级 FIELD_MERGE、`platformSpecificKeys` | 数据库 I/O、文件操作、异步 hook |
| `operations`（可选） | 文件资源发现、beforeArchive、逐行 transform、afterImport、blob 恢复、cloneAggregate | 可用纯数据表达的事实和策略 |

- contributor 是**冻结的常量对象**（非 class）：`export const TOPICS_CONTRIBUTOR = deepFreeze<BackupContributor>({ domain, schema, backupPolicy, operations })`。理由是纯数据 + 无状态纯函数 hook；`schema-only` 域 `operations: undefined` 天然支持；`deepFreeze` 保证 finalize 后不可变（strict mode 下任何 mutation 抛 TypeError）。
- **核心机制是 `schema.aggregates`（聚合边界 AggregateBoundary）**：把 object-boundary 的 SKIP/OVERWRITE/RENAME 从文字描述提升为**静态可校验**机制——一个 topic 连同它的 message 树、一次 Agent 会话连同它的消息，要么整体导入要么整体跳过。

---

## 2. Placement：contributor 声明放在哪

> 回应 PR #12659 review A3/L289：避免 domain facts 集中到 backup 模块。

**规则**：各域 contributor declaration **co-locate 在 owning domain module**，由业务域 owner 维护该域 entity facts（表归属/引用/聚合/file-ref/JSON 软引用）。

- 路径：`src/main/services/<domain>/backupContributor.ts`（如 `services/topics/backupContributor.ts` = `TOPICS_CONTRIBUTOR`）。每域可多文件拆分（如 KNOWLEDGE restoreResources 重 IO 可独立文件），测试就近放该域 `__tests__/`。
- **backup 模块只持**：统一 barrel（`contributors/index.ts` 聚合 14 域导出）+ `ContributorManager` + registry + 纯类型（`types.ts`）+ 通用 runtime helper（`deepFreeze`）。**不承载任何 domain-specific 表/列/聚合事实**——否则 domain facts 退回集中到 backup 模块，与下放目标矛盾。
- 检查：`src/main/services/backup/contributors/` **SHALL 仅含** barrel / finalize / 纯类型 / runtime helper；**SHALL NOT 含**域 schema/policy/operations declaration。

**Ownership 边界**：业务域（topics/agents/...）**反向 import backup 的纯类型**（`@main/services/backup/contributors/types` + `@shared/data/backup/dbSchemaRefs`）+ 通用 runtime helper（`deepFreeze`，acyclic、非 domain-specific）来声明并导出该域 contributor；**不依赖 backup 的 domain-specific facts**。列名从 `@shared/data/backup/dbSchemaRefs` import helper 与 `DB_PRIMARY_KEYS`，**SHALL NOT** 重新定义 `DbTableName`/`DbColumnName` 品牌。

> `domain/`（集中式规则库）是 v1 throwaway：contributor 并行实现，等价测试通过后替换 orchestrator import 来源再删 `domain/`，不修其 bug、不加 fallback。

---

## 3. Lifecycle：ContributorManager 如何启动

> 回应 PR #12659 review A3/L304。

**ContributorManager = non-lifecycle named singleton**，对齐 CLAUDE.md「Non-Lifecycle Services 决策指南」：

- 导出：`export const contributorManager = new ContributorManager()`。
- **不** `extends BaseService`、**不**应用 `@Injectable`/`@ServicePhase`、**不**进 `serviceRegistry.ts`、**无** `@DependsOn`。
- 理由：不持有长生命周期资源、**不连 DB**、无 IPC/定时器/事件订阅，只有"启动期一次性 finalize 产出冻结 BackupRegistry"的纯函数式行为。

**惰性 finalize**：`getRegistry()` 首次调用同步 finalize + 深度冻结 + 缓存（幂等）。失败抛 `ContributorFinalizeError`（含 domain/table/owner/违反不变量）。

**触发时机**：`BackupService`（WhenReady lifecycle service）于 `onInit()` 调 `contributorManager.getRegistry()` 惰性触发 finalize——直接 `import { contributorManager }`（**非** `application.get`，因它不在 lifecycle 容器）。失败 → `BackupService.onInit` 失败 → lifecycle 容器拒绝启动并报告。这保留了启动期校验语义，等价于原 `WhenReady + @DependsOn` 方案，但无需把纯静态 finalizer 提升为 lifecycle service。

**finalize 不连 DB**：只读 codegen 产物（`dbSchemaRefs.ts`）+ contributor 声明，不调 `application.get('DbService')`。DB 实际表覆盖由 **coverage test（CI）守门**——finalize 校验声明间一致性，coverage test 校验实际 schema 表覆盖，两者互补。

**BackupService 仍是 lifecycle service**（持 orchestrator/RESTORE BARRIER/journal 等长生命周期资源）：`@Injectable('BackupService') + @ServicePhase(Phase.WhenReady) + @DependsOn(['RestoreSafetyManager'])`。**不** `@DependsOn(['DbService'])`（DbService 是 BeforeReady，phase 顺序自动先于 WhenReady 启动；CLAUDE.md 硬约束：WhenReady 服务不得 `@DependsOn` BeforeReady 服务）。

> 检查：`serviceRegistry.ts` **SHALL NOT** 含 `ContributorManager`。

---

## 4. 聚合边界 + 25 不变量要点

### 4.1 AggregateBoundary（§6.2 派生公式）

`AggregateBoundary { root, renamable, [identityKey?], [identityClass?], [conflictDefault?], [members?] }`——除 `root` 与 `renamable` 外，其余字段**默认从 `references + primaryKeys` 派生**，contributor 显式声明仅在偏离默认时使用（显式 override 也须与派生自洽，不变量 14 拒绝漂移）。

| 字段 | 缺省派生 | 何时显式声明 |
|------|----------|----------|
| `root` | —（手写，领域事实：哪个表是"对象"语义根） | 必填 |
| `renamable` | —（手写，领域事实：能否安全克隆） | 必填 |
| `identityKey` | `primaryKeys[root].columns`；**root 有 UNIQUE 约束（非 PK）时须含 UNIQUE 键**（防跨设备同值不同 UUID 撞 SQLite UNIQUE，如 `agent_workspace.path`/`tag.name`/`note(rootPath,path)`/`pin(entityType,entityId)`/`agent_global_skill.folderName`/`job_schedule(type,name)`） | PK 复合且 UNIQUE 键非全 PK |
| `identityClass` | `primaryKeys[root].kind`：`uuid-v4`/`uuid-v7`→`uuid-entity`、`natural`/`composite`→`natural-key`；root 有 UNIQUE 约束（非 PK）→ `natural-key` | `slot`（预定义槽位，codegen 无法推断） |
| `conflictDefault` | `uuid-entity`→`SKIP`；`natural-key`/`slot`→`FIELD_MERGE` | 偏离默认时（现网仅 preference/note 偏离为 SKIP，设置类例外，须 reason + 不变量 21） |
| `members` | 域内指向 root 的 owning include references 源表（`viaColumn`=ref.column、`parent`=ref target，按拓扑序）；junction 表、跨域 ref、域内指向其它聚合根的 owning ref **不计入** | 需排除默认成员（如 self-ref 自引用） |

`AggregateMember { table, viaColumn, cascade:'include'|'optional' }`：include=随根整体处理；optional=根冲突时仅置空。派生由 `finalize` 启动期完成，**不**在 hook 调用期。

### 4.2 25 不变量要点（§8.5 精炼，非全抄）

每条失败抛 `ContributorFinalizeError(invariantId, payload)`，payload 含 domain/table/sourceType/owner 字段。

**归属与穷尽**：
- #1 每域恰一 contributor（`registry.length===14` 严格相等，`PREFERENCES/PROVIDERS/PROMPTS/MCP_SERVERS/TAGS_GROUPS/ASSISTANTS/AGENTS/SKILLS/MINIAPPS/TOPICS/KNOWLEDGE/TRANSLATE_HISTORY/PAINTINGS/FILE_STORAGE`）。
- #2 每张 Drizzle 用户数据表恰一 owner 或带 reason 排除；#3 无表被多 contributor 拥有；#4/#5 ALWAYS_STRIP/INFRASTRUCTURE/排除集运行时表不被 contributor 拥有（`job_schedule` 不整表排除，`type='agent.task'` row-scope 归 AGENTS）。

**引用与 PK 事实**：
- #6 references 的 source 表（`ref.table`）属声明方 owner，target 可跨域；#7 `omittedReferenceOverrides` 绑定已声明 reference + 非冗余 + reason。
- #8 每个 owned 表恰一个 primary-key fact 且列存在于 codegen；#9 主键 kind 非 ambiguous；#22 主键 kind 非 autoincrement（全库零自增 PK 是无 id remap 的基石前提）。
- #10 references 派生依赖图无环（Kahn 拓扑，环抛 `CircularReferenceError`）；#23 共享表 row-scope 覆盖穷尽 + 未命中 fail-loud（防脏 type 值致数据无声消失）。

**软引用覆盖**：
- #11 每个 `FileRefSourceType` 有 owner 或 runtime-only 排除；#12 声明的 `jsonSoftReferences` 列真实存在且为 json 类型（不反向全库扫描）。

**聚合边界（核心）**：
- #13 aggregate.root 在 owner，identityKey 是其 PK 或业务 UNIQUE 键（防跨设备同值不同 UUID 撞 UNIQUE）。
- #14 aggregate.members 派生自 owning include references——junction 表、跨域 ref、及域内指向**其它聚合根**的 owning ref 均不计入（仅指向本 root 的 owning ref 入 members）；optional 自引用不计入；多 owning reference 指向 member/root 须显式 parent 否则拒绝歧义；parent 链有环拒绝。
- #15 members 中每成员表属于本 contributor、viaColumn 是真实 FK 列指向 root.identityKey 或父 member 的 PK（多层 cascade A→B→C，C.viaColumn→B，§4.1 parent 派生）、junction 表不计入。
- #16 renamable:true 聚合须有 `operations.cloneAggregate`。

**FK 自洽（须 codegen 生成 `DB_FOREIGN_KEYS`）**：
- #19 每个 `EntityReference.kind` 与生成的 FK onDelete 自洽（cascade/restrict→owning 或 junction；set null/no action→optional；set default→拒绝）。
- #20 junction/co-owned FK 不声明 optional，NOT NULL 列不可 SET_NULL。
- #24 声明的 EntityReference 对应生成的 FK；#25 反向——**每个 DB FK 须被 owner contributor 声明**（防漏声明跨域 FK 如 `agent.model→user_model` 致拓扑无依赖边、omitted 动作不触发、悬空 FK 行）。

**冻结与冲突默认**：#17 schema 深度冻结；#18 失败信息含定位字段；#21 natural-key/slot 聚合 conflictDefault 非 SKIP（设置类 preference/note 例外允许 SKIP，含 `platformSpecificKeys` 排除跨平台不兼容 key）。

---

## 5. identity propagation（§5.4）

**场景**：owning/required FK 指向 **natural-key 聚合**（target 按 identityKey FIELD_MERGE、本地 UUID 胜出）时，备份 target 的 UUID 被 FIELD_MERGE 合并掉，importer **必须**建立 `{备份 target id → 本地 canonical id}` 映射，导入 source 时把该 FK 重写到本地 id——否则 owning FK 悬空（`defer_foreign_keys` COMMIT 失败或 source 丢失）。

**重写边界按 ref 是否 required（非按是否 JSON）**：

- **required ref**（target 缺失则功能损坏）——target 合并时**必须重写**：① DB owning FK（`agent_session.workspaceId → agent_workspace`，跨设备同 path 不同 uuid）；② **required JSON ref**（AGENTS：`agent_channel.workspace.workspaceId` / `job_schedule(type='agent.task').jobInputTemplate.workspace.workspaceId`，均为 `AgentSessionWorkspaceSource`），后者由 `jsonSoftReferences` 标 required 类参与 identity propagation——否则恢复看似成功（`foreign_key_check` 通过）但 channel/定时 task 引用悬空 workspace。
- **tolerant ref**（`message.data.fileEntryId` 附件软引用、`file_ref.sourceType`）——target 合并/缺失时**不重写**，缺失仅降级 Toast + orphan 检测。
- **optional ref**（如 `translate_history.sourceLanguage → translate_language`）——重写保留关联或按 optional 语义 SET_NULL（不可留悬空备份 uuid）。
- **junction ref**（如 `entity_tag.tagId → tag`）——随 root cascade-prune，target 合并时 FK 一并重写。

> **≠ 已删的 ID remap**：remap 给 uuid-entity 源记录 PK 生成新 uuid（不需要，保留源 PK 幂等）；identity propagation 把源 FK 重定向到 natural-key target 的 canonical id（源记录 PK 不变，natural-key 合并所必需）。

**典型工作流（AGENTS）**：`agent_session.workspaceId → 独立 agent_workspace 聚合`（域内跨聚合 owning reference：同属 AGENTS、分属两个独立聚合根）。workspaceId 是 cascade NOT NULL owning FK，但 target `agent_workspace`（natural-key `path` UNIQUE）是独立聚合根、非 `session.root`——故不变量 14 不计它入 `session.members`、workspace 不强制为 member。这不等于逃避 owning 校验：不变量 25 强制 AGENTS 声明此 FK → 不变量 19 校验 onDelete=cascade 对应 kind=owning 自洽（codegen `DB_FOREIGN_KEYS` 作数据源）。`agent_session` renamable:false（跨聚合 owning 克隆矛盾 + 撞 `path` UNIQUE）。

---

## 6. 各域关键决策（§3.5，14 域）

`identityClass`/默认 `conflictDefault` 为 finalize 派生值，显式声明仅用于偏离默认。

| 域 | 聚合根（+ include 成员） | identityClass | renamable | 默认 conflictDefault | 精简 |
|---|---|---|---|---|---|
| PREFERENCES | `preference[scope,key]` / `note`（`(rootPath,path)` UNIQUE） | natural-key | false | SKIP / SKIP（**设置类例外**：本地优先 + 补缺；`platformSpecificKeys` 排除跨平台不兼容 key） | ✓ |
| PROVIDERS | `user_provider` + `user_model`(providerId) | natural-key | false（派生键） | FIELD_MERGE | ✓ |
| PROMPTS | `prompt` | uuid-entity | false | SKIP | ✓ |
| MCP_SERVERS | `mcp_server` | uuid-entity | false | SKIP | ✓ |
| TAGS_GROUPS | `tag`/`group`/`pin` + `entity_tag`（多态 junction） | tag/pin natural-key、group uuid-entity | false | tag/pin FIELD_MERGE、group SKIP | ✓ |
| ASSISTANTS | `assistant` + `assistant_mcp_server`/`assistant_knowledge_base` | uuid-entity | true | SKIP | ✓ |
| AGENTS | `agent_session`(+`agent_session_message`) / `agent_workspace` / `agent_channel` / `agent` + `job_schedule`(type='agent.task') row-scope + `agent_skill`(junction) | agent_workspace/job_schedule natural-key、其余 uuid-entity | session:false（跨聚合 owning ref）、其余 false | agent_workspace/job_schedule FIELD_MERGE、其余 SKIP | ✓ |
| MINIAPPS | `mini_app`(app_id) | natural-key | false | FIELD_MERGE | ✓ |
| SKILLS | `agent_global_skill`（`folderName` UNIQUE） | natural-key | false | FIELD_MERGE | ✓ |
| TOPICS | `topic` + `message`(topicId) | uuid-entity | true | SKIP | ✓ |
| KNOWLEDGE | `knowledge_base` + `knowledge_item` | uuid-entity | **false**（`{baseId}` 目录一致性难保，RENAME 退化为 SKIP） | SKIP | ✗ |
| TRANSLATE_HISTORY | `translate_language`(langCode) + `translate_history`(uuid-entity 独立聚合) | natural-key / uuid-entity | false | FIELD_MERGE / SKIP | ✗ |
| PAINTINGS | `painting` | uuid-entity | false | SKIP | ✗ |
| FILE_STORAGE | `file_entry` + `file_ref` | uuid-entity | false（无安全克隆路径，RENAME 退化为跳过同名不同大小文件） | SKIP | ✗ |

> 精简模式：10 域含、4 域（KNOWLEDGE/TRANSLATE_HISTORY/PAINTINGS/FILE_STORAGE）排除，`includeFiles=false`/`restoreFiles=false`。junction 表（`agent_channel_task`/`agent_skill`）不计入聚合成员，走独立 junction reference。

---

## 7. contributor 声明示例（TOPICS）

聚合根 `topic` + 成员 `message(topicId)`；冲突 → 整组（topic + 其 message 树）按策略处理。

```typescript
import { table } from '@shared/data/backup/dbSchemaRefs'
import { deepFreeze, type BackupContributor } from '@main/services/backup/contributors/types'

// TOPICS 拥有 topic(uuid-v4) + message(uuid-v7) 两表
// message.topicId→topic.id: 域内 cascade FK → owning include member
// message.modelId→user_model.id: 跨域 set null FK → optional ref (referencedDomain=PROVIDERS)
// message.parentId→message.id: 自引用 set null → optional (self)，不计入聚合成员
export const TOPICS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TOPICS',
  schema: {
    tables: [table('topic'), table('message')],
    references: [
      // owning include ref → member
      // optional cross-domain / self refs
    ],
    primaryKeys: [/* topic: uuid-v4, message: uuid-v7 */],
    aggregates: [{
      root: 'topic',
      renamable: true,
      // identityKey / identityClass / conflictDefault / members 默认从 references+primaryKeys 派生
      // members 默认 = [message (viaColumn=topicId, include)]
    }],
    fileRefSourcePolicies: [
      // file_ref.sourceType='chat_message' → ownerDomain=TOPICS
    ],
    jsonSoftReferences: [
      // message.data 含 fileEntryId 软引用 → tolerant
    ]
  },
  backupPolicy: { /* omittedReferenceOverrides / uniqueMergeRules / fieldMergePolicies */ },
  operations: {
    // renamable:true 故 cloneAggregate 必须实现
    // cloneAggregate 须重写 topic.activeNodeId 标量 soft ref 到新 aggregate 的 message id
  }
})
```

> TOPICS `renamable:true`：RENAME 克隆 topic 时 `activeNodeId`（标量 text soft ref 指向 message，无 FK）**必须**随 `cloneAggregate` 重写（映射到新 topic 对应 message 的 id），否则 restored topic 指向旧 aggregate 的节点/悬挂引用——列为该域 `cloneAggregate` 必需重写规则。

---

## 8. 完整 spec 索引（深挖用，标注在配套 openspec change）

下列 spec 文件属于配套实现 spec（openspec change `modular-backup-contributors-refined`，实现期工件、非本 repo git 跟踪）。本文档不引用其路径（避免死链），仅列出职责供深挖。

### 框架与注册（capability `modular-backup-contributor`）
- `proposal.md` — 本变更与 codex 版分歧的裁决（聚合边界、表穷尽归类、稳定主键、omitted 引用派生）。
- `design.md` — 设计基线（三层分离、25 不变量矩阵、coverage、行级合并语义、A3 placement/lifecycle 裁决）。
- `tasks.md` — 实施任务（T0 gate → T1 框架/codegen/registry → T2 14 域 declaration → T3 orchestrator 接入）。
- `specs/modular-backup-contributor/spec.md` — BackupContributor 三层分离 interface 契约。
- `specs/modular-backup-contributor/contributor-framework.md` — contributor 冻结常量对象 + deepFreeze + placement/ownership 边界（A3 修订源）。
- `specs/modular-backup-contributor/types-contracts.md` — `DbTableName`/`DbColumnName<TTable>` 品牌化、helper 签名、codegen 认证路径。
- `specs/modular-backup-contributor/codegen.md` — `generate-backup-schema-refs.ts` 入口与 `backup:refs:generate`/`check` 命令。
- `specs/modular-backup-contributor/registry.md` — `ContributorRegistry` declare module 接口合并 + 14 域穷尽断言 + `ReadonlyBackupRegistry` 只读视图 + ContributorFinalizeError。
- `specs/modular-backup-contributor/hooks.md` — 7 hook 完整 typed context 签名。
- `specs/modular-backup-contributor/contexts.md` — `BackupScopedDb`（drizzle select/insert/update/delete 子集，不暴露 Client/transaction/run）。
- `specs/modular-backup-contributor/contributor-testing.md` — 四层测试（tsc+codegen check / coverage / equivalence / restore tests）。
- `specs/modular-backup-contributor/domains/simple-domains.md` — PROMPTS/MCP_SERVERS/PAINTINGS 等单表/无聚合域 declaration。
- `specs/modular-backup-contributor/domains/config-domains.md` — PROVIDERS/PREFERENCES/TAGS_GROUPS 等配置域（FIELD_MERGE / 设置类 SKIP / platformSpecificKeys）。
- `specs/modular-backup-contributor/domains/aggregate-domains.md` — TOPICS/ASSISTANTS/AGENTS/KNOWLEDGE 等聚合域（renamable、跨聚合 owning ref、row-scope）。

### 恢复安全（capability `backup-restore-safety`）
- `specs/backup-restore-safety/spec.md` — capability 级 requirements 汇总。
- `specs/backup-restore-safety/backup-service-lifecycle.md` — BackupService lifecycle（WhenReady + @DependsOn(RestoreSafetyManager)）+ ContributorManager non-lifecycle singleton（A3/L304 修订源）+ IPC channel。
- `specs/backup-restore-safety/export-orchestrator.md` — ExportOrchestrator 5 步流程（VACUUM INTO 复制 → beforeArchive → 收集资源）。
- `specs/backup-restore-safety/import-orchestrator.md` — ImportOrchestrator 7 步流程（聚合边界冲突策略 → defer FK withWriteTx 导入 → FTS 重建）。
- `specs/backup-restore-safety/restore-barrier.md` — RESTORE BARRIER（应用级写屏障，区别于逐事务 writeMutex）。
- `specs/backup-restore-safety/restore-recovery-point.md` — RestoreRecoveryPoint（整库 pre-snapshot + journal + 文件快照 + upstream DbService/PreferenceService gating）。

### 评审记录
- `FINAL_REVIEW.md` — 架构 final review。
- `reviews/PR12659-v2-lead-review.md` — PR #12659 review（A3 placement/lifecycle 修订出处）。
- `reviews/D-group-decision-summary.md` — 分歧裁决汇总。

> 主架构对照文档：`docs/references/backup/backup-architecture.md`（本 repo 内，详尽论述；本文档为其 contributor 落地要点的精炼速读版）。
