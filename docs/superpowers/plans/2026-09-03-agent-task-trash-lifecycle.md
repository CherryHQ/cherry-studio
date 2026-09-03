# Agent 任务回收站生命周期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Agent 移入回收站时永久删除任务与频道订阅，明确区分 trash/purge 生命周期，并禁止 inactive Agent 的任务命令。

**架构：** `AgentService` 在事务提交后发布独立的 `onAgentTrashed` 和 `onAgentPurged` 事件；`AgentJobsService` 订阅二者并继续通过 `JobManager.unregisterJobScheduleById()` 删除任务。启动与 purge 以 `deleteSchedulesForInactiveAgents()` 对账，renderer 三个真实 Agent 删除入口展示不可逆警告，restore 不重建任何任务。

**技术栈：** TypeScript、Electron lifecycle services、better-sqlite3/Drizzle、JobManager/SchedulerService、React、i18next、Vitest、Testing Library。

---

## 文件结构

- 修改 `src/main/data/services/AgentService.ts`：定义并发布 trash/purge 事件；记录 restore 不恢复任务；提供 purge 的提交后通知入口。
- 修改 `src/main/data/services/__tests__/AgentService.test.ts`：验证软删除与永久删除发布不同事件且只在成功提交后发布。
- 修改 `src/main/ai/agents/AgentJobsService.ts`：订阅两个事件，增加 inactive Agent 守卫，重命名并启动对账。
- 修改 `src/main/ai/agents/__tests__/AgentJobsService.test.ts`：验证 trash→restore 不恢复任务、purge 清理、inactive 命令拒绝和启动对账。
- 修改 `src/main/services/trash/trashPurgeJobHandler.ts`：通过 AgentService 发布 purge 事件并调用重命名后的对账方法。
- 修改 `src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts`：验证 purge 事件发生在提交后，并更新对账方法契约。
- 修改 `src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx`：资源目录的普通 Agent 删除确认展示警告。
- 修改 `src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx`：普通 Agent 显示、受保护 Agent 不显示警告。
- 修改 `src/renderer/pages/agents/components/Sessions.tsx`：Agent 会话页的普通 Agent 删除确认展示警告。
- 修改 `src/renderer/pages/agents/components/__tests__/Sessions.test.tsx`：覆盖会话页两种 Agent 删除边界。
- 修改 `src/renderer/components/chat/resourceList/AgentResourceList.tsx`：经典布局 Agent 列表的普通 Agent 删除确认展示警告。
- 修改 `src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx`：覆盖经典布局两种 Agent 删除边界。
- 修改 `src/renderer/i18n/locales/en-us.json`、`de-de.json`、`el-gr.json`、`es-es.json`、`fr-fr.json`、`ja-jp.json`、`pt-pt.json`、`ro-ro.json`、`ru-ru.json`、`tr-tr.json`、`vi-vn.json`、`zh-cn.json`、`zh-tw.json`：加入 `recycle_bin.move.agent_tasks_warning` 的完整翻译。
- 修改 `v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md`：记录 Agent 任务与频道订阅不会随 restore 恢复。

## 任务 1：拆分 Agent 生命周期事件

**文件：**
- 修改：`src/main/data/services/AgentService.ts:54-56,254-255,792-926`
- 测试：`src/main/data/services/__tests__/AgentService.test.ts:1063-1360`

- [ ] **步骤 1：先写区分 trash 与 purge 的失败测试**

在 `describe('deleteAgent')` 中增加：

```ts
it('publishes distinct lifecycle events after trash and permanent deletion', async () => {
  const { id } = await insertAgent({ id: 'agent_lifecycle_events_001' })
  const trashed: string[] = []
  const purged: string[] = []
  const trashDisposable = agentService.onAgentTrashed(({ agentId }) => trashed.push(agentId))
  const purgeDisposable = agentService.onAgentPurged(({ agentId }) => purged.push(agentId))

  try {
    expect(agentService.deleteAgent(id)).toMatchObject({ deleted: true })
    expect(trashed).toEqual([id])
    expect(purged).toEqual([])

    expect(agentService.deleteAgent(id, { permanent: true })).toMatchObject({ deleted: true })
    expect(trashed).toEqual([id])
    expect(purged).toEqual([id])
  } finally {
    trashDisposable.dispose()
    purgeDisposable.dispose()
  }
})

it('does not publish a lifecycle event for a stale delete', async () => {
  const trashed: string[] = []
  const disposable = agentService.onAgentTrashed(({ agentId }) => trashed.push(agentId))
  try {
    expect(agentService.deleteAgent('missing-agent')).toMatchObject({ deleted: false })
    expect(trashed).toEqual([])
  } finally {
    disposable.dispose()
  }
})
```

