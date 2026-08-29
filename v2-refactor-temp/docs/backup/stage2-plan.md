# 阶段 2 计划：决策统一 + 原子性（D3 promotion 原子 + D4 decision graph + D5 identity）

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（旧伪码 / 旧验收 / 旧 Design，如 marker write-ahead 覆盖 :48-49 旧 mark 序）若与修正冲突即作废。实施前先读文末修正段。

> 目标：消除 A3（promotion 非原子 rollback → mixed state）+ B1/B2（ResourcePlan 非唯一决策源 → 四层分叉）+ B3/B4（composite identity 不完备 + JSON soft-ref 硬编码）。
> 工时修正后 ~2.5-4 周。3 PR（2a 原子 / 2b decision graph / 2c identity）。
> **解环顺序（破 2a↔2b 循环依赖）**：`2b-schema`（先冻结 ConflictDecision 全字段 + decisionId 算法，实现可仍 SKIP/FIELD_MERGE）→ `2a`（marker 绑 decisionId）→ `2b-engine`（MergeEngine/planning 全量消费 decision graph）→ `2c`（可与 2b-engine 并行）。**删"2b 依赖 2a"单边表述** —— 是 2a 依赖 2b-schema 的 decisionId 契约，2b-engine 依赖 2a 的 marker 语义，按解环顺序单线开工。
> 前置：阶段 1（D1 coordinator + D2 快照）完成。

---

## PR 2a · promotion 可证原子事务

### PRD
**目标**：promotion 的 DB rename + 资源移动建模为可证原子事务；inverse 失败不 finalize completed；boot reconcile 恢复 partial promotion。消除"old DB+new resource 或 new DB+old resource"mixed state。

**范围**：
- journal 加 `resourceStates[]`（per-resource durable marker：`applied`/`inverse-pending`/`inverse-done`/`failed`）
- promotion 每步写 marker（apply 资源后 `applied`，inverse 前 `inverse-pending`，inverse 后 `inverse-done`）
- `inverseManifest` 失败 → **不 finalize completed/failed**，保留 `promoting` + 写 `inverse-failed` marker，下次 boot reconcile
- preboot gate `runRestorePromotion` 加 reconcile 分支：检测 partial（marker 不一致）→ forward 继续 / inverse 完成 / 明确 quarantine
- DB rename 作为 commit boundary（已有 `work-promoted` probe）+ 资源 marker 联合判定
- **apply 前 lexical containment 校验（D11 落点，解 B15）**：promotion apply 写 marker 前，`resource.livePath` realpath 解析后必须 lexical-contain 在 `userData` 下，越出 → `BackupPathEscapeError`（fail-closed）；marker 写入与 lexical 校验同事务（防 promotion `existsSync→rename` 窗口的 symlink 替换越出 userData）

**不在范围**：artifact GC（阶段 3a）、undo API（阶段 3a）、策略 OVERWRITE/RENAME（阶段 3c）

**验收**：
1. 资源 inverse 失败时 journal 不写 `completed`/`failed`，保留 `promoting` + `inverse-failed` marker
2. boot reconcile 按 marker 正确恢复（forward 继续 / inverse 重试完成）
3. 无 mixed state（DB 与资源最终一致：全 old 或全 new）
4. **crash 表冻结 + I/O failure 套件**：stage2 冻结 `checkpoint×decisionId` 机读表 + I/O failure 测试（`markerFailure`/`fsyncDirFailure` 可捕获异常）；**真进程边界 crash matrix 由 stage6 执行**（stage2 本阶段不交付真 crash 绿，只定义表 + I/O failure）
5. reconcile 不丢用户数据（forward/inverse 幂等）

### Design
**per-resource marker schema**（`restoreJournal.ts` 扩展）：
```ts
// RestoreJournal 加：
resourceStates?: Array<{
  decisionId: string       // 关联 PR 2b decision graph
  kind: ResourceKind
  livePath: string
  state: 'applied' | 'inverse-pending' | 'inverse-done' | 'inverse-failed'
  attempts: number
  lastError?: string
}>
```

