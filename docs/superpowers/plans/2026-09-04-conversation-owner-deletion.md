# 会话所有者删除解耦实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Agent 与 Session、Assistant 与 Topic 的回收站删除默认解耦，由用户通过复选框选择是否同时移动关联会话，并保证恢复、永久删除、运行时停用和未关联会话重新绑定都符合已批准契约。

**架构：** 保留 Agent 的 IpcApi 与 Assistant 的 DataApi 边界，由各所有者服务在一个 SQLite 写事务内负责父子软删除与同批恢复；历史读取以会话自身状态为准，执行准入额外要求活跃所有者；渲染层复用一个功能级受控确认组件及其 `createPopup` 包装器，不扩展 `packages/ui`。

**技术栈：** TypeScript、React、Electron、Drizzle ORM / better-sqlite3、TanStack Query、Vitest、Testing Library、i18next、`@cherrystudio/ui`。

---

## 开始前的仓库基线

- 设计依据：[2026-09-04-conversation-owner-deletion-design.md](../specs/2026-09-04-conversation-owner-deletion-design.md)。
- 本计划以提交 `e2094125df` 之后的分支状态为起点。
- `AgentJobsService` 已经实现逐任务的 `job_schedule.metadata.agentTrash.resumeOnRestore`、启动对账与永久删除清理；不要重复实现，只在最终验证中运行其现有测试。
- 不增加表、列、迁移或新的删除批次标识。级联批次继续使用同一事务内生成的 `deletedAt` 时间戳。
- 不改变以下公开请求结构：

```ts
// src/shared/ipc/schemas/ai.ts
{ agentId: string; deleteSessions: boolean; permanent?: boolean }

// src/shared/data/api/schemas/assistants.ts
{ deleteTopics?: boolean; permanent?: boolean }
```

## 文件与职责

### 数据与契约

- 修改 `src/main/data/services/AgentSessionService.ts`：让常规历史读取包含所有活跃 Session，把活跃 Agent 要求限制在可投递查询，并允许 Session 在 Agent 已进回收站时独立恢复。
- 修改 `src/main/data/services/AgentService.ts`：永久删除始终保留 Session；软级联继续用同一时间戳，并返回真正被移动的 Session ID。
- 修改 `src/main/data/services/TopicService.ts`：允许调用方提供软删除时间戳，并提供按 Assistant 与时间戳恢复同批 Topic 的事务内方法。
- 修改 `src/main/data/services/AssistantService.ts`：实现 Assistant/Topic 同批软删除与同批恢复；永久删除忽略 `deleteTopics`。
- 修改 `src/shared/data/api/schemas/assistants.ts`：只校正 `deleteTopics` 的说明，不改变 schema。
- 修改对应服务测试：`AgentSessionService.test.ts`、`AgentService.test.ts`、`TopicService.test.ts`、`AssistantService.test.ts`。

### Agent 运行时与频道

- 修改 `src/main/ai/agentSession/AgentSessionDeliveryService.ts`：两种 Agent 软删除都先暂停受影响的活跃 turn；数据库提交后的关闭失败只记录并等待后续对账，不把已提交删除报告为失败。
- 修改 `src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts`：覆盖级联暂停与提交后关闭失败。
- 修改 `src/main/ai/channels/ChannelManager.ts`：频道连接条件变为“频道启用且 Agent 活跃”，并响应 Agent trash/restore/purge 生命周期事件。
- 修改 `src/main/ai/channels/__tests__/ChannelManager.test.ts`：覆盖启动、单频道同步与 Agent 生命周期事件。

### 渲染层确认与入口

- 新增 `src/renderer/components/chat/DeleteConversationOwnerConfirmDialog.tsx`：受控确认组件、局部复选框状态与功能级 `createPopup` 包装器。
- 新增 `src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx`：验证默认值、选中值、重置、pending 与失败重试。
- 修改 `src/renderer/pages/agents/components/Sessions.tsx` 与测试：Agent 树删除入口；保护型内置 Agent 保持“删除全部会话”专用确认。
- 修改 `src/renderer/components/chat/resourceList/AgentResourceList.tsx` 与 `EntityResourceListActions.test.tsx`：经典布局 Agent 删除入口。
- 修改 `src/renderer/pages/home/Tabs/components/Topics.tsx` 与测试：Assistant 话题树删除入口。
- 修改 `src/renderer/components/chat/resourceList/AssistantResourceList.tsx` 与 `EntityResourceListActions.test.tsx`：经典布局 Assistant 删除入口。
- 修改 `src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx` 与测试：资源目录继续由父组件控制 open 状态，同时复用受控确认组件。

### 未关联会话、反馈与文档

- 修改 `src/renderer/pages/agents/AgentComposerSlot.tsx` 与现有聚焦测试：有 Session 但无活跃 Agent 时展示现有 `MissingAgentHomeComposer`，允许选择活跃 Agent。
- 修改 `src/renderer/pages/agents/AgentChat.tsx`：把既有 `handleSessionAgentChange` 和 pending 状态传给 composer slot。
- 修改 `src/renderer/pages/settings/DataSettings/TrashSettings/TrashDomainSections.tsx` 与测试：恢复 Assistant 后同时刷新 Topics；永久删除仍不传级联选项。
- 修改 `src/renderer/i18n/locales/*.json`：添加两个复选框文案，校正未关联 Session 提示与保护型 Agent 操作名称。
- 修改 `v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md`：记录默认单独删除、可选级联和对称恢复。

### 明确不改

- `packages/ui/src/components/composites/confirm-dialog/index.tsx`：现有 `content`、`confirmLoading`、`confirmDisabled` 足够；pending 时由受控 `onOpenChange` 阻止取消、Escape 与遮罩关闭。
- `src/shared/ipc/schemas/ai.ts`、`src/main/ipc/handlers/ai.ts`、`src/main/data/api/handlers/assistants.ts`：保留现有进程边界和请求/响应形状。
- Pins、tags、Assistant groups、prompt bindings 的现有删除行为不变。