- [ ] **步骤 2：运行测试并确认旧事件 API 使测试失败**

运行：

```bash
pnpm test:main src/main/data/services/__tests__/AgentService.test.ts
```

预期：FAIL，TypeScript/Vitest 报告 `onAgentTrashed` 和 `onAgentPurged` 不存在。

- [ ] **步骤 3：实现两个提交后事件并明确 restore 契约**

在 `AgentService.ts` 中以一个共享载荷类型替换 `AgentDeletedEvent`：

```ts
export interface AgentLifecycleEvent {
  agentId: string
}
```

在服务字段中替换旧 emitter：

```ts
private readonly agentTrashedEmitter = new Emitter<AgentLifecycleEvent>()
readonly onAgentTrashed: Event<AgentLifecycleEvent> = this.agentTrashedEmitter.event

private readonly agentPurgedEmitter = new Emitter<AgentLifecycleEvent>()
readonly onAgentPurged: Event<AgentLifecycleEvent> = this.agentPurgedEmitter.event
```

在 `deleteAgentForDelivery()` 的事务后成功分支中发布唯一事件：

```ts
if (deleted) {
  notifyDataApiDataChange([
    { endpoint: '/agents', kind: 'membership', entityIds: [id] },
    { endpoint: '/agents/:agentId', routeParams: { agentId: id }, entityIds: [id] }
  ])
  promptService.notifyTargetBindingsChanged()
  if (permanent) this.agentPurgedEmitter.fire({ agentId: id })
  else this.agentTrashedEmitter.fire({ agentId: id })
}
```

将 restore 文档改为：

```ts
/**
 * Restore a trashed agent and the sessions moved to the Recycle Bin with it.
 * Task schedules and channel subscriptions are permanently deleted at trash time and are not restored.
 */
```

- [ ] **步骤 4：运行 AgentService 测试并确认通过**

运行：

```bash
pnpm test:main src/main/data/services/__tests__/AgentService.test.ts
```

预期：PASS；原有 Agent trash/restore/permanent-delete 测试仍通过。

- [ ] **步骤 5：创建签名提交**

```bash
git add src/main/data/services/AgentService.ts src/main/data/services/__tests__/AgentService.test.ts
git commit -S --signoff -m "fix(agent-lifecycle): distinguish trash from purge"
```

## 任务 2：让 AgentJobsService 执行任务清理与 inactive 守卫

**文件：**
- 修改：`src/main/ai/agents/AgentJobsService.ts:60-301`
- 测试：`src/main/ai/agents/__tests__/AgentJobsService.test.ts:1-700`

- [ ] **步骤 1：写 trash、purge、inactive 与启动恢复的失败测试**

在测试文件顶部注册完整 Agent 删除依赖，并在 teardown 中停止服务：

```ts
import '@data/services/AgentSessionMessageService'

afterAll(async () => {
  await service._doStop()
  await jobManager._doStop()
  await scheduler._doStop()
  BaseService.resetInstances()
})
```

用真实数据库、JobManager 和 SchedulerService 增加以下测试：

