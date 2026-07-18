# 迁移诊断严格方案实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在所有迁移失败入口提供可保存的 Scheme A 诊断 ZIP，只包含严格结构化、无业务数据的事件与只读数据库状态，未压缩总量不超过 1 MiB。

**架构：** `runV2MigrationGate()` 在解析路径前创建非全局 `MigrationDiagnosticsCoordinator`，路径可用后将 crash-safe journal、迁移引擎、窗口和 IPC 显式接到同一实例。保存时才启动隔离的只读 SQLite Worker，并把四个固定条目通过 allowlist 打成 ZIP；任一诊断组件失败均降级为结构化 unavailable 状态，不阻止其余内容保存。

**技术栈：** TypeScript、Electron、Zod、better-sqlite3、Drizzle ORM、Node Worker Threads、archiver、node-stream-zip、React、i18next、`@cherrystudio/ui`、Vitest。

---

## 分支与约束

- 规格：`docs/superpowers/specs/2026-07-18-migration-diagnostics-bundle-design.md`。
- 分支：`codex/migration-diagnostics-strict`，从已评审设计和本计划提交开始。
- Scheme B 的日志读取、脱敏、隐私确认和双包输出只在配套日志方案计划实施。
- 迁移发生在 lifecycle/IpcApi 启动前；不得新增 lifecycle service 或依赖正常应用 IpcApi。
- 路径只从 `MigrationPaths` 取得；SQLite Worker 不导入 `@logger`；ZIP 只 append 固定 Buffer，禁止 directory/glob。

## 文件结构

### 新建

- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`：严格 journal、事件、数据库报告和 manifest schema。
- `src/main/data/migration/v2/diagnostics/migrationErrorClassifier.ts`：有界 cause-chain 到固定错误枚举。
- `src/main/data/migration/v2/diagnostics/payloadLengthProfiler.ts`：失败时计算指定字段的长度桶。
- `src/main/data/migration/v2/diagnostics/migrationDiagnosticsJournal.ts`：原子替换、损坏隔离、恢复、GC 和完成删除。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator.ts`：session/attempt 状态机、保留和 single-flight snapshot/save。
- `src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsWorker.ts`：L0/L1/L2 只读 SQLite Worker。
- `src/main/data/migration/v2/diagnostics/MigrationDatabaseDiagnostics.ts`：Worker host、timeout、partial result。
- `src/main/data/migration/v2/diagnostics/MigrationDiagnosticBundleBuilder.ts`：四项 A 包、1 MiB 预算、`.partial` 原子发布。
- `src/main/data/migration/v2/diagnostics/index.ts`：显式 re-export，无逻辑。
- `src/main/data/migration/v2/diagnostics/__tests__/*`：上述单元与 integration 测试。
- `src/main/data/migration/v2/window/migrationDiagnosticNativeI18n.ts`：preboot-safe 独立 i18next。
- `src/main/data/migration/v2/window/migrationDiagnosticDialogs.ts`：失败、恢复、保存后原生 dialog。
- `src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts`。
- `src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts`。
- `src/renderer/windows/migrationV2/components/MigrationDiagnosticsSavedActions.tsx` 及其测试。

### 修改

- `src/shared/data/migration/v2/types.ts`：attempt/save/support IPC channel 与 transport union。
- `src/main/data/migration/v2/core/MigrationPaths.ts`：`diagnosticsJournalFile`、`migrationExportDir`、`logsDir`、`homeDir`。
- `src/main/data/migration/v2/core/MigrationContext.ts`：窄 `MigrationDiagnosticsSink`。
- `src/main/data/migration/v2/core/MigrationEngine.ts`、`MigrationDbService.ts`：phase/terminal/L0 接线与完成清理。
- `src/main/data/migration/v2/migrators/BaseMigrator.ts` 和 14 个 migrator：失败写入边界 profiling。
- `src/main/core/preboot/v2MigrationGate.ts`：最早创建 coordinator，覆盖全部原生失败与恢复。
- `src/main/data/migration/v2/window/MigrationIpcHandler.ts`、`MigrationWindowManager.ts`：sender 校验、保存、crash/hang。
- `src/main/data/migration/v2/index.ts`：公共导出。
- `src/renderer/windows/migrationV2/{MigrationApp.tsx,hooks/useMigrationProgress.ts,i18n/locales.ts,components/index.ts}`：保存 UI。
- 对应既有测试：`MigrationPaths.test.ts`、`MigrationEngine.test.ts`、`v2MigrationGate.test.ts`、`MigrationIpcHandler.test.ts`、`MigrationWindowManager.test.ts`、`MigrationApp.test.tsx`、`useMigrationProgress.test.tsx`。