## 任务 1：让活跃 Session 在所有者不可用时仍属于历史记录

**文件：**

- 修改：`src/main/data/services/__tests__/AgentSessionService.test.ts`
- 修改：`src/main/data/services/AgentSessionService.ts`

- [ ] 把现有“trashed Agent 隐藏 retained Session”测试改成契约测试，并补充独立恢复用例。测试必须断言：

```ts
expect(agentSessionService.search({ q: 'owner evidence', limit: 5 })).toEqual([
  expect.objectContaining({
    id: 'session-trashed-owner',
    subtitle: undefined,
    target: { sessionId: 'session-trashed-owner', agentId: 'agent-trashed-owner' }
  })
])
expect(agentSessionService.listByCursor().items.map(({ id }) => id)).toEqual([
  'session-trashed-owner',
  'session-true-orphan'
])
expect(agentSessionService.getById('session-trashed-owner').id).toBe('session-trashed-owner')
expect(
  agentSessionService.searchWithMetadataEvidence({ q: 'owner evidence', limit: 5, addressableOnly: true })
).toEqual([])
```

独立恢复测试先软删除 Agent 和 Session，再恢复 Session，断言 Session 的 `deletedAt` 为空但 `agentId` 保留；随后把 Session 更新到另一个活跃 Agent，再恢复原 Agent，断言新 `agentId` 不被覆盖。

- [ ] 运行测试并确认先失败：

```bash
pnpm test:main src/main/data/services/__tests__/AgentSessionService.test.ts
```

预期：常规 `search`、`listByCursor`、`getById` 或 `restore` 的新断言失败，而 `listAddressableByCursor` 仍通过。

- [ ] 修改 `AgentSessionService.ts`，把查询条件分成历史可见性和可投递性。实现要点如下：

```ts
// searchWithMetadataEvidence
const filters: SQL[] = [isNull(sessionsTable.deletedAt)]
if (query.agentId) filters.push(eq(agentsTable.id, query.agentId))
if (query.addressableOnly) filters.push(isNotNull(agentsTable.id))

// listByCursor
const ownerFilter = query.agentId
  ? query.inTrash
    ? eq(sessionsTable.agentId, query.agentId)
    : eq(agentsTable.id, query.agentId)
  : undefined

// getLatestActive
const ownerFilter = query.agentId === 'unlinked'
  ? isNull(agentsTable.id)
  : query.agentId
    ? eq(agentsTable.id, query.agentId)
    : undefined
```

`getById` 只按 Session ID 与 Session 自身 active 状态筛选，不再要求活跃 Agent。`listAddressableByCursor` 保留对活跃 Agent 的 inner join。`restore(id)` 移除“所属 Agent 必须活跃”的前置检查，只恢复指定 Session；`update({ agentId })` 的活跃 Agent 校验保持不变。

- [ ] 再运行聚焦测试并确认通过：

```bash
pnpm test:main src/main/data/services/__tests__/AgentSessionService.test.ts
```

预期：该文件全部通过；被 trashed Agent 引用的活跃 Session 出现在常规列表和未关联作用域，但不进入 addressable 结果。

- [ ] 提交：

```bash
git add src/main/data/services/AgentSessionService.ts src/main/data/services/__tests__/AgentSessionService.test.ts
git commit -S --signoff -m "fix(agent-session): expose unlinked session history"
```

## 任务 2：固定 Agent 删除与恢复的父子边界

**文件：**

- 修改：`src/main/data/services/__tests__/AgentService.test.ts`
- 修改：`src/main/data/services/AgentService.ts`

- [ ] 先改测试，覆盖以下四个外部契约：

1. `deleteAgent(id, { deleteSessions: false })` 只 trash Agent，活跃 Session 保留相同 `agentId` 与空 `deletedAt`。
2. `deleteAgent(id, { deleteSessions: true })` 只 trash 当时活跃的 Session，Agent 与这些 Session 的 `deletedAt` 完全相等，之前已 trash 的 Session 时间戳不变。
3. Session 在 Agent trash 后可独立恢复并重分配；原 Agent 恢复只恢复仍为同一 `(agentId, deletedAt)` 的 Session。
4. `deleteAgent(id, { deleteSessions: true, permanent: true })` 与 `deleteSessions: false` 等价：Session 保留自身 active/trash 状态，Agent FK 由数据库设为 null，结果不返回 `deletedSessionIds`。

把现有永久级联删除 Session 的测试改为：

```ts
agentService.deleteAgent(id)
const result = agentService.deleteAgent(id, { deleteSessions: true, permanent: true })

expect(result).toEqual({ deleted: true })
expect(
  await dbh.db
    .select({ id: agentSessionTable.id, agentId: agentSessionTable.agentId, deletedAt: agentSessionTable.deletedAt })
    .from(agentSessionTable)
    .orderBy(agentSessionTable.id)
).toEqual([
  expect.objectContaining({ id: 'session-active', agentId: null, deletedAt: null }),
  expect.objectContaining({ id: 'session-trashed', agentId: null, deletedAt: priorDeletedAt })
])
```

把事务回滚测试切换为软级联：令 Agent update 之后执行的 `pinService.purgeForEntityTx` 抛错，断言 Agent 与 Session 都保持 active。

- [ ] 运行测试并确认永久删除用例先失败：

```bash
pnpm test:main src/main/data/services/__tests__/AgentService.test.ts
```

预期：当前实现仍会在 `permanent: true, deleteSessions: true` 时删除 Session 并返回 ID。

- [ ] 在 `AgentService.deleteAgentForDelivery` 的入口一次性计算有效选项：

```ts
const permanent = options.permanent === true
const deleteSessions = !permanent && options.deleteSessions === true
```

所有后续分支只使用这两个局部变量。永久分支调用：

```ts
const sessionImpact = agentSessionService.prepareForAgentDeletionTx(tx, id, {
  deleteSessions: false
})
```