```ts
it('permanently removes tasks and subscriptions on trash and does not recreate them on restore', async () => {
  seedChannel(CHANNEL_ID, AGENT_ID)
  const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })

  expect(agentService.deleteAgent(AGENT_ID, { deleteSessions: true })).toMatchObject({ deleted: true })
  await vi.waitFor(() => expect(jobScheduleService.getById(task.id)).toBeNull())
  expect(subscriptionRows(task.id)).toEqual([])
  expect(scheduler.has(`schedule:${task.id}`)).toBe(false)

  agentService.restoreAgent(AGENT_ID)
  expect(jobScheduleService.getById(task.id)).toBeNull()
  expect(subscriptionRows(task.id)).toEqual([])
  expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
})

it('removes a leftover task when a trashed agent is permanently purged', async () => {
  const task = service.createTask(AGENT_ID, form)
  dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

  expect(agentService.deleteAgent(AGENT_ID, { permanent: true })).toMatchObject({ deleted: true })
  await vi.waitFor(() => expect(jobScheduleService.getById(task.id)).toBeNull())
  expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
})

it('reconciles tasks for trashed and missing agents but preserves active agents', async () => {
  seedAgent(OTHER_AGENT_ID)
  seedAgent('missing-owner')
  const trashed = service.createTask(AGENT_ID, form)
  const missing = service.createTask('missing-owner', { ...form, name: 'missing-owner-task' })
  const active = service.createTask(OTHER_AGENT_ID, { ...form, name: 'active-task' })
  dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()
  dbh.db.delete(agentTable).where(eq(agentTable.id, 'missing-owner')).run()

  expect(await service.deleteSchedulesForInactiveAgents()).toBe(2)
  expect(jobScheduleService.getById(trashed.id)).toBeNull()
  expect(jobScheduleService.getById(missing.id)).toBeNull()
  expect(jobScheduleService.getById(active.id)).not.toBeNull()
})

it('refuses task mutations and execution while the owning agent is inactive', async () => {
  const enabled = service.createTask(AGENT_ID, form)
  const paused = service.createTask(AGENT_ID, { ...form, name: 'paused-task' })
  await service.pauseTask(AGENT_ID, paused.id)
  dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

  expect(service.updateTask(AGENT_ID, enabled.id, { name: 'changed' })).toBeNull()
  expect(await service.pauseTask(AGENT_ID, enabled.id)).toBeNull()
  expect(service.resumeTask(AGENT_ID, paused.id)).toBeNull()
  expect(await service.runTask(AGENT_ID, enabled.id)).toBe(false)
  expect(await service.deleteTask(AGENT_ID, enabled.id)).toBe(false)
  expect(jobScheduleService.getById(enabled.id)).toMatchObject({ name: form.name, enabled: true })
  expect(jobScheduleService.getById(paused.id)).toMatchObject({ enabled: false })
})

it('refuses sticky-session binding while the owning agent is inactive', () => {
  const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
  const session = agentSessionService.create({
    agentId: AGENT_ID,
    name: 'Scheduled task',
    workspace: { type: 'system' }
  })
  dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

  expect(
    service.bindTaskSessionReuse({
      scheduleId: task.id,
      sessionId: session.id,
      agentId: AGENT_ID,
      workspace: { type: 'system' },
      reuseRevision: 0
    })
  ).toBe(false)
  expect(agentSessionService.getById(session.id)?.taskScheduleId).toBeNull()
})

it('reconciles inactive-agent schedules after all services are ready', async () => {
  const task = service.createTask(AGENT_ID, form)
  dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

  await service._doAllReady()

  expect(jobScheduleService.getById(task.id)).toBeNull()
  expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
})
```

- [ ] **步骤 2：运行测试并确认失败覆盖每个旧行为**

运行：

```bash
pnpm test:main src/main/ai/agents/__tests__/AgentJobsService.test.ts
```

预期：FAIL，至少包含旧 `onAgentDeleted` 订阅、缺失的 `deleteSchedulesForInactiveAgents()`、inactive 命令仍执行以及启动未对账。

- [ ] **步骤 3：订阅两个生命周期事件并加入启动对账**

将 `onInit()` 中的旧订阅替换为：

```ts
for (const event of [agentService.onAgentTrashed, agentService.onAgentPurged]) {
  this.registerDisposable(
    event(({ agentId }) => {
      void this.deleteSchedulesForAgent(agentId).catch((error) => {
        logger.warn('Failed to delete task schedules for inactive agent', { agentId, error })
      })
    })
  )
}
```

增加启动对账：

```ts
protected override async onAllReady(): Promise<void> {
  try {
    await this.deleteSchedulesForInactiveAgents()
  } catch (error) {
    logger.warn('Failed to reconcile inactive Agent task schedules at startup', { error })
  }
}
```

- [ ] **步骤 4：统一 inactive Agent 命令守卫并重命名对账方法**

增加私有查询：

