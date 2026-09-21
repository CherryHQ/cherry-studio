# External Knowledge 手动同步修复实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 PR #20856 的持久清理、停止顺序、超时投影和来源创建校验问题，同时保留现有 Knowledge、JobManager 和 lifecycle 边界。

**架构：** 复用 `KnowledgeItem.status = 'deleting'` 与 `knowledge.delete-subtree` 作为外部快照和向量的持久清理记录；`KnowledgeService` 继续拥有 runtime，并以 owner-local gate 和 cancel-before-stop 顺序管理退出。来源创建在远端 scope resolution 后使用同一写事务重新验证 base、connection 和 source identity，IPC 仅暴露稳定的 Knowledge domain error。

**技术栈：** TypeScript、Electron main process、better-sqlite3、Drizzle ORM、JobManager、Vitest 3、pnpm。

---

## 文件结构

- 创建 `src/main/features/knowledge/ingestion/subtreeDeletion.ts`：统一构造、事务接纳和恢复 `knowledge.delete-subtree` 任务。
- 创建 `src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts`：验证队列、幂等键、分块和 base 过滤。
- 修改 `KnowledgeItemService.ts`：持久创建 deleting external staging item，并以 CAS 提升为 completed。
- 修改 `KnowledgeIngestionService.ts` 和 `subtreePurge.ts`：普通删除复用 helper；external 快照严格删除。
- 修改 `ExternalKnowledgeSyncService.ts`：用 deleting staging row 与持久删除任务替代直接补偿清理。
- 修改 `ExternalKnowledgeSyncAdmission.ts` 及三个 data service：增加 gate、tx-current target 校验和安全 conflict。
- 修改 `KnowledgeService.ts`：关闭 gate、取消并结算同步任务后再停止 runtime。
- 修改 `syncExternalSourceJobHandler.ts`：区分 handler timeout、取消和业务失败。
- 修改 Knowledge IPC errors/handler 和相邻测试，提供稳定错误协议。
- 更新现行 Knowledge 文档；最终删除本计划和对应设计规格。

### 任务 1：建立 deleting external staging 与统一删除接纳原语

**文件：**

- 创建：`src/main/features/knowledge/ingestion/subtreeDeletion.ts`
- 创建：`src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts`
- 修改：`src/main/data/services/KnowledgeItemService.ts`
- 测试：`src/main/data/services/__tests__/KnowledgeItemService.test.ts`
- 修改：`src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts`
- 修改：`src/main/features/knowledge/KnowledgeService.ts`
- 测试：`src/main/features/knowledge/__tests__/KnowledgeService.test.ts`

- [ ] **步骤 1：为 deleting staging item 写失败测试**

在 `KnowledgeItemService.test.ts` 的 `external synchronization mutations` 中先加入固定 fixture，再写入以下契约：

```ts
const STAGED_ITEM_ID = '0198f3f2-7d21-7abc-8def-123456789abc'
const STAGED_DATA = {
  source: 'Feishu Wiki',
  title: 'Document 1',
  relativePath: 'external/staged-document-1.md' as PosixRelativeFilePath
}

it('commits an invisible deleting external item before artifact staging', () => {
  const created = service.createDeletingExternal(KNOWLEDGE_BASE_ID, STAGED_ITEM_ID, STAGED_DATA)
  expect(created).toMatchObject({ id: STAGED_ITEM_ID, type: 'external', status: 'deleting' })
  expect(service.getItemsByBaseId(KNOWLEDGE_BASE_ID)).not.toContainEqual(
    expect.objectContaining({ id: STAGED_ITEM_ID })
  )
})

it('promotes only the matching deleting external item in the caller transaction', () => {
  service.createDeletingExternal(KNOWLEDGE_BASE_ID, STAGED_ITEM_ID, STAGED_DATA)
  expect(
    service.promoteDeletingExternalTx(dbh.db, KNOWLEDGE_BASE_ID, STAGED_ITEM_ID, {
      ...STAGED_DATA,
      source: 'Renamed Wiki'
    })
  ).toMatchObject({ id: STAGED_ITEM_ID, status: 'completed' })
  expect(service.promoteDeletingExternalTx(dbh.db, KNOWLEDGE_BASE_ID, STAGED_ITEM_ID, STAGED_DATA)).toBeNull()
})

it('does not promote another item type', async () => {
  const note = await seedItem({ id: NOTE_1_ID, status: 'deleting' })
  expect(service.promoteDeletingExternalTx(dbh.db, KNOWLEDGE_BASE_ID, note.id, STAGED_DATA)).toBeNull()
})
```

- [ ] **步骤 2：运行测试并确认新 API 尚不存在**

```bash
pnpm test:main src/main/data/services/__tests__/KnowledgeItemService.test.ts
```

预期：FAIL，`createDeletingExternal` 或 `promoteDeletingExternalTx` 不存在。

- [ ] **步骤 3：实现 staging item 数据原语**

在 `KnowledgeItemService.ts` 删除仅供当前同步路径使用的 `createCompletedExternalTx` 和 `deleteCompletedExternalTx`，实现：