软删除分支继续只生成一个 `const trashedAt = Date.now()`，并把它同时传给 Session 级联和 Agent 更新。事务结果额外保留真正被本次写入的 `trashed.trashedIds`，公开结果使用该精确集合：

```ts
return {
  rowsAffected: result.changes,
  deletedSessionIds: deleteSessions ? trashed.trashedIds : undefined,
  sessionImpact: {
    sessionIds,
    taskScheduleIds: trashed.taskScheduleIds,
    changeKind: trashed.trashedIds.length > 0 ? 'membership' : 'projection',
    deliveryResults: trashed.deliveryResults
  }
}
```

永久分支的 `deletedSessionIds` 始终为 undefined；外层返回 `result.deletedSessionIds`，不要再用全部 `sessionImpact.sessionIds` 代替实际被 trash 的 Session。

不要改 `ai.agent.delete` schema，也不要为永久删除增加另一个方法。

- [ ] 运行测试并确认通过：

```bash
pnpm test:main src/main/data/services/__tests__/AgentService.test.ts
```

预期：同批恢复、独立恢复/重分配、永久保留 Session 与软级联回滚全部通过。

- [ ] 提交：

```bash
git add src/main/data/services/AgentService.ts src/main/data/services/__tests__/AgentService.test.ts
git commit -S --signoff -m "fix(agent): decouple session deletion"
```

## 任务 3：让 Assistant/Topic 使用同一批次语义

**文件：**

- 修改：`src/main/data/services/__tests__/TopicService.test.ts`
- 修改：`src/main/data/services/__tests__/AssistantService.test.ts`
- 修改：`src/main/data/services/TopicService.ts`
- 修改：`src/main/data/services/AssistantService.ts`
- 修改：`src/shared/data/api/schemas/assistants.ts`

- [ ] 在 `TopicService.test.ts` 增加事务辅助方法的契约测试：调用方提供 `deletedAt = 1234` 时，仅活跃 Topic 被标记为 1234；`restoreTrashedWithAssistantTx(tx, assistantId, 1234)` 只恢复仍带该 FK 和该时间戳的 Topic。

- [ ] 在 `AssistantService.test.ts` 增加与 Agent 对称的测试：默认单独 trash、选择级联、已 trash Topic 不加入批次、独立恢复/重分配后不被原 Assistant 取回、永久删除忽略 `deleteTopics`、级联中后续父写失败时全部回滚。

删除只验证 collaborator 被调用的断言，改用数据库最终状态。永久删除断言使用：

```ts
assistantDataService.delete('ast-1')
const result = assistantDataService.delete('ast-1', { deleteTopics: true, permanent: true })

expect(result.deletedTopicIds).toBeUndefined()
expect(await dbh.db.select().from(assistantTable)).toHaveLength(0)
expect(await dbh.db.select().from(topicTable)).toEqual([
  expect.objectContaining({ id: 'topic-active', assistantId: null, deletedAt: null }),
  expect.objectContaining({ id: 'topic-trashed', assistantId: null, deletedAt: priorDeletedAt })
])
```

- [ ] 运行两个测试文件并确认先失败：

```bash
pnpm test:main src/main/data/services/__tests__/TopicService.test.ts src/main/data/services/__tests__/AssistantService.test.ts
```

预期：Assistant restore 不恢复同批 Topic，永久删除仍受 `deleteTopics` 影响，Topic 批量软删除不能接收父时间戳。

- [ ] 修改 `TopicService.ts`，让事务内批量 trash 接收可选时间戳，并增加精确恢复方法：

```ts
private trashManyByIdsTx(
  tx: DbOrTx,
  ids: string[],
  options: { requireAll?: boolean; deletedAt?: number } = {}
): string[] {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return []

  const rows = tx
    .select({ id: topicTable.id })
    .from(topicTable)
    .where(and(inArray(topicTable.id, uniqueIds), isNull(topicTable.deletedAt)))
    .all()
  const trashedIds = rows.map(({ id }) => id)
  if (options.requireAll && trashedIds.length !== uniqueIds.length) {
    const foundIds = new Set(trashedIds)
    const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
    throw DataApiErrorFactory.notFound('Topic', missingId)
  }
  if (trashedIds.length === 0) return []

  const deletedAt = options.deletedAt ?? Date.now()
  for (let index = 0; index < trashedIds.length; index += SQLITE_INARRAY_CHUNK) {
    tx.update(topicTable)
      .set({ deletedAt })
      .where(inArray(topicTable.id, trashedIds.slice(index, index + SQLITE_INARRAY_CHUNK)))
      .run()
  }
  tagService.purgeForEntitiesTx(tx, 'topic', trashedIds)
  pinService.purgeForEntitiesTx(tx, 'topic', trashedIds)
  return trashedIds
}

restoreTrashedWithAssistantTx(tx: DbOrTx, assistantId: string, deletedAt: number): string[] {
  return tx
    .update(topicTable)
    .set({ deletedAt: null })
    .where(and(eq(topicTable.assistantId, assistantId), eq(topicTable.deletedAt, deletedAt)))
    .returning({ id: topicTable.id })
    .all()
    .map(({ id }) => id)
}
```

`deleteByAssistantIdTx` 把 `options.deletedAt` 原样传给 `trashManyByIdsTx`。Topic 的独立 `restore(id)` 不增加 Assistant 活跃校验。

- [ ] 修改 `AssistantService.ts`。删除入口只认有效级联选项，并在同一写事务生成批次时间：

```ts
return dbService.withWriteTx((tx) => {
  const permanent = options.permanent === true
  if (permanent) {
    return { deleted: this.permanentlyDeleteTx(tx, id), deletedTopicIds: undefined }
  }

  const deleteTopics = options.deleteTopics === true
  const trashedAt = Date.now()
  const deletedTopicIds = deleteTopics
    ? topicService.deleteByAssistantIdTx(tx, id, { validateAssistant: false, deletedAt: trashedAt })
    : []
  const deleted = this.deleteTx(tx, id, trashedAt)
  return { deleted, deletedTopicIds: deleteTopics ? deletedTopicIds : undefined }
})
```