```ts
private getActiveTask(agentId: string, taskId: string): ScheduledTaskEntity | null {
  if (!agentService.agentExists(agentId)) return null
  return agentTaskService.getTask(agentId, taskId)
}
```

在 `updateTask`、`pauseTask`、`resumeTask`、`deleteTask`、`runTask` 中将：

```ts
const existing = agentTaskService.getTask(agentId, taskId)
```

替换为：

```ts
const existing = this.getActiveTask(agentId, taskId)
```

在 `bindTaskSessionReuse()` 的事务前增加：

```ts
if (!agentService.agentExists(params.agentId)) return false
```

将方法及日志改为：

```ts
/** Delete tasks whose owning Agent is trashed or missing. */
async deleteSchedulesForInactiveAgents(): Promise<number> {
  const schedules = jobScheduleService.listAll({ type: AGENT_TASK_TYPE }).filter((schedule) => {
    const template = readAgentTaskJobInputTemplate(schedule.jobInputTemplate)
    return template !== null && !agentService.agentExists(template.agentId)
  })

  const deletedIds: string[] = []
  for (const schedule of schedules) {
    if (await application.get('JobManager').unregisterJobScheduleById(schedule.id)) {
      deletedIds.push(schedule.id)
    }
  }
  if (deletedIds.length > 0) {
    logger.info('Deleted task schedules for inactive Agents', { deleted: deletedIds.length })
    agentTaskService.notifyReadModelChange(deletedIds)
  }
  return deletedIds.length
}
```

保留 `deleteSchedulesForAgent()` 中逐个调用 `unregisterJobScheduleById()` 的实现，并把注释从 orphan cleanup 改成 Agent task deletion。

- [ ] **步骤 5：运行 AgentJobsService 测试并确认通过**

运行：

```bash
pnpm test:main src/main/ai/agents/__tests__/AgentJobsService.test.ts
```

预期：PASS；schedule 行、timer、channel subscription 和 restore 不重建均被真实集成测试覆盖。

- [ ] **步骤 6：创建签名提交**

```bash
git add src/main/ai/agents/AgentJobsService.ts src/main/ai/agents/__tests__/AgentJobsService.test.ts
git commit -S --signoff -m "fix(agent-tasks): clean up tasks for inactive agents"
```

## 任务 3：连接 retention purge 的永久生命周期与幂等对账

**文件：**
- 修改：`src/main/data/services/AgentService.ts:257-264`
- 修改：`src/main/services/trash/trashPurgeJobHandler.ts:47-68,134-139`
- 测试：`src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts:20-82,234-318,399-418`

- [ ] **步骤 1：先把 purge 测试改为新契约并验证事件发生在提交后**

把 mock 统一改成：

```ts
agentJobsServiceMock: { deleteSchedulesForInactiveAgents: vi.fn(async () => 0) }
```

并从 `@data/services/AgentService` 导入 `agentService`，用于监听真实提交后事件。

在主 purge 测试中监听真实 Agent 生命周期：

```ts
const purgedAgents: string[] = []
const rowsAtPurgeEvent: number[] = []
const disposable = agentService.onAgentPurged(({ agentId }) => {
  purgedAgents.push(agentId)
  rowsAtPurgeEvent.push(dbh.db.select().from(agentTable).where(eq(agentTable.id, agentId)).all().length)
})

try {
  const result = await trashPurgeJobHandler.execute(ctx)
  expect(result).toMatchObject({ purged: expect.objectContaining({ agent: 1 }) })
} finally {
  disposable.dispose()
}
expect(purgedAgents).toEqual(['agent-expired'])
expect(rowsAtPurgeEvent).toEqual([0])
expect(agentJobsServiceMock.deleteSchedulesForInactiveAgents).toHaveBeenCalledTimes(1)
```

保留 retention 0 测试，并把其断言也更新为 `deleteSchedulesForInactiveAgents` 调用一次。

- [ ] **步骤 2：运行 purge 测试确认新事件尚未发布**

运行：

```bash
pnpm test:main src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts
```

预期：FAIL，`purgedAgents` 为空，且 handler 仍引用旧对账方法。

- [ ] **步骤 3：让 AgentService 拥有 purge 的提交后通知**

在 `notifyReadModelChange()` 后增加：

