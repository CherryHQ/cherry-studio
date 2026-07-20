# v1 → v2 迁移诊断精简实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不改变 v1 → v2 迁移顺序、事务、重试和既有 UI/交互的前提下，把当前严格诊断收缩为只记录真实阻塞失败的最小 checkpoint、两文件 ZIP、一次性 SQLite 检查和 native/renderer 保存链路。

**架构：** 失败事实只由版本门禁、renderer exporter、`MigrationEngine` 阶段边界、`BaseMigrator` 失败写入包装器和 renderer 进程事件产生；`MigrationDiagnosticsCoordinator` 只保存上一条失败/中断摘要与当前尝试。保存时主进程先做无 native 的文件/header 检查，再让一次性只读子进程返回一个 SQLite 结果，最后由 `archiver` 经仓库的 `createAtomicWriteStream()` 生成仅含 `migration-diagnostics.json` 与 `README.txt` 的 ZIP。

**技术栈：** TypeScript、Zod、Electron IPC/BrowserWindow、React、Vitest 3、better-sqlite3/Drizzle、archiver、node-stream-zip、`setupTestDatabase()`。

---

## 实施边界

- 当前分支固定为 `codex/migration-diagnostics-simplified`，以严格诊断分支现有 UI/交互和迁移修复为基线，禁止整体 reset 到诊断前提交。
- 不运行 `pnpm test`；不运行会间接执行全量测试的 `pnpm build:check`。
- 运行每个任务列出的定向 Vitest、最终 `pnpm lint`、`pnpm format`、`pnpm docs:check-links` 和 `git diff --check`。
- SQLite service/handler/验收测试使用 `setupTestDatabase()` 与生产 migration；不手写 `CREATE TABLE`，不 stub Drizzle 链。专门的损坏文件/header 测试可以复制或破坏测试数据库副本。
- 不新增 migration IPC 范式，不把 legacy migration IPC 改成 IpcApi。
- 不采集日志、原始错误、stack、SQL、路径、文件名、记录 ID、名称、值、credential、URL、命令、环境变量或内容 hash。
- 不新增 UI 组件或样式；保留诊断面板、已保存操作、version-incompatible 页面宽度/按钮、保存期间禁用、native 对话框、renderer crash/unresponsive 单次 claim。
- checkpoint、SQLite 子进程和 ZIP 保存失败只影响诊断可用性，绝不能覆盖原迁移结果或成为迁移根因。
- 每次提交前执行 `git status --short`，提交使用 Conventional Commit、具体 scope 和 `--signoff`。

## 仓库既有实践与取舍

- 复用 `MigrationEngine` 已有 initialize/prepare/execute/validate/finalize 控制流；不在 migrator 之外推断阶段。
- 复用 `BaseMigrator` 已有“原始 native error 尚在作用域内”的捕获点；删除向 `MigrationContext` 直接发事件的重复通道。
- 复用 `MigrationWindowManager` 的 `render-process-gone`、`unresponsive`、write waiter 和 failure claim。
- 复用 `presentMigrationDiagnosticFailure()`、`presentMigrationDiagnosticRecovery()`、renderer 保存/Reveal/Email/Copy 交互和本地化文案。
- 复用 `MigrationPaths` 作为所有路径的唯一所有者，保留一个 `diagnosticsJournalFile`，删除 legacy journal path。
- 复用 `archiver` 与 `src/main/utils/file/fs.ts` 的 `createAtomicWriteStream()`；不保留手写 ZIP header/CRC/reopen 校验。
- 复用 `?modulePath` 产出独立 SQLite child asset，因此保留 `electron.vite.config.ts` 的单 input/CJS 配置；删除的只是 L0/L1/L2 协议、ready handshake 和 lease。
- 取舍：checkpoint 不再给出阶段内时间线；SQLite child hang 时只返回 `unavailable`；开发期旧 ZIP/journal 不兼容。这三项换取更小、更可证明且不影响业务数据的实现。

## 文件与职责

### 新建

- `src/renderer/windows/migrationV2/exporters/RendererExportError.ts`：renderer 私有 tagged error，只携带固定 `sourceRole`/`operationRole`，保留原 cause 供日志使用但不跨 IPC。
- `src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts`：对 Redux、Dexie、localStorage 的真实 read/open/parse/serialize/write owner 进行定向测试。

### 精简保留

- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`：唯一 checkpoint/failure/location/evidence 严格合同。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticBundleSchemas.ts`：唯一 `migration-diagnostics.json` 严格 schema。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsJournal.ts`：1 MiB 上限、原子写、最多两个隔离文件；无版本升级。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`：previous/current、location、terminal failure、warning count、冻结 snapshot 和 save serialization。
- `src/main/data/migration/v2/diagnostics/migrationErrorClassifier.ts`：只从原始 errno/SQLite code/cause 链映射固定 code。
- `src/main/data/migration/v2/diagnostics/payloadLengthProfiler.ts`：失败后才测一个固定 role 的 string/json/blob 长度；无对象遍历矩阵。
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsSchemas.ts`：main file/header 结果与 one-shot child 最终结果。
- `src/main/data/migration/v2/diagnostics/MigrationDatabaseDiagnostics.ts`：main L0、一次 child、一个 timeout、一个 final message。
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts`：read-only open、`quick_check`、`foreign_key_check`、固定关键表/列检查、一次 `process.send()`。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`：严格 parse、两条 entry、1 MiB、archiver + atomic stream、统一 `bundle_save_failed`。
- `src/main/data/migration/v2/diagnostics/index.ts` 与 `src/main/data/migration/v2/migrationDiagnostics.ts`：只显式导出精简后的公共 API。

### 集成修改

- `src/shared/data/migration/v2/diagnostics.ts`：严格 renderer failure report 与 IPC payload schema/type。
- `src/shared/data/migration/v2/types.ts`：保存失败 code 收敛为 `dialog_failed | snapshot_failed | bundle_save_failed | save_in_progress`。
- `src/shared/data/types/model.ts`：Unique Model ID 错误增加固定 violation role/rule，保持原消息与抛错行为。
- `src/shared/utils/__tests__/model.test.ts`：Unique Model ID 固定 violation 与原成功/失败行为测试。
- `src/main/data/migration/v2/core/MigrationPaths.ts`：只保留 `diagnosticsJournalFile`。
- `src/main/data/migration/v2/core/MigrationContext.ts`：移除 migrator 可直接写诊断事件的 sink。
- `src/main/data/migration/v2/core/MigrationDbService.ts`：移除诊断 lease，恢复立即 close；保留原迁移数据库行为。
- `src/main/data/migration/v2/core/MigrationEngine.ts`：阶段开始只更新 location，阶段失败只提交一个 terminal failure；移除 DB lease 收集。
- `src/main/data/migration/v2/migrators/BaseMigrator.ts`：保留原始 native 分类与失败后长度测量，移除直接 event 记录。
- `src/main/data/migration/v2/migrators/AgentsMigrator.ts`
- `src/main/data/migration/v2/migrators/AssistantMigrator.ts`
- `src/main/data/migration/v2/migrators/BootConfigMigrator.ts`
- `src/main/data/migration/v2/migrators/ChatMigrator.ts`
- `src/main/data/migration/v2/migrators/FileMigrator.ts`
- `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`
- `src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`
- `src/main/data/migration/v2/migrators/McpServerMigrator.ts`
- `src/main/data/migration/v2/migrators/MiniAppMigrator.ts`
- `src/main/data/migration/v2/migrators/NoteMigrator.ts`
- `src/main/data/migration/v2/migrators/PaintingMigrator.ts`
- `src/main/data/migration/v2/migrators/PreferencesMigrator.ts`
- `src/main/data/migration/v2/migrators/PromptMigrator.ts`
- `src/main/data/migration/v2/migrators/ProviderModelMigrator.ts`
- `src/main/data/migration/v2/migrators/TranslateMigrator.ts`：删除 descriptor 常量/成功数据 profiling；保留 existing write wrapper，但改传固定 lazy value role；保留所有非诊断迁移修复。
- `src/main/data/migration/v2/window/MigrationIpcHandler.ts`：typed renderer report、main-owned export write 分类和原 UI message 分离。
- `src/main/data/migration/v2/window/MigrationWindowManager.ts`：保留现有进程失败处理，仅适配精简 failure API。
- `src/main/data/migration/v2/window/migrationDiagnosticDialogs.ts`：映射统一 bundle save failure；保留 native 决策与并发保护。
- `src/main/core/preboot/v2MigrationGate.ts`：精简 orchestrator、三种 gate block、recovery、migration/version window native fallback。
- `src/renderer/windows/migrationV2/exporters/{ReduxExporter,DexieExporter,LocalStorageExporter,index}.ts`：在真实 owner 边界抛 tagged error。
- `src/renderer/windows/migrationV2/MigrationApp.tsx`：export catch 发送 `{ message, report }`；main migration failure 不冒充 exporter failure；保留现有布局。
- `src/renderer/windows/migrationV2/i18n/locales.ts`：删除 archive/publish 两条文案，保留一条 `bundle_save_failed`。
- `electron.vite.config.ts`：只更新 child asset 注释，不改变当前可构建配置。
- `src/main/data/migration/v2/README.md` 与 `src/renderer/windows/migrationV2/README.md`：记录 failure-only 边界、两文件 ZIP、recovery 和 UI owner。

### 删除

- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsV1Schemas.ts`
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticRetention.ts`
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsLease.ts`
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsProtocol.d.mts`
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsProtocol.mjs`
- `src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts`
- `src/main/data/migration/v2/core/__tests__/MigrationDbService.integration.test.ts`：该文件只覆盖将被删除的 lease；原 `MigrationDbService` 行为继续由现有 engine/database 定向测试覆盖。