**promotion 执行 + marker**（`restorePromotion.ts:532-612` 改）：
```ts
for (const res of plan.resources) {
  markResourceState(res.decisionId, 'applied')        // apply 后
  // ... apply 资源 ...
}
// commit boundary: DB rename (work-promoted)
```

**inverse 失败处理**（`inverseManifest` :664-679 改）：
```ts
// 旧：per-entry best-effort，失败 log 继续，finalize failed
// 新：
for (const res of appliedResources.reverse()) {
  markResourceState(res.decisionId, 'inverse-pending')
  try { inverse(res); markResourceState(res.decisionId, 'inverse-done') }
  catch (e) {
    markResourceState(res.decisionId, 'inverse-failed', e)
    // 不 finalize！保留 promoting，写 reason，下次 boot reconcile
    finalize(ctx, 'promoting', currentStep, `inverse-failed: ${res.decisionId}`)
    return  // 停止，不进 completed/failed
  }
}
```

**boot reconcile**（`runRestorePromotion` :109-136 加分支）：
- 读 journal + resourceStates
- 若有 `inverse-failed` → 重试 inverse（幂等：只 inverse `applied` 且未 `inverse-done` 的）
- 若 inverse 仍失败 N 次 → `quarantine`（显式不可恢复，不 mixed）
- 若 forward partial（DB 已 promote 但资源未全 apply）→ 继续 apply 幂等

**幂等保证**：apply/inverse 操作必须可重复执行（rename 前检查目标存在；移动前检查源）。已有 `renameDurable` + aside probe 基础，扩展到资源级。

### Implement steps
1. journal `resourceStates` schema + read/write + 单测 → verify: schema round-trip + 旧 journal 兼容（无 resourceStates 视 legacy）
2. promotion apply 写 `applied` marker + 测试 → verify: marker 正确写
3. inverse 改 `inverse-pending`/`inverse-done`/`inverse-failed` + 失败不 finalize + 测试 → verify: 失败保留 promoting
4. boot reconcile 分支（inverse-failed 重试 / forward partial 继续 / N 次失败 quarantine）+ 测试 → verify: 每场景恢复
5. apply/inverse 幂等审计（每操作可重复）+ 测试 → verify: 重复执行不坏
6. crash 表冻结 + I/O failure 套件测试（`markerFailure`/`fsyncDirFailure` 每 checkpoint + checkpoint×decisionId 表完整）→ verify: 表完整 + I/O failure 恢复（**真进程边界用例 ID 留 stage6**，本阶段不交付真 crash 绿）

### 测试矩阵
- 资源 apply 后崩溃 → boot 继续 apply 幂等
- 资源 inverse 失败 → 保留 promoting + inverse-failed marker
- boot reconcile inverse-failed → 重试成功
- boot reconcile inverse 多次失败 → quarantine（不 mixed）
- forward partial（DB promote 资源未全 apply）→ boot 继续
- DB rename 后崩溃 → commit boundary probe 恢复（已有，验证不退化）
- 旧 journal（无 resourceStates）→ legacy 兼容
- apply/inverse 幂等（重复执行）
- N 个资源部分 inverse → 全 inverse 或全保留

### 风险 + 回滚
- **reconcile 逻辑复杂**（forward/inverse 交错）→ 完整 crash matrix 测试 + 状态机图 commit
- **幂等漏洞**（某操作不可重复）→ 每操作审计 + 幂等测试
- **journal schema 变更** → resourceStates optional + 旧 journal legacy 路径
- **回滚**：marker 是 additive（journal 加字段），旧 promotion 逻辑保留 fallback；reconcile 是新分支，可禁用回旧 best-effort

---

## PR 2b · 单一 RestorePlan decision graph（拆 2b-schema 冻结 → 2b-engine 消费；2a 依赖 2b-schema）