`deleteTx` 接收调用方提供的 `deletedAt`。`restore(id)` 改为一个写事务：先读取 Assistant 的 `deletedAt`，再恢复 Assistant，并调用 `restoreTrashedWithAssistantTx`；事务提交后分别通知 Assistant 与实际恢复的 Topic 读模型。返回值仍是现有 Assistant 响应类型。

- [ ] 更新 `src/shared/data/api/schemas/assistants.ts` 中 `deleteTopics` 的注释，明确它只影响软删除；schema 字段、默认值和结果字段完全不变。

- [ ] 重跑测试：

```bash
pnpm test:main src/main/data/services/__tests__/TopicService.test.ts src/main/data/services/__tests__/AssistantService.test.ts
```

预期：两个文件全部通过，Agent 与 Assistant 的父子删除/恢复规则对称。

- [ ] 提交：

```bash
git add src/main/data/services/TopicService.ts src/main/data/services/AssistantService.ts src/shared/data/api/schemas/assistants.ts src/main/data/services/__tests__/TopicService.test.ts src/main/data/services/__tests__/AssistantService.test.ts
git commit -S --signoff -m "fix(assistant): align topic trash batches"
```

## 任务 4：把 Agent 删除后的运行时处理变成提交后尽力而为

**文件：**

- 修改：`src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts`
- 修改：`src/main/ai/agentSession/AgentSessionDeliveryService.ts`

- [ ] 扩展现有 Agent 删除测试，让 `deleteAgent('agent-1', true)` 和 `deleteAgent('agent-1', false)` 都断言 `pauseRuntimeTurn` 先于 `closeSession`。

- [ ] 增加关闭失败测试：让持久层返回 `deleted: true`，`closeSession` reject，断言公开方法仍 resolve 已提交结果、delivery kick 仍执行且 logger 记录失败 Session ID。

```ts
// 加入 hoisted mocks
logError: vi.fn(),

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: mocks.logError, debug: vi.fn() })
  }
}))

mocks.closeSession.mockRejectedValueOnce(new Error('close failed'))
mocks.deleteAgent.mockReturnValue({
  deleted: true,
  deletedSessionIds: ['target'],
  affectedSessionIds: ['target'],
  deliveryResults: [{ ...accepted, sessionId: 'sender' }]
})

await expect(service.deleteAgent('agent-1', true)).resolves.toMatchObject({ deleted: true })
await flush()
expect(mocks.listAccepted).toHaveBeenCalledWith('sender')
expect(mocks.logError).toHaveBeenCalledWith(
  'Failed to close Agent Session runtime after committed deletion',
  expect.objectContaining({ sessionId: 'target', error: expect.any(Error) })
)
```

- [ ] 运行测试并确认先失败：

```bash
pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts
```

预期：级联路径没有 pause，关闭失败会 reject 已提交删除。

- [ ] 修改 `deleteAgent`，不再以 `deleteSessions` 决定是否 pause：

```ts
const manager = application.get('AiStreamManager')
for (const sessionId of result.affectedSessionIds) {
  manager.pauseRuntimeTurn(buildAgentSessionTopicId(sessionId), 'target-agent-deleted')
}
```

保留数据库删除在先、运行时收口在后的顺序。修改共享 `finishDeletion`：继续使用 `Promise.allSettled`，逐个记录 close 失败，随后照常 kick 持久化的 delivery result；删除抛出 `AggregateError` 的分支。不要吞掉数据库事务本身的异常。

- [ ] 重跑测试：

```bash
pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts
```

预期：所有删除路径先 pause/close，再 kick；close 失败不改变已提交结果。

- [ ] 提交：

```bash
git add src/main/ai/agentSession/AgentSessionDeliveryService.ts src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts
git commit -S --signoff -m "fix(agent-runtime): reconcile committed deletions"
```

## 任务 5：把 Agent 活跃状态加入频道连接门控

**文件：**

- 修改：`src/main/ai/channels/__tests__/ChannelManager.test.ts`
- 修改：`src/main/ai/channels/ChannelManager.ts`

- [ ] 给测试增加 `agentService` mock，暴露活跃判断和三个事件订阅。使用可调用的 listener 变量验证：

1. 启动时，启用频道引用 trashed/missing Agent 时不创建 adapter。
2. `syncChannel` 在 Agent inactive 时只断开、不重连。
3. Agent trash 和 purge 事件断开该 Agent 的所有 adapter 并清理 Session tracker。
4. Agent restore 事件重新读取该 Agent 的频道，只连接 `isActive: true` 的记录，不修改数据库中的 `isActive`。

- [ ] 运行测试并确认先失败：

```bash
pnpm test:main src/main/ai/channels/__tests__/ChannelManager.test.ts
```

预期：当前启动与 sync 只检查频道自身 `isActive`，且没有 Agent 生命周期订阅。

- [ ] 在 `ChannelManager` 中集中定义准入检查：

```ts
private canConnect(channel: ChannelRow): boolean {
  return Boolean(
    channel.isActive && channel.agentId && agentService.getLifecycleState(channel.agentId) === 'active'
  )
}
```

使用现有 `getLifecycleState`，不要从 `ChannelManager` 直接查询数据库。启动和 `syncChannel` 都调用同一个检查。

- [ ] 在生命周期初始化中使用 `registerDisposable` 注册：

```ts
protected async onReady(): Promise<void> {
  this.registerDisposable(
    agentService.onAgentTrashed(({ agentId }) => this.runAgentReconciliation('trash', agentId, () => this.disconnectAgent(agentId)))
  )
  this.registerDisposable(
    agentService.onAgentRestored(({ agentId }) => this.runAgentReconciliation('restore', agentId, () => this.syncAgent(agentId)))
  )
  this.registerDisposable(
    agentService.onAgentPurged(({ agentId }) => this.runAgentReconciliation('purge', agentId, () => this.disconnectAgent(agentId)))
  )
  await this.start()
}

private runAgentReconciliation(action: 'trash' | 'restore' | 'purge', agentId: string, run: () => Promise<void>): void {
  void run().catch((error) => {
    logger.error('Failed to reconcile channels after Agent lifecycle change', { action, agentId, error })
  })
}

private async syncAgent(agentId: string): Promise<void> {
  const channels = channelService.listChannels({ agentId })
  const outcomes = await Promise.allSettled(channels.map(({ id }) => this.syncChannel(id)))
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === 'rejected') {
      logger.warn('Failed to sync Agent channel', {
        agentId,
        channelId: channels[index]?.id,
        error: outcome.reason
      })
    }
  }
}
```