```ts
createDeletingExternal(baseId: string, id: string, data: ExternalItemData): KnowledgeItem {
  const [row] = withSqliteErrors(
    () =>
      this.db
        .insert(knowledgeItemTable)
        .values({ id, baseId, groupId: null, type: 'external', data, status: 'deleting', error: null })
        .returning()
        .all(),
    {
      foreignKey: () => DataApiErrorFactory.notFound('KnowledgeBase', baseId),
      check: (constraintName) =>
        DataApiErrorFactory.validation({
          _root: [constraintName ? `Knowledge item failed CHECK constraint '${constraintName}'` : 'Knowledge item failed a CHECK constraint']
        })
    } satisfies SqliteErrorHandlers
  )
  if (!row) throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', 'Deleting external item create result missing')
  return rowToKnowledgeItem(row)
}

promoteDeletingExternalTx(
  tx: Pick<DbType, 'update'>,
  baseId: string,
  id: string,
  data: ExternalItemData
): KnowledgeItem | null {
  const [row] = tx
    .update(knowledgeItemTable)
    .set({ data, status: 'completed', error: null })
    .where(and(
      eq(knowledgeItemTable.id, id),
      eq(knowledgeItemTable.baseId, baseId),
      eq(knowledgeItemTable.type, 'external'),
      eq(knowledgeItemTable.status, 'deleting')
    ))
    .returning()
    .all()
  return row ? rowToKnowledgeItem(row) : null
}
```

保留 `updateCompletedExternalMetadataTx`，unchanged 文档仍需原位更新标题。

- [ ] **步骤 4：为统一删除接纳 helper 写失败测试**

创建 `subtreeDeletion.test.ts`，通过 `mockApplicationFactory` 提供 `DbService.withWriteTx` 和 `JobManager.enqueueTx`，通过 mock `KnowledgeItemService` 提供 deleting roots：

```ts
it('enqueues a transactional delete with canonical queue and idempotency key', () => {
  enqueueKnowledgeSubtreeDeletionTx(tx, 'kb-1', ['note-2', 'note-1', 'note-1'])
  expect(enqueueTxMock).toHaveBeenCalledWith(
    tx,
    'knowledge.delete-subtree',
    { baseId: 'kb-1', rootItemIds: ['note-2', 'note-1'] },
    { idempotencyKey: 'knowledge:kb-1:note-1,note-2:delete', queue: 'base.kb-1' }
  )
})

it('recovers only the requested base and chunks roots at 500', () => {
  const roots = Array.from({ length: 501 }, (_, index) => `note-${index + 1}`)
  getDeletingRootGroupsMock.mockReturnValue([
    { baseId: 'kb-1', rootItemIds: roots },
    { baseId: 'kb-2', rootItemIds: ['other'] }
  ])
  recoverDeletingKnowledgeItems('kb-1')
  expect(enqueueTxMock).toHaveBeenCalledTimes(2)
  expect(enqueueTxMock.mock.calls.every((call) => call[2].baseId === 'kb-1')).toBe(true)
})
```

- [ ] **步骤 5：运行 helper 测试并确认模块尚不存在**

```bash
pnpm test:main src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts
```

预期：FAIL，无法解析 `subtreeDeletion.ts`。

- [ ] **步骤 6：实现 helper 并接入普通删除和启动恢复**

创建 `subtreeDeletion.ts`：

```ts
import '../tasks/jobTypes'
import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import {
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeQueueName,
  toKnowledgeBaseId,
  toKnowledgeItemIds
} from '../types'

const logger = loggerService.withContext('Knowledge:SubtreeDeletion')
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500

export function enqueueKnowledgeSubtreeDeletionTx(tx: DbOrTx, baseId: string, rootItemIds: string[]): void {
  const uniqueRootItemIds = [...new Set(rootItemIds)]
  if (uniqueRootItemIds.length === 0) return
  const knowledgeBaseId = toKnowledgeBaseId(baseId)
  application.get('JobManager').enqueueTx(
    tx,
    'knowledge.delete-subtree',
    { baseId, rootItemIds: uniqueRootItemIds },
    {
      idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, toKnowledgeItemIds(uniqueRootItemIds)),
      queue: knowledgeQueueName(knowledgeBaseId)
    }
  )
}

export function recoverDeletingKnowledgeItems(baseId?: string): void {
  let groups: ReturnType<typeof knowledgeItemService.getDeletingRootGroups>
  try {
    groups = knowledgeItemService.getDeletingRootGroups().filter((group) => baseId === undefined || group.baseId === baseId)
  } catch (error) {
    logger.error('Failed to scan deleting knowledge items for recovery', error as Error, { baseId })
    return
  }
  for (const group of groups) {
    for (let index = 0; index < group.rootItemIds.length; index += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
      const rootItemIds = group.rootItemIds.slice(index, index + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
      try {
        application.get('DbService').withWriteTx((tx) =>
          enqueueKnowledgeSubtreeDeletionTx(tx, group.baseId, rootItemIds)
        )
      } catch (error) {
        logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
          baseId: group.baseId,
          rootItemIds
        })
      }
    }
  }
}
```

在 `KnowledgeIngestionService.deleteItems` 中保留 owner guard 和 `setSubtreeStatusTx`，把内联 enqueue 替换为 `enqueueKnowledgeSubtreeDeletionTx(tx, baseId, rootItemIds)`；删除类中的 `recoverDeletingItems` 和旧恢复常量。`KnowledgeService.onAllReady` 直接调用 `recoverDeletingKnowledgeItems()`。