### PRD
**目标**：pre-merge 在 detached snapshot 一次性解析 immutable decision graph；planning/merge/journal/promotion/summary 四层只消费不重算。消除"plan skip / merge INSERT / promotion 移文件 / UI 不一致"分叉。携 FIELD_MERGE 字段级披露。

**范围**：
- `RestorePlan`：immutable `ConflictDecision[]`，每项 `{decisionId, aggregateIdentity, dbAction, resourceAction, targetFingerprint/treeHash, strategySource, reason}`
- planning 产 decisions（不再只产路径/skip 集）；MergeEngine 消费 decisions（不再独立 scan 推导）；journal 序列化 `planHash` + decisions；promotion 按 decisionId 执行；summary 消费 decisions + outcomes
- `strategyByAggregate`（按 aggregate/identity class/资源 scope）+ 统一 `ConflictDecision`（DB+资源成对）
- FIELD_MERGE 字段级披露：`FieldConflictDisclosure{table,entityKey,field,resolution}`（不携原值，credential/token/apiKey 只 table/entity/field/resolution）进 durable summary
- summary 分层：`plan`（future intent）/ `mergeLosses` / `promotionOutcome` / `tasks`，全持久化 + restoreId/schemaVersion envelope

**不在范围**：OVERWRITE/RENAME 策略实现（阶段 3c，本 PR 只留 decision graph 框架 + SKIP/FIELD_MERGE/INSERT）

**验收**：
1. 四层（planning/merge/journal/promotion）消费同一 decisions（grep 无独立 scan 推导冲突）
2. decision graph hash 一致性（journal 写 planHash，promotion 校验）
3. FIELD_MERGE 普通 scalar 冲突进 summary（无 credential 原文）
4. summary 分层持久化（plan/losses/outcome/tasks）+ envelope
5. Notes DB overlay SKIP 与 body 写入绑定（B2 mixed state 消除）

### Design
**`ConflictDecision` schema**（新 `merge/types.ts`；**2b-schema 一次冻结全字段，含 3c/5a 前向兼容**）：
```ts
type ConflictDecision = {
  decisionId: string              // 稳定 hash(aggregateIdentity + dbAction + resourceAction)；2a marker 绑此 id
  aggregateIdentity: { table: string; key: string[] | string }  // 支持 composite（PR 2c）
  dbAction: 'insert' | 'skip' | 'field-merge' | 'overwrite' | 'rename'      // 宽 union 一次冻结；overwrite/rename 本 PR 不实现（fail-closed），3c 消费
  resourceAction: 'none' | 'add' | 'skip' | 'overwrite' | 'tree-swap'       // 同上，tree-swap 3c 消费
  newIdentity?: { table: string; key: string[] }   // RENAME 用（3c 消费，2b-schema 只定义字段不实现 RENAME 逻辑）
  targetFingerprint?: string      // 资源 contentHash（PR 1b）/ treeHash
  fieldConflicts?: FieldConflictDisclosure[]  // FIELD_MERGE 逐字段
  resourceDecision?: {            // 5a 消费；2b-schema 一次冻结，防 5a/5b/5c 平行造状态（B1 复发）
    capability?: string
    diskEstimate?: number
    degradationKind?: string
  }
  strategySource: 'default' | 'user' | 'aggregate-policy'
  reason: string
}
// 2b-schema 冻结后 3c/5a 只填执行器，禁扩 schema/version/hash；未实现的 dbAction/resourceAction 遇到 → fail-closed（throw）
```

**RestorePlan 生成**（新 `planRestore(planDeps): RestorePlan`）：
- 在 detached work.sqlite 上扫描 backup aggregates + 与 live 对比
- 产 `ConflictDecision[]`（一次性，immutable）
- 替代当前 `resourcePlanning` 独立 skip + `MergeEngine` 独立 scan

**MergeEngine 改造**：
- 输入 `RestorePlan`（不再独立推导）
- 按 decision.dbAction 执行（insert/skip/field-merge）
- 返 `MergeLossLedger`（fieldConflicts + skips + degradations）

