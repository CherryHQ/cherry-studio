# 迁移诊断日志辅助方案实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从已验收的 strict 分支叠加 Scheme B：选择当前迁移 attempts 对应的现有应用日志并做 best-effort 脱敏，在开发比较模式一次生成同 snapshot 的 A/B 两个 ZIP，B 未压缩总量不超过 10 MiB。

**架构：** Scheme B 不改变 Coordinator、journal、数据库 Worker 或 A 包；它根据 frozen snapshot 的 attempt intervals 选择 general app log，经 diagnostics-local redactor 后占用剩余预算。Production 仍只输出一个工程选定的包且无用户 policy selector；本分支开发模式用一次目录选择生成 A/B 两个候选，并在目标选择前要求明确隐私确认。

**技术栈：** TypeScript、Electron、Winston JSONL、Node streams/readline、Zod、archiver、node-stream-zip、React、i18next、`@cherrystudio/ui`、Vitest。

---

## 分支与约束

- 分支：`codex/migration-diagnostics-log-assisted`，先 `git merge --ff-only codex/migration-diagnostics-strict`。
- 规格：设计文档第 12–15 节和 strict 配套计划。
- 不修改 LoggerService 存储内容，不承诺全脱敏，不读取 `app-error.*`、audit 或非 allowlisted 文件。
- B 仅增加 `logs/app-session.jsonl`、`redaction-summary.json`、`log-selection.json`。
- A/B 的共同四项来自同一个 frozen snapshot 且逐字节相等。
- 用户看不到 A/B 选择；开发双输出由构建环境决定，production 只保留工程选中的一个 policy。

## 文件结构

### 新建

- `src/main/data/migration/v2/diagnostics/migrationLogRedaction.ts`：字段、secret、URL、数据库 URL、路径、硬件字段的固定顺序脱敏与命中计数。
- `src/main/data/migration/v2/diagnostics/MigrationLogCollector.ts`：regular-file allowlist、JSONL envelope、attempt interval、level/module 选择、优先级和预算。
- `src/main/data/migration/v2/diagnostics/__tests__/migrationLogRedaction.test.ts`。
- `src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.test.ts`。
- `src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.integration.test.ts`：真实 LoggerService envelope 契约。
- `src/renderer/windows/migrationV2/components/MigrationDiagnosticsPrivacyDialog.tsx` 及测试。

### 修改

- `migrationDiagnosticsSchemas.ts`：B 三项严格 schema、redaction/selection enum。
- `MigrationDiagnosticBundleBuilder.ts`：B builder 与同 snapshot A/B API。
- `MigrationDiagnosticsCoordinator.ts`：一次 snapshot 后生成候选。
- `MigrationIpcHandler.ts`、shared `types.ts`：`privacyConfirmed` 和 `consent_required`，无 policy 字段。
- `MigrationApp.tsx`、components index、locales：privacy dialog 状态和四项风险文案。
- strict 的 bundle/IPC/UI integration 测试：A 不回归和双输出验证。

## 固定契约

```ts
export const MIGRATION_DIAGNOSTIC_LOG_ASSISTED_LIMIT_BYTES = 10_485_760
export const MIGRATION_DIAGNOSTIC_LOG_ENTRIES = [
  'logs/app-session.jsonl',
  'redaction-summary.json',
  'log-selection.json'
] as const

export type MigrationDiagnosticSaveInput = { privacyConfirmed: boolean }

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | { status: 'consent_required' }
  | { status: 'saved'; outputCount: 1 | 2 }
  | {
      status: 'failed'
      code: 'dialog_failed' | 'snapshot_failed' | 'archive_failed' | 'publish_failed' | 'save_in_progress'
    }
```

Transport 中不出现 `policy`、destination、路径、邮箱、error message 或日志内容。

## 任务 1：真实日志 envelope 与 diagnostics-local redactor

**文件：** 新建 `migrationLogRedaction.ts`、redaction 测试、Logger envelope integration 测试；修改 diagnostics schema。

- [ ] **步骤 1：写真实 LoggerService envelope 失败测试**

临时 logs dir 使用真实 Winston formatter 写 info/warn/error，断言 JSONL 至少有 string `timestamp/level/message`；同时固定已观察限制：module metadata 可能缺失、timestamp 无时区且秒精度、renderer info 默认不落盘。测试不得修改 LoggerService 去改变这些行为。

- [ ] **步骤 2：写 redactor 规则与 residual-risk 测试**

