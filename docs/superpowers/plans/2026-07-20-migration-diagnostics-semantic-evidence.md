# 迁移诊断严格语义证据实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不收集用户内容、用户标识、路径、原始错误或日志的前提下，让 v1 → v2 迁移诊断从真实事实源保留 renderer 导出、MCP 缺失 ID、Provider/Model 非法 ID 与目录/版本选择的严格因果证据，并通过代表性真实场景验证到最终 ZIP。

**架构：** 事实只能由操作所有者产生，经严格 discriminated union 与现有迁移 IPC/Coordinator 进入 v2 journal，再由白名单 Bundle Builder 投影为 v2 `migration-events.json`。Coordinator 与 Builder 共用一套纯保留策略；5.5 场景只作为验收子集，生产逻辑按事实所有者和不变量泛化，不按场景名称分支。

**技术栈：** TypeScript、Zod、Electron IPC、React、Vitest 3、better-sqlite3/Drizzle、archiver、node-stream-zip。

---

## 执行边界

- 不运行 `pnpm test`。
- 不运行 `pnpm build:check`；当前脚本会间接执行 `pnpm test`。
- 每个任务只运行列出的定向 Vitest 文件。
- 数据库测试使用 `setupTestDatabase()`，不手写 `CREATE TABLE`，不 stub Drizzle 链。
- 不新增 UI、遥测、自动上传、日志 ZIP、第五个 ZIP 条目、IpcApi 迁移或 MCP CHECK 生产分支。
- 所有日志继续使用 `loggerService`；所有迁移路径继续由 `MigrationPaths` 提供。
- 每次提交前先用 `git status --short` 核对变更边界，提交使用 `--signoff`。

## 文件与职责

### 新建

- `src/shared/data/migration/v2/diagnostics.ts`：renderer → Main 的严格失败报告 schema/type。
- `src/shared/data/migration/v2/__tests__/diagnostics.test.ts`：renderer 报告合法组合、非法组合和额外字段测试。
- `src/shared/data/types/__tests__/model.test.ts`：Unique Model ID 所有规则及类型化 violation 测试。
- `src/renderer/windows/migrationV2/exporters/RendererExportError.ts`：renderer 私有错误，固定报告与原始 cause 分离。
- `src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts`：三个 exporter 的实际操作归属测试。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticRetention.ts`：Coordinator/Builder 共用的纯因果保留策略。
- `src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts`：优先级、五次尝试和 200 事件边界测试。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsV1Schemas.ts`：冻结的 v1 journal 读取 schema 与 v1 → v2 转换。
- `src/main/data/migration/v2/window/rendererExportDiagnostics.ts`：严格解析 renderer 报告并组装固定 terminal input；Main-owned write 分类优先。
- `src/main/data/migration/v2/diagnostics/migrationVersionGateDiagnostics.ts`：由目录选择与版本读取事实组装严格 version-gate context。
- `src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticSemanticEvidence.integration.test.ts`：MCP、Provider、version owner → journal → builder → ZIP 验收。
- `src/renderer/windows/migrationV2/__tests__/MigrationRendererDiagnosticAcceptance.integration.test.ts`：实际 exporter failure → 严格报告 → journal → ZIP 验收。

### 修改

- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`：v2 session、固定 migrator ID、warning、两个 code、三类 semantic evidence、扩展 versionGate。
- `src/main/data/migration/v2/diagnostics/index.ts`：仅显式导出新增公共诊断 API；不导出内部保留策略或 v1 schema。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`：v2/v1 attach 顺序、原子升级和共用保留策略。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsJournal.ts`：允许调用方指定 v1/v2 schema，保持 1 MiB 与原子写语义。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticBundleSchemas.ts`：events/manifest format 2，database format 保持 1。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`：2 MiB、format 2、白名单 semantic evidence/versionGate、共用保留策略。
- `src/main/data/migration/v2/core/MigrationPaths.ts`：active v2 journal、legacy v1 journal、目录选择 role。
- `src/main/data/migration/v2/core/versionPolicy.ts`：一次读取产生 previous version 与 bounded version-log summary。
- `src/main/core/preboot/v2MigrationGate.ts`：只消费 owner 产生的 selection/version facts；renderer failure 接收 fixed terminal input。
- `src/shared/data/migration/v2/types.ts`：保留旧 IPC 通道，给 `ReportError`/`WriteExportFile` 的参数添加共享类型。
- `src/shared/data/types/model.ts`：集中 Unique Model ID violation，保持现有错误消息和行为。
- `src/renderer/windows/migrationV2/exporters/{ReduxExporter,DexieExporter,LocalStorageExporter,index}.ts`：逐操作包装 fixed source/operation report。
- `src/renderer/windows/migrationV2/MigrationApp.tsx`：exporter catch 与 `StartMigration` catch 分离，message/report 分离。
- `src/main/data/migration/v2/window/MigrationIpcHandler.ts`：严格 report fallback、同 generation write 分类、message 不进入诊断 capability。
- `src/main/data/migration/v2/migrators/BaseMigrator.ts`：提供不会改变迁移结果的 best-effort fixed event helper。
- `src/main/data/migration/v2/migrators/McpServerMigrator.ts`：独立 missing-ID 计数与单个 aggregate warning。
- `src/main/data/migration/v2/migrators/ProviderModelMigrator.ts`：识别 upstream typed violation 并记录 fixed evidence。
- `docs/superpowers/specs/2026-07-20-migration-diagnostics-semantic-evidence-design.md`：保持批准状态和不跑间接全量测试的命令说明。

### 定向测试更新

- `src/main/data/migration/v2/diagnostics/__tests__/{migrationDiagnosticsSchemas,MigrationDiagnosticsCoordinator,migrationDiagnosticsJournal,MigrationDiagnosticBundleBuilder,MigrationDiagnosticBundleBuilder.integration,MigrationDiagnosticAcceptance.integration}.test.ts`
- `src/main/data/migration/v2/diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts`
- `src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`
- `src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`
- `src/main/data/migration/v2/migrators/__tests__/{McpServerMigrator,ProviderModelMigrator}.test.ts`
- `src/main/data/migration/v2/core/__tests__/{versionPolicy,MigrationPaths}.test.ts`
- `src/main/core/preboot/__tests__/v2MigrationGate.test.ts`
- 所有手工构造 `MigrationPaths` 的现有定向测试 fixture：
  - `src/main/data/migration/v2/core/__tests__/MigrationDbService.integration.test.ts`
  - `src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts`
  - `src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts`
  - `src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.process.integration.test.ts`

## 任务 1：建立共享 renderer 报告与 v2 事件契约

**文件：**

- 新建：`src/shared/data/migration/v2/diagnostics.ts`
- 新建：`src/shared/data/migration/v2/__tests__/diagnostics.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/index.ts`

- [ ] 1. 在两个测试文件先写失败用例：穷举 10 个合法 renderer source/operation 组合；拒绝交叉组合、额外字段、自由字符串；穷举三个 semantic evidence 分支并拒绝错误 scope/phase/state/code/category/migrator 绑定。

测试中的合法 renderer 表应固定为：

```ts
const legalRendererOperations = {
  redux: ['read', 'parse'],
  dexie: ['open', 'read', 'serialize', 'write'],
  local_storage: ['read', 'serialize', 'write'],
  unknown: ['unknown']
} as const
```

- [ ] 2. 添加 v2 schema 失败用例：`warning` 不能作为 finished attempt terminal；producer input 拒绝 `migratorId: 'private-user-value'`；persisted event 允许固定 `unknown`；versionGate 必须包含目录 role 和严格 log summary。

- [ ] 3. 运行定向测试并确认失败来自缺失 schema/字段，而不是环境问题。

```bash
pnpm exec vitest run --silent \
  src/shared/data/migration/v2/__tests__/diagnostics.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts
```

预期：FAIL，报缺少 `migrationRendererExportFailureReportSchema`、`semanticEvidence`、`warning` 或 version 2。

- [ ] 4. 在共享文件实现严格 renderer 报告，不接受 `kind` 之外的自由上下文，也不接受错误 source/operation 配对。

```ts
export const migrationRendererExportFailureReportSchema = z.discriminatedUnion('sourceRole', [
  z.object({ sourceRole: z.literal('redux'), operationRole: z.enum(['read', 'parse']) }).strict(),
  z.object({ sourceRole: z.literal('dexie'), operationRole: z.enum(['open', 'read', 'serialize', 'write']) }).strict(),
  z.object({ sourceRole: z.literal('local_storage'), operationRole: z.enum(['read', 'serialize', 'write']) }).strict(),
  z.object({ sourceRole: z.literal('unknown'), operationRole: z.literal('unknown') }).strict()
])