**journal**（`restoreJournal.ts` 扩展）：
```ts
// 加：
planHash: string                  // hash(RestorePlan.decisions)
decisions: ConflictDecision[]     // 或外部 store 引用
```

**promotion 按 decisionId**：每资源操作关联 decision（与 PR 2a resourceStates.decisionId 对齐）。

**summary 分层**（`shared/types/backup.ts` 扩展）：
```ts
type RestoreResultSummary = {
  restoreId: string
  schemaVersion: number
  plan: PlanSummary              // 将执行的 decisions 概览
  mergeLosses: MergeLossLedger   // fieldConflicts + skips + degradations
  promotionOutcome: PromotionOutcome  // 实际 success/expire/partial
  tasks: RestorePostRestoreTask[]     // KNOWLEDGE reindex 等
}
```

**Notes B2 修复**：Notes decision 同时考虑 DB overlay identity + path（不再只 livePath existence）→ DB overlay SKIP 时 resourceAction 也 skip（不写 body）。

### Implement steps
1. **[2b-schema]** `ConflictDecision`/`RestorePlan` schema（含 `newIdentity`/`resourceDecision`/宽 union）+ planning 生成（detached snapshot 扫描）+ 单测 → verify: decisions 正确生成 + 未实现 action fail-closed（overwrite/rename/tree-swap 遇到 throw）
2. **[2b-engine 渐进迁移里程碑，三步]**：
   - **双跑期**：新 planning 产 decisions + **旧 MergeEngine scan 双跑**（决策一致性对比测试，旧 path 仍执行）→ verify: 新旧决策一致
   - **切主**：feature flag 切 MergeEngine 消费 decisions（旧 scan 仅 logging，可 revert）→ verify: flag 开/关行为一致 + 现有 merge 测试绿
   - **删旧 path**：删旧 scan + lint 禁独立推导冲突（flag 移除）→ verify: grep 无独立 scan + 四层一致
3. journal 序列化 planHash + decisions + promotion 按 decisionId + 测试 → verify: hash 一致 + 旧 journal 兼容
4. summary 分层（plan/losses/outcome/tasks）+ envelope + 测试 → verify: 持久化 + legacy 兼容
5. FIELD_MERGE fieldConflicts 披露（credential DTO + canary，见修正 4）+ 测试 → verify: 逐字段披露无原值
6. Notes decision 绑定 DB+path（B2 修复）+ 测试 → verify: overlay SKIP 时 body 不写
7. 四层一致性 e2e（plan→merge→journal→promotion→summary 消费同一 decisions）+ 测试 → verify: 无分叉

### 测试矩阵
- planning 产 decisions（各策略 SKIP/FIELD_MERGE/INSERT）
- MergeEngine 消费 decisions（不独立推导）
- journal planHash 与 promotion 校验一致
- FIELD_MERGE fieldConflicts（多字段/多 entity/多 table 聚合）
- credential/token/apiKey disclosure 不含原值
- summary 分层持久化 + envelope + 旧 journal legacy
- Notes overlay SKIP + body 缺失 → resourceAction skip（不 mixed）
- 四层 decision 一致性（grep 无独立 scan）

### 风险 + 回滚
- **大重构**（四层契约改）→ 渐进迁移（旧 path 并存 + decision 一致性校验双跑期）+ 充分 round-trip
- **decision 生成正确性**（planning 一次推导所有冲突）→ 对比旧 path 输出（双跑）+ 每 aggregate 测试
- **journal schema 大变更** → planHash + decisions optional；旧 journal legacy 兼容
- **回滚**：feature flag 控制（新 planning vs 旧 path）；独立 PR 可 revert

---

## PR 2c · identity propagation 升级（composite + 通用 JSON soft-ref）

