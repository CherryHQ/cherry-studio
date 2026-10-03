---
description: Test-driven implementation plan for remediating the Feishu Connection foundation in PR 20699
sources:
  - docs/references/knowledge/feishu-connection-fix-design.md
  - src/main/features/knowledge/external
  - src/main/data/services/ExternalKnowledgeConnectionService.ts
  - src/main/services/feishuAppRegistration.ts
---

# Feishu Connection Foundation Remediation Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers-zh:executing-plans` 在专用 worktree 中逐任务实施本计划。每项任务都按测试先行执行，并使用复选框跟踪进度。

**目标：** 修复 PR #20699 的稳定用户身份、凭据原子替换、运行时验证、启动准入、注册协议和安全存储缺陷，使其可以作为 #15970 的 Stack PR1 基座。

**架构：** 保留现有 Knowledge-owned Connection/runtime/credential-store 边界。跨 App 身份使用 `tenantKey + accountUserId`；重授权把完整候选凭据写入新的 opaque reference，再用一条 SQLite compare-and-swap 切换 Connection。`KnowledgeService` 继续持有 runtime 生命周期，不新增全局 OAuth、Credential Service、队列或 lifecycle service。

**技术栈：** TypeScript、Electron `safeStorage`/`net.fetch`、Zod、better-sqlite3 + Drizzle、Vitest、IpcApi/DataApi。

---

先阅读 [`feishu-connection-fix-design.md`](./feishu-connection-fix-design.md)、根目录
`AGENTS.md`、`CLAUDE.md`，以及存在时的 `CLAUDE.local.md`。设计文档是行为契约；本计划固定实施顺序、文件、测试和提交边界。

## 文件结构

### 修改

- `src/shared/data/types/externalKnowledgeConnection.ts`：renderer-safe Connection schema 和稳定用户身份约束。
- `src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts`：共享实体契约测试。
- `src/main/data/db/schemas/externalKnowledgeConnection.ts`：`account_user_id`、CHECK 和默认值归属。
- `src/main/data/services/ExternalKnowledgeConnectionService.ts`：Connection create、identity validation 和 reauthorization CAS。
- `src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts`：真实 SQLite 服务契约。
- `src/main/data/db/__tests__/applyMigrations.populated.test.ts`：真实迁移和约束验证。
- `src/main/features/knowledge/external/feishuKnowledgeProvider.ts`：必需 scope、`user_id`、请求 timeout 和错误分类。
- `src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts`：Feishu HTTP 契约。
- `src/main/features/knowledge/external/ExternalKnowledgeCredentialStore.ts`：安全 backend、引用枚举和原子文件替换。
- `src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts`：凭据安全与恢复测试。
- `src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`：候选凭据、reconciliation、验证、admission 和 registration-session 所有权。
- `src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`：授权、并发、恢复与 lifecycle 测试。
- `src/main/services/feishuAppRegistration.ts`：共享 PersonalAgent registration 协议。
- `src/main/services/__tests__/feishuAppRegistration.test.ts`：registration begin/poll/deadline 测试。
- `src/shared/ipc/errors/knowledge.ts`：稳定的 Knowledge/Feishu IPC error codes。
- `src/main/ipc/handlers/knowledge.ts`：runtime error 到 IPC error 的映射。
- `src/main/ipc/handlers/__tests__/knowledge.test.ts`：真实 IpcRouter/handler 行为。
- `docs/references/knowledge/feishu-connection-fix-design.md`：仅在实现证据推翻已确认细节时修正，不扩展范围。

### 删除并重新生成

- 删除当前未发布的 `migrations/sqlite-drizzle/0024_flaky_domino.sql`。
- 删除当前未发布的 `migrations/sqlite-drizzle/meta/0024_snapshot.json`。
- 从 PR base 恢复 `_journal.json` 后运行生成器，提交生成器给出的新 `0024_<name>.sql`、snapshot 和 journal。不得人工指定或修改 basename。

### 删除

- `src/shared/ipc/schemas/__tests__/knowledge.test.ts`：仓库禁止的 per-domain schema test。

## Task 1：持久化稳定的 Feishu 用户身份

**文件：**