每个异步事件 handler 自己 catch 并通过模块 logger 记录，不向已经提交的 Agent 操作反抛。

- [ ] 重跑测试：

```bash
pnpm test:main src/main/ai/channels/__tests__/ChannelManager.test.ts
```

预期：频道配置完整保留，实际连接始终满足 `channel.isActive && agent active`。

- [ ] 提交：

```bash
git add src/main/ai/channels/ChannelManager.ts src/main/ai/channels/__tests__/ChannelManager.test.ts
git commit -S --signoff -m "fix(agent-channel): gate connections by agent state"
```

## 任务 6：实现带复选框的功能级确认组件

**文件：**

- 新增：`src/renderer/components/chat/DeleteConversationOwnerConfirmDialog.tsx`
- 新增：`src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx`
- 修改：`src/renderer/i18n/locales/en-us.json`
- 修改：`src/renderer/i18n/locales/de-de.json`
- 修改：`src/renderer/i18n/locales/el-gr.json`
- 修改：`src/renderer/i18n/locales/es-es.json`
- 修改：`src/renderer/i18n/locales/fr-fr.json`
- 修改：`src/renderer/i18n/locales/ja-jp.json`
- 修改：`src/renderer/i18n/locales/pt-pt.json`
- 修改：`src/renderer/i18n/locales/ro-ro.json`
- 修改：`src/renderer/i18n/locales/ru-ru.json`
- 修改：`src/renderer/i18n/locales/tr-tr.json`
- 修改：`src/renderer/i18n/locales/vi-vn.json`
- 修改：`src/renderer/i18n/locales/zh-cn.json`
- 修改：`src/renderer/i18n/locales/zh-tw.json`

- [ ] 先写真实 UI 交互测试。该测试文件按前端测试指南显式使用真实 `@cherrystudio/ui`，不要依赖全局简化 mock。覆盖：

```ts
const onConfirm = vi.fn()

function Harness({ type }: { type: 'agent' | 'assistant' }) {
  const [open, setOpen] = useState(true)
  return (
    <DeleteConversationOwnerConfirmDialog
      type={type}
      open={open}
      pending={false}
      onOpenChange={setOpen}
      onConfirm={onConfirm}
    />
  )
}

it('defaults to standalone deletion', async () => {
  const user = userEvent.setup()
  render(<Harness type="agent" />)
  await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
  expect(onConfirm).toHaveBeenCalledWith(false)
})

it('passes the checked cascade choice', async () => {
  const user = userEvent.setup()
  render(<Harness type="assistant" />)
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
  expect(onConfirm).toHaveBeenCalledWith(true)
})
```

另测 close→open 与 target `key` remount 后恢复未选中；`pending` 时 Checkbox disabled，取消、Escape 与遮罩都不能触发外层关闭；action reject 后 dialog 保持打开并可重试。

- [ ] 运行测试并确认组件尚不存在：

```bash
pnpm test:renderer src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx
```

预期：导入失败或新行为测试失败。

- [ ] 新增模块级受控组件，API 保持窄且由调用方持有 open/pending：

```tsx
export interface DeleteConversationOwnerConfirmDialogProps {
  type: 'agent' | 'assistant'
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (deleteChildren: boolean) => void | Promise<void>
}

export function DeleteConversationOwnerConfirmDialog({
  type,
  open,
  pending,
  onOpenChange,
  onConfirm
}: DeleteConversationOwnerConfirmDialogProps) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [deleteChildren, setDeleteChildren] = useState(false)
  const preventNextCloseRef = useRef(false)
  const handleConfirm = async () => {
    try {
      await onConfirm(deleteChildren)
    } catch {
      preventNextCloseRef.current = true
    }
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && preventNextCloseRef.current) {
      preventNextCloseRef.current = false
      return
    }
    if (!nextOpen && pending) return
    if (!nextOpen || !open) setDeleteChildren(false)
    onOpenChange(nextOpen)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('recycle_bin.move.confirm_title')}
      confirmText={t('recycle_bin.move.confirm_action')}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      confirmDisabled={pending}
      content={
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={deleteChildren}
            disabled={pending}
            onCheckedChange={(checked) => setDeleteChildren(checked === true)}
          />
          <Label htmlFor={checkboxId}>
            {t(type === 'agent' ? 'recycle_bin.move.related_sessions' : 'recycle_bin.move.related_topics')}
          </Label>
        </div>
      }
      onConfirm={handleConfirm}
    />
  )
}
```

`preventNextCloseRef` 只拦截 `ConfirmDialog` 在 action reject 后发出的那一次成功关闭请求，因此既不产生未处理的 Promise rejection，也不需要修改共享组件契约。不要加 Effect、简单派生值的 memo 或共享全局状态。调用方以所有者 ID 作为 React `key`，切换目标时自然 remount。

- [ ] 在同一文件导出功能级 `deleteConversationOwnerPopup`。它用 `createPopup<Params, boolean>`，参数只有 `type` 与 `action(deleteChildren)`；自身持有 pending。使用以下控制流，失败 toast、清 pending 并抛回受控组件，用户可以重试；`dismissResult` 为 `false`：