### PRD
**目标**：identity key 从单 string 升级为 composite tuple/canonical；FK rewrite / PK lookup / junction upsert / self-ref repair 全支持 composite。JSON soft-ref 从硬编码 agent_workspace 升级为 contributor 提供 rewriter descriptor，未知 shape fail-closed。

**范围**：
- `IdentityMap` key：`string` → `string[]`（tuple）或 canonical encoding；lookup 全支持
- FK rewrite / PK lookup / junction upsert / self-ref repair 支持 composite（不再 `length !== 1 continue`）
- `JsonSoftReferencePolicy` 扩展：`{table, column, path, discriminator, rewriter}` 或 contributor 提供 `rewriteJsonSoftRefs(obj, identityMap) + validateJsonSoftRefs(obj)`
- dbSchemaRefs composite PK/FK inventory 全覆盖测试
- 未知 JSON shape → degradation（不静默跳过）

**验收**：
1. composite PK/FK round-trip（agent junctions、preference、knowledge_item self-FK）
2. 新 contributor 可声明 JSON soft-ref policy 并正确 rewrite
3. 未知 JSON shape → degradation（不静默）
4. dbSchemaRefs 全 composite 覆盖测试
5. 单列 identity 不退化

### Design
**identity key 升级**（`merge/types.ts:92-121`）：
```ts
// 旧：Map<table, Map<string, string>>  // 单列
// 新：
type IdentityKey = string[]   // tuple，单列 = [col]
type IdentityMap = Map<string, Map<string, IdentityKey>>  // table → canonical(key) → newKey
function canonical(key: string[]): string { return key.join('\x1f') }  // 分隔符
```

**FK rewrite 支持 composite**（`MergeEngine.ts:1384-1409` 改）：
- 旧：`if (fk.columns.length !== 1) continue`
- 新：按列组 lookup identityMap，全列映射

**junction upsert**（`:1688-1692`）：按 composite PK 查/插。

**JSON soft-ref 通用**（`MergeEngine.ts:384-427,1509-1565` 改）：
```ts
// 旧：硬编码 agent_workspace + 2 shape
// 新：contributor JsonSoftReferencePolicy 提供
type JsonSoftReferencePolicy = {
  table: string
  column: string
  // 二选一：
  pathRewrites?: Array<{ path: string; token: string }>   // 声明式
  rewriter?: (obj: unknown, map: IdentityMap) => unknown  // 函数式（contributor 提供）
}
// 遍历 JSON path，按 policy rewrite；未知 shape → degradation
```

**dbSchemaRefs composite inventory**（`:655-800`）：全量列 composite PK/FK，每类加 round-trip test。

### Implement steps
1. `IdentityKey` tuple 化 + `IdentityMap` 升级 + canonical + 单测 → verify: 单列不退化 + composite 支持
2. FK rewrite / PK lookup / junction upsert / self-ref repair 支持 composite + 测试 → verify: 各 composite 类型
3. dbSchemaRefs composite inventory 全量测试 → verify: 每 composite PK/FK round-trip
4. JSON soft-ref policy 扩展（pathRewrites + rewriter）+ contributor descriptor + 测试 → verify: agent_workspace 用新 policy + 新 contributor 可声明
5. 未知 JSON shape fail-closed（degradation）+ 测试 → verify: 不静默跳过
6. e2e composite restore（agent junctions + preference + knowledge_item self-FK）+ 测试 → verify: 身份正确传播

### 测试矩阵
- 单列 identity 不退化
- composite PK round-trip（各类型）
- composite FK rewrite（按列组）
- junction upsert composite
- self-ref repair composite（knowledge_item）
- JSON soft-ref agent_workspace（新 policy）+ 假新 contributor 声明
- 未知 JSON shape → degradation（不静默）
- dbSchemaRefs 全 composite 覆盖

### 风险 + 回滚
- **identity key 变更影响面广**（所有 contributor）→ schema inventory 完整 + 每 composite 测试 + 单列双跑
- **JSON soft-ref rewriter contributor 迁移**（agent_workspace 从硬编码迁 policy）→ 双跑对比
- **回滚**：IdentityMap 支持单列（tuple 长度 1）兼容旧；JSON soft-ref 旧硬编码路径保留 fallback