- 修改：`src/shared/data/types/externalKnowledgeConnection.ts`
- 修改：`src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts`
- 修改：`src/main/data/db/schemas/externalKnowledgeConnection.ts`
- 修改：`src/main/data/services/ExternalKnowledgeConnectionService.ts`
- 修改：`src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts`
- 修改：`src/main/features/knowledge/external/feishuKnowledgeProvider.ts`
- 修改：`src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`
- 修改：`src/main/data/db/__tests__/applyMigrations.populated.test.ts`
- 重新生成：`migrations/sqlite-drizzle/0024_*.sql`、`meta/0024_snapshot.json`、`meta/_journal.json`

- [ ] **步骤 1：先让共享实体和 provider 身份测试失败**

在 `validConnection`、`connectedIdentity`、runtime Connection/provider fixtures 中加入：

```ts
accountUserId: 'user_example'
```

pending fixtures 使用：

```ts
accountUserId: null
```

新增这些契约测试：

```ts
it('requires accountUserId on a connected connection', async () => {
  const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')
  expect(ExternalKnowledgeConnectionSchema.safeParse({ ...validConnection, accountUserId: null }).success).toBe(false)
})

it('rejects accountUserId on a pending connection', async () => {
  const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')
  expect(
    ExternalKnowledgeConnectionSchema.safeParse({
      ...validConnection,
      authorizationStatus: 'pending-authorization',
      accountUserId: 'user_example',
      accountOpenId: null,
      accountUnionId: null,
      tenantKey: null,
      displayName: null,
      avatarUrl: null,
      grantedScopes: [],
      authorizedAt: null,
      lastValidatedAt: null
    }).success
  ).toBe(false)
})
```

在 provider 测试中断言 device authorization 请求包含五项必需权限，并让 user-info
响应携带 `user_id: 'user_example'`。新增缺少 `user_id` 时产生
`identity-unverifiable` 的测试。

- [ ] **步骤 2：运行最小测试并确认红灯原因**

运行：

```bash
pnpm test:shared src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts
pnpm test:main src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
```

预期：schema 不认识 `accountUserId`；provider 未请求 identity scope、未解析
`user_id`；runtime 仍按 `open_id` 比较。

- [ ] **步骤 3：实现稳定身份和 scope contract**

在 shared schema 加入：

```ts
accountUserId: NullableNonBlankStringSchema,
```

pending 禁止字段包含 `accountUserId`；connected 必填字段为：

```ts
for (const field of ['accountUserId', 'accountOpenId', 'tenantKey', 'authorizedAt'] as const) {
  if (value[field] === null) {
    ctx.addIssue({ code: 'custom', path: [field], message: `Connected connection requires ${field}` })
  }
}
```

在 provider 中定义并实际请求：

```ts
export const FEISHU_IDENTITY_USER_SCOPE = 'auth:user.id:read' as const
export const FEISHU_REQUIRED_USER_SCOPES = [
  ...FEISHU_KNOWLEDGE_USER_SCOPES,
  FEISHU_IDENTITY_USER_SCOPE
] as const

export const FEISHU_AUTOMATIC_ALLOWED_SCOPES = new Set<string>(FEISHU_REQUIRED_USER_SCOPES)
```

`missingKnowledgeScopes()` 检查 `FEISHU_REQUIRED_USER_SCOPES`；automatic
registration 也传该数组。user-info schema 要求 `user_id`，并映射：

```ts
export type FeishuUserIdentity = {
  accountUserId: string
  accountOpenId: string
  accountUnionId: string | null
  tenantKey: string
  displayName: string | null
  avatarUrl: string | null
}
```

缺失 `data.user_id` 时抛：

```ts
throw new FeishuProviderError('identity-unverifiable', true)
```

其他 malformed user-info 仍使用 `invalid-response`。

- [ ] **步骤 4：修改数据 schema、create defaults 和 identity comparator**

数据库 schema：

```ts
provider: text().$type<ExternalKnowledgeConnectionProvider>().notNull(),
accountOpenId: text(),
accountUserId: text(),
accountUnionId: text(),
```

把 `account_user_id` 加入 non-empty、connected-required 和 pending-null CHECK。
保留 `grantedScopes` 的数据库 `[]` default。

Connection service 的 identity schema 加入必需的 `accountUserId`。Create schema
使用：

```ts
applicationName: NullableNonBlankStringSchema.optional()
```

