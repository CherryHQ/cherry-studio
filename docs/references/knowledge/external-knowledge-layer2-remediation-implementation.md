---
description: Test-driven remediation plan for the External Knowledge Layer 2 domain foundation
sources:
  - src/main/features/knowledge
  - src/main/data/services/ExternalKnowledgeConnectionService.ts
  - src/main/data/services/ExternalKnowledgeDocumentService.ts
  - src/main/data/db/schemas/externalKnowledgeDocument.ts
---

# External Knowledge Layer 2 Remediation Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用
> `superpowers-zh:subagent-driven-development`（推荐）或
> `superpowers-zh:executing-plans` 逐任务实施。每个行为改动遵循 TDD，步骤使用
> 复选框跟踪。

**目标：** 修复 Layer 2 中 Connection 删除、external ownership、snapshot 读取和索引复用边界，确保当前功能不会破坏已拥有的内容，并为后续同步提供安全的 prepare/publish 分界。

**架构：** 保留 `KnowledgeService` 作为唯一 lifecycle owner。SQLite 不变量由 direct-import data service 维护；普通 Knowledge workflow 负责 admission 和 job orchestration；索引流水线拆成无持久发布副作用的 preparation kernel 与 caller-owned publication。不会新增 lifecycle service、JobManager contract、vector-store contract 或同步 Job。

**技术栈：** TypeScript、better-sqlite3 + Drizzle、Vitest、JobManager、per-base `KeyedMutex`。

---

## 文件结构

### 修改

- `src/main/data/services/ExternalKnowledgeConnectionService.ts`：事务性地拒绝删除仍被 Source 引用的 Connection。
- `src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts`：真实 SQLite 删除契约。
- `src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`：durable delete 先于凭据 retirement。
- `src/main/features/knowledge/external/__tests__/ExternalKnowledgeRuntime.test.ts`：运行时删除顺序、失败恢复与清理契约。
- `src/main/ipc/handlers/knowledge.ts`、`src/shared/ipc/errors/knowledge.ts` 及对应测试：稳定的 Connection in-use 错误。
- `src/main/features/knowledge/ingestion/subtreePurge.ts`：普通 subtree purge 的 active-owner admission。
- `src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts`：add-replace 使用普通受保护 purge。
- `src/main/features/knowledge/tasks/prepareRootJobHandler.ts`：旧展开清理使用普通受保护 purge。
- `src/main/features/knowledge/tasks/reindexSubtreeJobHandler.ts`：container descendant cleanup 在任何 artifact 删除前执行 ownership admission。
- 对应 Knowledge integration/job handler 测试：验证拒绝时 row、snapshot、material 和状态均不改变。
- `src/main/features/knowledge/pipeline/readers/KnowledgeSnapshotReader.ts`：external snapshot 逐字读取，URL/note 才剥离 OKF frontmatter。
- reader 测试：保护 external Markdown 的合法 leading frontmatter。
- `src/main/features/knowledge/ingestion/indexKnowledgeItem.ts`：提取 preparation kernel；现有 Job composition 保持状态和发布行为。
- `src/main/features/knowledge/tasks/indexDocumentsJobHandler.ts` 及测试：适配拆分后的 operation，保持现有 Job contract。
- Knowledge 文档：记录 ownership admission、两阶段 indexing 和 snapshot 格式。

### 不修改

- `serviceRegistry.ts`、lifecycle decorators 或 lifecycle dependencies。
- JobManager job schema、recovery policy、vector-store public contract。
- Source/Document schema 和 `0026` migration；本修复不需要 schema 变化。
- Layer 3–6 的 provider traversal、sync job、schedule、UI。

## Task 1：Connection durable-delete-first

**失败会捕获：** 有任意 persisted Source 引用时，删除 Connection 不得撤销远端 token、删除本地 credential 或删除 Connection；成功删除时，SQLite durable reference 先消失，credential retirement 失败可由 startup reconciliation 收敛。

- [x] **步骤 1：为 data owner 编写失败的真实数据库测试**