---

## 阶段 2 整体验证闭环
```bash
pnpm vitest run src/main/services/backup src/main/data/db/restore src/main/data/db/backup
pnpm lint && pnpm build:check
# crash matrix e2e + decision graph 一致性 e2e + composite round-trip e2e
```

## 阶段 2 门槛
- vitest 绿 + lint 0 error + build:check 绿
- cursor/codex 对抗 review 无 high/medium（重点审：原子事务 reconcile 幂等 / decision graph 四层一致 / composite 完备 / credential 不泄露）
- crash matrix 文档 + decision graph 状态机图 commit
- **局部 traceability**：本 plan 各 PR"测试矩阵"段即 criterion→test 映射（PR 实施时填 test ID + CI tier）；架构 Master Traceability 是汇总索引。crash 表 checkpoint×decisionId 与 stage6 共享

---

## 对抗 review 细化修正（stage2 review 发现）

### 修正 1 · 资源 marker write-ahead 状态机（2a）

**review 发现**：原伪码在资源操作**前** `markResourceState('applied')`，marker 落盘后 apply 前崩溃 → reconcile 误把未 apply 当 applied（错误 inverse/漏 forward）。且 promotion 资源操作分散在 DB commit **前后两步**，成功标记仅整 step 完成后写。

**修正**：marker 改 write-ahead 两态：
```ts
// apply 前：写 'applying'（crash 后 reconcile 知该资源未完成，重试 apply 幂等）
markResourceState(decisionId, 'applying')
// apply 成功且 durable 后：写 'applied'
markResourceState(decisionId, 'applied')
// reconcile：'applying' = 未完成（重试 apply），'applied' = 已完成（inverse 候选）
```
marker 必须区分 pre-commit（DB rename 前）与 post-commit（DB rename 后）资源（inverse 顺序不同）。

**验收**：加"marker 'applying' 落盘后 apply 前崩溃 → reconcile 重试 apply 不误 inverse"测试。

### 修正 2 · identity map 保留 source/target 双向（2c）

**review 发现**：MergeEngine 保留 source/target（backup PK → local PK + local PK → backup PK）两套 identity map 语义；简化为单表 tuple map 会丢 junction 处理事实。

**修正**：IdentityMap 保留双向：
```ts
type IdentityMap = {
  backupToLocal: Map<string /*table*/, Map<string /*canonical(tuple)*/, string>>
  localToBackup: Map<string, Map<string, string>>  // 反向（junction / dangling repair）
}
```
不简化为单表。tuple key 支持复合（修正 3）。

### 修正 3 · canonical tuple 无歧义编码（2c）

**review 发现**：`canonical(key) = key.join('\x1f')` 碰撞（`['a\x1fb','c']` vs `['a','b\x1fc']` 同结果）→ IdentityMap 错 entity / FK 错 rewrite。

**修正**：length-prefix 编码或 canonical JSON（保列序）：
```ts
function canonical(key: string[]): string {
  // length-prefix：每列 "len:value"，无歧义
  return key.map(c => `${c.length}:${c}`).join('\x1f')
}
// 或 canonical JSON：JSON.stringify(key)（保列序，引号转义安全）
```
加碰撞回归测试（含 `\x1f` / `:` / 引号在值中）。

### 修正 4 · credential disclosure schema-level DTO + canary（2b）

**review 发现**：原"credential 黑名单"+"测试不含原值"笼统，无黑名单来源/字段识别/统一禁入契约（reason/tasks/mergeLosses/journal/summary/log）。contributor spec 明确 `user_provider.apiKeys`/`authConfig` 携带 credential（docs/references/backup/contributor-spec.md:80-86）。