### 重写或定向更新的测试

- `src/shared/data/migration/v2/__tests__/diagnostics.test.ts`
- `src/shared/utils/__tests__/model.test.ts`
- `src/main/data/migration/v2/diagnostics/__tests__/{migrationDiagnosticsSchemas,migrationDiagnosticsJournal,MigrationDiagnosticsCoordinator,migrationErrorClassifier,payloadLengthProfiler}.test.ts`
- `src/main/data/migration/v2/diagnostics/__tests__/{migrationDatabaseDiagnosticsSchemas,MigrationDatabaseDiagnostics,MigrationDatabaseDiagnostics.integration,MigrationDatabaseDiagnostics.process.integration,migrationDatabaseDiagnosticsBarrel}.test.ts`
- `src/main/data/migration/v2/diagnostics/__tests__/{MigrationDiagnosticBundleBuilder,MigrationDiagnosticBundleBuilder.integration,MigrationDiagnosticAcceptance.integration}.test.ts`
- `src/main/data/migration/v2/diagnostics/__tests__/fixtures/{migrationDiagnosticAcceptanceFixtures,nativeSqliteHangChild.mjs}`
- `src/main/data/migration/v2/core/__tests__/{MigrationPaths,MigrationEngine}.test.ts`
- `src/main/data/migration/v2/migrators/__tests__/{BaseMigrator,AgentsMigrator,McpServerMigrator,ProviderModelMigrator,KnowledgeVectorMigrator}.test.ts`
- `src/main/data/migration/v2/window/__tests__/{MigrationIpcHandler,MigrationWindowManager,migrationDiagnosticDialogs,migrationDiagnosticNativeI18n}.test.ts`
- `src/main/core/preboot/__tests__/v2MigrationGate.test.ts`
- `src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`
- `src/renderer/windows/migrationV2/components/__tests__/{MigrationDiagnosticsSavedActions,MigrationWindowControls}.test.tsx`

## 任务 1：锁定最小 failure、checkpoint 与 renderer 合同

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationErrorClassifier.ts`
- 修改：`src/shared/data/migration/v2/diagnostics.ts`
- 修改：`src/shared/data/migration/v2/types.ts`
- 修改测试：`src/main/data/migration/v2/diagnostics/__tests__/{migrationDiagnosticsSchemas,migrationErrorClassifier}.test.ts`
- 修改测试：`src/shared/data/migration/v2/__tests__/diagnostics.test.ts`

- [ ] **步骤 1：先写闭集合同失败测试。** 穷举 9 个 `failureKind`、三种 gate reason、合法 renderer source/operation 组合、严格 evidence 分支；断言额外字段、任意 migrator ID、raw error、path、SQL、stack 和错误 evidence/failureKind 配对全部被拒绝。

```ts
const FAILURE_KINDS = [
  'upgrade_path_blocked',
  'preboot_failed',
  'renderer_export_failed',
  'source_prepare_failed',
  'migration_write_failed',
  'migration_invariant_failed',
  'migration_validation_failed',
  'migration_finalize_failed',
  'process_interrupted'
] as const

const legalRendererOperations = {
  redux: ['read', 'parse'],
  dexie: ['open', 'read', 'serialize', 'write'],
  local_storage: ['read', 'serialize', 'write'],
  unknown: ['unknown']
} as const
```

- [ ] **步骤 2：写 classifier 失败测试。** 用只含 own data property 的 error/cause fixture 覆盖 `SQLITE_CANTOPEN*`、`CORRUPT`、`NOTADB`、`SCHEMA`、`CONSTRAINT*`、`READONLY*`、`TOOBIG`、`BUSY`、`LOCKED`、`IOERR*`、`ENOENT`、`EACCES`、`EPERM`、`EROFS`、`EIO` 和未知对象；断言 getter 不会被执行、cause 最多 4 层、输出没有 message。

- [ ] **步骤 3：运行测试确认旧事件/类别/descriptor 合同失败。**

```bash
pnpm exec vitest run --project shared src/shared/data/migration/v2/__tests__/diagnostics.test.ts
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts src/main/data/migration/v2/diagnostics/__tests__/migrationErrorClassifier.test.ts
```

预期：FAIL，旧 schema 仍要求 event timeline/version 2，classifier 缺少 busy/locked/I/O/只读映射，保存结果仍暴露 archive/publish 两个 code。

- [ ] **步骤 4：用严格 discriminated unions 实现合同。** 最终公共 shape 固定为以下形式；Zod 的所有 object 使用 `.strict()`，所有 string/count/array 明确上限。

```ts
export const migrationDiagnosticLocationSchema = z.object({
  scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database']),
  phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'interrupted']),
  migratorId: migrationDiagnosticMigratorIdSchema.optional()
}).strict()

export const migrationDiagnosticAppMetadataSchema = z.object({
  version: z.union([z.literal('unknown'), z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)]),
  platform: z.enum(['darwin', 'win32', 'linux', 'other']),
  arch: z.enum(['x64', 'arm64', 'ia32', 'other'])
}).strict()

export const migrationDiagnosticAttemptSchema = z.discriminatedUnion('status', [
  z.object({ trigger: migrationAttemptTriggerSchema, status: z.literal('in_progress'), startedAt: z.string().datetime(), lastLocation: migrationDiagnosticLocationSchema }).strict(),
  z.object({ trigger: migrationAttemptTriggerSchema, status: z.literal('completed'), startedAt: z.string().datetime(), endedAt: z.string().datetime(), lastLocation: migrationDiagnosticLocationSchema, warningCountBucket: z.enum(['0', '1', '2-10', '11+']) }).strict(),
  z.object({ trigger: migrationAttemptTriggerSchema, status: z.literal('failed'), startedAt: z.string().datetime(), endedAt: z.string().datetime(), lastLocation: migrationDiagnosticLocationSchema, failure: migrationDiagnosticFailureSchema }).strict(),
  z.object({ trigger: migrationAttemptTriggerSchema, status: z.literal('interrupted'), startedAt: z.string().datetime(), endedAt: z.string().datetime(), lastLocation: migrationDiagnosticLocationSchema, failure: processInterruptedFailureSchema }).strict()
])