## 固定契约

```ts
export const MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES = 1_048_576
export const MIGRATION_DIAGNOSTIC_STRICT_ENTRIES = [
  'manifest.json',
  'migration-events.json',
  'database-diagnostics.json',
  'README.txt'
] as const

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | { status: 'saved'; outputCount: 1 }
  | {
      status: 'failed'
      code: 'dialog_failed' | 'snapshot_failed' | 'archive_failed' | 'publish_failed' | 'save_in_progress'
    }
```

Journal 固定为 `{userData}/migration-diagnostics-v1.json`；损坏文件为 `migration-diagnostics-v1.corrupt.<UTC-basic-timestamp>.json`，最多 2 个、最长 7 天，且永不进入 ZIP。

## 任务 1：严格 schema、错误分类和长度 profiler

**文件：** 新建 `migrationDiagnosticsSchemas.ts`、`migrationErrorClassifier.ts`、`payloadLengthProfiler.ts` 及三个同名测试。

- [ ] **步骤 1：先写失败测试**

```ts
it('rejects arbitrary error text', () => {
  const result = migrationDiagnosticEventSchema.safeParse({
    sequence: 1,
    at: '2026-07-19T10:00:00.000Z',
    attemptId: 'attempt-1',
    scope: 'migrator',
    phase: 'execute',
    state: 'failed',
    code: 'sqlite_too_big',
    rawError: 'sk-user-message'
  })
  expect(result.success).toBe(false)
})

it('classifies nested SQLite errors without text', () => {
  const cause = Object.assign(new Error('secret /Users/alice'), { code: 'SQLITE_TOOBIG' })
  expect(classifyMigrationError(new Error('wrapper', { cause }))).toEqual({
    category: 'database_write', code: 'sqlite_too_big', causeDepth: 1
  })
})
```

Profiler 测试覆盖 UTF-8 string、Buffer、JSON cycle/depth/node/deadline、getter 不执行、动态 nested key 不输出。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/migrationErrorClassifier.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/payloadLengthProfiler.test.ts
```

预期：模块不存在。

- [ ] **步骤 3：实现最小代码**

所有 schema `.strict()`；错误只输出固定 category/code/causeDepth，unknown 不调用 `String()`/`toString()`。Profiler 只读 descriptor 声明的顶层 slot，最长深度 8、最多 1,024 节点、64 字段、5 ms；长度仅映射到 `0`、`1-256`、`257-4096`、`4097-65536`、`65537-262144`、`262145+`。

```ts
export const migrationErrorCodeSchema = z.enum([
  'unknown', 'path_unavailable', 'permission_denied', 'disk_full',
  'sqlite_corrupt', 'sqlite_not_database', 'sqlite_too_big',
  'sqlite_constraint', 'sqlite_schema', 'source_parse',
  'worker_timeout', 'archive_write'
])
```

- [ ] **步骤 4：重跑同一命令，预期 PASS；提交**

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): define strict diagnostic records"
```

## 任务 2：crash-safe journal 与 Coordinator

**文件：** 新建 `migrationDiagnosticsJournal.ts`、`MigrationDiagnosticsCoordinator.ts`、`index.ts` 及测试；修改 `MigrationPaths.ts` 与 `MigrationPaths.test.ts`。

- [ ] **步骤 1：写失败测试**

Journal 断言同目录 tmp → file fsync → rename → POSIX dir fsync；corrupt 隔离；第三个副本淘汰最旧；8 天副本删除；完成只删 journal/tmp。Coordinator 断言 memory-only、attach 后恢复旧 session、不覆盖旧 journal、attempt 最多 5、event 最多 200、terminal event 必留、并发 snapshot 共用同一 Promise、并发 save 返回 `save_in_progress`。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsJournal.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts \
  src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts
```

- [ ] **步骤 3：实现 journal/coordinator，并一次性计算路径**

```ts
export interface MigrationPaths {
  readonly diagnosticsJournalFile: string
  readonly migrationExportDir: string
  readonly logsDir: string
  readonly homeDir: string
}
```

custom userData 必须同时重定向 journal/export；logs/home 来自 preboot 已有中心常量。`snapshot()` 返回 frozen deep copy；淘汰最旧非终态事件，不淘汰 attempt terminal。

- [ ] **步骤 4：重跑同一命令，预期 PASS；提交**

```bash
git add src/main/data/migration/v2/diagnostics src/main/data/migration/v2/core/MigrationPaths.ts \
  src/main/data/migration/v2/core/__tests__/MigrationPaths.test.ts
git commit --signoff -m "feat(data-migration): persist diagnostic attempts"
```

## 任务 3：Engine、Context 与真实失败写入边界

**文件：** 修改 `MigrationContext.ts`、`MigrationEngine.ts`、`MigrationDbService.ts`、`BaseMigrator.ts`、各 migrator 与对应测试。

- [ ] **步骤 1：写 Engine/BaseMigrator 失败测试**

断言事件顺序是 phase started → failed → attempt terminal；原异常在 `markFailed()` 前记录；status write 二次失败是独立固定事件且不遮蔽原错误；DB completed 后才清 journal。Helper 仅 catch 时 profiling、原样 rethrow、不开 transaction、不复制 rows。

```ts
protected runDiagnosedWrite<T>(
  ctx: MigrationContext,
  descriptor: PayloadProfileDescriptor,
  rows: readonly unknown[],
  write: () => T
): T
```

- [ ] **步骤 2：运行 Engine/BaseMigrator 测试，预期 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/core/__tests__/MigrationEngine.test.ts \
  src/main/data/migration/v2/migrators/__tests__/BaseMigrator.test.ts
```

- [ ] **步骤 3：实现 sink/helper，并按表接入**

| 文件 | target | 仅统计 slot |
|---|---|---|
| `PreferencesMigrator.ts` | `preference` | `value` |
| `AssistantMigrator.ts` | `assistant`, `assistant_relation` | `name`, `prompt`, `description` |
| `McpServerMigrator.ts` | `mcp_server` | `name`, `command`, `args`, `env` |
| `ProviderModelMigrator.ts` | `user_provider`, `user_model` | `name`, `apiHost`, `apiKey`, `config` |
| `MiniAppMigrator.ts` | `mini_app` | `name`, `url`, `logo` |
| `FileMigrator.ts` | `file_entry` | `name`, `path`, `metadata` |
| `KnowledgeMigrator.ts` | `knowledge_base`, `knowledge_item` | `name`, `content`, `metadata` |
| `ChatMigrator.ts` | `topic`, `message`, `file_ref`, `pin` | `name`, `content`, `metadata` |
| `PaintingMigrator.ts` | `painting`, `file_ref` | `prompt`, `negativePrompt`, `metadata` |
| `TranslateMigrator.ts` | `translate_language`, `translate_history` | `name`, `sourceText`, `targetText` |
| `PromptMigrator.ts` | `prompt` | `name`, `content` |
| `NoteMigrator.ts` | `note` | `title`, `content` |
| `AgentsMigrator.ts` | `agent_task`, `agent_message`, `agent_relation` | `title`, `content`, `metadata` |
| `KnowledgeVectorMigrator.ts` | `knowledge_vector_status` | `error`, `metadata` |

`logoMigration.ts` 的 file entry 也经 helper。原始 `INSERT ... SELECT` 只记录固定 source/phase/category，不伪造内存 profile。每个被改 migrator 增加一条 `SQLITE_TOOBIG` 测试。