在 `ExternalKnowledgeConnectionService.test.ts` 中创建 Connection 与 `active`/`paused`
Source，调用预期的新入口：

```ts
expect(() => externalKnowledgeConnectionService.removeUnreferenced(connection.id)).toThrowError(
  expect.objectContaining({ code: ErrorCode.INVALID_OPERATION })
)
expect(externalKnowledgeConnectionService.getById(connection.id)).not.toBeNull()
```

无 Source 时断言返回 `true` 且 row 不存在。测试必须使用 `setupTestDatabase()` 和生产 migration。

- [x] **步骤 2：运行单文件测试，确认因缺少 `removeUnreferenced` 而失败**

运行：

```bash
pnpm test:main src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts
```

预期：FAIL，新方法不存在或仍允许删除 referenced Connection。

- [x] **步骤 3：实现最小 data-owner transaction**

在 `ExternalKnowledgeConnectionService` 中增加：

```ts
removeUnreferenced(id: string): boolean {
  return application.get('DbService').withWriteTx((tx) => {
    const referenced = tx
      .select({ id: externalKnowledgeSourceTable.id })
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.connectionId, id))
      .limit(1)
      .get()
    if (referenced) {
      throw DataApiErrorFactory.invalidOperation(
        'remove external knowledge connection',
        'Connection is still referenced by an External Knowledge source'
      )
    }
    return this.removeTx(tx, id)
  })
}
```

通知仅在 transaction 成功提交后发布；若现有 helper 不能保证这一点，将 row mutation 与通知拆开，不引入新 service。

- [x] **步骤 4：为 runtime 编写失败测试**

扩展 injected `ConnectionStore`，使 `removeUnreferenced` 可抛 in-use 错误。断言：

```ts
await expect(runtime.removeUnreferencedConnection(connection.id)).rejects.toMatchObject({ code: 'connection-in-use' })
expect(providerRevokeCount).toBe(0)
expect(credentials.has(connection.credentialReference)).toBe(true)
```

成功路径记录事件顺序，断言 `connection-remove` 发生在 `provider-revoke` 与
`credential-remove` 之前；post-commit credential cleanup 失败不得恢复已删除 Connection。

- [x] **步骤 5：调整 runtime 与 IPC error mapping**

Runtime 在 drain 完成后调用 durable `removeUnreferenced`。in-use 时恢复 credential
generation/admission 并抛 `ExternalKnowledgeRuntimeError('connection-in-use')`。删除成功后复用
现有 `retireCredential` best-effort 语义，并移除 runtime state。

新增 `KNOWLEDGE_EXTERNAL_CONNECTION_IN_USE`，handler 映射到稳定 `IpcError`；不得把
SQLite FK 文本暴露给 renderer。

- [x] **步骤 6：运行 data/runtime/IPC 定向测试并提交**

提交信息：

```text
fix(external-knowledge): protect referenced connection removal
```

## Task 2：所有 destructive subtree path 执行 ownership admission

**失败会捕获：** active-owned external descendant 不能通过 add-replace、prepare-root stale expansion cleanup 或 container reindex 先丢失 vector/snapshot，再被 FK 阻止删 row。

- [x] **步骤 1：分别为三个入口增加失败测试**

测试建立包含 active-owned external descendant 的 subtree，并让 vector/file cleanup 在被调用时抛出 sentinel。期望操作以 `INVALID_OPERATION` 失败，而 sentinel 永不出现；数据库 row 和状态保持原值。

覆盖：

```text
KnowledgeIngestionService.addItems(..., 'replace')
knowledge.prepare-root stale descendant replacement
knowledge.reindex-subtree container descendant reset
```

- [x] **步骤 2：运行三个定向测试文件，确认 cleanup 当前先发生**

运行对应 `KnowledgeService.integration`、`prepareRootJobHandler` 和
`reindexSubtreeJobHandler` 测试文件。预期新增用例失败，原因是 cleanup 已被调用或
owned row 只在最后删除时触发 FK。

- [x] **步骤 3：建立普通 purge 的窄 admission helper**