```ts
it('redacts fields, secrets, URLs, paths and hardware in fixed order', () => {
  const result = redactMigrationLogRecord({
    level: 'error',
    timestamp: '2026-07-19 10:00:00',
    message: 'Bearer abcdefghijklmnop at /Users/alice/Cherry/data',
    apiKey: 'sk-secret',
    url: 'postgres://alice:pass@db.local/app?token=secret',
    cpuModel: 'device-fingerprint'
  }, redactionContext)
  expect(JSON.stringify(result.record)).not.toMatch(
    /alice|pass|sk-secret|device-fingerprint|abcdefghijklmnop/
  )
})
```

另写测试明确自然语言 `my childhood code word is bluebird` 可能保留；测试名必须写明 documented residual risk，不得声称 arbitrary free text anonymized。

- [ ] **步骤 3：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/migrationLogRedaction.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.integration.test.ts
```

- [ ] **步骤 4：实现固定顺序 redactor**

顺序：敏感字段名 → 所有字符串 secret pattern → URL/数据库 URL → longest-root-first 路径 → 硬件字段删除。字段覆盖 password/token/cookie/authorization/api key/client secret/private key/email/user/account/device identifier，但不泛化所有 `id`。路径 token 固定为 `<MIGRATION_EXPORT>`、`<USER_DATA>`、`<LOGS>`、`<HOME>`；Windows 大小写不敏感并支持两种分隔符。Summary 仅含固定 rule count、dropped field count、processed record count。

- [ ] **步骤 5：重跑同一命令，预期 PASS；提交**

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): redact diagnostic log copies"
```

## 任务 2：attempt-aware 日志选择与真实字节预算

**文件：** 新建 `MigrationLogCollector.ts` 及测试，修改 diagnostics index。

- [ ] **步骤 1：写文件安全失败测试**

只接受 `^app\.\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$`；拒绝 `app-error.*`、audit、隐藏文件、目录、FIFO、symlink。实现必须 lstat → open → fstat 二次确认 regular file。

- [ ] **步骤 2：写 envelope、interval 和选择测试**

每行最多 256 KiB；只接受 object 且具有 string `timestamp/level/message`。坏 JSON、超深/超节点、缺字段直接丢弃，无 raw fallback。attempt interval 并集边界 ±1 秒；open attempt 截止 snapshot；recovered interrupted attempt 截止最后 event + 2 秒，不能延伸到新启动。

已识别 migration module 选 info/warn/error；module 缺失或其他 module 只选 warn/error；不从 message 猜 module；debug/verbose/silly 永远丢弃。

- [ ] **步骤 3：写优先级和先脱敏后计费测试**

优先级：attempt boundary → terminal failure → newest error → newest warn → newest migration info。每条先 redaction、JSON stringify、加 `\n`，再用 `Buffer.byteLength` 计费。

- [ ] **步骤 4：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.test.ts
```

- [ ] **步骤 5：实现流式 collector**

使用 `createReadStream` + `readline`，不整批载入历史日志。返回 `{ jsonl, redactionSummary, selectionSummary }`；selection summary 只含文件数、候选/选择/丢弃数、固定 reason counts、interval count、truncated，不含路径、原文件名或日志文本。

- [ ] **步骤 6：重跑 unit + envelope integration，预期 PASS；提交**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationLogCollector.integration.test.ts
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): select current attempt logs"
```

## 任务 3：B builder 和同 snapshot 开发双输出

**文件：** 修改 builder/coordinator 与对应 unit/integration 测试。

- [ ] **步骤 1：写七项 allowlist、10 MiB 和 A 字节一致失败测试**

同一次 comparison 只调用一次 snapshot；解压 A/B 后共同四项逐字节相等。B 精确七项且未压缩总量不超过 10,485,760；先冻结 A 四项和两个 summary，剩余预算给 JSONL。

- [ ] **步骤 2：写一次目录选择、两个 partial 与 fail-open 测试**

开发模式只调用一次 `showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })`，固定输出 `cherry-migration-diagnostics-strict.zip` 和 `cherry-migration-diagnostics-log-assisted.zip`。日志读取失败时 B 仍保存并标 unavailable；publish 失败清本次 partial，不覆盖既有 final。

- [ ] **步骤 3：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.integration.test.ts \
  src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticsCoordinator.test.ts