export type MigrationRendererExportFailureReport = z.infer<
  typeof migrationRendererExportFailureReportSchema
>
```

- [ ] 5. 在 Main schema 中加入 `missing_required_field`、`invalid_identifier`、`warning`、固定 migrator input，以及三个 strict `semanticEvidence` 分支。用一个 `superRefine` 同时校验“有 evidence 必须完全匹配固定事件”和“固定 evidence 事件必须带对应 evidence”。

```ts
const invalidIdentifierEvidenceSchema = z.discriminatedUnion('identifierRole', [
  z.object({ kind: z.literal('invalid_identifier'), identifierRole: z.literal('provider_id'), rule: z.enum(['empty', 'contains_separator']) }).strict(),
  z.object({ kind: z.literal('invalid_identifier'), identifierRole: z.literal('model_id'), rule: z.enum(['empty', 'contains_reserved_route_character']) }).strict()
])
```

`MIGRATION_DIAGNOSTICS_SESSION_VERSION` 改为 `2`；attempt terminal outcome 不新增 warning。

- [ ] 6. 扩展 `migrationVersionGateContextSchema`：加入 `directorySelectionRole`；把字符串 `versionLog` 替换为 `missing | read_failed | parsed` union；`parsed` 的两个桶只允许 `0 | 1 | 2+ | unknown`，其中生产 owner 后续不会产生 unknown。

- [ ] 7. 重跑同一命令，预期 PASS；再执行 `git diff --check`。

- [ ] 8. 提交。

```bash
git add src/shared/data/migration/v2 src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(migration-diagnostics): define v2 semantic contracts"
```

## 任务 2：集中因果保留策略

**文件：**

- 新建：`src/main/data/migration/v2/diagnostics/migrationDiagnosticRetention.ts`
- 新建：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts`

- [ ] 1. 先写纯策略失败测试。每个 finished attempt 必须保护 terminal；优先保护该 attempt 最后一个带 `semanticEvidence`/`payloadProfile`/`versionGate` 的 event；没有结构事实时保护最后一个 non-unknown failed/unavailable/warning event。

- [ ] 2. 写压力失败测试：五个 attempt、接近 200 个事件、每个 attempt 两个 protected event；删除顺序必须是“最旧 ordinary → 最旧额外 causal”，protected 集合永不出现在 removable 顺序中。

- [ ] 3. 运行：

```bash
pnpm exec vitest run --silent \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts
```

预期：FAIL，旧实现仅保护 terminal，Builder 仍按普通 intermediate 删除。

- [ ] 4. 实现一个内部纯 API，并保持它不从 barrel 导出。

```ts
export interface MigrationDiagnosticRetentionPlan {
  readonly protectedSequences: ReadonlySet<number>
  readonly removableSequences: readonly number[]
}

export function createMigrationDiagnosticRetentionPlan(
  attempts: readonly MigrationDiagnosticsAttempt[]
): MigrationDiagnosticRetentionPlan
```

信息等级固定为：结构事实 2；non-unknown failed/unavailable/warning 1；普通生命周期 0。同级选择最后一个作为 protected cause，以保留最靠近 terminal 的 owner fact；删除时保持原 sequence 升序。

- [ ] 5. Coordinator 的 200-event 与 1 MiB 两轮裁剪都只消费 `removableSequences`；若 protected 最小集合本身越界，继续抛固定 size-limit error，不降级删除因果事实。

- [ ] 6. Builder 改用同一策略决定 event 裁剪，不在 Builder 推断 scenario、code 含义或 raw root cause。

- [ ] 7. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 8. 提交。

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "refactor(migration-diagnostics): centralize causal retention"
```

## 任务 3：升级 journal 与路径契约

**文件：**

- 新建：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsV1Schemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsJournal.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`
- 修改：`src/main/data/migration/v2/core/MigrationPaths.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsJournal.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts`
- 修改：`src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts`
- 修改：本计划“定向测试更新”中列出的全部 `MigrationPaths` fixture。

- [ ] 1. 先写失败测试：active 文件名是 `migration-diagnostics-v2.json`，legacy 文件名是 `migration-diagnostics-v1.json`；v2 存在时不读 v1；v2 不存在且 v1 有效时原子写 v2 后删除 v1。