在 `subtreePurge.ts` 中加入仅用于普通 Knowledge workflow 的检查：

```ts
function assertNoActiveExternalOwner(itemIds: readonly string[], operation: string): void {
  const owned = externalKnowledgeDocumentService.getActiveOwnedKnowledgeItemIds(itemIds)
  if (owned.size > 0) {
    throw DataApiErrorFactory.invalidOperation(
      operation,
      `Cannot purge ${owned.size} external knowledge item(s) managed by an active document owner`
    )
  }
}
```

检查必须发生在 `deleteKnowledgeItemVectors` 和文件删除之前。不要增加
`force`/`skipOwnershipCheck` 参数。

- [x] **步骤 4：复用 admission 而不改变 delete job recovery**

add-replace 与 prepare-root 继续调用普通 purge。reindex 的 inline descendant cleanup
在 artifact 删除前调用同一 admission helper或改用同一 purge primitive。
reindex ownership admission 只覆盖 selected container 会删除的 descendants；直接选择的
active-owned external leaf 保留 owner、row 和 pinned snapshot，只重建 derived index。

已由 `deleteItems` transaction 接纳的 delete job 仍可执行；未来 Document writer 必须禁止把 owner 绑定到 `deleting` item。本 Task 不实现未来 writer。

- [x] **步骤 5：运行定向测试并提交**

提交信息：

```text
fix(knowledge-ingestion): protect managed subtree artifacts
```

## Task 3：external snapshot 按 provider Markdown 逐字读取

**失败会捕获：** Provider-normalized Markdown 以合法 YAML frontmatter 开头时，第一段内容不会被当作 Cherry OKF metadata 丢弃。

- [x] **步骤 1：添加失败的 reader contract test**

在 `ReaderFactory.test.ts` 或 `KnowledgeReaderMetadata.test.ts` 写入：

```md
---
title: Provider document
---
# Body
```

external item 的 `Document.text` 必须与上述文件解码后的 UTF-8 文本逐字符一致；URL/note 现有测试继续要求剥离 Cherry frontmatter。

- [x] **步骤 2：运行 reader 测试确认红灯**

预期 external `Document.text` 缺少 leading frontmatter。

- [x] **步骤 3：按 item type 分支读取**

`loadSnapshotDocuments` 读取文件一次：

```ts
const snapshot = await read(filePath)
const text = item.type === 'external' ? snapshot : stripOkfFrontmatter(snapshot)
```

不检测内容形状，不为 external 增加 frontmatter heuristic。

- [x] **步骤 4：运行 reader/metadata 测试并提交**

提交信息：

```text
fix(knowledge-reader): preserve external markdown verbatim
```

## Task 4：拆分索引 preparation 与 publication

**失败会捕获：** 未来 external replacement 可以复用读取、chunk、embedding 逻辑，而不会把现有 completed item 改为 active 状态、提前替换 material 或创建已完成的中间可见 item。

- [x] **步骤 1：添加 preparation operation 的失败测试**

在 indexing operation 测试中直接调用新 preparation seam，断言它返回
`RebuildMaterialInput`，但 item 仍为 `completed`、store 中原 material 未改变。测试输入使用显式
`IndexableKnowledgeItem`，因此 preparation 不依赖把 staging item 先写入主数据库。

- [x] **步骤 2：运行测试确认新 seam 不存在**

预期 import/type 或调用失败，而不是已有行为偶然通过。

- [x] **步骤 3：提取无持久发布副作用的 preparation kernel**

定义窄输入与结果：

```ts
export interface PrepareKnowledgeMaterialInput {
  base: KnowledgeBase
  item: IndexableKnowledgeItem
  signal: AbortSignal
  reportProgress: IndexKnowledgeItemInput['reportProgress']
}

export interface PreparedKnowledgeMaterial {
  item: IndexableKnowledgeItem
  rebuildInput: RebuildMaterialInput
}
```

`prepareKnowledgeMaterial` 负责 snapshot/document 读取、chunk、local-token refinement、embedding reuse 和 empty-content rejection。它不得：