export const migrationDiagnosticFinishedAttemptSchema = z.union([
  migrationDiagnosticAttemptSchema.options[1],
  migrationDiagnosticAttemptSchema.options[2],
  migrationDiagnosticAttemptSchema.options[3]
])

export const migrationDiagnosticsCheckpointSchema = z.object({
  formatVersion: z.literal(1),
  app: migrationDiagnosticAppMetadataSchema,
  state: z.enum(['active', 'failed', 'completed']),
  previous: migrationDiagnosticFinishedAttemptSchema.optional(),
  current: migrationDiagnosticAttemptSchema.optional()
}).strict()

export type MigrationDiagnosticFailure = z.infer<typeof migrationDiagnosticFailureSchema>
export type ProcessInterruptedFailure = Extract<MigrationDiagnosticFailure, { kind: 'process_interrupted' }>
export type MigrationDiagnosticFailureEvidence = NonNullable<MigrationDiagnosticFailure['evidence']>

export type MigrationAttemptFinish =
  | { status: 'completed'; warningCount: number }
  | { status: 'failed'; failure: MigrationDiagnosticFailure }
  | { status: 'interrupted'; failure: ProcessInterruptedFailure }

export type MigrationDiagnosticsSnapshot = Readonly<z.infer<typeof migrationDiagnosticsCheckpointSchema>>

export interface ClassifiedMigrationError {
  readonly errorCode: (typeof MIGRATION_FAILURE_ERROR_CODES)[number]
}
```

`migrationDiagnosticFailureSchema` 只允许设计文档列出的 9 个 kind；`errorCode` 只允许固定 SQLite/filesystem/source/validation/process/gate/preboot code；evidence 只允许 `version_gate | renderer_export | all_required_rows_rejected | failed_write | invariant | validation | interruption` 七个分支。`failed_write` 的 value 只允许固定 role、`string | json | blob`、非负 `byteLength` 和 `0 | 1-256 | 257-4096 | 4097-65536 | 65537-262144 | 262145+` bucket。

根因 code 的闭集固定为：

```ts
export const MIGRATION_FAILURE_ERROR_CODES = [
  'unknown_error',
  'sqlite_open_failed', 'sqlite_corrupt', 'sqlite_not_database', 'sqlite_schema',
  'sqlite_constraint', 'sqlite_readonly', 'sqlite_permission', 'sqlite_too_big',
  'sqlite_busy', 'sqlite_locked', 'sqlite_io', 'sqlite_unknown',
  'file_missing', 'file_permission', 'file_readonly', 'file_io', 'file_unknown',
  'source_read_failed', 'source_parse_failed', 'source_serialization_failed',
  'source_required_records_rejected', 'source_invalid_identifier',
  'validation_count_mismatch', 'validation_required_target_field',
  'validation_relation', 'validation_material', 'validation_vector',
  'validation_foreign_key', 'validation_status',
  'renderer_process_gone', 'renderer_unresponsive', 'process_interrupted',
  'no_version_log', 'v1_too_old', 'v2_gateway_skipped',
  'path_resolution_failed', 'legacy_data_location_unavailable',
  'data_location_pin_failed', 'database_initialize_failed',
  'migration_status_probe_failed', 'version_check_failed',
  'version_window_failed', 'migration_window_failed'
] as const
```

`database_diagnostics_timeout | database_diagnostics_child_exit | database_diagnostics_invalid_output` 只属于 `database.sqlite.reason`，不在根因 code enum 中；`bundle_save_failed` 只属于 save result。

绑定规则固定为：`version_gate` evidence 只配 `upgrade_path_blocked`，或配带 `version_window_failed` 的 `preboot_failed`；`renderer_export` 只配 `renderer_export_failed`；`all_required_rows_rejected` 只配 `source_prepare_failed`；`failed_write` 只配 `migration_write_failed`；`invariant` 只配 `migration_invariant_failed`；`validation` 只配 validation/finalize；`interruption` 只配 `process_interrupted`。schema test 对每个反向错误组合逐一断言拒绝。

- [ ] **步骤 5：收敛 renderer 与保存结果。** `migrationRendererExportFailureReportSchema` 保留合法 source/operation 配对；新增严格 IPC payload schema，message 只用于 UI，report 才能进入诊断。

```ts
export const migrationRendererExportFailurePayloadSchema = z.object({
  message: z.string().min(1).max(4_096),
  report: migrationRendererExportFailureReportSchema
}).strict()

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | { status: 'saved' }
  | { status: 'failed'; code: 'dialog_failed' | 'snapshot_failed' | 'bundle_save_failed' | 'save_in_progress' }
```

- [ ] **步骤 6：实现固定 classifier。** 只读取 `code`/`cause` own data property；不解析 message，不把 SQLite child timeout/exit 或 ZIP error 映射为迁移根因。

- [ ] **步骤 7：重跑任务测试并检查 diff。** 预期全部 PASS；`git diff --check` 无输出。

- [ ] **步骤 8：提交。**

```bash
git add src/shared/data/migration/v2 src/main/data/migration/v2/diagnostics
git commit --signoff -m "refactor(migration-diagnostics): define blocking failure contract"
```

## 任务 2：把五次/200 事件 journal 收缩为 previous/current checkpoint

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsJournal.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`
- 修改：`src/main/data/migration/v2/core/MigrationPaths.ts`
- 修改：`src/main/data/migration/v2/diagnostics/index.ts`
- 修改：`src/main/data/migration/v2/migrationDiagnostics.ts`
- 删除：`src/main/data/migration/v2/diagnostics/{migrationDiagnosticsV1Schemas,migrationDiagnosticRetention}.ts`
- 删除测试：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticRetention.test.ts`
- 修改测试：`src/main/data/migration/v2/diagnostics/__tests__/{migrationDiagnosticsJournal,MigrationDiagnosticsCoordinator}.test.ts`
- 修改测试：`src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts`

- [ ] **步骤 1：写 checkpoint 失败测试。** 覆盖 begin → location → failed、manual retry 时 current 下沉为 previous、第三次尝试只保留最近 previous、completed warning bucket、snapshot deep-freeze、并发保存返回 `save_in_progress`。

- [ ] **步骤 2：写恢复失败测试。** 有效 `in_progress` 在下次 attach 时变为 `process_interrupted`，evidence 的 `recoverySource` 固定为 `checkpoint`；旧 strict v2、旧 v1、损坏 JSON、超 1 MiB、非普通文件被隔离，business DB/path 不被改写。

- [ ] **步骤 3：写 non-interference 失败测试。** 注入 open/write/fsync/rename 失败，`beginAttempt()`、`updateLocation()`、`finishAttempt()` 不抛出，原迁移回调仍返回原结果，下一次 `snapshot()` 仍可使用内存事实但 `recovered` 为 false。

- [ ] **步骤 4：运行定向测试确认失败。**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsJournal.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts
```

预期：FAIL，旧实现仍出现 `attempts/events/sequence`、v1 → v2 upgrade 和 `legacyDiagnosticsJournalFile`。

- [ ] **步骤 5：保留 journal 的原子 primitive，删除兼容/retention。** 继续使用同目录 `.tmp`、`0600`、file fsync、rename 和 POSIX directory fsync；读取只接受 `migrationDiagnosticsCheckpointSchema`；隔离文件最多 2 个；所有 writer exception 在 coordinator 的 `persistBestEffort()` 内被吞掉并通过 `loggerService` 记录固定消息。

- [ ] **步骤 6：实现 coordinator 的窄 API。**

```ts
export class MigrationDiagnosticsCoordinator {
  readonly recovered: boolean
  attachPaths(paths: Pick<MigrationPaths, 'diagnosticsJournalFile'>): void
  beginAttempt(trigger: MigrationAttemptTrigger): void
  updateLocation(location: MigrationDiagnosticLocation): void
  finishAttempt(result: MigrationAttemptFinish): void
  snapshot(): Promise<MigrationDiagnosticsSnapshot>
  runSave<TResult>(save: (snapshot: MigrationDiagnosticsSnapshot) => Promise<TResult>): Promise<TResult | MigrationDiagnosticsSaveInProgress>
  complete(): void
}
```