- [ ] **步骤 7：运行相关测试**

```bash
pnpm test:main \
  src/main/data/services/__tests__/KnowledgeItemService.test.ts \
  src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts
```

预期：PASS，删除状态写入与任务接纳仍在一个 transaction 中。

- [ ] **步骤 8：提交本任务**

```bash
git add src/main/data/services/KnowledgeItemService.ts \
  src/main/data/services/__tests__/KnowledgeItemService.test.ts \
  src/main/features/knowledge/ingestion/subtreeDeletion.ts \
  src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts \
  src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts \
  src/main/features/knowledge/KnowledgeService.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts
git commit -S --signoff -m "refactor(knowledge-deletion): centralize durable cleanup admission"
```

### 任务 2：让 external 快照删除失败保持可恢复

**文件：**

- 修改：`src/main/features/knowledge/ingestion/subtreePurge.ts`
- 修改：`src/main/features/knowledge/tasks/__tests__/jobHandlerTestUtils.ts`
- 测试：`src/main/features/knowledge/tasks/__tests__/deleteSubtreeJobHandler.test.ts`

- [ ] **步骤 1：写严格 external 清理失败测试**

在 test utils 增加 `deleteKnowledgeItemFilesMock`；在 handler 测试加入这个 factory 和两个测试：

```ts
const createExternalItem = (
  id: string,
  status: KnowledgeItemOf<'external'>['status']
): KnowledgeItemOf<'external'> => ({
  id,
  baseId: 'kb-1',
  groupId: null,
  type: 'external',
  data: {
    source: 'Feishu Wiki',
    title: 'External document',
    relativePath: `external/${id}.md` as PosixRelativeFilePath
  },
  status,
  error: null,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z'
})

it('keeps deleting external rows when strict snapshot cleanup fails', async () => {
  const external = createExternalItem('external-1', 'deleting')
  knowledgeItemGetSubtreeItemsMock.mockReturnValue([external])
  deleteKnowledgeItemFilesMock.mockRejectedValue(new Error('snapshot busy'))

  await expect(
    createDeleteSubtreeJobHandler(knowledgeLockManager as never).execute(
      createCtx({ baseId: 'kb-1', rootItemIds: [external.id] }, 'delete-job')
    )
  ).rejects.toThrow('snapshot busy')
  expect(deleteMaterialsMock).toHaveBeenCalledWith([external.id])
  expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
})

it('splits strict external cleanup from ordinary best-effort cleanup', async () => {
  const external = createExternalItem('external-1', 'deleting')
  const file = createFileItem(FILE_ITEM_ID, 'deleting')
  knowledgeItemGetSubtreeItemsMock.mockReturnValue([external, file])
  await createDeleteSubtreeJobHandler(knowledgeLockManager as never).execute(
    createCtx({ baseId: 'kb-1', rootItemIds: [external.id, file.id] }, 'delete-job')
  )
  expect(deleteKnowledgeItemFilesMock).toHaveBeenCalledWith('kb-1', [external])
  expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', [file], {
    baseId: 'kb-1', jobId: 'delete-job'
  })
})
```

- [ ] **步骤 2：运行测试并确认 strict mock 未被调用**

```bash
pnpm test:main src/main/features/knowledge/tasks/__tests__/deleteSubtreeJobHandler.test.ts
```

预期：FAIL，external 仍走 best-effort 路径。

- [ ] **步骤 3：按类型拆分 purge 文件阶段**

在 `subtreePurge.ts` 导入 `deleteKnowledgeItemFiles`，把文件阶段替换为：

```ts
const externalItems = subtreeItems.filter((item) => item.type === 'external')
const ordinaryItems = subtreeItems.filter((item) => item.type !== 'external')

await deleteKnowledgeItemVectors(base, leafItemIds)
if (externalItems.length > 0) await deleteKnowledgeItemFiles(base.id, externalItems)
if (ordinaryItems.length > 0) {
  await deleteKnowledgeItemFilesBestEffort(base.id, ordinaryItems, logContext)
}
knowledgeItemService.deleteItemsByIds(base.id, subtreeItemIds)
```

严格 external 删除必须先成功，才能 hard-delete 任意目标行；普通 item 的 best-effort 契约不变。

- [ ] **步骤 4：运行测试并提交**

```bash
pnpm test:main src/main/features/knowledge/tasks/__tests__/deleteSubtreeJobHandler.test.ts
git add src/main/features/knowledge/ingestion/subtreePurge.ts \
  src/main/features/knowledge/tasks/__tests__/jobHandlerTestUtils.ts \
  src/main/features/knowledge/tasks/__tests__/deleteSubtreeJobHandler.test.ts
git commit -S --signoff -m "fix(knowledge-deletion): retain failed external cleanup"
```

预期：PASS；external 失败时 DB 行保留，普通文件测试继续通过。

### 任务 3：把外部同步发布和 reconciliation 改为持久清理

**文件：**