- [ ] 2. 写兼容失败测试：v1 arbitrary migrator ID 转成 `unknown`；旧 versionGate 转成 `directorySelectionRole: 'unknown'` 与 unknown count buckets；v1 不生成 semantic evidence；invalid/oversized v1 被 quarantine 且任何 canary 不进入 v2。

- [ ] 3. 运行：

```bash
pnpm exec vitest run --silent \
  src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsJournal.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts
```

预期：FAIL，路径仍为 v1 且 reader 只接受当前 schema。

- [ ] 4. 给 `MigrationPaths` 增加明确的两个字段，所有 fixture 使用同样的固定文件名。

```ts
readonly diagnosticsJournalFile: string
readonly legacyDiagnosticsJournalFile: string
```

- [ ] 5. 冻结 v1 schema，只包含已发布 v1 字段。实现 `upgradeMigrationDiagnosticsV1Session`，逐字段 allowlist copy；不通过对象 spread 携带未知键。转换后的 session 必须再次由 v2 schema parse。

- [ ] 6. Coordinator attach 顺序实现为：read v2；仅在 v2 `none` 时 read v1；valid v1 → write v2 → cleanup v1；corrupt v1 → quarantine v1 → write fresh v2。保留现有 recovered attempt close 行为。

- [ ] 7. 更新 quarantine 测试的文件名断言，使 v1/v2 都从传入 basename 派生，不放宽“两份、七天、regular file”规则；journal 上限仍是 1,048,576 bytes。

- [ ] 8. 重跑上述测试；再定向跑所有改动过 fixture 的测试文件，预期 PASS。

```bash
pnpm exec vitest run --silent \
  src/main/data/migration/v2/core/__tests__/MigrationDbService.integration.test.ts \
  src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.process.integration.test.ts
```

- [ ] 9. 提交。

```bash
git add src/main/data/migration/v2 src/main/core/preboot/__tests__/v2MigrationGate.test.ts
git commit --signoff -m "feat(migration-diagnostics): upgrade journal contract to v2"
```

## 任务 4：发布 v2 严格 ZIP 并提高到 2 MiB

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticBundleSchemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts`

- [ ] 1. 写失败测试：manifest/events `formatVersion` 为 2，database 仍为 1；四个 entry 名称和顺序不变；event projection 保留 strict `semanticEvidence` 与新版 `versionGate`，仍剔除 session/attempt 原始 ID。

- [ ] 2. 给预算判断写 exact-boundary 失败测试：`2_097_152` 返回可接受，`2_097_153` 返回超限；Builder 的最终 publish 仍以四个 uncompressed buffer 的总和为准，不看压缩后 ZIP 大小。

- [ ] 3. 运行：

```bash
pnpm exec vitest run --silent \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts
```

预期：FAIL，旧输出仍为 format 1、1 MiB，且 projection 不认识 semantic evidence。

- [ ] 4. 把 `MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES` 改为 `2_097_152`。`createBundleEvent` 逐字段复制 `semanticEvidence`/`versionGate`，不复制 raw error、path、message、stack 或任意 unknown field。

- [ ] 5. manifest/events schema 改为 literal 2；database schema与 `MIGRATION_DATABASE_DIAGNOSTIC_VERSION` 不变；README 明确“privacy-minimized metadata、四项、2 MiB、local-only/no automatic upload”。

- [ ] 6. 保持预算次序：先用共用策略删除 ordinary/extra causal，protected cause/terminal 不删；再沿用 database detail omission。任何仍超限的输入返回固定失败且不发布 partial ZIP。

- [ ] 7. 把 acceptance fixture 的 session 改为 version 2，并为所有新字段提供 fixed 值；保留现有 Agents L2 外键回归与无 version.log 回归。

- [ ] 8. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 9. 提交。

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(migration-diagnostics): publish v2 support bundles"
```

## 任务 5：让 renderer/Main 在真实操作边界报告失败

**文件：**