**修正**：
- `FieldConflictDisclosure` schema-level 禁 raw value（DTO 无 value 字段，只 `{table, entityKey, field, resolution}`）
- 敏感字段 policy（contributor spec 声明 `user_provider.apiKeys/authConfig/token/secret` 等）→ disclosure 标 `resolution` 不携值
- **canary 断言**：测试用唯一 canary credential（如 `canary-secret-<uuid>`），断言它不出现于 summary/journal/reason/tasks/mergeLosses/log/UI payload 任何位置
- 统一禁入契约：所有 durable summary/journal + error reason + log 经 `redactSecrets()` 过滤

### 修正 5 · composite inventory oracle（2c）

**review 发现**：矩阵只类型示例，现有 schema 有多个未列名 composite PK（`assistantRelations.ts:29,49,69,90` + `tagging.ts:39` 三列）。手写 e2e 无法证明全量，新 composite 不会自动失败。

**修正**：由 `dbSchemaRefs` 或 schema metadata **导出 committed inventory**：
- 测试启动时读 dbSchemaRefs 全 composite PK/FK → 断言每项有 declared round-trip fixture
- schema 新增 composite → inventory 测试自动失败（强制更新）
- committed inventory 文档 commit（审计）

### 修正 6 · crash matrix checkpoint oracle（2a/阶段 6）

**review 发现**：验收要"每步"，测试只列 promotion 资源。无 checkpoint 名录/故障注入/每态期望/测试条目 → 验收漂移。

**修正**：枚举 checkpoint 为稳定 ID + 每态 expected + parameterize：
```
checkpoint ID | 注入崩溃点 | 重启入口 | 期望终态(old/new/quarantine) | journal state
admission-pre | admitArchive 前 | 重新 admission | old (无 journal) | none
quiesce-mid | drain 中 | 重新 quiesce | old | none
snapshot-pre | VACUUM INTO 前 | 重新 snapshot | old | none
stage-mid | staging copy 中 | 重新 stage | old | none
merge-mid | merge 中 | 重新 merge（work DB 重建）| old | none
migrate-mid | migration 中 | 重新 migrate | old | none
seal-pre | fingerprint seal 前 | 重新 seal | old | none
promote-gate-passed | gate-passed 后 | preboot reconcile | 看 commit boundary | promoting
promote-additive-moved | additive-moved 后 | reconcile forward/inverse | marker 决定 | promoting
promote-sidecars-removed | sidecars-removed 后 | reconcile | marker | promoting
promote-live-aside | live→aside 后 | reconcile（live 在 aside） | marker | promoting
promote-work-promoted | work→live 后（DB committed） | forward resume | new | promoting
promote-entries-applied | 资源 apply 中 | reconcile（marker） | new（资源进行中）| promoting
promote-integrity-ok | integrity 后 | complete | new | completed
```
fault injection 扩展 markerFailure/fsyncDirFailure 模式到每 checkpoint；测试 parameterize 全 checkpoint。

**decisionId 统一（与 stage6 共享机读表）**：crash 表 row key 必须含 `decisionId`（per-resource oracle：每 decisionId 的 source/live/aside/ownership 终态），与 stage6 共享同一机读表 —— **stage2 冻结、stage6 只扩展用例，禁两套 ID 体系**。上表 checkpoint 列对应 `checkpoint × decisionId` 二维。

**进程边界约束（防虚假通过，统一 N1）**：crash **表字段定义真进程边界语义**（`checkpoint×decisionId` + `arrange-and-crash`/`fresh-boot-recover` 模型），**由 stage6 实现执行**；stage2 本阶段只**冻结机读表 + I/O failure 套件**（`markerFailure`/`fsyncDirFailure` 可捕获异常 + 存活 handle），不交付真 crash 绿。stage2-5 勿把 fault injection 绿当真 crash 验证（架构 crash 分层）。

### 工时修正
- 2a 加 marker write-ahead + crash matrix oracle → ~4-6 天
- 2b 加 credential DTO + canary + summary 分层 → ~3-5 天
- 2c 加双向 identity map + canonical + composite oracle → ~4-6 天