- [ ] **步骤 4：运行所有 migration v2 main tests，预期 PASS；提交**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2
git add src/main/data/migration/v2/core src/main/data/migration/v2/migrators
git commit --signoff -m "feat(data-migration): record bounded failure context"
```

## 任务 4：L0/L1/L2 只读数据库 Worker

**文件：** 新建 worker/host 与 `MigrationDatabaseDiagnostics.test.ts`、`MigrationDatabaseDiagnostics.integration.test.ts`。

- [ ] **步骤 1：写 fake Worker 和生产 DB integration 失败测试**

Fake Worker 覆盖增量 L0/L1、error、exit、3 秒 timeout、terminate once、listener cleanup。Integration 使用 `setupTestDatabase()`，覆盖 healthy、schema mismatch、FK violation、截断副本、unreadable、step truncation；不手写 production DDL。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts
```

- [ ] **步骤 3：实现 Worker/host**

Worker 用 `new Database(file, { readonly: true, fileMustExist: true })` 和 `query_only = ON`。L0 仅文件状态/大小桶/header；L1 仅 allowlisted expected/missing/extra object ID 与列数桶；L2 执行 `PRAGMA quick_check(20)` 和 FK check，映射固定类别并删除 rowid/fkid/原文。每步发 typed message，finally close。Host timeout 后 terminate 并保留已完成 step。

- [ ] **步骤 4：重复三次稳定性测试**

```bash
for run in 1 2 3; do
  pnpm exec vitest run --project main \
    src/main/data/migration/v2/diagnostics/__tests__/MigrationDatabaseDiagnostics.integration.test.ts || exit 1
done
```

预期：三次 PASS，无 native crash。若强制终止 better-sqlite3 Worker 触发 native finalizer 崩溃，停止实施并报告 blocker；不得把查询搬回 Main 线程。

- [ ] **步骤 5：提交**

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): inspect failed databases read-only"
```

## 任务 5：严格 A ZIP 与隐私扫描

**文件：** 新建 `MigrationDiagnosticBundleBuilder.ts` 及 unit/integration 测试。

- [ ] **步骤 1：写失败测试**

断言精确四项 allowlist、未压缩 `sum(Buffer.byteLength) <= 1_048_576`、manifest 自身长度迭代稳定、terminal event 必留、裁剪顺序、0o600、`.partial` fsync/rename/失败清理。解压扫描 user message、home/userData、keys、Bearer、cookie、password、PEM、DB URL、email/device ID、stack path canary；A 全部 0 命中，且无 DB/WAL/SHM/journal/export/traversal。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts \
  src/main/services/__tests__/archiverZipRoundtrip.integration.test.ts
```

- [ ] **步骤 3：实现 builder**

四项先严格验证并转为固定名 Buffer Map；manifest 迭代到 byte counts 稳定后硬断言预算。只调用 `archive.append(buffer, { name })`。发布复用 `atomicWriteFile(..., { mode: 0o600 })`；若精确 `.partial` 名称无法复用，则在本模块实现窄的 sibling temp/fsync/rename，不改共享 helper。

- [ ] **步骤 4：重跑同一命令，预期 PASS；提交**

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): build strict diagnostic archives"
```

## 任务 6：覆盖 preboot、恢复、crash/hang 原生路径

**文件：** 新建 native i18n/dialog；修改 `v2MigrationGate.ts`、`MigrationWindowManager.ts` 及测试。

- [ ] **步骤 1：写失败测试**

覆盖 zh-CN/en-US/fallback；path resolve、pin、DB initialize/status、version window、migration window 全部经同一 presenter；unfinished journal 在 DB initialize 前提示；DB completed 会清 stale journal；save cancel 返回原决策框。连续 hang+crash 只调用一次 callback，等待 in-flight write 后保存/退出。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/core/preboot/__tests__/v2MigrationGate.test.ts \
  src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts \
  src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts \
  src/main/data/migration/v2/window/__tests__/MigrationWindowManager.test.ts
```

- [ ] **步骤 3：实现显式接线**

Gate 第一条业务语句创建 coordinator，resolve 后 attach；presenter 只接 fixed code，不接 raw Error。`MigrationWindowManager.create({ onRendererFailure })` 保存 callback 而非 coordinator，并用内部 Promise single-flight。主进程硬挂不在承诺范围。