- 修改：`src/main/features/knowledge/external/ExternalKnowledgeSyncService.ts`
- 测试：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncService.test.ts`
- 修改：`src/main/features/knowledge/tasks/syncExternalSourceJobHandler.ts`
- 测试：`src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts`

- [ ] **步骤 1：把补偿清理测试改写为 durable state 测试**

在 sync service 测试的 dependency fixture 加入 `enqueueDeletionTxMock` 和 `recoverDeletingKnowledgeItemsMock`。覆盖四个明确失败点（snapshot write、material prepare、vector rebuild、publication transaction），每个 case 都断言 staging row 为 `deleting` 且 `enqueueDeletionTxMock(tx, BASE_ID, [STAGED_ITEM_ID])` 被调用。

成功替换 case 必须断言：新 item completed；旧 item deleting；document 指向新 item；旧 snapshot/material 仍存在；旧 item 的删除任务已接纳。missing 和 permission-denied 两个 case 必须分别断言 document unavailable、`knowledgeItemId = null`、旧 item deleting、删除任务已接纳。增加 `syncSource` 起点调用 `recoverDeletingKnowledgeItemsMock(BASE_ID)` 的断言。

- [ ] **步骤 2：运行 sync service 测试并确认失败**

```bash
pnpm test:main src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncService.test.ts
```

预期：FAIL；当前实现没有预先写入 deleting row，并在 commit 后直接清理旧 artifacts。

- [ ] **步骤 3：实现 staging publication 协议**

在 `ExternalKnowledgeSyncDependencies` 移除 `deleteKnowledgeItemFiles`，加入：

```ts
enqueueKnowledgeSubtreeDeletionTx: typeof enqueueKnowledgeSubtreeDeletionTx
recoverDeletingKnowledgeItems: typeof recoverDeletingKnowledgeItems
```

默认值引用 `ingestion/subtreeDeletion.ts`。`syncSource` 通过最初 abort check 后调用 `recoverDeletingKnowledgeItems(input.fence.baseId)`。

`syncDocument` 在 read/hash 确认需要新版本后先执行：

```ts
const item = knowledgeItemService.createDeletingExternal(input.fence.baseId, itemId, {
  source: source.name,
  title: input.reference.descriptor.title,
  relativePath
})
```

然后才写 snapshot、prepare 和 rebuild。publication transaction 中先 CAS promote，再 publish document；存在 old owner 时执行：

```ts
const promoted = knowledgeItemService.promoteDeletingExternalTx(tx, input.fence.baseId, itemId, {
  ...item.data,
  source: latestSource.name
})
if (!promoted) throw new StaleExternalKnowledgePublicationError()

if (previousItem) {
  const deletingIds = knowledgeItemService.setSubtreeStatusTx(
    tx,
    input.fence.baseId,
    [previousItem.id],
    'deleting'
  )
  if (!deletingIds.includes(previousItem.id)) throw new StaleExternalKnowledgePublicationError()
  this.dependencies.enqueueKnowledgeSubtreeDeletionTx(tx, input.fence.baseId, [previousItem.id])
}
```

错误路径用独立短事务尝试接纳 staging cleanup，但永远保留原 error：

```ts
private admitStagedCleanup(baseId: string, itemId: string): void {
  try {
    application.get('DbService').withWriteTx((tx) =>
      this.dependencies.enqueueKnowledgeSubtreeDeletionTx(tx, baseId, [itemId])
    )
  } catch (error) {
    logger.warn('Failed to admit staged external knowledge cleanup; recovery will retry', {
      baseId, itemId, error: error instanceof Error ? error.message : String(error)
    })
  }
}
```

catch 先调用该 helper；stale publication 返回 `skipped/stale-publication`，其他 error 原样抛出。删除 `materialStaged`、`snapshotStaged`、三个直接 cleanup helper、`ExternalKnowledgeDocumentSyncFailure` 和 cleanup warning 类型。

- [ ] **步骤 4：把 missing/permission reconciliation 改成原子 durable cleanup admission**

在两个 reconciliation transaction 的 `markUnavailable*Tx` 后执行：

```ts
const itemIds = items.map((item) => item.id)
const deletingIds = knowledgeItemService.setSubtreeStatusTx(tx, input.fence.baseId, itemIds, 'deleting')
if (deletingIds.length !== itemIds.length) throw new StaleExternalKnowledgePublicationError()
this.dependencies.enqueueKnowledgeSubtreeDeletionTx(tx, input.fence.baseId, itemIds)
```

返回空 cleanup warning；从 `ExternalKnowledgeSourceSyncWarningCode` 和 handler `WarningCodeSchema` 删除 staged/old/missing/permission cleanup failure codes。

- [ ] **步骤 5：运行相关测试**

```bash
pnpm test:main \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncService.test.ts \
  src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts
```

预期：PASS；成功同步只保证旧内容隐藏且清理任务已持久接纳。

- [ ] **步骤 6：提交本任务**

```bash
git add src/main/features/knowledge/external/ExternalKnowledgeSyncService.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncService.test.ts \
  src/main/features/knowledge/tasks/syncExternalSourceJobHandler.ts \
  src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts
git commit -S --signoff -m "fix(external-knowledge-sync): persist artifact cleanup"
```

### 任务 4：在来源创建事务中重验 target 与 identity，并稳定映射 IPC

**文件：**

- 修改：`src/main/data/services/KnowledgeBaseService.ts`
- 测试：`src/main/data/services/__tests__/KnowledgeBaseService.test.ts`
- 修改：`src/main/data/services/ExternalKnowledgeConnectionService.ts`
- 测试：`src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts`
- 修改：`src/main/data/services/ExternalKnowledgeSourceService.ts`
- 测试：`src/main/data/services/__tests__/ExternalKnowledgeSourceService.test.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeSyncAdmission.ts`
- 测试：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts`
- 修改：`src/main/features/knowledge/index.ts`
- 修改：`src/shared/ipc/errors/knowledge.ts`
- 修改：`src/main/ipc/handlers/knowledge.ts`
- 测试：`src/main/ipc/handlers/__tests__/knowledge.test.ts`

- [ ] **步骤 1：写 tx-current target 与安全 conflict 失败测试**

在 Base/Connection service 测试分别断言 `getByIdTx(dbh.db, id)` 与非 tx getter 返回同一实体，missing 语义不变。在 source service 测试把重复 identity 断言强化为：

```ts
expect(() =>
  dbh.db.transaction((tx) => externalKnowledgeSourceService.createTx(tx, input))
).toThrowError(expect.objectContaining({
  code: ErrorCode.CONFLICT,
  message: 'An external knowledge source already exists for this provider scope'
}))

try {
  dbh.db.transaction((tx) => externalKnowledgeSourceService.createTx(tx, input))
} catch (error) {
  expect((error as Error).message).not.toContain(`${BASE_ID}:feishu:tenant-1:space-1`)
}
```

在 admission 测试把默认 connection seed 改为合法 connected identity，然后加入四个独立 case：scope resolution 期间删除 base、删除 connection、把 connection 置为 `reauthorization-required`、把 connection tenant 改为与 resolution 不一致。每个 case 都断言 admission error code 为 `target-unavailable`，且 source/job 表为空。再加入重复 identity 返回 `source-conflict` 的 case。

- [ ] **步骤 2：运行数据与 admission 测试并确认失败**

```bash
pnpm test:main \
  src/main/data/services/__tests__/KnowledgeBaseService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeSourceService.test.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts
```

预期：FAIL；tx readers/admission error 尚不存在，重复错误仍包含复合 identity。

- [ ] **步骤 3：实现 tx readers**

让 Base getter 委托给：

```ts
getByIdTx(tx: Pick<DbType, 'select'>, id: string): KnowledgeBase {
  const row = tx.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1).get()
  if (!row) throw DataApiErrorFactory.notFound('KnowledgeBase', id)
  return rowToKnowledgeBase(row)
}
```

Connection 版本使用相同 query 形状，但返回 `ExternalKnowledgeConnection | null`。两个非 tx `getById` 都只调用对应 `getByIdTx(this.db, id)`。

- [ ] **步骤 4：实现 source identity 预查询和安全 SQLite fallback**

将 `ExternalKnowledgeSourceService.createTx` 的 tx 类型改为 `Pick<DbType, 'select' | 'insert'>`。insert 前查询 `(baseId, provider, tenantId, spaceId)`；命中时和 UNIQUE fallback 都调用：

```ts
const sourceIdentityConflict = () =>
  DataApiErrorFactory.conflict(
    'An external knowledge source already exists for this provider scope',
    'ExternalKnowledgeSource'
  )
```

`withSqliteErrors` 显式提供：

```ts
{
  unique: sourceIdentityConflict,
  foreignKey: () => DataApiErrorFactory.notFound('ExternalKnowledgeSourceTarget'),
  check: () => DataApiErrorFactory.validation({
    _root: ['External knowledge source failed persisted validation']
  })
} satisfies SqliteErrorHandlers
```

不得再把复合 identity 交给 `defaultHandlersFor`。

- [ ] **步骤 5：实现 admission domain error 与事务内重验**

在 `ExternalKnowledgeSyncAdmission.ts` 定义并导出：

```ts
export type ExternalKnowledgeAdmissionErrorCode = 'source-conflict' | 'target-unavailable'

export class ExternalKnowledgeAdmissionError extends Error {
  constructor(readonly code: ExternalKnowledgeAdmissionErrorCode) {
    super(`External knowledge source admission failed: ${code}`)
    this.name = 'ExternalKnowledgeAdmissionError'
  }
}
```

resolution 返回后，在 write tx 中先读取 base 与 connection：

```ts
const base = knowledgeBaseService.getByIdTx(tx, input.baseId)
const connection = externalKnowledgeConnectionService.getByIdTx(tx, input.connectionId)
if (
  base.status === 'failed' ||
  !connection ||
  connection.provider !== 'feishu' ||
  connection.authorizationStatus !== 'connected' ||
  connection.tenantKey !== resolution.tenantId
) {
  throw new ExternalKnowledgeAdmissionError('target-unavailable')
}
```

将 Base NOT_FOUND、source insert FK NOT_FOUND 转为 `target-unavailable`，将 source create `ErrorCode.CONFLICT` 转为 `source-conflict`；其他 DataApi/database error 原样抛出。

- [ ] **步骤 6：添加 IPC domain mapping**

在 `knowledgeErrorCodes` 增加：