```ts
notifyPurged(agentIds: readonly string[]): void {
  if (agentIds.length === 0) return
  const uniqueIds = [...new Set(agentIds)]
  this.notifyReadModelChange(uniqueIds, 'membership')
  promptService.notifyTargetBindingsChanged()
  for (const agentId of uniqueIds) this.agentPurgedEmitter.fire({ agentId })
}
```

在 trash purge 的 Agent domain 中使用统一方法：

```ts
notifyPurged: (ids) => agentService.notifyPurged(ids)
```

将提交后对账调用改为：

```ts
await application.get('AgentJobsService').deleteSchedulesForInactiveAgents()
```

- [ ] **步骤 4：运行 AgentService 与 purge 测试**

运行：

```bash
pnpm test:main src/main/data/services/__tests__/AgentService.test.ts src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts
```

预期：PASS；purge 事件读取数据库时 Agent 行已经不存在，retention 0 仍执行 schedule 对账。

- [ ] **步骤 5：创建签名提交**

```bash
git add src/main/data/services/AgentService.ts src/main/services/trash/trashPurgeJobHandler.ts src/main/services/trash/__tests__/trashPurgeJobHandler.test.ts
git commit -S --signoff -m "fix(trash-purge): reconcile inactive agent tasks"
```

## 任务 4：在三个 Agent 删除入口显示不可逆警告

**文件：**
- 修改：`src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx:100-254`
- 修改：`src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx:30-45,129-200`
- 修改：`src/renderer/pages/agents/components/Sessions.tsx:1245-1280`
- 修改：`src/renderer/pages/agents/components/__tests__/Sessions.test.tsx:560-650,3625-3800`
- 修改：`src/renderer/components/chat/resourceList/AgentResourceList.tsx:249-277`
- 修改：`src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx:1025-1170`
- 修改：`src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：先修改 UI 测试，要求普通 Agent 显示、受保护 Agent 不显示警告**

测试使用英文内容：

```ts
const agentTasksWarning =
  'Scheduled tasks and channel subscriptions associated with this Agent will be permanently deleted and will not be restored if you restore the Agent.'
```

Resource dialog 普通 Agent 断言：

```ts
expect(screen.getByRole('dialog')).toHaveTextContent(agentTasksWarning)
```

Resource dialog 受保护 Agent 断言：

```ts
expect(screen.getByRole('dialog')).not.toHaveTextContent(agentTasksWarning)
```

Sessions 普通 Agent 和 classic rail 普通 Agent 的 popup 断言分别增加：

```ts
content: 'Scheduled tasks and channel subscriptions associated with this Agent will be permanently deleted and will not be restored if you restore the Agent.'
```

返回 i18n key 的 classic rail 测试使用：

```ts
content: 'recycle_bin.move.agent_tasks_warning'
```

保留两个受保护 Agent 测试的：

```ts
expect(popup.confirm.mock.calls.at(-1)?.[0]).not.toHaveProperty('content')
```

- [ ] **步骤 2：运行三个 renderer 测试确认警告缺失**

运行：

```bash
pnpm test:renderer src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx
```

预期：FAIL，三个普通 Agent 删除入口都没有 warning 内容。

- [ ] **步骤 3：添加英文源 key 并同步所有 locale**

在 `en-us.json` 增加：

```json
"recycle_bin.move.agent_tasks_warning": "Scheduled tasks and channel subscriptions associated with this Agent will be permanently deleted and will not be restored if you restore the Agent."
```

运行：

```bash
pnpm i18n:sync
```

随后将所有 locale 的同一 key 写为以下文本，不保留 `[to be translated]`：

| Locale | Translation |
|---|---|
| `de-de` | Mit diesem Agenten verknüpfte geplante Aufgaben und Kanalabonnements werden dauerhaft gelöscht und beim Wiederherstellen des Agenten nicht wiederhergestellt. |
| `el-gr` | Οι προγραμματισμένες εργασίες και οι συνδρομές καναλιών που σχετίζονται με αυτόν τον Agent θα διαγραφούν οριστικά και δεν θα αποκατασταθούν αν επαναφέρετε τον Agent. |
| `es-es` | Las tareas programadas y las suscripciones a canales asociadas a este agente se eliminarán permanentemente y no se restaurarán al restaurar el agente. |
| `fr-fr` | Les tâches planifiées et les abonnements aux canaux associés à cet agent seront définitivement supprimés et ne seront pas restaurés si vous restaurez l’agent. |
| `ja-jp` | このエージェントに関連付けられたスケジュール済みタスクとチャンネル購読は完全に削除され、エージェントを復元しても元に戻りません。 |
| `pt-pt` | As tarefas agendadas e as subscrições de canais associadas a este Agente serão eliminadas permanentemente e não serão restauradas se restaurar o Agente. |
| `ro-ro` | Sarcinile programate și abonamentele la canale asociate acestui Agent vor fi șterse definitiv și nu vor fi restaurate dacă restaurați Agentul. |
| `ru-ru` | Запланированные задачи и подписки на каналы, связанные с этим агентом, будут удалены безвозвратно и не восстановятся при восстановлении агента. |
| `tr-tr` | Bu Agent ile ilişkili zamanlanmış görevler ve kanal abonelikleri kalıcı olarak silinecek ve Agent geri yüklendiğinde geri getirilmeyecektir. |
| `vi-vn` | Các tác vụ đã lên lịch và đăng ký kênh liên kết với Agent này sẽ bị xóa vĩnh viễn và sẽ không được khôi phục khi bạn khôi phục Agent. |
| `zh-cn` | 与此 Agent 关联的定时任务和频道订阅将被永久删除，恢复 Agent 后不会恢复。 |
| `zh-tw` | 與此 Agent 關聯的排程任務和頻道訂閱將被永久刪除，還原 Agent 後也不會恢復。 |

- [ ] **步骤 4：接入 ResourceDeleteConfirmDialog 的 description**

扩展文件内私有组件参数：

```ts
interface DeleteDialogContentProps {
  resource: ResourceItem
  onClose: () => void
  onDelete: () => Promise<void>
  description?: string
}
```

普通 Agent 调用时传入：

```tsx
<DeleteDialogContent
  resource={resource}
  onClose={onClose}
  onDelete={onDelete}
  description={deleteTasksOnly ? undefined : t('recycle_bin.move.agent_tasks_warning')}