- 新建：`src/renderer/windows/migrationV2/exporters/RendererExportError.ts`
- 新建：`src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts`
- 新建：`src/main/data/migration/v2/window/rendererExportDiagnostics.ts`
- 修改：`src/renderer/windows/migrationV2/exporters/{ReduxExporter,DexieExporter,LocalStorageExporter,index}.ts`
- 修改：`src/renderer/windows/migrationV2/MigrationApp.tsx`
- 修改：`src/shared/data/migration/v2/types.ts`
- 修改：`src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- 修改：`src/main/core/preboot/v2MigrationGate.ts`
- 修改：`src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`
- 修改：`src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`
- 修改：`src/main/core/preboot/__tests__/v2MigrationGate.test.ts`

- [ ] 1. 先写 exporter 失败测试：实际让 Redux `getItem`/root `JSON.parse`、Dexie open/read/serialize/write、LocalStorage read/serialize/write 抛错；断言捕获 `RendererExportError.report` 的 fixed role，原始 canary 只存在于 `cause`/display message。

- [ ] 2. 写 `MigrationApp` 失败测试：exporter error 调用 `ReportError(message, report)`；`actions.startMigration` rejection 只更新 UI/log，不调用 `ReportError`；`actions.start` rejection 也不伪装成 exporter failure。

- [ ] 3. 写 Main IPC 失败测试：含额外字段或非法组合的 report 整体替换为 `{sourceRole:'unknown', operationRole:'unknown'}`；display message 不传入 capability；`WriteExportFile` 的 ENOSPC/EACCES 分类按同 generation 绑定并覆盖 renderer 的 write report；StartMigration 清除旧 generation 分类。

- [ ] 4. 运行：

```bash
pnpm exec vitest run --silent \
  src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts \
  src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx \
  src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts \
  src/main/core/preboot/__tests__/v2MigrationGate.test.ts
```

预期：FAIL，当前 exporter 无 typed report，IPC capability 无参数。

- [ ] 5. 实现 renderer 私有错误。`message` 使用原始 Error message 供当前 UI/log；diagnostic report 只由严格 schema parse 后保存。

```ts
export class RendererExportError extends Error {
  readonly report: MigrationRendererExportFailureReport

  constructor(report: MigrationRendererExportFailureReport, cause: unknown) {
    const runtimeCause = cause instanceof Error ? cause : new Error(String(cause))
    super(runtimeCause.message, { cause: runtimeCause })
    this.name = 'RendererExportError'
    this.report = migrationRendererExportFailureReportSchema.parse(report)
  }
}
```

- [ ] 6. 每个 exporter 在它拥有的最小边界包装错误。Redux slice 单项 parse 保持现有 nonfatal fallback；只有 root parse 是 `redux/parse`。传给 `WriteExportFile` 的额外参数只允许 `dexie | local_storage` source role。

- [ ] 7. `MigrationApp.runMigration` 分三段 catch：`actions.start`、renderer exporters、`actions.startMigration`。只有第二段向 `ReportError` 发送 display message + strict report；未知 renderer error 使用完整 unknown fallback。

- [ ] 8. Main registration state增加同-generation write failure：固定 source role、`operationRole:'write'` 与 `classifyMigrationError` 结果。`rendererExportDiagnostics.ts` 输出 `MigrationDiagnosticEventInput`；若有同-generation Main write fact则优先，否则只把 `redux/parse` 映射为 `source_parse/source`，其余安全降级 unknown。

- [ ] 9. `MigrationIpcDiagnosticCapabilities.reportRendererExportFailure` 只接收 fixed terminal input，不接收 message/error/path；v2 gate直接将其交给 Coordinator `finishAttempt`，不再次推断。

- [ ] 10. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 11. 提交。

```bash
git add src/shared/data/migration/v2 src/renderer/windows/migrationV2 src/main/data/migration/v2/window src/main/core/preboot
git commit --signoff -m "feat(migration-diagnostics): report renderer export owners"
```

## 任务 6：从 MCP prepare 事实源报告缺失 source ID

**文件：**

- 修改：`src/main/data/migration/v2/migrators/BaseMigrator.ts`
- 修改：`src/main/data/migration/v2/migrators/McpServerMigrator.ts`
- 修改：`src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts`

- [ ] 1. 在现有“filter out servers without id”和“all skipped”用例中先加入失败断言：只调用一次 `recordEvent`；bucket 分别为 `2-10`；event 固定绑定 prepare/warning/source/mcp_server；既有 warnings/result 完全不变。

- [ ] 2. 加 1 与 11 条缺失 ID 的 table test，期望 bucket 为 `1` 与 `11+`；duplicate/transform skip 不计入这个 bucket；诊断 sink 抛错时 prepare 结果仍与未抛错时相同。

- [ ] 3. 运行：

```bash
pnpm exec vitest run --silent src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts
```

预期：FAIL，当前只有 `skippedCount`，没有 aggregate event。

- [ ] 4. 在 `BaseMigrator` 增加 protected best-effort `recordDiagnosticEvent(ctx, input)`，固定日志为 `Failed to record bounded migration diagnostics`；把已有 diagnosed write 调用改为复用它，但不改变其 event 内容。

- [ ] 5. MCP 增加 `missingIdCount` 并在 `reset()` 清零；只在 `!s.id || typeof s.id !== 'string'` 分支递增。循环完成后调用一次 fixed warning；在 early failure return 前也调用，确保全缺失场景有证据。

- [ ] 6. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 7. 提交。

```bash
git add src/main/data/migration/v2/migrators/BaseMigrator.ts src/main/data/migration/v2/migrators/McpServerMigrator.ts src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts
git commit --signoff -m "feat(mcp-migration): report missing source identifiers"
```

## 任务 7：从 Unique Model ID owner 报告非法 ID

**文件：**

- 新建：`src/shared/data/types/__tests__/model.test.ts`
- 修改：`src/shared/data/types/model.ts`
- 修改：`src/main/data/migration/v2/migrators/ProviderModelMigrator.ts`
- 修改：`src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts`

- [ ] 1. 先写 shared unit 失败测试，覆盖四个 violation；断言 `createUniqueModelId` 仍抛与当前完全相同的 message，valid ID 输出不变，validator 不暴露实际字符/ID到 violation 对象。

- [ ] 2. 写 Provider 实际 execute 失败测试：model ID 带 `?`，通过真实 `transformModel` 触发；结果仍为原来的 execute failure；诊断只包含 `model_id/contains_reserved_route_character`，不含 provider/model ID canary。

- [ ] 3. 运行：

```bash
pnpm exec vitest run --silent \
  src/shared/data/types/__tests__/model.test.ts \
  src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts
```

预期：FAIL，owner 只抛普通 Error，migrator 只能得到 unknown。

- [ ] 4. 在 shared owner 定义严格 violation 与 typed error；validator 按现有规则顺序返回第一项；`createUniqueModelId` 调用 validator 并从 violation 生成现有 message。reserved character 只用于 message，不进入 violation 字段。

```ts
export type UniqueModelIdViolation =
  | { readonly identifierRole: 'provider_id'; readonly rule: 'empty' | 'contains_separator' }
  | { readonly identifierRole: 'model_id'; readonly rule: 'empty' | 'contains_reserved_route_character' }
```

- [ ] 5. Provider execute catch 在包装 phase error 前检查 `UniqueModelIdValidationError`；通过 BaseMigrator helper 记录一个 fixed execute/failed event，然后继续现有 `capturePhaseFailure`、cleanup、error formatting，不能吞掉或替换原失败。

- [ ] 6. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 7. 提交。

```bash
git add src/shared/data/types/model.ts src/shared/data/types/__tests__/model.test.ts src/main/data/migration/v2/migrators/ProviderModelMigrator.ts src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts
git commit --signoff -m "feat(provider-model-migration): report invalid identifiers"
```

## 任务 8：保留目录选择与 version.log 解析事实

**文件：**

- 新建：`src/main/data/migration/v2/diagnostics/migrationVersionGateDiagnostics.ts`
- 修改：`src/main/data/migration/v2/core/versionPolicy.ts`
- 修改：`src/main/data/migration/v2/core/MigrationPaths.ts`
- 修改：`src/main/core/preboot/v2MigrationGate.ts`
- 修改：`src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts`
- 修改：`src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts`
- 修改：`src/main/core/preboot/__tests__/v2MigrationGate.test.ts`

- [ ] 1. 先写 versionPolicy 失败测试：missing、read_failed、空文件 parsed 0/0、一个有效、两个以上有效/无效混合；valid record 必须是非空六段且 semver 合法，previousVersion 是最后一个不同于 current 的 valid record。

- [ ] 2. 给 selection matrix 每个 A0/A1/B1/B2/B3/B4 断言 role：A0 current；boot config boot_config；A1 legacy_exact；B1 legacy_fuzzy_eligible；B2 legacy_fuzzy_blocked；未选中旧目录的 B3/B4 default。A1 映射到当前路径仍返回 legacy_exact role。

- [ ] 3. 写 gate 失败测试：block event 使用同一次 `evaluateCandidateVersion` 返回的 summary 与 `resolveMigrationPaths` role；不额外读 version.log；raw line/path canary 不进入 event。

- [ ] 4. 运行：

```bash
pnpm exec vitest run --silent \
  src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts \
  src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts \
  src/main/core/preboot/__tests__/v2MigrationGate.test.ts