```ts
EXTERNAL_SOURCE_CONFLICT: 'KNOWLEDGE_EXTERNAL_SOURCE_CONFLICT',
EXTERNAL_SOURCE_TARGET_UNAVAILABLE: 'KNOWLEDGE_EXTERNAL_SOURCE_TARGET_UNAVAILABLE',
```

从 Knowledge feature barrel 导出 `ExternalKnowledgeAdmissionError`。`mapExternalKnowledgeError` 映射这两个 code；create 和 `knowledge.external_source.sync` 都通过 `externalKnowledgeAdmissionCommand`。更新 handler 测试，断言 domain code 正确且消息不含复合 identity。

- [ ] **步骤 7：运行相关测试**

```bash
pnpm test:main \
  src/main/data/services/__tests__/KnowledgeBaseService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeSourceService.test.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/ipc/handlers/__tests__/knowledge.test.ts
```

预期：PASS；预期冲突与 target race 不再成为 IPC `INTERNAL`。

- [ ] **步骤 8：提交本任务**

```bash
git add src/main/data/services/KnowledgeBaseService.ts \
  src/main/data/services/__tests__/KnowledgeBaseService.test.ts \
  src/main/data/services/ExternalKnowledgeConnectionService.ts \
  src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts \
  src/main/data/services/ExternalKnowledgeSourceService.ts \
  src/main/data/services/__tests__/ExternalKnowledgeSourceService.test.ts \
  src/main/features/knowledge/external/ExternalKnowledgeSyncAdmission.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/features/knowledge/index.ts \
  src/shared/ipc/errors/knowledge.ts \
  src/main/ipc/handlers/knowledge.ts \
  src/main/ipc/handlers/__tests__/knowledge.test.ts
git commit -S --signoff -m "fix(external-knowledge): validate source admission transaction"
```

### 任务 5：关闭 admission 后取消同步任务，再停止 runtime

**文件：**

- 修改：`src/main/features/knowledge/KnowledgeService.ts`
- 修改：`src/main/features/knowledge/external/ExternalKnowledgeSyncAdmission.ts`
- 测试：`src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts`
- 测试：`src/main/features/knowledge/__tests__/KnowledgeService.test.ts`
- 测试：`src/main/ipc/handlers/__tests__/knowledge.test.ts`

- [ ] **步骤 1：写 gate race 失败测试**

在 admission 测试注入 `assertOpen`，用 deferred resolution 验证第二次检查：

```ts
const createInput = {
  baseId: BASE_ID,
  connectionId: CONNECTION_ID,
  url: 'https://acme.feishu.cn/wiki/root',
  name: 'Engineering Wiki'
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve })
  return { promise, resolve }
}

it('checks admission again after scope resolution before writing', async () => {
  let open = true
  const resolutionGate = createDeferred<typeof resolution>()
  resolveFeishuScope.mockReturnValue(resolutionGate.promise)
  const admission = new ExternalKnowledgeSyncAdmission(
    { resolveFeishuScope },
    {
      now: () => 123,
      assertOpen: () => {
        if (!open) throw new ExternalKnowledgeRuntimeError('stopped')
      }
    }
  )
  const creating = admission.create(createInput)
  await vi.waitFor(() => expect(resolveFeishuScope).toHaveBeenCalledOnce())
  open = false
  resolutionGate.resolve(resolution)
  await expect(creating).rejects.toMatchObject({ code: 'stopped' })
  expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toEqual([])
})
```

另写 `requestSync` 在 entry gate 关闭时不查询 source、不 enqueue 的测试。

- [ ] **步骤 2：写 shutdown 顺序和失败聚合测试**

在 `KnowledgeService.test.ts` 替换“shutdown 不取消任务”的旧测试：

```ts
it('cancels every active external sync before stopping the runtime', async () => {
  const order: string[] = []
  listMock.mockResolvedValue([
    { id: 'running-job', status: 'running' },
    { id: 'pending-job', status: 'pending' },
    { id: 'delayed-job', status: 'delayed' }
  ] as never)
  cancelMock.mockImplementation(async (id) => {
    order.push(`cancel:${id}`)
    return { outcome: 'cancelled' }
  })
  externalKnowledgeRuntimeStopMock.mockImplementation(async () => { order.push('runtime:stop') })
  await (new KnowledgeService() as unknown as { onStop(): Promise<void> }).onStop()
  expect(listMock).toHaveBeenCalledWith({
    status: ['pending', 'delayed', 'running'],
    type: 'knowledge.sync-external-source'
  })
  expect(order.at(-1)).toBe('runtime:stop')
})
```

再增加：任一 cancel reject 时其余 cancel 和 runtime stop 仍执行；runtime stop reject 时 cancel 已完成；两者都失败时抛 `AggregateError`；`onReady` 只有 runtime start 成功后才打开 gate。

- [ ] **步骤 3：运行 lifecycle/admission 测试并确认失败**

```bash
pnpm test:main \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts
```

预期：FAIL；当前 onStop 直接停止 runtime，admission 没有双重 gate。

- [ ] **步骤 4：给 admission 加双重 gate**

把依赖规范化为：