create 只写：

```ts
.values({
  provider: 'feishu',
  ...parsed,
  authorizationStatus: 'pending-authorization'
})
```

runtime error union 增加 `identity-conflict` 和 `identity-unverifiable`，并用：

```ts
private assertMatchingIdentity(
  connection: ExternalKnowledgeConnection,
  identity: FeishuUserIdentity
): void {
  if (!connection.accountUserId || !identity.accountUserId) {
    throw new ExternalKnowledgeRuntimeError('identity-unverifiable')
  }
  if (connection.tenantKey !== identity.tenantKey || connection.accountUserId !== identity.accountUserId) {
    throw new ExternalKnowledgeRuntimeError('identity-conflict')
  }
}
```

仅 reconnect 调用该检查；initial authorization 没有旧身份。`open_id` 不参与跨 App
判断。

- [ ] **步骤 5：重新生成未发布的 0024 并测试真实迁移**

运行：

```bash
git rm migrations/sqlite-drizzle/0024_flaky_domino.sql
git rm migrations/sqlite-drizzle/meta/0024_snapshot.json
git restore --source=af8b4eafc0fd418faf4006af7a728dc8a1a8664b -- migrations/sqlite-drizzle/meta/_journal.json
pnpm db:migrations:generate
```

不得修改生成器给出的文件名。扩展 populated migration test，断言
`account_user_id` 存在、`provider` 没有 DB default、`granted_scopes` 仍由 DB
默认成 `[]`，省略 provider 的 raw insert 因 NOT NULL 失败，并验证
`foreign_key_check` 与 `integrity_check`。

运行：

```bash
pnpm db:migrations:check
pnpm test:shared src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts
pnpm test:main src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts
git diff --check
```

预期：全部退出 `0`。

- [ ] **步骤 6：提交稳定身份变更**

```bash
git add migrations/sqlite-drizzle src/shared/data/types/externalKnowledgeConnection.ts src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts src/main/data/db/schemas/externalKnowledgeConnection.ts src/main/data/services/ExternalKnowledgeConnectionService.ts src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts src/main/features/knowledge/external/feishuKnowledgeProvider.ts src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git commit -S --signoff -m "fix(external-knowledge): persist stable Feishu user identity"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format=%B HEAD | rg '^Signed-off-by:'
```

## Task 2：原子提交重授权凭据

**文件：**

- 修改：`src/main/data/services/ExternalKnowledgeConnectionService.ts`
- 修改：`src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeCredentialStore.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`

- [ ] **步骤 1：先写 CAS、候选凭据和 crash-boundary 失败测试**

删除 service 中旧的“提前替换 App metadata”测试，新增：

```text
commits reauthorization with one guarded credential-reference swap
rejects a stale reauthorization CAS without changing the committed connection
reports a missing connection separately from a stale credential reference
rejects using the active credential reference as its own candidate
```

runtime 新增：

```text
keeps the active reference, application metadata and credential bytes unchanged while reconnect authorization is pending
commits a reconnect to a new credential reference and retires the old credential
removes the candidate and preserves the old credential when the CAS is stale
removes the candidate and preserves the old credential on cancellation or terminal authorization failure
removes an unreferenced candidate during startup reconciliation
keeps the referenced candidate and removes the old entry after a post-CAS crash
preserves a pending initial connection without credentials and marks it reauthorization-required
does not prune any credential when enumeration is corrupt or undecryptable
```

加强 identity-conflict 测试：old reference、App metadata 和 credential bytes 必须完全不变。

- [ ] **步骤 2：运行目标测试并确认现有提前覆盖行为失败**

```bash
pnpm test:main src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
```

预期：现有 `updateApplication()` 和同 reference `put()` 会使保护旧凭据的断言失败。

- [ ] **步骤 3：实现 Connection CAS**

删除 `ExternalKnowledgeApplicationSchema` 和 `updateApplication()`。新增包含
`expectedCredentialReference`、`candidateCredentialReference`、App metadata 和
`identity` 的 strict schema，并拒绝两个 reference 相同。

公开签名：

```ts
commitReauthorization(
  id: string,
  input: CommitExternalKnowledgeReauthorizationInput
): ExternalKnowledgeConnection
```

使用一条同步 UPDATE：