- [ ] **步骤 4：重跑同一命令，预期 PASS；提交**

```bash
git add src/main/core/preboot/v2MigrationGate.ts src/main/core/preboot/__tests__/v2MigrationGate.test.ts \
  src/main/data/migration/v2/window
git commit --signoff -m "feat(data-migration): offer diagnostics on native failures"
```

## 任务 7：migration IPC 与 Renderer 错误页

**文件：** 修改 shared types、IPC handler、renderer hook/app/locales；新建 `MigrationDiagnosticsSavedActions.tsx` 及测试。

- [ ] **步骤 1：写失败测试**

Channels 固定为 `Start`、`SaveDiagnosticBundle`、`OpenDiagnosticEmail`、`ShowDiagnosticBundleInFolder`、`CopySupportEmail`。非 migration sender 必须 reject；handler 不接路径/邮箱。错误页保存 pending 时 Save/Retry/Close disabled；saved 显示三项操作；failed code 只经 i18n 映射。

- [ ] **步骤 2：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx \
  src/renderer/windows/migrationV2/hooks/__tests__/useMigrationProgress.test.tsx \
  src/renderer/windows/migrationV2/components/__tests__/MigrationDiagnosticsSavedActions.test.tsx
```

- [ ] **步骤 3：实现 transport/UI**

`Start` 在 renderer export 前开始 attempt；`StartMigration` 不重复。Main 固定支持邮箱 `support@cherry-ai.com`；mailto 由固定 subject/body 生成并经 `isSafeExternalUrl()`；show folder 只用 coordinator 最后输出；copy 只复制固定邮箱。Renderer 无 policy selector，Scheme A 无隐私确认。

- [ ] **步骤 4：重跑测试、typecheck、i18n，预期 PASS；提交**

```bash
pnpm typecheck:node
pnpm typecheck:web
pnpm i18n:check
git add src/shared/data/migration/v2/types.ts src/main/data/migration/v2/window \
  src/renderer/windows/migrationV2
git commit --signoff -m "feat(data-migration): download strict diagnostics on failure"
```

## 任务 8：严格方案验收与 B 分支 fast-forward

**文件：** 修改 integration fixtures、`src/main/data/migration/v2/README.md` 和测试证据产生后的设计文档候选结果。

- [ ] **步骤 1：运行同一高优先级 fixture matrix**

覆盖 DB open/corrupt/schema/constraint、超长 string/JSON/blob、source parse、路径不可写、renderer crash/hang、重试/恢复、DB worker/archive 部分失败。每包必须识别 category、gate/migrator、phase；不得用增加原始文本补缺口。

- [ ] **步骤 2：执行迁移窗口交互 smoke 与 ZIP 解压检查**

分别触发 renderer error、native gate error、renderer crash、unfinished journal；保存 ZIP，确认四项固定 entry、支持操作不自动发送/附加邮件。

- [ ] **步骤 3：全量验证**

```bash
pnpm format
pnpm lint
pnpm test
pnpm build:check
git diff --check
```

预期：全部 exit 0。

- [ ] **步骤 4：提交验收证据**

```bash
git add src/main/data/migration/v2/README.md \
  docs/superpowers/specs/2026-07-18-migration-diagnostics-bundle-design.md \
  src/main/data/migration/v2/diagnostics/__tests__
git commit --signoff -m "test(data-migration): verify strict diagnostic bundles"
```

- [ ] **步骤 5：将 B 分支线性推进到 strict tip**

```bash
git status --short
git switch codex/migration-diagnostics-log-assisted
git merge --ff-only codex/migration-diagnostics-strict
```

预期：clean；只有 fast-forward，无 merge commit。随后执行日志辅助计划。

## 自检

- 设计第 6–8 节：任务 2、3、6、7。
- 第 9 节 L0/L1/L2 与禁止项：任务 4、5。
- 第 10 节超长数据：任务 1、3、8。
- 第 11 节四项与 1 MiB：任务 5、8。
- 第 13 节保存/支持：任务 5–7。
- 第 16 节 unit/worker/integration/privacy/full verification：任务 1–8。
- 公共类型和 channel 名称在全文一致；没有实现占位符。