`beginAttempt()` 只把最近 failed/interrupted current 下沉到 previous；`updateLocation()` 只替换一个 `lastLocation`；`finishAttempt()` 只写 terminal shape；`complete()` 删除 checkpoint 但保留内存中的 completed-with-warning snapshot 供当前页面保存。

- [ ] **步骤 7：从 `MigrationPaths` 删除 `legacyDiagnosticsJournalFile`。** 保留当前 `migration-diagnostics-v2.json` 文件名，使严格分支遗留文件能在同一路径被识别为 incompatible 并隔离；不要引入第二个 probe path。

- [ ] **步骤 8：删除 orphan export/test 并重跑任务测试。** 预期 PASS；执行 `rg -n "MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS|MIGRATION_DIAGNOSTICS_MAX_EVENTS|createMigrationDiagnosticRetentionPlan|upgradeMigrationDiagnosticsV1|legacyDiagnosticsJournalFile" src/main src/shared`，预期无输出。

- [ ] **步骤 9：提交。**

```bash
git add src/main/data/migration/v2
git commit --signoff -m "refactor(migration-diagnostics): simplify crash checkpoint"
```

## 任务 3：用 main L0 + 一次性只读 child 代替 L0/L1/L2 stream/lease

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsSchemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDatabaseDiagnostics.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts`
- 修改：`src/main/data/migration/v2/core/MigrationDbService.ts`
- 修改：`src/main/data/migration/v2/core/MigrationEngine.ts`
- 修改：`electron.vite.config.ts`
- 删除：`src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsLease.ts`
- 删除：`src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsProtocol.d.mts`
- 删除：`src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsProtocol.mjs`
- 删除测试：`src/main/data/migration/v2/core/__tests__/MigrationDbService.integration.test.ts`
- 修改测试：`src/main/data/migration/v2/diagnostics/__tests__/{migrationDatabaseDiagnosticsSchemas,MigrationDatabaseDiagnostics,MigrationDatabaseDiagnostics.integration,MigrationDatabaseDiagnostics.process.integration,migrationDatabaseDiagnosticsBarrel}.test.ts`

- [ ] **步骤 1：先写 schema 与 parent 失败测试。** 断言 main L0 只输出 existence/regular-file/size bucket/header/WAL/SHM booleans；child 只接受一个 `{ databaseFile }` input、只返回一个 final result；额外 message、partial level、ready handshake、路径泄漏被拒绝。

- [ ] **步骤 2：写真实 DB 失败测试。** 用 `setupTestDatabase()` 创建生产 schema，断言 `quick_check=ok`、FK violation bucket、以下固定表/列 role 全部 present：`app_state(key,value)`、`preference(scope,key,value)`、`user_provider(provider_id,name)`、`user_model(id,provider_id,model_id)`、`assistant(id,name,settings)`、`mcp_server(id,name,type)`、`topic(id,assistant_id)`、`message(id,topic_id,role,status)`、`file(id,origin,name)`、`knowledge_base(id,name,status)`、`knowledge_item(id,base_id,type,status)`。

- [ ] **步骤 3：写 timeout/exit/invalid-output 失败测试。** 复用 `nativeSqliteHangChild.mjs`，断言 child hang 被 kill 后 `sqlite.status='unavailable', reason='timeout'`；exit/invalid output 分别为 `child_exit`/`invalid_output`；main L0 仍保留且整体 inspect resolve，不 reject。

- [ ] **步骤 4：运行 native 定向测试。**

```bash
pnpm rebuild:node
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/migrationDatabaseDiagnosticsSchemas.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.process.integration.test.ts src/main/data/migration/v2/diagnostics/__tests__/migrationDatabaseDiagnosticsBarrel.test.ts
```

预期：FAIL，旧结果仍含 version/expectedSchemaVersion/completion/L0/L1/L2 和多 message 协议。

- [ ] **步骤 5：实现严格 one-shot schema。**

```ts
export const migrationDatabaseObjectCheckSchema = z.object({
  role: z.enum([
    'app_state', 'preference', 'user_provider', 'user_model', 'assistant',
    'mcp_server', 'topic', 'message', 'file', 'knowledge_base', 'knowledge_item'
  ]),
  status: z.enum(['present', 'missing_table', 'missing_columns']),
  missingColumnRoles: z.array(z.string().min(1).max(32)).max(4).optional()
}).strict()

export const migrationDatabaseSqliteResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), quickCheck: z.enum(['ok', 'failed']), foreignKeyViolationCountBucket: z.enum(['0', '1', '2-10', '11+']), objects: z.array(migrationDatabaseObjectCheckSchema).length(11) }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.enum(['not_attempted', 'open_failed', 'query_failed', 'timeout', 'child_exit', 'invalid_output']) }).strict()
])

export const migrationDatabaseDiagnosticResultSchema = z.object({
  file: z.object({
    status: z.enum(['missing', 'not_regular', 'readable', 'unreadable']),
    sizeBucket: z.enum(['0', '1-4095', '4096-1m', '1m-100m', '100m+']).optional(),
    sqliteHeader: z.enum(['valid', 'invalid', 'unavailable']),
    walPresent: z.boolean().optional(),
    shmPresent: z.boolean().optional()
  }).strict(),
  sqlite: migrationDatabaseSqliteResultSchema
}).strict()

export const migrationDatabaseDiagnosticsChildInputSchema = z.object({
  databaseFile: z.string().min(1).max(4_096)
}).strict()

export const migrationDatabaseDiagnosticsChildMessageSchema = z.object({
  type: z.literal('result'),
  result: migrationDatabaseSqliteResultSchema
}).strict()
```

- [ ] **步骤 6：实现 parent main L0。** `lstat`、最多 100-byte header read 和 sidecar `lstat` 在主进程完成；路径只传给 child stdin/IPC，不进入 result/log context；spawn 参数只含 module path，数据库路径放一次 schema-validated `child.send()`；timeout 时 kill 一次并 resolve unavailable。

- [ ] **步骤 7：实现 child 一次发送。** 使用 `new Database(databaseFile, { readonly: true, fileMustExist: true })`；依次运行 `PRAGMA quick_check(1)`、`PRAGMA foreign_key_check`（只聚合 count bucket）和固定 allowlist 的 `sqlite_schema`/`pragma_table_info` 查询；在 `finally` close；成功或失败都只调用一次 `process.send({ type: 'result', result })` 后退出。

- [ ] **步骤 8：移除 lease。** `MigrationDbService` 恢复 `close()` 立即关闭一个 connection；删除 identity/WAL/SHM lease；`MigrationEngine.collectDatabaseDiagnostics()` 删除，gate 保存直接调用 `databaseDiagnostics.inspect(paths.databaseFile)`。

- [ ] **步骤 9：重跑任务测试并扫描旧协议。** 预期 PASS；`rg -n "inspectWithLease|withDiagnosticsLease|l0_only|migrationDatabaseDiagnosticsChildReady|MigrationDatabaseL1|MigrationDatabaseL2|MigrationDatabaseDiagnosticsLease" src/main/data/migration/v2` 无输出。

- [ ] **步骤 10：提交。**

```bash
git add electron.vite.config.ts src/main/data/migration/v2
git commit --signoff -m "refactor(migration-diagnostics): use one-shot database inspection"
```

## 任务 4：把四文件严格 ZIP 收缩为两个 entry 和一个 document schema

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticBundleSchemas.ts`
- 修改：`src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`
- 修改：`src/main/data/migration/v2/diagnostics/index.ts`
- 修改：`src/main/data/migration/v2/window/migrationDiagnosticDialogs.ts`
- 修改：`src/renderer/windows/migrationV2/MigrationApp.tsx`
- 修改：`src/renderer/windows/migrationV2/i18n/locales.ts`
- 修改测试：`src/main/data/migration/v2/diagnostics/__tests__/{MigrationDiagnosticBundleBuilder,MigrationDiagnosticBundleBuilder.integration}.test.ts`
- 修改测试：`src/main/data/migration/v2/window/__tests__/{migrationDiagnosticDialogs,migrationDiagnosticNativeI18n}.test.ts`
- 修改测试：`src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`