```

- [ ] **步骤 4：实现 additive B builder**

不改 strict 四项序列化；B 接收 strict entries 和 collector output，追加三项并生成 B manifest。Production API 从 build config 取得 policy，IPC/UI 不传 policy；development API 一次生成 comparison。

- [ ] **步骤 5：重跑并执行 canary scan**

A canary 仍全部 0；B 的声明 credential/path/device canary 为 0，自然语言 residual fixture 允许存在并在 README/consent 说明。两包均无 DB/WAL/SHM/journal/export。

- [ ] **步骤 6：提交**

```bash
git add src/main/data/migration/v2/diagnostics
git commit --signoff -m "feat(data-migration): build log-assisted diagnostic archives"
```

## 任务 4：B 隐私确认且无 policy selector

**文件：** 新建 privacy dialog 及测试；修改 shared types、IPC handler/tests、MigrationApp/tests、components index、locales、native dialog tests。

- [ ] **步骤 1：写 consent transport 失败测试**

首次 `{ privacyConfirmed: false }` 在 B production 或 comparison 返回 `consent_required`，且不打开目标 dialog；确认 true 才打开。A production 直接保存。Input schema `.strict()`，含 policy/path 的输入 reject。

- [ ] **步骤 2：写四项风险与交互失败测试**

Dialog 必须说明：包含当前 session logs；credential/path 为 best-effort；用户输入或未知敏感信息可能保留；数据库及 sidecar 永不包含。Cancel 不保存；Confirm 再 invoke。页面不存在 A/B radio/select/toggle 或“详细程度”选项。

- [ ] **步骤 3：运行并确认 FAIL**

```bash
pnpm exec vitest run --project main src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/windows/migrationV2/components/__tests__/MigrationDiagnosticsPrivacyDialog.test.tsx \
  src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx
```

- [ ] **步骤 4：实现 transport、Dialog 和状态机**

`MigrationApp` 拥有 `diagnosticsPrivacyOpen`；consent_required 只开 dialog。Confirm 后复用 save callback 并传 true；pending 仍禁用 Save/Retry/Close。原生 crash/gate 流程在 B/comparison 下也先显示同样四项风险的 native i18n 版本。

- [ ] **步骤 5：重跑 IPC/UI/i18n/typecheck，预期 PASS；提交**

```bash
pnpm exec vitest run --project main \
  src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts \
  src/main/data/migration/v2/window/__tests__/migrationDiagnosticDialogs.test.ts
pnpm exec vitest run --project renderer \
  src/renderer/windows/migrationV2/components/__tests__/MigrationDiagnosticsPrivacyDialog.test.tsx \
  src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx
pnpm typecheck:node
pnpm typecheck:web
pnpm i18n:check
git add src/shared/data/migration/v2/types.ts src/main/data/migration/v2/window \
  src/renderer/windows/migrationV2
git commit --signoff -m "feat(data-migration): confirm log bundle privacy risk"
```

## 任务 5：同 fixture 盲评、真实邮件与最终候选

**文件：** 修改 high-priority fixture matrix 和设计文档候选结果；若执行时已有 ADR 目录，按其 README 新建记录，否则只更新设计文档。

- [ ] **步骤 1：同 snapshot 生成随机顺序 A/B 评审样本**

每个 fixture 分别评分是否识别 category、gate/migrator/phase、下一调查位置。记录只含 pass/fail 与理由，不复制包内日志。

- [ ] **步骤 2：隐私和近上限邮件验收**

B 声明规则 canary 为 0，entry 精确七项，未压缩不超过 10,485,760。构造接近 10 MiB 未压缩文本包，通过默认邮件客户端手动附加并发送至 `support@cherry-ai.com`，确认收件；记录 provider 与实际 ZIP bytes，不承诺所有企业 provider。

- [ ] **步骤 3：按固定规则选择**

A 覆盖全部高优先级 fixture 时默认选 A。仅当 B 对真实高优先级 case 提供 A 无法提供的实质定位且通过隐私评审时选 B。production PR 前删除 losing policy 与 comparison path，不保留用户 selector。

- [ ] **步骤 4：全量验证**

```bash
pnpm format
pnpm lint
pnpm test
pnpm build:check
git diff --check
```

预期：全部 exit 0。

- [ ] **步骤 5：提交比较证据**

```bash
git add docs/superpowers/specs/2026-07-18-migration-diagnostics-bundle-design.md \
  src/main/data/migration/v2/diagnostics/__tests__ src/renderer/windows/migrationV2
git commit --signoff -m "test(data-migration): compare diagnostic bundle policies"
```

## 自检

- 日志选择：任务 2；脱敏顺序：任务 1；residual risk/consent：任务 1、4。
- 一次目录选择、同 snapshot 双包：任务 3、4；10 MiB 与邮件：任务 3、5。
- stacked diff 与 A 默认胜出：分支约束和任务 5。
- 公共 transport 名称与 strict 计划一致；没有实现占位符。