```ts
.where(
  and(
    eq(externalKnowledgeConnectionTable.id, id),
    eq(externalKnowledgeConnectionTable.credentialReference, parsed.expectedCredentialReference),
    eq(externalKnowledgeConnectionTable.authorizationStatus, 'reauthorization-required')
  )
)
```

同一次 `.set()` 写入 candidate reference、App metadata、identity/scopes、
`connected`、`authorizedAt` 和 `lastValidatedAt`。零行时再次 `getById()`：不存在则
`notFound`，否则抛 `DataApiErrorFactory.concurrentModification()`。单条 UPDATE 已原子，
不要增加 `withWriteTx()`。

- [ ] **步骤 4：给凭据存储增加可用性探针和最小引用枚举**

新增类型和方法：

```ts
export type ExternalKnowledgeCredentialReferenceListResult =
  | { status: 'ok'; credentialReferences: string[] }
  | { status: 'missing' | 'corrupt' | 'undecryptable' }

assertAvailable(): void
async listReferences(): Promise<ExternalKnowledgeCredentialReferenceListResult>
```

`listReferences()` 只在文件 schema 正常且 encryption 可用时返回 keys；missing、corrupt、
undecryptable 原样返回，绝不 rewrite。`remove()` 在 rewrite 前再次检查 encryption
availability。

- [ ] **步骤 5：把 authorization session 改成 candidate-reference 流程**

session 使用这些持久化相关字段：

```ts
stateCredentialReference: string
candidateCredentialReference: string
expectedCredentialReference: string | null
```

`beginAuthorization()` 必须按此顺序：

1. 同步 `credentials.assertAvailable()`。
2. 为每次调用生成新的 `feishu:${randomUUID()}` candidate。
3. reconnect 继续用 old reference 找 runtime state，既不更新 App metadata，也不写文件。
4. initial 用 candidate 作为 state reference。
5. 以内存 App credentials 开始 device authorization。
6. initial 在 device begin 成功后创建引用 candidate 的 pending Connection。
7. session 记录 candidate 和 expected old reference。

`completeAuthorization()` 必须按此顺序：

1. exchange token 到内存；
2. 校验五项 required scopes；
3. 获取 identity；
4. reconnect 校验 `tenantKey + accountUserId`；
5. 将完整候选 credential 写入 candidate reference；
6. 再做 generation check；
7. initial 使用 `markConnected()`，reconnect 使用 `commitReauthorization()`；
8. 标记 candidate 已 durable commit；
9. reconnect 同步 re-key runtime state；
10. best-effort revoke/remove old credential。

新增窄 helper：

```ts
private rekeyCredentialState(
  expectedReference: string,
  candidateReference: string,
  state: CredentialRuntimeState,
  generation: number
): void

private async retireCredential(credentialReference: string, signal: AbortSignal): Promise<void>
```

任何失败只要 candidate 尚未提交，就 best-effort 删除 candidate。CAS miss、scope、身份、
terminal error、cancel 和 stale generation 都不得写 old reference。

- [ ] **步骤 6：实现启动 orphan reconciliation**

从一次 Connection snapshot 生成：

```ts
const referenced = new Set(connections.map((connection) => connection.credentialReference))
```

先执行现有本地 credential reconciliation，再调用 `listReferences()`。仅 `status === 'ok'`
时顺序删除未引用 entries；missing/corrupt/undecryptable 时不 prune、不 rewrite。pending 且
没有凭据时保留 Connection 并转成 `reauthorization-required`。

- [ ] **步骤 7：运行回归并提交**

```bash
pnpm test:main src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
pnpm test:shared src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts
git diff --check
git add src/main/data/services/ExternalKnowledgeConnectionService.ts src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/features/knowledge/external/ExternalKnowledgeCredentialStore.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git commit -S --signoff -m "fix(external-knowledge): commit reauthorization atomically"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format=%B HEAD | rg '^Signed-off-by:'
```

## Task 3：修正运行时验证和启动准入

**文件：**

- 修改：`src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`

- [ ] **步骤 1：先写 explicit validation、terminal validation 和 startup 失败测试**

新增：

```text
performs a fresh identity request for explicit validation after cached admission
coalesces concurrent explicit validations after invalidating the cache
marks terminal identity validation failures as requiring reauthorization before provider admission
keeps admission closed and shares startup reconciliation until it finishes
waits for startup reconciliation to settle while stopping
```