- [ ] **步骤 1：写 builder 失败测试。** 断言 ZIP entry 名称及顺序恰为 `migration-diagnostics.json`、`README.txt`；JSON `formatVersion=1` 且通过唯一 schema；README 说明隐私排除、手动附件、无自动上传、child unavailable；uncompressed 总和上限 1,048,576 bytes。

- [ ] **步骤 2：写真实 ZIP/原子失败测试。** 使用 `node-stream-zip` 解压 builder 真实输出；在 archiver error、atomic stream error、schema invalid、超限四种情况下断言返回 `{ status:'failed', code:'bundle_save_failed' }`，目标文件不存在或保持原内容，且没有 `.tmp` 残留。

- [ ] **步骤 3：写 privacy canary 失败测试。** 将 `PRIVATE_PATH_CANARY`、`RAW_ERROR_CANARY`、`STACK_CANARY`、`SQL_CANARY`、`TOKEN_CANARY`、`RECORD_ID_CANARY` 放进被拒绝的输入和 test-only cause；读取 checkpoint 与两个解压 entry，断言六个字符串全部不存在。

- [ ] **步骤 4：运行测试确认旧四文件/manifest 实现失败。**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts
pnpm exec vitest run --project renderer src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx
```

预期：FAIL，旧 builder 仍生成 manifest/events/database/readme 并返回 archive/publish failure code。

- [ ] **步骤 5：实现唯一 document schema。**

```ts
export const migrationDiagnosticBundleDocumentSchema = z.object({
  formatVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  app: migrationDiagnosticAppMetadataSchema,
  state: z.enum(['active', 'failed', 'completed']),
  previous: migrationDiagnosticFinishedAttemptSchema.optional(),
  current: migrationDiagnosticAttemptSchema.optional(),
  database: migrationDatabaseDiagnosticResultSchema
}).strict()

export const MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES = [
  'migration-diagnostics.json',
  'README.txt'
] as const
```

- [ ] **步骤 6：实现最小 builder pipeline。** schema parse 和两个 Buffer 的 byte sum 在创建 stream 前完成；之后只执行一次 `archiver('zip', { zlib: { level: 9 } })`、两次 `append`、`archive.pipe(createAtomicWriteStream(destination))`、`finalize()`；监听 archive/output error 并统一转换为 `bundle_save_failed`。不 reopen、不计算 CRC、不读取 central directory、不做 inode 比较。

- [ ] **步骤 7：保持 UI 交互，只替换 code 映射。** `MigrationApp` 的保存按钮、保存中 guard、saved actions、version page 容器、restart/close disable 保持 JSX/className 不变；只把 `archive_failed`/`publish_failed` 两项替换为 `bundle_save_failed` 的单个 i18n key。

- [ ] **步骤 8：重跑任务测试并扫描旧 ZIP 机制。** 预期 PASS；`rg -n "manifest.json|migration-events.json|database-diagnostics.json|crc|central directory|reopen|archive_failed|publish_failed" src/main/data/migration/v2 src/renderer/windows/migrationV2 src/shared/data/migration/v2` 无输出。

- [ ] **步骤 9：提交。**

```bash
git add src/main/data/migration/v2/diagnostics src/main/data/migration/v2/window src/renderer/windows/migrationV2 src/shared/data/migration/v2
git commit --signoff -m "refactor(migration-diagnostics): build two-entry bundle"
```

## 任务 5：在 engine owner 边界只记录一次 fatal，并保留失败写入长度

**文件：**

- 修改：`src/main/data/migration/v2/core/MigrationContext.ts`
- 修改：`src/main/data/migration/v2/core/MigrationEngine.ts`
- 修改：`src/main/data/migration/v2/migrators/BaseMigrator.ts`
- 修改：`src/main/data/migration/v2/diagnostics/payloadLengthProfiler.ts`
- 修改：`src/main/data/migration/v2/migrators/{Agents,Assistant,BootConfig,Chat,File,Knowledge,KnowledgeVector,McpServer,MiniApp,Note,Painting,Preferences,Prompt,ProviderModel,Translate}Migrator.ts`
- 修改测试：`src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts`
- 修改测试：`src/main/data/migration/v2/migrators/__tests__/{BaseMigrator,AgentsMigrator,McpServerMigrator,ProviderModelMigrator,KnowledgeVectorMigrator}.test.ts`
- 修改测试：`src/main/data/migration/v2/diagnostics/__tests__/payloadLengthProfiler.test.ts`

- [ ] **步骤 1：写 BaseMigrator 失败测试。** 同步和 async write 分别抛带 `SQLITE_TOOBIG` cause 的错误，断言原 error identity 被重新抛出、phase wrapper 返回固定 classification 与一个 failed-write evidence、diagnostics sink 没有被调用；成功 write 不执行 lazy measurement。

- [ ] **步骤 2：写 string/json/blob 长度失败测试。** string 使用 `Buffer.byteLength`；JSON 在失败后才 stringify 且 stringify 再失败时 evidence 省略、不覆盖原 error；blob 只读取现有 `byteLength`，不 clone/遍历 buffer；数值按 262145 饱和并带 bucket。

```ts
export type FailedWriteValue =
  | { role: 'text_value'; kind: 'string'; value: string }
  | { role: 'json_value'; kind: 'json'; value: unknown }
  | { role: 'blob_value'; kind: 'blob'; byteLength: number }

export interface DiagnosedPhaseFailure {
  classification: ClassifiedMigrationError
  evidence?: Extract<MigrationDiagnosticFailureEvidence, { kind: 'failed_write' }>
}
```

- [ ] **步骤 3：写 engine 失败测试。** 对 initialize/prepare/execute/validate/final FK/final status 每个边界断言：开始时只更新 location；真实 throw 或 `success:false` 时只调用一次 `finishAttempt({ status:'failed', failure })`；`markFailed()` 二次失败不覆盖首个 failure；warning/skip/default/degrade 不产生 fatal。

- [ ] **步骤 4：运行定向测试确认旧 direct-event/profile 失败。**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/payloadLengthProfiler.test.ts src/main/data/migration/v2/migrators/__tests__/BaseMigrator.test.ts src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts
```

预期：FAIL，旧 profiler 深遍历 row/64 slots，BaseMigrator 向 `ctx.diagnostics.recordEvent()` 写重复事件，engine 仍提交 started/completed events。

- [ ] **步骤 5：实现 failure-only wrapper。**

```ts
protected runDiagnosedWrite<T>(values: () => readonly FailedWriteValue[], write: () => T): T {
  try {
    return write()
  } catch (error) {
    this.diagnosedPhaseFailure = {
      classification: classifyMigrationError(error),
      evidence: measureFailedWriteValuesBestEffort(values)
    }
    throw error
  }
}

protected captureDiagnosedFailure(failure: DiagnosedPhaseFailure): void {
  this.diagnosedPhaseFailure = failure
}

private async runPhaseWithDiagnostics<TResult extends { success: boolean }>(
  operation: () => Promise<TResult>
): Promise<{ result: TResult; failure?: DiagnosedPhaseFailure }> {
  this.diagnosedPhaseFailure = undefined
  try {
    const result = await operation()
    return result.success || this.diagnosedPhaseFailure === undefined
      ? { result }
      : { result, failure: this.diagnosedPhaseFailure }
  } finally {
    this.diagnosedPhaseFailure = undefined
  }
}
```

测量函数的整个 body 放在 `try/catch` 中并返回 `undefined`；最多返回三个 value measurement，永不改变 write error。`McpServerMigrator` 在“source 非空且所有 required rows 被拒绝”分支调用 `captureDiagnosedFailure()`；单条 skip 不调用。`UniqueModelIdViolationError` 使用固定 own data `code='INVALID_UNIQUE_MODEL_ID'`、`identifierRole`、`rule`，保持现有 message；classifier 只复制 role/rule，不复制 ID/字符/message。