```tsx
export interface DeleteConversationOwnerPopupParams {
  type: 'agent' | 'assistant'
  action: (deleteChildren: boolean) => void | Promise<void>
}

type PopupProps = DeleteConversationOwnerPopupParams & PopupInjectedProps<boolean>

const DeleteConversationOwnerPopupContainer = ({ open, resolve, type, action }: PopupProps) => {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const handleConfirm = async (deleteChildren: boolean) => {
    setPending(true)
    try {
      await action(deleteChildren)
    } catch (error) {
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      setPending(false)
      throw error
    }
    resolve(true)
  }

  return (
    <DeleteConversationOwnerConfirmDialog
      type={type}
      open={open}
      pending={pending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) resolve(false)
      }}
      onConfirm={handleConfirm}
    />
  )
}

export const deleteConversationOwnerPopup = createPopup<DeleteConversationOwnerPopupParams, boolean>(
  DeleteConversationOwnerPopupContainer,
  { dismissResult: false }
)
```

- [ ] 在 `en-us.json` 添加：

```json
"recycle_bin.move.related_sessions": "Also move related sessions to the Recycle Bin",
"recycle_bin.move.related_topics": "Also move related topics to the Recycle Bin"
```

运行同步，再把所有语言中的两个新键翻译完整：

```bash
pnpm i18n:sync
```

`zh-cn.json` 必须为：

```json
"recycle_bin.move.related_sessions": "同时将关联会话移入回收站",
"recycle_bin.move.related_topics": "同时将关联话题移入回收站"
```

`zh-tw.json` 必须为：

```json
"recycle_bin.move.related_sessions": "同時將關聯工作階段移入資源回收筒",
"recycle_bin.move.related_topics": "同時將關聯話題移入資源回收筒"
```

其余目录使用对应语言的自然译文；完成后执行 `rg -n '\[to be translated\]:' src/renderer/i18n/locales`，预期无输出。

- [ ] 重跑组件测试：

```bash
pnpm test:renderer src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx
```

预期：默认 false、选中 true、重置、pending 和重试全部通过。

- [ ] 提交：

```bash
git add src/renderer/components/chat/DeleteConversationOwnerConfirmDialog.tsx src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx src/renderer/i18n/locales
git commit -S --signoff -m "feat(conversation-owner): add cascade delete choice"
```

## 任务 7：接入 Agent 与 Assistant 的树形/经典布局入口

**文件：**

- 修改：`src/renderer/pages/agents/components/Sessions.tsx`
- 修改：`src/renderer/pages/agents/components/agentGroupActions.tsx`
- 修改：`src/renderer/pages/agents/components/__tests__/Sessions.test.tsx`
- 修改：`src/renderer/components/chat/resourceList/AgentResourceList.tsx`
- 修改：`src/renderer/components/chat/resourceList/AssistantResourceList.tsx`
- 修改：`src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx`
- 修改：`src/renderer/pages/home/Tabs/components/Topics.tsx`
- 修改：`src/renderer/pages/home/Tabs/components/__tests__/Topics.test.tsx`
- 修改：`src/renderer/i18n/locales/*.json`

- [ ] 在现有消费者测试中 mock `deleteConversationOwnerPopup.show`，分别令 action 接收 `false` 与 `true`。每类所有者至少断言：

```ts
expect(ipcApi.request).toHaveBeenCalledWith('ai.agent.delete', {
  agentId,
  deleteSessions: false
})
expect(deleteAssistant).toHaveBeenCalledWith(assistantId, { deleteTopics: false })
```

选中级联的用例断言 boolean 为 true，并且只关闭返回的 `deletedSessionIds` / `deletedTopicIds`。单独删除用例断言当前子 tab 和选中项保持不变。

- [ ] 更新保护型内置 Agent 测试：确认文案是 “Delete all sessions” / “删除全部会话”，不渲染级联 Checkbox，只调用 `ai.agent.sessions.delete`；仅返回的 active Session 进入回收站，Agent、任务和频道操作不发生。

- [ ] 运行三个聚焦测试文件并确认先失败：

```bash
pnpm test:renderer src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx src/renderer/pages/home/Tabs/components/__tests__/Topics.test.tsx
```

预期：当前入口使用 `popup.confirm` 并固定传 true，且保护型操作仍显示旧名称。

- [ ] 在四个普通所有者入口调用新 popup，把整个可失败动作放进 `action`：

```ts
await deleteConversationOwnerPopup.show({
  type: 'agent',
  action: async (deleteSessions) => {
    const result = await ipcApi.request('ai.agent.delete', { agentId, deleteSessions })
    if (!result.deleted) {
      await refreshAgentResources()
      toast.info(t('recycle_bin.already_moved'))
      return
    }
    const deletedSessionIds = result.deletedSessionIds ?? []
    if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)
    if (currentActiveSession && deletedSessionIds.includes(currentActiveSession.id)) {
      await onActiveAgentDeleted?.(agentId)
    }
    await refreshAgentResources()
  }
})
```

现有 `showRecycleBinUndo` 保持在成功 action 内，继续使用原来的 restore callback。Assistant 使用同一结构并把参数映射为 `{ deleteTopics }`，仅当 `deletedTopicIds.includes(activeTopic.id)` 时触发 active-topic 协调。刷新使用 `Promise.allSettled` 或现有 best-effort helper；数据库 NOT_FOUND 走既有 stale 反馈与刷新。不要为了复选框预取子项数量。

- [ ] 删除 Agent 时，只在当前 Session ID 位于 `deletedSessionIds` 时清理当前选择或选择替代项；删除 Assistant 时采用同样规则处理 Topic。单独删除不得关闭或跳走活跃子会话。

- [ ] 把局部变量 `deleteTasksOnly` 重命名为 `deleteSessionsOnly`，准确表达保护型内置 Agent 行为。将现有 i18n 键 `agent.session.agent.delete.trigger/title` 更新为 “Delete all sessions” / “删除全部会话”，运行 `pnpm i18n:sync` 并完成所有语言译文。

- [ ] 重跑测试：

```bash
pnpm test:renderer src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx src/renderer/pages/home/Tabs/components/__tests__/Topics.test.tsx
```

预期：两种选择映射正确，单独删除保留 tab，级联只关闭返回 ID，保护型流程不出现 Checkbox。