/>
```

组件将外部 `description` 优先于既有类型默认值：

```tsx
const { title, description: defaultDescription, confirmText } = useMemo(/* existing mapping */, [resource.type, t])

<ConfirmDialog description={description ?? defaultDescription} />
```

- [ ] **步骤 5：接入两个 popup.confirm 删除入口且不污染受保护流程**

在 `Sessions.tsx` 和 `AgentResourceList.tsx` 的 confirm 参数中增加条件展开：

```ts
const confirmed = await popup.confirm({
  title: t('recycle_bin.move.confirm_title'),
  ...(deleteTasksOnly ? {} : { content: t('recycle_bin.move.agent_tasks_warning') }),
  okText: t('recycle_bin.move.confirm_action'),
  cancelText: t('common.cancel'),
  centered: true,
  okButtonProps: { danger: true }
})
```

- [ ] **步骤 6：运行 UI 与 i18n 验证**

运行：

```bash
pnpm test:renderer src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx
pnpm i18n:check
pnpm i18n:unused:check
pnpm i18n:hardcoded:strict
```

预期：全部 PASS；所有 locale key 对齐、无占位符、key 被生产代码引用，受保护 Agent 无 warning。

- [ ] **步骤 7：创建签名提交**

```bash
git add src/renderer/components/resourceCatalog/dialogs/delete/ResourceDeleteConfirmDialog.tsx src/renderer/components/resourceCatalog/dialogs/delete/__tests__/ResourceDeleteConfirmDialog.test.tsx src/renderer/pages/agents/components/Sessions.tsx src/renderer/pages/agents/components/__tests__/Sessions.test.tsx src/renderer/components/chat/resourceList/AgentResourceList.tsx src/renderer/components/chat/resourceList/__tests__/EntityResourceListActions.test.tsx src/renderer/i18n/locales
git commit -S --signoff -m "fix(agent-delete): warn about irreversible task cleanup"
```

## 任务 5：更新 breaking-change 说明并执行整体验证

**文件：**
- 修改：`v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md:17-24`

- [ ] **步骤 1：记录不可恢复的 Agent 子数据**

在用户影响列表加入：

```md
- Moving an Agent to the Recycle Bin permanently deletes its scheduled tasks and channel subscriptions. Restoring the Agent does not recreate them.
```

- [ ] **步骤 2：运行文档门禁**

运行：

```bash
pnpm docs:check
```

预期：PASS，链接、目录结构、frontmatter 与索引均保持有效。

- [ ] **步骤 3：创建签名提交**

```bash
git add v2-refactor-temp/docs/breaking-changes/2026-07-04-topic-delete-moves-to-trash.md
git commit -S --signoff -m "docs(recycle-bin): document agent task deletion"
```

- [ ] **步骤 4：运行格式、类型、i18n、完整测试和 warning 门禁**

运行：

```bash
pnpm lint
pnpm build:check
pnpm test:lint
```

预期：三个命令退出码均为 0。`pnpm build:check` 覆盖 lint、docs 和完整 Vitest；`pnpm test:lint` 额外拒绝 warning。

- [ ] **步骤 5：检查格式化副作用与提交签名**

运行：

```bash
git status --short
git diff --check
git log --format='%h %s' d434fec6629270137e9ece76ec40de72e5004703..HEAD
for commit in $(git rev-list d434fec6629270137e9ece76ec40de72e5004703..HEAD); do
  git cat-file commit "$commit" | grep -q '^gpgsig ' || exit 1
  git cat-file commit "$commit" | grep -q '^Signed-off-by: ' || exit 1