```ts
type AdmissionDependencies = {
  now(): number
  assertOpen(): void
}

constructor(runtime: ScopeRuntime, dependencies: Partial<AdmissionDependencies> = {}) {
  this.dependencies = { now: Date.now, assertOpen: () => undefined, ...dependencies }
}
```

`create` 在参数校验后、runtime call 前执行一次 `assertOpen()`，resolution 返回后、write tx 前再执行一次。`requestSync` 在任何 DB read 前执行一次。gate 统一通过 `ExternalKnowledgeRuntimeError('stopped')` 拒绝。

- [ ] **步骤 5：实现 owner-local gate 和 cancel-before-stop**

在 `KnowledgeService` 增加：

```ts
private isExternalKnowledgeAdmissionOpen = false

private assertExternalKnowledgeAdmissionOpen = (): void => {
  if (!this.isExternalKnowledgeAdmissionOpen) throw new ExternalKnowledgeRuntimeError('stopped')
}
```

构造 admission 时传入 callback。生命周期改成：

```ts
protected async onReady(): Promise<void> {
  await this.externalKnowledgeRuntime.start()
  this.isExternalKnowledgeAdmissionOpen = true
}

protected async onStop(): Promise<void> {
  this.isExternalKnowledgeAdmissionOpen = false
  const failures: unknown[] = []
  try {
    const jobs = await application.get('JobManager').list({
      status: [...ACTIVE_JOB_STATUSES],
      type: 'knowledge.sync-external-source'
    })
    const results = await Promise.allSettled(
      jobs.map((job) => application.get('JobManager').cancel(job.id, 'knowledge-service-stop'))
    )
    failures.push(...results.filter((result) => result.status === 'rejected').map((result) => result.reason))
  } catch (error) {
    failures.push(error)
  }
  try {
    await this.externalKnowledgeRuntime.stop()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Failed to stop External Knowledge cleanly')
}
```

不得使用 `cancelMany`。`cancel()` 返回 `timed-out` 时 JobManager 已先写入 cancelled terminal state 并运行 settle；不要把该结果重新归类为业务失败。

- [ ] **步骤 6：验证 manual sync 的 stopped IPC 映射**

在 IPC handler 测试让 `requestExternalKnowledgeSourceSync` 抛 `ExternalKnowledgeRuntimeError('stopped')`，断言 `knowledge.external_source.sync` 返回 `KNOWLEDGE_EXTERNAL_RUNTIME_STOPPED`。

- [ ] **步骤 7：运行相关测试并提交**

```bash
pnpm test:main \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts \
  src/main/ipc/handlers/__tests__/knowledge.test.ts
git add src/main/features/knowledge/KnowledgeService.ts \
  src/main/features/knowledge/external/ExternalKnowledgeSyncAdmission.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts \
  src/main/ipc/handlers/__tests__/knowledge.test.ts
git commit -S --signoff -m "fix(knowledge-lifecycle): drain external sync before runtime stop"
```

预期：PASS；runtime stop 在所有 cancel promises settle 后执行。

### 任务 6：把最终 handler timeout 投影为 timeout

**文件：**

- 修改：`src/main/features/knowledge/tasks/syncExternalSourceJobHandler.ts`
- 测试：`src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts`

- [ ] **步骤 1：写 timeout 优先级失败测试**

在 settled table 增加：

```ts
{
  name: 'handler timeout after retries are exhausted',
  event: settledEvent({
    status: 'failed',
    output: undefined,
    error: { code: JOB_ERROR_CODES.HANDLER_TIMEOUT, message: 'JobHandlerTimeout', retryable: true },
    metadata: {
      externalKnowledgeSync: { code: 'cancelled', summary: summary({ indexedCount: 0 }) }
    },
    attempt: 2
  }),
  expectedOutcome: 'failed',
  expectedError: 'timeout',
  expectedSummary: summary({ indexedCount: 0 })
}
```

metadata 故意为 cancelled，证明结构化 JobManager timeout code 优先。

- [ ] **步骤 2：运行测试并确认当前错误投影为 cancelled**

```bash
pnpm test:main src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts
```

预期：FAIL，`errorSummary` 当前取 metadata code。

- [ ] **步骤 3：实现 timeout 分类**

导入 `JOB_ERROR_CODES`，将非 completed 的错误摘要改成：

```ts
const errorSummary =
  event.status === 'completed'
    ? null
    : event.status === 'cancelled'
      ? 'cancelled'
      : event.error?.code === JOB_ERROR_CODES.HANDLER_TIMEOUT
        ? 'timeout'
        : (failedMetadata?.code ?? 'failed')
```

不得匹配 error message，不修改 JobManager retry policy。

- [ ] **步骤 4：运行测试并提交**

```bash
pnpm test:main src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts
git add src/main/features/knowledge/tasks/syncExternalSourceJobHandler.ts \
  src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts
git commit -S --signoff -m "fix(external-knowledge-sync): distinguish handler timeout"
```

预期：PASS，timeout、cancel 和 domain failure 三类投影互不覆盖。

### 任务 7：更新现行文档并完成风险匹配验证

**文件：**

- 修改：`src/main/features/knowledge/README.md`
- 修改：`docs/references/knowledge/workflow-architecture.md`
- 修改：`docs/references/knowledge/knowledge-service.md`
- 复核：本计划全部生产与测试文件