- [ ] 提交：

```bash
git add src/renderer/pages/agents/components/Sessions.tsx src/renderer/pages/agents/components/agentGroupActions.tsx src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/AgentResourceList.tsx src/renderer/components/chat/resourceList/AssistantResourceList.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx src/renderer/pages/home/Tabs/components/Topics.tsx src/renderer/pages/home/Tabs/components/__tests__/Topics.test.tsx src/renderer/i18n/locales
git commit -S --signoff -m "feat(conversation-owner): wire deletion choices"
```

## 任务 8：接入资源目录的受控删除对话框

**文件：**

- 修改：`src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx`
- 修改：`src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx`

- [ ] 扩展资源目录测试：Agent 与 Assistant 初始确认分别传 `deleteSessions: false` / `deleteTopics: false`；选中 Checkbox 后传 true；切换 `resource.id` 后 Checkbox 重置；删除 reject 时 dialog 保持打开；单独删除不关闭会话 tab；级联只关闭结果 ID。

- [ ] 运行测试并确认先失败：

```bash
pnpm test:renderer src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx
```

预期：当前 Agent/Assistant 路径固定级联，并由通用 `DeleteDialogContent` 渲染。

- [ ] 保留 Skill 与 Prompt 的 `DeleteDialogContent`。Agent/Assistant 分支直接渲染受控组件，并用资源类型与 ID 作为 key：

```tsx
<DeleteConversationOwnerConfirmDialog
  key={`${resource.type}:${resource.id}`}
  type="assistant"
  open
  pending={pending}
  onOpenChange={(open) => {
    if (!open && !pending) onClose()
  }}
  onConfirm={handleConfirm}
/>
```

`handleConfirm(deleteTopics)` / `handleConfirm(deleteSessions)` 在事件处理器内 set pending、执行数据库动作和 best-effort refresh；成功后调用 `onClose`，失败 toast 后重新抛出，保证 dialog 可重试。保护型内置 Agent 继续使用原 `ConfirmDialog`，不渲染复选框。

- [ ] Assistant restore mutation 的 refresh 列表必须包含 `/topics`；Agent restore 保留 `/agent-sessions`。tab 关闭只使用服务实际返回的 ID。

- [ ] 重跑测试：

```bash
pnpm test:renderer src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx
```

预期：受控路径、重置、失败重试与 tab 行为全部通过，Skill/Prompt 测试不变。

- [ ] 提交：

```bash
git add src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx
git commit -S --signoff -m "feat(resource-catalog): choose owner cascade deletion"
```

## 任务 9：允许未关联 Session 选择新的活跃 Agent

**文件：**

- 修改：`src/renderer/pages/agents/__tests__/AgentComposerSlot.test.tsx`
- 修改：`src/renderer/pages/agents/__tests__/AgentChatSettingsPanel.test.tsx`
- 修改：`src/renderer/pages/agents/AgentComposerSlot.tsx`
- 修改：`src/renderer/pages/agents/AgentChat.tsx`
- 修改：`src/renderer/i18n/locales/*.json`

- [ ] 先修改现有 `AgentComposerSlot.test.tsx`：保留“Agent 元数据加载中仍显示普通 composer”的断言；另给一个现存 Session 传 `agentId={undefined}`，断言展示 Agent selector 与阻塞发送提示；选择活跃 Agent 后调用 `onAgentChange(newAgentId)`，并显示 pending 状态。

- [ ] 在 `AgentChatSettingsPanel.test.tsx` 调整 `MissingAgentHomeComposer` mock，使其按钮调用收到的 `onAgentChange('agent-2')`；以 retained Session 和已完成但返回 undefined 的 Agent resource 渲染 `AgentChat`，点击后断言只调用：

```ts
updateSession(
  { id: existingSessionId, agentId: nextAgentId },
  { showSuccessToast: false }
)
```

消息、workspace 与 Session ID 不发生创建或替换。服务端的 `AgentSessionService.update` 负责拒绝 inactive Agent。

- [ ] 运行测试并确认先失败：

```bash
pnpm test:renderer src/renderer/pages/agents/__tests__/AgentComposerSlot.test.tsx src/renderer/pages/agents/__tests__/AgentChatSettingsPanel.test.tsx
```

预期：当前 Agent 查询已完成但 `composerAgentId` 为 undefined 时不渲染任何 composer，没有可用的重新绑定入口。

- [ ] 复用已经导出的 `MissingAgentHomeComposer`。`AgentChat` 现有 `composerAgentId` 已区分“仍在加载”（保留 Session FK）与“查询完成但 Agent 不活跃”（undefined），因此 slot 只按该 prop 选择 fallback：

```tsx
const fallback = !isMultiSelectMode
  ? agentId
    ? <AgentComposer
        agentId={agentId}
        sessionId={sessionId}
        sessionOverride={session}
        resolvedAgent={activeAgent}
        resolvedModel={activeModel}
        resolvedWorkspaceWarning={workspaceWarning ?? null}
        externalContextControls
        sendMessage={sendMessage}
        stop={stop}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        onCreateEmptySession={onCreateEmptySession}
        compactWhenSingleLine={compactWhenSingleLine}
        launchOptions={composerLaunchOptions}
      />
    : <MissingAgentHomeComposer onAgentChange={onAgentChange} agentChanging={agentChanging} />
  : undefined
```

新增的 slot props 只有：

```ts
onAgentChange?: (agentId: string | null) => void | Promise<void>
agentChanging?: boolean
```

`AgentChat` 在 `handleSessionAgentChange` 周围维护局部 pending，并把 handler 传入 slot。不要创建默认 Agent，不要复制 Session，也不要用 Effect 发起重绑定。

- [ ] 更新 `agent.session.group.unknown_agent_tip`，英文明确“Choose an active Agent to continue this Session”，简体中文使用“选择一个已启用的智能体后即可继续此会话”；同步并翻译全部目录。

- [ ] 重跑测试：