- 接受非 `completed` base、无效 material path，或已 abort 的调用；
- 为 embedding reuse 打开 store 或执行宽泛扫描；caller 只可注入当前 chunk hash 集合的窄查询；

- 更新 KnowledgeItem status；
- 写 vector store；
- 移动或覆盖 snapshot；
- 标记 item completed。

URL/note 首次 capture 仍属于现有 Job composition，因为它会持久化 live item 的
`relativePath`；external preparation 只消费 caller 提供的 pinned/staged snapshot。

- [x] **步骤 4：让现有 `indexKnowledgeItem` 组合新 kernel**

保持现有调用形状和 Job 语义：load/skip → status `reading` → URL/note capture → preparation → status `embedding`/progress → base lock 内 live-item recheck → `rebuildMaterial` → `completed`。

现有 Job handler 不获得 publication 策略参数，不修改 JobManager contract。

- [x] **步骤 5：验证现有 indexing observable contract**

运行完整 `indexDocumentsJobHandler.test.ts`：embedding reuse、BM25、abort、empty text、URL/note capture、deleting race、write failure 全部保持通过。新增 preparation 测试验证 completed external item 可以被显式准备且没有 publish 副作用。

- [x] **步骤 6：提交**

提交信息：

```text
refactor(knowledge-indexing): separate preparation from publish
```

## Task 5：修正文档契约并完成验证

- [x] **步骤 1：更新设计文档**

修正：

- `workflow-architecture.md`：共享的是 preparation kernel；publication 由 Job 或未来 synchronizer 分别拥有。
- `knowledge-service.md`：external snapshot 无 Cherry OKF frontmatter；Connection 先 durable delete 再 retire credential。
- `operation-guards.md`：`deleteItems` ownership transaction、普通 subtree purge 的前置 admission 和 review checklist。
- `src/main/features/knowledge/README.md`：目录职责与两阶段索引边界。

未来同步的 visibility commit 固定为：锁外 stage/prepare；锁内 revision recheck；新
snapshot/material 在没有主数据库 row 时不可见；一个 `withWriteTx` 创建 completed item、切换 Document owner/hash/revision，并删除已失去 owner 的旧 Item row；提交后 best-effort 清理旧 snapshot/vector，失败由 reconciliation 收敛。

- [x] **步骤 2：更新生成的 docs index**

运行 `pnpm docs:index`，只接受生成器对 `docs/README.md` 的改动。

- [x] **步骤 3：针对性验证**

运行全部修改到的 main/shared 测试。数据库测试必须使用真实 migration 数据库；无 schema
变化，因此不重新生成 `0026`。

- [x] **步骤 4：仓库门禁与 diff 自审**

运行 `pnpm db:migrations:check`、`pnpm lint`、`pnpm docs:check`、
`pnpm build:check` 和相对 Layer 2 base 的 `git diff --check`。检查没有新增 lifecycle service、
通用 bypass、跨层深导入或未使用的 future CRUD。

- [x] **步骤 5：提交文档与最终修正**

提交信息：

```text
docs(knowledge): define external publication boundaries
```

## Task 6：允许 active-owned external leaf 重建 derived index

- [x] 将直接选择的 active-owned external leaf 契约改为 probe 并 enqueue，先确认旧 guard 使测试失败。
- [x] 将 reindex ownership admission 收窄到 selected container 会删除的 descendants；entrypoint、producer-failure race 和锁内 reset 使用同一边界。
- [x] 保留 container descendant race 的拒绝测试，并验证直接 leaf 只重建 vector、保留 row、owner 和 pinned snapshot。
- [x] 同步本文、`knowledge-service.md`、`operation-guards.md` 与 feature README，并运行定向测试和文档门禁。

提交信息：

```text
fix(knowledge-indexing): allow managed leaf reindex
```

每个 commit 使用 `git commit -S --signoff`，提交后检查 `gpgsig` 与
`Signed-off-by`。正常 push，禁止 force push。