terminal identity 测试必须断言 provider operation 没有执行；startup 测试使用 deferred
credential read，让两个 `start()` 共享同一个 reconciliation。

- [ ] **步骤 2：运行测试并确认失败路径**

```bash
pnpm test:main src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts -t 'explicit validation|terminal identity|startup reconciliation'
```

预期：显式验证命中缓存；identity terminal error 不改状态；reconciliation 未完成时
`accepting` 已为 true。

- [ ] **步骤 3：让显式验证绕过缓存但继续 single-flight**

保持公开签名不变：

```ts
async validateConnection(connectionId: string): Promise<ExternalKnowledgeConnection> {
  this.assertAccepting()
  const connection = this.requireConnection(connectionId)
  const state = this.getCredentialState(connection.credentialReference)
  state.validatedGeneration = undefined
  return await this.runAuthorizedRequest(connectionId, async () => this.requireConnection(connectionId))
}
```

不要给 `runAuthorizedRequest()` 增加公开 `forceValidation` 参数，也不要增加第二套 validation
flight。

- [ ] **步骤 4：扩大 terminal-error boundary**

在 credential lane 内用同一 try/catch 包住 access-token acquisition、identity validation
和实际 operation：

```ts
try {
  const accessToken = await this.acquireAccessToken(connectionId, signal)
  assertCurrent()
  await this.ensureConnectionValidated(connection, accessToken, state, generation, signal)
  assertCurrent()
  return await this.runCredentialRequest(state, generation, signal, () =>
    operation(accessToken, signal, assertCurrent)
  )
} catch (error) {
  assertCurrent()
  if (!(error instanceof FeishuProviderError) || !error.terminal) throw error
  this.markReauthorizationRequiredIfCurrent(connectionId, state, generation)
  throw new ExternalKnowledgeRuntimeError(
    error.code === 'app-scope-missing' ? 'scope-missing' :
      error.code === 'identity-unverifiable' ? 'identity-unverifiable' :
        'reauthorization-required'
  )
}
```

transient、timeout 和 abort 不进入持久状态转换。

- [ ] **步骤 5：增加最小 `startFlight`**

新增：

```ts
private startFlight?: Promise<void>
```

`start()` 在 reconcile 成功且 lifetime 未 abort 后才设 `accepting = true`；并发 start
await 同一个 flight。`stop()` 先关闭 admission、abort lifetime 和所有 session/state controller，
再同时等待捕获的 `startFlight` 与 `inFlight`，最后清理 maps。不要新增 phase enum，也不要
修改 `KnowledgeService` lifecycle phase/dependencies。

- [ ] **步骤 6：运行 runtime 文件并提交**

```bash
pnpm test:main src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git diff --check
git add src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git commit -S --signoff -m "fix(external-knowledge): make runtime validation authoritative"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format=%B HEAD | rg '^Signed-off-by:'
```

## Task 4：加固 registration、HTTP 和 credential transport

**文件：**

- 修改：`src/main/services/feishuAppRegistration.ts`
- 修改：`src/main/services/__tests__/feishuAppRegistration.test.ts`
- 修改：`src/main/features/knowledge/external/feishuKnowledgeProvider.ts`
- 修改：`src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeCredentialStore.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts`

- [ ] **步骤 1：先写 registration 协议和 deadline 失败测试**

新增：

```text
prefers canonical expire_in and accepts expires_in only as a compatibility fallback
rejects failed and malformed registration responses without exposing provider payloads
aborts an in-flight poll when the registration deadline expires
retries a timed-out poll request within the registration deadline
preserves caller cancellation instead of classifying it as a request timeout
```

addons 测试改名为 `encodes only the requested PersonalAgent user scopes`，断言输出不能含
tenant scope。

- [ ] **步骤 2：实现局部 registration decoder 和双层 timeout**

在 registration 模块内定义：

```ts
const REGISTRATION_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const DEFAULT_EXPIRY_SECONDS = 600
const MAX_POLL_INTERVAL_MS = 60_000

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
```

使用局部 Zod schemas 校验 JSON object、begin 和 poll 字段。HTTP 非 2xx、非对象、缺失
字段和未知 provider error 都返回固定文案，不拼接 response body/error description。
expiry 使用：