```bash
pnpm test:renderer src/renderer/pages/agents/__tests__/AgentComposerSlot.test.tsx src/renderer/pages/agents/__tests__/AgentChatSettingsPanel.test.tsx
```

预期：未关联 Session 可查看但发送受阻，选择活跃 Agent 后原 Session 原地恢复可执行关联。

- [ ] 提交：

```bash
git add src/renderer/pages/agents/AgentComposerSlot.tsx src/renderer/pages/agents/AgentChat.tsx src/renderer/pages/agents/__tests__/AgentComposerSlot.test.tsx src/renderer/pages/agents/__tests__/AgentChatSettingsPanel.test.tsx src/renderer/i18n/locales
git commit -S --signoff -m "feat(agent-session): reassign unlinked sessions"
```

## 任务 10：补齐回收站刷新、用户文档与整体验证

**文件：**

- 修改：`src/renderer/pages/settings/DataSettings/TrashSettings/TrashDomainSections.tsx`
- 修改：`src/renderer/pages/settings/DataSettings/TrashSettings/__tests__/TrashDomainSections.test.tsx`
- 修改：`v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md`
- 验证：本计划列出的全部实现与测试文件

- [ ] 修改 Assistant restore mutation，让 refresh 同时包含所有者与子读模型：

```ts
useMutation('POST', '/assistants/:id/restore', {
  refresh: ['/assistants', '/assistants/*', '/topics']
})
```

确认回收站永久 Agent 删除仍显式传 `deleteSessions: false`，永久 Assistant 删除不传 `deleteTopics`；不要给永久删除界面增加复选框。

- [ ] 在 `TrashDomainSections.test.tsx` 断言 Assistant restore 会刷新 `/assistants`、对应详情与 `/topics`，并保留现有永久删除 payload 断言。运行：

```bash
pnpm test:renderer src/renderer/pages/settings/DataSettings/TrashSettings/__tests__/TrashDomainSections.test.tsx
```

预期：加入 `/topics` 后全部通过，Agent/Assistant 永久删除仍不级联。

- [ ] 更新 breaking-change 文档，明确以下可感知行为：默认只移动所有者、复选框可同时移动关联会话、未关联会话仍可查看和重分配、恢复只带回同批且仍在回收站中的会话、永久删除不改变子会话 active/trash 状态。

- [ ] 运行数据与运行时聚焦测试：

```bash
pnpm test:main src/main/data/services/__tests__/AgentSessionService.test.ts src/main/data/services/__tests__/AgentService.test.ts src/main/data/services/__tests__/TopicService.test.ts src/main/data/services/__tests__/AssistantService.test.ts src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts src/main/ai/channels/__tests__/ChannelManager.test.ts src/main/ai/agents/__tests__/AgentJobsService.test.ts
```

预期：全部通过；现有 task marker、启动对账和 purge 清理测试继续通过。

- [ ] 运行渲染层聚焦测试：

```bash
pnpm test:renderer src/renderer/components/chat/__tests__/DeleteConversationOwnerConfirmDialog.test.tsx src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx src/renderer/pages/home/Tabs/components/__tests__/Topics.test.tsx src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx src/renderer/pages/agents/__tests__/AgentComposerSlot.test.tsx src/renderer/pages/agents/__tests__/AgentChatSettingsPanel.test.tsx src/renderer/pages/settings/DataSettings/TrashSettings/__tests__/TrashDomainSections.test.tsx
```

预期：全部通过；两种所有者、两种选择、五个入口、保护型 Agent 和未关联重新绑定均有覆盖。

- [ ] 按批准规格逐项审计，并记录为本任务的自查清单：

```text
[ ] 默认未选中且每次打开重置
[ ] soft standalone 只删除 owner
[ ] soft cascade 同事务、同 deletedAt、只影响 active child
[ ] restore 只恢复仍 trash 的同 FK/同 deletedAt child
[ ] 独立恢复和重分配不被 former owner restore 覆盖
[ ] permanent 忽略级联 boolean，child 状态不变且 FK SET NULL
[ ] general history 可见，addressable/runtime 要求 active owner
[ ] Agent turn 暂停，close/channel/refresh 失败不伪装成 DB 失败
[ ] task marker 在 task metadata，channel isActive 保留
[ ] protected Agent 仅“删除全部会话”，无 checkbox
[ ] backend route 与 payload shape 不变
[ ] pins/tags/groups/prompt bindings 契约不变
```

- [ ] 扫描计划执行后的代码，确保没有未完成标记和翻译前缀：

```bash
rg -n 'T[O]DO|T[B]D|FIX[M]E|\[to be translated\]:' \
  src/main/data/services \
  src/main/ai/agentSession \
  src/main/ai/channels \
  src/renderer/components/chat \
  src/renderer/components/resourceCatalog/dialogs/delete \
  src/renderer/pages/agents \
  src/renderer/pages/home/Tabs/components \
  src/renderer/i18n/locales
```

预期：本次新增或修改区域没有新引入的命中；若命中原有内容，只核对不修改无关代码。

- [ ] 运行仓库门禁。`pnpm lint` 会写格式，完成后检查 diff：

```bash
pnpm lint
git diff --check
pnpm docs:check
pnpm test:lint
pnpm build:check
```

预期：所有命令退出码为 0。此变更横跨数据、IPC 后置运行时与多个渲染入口，因此执行完整 `build:check`，不以聚焦测试代替最终门禁。

- [ ] 检查只包含本需求相关文件，并提交最终补充：

```bash
git status --short
git diff --stat
git add src/renderer/pages/settings/DataSettings/TrashSettings/TrashDomainSections.tsx src/renderer/pages/settings/DataSettings/TrashSettings/__tests__/TrashDomainSections.test.tsx v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md
git commit -S --signoff -m "docs(conversation-owner): explain deletion choices"
git cat-file commit HEAD | rg '^(gpgsig|Signed-off-by:)'
```

预期：提交对象包含 `gpgsig` 与 `Signed-off-by:`，工作树干净。