```

预期：FAIL，当前 evaluation 只有 boolean exists，selection 结果会折叠 role。

- [ ] 5. 把版本读取实现为一次 I/O 返回：

```ts
export interface CandidateVersionEvaluation {
  readonly check: VersionCheckResult
  readonly previousVersion: string | null
  readonly versionLogExists: boolean
  readonly versionLog: MigrationVersionLogSummary
}
```

`readPreviousVersion` 保留公共行为以避免旁支回归，但内部复用同一个 parser；`evaluateCandidateVersion` 不得 read 两次。

- [ ] 6. `SelectionResult` 每个 branch 加 `directorySelectionRole`，`MigrationPathsResult` 向 gate 暴露最终 role。boot-config short circuit 在 resolver 直接标记，不伪造成 legacy exact。

- [ ] 7. `migrationVersionGateDiagnostics.ts` 是唯一 context assembler：接收 block reason/details、normalized current/previous、directory role、versionLog summary；只输出 strict safe enum/version/bucket。v2 gate 不再用旧的 coarse `versionLogExists` 自行拼装。

- [ ] 8. 在 gate test 建一个 `candidateEvaluation(overrides)` helper，统一补齐新版 `versionLog`，再逐个保留原 test 意图，避免散落不完整 mock。

- [ ] 9. 重跑任务测试，预期 PASS；执行 `git diff --check`。

- [ ] 10. 提交。

```bash
git add src/main/data/migration/v2/core src/main/data/migration/v2/diagnostics/migrationVersionGateDiagnostics.ts src/main/core/preboot/v2MigrationGate.ts src/main/core/preboot/__tests__/v2MigrationGate.test.ts
git commit --signoff -m "feat(migration-version): preserve selection evidence"
```

## 任务 9：以代表性真实 owner 场景验证到 ZIP

**文件：**

- 新建：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticSemanticEvidence.integration.test.ts`
- 新建：`src/renderer/windows/migrationV2/__tests__/MigrationRendererDiagnosticAcceptance.integration.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts`

- [ ] 1. 先建立只供测试的 `saveJournalAndReadStrictZip` helper：Coordinator 必须 attach 临时 `MigrationPaths`、owner 自己 record、Builder `save`、node-stream-zip 解压、三个 JSON schema parse。helper 不接收预制的 expected evidence event。

- [ ] 2. 写实际 Redux UnknownError 场景：让 `localStorage.getItem` 抛带 path/token canary 的 Error；从 `RendererExportError.report` 经 production strict parser/terminal assembler 进入 Coordinator；断言 journal 与 ZIP 只有 `redux/read` 和 unknown classification。

- [ ] 3. 写实际 MCP missing-ID 场景：调用 `McpServerMigrator.prepare`，sink 直接连接 Coordinator；断言原 warning 保留、只有一个 aggregate event、ZIP bucket 正确，MCP name/ID/env canary 不存在。

- [ ] 4. 写 MCP CHECK 当前 schema probe：用 `setupTestDatabase()` 与 production migration，运行实际 transform/execute/validate；断言当前支持的 MCP type 不产生 CHECK/constraint failure。若测试意外复现 CHECK，立即停止任务并先修订设计规格；不得直接加 production evidence branch。

- [ ] 5. 写实际 Provider `?` 场景：用 `setupTestDatabase()`、actual prepare/execute；owner event 经 Coordinator 到 ZIP；断言迁移仍失败且 provider/model canary、`?`、raw message、SQLite/SQL 不进入 journal/ZIP。

- [ ] 6. 写实际版本差异场景：临时 `version.log` 同时含 current、旧 valid、invalid line；调用 actual selection/evaluation/context assembler；断言 selection role、parsed buckets 与 selected previous version正确，raw line/path 不进入 journal/ZIP。

- [ ] 7. 保留并重跑现有 Agents real-database L2 foreign-key regression 与 no-version-log regression；不要把它们改成直接构造最终 evidence 的薄测试。