- [ ] **步骤 6：收缩 engine integration。** `createMigrationContext()` 删除 diagnostics 参数；`MigrationAttemptDiagnostics` 只保留 `updateLocation`、`finishAttempt`、`complete`；`runDiagnosticBoundary()` 在进入时持久化 location，在 catch 时从 `MigratorResultError.failure` 优先使用原 native classification/evidence，否则直接 classify 当前 thrown value，最后只提交一次 terminal failure。

- [ ] **步骤 7：机械清理 15 个 migrator。** 删除 `PayloadProfileDescriptor` 与 target/slot descriptor 常量；把已有 `runDiagnosedWrite(ctx, descriptor, rows, write)` 改为 `runDiagnosedWrite(() => fixedFailedWriteValues, write)`；只传真正可能过长的 text/json/blob 字段，不传 ID/name/path/command/URL。保留 `capturePhaseFailure(error)` 的原始 error 捕获和所有非诊断逻辑。

固定 role 规则：普通 Drizzle JSON/text write 使用 `text_value`/`json_value`；knowledge vector 使用已知 `Float32Array.byteLength` 作为 `blob_value`；文件 move/copy 不创建 payload-length evidence，只保留 filesystem classification。

- [ ] **步骤 8：覆盖真实阻塞与负例。** Agents FK 失败为 `migration_invariant_failed`；MCP 全部 required rows 被拒绝为 `source_prepare_failed` + aggregate count bucket；单条缺失记录但仍有可迁移记录只产生既有 warning；Provider/Model typed violation 为 `source_invalid_identifier`；KnowledgeVector BLOB write failure不复制 buffer。

- [ ] **步骤 9：重跑任务测试。**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/payloadLengthProfiler.test.ts src/main/data/migration/v2/migrators/__tests__/BaseMigrator.test.ts src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts src/main/data/migration/v2/migrators/__tests__/AgentsMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/KnowledgeVectorMigrator.test.ts
```

预期：PASS；`rg -n "PayloadProfileDescriptor|profilePayloadLengths|ctx\.diagnostics|recordEvent\(" src/main/data/migration/v2` 无输出。

- [ ] **步骤 10：提交。**

```bash
git add src/main/data/migration/v2/core src/main/data/migration/v2/migrators src/main/data/migration/v2/diagnostics
git commit --signoff -m "refactor(migration-diagnostics): record fatal boundaries once"
```

## 任务 6：从真实 renderer exporter owner 发送固定失败报告

**文件：**

- 新建：`src/renderer/windows/migrationV2/exporters/RendererExportError.ts`
- 新建测试：`src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts`
- 修改：`src/renderer/windows/migrationV2/exporters/{ReduxExporter,DexieExporter,LocalStorageExporter,index}.ts`
- 修改：`src/renderer/windows/migrationV2/MigrationApp.tsx`
- 修改：`src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- 修改：`src/main/core/preboot/v2MigrationGate.ts`
- 修改测试：`src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`
- 修改测试：`src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`

- [ ] **步骤 1：写 exporter owner 失败测试。** Redux `localStorage.getItem`/root `JSON.parse` 分别映射 read/parse；Dexie exists/open/toArray/JSON.stringify/IPC 分别映射 open/read/serialize/write；localStorage iteration/JSON.stringify/IPC 分别映射 read/serialize/write；assert tagged error 的 report 不含 source data/cause message。

- [ ] **步骤 2：写 handoff 失败测试。** `MigrationApp` 在 exporter failure 时发送 `{ message, report }`；`actions.startMigration()` rejection 只显示 main 已拥有的 migration error，不发送第二条 renderer export report；重复点击仍只启动一个 generation。

- [ ] **步骤 3：写 Main IPC 失败测试。** 合法 report 进入 capability；非法/额外字段降级为 `{ sourceRole:'unknown', operationRole:'unknown' }`；`WriteExportFile` 的原始 ENOSPC/EACCES 在 main handler 内优先分类；迟到/旧 generation report 返回 false，不覆盖 engine attempt；message 只进入 UI progress，不进入 coordinator candidate。

- [ ] **步骤 4：运行 renderer/Main 定向测试确认失败。**

```bash
pnpm exec vitest run --project renderer src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx
pnpm exec vitest run --project main src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts
```

预期：FAIL，exporter 仍抛普通 Error，`ReportError` 仍只接收 message，capability 不接收 report。

- [ ] **步骤 5：实现 tagged error。**

```ts
export class RendererExportError extends Error {
  override readonly name = 'RendererExportError'

  constructor(
    readonly report: MigrationRendererExportFailureReport,
    cause: unknown
  ) {
    super('Migration data export failed', { cause })
  }
}

export function rendererExportReport(error: unknown): MigrationRendererExportFailureReport {
  return error instanceof RendererExportError
    ? error.report
    : { sourceRole: 'unknown', operationRole: 'unknown' }
}

export function rendererExportMessage(error: unknown): string {
  const cause = error instanceof RendererExportError ? error.cause : error
  return cause instanceof Error ? cause.message : 'Migration data export failed'
}
```

包装器只围住各 owner 的具体操作，finally 中现有 `db.close()` 保持不变；用户可见 message 继续由原 cause 生成，report 从不包含 message。

- [ ] **步骤 6：拆分 renderer export 与 main handoff catch。** exporter 三步放在一个 catch 中并发送 typed report；`actions.startMigration(payload)` 放在其后独立 try/catch，失败只设置 local error，因为 engine 已记录根因。

- [ ] **步骤 7：修改 IPC capability。**

```ts
export interface MigrationIpcDiagnosticCapabilities {
  start(): void | Promise<void>
  reportRendererExportFailure(report: MigrationRendererExportFailureReport): void | Promise<void>
  saveDiagnosticBundle(destination: string): Promise<MigrationDiagnosticNativeSaveResult>
  completeVersionGate(): void
}
```

`DiagnosticRegistrationState.rendererExportPhase` 增加可选 `mainWriteFailure`；`WriteExportFile` catch 在原错误仍存在时保存 fixed classification；`ReportError` parse payload 后以 main write failure 优先、renderer report 次之构造唯一 fatal。

- [ ] **步骤 8：重跑任务测试。** 预期 PASS；检查 `MigrationApp.tsx` 的 diagnostic panel JSX/className diff 为空，仅 export flow 与 failure key 变化。

- [ ] **步骤 9：提交。**

```bash
git add src/shared/data/migration/v2 src/renderer/windows/migrationV2 src/main/data/migration/v2/window src/main/core/preboot/v2MigrationGate.ts
git commit --signoff -m "fix(migration-diagnostics): report renderer export failures"
```

## 任务 7：接回 gate、version 页面、native fallback 与 crash/recovery

**文件：**

- 修改：`src/main/core/preboot/v2MigrationGate.ts`
- 修改：`src/main/data/migration/v2/window/MigrationWindowManager.ts`
- 修改：`src/main/data/migration/v2/window/migrationDiagnosticDialogs.ts`
- 修改：`src/main/data/migration/v2/core/MigrationEngine.ts`
- 修改测试：`src/main/core/preboot/__tests__/v2MigrationGate.test.ts`
- 修改测试：`src/main/data/migration/v2/window/__tests__/{MigrationWindowManager,migrationDiagnosticDialogs}.test.ts`
- 修改测试：`src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`

- [ ] **步骤 1：写三种 version block 失败测试。** `no_version_log`、`v1_too_old`、`v2_gateway_skipped` 都产生 `upgrade_path_blocked`、严格 version evidence、现有 `version_incompatible` progress/page 和可保存两文件 ZIP；使用真实 version.log parser/selection 复现“页面显示 1.8.4，但实际运行过 1.9.11”的选择事实。只有 `waitForReady()` 成功后才把 current 结束为 gate block；若 window 创建/加载失败，同一 current 结束为 `preboot_failed/version_window_failed` 并保留 version-gate evidence，不引入第二条 fatal。