done
```

预期：工作区干净、无 whitespace error，每个新增 commit 同时包含 `gpgsig` 与 `Signed-off-by`。

如果 `pnpm lint` 只格式化了本计划涉及的文件，用同一职责的签名提交收纳；若修改无关文件，恢复这些格式化副作用而不触碰用户改动。

## 任务 6：push、观察 CI、关闭原 review 并 approve

**文件：**
- 无本地文件修改。

- [ ] **步骤 1：非强制 push 当前 PR 分支**

运行：

```bash
git push origin HEAD
```

预期：`DeJeune/archive-vs-delete-domains` 前进到本地 HEAD；禁止使用任何 force 参数。

- [ ] **步骤 2：验证 GitHub commit 签名并等待 PR CI**

运行：

```bash
for commit in $(git rev-list d434fec6629270137e9ece76ec40de72e5004703..HEAD); do
  gh api "repos/CherryHQ/cherry-studio/commits/$commit" --jq '.commit.verification.verified' | grep -qx true || exit 1
done
gh pr checks 16746 --watch --interval 20
```

预期：每个 commit 输出 `true`，所有 required checks 通过。若 CI 失败，先判断失败是否由当前 diff 引入；仅修复当前 PR 引入的问题并重新执行对应验证。

- [ ] **步骤 3：确认原评论对应的代码与测试已存在**

运行：

```bash
git grep -n "onAgentTrashed\|onAgentPurged\|deleteSchedulesForInactiveAgents\|agent_tasks_warning"
gh pr diff 16746 | rg -n "onAgentTrashed|onAgentPurged|deleteSchedulesForInactiveAgents|agent_tasks_warning"
```

预期：diff 同时包含事件拆分、trash/purge/启动清理、inactive 命令守卫及不可逆 UI 提示。

- [ ] **步骤 4：解决原 review thread 并提交批准**

先查询原 thread 的 GraphQL ID，再执行 `resolveReviewThread`；随后批准：

```bash
REVIEW_THREAD_ID=$(gh api graphql \
  -f owner=CherryHQ \
  -f name=cherry-studio \
  -F number=16746 \
  -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id comments(first:100){nodes{url}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(any(.comments.nodes[]; .url == "https://github.com/CherryHQ/cherry-studio/pull/16746#discussion_r3891602270")) | .id')
test -n "$REVIEW_THREAD_ID"
gh api graphql \
  -f threadId="$REVIEW_THREAD_ID" \
  -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' \
  --jq '.data.resolveReviewThread.thread.isResolved'
gh pr review 16746 --approve --body "The Agent lifecycle now distinguishes trash from purge. Trashing permanently removes task schedules and channel subscriptions, restore does not rebuild them, inactive task commands are blocked, and startup/purge recovery plus UI warnings are covered by tests."
```

预期：原 blocking thread 标记 resolved，PR review 状态变为 `APPROVED`。