```ts
positiveInteger(data.expire_in) ?? positiveInteger(data.expires_in) ?? DEFAULT_EXPIRY_SECONDS
```

poll 创建 session deadline signal，并与 caller signal 组合；同一 signal 同时传给 delay 和
fetch。每次 fetch 另加 30 秒 timeout。request timeout 在总 deadline 内按 transient 继续；
caller abort 映射 aborted；deadline abort 映射 timed out。`slow_down` 上限 60 秒。保留
Channel 现有先等待 interval 再首 poll 的节奏。

- [ ] **步骤 3：给 Knowledge provider 的每次 fetch 增加 30 秒 timeout**

先新增：

```text
classifies the internal request timeout as transient
preserves caller cancellation when it wins the combined request signal
```

实现：

```ts
const FEISHU_REQUEST_TIMEOUT_MS = 30_000
const callerSignal = init.signal ?? undefined
const timeoutSignal = AbortSignal.timeout(FEISHU_REQUEST_TIMEOUT_MS)
const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
```

caller abort 原样抛；其他 transport/timeout 变成现有 non-terminal `transient`。不要增加 IPC
timeout code 或共享 timeout abstraction。

- [ ] **步骤 4：使 registration session 单次消费且仍可取消**

先新增：

```text
allows only one consumer to claim a PersonalAgent registration session
can cancel a PersonalAgent registration after its session is claimed
```

session 加入：

```ts
claimed: boolean
```

`resolveApplicationCredentials()` 在第一个 await 前同步 get、拒绝 missing/already claimed、
再设 `claimed = true`。entry 保留到 finally，以便现有 cancel 找到 controller；finally 仅在
map 中仍是同一对象时删除。

- [ ] **步骤 5：拒绝 Linux `basic_text` 并复用 canonical atomic write**

先新增：

```text
fails closed for the Linux basic_text safeStorage backend
does not decrypt or rotate credentials after Linux safeStorage falls back to basic_text
```

adapter 包含：

```ts
export type SafeStorageAdapter = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'
>
```

Linux 只接受 `gnome_libsecret`、`kwallet`、`kwallet5`、`kwallet6`；`basic_text` 和
`unknown` fail-closed。read/rotate/assertAvailable 复用同一判定。

`replace()` 使用：

```ts
const filePath = AbsoluteFilePathSchema.parse(this.filePath)
await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
await atomicWriteFile(filePath, `${JSON.stringify(credentialFileSchema.parse(file), null, 2)}\n`, {
  mode: 0o600
})
```

删除本地 random UUID/tmp/rename/chmod/rm 实现，不扩展公共 filesystem API。

- [ ] **步骤 6：运行四组测试并提交**

```bash
pnpm test:main src/main/services/__tests__/feishuAppRegistration.test.ts src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts
git diff --check
git add src/main/services/feishuAppRegistration.ts src/main/services/__tests__/feishuAppRegistration.test.ts src/main/features/knowledge/external/feishuKnowledgeProvider.ts src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts src/main/features/knowledge/external/ExternalKnowledgeCredentialStore.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts
git commit -S --signoff -m "fix(feishu-auth): harden registration and credential transport"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format=%B HEAD | rg '^Signed-off-by:'
```

## Task 5：收窄 Layer 1 公共契约

**文件：**