- [ ] 8. 每个场景分别把 Unix path、Windows path、bearer token、MCP name/ID、Provider/Model ID、SQL、constraint 与 stack canary 放在原始 source/error；依次检查 persisted journal、每个 extracted entry、builder result。

- [ ] 9. 运行：

```bash
pnpm exec vitest run --silent \
  src/renderer/windows/migrationV2/__tests__/MigrationRendererDiagnosticAcceptance.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticSemanticEvidence.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts
```

预期：第一次 FAIL，直到真实 owner 链路和 canary 断言全部接通；完成后 PASS。

- [ ] 10. 提交。

```bash
git add src/main/data/migration/v2/diagnostics/__tests__ src/renderer/windows/migrationV2/__tests__
git commit --signoff -m "test(migration-diagnostics): exercise semantic owners to zip"
```

## 任务 10：定向回归、格式和交付核对

- [ ] 1. 一次性运行全部受影响的定向测试；不得把命令替换为目录级或全量 `pnpm test`。

```bash
pnpm exec vitest run --silent \
  src/shared/data/migration/v2/__tests__/diagnostics.test.ts \
  src/shared/data/types/__tests__/model.test.ts \
  src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts \
  src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx \
  src/renderer/windows/migrationV2/__tests__/MigrationRendererDiagnosticAcceptance.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsJournal.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticSemanticEvidence.integration.test.ts \
  src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts \
  src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts \
  src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts \
  src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts \
  src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts \
  src/main/core/preboot/__tests__/v2MigrationGate.test.ts
```

- [ ] 2. 运行非测试检查。`pnpm lint` 会执行 typecheck、i18n check 和 format check；如它写入文件，核对这些文件都在本任务范围。

```bash
pnpm lint
pnpm format
pnpm docs:check-links
git diff --check
```

预期：全部 exit 0。允许报告仓库已有 warning，但不得新增 error。

- [ ] 3. 显式证明边界：

```bash
git diff --name-only origin/codex/migration-diagnostics-strict...HEAD
git grep -nE "rawError|stack|sql|constraintName|Record<string, unknown>" -- \
  src/main/data/migration/v2/diagnostics \
  src/shared/data/migration/v2/diagnostics.ts
```

逐条审查 grep 命中：既有 SQL/database internals 可存在于收集器实现，但任何新增 journal/bundle/report schema 不得接收自由 context 或 prohibited 字段。

- [ ] 4. 检查 git 状态与提交历史；若 formatter 产生任务内变更，单独提交。

```bash
git status --short --branch
git log --oneline --decorate -10
```

确认 `git status --short` 中只剩本计划列出的任务内文件后，逐个 stage 这些文件并执行：

```bash
git commit --signoff -m "chore(migration-diagnostics): finalize strict verification"
```

仅在确有未提交的 formatter/docs 变更时执行最后这个 commit；工作树已 clean 时跳过，且不得 broad-stage 不相关文件。

- [ ] 5. 最终交付必须列出所有实际运行的定向 Vitest 文件、`pnpm lint`、`pnpm format`、`pnpm docs:check-links`，并明确说明按用户要求未运行全量 `pnpm test` 与会间接运行它的 `pnpm build:check`。

## 计划自检清单

- [ ] 设计的三类 semantic evidence 均有 owner、strict schema、IPC/Coordinator 路径和 ZIP 验收。
- [ ] version evidence 只扩展 `versionGate`，没有新增重复 semantic branch。
- [ ] renderer message/raw cause 与 fixed report 在类型和调用参数上分离。
- [ ] MCP missing ID 与 duplicate/transform skip 分开计数，迁移行为不变。
- [ ] Provider 所有四个规则由 shared owner 定义，migrator 不复制字符规则。
- [ ] v1 journal 只在 v2 不存在时读取；无旧 ZIP converter。
- [ ] journal 1 MiB、ZIP 2 MiB、四 entries、五 attempts、200 events 全部被定向测试锁定。
- [ ] causal retention 不含 scenario 名称，Coordinator/Builder 共用实现。
- [ ] 5.5 只是代表性验收子集；生产代码按 owner/invariant 泛化。
- [ ] 没有 UI、日志 ZIP、自动上传、遥测、IpcApi 迁移或未证实 MCP CHECK 分支。
- [ ] 没有全量测试命令。