- [ ] **步骤 2：反转 version window catch 的旧断言。** `migrationWindowManager.create()`/`waitForReady()` 在 version page 路径失败时，不再断言 `dialog.showErrorBox()`；改断言 `presentMigrationDiagnosticFailure({ code:'version_window_failed', saveBundle })` 被调用，save 后可 retry/quit。

- [ ] **步骤 3：写 renderer crash/hang 单次 flow 测试。** `render-process-gone` 和 `unresponsive` 分别完成 `process_interrupted` failure，等待已有 migration/diagnostic writes settle，打开 native save；两个信号连续到达只 claim 一次；native save 失败不覆盖 process root cause。

- [ ] **步骤 4：写 next-launch recovery 测试。** 上一进程留下 in-progress checkpoint，下一次 gate attach 先展示 `presentMigrationDiagnosticRecovery()`；保存 ZIP 后 retry 创建 `recovered_retry` current；选择 quit 不启动 engine；损坏 checkpoint 只隔离并继续正常 gate。

- [ ] **步骤 5：运行 gate/window/renderer 定向测试确认失败。**

```bash
pnpm exec vitest run --project main src/main/core/preboot/__tests__/v2MigrationGate.test.ts src/main/data/migration/v2/window/__tests__/MigrationWindowManager.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts
pnpm exec vitest run --project renderer src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx src/renderer/windows/migrationV2/components/__tests__/MigrationDiagnosticsSavedActions.test.tsx src/renderer/windows/migrationV2/components/__tests__/MigrationWindowControls.test.tsx
```

预期：FAIL，gate 仍使用 event API/旧 snapshot shape，version window catch 仍 showErrorBox/quit。

- [ ] **步骤 6：精简 gate orchestration。** gate 创建 coordinator/builder/database inspector；path resolution 前即可创建 in-memory attempt，未得到数据库路径时 bundle 使用既有 memory-only `database.sqlite.reason='not_attempted'`；attach 后先处理 recovered；每次 renderer export 前 begin attempt；三种 version block 在 version window ready 后 finish fixed failure；engine 只获得窄 diagnostics capability；所有 coordinator call 是 best-effort。删除 native failure enum/i18n/test 中的 `diagnostics_journal_failed`，checkpoint attach/write 失败继续当前迁移且不弹新错误。

- [ ] **步骤 7：替换 version window fallback。** catch 中保留原 logger，调用与 migration-window failure 相同的 `presentFailure('version_window_failed')`，再经 `applyNativeDecision()`；不新增 dialog/component/style。

```ts
try {
  migrationWindowManager.create(windowFailureOptions)
  await migrationWindowManager.waitForReady()
} catch (error) {
  logger.error('Failed to open version-incompatible migration window', error as Error)
  return applyNativeDecision(await presentFailure('version_window_failed'))
}
```

- [ ] **步骤 8：保持 crash/hang 现有单 claim。** 只把 callback 内 `recordEvent/finishAttempt` 改为 `finishAttempt({ status:'interrupted', failure })`；`renderer_process_gone`/`renderer_unresponsive` 仍是根因 code，SQLite child timeout/ZIP failure 不替换它。

- [ ] **步骤 9：重跑任务测试。** 预期 PASS；确认三个 version page snapshot 与严格分支样式断言保持一致。

- [ ] **步骤 10：提交。**

```bash
git add src/main/core/preboot src/main/data/migration/v2/core src/main/data/migration/v2/window src/renderer/windows/migrationV2
git commit --signoff -m "fix(migration-diagnostics): preserve native recovery flows"
```

## 任务 8：用真实 owner/DB/ZIP 覆盖七个历史场景与十四个 fixture

**文件：**

- 修改：`src/main/data/migration/v2/diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/fixtures/nativeSqliteHangChild.mjs`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts`
- 修改：`src/main/data/migration/v2/migrators/__tests__/{AgentsMigrator,McpServerMigrator,ProviderModelMigrator}.test.ts`
- 修改：`src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts`
- 修改：`src/main/core/preboot/__tests__/v2MigrationGate.test.ts`

- [ ] **步骤 1：把 fixture 定义改为显式角色表。**

```ts
export const BLOCKING_FIXTURES = [
  'database-open', 'database-corrupt', 'database-schema', 'database-constraint',
  'oversized-string', 'oversized-json', 'oversized-blob', 'source-parse',
  'path-permission', 'renderer-crash', 'renderer-hang', 'retry-recovery'
] as const

export const SUPPORT_CHAIN_FIXTURES = [
  'archive-finalization-failure', 'database-process-partial'
] as const
```

测试必须断言前 12 个有阻塞 root（或 process interruption），后 2 个没有 migration root，只改变 `bundle_save_failed`/`database.sqlite.status`。

- [ ] **步骤 2：写七个历史场景验收。**

1. Agents：生产 schema + actual migrator validation，FK violation 映射固定 invariant/foreign-key role。
2. Internal/Unknown：让 actual Dexie exporter read/write operation reject，跨 renderer → Main report boundary 后保存 ZIP。
3. MCP missing id/name：全部 required rows rejected 才 fatal；另一个“1 条坏 + 1 条好”用例成功且无 fatal。
4. MCP type CHECK：actual `transformMcpServer({ type:'arbitrary' })` 归一为 `null`，migration 成功且无专用 fatal evidence。
5. Provider Model reserved character：actual `createUniqueModelId` typed violation，经 migrator/engine 保存 fixed invalid-identifier rule，不保存字符/ID。
6. Missing version.log：actual gate evaluation 产生 `no_version_log`，现有 version page 可保存真实 ZIP。
7. 1.8.4 vs 1.9.11：actual version log reader 选择最近有效 1.9.11，bundle 只保存安全 normalized version context。

- [ ] **步骤 3：为 database-open/corrupt/schema/constraint 使用生产 DB fixture。** open/schema 通过 real engine/database service；corrupt 复制 `setupTestDatabase()` 文件后破坏 header；constraint 走 actual Drizzle write；不得在测试写 `CREATE TABLE`。

- [ ] **步骤 4：为 length/source/path 使用 actual owner。** string/json/blob 让 actual write wrapper 收到 `SQLITE_TOOBIG`；source parse 使用 actual Redux exporter parser；path permission 在 temp directory 上收紧权限并在 finally 恢复；断言 raw value/path 不在 ZIP。

- [ ] **步骤 5：为 process/recovery/support chain 使用 deterministic process fixture。** renderer crash/hang 调用 window manager 的真实 event handlers；DB child partial/hang 只使 SQLite evidence unavailable；archive finalization只返回统一 save failure；retry recovery跨两个 coordinator 实例读取同一真实 checkpoint。

- [ ] **步骤 6：运行完整但非全仓的 diagnostics acceptance 集合。**

```bash
pnpm rebuild:node
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.process.integration.test.ts src/main/data/migration/v2/migrators/__tests__/AgentsMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts src/main/core/preboot/__tests__/v2MigrationGate.test.ts
pnpm exec vitest run --project renderer src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx
```

预期：PASS；acceptance 输出中 7/7 历史场景、12/12 blocking/process fixture、2/2 support-chain fixture 均命中；MCP single-skip 和 type-normalization 两个负例无 fatal。

- [ ] **步骤 7：提交。**

```bash
git add src/main/data/migration/v2/diagnostics src/main/data/migration/v2/migrators src/main/data/migration/v2/core src/main/core/preboot src/renderer/windows/migrationV2
git commit --signoff -m "test(migration-diagnostics): cover blocking failure matrix"
```

## 任务 9：真实 Electron 验收、文档和最终定向验证

**文件：**

- 修改：`src/main/data/migration/v2/README.md`
- 修改：`src/renderer/windows/migrationV2/README.md`
- 更新外部文档：`https://mcnnox2fhjfq.feishu.cn/docx/GuhidWzBdoh4l1xGKFxc52acnub`