- [ ] **步骤 1：更新实现文档**

三个文档都必须明确：

- `knowledge.delete-subtree` 也由 external publication、missing/permission reconciliation 和每次 external sync 的恢复路径接纳。
- deleting external row 是 snapshot/vector 的 durable cleanup locator；external snapshot 删除严格失败并保留行，普通 item 仍 best-effort。
- external sync success 表示旧内容已隐藏且 durable cleanup 已接纳，不保证旧字节已物理删除。
- `KnowledgeService` 的停止顺序为 close admission -> cancel/settle sync jobs -> runtime stop。
- source create 在 scope resolution 后的同一 tx snapshot 重验 base、connected connection、tenant identity 与 source uniqueness。
- timeout 使用 JobManager `JOB_HANDLER_TIMEOUT` 投影，不根据文本判断。

删除“publication transaction removes old item row”和“withdraw ownership before best-effort artifact cleanup”等失效描述。

- [ ] **步骤 2：运行全部定向测试**

```bash
pnpm test:main \
  src/main/data/services/__tests__/KnowledgeItemService.test.ts \
  src/main/data/services/__tests__/KnowledgeBaseService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeConnectionService.test.ts \
  src/main/data/services/__tests__/ExternalKnowledgeSourceService.test.ts \
  src/main/features/knowledge/ingestion/__tests__/subtreeDeletion.test.ts \
  src/main/features/knowledge/tasks/__tests__/deleteSubtreeJobHandler.test.ts \
  src/main/features/knowledge/tasks/__tests__/syncExternalSourceJobHandler.test.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncService.test.ts \
  src/main/features/knowledge/external/__tests__/ExternalKnowledgeSyncAdmission.test.ts \
  src/main/features/knowledge/__tests__/KnowledgeService.test.ts \
  src/main/ipc/handlers/__tests__/knowledge.test.ts
```

预期：全部 PASS。

- [ ] **步骤 3：运行 lint 并检查自动写入**

```bash
pnpm lint
git diff --check
git status --short
```

预期：lint、typecheck、i18n check 和 format 全部通过；只出现本计划列出的文件。`pnpm lint` 产生的合法格式化变更纳入本任务，不触碰无关文件。

- [ ] **步骤 4：运行文档和完整 build gate**

```bash
pnpm docs:check
pnpm build:check
```

预期：两条命令均退出 0。改动横跨持久清理、SQLite 事务、IPC 和 lifecycle，因此不跳过完整 gate。

- [ ] **步骤 5：复核边界与提交签名**

```bash
git diff --stat 05b98e8102ddd1d782d72b4d8d3582503e66ac78...HEAD
git diff --check 05b98e8102ddd1d782d72b4d8d3582503e66ac78...HEAD
git log --format='%h %s' 05b98e8102ddd1d782d72b4d8d3582503e66ac78..HEAD
for commit in $(git rev-list 05b98e8102ddd1d782d72b4d8d3582503e66ac78..HEAD); do
  git cat-file commit "$commit" | grep -q '^gpgsig ' || exit 1
  git cat-file commit "$commit" | grep -q '^Signed-off-by: ' || exit 1
done
```

预期：没有 schema/migration、JobManager core 或新 lifecycle service；本轮所有 commit 都有 `gpgsig` 和 DCO sign-off。

- [ ] **步骤 6：提交文档与必要格式化调整**

```bash
git add src/main/features/knowledge/README.md \
  docs/references/knowledge/workflow-architecture.md \
  docs/references/knowledge/knowledge-service.md
git commit -S --signoff -m "docs(external-knowledge): document durable sync cleanup"
```

如果 `pnpm lint` 修改了本计划内的源文件，把这些文件一并加入该提交；不得顺手重构相邻代码。

### 任务 8：删除临时设计与实施文档

**文件：**

- 删除：`docs/superpowers/specs/2026-09-21-external-knowledge-sync-repair-design.md`
- 删除：`docs/superpowers/plans/2026-09-21-external-knowledge-sync-repair.md`

- [ ] **步骤 1：确认实现和完整 gate 已成功**

```bash
git log -1 --oneline
git status --short
```

预期：任务 7 提交存在、工作树干净，并且 `pnpm build:check` 已在当前实现上退出 0。任一条件不满足时先完成验证，不删除临时文档。

- [ ] **步骤 2：使用 apply_patch 删除两个精确文件**

用两个 `*** Delete File` patch 删除本计划和对应设计规格。不得递归删除 `docs/superpowers`，也不得删除其他 agent 文档。

- [ ] **步骤 3：验证删除后的文档树**

```bash
pnpm docs:check
git diff --check
git status --short
```

预期：docs gate 退出 0；状态只显示这两个临时文档被删除。

- [ ] **步骤 4：提交临时文档清理**

```bash
git add -u docs/superpowers/specs/2026-09-21-external-knowledge-sync-repair-design.md \
  docs/superpowers/plans/2026-09-21-external-knowledge-sync-repair.md
git commit -S --signoff -m "docs(external-knowledge): remove temporary implementation notes"
git status --short
```

预期：commit 成功、工作树干净；最终 PR 文件树不包含设计规格或实施计划。