- 修改：`src/shared/ipc/errors/knowledge.ts`
- 修改：`src/main/ipc/handlers/knowledge.ts`
- 修改：`src/main/ipc/handlers/__tests__/knowledge.test.ts`
- 修改：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`
- 删除：`src/shared/ipc/schemas/__tests__/knowledge.test.ts`

- [ ] **步骤 1：先写 distinct IPC error 测试**

通过真实 `knowledge.feishu.connection.validate` handler 建表测试：

```text
scope-missing              -> KNOWLEDGE_FEISHU_SCOPE_MISSING
automatic-scope-mismatch   -> KNOWLEDGE_FEISHU_AUTOMATIC_SCOPE_MISMATCH
identity-conflict          -> KNOWLEDGE_FEISHU_IDENTITY_CONFLICT
identity-unverifiable      -> KNOWLEDGE_FEISHU_IDENTITY_UNVERIFIABLE
reauthorization-required   -> KNOWLEDGE_EXTERNAL_REAUTHORIZATION_REQUIRED
```

每个消息使用固定文案，不包含 provider payload、App ID、用户 ID 或 credential reference。

- [ ] **步骤 2：增加 error code 并拆开 handler mapping**

新增：

```ts
FEISHU_AUTOMATIC_SCOPE_MISMATCH: 'KNOWLEDGE_FEISHU_AUTOMATIC_SCOPE_MISMATCH',
FEISHU_IDENTITY_CONFLICT: 'KNOWLEDGE_FEISHU_IDENTITY_CONFLICT',
FEISHU_IDENTITY_UNVERIFIABLE: 'KNOWLEDGE_FEISHU_IDENTITY_UNVERIFIABLE',
```

`mapExternalKnowledgeError()` 为每个 runtime code 使用独立 case；不得再把 automatic mismatch
合并到 scope missing。

- [ ] **步骤 3：删除 speculative/误导测试表面**

确认 Task 4 已从 `RegistrationVerificationOptions.addons` 删除 `tenantScopes`。删除：

```bash
git rm src/shared/ipc/schemas/__tests__/knowledge.test.ts
```

不要迁移其 `safeParse` 断言。真实非法输入由现有 `IpcRouter.dispatch` 测试覆盖；在 automatic
authorization runtime 测试中保留返回对象不含 secret sentinel 的断言。

- [ ] **步骤 4：运行目标测试并提交**

```bash
pnpm test:main src/main/ipc/handlers/__tests__/knowledge.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git diff --check
git add src/shared/ipc/errors/knowledge.ts src/main/ipc/handlers/knowledge.ts src/main/ipc/handlers/__tests__/knowledge.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts
git commit -S --signoff -m "refactor(external-knowledge): narrow layer-one contracts"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format=%B HEAD | rg '^Signed-off-by:'
```

## Task 6：最终验证与交付检查

**文件：**

- 按实际结果更新：PR #20699 body 的 validation 列表。
- 按已确认契约更新：Issue #15970 当前方案 comment 中的技术身份权限与匹配规则。

- [ ] **步骤 1：运行全部定向测试**

```bash
pnpm test:shared src/shared/data/types/__tests__/externalKnowledgeConnection.test.ts
pnpm test:main src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts src/main/services/__tests__/feishuAppRegistration.test.ts src/main/features/knowledge/external/__tests__/feishuKnowledgeProvider.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeCredentialStore.test.ts src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts src/main/ipc/handlers/__tests__/knowledge.test.ts
pnpm db:migrations:check
```

预期：全部退出 `0`。

- [ ] **步骤 2：运行跨边界最终门禁**

```bash
pnpm lint
pnpm build:check
pnpm docs:check
git diff --check af8b4eafc0fd418faf4006af7a728dc8a1a8664b..HEAD
```

预期：全部退出 `0`；工作树只包含计划内提交。

- [ ] **步骤 3：审计提交和范围**

```bash
git log --show-signature --format=fuller af8b4eafc0fd418faf4006af7a728dc8a1a8664b..HEAD
git diff --stat af8b4eafc0fd418faf4006af7a728dc8a1a8664b..HEAD
git status --short --branch
```

确认每个新增 commit 有 `gpgsig` 和 `Signed-off-by`，没有 Source、Document、sync Job、schedule、
UI、Lark、bot-only 或全局 auth infrastructure。

- [ ] **步骤 4：更新远端说明但不伪造验证结果**

Issue 当前方案 comment 明确写入：

```text
auth:user.id:read is required for both PersonalAgent and self-built application flows.
Cross-application replacement retains the Connection ID only when tenant_key + user_id match.
open_id remains application-scoped and is not used for cross-application identity matching.
```

PR body 只记录实际运行并通过的命令。若 GitHub CI 因 Draft 仍是 skipped，不写成 passed；在准备
转 Ready 前报告该状态。普通 push 可以按用户授权执行，禁止 force push。

- [ ] **步骤 5：等待 GitHub CI 并给出最终验收报告**

CI 必须实际运行且所有 required checks 通过，才能声明 #20699 满足 Stack PR1。报告应区分：

```text
local focused checks
local full gate
GitHub CI
remaining non-blocking follow-ups
```