- [ ] **步骤 1：更新仓库 README。** Main README 写明 failure owner、checkpoint previous/current、两 entry ZIP、one-shot DB child 和 non-interference；renderer README 写明 exporter tagged report、UI message/report 分离、version page 与 native fallback。删除 L0/L1/L2、5 attempts/200 events、4-entry ZIP、lease、CRC/reopen 的描述。

- [ ] **步骤 2：准备隔离的真实 Electron version-block 场景。** 使用 `CS_DEV_USER_DATA_SUFFIX=CodexMigrationDiagnostics` 启动一次拿到独立 dev userData，停止进程，在该目录只放非空 `config.json` 且不放 `version.log`；这会经真实 `hasV1Data()` + version policy 到 `no_version_log`，不会接触日常/生产 userData。

```bash
pkill -f "cherry-studio.*Electron"
pkill -f "electron-vite"
lsof -ti :9222 | xargs kill
lsof -ti :5173 | xargs kill
CS_DEV_USER_DATA_SUFFIX=CodexMigrationDiagnostics nohup pnpm debug > /tmp/cherry-migration-diagnostics.log 2>&1 &
```

从 `/tmp/cherry-migration-diagnostics.log` 中读取 `userData set with dev suffix` 的 `devPath`，确认 basename 以 `CodexMigrationDiagnostics` 结尾后停止 app；用 Node `fs.writeFileSync(path.join(devPath, 'config.json'), JSON.stringify({ migrationFixture: true }))` 生成隔离 fixture。不得删除或改写其他 userData。

- [ ] **步骤 3：再次启动并用 CDP 验证真实窗口。** 连接 9222，选择 URL 含 `migrationV2` 的 tab，截图 version-incompatible 页面；点击保存诊断包并选一个临时目标；验证保存期间按钮 disabled、保存后 Reveal/Copy/Email actions 出现，page 宽度/按钮与严格分支保持一致。

```bash
CS_DEV_USER_DATA_SUFFIX=CodexMigrationDiagnostics nohup pnpm debug > /tmp/cherry-migration-diagnostics.log 2>&1 &
agent-browser connect 9222
agent-browser tab
agent-browser snapshot -i
```

用 `node-stream-zip` 打开真实保存文件，断言 entry 只有两个且 JSON reason 为 `no_version_log`；截图和 ZIP entry 列表保存到 `/tmp/cherry-migration-diagnostics-report/`。

- [ ] **步骤 4：清理真实测试进程和隔离数据。** 先 SIGTERM，再仅对仍占用 9222/5173 的 PID 使用 SIGKILL；把已确认 suffix 的隔离 dev userData 移到 Trash/独立备份目录，不删除任何普通 Cherry Studio userData；保持当前 feature branch，不切回 `main`，因为用户明确要求本地继续停留在新分支。

- [ ] **步骤 5：运行全部定向验证。**

```bash
pnpm rebuild:node
pnpm exec vitest run --project shared src/shared/data/migration/v2/__tests__/diagnostics.test.ts src/shared/utils/__tests__/model.test.ts
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__ src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts src/main/data/migration/v2/core/__tests__/versionPolicy.test.ts src/main/data/migration/v2/migrators/__tests__/BaseMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/AgentsMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/McpServerMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts src/main/data/migration/v2/migrators/__tests__/KnowledgeVectorMigrator.test.ts src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts src/main/data/migration/v2/window/__tests__/MigrationWindowManager.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts src/main/core/preboot/__tests__/v2MigrationGate.test.ts
pnpm exec vitest run --project renderer src/renderer/windows/migrationV2/exporters/__tests__/MigrationExporters.test.ts src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx src/renderer/windows/migrationV2/components/__tests__/MigrationDiagnosticsSavedActions.test.tsx src/renderer/windows/migrationV2/components/__tests__/MigrationWindowControls.test.tsx
pnpm lint
pnpm format
pnpm docs:check-links
git diff --check
```

预期：定向测试、lint、format、docs links 全部 PASS，`git diff --check` 无输出。明确不执行 `pnpm test` 和 `pnpm build:check`。

- [ ] **步骤 6：做最终残留和隐私扫描。**

```bash
rg -n "migrationDiagnosticsV1|migrationDiagnosticRetention|withDiagnosticsLease|inspectWithLease|manifest.json|migration-events.json|database-diagnostics.json|MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS|MIGRATION_DIAGNOSTICS_MAX_EVENTS|archive_failed|publish_failed|PayloadProfileDescriptor|profilePayloadLengths" src electron.vite.config.ts
rg -n "console\.(log|warn|error)|app\.getPath\(|os\.homedir\(" src/main/data/migration/v2/diagnostics src/main/core/preboot/v2MigrationGate.ts
git status --short
```

预期：前两条 `rg` 无输出；status 只包含本任务直接相关文件。

- [ ] **步骤 7：更新飞书实施文档。** 按 `lark-doc` 技能读取最新 revision，在“实施记录”写入每个实际 commit、净增删行、保留/删除模块；在“测试结果”写入 7 个历史场景、14 个 fixture、真实 Electron 截图/ZIP entry 结果、privacy canary、lint/format/docs links；明确“未运行全量 `pnpm test` / `pnpm build:check`”。更新后重新 fetch，确认 D0–D5 与结果段落均存在。

- [ ] **步骤 8：提交 README 与格式化结果。**

```bash
git add src/main/data/migration/v2/README.md src/renderer/windows/migrationV2/README.md src/main src/renderer src/shared electron.vite.config.ts
git commit --signoff -m "docs(migration-diagnostics): record simplified verification"
```

- [ ] **步骤 9：核对最终分支。** `git status --short --branch` 必须显示 `codex/migration-diagnostics-simplified` 且工作树 clean；`git log --show-signature -9 --oneline` 显示所有小步签名提交；向用户报告实际测试、未跑项目、真实场景证据和飞书链接。

## 规格—任务映射

| 批准要求 | 落地任务 |
| --- | --- |
| previous/current 最小 checkpoint、断电/主进程中断恢复 | 2、7、8 |
| renderer 闪退/无响应即时 native 保存 | 7、8 |
| native SQLite hang/child partial 不阻塞 ZIP | 3、8 |
| 本地对抗性文件竞争不纳入生产范围 | 3、4（仅原子写与普通文件检查） |
| 真实阻塞错误倒推 fixed code/evidence | 1、5、6、8 |
| 字段缺失仅 all-required-rejected 才 fatal | 5、8 |
| 失败写入 string/json/blob 长度 | 5、8 |
| 三种版本不兼容页面与保存 | 7、8、9 |
| version 页面创建失败也有 native 下载按钮 | 7 |
| 两 entry ZIP、1 MiB、无自动上传 | 4、9 |
| SQLite real file-backed/生产 migration | 3、8 |
| 保留现有 UI/交互与迁移逻辑 | 4、6、7、9 |
| 七个历史场景、十四 fixture、至少一个真实 Electron 窗口 | 8、9 |
| 不跑全量测试 | 所有任务，尤其 9 |

## 完成定义

1. 任何用户可见保存入口都生成同一个两 entry ZIP。
2. fatal 只来自 gate block、renderer export 终止、engine failure 或 process interruption。
3. warning、单条 skip、default、degrade、SQLite child failure、ZIP failure 不成为 migration root。
4. 失败 write 可记录 bounded string/json/blob byte length，且不记录内容。
5. renderer crash/unresponsive 立即出现 native save；main/native interruption 下次启动可恢复。
6. 三个 version reason 可在现有页面保存，version window 自身失败可走 native `version_window_failed` 保存。
7. checkpoint 与 ZIP 均通过 privacy canary；旧 strict journal 被隔离但 business data 不受影响。
8. 7 个历史场景、14 个 fixture、真实 Electron version page 均有结果证据。
9. 定向测试、lint、format、docs links 通过；handoff 明确未运行全量测试。
